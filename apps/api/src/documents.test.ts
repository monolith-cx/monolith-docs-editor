import jwt from 'jsonwebtoken';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { probeConverter } from './convert.js';
import { config } from './config.js';
import { resetConsumers, setConsumersForTest } from './consumers.js';
import type { Consumer } from './consumers.js';
import { BRIDGE_PLUGIN_GUID, PLUGIN_MANAGER_GUID } from './editor-config.js';
import { verifyNotification } from './reference/verify-notification.js';
import { MAX_TOKEN_CHARS, openSource, sealSession, sealSource } from './session-token.js';
import { endSource, expectSource } from './source-outcomes.js';

// --- A consumer's notification endpoint ---
let notifyPort = 0;
let notifyAnswer = 200;
let notified: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = [];
const notifyServer = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    notified.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
    res.writeHead(notifyAnswer, { 'content-type': 'application/json' });
    res.end('{}');
  });
});

// --- A consumer's file host (the source route fetches from it) ---
let filePort = 0;
let fileFetches = 0;
let endlessClosedAt = 0;
const FILE_BYTES = Buffer.from('PK-not-really-a-docx-but-bytes');
const LARGE_BYTES = Buffer.alloc(200_000, 7);
let uploads: Array<{ path: string; bytes: Buffer; type: string | undefined; length: string | undefined }> = [];
const fileServer = createServer((req, res) => {
  if (req.method === 'PUT') {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      uploads.push({ path: req.url ?? '', bytes: Buffer.concat(chunks), type: req.headers['content-type'], length: req.headers['content-length'] });
      if (req.url === '/upload/redirect') res.writeHead(307, { location: 'http://169.254.169.254/x' });
      else res.writeHead(req.url === '/upload/fail' ? 500 : 200);
      res.end();
    });
    return;
  }
  fileFetches += 1;
  if (req.url === '/contract.docx') {
    res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    res.end(FILE_BYTES);
  } else if (req.url === '/big.docx') {
    // No content-length: the cap is enforced on the stream.
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' });
    res.end(Buffer.alloc(4096, 1));
  } else if (req.url === '/gzip.docx') {
    // Compresses even when asked for identity, with the compressed length declared.
    const zipped = gzipSync(LARGE_BYTES);
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-encoding': 'gzip', 'content-length': String(zipped.length) });
    res.end(zipped);
  } else if (req.url === '/late-big.docx') {
    // Under the cap at first (headers go out), over it later.
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.write(Buffer.alloc(512, 1));
    setTimeout(() => res.end(Buffer.alloc(4096, 1)), 100);
  } else if (req.url === '/declared-big.docx') {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '4096' });
    res.end(Buffer.alloc(4096, 1));
  } else if (req.url === '/dies.docx') {
    // Declares 4096, sends 1000, then drops the connection.
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '4096' });
    res.write(Buffer.alloc(1000, 1));
    setTimeout(() => res.destroy(), 50);
  } else if (req.url === '/endless.docx') {
    // Streams until the service hangs up; records when it does.
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    const timer = setInterval(() => res.write(Buffer.alloc(16 * 1024, 1)), 10);
    res.on('close', () => {
      clearInterval(timer);
      endlessClosedAt = Date.now();
    });
  } else if (req.url === '/redirect.docx') {
    res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
    res.end();
  } else {
    res.writeHead(500);
    res.end();
  }
});

// --- DocumentServer's command service (ONLYOFFICE_URL in vitest.config.ts) ---
let commands: Array<Record<string, unknown>> = [];
let commandAnswer: Record<string, unknown> = { error: 0 };
// ConvertService (EDIT-3): the test decides the answer; by default it fetches its source through the
// app's source route like DocumentServer does, and serves the "converted" bytes from /cache/files/.
let converterApp: ReturnType<typeof buildApp> | null = null;
let converterBodies: Array<Record<string, unknown>> = [];
let converterAnswer: ((body: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
const PDF_BYTES = Buffer.from('%PDF-1.7 converted bytes for the test');
let resultBytes = PDF_BYTES;
let resultChunked = false;
let resultMode: 'ok' | 'short' | 'gzip' | 'empty' = 'ok';
async function defaultConverter(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const source = await converterApp?.inject({ method: 'GET', url: new URL(String(body['url'])).pathname });
  if (!source || source.statusCode !== 200) return { error: -4 };
  return { endConvert: true, percent: 100, fileUrl: 'http://127.0.0.1:18999/cache/files/conv/output.pdf?md5=x&expires=9' };
}
const commandServer = createServer((req, res) => {
  if (req.method === 'GET' && req.url?.startsWith('/cache/files/')) {
    if (resultMode === 'short') {
      // Declares more than it sends, then drops the connection.
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': String(resultBytes.length + 100) });
      res.write(resultBytes);
      setTimeout(() => res.destroy(), 50);
      return;
    }
    if (resultMode === 'empty') {
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': '0' });
      res.end();
      return;
    }
    if (resultMode === 'gzip') {
      const zipped = gzipSync(resultBytes);
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-encoding': 'gzip', 'content-length': String(zipped.length) });
      res.end(zipped);
      return;
    }
    if (resultChunked) {
      res.writeHead(200, { 'content-type': 'application/pdf', 'transfer-encoding': 'chunked' });
    } else {
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': String(resultBytes.length) });
    }
    res.end(resultBytes);
    return;
  }
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    if (req.url === '/converter') {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      converterBodies.push({ ...body, authorized: Boolean(req.headers.authorization) });
      void (converterAnswer ?? defaultConverter)(body).then((answer) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(answer));
      });
      return;
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    commands.push({ ...body, authorized: Boolean(req.headers.authorization) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ key: body['key'], ...commandAnswer }));
  });
});

