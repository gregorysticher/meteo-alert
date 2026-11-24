// Verdict QA des alertes neige envoyées (D-003) : règles, lectures J / J+1, épisodes,
// biais par échéance (alerte et 0,7 fixe), archive des HS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  verdict, mesurePlage, verdicts, episodes, ligneEnvoi, journaliserEnvoi, lireEnvois,
  ecrireVerdicts, mesuresReference, biaisParEcheance, rapportTemperature,
  rapport, ALIGNEMENT, comparaisonJours, comparaisonEpisodes,
} from '../snow-verdict.mjs';
import { journaliserHs } from '../snow-qa.mjs';

const envoi = (type, annonce, seuil = 10, debut = '2026-11-15', fin = '2026-11-16', envoye = '2026-11-13T10:00Z') =>
  ({ envoye_le: envoye, type, debut, fin, annonce_cm: annonce, seuil_cm: seuil, avant_cm: null, echeance_j: 2 });

test('verdict : OK, SURESTIME, SOUSESTIME, RATE, à 30 % près', () => {
  assert.equal(verdict(envoi('hausse', 40), { cm: 28 }), 'OK');           // 30 % pile
  assert.equal(verdict(envoi('hausse', 40), { cm: 27.9 }), 'SURESTIME');
  assert.equal(verdict(envoi('hausse', 40), { cm: 52 }), 'OK');
  assert.equal(verdict(envoi('hausse', 40), { cm: 52.1 }), 'SOUSESTIME');
  assert.equal(verdict(envoi('nouvelle', 40), { cm: 9.9 }), 'RATE');
  assert.equal(verdict(envoi('nouvelle', 40), { cm: 10 }), 'SURESTIME');   // seuil atteint
  assert.equal(verdict(envoi('hausse', 40), { cm: 20 }, 0.5), 'OK', 'tolérance réglable');
  // Baisse annoncée sous le seuil (marge d'annulation) : pas RATE, jugée à la tolérance.
  assert.equal(verdict(envoi('baisse', 8.5), { cm: 8 }), 'OK');
  assert.equal(verdict(envoi('baisse', 8.5), { cm: 3 }), 'SURESTIME');
  assert.equal(verdict(envoi('nouvelle', 0, 0), { cm: 0 }), 'OK', 'pas de division par zéro');
});

test('verdict : annulation justifiée ou à tort, mesures manquantes, plage pas passée', () => {
  assert.equal(verdict(envoi('annule', 0), { cm: 4 }), 'JUSTIFIEE');
  assert.equal(verdict(envoi('annule', 0), { cm: 10 }), 'A_TORT');
  assert.equal(verdict(envoi('hausse', 40), { manque: true }), '?');
  assert.equal(verdict(envoi('annule', 0), { attente: true }), 'ATTENTE');
});

test('mesure de la plage : lecture J et J+1', () => {
  const m = new Map([['2026-11-15', 2], ['2026-11-16', 10], ['2026-11-17', 20]]);
  assert.deepEqual(mesurePlage(m, '2026-11-15', '2026-11-16', 'J', '2026-11-18'), { cm: 12 });
  assert.deepEqual(mesurePlage(m, '2026-11-15', '2026-11-16', 'J+1', '2026-11-18'), { cm: 30 });
  // Dernier jour de la plage : pas encore passé, quelle que soit la lecture.
  assert.deepEqual(mesurePlage(m, '2026-11-15', '2026-11-16', 'J', '2026-11-16'), { attente: true });
  assert.deepEqual(mesurePlage(m, '2026-11-15', '2026-11-16', 'J+1', '2026-11-16'), { attente: true });
  // Le lendemain, J+1 lit le relevé du jour : pas encore publié = attente, pas « ? ».
  const sans17 = new Map([['2026-11-15', 2], ['2026-11-16', 10]]);
  assert.deepEqual(mesurePlage(sans17, '2026-11-15', '2026-11-16', 'J+1', '2026-11-17'), { attente: true });
  assert.deepEqual(mesurePlage(sans17, '2026-11-15', '2026-11-16', 'J', '2026-11-17'), { cm: 12 });
  // Trou dans les mesures.
  assert.deepEqual(mesurePlage(new Map([['2026-11-16', 3]]), '2026-11-15', '2026-11-16', 'J', '2026-11-20'), { manque: true });
  assert.deepEqual(mesurePlage(sans17, '2026-11-15', '2026-11-16', 'J+1', '2026-11-18'), { manque: true });
});

