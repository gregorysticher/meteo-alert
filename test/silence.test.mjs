// Silence nocturne (D-001) : fenêtre, jours de repos genevois, envoi retenu sans échec.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { silence, paques, feriesGeneve, jourOuvre, heureDeReveil, apresSilence, SILENCE } from '../silence.mjs';
import { notifier, echecs, differees } from '../notify.mjs';

const actif = (iso) => silence(new Date(iso)).actif;

test('réglage : 22h30 -> 7h00, 8h00 les jours de repos', () => {
  assert.deepEqual(SILENCE, { debut: '22:30', finOuvre: '07:00', finRepos: '08:00' });
});

test('Pâques : dates connues', () => {
  assert.equal(paques(2026), '2026-04-05');
  assert.equal(paques(2027), '2027-03-28');
  assert.equal(paques(2028), '2028-04-16');
});

test('fériés genevois 2026 et 2027', () => {
  const f26 = feriesGeneve(2026);
  for (const d of ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-14', '2026-05-25',
    '2026-08-01', '2026-09-10', '2026-12-25', '2026-12-31']) assert.ok(f26.has(d), d);
  assert.equal(f26.size, 9);
  // Jeûne genevois 2027 : premier dimanche de septembre le 5 -> jeudi 9.
  assert.ok(feriesGeneve(2027).has('2027-09-09'));
  assert.ok(feriesGeneve(2027).has('2027-03-26'), 'Vendredi saint 2027');
});

test('jours ouvrés : semaine hors fériés', () => {
  assert.equal(jourOuvre('2026-11-16'), true);   // lundi
  assert.equal(jourOuvre('2026-11-14'), false);  // samedi
  assert.equal(jourOuvre('2026-11-15'), false);  // dimanche
  assert.equal(jourOuvre('2026-12-25'), false);  // Noël, vendredi
  assert.equal(jourOuvre('2026-12-31'), false);  // Restauration, jeudi
  assert.equal(jourOuvre('2026-09-10'), false);  // Jeûne genevois
});

test('fenêtre un jour ouvré (heure d\'hiver, UTC+1)', () => {
  assert.equal(actif('2026-11-16T21:29:00Z'), false);  // lundi 22h29
  assert.equal(actif('2026-11-16T21:30:00Z'), true);   // lundi 22h30
  assert.equal(actif('2026-11-17T03:00:00Z'), true);   // mardi 4h
  assert.equal(actif('2026-11-17T05:59:00Z'), true);   // mardi 6h59
  assert.equal(actif('2026-11-17T06:00:00Z'), false);  // mardi 7h00
});

test('fenêtre un jour de repos : jusqu\'à 8h', () => {
  assert.equal(actif('2026-11-14T06:30:00Z'), true);   // samedi 7h30
  assert.equal(actif('2026-11-14T07:00:00Z'), false);  // samedi 8h00
  assert.equal(actif('2026-12-25T06:30:00Z'), true);   // Noël 7h30
});

test('heure d\'été (UTC+2)', () => {
  assert.equal(actif('2027-06-14T04:59:00Z'), true);   // lundi 6h59
  assert.equal(actif('2027-06-14T05:00:00Z'), false);  // lundi 7h00
  assert.equal(actif('2027-06-14T20:30:00Z'), true);   // lundi 22h30
});

test('reprise annoncée : le bon matin', () => {
  assert.equal(silence(new Date('2026-11-13T21:45:00Z')).reprise, 'Sa 14.11 08:00'); // vendredi soir
  assert.equal(silence(new Date('2026-11-15T21:45:00Z')).reprise, 'Lu 16.11 07:00'); // dimanche soir
  assert.equal(silence(new Date('2026-11-16T04:00:00Z')).reprise, 'Lu 16.11 07:00'); // lundi 5h
  assert.equal(silence(new Date('2026-11-16T12:00:00Z')).reprise, undefined);
});

