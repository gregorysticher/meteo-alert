// wind-sources.mjs — acces MeteoSuisse (mesures + previsions), Alplakes (lac) et
// Open-Meteo (AROME, second avis archive pour la QA, aucune alerte n'en depend).
// Source: MeteoSwiss / Eawag Alplakes / Open-Meteo (Meteo-France).
//
// Schemas verifies en production le 29/08/2026 :
//   VQHA80      Station/Location;Date;...;dkl010z0;fu3010z0;fu3010z1
//   previsions  vnut12.lssw.<AAAAMMJJHH00>.<param>.csv
//               point_id;point_type_id;Date;<param>
//
// Piege d'unite : fu3* est en km/h, fkl* en m/s. Les deux existent dans le
// catalogue MeteoSuisse. On verifie la presence de la colonne attendue plutot
// que de supposer, comme le faisait deja l'ancien controle Open-Meteo.

import { fetchEssai, lireEssai } from './reseau.mjs';
import { informatif, sourceOk, enPanne } from './gravite.mjs';

const STAC =
  'https://data.geo.admin.ch/api/stac/v1/collections/' +
  'ch.meteoschweiz.ogd-local-forecasting/items';
const POINTS =
  'https://data.geo.admin.ch/ch.meteoschweiz.ogd-local-forecasting/' +
  'ogd-local-forecasting_meta_point.csv';
const MESURES =
  'https://data.geo.admin.ch/ch.meteoschweiz.messwerte-aktuell/VQHA80.csv';
const ALPLAKES = 'https://alplakes-api.eawag.ch';
const AROME_MODELE = 'meteofrance_arome_france_hd';
const AROME_META =
  `https://api.open-meteo.com/data/${AROME_MODELE}/static/meta.json`;

export const KMH_KN = 1 / 1.852;

export const PARAMS = {
  moy: 'fu3010h0',
  rafale: 'fu3010h1',
  q10: 'fu3q10h0',
  dir: 'dkl010h0',
};

// Facultatifs : leur panne ne bloque pas les alertes (avertissement, rouge apres 24 h).
export const PARAMS_OPTION = {
  air: 'tre200h0',    // temperature de l'air a 2 m, degres C
};

// Lecture du corps dans l'essai : un CSV de ~30 Mo coupé en route est réessayé.
async function texte(url) {
  return lireEssai(url, async (res) => new TextDecoder('latin1').decode(await res.arrayBuffer()));
}

// ---- points de prevision -------------------------------------------------

export async function resoudrePoints(spots) {
  const lignes = (await texte(POINTS)).split('\n');
  const e = lignes[0].trim().split(';');
  const iId = e.indexOf('point_id');
  const iType = e.indexOf('point_type_id');
  const iAbbr = e.indexOf('station_abbr');
  const iNom = e.indexOf('point_name');

  const parStation = new Map();
  const parNpa = new Map();
  for (let i = 1; i < lignes.length; i++) {
    const c = lignes[i].split(';');
    if (c.length <= iNom) continue;
    if (c[iType] === '1') {
      parStation.set((c[iAbbr] || '').trim().toUpperCase(), c[iId]);
    } else if (c[iType] === '2') {
      const n = (c[iNom] || '').trim();
      if (!parNpa.has(n)) parNpa.set(n, c[iId]);
    }
  }

  const res = new Map();
  for (const s of spots) {
    const id =
      s.point.type === 'station'
        ? parStation.get(s.point.nom.toUpperCase())
        : parNpa.get(s.point.nom);
    if (id) res.set(s.key, id);
    else console.warn('  ! point introuvable : ' + s.nom + ' (' + s.point.nom + ')');
  }
  return res;
}

// ---- previsions ----------------------------------------------------------

async function dernierAsset(param) {
  const j = await (await fetchEssai(STAC)).json();
  const assets = {};
  for (const f of j.features || []) {
    for (const [k, v] of Object.entries(f.assets || {})) assets[k] = v.href;
  }
  const cles = Object.keys(assets)
    .filter((k) => k.endsWith('.' + param + '.csv'))
    .sort();
  if (!cles.length) throw new Error('Aucun asset pour ' + param);
  const nom = cles[cles.length - 1];
  return { url: assets[nom], nom };
}

