import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const client = await readFile(new URL('cam-inspecciones-sync-client-v1.js', root), 'utf8');
const sw = await readFile(new URL('sw.js', root), 'utf8');

test('V1.4 muestra acciones separadas para preparar y enviar una prueba sintética', () => {
  assert.match(html, /id="camSyncPrepareTestV1"/);
  assert.match(html, /id="camSyncSendTestV1"/);
  assert.match(html, /Enviar prueba controlada/);
});

test('Preparar prueba local no ejecuta fetch ni altera la colección funcional', () => {
  const start = client.indexOf('function prepareLocalTest()');
  const end = client.indexOf('async function syncOnlyTest()', start);
  const fn = client.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(fn, /fetch\s*\(/);
  assert.match(fn, /writePair\(\[\.\.\.queue, operation\], records\)/);
  assert.match(client, /_tecchnex_sync_lab_test_v1/);
  assert.match(fn, /REGISTRO_SINTETICO_DE_LABORATORIO/);
});

test('El emisor dedicado selecciona exclusivamente la operación de prueba marcada', () => {
  const start = client.indexOf('async function syncOnlyTest()');
  const end = client.indexOf('function refreshLabel()', start);
  const fn = client.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(fn.includes("queue.findIndex(op => op?.payload?.[TEST_MARKER] === true && op.status === \"pending\")"));
  assert.match(fn, /sendOne\(operation\)/);
  assert.doesNotMatch(fn, /filter\(op => op && op\.status === "pending"\)/);
});

test('La caché de laboratorio se actualiza a V4 y precarga el cliente', () => {
  assert.match(sw, /inspecciones-seguridad-v25-bridge-lab-v4/);
  assert.match(sw, /\.\/cam-inspecciones-sync-client-v1\.js/);
});
