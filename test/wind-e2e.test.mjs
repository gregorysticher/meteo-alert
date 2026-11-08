// wind-alert.mjs de bout en bout, sur un monde simule (helpers/mock-wind.mjs) :
// annulation (spec B7.1), independance des alertes vis-a-vis d'AROME (B5),
// ligne air-eau et journal du gradient (B6), pannes en rouge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOCK = 'file:///' + join(RACINE, 'test', 'helpers', 'mock-wind.mjs').replace(/\\/g, '/');

// Vendredi 07/05/2027 12:00 local. Le samedi 08/05 est dans la tranche « conf ».
const VENDREDI = '2027-05-07T10:00:00Z';
const SAMEDI = '2027-05-08';

function lancer(monde, { vus = [], env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wind-e2e-'));
  try {
    mkdirSync(join(dir, 'wind'));
    copyFileSync(join(RACINE, 'wind', 'spots.json'), join(dir, 'wind', 'spots.json'));
    writeFileSync(join(dir, 'alerted.json'), JSON.stringify(vus));
    const log = join(dir, 'ntfy.log');
    writeFileSync(log, '');
    const r = spawnSync(process.execPath, ['--import', MOCK, join(RACINE, 'wind-alert.mjs')], {
      cwd: dir, encoding: 'utf8',
      env: { ...process.env, DRY_RUN: '0', QA_ONLY: '0', SEUIL_TEST: '', TRMNL_WEBHOOK_URL: '',
        NTFY_TOPIC_VENT: 'test', MOCK_NTFY_LOG: log,
        MOCK_WIND: JSON.stringify({ now: VENDREDI, ...monde }), ...env },
    });
    const lit = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
    return {
      code: r.status, out: r.stdout + r.stderr,
      notifs: lit('ntfy.log').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)),
      vus: JSON.parse(lit('alerted.json')),
      archive: lit('data/forecasts/2027-05.csv'), qa: lit('data/qa.csv'), gradient: lit('data/gradient.csv'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const titres = (r) => r.notifs.map((n) => n.title);
const PRE = 'pre|reposoir|202705080700';    // samedi 09:00 local
const venteSamedi = (...points) =>
  Object.fromEntries(points.map((p) => [p, { [SAMEDI]: 15 }]));

test('B7.1 : Reposoir ne tient plus, Cologny oui -> pas d\'annulation, seulement la confirmation', () => {
  const r = lancer({ vent: venteSamedi('Cologny') }, { vus: [PRE] });
  assert.equal(r.code, 0, r.out);
  assert.ok(!titres(r).some((t) => t.startsWith('Annule')), titres(r).join(' | '));
  assert.ok(titres(r).some((t) => t.startsWith('Confirme — Cologny')), titres(r).join(' | '));
});

test('B7.1 : aucun spot ne tient -> annulation, memorisee une seule fois', () => {
  const r = lancer({}, { vus: [PRE] });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(titres(r).filter((t) => t.startsWith('Annule')).length, 1);
  assert.match(r.notifs[0].message, /aucun autre spot/);
  assert.ok(r.vus.includes('annul|reposoir|202705080700'));
  const r2 = lancer({}, { vus: r.vus });
  assert.equal(titres(r2).length, 0, 'pas de seconde annulation');
});

test('B7.1 : le meme spot tient encore -> ni annulation ni doublon de pre-alerte', () => {
  const r = lancer({ vent: venteSamedi('Bellevue') }, { vus: [PRE] });
  assert.ok(!titres(r).some((t) => t.startsWith('Annule')));
  assert.ok(titres(r).some((t) => t.startsWith('Confirme — Reposoir')));
});

test('annulation : ntfy en panne -> run rouge, rien memorise, nouvel essai possible', () => {
  const r = lancer({ ntfy: 500 }, { vus: [PRE] });
  assert.equal(r.code, 1, r.out);
  assert.ok(!r.vus.includes('annul|reposoir|202705080700'));
});

test('B5 : AROME archive avec son modele, alertes identiques avec ou sans lui', () => {
  const monde = { vent: venteSamedi('Bellevue') };
  const avec = lancer(monde);
  const sans = lancer({ ...monde, arome: 503 });
  assert.equal(avec.code, 0, avec.out);
  assert.deepEqual(avec.notifs, sans.notifs);
  assert.ok(avec.notifs.length > 0);
  assert.match(avec.archive, /,30\.0,,40\.0,90,arome/);
  assert.match(avec.archive, /,ms\n/);
  // emission = run AROME (now - 3 h), aucune heure anterieure archivee
  const lignes = avec.archive.split('\n').filter((l) => l.endsWith(',arome'));
  assert.ok(lignes.length > 0);
  assert.ok(lignes.every((l) => l.startsWith('202705070700,') && l.split(',')[3] >= '202705070700'));
});

test('B5 : AROME en panne -> run rouge, MAIS alertes parties et archive MeteoSuisse ecrite', () => {
  for (const arome of [503, 'vide']) {
    const r = lancer({ vent: venteSamedi('Bellevue'), arome });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /ECHEC archive AROME/);
    assert.ok(r.notifs.length > 0);
    assert.match(r.archive, /,ms\n/);
    assert.doesNotMatch(r.archive, /,arome/);
  }
});

test('B5 : l\'appariement separe les modeles', () => {
  const r = lancer({});
  assert.match(r.qa, /,ms\n/);
  assert.match(r.qa, /,arome\n/);
  assert.match(r.out, /QA previsions ms/);
  assert.match(r.out, /QA previsions arome/);
});

test('B6 : alerte avec air, eau et gradient ; sans lac, pas de ligne', () => {
  const r = lancer({ vent: venteSamedi('Bellevue'), air: 18.4, eau: 12.1 });
  const conf = r.notifs.find((n) => n.title.startsWith('Confirme'));
  assert.match(conf.message, /Eau 12\.1°C, air 18\.4°C \(air − eau \+6\.3°C\)/);
  const r2 = lancer({ vent: venteSamedi('Bellevue'), eau: null });
  assert.doesNotMatch(r2.notifs.find((n) => n.title.startsWith('Confirme')).message, /Eau/);
});

test('B6 : gradient journalise par spot sur lac, station sans thermometre sautee', () => {
  const r = lancer({ air: 8, eau: 12 });
  assert.equal(r.code, 0, r.out);
  const l = r.gradient.trim().split('\n');
  assert.equal(l[0], 'ts,spot,station,air_c,eau_c,gradient_c');
  assert.equal(l.length - 1, 6, r.gradient);     // 8 spots - Joux (pas de lac) - Preverenges (PRE)
  assert.match(r.gradient, /202705071000,reposoir,GVE,8\.0,12\.0,-4\.0/);
  assert.doesNotMatch(r.gradient, /joux|preverenges/);
});

test('B6 : lac muet -> run rouge, alertes parties quand meme', () => {
  const r = lancer({ vent: venteSamedi('Bellevue'), eau: null });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /ECHEC journal gradient/);
  assert.ok(r.notifs.length > 0);
});

test('B6 : prevision d\'air absente -> run rouge, alertes parties sans l\'air', () => {
  const r = lancer({ vent: venteSamedi('Bellevue'), air_prev: false, eau: 12 });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /ECHEC prevision tre200h0/);
  const conf = r.notifs.find((n) => n.title.startsWith('Confirme'));
  assert.match(conf.message, /Eau 12\.0°C\n/);
});

test('B7.2 : fenetre qui commence dans 20 min -> « Aujourd\'hui » part', () => {
  // Samedi 08:40 local (06:40 UTC), fenetre des 09:00.
  const r = lancer({ now: '2027-05-08T06:40:00Z', vent: venteSamedi('Bellevue') });
  assert.ok(titres(r).some((t) => t.startsWith('Aujourd\'hui — Reposoir')), titres(r).join(' | '));
});
