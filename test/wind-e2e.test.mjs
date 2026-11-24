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
      env: { ...process.env, SILENCE_NOCTURNE: '', SILENCE_HORLOGE: '',
        DRY_RUN: '0', QA_ONLY: '0', SEUIL_TEST: '', TRMNL_WEBHOOK_URL: 'https://trmnl.test/hook',
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
      sources: lit('data/sources-vent.json') ? JSON.parse(lit('data/sources-vent.json')) : null,
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

test('B5 : AROME en panne -> avertissement, run vert (D-007), alertes parties et archive MeteoSuisse ecrite', () => {
  for (const arome of [503, 'vide']) {
    const r = lancer({ vent: venteSamedi('Bellevue'), arome });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /AVERTISSEMENT AROME \(Open-Meteo\)/);
    assert.match(r.out, /::warning title=AROME \(Open-Meteo\)::/);
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

test('B5 : unite inattendue ou run fige -> avertissement, rien d\'archive pour AROME', () => {
  for (const arome of ['mph', 'fige']) {
    const r = lancer({ arome });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /AVERTISSEMENT AROME/);
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

test('B6 : air absent partout -> avertissement, vert', () => {
  const r = lancer({ air_mesure: false, eau: 12 });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /AVERTISSEMENT gradient air-eau/);
  assert.match(r.out, /air absente/);
});

test('B6 : lac muet -> avertissement, vert, alertes parties quand meme', () => {
  const r = lancer({ vent: venteSamedi('Bellevue'), eau: null });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /AVERTISSEMENT gradient air-eau : temperature du lac indisponible/);
  assert.ok(r.notifs.length > 0);
});

test('B6 : prevision d\'air absente -> avertissement, vert, alertes parties sans l\'air', () => {
  const r = lancer({ vent: venteSamedi('Bellevue'), air_prev: false, eau: 12 });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /AVERTISSEMENT prevision tre200h0/);
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
const SPOT_CHAMPS = ['a', 'd', 'de', 'e', 'fin', 'j', 'kn', 'min', 'n', 'now', 'raf'];
// On peut ajouter des champs, pas en retirer : inclusion, pas egalite.
const contient = (obj, champs, nom) => {
  for (const c of champs) assert.ok(c in obj, `${nom}.${c} retire`);
};

test('contrat : aucun champ retire, en saison avec fenetre', () => {
  const p = lancer({ vent: venteSamedi('Bellevue') }, HOOK).payload;
  contient(p, ['maj', 'mesure', 'neige', 'profil', 'reco', 'saison', 'seuil', 'spots', 'tz'], 'payload');
  contient(p.mesure, ['g', 'h', 'n', 'now'], 'mesure');
  contient(p.reco, ['a', 'de', 'fin', 'g', 'j', 'kn', 'min', 'n', 'ok', 'raf'], 'reco');
  contient(p.profil, ['de', 'j', 'kn', 'n', 'ok'], 'profil');
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

test('contrat : profil = spot et jour de la reco, 7 h a 21 h, ok decide par meteo-alert', () => {
  const p = lancer({ vent: venteSamedi('Bellevue') }, HOOK).payload;
  const pf = p.profil;
  assert.deepEqual([pf.n, pf.j, pf.de], [p.reco.n, p.reco.j, 7]);
  assert.equal(pf.kn.length, 15);
  assert.equal(pf.ok.length, 15);
  // Fenetre samedi 09:00-18:00 : les heures 9 a 17 tiennent, 7, 8 et 18 a 21 non.
  assert.deepEqual(pf.ok, [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0]);
  assert.equal(pf.kn[2], p.reco.kn);
  assert.ok(pf.kn.every((v) => v === null || Math.round(v * 10) === v * 10), 'kn au dixieme');
  assert.equal(p.tz, 7200);
  // fin des spots : meme sens que reco.fin (epoch UTC, fin de la derniere heure)
  assert.equal(p.spots[0].fin, p.reco.fin);
});

test('contrat : chaque spot porte la fin de SA fenetre', () => {
  // Coppet : secteur 180-300, d'ou la direction 230 ; dimanche, l'autre jour du week-end.
  const vent = { Bellevue: { [SAMEDI]: 15 }, Coppet: { '2027-05-09': 15 } };
  const p = lancer({ vent, dir: { Coppet: 230 } }, HOOK).payload;
  const avec = p.spots.filter((s) => s.e === 2);
  assert.ok(new Set(avec.map((s) => s.j)).size >= 2, avec.map((s) => s.n + ' ' + s.j).join(', '));
  for (const s of avec) {
    // fin = j + a en heure d'ete suisse ; a = 00:00 voudrait dire le lendemain
    assert.equal(s.fin, Date.parse(`${s.j}T${s.a}:00+02:00`) / 1000, s.n);
  }
});

test('contrat : hors saison, profil et fin des spots nuls', () => {
  const p = lancer({ now: '2026-11-09T18:00:00Z' }, HOOK).payload;
  assert.equal(p.tz, 3600);
  assert.equal(p.reco, null);
  assert.equal(p.profil, null);
  assert.ok(p.spots.every((s) => s.fin === null));
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
  // Page detail : bulletin et releves ajoutes a chaque envoi (pas d'archive HS ici).
  assert.deepEqual(lancer(hiver, { ...HOOK, fichiers }).payload.neige, { ...ecran, mesure: null,
    avalanche: { niveau: 3, sous: '', nom: 'marqué', pb: ['neige soufflée dès 2400 m'],
      debut: Date.parse('2026-11-08T16:00:00Z') / 1000, fin: Date.parse('2026-11-09T16:00:00Z') / 1000 } });
  assert.equal(lancer(hiver, HOOK).payload.neige, null);
  assert.equal(lancer({}, { ...HOOK, fichiers }).payload.neige, null);
  // 6 jours : encore joint.
  const recent = { 'data/neige-ecran.json': JSON.stringify({ ...ecran, maj: '202611020900' }) };
  assert.equal(lancer(hiver, { ...HOOK, fichiers: recent }).payload.neige.maj, '202611020900');
  // Fichier de la saison passee : pas joint.
  const vieux = { 'data/neige-ecran.json': JSON.stringify({ ...ecran, maj: '202604100500' }) };
  assert.equal(lancer(hiver, { ...HOOK, fichiers: vieux }).payload.neige, null);
  const r = lancer(hiver, { ...HOOK, fichiers: { 'data/neige-ecran.json': '{pas du json' } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /AVERTISSEMENT data\/neige-ecran\.json/);
  assert.equal(r.payload.neige, null);
});

test('contrat (D-008) : episode commence -> reste a tomber a l\'envoi, total garde, suivant si moins de min', () => {
  const ecran = { maj: '202611080500', lieu: 'Les Collines', min: 5, jour: '2026-11-08',
    jours: [{ d: '2026-11-08', cm: 2 }, { d: '2026-11-09', cm: 20 }, { d: '2026-11-10', cm: 0 }, { d: '2026-11-11', cm: 9 }],
    episodes: [{ cm: 60, de: '2026-11-06', a: '2026-11-09', ok: true }, { cm: 9, de: '2026-11-11', a: '2026-11-11', ok: false }],
    episode: { cm: 60, de: '2026-11-06', a: '2026-11-09', ok: true } };
  const fichiers = { 'data/neige-ecran.json': JSON.stringify(ecran) };
  const n = lancer({ now: '2026-11-08T10:00:00Z' }, { ...HOOK, fichiers }).payload.neige;
  assert.deepEqual(n.episode, { cm: 22, de: '2026-11-08', a: '2026-11-09', ok: true, total: 60, cours: true });
  assert.deepEqual(n.episodes[1], { cm: 9, de: '2026-11-11', a: '2026-11-11', ok: false, total: 9, cours: false });
  // Le 09 au soir sans h : jour entier (20 cm) ; le 10, l'episode est fini -> le suivant.
  const fin = lancer({ now: '2026-11-10T10:00:00Z' }, { ...HOOK, fichiers }).payload.neige;
  assert.deepEqual(fin.episode, { cm: 9, de: '2026-11-11', a: '2026-11-11', ok: false, total: 9, cours: false });
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

// ---- page detail : bulletin, releves ILI2, plan ------------------------------------

test('page detail : bulletin en panne ou region absente -> avertissement, vert, envoi parti ; aucun bulletin -> vert', () => {
  const ecran = { maj: '202611081000', lieu: 'Les Collines', episode: null };
  const fichiers = { 'data/neige-ecran.json': JSON.stringify(ecran) };
  const panne = lancer({ now: '2026-11-08T10:00:00Z', avalanche: 'panne' }, { ...HOOK, fichiers });
  assert.equal(panne.code, 0, panne.out);
  assert.match(panne.out, /AVERTISSEMENT bulletin d'avalanches SLF : HTTP 503/);
  assert.equal(panne.payload.neige.avalanche, null);
  assert.equal(panne.payload.neige.maj, '202611081000');
  const autre = lancer({ now: '2026-11-08T10:00:00Z', avalanche: 'autre' }, { ...HOOK, fichiers });
  assert.equal(autre.code, 0, autre.out);
  assert.match(autre.out, /région CH-1312 absente/);
  const vide = lancer({ now: '2026-11-08T10:00:00Z', avalanche: 'vide' }, { ...HOOK, fichiers });
  assert.equal(vide.code, 0, vide.out);
  assert.equal(vide.payload.neige.avalanche, null);
});

test('page detail : releves ILI2 joints, trop vieux -> null', () => {
  const ecran = { maj: '202611081000', lieu: 'Les Collines', episode: null };
  const hs = 'ts,station,hs,ta\n2026-11-07T09:00Z,ILI2,20,-1\n2026-11-08T09:00Z,ILI2,31,-3.4\n';
  const neige = 'run,source,jour,cm,echeance_j,modele,mm,pluie_mm,t_moy,station,hs,cm_fixe\n' +
    '2026-11-08T07:00Z,mesure,2026-11-08,11,,,,,,ILI2,,\n';
  const f = { 'data/neige-ecran.json': JSON.stringify(ecran), 'data/neige-hs.csv': hs, 'data/neige.csv': neige };
  const m = lancer({ now: '2026-11-08T10:00:00Z' }, { ...HOOK, fichiers: f }).payload.neige.mesure;
  assert.deepEqual(m, { h: Date.parse('2026-11-08T09:00Z') / 1000, hs: 31, d24: 11, ta: -3.4, hn: [{ d: '2026-11-08', cm: 11 }] });
  assert.equal(lancer({ now: '2026-11-11T10:00:00Z' }, { ...HOOK, fichiers: f }).payload.neige.mesure, null);
});

test('contrat : plan aligne sur spots[], 7 jours', () => {
  const p = lancer({ vent: venteSamedi('Bellevue') }, HOOK).payload;
  assert.ok(p.plan, 'plan present en saison vent');
  assert.equal(p.plan.jours.length, 7);
  assert.deepEqual(p.plan.s.map((x) => x.n), p.spots.map((x) => x.n));
  assert.ok(p.plan.s.every((x) => x.kn.length === 7 && x.ok.length === 7));
});

// ---- D-007 : deux niveaux de gravite --------------------------------------------

test('D-007 : AROME en panne depuis moins de 24 h -> vert, suivi garde le debut', () => {
  const depuis = new Date(Date.parse(VENDREDI) - 20 * 36e5).toISOString();
  const suivi = { 'AROME (Open-Meteo)': { depuis, dernier: new Date(Date.parse(VENDREDI) - 4 * 36e5).toISOString(), message: 'HTTP 429' } };
  const r = lancer({ arome: 503 }, { fichiers: { 'data/sources-vent.json': JSON.stringify(suivi) } });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.sources['AROME (Open-Meteo)'].depuis, depuis);
});

test('D-007 : AROME en panne depuis plus de 24 h -> rouge (escalade), alertes parties', () => {
  const depuis = new Date(Date.parse(VENDREDI) - 25 * 36e5).toISOString();
  const suivi = { 'AROME (Open-Meteo)': { depuis, dernier: new Date(Date.parse(VENDREDI) - 4 * 36e5).toISOString(), message: 'HTTP 429' } };
  const r = lancer({ vent: venteSamedi('Bellevue'), arome: 503 },
    { fichiers: { 'data/sources-vent.json': JSON.stringify(suivi) } });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /ECHEC AROME \(Open-Meteo\) en panne depuis plus de 24 h/);
  assert.ok(r.notifs.length > 0);
});

test('D-007 : AROME de retour -> suivi efface', () => {
  const depuis = new Date(Date.parse(VENDREDI) - 30 * 36e5).toISOString();
  const suivi = { 'AROME (Open-Meteo)': { depuis, dernier: new Date(Date.parse(VENDREDI) - 4 * 36e5).toISOString(), message: 'HTTP 429' } };
  const r = lancer({}, { fichiers: { 'data/sources-vent.json': JSON.stringify(suivi) } });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.sources, {});
});

test('D-007 : Alplakes muet -> un seul nouvel essai dans le run, spots suivants sautes', () => {
  const r = lancer({ vent: venteSamedi('Bellevue'), eau: null });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.out.match(/Raté sur https:\/\/alplakes-api\.eawag\.ch/g)?.length, 1, r.out);
  assert.match(r.out, /AVERTISSEMENT lac \(Alplakes\) : HTTP 500/);
  assert.ok(r.sources['lac (Alplakes)']);
});

test('D-007 : critiques inchanges -> ntfy, webhook et prevision restent rouges au premier echec', () => {
  assert.equal(lancer({ ntfy: 500, vent: venteSamedi('Bellevue') }).code, 1);
  assert.equal(lancer({ emission_age_h: 30 }).code, 1);
});
