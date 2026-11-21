// Conversion pluie-neige selon la température (D-005) : module seul, puis le script
// d'alerte complet sur fetch simulé (même harnais que snow.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  partNeige, neigeHoraire, neigeJournaliere, rapportTemperature, TEMP_NEIGE_C, TEMP_PLUIE_C,
} from '../snow-conversion.mjs';
import { journaliserPrevision, journaliserMesures, lire } from '../snow-qa.mjs';

const proche = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

// ---- module ---------------------------------------------------------------------

test('bornes par défaut : −5 / +5 °C (calage du 21.11.2026)', () => {
  assert.equal(TEMP_NEIGE_C, -5);
  assert.equal(TEMP_PLUIE_C, 5);
});

test('part neige : 1 sous la borne basse, 0 au-dessus de la haute, linéaire entre', () => {
  assert.equal(partNeige(-10), 1);
  assert.equal(partNeige(-5), 1);
  proche(partNeige(0), 0.5);
  proche(partNeige(2.5), 0.25);
  assert.equal(partNeige(5), 0);
  assert.equal(partNeige(12), 0);
  proche(partNeige(1, { neige: 0, pluie: 2 }), 0.5);
});

test('neige horaire : mm × part × Hedstrom et Pomeroy ; pluie chaude = 0', () => {
  proche(neigeHoraire(10, -5), 10 * rapportTemperature(-5));   // 13,3 cm
  proche(neigeHoraire(10, 0), 10 * 0.5 * rapportTemperature(0)); // 4,2 cm
  assert.equal(neigeHoraire(30, 6), 0);
  assert.equal(neigeHoraire(0, -10), 0);
});

const heures = (jour, n, mm, t) => Array.from({ length: n }, (_, k) => ({
  time: `${jour}T${String(k).padStart(2, '0')}:00`, mm: typeof mm === 'function' ? mm(k) : mm, t,
}));
const horaire = (lignes) => ({
  time: lignes.map((l) => l.time), precipitation: lignes.map((l) => l.mm),
  temperature_2m: lignes.map((l) => l.t),
});

test('journalier : somme des heures 00:00 à 23:00 du jour local', () => {
  const h = horaire([...heures('2026-11-20', 24, 1, -5), ...heures('2026-11-21', 24, 2, 6)]);
  const [a, b] = neigeJournaliere(h, ['2026-11-20', '2026-11-21']);
  proche(a, Math.round(24 * rapportTemperature(-5) * 100) / 100);
  assert.equal(b, 0, 'pluie à +6 °C');
});

test('journalier : heure manquante, nulle ou négative -> jour inconnu (null), jamais 0', () => {
  const dates = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'];
  const h = horaire([
    ...heures('2026-11-20', 22, 0, -5),                               // 22 h : incomplet
    ...heures('2026-11-21', 24, (k) => (k === 5 ? null : 0), -5),     // une valeur nulle
    ...heures('2026-11-22', 24, (k) => (k === 5 ? -1 : 0), -5),       // négative
  ]);
  assert.deepEqual(neigeJournaliere(h, dates), [null, null, null, null]);
  assert.deepEqual(neigeJournaliere(undefined, dates), [null, null, null, null]);
});

test('journalier : 24 heures exigées (Open-Meteo : décalage fixe, même au changement d\'heure)', () => {
  const h = horaire([...heures('2026-03-29', 23, 0, -5), ...heures('2026-10-25', 25, 0, -5),
    ...heures('2026-11-01', 24, 0, -5)]);
  assert.deepEqual(neigeJournaliere(h, ['2026-03-29', '2026-10-25', '2026-11-01']), [null, null, 0]);
});

// ---- journal : en-tête d'avant D-005 complété, lignes gardées --------------------

