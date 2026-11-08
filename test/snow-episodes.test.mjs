// Règles de l'alerte neige annoncée (spec B4.3) sur des épisodes simulés.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { episodes, decider, duree } from '../snow-episodes.mjs';

const OPT = { jour: '2027-01-12', seuil: 10, hausse: 5 };
const LU = '2027-01-11', MA = '2027-01-12', ME = '2027-01-13', JE = '2027-01-14', VE = '2027-01-15';

const ep = (debut, fin, total) => ({ debut, fin, total, jours: [] });
const rec = (debut, fin, total, d = duree({ debut, fin }), annule = false) =>
  ({ debut, fin, total, duree: d, annule });
const types = (ds) => ds.map((d) => d.type);

// ---- episodes() ------------------------------------------------------------

test('episodes : jours consecutifs, traces ignorees, valeurs invalides coupent', () => {
  const dates = [LU, MA, ME, JE, VE];
  const e = episodes(dates, [5, 7, 0.5, 12, null], { minJour: 1 });
  assert.equal(e.length, 2);
  assert.deepEqual([e[0].debut, e[0].fin, e[0].total], [LU, MA, 12]);
  assert.deepEqual([e[1].debut, e[1].fin, e[1].total], [JE, JE, 12]);
});

test('episodes : retenir exclut les jours hors saison', () => {
  const e = episodes([LU, MA], [5, 7], { minJour: 1, retenir: (d) => d !== MA });
  assert.deepEqual([e[0].fin, e[0].total], [LU, 5]);
});

// ---- nouvelle --------------------------------------------------------------

test('nouvelle : au-dessus du seuil, jamais alerte', () => {
  const d = decider([ep(ME, JE, 12)], [], OPT);
  assert.deepEqual(types(d), ['nouvelle']);
  assert.deepEqual(d[0].apres, rec(ME, JE, 12));
});
test('rien sous le seuil', () => {
  assert.deepEqual(decider([ep(ME, JE, 9.9)], [], OPT), []);
});
test('seuil exact : alerte', () => {
  assert.deepEqual(types(decider([ep(ME, ME, 10)], [], OPT)), ['nouvelle']);
});
test('episode deja fini, jamais alerte : pas d\'alerte', () => {
  assert.deepEqual(decider([ep(LU, LU, 30)], [], OPT), []);
});

// ---- hausse ----------------------------------------------------------------

test('hausse : +4 cm -> rien ; +5 cm -> alerte, nouvelle reference', () => {
  const r = rec(ME, JE, 12);
  assert.deepEqual(types(decider([ep(ME, JE, 16)], [r], OPT)), [null]);
  const d = decider([ep(ME, JE, 17)], [r], OPT);
  assert.deepEqual(types(d), ['hausse']);
  assert.equal(d[0].apres.total, 17);
});
test('hausse : reference = derniere alerte, pas le dernier run (montee lente)', () => {
  let r = rec(ME, JE, 12);
  for (const total of [13, 14, 15, 16]) {
    const d = decider([ep(ME, JE, total)], [r], OPT);
    assert.deepEqual(types(d), [null]);
    r = d[0].apres;
  }
  assert.deepEqual(types(decider([ep(ME, JE, 17)], [r], OPT)), ['hausse']);
});
test('baisse puis remontee sous la reference : rien', () => {
  let r = rec(ME, JE, 30);
  r = decider([ep(ME, JE, 20)], [r], OPT)[0].apres;
  assert.deepEqual(types(decider([ep(ME, JE, 27)], [r], OPT)), [null]);
  assert.equal(r.total, 30);
});
test('seuil de hausse parametrable', () => {
  const d = decider([ep(ME, JE, 15)], [rec(ME, JE, 12)], { ...OPT, hausse: 3 });
  assert.deepEqual(types(d), ['hausse']);
});

// ---- prolonge --------------------------------------------------------------

test('prolonge : un jour de plus -> alerte, meme sans hausse de 5 cm', () => {
  const d = decider([ep(ME, VE, 13)], [rec(ME, JE, 12)], OPT);
  assert.deepEqual(types(d), ['prolonge']);
  assert.equal(d[0].apres.duree, 3);
});
test('prolonge : debut avance -> alerte', () => {
  assert.deepEqual(types(decider([ep(MA, JE, 13)], [rec(ME, JE, 12)], OPT)), ['prolonge']);
});
test('decale sans s\'allonger : rien, mais la plage suivie s\'elargit', () => {
  const d = decider([ep(JE, VE, 12)], [rec(ME, JE, 12)], OPT);
  assert.deepEqual(types(d), [null]);
  assert.deepEqual([d[0].apres.debut, d[0].apres.fin, d[0].apres.duree], [ME, VE, 2]);
});
test('raccourci puis rallonge a la duree deja annoncee : rien', () => {
  const r1 = decider([ep(ME, ME, 12)], [rec(ME, JE, 12)], OPT)[0].apres;
  assert.deepEqual(types(decider([ep(ME, JE, 12)], [r1], OPT)), [null]);
});
test('hausse ET prolongation : une seule alerte', () => {
  assert.deepEqual(types(decider([ep(ME, VE, 25)], [rec(ME, JE, 12)], OPT)), ['hausse']);
});