beforeAll(async () => {
  await new Promise<void>((r) => notifyServer.listen(0, '127.0.0.1', () => r()));
  notifyPort = (notifyServer.address() as AddressInfo).port;
  await new Promise<void>((r) => commandServer.listen(18999, '127.0.0.1', () => r()));
  await new Promise<void>((r) => fileServer.listen(0, '127.0.0.1', () => r()));
  filePort = (fileServer.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((r) => notifyServer.close(() => r()));
  await new Promise<void>((r) => commandServer.close(() => r()));
  await new Promise<void>((r) => fileServer.close(() => r()));
  resetConsumers();
});

const crm = (): Consumer => ({
  id: 'crm',
  name: 'CRM',
  auth: { mode: 'api-key', key: 'crm-key' },
  profiles: ['document', 'template', 'view'],
  callbackUrl: `http://127.0.0.1:${notifyPort}/notify`,
  notificationSecretRef: 'EDITOR_NOTIFY_SECRET_TEST',
  panelOrigins: ['https://panel.test'],
  fileHosts: ['127.0.0.1'],
  convertSourceHosts: ['127.0.0.1'],
  convertUploadHosts: ['127.0.0.1'],
  returnOrigin: 'https://crm.test',
});
const fastmail: Consumer = { id: 'fastmail-connect', name: 'Connect for Fastmail', auth: { mode: 'api-key', key: 'fm-key' }, allowedCallbackDomains: [] };

beforeEach(() => {
  resetConsumers();
  setConsumersForTest([crm(), fastmail]);
  notified = [];
  notifyAnswer = 200;
  commands = [];
  commandAnswer = { error: 0 };
  converterBodies = [];
  converterAnswer = null;
  converterApp = null;
  resultBytes = PDF_BYTES;
  resultChunked = false;
  resultMode = 'ok';
  uploads = [];
});

const FILE = 'http://127.0.0.1:9/contract.docx';
const documentOpen = (over: Record<string, unknown> = {}) => ({
  profile: 'document',
  documentRef: 'doc_1',
  revision: '1',
  mode: 'e',
  fileUrl: FILE,
  fileName: 'Contract.docx',
  user: { id: 'u1', name: 'Rep One' },
  panelUrl: 'https://panel.test/editor-panel#token=abc',
  ...over,
});

async function open(body: Record<string, unknown>, key = 'crm-key') {
  const app = buildApp();
  const res = await app.inject({ method: 'POST', url: '/api/documents/open', headers: { authorization: `Bearer ${key}` }, payload: body });
  return { app, res };
}

describe('POST /api/documents/open — profiles (EDIT-2.3)', () => {
  it('opens a document session and returns a sealed editor URL with the key', async () => {
    const { res } = await open(documentOpen());
    expect(res.statusCode).toBe(200);
    const body = res.json<{ editorUrl: string; key: string; expiresAt: string }>();
    expect(body.key).toBe('crm.doc_1.e1');
    expect(body.editorUrl.startsWith('http://editor.test/editor/')).toBe(true);
    expect(body.editorUrl).not.toContain('crm.doc_1');
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
  });

  it.each([
    ['a dot in documentRef', documentOpen({ documentRef: 'doc.1' }), 'bad_key:bad_component'],
    ['view on an e key', documentOpen({ profile: 'view', panelUrl: undefined }), 'profile_mode_mismatch'],
    ['document on a v key', documentOpen({ mode: 'v' }), 'profile_mode_mismatch'],
    ['an unregistered panel origin', documentOpen({ panelUrl: 'https://evil.test/panel' }), 'panel_origin_not_registered'],
    ['a file host outside fileHosts', documentOpen({ fileUrl: 'http://8.8.8.8/x.docx' }), 'file_url_refused:host_not_allowed'],
    ['a legacy field', documentOpen({ callbackUrl: 'https://crm.test/cb' }), 'field_not_allowed'],
    ['missing key fields', documentOpen({ revision: undefined }), 'key_fields_required'],
  ])('refuses %s', async (_label, body, error) => {
    const { res } = await open(body);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe(error);
  });

  it('refuses a key over 128 characters', async () => {
    setConsumersForTest([{ ...crm(), id: 'crm_tenant_identifier', auth: { mode: 'api-key', key: 'long-key' } }]);
    const { res } = await open(documentOpen({ documentRef: 'd'.repeat(96), revision: 'r'.repeat(24) }), 'long-key');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('bad_key:too_long');
  });

  it('refuses a profile from a legacy-only consumer', async () => {
    const { res } = await open(documentOpen(), 'fm-key');
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toBe('profile_not_allowed');
  });

  it('opens a view session on a v key without a panel', async () => {
    const { res } = await open(documentOpen({ profile: 'view', mode: 'v', panelUrl: undefined }));
    expect(res.statusCode).toBe(200);
    expect(res.json<{ key: string }>().key).toBe('crm.doc_1.v1');
  });
});

describe('POST /api/documents/open — legacy shape (E1)', () => {
  it("opens fastmail-connect's view-only request (docs-proxy.ts)", async () => {
    const { res } = await open({ fileUrl: 'http://editor-api:3020/api/files/abc.docx', fileName: 'a.docx', user: { id: 'c1', name: 'Extension User' }, permissions: { edit: false, download: true, print: true } }, 'fm-key');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ key: string }>().key).toMatch(/^fastmail-connect\.legacy-[0-9a-f-]+\.v0$/);
  });

  it("opens the Connect extension's editable request without a callback (docs-api.ts)", async () => {
    const { res } = await open({ fileUrl: 'http://editor-api:3020/api/files/def.docx', fileName: 'b.docx', user: { id: 'extension-user', name: 'Extension User' } }, 'fm-key');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ key: string }>().key).toMatch(/\.e0$/);
  });

  it('refuses a per-request callbackUrl, saveTo, and GCS paths', async () => {
    const user = { id: 'u', name: 'U' };
    for (const body of [
      { fileUrl: FILE, user, callbackUrl: 'https://crm.test/cb' },
      { fileUrl: FILE, user, saveTo: { bucket: 'b', object: 'o' } },
      { fileUrl: 'gs://bucket/object.docx', user },
      { fileUrl: 'bucket/object.docx', user },
    ]) {
      const { res } = await open(body, 'fm-key');
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toBe('legacy_field_removed');
    }
  });

  it('refuses the legacy shape from a profile-capable consumer, so its keys always get the profile rules', async () => {
    const { res } = await open({ fileUrl: 'https://files.example.com/a.docx', user: { id: 'u', name: 'U' } });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('profile_required');
  });

  it('accepts an empty legacy fileName and falls back to the URL (as before EDIT-2)', async () => {
    const { res } = await open({ fileUrl: 'http://editor-api:3020/api/files/abc.docx', fileName: '', user: { id: 'u', name: 'U' } }, 'fm-key');
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /editor/:token (EDIT-2.3, 2.6)', () => {
  it('renders the editor with a signed config, a CSP, and no referrer', async () => {
    const { app, res } = await open(documentOpen({ fileName: '</title><script>alert(1)</script>.docx' }));
    const page = await app.inject({ method: 'GET', url: new URL(res.json<{ editorUrl: string }>().editorUrl).pathname });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    expect(page.body).not.toContain('<script>alert(1)</script>');
    const token = JSON.parse(/editorConfig\.token = (".*?");/.exec(page.body)?.[1] ?? '""') as string;
    const signed = jwt.verify(token, config.onlyofficeJwtSecret) as { document: { key: string; permissions: Record<string, boolean> }; editorConfig: { plugins: { autostart: string[]; disable: string[] } } };
    expect(signed.document.key).toBe('crm.doc_1.e1');
    expect(signed.document.permissions).toMatchObject({ modifyContentControl: false, protect: false });
    expect(signed.editorConfig.plugins.autostart).toEqual([BRIDGE_PLUGIN_GUID]);
    expect(signed.editorConfig.plugins.disable).toEqual([PLUGIN_MANAGER_GUID]);
  });

  it('shows the expired page: with a link for an expired token, without one for a tampered token', async () => {
    const app = buildApp();
    const expired = sealSession({ p: 'document', c: 'crm', k: 'crm.d.e1', u: { id: 'u', name: 'U' }, f: FILE, n: 'a.docx', exp: Date.now() - 1 }, config.sealKeys);
    const res1 = await app.inject({ method: 'GET', url: `/editor/${expired}` });
    expect(res1.statusCode).toBe(410);
    expect(res1.body).toContain('href="https://crm.test"');
    const tampered = `${expired.slice(0, -3)}${expired.slice(-3) === 'AAA' ? 'BBB' : 'AAA'}`;
    const res2 = await app.inject({ method: 'GET', url: `/editor/${tampered}` });
    expect(res2.statusCode).toBe(410);
    expect(res2.body).not.toContain('href=');
  });

  it('opens a token sealed with the previous seal key', async () => {
    const previousOnly = [config.sealKeys[1] as Buffer];
    const token = sealSession({ p: 'view', c: 'crm', k: 'crm.d.v1', u: { id: 'u', name: 'U' }, f: FILE, n: 'a.docx', exp: Date.now() + 60_000 }, previousOnly);
    const res = await buildApp().inject({ method: 'GET', url: `/editor/${token}` });
    expect(res.statusCode).toBe(200);
  });

  it('accepts a large real token, and routes a token of exactly MAX_TOKEN_CHARS to the page', async () => {
    const { app, res } = await open(documentOpen({ fileUrl: `http://127.0.0.1:9/${'a'.repeat(1900)}.docx`, panelUrl: `https://panel.test/p#${'t'.repeat(1000)}` }));
    expect(res.statusCode).toBe(200);
    const page = await app.inject({ method: 'GET', url: new URL(res.json<{ editorUrl: string }>().editorUrl).pathname });
    expect(page.statusCode).toBe(200);
    // The router must hand the longest possible token to the route (which then refuses this one as malformed).
    const longest = await app.inject({ method: 'GET', url: `/editor/${'A'.repeat(MAX_TOKEN_CHARS)}` });
    expect(longest.statusCode).toBe(410);
  });

  it('answers 500, not "too large", when no seal key is usable (a misconfiguration)', async () => {
    const keys = config.sealKeys;
    config.sealKeys = [];
    try {
      const { res } = await open(documentOpen());
      expect(res.statusCode).toBe(500);
      expect(res.json<{ error: string }>().error).toBe('seal_unavailable');
    } finally {
      config.sealKeys = keys;
    }
  });
});

