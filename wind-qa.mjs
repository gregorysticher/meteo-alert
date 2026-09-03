// wind-qa.mjs — boucle qualite : archive les previsions, les apparie aux
// mesures reelles, et calcule le biais par spot et par echeance.
//
// Pourquoi : les previsions ponctuelles MeteoSuisse sont post-traitees mais
// aucune station n'est *sur* un spot (GVE est a l'aeroport, ~5 km du Vengeron).
// Le seul moyen de connaitre la fiabilite reelle est de mesurer l'ecart dans
// la duree, par spot, par heure et par echeance.
//
// Deux fichiers, commites par le workflow :
//   data/forecasts.csv  archive brute (emission, spot, echeance, valeurs)
//   data/qa.csv         appariements prevision <-> mesure

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { mesures } from './wind-sources.mjs';

const DIR = 'data';
const ARCHIVE = DIR + '/forecasts.csv';
const QA = DIR + '/qa.csv';

const ENT_ARCHIVE = 'emission,spot,station,echeance,kn,q10,rafale,dir';
const ENT_QA =
  'emission,spot,station,echeance,lead_h,prevu_kn,mesure_kn,erreur_kn';

async function lire(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
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

/** Ajoute les previsions du run courant a l'archive. */
export async function archiver(emission, spots, parSpot) {
  await mkdir(DIR, { recursive: true });
  const existant = await lire(ARCHIVE);
  const lignes = [];
  for (const s of spots) {
    for (const l of parSpot.get(s.key) || []) {
      lignes.push(
        [emission, s.key, s.station, l.date,
         l.kn.toFixed(1), l.q10.toFixed(1), l.rafale.toFixed(1),
         l.dir === null ? '' : Math.round(l.dir)].join(',')
      );
    }
  }
  const corps = existant.trim()
    ? existant.trimEnd() + '\n' + lignes.join('\n') + '\n'
    : ENT_ARCHIVE + '\n' + lignes.join('\n') + '\n';
  await writeFile(ARCHIVE, corps);
  return lignes.length;
}

/**
 * Apparie la mesure de l'heure courante aux previsions faites pour cette
 * heure, toutes echeances confondues. Idempotent : une meme combinaison
 * (emission, spot, echeance) n'est ecrite qu'une fois.
 */
export async function apparier(spots) {
  await mkdir(DIR, { recursive: true });
  const archive = await lire(ARCHIVE);
  if (!archive.trim()) return 0;

  const codes = new Set(spots.map((s) => s.station));
  const m = await mesures(codes);

  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  const cible =
    now.toISOString().slice(0, 16).replace(/[-:T]/g, '');

  const dejaVu = new Set();
  const qa = await lire(QA);
  for (const l of qa.split('\n').slice(1)) {
    const c = l.split(',');
    if (c.length > 3) dejaVu.add(c[0] + '|' + c[1] + '|' + c[3]);
  }

  const nouvelles = [];
  for (const l of archive.split('\n').slice(1)) {
    const c = l.split(',');
    if (c.length < 5) continue;
    const [emission, spot, station, echeance, kn] = c;
    if (echeance !== cible) continue;
    if (dejaVu.has(emission + '|' + spot + '|' + echeance)) continue;
    const mes = m.get(station);
    if (!mes || mes.kn === null) continue;
    const lead =
      (versDate(echeance) - versDate(emission)) / 36e5;
    const prevu = parseFloat(kn);
    nouvelles.push(
      [emission, spot, station, echeance, lead.toFixed(1),
       prevu.toFixed(1), mes.kn.toFixed(1),
       (prevu - mes.kn).toFixed(1)].join(',')
    );
  }
  if (!nouvelles.length) return 0;

  const corps = qa.trim()
    ? qa.trimEnd() + '\n' + nouvelles.join('\n') + '\n'
    : ENT_QA + '\n' + nouvelles.join('\n') + '\n';
  await writeFile(QA, corps);
  return nouvelles.length;
}

/** Rapport lisible : biais et erreur absolue par spot, puis par echeance. */
export async function rapport() {
  const qa = await lire(QA);
  const lignes = qa.split('\n').slice(1).filter((l) => l.split(',').length > 7);
  if (!lignes.length) {
    return 'QA : aucun appariement pour l\'instant. ' +
      'Les premiers chiffres arrivent apres 24 h de crons horaires.';
  }

  const parSpot = new Map();
  const parLead = new Map();
  for (const l of lignes) {
    const c = l.split(',');
    const err = parseFloat(c[7]);
    const lead = Math.round(parseFloat(c[4]) / 6) * 6; // classes de 6 h
    if (!Number.isFinite(err)) continue;
    (parSpot.get(c[1]) || parSpot.set(c[1], []).get(c[1])).push(err);
    (parLead.get(lead) || parLead.set(lead, []).get(lead)).push(err);
  }

  const stat = (errs) => {
    const biais = errs.reduce((a, b) => a + b, 0) / errs.length;
    const mae = errs.reduce((a, b) => a + Math.abs(b), 0) / errs.length;
    const max = errs.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
    return { n: errs.length, biais, mae, max };
  };

  const out = ['QA — ' + lignes.length + ' appariements', ''];
  out.push('Par spot :');
  for (const [spot, errs] of [...parSpot].sort()) {
    const s = stat(errs);
    out.push(
      `  ${spot.padEnd(13)} n=${String(s.n).padStart(4)}  ` +
      `biais ${s.biais >= 0 ? '+' : ''}${s.biais.toFixed(1)} kn  ` +
      `err.abs ${s.mae.toFixed(1)} kn  max ${s.max >= 0 ? '+' : ''}${s.max.toFixed(1)}`
    );
  }
  out.push('', 'Par echeance :');
  for (const [lead, errs] of [...parLead].sort((a, b) => a[0] - b[0])) {
    const s = stat(errs);
    out.push(
      `  ${String(lead).padStart(3)} h  n=${String(s.n).padStart(4)}  ` +
      `biais ${s.biais >= 0 ? '+' : ''}${s.biais.toFixed(1)} kn  ` +
      `err.abs ${s.mae.toFixed(1)} kn`
    );
  }
  out.push('', 'Biais positif = la prevision surestime le vent.');
  return out.join('\n');
}
