// Règles de l'alerte neige annoncée (spec B4.3) sur des épisodes simulés, dont
// les séquences trouvées par la revue QA du 08/11/2026.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { episodes, decider, duree, ecranNeige } from '../snow-episodes.mjs';

const OPT = { jour: '2027-01-12', seuil: 10, hausse: 5, marge: 2, prolongeMin: 2, memoire: 7 };
const SA = '2027-01-09', DI = '2027-01-10', LU = '2027-01-11', MA = '2027-01-12',
  ME = '2027-01-13', JE = '2027-01-14', VE = '2027-01-15', SA2 = '2027-01-16';
const CAL = [SA, DI, LU, MA, ME, JE, VE, SA2];

// ep(ME, [7, 5]) : jours consecutifs a partir de ME.
function ep(debut, valeurs) {
  const i = CAL.indexOf(debut);
  const jours = valeurs.map((v, k) => ({ d: CAL[i + k], v }));
  return { debut, fin: jours.at(-1).d, total: valeurs.reduce((a, b) => a + b, 0), jours };
}
const rec = (debut, fin, total, annule = false) =>
  ({ debut, fin, total, duree: duree({ debut, fin }), annule });
const types = (ds) => ds.map((d) => d.type);

// ---- episodes() ------------------------------------------------------------

test('episodes : jours consecutifs, traces ignorees, valeurs invalides coupent', () => {
  const e = episodes([LU, MA, ME, JE, VE], [5, 7, 0.5, 12, null], { minJour: 1 });
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
  const d = decider([ep(ME, [7, 5])], [], OPT);
  assert.deepEqual(types(d), ['nouvelle']);
  assert.deepEqual(d[0].apres, rec(ME, JE, 12));
});
test('rien sous le seuil ; seuil exact : alerte', () => {
  assert.deepEqual(decider([ep(ME, [5, 4.9])], [], OPT), []);
  assert.deepEqual(types(decider([ep(ME, [10])], [], OPT)), ['nouvelle']);
});
test('episode deja fini, jamais alerte : pas d\'alerte', () => {
  assert.deepEqual(decider([ep(LU, [30])], [], OPT), []);
});
test('QA 2 : neige deja tombee + trace aujourd\'hui -> pas de « neige annoncee »', () => {
  assert.deepEqual(decider([ep(DI, [20, 0.5, 1.2])], [], OPT), []);
  assert.deepEqual(decider([ep(LU, [30, 1])], [], OPT), []);
});
test('neige tombee + vraie chute a venir -> nouvelle', () => {
  assert.deepEqual(types(decider([ep(LU, [5, 6])], [], OPT)), ['nouvelle']);
});
test('QA 2 : episode alerte et fini reste suivi : la trace du lendemain ne realerte pas', () => {
  // Alerte vendredi-samedi, fini hier ; 1,2 cm aujourd'hui colle a la veille.
  const d = decider([ep(DI, [10, 10, 1.2])], [rec(DI, LU, 20)], OPT);
  assert.deepEqual(types(d), [null]);
  assert.ok(d[0].apres, 'toujours suivi');
});

// ---- hausse ----------------------------------------------------------------

test('hausse : +4 cm -> rien ; +5 cm -> alerte, nouvelle reference', () => {
  const r = rec(ME, JE, 12);
  assert.deepEqual(types(decider([ep(ME, [8, 8])], [r], OPT)), [null]);
  const d = decider([ep(ME, [9, 8])], [r], OPT);
  assert.deepEqual(types(d), ['hausse']);
  assert.equal(d[0].apres.total, 17);
});
test('hausse : reference = derniere alerte, pas le dernier run (montee lente)', () => {
  let r = rec(ME, JE, 12);
  for (const total of [13, 14, 15, 16]) {
    const d = decider([ep(ME, [total - 5, 5])], [r], OPT);
    assert.deepEqual(types(d), [null]);
    r = d[0].apres;
  }
  assert.deepEqual(types(decider([ep(ME, [12, 5])], [r], OPT)), ['hausse']);
});
test('baisse puis remontee sous la reference : rien', () => {
  const r = rec(ME, JE, 30);
  assert.deepEqual(types(decider([ep(ME, [10, 10])], [r], OPT)), [null]);
  assert.deepEqual(types(decider([ep(ME, [14, 13])], [r], OPT)), [null]);
});
test('seuil de hausse parametrable', () => {
  const d = decider([ep(ME, [8, 7])], [rec(ME, JE, 12)], { ...OPT, hausse: 3 });
  assert.deepEqual(types(d), ['hausse']);
});
test('hausse due au passe seul : rien', () => {
  // Le modele revise hier a la hausse, plus rien a venir.
  assert.deepEqual(types(decider([ep(DI, [10, 10])], [rec(DI, LU, 12)], OPT)), [null]);
});

