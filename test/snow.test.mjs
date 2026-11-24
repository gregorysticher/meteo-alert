// Tests neige : journal prévision/mesure et chemins d'échec des deux scripts.
// Règle testée : en saison, toute source muette ou refusée rend le run ROUGE
// (code de sortie 1) ; un run qui fonctionne sort en 0.
// Les scripts tournent en DRY_RUN avec un fetch simulé : rien n'est envoyé ni
// écrit, et le résultat ne dépend pas de la météo du jour.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { journaliserPrevision, journaliserMesures, lire, rapport } from '../snow-qa.mjs';
import { rapportTemperature } from '../snow-conversion.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOCK = join(RACINE, 'test', 'helpers', 'mock-fetch.mjs');

// cwd = dossier temporaire vide : un script qui écrirait malgré DRY_RUN le
// ferait là (le test « aucun fichier écrit » le voit), jamais dans le vrai
// journal du dépôt.
function lancer(script, mock, env = {}, etat = null, fichiers = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'neige-run-'));
  const fichierEtat = join(dir, 'snow-forecast-alerted.json');
  try {
    if (etat !== null) writeFileSync(fichierEtat, etat);
    for (const [f, texte] of Object.entries(fichiers)) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      writeFileSync(join(dir, f), texte);
    }
    const r = spawnSync(process.execPath,
      ['--import', 'file:///' + MOCK.replace(/\\/g, '/'), join(RACINE, script)], {
        cwd: dir, encoding: 'utf8',
        env: { ...process.env, DRY_RUN: 'true', IGNORER_SAISON: 'true',
          SEUIL_CM: '10', NTFY_TOPIC_NEIGE: '', SILENCE_NOCTURNE: '', HAUSSE_PCT: '', MOCK_MSL: 'ok',
          GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '', RELANCE: '', RUN_ORIGINE: '',
          MOCK_FETCH: typeof mock === 'string' ? mock : JSON.stringify(mock), ...env },
      });
    return {
      code: r.status, out: r.stdout + r.stderr, fichiers: readdirSync(dir),
      etat: existsSync(fichierEtat) ? readFileSync(fichierEtat, 'utf8') : null,
      journal: existsSync(join(dir, 'data/neige.csv')) ? readFileSync(join(dir, 'data/neige.csv'), 'utf8') : '',
      ecran: existsSync(join(dir, 'data/neige-ecran.json')) ? JSON.parse(readFileSync(join(dir, 'data/neige-ecran.json'), 'utf8')) : null,
      alertes: existsSync(join(dir, 'data/alertes-neige.csv')) ? readFileSync(join(dir, 'data/alertes-neige.csv'), 'utf8') : '',
      qa: existsSync(join(dir, 'data/alertes-neige-qa.csv')) ? readFileSync(join(dir, 'data/alertes-neige-qa.csv'), 'utf8') : '',
      hs: existsSync(join(dir, 'data/neige-hs.csv')) ? readFileSync(join(dir, 'data/neige-hs.csv'), 'utf8') : '',
      sources: ['annoncee', 'fraiche'].map((n) => join(dir, `data/sources-neige-${n}.json`))
        .map((p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null)),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const jourLocal = (decalage = 0) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(Date.now() + decalage * 864e5));

// ---- journal --------------------------------------------------------------

test('journal : prévisions, mesures dédoublonnées, rapport J-1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neige-'));
  const fichier = join(dir, 'neige.csv');
  try {
    const t0 = new Date('2026-11-06T16:00:00Z');
    assert.equal(journaliserPrevision('2026-11-06', ['2026-11-06', '2026-11-07', '2026-11-08'],
      [0, 8.4, null], { fichier, maintenant: t0 }), 2);   // null ignoré
    // mêmes mesures renvoyées deux fois : écrites une seule fois
    const m = [{ jour: '2026-11-07', cm: 3 }, { jour: '2026-11-08', cm: 8.6 }];
    assert.equal(journaliserMesures(m, { fichier }), 2);
    assert.equal(journaliserMesures(m, { fichier }), 0);
    // valeur révisée : réécrite
    assert.equal(journaliserMesures([{ jour: '2026-11-08', cm: 9 }], { fichier }), 1);
    const l = lire(fichier);
    assert.equal(l.find((x) => x.source === 'prev' && x.jour === '2026-11-07').echeance_j, 1);
    const r = rapport(l);
    assert.match(r, /2026-11-07 {2}8\.4 \| 3\.0 \| 9\.0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- alerte annoncée (Open-Meteo) ----------------------------------------

// passes = valeurs des jours precedents, du plus ancien a hier (past_days).
// Horaire (D-005) : toute la neige du jour tombe à midi à −5 °C (part neige 1), en mm
// tels que la conversion redonne exactement la valeur ; null = jour sans données.
// snowfall_sum (0,7 fixe, information) = la même valeur.
const prev = (neige, unite = 'mm', passes = []) => {
  const valeurs = [...passes, ...neige];
  const time = [...passes.map((_, i) => jourLocal(i - passes.length)), ...neige.map((_, i) => jourLocal(i))];
  const h = { time: [], precipitation: [], temperature_2m: [] };
  time.forEach((d, i) => {
    for (let k = 0; k < 24; k++) {
      h.time.push(`${d}T${String(k).padStart(2, '0')}:00`);
      const v = valeurs[i];
      h.precipitation.push(v == null ? null : k === 12 ? v / rapportTemperature(-5) : 0);
      h.temperature_2m.push(-5);
    }
  });
  return { body: {
    daily_units: { snowfall_sum: 'cm' },
    hourly_units: { precipitation: unite, temperature_2m: '°C' },
    daily: { time, snowfall_sum: valeurs },
    hourly: h,
  } };
};

const REEL = { DRY_RUN: 'false', NTFY_TOPIC_NEIGE: 'x' };
const etatDe = (debut, fin, total, annule = false) => JSON.stringify({ episodes: [
  { debut: jourLocal(debut), fin: jourLocal(fin), total, duree: fin - debut + 1, annule },
] });

test('annoncée : HTTP 400 -> rouge', () => {
  const r = lancer('snow-forecast-alert.mjs', { status: 400, body: { error: true, reason: 'invalid String value' } });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /HTTP 400/);
});
test('annoncée : erreur réseau -> rouge', () => {
  assert.equal(lancer('snow-forecast-alert.mjs', 'network-error').code, 1);
});
test('annoncée : un raté réseau puis réponse -> vert, raté au journal', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 7, 5, 0, 0]), { MOCK_RATES: '1' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Raté sur https:\/\/api\.open-meteo\.com \(fetch failed/);
  assert.match(r.out, /À notifier : 1/);
});
test('annoncée : deux ratés réseau -> rouge', () => {
  assert.equal(lancer('snow-forecast-alert.mjs', prev([0, 7, 5, 0, 0]), { MOCK_RATES: '2' }).code, 1);
});
test('annoncée : unité inattendue -> rouge', () => {
  assert.equal(lancer('snow-forecast-alert.mjs', prev([0, 5], 'cm')).code, 1);
});
test('annoncée : réponse vide -> rouge', () => {
  assert.equal(lancer('snow-forecast-alert.mjs', { body: { daily_units: { snowfall_sum: 'cm' }, daily: {} } }).code, 1);
});
test('annoncée : snowfall_sum absent -> avertissement, vert (journal seulement depuis D-005)', () => {
  const m = prev([0, 5]);
  delete m.body.daily.snowfall_sum;
  const r = lancer('snow-forecast-alert.mjs', m);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /AVERTISSEMENT snowfall_sum \(journal\)/);
});
test('annoncée : snowfall_sum tout à null -> rouge', () => {
  assert.equal(lancer('snow-forecast-alert.mjs', prev([null, null, null])).code, 1);
});
test('annoncée : JSON invalide -> rouge', () => {
  assert.equal(lancer('snow-forecast-alert.mjs', { body: 'pas du json' }).code, 1);
});
test('annoncée : épisode de 12 cm -> vert, 1 alerte à notifier', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 7, 5, 0, 0]));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Prévisions journalières/);
  assert.match(r.out, /À notifier : 1/);
});
test('annoncée : rien de prévu -> vert, rien à notifier', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 0, 0.2, 0, 0]));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /À notifier : 0/);
});