test('mesures de référence : ILI2 seule, la révision la plus récente l\'emporte', () => {
  const m = mesuresReference([
    { source: 'mesure', station: 'ILI2', jour: '2026-11-07', cm: 8.6, run: '2026-11-08T20:46Z' },
    { source: 'mesure', station: 'ILI2', jour: '2026-11-07', cm: 11.2, run: '2026-11-10T05:47Z' },
    { source: 'mesure', station: 'GRA2', jour: '2026-11-07', cm: 99, run: '2026-11-11T05:47Z' },
    { source: 'prev', station: '', jour: '2026-11-07', cm: 50, run: '2026-11-11T05:47Z' },
  ]);
  assert.deepEqual([...m], [['2026-11-07', 11.2]]);
});

test('épisodes : plages qui se touchent groupées, dans l\'ordre d\'envoi', () => {
  const g = episodes([
    envoi('hausse', 37, 10, '2026-11-15', '2026-11-16', '2026-11-13T16:33Z'),
    envoi('nouvelle', 64, 10, '2026-11-15', '2026-11-16', '2026-11-12T04:24Z'),
    envoi('hausse', 59, 10, '2026-11-15', '2026-11-18', '2026-11-14T04:24Z'),
    envoi('nouvelle', 20, 10, '2026-11-19', '2026-11-20', '2026-11-15T04:24Z'),  // touche le 18
    envoi('nouvelle', 15, 10, '2026-11-25', '2026-11-25', '2026-11-22T04:24Z'),  // séparé
  ]);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].messages.map((m) => m.type), ['nouvelle', 'hausse', 'hausse', 'nouvelle']);
  assert.equal(g[0].debut, '2026-11-15');
  assert.equal(g[0].fin, '2026-11-20');
  assert.equal(g[1].messages.length, 1);
});

test('épisodes : un message qui relie deux épisodes les fusionne', () => {
  const g = episodes([
    envoi('nouvelle', 20, 10, '2026-11-15', '2026-11-16', '2026-11-12T04:24Z'),
    envoi('nouvelle', 20, 10, '2026-11-19', '2026-11-20', '2026-11-13T04:24Z'),
    envoi('hausse', 50, 10, '2026-11-15', '2026-11-20', '2026-11-14T04:24Z'),
  ]);
  assert.equal(g.length, 1);
  assert.deepEqual([g[0].debut, g[0].fin, g[0].messages.length], ['2026-11-15', '2026-11-20', 3]);
  assert.deepEqual(g[0].messages.map((m) => m.envoye_le.slice(8, 10)), ['12', '13', '14']);
});

test('verdicts : deux lectures, colonne verdict selon l\'alignement (J+1 depuis le 21.11)', () => {
  assert.equal(ALIGNEMENT, 'J+1');
  const m = new Map([['2026-11-15', 0], ['2026-11-16', 30], ['2026-11-17', 35]]);
  const e = [envoi('hausse', 40)];
  const [v] = verdicts(e, m, { jour: '2026-11-18' });  // plage 15-16, J+1 lit le 17
  assert.equal(v.mesure_j_cm, 30); assert.equal(v.verdict_j, 'OK');
  assert.equal(v.mesure_j1_cm, 65); assert.equal(v.verdict_j1, 'SOUSESTIME');
  assert.equal(v.verdict, 'SOUSESTIME', 'lecture J+1 retenue');
  assert.equal(verdicts(e, m, { jour: '2026-11-18', alignement: null })[0].verdict, '');
  assert.equal(v.episode, '2026-11-15');
  assert.equal(verdicts(e, m, { jour: '2026-11-18', alignement: 'J+1' })[0].verdict, 'SOUSESTIME');
});

