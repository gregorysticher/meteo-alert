// relance.mjs (D-008, Décision 2) : une seule relance après un refus d'Open-Meteo, pas si un
// run planifié tombe dans les 2 h.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prochainRunPrevu, decider, attenteMin, ATTENTE_DEFAUT_MIN } from '../relance.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const d = (iso) => new Date(iso);

test('runs planifiés : 04:23 et 15:23 UTC, réveil 8h03 (jour ouvré) ou 9h03 (repos), heure suisse', () => {
  assert.equal(prochainRunPrevu(d('2026-11-24T03:00:00Z'))?.toISOString(), '2026-11-24T04:23:00.000Z');
  assert.equal(prochainRunPrevu(d('2026-11-24T13:30:00Z'))?.toISOString(), '2026-11-24T15:23:00.000Z');
  // Mardi : réveil à 8h03 locales = 07:03 UTC en hiver.
  assert.equal(prochainRunPrevu(d('2026-11-24T05:30:00Z'))?.toISOString(), '2026-11-24T07:03:00.000Z');
  // Samedi 28.11 : 9h03 = 08:03 UTC.
  assert.equal(prochainRunPrevu(d('2026-11-28T06:30:00Z'))?.toISOString(), '2026-11-28T08:03:00.000Z');
  // Été (UTC+2) : réveil 8h03 = 06:03 UTC.
  assert.equal(prochainRunPrevu(d('2027-04-13T05:00:00Z'))?.toISOString(), '2027-04-13T06:03:00.000Z');
  assert.equal(prochainRunPrevu(d('2026-11-24T09:00:00Z')), null);
  // Fenêtre de 2 h : le run de dans 2 h pile compte, celui de dans 2 h 01 non.
  assert.equal(prochainRunPrevu(d('2026-11-24T02:23:00Z'))?.toISOString(), '2026-11-24T04:23:00.000Z');
  assert.equal(prochainRunPrevu(d('2026-11-24T02:22:00Z')), null);
});

test('décision : relance hors des 2 h, pas de relance d\'une relance', () => {
  const r = decider({ maintenant: d('2026-11-24T09:00:00Z'), attente: 40 });
  assert.equal(r.relancer, true);
  assert.match(r.raison, /relance dans 40 min, vers 10:40 \(heure suisse\)/);
  const p = decider({ maintenant: d('2026-11-24T14:00:00Z') });
  assert.equal(p.relancer, false);
  assert.match(p.raison, /run planifié à 16:23/);
  assert.equal(decider({ maintenant: d('2026-11-24T09:00:00Z'), dejaRelance: true }).relancer, false);
});

test('attente : RELANCE_NEIGE_MIN entre 30 et 60, sinon 40', () => {
  assert.equal(attenteMin(''), ATTENTE_DEFAUT_MIN);
  assert.equal(attenteMin(undefined), 40);
  assert.equal(attenteMin('45'), 45);
  assert.equal(attenteMin('10'), 40);
  assert.equal(attenteMin('abc'), 40);
});

test('script : code 0 = relancer, 3 = non ; raison au résumé, attente en sortie', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relance-'));
  try {
    const out = join(dir, 'o'), res = join(dir, 'r');
    writeFileSync(out, ''); writeFileSync(res, '');
    const r = spawnSync(process.execPath, [join(RACINE, 'relance.mjs')], { encoding: 'utf8',
      env: { ...process.env, RELANCE: '1', RELANCE_NEIGE_MIN: '50', GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: res } });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(readFileSync(res, 'utf8'), /déjà une relance/);
    assert.match(readFileSync(out, 'utf8'), /^attente_min=50$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
