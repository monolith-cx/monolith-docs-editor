/**
 * Document routes (EDIT-2, parent UDOC-1.2). Stateless: everything an editor page needs travels
 * in its sealed token, DocumentServer's callbacks are routed by the document key's consumer, and
 * the service keeps no session map and no database (D13).
 *
 *   POST   /api/documents/open                    consumer: open a session (profile or legacy shape)
 *   GET    /editor/:token                         public: the editor page (or the expired page)
 *   GET    /api/documents/source/:token           DocumentServer: the consumer's file, fetched by the service on a pinned address
 *   POST   /api/documents/callback                DocumentServer: verified, then notified to the consumer
 *   POST   /api/documents/convert                 consumer: a document in its storage to a PDF in its storage (EDIT-3)
 *   POST   /api/documents/keys/:key/drop          consumer: drop a key's users (the closing sequence)
 *   GET    /api/documents/keys/:key/forgotten     consumer: a final save DocumentServer kept (ADR F1)
 *   DELETE /api/documents/keys/:key/forgotten     consumer: release it after storing it
 *
 * Removed with the session map (consumer guide changelog): GET /api/documents/:key/download,
 * GET /api/sessions, per-request callbackUrl, saveTo, and GCS bucket/object file references.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { checkCallback } from '../callback-auth.js';
import { config } from '../config.js';
import type { Consumer, Profile } from '../consumers.js';
import { findConsumerById, getConsumers, notificationSecrets } from '../consumers.js';
import { buildKey, parseKey } from '../document-key.js';
import { COMMAND_ERRORS, command, onBase } from '../docserver.js';
import type { ConvertFileType } from '../convert.js';
import { CONVERT_FILE_TYPES, ConvertError, convertToPdf } from '../convert.js';
import { buildEditorConfig } from '../editor-config.js';
import { renderEditorPage, renderExpiredPage } from '../editor-page.js';
import { hostOf, keyRef } from '../log-safety.js';
import { STATUS_EVENTS, buildNotification, deliver } from '../notify.js';
import { recordSource, sourceActive, sourceSignal } from '../source-outcomes.js';
import { partsStream, readCapped } from '../capped-read.js';
import type { CheckedUrl } from '../safe-url.js';
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

const convertSchema = {
  body: {
    type: 'object',
    required: ['sourceUrl', 'uploadUrl'],
    properties: {
      sourceUrl: { type: 'string', minLength: 1, maxLength: 2048 },
      uploadUrl: { type: 'string', minLength: 1, maxLength: 2048 },
      fileType: { type: 'string', enum: [...CONVERT_FILE_TYPES] },
    },
    additionalProperties: false,
  },
} as const;

/** The source's type from its URL path, else docx. */
function inferConvertType(sourceUrl: string): ConvertFileType {
  try {
    const ext = new URL(sourceUrl).pathname.split('.').pop()?.toLowerCase();
    return (CONVERT_FILE_TYPES as readonly string[]).includes(ext ?? '') ? (ext as ConvertFileType) : 'docx';
  } catch {
    return 'docx';
  }
}

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

/** Source reads in progress (in-process; one API instance per environment). */
let sourceReads = 0;

type SourceRead =
  | { ok: true; parts: Buffer[]; size: number; type: string }
  | { ok: false; reason: 'over_cap' | 'upstream_status' | 'unreachable' | 'cut' | 'aborted'; log: Record<string, unknown> };

/**
 * Reads a checked source whole, under the cap (ADR F17): no redirects, `identity` encoding, a
 * declared length over the cap refused before reading, a body short of its declared length refused.
 */
