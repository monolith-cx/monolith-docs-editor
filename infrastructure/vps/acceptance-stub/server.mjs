// The acceptance stub consumer (EDIT-6.7). It stands in for a product on `monolith-dev` so the
// hosted editor can be accepted end to end before CRM's own receiver exists (UDOC-3.3):
//
//   GET  /launch?k=<launch key>   opens a `document` session (server-side, as a consumer's backend
//                                  does) and renders a page that frames the editor
//   GET  /fixtures/acceptance.docx the source document (synthetic)
//   GET  /panel/<file>             the consumer panel page the bridge plugin loads
//   POST /callback                 the notification receiver: verified as the consumer guide says
//   GET  /results?k=<launch key>   what the receiver saw, as facts only
//
// No dependencies. It stores no secret, token, or URL: only facts, in memory, bounded.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { inflateRawSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** The one place this process reads its environment. */
function loadConfig(env) {
  const missing = [];
  const need = (name) => {
    if (!env[name]) missing.push(name);
    return env[name] ?? '';
  };
  const config = {
    port: Number(env.PORT ?? 8080),
    stubDir: env.STUB_DIR ?? '/stub',
    stubOrigin: need('STUB_ORIGIN'),
    editorApi: need('EDITOR_API'),
    editorOrigin: need('EDITOR_PUBLIC_ORIGIN'),
    issuer: need('CONSUMER_ISSUER'),
    hmacSecret: need('CONSUMER_HMAC_SECRET'),
    notifySecret: need('NOTIFY_SECRET'),
    launchKey: need('LAUNCH_KEY'),
  };
  if (missing.length) {
    process.stderr.write(`missing ${missing.join(', ')}\n`);
    process.exit(1);
  }
  return config;
}

const config = loadConfig(process.env);

const MAX_CALLBACK_BYTES = 64 * 1024;
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_RESULTS = 200;
const MAX_KEYS = 100;
const MAX_DELIVERIES = 1000;

/** A set that forgets its oldest entries past `cap` (the stub runs for one acceptance run). */
function boundedSet(cap) {
  const set = new Set();
  return {
    has: (v) => set.has(v),
    get size() {
      return set.size;
    },
    add(v) {
      set.delete(v);
      set.add(v);
      if (set.size > cap) set.delete(set.values().next().value);
    },
  };
}

const issuedKeys = boundedSet(MAX_KEYS);
const seenDeliveries = boundedSet(MAX_DELIVERIES);
const results = [];
// Unauthenticated refusals are counted, not stored: the callback route is public.
const refusals = { stale: 0, bad_signature: 0 };

const TYPES = { '.html': 'text/html; charset=utf-8', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(payload);
}

function record(fact) {
  results.push(fact);
  if (results.length > MAX_RESULTS) results.shift();
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function sameSecret(given, expected) {
  const a = createHash('sha256').update(String(given ?? '')).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function base64url(data) {
  return Buffer.from(data).toString('base64url');
}

/** The consumer token for `open`: HS256 under the consumer's HMAC secret, one minute long. */
function consumerToken() {
  const now = Math.floor(Date.now() / 1000);
  const head = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify({ iss: config.issuer, iat: now, exp: now + 60 }));
  const sig = createHmac('sha256', config.hmacSecret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/** The request body, or null once it passes the cap (the request is then destroyed). */
async function readBody(req, cap) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > cap) {
      req.destroy();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const MARKER = /EDIT-6\.7 acceptance \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g;

/**
 * The text of `word/document.xml` in a DOCX, or null: read through the ZIP's central directory,
 * stored or deflated entries only. Enough to find the runner's typed marker; not a general reader.
 */
function documentText(zip) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > zip.length) return null;
  const entries = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < entries && at + 46 <= zip.length; i += 1) {
    if (zip.readUInt32LE(at) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    if (name === 'word/document.xml') {
      if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) return null;
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + compressed);
      const xml = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: MAX_DOWNLOAD_BYTES }) : null;
      return xml ? xml.toString('utf8').replace(/<[^>]+>/g, '') : null;
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/** A response body, or null once it passes the cap (leaving the loop cancels the stream). */
async function readCapped(response, cap) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > cap) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function serveFile(res, dir, name, type) {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith('.')) return send(res, 404, { error: 'not found' });
  try {
    const body = await readFile(path.join(dir, name));
    return send(res, 200, body, { 'Content-Type': type ?? TYPES[path.extname(name)] ?? 'application/octet-stream' });
  } catch {
    return send(res, 404, { error: 'not found' });
  }
}

