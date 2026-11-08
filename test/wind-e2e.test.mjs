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

function lancer(monde, { vus = [], env = {}, fichiers = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wind-e2e-'));
  try {
    mkdirSync(join(dir, 'wind'));
    copyFileSync(join(RACINE, 'wind', 'spots.json'), join(dir, 'wind', 'spots.json'));
    writeFileSync(join(dir, 'alerted.json'), JSON.stringify(vus));
    for (const [f, texte] of Object.entries(fichiers)) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      writeFileSync(join(dir, f), texte);
    }
    const log = join(dir, 'ntfy.log');
    writeFileSync(log, '');
    const logTrmnl = join(dir, 'trmnl.log');
    writeFileSync(logTrmnl, '');
    const r = spawnSync(process.execPath, ['--import', MOCK, join(RACINE, 'wind-alert.mjs')], {
      cwd: dir, encoding: 'utf8',
      env: { ...process.env, DRY_RUN: '0', QA_ONLY: '0', SEUIL_TEST: '', TRMNL_WEBHOOK_URL: 'https://trmnl.test/hook',
        NTFY_TOPIC_VENT: 'test', MOCK_NTFY_LOG: log, MOCK_TRMNL_LOG: logTrmnl,
        MOCK_WIND: JSON.stringify({ now: VENDREDI, ...monde }), ...env },
    });
    const lit = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
    return {
      code: r.status, out: r.stdout + r.stderr,
      notifs: lit('ntfy.log').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)),
      vus: JSON.parse(lit('alerted.json')),
      payload: lit('trmnl.log').trim() ? JSON.parse(lit('trmnl.log')).merge_variables : null,
      archive: lit('data/forecasts/2027-05.csv'), qa: lit('data/qa/2027-05.csv'), gradient: lit('data/gradient.csv'),
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

test('B7.1 : samedi tombe, seul dimanche tient -> annulation de samedi, pic du jour', () => {
  const r = lancer({ vent: { Bellevue: { '2027-05-09': 25 } } }, { vus: [PRE] });
  const annul = r.notifs.find((n) => n.title.startsWith('Annule'));
  assert.ok(annul, titres(r).join(' | '));
  assert.match(annul.message, /Pic revu a 3 kn ce jour-la/);
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

test('B5 : la requete AROME demande le bon modele, en noeuds', () => {
  const r = lancer({ arome_strict: true });
  assert.equal(r.code, 0, r.out);
  assert.match(r.archive, /,arome/);
});

test('B5 : unite inattendue ou run fige -> rouge, rien d\'archive pour AROME', () => {
  for (const arome of ['mph', 'fige']) {
    const r = lancer({ arome });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /ECHEC archive AROME/);
    assert.doesNotMatch(r.archive, /,arome/);
  }
});

test('run MeteoSuisse de plus de 24 h -> rouge', () => {
  const r = lancer({ emission_age_h: 30 });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /run MeteoSuisse de plus de 24 h/);
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

test('B6 : second run dans la meme heure, seul le spot sans thermometre reste -> vert', () => {
  // Reproduit le run rouge du 08/11 11:43.
  const faits = ['cologny,GVE', 'reposoir,GVE', 'vengeron,GVE', 'coppet,CGI', 'nyon,CGI', 'bouveret,BOU']
    .map((x) => `202705071000,${x},8.0,12.0,-4.0`).join('\n');
  const r = lancer({ air: 8, eau: 12 }, { fichiers: {
    'data/gradient.csv': `ts,spot,station,air_c,eau_c,gradient_c\n${faits}\n`,
  } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Gradient air-eau : 0/);
});

test('B6 : air absent partout -> rouge', () => {
  const r = lancer({ air_mesure: false, eau: 12 });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /air absente/);
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

// ---- contrat du payload TRMNL (docs/contrat-trmnl.md) --------------------------

const HOOK = {};
const SPOT_CHAMPS = ['a', 'd', 'de', 'e', 'j', 'kn', 'min', 'n', 'now', 'raf'];
// On peut ajouter des champs, pas en retirer : inclusion, pas egalite.
const contient = (obj, champs, nom) => {
  for (const c of champs) assert.ok(c in obj, `${nom}.${c} retire`);
};

test('contrat : aucun champ retire, en saison avec fenetre', () => {
  const p = lancer({ vent: venteSamedi('Bellevue') }, HOOK).payload;
  contient(p, ['maj', 'mesure', 'neige', 'reco', 'saison', 'seuil', 'spots'], 'payload');
  contient(p.mesure, ['g', 'h', 'n', 'now'], 'mesure');
  contient(p.reco, ['a', 'de', 'fin', 'g', 'j', 'kn', 'min', 'n', 'ok', 'raf'], 'reco');
  for (const s of p.spots) contient(s, SPOT_CHAMPS, 'spots');
});

test('contrat : unites et sens des champs', () => {
  const p = lancer({ vent: venteSamedi('Bellevue') }, HOOK).payload;
  assert.equal(p.seuil, 11);
  assert.deepEqual([p.reco.kn, p.reco.min], [15, 12]);
  assert.ok(p.reco.raf >= 19 && p.reco.raf <= 20, `raf ${p.reco.raf}`);
  const s = p.spots[0];
  assert.deepEqual([s.n, s.min, s.now, s.d, s.kn], ['Reposoir', 12, 5, 90, 15]);
});

test('webhook injoignable -> rouge, QA du run conservee', () => {
  const r = lancer({ vent: venteSamedi('Bellevue') }, { env: { TRMNL_WEBHOOK_URL: 'https://hors-simulation.test/x' } });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /ECHEC webhook TRMNL/);
  assert.match(r.archive, /,ms\n/);
  assert.match(r.qa, /,ms\n/);
});

test('secret du webhook absent -> rouge, sauf DRY_RUN', () => {
  const r = lancer({}, { env: { TRMNL_WEBHOOK_URL: '' } });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /ECHEC : pas de TRMNL_WEBHOOK_URL/);
  assert.equal(lancer({}, { env: { TRMNL_WEBHOOK_URL: '', DRY_RUN: '1' } }).code, 0);
});

test('contrat : une vraie mesure a 0 kn reste 0, pas null ; spots du plus proche au plus loin', () => {
  const p = lancer({ mesure_kn: 0 }, HOOK).payload;
  assert.equal(p.mesure.now, 0);
  assert.equal(p.spots[0].now, 0);
  const minutes = p.spots.map((s) => s.min);
  assert.deepEqual(minutes, [...minutes].sort((a, b) => a - b));
  assert.equal(p.spots.length, 6);
});

test('glyphe sur la mesure brute : 8,6 kn reste ○ (seuil 11, marge 2)', () => {
  assert.equal(lancer({ mesure_kn: 8.6 }, HOOK).payload.mesure.g, '○');
  assert.equal(lancer({ mesure_kn: 9.2 }, HOOK).payload.mesure.g, '◐');
});

test('contrat : valeurs lues par le markup, fenetre 09-18 h', () => {
  const p = lancer({ vent: venteSamedi('Bellevue') }, HOOK).payload;
  assert.equal(p.saison, 'vent');
  assert.equal(p.reco.n, 'Reposoir');
  assert.equal(p.reco.de, '09:00');
  assert.equal(p.reco.a, '18:00', 'la vraie fin, pas le debut de la derniere heure');
  assert.equal(p.reco.g, '●');
  assert.equal(p.reco.j, SAMEDI);
  assert.equal(new Date(p.reco.fin * 1000).toISOString(), '2027-05-08T16:00:00.000Z');
  assert.equal(p.spots[0].a, '18:00');
  assert.equal(p.spots[0].e, 2);
  assert.equal(p.mesure.g, '●');
  assert.equal(p.maj, '202705070900');
});

test('contrat : mesure.h = heure locale de la mesure, pas celle de l\'emission', () => {
  const p = lancer({}, HOOK).payload;
  assert.deepEqual([p.mesure.n, p.mesure.now, p.mesure.h], ['Reposoir', 5, '02:00']);
});

test('contrat : hors saison -> saison neige, reco nulle, mesure toujours la', () => {
  const p = lancer({ now: '2026-11-08T10:00:00Z' }, HOOK).payload;
  assert.equal(p.saison, 'neige');
  assert.equal(p.reco, null);
  assert.equal(p.mesure.n, 'Reposoir');
});

test('contrat : neige jointe en saison neige, nulle en saison vent ou si absente', () => {
  const ecran = { maj: '202611081000', lieu: 'Les Collines', min: 5, j0: 0, j5: 23,
    episode: { cm: 23, de: '2026-11-10', a: '2026-11-12', ok: true } };
  const fichiers = { 'data/neige-ecran.json': JSON.stringify(ecran) };
  const hiver = { now: '2026-11-08T10:00:00Z' };
  assert.deepEqual(lancer(hiver, { ...HOOK, fichiers }).payload.neige, ecran);
  assert.equal(lancer(hiver, HOOK).payload.neige, null);
  assert.equal(lancer({}, { ...HOOK, fichiers }).payload.neige, null);
  const r = lancer(hiver, { ...HOOK, fichiers: { 'data/neige-ecran.json': '{pas du json' } });
  assert.equal(r.code, 1, r.out);
  assert.equal(r.payload.neige, null);
});

test('contrat : reco sous le seuil -> glyphe ○, ok faux', () => {
  const p = lancer({}, HOOK).payload;
  assert.equal(p.reco.ok, false);
  assert.equal(p.reco.g, '○');
});

test('alerte : le message annonce la vraie fin de la fenetre', () => {
  const r = lancer({ vent: venteSamedi('Bellevue') });
  const conf = r.notifs.find((n) => n.title.startsWith('Confirme'));
  assert.match(conf.message, /→ 18:00/);
});