async function readSource(checked: CheckedUrl, signal: AbortSignal, cap: number): Promise<SourceRead> {
  let upstream;
  try {
    upstream = await safeFetch(checked, { method: 'GET', headers: { 'accept-encoding': 'identity' }, signal });
  } catch (err) {
    return { ok: false, reason: err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'aborted' : 'unreachable', log: {} };
  }
  if (upstream.status !== 200) {
    await upstream.body?.cancel().catch(() => undefined);
    return { ok: false, reason: 'upstream_status', log: { upstreamStatus: upstream.status } };
  }
  const read = await readCapped(upstream, cap);
  if (!read.ok) return { ok: false, reason: read.reason, log: { bytes: read.bytes, declared: read.declared } };
  return { ok: true, parts: read.parts, size: read.size, type: upstream.headers.get('content-type') ?? 'application/octet-stream' };
}

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

  // --- Document source (EDIT-2.2, EDIT-3) ---
  // DocumentServer fetches the document here instead of from the consumer's URL, so the fetch is
  // made by the service on the addresses it checked (a DNS answer that changes after `open`
  // cannot steer it inward; DocumentServer's own filter is bypassed for signed configs, ADR F3).
  // The whole file is read before anything is answered (ADR F17): a download that ends part way
  // wedges DocumentServer's one converter, which also serves every editor open, so DocumentServer
  // only ever receives a complete file with its length, or an error before any byte.
  // A refusal of the token is a 404; a failure of the source a 502; too many reads at once a 503
  // (DocumentServer retries); reasons are logged without the URL.
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
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const opened = openSource(req.params.token, config.sealKeys);
      const consumer = opened.ok ? findConsumerById(opened.payload.c) : undefined;
      if (!opened.ok || !consumer) {
        req.log.warn({ reason: opened.ok ? 'unknown_consumer' : opened.reason }, 'Document source refused');
        return reply.status(404).send({ error: 'not_found' });
      }
      const { f: fileUrl, k: key, n: conversion } = opened.payload;
      const isConversion = opened.payload.h === 'convert';
      // A conversion's token is admitted only while its conversion runs (and only for a profile
      // consumer): a late or repeated fetch after it ended gets nothing.
      // Taken now, before any await: a conversion that ends meanwhile still aborts this read.
      const conversionSignal = sourceSignal(conversion);
      if (isConversion && (!conversion || !sourceActive(conversion) || !conversionSignal || !consumer.profiles?.length)) {
        req.log.warn({ keyRef: keyRef(key), reason: 'conversion_ended' }, 'Document source refused');
        return reply.status(404).send({ error: 'not_found' });
      }
      // The consumer's current registration decides, not the one at `open`: an editing source is
      // checked against fileHosts, a conversion's against convertSourceHosts (EDIT-3).
      const hosts = isConversion ? consumer.convertSourceHosts : consumer.fileHosts;
      let checked;
      try {
        checked = await checkUrl(fileUrl, { ...(consumer.profiles?.length ? { allowHosts: hosts ?? [] } : {}), local: !config.strict });
      } catch (err) {
        recordSource(conversion, 'refused');
        req.log.warn({ keyRef: keyRef(key), host: hostOf(fileUrl), reason: err instanceof UrlRefused ? err.code : 'invalid' }, 'Document source refused');
        return reply.status(404).send({ error: 'not_found' });
      }
      // DocumentServer may have gone, or the conversion ended, while the address was resolved.
      if (reply.raw.destroyed) return reply;
      if (conversionSignal?.aborted) return reply.status(404).send({ error: 'not_found' });
      // Whole files are held in memory while they are read and sent, so the number at once is bounded.
      if (sourceReads >= config.sourceConcurrency) {
        recordSource(conversion, 'busy');
        req.log.warn({ keyRef: keyRef(key), host: hostOf(fileUrl), reason: 'busy' }, 'Document source refused');
        return reply.status(503).header('Retry-After', '1').send({ error: 'busy' });
      }
      // The slot is held until the answer has left (or DocumentServer went away), not just until the
      // handler returns: the buffer lives as long as the response does.
      sourceReads += 1;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          sourceReads -= 1;
        }
      };
      reply.raw.once('finish', release);
      reply.raw.once('close', release);
      const fields = { keyRef: keyRef(key), host: hostOf(fileUrl) };
      try {
        // Ends the read when DocumentServer goes away, the conversion ends, or time runs out.
        const hangUp = new AbortController();
        reply.raw.once('close', () => hangUp.abort());
        const timeout = AbortSignal.timeout(Math.max(1, Math.min(config.sourceTimeoutMs, opened.payload.exp - Date.now())));
        const signal = AbortSignal.any([hangUp.signal, timeout, ...(conversionSignal ? [conversionSignal] : [])]);
        const read = await readSource(checked, signal, config.maxSourceBytes);
        if (!read.ok) {
          const why = read.reason === 'aborted'
            ? (hangUp.signal.aborted ? 'hung_up' : conversionSignal?.aborted ? 'conversion_ended' : 'timeout')
            : read.reason;
          recordSource(conversion, read.reason === 'over_cap' ? 'too_large' : 'unavailable');
          req.log.warn({ ...fields, ...read.log, reason: why }, 'Document source failed');
          if (reply.raw.destroyed) return reply;
          return reply.status(502).send({ error: read.reason === 'over_cap' ? 'source_over_cap' : 'source_unavailable' });
        }
        recordSource(conversion, 'served');
        req.log.info({ ...fields, bytes: read.size }, 'Document source served');
        // A conversion that ends while its file is still being sent cuts the send (and frees the slot).
        if (conversionSignal?.aborted) return reply.status(404).send({ error: 'not_found' });
        conversionSignal?.addEventListener('abort', () => {
          if (!reply.raw.writableFinished) reply.raw.destroy();
        }, { once: true });
        return reply
          .status(200)
          .type(read.type)
          .header('Content-Length', String(read.size))
          .send(partsStream(read.parts));
      } catch (err) {
        release();
        throw err;
      }
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

  // --- Conversion (EDIT-3) ---
  app.post<{ Body: { sourceUrl: string; uploadUrl: string; fileType?: ConvertFileType } }>('/api/documents/convert', { schema: convertSchema }, async (req, reply) => {
    const consumer = actingConsumer(req);
    if (!consumer) return refuse(reply, 401, 'unauthenticated');
    // Conversion needs the profile registration's host lists (E5).
    if (!consumer.profiles?.length) return refuse(reply, 403, 'profile_not_allowed');
    const fileType = req.body.fileType ?? inferConvertType(req.body.sourceUrl);
    try {
      // A consumer that hangs up cancels its conversion, so its retry is not refused as busy.
      const gone = new AbortController();
      const onClose = () => {
        if (!reply.raw.writableFinished) gone.abort();
      };
      // The response's close, not the request's: a request emits close once its body has been read.
      reply.raw.once('close', onClose);
      let result;
      try {
        result = await convertToPdf({ consumer, sourceUrl: req.body.sourceUrl, uploadUrl: req.body.uploadUrl, fileType, cancelled: gone.signal }, (level, fields, msg) => req.log[level](fields, msg));
      } finally {
        reply.raw.off('close', onClose);
      }
      return reply.send(result);
    } catch (err) {
      if (err instanceof ConvertError) return refuse(reply, err.status, err.code);
      throw err;
    }
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
