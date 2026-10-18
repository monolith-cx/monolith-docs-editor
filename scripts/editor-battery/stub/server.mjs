// Battery stub (EDIT-1.2): stands in for a consumer and its storage.
//
// Origin A (18201): fixtures, editor pages, the probe plugin, the DocumentServer
//   callback receiver, and the control API the runner uses.
// Origin B (18202): a panel page on a different origin (UDOC-1.5 bridge tests).
// Origin C (18203): a third origin for CORS checks (spike item 9e).
//
// Everything it records is synthetic; the JWT secret is a random per-run value.
import { createServer } from 'node:http';
import { lookup } from 'node:dns/promises';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyJwt } from './jwt.mjs';

const SECRET = process.env.BATTERY_JWT_SECRET;
const NOTIFY_SECRET = process.env.BATTERY_NOTIFY_SECRET ?? '';
const DS_INTERNAL = process.env.DS_INTERNAL ?? 'http://ds';
const DS_PUBLIC = process.env.DS_PUBLIC ?? 'http://127.0.0.1:18200';
const WORK = '/work';
const STUB_DIR = path.dirname(new URL(import.meta.url).pathname);

const sessions = new Map();
let events = [];
let callbackMode = { mode: 'ok', count: 0 };
let consumerMode = { failLeft: 0, failStatus: 503 };
let saveCounter = 0;

const TYPES = {
  '.json': 'application/json',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function serveFile(res, root, rel, extraHeaders = {}) {
  const full = path.join(root, rel);
  if (!full.startsWith(root + path.sep)) return send(res, 400, { error: 'bad path' });
  try {
    const data = await readFile(full);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] ?? 'application/octet-stream', ...extraHeaders });
    res.end(data);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

function editorPage(session) {
  const cfg = Buffer.from(JSON.stringify(session.config)).toString('base64');
  return `<!doctype html><html><head><meta charset="utf-8"><title>editor-battery</title>
<script src="${DS_PUBLIC}/web-apps/apps/api/documents/api.js"></script></head>
<body style="margin:0"><div id="placeholder"></div>
<script>
window.__events = [];
const cfg = JSON.parse(atob(${JSON.stringify(cfg)}));
cfg.width = '100%'; cfg.height = '900px';
cfg.events = {
  onAppReady: () => window.__events.push(['appReady']),
  onDocumentReady: () => { window.__ready = true; window.__events.push(['documentReady']); },
  onError: (e) => window.__events.push(['error', e && e.data]),
  onWarning: (e) => window.__events.push(['warning', e && e.data]),
  onRequestClose: () => window.__events.push(['requestClose']),
};
window.docEditor = new DocsAPI.DocEditor('placeholder', cfg);
</script></body></html>`;
}

async function downloadSaved(url, key, status) {
  // DocumentServer may emit its public origin; fetch through the internal one and record which it was.
  const parsed = new URL(url);
  const internal = new URL(parsed.pathname + parsed.search, DS_INTERNAL);
  const res = await fetch(internal, { redirect: 'manual' });
  if (!res.ok) return { error: `download ${res.status}` };
  const buf = Buffer.from(await res.arrayBuffer());
  saveCounter += 1;
  const name = `${key.replace(/[^A-Za-z0-9_.-]/g, '_')}.s${status}.${saveCounter}.docx`;
  await mkdir(path.join(WORK, 'saved'), { recursive: true });
  await writeFile(path.join(WORK, 'saved', name), buf);
  return { file: name, bytes: buf.length };
}