test('journal : fichier à 11 colonnes -> en-tête cm_fixe ajouté, anciennes lignes = 0,7 fixe', () => {
  const dir = mkdtempSync(join(tmpdir(), 'conv-'));
  const fichier = join(dir, 'neige.csv');
  try {
    writeFileSync(fichier, 'run,source,jour,cm,echeance_j,modele,mm,pluie_mm,t_moy,station,hs\n' +
      '2026-11-14T04:24Z,prev,2026-11-15,12,1,icon,17,0,-2,,\n');
    journaliserPrevision('2026-11-20', ['2026-11-21'], [4.2], {
      fichier, maintenant: new Date('2026-11-20T05:00:00Z'), annexes: { cmFixe: [7] } });
    journaliserMesures([{ jour: '2026-11-21', cm: 3, station: 'ILI2' }], { fichier });
    const texte = readFileSync(fichier, 'utf8');
    assert.ok(texte.startsWith('run,source,jour,cm,echeance_j,modele,mm,pluie_mm,t_moy,station,hs,cm_fixe\n'));
    assert.match(texte, /\n2026-11-14T04:24Z,prev,2026-11-15,12,1,icon,17,0,-2,,\n/);
    const l = lire(fichier);
    assert.equal(l[0].cmFixe, 12, 'avant D-005, cm était le 0,7 fixe');
    assert.equal(l[1].cm, 4.2);
    assert.equal(l[1].cmFixe, 7);
    assert.equal(l[2].source, 'mesure');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- script complet ------------------------------------------------------------

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOCK = join(RACINE, 'test', 'helpers', 'mock-fetch.mjs');
const jourLocal = (decalage = 0) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(Date.now() + decalage * 864e5));

function lancer(body, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'conv-run-'));
  try {
    const r = spawnSync(process.execPath,
      ['--import', 'file:///' + MOCK.replace(/\\/g, '/'), join(RACINE, 'snow-forecast-alert.mjs')], {
        cwd: dir, encoding: 'utf8',
        env: { ...process.env, DRY_RUN: 'false', NTFY_TOPIC_NEIGE: 'x', IGNORER_SAISON: 'true',
          SEUIL_CM: '10', SILENCE_NOCTURNE: '', HAUSSE_PCT: '', TEMP_NEIGE_C: '', TEMP_PLUIE_C: '',
          MOCK_FETCH: JSON.stringify({ body }), ...env },
      });
    const lireSi = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
    return { code: r.status, out: r.stdout + r.stderr, journal: lireSi('data/neige.csv'),
      ecran: lireSi('data/neige-ecran.json'), etat: lireSi('snow-forecast-alerted.json') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// jours = [{ mm, t, fixe }] à partir d'aujourd'hui ; mm répartis sur 24 h à température t.
function reponse(jours) {
  const time = jours.map((_, i) => jourLocal(i));
  const h = { time: [], precipitation: [], temperature_2m: [] };
  jours.forEach((j, i) => {
    for (let k = 0; k < 24; k++) {
      h.time.push(`${time[i]}T${String(k).padStart(2, '0')}:00`);
      h.precipitation.push(j.mm == null ? null : j.mm / 24);
      h.temperature_2m.push(j.t);
    }
  });
  return {
    daily_units: { snowfall_sum: 'cm' }, hourly_units: { precipitation: 'mm', temperature_2m: '°C' },
    daily: { time, snowfall_sum: jours.map((j) => j.fixe ?? 0) }, hourly: h,
  };
}

test('script : 30 mm de pluie à +6 °C -> 0 cm, aucune alerte, même si le 0,7 fixe dit 21 cm', () => {
  const r = lancer(reponse([{ mm: 0, t: 6 }, { mm: 30, t: 6, fixe: 21 }, { mm: 0, t: 6 }]));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /À notifier : 0/);
  assert.ok(r.journal.split('\n').some((l) => l.endsWith(`prev,${jourLocal(1)},0,1,icon,,,,,,21`)), r.journal);
});

test('script : 20 mm à −8 °C -> neige convertie annoncée, écran au même chiffre', () => {
  const r = lancer(reponse([{ mm: 0, t: -8 }, { mm: 20, t: -8, fixe: 14 }, { mm: 0, t: -8 }]));
  assert.equal(r.code, 0, r.out);
  const attendu = Math.round(20 * rapportTemperature(-8));   // 28 cm
  assert.match(r.out, /À notifier : 1/);
  assert.match(r.out, new RegExp(`\\[nouvelle\\] ${attendu} cm cumulés`));
  assert.ok(Math.abs(JSON.parse(r.etat).episodes[0].total - 20 * rapportTemperature(-8)) < 0.1, r.etat);
  const ecran = JSON.parse(r.ecran);
  assert.equal(ecran.episode.cm, attendu, 'écran = chiffre de l\'alerte');
  assert.ok(Math.abs(ecran.jours[1].cm - 20 * rapportTemperature(-8)) < 0.1, r.ecran);
});

test('script : données horaires absentes -> rouge, aucune alerte', () => {
  const b = reponse([{ mm: 20, t: -8 }, { mm: 20, t: -8 }]);
  delete b.hourly;
  const r = lancer(b);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /aucune alerte/i);
  assert.equal(r.etat, '');
});

test('script : unité horaire inattendue -> rouge, aucune alerte', () => {
  const b = reponse([{ mm: 20, t: -8 }]);
  b.hourly_units.temperature_2m = '°F';
  const r = lancer(b);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Unité inattendue/);
});