// ---- prolonge --------------------------------------------------------------

test('prolonge : un jour de plus avec de la vraie neige -> alerte', () => {
  const d = decider([ep(ME, [7, 5, 2])], [rec(ME, JE, 12)], OPT);
  assert.deepEqual(types(d), ['prolonge']);
  assert.equal(d[0].apres.duree, 3);
});
test('prolonge : debut avance -> alerte', () => {
  assert.deepEqual(types(decider([ep(MA, [3, 7, 5])], [rec(ME, JE, 12)], OPT)), ['prolonge']);
});
test('QA 5 : queue de traces a l\'horizon -> rien', () => {
  assert.deepEqual(types(decider([ep(ME, [7, 5, 1.1])], [rec(ME, JE, 12)], OPT)), [null]);
});
test('QA 5 : les traces s\'accumulent : alerte quand elles atteignent le minimum', () => {
  const r = rec(ME, JE, 12);
  assert.deepEqual(types(decider([ep(ME, [7, 5, 1.1, 1.1])], [r], OPT)), ['prolonge']);
});
test('QA 5 : la veille revisee de 0,8 a 1,2 cm n\'est pas une prolongation', () => {
  const d = decider([ep(LU, [1.2, 7, 5])], [rec(MA, ME, 12)], OPT);
  assert.deepEqual(types(d), [null]);
});
test('jour passe de 3 cm ajoute par revision : pas une prolongation', () => {
  assert.deepEqual(types(decider([ep(LU, [3, 7, 5])], [rec(MA, ME, 12)], OPT)), [null]);
});
test('hausse superieure au seuil : la nouvelle se juge sur le seuil', () => {
  assert.deepEqual(types(decider([ep(ME, [12])], [], { ...OPT, hausse: 15 })), ['nouvelle']);
});
test('decale sans s\'allonger : rien, la plage annoncee ne bouge pas', () => {
  const d = decider([ep(JE, [7, 5])], [rec(ME, JE, 12)], OPT);
  assert.deepEqual(types(d), [null]);
  assert.deepEqual([d[0].apres.debut, d[0].apres.fin], [ME, JE]);
});
test('raccourci puis rallonge a la duree deja annoncee : rien', () => {
  const r = rec(ME, JE, 12);
  const r1 = decider([ep(ME, [11])], [r], OPT)[0].apres;
  assert.deepEqual(types(decider([ep(ME, [7, 5])], [r1], OPT)), [null]);
});
test('hausse ET prolongation : une seule alerte', () => {
  assert.deepEqual(types(decider([ep(ME, [10, 10, 5])], [rec(ME, JE, 12)], OPT)), ['hausse']);
});

// ---- annule ----------------------------------------------------------------