test('annoncée : valeurs nulles dans le passé seul -> vert', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 0, 0, 0, 0], 'mm', [null, null]));
  assert.equal(r.code, 0, r.out);
});
test('annoncée : passé renseigné mais avenir tout à null -> rouge', () => {
  assert.equal(lancer('snow-forecast-alert.mjs', prev([null, null], 'mm', [5, 5])).code, 1);
});
test('annoncée : envoi réel d\'une nouvelle alerte, état écrit, second run muet', () => {
  const m = prev([0, 7, 5, 0, 0]);
  const r = lancer('snow-forecast-alert.mjs', m, REEL);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Neige annoncée/);
  const e = JSON.parse(r.etat);
  assert.deepEqual([e.episodes[0].debut, e.episodes[0].total, e.episodes[0].duree],
    [jourLocal(1), 12, 2]);
  const r2 = lancer('snow-forecast-alert.mjs', m, REEL, r.etat);
  assert.match(r2.out, /À notifier : 0/);
  assert.doesNotMatch(r2.out, /ntfy →/);
  assert.equal(r2.etat, r.etat, 'état inchangé : pas de commit inutile');
});
test('annoncée : +5 cm -> « revue à la hausse »', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 10, 7, 0, 0]), REEL, etatDe(1, 2, 12));
  assert.match(r.out, /ntfy → Neige revue à la hausse/);
  assert.equal(JSON.parse(r.etat).episodes[0].total, 17);
});
test('annoncée : +2 cm -> rien', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 8, 6, 0, 0]), REEL, etatDe(1, 2, 12));
  assert.match(r.out, /À notifier : 0/);
});
test('annoncée : HAUSSE_CM abaissé -> +2 cm suffit', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 8, 6, 0, 0]),
    { ...REEL, HAUSSE_CM: '2', HAUSSE_PCT: '0' }, etatDe(1, 2, 12));
  assert.match(r.out, /ntfy → Neige revue à la hausse/);
});
// Série du 13-14/11/2026 (D-001) : pas = max(5 cm, 30 % de la dernière alerte).
test('annoncée : 37 -> 44 cm, sous le pas de 30 % -> rien', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 20, 24, 0, 0]), REEL, etatDe(1, 2, 37));
  assert.match(r.out, /À notifier : 0/);
  assert.match(r.out, /hausse 5 cm ou 30 %/);
});
test('annoncée : 37 -> 59 cm -> « revue à la hausse », comparé à la dernière alerte', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 29, 30, 0, 0]), REEL, etatDe(1, 2, 37));
  assert.match(r.out, /ntfy → Neige revue à la hausse/);
  assert.match(r.out, /59 cm cumulés \(37 cm à la dernière alerte\)/);
});
test('annoncée : HAUSSE_PCT absurde -> rouge, défaut 30 %', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 20, 24, 0, 0]), { ...REEL, HAUSSE_PCT: '300' }, etatDe(1, 2, 37));
  assert.equal(r.code, 1);
  assert.match(r.out, /Variable invalide : HAUSSE_PCT = 300/);
  assert.match(r.out, /À notifier : 0/);
});
test('annoncée : silence nocturne -> rien envoyé, état gardé, run vert', () => {
  const etat = etatDe(1, 2, 12);
  const r = lancer('snow-forecast-alert.mjs', prev([0, 10, 7, 0, 0]),
    { ...REEL, SILENCE_NOCTURNE: '1', SILENCE_HORLOGE: '2026-11-16T23:00:00Z' }, etat);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Silence nocturne : « Neige revue à la hausse — Les Collines » retenu, réévalué au réveil \(Ma 17\.11 08:00\)/);
  assert.doesNotMatch(r.out, /ntfy →/);
  assert.equal(r.etat, etat, "état inchangé : l'alerte repart au réveil");
});
test('annoncée : message parti -> journalisé pour le verdict QA (D-003)', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 10, 7, 0, 0]), REEL, etatDe(1, 2, 12));
  assert.match(r.out, /ntfy → Neige revue à la hausse/);
  const [entete, ligne, ...reste] = r.alertes.trim().split('\n');
  assert.equal(entete, 'envoye_le,type,debut,fin,annonce_cm,avant_cm,echeance_j,seuil_cm');
  assert.deepEqual(reste, []);
  assert.match(ligne, new RegExp(`^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\dZ,hausse,${jourLocal(1)},${jourLocal(2)},17,12,1,10$`));
});
test('annoncée : retenu par le silence, ntfy en panne ou seuil forcé -> rien au journal QA', () => {
  const nuit = lancer('snow-forecast-alert.mjs', prev([0, 10, 7, 0, 0]),
    { ...REEL, SILENCE_NOCTURNE: '1', SILENCE_HORLOGE: '2026-11-16T23:00:00Z' }, etatDe(1, 2, 12));
  assert.match(nuit.out, /Silence nocturne/);
  assert.equal(nuit.alertes, '');
  const panne = lancer('snow-forecast-alert.mjs', prev([0, 10, 7, 0, 0]),
    { ...REEL, MOCK_NTFY_STATUS: '500' }, etatDe(1, 2, 12));
  assert.equal(panne.code, 1);
  assert.equal(panne.alertes, '');
  const force = lancer('snow-forecast-alert.mjs', prev([0, 3, 0, 0, 0]), { ...REEL, SEUIL_FORCE: '1', SEUIL_CM: '1' });
  assert.match(force.out, /ntfy → Neige annoncée/);
  assert.equal(force.alertes, '');
});
test('annoncée : annulation journalisée avec la plage annulée', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 0, 0, 0, 0]), REEL, etatDe(1, 2, 30));
  assert.match(r.out, /ntfy → Annulé/);
  assert.match(r.alertes, new RegExp(`,annule,${jourLocal(1)},${jourLocal(2)},0,30,1,10\n$`));
});
test('annoncée : silence actif mais de jour -> envoyé', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 10, 7, 0, 0]),
    { ...REEL, SILENCE_NOCTURNE: '1', SILENCE_HORLOGE: '2026-11-16T09:00:00Z' }, etatDe(1, 2, 12));
  assert.match(r.out, /ntfy → Neige revue à la hausse/);
});
test('annoncée : un jour de plus -> « prolongé »', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 7, 5, 3, 0]), REEL, etatDe(1, 2, 12));
  assert.match(r.out, /ntfy → Épisode de neige prolongé/);
  assert.match(r.out, /15 cm cumulés \(12 cm sur 2 j à la dernière alerte\)/);
});
test('annoncée : forte baisse avec un jour de plus -> « revue à la baisse », pas « prolongé »', () => {
  // Cas réel du 13/11/2026 : 64 cm sur 2 j annoncés, puis 28 cm sur 3 j (D-002).
  const r = lancer('snow-forecast-alert.mjs', prev([0, 7, 9, 12, 0]), REEL, etatDe(1, 2, 64));
  assert.match(r.out, /ntfy → Neige revue à la baisse/);
  assert.doesNotMatch(r.out, /prolongé/);
  assert.match(r.out, /28 cm cumulés \(64 cm à la dernière alerte, \w\w \d\d\.\d\d → \w\w \d\d\.\d\d\)/);
  assert.equal(JSON.parse(r.etat).episodes[0].total, 28);
});
test('annoncée : baisse sous le pas -> rien (37 -> 30 cm, pas 11,1)', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 15, 15, 0, 0]), REEL, etatDe(1, 2, 37));
  assert.match(r.out, /À notifier : 0/);
});
test('annoncée : nouvelle sur le seul dernier jour de l\'horizon -> rien, écran plein', () => {
  // Cas réel du 12/11/2026 : 7,8 cm à J+3, 56,6 cm à J+4 (D-002).
  const r = lancer('snow-forecast-alert.mjs', prev([0, 0, 0, 8, 57]), REEL);
  assert.match(r.out, /À notifier : 0/);
  assert.equal(r.ecran.episode.cm, 65, 'l\'écran garde le cumul complet');
});
test('annoncée : nouvelle qui tient sans le dernier jour -> envoyée avec le cumul complet', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 0, 6, 5, 20]), REEL);
  assert.match(r.out, /ntfy → Neige annoncée/);
  assert.match(r.out, /31 cm cumulés/);
});
test('annoncée : requête avec le bon modèle et les jours passés', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 0, 0, 0, 0]));
  assert.match(r.out, /models=meteoswiss_icon_seamless/);
  assert.match(r.out, /past_days=7/);
  assert.match(r.out, /forecast_days=5/);
});
test('annoncée : le journal ne reçoit que les jours à venir', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([1, 2, 0, 0, 0], 'mm', [9, 9]), { ...REEL, SEUIL_CM: '999' });
  assert.equal(r.code, 0, r.out);
  const lignes = r.journal.trim().split('\n').slice(1).filter((l) => l.split(',')[5] === 'icon');
  assert.equal(lignes.length, 5);
  assert.ok(lignes.every((l) => l.split(',')[2] >= jourLocal()), r.journal);
});
test('annoncée : écran écrit avec le chiffre de l\'alerte, pas en DRY_RUN ni seuil forcé', () => {
  const m = prev([0, 7, 5, 0, 0]);
  const r = lancer('snow-forecast-alert.mjs', m, REEL);
  assert.deepEqual(r.ecran.episode, { cm: 12, de: jourLocal(1), a: jourLocal(2), ok: true });
  assert.equal(r.ecran.lieu, 'Les Collines');
  assert.match(r.ecran.maj, /^\d{12}$/);
  assert.match(r.out, /12 cm cumulés/);
  assert.equal(lancer('snow-forecast-alert.mjs', m).ecran, null);
  assert.equal(lancer('snow-forecast-alert.mjs', m, { ...REEL, SEUIL_FORCE: '1' }).ecran, null);
});
test('annoncée : variable AFFICHAGE_CM lue', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 3, 0, 0, 0]), { ...REEL, AFFICHAGE_CM: '2' });
  assert.deepEqual([r.ecran.min, r.ecran.episode.cm, r.ecran.episode.ok], [2, 3, false]);
  assert.equal(lancer('snow-forecast-alert.mjs', prev([0, 3, 0, 0, 0]), REEL).ecran.episode, null);
});
test('annoncée : journal complet, modèle court et long séparés', () => {
  const m = prev([0, 7, 5, 0, 0]);
  m.body.daily.precipitation_sum = [0, 10, 8, 0, 0];
  m.body.daily.rain_sum = [0, 0, 1, 0, 0];
  m.body.daily.temperature_2m_mean = [-1, -4, -2, 0, 1];
  m.body.daily.snowfall_sum = [0, 9, 6, 0, 0];   // 0,7 fixe : en information, colonne cm_fixe
  const r = lancer('snow-forecast-alert.mjs', m, { ...REEL, SEUIL_CM: '999' });
  const lignes = r.journal.trim().split('\n');
  assert.equal(lignes[0], 'run,source,jour,cm,echeance_j,modele,mm,pluie_mm,t_moy,station,hs,cm_fixe');
  assert.ok(lignes.some((l) => l.endsWith(`prev,${jourLocal(2)},5,2,icon,8,1,-2,,,6`)), r.journal);
  assert.match(r.journal, /,long,/);
  assert.match(r.out, /horizon long : 5/);
});
test('annoncée : annexes alignées sur les jours à venir, malgré les jours passés', () => {
  const m = prev([1, 2], 'mm', [9]);
  m.body.daily.precipitation_sum = [90, 10, 20];
  m.body.daily.rain_sum = [0, 0, 1];
  m.body.daily.temperature_2m_mean = [-9, -1, -2];
  const r = lancer('snow-forecast-alert.mjs', m, { ...REEL, SEUIL_CM: '999' });
  assert.ok(r.journal.includes(`prev,${jourLocal()},1,0,icon,10,0,-1,,`), r.journal);
  assert.ok(r.journal.includes(`prev,${jourLocal(1)},2,1,icon,20,1,-2,,`), r.journal);
});
test('annoncée : colonnes annexes demandées à l\'API', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 0, 0, 0, 0]));
  assert.match(r.out, /daily=snowfall_sum,precipitation_sum,rain_sum,temperature_2m_mean/);
});
test('annoncée : panne du journal long -> avertissement, vert, alerte partie et écran écrit', () => {
  for (const long of ['{"status":503,"body":{}}', '{"body":{"daily":{"time":["2026-11-08"]}}}']) {
    const r = lancer('snow-forecast-alert.mjs', prev([0, 7, 5, 0, 0]), { ...REEL, MOCK_LONG: long });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /AVERTISSEMENT journal neige horizon long/);
    assert.match(r.out, /ntfy → Neige annoncée/);
    assert.equal(r.ecran.episode.cm, 12);
  }
});
test('annoncée : sortie ecran_change seulement si l\'épisode change', () => {
  const sortie = join(tmpdir(), `sortie-${process.pid}.txt`);
  writeFileSync(sortie, '');
  const m = prev([0, 7, 5, 0, 0]);
  lancer('snow-forecast-alert.mjs', m, { ...REEL, GITHUB_OUTPUT: sortie });
  const lu = readFileSync(sortie, 'utf8');
  rmSync(sortie);
  assert.match(lu, /ecran_change=true/);
});
test('annoncée : second run identique -> ecran_change=false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neige-chaine-'));
  const sortie = join(dir, 'sortie.txt');
  const m = prev([0, 7, 5, 0, 0]);
  const env = { ...process.env, DRY_RUN: 'false', IGNORER_SAISON: 'true', SEUIL_CM: '10',
    NTFY_TOPIC_NEIGE: 'x', MOCK_FETCH: JSON.stringify(m), GITHUB_OUTPUT: sortie };
  const run = () => spawnSync(process.execPath,
    ['--import', 'file:///' + MOCK.replace(/\\/g, '/'), join(RACINE, 'snow-forecast-alert.mjs')],
    { cwd: dir, encoding: 'utf8', env });
  try {
    run();
    writeFileSync(sortie, '');
    assert.equal(run().status, 0);
    assert.match(readFileSync(sortie, 'utf8'), /ecran_change=false/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('annoncée : l\'écran suit les décisions, épisode scindé compris (script complet)', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 9, 0, 9, 0]), REEL, etatDe(1, 3, 12));
  assert.match(r.out, /18 cm cumulés/);
  assert.equal(r.ecran.episode.cm, 18);
  assert.equal(r.ecran.episode.ok, true);
});
test('annoncée : alerte envoyée avant le journal long, avec un délai maximal', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 7, 5, 0, 0]), REEL);
  assert.ok(r.out.indexOf('ntfy →') < r.out.indexOf('horizon long'), r.out);
  // Le délai maximal vient de reseau.mjs, utilisé pour tous les appels.
  assert.ok(readFileSync(join(RACINE, 'snow-forecast-alert.mjs'), 'utf8').includes('fetchEssai(long)'));
  assert.ok(readFileSync(join(RACINE, 'reseau.mjs'), 'utf8').includes('AbortSignal.timeout'));
});
test('annoncée : écran daté du run', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 7, 5, 0, 0]), REEL);
  const maj = r.ecran.maj;
  const d = Date.UTC(+maj.slice(0, 4), +maj.slice(4, 6) - 1, +maj.slice(6, 8), +maj.slice(8, 10), +maj.slice(10, 12));
  assert.ok(Math.abs(Date.now() - d) < 5 * 60e3, maj);
  assert.equal(r.ecran.jour, jourLocal());
});
test('annoncée : AFFICHAGE_CM absurde -> rouge', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 0, 0, 0, 0]), { ...REEL, AFFICHAGE_CM: '0' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Variable invalide/);
});
test('annoncée : la requête longue n\'a ni modèle ni past_days, sur 16 jours', () => {
  const urls = join(tmpdir(), `urls-${process.pid}.log`);
  writeFileSync(urls, '');
  const r = lancer('snow-forecast-alert.mjs', prev([0, 0, 0, 0, 0]), { ...REEL, SEUIL_CM: '999', MOCK_URLS: urls });
  assert.equal(r.code, 0, r.out);
  const liste = readFileSync(urls, 'utf8').trim().split('\n').filter((u) => u.includes('open-meteo'));
  rmSync(urls);
  assert.equal(liste.length, 2);
  assert.match(liste[1], /forecast_days=16/);
  assert.doesNotMatch(liste[1], /models=|past_days=|hourly=/);
  assert.match(liste[0], /hourly=precipitation,temperature_2m/);
});
test('annoncée : annonce déplacée -> un seul message « décalée »', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 0, 7, 5, 0]), REEL, etatDe(0, 1, 12));
  assert.match(r.out, /ntfy → Neige décalée/);
  assert.doesNotMatch(r.out, /ntfy → (Annulé|Neige annoncée)/);
});
test('annoncée : neige tombée, trace aujourd\'hui, premier run -> pas d\'alerte', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([1.2, 0, 0, 0, 0], 'mm', [20]), REEL);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /ntfy →/);
});
test('annoncée : variables de marge et de prolongation lues', () => {
  const m = prev([0, 4, 5, 0, 0]);                 // 9 cm, seuil 10
  assert.doesNotMatch(lancer('snow-forecast-alert.mjs', m, REEL, etatDe(1, 2, 12)).out, /ntfy →/);
  assert.match(lancer('snow-forecast-alert.mjs', m, { ...REEL, MARGE_CM: '0' }, etatDe(1, 2, 12)).out, /ntfy → Annulé/);
  const p = prev([0, 7, 5, 1, 0]);
  assert.doesNotMatch(lancer('snow-forecast-alert.mjs', p, REEL, etatDe(1, 2, 12)).out, /ntfy →/);
  assert.match(lancer('snow-forecast-alert.mjs', p, { ...REEL, PROLONGE_MIN_CM: '1' }, etatDe(1, 2, 12)).out, /prolongé/);
});
test('annoncée : réglages absurdes -> rouge, défauts appliqués', () => {
  const m = prev([0, 7, 5, 0, 0]);
  for (const env of [{ HAUSSE_CM: '0' }, { MARGE_CM: '10' }, { MARGE_CM: '-1' }, { PROLONGE_MIN_CM: '-1' }]) {
    const r = lancer('snow-forecast-alert.mjs', m, { ...REEL, ...env }, etatDe(1, 2, 12));
    assert.equal(r.code, 1, JSON.stringify(env));
    assert.match(r.out, /Variable invalide/);
    assert.doesNotMatch(r.out, /ntfy →/);
  }
});
test('annoncée : valeur inconnue dans la plage -> pas d\'annulation à l\'aveugle', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 2, 0, 0, 0], 'mm', [null]), REEL, etatDe(-1, 1, 12));
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /ntfy →/);
});
test('annoncée : épisode fini gardé en mémoire tant qu\'il est dans la série', () => {
  const etat = etatDe(-3, -3, 20);
  const r = lancer('snow-forecast-alert.mjs', prev([0, 0, 0, 0, 0], 'mm', [20, 0, 0]), REEL, etat);
  assert.equal(r.etat, etat, 'état inchangé');
});
test('annoncée : seuil forcé -> pas de « décalée » non plus', () => {
  const etat = etatDe(0, 1, 12);
  const r = lancer('snow-forecast-alert.mjs', prev([0, 0, 0, 7, 5]),
    { ...REEL, SEUIL_FORCE: '10' }, etat);
  assert.doesNotMatch(r.out, /décalée/);
  assert.equal(r.etat, etat);
});
test('annoncée : sous le seuil -> annulation unique', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 3, 2, 0, 0]), REEL, etatDe(1, 2, 12));
  assert.match(r.out, /ntfy → Annulé — neige/);
  assert.equal(JSON.parse(r.etat).episodes[0].annule, true);
  const r2 = lancer('snow-forecast-alert.mjs', prev([0, 3, 2, 0, 0]), REEL, r.etat);
  assert.doesNotMatch(r2.out, /ntfy →/);
});
test('annoncée : épisode en cours, jours passés comptés -> pas de fausse annulation', () => {
  // Alerte hier sur hier + aujourd'hui (12 cm), aujourd'hui n'en attend plus que 4.
  const r = lancer('snow-forecast-alert.mjs', prev([4, 0, 0, 0, 0], 'mm', [8]), REEL, etatDe(-1, 0, 12));
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /ntfy →/);
});
test('annoncée : ntfy en panne -> rouge, état conservé, l\'alerte repartira', () => {
  const etat = etatDe(1, 2, 12);
  const r = lancer('snow-forecast-alert.mjs', prev([0, 3, 2, 0, 0]),
    { ...REEL, MOCK_NTFY_STATUS: '500' }, etat);
  assert.equal(r.code, 1, r.out);
  assert.equal(r.etat, etat);
});
test('annoncée : seuil forcé -> ni annulation ni état écrit', () => {
  const etat = etatDe(1, 2, 12);
  const r = lancer('snow-forecast-alert.mjs', prev([0, 3, 2, 0, 0]),
    { ...REEL, SEUIL_CM: '999', SEUIL_FORCE: '999' }, etat);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /ntfy →/);
  assert.equal(r.etat, etat);
});
test('annoncée : état illisible -> rouge, alerte quand même', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 7, 5, 0, 0]), REEL, '{pas du json');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /ntfy → Neige annoncée/);
});
test('annoncée : DRY_RUN avec décisions -> rien envoyé, état intact', () => {
  const etat = etatDe(1, 2, 12);
  const r = lancer('snow-forecast-alert.mjs', prev([0, 3, 2, 0, 0]), {}, etat);
  assert.match(r.out, /\[annule\]/);
  assert.doesNotMatch(r.out, /ntfy →/);
  assert.equal(r.etat, etat);
});

