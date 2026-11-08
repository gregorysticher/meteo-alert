// Garde du cron de secours de wind-alert (cron-garde.mjs).

import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aSauter, dernierCommitDonnees } from '../cron-garde.mjs';

afterEach(() => mock.restoreAll());

const T = new Date('2026-11-08T12:00:00Z');

test('schedule : donnees de moins de 3 h -> saute ; au-dela -> lance', () => {
  assert.equal(aSauter('schedule', '2026-11-08T10:00:00Z', T), true);
  assert.equal(aSauter('schedule', '2026-11-08T09:00:00Z', T), false);
});
test('dispatch (Worker, manuel) : jamais saute', () => {
  assert.equal(aSauter('workflow_dispatch', '2026-11-08T11:59:00Z', T), false);
});
test('date absente, invalide ou future : lance', () => {
  assert.equal(aSauter('schedule', null, T), false);
  assert.equal(aSauter('schedule', 'n/importe', T), false);
  assert.equal(aSauter('schedule', '2026-11-08T13:00:00Z', T), false);
});
test('duree parametrable', () => {
  assert.equal(aSauter('schedule', '2026-11-08T10:00:00Z', T, 1), false);
});
test('lit les commits de data/forecasts, pas ceux de la neige', async () => {
  let url;
  mock.method(globalThis, 'fetch', async (u) => {
    url = u;
    return new Response(JSON.stringify([{ commit: { message: 'data: wind', committer: { date: '2026-11-08T10:00:00Z' } } }]));
  });
  assert.equal(await dernierCommitDonnees('a/b', 'x'), '2026-11-08T10:00:00Z');
  assert.match(url, /repos\/a\/b\/commits\?path=data\/forecasts/);
});
test('un dry-run n\'arme pas la garde : on remonte au dernier vrai run', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([
    { commit: { message: 'data: wind 2026-11-08T11:00:00Z [dry]', committer: { date: '2026-11-08T11:00:00Z' } } },
    { commit: { message: 'data: wind 2026-11-08T05:00:00Z', committer: { date: '2026-11-08T05:00:00Z' } } },
  ])));
  assert.equal(await dernierCommitDonnees('a/b', 'x'), '2026-11-08T05:00:00Z');
});

test('script : API muette -> sortie passer=false, code 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'garde-'));
  try {
    const out = join(dir, 'out');
    const r = spawnSync(process.execPath, ['cron-garde.mjs'], { encoding: 'utf8', env: {
      ...process.env, EVENT: 'schedule', DEPOT: 'gregorysticher/inexistant-xyz', GH_TOKEN: 'x', GITHUB_OUTPUT: out,
    } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(out, 'utf8'), /passer=false/);
    assert.match(r.stdout, /run lancé/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('workflow : la garde recoit le vrai evenement, sa duree, et le commit reste en always', () => {
  const yml = readFileSync('.github/workflows/wind-alert.yml', 'utf8');
  assert.ok(yml.includes('EVENT: ${{ github.event_name }}'), 'sinon le Worker sauterait aussi');
  assert.ok(yml.includes('GARDE_H: ${{ vars.GARDE_CRON_VENT_H }}'));
  const commit = yml.slice(yml.indexOf('- name: Commit des donnees')).split('\n')[1];
  assert.ok(commit.includes('always()'), 'alerted.json perdu sinon sur un run rouge');
  assert.ok(yml.includes("inputs.dry_run == '1' && ' [dry]'"));
  assert.ok(yml.includes('$(date -u +%FT%TZ)$MARQUE'));
});

test('workflow : toutes les etapes du run respectent la garde', () => {
  const yml = readFileSync('.github/workflows/wind-alert.yml', 'utf8');
  for (const etape of ['Tests', 'Previsions, alertes et QA', 'Commit des donnees', 'Taille des fichiers de donnees']) {
    const bloc = yml.slice(yml.indexOf(`- name: ${etape}`)).split('\n').slice(0, 3).join('\n');
    assert.ok(bloc.includes("steps.garde.outputs.passer != 'true'"), etape);
  }
});