test('annule : sous le seuil moins la marge -> annulation, une seule fois', () => {
  const d = decider([ep(ME, [4, 3])], [rec(ME, JE, 12)], OPT);
  assert.deepEqual(types(d), ['annule']);
  assert.equal(d[0].apres.annule, true);
  assert.deepEqual(types(decider([ep(ME, [4, 3])], [d[0].apres], OPT)), [null]);
});
test('QA 4b : oscillation autour du seuil -> une seule alerte, aucune annulation', () => {
  let etat = [];
  const vus = [];
  for (const [a, b] of [[6, 5], [5, 4.5], [6, 5], [5, 4.5]]) {
    const d = decider([ep(ME, [a, b])], etat, OPT);
    vus.push(...types(d).filter(Boolean));
    etat = d.map((x) => x.apres).filter(Boolean);
  }
  assert.deepEqual(vus, ['nouvelle']);
});
test('marge a 0 : annulation des le passage sous le seuil', () => {
  assert.deepEqual(types(decider([ep(ME, [5, 4.5])], [rec(ME, JE, 12)], { ...OPT, marge: 0 })), ['annule']);
});
test('annule : l\'episode disparait de la prevision -> annulation', () => {
  assert.deepEqual(types(decider([], [rec(ME, JE, 12)], OPT)), ['annule']);
});
test('annule : annonce commencee hier, rien n\'est tombe, plus rien de prevu -> annulation', () => {
  assert.deepEqual(types(decider([], [rec(LU, ME, 12)], OPT)), ['annule']);
});
test('annule puis repasse au seuil -> nouvelle, reference remise a zero', () => {
  const d = decider([ep(ME, [6, 5])], [rec(ME, JE, 12, true)], OPT);
  assert.deepEqual(types(d), ['nouvelle']);
  assert.equal(d[0].apres.annule, false);
  assert.equal(d[0].apres.total, 11);
});
test('annule : repasse entre seuil - marge et seuil -> reste annule, muet', () => {
  assert.deepEqual(types(decider([ep(ME, [5, 4])], [rec(ME, JE, 12, true)], OPT)), [null]);
});
test('CV A : effondrement avec un jour de plus -> annulation, pas de prolongation', () => {
  assert.deepEqual(types(decider([ep(ME, [1, 1.5])], [rec(ME, ME, 15)], OPT)), ['annule']);
  assert.deepEqual(types(decider([ep(ME, [1, 3])], [rec(ME, ME, 15)], OPT)), ['annule']);
  assert.deepEqual(types(decider([ep(ME, [8, 6])], [rec(ME, ME, 15)], OPT)), ['prolonge']);
});
test('CV B : une trace tombee ne bloque pas l\'annulation d\'une chute a venir', () => {
  assert.deepEqual(types(decider([ep(LU, [1.2, 1.1, 2])], [rec(LU, ME, 17)], OPT)), ['annule']);
});
test('QA 4a : neige en cours sous le seuil -> jamais d\'annulation', () => {
  // Alerte 12 cm (8+4). 6 cm tombes hier, 1 cm prevu : 7 cm tombent bel et bien.
  assert.deepEqual(types(decider([ep(LU, [6, 1])], [rec(LU, MA, 12)], OPT)), [null]);
});
test('QA 4f : episode plus long que past_days : debut sorti de la serie, pas d\'annulation', () => {
  assert.deepEqual(types(decider([ep(SA, [3, 3])], [rec('2027-01-01', LU, 40)], { ...OPT, jour: DI })), [null]);
});
test('QA 4e : valeur inconnue dans la plage annoncee -> pas d\'annulation a l\'aveugle', () => {
  const opts = { ...OPT, inconnus: new Set([ME]) };
  assert.deepEqual(types(decider([ep(JE, [2])], [rec(ME, JE, 12)], opts)), [null]);
  assert.deepEqual(types(decider([ep(JE, [2])], [rec(ME, JE, 12)], OPT)), ['annule']);
});

// ---- decale ----------------------------------------------------------------

test('QA 4d : annonce deplacee sans chevauchement -> un seul message', () => {
  const d = decider([ep(VE, [7, 5])], [rec(ME, JE, 12)], OPT);
  assert.deepEqual(types(d), ['decale']);
  assert.deepEqual([d[0].record.debut, d[0].episode.debut], [ME, VE]);
  assert.deepEqual([d[0].apres.debut, d[0].apres.fin, d[0].apres.annule], [VE, SA2, false]);
});

// ---- episode en cours ou fini --------------------------------------------------

test('episode en cours : les jours passes comptent, pas de fausse annulation', () => {
  assert.deepEqual(types(decider([ep(LU, [10, 10, 10])], [rec(LU, ME, 30)], OPT)), [null]);
});
test('dernier jour revu a zero, neige tombee la veille : ni annulation ni alerte', () => {
  const d = decider([ep(LU, [28])], [rec(LU, MA, 30)], OPT);
  assert.deepEqual(types(d), [null]);
  assert.ok(d[0].apres);
});
test('episode fini : suivi tant que ses jours sont dans la serie, puis oublie', () => {
  assert.ok(decider([ep(SA, [30])], [rec(SA, SA, 30)], OPT)[0].apres);
  const d = decider([], [rec('2027-01-04', '2027-01-04', 30)], OPT);
  assert.deepEqual(types(d), [null]);
  assert.equal(d[0].apres, null);
});
test('annule termine : oublie a la meme echeance, sans message', () => {
  const d = decider([], [rec('2027-01-04', '2027-01-04', 30, true)], OPT);
  assert.deepEqual(types(d), [null]);
  assert.equal(d[0].apres, null);
});