/** The document URL DocumentServer is told to fetch, read from the rendered editor page. */
async function documentUrlOf(body: Record<string, unknown>, key = 'crm-key') {
  const { app, res } = await open(body, key);
  expect(res.statusCode).toBe(200);
  const page = await app.inject({ method: 'GET', url: new URL(res.json<{ editorUrl: string }>().editorUrl).pathname });
  const cfg = JSON.parse(/var editorConfig = (\{.*\});/.exec(page.body)?.[1] ?? '{}') as { document: { url: string } };
  return { app, url: cfg.document.url };
}

describe('GET /api/documents/source/:token (EDIT-2.2: the service fetches, pinned)', () => {
  const fileUrl = (name: string) => `http://127.0.0.1:${filePort}/${name}`;

  it("hands DocumentServer the service's source URL, never the consumer's, and serves the file", async () => {
    const { app, url } = await documentUrlOf(documentOpen({ fileUrl: fileUrl('contract.docx') }));
    expect(url.startsWith('http://editor-api:3020/api/documents/source/')).toBe(true);
    expect(url).not.toContain('127.0.0.1');
    const got = await app.inject({ method: 'GET', url: new URL(url).pathname });
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.equals(FILE_BYTES)).toBe(true);
    expect(got.headers['cache-control']).toBe('no-store');
  });

  it('hands a legacy internal /api/files/ URL over as it is', async () => {
    const { url } = await documentUrlOf({ fileUrl: 'http://editor-api:3020/api/files/abc.docx', user: { id: 'u', name: 'U' } }, 'fm-key');
    expect(url).toBe('http://editor-api:3020/api/files/abc.docx');
  });

  it('refuses an editor token, a tampered token, and a host the consumer no longer registers', async () => {
    const { app, url } = await documentUrlOf(documentOpen({ fileUrl: fileUrl('contract.docx') }));
    const sourcePath = new URL(url).pathname;
    const tampered = `${sourcePath.slice(0, -3)}${sourcePath.slice(-3) === 'AAA' ? 'BBB' : 'AAA'}`;
    expect((await app.inject({ method: 'GET', url: tampered })).statusCode).toBe(404);
    const editorToken = sealSession({ p: 'document', c: 'crm', k: 'crm.d.e1', u: { id: 'u', name: 'U' }, f: fileUrl('contract.docx'), n: 'a.docx', exp: Date.now() + 60_000 }, config.sealKeys);
    expect((await app.inject({ method: 'GET', url: `/api/documents/source/${editorToken}` })).statusCode).toBe(404);
    setConsumersForTest([{ ...crm(), fileHosts: ['files.example.com'] }, fastmail]);
    fileFetches = 0;
    expect((await app.inject({ method: 'GET', url: sourcePath })).statusCode).toBe(404);
    expect(fileFetches).toBe(0);
  });

  it('never follows a redirect, refuses an upstream error, and refuses a declared length over the cap before answering', async () => {
    for (const name of ['redirect.docx', 'missing.docx']) {
      const { app, url } = await documentUrlOf(documentOpen({ fileUrl: fileUrl(name) }));
      expect((await app.inject({ method: 'GET', url: new URL(url).pathname })).statusCode).toBe(502);
    }
    const cap = config.maxSourceBytes;
    config.maxSourceBytes = 1024;
    try {
      const { app, url } = await documentUrlOf(documentOpen({ fileUrl: fileUrl('declared-big.docx') }));
      const got = await app.inject({ method: 'GET', url: new URL(url).pathname });
      expect(got.statusCode).toBe(502);
      expect(got.json()).toEqual({ error: 'source_over_cap' });
    } finally {
      config.maxSourceBytes = cap;
    }
  });

  it('expires a source token (minted per page load, minutes not hours)', async () => {
    const stale = sealSource({ c: 'crm', k: 'crm.doc_1.e1', f: fileUrl('contract.docx'), exp: Date.now() - 1 }, config.sealKeys);
    fileFetches = 0;
    expect((await buildApp().inject({ method: 'GET', url: `/api/documents/source/${stale}` })).statusCode).toBe(404);
    expect(fileFetches).toBe(0);
    const { url } = await documentUrlOf(documentOpen({ fileUrl: fileUrl('contract.docx') }));
    const opened = openSource(new URL(url).pathname.split('/').pop() ?? '', config.sealKeys);
    expect(opened.ok && opened.payload.exp - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it('admits a conversion token only while its conversion runs', async () => {
    const token = sealSource({ c: 'crm', k: 'crm.convert_gone.v0', f: fileUrl('contract.docx'), exp: Date.now() + 60_000, h: 'convert', n: 'gone' }, config.sealKeys);
    fileFetches = 0;
    expect((await buildApp().inject({ method: 'GET', url: `/api/documents/source/${token}` })).statusCode).toBe(404);
    expect(fileFetches).toBe(0);
    expectSource('live');
    try {
      const live = sealSource({ c: 'crm', k: 'crm.convert_live.v0', f: fileUrl('contract.docx'), exp: Date.now() + 60_000, h: 'convert', n: 'live' }, config.sealKeys);
      expect((await buildApp().inject({ method: 'GET', url: `/api/documents/source/${live}` })).statusCode).toBe(200);
    } finally {
      endSource('live');
    }
  });

  it('checks an editing token against fileHosts and a conversion token against convertSourceHosts', async () => {
    setConsumersForTest([{ ...crm(), fileHosts: ['127.0.0.1'], convertSourceHosts: ['localhost'] }, fastmail]);
    const viaLocalhost = `http://localhost:${filePort}/contract.docx`;
    const viaIp = fileUrl('contract.docx');
    const edit = (f: string) => sealSource({ c: 'crm', k: 'crm.d.e1', f, exp: Date.now() + 60_000 }, config.sealKeys);
    expectSource('scope');
    try {
      const conv = (f: string) => sealSource({ c: 'crm', k: 'crm.convert_scope.v0', f, exp: Date.now() + 60_000, h: 'convert', n: 'scope' }, config.sealKeys);
      const app = buildApp();
      const status = async (t: string) => (await app.inject({ method: 'GET', url: `/api/documents/source/${t}` })).statusCode;
      expect(await status(edit(viaIp))).toBe(200);
      expect(await status(edit(viaLocalhost))).toBe(404);
      expect(await status(conv(viaLocalhost))).toBe(200);
      expect(await status(conv(viaIp))).toBe(404);
    } finally {
      endSource('scope');
    }
  });

  it('gives up on a slow source at EDITOR_SOURCE_TIMEOUT_MS with an error before any byte (ADR F17)', async () => {
    const limit = config.sourceTimeoutMs;
    config.sourceTimeoutMs = 500;
    try {
      const { app, url } = await documentUrlOf(documentOpen({ fileUrl: fileUrl('endless.docx') }));
      const started = Date.now();
      const res = await app.inject({ method: 'GET', url: new URL(url).pathname });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: 'source_unavailable' });
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      config.sourceTimeoutMs = limit;
    }
  });

  it('limits tokens that do not open per address, like every other route', async () => {
    const max = config.rateLimitMax;
    config.rateLimitMax = 5;
    try {
      const app = buildApp();
      const codes: number[] = [];
      for (let i = 0; i < 6; i += 1) codes.push((await app.inject({ method: 'GET', url: `/api/documents/source/garbage${i}` })).statusCode);
      expect(codes.slice(0, 5).every((c) => c === 404)).toBe(true);
      expect(codes[5]).toBe(429);
    } finally {
      config.rateLimitMax = max;
    }
  });

  it('limits fetches per source token, not per address', async () => {
    const { app, url } = await documentUrlOf(documentOpen({ fileUrl: fileUrl('contract.docx') }));
    const codes: number[] = [];
    for (let i = 0; i < 11; i += 1) codes.push((await app.inject({ method: 'GET', url: new URL(url).pathname })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
    // Another token from the same address is not affected.
    const second = await documentUrlOf(documentOpen({ fileUrl: fileUrl('contract.docx') }));
    expect((await app.inject({ method: 'GET', url: new URL(second.url).pathname })).statusCode).toBe(200);
  });

  describe('over a real connection', () => {
    async function served(name: string) {
      const { app, url } = await documentUrlOf(documentOpen({ fileUrl: fileUrl(name) }));
      const address = await app.listen({ port: 0, host: '127.0.0.1' });
      return { app, target: `${address}${new URL(url).pathname}` };
    }

    it('answers 502 in the service shape when the first chunk is already over the cap', async () => {
      const cap = config.maxSourceBytes;
      config.maxSourceBytes = 1024;
      const { app, target } = await served('big.docx');
      try {
        const res = await fetch(target);
        expect(res.status).toBe(502);
        expect(await res.json()).toEqual({ error: 'source_over_cap' });
      } finally {
        config.maxSourceBytes = cap;
        await app.close();
      }
    });

    it('refuses a cap passed part way through the read before answering anything (ADR F17)', async () => {
      const cap = config.maxSourceBytes;
      config.maxSourceBytes = 1024;
      const { app, target } = await served('late-big.docx');
      try {
        const res = await fetch(target);
        expect(res.status).toBe(502);
        expect(await res.json()).toEqual({ error: 'source_over_cap' });
      } finally {
        config.maxSourceBytes = cap;
        await app.close();
      }
    });

    it('serves a compressed upstream whole: its compressed length is never forwarded', async () => {
      const { app, target } = await served('gzip.docx');
      try {
        const res = await fetch(target);
        expect(res.status).toBe(200);
        const bytes = Buffer.from(await res.arrayBuffer());
        expect(bytes.equals(LARGE_BYTES)).toBe(true);
      } finally {
        await app.close();
      }
    });

    it('refuses an upstream that dies part way before answering anything, never a short file (ADR F17)', async () => {
      const { app, target } = await served('dies.docx');
      try {
        const res = await fetch(target);
        expect(res.status).toBe(502);
        expect(await res.json()).toEqual({ error: 'source_unavailable' });
      } finally {
        await app.close();
      }
    });

    it('answers 502 at once, and stops reading the source, when its conversion ends (battery E3b)', async () => {
      const app = buildApp();
      const address = await app.listen({ port: 0, host: '127.0.0.1' });
      try {
        endlessClosedAt = 0;
        expectSource('probe1');
        const token = sealSource({ c: 'crm', k: 'crm.convert_probe1.v0', f: fileUrl('endless.docx'), exp: Date.now() + 60_000, h: 'convert', n: 'probe1' }, config.sealKeys);
        const pending = fetch(`${address}/api/documents/source/${token}`);
        await new Promise((r) => setTimeout(r, 300));
        const endedAt = Date.now();
        endSource('probe1');
        const res = await pending;
        expect(res.status).toBe(502);
        expect(Date.now() - endedAt).toBeLessThan(1000);
        for (let i = 0; i < 40 && endlessClosedAt === 0; i += 1) await new Promise((r) => setTimeout(r, 50));
        expect(endlessClosedAt).toBeGreaterThanOrEqual(endedAt);
      } finally {
        await app.close();
      }
    });

    it('bounds the reads held in memory at once with an immediate 503', async () => {
      const limit = config.sourceConcurrency;
      config.sourceConcurrency = 1;
      const first = await served('endless.docx');
      const { url } = await documentUrlOf(documentOpen({ fileUrl: fileUrl('contract.docx') }));
      try {
        const abort = new AbortController();
        const pending = fetch(first.target, { signal: abort.signal }).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 300));
        const second = await first.app.inject({ method: 'GET', url: new URL(url).pathname });
        expect(second.statusCode).toBe(503);
        expect(second.json()).toEqual({ error: 'busy' });
        abort.abort();
        await pending;
        // The hang-up released the slot: the next read is admitted.
        await new Promise((r) => setTimeout(r, 200));
        const third = await first.app.inject({ method: 'GET', url: new URL(url).pathname });
        expect(third.statusCode).toBe(200);
      } finally {
        config.sourceConcurrency = limit;
        await first.app.close();
      }
    });

    it('stops pulling from the consumer when DocumentServer hangs up', async () => {
      const { app, target } = await served('endless.docx');
      try {
        endlessClosedAt = 0;
        const abort = new AbortController();
        const pending = fetch(target, { signal: abort.signal }).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 300));
        const abortedAt = Date.now();
        abort.abort();
        await pending;
        for (let i = 0; i < 40 && endlessClosedAt === 0; i += 1) await new Promise((r) => setTimeout(r, 50));
        expect(endlessClosedAt).toBeGreaterThanOrEqual(abortedAt);
        expect(endlessClosedAt - abortedAt).toBeLessThan(2000);
      } finally {
        await app.close();
      }
    });
  });
});

