// Second essai de reseau.mjs : une seule reprise, puis l'échec remonte.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchEssai, lireEssai } from '../reseau.mjs';

const vrai = globalThis.fetch;
const logVrai = console.log;
let appels, journal;

function simuler(...reponses) {
  globalThis.fetch = async (url, opts) => {
    appels.push({ url, opts });
    const r = reponses.shift();
    if (r instanceof Error) throw r;
    return new Response('x', { status: r });
  };
}

beforeEach(() => {
  appels = []; journal = [];
  process.env.ESSAI_ATTENTE_S = '0';
  console.log = (m) => journal.push(m);
});
afterEach(() => { globalThis.fetch = vrai; console.log = logVrai; });

test('succès au premier essai : un seul appel, rien au journal', async () => {
  simuler(200);
  assert.equal((await fetchEssai('https://a.test/x')).status, 200);
  assert.equal(appels.length, 1);
  assert.deepEqual(journal, []);
});

test('erreur réseau puis succès : réponse rendue, raté au journal', async () => {
  simuler(new Error('fetch failed'), 200);
  assert.equal((await fetchEssai('https://a.test/x')).status, 200);
  assert.equal(appels.length, 2);
  assert.match(journal[0], /Raté sur https:\/\/a\.test \(fetch failed\)/);
});

test('404 puis succès (meta AROME du 13/11) : réponse rendue', async () => {
  simuler(404, 200);
  assert.equal((await fetchEssai('https://a.test/meta.json')).status, 200);
  assert.match(journal[0], /HTTP 404/);
});

test('deux 503 : la seconde réponse remonte, pas de troisième essai', async () => {
  simuler(503, 503);
  assert.equal((await fetchEssai('https://a.test/x')).status, 503);
  assert.equal(appels.length, 2);
});

test('deux erreurs réseau : l\'erreur remonte', async () => {
  simuler(new Error('fetch failed'), new Error('ECONNRESET'));
  await assert.rejects(fetchEssai('https://a.test/x'), /ECONNRESET/);
  assert.equal(appels.length, 2);
});

test('POST : même corps et même méthode au second essai', async () => {
  simuler(502, 200);
  await fetchEssai('https://ntfy.test', { method: 'POST', body: '{"a":1}' });
  assert.equal(appels[1].opts.method, 'POST');
  assert.equal(appels[1].opts.body, '{"a":1}');
});

test('journal : ni chemin ni requête (webhook TRMNL, clés) n\'est écrit', async () => {
  simuler(500, 200);
  await fetchEssai('https://a.test/api/custom_plugins/SECRETCHEMIN?api_key=SECRET123');
  assert.doesNotMatch(journal[0], /SECRET/);
  assert.match(journal[0], /Raté sur https:\/\/a\.test \(HTTP 500\)/);
});

test('journal : la cause réseau est donnée', async () => {
  simuler(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }), 200);
  await fetchEssai('https://a.test/x');
  assert.match(journal[0], /fetch failed : ECONNRESET/);
});

test('délai par essai : un signal de temporisation est posé', async () => {
  simuler(200);
  await fetchEssai('https://a.test/x');
  assert.ok(appels[0].opts.signal instanceof AbortSignal);
});

test('signal de l\'appelant interrompu : pas de second essai', async () => {
  const c = new AbortController();
  c.abort();
  simuler(new Error('aborted'), 200);
  await assert.rejects(fetchEssai('https://a.test/x', { signal: c.signal }));
  assert.equal(appels.length, 1);
});

test('lireEssai : corps coupé en route au premier essai, relu au second', async () => {
  let n = 0;
  globalThis.fetch = async (url, opts) => {
    appels.push({ url, opts });
    n++;
    const corps = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('debut;'));
        if (n === 1) c.error(new TypeError('terminated')); else c.close();
      },
    });
    return new Response(corps, { status: 200 });
  };
  assert.equal(await lireEssai('https://a.test/gros.csv', (r) => r.text()), 'debut;');
  assert.equal(appels.length, 2);
  assert.match(journal[0], /terminated/);
});

test('lireEssai : deux 404, erreur « url -> HTTP 404 » comme avant', async () => {
  simuler(404, 404);
  await assert.rejects(lireEssai('https://a.test/f.csv', (r) => r.text()),
    (e) => e.message === 'https://a.test/f.csv -> HTTP 404');
  assert.equal(appels.length, 2);
  assert.match(journal[0], /\(HTTP 404\)/);
});
