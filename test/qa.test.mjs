// Tests de l'archive des previsions et de la boucle QA : decoupage par mois,
// lecture a cheval sur deux mois, idempotence, et surtout : un second modele
// ne doit jamais toucher au biais qui corrige les alertes.
// Le fetch (mesures) est simule ; chaque test tourne dans un dossier temporaire.

import { test, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  archiver, apparier, biaisParEcheance, fichierArchive, lignesArchive, rapport,
} from '../wind-qa.mjs';

const SPOTS = [{ key: 'reposoir', station: 'GVE' }, { key: 'coppet', station: 'CGI' }];
const racine = process.cwd();
let dir;

beforeEach(() => {
  process.chdir(racine);
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), 'qa-'));
  process.chdir(dir);
});
after(() => {
  process.chdir(racine);
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

const ligne = (date, kn = 10) => ({ date, kn, q10: kn - 2, rafale: kn + 5, dir: 90 });
const parSpot = (date, kn) => new Map(SPOTS.map((s) => [s.key, [ligne(date, kn)]]));

function simulerMesures(kn = 8) {
  const csv = 'Station/Location;Date;tre200s0;dkl010z0;fu3010z0;fu3010z1\n' +
    `GVE;202611081000;9.6;90;${kn * 1.852};${kn * 2 * 1.852}\n` +
    `CGI;202611081000;8.5;90;${kn * 1.852};${kn * 2 * 1.852}\n`;
  mock.method(globalThis, 'fetch', async () => new Response(csv));
}

test('une emission va dans le fichier de SON mois', async () => {
  assert.equal(fichierArchive('202612312300'), 'data/forecasts/2026-12.csv');
  assert.equal(fichierArchive('202701010000'), 'data/forecasts/2027-01.csv');
  assert.equal(await archiver('202612312300', SPOTS, parSpot('202701010500')), 2);
  assert.equal(await archiver('202701010000', SPOTS, parSpot('202701010500')), 2);
  assert.deepEqual(readdirSync('data/forecasts').sort(), ['2026-12.csv', '2027-01.csv']);
  const dec = readFileSync('data/forecasts/2026-12.csv', 'utf8').trim().split('\n');
  assert.equal(dec[0], 'emission,spot,station,echeance,kn,q10,rafale,dir,modele');
  assert.equal(dec[1], '202612312300,reposoir,GVE,202701010500,10.0,8.0,15.0,90,ms');
  assert.equal(dec.length, 3);
});

test('meme emission, meme modele : ecrite une seule fois ; autre modele : ecrite', async () => {
  assert.equal(await archiver('202611080500', SPOTS, parSpot('202611081000')), 2);
  assert.equal(await archiver('202611080500', SPOTS, parSpot('202611081000')), 0);
  assert.equal(await archiver('202611080500', SPOTS, parSpot('202611081000'), 'arome'), 2);
  assert.equal(await archiver('202611080500', SPOTS, parSpot('202611081000'), 'arome'), 0);
  assert.equal(readFileSync('data/forecasts/2026-11.csv', 'utf8').trim().split('\n').length, 5);
});

test('valeurs absentes (AROME sans q10, direction nulle) : colonnes vides', async () => {
  const m = new Map([['reposoir', [{ date: '202611081000', kn: 7, q10: null, rafale: 12.34, dir: null }]]]);
  await archiver('202611080300', SPOTS, m, 'arome');
  assert.match(readFileSync('data/forecasts/2026-11.csv', 'utf8'),
    /202611080300,reposoir,GVE,202611081000,7\.0,,12\.3,,arome/);
});

test('lecture : mois de l\'echeance et precedent, y compris au passage d\'annee', async () => {
  await archiver('202611280500', SPOTS, parSpot('202612010500'));   // trop vieux pour janvier
  await archiver('202612280500', SPOTS, parSpot('202701010500'));
  await archiver('202701010000', SPOTS, parSpot('202701010500'));
  const l = await lignesArchive('202701010500');
  assert.equal(l.length, 4);
  assert.ok(l.every((x) => !x.startsWith('emission')));
  assert.ok(l.every((x) => !x.startsWith('20261128')));
  // Mois precedent absent : pas d'erreur.
  assert.equal((await lignesArchive('202703010500')).length, 0);
});

test('appariement a cheval sur deux mois (vraie heure courante)', async () => {
  simulerMesures(8);
  const maintenant = new Date();
  maintenant.setUTCMinutes(0, 0, 0);
  const cle = (d) => d.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const cible = cle(maintenant);
  // Une emission du mois precedent : doit etre lue aussi.
  const mPrec = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - 1, 15, 5));
  await archiver(cle(mPrec), SPOTS, parSpot(cible, 10));
  await archiver(cle(new Date(maintenant - 6 * 36e5)), SPOTS, parSpot(cible, 12));
  assert.equal(await apparier(SPOTS), 4);
  assert.equal(await apparier(SPOTS), 0, 'idempotent');
  const qa = readFileSync('data/qa.csv', 'utf8').trim().split('\n');
  assert.equal(qa[0], 'emission,spot,station,echeance,lead_h,prevu_kn,mesure_kn,erreur_kn,modele');
  assert.match(qa.join('\n'), /,10\.0,8\.0,2\.0,ms/);
  assert.match(qa.join('\n'), /,12\.0,8\.0,4\.0,ms/);
  mock.restoreAll();
});