// ---- scission, seconde chute, fusion ---------------------------------------------

test('scission : cumul inchange -> rien', () => {
  assert.deepEqual(types(decider([ep(ME, [11]), ep(VE, [12])], [rec(ME, VE, 25)], OPT)), [null]);
});
test('QA 4c : scission sur 0,2 cm d\'un episode a seuil eleve -> rien', () => {
  const o = { ...OPT, seuil: 20 };
  assert.deepEqual(types(decider([ep(ME, [12]), ep(VE, [12])], [rec(ME, VE, 25.1)], o)), [null]);
});
test('scission : cumul d\'ensemble sous le seuil -> annulation', () => {
  assert.deepEqual(types(decider([ep(ME, [3]), ep(VE, [4])], [rec(ME, VE, 25)], OPT)), ['annule']);
});
test('QA 3 : seconde chute dans la plage annoncee -> alerte, pas de silence', () => {
  // On est mardi. Record lundi-jeudi 16 cm, 14 tombes lundi, mardi sec, 13,5 jeudi.
  const d = decider([ep(LU, [14]), ep(JE, [13.5])], [rec(LU, JE, 16)], OPT);
  assert.deepEqual(types(d), ['hausse']);
});
test('fusion de deux episodes alertes : un seul suivi, une seule alerte', () => {
  const d = decider([ep(ME, [10, 6, 10])], [rec(ME, ME, 12), rec(VE, VE, 12)], OPT);
  assert.deepEqual(types(d).filter(Boolean), ['hausse']);
  assert.equal(d.filter((x) => x.apres).length, 1);
});
test('deux episodes distincts : deux alertes', () => {
  assert.deepEqual(types(decider([ep(MA, [11]), ep(JE, [7, 5])], [], OPT)), ['nouvelle', 'nouvelle']);
});
test('episode alerte + autre episode nouveau : une seule alerte', () => {
  assert.deepEqual(types(decider([ep(MA, [11]), ep(JE, [7, 5])], [rec(MA, MA, 11)], OPT)), [null, 'nouvelle']);
});

// ---- ecran (B4.2) --------------------------------------------------------------

const ECRAN = { jour: MA, seuil: 10, hausse: 5, minAffichage: 5 };
const serie = (eps) => {
  const v = Object.fromEntries(eps.flatMap((e) => e.jours.map((j) => [j.d, j.v])));
  return [CAL, CAL.map((d) => v[d] ?? 0)];
};
const ecran = (eps, records = [], o = ECRAN) =>
  ecranNeige(eps, ...serie(eps), decider(eps, records, OPT), o);