async function launch(res) {
  const documentRef = `acc_${Date.now().toString(36)}`;
  const opened = await fetch(`${config.editorApi}/api/documents/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${consumerToken()}` },
    body: JSON.stringify({
      profile: 'document',
      documentRef,
      revision: '1',
      mode: 'e',
      fileUrl: `${config.stubOrigin}/fixtures/acceptance.docx`,
      fileName: 'acceptance.docx',
      user: { id: 'acceptance-user', name: 'Acceptance User' },
      panelUrl: `${config.stubOrigin}/panel/bridge.html#pluginOrigin=${encodeURIComponent(config.editorOrigin)}`,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const answer = await opened.json().catch(() => ({}));
  if (opened.status !== 200 || typeof answer.key !== 'string' || typeof answer.editorUrl !== 'string' || !answer.editorUrl.startsWith(`${config.editorOrigin}/editor/`)) {
    return send(res, 502, { error: 'open refused', status: opened.status, code: typeof answer.error === 'string' ? answer.error : null });
  }
  issuedKeys.add(answer.key);
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Editor acceptance</title>
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style></head>
<body><iframe id="editor" data-key="${escapeHtml(answer.key)}" src="${escapeHtml(answer.editorUrl)}" allow="clipboard-read; clipboard-write"></iframe></body></html>`;
  return send(res, 200, html, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; frame-src ${config.editorOrigin}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    'Referrer-Policy': 'no-referrer',
  });
}

/** The consumer guide's verification, in its order, against the raw body (reference verifier, EDIT-2.7). */
function verify(raw, headers) {
  const ts = Number(headers['x-editor-timestamp']);
  if (!Number.isInteger(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return { ok: false, reason: 'stale' };
  const expected = Buffer.from(createHmac('sha256', config.notifySecret).update(`${headers['x-editor-timestamp']}.${raw}`).digest('hex'), 'hex');
  const signed = String(headers['x-editor-signature'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^v1=[0-9a-f]{64}$/i.test(s))
    .some((s) => timingSafeEqual(Buffer.from(s.slice(3), 'hex'), expected));
  if (!signed) return { ok: false, reason: 'bad_signature' };
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof body.key !== 'string' || !issuedKeys.has(body.key)) return { ok: false, reason: 'unknown_key' };
  if (body.status === 2 || body.status === 6) {
    if (typeof body.deliveryId !== 'string' || body.deliveryId !== headers['x-editor-delivery']) return { ok: false, reason: 'delivery_mismatch', body };
    if (seenDeliveries.has(body.deliveryId)) return { ok: false, reason: 'replay', body };
  }
  return { ok: true, body };
}

/** Fetch a save, only from the editor's origin (guide, section 4), with no redirect and a size cap. */
async function download(url) {
  let origin = null;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = null;
  }
  if (origin !== config.editorOrigin) return { origin, downloaded: { refused: 'download origin is not the editor' } };
  const file = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!file || !file.ok || !file.body) return { origin, downloaded: { failed: file ? file.status : 'network' } };
  const bytes = await readCapped(file, MAX_DOWNLOAD_BYTES).catch(() => null);
  if (!bytes) return { origin, downloaded: { failed: 'too large or interrupted' } };
  let text = null;
  try {
    text = documentText(bytes);
  } catch {
    text = null;
  }
  return {
    origin,
    downloaded: { bytes: bytes.length, zip: bytes.subarray(0, 4).toString('hex') === '504b0304', hasDocumentXml: text !== null, markers: text ? [...new Set(text.match(MARKER) ?? [])] : [] },
  };
}

async function callback(req, res) {
  const rawBuffer = await readBody(req, MAX_CALLBACK_BYTES);
  if (!rawBuffer) return undefined;
  const checked = verify(rawBuffer.toString('utf8'), req.headers);
  if (!checked.ok && (checked.reason === 'stale' || checked.reason === 'bad_signature')) {
    refusals[checked.reason] += 1;
    return send(res, 401, { error: checked.reason });
  }
  const fact = { at: new Date().toISOString(), valid: checked.ok, reason: checked.ok ? null : checked.reason };
  if (checked.body) Object.assign(fact, { key: checked.body.key, status: checked.body.status, event: checked.body.event ?? null });
  if (!checked.ok) {
    record(fact);
    // A replayed save already stored is acknowledged so the service stops retrying (guide, Verifying).
    return checked.reason === 'replay' ? send(res, 200, { ok: true }) : send(res, 401, { error: checked.reason });
  }
  const { body } = checked;
  if (body.status === 2 || body.status === 6) {
    seenDeliveries.add(body.deliveryId);
    fact.deliveryId = body.deliveryId;
    const fetched = await download(body.downloadUrl);
    fact.downloadOrigin = fetched.origin;
    fact.downloaded = fetched.downloaded;
  }
  record(fact);
  return send(res, 200, { ok: true });
}

async function route(req, res) {
  const url = new URL(req.url, config.stubOrigin);
  const p = url.pathname;
  if (req.method === 'GET' && p === '/health') return send(res, 200, { ok: true });
  if (req.method === 'GET' && p === '/launch') {
    if (!sameSecret(url.searchParams.get('k'), config.launchKey)) return send(res, 404, { error: 'not found' });
    return launch(res);
  }
  if (req.method === 'GET' && p === '/results') {
    if (!sameSecret(url.searchParams.get('k'), config.launchKey)) return send(res, 404, { error: 'not found' });
    return send(res, 200, { issuedKeys: issuedKeys.size, refusals, results });
  }
  if (req.method === 'GET' && p === '/fixtures/acceptance.docx') return serveFile(res, path.join(config.stubDir, 'fixtures'), 'acceptance.docx');
  if (req.method === 'GET' && p.startsWith('/panel/')) return serveFile(res, path.join(config.stubDir, 'panel'), p.slice('/panel/'.length));
  if (req.method === 'POST' && p === '/callback') return callback(req, res);
  return send(res, 404, { error: 'not found' });
}

createServer((req, res) => {
  route(req, res).catch(() => {
    if (!res.headersSent) send(res, 500, { error: 'stub error' });
  });
}).listen(config.port, '0.0.0.0', () => process.stdout.write(`acceptance stub listening on ${config.port}\n`));
