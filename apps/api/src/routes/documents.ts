/**
 * Document routes (EDIT-2, parent UDOC-1.2). Stateless: everything an editor page needs travels
 * in its sealed token, DocumentServer's callbacks are routed by the document key's consumer, and
 * the service keeps no session map and no database (D13).
 *
 *   POST   /api/documents/open                    consumer: open a session (profile or legacy shape)
 *   GET    /editor/:token                         public: the editor page (or the expired page)
 *   GET    /api/documents/source/:token           DocumentServer: the consumer's file, fetched by the service on a pinned address
 *   POST   /api/documents/callback                DocumentServer: verified, then notified to the consumer
 *   POST   /api/documents/keys/:key/drop          consumer: drop a key's users (the closing sequence)
 *   GET    /api/documents/keys/:key/forgotten     consumer: a final save DocumentServer kept (ADR F1)
 *   DELETE /api/documents/keys/:key/forgotten     consumer: release it after storing it
 *
 * Removed with the session map (consumer guide changelog): GET /api/documents/:key/download,
 * GET /api/sessions, per-request callbackUrl, saveTo, and GCS bucket/object file references.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Readable, Transform, pipeline } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import jwt from 'jsonwebtoken';
import { checkCallback } from '../callback-auth.js';
import { config } from '../config.js';
import type { Consumer, Profile } from '../consumers.js';
import { findConsumerById, getConsumers, notificationSecrets } from '../consumers.js';
import { buildKey, parseKey } from '../document-key.js';
import { COMMAND_ERRORS, command, onBase } from '../docserver.js';
import { buildEditorConfig } from '../editor-config.js';
import { renderEditorPage, renderExpiredPage } from '../editor-page.js';
import { hostOf, keyRef } from '../log-safety.js';
import { STATUS_EVENTS, buildNotification, deliver } from '../notify.js';
import { UrlRefused, checkUrl, safeFetch } from '../safe-url.js';
import type { SessionPayload } from '../session-token.js';
import { SealError, openSession, openSource, sealSession, sealSource, sessionExpiry } from '../session-token.js';

interface OpenBody {
  fileUrl: string;
  fileName?: string;
  user: { id: string; name: string };
  // Profile shape (EDIT-2.3)
  profile?: Profile;
  documentRef?: string;
  revision?: string;
  mode?: 'e' | 'v';
  panelUrl?: string;
  // Legacy shape (E1)
  permissions?: { edit?: boolean; download?: boolean; print?: boolean };
  callbackUrl?: string;
  saveTo?: unknown;
}

const openSchema = {
  body: {
    type: 'object',
    required: ['fileUrl', 'user'],
    properties: {
      fileUrl: { type: 'string', minLength: 1, maxLength: 2048 },
      fileName: { type: 'string', maxLength: 255 },
      user: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 128 },
          name: { type: 'string', minLength: 1, maxLength: 256 },
        },
        additionalProperties: false,
      },
      profile: { type: 'string', enum: ['document', 'template', 'view'] },
      documentRef: { type: 'string', minLength: 1, maxLength: 96 },
      revision: { type: 'string', minLength: 1, maxLength: 24 },
      mode: { type: 'string', enum: ['e', 'v'] },
      panelUrl: { type: 'string', minLength: 1, maxLength: 1024 },
      permissions: {
        type: 'object',
        properties: { edit: { type: 'boolean' }, download: { type: 'boolean' }, print: { type: 'boolean' } },
        additionalProperties: false,
      },
      callbackUrl: { type: 'string', maxLength: 2048 },
      saveTo: { type: 'object' },
    },
    additionalProperties: false,
  },
} as const;

const keyParams = {
  params: {
    type: 'object',
    required: ['key'],
    properties: { key: { type: 'string', minLength: 1, maxLength: 128 } },
  },
} as const;

const dropSchema = {
  ...keyParams,
  body: {
    type: 'object',
    required: ['users'],
    properties: { users: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 128 } } },
    additionalProperties: false,
  },
} as const;

/** The consumer a request acts as; an anonymous `local` consumer only when none are configured outside strict mode. */
function actingConsumer(req: FastifyRequest): Consumer | null {
  if (req.consumer) return req.consumer;
  if (!config.strict && getConsumers().length === 0) return { id: 'local', name: 'Local development', auth: { mode: 'api-key', key: '' } };
  return null;
}

