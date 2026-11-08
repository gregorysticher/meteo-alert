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

// Facultatifs : leur panne rend le run rouge mais ne bloque pas les alertes.
export const PARAMS_OPTION = {
  air: 'tre200h0',    // temperature de l'air a 2 m, degres C
};

async function texte(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ' -> HTTP ' + res.status);
  return new TextDecoder('latin1').decode(await res.arrayBuffer());
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
  const j = await (await fetch(STAC)).json();
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
    } catch (err) {
      console.error(`ECHEC prevision ${param} : ${err.message}`);
      process.exitCode = 1;
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
  const resMeta = await fetch(AROME_META);
  if (!resMeta.ok) throw new Error('meta AROME -> HTTP ' + resMeta.status);
  const init = (await resMeta.json()).last_run_initialisation_time;
  if (!Number.isFinite(init)) throw new Error('meta AROME sans heure de run');
  const emission = new Date(init * 1000).toISOString().slice(0, 16).replace(/[-:T]/g, '');

  const url = 'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${spots.map((s) => s.lat).join(',')}` +
    `&longitude=${spots.map((s) => s.lon).join(',')}` +
    '&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m' +
    `&models=${AROME_MODELE}&wind_speed_unit=kn&timezone=GMT&forecast_days=3`;
  const res = await fetch(url);
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

export async function mesures(codes) {
  const lignes = (await texte(MESURES)).split('\n');
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

/** Non bloquant : renvoie null en cas d'echec, le reste continue. */
export async function tempLac(lac, lat, lon) {
  if (!lac) return null;
  const f = (d) =>
    new Date(Date.now() + d * 864e5).toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const url =
    ALPLAKES + '/simulations/point/delft3d-flow/' + lac + '/' +
    f(0) + '/' + f(1) + '/0/' + lat + '/' + lon + '?variables=temperature';
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = await res.json();
    const d = j && j.variables && j.variables.temperature && j.variables.temperature.data;
    const v = Array.isArray(d) ? d.find((x) => typeof x === 'number') : null;
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
}
