// Tests de la selection vent (wind-select.mjs) sur donnees simulees.
// Hors saison, un DRY_RUN reel ne passe par aucune fenetre : ces cas couvrent
// la regle d'affichage du 24/09/2026 et les etages d'alerte.
//
// Configuration FIGEE (CFG ci-dessous), independante de wind/spots.json :
// changer seuil_kn ou un spot ne doit pas faire echouer ces tests (ils
// tournent avant chaque run et bloqueraient les alertes). La coherence de
// spots.json est verifiee a part, en fin de fichier.
//
// Reference : vendredi 14/05/2027 19:00 heure suisse (17:00 UTC), CEST.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fenetre, fenetres, choisirReco, choisirAlerte, dejaEnvoye, local } from '../wind-select.mjs';

const S = (key, court, route_min, secteurs = [[200, 260]]) =>
  ({ key, court, nom: court, route_min, secteurs });
const CFG = {
  seuil_kn: 11, min_heures: 3, horizon_jours: 7,
  saison: { debut: 415, fin: 1015 },
  creneaux: { 6: [9, 18], 0: [9, 18], 2: [8, 13] },
  spot_prioritaire: 'reposoir',
  alertes: {
    pre: { lead_min_h: 34, lead_max_h: 168, marge_kn: 1.5 },
    conf: { lead_min_h: 9, lead_max_h: 34, marge_kn: 0 },
    jour: { lead_min_h: 0.5, lead_max_h: 9, marge_kn: 0 },
  },
  spots: [
    S('cologny', 'Cologny', 15), S('reposoir', 'Reposoir', 12),
    S('vengeron', 'Vengeron', 15), S('coppet', 'Coppet', 20, [[180, 300]]),
    S('nyon', 'Nyon', 25, [[180, 300]]), S('joux', 'Joux', 80, []),
  ],
};
const VEN_19H = new Date('2027-05-14T17:00:00Z');
const BASE_KN = 4;
const DIR_OK = 230;

const cle = (d) => d.toISOString().slice(0, 16).replace(/[-:T]/g, '');

// vent : { [cleSpot]: [{ jour: 'AAAA-MM-JJ', de, a, kn, dir? }] } en heure
// locale. Lignes de -3 h a +9 j (MeteoSuisse livre aussi des heures passees
// et va au-dela de 7 j). trous : cles AAAAMMJJHHMM UTC a retirer.
function prevision(vent, maintenant, trous = []) {
  const parSpot = new Map();
  const t0 = Math.floor(maintenant.getTime() / 36e5) * 36e5;
  for (const spot of CFG.spots) {
    const lignes = [];
    for (let h = -3; h <= 9 * 24; h++) {
      const d = new Date(t0 + h * 36e5);
      const t = local(d);
      const p = (vent[spot.key] || [])
        .find((v) => v.jour === t.iso && t.heure >= v.de && t.heure < v.a);
      const kn = p ? p.kn : BASE_KN;
      if (trous.includes(cle(d))) continue;
      lignes.push({ date: cle(d), kn, rafale: kn * 1.3, q10: kn - 2, dir: p?.dir ?? DIR_OK });
    }
    parSpot.set(spot.key, lignes);
  }
  return parSpot;
}

function classer(vent, { cfg = CFG, biais = new Map(), maintenant = VEN_19H, trous } = {}) {
  const parSpot = prevision(vent, maintenant, trous);
  return cfg.spots.map((spot) => {
    const lignes = parSpot.get(spot.key);
    return { spot, lignes, f: fenetre(lignes, spot, cfg, cfg.seuil_kn, biais, maintenant) };
  }).sort((a, b) => a.spot.route_min - b.spot.route_min);
}
const reco = (vent, o = {}) =>
  choisirReco(classer(vent, o), o.cfg ?? CFG, o.biais ?? new Map(), o.maintenant ?? VEN_19H);

const SAM = '2027-05-15', DIM = '2027-05-16', MAR = '2027-05-18', MER = '2027-05-19';

// ---- regle d'affichage -----------------------------------------------------

test('1. le Reposoir tient -> Reposoir, inverse', () => {
  const r = reco({
    reposoir: [{ jour: SAM, de: 10, a: 14, kn: 14 }],
    coppet: [{ jour: SAM, de: 9, a: 17, kn: 20 }],        // plus vente, plus loin
  });
  assert.equal(r.n, 'Reposoir');
  assert.equal(r.ok, true);
  assert.equal(r.j, SAM);
  assert.equal(r.de, '10:00');
  assert.equal(r.a, '13:00');
  assert.equal(r.kn, 14);
  // fin = samedi 14:00 locale = 12:00 UTC, posterieure au vendredi soir
  assert.equal(r.fin, Date.parse('2027-05-15T12:00:00Z') / 1000);
});