function signedCallback(payload: Record<string, unknown>) {
  return {
    method: 'POST' as const,
    url: '/api/documents/callback',
    headers: { authorization: `Bearer ${jwt.sign({ payload }, config.onlyofficeJwtSecret)}` },
    payload: { ...payload, token: jwt.sign(payload, config.onlyofficeJwtSecret) },
  };
}

const SAVE = { key: 'crm.doc_1.e1', status: 2, url: 'http://ds-public.test/cache/files/data/crm.doc_1.e1_1/output.docx/output.docx?md5=x&expires=9', users: ['u1'], lastsave: '2026-10-18T02:00:00.000Z' };

describe('POST /api/documents/callback (EDIT-2.4)', () => {
  it('notifies the consumer with a signed body the reference verifier accepts, and acknowledges', async () => {
    const res = await buildApp().inject(signedCallback(SAVE));
    expect(res.json()).toEqual({ error: 0 });
    const got = notified[0];
    expect(got).toBeDefined();
    const verified = verifyNotification({
      rawBody: got?.body ?? '',
      timestampHeader: got?.headers['x-editor-timestamp'] as string,
      signatureHeader: got?.headers['x-editor-signature'] as string,
      deliveryHeader: got?.headers['x-editor-delivery'] as string,
      secrets: [config.notifySecrets['EDITOR_NOTIFY_SECRET_TEST'] as string],
      isKnownKey: (k) => k === 'crm.doc_1.e1',
      seenDelivery: () => false,
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.body).toMatchObject({ documentRef: 'doc_1', revision: '1', mode: 'e', status: 2, event: 'saved' });
      expect(String(verified.body['downloadUrl']).startsWith('http://ds-public.test/cache/files/')).toBe(true);
    }
  });

  it('answers DocumentServer 503 when the consumer fails, so a final save is retried (ADR F1)', async () => {
    notifyAnswer = 401;
    const res = await buildApp().inject(signedCallback(SAVE));
    expect(res.statusCode).toBe(503);
  });

  it("refuses the editor page's own token used as a callback token", async () => {
    const pageToken = jwt.sign({ document: { key: SAVE.key }, editorConfig: {}, ...SAVE }, config.onlyofficeJwtSecret);
    const res = await buildApp().inject({ method: 'POST', url: '/api/documents/callback', headers: { authorization: `Bearer ${pageToken}` }, payload: SAVE });
    expect(res.statusCode).toBe(403);
    expect(notified).toHaveLength(0);
  });

  it('refuses a save URL on another host and a body that disagrees with its token', async () => {
    const evil = { ...SAVE, url: 'https://evil.test/x.docx' };
    expect((await buildApp().inject(signedCallback(evil))).statusCode).toBe(403);
    const mismatched = { ...signedCallback(SAVE), payload: { ...SAVE, url: 'http://ds-public.test/cache/files/data/other/output.docx' } };
    expect((await buildApp().inject(mismatched)).statusCode).toBe(403);
    expect(notified).toHaveLength(0);
  });

  it('forwards no download URL on a status that carries no save', async () => {
    await buildApp().inject(signedCallback({ key: 'crm.doc_1.e1', status: 3, url: SAVE.url, users: ['u1'] }));
    expect(JSON.parse(notified[0]?.body ?? '{}')).toMatchObject({ status: 3, event: 'save_error' });
    expect(JSON.parse(notified[0]?.body ?? '{}')['downloadUrl']).toBeUndefined();
  });

  it('forwards connect events without a deliveryId, and acknowledges keys from before stateless sessions', async () => {
    await buildApp().inject(signedCallback({ key: 'crm.doc_1.e1', status: 1, users: ['u1'], actions: [{ type: 1, userid: 'u1' }] }));
    expect(JSON.parse(notified[0]?.body ?? '{}')).toMatchObject({ status: 1, event: 'editing', users: ['u1'], actions: [{ type: 1, userid: 'u1' }] });
    expect(notified[0]?.headers['x-editor-delivery']).toBeUndefined();
    const old = await buildApp().inject(signedCallback({ key: '1b4e28ba-2fa1-11d2-883f-0016d3cca427', status: 2, url: SAVE.url }));
    expect(old.json()).toEqual({ error: 0 });
    expect(notified).toHaveLength(1);
  });
});

