// wind-sources.mjs — acces MeteoSuisse (mesures + previsions) et Alplakes (lac).
// Source: MeteoSwiss / Eawag Alplakes.
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

export const KMH_KN = 1 / 1.852;

export const PARAMS = {
  moy: 'fu3010h0',
  rafale: 'fu3010h1',
  q10: 'fu3q10h0',
  dir: 'dkl010h0',
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
      });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    parSpot.set(s.key, out);
  }
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