test('1b. spot prioritaire configurable, prioritaire meme s il est plus loin', () => {
  const cfg = { ...CFG, spot_prioritaire: 'coppet' };
  const r = reco({
    reposoir: [{ jour: SAM, de: 10, a: 14, kn: 14 }],
    coppet: [{ jour: DIM, de: 12, a: 15, kn: 12 }],
  }, { cfg });
  assert.equal(r.n, 'Coppet');
  assert.equal(r.ok, true);
});

test('1c. spot prioritaire absent de la config -> regle 2', () => {
  const cfg = { ...CFG, spot_prioritaire: 'inconnu' };
  const r = reco({ coppet: [{ jour: DIM, de: 12, a: 15, kn: 12 }] }, { cfg });
  assert.equal(r.n, 'Coppet');
});

test('2. un autre spot tient -> le plus PROCHE qui tient, pas le plus vente', () => {
  const r = reco({
    reposoir: [{ jour: SAM, de: 9, a: 18, kn: 8 }],
    coppet: [{ jour: DIM, de: 13, a: 17, kn: 12 }],
    nyon: [{ jour: SAM, de: 9, a: 18, kn: 22 }],
  });
  assert.equal(r.n, 'Coppet');
  assert.equal(r.ok, true);
  assert.equal(r.j, DIM);
  assert.equal(r.de, '13:00');
  assert.equal(r.a, '16:00');
});

test('2b. egalite de route_min (Cologny/Vengeron 15) -> ordre de la config', () => {
  const r = reco({
    vengeron: [{ jour: SAM, de: 10, a: 14, kn: 14 }],
    cologny: [{ jour: SAM, de: 10, a: 14, kn: 12 }],
  });
  assert.equal(r.n, 'Cologny');            // premiere des deux dans CFG.spots
});

test('3. seul le mardi tient -> le mardi passe devant un week-end mort', () => {
  const r = reco({
    reposoir: [
      { jour: SAM, de: 9, a: 18, kn: 9 },
      { jour: MER, de: 9, a: 18, kn: 20 },                 // hors creneau
    ],
    vengeron: [{ jour: MAR, de: 8, a: 12, kn: 13 }],
  });
  assert.equal(r.n, 'Vengeron');
  assert.equal(r.ok, true);
  assert.equal(r.j, MAR);
  assert.equal(r.de, '08:00');
  assert.equal(r.a, '11:00');
});

test('4. aucun spot ne tient -> meilleure moyenne, affichage normal', () => {
  const r = reco({
    reposoir: [
      { jour: SAM, de: 14, a: 17, kn: 9 },
      { jour: DIM, de: 10, a: 13, kn: 15, dir: 120 },      // hors secteur
    ],
    nyon: [{ jour: DIM, de: 10, a: 13, kn: 10 }],
    joux: [{ jour: SAM, de: 9, a: 11, kn: 10.5 }],           // 2 h seulement
  });
  assert.equal(r.n, 'Nyon');
  assert.equal(r.ok, false);
  assert.equal(r.j, DIM);
  assert.equal(r.de, '10:00');
  assert.equal(r.a, '12:00');
  assert.equal(r.kn, 10);
});

test('kn corrige du biais, comme l eligibilite', () => {
  // QA : la prevision sous-estime de 2 kn -> 9.6 brut devient 11.6 et tient.
  const biais = new Map([[24, -2]]);
  const r = reco({ reposoir: [{ jour: SAM, de: 10, a: 13, kn: 9.6 }] }, { biais });
  assert.equal(r.n, 'Reposoir');
  assert.equal(r.ok, true);
  assert.equal(r.kn, 12);
});

test('hors saison -> pas de reco', () => {
  const r = reco({ reposoir: [{ jour: '2026-11-14', de: 10, a: 14, kn: 20 }] },
    { maintenant: new Date('2026-11-07T19:00:00Z') });
  assert.equal(r, null);
});

// ---- constats de la revue QA du 2026-11-07 ---------------------------------

test('A. fenetre en cours (sam 11:30, Reposoir 10-14) -> toujours affichee', () => {
  const r = reco({ reposoir: [{ jour: SAM, de: 10, a: 14, kn: 15 }] },
    { maintenant: new Date('2027-05-15T09:30:00Z') });       // 11:30 locale
  assert.equal(r.n, 'Reposoir');
  assert.equal(r.ok, true);
  assert.equal(r.de, '11:00');              // heure en cours incluse, 10-11 finie
  assert.equal(r.fin, Date.parse('2027-05-15T12:00:00Z') / 1000);
  assert.equal(r.kn, 15);
});

test('B. la PROCHAINE fenetre, pas la plus longue', () => {
  // lundi 20:00 : Reposoir tient mardi 8-11 (3 h) et dimanche 9-18 (9 h)
  const r = reco({ reposoir: [
    { jour: MAR, de: 8, a: 11, kn: 13 },
    { jour: '2027-05-23', de: 9, a: 18, kn: 13 },
  ] }, { maintenant: new Date('2027-05-17T18:00:00Z') });
  assert.equal(r.j, MAR);
});

