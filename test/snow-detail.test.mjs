// Page détail neige (saison neige) : détail des jours, mesures ILI2, bulletin d'avalanches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detailJours, mesureStation, avalanche, POUDRE } from '../snow-detail.mjs';

// ---- jours ---------------------------------------------------------------------

const D = ['2026-11-22', '2026-11-23', '2026-11-24'];
function api({ tx = [1, -3, -2], tn = [-2, -6, -7], rain = [5, 0, 0], showers = [1, 0, 0],
  sol = [0, 0, 6 * 3600], raf = [80, 40, 20], iso = null } = {}) {
  const h = { time: [], freezing_level_height: [] };
  for (const d of D) {
    for (let k = 0; k < 24; k++) {
      h.time.push(`${d}T${String(k).padStart(2, '0')}:00`);
      // isotherme : 1500 m la nuit, 2400 m à 12h, 3000 m à 20h (hors heures de ski)
      h.freezing_level_height.push(iso ?? (k === 12 ? 2400 : k === 20 ? 3000 : 1500));
    }
  }
  return { daily: { time: D, temperature_2m_max: tx, temperature_2m_min: tn, rain_sum: rain,
    showers_sum: showers, sunshine_duration: sol, wind_gusts_10m_max: raf }, hourly: h };
}
const jours = D.map((d) => ({ d, cm: 0 }));

test('jours : températures, pluie (rain + showers), soleil en h, rafales, isotherme 9h-16h', () => {
  const [a] = detailJours(api(), D, [20, 30, 0], jours);
  assert.deepEqual(a, { d: '2026-11-22', cm: 0, tn: -2, tx: 1, pl: 6, iso: 2400, raf: 80, sol: 0, p: 0 });
});

test('jours : poudre = neige de la veille, soleil, peu de vent, pas doux', () => {
  const r = detailJours(api(), D, [20, 30, 0], jours);
  assert.equal(r[2].p, 1, '30 cm la veille, 6 h de soleil, 20 km/h, −2 °C');
  assert.equal(r[1].p, 0, 'pas de soleil');
  // Chaque condition manquante l'éteint.
  assert.equal(detailJours(api(), D, [20, POUDRE.cm - 1, 0], jours)[2].p, 0);
  assert.equal(detailJours(api({ raf: [0, 0, POUDRE.rafalesKmh] }), D, [20, 30, 0], jours)[2].p, 0);
  assert.equal(detailJours(api({ tx: [0, 0, POUDRE.tmaxC + 1] }), D, [20, 30, 0], jours)[2].p, 0);
  assert.equal(detailJours(api({ sol: [0, 0, 3 * 3600] }), D, [20, 30, 0], jours)[2].p, 0);
  // Premier jour de la série : pas de veille connue -> pas de poudre.
  assert.equal(detailJours(api({ sol: [6 * 3600, 0, 0], raf: [10, 0, 0], tx: [-5, 0, 0] }), D, [20, 30, 0], jours)[0].p, 0);
  // Seuils réglables.
  assert.equal(detailJours(api(), D, [20, 30, 0], jours, { ...POUDRE, cm: 40 })[2].p, 0);
});

test('jours : valeurs absentes -> null, jamais 0', () => {
  const r = detailJours({ daily: { time: D } }, D, [0, 0, 0], jours);
  assert.deepEqual(r[0], { d: '2026-11-22', cm: 0, tn: null, tx: null, pl: null, iso: null, raf: null, sol: null, p: 0 });
  assert.equal(detailJours(undefined, D, [0, 0, 0], jours)[1].tx, null);
});

// ---- mesures ILI2 --------------------------------------------------------------


const MAINTENANT = new Date('2026-11-21T10:00:00Z');