describe('drop and forgotten files (EDIT-2.5)', () => {
  it("drives DocumentServer's drop for the key's own consumer only", async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/documents/keys/crm.doc_1.e1/drop', headers: { authorization: 'Bearer crm-key' }, payload: { users: ['u1'] } });
    expect(res.json()).toEqual({ result: 'ok' });
    expect(commands[0]).toMatchObject({ c: 'drop', key: 'crm.doc_1.e1', users: ['u1'], authorized: true });
    const other = await app.inject({ method: 'POST', url: '/api/documents/keys/crm.doc_1.e1/drop', headers: { authorization: 'Bearer fm-key' }, payload: { users: ['u1'] } });
    expect(other.statusCode).toBe(403);
    commandAnswer = { error: 1 };
    const missing = await app.inject({ method: 'POST', url: '/api/documents/keys/crm.doc_9.e1/drop', headers: { authorization: 'Bearer crm-key' }, payload: { users: ['u1'] } });
    expect(missing.json()).toEqual({ error: 'key_not_found' });
    expect(missing.statusCode).toBe(404);
  });

  it.each([
    [3, 502, 'docserver_internal'],
    [6, 502, 'invalid_token'],
    [4, 409, 'no_changes'],
    [5, 409, 'command_not_correct'],
  ])('maps drop error %i to HTTP %i', async (error, status, name) => {
    commandAnswer = { error };
    const res = await buildApp().inject({ method: 'POST', url: '/api/documents/keys/crm.doc_1.e1/drop', headers: { authorization: 'Bearer crm-key' }, payload: { users: ['u1'] } });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error: name });
  });

  it('never answers "none" or "ok" for forgotten files when DocumentServer is failing', async () => {
    const app = buildApp();
    for (const error of [3, 6]) {
      commandAnswer = { error };
      const got = await app.inject({ method: 'GET', url: '/api/documents/keys/crm.doc_1.e1/forgotten', headers: { authorization: 'Bearer crm-key' } });
      expect(got.statusCode).toBe(502);
      const del = await app.inject({ method: 'DELETE', url: '/api/documents/keys/crm.doc_1.e1/forgotten', headers: { authorization: 'Bearer crm-key' } });
      expect(del.statusCode).toBe(502);
    }
    commandAnswer = { error: 0 };
    const noUrl = await app.inject({ method: 'GET', url: '/api/documents/keys/crm.doc_1.e1/forgotten', headers: { authorization: 'Bearer crm-key' } });
    expect(noUrl.statusCode).toBe(502);
    commandAnswer = { error: 1 };
    const del = await app.inject({ method: 'DELETE', url: '/api/documents/keys/crm.doc_1.e1/forgotten', headers: { authorization: 'Bearer crm-key' } });
    expect(del.statusCode).toBe(404);
  });

  it('returns a forgotten final save on the public base, and releases it', async () => {
    commandAnswer = { error: 0, url: 'http://127.0.0.1:18999/cache/files/forgotten/crm.doc_1.e1/output.docx?md5=a' };
    const app = buildApp();
    const got = await app.inject({ method: 'GET', url: '/api/documents/keys/crm.doc_1.e1/forgotten', headers: { authorization: 'Bearer crm-key' } });
    expect(got.json<{ downloadUrl: string }>().downloadUrl.startsWith('http://ds-public.test/cache/files/forgotten/')).toBe(true);
    commandAnswer = { error: 1 };
    const none = await app.inject({ method: 'GET', url: '/api/documents/keys/crm.doc_1.e1/forgotten', headers: { authorization: 'Bearer crm-key' } });
    expect(none.json()).toEqual({ none: true });
    commandAnswer = { error: 0 };
    const del = await app.inject({ method: 'DELETE', url: '/api/documents/keys/crm.doc_1.e1/forgotten', headers: { authorization: 'Bearer crm-key' } });
    expect(del.json()).toEqual({ result: 'ok' });
    expect(commands.map((c) => c['c'])).toEqual(['getForgotten', 'getForgotten', 'deleteForgotten']);
  });
});