// ---- neige fraîche (SLF) ---------------------------------------------------

const slf = (hn, age = 0) => ({ body: [
  { station_code: 'ILI2', measure_date: `${jourLocal(-age)}T00:00:00Z`, HS: 40, HN_1D: hn },
  { station_code: 'XXX1', measure_date: `${jourLocal()}T00:00:00Z`, HS: 0, HN_1D: 0 },
] });

test('fraîche : HTTP 503 -> rouge', () => {
  assert.equal(lancer('snow-fresh-alert.mjs', { status: 503, body: {} }).code, 1);
});
test('fraîche : erreur réseau -> rouge', () => {
  assert.equal(lancer('snow-fresh-alert.mjs', 'network-error').code, 1);
});
test('fraîche : un raté réseau puis réponse -> vert', () => {
  const r = lancer('snow-fresh-alert.mjs', slf(3, 1), { MOCK_RATES: '1' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Raté sur/);
});
test('fraîche : deux ratés réseau -> rouge', () => {
  assert.equal(lancer('snow-fresh-alert.mjs', slf(3, 1), { MOCK_RATES: '2' }).code, 1);
});
test('fraîche : station absente -> rouge', () => {
  assert.equal(lancer('snow-fresh-alert.mjs', { body: [] }).code, 1);
});
test('fraîche : relevé de 5 jours -> rouge', () => {
  assert.equal(lancer('snow-fresh-alert.mjs', slf(12, 5)).code, 1);
});
test('fraîche : HN_1D nul -> rouge', () => {
  assert.equal(lancer('snow-fresh-alert.mjs', slf(null)).code, 1);
});
test('fraîche : relevé de la veille, 3 cm -> vert, sous le seuil', () => {
  const r = lancer('snow-fresh-alert.mjs', slf(3, 1));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Sous le seuil/);
});
test('fraîche : 25 cm -> vert, alerte à notifier', () => {
  const r = lancer('snow-fresh-alert.mjs', slf(25));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /À notifier : Neige fraîche/);
});
test('DRY_RUN : aucun fichier écrit', () => {
  assert.deepEqual(lancer('snow-fresh-alert.mjs', slf(25)).fichiers, []);
  assert.deepEqual(lancer('snow-forecast-alert.mjs', prev([0, 7, 5, 0, 0])).fichiers, []);
});
test('hors DRY_RUN : le journal est bien écrit (le test ci-dessus prouve donc quelque chose)', () => {
  const env = { DRY_RUN: 'false', SEUIL_CM: '999', NTFY_TOPIC_NEIGE: 'x' };
  const r = lancer('snow-forecast-alert.mjs', prev([0, 7, 5, 0, 0]), env);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.fichiers, ['data']);
});

