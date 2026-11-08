// Déclencheur Cloudflare (worker/) : requête envoyée à GitHub, pannes signalées,
// et cohérence avec les workflows — un Worker qui oublierait dry_run ne ferait
// jamais partir une alerte, en silence.

import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../worker/src/index.mjs';
import { TACHES, declencher } from '../worker/src/taches.mjs';

afterEach(() => mock.restoreAll());

const ENV = { GH_TOKEN: 'jeton-factice' };
const WIND = '17 1,5,9,13,17,21 * * *';

function simuler(...reponses) {
  const appels = [];
  mock.method(globalThis, 'fetch', async (url, opts) => {
    appels.push({ url, opts, corps: JSON.parse(opts.body) });
    const r = reponses[Math.min(appels.length - 1, reponses.length - 1)];
    return new Response(r === 204 ? null : 'erreur', { status: r });
  });
  mock.method(console, 'log', () => {});
  mock.method(console, 'error', () => {});
  return appels;
}

test('requete conforme a l\'API GitHub', async () => {
  const a = simuler(204);
  await declencher(WIND, ENV);
  assert.equal(a.length, 1);
  assert.equal(a[0].url,
    'https://api.github.com/repos/gregorysticher/meteo-alert/actions/workflows/wind-alert.yml/dispatches');
  assert.equal(a[0].opts.method, 'POST');
  assert.equal(a[0].opts.headers.Authorization, 'Bearer jeton-factice');
  assert.ok(a[0].opts.headers['User-Agent'], 'GitHub refuse une requete sans User-Agent');
  assert.deepEqual(a[0].corps, { ref: 'main', inputs: { dry_run: '0', qa_only: '0' } });
});

test('HTTP 200 accepte aussi (la doc annonce 200 avec details du run)', async () => {
  const a = [];
  mock.method(globalThis, 'fetch', async (url, opts) => { a.push(opts); return new Response('{}', { status: 200 }); });
  mock.method(console, 'log', () => {});
  await declencher(WIND, ENV);
  assert.equal(a.length, 1);
});

test('chaque declenchement est un VRAI run : jamais de DRY_RUN', () => {
  for (const { workflow, inputs } of Object.values(TACHES)) {
    const yml = readFileSync(`.github/workflows/${workflow}`, 'utf8');
    assert.match(yml, /workflow_dispatch:/, workflow);
    for (const cle of Object.keys(inputs)) {
      assert.match(yml, new RegExp(`^\\s+${cle}:`, 'm'), `${workflow} : entree ${cle}`);
    }
    assert.ok(['0', 'false'].includes(inputs.dry_run), workflow);
  }
});

test('les workflows transmettent vraiment l\'entree au script', () => {
  const wind = readFileSync('.github/workflows/wind-alert.yml', 'utf8');
  assert.ok(wind.includes("DRY_RUN: ${{ github.event_name == 'workflow_dispatch' && inputs.dry_run || '0' }}"));
  assert.ok(readFileSync('wind-alert.mjs', 'utf8').includes("process.env.DRY_RUN === '1'"));
  assert.equal(TACHES[WIND].inputs.dry_run, '0');
  for (const f of ['snow-forecast-alert', 'snow-fresh-alert']) {
    const yml = readFileSync(`.github/workflows/${f}.yml`, 'utf8');
    assert.ok(yml.includes('DRY_RUN: ${{ inputs.dry_run }}'), f);
    assert.match(yml, /dry_run:\n(.*\n){1,2}\s+type: boolean/, f);
    assert.ok(readFileSync(`${f}.mjs`, 'utf8').includes('process.env.DRY_RUN === "true"'), f);
  }
  const annonce = readFileSync('.github/workflows/snow-forecast-alert.yml', 'utf8');
  for (const v of ['HAUSSE_CM: ${{ vars.HAUSSE_NEIGE_CM }}', 'MARGE_CM: ${{ vars.MARGE_ANNUL_NEIGE_CM }}',
    'PROLONGE_MIN_CM: ${{ vars.PROLONGE_MIN_NEIGE_CM }}', 'SEUIL_FORCE: ${{ inputs.seuil_cm }}']) {
    assert.ok(annonce.includes(v), v);
  }
  assert.ok(wind.includes('-size +45M'), 'garde de taille des fichiers');
});

test('crons alignes : wrangler.toml = TACHES = cron de chaque workflow', () => {
  const toml = readFileSync('worker/wrangler.toml', 'utf8');
  const crons = JSON.parse(toml.match(/^crons = (\[.*\])$/m)[1]);
  assert.deepEqual([...crons].sort(), Object.keys(TACHES).sort());
  assert.ok(crons.length <= 5, 'plan gratuit Cloudflare : 5 crons par compte');
  for (const [cron, { workflow }] of Object.entries(TACHES)) {
    const yml = readFileSync(`.github/workflows/${workflow}`, 'utf8');
    assert.ok(yml.includes(`- cron: "${cron}"`), `${workflow} : cron de secours ${cron}`);
  }
});

test('erreur 5xx : un second essai', async () => {
  const a = simuler(502, 204);
  await declencher(WIND, ENV);
  assert.equal(a.length, 2);
});

test('5xx deux fois : echec', async () => {
  const a = simuler(502, 503);
  await assert.rejects(declencher(WIND, ENV), /HTTP 503/);
  assert.equal(a.length, 2);
});

test('jeton refuse (401) : pas de second essai', async () => {
  const a = simuler(401);
  await assert.rejects(declencher(WIND, ENV), /HTTP 401/);
  assert.equal(a.length, 1);
});

test('secret absent, cron inconnu : echec clair, sans appel', async () => {
  const a = simuler(204);
  await assert.rejects(declencher(WIND, {}), /GH_TOKEN/);
  await assert.rejects(declencher('0 0 * * *', ENV), /cron inconnu/);
  assert.equal(a.length, 0);
});

test('scheduled : succes, rien de signale', async () => {
  const a = simuler(204);
  await worker.scheduled({ cron: WIND }, { ...ENV, NTFY_TOPIC_PANNE: 'panne' });
  assert.equal(a.length, 1);
});

test('scheduled : panne -> ntfy prevenu ET echec visible dans Cloudflare', async () => {
  const a = simuler(401, 200);
  await assert.rejects(worker.scheduled({ cron: WIND }, { ...ENV, NTFY_TOPIC_PANNE: 'panne' }), /HTTP 401/);
  assert.equal(a.at(-1).url, 'https://ntfy.sh');
  assert.equal(a.at(-1).corps.topic, 'panne');
  assert.doesNotMatch(a.at(-1).opts.body, /jeton-factice/);
});

test('scheduled : panne, ntfy absent ou en panne -> l\'echec reste celui de GitHub', async () => {
  simuler(401);
  await assert.rejects(worker.scheduled({ cron: WIND }, ENV), /HTTP 401/);
  mock.restoreAll();
  mock.method(console, 'error', () => {});
  mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('ntfy')) throw new Error('ntfy muet');
    return new Response('x', { status: 401 });
  });
  await assert.rejects(worker.scheduled({ cron: WIND }, { ...ENV, NTFY_TOPIC_PANNE: 'p' }), /HTTP 401/);
});