test('script : snowfall_sum absent -> alerte quand même, run rouge, cm_fixe vide', () => {
  const b = reponse([{ mm: 0, t: -8 }, { mm: 20, t: -8 }, { mm: 0, t: -8 }]);
  delete b.daily.snowfall_sum;
  const r = lancer(b);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /snowfall_sum inexploitable/);
  assert.match(r.out, /À notifier : 1/);
  assert.ok(r.journal.split('\n').some((l) => l.includes(`prev,${jourLocal(1)},`) && l.endsWith(',,')), r.journal);
});

test('relecture : cm_fixe vide sur une ligne D-005 -> inconnu, pas le chiffre converti', () => {
  const dir = mkdtempSync(join(tmpdir(), 'conv-'));
  const fichier = join(dir, 'neige.csv');
  try {
    journaliserPrevision('2026-11-20', ['2026-11-21'], [30], {
      fichier, maintenant: new Date('2026-11-20T05:00:00Z'), annexes: { cmFixe: [null] } });
    const [l] = lire(fichier);
    assert.equal(l.cm, 30);
    assert.ok(Number.isNaN(l.cmFixe), String(l.cmFixe));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('script : virgule décimale et signe moins typographique acceptés', () => {
  const r = lancer(reponse([{ mm: 0, t: 0 }, { mm: 20, t: 0 }]), { TEMP_NEIGE_C: '−2,5', TEMP_PLUIE_C: '2,5' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /neige sous -2\.5 °C, rien au-dessus de 2\.5 °C/);
});

test('script : borne non numérique -> rouge, défaut annoncé lisiblement', () => {
  const r = lancer(reponse([{ mm: 0, t: 0 }, { mm: 20, t: 0 }]), { TEMP_NEIGE_C: 'froid' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Variable invalide : TEMP_NEIGE_C = « froid » n'est pas un nombre — défaut -5 utilisé/);
  const b = lancer(reponse([{ mm: 0, t: 0 }]), { TEMP_NEIGE_C: '4', TEMP_PLUIE_C: '1' });
  assert.match(b.out, /défaut -5 \/ 5 °C utilisé/);
  assert.doesNotMatch(b.out, /object Object/);
});

test('script : bornes de température absurdes -> rouge, défauts −5 / +5 utilisés', () => {
  const r = lancer(reponse([{ mm: 0, t: 0 }, { mm: 20, t: 0 }]), { TEMP_NEIGE_C: '4', TEMP_PLUIE_C: '1' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Variable invalide : TEMP_NEIGE_C = 4, TEMP_PLUIE_C = 1/);
  assert.match(r.out, /neige sous -5 °C, rien au-dessus de 5 °C/);
});

test('script : bornes lues dans les variables', () => {
  // 20 mm à 0 °C : bornes −2 / +2 -> part 0,5 ; défaut −5 / +5 -> part 0,5 aussi. On prend 1 °C.
  const corps = reponse([{ mm: 0, t: 1 }, { mm: 20, t: 1 }]);
  const def = lancer(corps);
  const serre = lancer(corps, { TEMP_NEIGE_C: '-1', TEMP_PLUIE_C: '1' });
  assert.match(def.out, new RegExp(`· ${Math.round(20 * 0.4 * rapportTemperature(1) * 100) / 100} cm`));
  assert.match(serre.out, /neige sous -1 °C, rien au-dessus de 1 °C/);
  assert.match(serre.out, new RegExp(`${jourLocal(1).slice(8, 10)}\\.${jourLocal(1).slice(5, 7)} · 0 cm`));
});
