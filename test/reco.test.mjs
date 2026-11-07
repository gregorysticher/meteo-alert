// Tests de choisirReco() sur donnees simulees (node --test).
// Hors saison, un DRY_RUN reel ne passe par aucune fenetre : ces cas
// couvrent les 3 niveaux de la regle d'affichage du 24/09/2026.
//
// Reference : vendredi 14/05/2027 19:00 heure suisse (17:00 UTC) — le cas
// ou l'ancien markup declarait « passee » la fenetre du samedi matin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fenetre, choisirReco } from '../wind-select.mjs';

const CFG = JSON.parse(readFileSync(new URL('../wind/spots.json', import.meta.url)));
const MAINTENANT = new Date('2027-05-14T17:00:00Z');
const BASE_KN = 4;
const DIR_OK = 230;              // dans les secteurs de tous les spots

// Heure locale suisse (CEST = UTC+2 en mai) -> cle AAAAMMJJHHMM UTC.
const cle = (d) => d.toISOString().slice(0, 16).replace(/[-:T]/g, '');

// vent : { [cleSpot]: [{ jour: 'AAAA-MM-JJ', de, a, kn, dir? }] } en heure locale.
function prevision(vent, maintenant) {
  const parSpot = new Map();
  for (const spot of CFG.spots) {
    const lignes = [];
    for (let h = 1; h <= 7 * 24; h++) {
      const d = new Date(maintenant.getTime() + h * 36e5);
      const loc = new Date(d.getTime() + 2 * 36e5);   // CEST (approx. hors mai)
      const jour = loc.toISOString().slice(0, 10);
      const heure = loc.getUTCHours();
      const p = (vent[spot.key] || [])
        .find((v) => v.jour === jour && heure >= v.de && heure < v.a);
      const kn = p ? p.kn : BASE_KN;
      lignes.push({ date: cle(d), kn, rafale: kn * 1.3, q10: kn - 2,
        dir: p?.dir ?? DIR_OK });
    }
    parSpot.set(spot.key, lignes);
  }
  return parSpot;
}

function reco(vent, { cfg = CFG, biais = new Map(), maintenant = MAINTENANT } = {}) {
  const parSpot = prevision(vent, maintenant);
  const classement = cfg.spots.map((spot) => {
    const lignes = parSpot.get(spot.key);
    return { spot, lignes,
      f: fenetre(lignes, spot, cfg, cfg.seuil_kn, biais, maintenant) };
  }).sort((a, b) => a.spot.route_min - b.spot.route_min);
  return choisirReco(classement, cfg, biais, maintenant);
}

const SAM = '2027-05-15', DIM = '2027-05-16', MAR = '2027-05-18', MER = '2027-05-19';

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
  // fin = samedi 14:00 locale = 12:00 UTC, posterieure a « maintenant »
  assert.equal(r.fin, Date.parse('2027-05-15T12:00:00Z') / 1000);
  assert.ok(r.fin > MAINTENANT.getTime() / 1000);
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