// ---- annule ----------------------------------------------------------------

test('annule : repasse sous le seuil -> annulation, une seule fois', () => {
  const d = decider([ep(ME, JE, 8)], [rec(ME, JE, 12)], OPT);
  assert.deepEqual(types(d), ['annule']);
  assert.equal(d[0].apres.annule, true);
  assert.deepEqual(types(decider([ep(ME, JE, 8)], [d[0].apres], OPT)), [null]);
});
test('annule : l\'episode disparait de la prevision -> annulation', () => {
  assert.deepEqual(types(decider([], [rec(ME, JE, 12)], OPT)), ['annule']);
});
test('annule puis repasse au-dessus -> nouvelle, reference remise a zero', () => {
  const d = decider([ep(ME, JE, 11)], [rec(ME, JE, 12, 2, true)], OPT);
  assert.deepEqual(types(d), ['nouvelle']);
  assert.equal(d[0].apres.annule, false);
  assert.equal(d[0].apres.total, 11);
});

// ---- episode en cours : pas de fausse annulation ------------------------------

test('episode en cours : les jours passes comptent, pas de fausse annulation', () => {
  // Alerte lundi : 30 cm sur lundi-mercredi. Mardi, la serie contient encore
  // lundi (past_days) : le cumul ne s'effondre pas.
  assert.deepEqual(types(decider([ep(LU, ME, 30)], [rec(LU, ME, 30)], OPT)), [null]);
});
test('dernier jour revu a zero, neige tombee la veille : ni annulation ni alerte', () => {
  // On est mardi. Annonce lundi-mardi 30 cm ; mardi revu a 0, lundi a donne 28 cm.
  const d = decider([ep(LU, LU, 28)], [rec(LU, MA, 30)], OPT);
  assert.deepEqual(types(d), [null]);
  assert.ok(d[0].apres, 'suivi jusqu\'a la fin de la plage');
});
test('episode alerte termine : oublie sans notification', () => {
  const d = decider([ep('2027-01-09', LU, 30)], [rec('2027-01-09', LU, 30)], OPT);
  assert.deepEqual(types(d), [null]);
  assert.equal(d[0].apres, null);
});
test('episode alerte termine et disparu de la serie : oublie, pas d\'annulation', () => {
  const d = decider([], [rec('2027-01-05', '2027-01-06', 30)], OPT);
  assert.deepEqual(types(d), [null]);
  assert.equal(d[0].apres, null);
});
test('annule termine : oublie', () => {
  const d = decider([], [rec('2027-01-05', '2027-01-06', 30, 2, true)], OPT);
  assert.equal(d[0].apres, null);
});
test('un record qui finit hier mais la neige continue aujourd\'hui : suivi, pas de doublon', () => {
  const d = decider([ep(LU, ME, 25)], [rec(LU, LU, 25)], OPT);
  assert.deepEqual(types(d), ['prolonge']);
});

// ---- scission, fusion, plusieurs episodes ----------------------------------------

test('scission : un morceau tient encore -> ni annulation ni nouvelle alerte', () => {
  const d = decider([ep(ME, ME, 11), ep(VE, VE, 12)], [rec(ME, VE, 25)], OPT);
  assert.deepEqual(types(d), [null]);
});
test('scission : aucun morceau ne tient -> annulation', () => {
  const d = decider([ep(ME, ME, 4), ep(VE, VE, 5)], [rec(ME, VE, 25)], OPT);
  assert.deepEqual(types(d), ['annule']);
});
test('fusion de deux episodes alertes : un seul suivi, alerte de prolongation unique', () => {
  const d = decider([ep(ME, VE, 26)], [rec(ME, ME, 12), rec(VE, VE, 12)], OPT);
  assert.deepEqual(types(d).filter(Boolean), ['hausse']);
  assert.equal(d.filter((x) => x.apres).length, 1);
});
test('deux episodes distincts : deux alertes', () => {
  const d = decider([ep(MA, MA, 11), ep(JE, VE, 12)], [], OPT);
  assert.deepEqual(types(d), ['nouvelle', 'nouvelle']);
});
test('episode alerte + autre episode nouveau : une seule alerte', () => {
  const d = decider([ep(MA, MA, 11), ep(JE, VE, 12)], [rec(MA, MA, 11)], OPT);
  assert.deepEqual(types(d), [null, 'nouvelle']);
});