test('mesures : dernier HS, variation sur 24 h, trois derniers HN publiés', () => {
  const dir = mkdtempSync(join(tmpdir(), 'det-'));
  const f = join(dir, 'hs.csv');
  try {
    writeFileSync(f, 'ts,station,hs,ta\n' +
      '2026-11-20T06:00Z,ILI2,10,-1\n2026-11-20T06:30Z,ILI2,11,-1\n' +
      '2026-11-21T06:30Z,FNH2,140,-5\n' +          // autre station : ignorée
      '2026-11-21T06:00Z,ILI2,38.6,-2.94\n2026-11-21T05:30Z,ILI2,37,-3\n');
    const hn = (jour, cm, run = '2026-11-21T07:00Z', station = 'ILI2') => ({ source: 'mesure', jour, cm, run, station });
    const m = mesureStation({ fichierHs: f, maintenant: MAINTENANT, lignesNeige: [
      hn('2026-11-18', 5), hn('2026-11-19', 2.3), hn('2026-11-20', 30), hn('2026-11-20', 32.3, '2026-11-21T08:00Z'),
      hn('2026-11-21', 21.2), hn('2026-11-21', 99, '2026-11-21T09:00Z', 'FNH2'),
    ] });
    assert.deepEqual(m, { h: Date.parse('2026-11-21T06:00Z') / 1000, hs: 39, d24: 29, ta: -2.9,
      hn: [{ d: '2026-11-19', cm: 2 }, { d: '2026-11-20', cm: 32 }, { d: '2026-11-21', cm: 21 }] });
    // Plus de 48 h : archive d'une autre saison, pas montrée comme actuelle.
    assert.equal(mesureStation({ fichierHs: f, maintenant: new Date('2026-11-23T07:00:00Z') }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mesures : pas de relevé 24 h avant -> d24 null ; fichier absent -> null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'det-'));
  const f = join(dir, 'hs.csv');
  try {
    writeFileSync(f, 'ts,station,hs,ta\n2026-11-21T06:00Z,ILI2,38,\n');
    const m = mesureStation({ fichierHs: f, maintenant: MAINTENANT });
    assert.equal(m.d24, null);
    assert.equal(m.ta, null);
    assert.deepEqual(m.hn, []);
    assert.equal(mesureStation({ fichierHs: join(dir, 'absent.csv') }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- avalanches ------------------------------------------------------------------

const bulletin = (ratings, problems = [], region = 'CH-1312') => ({ bulletins: [
  { regions: [{ regionID: 'CH-9999' }], dangerRatings: [{ mainValue: 'low' }] },
  { regions: [{ regionID: region }], dangerRatings: ratings, avalancheProblems: problems,
    validTime: { startTime: '2026-11-21T07:00:00Z', endTime: '2026-11-21T16:00:00Z' } },
] });

test('avalanches : degré, sous-degré, nom, problèmes avec leur altitude, validité', () => {
  const a = avalanche(bulletin(
    [{ mainValue: 'high', customData: { CH: { subdivision: 'minus' } } }],
    [{ problemType: 'new_snow', elevation: { lowerBound: '2200' } }, { problemType: 'wind_slab' }, { problemType: 'new_snow' }]));
  assert.deepEqual(a, { niveau: 4, sous: '-', nom: 'fort', pb: ['neige fraîche dès 2200 m', 'neige soufflée'],
    debut: Date.parse('2026-11-21T07:00:00Z') / 1000, fin: Date.parse('2026-11-21T16:00:00Z') / 1000 });
});

test('avalanches : le plus haut de la journée, sous-degré − < = < +', () => {
  const a = avalanche(bulletin([{ mainValue: 'moderate', validTimePeriod: 'earlier' },
    { mainValue: 'considerable', validTimePeriod: 'later', customData: { CH: { subdivision: 'neutral' } } }]));
  assert.equal(a.niveau, 3);
  assert.equal(a.sous, '');
  assert.equal(a.nom, 'marqué');
  const b = avalanche(bulletin([{ mainValue: 'considerable', customData: { CH: { subdivision: 'minus' } } },
    { mainValue: 'considerable', customData: { CH: { subdivision: 'neutral' } } }]));
  assert.equal(b.sous, '', '3= l\'emporte sur 3−');
  const c = avalanche(bulletin([{ mainValue: 'considerable', customData: { CH: { subdivision: 'plus' } } },
    { mainValue: 'considerable' }]));
  assert.equal(c.sous, '+');
});

test('avalanches : aucun bulletin -> « vide » ; région absente ou degré inconnu -> null', () => {
  assert.equal(avalanche({ bulletins: [] }), 'vide');
  assert.equal(avalanche({}), 'vide');
  assert.equal(avalanche(bulletin([{ mainValue: 'high' }], [], 'CH-4115')), null);
  assert.equal(avalanche(bulletin([{ mainValue: 'inconnu' }])), null);
});

test('avalanches : lecture réseau, 404 et vide verts, panne et région absente rouges', async () => {
  const { lireAvalanche } = await import('../snow-detail.mjs');
  const rep = (status, body) => async () => new Response(JSON.stringify(body), { status });
  assert.deepEqual(await lireAvalanche(rep(404, {})), { avalanche: null });
  assert.deepEqual(await lireAvalanche(rep(200, { bulletins: [] })), { avalanche: null });
  assert.equal((await lireAvalanche(rep(503, {}))).erreur, 'HTTP 503');
  assert.match((await lireAvalanche(rep(200, bulletin([{ mainValue: 'high' }], [], 'CH-4115')))).erreur, /CH-1312 absente/);
  assert.equal((await lireAvalanche(async () => { throw new Error('ECONNRESET'); })).erreur, 'ECONNRESET');
  assert.equal((await lireAvalanche(rep(200, bulletin([{ mainValue: 'high' }])))).avalanche.niveau, 4);
});

// ---- heure par heure ---------------------------------------------------------------

test('heures : depuis l\'heure en cours, h0 = début de la première heure (étiquette − 1 h)', async () => {
  const { heuresDetail } = await import('../snow-detail.mjs');
  const { neigeHoraire, rapportTemperature } = await import('../snow-conversion.mjs');
  const time = [], precipitation = [], temperature_2m = [], rain = [], showers = [];
  for (let k = 0; k < 96; k++) {
    // étiquettes locales à décalage fixe +1 h (utc_offset_seconds = 3600)
    time.push(new Date(Date.UTC(2026, 10, 21, k)).toISOString().slice(0, 16));
    precipitation.push(k === 14 ? 2 : 0); temperature_2m.push(k === 14 ? -6 : 1.6);
    rain.push(k === 15 ? 1.25 : 0); showers.push(k === 15 ? 0.5 : null);
  }
  const data = { utc_offset_seconds: 3600, hourly: { time, precipitation, temperature_2m, rain, showers } };
  // 12:42 UTC = 13:42 locale : heure en cours 13h-14h locale, étiquette « 14:00 ».
  const r = heuresDetail(data, Date.parse('2026-11-21T12:42:00Z'), neigeHoraire);
  assert.equal(r.h0, Date.parse('2026-11-21T12:00:00Z') / 1000);   // 13:00 locale
  assert.equal(r.cm.length, 60);
  assert.equal(r.cm[0], Math.round(2 * rapportTemperature(-6) * 10) / 10);
  assert.equal(r.pl[1], 1.8);
  assert.equal(r.t[0], -6);
  assert.equal(r.t[1], 2);
  assert.equal(heuresDetail({ ...data, utc_offset_seconds: undefined }, Date.now(), neigeHoraire), null);
  assert.equal(heuresDetail(data, Date.parse('2026-12-30T00:00:00Z'), neigeHoraire), null);
  const trou = heuresDetail({ ...data, hourly: { time, precipitation: precipitation.map((v, k) => (k === 14 ? null : v)), temperature_2m } },
    Date.parse('2026-11-21T12:42:00Z'), neigeHoraire);
  assert.equal(trou.cm[0], null);
  assert.equal(trou.pl[0], null);
});
