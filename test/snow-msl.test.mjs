// snow-msl.mjs (D-008, Décision 1) : prévision MeteoSuisse Planachaux convertie D-005,
// par jour civil et par fenêtre du relevé 7h → 7h.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choisirRun, trouverPoint, valeursPoint, heuresMsl, heuresIcon, cumuls } from '../snow-msl.mjs';
import { neigeHoraire, partNeige } from '../snow-conversion.mjs';

test('run : le plus récent qui a les deux paramètres', () => {
  const n = (r, p) => `vnut12.lssw.${r}.${p}.csv`;
  assert.equal(choisirRun([n('202611240400', 'rre150h0'), n('202611240400', 'tre200h0'),
    n('202611240500', 'rre150h0'), 'autre.csv']), '202611240400');
  assert.equal(choisirRun([n('202611240500', 'rre150h0')]), null);
});

test('point : WNSPLA, station (type 1), altitude lue', () => {
  const csv = 'point_id;point_type_id;station_abbr;point_height_masl\n7;2;WNSPLA;1000\n19999;1;WNSPLA;1943.0\n';
  assert.deepEqual(trouverPoint(csv), { id: '19999', alt: 1943 });
  assert.equal(trouverPoint('point_id;point_type_id;station_abbr;point_height_masl\n'), null);
});

test('valeurs : un seul point, colonne vérifiée', () => {
  const csv = 'point_id;point_type_id;Date;rre150h0\n19999;1;202611240100;0.4\n1;1;202611240100;9\n19999;1;202611240200;\n';
  assert.deepEqual([...valeursPoint(csv, 'rre150h0', '19999')], [['202611240100', 0.4]]);
  assert.throws(() => valeursPoint(csv, 'tre200h0', '19999'), /colonne tre200h0 absente/);
});

// Série MeteoSuisse : valeur datée de la fin de l'heure, en UTC.
const serie = (debutIso, n, f) => {
  const m = new Map();
  for (let i = 0; i < n; i++) {
    const fin = new Date(Date.parse(debutIso) + (i + 1) * 36e5);
    m.set(fin.toISOString().replace(/[-:T]/g, '').slice(0, 12), f(i, fin));
  }
  return m;
};

test('heures : début de l\'heure en heure suisse, température ramenée à 2022 m', () => {
  const pr = serie('2026-11-22T23:00:00Z', 2, () => 2);
  const te = serie('2026-11-22T23:00:00Z', 2, () => -2);
  const h = heuresMsl(pr, te, { altPoint: 1943, alt: 2022 });
  assert.deepEqual(h.map((x) => [x.jour, x.h]), [['2026-11-23', 0], ['2026-11-23', 1]]);
  const t = -2 - 0.0065 * 79;
  assert.ok(Math.abs(h[0].t - t) < 1e-9);
  assert.ok(Math.abs(h[0].cm - neigeHoraire(2, t)) < 1e-9);
  assert.ok(Math.abs(h[0].pluie - 2 * (1 - partNeige(t))) < 1e-9);
});

test('cumuls : jour civil et fenêtre 7h → 7h complets seulement', () => {
  // 48 heures depuis le 22.11 à 7h locales (06:00 UTC), 1 mm/h.
  const pr = serie('2026-11-22T06:00:00Z', 48, () => 1);
  const te = serie('2026-11-22T06:00:00Z', 48, () => -10);
  const h = heuresMsl(pr, te, { altPoint: 2022, alt: 2022 });
  const f = cumuls(h, 7);
  assert.deepEqual(f.map((x) => [x.jour, x.mm]), [['2026-11-22', 24], ['2026-11-23', 24]]);
  // Civil : le 22 commence à 7h (incomplet), le 24 finit à 6h (incomplet) : seul le 23.
  assert.deepEqual(cumuls(h, 0).map((x) => [x.jour, x.mm, x.tMoy]), [['2026-11-23', 24, -10]]);
  // Une heure manquante rend sa fenêtre incomplète, jamais 0.
  pr.delete([...pr.keys()][30]);
  assert.deepEqual(cumuls(heuresMsl(pr, te, { altPoint: 2022, alt: 2022 }), 7).map((x) => x.jour), ['2026-11-22']);
});

test('cumuls : changement d\'heure (nuit du 24 au 25.10.2026, 25 heures) accepté', () => {
  const pr = serie('2026-10-24T05:00:00Z', 26, () => 1);   // 7h CEST le 24 → 7h CET le 25
  const te = serie('2026-10-24T05:00:00Z', 26, () => -10);
  const f = cumuls(heuresMsl(pr, te, { altPoint: 2022, alt: 2022 }), 7);
  assert.deepEqual(f.map((x) => [x.jour, x.mm]), [['2026-10-24', 25]]);
});

test('ICON : étiquette = fin de l\'heure ; fenêtre 7h → 7h = étiquettes 08:00 à 07:00', () => {
  const time = [], precipitation = [], temperature_2m = [];
  for (let i = 0; i < 48; i++) {
    const d = new Date(Date.parse('2026-11-22T01:00:00Z') + i * 36e5).toISOString().slice(0, 16);
    time.push(d);
    // Neige seulement l'heure 07:00-08:00 du 22 (étiquette 08:00) et 06:00-07:00 du 23 (07:00).
    precipitation.push(d === '2026-11-22T08:00' || d === '2026-11-23T07:00' ? 1 : 0);
    temperature_2m.push(-10);
  }
  const f = cumuls(heuresIcon({ time, precipitation, temperature_2m }), 7);
  assert.equal(f[0].jour, '2026-11-22');
  assert.equal(f[0].mm, 2);
});

test('valeurs : ligne tronquée du point ignorée, pas d\'erreur', () => {
  const csv = 'point_id;point_type_id;Date;rre150h0\n19999;1;202611240100;0.4\n19999;1\n';
  assert.deepEqual([...valeursPoint(csv, 'rre150h0', '19999')], [['202611240100', 0.4]]);
});

test('ICON avec utc_offset_seconds : heure de Genève réelle, même après un changement d\'heure', () => {
  // Réponse émise en été (décalage fixe +2 h) pour le 26.10, déjà en heure d'hiver (+1 h).
  const hourly = { time: ['2026-10-26T09:00'], precipitation: [1], temperature_2m: [-10] };
  const [x] = heuresIcon(hourly, undefined, 7200);
  assert.equal(new Date(x.debut).toISOString(), '2026-10-26T06:00:00.000Z');
  assert.deepEqual([x.jour, x.h], ['2026-10-26', 7]);
  const [nu] = heuresIcon(hourly);
  assert.deepEqual([nu.jour, nu.h], ['2026-10-26', 8], 'sans décalage : heure nue');
});
