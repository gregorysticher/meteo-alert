// gravite.mjs (D-007) : avertissement pour une source informative, escalade au rouge
// après 24 h de panne continue, remise à zéro dès qu'elle répond.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initSources, informatif, sourceOk, enPanne, bilanSources, ESCALADE_H } from '../gravite.mjs';

let dir, f, code;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gravite-'));
  f = join(dir, 'data', 'sources.json');
  code = process.exitCode;
  process.exitCode = undefined;
});
afterEach(() => {
  process.exitCode = code;
  rmSync(dir, { recursive: true, force: true });
});

const T0 = new Date('2026-11-23T12:00:00Z');
const plus = (h) => new Date(T0.getTime() + h * 36e5);
const lire = () => JSON.parse(readFileSync(f, 'utf8'));

test('panne d\'une source informative : vert, suivi écrit avec le début de la panne', () => {
  initSources(f);
  informatif('lac', 'HTTP 503');
  informatif('lac', 'second message ignoré');
  assert.equal(enPanne('lac'), true);
  assert.equal(enPanne('AROME'), false);
  assert.deepEqual(bilanSources(T0), []);
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(lire(), { lac: { depuis: T0.toISOString(), dernier: T0.toISOString(), message: 'HTTP 503' } });
});

test('panne continue : vert jusqu\'à 24 h, rouge au-delà, à chaque run', () => {
  assert.equal(ESCALADE_H, 24);
  initSources(f); informatif('lac', 'a'); bilanSources(T0);
  initSources(f); informatif('lac', 'b'); assert.deepEqual(bilanSources(plus(24)), []);
  assert.equal(process.exitCode, undefined, 'pile 24 h : encore vert');
  assert.equal(lire().lac.depuis, T0.toISOString(), 'le début de la panne ne bouge pas');
  initSources(f); informatif('lac', 'c'); assert.deepEqual(bilanSources(plus(25)), ['lac']);
  assert.equal(process.exitCode, 1);
  process.exitCode = undefined;
  initSources(f); informatif('lac', 'd'); assert.deepEqual(bilanSources(plus(29)), ['lac']);
  assert.equal(process.exitCode, 1, 'reste rouge tant que la panne dure');
});

test('la source répond : suivi effacé, une nouvelle panne repart de zéro', () => {
  initSources(f); informatif('lac', 'a'); bilanSources(T0);
  initSources(f); sourceOk('lac'); bilanSources(plus(10));
  assert.deepEqual(lire(), {});
  initSources(f); informatif('lac', 'b'); assert.deepEqual(bilanSources(plus(30)), []);
  assert.equal(lire().lac.depuis, plus(30).toISOString());
});

test('échec et réussite dans le même run (un spot sur deux) : compte comme une panne', () => {
  initSources(f); sourceOk('lac'); informatif('lac', 'x'); bilanSources(T0);
  assert.ok(lire().lac);
});

test('source non appelée dans le run : suivi inchangé', () => {
  initSources(f); informatif('lac', 'a'); bilanSources(T0);
  initSources(f); sourceOk('AROME'); bilanSources(plus(30));
  assert.equal(lire().lac.depuis, T0.toISOString());
  assert.equal(process.exitCode, undefined, 'pas d\'escalade sans nouvel échec');
});

test('DRY_RUN (ecrire: false) : rien écrit, escalade quand même calculée', () => {
  writeFileSync(join(dir, 'x'), '');
  initSources(f, { ecrire: false }); informatif('lac', 'a');
  assert.deepEqual(bilanSources(T0), []);
  assert.equal(existsSync(f), false);
});

test('suivi illisible : repart de zéro, sans rouge', () => {
  initSources(f); informatif('lac', 'a'); bilanSources(T0);
  writeFileSync(f, '{pas du json');
  initSources(f); informatif('lac', 'b');
  assert.deepEqual(bilanSources(plus(30)), []);
  assert.equal(lire().lac.depuis, plus(30).toISOString());
});

test('source non appelée plus de 24 h : la série est close, la panne suivante repart de zéro', () => {
  initSources(f); informatif('bulletin', 'a'); bilanSources(T0);
  initSources(f); informatif('bulletin', 'b'); assert.deepEqual(bilanSources(plus(24 * 30)), []);
  assert.equal(process.exitCode, undefined);
  assert.equal(lire().bulletin.depuis, plus(24 * 30).toISOString());
});

test('erreur de code dans une étape informative -> rouge tout de suite ; panne réseau -> avertissement', () => {
  initSources(f);
  informatif('plan', new TypeError("Cannot read properties of undefined (reading 'kn')"));
  assert.equal(process.exitCode, 1);
  assert.equal(enPanne('plan'), false, 'pas une panne de source');
  process.exitCode = undefined;
  informatif('lac', new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }));
  informatif('json', new SyntaxError('Unexpected token'));
  informatif('pile', new RangeError('Maximum call stack size exceeded'));
  assert.equal(process.exitCode, 1, 'RangeError : code');
  assert.equal(enPanne('lac'), true);
  assert.equal(enPanne('json'), true);
  bilanSources(T0);
  assert.equal(lire().lac.message, 'fetch failed : UND_ERR_CONNECT_TIMEOUT');
});

test('DRY (ecrire: false) sur une panne de plus de 24 h : rouge, fichier intact', () => {
  initSources(f); informatif('lac', 'a'); bilanSources(T0);
  initSources(f); informatif('lac', 'b'); bilanSources(plus(20));
  const avant = readFileSync(f, 'utf8');
  initSources(f, { ecrire: false }); informatif('lac', 'c');
  assert.deepEqual(bilanSources(plus(25)), ['lac']);
  assert.equal(process.exitCode, 1);
  assert.equal(readFileSync(f, 'utf8'), avant);
});
