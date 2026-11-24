// snow-msl.mjs — journal en parallèle : neige prévue par MeteoSuisse à Planachaux (D-008,
// Décision 1, Greg 24.11.2026). INFORMATION SEULEMENT : aucune alerte ni l'écran n'en
// dépendent. Source informative au sens de D-007 (avertissement, rouge après 24 h de panne).
//
// Source : prévisions locales MeteoSuisse (ogd-local-forecasting, la même API que l'alerte
// vent), point station WNSPLA (Champéry / Planachaux, 1943 m, à 1,9 km de Les Collines).
// Paramètres : rre150h0 (précipitation de l'heure, mm) et tre200h0 (température à 2 m, °C).
// Valeur datée de la FIN de l'heure, en UTC (AAAAMMJJHHmm). Horizon ~9 jours.
// Conversion D-005 (snow-conversion.mjs), température ramenée à 2022 m (−0,65 °C / 100 m).
//
// Deux découpages, écrits dans data/neige.csv (snow-qa.mjs) :
//   modele msl   jour civil local, 00h → 24h (comme ICON, modele icon) ;
//   modele msl7  fenêtre du relevé SLF, 7h le jour J → 7h le jour J+1, rangée au jour J :
//                elle se compare au HN_1D daté J+1 (lecture J+1, D-005). La neige qui tombe
//                la nuit est à cheval sur deux jours civils (22-23.11.2026), pas sur deux
//                fenêtres. ICON a la même fenêtre : modele icon7 (snow-forecast-alert.mjs).
// Seuls les jours ou fenêtres complets sont écrits : le jour du run, un run de l'après-midi
// n'a plus les heures du matin.

import { lireEssai, fetchEssai } from './reseau.mjs';
import { neigeHoraire, partNeige } from './snow-conversion.mjs';
import { local } from './silence.mjs';

const STAC = 'https://data.geo.admin.ch/api/stac/v1/collections/' +
  'ch.meteoschweiz.ogd-local-forecasting/items';
const META = 'https://data.geo.admin.ch/ch.meteoschweiz.ogd-local-forecasting/' +
  'ogd-local-forecasting_meta_point.csv';

export const STATION_MSL = 'WNSPLA';
export const PARAMS_MSL = { mm: 'rre150h0', t: 'tre200h0' };
export const GRADIENT_K_M = 0.0065;
export const DEBUT_RELEVE_H = 7;            // heure locale du relevé SLF (HN_1D)

const HEURE = 36e5;
const r2 = (x) => Math.round(x * 100) / 100;
const r1 = (x) => Math.round(x * 10) / 10;
const veille = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
const nombre = (x) => typeof x === 'number' && Number.isFinite(x);

// ---- fonctions pures ----------------------------------------------------------------

// Le run le plus récent qui a TOUS les paramètres : pendant la publication, un paramètre
// peut précéder l'autre, et il ne faut pas mêler deux runs. noms = noms d'assets du STAC.
export function choisirRun(noms, params = Object.values(PARAMS_MSL)) {
  const runs = new Map();
  for (const n of noms) {
    const m = /^vnut12\.lssw\.(\d{12})\.([a-z0-9]+)\.csv$/.exec(n);
    if (!m) continue;
    if (!runs.has(m[1])) runs.set(m[1], new Set());
    runs.get(m[1]).add(m[2]);
  }
  return [...runs].filter(([, s]) => params.every((p) => s.has(p))).map(([r]) => r).sort().at(-1) ?? null;
}

// Point station du méta-fichier : { id, alt }, ou null.
export function trouverPoint(csv, abbr = STATION_MSL) {
  const l = csv.split('\n');
  const e = l[0].trim().split(';');
  const iId = e.indexOf('point_id'), iType = e.indexOf('point_type_id');
  const iAbbr = e.indexOf('station_abbr'), iAlt = e.indexOf('point_height_masl');
  for (const x of l.slice(1)) {
    const c = x.split(';');
    if (c[iType] === '1' && (c[iAbbr] ?? '').trim().toUpperCase() === abbr) {
      const alt = parseFloat(c[iAlt]);
      return nombre(alt) ? { id: c[iId], alt } : null;
    }
  }
  return null;
}

// Valeurs d'un point dans un CSV de prévision : Map Date (AAAAMMJJHHmm UTC) → nombre.
export function valeursPoint(csv, param, id) {
  const l = csv.split('\n');
  const e = l[0].trim().split(';');
  const iId = e.indexOf('point_id'), iD = e.indexOf('Date'), iV = e.indexOf(param);
  if (iId < 0 || iD < 0 || iV < 0) throw new Error(`colonne ${param} absente`);
  const out = new Map();
  for (const x of l.slice(1)) {
    const c = x.split(';');
    if (c[iId] !== id || c.length <= Math.max(iD, iV)) continue;   // ligne tronquée : ignorée
    const v = parseFloat(c[iV]);
    if (Number.isFinite(v)) out.set(c[iD].trim(), v);
  }
  return out;
}

const finUtc = (d) => Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(8, 10), +d.slice(10, 12) || 0);