test('ecran : episode 6+9+8 -> 23 cm, plage, inverse', () => {
  const e = ecran([ep(ME, [6, 9, 8])]);
  assert.deepEqual(e.episode, { cm: 23, de: ME, a: VE, ok: true });
  assert.deepEqual([e.jour, e.j5, e.j0, e.min], [MA, 23, 0, 5]);
  assert.deepEqual(e.jours.slice(0, 3), [{ d: MA, cm: 0 }, { d: ME, cm: 6 }, { d: JE, cm: 9 }]);
});
test('ecran : le cumul compte les jours passes', () => {
  assert.equal(ecran([ep(LU, [5, 6])]).episode.cm, 11);
});
test('ecran : le jour meme compte dans j0', () => {
  assert.equal(ecran([ep(MA, [7, 8])]).j0, 7);
});
test('ecran : episode d\'alerte prioritaire sur une petite chute plus proche', () => {
  assert.deepEqual(ecran([ep(MA, [6]), ep(JE, [7, 5])]).episode, { cm: 12, de: JE, a: VE, ok: true });
});
test('ecran : deux episodes au seuil -> le plus proche', () => {
  assert.equal(ecran([ep(MA, [11]), ep(JE, [7, 5])]).episode.de, MA);
});
test('ecran : deux petites chutes -> la plus proche', () => {
  assert.equal(ecran([ep(MA, [6]), ep(JE, [7])]).episode.de, MA);
});
test('ecran : sous le seuil mais au moins 5 cm a venir -> sans inversion', () => {
  assert.deepEqual(ecran([ep(ME, [6])]).episode, { cm: 6, de: ME, a: ME, ok: false });
});
test('ecran : traces -> aucun episode', () => {
  assert.equal(ecran([ep(ME, [2, 2])]).episode, null);
  assert.equal(ecran([]).episode, null);
});
test('ecran : neige tombee + trace -> pas annoncee ; episode fini ignore ; passe hors j5', () => {
  const e = ecran([ep(DI, [20, 0.5, 1.2])]);
  assert.equal(e.episode, null);
  assert.equal(e.j5, 1);
  assert.equal(ecran([ep(LU, [30])]).episode, null);
});
test('CV R1 : l\'episode du jour fini a minuit, le suivant reste dans la liste', () => {
  const e = ecran([ep(MA, [12]), ep(JE, [40])], [rec(MA, MA, 12), rec(JE, JE, 40)]);
  assert.deepEqual(e.episodes.map((x) => [x.de, x.cm]), [[MA, 12], [JE, 40]]);
});
test('CV R1 : neige surtout tombee, grosse chute a venir -> la grosse chute d\'abord', () => {
  const e = ecran([ep(LU, [11, 1]), ep(JE, [40])], [rec(LU, MA, 12)]);
  assert.equal(e.episode.cm, 40);
  assert.equal(e.episodes[1].cm, 12);
});
test('ecran : episode suivi mais fini -> plus montre', () => {
  assert.equal(ecran([ep(DI, [20])], [rec(DI, DI, 20)]).episode, null);
});
test('ecran : un episode dans la plage d\'une annonce n\'est pas compte deux fois', () => {
  const e = ecran([ep(ME, [9]), ep(VE, [9])], [rec(ME, VE, 12)]);
  assert.equal(e.episodes.length, 1);
  assert.equal(e.episode.cm, 18);
});
test('ecran : valeurs nulles sans effet sur les totaux', () => {
  const e = ecranNeige([], [MA, ME], [null, 3], [], ECRAN);
  assert.deepEqual([e.j0, e.j5], [0, 3]);
});
test('ecran : j5 ne depasse pas la saison', () => {
  const e = ecranNeige([], [MA, ME], [1, 30], [], { ...ECRAN, retenir: (d) => d !== ME });
  assert.equal(e.j5, 1);
});

// L'ecran montre le chiffre que vient d'annoncer l'alerte.
const memeChiffre = (eps, records) => {
  const d = decider(eps, records, OPT).find((x) => x.type);
  const e = ecran(eps, records).episode;
  assert.equal(e.cm, Math.round(d.episode.total), d.type);
  assert.equal(e.ok, true, d.type);
  return d.type;
};
test('alerte et ecran : meme chiffre, nouvelle', () => {
  assert.equal(memeChiffre([ep(ME, [6.4, 9.3])], []), 'nouvelle');
});
test('alerte et ecran : meme chiffre, hausse sur episode scinde', () => {
  assert.equal(memeChiffre([ep(ME, [9]), ep(VE, [9])], [rec(ME, VE, 12)]), 'hausse');
});
test('alerte et ecran : meme chiffre, annule qui redevient nouvelle, scinde', () => {
  assert.equal(memeChiffre([ep(ME, [6]), ep(VE, [6])], [rec(ME, VE, 12, true)]), 'nouvelle');
});
test('alerte et ecran : meme chiffre, prolongation avec peu a venir', () => {
  assert.equal(memeChiffre([ep(LU, [11, 1, 2])], [rec(LU, MA, 12)]), 'prolonge');
});
test('alerte et ecran : meme chiffre, annonce decalee', () => {
  assert.equal(memeChiffre([ep(VE, [7, 5])], [rec(ME, JE, 12)]), 'decale');
});
test('episode suivi sans message : cumul courant, inverse ; dans la marge : sans inversion', () => {
  assert.deepEqual(ecran([ep(ME, [8, 6])], [rec(ME, JE, 12)]).episode, { cm: 14, de: ME, a: JE, ok: true });
  assert.deepEqual(ecran([ep(ME, [5, 4])], [rec(ME, JE, 12)]).episode, { cm: 9, de: ME, a: JE, ok: false });
});
test('episode annule : plus inverse, et plus du tout sous les 5 cm a venir', () => {
  assert.equal(ecran([ep(ME, [2, 1])], [rec(ME, JE, 12)]).episode, null);
});
test('deuxieme episode nouveau : l\'ecran garde le plus proche, deja annonce', () => {
  const e = ecran([ep(MA, [12]), ep(JE, [15])], [rec(MA, MA, 12)]);
  assert.deepEqual(e.episode, { cm: 12, de: MA, a: MA, ok: true });
});
