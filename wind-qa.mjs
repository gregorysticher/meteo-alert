// wind-qa.mjs — boucle qualite.
// 1. archive les previsions et les apparie aux mesures reelles (biais modele)
// 2. journalise les mesures brutes (verite terrain independante)
// 3. journalise les alertes envoyees et les confronte au vent mesure
//
// Pourquoi : aucune station SMN n'est *sur* un spot, et la prevision
// sous-estime systematiquement. Le seul moyen de savoir ce que vaut une alerte
// est de mesurer l'ecart dans la duree, par spot et par echeance.
//
// Fichiers, commites par le workflow :
//   data/forecasts.csv  archive brute des previsions
//   data/qa.csv         appariements prevision <-> mesure
//   data/mesures.csv    mesures horaires brutes par station
//   data/alertes.csv    alertes envoyees
//   data/alertes_qa.csv verdict de chaque alerte une fois la fenetre passee

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { mesures } from './wind-sources.mjs';

const DIR = 'data';
const ARCHIVE = DIR + '/forecasts.csv';
const QA = DIR + '/qa.csv';
const MESURES = DIR + '/mesures.csv';
const ALERTES = DIR + '/alertes.csv';
const ALERTES_QA = DIR + '/alertes_qa.csv';

const ENT_ARCHIVE = 'emission,spot,station,echeance,kn,q10,rafale,dir';
const ENT_QA =
  'emission,spot,station,echeance,lead_h,prevu_kn,mesure_kn,erreur_kn';
const ENT_MESURES = 'ts,station,kn,rafale,dir';
const ENT_ALERTES =
  'envoye_le,etage,spot,station,debut,fin,prevu_kn,corrige_kn,lead_h';
const ENT_ALERTES_QA =
  'envoye_le,etage,spot,debut,fin,prevu_kn,mesure_moy_kn,mesure_max_kn,' +
  'n_mesures,verdict';