describe('the converter probe (EDIT-6.3, ADR F17)', () => {
  it('converts the built-in sample through DocumentServer from the internal origin, under a fresh key each time', async () => {
    const app = buildApp();
    converterApp = app;
    converterBodies = [];
    const first = await app.inject({ method: 'GET', url: '/health/converter' });
    const second = await app.inject({ method: 'GET', url: '/health/converter' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ status: 'ok' });
    expect(second.statusCode).toBe(200);
    expect(converterBodies).toHaveLength(2);
    expect(converterBodies[0]).toMatchObject({ filetype: 'docx', outputtype: 'pdf', url: 'http://editor-api:3020/health/converter-sample.docx', authorized: true });
    expect(converterBodies[0]?.['key']).not.toBe(converterBodies[1]?.['key']);
    // The sample is a real DOCX (a ZIP), served to anyone who asks: nothing in it is secret.
    const sample = await app.inject({ method: 'GET', url: '/health/converter-sample.docx' });
    expect(sample.statusCode).toBe(200);
    expect(sample.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('answers 503 with a fixed code when the converter refuses or never finishes', async () => {
    const app = buildApp();
    converterApp = app;
    converterAnswer = async () => ({ error: -4 });
    const refused = await app.inject({ method: 'GET', url: '/health/converter' });
    expect(refused.statusCode).toBe(503);
    expect(refused.json()).toMatchObject({ status: 'unhealthy', detail: 'converter_-4' });
    converterAnswer = async () => ({ endConvert: false, percent: 0 });
    const stuck = await probeConverter(1500);
    expect(stuck.ok).toBe(false);
    expect(['poll', 'converter_unreachable', 'converter_answer']).toContain(stuck.detail);
    converterAnswer = () => new Promise((r) => setTimeout(() => r({ endConvert: true }), 3000));
    const silent = await probeConverter(500);
    expect(silent).toMatchObject({ ok: false });
    expect(['poll', 'converter_unreachable', 'converter_answer']).toContain(silent.detail);
  });

  it('answers only a direct loopback caller, whatever a forwarded header says, and one probe at a time', async () => {
    const app = buildApp();
    converterApp = app;
    converterBodies = [];
    const outside = await app.inject({ method: 'GET', url: '/health/converter', remoteAddress: '203.0.113.9', headers: { 'x-forwarded-for': '127.0.0.1' } });
    expect(outside.statusCode).toBe(404);
    const mappedOutside = await app.inject({ method: 'GET', url: '/health/converter', remoteAddress: '::ffff:10.0.0.7' });
    expect(mappedOutside.statusCode).toBe(404);
    expect(converterBodies).toHaveLength(0);
    // Loopback in its IPv4-mapped form is still loopback.
    const mappedLoopback = await app.inject({ method: 'GET', url: '/health/converter', remoteAddress: '::ffff:127.0.0.1' });
    expect(mappedLoopback.statusCode).toBe(200);
    converterBodies = [];
    converterAnswer = () => new Promise((r) => setTimeout(() => r({ endConvert: true, fileUrl: 'http://127.0.0.1:18999/cache/files/p.pdf' }), 300));
    const [a, b] = await Promise.all([app.inject({ method: 'GET', url: '/health/converter' }), app.inject({ method: 'GET', url: '/health/converter' })]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 429]);
  });
});

describe('POST /api/documents/convert (EDIT-3)', () => {
  const at = (p: string) => `http://127.0.0.1:${filePort}${p}`;
  async function convert(body: Record<string, unknown>, key = 'crm-key') {
    const app = buildApp();
    converterApp = app;
    const res = await app.inject({ method: 'POST', url: '/api/documents/convert', headers: { authorization: `Bearer ${key}` }, payload: body });
    return res;
  }

  it('converts through the source route and uploads the PDF with its length, answering size and sha256', async () => {
    const res = await convert({ sourceUrl: at('/contract.docx'), uploadUrl: at('/upload/ok') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ size: PDF_BYTES.length, sha256: createHash('sha256').update(PDF_BYTES).digest('hex') });
    const sent = converterBodies[0];
    expect(sent).toMatchObject({ async: false, filetype: 'docx', outputtype: 'pdf', authorized: true });
    expect(String(sent?.['url']).startsWith('http://editor-api:3020/api/documents/source/')).toBe(true);
    expect(String(sent?.['url'])).not.toContain('127.0.0.1');
    expect(String(sent?.['key'])).toMatch(/^crm\.convert_[0-9a-f]{32}\.v0$/);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.bytes.equals(PDF_BYTES)).toBe(true);
    expect(uploads[0]?.type).toBe('application/pdf');
    expect(uploads[0]?.length).toBe(String(PDF_BYTES.length));
  });

  it('holds a result without a declared length in memory and still uploads it with one', async () => {
    resultChunked = true;
    const res = await convert({ sourceUrl: at('/contract.docx'), uploadUrl: at('/upload/ok') });
    expect(res.statusCode).toBe(200);
    expect(uploads[0]?.length).toBe(String(PDF_BYTES.length));
  });

  it.each([
    ['a source host outside convertSourceHosts', { sourceUrl: 'http://8.8.8.8/a.docx', uploadUrl: 'http://127.0.0.1:9/u' }, 400, 'source_url_refused'],
    ['a metadata source', { sourceUrl: 'http://169.254.169.254/latest/meta-data/', uploadUrl: 'http://127.0.0.1:9/u' }, 400, 'source_url_refused'],
    ['an upload host outside convertUploadHosts', { sourceUrl: 'http://127.0.0.1:9/a.docx', uploadUrl: 'http://8.8.8.8/u' }, 400, 'upload_url_refused'],
  ])('refuses %s before anything is fetched', async (_label, body, status, error) => {
    const res = await convert(body);
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error });
    expect(converterBodies).toHaveLength(0);
  });

  it('names the source failure DocumentServer reports only as "download failed"', async () => {
    const cap = config.maxSourceBytes;
    config.maxSourceBytes = 1024;
    try {
      const big = await convert({ sourceUrl: at('/declared-big.docx'), uploadUrl: at('/upload/ok') });
      expect(big.statusCode).toBe(413);
      expect(big.json()).toEqual({ error: 'input_too_large' });
    } finally {
      config.maxSourceBytes = cap;
    }
    const missing = await convert({ sourceUrl: at('/missing.docx'), uploadUrl: at('/upload/ok') });
    expect(missing.json()).toEqual({ error: 'source_unavailable' });
    // A redirect from the source host is not followed.
    fileFetches = 0;
    const redirected = await convert({ sourceUrl: at('/redirect.docx'), uploadUrl: at('/upload/ok') });
    expect(redirected.json()).toEqual({ error: 'source_unavailable' });
    expect(uploads).toHaveLength(0);
  });

  it('maps a converter timeout, an unfinished conversion, and a converter error', async () => {
    const timeout = config.convertTimeoutMs;
    config.convertTimeoutMs = 300;
    converterAnswer = () => new Promise((r) => setTimeout(() => r({ endConvert: true }), 1000));
    try {
      const slow = await convert({ sourceUrl: at('/contract.docx'), uploadUrl: at('/upload/ok') });
      expect(slow.statusCode).toBe(504);
      expect(slow.json()).toEqual({ error: 'conversion_timeout' });
    } finally {
      config.convertTimeoutMs = timeout;
    }
    // "Not finished" is polled (the same request again) until the deadline.
    config.convertTimeoutMs = 2500;
    try {
      converterAnswer = async () => ({ endConvert: false, percent: 40 });
      expect((await convert({ sourceUrl: at('/contract.docx'), uploadUrl: at('/upload/ok') })).json()).toEqual({ error: 'conversion_timeout' });
      expect(converterBodies.length).toBeGreaterThanOrEqual(2);
      converterBodies = [];
      let calls = 0;
      converterAnswer = async (body) => (++calls < 2 ? { endConvert: false, percent: 60 } : defaultConverter(body));
      const polled = await convert({ sourceUrl: at('/contract.docx'), uploadUrl: at('/upload/ok') });
      expect(polled.statusCode).toBe(200);
      expect(new Set(converterBodies.map((b) => b['key'])).size).toBe(1);
    } finally {
      config.convertTimeoutMs = timeout;
    }
    converterAnswer = async () => ({ error: -3 });
    expect((await convert({ sourceUrl: at('/contract.docx'), uploadUrl: at('/upload/ok') })).json()).toEqual({ error: 'conversion_failed' });
    converterAnswer = async () => ({ endConvert: true, fileUrl: 'https://evil.test/output.pdf' });
    expect((await convert({ sourceUrl: at('/contract.docx'), uploadUrl: at('/upload/ok') })).json()).toEqual({ error: 'conversion_failed' });
  });

  it('stops its source fetch when a conversion ends, so DocumentServer is not left reading (battery E3b)', async () => {
    const timeout = config.convertTimeoutMs;
    config.convertTimeoutMs = 400;
    endlessClosedAt = 0;
    // DocumentServer starts reading the source and keeps waiting for it.
    converterAnswer = (body) => {
      void converterApp?.inject({ method: 'GET', url: new URL(String(body['url'])).pathname }).catch(() => undefined);
      return new Promise((r) => setTimeout(() => r({ error: -4 }), 3000));
    };
    try {
      const res = await convert({ sourceUrl: at('/endless.docx'), uploadUrl: at('/upload/ok') });
      const answeredAt = Date.now();
      expect(res.json()).toEqual({ error: 'conversion_timeout' });
      for (let i = 0; i < 40 && endlessClosedAt === 0; i += 1) await new Promise((r) => setTimeout(r, 50));
      expect(endlessClosedAt).toBeGreaterThan(0);
      expect(endlessClosedAt - answeredAt).toBeLessThan(1000);
    } finally {
      config.convertTimeoutMs = timeout;
    }
  });

  it('refuses a result over the output cap, and reports an upload that fails, redirects, or cannot connect', async () => {
    const cap = config.maxConvertOutputBytes;
    config.maxConvertOutputBytes = 10;
    try {
      const big = await convert({ sourceUrl: at('/contract.docx'), uploadUrl: at('/upload/ok') });
      expect(big.statusCode).toBe(413);
      expect(big.json()).toEqual({ error: 'output_too_large' });
      expect(uploads).toHaveLength(0);
    } finally {
      config.maxConvertOutputBytes = cap;
    }
    for (const uploadUrl of [at('/upload/fail'), at('/upload/redirect'), 'http://127.0.0.1:9/upload']) {
      const res = await convert({ sourceUrl: at('/contract.docx'), uploadUrl });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: 'upload_failed' });
    }
  });

  it('never uploads part of a result: a result short of its length fails before the upload; a gzip result arrives whole', async () => {
    resultMode = 'short';
    const short = await convert({ sourceUrl: at('/contract.docx'), uploadUrl: at('/upload/ok') });
    expect(short.statusCode).toBe(502);
    expect(short.json()).toEqual({ error: 'conversion_failed' });
    expect(uploads).toHaveLength(0);
    resultMode = 'empty';
    expect((await convert({ sourceUrl: at('/contract.docx'), uploadUrl: at('/upload/ok') })).json()).toEqual({ error: 'conversion_failed' });
    expect(uploads).toHaveLength(0);
    resultMode = 'gzip';
    resultBytes = Buffer.alloc(50_000, 9);
    const zipped = await convert({ sourceUrl: at('/contract.docx'), uploadUrl: at('/upload/ok') });
    expect(zipped.statusCode).toBe(200);
    expect(uploads[0]?.bytes.equals(resultBytes)).toBe(true);
  });

  it('refuses a metadata source even when the consumer lists its address', async () => {
    setConsumersForTest([{ ...crm(), convertSourceHosts: ['169.254.169.254', '127.0.0.1'] }, fastmail]);
    const res = await convert({ sourceUrl: 'http://169.254.169.254/latest/meta-data/', uploadUrl: at('/upload/ok') });
    expect(res.json()).toEqual({ error: 'source_url_refused' });
    expect(converterBodies).toHaveLength(0);
  });

  it('limits conversions in total, and a refused key leaks no slot', async () => {
    const total = config.convertConcurrencyTotal;
    config.convertConcurrencyTotal = 1;
    let release: () => void = () => undefined;
    converterAnswer = (body) => new Promise((r) => { release = () => void defaultConverter(body).then(r); });
    try {
      setConsumersForTest([crm(), { ...crm(), id: 'docs', auth: { mode: 'api-key', key: 'docs-key' } }, fastmail]);
      const first = convert({ sourceUrl: at('/contract.docx'), uploadUrl: at('/upload/ok') });
      await new Promise((r) => setTimeout(r, 100));
      const other = await convert({ sourceUrl: at('/contract.docx'), uploadUrl: at('/upload/ok') }, 'docs-key');
      expect(other.json()).toEqual({ error: 'busy' });
      release();
      expect((await first).statusCode).toBe(200);
    } finally {
      config.convertConcurrencyTotal = total;
    }
    // A consumer id too long for a key fails the key, twice, and still is not "busy" afterwards.
    setConsumersForTest([{ ...crm(), id: 'c'.repeat(90), auth: { mode: 'api-key', key: 'long-key' } }]);
    for (let i = 0; i < 3; i += 1) {
      expect((await convert({ sourceUrl: at('/contract.docx'), uploadUrl: at('/upload/ok') }, 'long-key')).json()).toEqual({ error: 'conversion_failed' });
    }
  });

  it('cancels a conversion whose consumer hangs up, so the retry is not refused as busy', async () => {
    const limit = config.convertConcurrency;
    config.convertConcurrency = 1;
    const app = buildApp();
    converterApp = app;
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      converterAnswer = () => new Promise((r) => setTimeout(() => r({ endConvert: false }), 300));
      const abort = new AbortController();
      const pending = fetch(`${address}/api/documents/convert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer crm-key' },
        body: JSON.stringify({ sourceUrl: at('/contract.docx'), uploadUrl: at('/upload/ok') }),
        signal: abort.signal,
      }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 200));
      abort.abort();
      await pending;
      await new Promise((r) => setTimeout(r, 600));
      converterAnswer = null;
      const retry = await app.inject({ method: 'POST', url: '/api/documents/convert', headers: { authorization: 'Bearer crm-key' }, payload: { sourceUrl: at('/contract.docx'), uploadUrl: at('/upload/ok') } });
      expect(retry.statusCode).toBe(200);
    } finally {
      config.convertConcurrency = limit;
      await app.close();
    }
  });

  it('limits concurrent conversions per consumer, and refuses a legacy-only consumer', async () => {
    const limit = config.convertConcurrency;
    config.convertConcurrency = 1;
    let release: () => void = () => undefined;
    converterAnswer = (body) => new Promise((r) => { release = () => void defaultConverter(body).then(r); });
    try {
      const first = convert({ sourceUrl: at('/contract.docx'), uploadUrl: at('/upload/ok') });
      await new Promise((r) => setTimeout(r, 100));
      const second = await convert({ sourceUrl: at('/contract.docx'), uploadUrl: at('/upload/ok') });
      expect(second.statusCode).toBe(429);
      expect(second.json()).toEqual({ error: 'busy' });
      release();
      expect((await first).statusCode).toBe(200);
    } finally {
      config.convertConcurrency = limit;
    }
    const legacy = await convert({ sourceUrl: at('/contract.docx'), uploadUrl: at('/upload/ok') }, 'fm-key');
    expect(legacy.statusCode).toBe(403);
  });
});

describe('CORS (consumer calls are server to server)', () => {
  it('admits no browser preflight for DELETE or other consumer-credential methods beyond GET and POST', async () => {
    const res = await buildApp().inject({
      method: 'OPTIONS',
      url: '/api/documents/keys/crm.doc_1.e1/forgotten',
      headers: { origin: 'https://crm.example.com', 'access-control-request-method': 'DELETE' },
    });
    expect(String(res.headers['access-control-allow-methods'] ?? '')).not.toContain('DELETE');
  });
});

describe('removed routes (consumer guide changelog)', () => {
  it('no longer serves /api/sessions or /api/documents/:key/download', async () => {
    const app = buildApp();
    expect((await app.inject({ method: 'GET', url: '/api/sessions', headers: { authorization: 'Bearer crm-key' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/documents/crm.d.e1/download', headers: { authorization: 'Bearer crm-key' } })).statusCode).toBe(404);
  });
});