async function handleCallback(req, res) {
  const raw = await readBody(req);
  const bodyHash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  let body = {};
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    body = {};
  }
  const auth = req.headers.authorization ?? '';
  const headerToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const headerPayload = headerToken ? verifyJwt(headerToken, SECRET) : null;
  const bodyPayload = body.token ? verifyJwt(body.token, SECRET) : null;
  const verified = headerPayload ?? bodyPayload;
  const signedBody = verified && verified.payload ? verified.payload : verified;
  // A fingerprint per signed field (never the values), so retries can be compared field by field.
  const fingerprint = {};
  if (signedBody) {
    for (const [k, v] of Object.entries(signedBody)) {
      fingerprint[k] = createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex').slice(0, 12);
    }
  }
  const tokenTimes = verified ? { iat: verified.iat ?? null, exp: verified.exp ?? null } : null;
  const event = {
    t: Date.now(),
    kind: 'callback',
    key: body.key,
    status: body.status,
    users: body.users,
    actions: body.actions,
    forcesavetype: body.forcesavetype,
    userdata: body.userdata,
    tokenPlace: headerToken ? 'header' : body.token ? 'body' : 'none',
    bodyTokenShape: bodyPayload ? (bodyPayload.payload ? 'payload-wrapped' : 'flat') : body.token ? 'unverified' : 'absent',
    signedFields: fingerprint,
    tokenTimes,
    urlQueryNames: body.url ? [...new URL(body.url).searchParams.keys()].sort() : undefined,
    payloadShape: verified ? (verified.payload ? 'payload-wrapped' : 'flat') : 'unverified',
    signedMatchesBody: signedBody ? signedBody.key === body.key && signedBody.status === body.status && signedBody.url === body.url : false,
    urlOrigin: body.url ? new URL(body.url).origin : undefined,
    urlPath: body.url ? new URL(body.url).pathname : undefined,
    bodyHash,
    bodyKeys: Object.keys(body).sort(),
    modeApplied: callbackMode.mode,
  };
  if ((body.status === 2 || body.status === 3 || body.status === 6 || body.status === 7) && body.url) {
    event.saved = await downloadSaved(body.url, body.key ?? 'unknown', body.status).catch((err) => ({ error: String(err) }));
  }
  events.push(event);
  callbackMode.count += 1;
  switch (callbackMode.mode) {
    case 'error':
      return send(res, 200, { error: 1 });
    case 'http500':
      return send(res, 500, { error: 'consumer down' });
    case 'http401':
      return send(res, 401, { error: 'unauthorized' });
    case 'http503':
      return send(res, 503, { error: 'unavailable' });
    case 'http429':
      return send(res, 429, { error: 'slow down' });
    case 'hang':
      return; // never answer; DocumentServer's own timeout decides
    default:
      return send(res, 200, { error: 0 });
  }
}

/** Which compose service made a request (`api`, `ds`, or the address), by resolving the service names. */
async function fetcherOf(req) {
  const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  for (const name of ['api', 'ds']) {
    const addresses = await lookup(name, { all: true }).then((list) => list.map((a) => a.address), () => []);
    if (addresses.includes(remote)) return name;
  }
  return remote;
}