test('fraîche : stations voisines journalisées, le rapport ne lit que la référence', () => {
  const m = slf(3, 1);
  m.body.push({ station_code: 'GRA2', measure_date: `${jourLocal(-1)}T00:00:00Z`, HS: 20, HN_1D: 99 });
  const r = lancer('snow-fresh-alert.mjs', m, { DRY_RUN: 'false', NTFY_TOPIC_NEIGE: 'x' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.journal, /,GRA2,20/);
  assert.match(r.journal, /,ILI2,40/);
  assert.doesNotMatch(r.journal, /XXX1/);
});

test('fraîche : verdicts QA écrits et HS archivées hors DRY_RUN (D-003)', () => {
  const r = lancer('snow-fresh-alert.mjs', slf(3, 1), { DRY_RUN: 'false', NTFY_TOPIC_NEIGE: 'x' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /QA alertes neige \(D-003\)/);
  assert.match(r.qa, /^envoye_le,episode,type,/);
  assert.match(r.hs, /^ts,station,hs,ta\n.*,ILI2,40,/s);
  assert.doesNotMatch(r.hs, /XXX1/);
});
test('fraîche : HAUSSE_PCT absurde -> verdict à 30 %, run rouge', () => {
  const r = lancer('snow-fresh-alert.mjs', slf(3, 1), { HAUSSE_PCT: '-5' });
  assert.equal(r.code, 1);
  assert.match(r.out, /Variable invalide : HAUSSE_PCT = -5/);
});
test("fraîche : relevé absent et réponse inattendue de l'archive HS -> rouge (alerte aveugle), HS en avertissement", () => {
  const r = lancer('snow-fresh-alert.mjs', { body: {} }, { DRY_RUN: 'false', NTFY_TOPIC_NEIGE: 'x' });
  assert.equal(r.code, 1, "relevé ILI2 absent : l'alerte est aveugle, critique");
  assert.match(r.out, /AVERTISSEMENT archive HS ILI2 : réponse inattendue/);
});
test('rapport : modèle de l\'alerte et station de référence seuls', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neige-'));
  const fichier = join(dir, 'neige.csv');
  try {
    const t = new Date('2026-11-06T16:00:00Z');
    journaliserPrevision('2026-11-06', ['2026-11-07'], [8.4], { fichier, maintenant: t });
    journaliserPrevision('2026-11-06', ['2026-11-07'], [77], { fichier, maintenant: new Date('2026-11-06T17:00:00Z'), modele: 'long' });
    journaliserMesures([{ jour: '2026-11-07', cm: 3, station: 'ILI2', hs: 10 }], { fichier });
    journaliserMesures([{ jour: '2026-11-07', cm: 99, station: 'GRA2', hs: 20 }], { fichier, maintenant: new Date(Date.now() + 6e4) });
    const r = rapport(lire(fichier));
    assert.match(r, /2026-11-07 {2}8\.4 \| 3\.0/);
    assert.doesNotMatch(r, /77|99/);
    const l = lire(fichier);
    assert.equal(l.find((x) => x.station === 'GRA2').hs, '20', 'bonne colonne');
    // Dédoublonnage par station, et révision de la hauteur au sol seule.
    assert.equal(journaliserMesures([{ jour: '2026-11-07', cm: 3, station: 'ILI2', hs: 10 }], { fichier }), 0);
    assert.equal(journaliserMesures([{ jour: '2026-11-07', cm: 3, station: 'FNH2', hs: 5 }], { fichier }), 1);
    assert.equal(journaliserMesures([{ jour: '2026-11-07', cm: 3, station: 'ILI2', hs: 11 }], { fichier }), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- page detail neige (contexte) -------------------------------------------------

test('annoncée : écran enrichi (jours détaillés, altitude), sans bulletin ni relevés (ajoutés par wind-alert)', () => {
  const m = prev([0, 7, 5, 0, 0]);
  m.body.utc_offset_seconds = 3600;
  const r = lancer('snow-forecast-alert.mjs', m, REEL);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.ecran.alt, 2022);
  assert.ok(['tn', 'tx', 'pl', 'iso', 'raf', 'sol', 'p'].every((k) => k in r.ecran.jours[0]), JSON.stringify(r.ecran.jours[0]));
  assert.equal(r.ecran.h.cm.length > 0, true);
  assert.equal('avalanche' in r.ecran, false);
  assert.equal('mesure' in r.ecran, false);
  assert.doesNotMatch(r.out, /aws\.slf\.ch|bulletin/);
});

// ---- D-007 : un 429 d'Open-Meteo ne perd rien ----------------------------------

test('annoncée : 429 Open-Meteo -> rouge, état, écran et journal intacts ; le run suivant rattrape', () => {
  const etat = JSON.stringify({ episodes: [] });
  const refus = lancer('snow-forecast-alert.mjs', { status: 429, body: { error: true, reason: 'Daily API request limit exceeded' } },
    REEL, etat);
  assert.equal(refus.code, 1, refus.out);
  assert.match(refus.out, /HTTP 429/);
  assert.equal(refus.etat, etat, 'état d\'épisode inchangé');
  assert.equal(refus.ecran, null, 'écran non réécrit : TRMNL garde le dernier, daté');
  assert.equal(refus.journal, '', 'rien au journal');
  assert.doesNotMatch(refus.out, /ntfy →/);
  const suivant = lancer('snow-forecast-alert.mjs', prev([0, 7, 5, 0, 0]), REEL, etat);
  assert.equal(suivant.code, 0, suivant.out);
  assert.match(suivant.out, /ntfy → Neige annoncée/);
  assert.equal(suivant.ecran.episode.cm, 12);
});


test('fraîche : archive HS injoignable -> vert, un seul nouvel essai, stations suivantes sautées', () => {
  const urls = join(tmpdir(), `urls-hs-${process.pid}.log`);
  writeFileSync(urls, '');
  try {
    const r = lancer('snow-fresh-alert.mjs', slf(3, 1),
      { DRY_RUN: 'false', NTFY_TOPIC_NEIGE: 'x', MOCK_STATION: '{"status":503,"body":{}}', MOCK_URLS: urls });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /AVERTISSEMENT archive HS \(SLF\) : ILI2 : HTTP 503/);
    assert.match(r.out, /sautée : SLF en panne dans ce run/);
    const appels = readFileSync(urls, 'utf8').split('\n').filter((u) => u.includes('/imis/station/'));
    assert.equal(appels.length, 2, 'ILI2 et son nouvel essai, rien pour les voisines');
    assert.ok(r.sources[1]['archive HS (SLF)']);
  } finally {
    rmSync(urls, { force: true });
  }
});

test('fraîche : une station voisine en 404 -> avertissement sous son nom, les autres archivées', () => {
  const r = lancer('snow-fresh-alert.mjs', slf(3, 1),
    { DRY_RUN: 'false', NTFY_TOPIC_NEIGE: 'x', MOCK_STATION_404: 'ILI2' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /AVERTISSEMENT archive HS ILI2 : HTTP 404/);
  assert.doesNotMatch(r.out, /sautée/);
  assert.equal(r.sources[1]['archive HS (SLF)'], undefined);
});

test('annoncée : source informative en panne depuis plus de 24 h -> rouge (escalade), alerte partie', () => {
  const t = (h) => new Date(Date.now() - h * 36e5).toISOString();
  const suivi = { 'journal neige horizon long': { depuis: t(30), dernier: t(5), message: 'HTTP 503' } };
  const r = lancer('snow-forecast-alert.mjs', prev([0, 7, 5, 0, 0]), { ...REEL, MOCK_LONG: '{"status":503,"body":{}}' },
    null, { 'data/sources-neige-annoncee.json': JSON.stringify(suivi) });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /ECHEC journal neige horizon long en panne depuis plus de 24 h/);
  assert.match(r.out, /ntfy → Neige annoncée/);
  assert.equal(r.sources[0]['journal neige horizon long'].depuis, suivi['journal neige horizon long'].depuis);
});

test('annoncée : DRY_RUN avec une panne en cours -> escalade calculée (rouge), suivi non réécrit', () => {
  const t = (h) => new Date(Date.now() - h * 36e5).toISOString();
  const suivi = JSON.stringify({ 'snowfall_sum (journal)': { depuis: t(30), dernier: t(5), message: 'x' } });
  const m = prev([0, 7, 5, 0, 0]);
  delete m.body.daily.snowfall_sum;
  const r = lancer('snow-forecast-alert.mjs', m, {}, null, { 'data/sources-neige-annoncee.json': suivi });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /snowfall_sum \(journal\) en panne depuis plus de 24 h/);
  assert.deepEqual(r.sources[0], JSON.parse(suivi));
});

// ---- D-008 : journal MeteoSuisse en parallèle, relance après un refus d'Open-Meteo ------

const sortieGh = () => {
  const d = mkdtempSync(join(tmpdir(), 'gh-'));
  const out = join(d, 'out'), resume = join(d, 'resume');
  writeFileSync(out, ''); writeFileSync(resume, '');
  return { env: { GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: resume },
    lire: () => ({ out: readFileSync(out, 'utf8'), resume: readFileSync(resume, 'utf8') }),
    fin: () => rmSync(d, { recursive: true, force: true }) };
};

test('annoncée (D-008) : journal msl, msl7 et icon7 écrits, information seulement', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 7, 5, 0, 0]), REEL);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /AVERTISSEMENT/);
  const lignes = r.journal.trim().split('\n').slice(1).map((l) => l.split(','));
  const de = (m) => lignes.filter((l) => l[5] === m);
  // 1 mm/h à −6 °C à 1943 m, soit −6,51 °C à 2022 m : toute la précipitation en neige.
  const parJour = 24 * rapportTemperature(-6 - 0.0065 * 79);
  assert.ok(de('msl').length >= 2, r.out);
  assert.ok(de('msl7').length >= 2, r.out);
  for (const l of [...de('msl'), ...de('msl7')]) {
    assert.ok(Math.abs(+l[3] - parJour) < 0.05, l.join(','));
    assert.equal(+l[6], 24);
  }
  assert.ok(de('msl').every((l) => l[2] > jourLocal(0)), 'jour du run incomplet (heures du matin absentes) : pas écrit');
  // icon7 : fenêtre 7h → 7h rangée au jour où elle commence, neige de midi comprise.
  assert.deepEqual(de('icon7').map((l) => [l[2], +l[3], +l[4]]),
    [[jourLocal(0), 0, 0], [jourLocal(1), 7, 1], [jourLocal(2), 5, 2], [jourLocal(3), 0, 3]]);
  assert.match(r.out, /Journal neige MeteoSuisse : run 202611240400, point 19999 \(1943 m\)/);
  assert.match(r.out, /ntfy → Neige annoncée/);
});

