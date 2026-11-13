// Second essai de reseau.mjs : une seule reprise, puis l'échec remonte.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchEssai, lireEssai, SECOURS } from '../reseau.mjs';

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
  process.env.RESEAU_SECOURS = '{}';
  console.log = (m) => journal.push(m);
});
afterEach(() => { globalThis.fetch = vrai; console.log = logVrai; delete process.env.RESEAU_SECOURS; });

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

// ---- serveur de secours (panne du serveur US d'Open-Meteo, 13/11/2026) ----

// Serveur local qui joue le serveur de secours ; l'hôte « secours.test » n'existe
// pas : seule l'adresse imposée par la table de secours peut l'atteindre.
async function serveur(traiter) {
  const recus = [];
  const srv = http.createServer((req, res) => {
    let corps = '';
    req.on('data', (c) => (corps += c));
    req.on('end', () => { recus.push({ url: req.url, host: req.headers.host, methode: req.method, corps }); traiter(req, res); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { recus, port: srv.address().port, fermer: () => new Promise((r) => srv.close(r)) };
}

test('table de secours : api.open-meteo.com vers le serveur européen', () => {
  assert.equal(SECOURS['api.open-meteo.com'], '157.90.83.168');
});

test('secours : connexion impossible, second essai par l\'adresse de secours', async () => {
  const s = await serveur((req, res) => res.end('{"ok":1}'));
  try {
    process.env.RESEAU_SECOURS = JSON.stringify({ 'secours.test': '127.0.0.1' });
    simuler(new Error('fetch failed'));
    const url = `http://secours.test:${s.port}/v1/forecast?a=1`;
    const res = await fetchEssai(url);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: 1 });
    assert.equal(appels.length, 1, 'le second essai ne passe pas par fetch');
    assert.equal(s.recus[0].url, '/v1/forecast?a=1');
    assert.equal(s.recus[0].host, `secours.test:${s.port}`);
    assert.match(journal[0], /par le serveur de secours 127\.0\.0\.1/);
  } finally { await s.fermer(); }
});

test('secours : un 503 (serveur joignable) est réessayé normalement', async () => {
  const s = await serveur((req, res) => res.end('x'));
  try {
    process.env.RESEAU_SECOURS = JSON.stringify({ 'secours.test': '127.0.0.1' });
    simuler(503, 200);
    assert.equal((await fetchEssai(`http://secours.test:${s.port}/x`)).status, 200);
    assert.equal(appels.length, 2);
    assert.equal(s.recus.length, 0);
    assert.doesNotMatch(journal[0], /serveur de secours/);
  } finally { await s.fermer(); }
});

test('secours : son 500 remonte tel quel, run rouge comme avant', async () => {
  const s = await serveur((req, res) => { res.statusCode = 500; res.end('panne'); });
  try {
    process.env.RESEAU_SECOURS = JSON.stringify({ 'secours.test': '127.0.0.1' });
    simuler(new Error('fetch failed'));
    assert.equal((await fetchEssai(`http://secours.test:${s.port}/x`)).status, 500);
  } finally { await s.fermer(); }
});

test('secours : injoignable lui aussi, l\'erreur remonte', async () => {
  const s = await serveur(() => {});
  const port = s.port;
  await s.fermer();
  process.env.RESEAU_SECOURS = JSON.stringify({ 'secours.test': '127.0.0.1' });
  simuler(new Error('fetch failed'));
  await assert.rejects(fetchEssai(`http://secours.test:${port}/x`), /ECONNREFUSED/);
});

test('secours : hôte hors table, second essai normal', async () => {
  process.env.RESEAU_SECOURS = JSON.stringify({ 'secours.test': '127.0.0.1' });
  simuler(new Error('fetch failed'), 200);
  assert.equal((await fetchEssai('https://autre.test/x')).status, 200);
  assert.equal(appels.length, 2);
});

test('secours : POST, même méthode, en-têtes et corps', async () => {
  const s = await serveur((req, res) => { res.statusCode = 204; res.end(); });
  try {
    process.env.RESEAU_SECOURS = JSON.stringify({ 'secours.test': '127.0.0.1' });
    simuler(new Error('fetch failed'));
    const res = await fetchEssai(`http://secours.test:${s.port}/p`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
    assert.equal(res.status, 204);
    assert.deepEqual([s.recus[0].methode, s.recus[0].corps], ['POST', '{"a":1}']);
  } finally { await s.fermer(); }
});

test('secours : lireEssai lit le corps par l\'adresse de secours', async () => {
  const s = await serveur((req, res) => res.end('a;b\n1;2\n'));
  try {
    process.env.RESEAU_SECOURS = JSON.stringify({ 'secours.test': '127.0.0.1' });
    simuler(new Error('fetch failed'));
    assert.equal(await lireEssai(`http://secours.test:${s.port}/f.csv`, (r) => r.text()), 'a;b\n1;2\n');
  } finally { await s.fermer(); }
});

test('secours : lireEssai sur un 404, pas de secours', async () => {
  process.env.RESEAU_SECOURS = JSON.stringify({ 'secours.test': '127.0.0.1' });
  simuler(404, 404);
  await assert.rejects(lireEssai('http://secours.test:1/f.csv', (r) => r.text()), /HTTP 404/);
  assert.equal(appels.length, 2);
});

test('secours : statut 205 rendu sans corps, pas de plantage', async () => {
  const s = await serveur((req, res) => { res.statusCode = 205; res.end(); });
  try {
    process.env.RESEAU_SECOURS = JSON.stringify({ 'secours.test': '127.0.0.1' });
    simuler(new Error('fetch failed'));
    assert.equal((await fetchEssai(`http://secours.test:${s.port}/x`)).status, 205);
  } finally { await s.fermer(); }
});

test('secours : RESEAU_SECOURS illisible, erreur claire', async () => {
  process.env.RESEAU_SECOURS = '{pas du json';
  simuler(new Error('fetch failed'));
  await assert.rejects(fetchEssai('https://a.test/x'), /RESEAU_SECOURS illisible/);
});
