// The EDIT-6.7 acceptance stub (infrastructure/vps/acceptance-stub/server.mjs) against a fake editor
// API and a fake DocumentServer: the launch gate and consumer token, file serving, and the
// notification receiver's verification, answers, bounds, and download rule.
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

const STUB_SCRIPT = new URL('../../../infrastructure/vps/acceptance-stub/server.mjs', import.meta.url).pathname;
const SECRET = 'hmac-test-secret';
const NOTIFY = 'notify-test-secret';
const KEY = 'launch-test-key';
const DOC_KEY = 'acceptance.acc_x.e1';
const MARKER = 'EDIT-6.7 acceptance 2026-11-02T04:19:41.123Z';

let stub;
let api;
let ds;
let dir;
let base;
let dsOrigin;
let tokenAccepted = null;

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'acceptance-stub-'));
  await mkdir(path.join(dir, 'fixtures'));
  await mkdir(path.join(dir, 'panel'));
  await writeFile(path.join(dir, 'fixtures', 'acceptance.docx'), Buffer.from('504b0304', 'hex'));
  await writeFile(path.join(dir, 'panel', 'bridge.html'), '<!doctype html><title>panel</title>');

  // A DOCX whose typed marker OnlyOffice may split across runs.
  const docx = new JSZip();
  docx.file('[Content_Types].xml', '<Types/>');
  docx.file('word/document.xml', `<w:document><w:body><w:p><w:r><w:t>EDIT-6.7 accep</w:t></w:r><w:r><w:t>tance ${MARKER.slice('EDIT-6.7 acceptance '.length)}</w:t></w:r></w:p></w:body></w:document>`);
  const saved = await docx.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  ds = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: 'http://example.invalid/x' });
      return res.end();
    }
    res.writeHead(200);
    return res.end(req.url === '/not-a-docx' ? Buffer.from('504b0304', 'hex') : saved);
  });
  dsOrigin = `http://127.0.0.1:${await listen(ds)}`;

  api = createServer((req, res) => {
    const [head, body, sig] = (req.headers.authorization ?? '').slice('Bearer '.length).split('.');
    const payload = JSON.parse(Buffer.from(body ?? '', 'base64url').toString() || '{}');
    tokenAccepted =
      createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url') === sig &&
      JSON.parse(Buffer.from(head, 'base64url').toString()).alg === 'HS256' &&
      payload.iss === 'acceptance' &&
      payload.exp > Date.now() / 1000;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ editorUrl: `${dsOrigin}/editor/TOKEN`, key: DOC_KEY }));
  });
  const apiPort = await listen(api);

  const probe = createServer();
  const port = await listen(probe);
  await new Promise((r) => probe.close(r));
  base = `http://127.0.0.1:${port}`;
  stub = spawn(process.execPath, [STUB_SCRIPT], {
    env: {
      PORT: String(port),
      STUB_DIR: dir,
      STUB_ORIGIN: base,
      EDITOR_API: `http://127.0.0.1:${apiPort}`,
      EDITOR_PUBLIC_ORIGIN: dsOrigin,
      CONSUMER_ISSUER: 'acceptance',
      CONSUMER_HMAC_SECRET: SECRET,
      NOTIFY_SECRET: NOTIFY,
      LAUNCH_KEY: KEY,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  stub.stderr.on('data', (d) => (stderr += d));
  for (let i = 0; i < 50; i += 1) {
    if (await fetch(`${base}/health`).then((r) => r.ok).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`stub did not start: ${stderr}`);
});

after(async () => {
  stub?.kill();
  await new Promise((r) => api.close(r));
  await new Promise((r) => ds.close(r));
  await rm(dir, { recursive: true, force: true });
});

const signed = (body, { ts = Math.floor(Date.now() / 1000), secret = NOTIFY, delivery } = {}) => ({
  'content-type': 'application/json',
  'x-editor-timestamp': String(ts),
  'x-editor-signature': `v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`,
  ...(delivery ? { 'x-editor-delivery': delivery } : {}),
});
const post = (body, headers) => fetch(`${base}/callback`, { method: 'POST', headers, body }).then((r) => r.status);
const results = () => fetch(`${base}/results?k=${KEY}`).then((r) => r.json());
const save = (deliveryId, downloadUrl, status = 2) => JSON.stringify({ key: DOC_KEY, status, event: 'saved', downloadUrl, deliveryId });

test('launch is gated by the key and opens a session with a valid consumer token', async () => {
  assert.equal((await fetch(`${base}/launch`)).status, 404);
  assert.equal((await fetch(`${base}/launch?k=wrong`)).status, 404);
  const res = await fetch(`${base}/launch?k=${KEY}`);
  assert.equal(res.status, 200);
  assert.equal(tokenAccepted, true);
  assert.match(await res.text(), new RegExp(`src="${dsOrigin}/editor/TOKEN"`));
  assert.match(res.headers.get('content-security-policy'), new RegExp(`frame-src ${dsOrigin}; frame-ancestors 'none'`));
  assert.equal((await fetch(`${base}/results`)).status, 404);
});

test('serves the fixture and the panel, and nothing outside them', async () => {
  assert.equal((await fetch(`${base}/fixtures/acceptance.docx`)).status, 200);
  assert.equal((await fetch(`${base}/panel/bridge.html`)).status, 200);
  assert.equal((await fetch(`${base}/panel/..%2Fserver.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/panel/.hidden`)).status, 404);
});

test('verifies a save, downloads it from the editor origin only, and acknowledges a replay', async () => {
  const body = save('d1', `${dsOrigin}/cache/file`);
  assert.equal(await post(body, signed(body, { delivery: 'd1' })), 200);
  assert.equal(await post(body, signed(body, { delivery: 'd1' })), 200);
  const facts = (await results()).results;
  const stored = facts.find((f) => f.deliveryId === 'd1');
  assert.equal(stored.valid, true);
  assert.equal(stored.downloadOrigin, dsOrigin);
  assert.equal(stored.downloaded.zip, true);
  assert.equal(stored.downloaded.hasDocumentXml, true);
  assert.deepEqual(stored.downloaded.markers, [MARKER]);
  assert.equal(facts.filter((f) => f.reason === 'replay').length, 1);
  assert.ok(!JSON.stringify(facts).includes('/cache/file'), 'no URL is stored');
});

test('refuses forged, stale, unknown-key, and mismatched-delivery notifications; counts the unauthenticated ones', async () => {
  const body = save('d2', `${dsOrigin}/cache/file`);
  assert.equal(await post(body, signed(body, { secret: 'wrong', delivery: 'd2' })), 401);
  assert.equal(await post(body, signed(body, { ts: Math.floor(Date.now() / 1000) - 600, delivery: 'd2' })), 401);
  assert.equal(await post(body, signed(body, { delivery: 'other' })), 401);
  const loose = signed(body, { delivery: 'd2' });
  loose['x-editor-signature'] = `${loose['x-editor-signature']}zz`;
  assert.equal(await post(body, loose), 401);
  const unknown = JSON.stringify({ key: 'someone.else.e1', status: 1 });
  assert.equal(await post(unknown, signed(unknown)), 401);
  const r = await results();
  assert.equal(r.refusals.bad_signature, 2);
  assert.equal(r.refusals.stale, 1);
  assert.ok(r.results.some((f) => f.reason === 'delivery_mismatch'));
  assert.ok(r.results.some((f) => f.reason === 'unknown_key'));
});

test('never downloads from another origin or through a redirect', async () => {
  const foreign = save('d3', 'http://evil.example/x');
  assert.equal(await post(foreign, signed(foreign, { delivery: 'd3' })), 200);
  const redirect = save('d4', `${dsOrigin}/redirect`);
  assert.equal(await post(redirect, signed(redirect, { delivery: 'd4' })), 200);
  const facts = (await results()).results;
  assert.deepEqual(facts.find((f) => f.deliveryId === 'd3').downloaded, { refused: 'download origin is not the editor' });
  assert.equal(facts.find((f) => f.deliveryId === 'd4').downloaded.failed, 'network');
});

test('a download that is not a DOCX has no document text and no markers', async () => {
  const body = save('d5', `${dsOrigin}/not-a-docx`);
  assert.equal(await post(body, signed(body, { delivery: 'd5' })), 200);
  const stored = (await results()).results.find((f) => f.deliveryId === 'd5');
  assert.deepEqual(stored.downloaded, { bytes: 4, zip: true, hasDocumentXml: false, markers: [] });
});

test('refuses a callback body over 64 KiB', async () => {
  const status = await fetch(`${base}/callback`, { method: 'POST', body: 'x'.repeat(70 * 1024) }).then((r) => r.status).catch(() => 'reset');
  assert.notEqual(status, 200);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});