test('annoncée (D-008) : MeteoSuisse en panne -> avertissement, vert, alerte partie, rien de msl', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 7, 5, 0, 0]), { ...REEL, MOCK_MSL: 'panne' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /AVERTISSEMENT MeteoSuisse Planachaux \(journal\) : STAC : HTTP 503/);
  assert.match(r.out, /ntfy → Neige annoncée/);
  assert.doesNotMatch(r.journal, /,msl/);
  assert.ok(r.sources[0]['MeteoSuisse Planachaux (journal)']);
});

test('annoncée (D-008) : DRY_RUN -> MeteoSuisse lu et affiché, rien écrit', () => {
  const r = lancer('snow-forecast-alert.mjs', prev([0, 7, 5, 0, 0]));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /msl7 : /);
  assert.match(r.out, /rien d'écrit \(DRY_RUN\)/);
  assert.equal(r.journal, '');
});

test('annoncée (D-008) : 429 -> rouge et relance demandée ; puis la relance réussit -> rattrapée', () => {
  const gh = sortieGh();
  const gh2 = sortieGh();
  try {
    const r = lancer('snow-forecast-alert.mjs', { status: 429, body: { error: true, reason: 'Hourly API request limit exceeded' } },
      { ...REEL, ...gh.env });
    assert.equal(r.code, 1, r.out);
    assert.match(gh.lire().out, /^relance=true$/m);
    assert.match(r.out, /Relance demandée au workflow \(HTTP 429\)/);
    // Le run relancé (RELANCE=1) : Open-Meteo répond, alerte normale, résumé explicite.
    const r2 = lancer('snow-forecast-alert.mjs', prev([0, 7, 5, 0, 0]),
      { ...REEL, ...gh2.env, RELANCE: '1', RUN_ORIGINE: '123' });
    assert.equal(r2.code, 0, r2.out);
    assert.match(r2.out, /ntfy → Neige annoncée/);
    assert.match(gh2.lire().resume, /Relance après le refus d'Open-Meteo du run 123 : Open-Meteo a répondu, l'alerte est rattrapée/);
    assert.doesNotMatch(gh2.lire().out, /relance=true/);
  } finally { gh.fin(); gh2.fin(); }
});