async function lire(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function ajouter(path, entete, lignes) {
  if (!lignes.length) return 0;
  await mkdir(DIR, { recursive: true });
  const existant = await lire(path);
  const corps = existant.trim()
    ? existant.trimEnd() + '\n' + lignes.join('\n') + '\n'
    : entete + '\n' + lignes.join('\n') + '\n';
  await writeFile(path, corps);
  return lignes.length;
}

/** Horodatage MeteoSuisse AAAAMMJJHHMM -> Date UTC. */
export function versDate(s) {
  return new Date(
    Date.UTC(
      +s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
      +s.slice(8, 10), +s.slice(10, 12)
    )
  );
}

export function versCle(d) {
  return d.toISOString().slice(0, 16).replace(/[-:T]/g, '');
}

// ---- 1. archive des previsions -------------------------------------------

export async function archiver(emission, spots, parSpot) {
  const lignes = [];
  for (const s of spots) {
    for (const l of parSpot.get(s.key) || []) {
      lignes.push([emission, s.key, s.station, l.date,
        l.kn.toFixed(1), l.q10.toFixed(1), l.rafale.toFixed(1),
        l.dir === null ? '' : Math.round(l.dir)].join(','));
    }
  }
  return ajouter(ARCHIVE, ENT_ARCHIVE, lignes);
}

// ---- 2. mesures brutes ----------------------------------------------------

/** Verite terrain, independante de toute prevision. Idempotent par heure. */
export async function journaliserMesures(spots) {
  const codes = new Set(spots.map((s) => s.station));
  const m = await mesures(codes).catch(() => new Map());
  if (!m.size) return 0;

  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  const ts = versCle(now);

  const vu = new Set();
  for (const l of (await lire(MESURES)).split('\n').slice(1)) {
    const c = l.split(',');
    if (c.length > 1) vu.add(c[0] + '|' + c[1]);
  }

  const lignes = [];
  for (const [station, v] of m) {
    if (vu.has(ts + '|' + station) || v.kn === null) continue;
    lignes.push([ts, station, v.kn.toFixed(1),
      v.rafale === null ? '' : v.rafale.toFixed(1),
      v.dir === null ? '' : Math.round(v.dir)].join(','));
  }
  return ajouter(MESURES, ENT_MESURES, lignes);
}

// ---- 3. appariement prevision <-> mesure ---------------------------------

export async function apparier(spots) {
  const archive = await lire(ARCHIVE);
  if (!archive.trim()) return 0;

  const codes = new Set(spots.map((s) => s.station));
  const m = await mesures(codes);
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  const cible = versCle(now);

  const vu = new Set();
  for (const l of (await lire(QA)).split('\n').slice(1)) {
    const c = l.split(',');
    if (c.length > 3) vu.add(c[0] + '|' + c[1] + '|' + c[3]);
  }

  const lignes = [];
  for (const l of archive.split('\n').slice(1)) {
    const c = l.split(',');
    if (c.length < 5) continue;
    const [emission, spot, station, echeance, kn] = c;
    if (echeance !== cible) continue;
    if (vu.has(emission + '|' + spot + '|' + echeance)) continue;
    const mes = m.get(station);
    if (!mes || mes.kn === null) continue;
    const lead = (versDate(echeance) - versDate(emission)) / 36e5;
    const fc = parseFloat(kn);
    lignes.push([emission, spot, station, echeance, lead.toFixed(1),
      fc.toFixed(1), mes.kn.toFixed(1), (fc - mes.kn).toFixed(1)].join(','));
  }
  return ajouter(QA, ENT_QA, lignes);
}

/**
 * Biais moyen par classe d'echeance (6 h), calcule sur qa.csv.
 * Negatif = la prevision sous-estime. C'est ce qui permet de corriger une
 * pre-alerte a J-5, ou l'ecart atteint 2 noeuds.
 */
export async function biaisParEcheance() {
  const par = new Map();
  for (const l of (await lire(QA)).split('\n').slice(1)) {
    const c = l.split(',');
    if (c.length < 8) continue;
    const lead = Math.round(parseFloat(c[4]) / 6) * 6;
    const err = parseFloat(c[7]);
    if (!Number.isFinite(err)) continue;
    if (!par.has(lead)) par.set(lead, []);
    par.get(lead).push(err);
  }
  const out = new Map();
  for (const [lead, errs] of par) {
    if (errs.length < 30) continue; // sous 30 points, trop bruite
    out.set(lead, errs.reduce((a, b) => a + b, 0) / errs.length);
  }
  return out;
}

/** Correction a appliquer a une prevision d'echeance donnee, en noeuds. */
export function correction(biais, leadH) {
  if (!biais.size) return 0;
  const cible = Math.round(leadH / 6) * 6;
  let best = null;
  for (const lead of biais.keys()) {
    if (best === null || Math.abs(lead - cible) < Math.abs(best - cible)) {
      best = lead;
    }
  }
  // biais negatif (sous-estimation) -> on remonte la prevision
  return best === null ? 0 : -biais.get(best);
}

// ---- 4. journal des alertes ----------------------------------------------

export async function journaliserAlerte(a) {
  return ajouter(ALERTES, ENT_ALERTES, [[
    a.envoyeLe, a.etage, a.spot, a.station, a.debut, a.fin,
    a.prevu.toFixed(1), a.corrige.toFixed(1), a.lead.toFixed(1),
  ].join(',')]);
}

/**
 * Confronte chaque alerte passee au vent reellement mesure sur sa fenetre.
 * Verdict :
 *   OK      moyenne mesuree >= seuil
 *   FAIBLE  entre seuil - 2 et seuil
 *   RATE    en dessous de seuil - 2
 *   ?       pas assez de mesures dans la fenetre
 */
export async function evaluerAlertes(cfg) {
  const alertes = (await lire(ALERTES)).split('\n').slice(1)
    .filter((l) => l.split(',').length >= 9);
  if (!alertes.length) return 0;

  const parStation = new Map();
  for (const l of (await lire(MESURES)).split('\n').slice(1)) {
    const c = l.split(',');
    if (c.length < 3) continue;
    if (!parStation.has(c[1])) parStation.set(c[1], []);
    parStation.get(c[1]).push({ ts: c[0], kn: parseFloat(c[2]) });
  }

  const vu = new Set();
  for (const l of (await lire(ALERTES_QA)).split('\n').slice(1)) {
    const c = l.split(',');
    if (c.length > 3) vu.add(c[0] + '|' + c[1] + '|' + c[3]);
  }

  const maintenant = versCle(new Date());
  const lignes = [];
  for (const l of alertes) {
    const [envoyeLe, etage, spot, station, debut, fin, prevu] = l.split(',');
    if (fin >= maintenant) continue;            // fenetre pas encore passee
    if (vu.has(envoyeLe + '|' + etage + '|' + debut)) continue;

    const pts = (parStation.get(station) || [])
      .filter((p) => p.ts >= debut && p.ts <= fin && Number.isFinite(p.kn));
    let moy = '', max = '', verdict = '?';
    if (pts.length) {
      const vals = pts.map((p) => p.kn);
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      moy = m.toFixed(1);
      max = Math.max(...vals).toFixed(1);
      verdict = m >= cfg.seuil_kn ? 'OK'
        : m >= cfg.seuil_kn - 2 ? 'FAIBLE' : 'RATE';
    }
    lignes.push([envoyeLe, etage, spot, debut, fin, prevu, moy, max,
      pts.length, verdict].join(','));
  }
  return ajouter(ALERTES_QA, ENT_ALERTES_QA, lignes);
}

// ---- rapports -------------------------------------------------------------

function stat(errs) {
  const biais = errs.reduce((a, b) => a + b, 0) / errs.length;
  const mae = errs.reduce((a, b) => a + Math.abs(b), 0) / errs.length;
  const max = errs.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
  return { n: errs.length, biais, mae, max };
}

export async function rapport() {
  const lignes = (await lire(QA)).split('\n').slice(1)
    .filter((l) => l.split(',').length > 7);
  if (!lignes.length) return 'QA : aucun appariement pour l\'instant.';

  const parSpot = new Map();
  const parLead = new Map();
  for (const l of lignes) {
    const c = l.split(',');
    const err = parseFloat(c[7]);
    if (!Number.isFinite(err)) continue;
    const lead = Math.round(parseFloat(c[4]) / 6) * 6;
    if (!parSpot.has(c[1])) parSpot.set(c[1], []);
    if (!parLead.has(lead)) parLead.set(lead, []);
    parSpot.get(c[1]).push(err);
    parLead.get(lead).push(err);
  }

  const out = ['QA previsions — ' + lignes.length + ' appariements', '',
    'Par spot :'];
  for (const [spot, errs] of [...parSpot].sort()) {
    const s = stat(errs);
    out.push(`  ${spot.padEnd(13)} n=${String(s.n).padStart(4)}  ` +
      `biais ${s.biais >= 0 ? '+' : ''}${s.biais.toFixed(1)} kn  ` +
      `err.abs ${s.mae.toFixed(1)} kn`);
  }
  out.push('', 'Par echeance (classes de 6 h) :');
  for (const [lead, errs] of [...parLead].sort((a, b) => a[0] - b[0])) {
    if (lead % 24 && lead > 24) continue;       // allege : 1 point par jour
    const s = stat(errs);
    out.push(`  ${String(lead).padStart(3)} h  n=${String(s.n).padStart(4)}  ` +
      `biais ${s.biais >= 0 ? '+' : ''}${s.biais.toFixed(1)} kn  ` +
      `err.abs ${s.mae.toFixed(1)} kn`);
  }
  out.push('', 'Biais negatif = la prevision sous-estime le vent.');
  return out.join('\n');
}

/** Bilan des alertes : combien etaient justifiees, par etage. */
export async function rapportAlertes() {
  const lignes = (await lire(ALERTES_QA)).split('\n').slice(1)
    .filter((l) => l.split(',').length >= 10);
  if (!lignes.length) {
    return 'QA alertes : aucune alerte encore evaluee.';
  }
  const par = new Map();
  for (const l of lignes) {
    const c = l.split(',');
    const etage = c[1];
    if (!par.has(etage)) par.set(etage, []);
    par.get(etage).push({ prevu: parseFloat(c[5]), mes: parseFloat(c[6]),
      verdict: c[9] });
  }
  const out = ['QA alertes — ' + lignes.length + ' alertes evaluees', ''];
  out.push('| Etage | n | OK | FAIBLE | RATE | ? | Ecart moyen |');
  for (const [etage, rows] of [...par].sort()) {
    const n = (v) => rows.filter((r) => r.verdict === v).length;
    const ecarts = rows.filter((r) => Number.isFinite(r.mes))
      .map((r) => r.prevu - r.mes);
    const ec = ecarts.length
      ? (ecarts.reduce((a, b) => a + b, 0) / ecarts.length).toFixed(1)
      : '-';
    out.push(`| ${etage.padEnd(6)} | ${rows.length} | ${n('OK')} | ` +
      `${n('FAIBLE')} | ${n('RATE')} | ${n('?')} | ${ec} kn |`);
  }
  out.push('', 'OK = vent mesure >= seuil sur la fenetre annoncee.',
    'Ecart positif = l\'alerte promettait plus que le vent reel.');
  return out.join('\n');
}
