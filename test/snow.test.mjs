// Tests neige : journal prévision/mesure et chemins d'échec des deux scripts.
// Règle testée : en saison, toute source muette ou refusée rend le run ROUGE
// (code de sortie 1) ; un run qui fonctionne sort en 0.
// Les scripts tournent en DRY_RUN avec un fetch simulé : rien n'est envoyé ni
// écrit, et le résultat ne dépend pas de la météo du jour.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { journaliserPrevision, journaliserMesures, lire, rapport } from '../snow-qa.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOCK = join(RACINE, 'test', 'helpers', 'mock-fetch.mjs');

// cwd = dossier temporaire vide : un script qui écrirait malgré DRY_RUN le
// ferait là (le test « aucun fichier écrit » le voit), jamais dans le vrai
// journal du dépôt.
function lancer(script, mock, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'neige-run-'));
  try {
    const r = spawnSync(process.execPath,
      ['--import', 'file:///' + MOCK.replace(/\\/g, '/'), join(RACINE, script)], {
        cwd: dir, encoding: 'utf8',
        env: { ...process.env, DRY_RUN: 'true', IGNORER_SAISON: 'true',
          SEUIL_CM: '10', NTFY_TOPIC_NEIGE: '',
          MOCK_FETCH: typeof mock === 'string' ? mock : JSON.stringify(mock), ...env },
      });
    return { code: r.status, out: r.stdout + r.stderr, fichiers: readdirSync(dir) };
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

const prev = (neige, unite = 'cm') => ({ body: {
  daily_units: { snowfall_sum: unite },
  daily: { time: neige.map((_, i) => jourLocal(i)), snowfall_sum: neige },
} });

test('annoncée : HTTP 400 -> rouge', () => {
  const r = lancer('snow-forecast-alert.mjs', { status: 400, body: { error: true, reason: 'invalid String value' } });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /HTTP 400/);
});
test('annoncée : erreur réseau -> rouge', () => {
  assert.equal(lancer('snow-forecast-alert.mjs', 'network-error').code, 1);
});
test('annoncée : unité inattendue -> rouge', () => {
  assert.equal(lancer('snow-forecast-alert.mjs', prev([0, 5], 'mm')).code, 1);
});
test('annoncée : réponse vide -> rouge', () => {
  assert.equal(lancer('snow-forecast-alert.mjs', { body: { daily_units: { snowfall_sum: 'cm' }, daily: {} } }).code, 1);
});
test('annoncée : snowfall_sum absent -> rouge', () => {
  const m = prev([0, 5]);
  delete m.body.daily.snowfall_sum;
  assert.equal(lancer('snow-forecast-alert.mjs', m).code, 1);
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