test('annoncée (D-008) : relance, Open-Meteo répond mais ntfy échoue -> rouge, pas « rattrapée »', () => {
  const gh = sortieGh();
  try {
    const r = lancer('snow-forecast-alert.mjs', prev([0, 7, 5, 0, 0]),
      { ...REEL, ...gh.env, RELANCE: '1', RUN_ORIGINE: '123', MOCK_NTFY_STATUS: '500' });
    assert.equal(r.code, 1, r.out);
    assert.match(gh.lire().resume, /Open-Meteo a répondu, mais le run a échoué ensuite/);
    assert.doesNotMatch(gh.lire().resume, /l'alerte est rattrapée/);
  } finally { gh.fin(); }
});

test('annoncée (D-008) : réponse 200 illisible -> rouge, pas de relance', () => {
  const gh = sortieGh();
  try {
    const r = lancer('snow-forecast-alert.mjs', { status: 200, body: '{pas du json' }, { ...REEL, ...gh.env });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Réponse d'Open-Meteo illisible/);
    assert.doesNotMatch(gh.lire().out, /relance=true/);
  } finally { gh.fin(); }
});

test('annoncée (D-008) : relance qui échoue encore -> rouge, pas d\'autre relance', () => {
  const gh = sortieGh();
  try {
    const r = lancer('snow-forecast-alert.mjs', 'network-error', { ...REEL, ...gh.env, RELANCE: '1', RUN_ORIGINE: '123' });
    assert.equal(r.code, 1, r.out);
    assert.doesNotMatch(gh.lire().out, /relance=true/);
    assert.match(gh.lire().resume, /du run 123 : nouvel échec \(ECONNRESET/);
  } finally { gh.fin(); }
});

test('annoncée (D-008) : 503 et injoignable -> relance ; 400 -> pas de relance ; DRY_RUN et seuil forcé -> jamais', () => {
  const cas = [
    [{ status: 503, body: {} }, REEL, true],
    ['network-error', REEL, true],
    [{ status: 400, body: { error: true } }, REEL, false],
    [{ status: 429, body: {} }, {}, false],
    [{ status: 429, body: {} }, { ...REEL, SEUIL_FORCE: '5' }, false],
  ];
  for (const [mock, env, attendu] of cas) {
    const gh = sortieGh();
    try {
      const r = lancer('snow-forecast-alert.mjs', mock, { ...env, ...gh.env });
      assert.equal(r.code, 1, r.out);
      assert.equal(/relance=true/.test(gh.lire().out), attendu, `${JSON.stringify(mock)} ${JSON.stringify(env)}`);
    } finally { gh.fin(); }
  }
});