// Heures MeteoSuisse converties : [{ debut (ms UTC), jour, h (heure locale de début), cm,
// mm, pluie, t }], triées. Une heure sans précipitation ou sans température valide manque :
// le jour ou la fenêtre qui la contient devient incomplet, jamais 0.
export function heuresMsl(pr, te, { altPoint, alt, bornes, gradient = GRADIENT_K_M }) {
  const out = [];
  for (const [d, mm] of pr) {
    const t0 = te.get(d);
    if (!/^\d{12}$/.test(d) || !nombre(mm) || mm < 0 || !nombre(t0)) continue;
    const debut = finUtc(d) - HEURE;
    const l = local(new Date(debut));
    const t = t0 - gradient * (alt - altPoint);
    out.push({ debut, jour: l.jour, h: Math.floor(l.minutes / 60), mm, t,
      cm: neigeHoraire(mm, t, bornes), pluie: mm > 0 ? mm * (1 - partNeige(t, bornes)) : 0 });
  }
  return out.sort((a, b) => a.debut - b.debut);
}

// Heures ICON d'Open-Meteo (snow-forecast-alert) au même format. hourly.time = fin de
// l'heure, heure locale à décalage FIXE pour toute la réponse (utc_offset_seconds) : on
// revient en UTC puis à l'heure de Genève, pour que la fenêtre 7h → 7h soit la même que
// msl7 autour d'un changement d'heure. Sans décalage connu : heure « nue ».
export function heuresIcon(hourly, bornes, decalageS = null) {
  const { time = [], precipitation: p = [], temperature_2m: tt = [] } = hourly ?? {};
  const out = [];
  time.forEach((lab, i) => {
    const mm = p[i], t = tt[i];
    if (!nombre(mm) || mm < 0 || !nombre(t)) return;
    const nu = Date.parse(`${String(lab).slice(0, 16)}Z`) - HEURE;
    if (!Number.isFinite(nu)) return;
    let debut = nu, jour, h;
    if (nombre(decalageS)) {
      debut = nu - decalageS * 1000;
      const l = local(new Date(debut));
      jour = l.jour; h = Math.floor(l.minutes / 60);
    } else {
      const iso = new Date(nu).toISOString();
      jour = iso.slice(0, 10); h = +iso.slice(11, 13);
    }
    out.push({ debut, jour, h, mm, t,
      cm: neigeHoraire(mm, t, bornes), pluie: mm > 0 ? mm * (1 - partNeige(t, bornes)) : 0 });
  });
  return out.sort((a, b) => a.debut - b.debut);
}

// Cumuls par jour civil (debutH = 0) ou par fenêtre du relevé (debutH = 7, rangée au jour où
// elle commence). Seuls les découpages complets : première heure à debutH, dernière à
// debutH − 1, heures consécutives (23 ou 25 aux changements d'heure).
// Renvoie [{ jour, cm, mm, pluie, tMoy }] triés.
export function cumuls(heures, debutH = 0) {
  const g = new Map();
  for (const x of heures) {
    const k = x.h >= debutH ? x.jour : veille(x.jour);
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(x);
  }
  const out = [];
  for (const [jour, hs] of g) {
    const ok = hs.length >= 23 && hs.length <= 25 && hs[0].h === debutH &&
      hs.at(-1).h === (debutH + 23) % 24 && hs.every((x, i) => i === 0 || x.debut - hs[i - 1].debut === HEURE);
    if (!ok) continue;
    const s = (c) => hs.reduce((a, x) => a + x[c], 0);
    out.push({ jour, cm: r2(s('cm')), mm: r2(s('mm')), pluie: r2(s('pluie')), tMoy: r1(s('t') / hs.length) });
  }
  return out.sort((a, b) => a.jour.localeCompare(b.jour));
}

// ---- accès réseau ---------------------------------------------------------------------

const texte = (url) => lireEssai(url, async (res) => new TextDecoder('latin1').decode(await res.arrayBuffer()));

// { run, heures, point } du dernier run complet. Lève une erreur si quelque chose manque.
export async function previsionMsl({ alt, bornes }) {
  const res = await fetchEssai(STAC);
  if (!res.ok) throw new Error(`STAC : HTTP ${res.status}`);
  const hrefs = new Map();
  for (const f of (await res.json()).features ?? []) {
    for (const [k, v] of Object.entries(f.assets ?? {})) hrefs.set(k, v.href);
  }
  const run = choisirRun([...hrefs.keys()]);
  if (!run) throw new Error('aucun run avec rre150h0 et tre200h0');
  const point = trouverPoint(await texte(META));
  if (!point) throw new Error(`point ${STATION_MSL} absent du méta-fichier`);
  const lire = async (param) =>
    valeursPoint(await texte(hrefs.get(`vnut12.lssw.${run}.${param}.csv`)), param, point.id);
  const pr = await lire(PARAMS_MSL.mm);
  const te = await lire(PARAMS_MSL.t);
  const heures = heuresMsl(pr, te, { altPoint: point.alt, alt, bornes });
  if (!heures.length) throw new Error(`run ${run} : aucune heure exploitable pour ${STATION_MSL}`);
  return { run, point, heures };
}