test('heure de réveil : 7h un jour ouvré, 8h sinon, hiver comme été', () => {
  assert.equal(heureDeReveil(new Date('2026-11-16T06:03:00Z')), true);   // lundi 7h03
  assert.equal(heureDeReveil(new Date('2026-11-16T07:03:00Z')), false);  // lundi 8h03
  assert.equal(heureDeReveil(new Date('2026-11-16T05:03:00Z')), false);  // lundi 6h03
  assert.equal(heureDeReveil(new Date('2026-11-14T07:03:00Z')), true);   // samedi 8h03
  assert.equal(heureDeReveil(new Date('2026-11-14T06:03:00Z')), false);  // samedi 7h03
  assert.equal(heureDeReveil(new Date('2027-06-14T05:03:00Z')), true);   // lundi d'été 7h03
  assert.equal(heureDeReveil(new Date('2027-06-13T06:03:00Z')), true);   // dimanche d'été 8h03
});

test('après le silence : 3 h depuis la fin du matin', () => {
  assert.equal(apresSilence(new Date('2026-11-16T05:59:00Z')), false);  // lundi 6h59
  assert.equal(apresSilence(new Date('2026-11-16T06:03:00Z')), true);   // lundi 7h03
  assert.equal(apresSilence(new Date('2026-11-16T08:59:00Z')), true);   // lundi 9h59
  assert.equal(apresSilence(new Date('2026-11-16T09:00:00Z')), false);  // lundi 10h00
  assert.equal(apresSilence(new Date('2026-11-14T06:30:00Z')), false);  // samedi 7h30
  assert.equal(apresSilence(new Date('2026-11-14T07:03:00Z')), true);   // samedi 8h03
});

test('fins du silence à heure pleine : réveil du Worker à HH:03', () => {
  for (const h of [SILENCE.finOuvre, SILENCE.finRepos]) assert.match(h, /^\d\d:00$/);
});

// ---- notifier ------------------------------------------------------------------

const vrai = globalThis.fetch;
const logVrai = console.log;
let envois;
beforeEach(() => {
  envois = [];
  echecs.length = 0; differees.length = 0;
  globalThis.fetch = async (url, opts) => { envois.push(JSON.parse(opts.body)); return new Response('{}', { status: 200 }); };
  console.log = () => {};
});
afterEach(() => {
  globalThis.fetch = vrai; console.log = logVrai;
  delete process.env.SILENCE_NOCTURNE; delete process.env.SILENCE_HORLOGE;
});

test('notifier : la nuit, retenu, ni envoi ni échec', async () => {
  process.env.SILENCE_NOCTURNE = '1';
  process.env.SILENCE_HORLOGE = '2026-11-14T04:24:00Z';  // l'alerte de 5h24 (samedi)
  assert.equal(await notifier('t', 'Neige', 'x'), false);
  assert.equal(envois.length, 0);
  assert.deepEqual(echecs, []);
  assert.deepEqual(differees, ['Neige']);
});

test('notifier : la nuit, envoi de test forcé', async () => {
  process.env.SILENCE_NOCTURNE = '1';
  process.env.SILENCE_HORLOGE = '2026-11-13T21:45:00Z';
  assert.equal(await notifier('t', '[TEST] Vent', 'x', { ignorerSilence: true }), true);
  assert.equal(envois.length, 1);
});

test('notifier : de jour, envoyé', async () => {
  process.env.SILENCE_NOCTURNE = '1';
  process.env.SILENCE_HORLOGE = '2026-11-14T10:00:00Z';
  assert.equal(await notifier('t', 'Neige', 'x'), true);
  assert.equal(envois.length, 1);
});

test('notifier : variable SILENCE_NOCTURNE absente, la nuit aussi envoyé', async () => {
  process.env.SILENCE_HORLOGE = '2026-11-13T21:45:00Z';
  assert.equal(await notifier('t', 'Neige', 'x'), true);
  assert.deepEqual(differees, []);
});