test('C. alerte conf : Reposoir tient demain -> Reposoir, meme s il tient plus longtemps dimanche', () => {
  const maintenant = new Date('2027-05-17T18:00:00Z');       // lundi 20:00
  const cl = classer({
    reposoir: [{ jour: MAR, de: 8, a: 11, kn: 13 }, { jour: '2027-05-23', de: 9, a: 18, kn: 13 }],
    coppet: [{ jour: MAR, de: 8, a: 13, kn: 13 }],
  }, { maintenant });
  const g = choisirAlerte(cl, CFG, CFG.alertes.conf, new Map(), maintenant);
  assert.equal(g.c.spot.key, 'reposoir');
  assert.equal(g.f[0].t.iso, MAR);
  // et la pre-alerte voit bien le dimanche (lead > 34 h)
  const p = choisirAlerte(cl, CFG, CFG.alertes.pre, new Map(), maintenant);
  assert.equal(p.c.spot.key, 'reposoir');
  assert.equal(p.f[0].t.iso, '2027-05-23');
});

test('C2. alerte jour : run en retard dans une fenetre commencee', () => {
  // sam 10:20, fenetre 9-18 : la partie a venir (11-17) fait >= 3 h
  const maintenant = new Date('2027-05-15T08:20:00Z');
  const cl = classer({ reposoir: [{ jour: SAM, de: 9, a: 18, kn: 13 }] }, { maintenant });
  const g = choisirAlerte(cl, CFG, CFG.alertes.jour, new Map(), maintenant);
  assert.equal(g.c.spot.key, 'reposoir');
  assert.equal(g.f[0].t.court, '10:00');     // heure en cours incluse
  assert.ok(g.lead > 0.5 && g.lead < 1);     // partie a venir : 11:00
  // deja alerte a 08:20 avec un debut a 09:00 : meme jour -> pas de rappel
  assert.equal(dejaEnvoye(['jour|reposoir|202705150700'], 'jour', 'reposoir', SAM), true);
  assert.equal(dejaEnvoye(['jour|reposoir|202705150700'], 'conf', 'reposoir', SAM), false);
  assert.equal(dejaEnvoye(['jour|reposoir|202705150700'], 'jour', 'coppet', SAM), false);
  assert.equal(dejaEnvoye(['jour|reposoir|202705150700', 'annul|x|y'], 'jour', 'reposoir', DIM), false);
  // a 16:20, il ne reste que 1 h a venir : plus d'alerte « Aujourd'hui »
  const tard = new Date('2027-05-15T14:20:00Z');
  const cl2 = classer({ reposoir: [{ jour: SAM, de: 9, a: 18, kn: 13 }] }, { maintenant: tard });
  assert.equal(choisirAlerte(cl2, CFG, CFG.alertes.jour, new Map(), tard), null);
});

test('D. horizon_jours respecte : rien au-dela de 7 j', () => {
  // samedi 16/05 ... le dimanche J+8 (2027-05-23 vu depuis le sam 15) est exclu
  const maintenant = new Date('2027-05-15T05:00:00Z');       // sam 07:00
  const r = reco({ reposoir: [{ jour: '2027-05-23', de: 10, a: 14, kn: 15 }] }, { maintenant });
  assert.notEqual(r?.j, '2027-05-23');
  assert.notEqual(r?.ok, true);
});

test('E. heure manquante dans les donnees -> la suite est coupee', () => {
  // 10, (11 absent), 12, 13 : pas 3 h consecutives
  const r = classer({ reposoir: [{ jour: SAM, de: 10, a: 14, kn: 15 }] },
    { trous: ['202705150900'] });                            // 11:00 locale
  const rep = r.find((c) => c.spot.key === 'reposoir');
  assert.equal(rep.f, null);
  assert.equal(fenetres(rep.lignes, rep.spot, CFG, 11, new Map(), VEN_19H).length, 0);
});

// ---- coherence de la config reelle ------------------------------------------

test('spots.json coherent', () => {
  const cfg = JSON.parse(readFileSync(new URL('../wind/spots.json', import.meta.url)));
  assert.ok(cfg.spots.some((s) => s.key === cfg.spot_prioritaire), 'spot_prioritaire inconnu');
  assert.ok(cfg.seuil_kn > 0 && cfg.min_heures >= 1 && cfg.horizon_jours >= 1);
  for (const [j, [a, b]] of Object.entries(cfg.creneaux)) {
    assert.ok(+j >= 0 && +j <= 6 && a >= 0 && a < b && b <= 24, `creneau ${j}`);
  }
  const { pre, conf, jour } = cfg.alertes;
  assert.equal(jour.lead_max_h, conf.lead_min_h, 'tranches jour/conf non contigues');
  assert.equal(conf.lead_max_h, pre.lead_min_h, 'tranches conf/pre non contigues');
  for (const s of cfg.spots) assert.ok(Number.isFinite(s.route_min), s.key);
});
