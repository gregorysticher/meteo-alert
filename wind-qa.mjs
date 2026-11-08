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
//   data/forecasts/AAAA-MM.csv  archive brute des previsions, un fichier par
//                       mois d'EMISSION (limite GitHub : 50 Mo avertissement,
//                       100 Mo refus ; un fichier unique y serait arrive en 2027)
//   data/qa/AAAA-MM.csv appariements prevision <-> mesure, par mois d'ECHEANCE
//                       (croit avec le carre du nombre de runs par jour)
//   data/mesures.csv    mesures horaires brutes par station
//   data/alertes.csv    alertes envoyees
//   data/alertes_qa.csv verdict de chaque alerte une fois la fenetre passee
//   data/gradient.csv   air mesure - eau (Alplakes), par spot et par heure :
//                       se joint a data/qa/ sur (spot, echeance = ts) pour voir si
//                       le biais depend du gradient (spec B6). Une ligne de
//                       gradient pour toutes les emissions de cette heure, et les
//                       spots d'une meme station partagent l'air : grouper par
//                       echeance et par station, sinon le n est gonfle.
//
// Colonne modele (archive et data/qa/) : ms = MeteoSuisse, celui des alertes ;
// arome = second avis, archive seulement. Le biais qui corrige les alertes
// (biaisParEcheance) ne lit QUE ms : AROME ne doit pas changer une alerte.

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { mesures, tempLac } from './wind-sources.mjs';

const DIR = 'data';
const ARCHIVES = DIR + '/forecasts';
const QA_DIR = DIR + '/qa';
const MESURES = DIR + '/mesures.csv';
const ALERTES = DIR + '/alertes.csv';
const ALERTES_QA = DIR + '/alertes_qa.csv';
const GRADIENT = DIR + '/gradient.csv';

const ENT_ARCHIVE = 'emission,spot,station,echeance,kn,q10,rafale,dir,modele';
const ENT_QA =
  'emission,spot,station,echeance,lead_h,prevu_kn,mesure_kn,erreur_kn,modele';
export const MODELE_ALERTES = 'ms';
const ENT_MESURES = 'ts,station,kn,rafale,dir';
const ENT_GRADIENT = 'ts,spot,station,air_c,eau_c,gradient_c';
const ENT_ALERTES =
  'envoye_le,etage,spot,station,debut,fin,prevu_kn,corrige_kn,lead_h';
const ENT_ALERTES_QA =
  'envoye_le,etage,spot,debut,fin,prevu_kn,mesure_moy_kn,mesure_max_kn,' +
  'n_mesures,verdict';