function refuse(reply: FastifyReply, status: number, error: string) {
  return reply.status(status).send({ error });
}

/** How long a source token lives, and how many fetches one token may make (EDIT-2.2). */
const SOURCE_TOKEN_TTL_MS = 5 * 60 * 1000;
const SOURCE_FETCHES_PER_TOKEN = 10;
const SOURCE_OVER_CAP = 'source_over_cap';

/**
 * HTTP status for a DocumentServer command error: an unknown key is 404; DocumentServer's own
 * faults and a token it refused (a configuration fault) are 502; the rest describe the request (409).
 */
function commandStatus(error: number): number {
  if (error === 1) return 404;
  if (error === 3 || error === 6) return 502;
  return 409;
}

function inferFileName(fileUrl: string): string {
  try {
    const base = new URL(fileUrl).pathname.split('/').pop();
    if (base && base.includes('.')) return decodeURIComponent(base);
  } catch {
    /* not a URL */
  }
  return 'document.docx';
}

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  const callbackUrl = `${config.apiInternalUrl}/api/documents/callback`;
  const bridgePluginConfigUrl = `${config.apiPublicUrl}/plugins/udoc-bridge/config.json`;
  const legacyFilesPrefix = `${config.apiInternalUrl}/api/files/`;
  const sourcePrefix = `${config.apiInternalUrl}/api/documents/source/`;

  // --- Open ---
  app.post<{ Body: OpenBody }>('/api/documents/open', { schema: openSchema }, async (req, reply) => {
    const consumer = actingConsumer(req);
    if (!consumer) return refuse(reply, 401, 'unauthenticated');
    const body = req.body;
    // An empty name (legacy clients may send one) falls back to the URL's, as it did before EDIT-2.
    const fileName = body.fileName || inferFileName(body.fileUrl);
    const local = !config.strict;

    let payload: Omit<SessionPayload, 'exp'>;
    if (body.profile) {
      // Profile shape (EDIT-2.3).
      if (!consumer.profiles?.includes(body.profile)) return refuse(reply, 403, 'profile_not_allowed');
      if (body.callbackUrl !== undefined || body.saveTo !== undefined || body.permissions !== undefined) {
        return refuse(reply, 400, 'field_not_allowed');
      }
      if (!body.documentRef || !body.revision || !body.mode) return refuse(reply, 400, 'key_fields_required');
      const wantMode = body.profile === 'view' ? 'v' : 'e';
      if (body.mode !== wantMode) return refuse(reply, 400, 'profile_mode_mismatch');
      const built = buildKey({ consumer: consumer.id, documentRef: body.documentRef, mode: body.mode, revision: body.revision });
      if (!built.ok) return refuse(reply, 400, `bad_key:${built.reason}`);
      try {
        await checkUrl(body.fileUrl, { allowHosts: consumer.fileHosts ?? [], local });
      } catch (err) {
        return refuse(reply, 400, `file_url_refused:${err instanceof UrlRefused ? err.code : 'invalid'}`);
      }
      let panelUrl: string | undefined;
      if (body.profile !== 'view') {
        if (!body.panelUrl) return refuse(reply, 400, 'panel_url_required');
        let panelOrigin: string;
        try {
          panelOrigin = new URL(body.panelUrl).origin;
        } catch {
          return refuse(reply, 400, 'panel_url_invalid');
        }
        if (!consumer.panelOrigins?.includes(panelOrigin)) return refuse(reply, 400, 'panel_origin_not_registered');
        panelUrl = body.panelUrl;
      } else if (body.panelUrl !== undefined) {
        return refuse(reply, 400, 'field_not_allowed');
      }
      payload = { p: body.profile, c: consumer.id, k: built.key, u: body.user, f: body.fileUrl, n: fileName, ...(panelUrl ? { pu: panelUrl } : {}) };
    } else {
      // Legacy shape (E1): kept until fastmail-connect and the Connect extension migrate. A
      // profile-capable consumer must use profiles, so its keys always get the profile rules
      // (fileHosts, notifications) and never the legacy ones.
      if (consumer.profiles?.length) return refuse(reply, 400, 'profile_required');
      if (body.documentRef !== undefined || body.revision !== undefined || body.mode !== undefined || body.panelUrl !== undefined) {
        return refuse(reply, 400, 'profile_required');
      }
      if (body.callbackUrl !== undefined || body.saveTo !== undefined || !/^https?:\/\//i.test(body.fileUrl)) {
        return refuse(reply, 400, 'legacy_field_removed');
      }
      try {
        await checkUrl(body.fileUrl, { internalPrefix: legacyFilesPrefix, local });
      } catch (err) {
        return refuse(reply, 400, `file_url_refused:${err instanceof UrlRefused ? err.code : 'invalid'}`);
      }
      const edit = body.permissions?.edit ?? true;
      const built = buildKey({ consumer: consumer.id, documentRef: `legacy-${randomUUID()}`, mode: edit ? 'e' : 'v', revision: '0' });
      if (!built.ok) return refuse(reply, 400, `bad_key:${built.reason}`);
      payload = {
        p: edit ? 'legacy-edit' : 'legacy-view',
        c: consumer.id,
        k: built.key,
        u: body.user,
        f: body.fileUrl,
        n: fileName,
        perm: { download: body.permissions?.download ?? true, print: body.permissions?.print ?? true },
      };
      req.log.info({ consumerId: consumer.id, legacy_open: true }, 'Legacy open shape used');
    }

    const exp = sessionExpiry(payload.f, config.maxSessionMs);
    if (exp <= Date.now()) return refuse(reply, 400, 'file_url_expired');
    let token: string;
    try {
      token = sealSession({ ...payload, exp } as SessionPayload, config.sealKeys);
    } catch (err) {
      if (err instanceof SealError && err.code === 'too_large') return refuse(reply, 400, 'session_too_large');
      req.log.error({ consumerId: consumer.id }, 'Sealing an editor session failed');
      return refuse(reply, 500, 'seal_unavailable');
    }
    req.log.info({ keyRef: keyRef(payload.k), consumerId: consumer.id, profile: payload.p, userId: body.user.id }, 'Document session opened');
    return reply.send({ editorUrl: `${config.apiPublicUrl}/editor/${token}`, key: payload.k, expiresAt: new Date(exp).toISOString() });
  });

  // --- Editor page ---
  app.get<{ Params: { token: string } }>('/editor/:token', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    const opened = openSession(req.params.token, config.sealKeys);
    if (!opened.ok) {
      const returnOrigin = opened.reason === 'expired' && opened.consumer ? findConsumerById(opened.consumer)?.returnOrigin : undefined;
      const page = renderExpiredPage(returnOrigin);
      reply.header('Content-Security-Policy', page.csp);
      return reply.status(410).type('text/html').send(page.html);
    }
    const session = opened.payload;
    let documentUrl = session.f;
    if (!session.f.startsWith(legacyFilesPrefix)) {
      try {
        // Short-lived: DocumentServer fetches right after the page loads, and every load mints a new one.
        const exp = Math.min(session.exp, Date.now() + SOURCE_TOKEN_TTL_MS);
        documentUrl = `${sourcePrefix}${sealSource({ c: session.c, k: session.k, f: session.f, exp }, config.sealKeys)}`;
      } catch {
        req.log.error({ keyRef: keyRef(session.k) }, 'Sealing a source URL failed');
        return reply.status(500).type('text/plain').send('Editor unavailable');
      }
    }
    const editorConfig = buildEditorConfig(session, { callbackUrl, bridgePluginConfigUrl, documentUrl });
    const token = jwt.sign(editorConfig, config.onlyofficeJwtSecret, { algorithm: 'HS256' });
    const page = renderEditorPage({ dsPublicUrl: config.onlyofficePublicUrl, title: opened.payload.n, config: editorConfig, token });
    reply.header('Content-Security-Policy', page.csp);
    return reply.type('text/html').send(page.html);
  });

  // --- Document source (EDIT-2.2) ---
  // DocumentServer fetches the document here instead of from the consumer's URL, so the fetch is
  // made by the service on the addresses it checked (a DNS answer that changes after `open`
  // cannot steer it inward; DocumentServer's own filter is bypassed for signed configs, ADR F3).
  // Every refusal is the same 404 to DocumentServer; the reason is logged without the URL.
  app.get<{ Params: { token: string } }>(
    '/api/documents/source/:token',
    {
      config: {
        rateLimit: {
          // A token that opens gets its own bucket (DocumentServer's one address must not share a
          // bucket across every document, and one token drives at most a few fetches); anything
          // else is limited per address like every other route, so garbage tokens are throttled
          // and cannot churn the token buckets.
          keyGenerator: (r: FastifyRequest) => {
            const token = (r.params as { token?: string }).token ?? '';
            return openSource(token, config.sealKeys).ok ? `source:${token}` : `ip:${r.ip}`;
          },
          max: (_r: FastifyRequest, key: string) => (key.startsWith('source:') ? SOURCE_FETCHES_PER_TOKEN : config.rateLimitMax),
          timeWindow: (_r: FastifyRequest, key: string) => (key.startsWith('source:') ? SOURCE_TOKEN_TTL_MS : config.rateLimitWindowMs),
        },
      },
      // A body over the cap fails before any byte went out only through this handler: answer in the
      // service's own shape. DocumentServer needs only the status.
      errorHandler: (err: Error, req: FastifyRequest, reply: FastifyReply) => {
        if (err.message === SOURCE_OVER_CAP) {
          // The route already set the file's type and, perhaps, its length; this answer is JSON.
          reply.removeHeader('content-length');
          return reply.status(502).type('application/json; charset=utf-8').send(JSON.stringify({ error: SOURCE_OVER_CAP }));
        }
        return reply.send(err);
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const opened = openSource(req.params.token, config.sealKeys);
      const consumer = opened.ok ? findConsumerById(opened.payload.c) : undefined;
      if (!opened.ok || !consumer) {
        req.log.warn({ reason: opened.ok ? 'unknown_consumer' : opened.reason }, 'Document source refused');
        return reply.status(404).send({ error: 'not_found' });
      }
      const { f: fileUrl, k: key } = opened.payload;
      let checked;
      try {
        // The consumer's current registration decides, not the one at `open`.
        checked = await checkUrl(fileUrl, { ...(consumer.profiles?.length ? { allowHosts: consumer.fileHosts ?? [] } : {}), local: !config.strict });
      } catch (err) {
        req.log.warn({ keyRef: keyRef(key), host: hostOf(fileUrl), reason: err instanceof UrlRefused ? err.code : 'invalid' }, 'Document source refused');
        return reply.status(404).send({ error: 'not_found' });
      }
      let upstream;
      try {
        // identity: a compressed answer would be decompressed by fetch while its Content-Length
        // still counted the compressed bytes, so forwarding it would cut the file short.
        upstream = await safeFetch(checked, { method: 'GET', headers: { 'accept-encoding': 'identity' }, signal: AbortSignal.timeout(config.sourceTimeoutMs) });
      } catch (err) {
        req.log.warn({ keyRef: keyRef(key), host: hostOf(fileUrl), reason: err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network' }, 'Document source unreachable');
        return reply.status(502).send({ error: 'source_unreachable' });
      }
      // A length is trusted only for an uncompressed answer (a host may encode despite `identity`).
      const encoding = (upstream.headers.get('content-encoding') ?? 'identity').trim().toLowerCase();
      const declaredHeader = encoding === 'identity' ? upstream.headers.get('content-length') : null;
      const declaredNumber = declaredHeader === null ? NaN : Number(declaredHeader);
      const declared = Number.isSafeInteger(declaredNumber) && declaredNumber >= 0 ? declaredNumber : NaN;
      if (upstream.status !== 200 || !upstream.body || (Number.isFinite(declared) && declared > config.maxSourceBytes)) {
        await upstream.body?.cancel().catch(() => undefined);
        req.log.warn({ keyRef: keyRef(key), host: hostOf(fileUrl), upstreamStatus: upstream.status, tooLarge: declared > config.maxSourceBytes }, 'Document source refused upstream answer');
        return reply.status(502).send({ error: 'source_refused' });
      }
      let seen = 0;
      let overCap = false;
      const cap = config.maxSourceBytes;
      const limiter = new Transform({
        transform(chunk: Buffer, _enc, done) {
          seen += chunk.length;
          if (seen > cap) {
            overCap = true;
            done(new Error(SOURCE_OVER_CAP));
          } else done(null, chunk);
        },
      });
      const body = Readable.fromWeb(upstream.body as unknown as WebReadableStream<Uint8Array>);
      let clientClosed = false;
      // pipeline tears both ends down on any failure; DocumentServer going away tears them down too,
      // so an abandoned fetch stops pulling from the consumer's host at once.
      let streamed = false;
      let finished = false;
      const fields = () => ({ keyRef: keyRef(key), host: hostOf(fileUrl), bytes: seen });
      // "Served" only once the stream completed and the response itself finished, in either order.
      const servedIfDone = () => {
        if (streamed && finished) req.log.info(fields(), 'Document source served');
      };
      pipeline(body, limiter, (err) => {
        if (!err) {
          streamed = true;
          servedIfDone();
        } else if (clientClosed) req.log.info({ ...fields(), reason: 'client_closed' }, 'Document source aborted');
        else req.log.warn({ ...fields(), reason: overCap ? 'over_cap' : 'upstream' }, 'Document source aborted');
      });
      reply.raw.once('finish', () => {
        finished = true;
        servedIfDone();
      });
      reply.raw.once('close', () => {
        if (!limiter.writableFinished) {
          clientClosed = !overCap;
          limiter.destroy();
        }
        body.destroy();
      });
      // A declared length is forwarded, so a body cut short (cap or upstream failure) is a protocol
      // error for DocumentServer rather than a complete-looking short file; without one the response
      // is chunked and a cut leaves it unterminated, which is the same.
      if (Number.isFinite(declared)) reply.header('Content-Length', String(declared));
      return reply
        .status(200)
        .type(upstream.headers.get('content-type') ?? 'application/octet-stream')
        .send(limiter);
    },
  );

  // --- DocumentServer callback ---
  app.post('/api/documents/callback', async (req, reply) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const checked = checkCallback({
      authorization: req.headers.authorization,
      body,
      secret: config.onlyofficeJwtSecret,
      allowedUrlOrigins: config.onlyofficeCallbackUrlOrigins,
      requireToken: config.strict,
    });
    if (!checked.ok) {
      req.log.warn({ reason: checked.reason }, 'DocumentServer callback refused');
      return reply.status(403).send({ error: 1 });
    }
    const cb = checked.callback;
    const key = parseKey(cb.key);
    const consumer = key ? findConsumerById(key.consumer) : undefined;
    if (!key || !consumer || !STATUS_EVENTS[cb.status]) {
      // A key from before stateless sessions, an unknown consumer, or a status we do not forward.
      req.log.info({ keyRef: keyRef(cb.key), status: cb.status }, 'DocumentServer callback acknowledged without notification');
      return reply.send({ error: 0 });
    }
    if (!consumer.callbackUrl) {
      // Legacy-only consumers registered no notification endpoint (E1).
      return reply.send({ error: 0 });
    }
    // Only saves carry a file (EDIT-2.4); a URL on any other status is not forwarded.
    const downloadUrl = cb.url && (cb.status === 2 || cb.status === 6) ? onBase(cb.url, config.onlyofficePublicUrl) : undefined;
    const outcome = await deliver({
      consumer,
      secrets: notificationSecrets(consumer),
      notification: buildNotification(cb, key, downloadUrl),
      timeoutMs: config.notifyTimeoutMs,
      local: !config.strict,
    });
    req.log.info(
      { keyRef: keyRef(cb.key), status: cb.status, consumerId: consumer.id, callbackHost: hostOf(consumer.callbackUrl), outcome: outcome.answer, consumerStatus: 'consumerStatus' in outcome ? outcome.consumerStatus : undefined },
      'Consumer notified',
    );
    // DocumentServer retries a final save only on HTTP 429/5xx (ADR F1).
    if (outcome.answer === 'retry') return reply.status(503).send({ error: 1 });
    return reply.send({ error: 0 });
  });

  // --- Key commands (the key's own consumer only) ---
  function ownKey(req: FastifyRequest<{ Params: { key: string } }>, reply: FastifyReply): string | null {
    const consumer = actingConsumer(req);
    const key = parseKey(req.params.key);
    if (!consumer) {
      void refuse(reply, 401, 'unauthenticated');
      return null;
    }
    if (!key || key.consumer !== consumer.id) {
      void refuse(reply, 403, 'not_your_key');
      return null;
    }
    return req.params.key;
  }

  app.post<{ Params: { key: string }; Body: { users: string[] } }>('/api/documents/keys/:key/drop', { schema: dropSchema }, async (req, reply) => {
    const key = ownKey(req, reply);
    if (!key) return reply;
    try {
      const res = await command(config.onlyofficeUrl, config.onlyofficeJwtSecret, { c: 'drop', key, users: req.body.users });
      const result = COMMAND_ERRORS[res.error] ?? 'unknown';
      req.log.info({ keyRef: keyRef(key), result }, 'Drop requested');
      return res.error === 0 ? reply.send({ result }) : reply.status(commandStatus(res.error)).send({ error: result });
    } catch {
      return refuse(reply, 502, 'docserver_unreachable');
    }
  });

  app.get<{ Params: { key: string } }>('/api/documents/keys/:key/forgotten', { schema: keyParams }, async (req, reply) => {
    const key = ownKey(req, reply);
    if (!key) return reply;
    try {
      const res = await command(config.onlyofficeUrl, config.onlyofficeJwtSecret, { c: 'getForgotten', key });
      if (res.error === 0 && typeof res.url === 'string') return reply.send({ downloadUrl: onBase(res.url, config.onlyofficePublicUrl) });
      // Only "no such key" means nothing is kept; any other answer is a fault, never a quiet "none".
      if (res.error === 1) return reply.send({ none: true });
      req.log.warn({ keyRef: keyRef(key), result: COMMAND_ERRORS[res.error] ?? 'unknown' }, 'Forgotten-file lookup failed');
      return reply.status(502).send({ error: res.error === 0 ? 'unexpected_answer' : (COMMAND_ERRORS[res.error] ?? 'unknown') });
    } catch {
      return refuse(reply, 502, 'docserver_unreachable');
    }
  });

  app.delete<{ Params: { key: string } }>('/api/documents/keys/:key/forgotten', { schema: keyParams }, async (req, reply) => {
    const key = ownKey(req, reply);
    if (!key) return reply;
    try {
      const res = await command(config.onlyofficeUrl, config.onlyofficeJwtSecret, { c: 'deleteForgotten', key });
      const result = COMMAND_ERRORS[res.error] ?? 'unknown';
      if (res.error === 0) return reply.send({ result });
      if (res.error === 1) return reply.status(404).send({ error: result });
      req.log.warn({ keyRef: keyRef(key), result }, 'Forgotten-file release failed');
      return reply.status(502).send({ error: result });
    } catch {
      return refuse(reply, 502, 'docserver_unreachable');
    }
  });
}