test('journal des envois : ligne écrite, relue, annulation sur la plage annulée', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-neige-'));
  const fichier = join(dir, 'alertes-neige.csv');
  try {
    const maintenant = new Date('2026-11-15T07:03:57Z');
    journaliserEnvoi({ type: 'hausse', episode: { debut: '2026-11-15', fin: '2026-11-19', total: 88.64 },
      record: { debut: '2026-11-15', fin: '2026-11-18', total: 67.9 } }, { jour: '2026-11-15', seuil: 10, maintenant }, fichier);
    journaliserEnvoi({ type: 'annule', episode: null,
      record: { debut: '2026-11-17', fin: '2026-11-18', total: 30 } }, { jour: '2026-11-15', seuil: 10, maintenant }, fichier);
    assert.equal(readFileSync(fichier, 'utf8'),
      'envoye_le,type,debut,fin,annonce_cm,avant_cm,echeance_j,seuil_cm\n' +
      '2026-11-15T07:03Z,hausse,2026-11-15,2026-11-19,88.6,67.9,0,10\n' +
      '2026-11-15T07:03Z,annule,2026-11-17,2026-11-18,0,30,2,10\n');
    const l = lireEnvois(fichier);
    assert.equal(l[0].annonce_cm, 88.6);
    assert.equal(l[1].avant_cm, 30);
    assert.equal(ligneEnvoi({ type: 'nouvelle', episode: { debut: '2026-11-15', fin: '2026-11-15', total: 12 } },
      { jour: '2026-11-12', seuil: 10, maintenant }).avant_cm, '');
    // Retour d'un épisode annulé : nouvelle, sans « avant ».
    assert.equal(ligneEnvoi({ type: 'nouvelle', episode: { debut: '2026-11-15', fin: '2026-11-15', total: 12 },
      record: { debut: '2026-11-15', fin: '2026-11-15', total: 30, annule: true } },
      { jour: '2026-11-12', seuil: 10, maintenant }).avant_cm, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fichier des verdicts : réécrit en entier', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-neige-'));
  const fichier = join(dir, 'qa.csv');
  try {
    const m = new Map([['2026-11-15', 5], ['2026-11-16', 30]]);
    ecrireVerdicts(verdicts([envoi('hausse', 40)], m, { jour: '2026-11-20' }), fichier);
    ecrireVerdicts(verdicts([envoi('hausse', 40)], m, { jour: '2026-11-20' }), fichier);
    assert.equal(readFileSync(fichier, 'utf8'),
      'envoye_le,episode,type,debut,fin,annonce_cm,seuil_cm,mesure_j_cm,verdict_j,mesure_j1_cm,verdict_j1,verdict\n' +
      '2026-11-13T10:00Z,2026-11-15,hausse,2026-11-15,2026-11-16,40,10,35,OK,,?,?\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const prevL = (jour, cm, k, run = '2026-11-14T04:24Z', annexes = {}) =>
  ({ source: 'prev', modele: 'icon', jour, cm, echeance_j: k, run, mm: NaN, pluie: NaN, tMoy: NaN, ...annexes });

test('biais par échéance : dernière prévision de l\'échéance, jours secs écartés', () => {
  const lignes = [
    prevL('2026-11-15', 12, 1, '2026-11-14T04:24Z'),
    prevL('2026-11-15', 8, 1, '2026-11-14T15:24Z'),   // plus récente : retenue
    prevL('2026-11-16', 0, 1),                         // sec des deux côtés : écarté
    prevL('2026-11-15', 20, 2),
  ];
  const m = new Map([['2026-11-15', 5], ['2026-11-16', 0], ['2026-11-17', 1]]);
  const b = biaisParEcheance(lignes, m, { echeances: [1, 2] });
  const de = (k, l) => b.find((x) => x.echeance === k && x.lecture === l);
  assert.deepEqual(de(1, 'J'), { echeance: 1, lecture: 'J', n: 1, biais: 3, mae: 3 });
  // Lecture J+1 : le 15 est comparé au 16 (0), le 16 au 17 (1 cm : retenu).
  assert.deepEqual(de(1, 'J+1'), { echeance: 1, lecture: 'J+1', n: 2, biais: 3.5, mae: 4.5 });
  assert.equal(de(2, 'J').biais, 15);
});

test('Hedstrom et Pomeroy : 0,84 cm/mm à 0 °C, plafonné au-dessus', () => {
  assert.ok(Math.abs(rapportTemperature(0) - 100 / 119.17) < 1e-9);
  assert.ok(rapportTemperature(-10) > 1.4 && rapportTemperature(-10) < 1.5);
  assert.equal(rapportTemperature(3), rapportTemperature(0), 'plafonné à 0 °C');
});

test('biais : chiffre de l\'alerte et 0,7 fixe côte à côte (D-005)', () => {
  // Ligne D-005 : cm = conversion, cmFixe = snowfall_sum. Ligne d'avant : cmFixe = cm (lire()).
  const lignes = [
    prevL('2026-11-15', 6, 1, 'a', { cmFixe: 14 }),
    prevL('2026-11-16', 9, 1, 'a', { cmFixe: 9 }),
  ];
  const m = new Map([['2026-11-15', 5], ['2026-11-16', 10]]);
  const alerte = biaisParEcheance(lignes, m, { echeances: [1] }).find((x) => x.lecture === 'J');
  const fixe = biaisParEcheance(lignes, m, { echeances: [1], champ: 'cmFixe' }).find((x) => x.lecture === 'J');
  assert.equal(alerte.biais, 0);     // (1 − 1) / 2
  assert.equal(fixe.biais, 4);       // (9 − 1) / 2
  const r = rapport([], lignes, m);
  assert.match(r, /\| J-1 \| J \| 2 \| 0 \| 1 \| 4 \| 5 \|/);
});

test('rapport du job : verdicts, messages par épisode au-delà de l\'objectif', () => {
  const e = ['2026-11-12T04:24Z', '2026-11-13T10:28Z', '2026-11-13T16:33Z', '2026-11-14T04:24Z']
    .map((t) => envoi('hausse', 40, 10, '2026-11-15', '2026-11-16', t));
  const r = rapport(verdicts(e, new Map(), { jour: '2026-11-14' }), [], new Map());
  assert.match(r, /\| 2026-11-12T04:24Z \| hausse \| 2026-11-15 → 2026-11-16 \| 40 \| — \| ATTENTE \|/);
  assert.match(r, /2026-11-15 → 2026-11-16 : 4 message\(s\) — au-delà de l'objectif/);
  assert.ok(r.includes("Alignement HN_1D : J+1."), r);
  assert.match(rapport([], [], new Map()), /Aucune alerte neige envoyée journalisée/);
});

test('archive HS : dédoublonnée par station et heure, valeurs invalides écartées', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-neige-'));
  const fichier = join(dir, 'hs.csv');
  try {
    const r = [
      { station_code: 'ILI2', measure_date: '2026-11-13T20:00:00Z', HS: 7.48, TA_30MIN_MEAN: -3.7 },
      { station_code: 'ILI2', measure_date: '2026-11-13T19:30:00Z', HS: 1, TA_30MIN_MEAN: null },
      { station_code: 'ILI2', measure_date: '2026-11-13T21:00:00Z', HS: null },
      { station_code: 'ILI2', measure_date: 'n/a', HS: 3 },
    ];
    assert.equal(journaliserHs(r, { fichier }), 2);
    assert.equal(journaliserHs(r, { fichier }), 0);
    assert.equal(readFileSync(fichier, 'utf8'),
      'ts,station,hs,ta\n2026-11-13T19:30Z,ILI2,1,\n2026-11-13T20:00Z,ILI2,7.48,-3.7\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- D-008 : ICON contre MeteoSuisse, jours civils et fenêtres 7h -> 7h ------------------

const pv = (run, jour, cm, ech, modele) => ({ run, source: 'prev', jour, cm, echeance_j: ech, modele });
const JOURNAL = [
  pv('2026-11-24T04:24Z', '2026-11-25', 18, 1, 'icon'), pv('2026-11-24T04:24Z', '2026-11-25', 14, 1, 'icon7'),
  pv('2026-11-24T04:24Z', '2026-11-25', 2, 1, 'msl'), pv('2026-11-24T04:24Z', '2026-11-25', 4, 1, 'msl7'),
  pv('2026-11-24T15:24Z', '2026-11-25', 5, 1, 'msl7'),          // plus récent à J-1 : retenu
  pv('2026-11-24T04:24Z', '2026-11-26', 9, 2, 'icon7'), pv('2026-11-24T04:24Z', '2026-11-26', 1, 2, 'msl7'),
  pv('2026-11-25T04:24Z', '2026-11-26', 7, 1, 'icon7'), pv('2026-11-25T04:24Z', '2026-11-26', 1.5, 1, 'msl7'),
  pv('2026-11-23T04:24Z', '2026-11-25', 20, 2, 'icon7'), pv('2026-11-23T04:24Z', '2026-11-25', 3, 2, 'msl7'),
];
const MESURES = new Map([['2026-11-26', 6], ['2026-11-27', 2]]);

test('D-008 : comparaison par jour à J-1, mesure datée J+1', () => {
  assert.deepEqual(comparaisonJours(JOURNAL, MESURES), [
    { jour: '2026-11-25', icon: 18, icon7: 14, msl: 2, msl7: 5, mesure: 6 },
    { jour: '2026-11-26', icon: null, icon7: 7, msl: null, msl7: 1.5, mesure: 2 },
  ]);
});

test('D-008 : total par épisode des fenêtres, J-1 et J-2, couverture partielle dite', () => {
  const envois = [envoi('nouvelle', 29, 10, '2026-11-25', '2026-11-26', '2026-11-22T08:03Z')];
  const [e] = comparaisonEpisodes(envois, JOURNAL, MESURES, { jour: '2026-11-28' });
  assert.deepEqual([e.icon7_j1, e.msl7_j1, e.icon7_j2, e.msl7_j2, e.mesure],
    [{ cm: 21, n: 2 }, { cm: 6.5, n: 2 }, { cm: 29, n: 2 }, { cm: 4, n: 2 }, { cm: 8 }]);
  // Épisode d'avant le journal MeteoSuisse : absent.
  assert.deepEqual(comparaisonEpisodes([envoi('nouvelle', 40)], JOURNAL, MESURES, { jour: '2026-11-28' }), []);
  const texte = rapport(verdicts(envois, MESURES, { jour: '2026-11-28' }), JOURNAL, MESURES, { jour: '2026-11-28' });
  assert.match(texte, /\| 2026-11-25 \| 18 \| 14 \| 2 \| 5 \| 6 \|/);
  assert.match(texte, /\| 2026-11-25 → 2026-11-26 \| 21 \| 6\.5 \| 29 \| 4 \| 8 \|/);
});