// Seul un fichier ABSENT vaut vide. Toute autre erreur doit remonter : ajouter()
// reecrirait sinon le fichier avec le seul nouveau contenu.
async function lire(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

async function ajouter(path, entete, lignes) {
  if (!lignes.length) return 0;
  await mkdir(dirname(path), { recursive: true });
  const existant = await lire(path);
  const corps = existant.trim()
    ? existant.trimEnd() + '\n' + lignes.join('\n') + '\n'
    : entete + '\n' + lignes.join('\n') + '\n';
  await writeFile(path, corps);
  return lignes.length;
}

/** Fichier QA d'une echeance AAAAMMJJHHMM : son mois, en UTC. */
export function fichierQa(echeance) {
  return `${QA_DIR}/${echeance.slice(0, 4)}-${echeance.slice(4, 6)}.csv`;
}

/** Toutes les lignes QA, tous mois confondus, sans entete ni CR. */
async function lignesQa() {
  let noms;
  try {
    noms = await readdir(QA_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const parties = [];
  for (const n of noms.filter((x) => x.endsWith('.csv')).sort()) {
    parties.push((await lire(`${QA_DIR}/${n}`)).split('\n').slice(1));
  }
  return parties.flat().map((l) => l.trimEnd()).filter(Boolean);
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

/** Fichier d'archive d'une emission AAAAMMJJHHMM : son mois, en UTC. */
export function fichierArchive(emission) {
  return `${ARCHIVES}/${emission.slice(0, 4)}-${emission.slice(4, 6)}.csv`;
}

const nombre = (v) => (v === null || v === undefined ? '' : v.toFixed(1));

/**
 * Ajoute une emission a l'archive de son mois. Idempotent par emission et par
 * modele : deux runs sur la meme emission (dispatch, cron de secours apres le
 * declencheur externe) n'ecrivent qu'une fois. Renvoie le nombre de lignes.
 */
export async function archiver(emission, spots, parSpot, modele = MODELE_ALERTES) {
  const fichier = fichierArchive(emission);
  const fin = ',' + modele;
  const deja = (await lire(fichier)).split('\n')
    .some((l) => l.startsWith(emission + ',') && l.trimEnd().endsWith(fin));
  if (deja) return 0;

  const lignes = [];
  for (const s of spots) {
    for (const l of parSpot.get(s.key) || []) {
      lignes.push([emission, s.key, s.station, l.date,
        l.kn.toFixed(1), nombre(l.q10), nombre(l.rafale),
        l.dir === null ? '' : Math.round(l.dir), modele].join(','));
    }
  }
  return ajouter(fichier, ENT_ARCHIVE, lignes);
}

/**
 * Lignes d'archive pouvant viser l'echeance donnee : mois de l'echeance et mois
 * precedent (emissions partitionnees par mois, horizon < 1 mois). Un mois
 * absent est simplement vide. Pas d'entete dans le resultat.
 */
export async function lignesArchive(echeance) {
  const d = versDate(echeance);
  const avant = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  // Pas de push(...lignes) : l'etalement depasse la pile au volume reel (un
  // mois d'archive fait des centaines de milliers de lignes).
  const parties = [];
  for (const m of [versCle(avant), echeance]) {
    parties.push((await lire(fichierArchive(m))).split('\n').slice(1));
  }
  return parties.flat().filter((l) => l.trim());
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

/**
 * Gradient air - eau du moment, par spot sur un lac. Idempotent par heure. Une
 * station sans thermometre (PRE) saute simplement son spot. Leve une erreur si
 * le lac ne repond pour AUCUN spot : le journal serait aveugle sans le dire.
 */
export async function journaliserGradient(spots) {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  const ts = versCle(now);

  const vu = new Set();
  for (const l of (await lire(GRADIENT)).split('\n').slice(1)) {
    const c = l.split(',');
    if (c.length > 1) vu.add(c[0] + '|' + c[1]);
  }
  const lacs = spots.filter((s) => s.lac);
  const aFaire = lacs.filter((s) => !vu.has(ts + '|' + s.key));
  if (!aFaire.length) return 0;

  // Toutes les stations : un spot sans thermometre (PRE) reste seul a faire lors
  // d'un second run dans la meme heure, sans que l'air manque pour autant.
  const m = await mesures(new Set(lacs.map((s) => s.station)));
  const lignes = [];
  let eaux = 0;
  for (const s of aFaire) {
    const eau = await tempLac(s.lac, s.lat, s.lon);
    if (eau === null) continue;
    eaux++;
    const air = m.get(s.station)?.air ?? null;
    if (air === null) continue;
    lignes.push([ts, s.key, s.station, air.toFixed(1), eau.toFixed(1),
      (air - eau).toFixed(1)].join(','));
  }
  if (!eaux) throw new Error('temperature du lac indisponible pour tous les spots');
  if (!lacs.some((s) => (m.get(s.station)?.air ?? null) !== null)) {
    throw new Error('temperature de l\'air absente pour tous les spots');
  }
  if (eaux < aFaire.length) {
    console.log(`Gradient : lac muet pour ${aFaire.length - eaux} spot(s) sur ${aFaire.length}.`);
  }
  return ajouter(GRADIENT, ENT_GRADIENT, lignes);
}

// ---- 3. appariement prevision <-> mesure ---------------------------------

export async function apparier(spots) {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  const cible = versCle(now);

  const archive = await lignesArchive(cible);
  if (!archive.length) return 0;

  const codes = new Set(spots.map((s) => s.station));
  const m = await mesures(codes);

  // Tout ce qui vise cette echeance est dans le fichier de son mois.
  const fichier = fichierQa(cible);
  const vu = new Set();
  for (const l of (await lire(fichier)).split('\n').slice(1)) {
    const c = l.trimEnd().split(',');
    if (c.length > 8) vu.add(c[0] + '|' + c[1] + '|' + c[3] + '|' + c[8]);
  }

  const lignes = [];
  for (const l of archive) {
    const c = l.trimEnd().split(',');
    if (c.length < 9) continue;
    const [emission, spot, station, echeance, kn] = c;
    const modele = c[8];
    if (echeance !== cible) continue;
    if (vu.has(emission + '|' + spot + '|' + echeance + '|' + modele)) continue;
    const mes = m.get(station);
    if (!mes || mes.kn === null) continue;
    const lead = (versDate(echeance) - versDate(emission)) / 36e5;
    const fc = parseFloat(kn);
    lignes.push([emission, spot, station, echeance, lead.toFixed(1),
      fc.toFixed(1), mes.kn.toFixed(1), (fc - mes.kn).toFixed(1), modele].join(','));
  }
  return ajouter(fichier, ENT_QA, lignes);
}

/**
 * Biais moyen par classe d'echeance (6 h), calcule sur data/qa/, MeteoSuisse seul.
 * Negatif = la prevision sous-estime. C'est ce qui permet de corriger une
 * pre-alerte a J-5, ou l'ecart atteint 2 noeuds.
 */
export async function biaisParEcheance() {
  const par = new Map();
  for (const l of await lignesQa()) {
    const c = l.split(',');
    if (c.length < 9 || c[8] !== MODELE_ALERTES) continue;
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
  const lignes = (await lignesQa()).filter((l) => l.split(',').length > 8);
  if (!lignes.length) return 'QA : aucun appariement pour l\'instant.';

  const parModele = new Map();
  for (const l of lignes) {
    const m = l.split(',')[8];
    if (!parModele.has(m)) parModele.set(m, []);
    parModele.get(m).push(l);
  }
  // MeteoSuisse d'abord (celui des alertes), puis les seconds avis.
  const tries = [...parModele]
    .sort(([a], [b]) => (b === MODELE_ALERTES) - (a === MODELE_ALERTES) || a.localeCompare(b));
  const blocs = tries.map(([m, ls]) => rapportModele(m, ls));
  if (tries.length > 1) blocs.push(comparaison(tries));
  return blocs.join('\n\n');
}

// Comparaison des modeles par spot sur la zone commune 12-36 h (spec B5, etape 2).
function comparaison(tries) {
  const parSpot = new Map();
  for (const [m, ls] of tries) {
    for (const l of ls) {
      const c = l.split(',');
      const lead = parseFloat(c[4]);
      const err = parseFloat(c[7]);
      if (!(lead >= 12 && lead <= 36) || !Number.isFinite(err)) continue;
      if (!parSpot.has(c[1])) parSpot.set(c[1], new Map());
      if (!parSpot.get(c[1]).has(m)) parSpot.get(c[1]).set(m, []);
      parSpot.get(c[1]).get(m).push(err);
    }
  }
  const out = ['Erreur absolue par spot, 12-36 h :'];
  for (const [spot, parM] of [...parSpot].sort()) {
    const cols = tries.map(([m]) => {
      const errs = parM.get(m);
      return `${m} ${errs ? stat(errs).mae.toFixed(1) + ' kn (n=' + errs.length + ')' : '—'}`;
    });
    out.push(`  ${spot.padEnd(13)} ${cols.join('  ')}`);
  }
  return out.join('\n');
}

function rapportModele(modele, lignes) {
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

  const out = [`QA previsions ${modele} — ${lignes.length} appariements`, '',
    'Par spot :'];
  for (const [spot, errs] of [...parSpot].sort()) {
    const s = stat(errs);
    out.push(`  ${spot.padEnd(13)} n=${String(s.n).padStart(4)}  ` +
      `biais ${s.biais >= 0 ? '+' : ''}${s.biais.toFixed(1)} kn  ` +
      `err.abs ${s.mae.toFixed(1)} kn`);
  }
  out.push('', 'Par echeance (classes de 6 h) :');
  for (const [lead, errs] of [...parLead].sort((a, b) => a[0] - b[0])) {
    // Allege MeteoSuisse (9 j) : 1 point par jour. AROME (51 h) : tout.
    if (modele === MODELE_ALERTES && lead % 24 && lead > 24) continue;
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
    const c = l.trimEnd().split(',');
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