async function serie(param, ids) {
  const { url, nom } = await dernierAsset(param);
  const lignes = (await texte(url)).split('\n');
  const e = lignes[0].trim().split(';');
  const iId = e.indexOf('point_id');
  const iDate = e.indexOf('Date');
  const iVal = e.indexOf(param);
  if (iVal < 0) throw new Error('Colonne ' + param + ' absente de ' + nom);

  const out = new Map();
  for (let i = 1; i < lignes.length; i++) {
    const c = lignes[i].split(';');
    if (c.length <= iVal || !ids.has(c[iId])) continue;
    const v = parseFloat(c[iVal]);
    if (Number.isFinite(v)) out.set(c[iId] + '|' + c[iDate], v);
  }
  return { data: out, emission: nom.split('.')[2] };
}

/** Previsions horaires par spot, converties en noeuds. Dates en UTC. */
export async function previsions(spots) {
  const points = await resoudrePoints(spots);
  const ids = new Set(points.values());
  const series = {};
  let emission = null;
  for (const [label, param] of Object.entries(PARAMS)) {
    const r = await serie(param, ids);
    series[label] = r.data;
    if (!emission) emission = r.emission;
  }
  for (const [label, param] of Object.entries(PARAMS_OPTION)) {
    try {
      series[label] = (await serie(param, ids)).data;
      sourceOk(`prevision ${param}`);
    } catch (err) {
      informatif(`prevision ${param}`, err);
      series[label] = new Map();
    }
  }

  const parSpot = new Map();
  for (const s of spots) {
    const pid = points.get(s.key);
    if (!pid) continue;
    const out = [];
    for (const [cle, moy] of series.moy) {
      const sep = cle.indexOf('|');
      if (cle.slice(0, sep) !== pid) continue;
      const g = (l) => series[l].get(cle);
      out.push({
        date: cle.slice(sep + 1),
        kn: moy * KMH_KN,
        rafale: (g('rafale') || 0) * KMH_KN,
        q10: (g('q10') || 0) * KMH_KN,
        dir: g('dir') === undefined ? null : g('dir'),
        air: g('air') === undefined ? null : g('air'),
      });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    parSpot.set(s.key, out);
  }
  return { emission, parSpot };
}

// ---- AROME (second avis) -------------------------------------------------

/**
 * AROME 1,3 km via Open-Meteo, meme forme que previsions(). Schema verifie le
 * 08/11/2026 sur les 8 spots : nœuds, rafales et direction, horizon ~51 h.
 * emission = heure d'initialisation du run (meta.json) ; les heures anterieures,
 * qu'Open-Meteo renvoie aussi, sont ecartees : ce ne sont pas des previsions.
 * Leve une erreur si la reponse est inexploitable.
 */
export async function previsionsArome(spots) {
  // Meta 404 : le serveur US 51.81.167.44, où GitHub envoie souvent les runners, n'a
  // aucune meta (16/11/2026 ; les 404 des 13-15/11, crus liés aux mises à jour du
  // modèle, venaient de là). Second essai par les serveurs de secours (reseau.mjs), après
  // 80 s comme avant : si une mise à jour du modèle donne aussi des 404, elle est passée.
  const resMeta = await fetchEssai(AROME_META, {}, { attenteFois: 4, secoursSi: [404] });
  if (!resMeta.ok) throw new Error('meta AROME -> HTTP ' + resMeta.status);
  const init = (await resMeta.json()).last_run_initialisation_time;
  if (!Number.isFinite(init)) throw new Error('meta AROME sans heure de run');
  // Source figee : l'archive n'ecrirait plus rien, en vert.
  if (Date.now() / 1000 - init > 24 * 3600) {
    throw new Error(`run AROME de plus de 24 h (${new Date(init * 1000).toISOString()})`);
  }
  const emission = new Date(init * 1000).toISOString().slice(0, 16).replace(/[-:T]/g, '');

  const url = 'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${spots.map((s) => s.lat).join(',')}` +
    `&longitude=${spots.map((s) => s.lon).join(',')}` +
    '&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m' +
    `&models=${AROME_MODELE}&wind_speed_unit=kn&timezone=GMT&forecast_days=3`;
  const res = await fetchEssai(url);
  if (!res.ok) throw new Error('AROME -> HTTP ' + res.status);
  const reponses = [].concat(await res.json());
  if (reponses.length !== spots.length) {
    throw new Error(`AROME : ${reponses.length} reponses pour ${spots.length} spots`);
  }

  const parSpot = new Map();
  spots.forEach((s, i) => {
    const { hourly: h, hourly_units: u } = reponses[i];
    if (u?.wind_speed_10m !== 'kn') {
      throw new Error(`AROME : unite ${u?.wind_speed_10m} au lieu de kn (${s.key})`);
    }
    const out = [];
    h.time.forEach((t, j) => {
      const date = t.replace(/[-:T]/g, '');
      const kn = h.wind_speed_10m[j];
      if (date < emission || typeof kn !== 'number') return;
      out.push({ date, kn, q10: null, rafale: h.wind_gusts_10m[j] ?? null,
        dir: h.wind_direction_10m[j] ?? null });
    });
    if (!out.length) throw new Error(`AROME : aucune prevision pour ${s.key}`);
    parSpot.set(s.key, out);
  });
  return { emission, parSpot };
}

// ---- mesures temps reel --------------------------------------------------

// Un seul telechargement de VQHA80 par run (appele pour l'ecran, le journal et le
// gradient) : le texte, ou l'echec apres son nouvel essai, est garde pour le run.
let vqha80 = null;
// Tests dans un meme processus : chaque scenario simule un autre VQHA80.
export function oublierMesures() { vqha80 = null; }

export async function mesures(codes) {
  vqha80 ??= texte(MESURES);
  const lignes = (await vqha80).split('\n');
  const e = lignes[0].trim().split(';');
  const iDate = e.indexOf('Date');
  const iMoy = e.indexOf('fu3010z0');
  const iRaf = e.indexOf('fu3010z1');
  const iDir = e.indexOf('dkl010z0');
  const iAir = e.indexOf('tre200s0');
  if (iMoy < 0) throw new Error('Colonne fu3010z0 absente de VQHA80');

  const out = new Map();
  for (let i = 1; i < lignes.length; i++) {
    const c = lignes[i].split(';');
    if (c.length <= iMoy) continue;
    const code = (c[0] || '').trim().toUpperCase();
    if (!codes.has(code)) continue;
    const n = (j) => {
      const v = parseFloat(c[j]);
      return Number.isFinite(v) ? v : null;
    };
    const m = n(iMoy);
    const r = n(iRaf);
    out.set(code, {
      kn: m === null ? null : m * KMH_KN,
      rafale: r === null ? null : r * KMH_KN,
      dir: n(iDir),
      air: iAir < 0 ? null : n(iAir),
      date: c[iDate],
    });
  }
  return out;
}

// ---- temperature de surface du lac --------------------------------------

/**
 * Non bloquant : renvoie null en cas d'echec, le reste continue.
 * Simulation au pas de 3 h : la valeur est celle du pas suivant, jusqu'a 3 h apres
 * l'instant demande. Unite verifiee le 08/11/2026 (degC, profondeur 0,17 m).
 * Source informative (D-007) : Alplakes injoignable (reseau, 5xx, 429) apres son
 * nouvel essai -> avertissement, et les appels suivants du run sont sautes (le
 * 23.11.2026, un essai par spot avait coute 5 minutes). Un 4xx reste propre au point.
 */
export const SOURCE_LAC = 'lac (Alplakes)';

export async function tempLac(lac, lat, lon) {
  if (!lac || enPanne(SOURCE_LAC)) return null;
  const f = (d) =>
    new Date(Date.now() + d * 864e5).toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const url =
    ALPLAKES + '/simulations/point/delft3d-flow/' + lac + '/' +
    f(0) + '/' + f(1) + '/0/' + lat + '/' + lon + '?variables=temperature';
  let res;
  try {
    res = await fetchEssai(url);
  } catch (err) {
    informatif(SOURCE_LAC, err);
    return null;
  }
  if (res.status >= 500 || res.status === 429) {
    informatif(SOURCE_LAC, `HTTP ${res.status}`);
    return null;
  }
  try {
    if (!res.ok) return null;
    sourceOk(SOURCE_LAC);
    const j = await res.json();
    const temp = j && j.variables && j.variables.temperature;
    if (temp && temp.unit && temp.unit !== 'degC') return null;
    const d = temp && temp.data;
    const v = Array.isArray(d) ? d.find((x) => typeof x === 'number') : null;
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
}