test('volume reel : deux mois de 400 000 lignes passent (run du 08/11 rouge sans cela)', async () => {
  mkdirSync('data/forecasts', { recursive: true });
  const rang = '202611080500,reposoir,GVE,202611081000,10.0,8.0,15.0,90,ms\n';
  const entete = 'emission,spot,station,echeance,kn,q10,rafale,dir,modele\n';
  writeFileSync('data/forecasts/2026-10.csv', entete + rang.repeat(400000));
  writeFileSync('data/forecasts/2026-11.csv', entete + rang.repeat(400000));
  assert.equal((await lignesArchive('202611081000')).length, 800000);
});

test('apparier : archive absente -> 0, sans appeler les mesures', async () => {
  const f = mock.method(globalThis, 'fetch', async () => { throw new Error('ne doit pas etre appele'); });
  assert.equal(await apparier(SPOTS), 0);
  assert.equal(f.mock.callCount(), 0);
  mock.restoreAll();
});

test('deux modeles sur la meme heure : deux appariements distincts', async () => {
  simulerMesures(8);
  const maintenant = new Date();
  maintenant.setUTCMinutes(0, 0, 0);
  const cle = (d) => d.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const emission = cle(new Date(maintenant - 6 * 36e5));
  const cible = cle(maintenant);
  await archiver(emission, SPOTS, parSpot(cible, 10));
  await archiver(emission, SPOTS, parSpot(cible, 20), 'arome');
  assert.equal(await apparier(SPOTS), 4);
  const r = await rapport();
  assert.match(r, /QA previsions ms — 2 appariements/);
  assert.match(r, /QA previsions arome — 2 appariements/);
  assert.ok(r.indexOf('previsions ms') < r.indexOf('previsions arome'), 'MeteoSuisse d\'abord');
  mock.restoreAll();
});

test('AROME ne change PAS le biais qui corrige les alertes', async () => {
  const entete = 'emission,spot,station,echeance,lead_h,prevu_kn,mesure_kn,erreur_kn,modele\n';
  const rangs = (modele, err, n) => Array.from({ length: n },
    (_, i) => `2026110${(i % 8) + 1}0500,reposoir,GVE,2026110${(i % 8) + 1}1100,6.0,10.0,12.0,${err},${modele}`);
  mkdirSync('data', { recursive: true });
  writeFileSync('data/qa.csv', entete + rangs('ms', -2.0, 40).join('\n') + '\n');
  const avant = await biaisParEcheance();
  assert.equal(avant.get(6), -2);
  writeFileSync('data/qa.csv', entete +
    [...rangs('ms', -2.0, 40), ...rangs('arome', 9.0, 400)].join('\n') + '\n');
  assert.deepEqual([...(await biaisParEcheance())], [...avant]);
});

test('sous 30 points MeteoSuisse, pas de biais, meme avec beaucoup d\'AROME', async () => {
  const entete = 'emission,spot,station,echeance,lead_h,prevu_kn,mesure_kn,erreur_kn,modele\n';
  const rang = (m) => `202611010500,reposoir,GVE,202611011100,6.0,10.0,12.0,5.0,${m}`;
  mkdirSync('data', { recursive: true });
  writeFileSync('data/qa.csv', entete +
    [...Array(5).fill(rang('ms')), ...Array(100).fill(rang('arome'))].join('\n') + '\n');
  assert.equal((await biaisParEcheance()).size, 0);
});

test('fichier en CRLF (clone Windows) : modele et idempotence restent justes', async () => {
  mkdirSync('data/forecasts', { recursive: true });
  writeFileSync('data/forecasts/2026-11.csv',
    'emission,spot,station,echeance,kn,q10,rafale,dir,modele\r\n' +
    '202611080500,reposoir,GVE,202611081000,10.0,8.0,15.0,90,ms\r\n');
  assert.equal(await archiver('202611080500', SPOTS, parSpot('202611081000')), 0);
});

test('rapport sans donnees', async () => {
  assert.match(await rapport(), /aucun appariement/);
  assert.equal(existsSync('data'), false);
});