async function originA(req, res) {
  const url = new URL(req.url, 'http://stub');
  const p = url.pathname;
  if (req.method === 'GET' && p.startsWith('/fixtures/')) {
    events.push({ t: Date.now(), kind: 'fixture-fetch', path: p, ua: req.headers['user-agent'] ?? '', from: await fetcherOf(req) });
    return serveFile(res, path.join(WORK, 'fixtures'), p.slice('/fixtures/'.length));
  }
  if (req.method === 'GET' && p.startsWith('/plugins/')) {
    return serveFile(res, path.join(STUB_DIR, 'plugins'), p.slice('/plugins/'.length), {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
  }
  if (req.method === 'POST' && p === '/sessions') {
    const { config } = JSON.parse((await readBody(req)).toString('utf8'));
    const id = randomUUID();
    sessions.set(id, { config });
    return send(res, 200, { id });
  }
  if (req.method === 'GET' && p.startsWith('/editor/')) {
    const session = sessions.get(p.slice('/editor/'.length));
    if (!session) return send(res, 404, { error: 'no session' });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(editorPage(session));
  }
  if (req.method === 'POST' && p === '/callback') return handleCallback(req, res);
  if (req.method === 'POST' && p === '/consumer-callback') {
    // The consumer side of the service's signed notifications (EDIT-2.4): verify, record, answer as told.
    const raw = await readBody(req);
    let body = {};
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      body = {};
    }
    const ts = req.headers['x-editor-timestamp'];
    const sigs = String(req.headers['x-editor-signature'] ?? '').split(',').map((x) => x.trim().replace(/^v1=/, ''));
    const expected = createHmac('sha256', NOTIFY_SECRET).update(`${ts}.${raw.toString('utf8')}`).digest('hex');
    const signatureValid = sigs.some((sig) => sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
    const answer = consumerMode.failLeft > 0 ? consumerMode.failStatus : 200;
    if (consumerMode.failLeft > 0) consumerMode.failLeft -= 1;
    const event = {
      t: Date.now(),
      kind: 'consumer-callback',
      key: body.key,
      status: body.status,
      event: body.event,
      users: body.users,
      actions: body.actions,
      deliveryId: body.deliveryId,
      deliveryHeader: req.headers['x-editor-delivery'] ?? null,
      hasDownloadUrl: Boolean(body.downloadUrl),
      downloadOrigin: body.downloadUrl ? new URL(body.downloadUrl).origin : null,
      signatureValid,
      answered: answer,
    };
    if (answer === 200 && body.downloadUrl) {
      event.saved = await downloadSaved(body.downloadUrl, `consumer-${body.key}`, body.status ?? 0).catch((err) => ({ error: String(err) }));
    }
    events.push(event);
    return send(res, answer, answer === 200 ? { ok: true } : { error: 'consumer unavailable' });
  }
  if (req.method === 'POST' && p === '/control/consumer-mode') {
    const { failCount, failStatus } = JSON.parse((await readBody(req)).toString('utf8'));
    consumerMode = { failLeft: failCount ?? 0, failStatus: failStatus ?? 503 };
    return send(res, 200, { ok: true });
  }
  if (req.method === 'GET' && p === '/events') return send(res, 200, events);
  if (req.method === 'POST' && p === '/control/reset') {
    events = [];
    callbackMode = { mode: 'ok', count: 0 };
    consumerMode = { failLeft: 0, failStatus: 503 };
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && p === '/control/callback-mode') {
    const { mode } = JSON.parse((await readBody(req)).toString('utf8'));
    callbackMode = { mode, count: 0 };
    return send(res, 200, { ok: true });
  }
  if (req.method === 'GET' && p === '/saved') {
    return send(res, 200, events.filter((e) => e.saved && e.saved.file).map((e) => e.saved.file));
  }
  if (req.method === 'GET' && p.startsWith('/saved/')) {
    return serveFile(res, path.join(WORK, 'saved'), p.slice('/saved/'.length));
  }
  return send(res, 404, { error: 'not found' });
}

async function originB(req, res) {
  const p = new URL(req.url, 'http://stub').pathname;
  if (req.method === 'GET' && p.startsWith('/panel/')) {
    return serveFile(res, path.join(STUB_DIR, 'panel'), p.slice('/panel/'.length));
  }
  return send(res, 404, { error: 'not found' });
}

async function originC(req, res) {
  const p = new URL(req.url, 'http://stub').pathname;
  const allow = p === '/cors/yes' ? { 'Access-Control-Allow-Origin': req.headers.origin ?? '*', 'Access-Control-Allow-Headers': 'content-type' } : {};
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...allow, 'Access-Control-Allow-Methods': 'POST, GET' });
    return res.end();
  }
  if (p === '/cors/yes' || p === '/cors/no') {
    events.push({ t: Date.now(), kind: 'cors-call', path: p, origin: req.headers.origin ?? null });
    return send(res, 200, { ok: true, path: p }, allow);
  }
  return send(res, 404, { error: 'not found' });
}

const route = { 18201: originA, 18202: originB, 18203: originC };
for (const port of [18201, 18202, 18203]) {
  createServer((req, res) => {
    route[port](req, res).catch((err) => send(res, 500, { error: String(err) }));
  }).listen(port, '0.0.0.0');
}
process.stdout.write('stub listening on 18201, 18202, 18203\n');
