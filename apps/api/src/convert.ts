/**
 * PDF conversion (EDIT-3, parent UDOC-1.3): a consumer's document in its storage becomes a PDF in
 * its storage, and the service keeps neither file.
 *
 *  1. Both URLs are checked through `safe-url` against the consumer's `convertSourceHosts` and
 *     `convertUploadHosts`.
 *  2. DocumentServer's ConvertService gets a JWT-signed request whose `url` is the service's own
 *     source route with a source token scoped to this conversion (EDIT-2.2): the service, not
 *     DocumentServer, reads the source, whole, on the checked addresses, under the input cap, and
 *     only while the conversion runs. While DocumentServer answers "not finished" the same request
 *     is repeated (its documented progress poll) until the deadline.
 *  3. The PDF is read whole from DocumentServer's internal URL under the output cap and checked
 *     against its declared length, then uploaded to the pinned upload address with its length; the
 *     consumer's storage never receives part of a file. The answer is `{ size, sha256 }`.
 *
 * Memory: each running conversion holds at most one PDF (the output cap); conversions are limited
 * per consumer and in total (`EDITOR_CONVERT_CONCURRENCY`, `EDITOR_CONVERT_CONCURRENCY_TOTAL`).
 *
 * Named errors (`ConvertError.code`): source_url_refused, upload_url_refused, input_too_large,
 * source_unavailable, output_too_large, conversion_timeout, conversion_failed, upload_failed, busy.
 * `detail` is a fixed code for the log, never a URL or a provider message. Nothing is written to
 * disk; only hosts, sizes, and codes are logged. DocumentServer keeps the PDF in its cache for up to
 * 24 h (ADR F8).
 */
import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { fetch as undiciFetch } from 'undici';
import { partsWebStream, readCapped } from './capped-read.js';
import { config } from './config.js';
import { PROBE_SAMPLE_ROUTE } from './health-paths.js';
import type { Consumer } from './consumers.js';
import { buildKey } from './document-key.js';
import { onBase } from './docserver.js';
import { hostOf, keyRef } from './log-safety.js';
import type { CheckedUrl } from './safe-url.js';
import { UrlRefused, checkUrl, safeFetch } from './safe-url.js';
import { sealSource } from './session-token.js';
import { endSource, expectSource, peekSource } from './source-outcomes.js';

export type ConvertErrorCode =
  | 'source_url_refused'
  | 'upload_url_refused'
  | 'input_too_large'
  | 'source_unavailable'
  | 'output_too_large'
  | 'conversion_timeout'
  | 'conversion_failed'
  | 'upload_failed'
  | 'busy';

const STATUS: Record<ConvertErrorCode, number> = {
  source_url_refused: 400,
  upload_url_refused: 400,
  input_too_large: 413,
  source_unavailable: 502,
  output_too_large: 413,
  conversion_timeout: 504,
  conversion_failed: 502,
  upload_failed: 502,
  busy: 429,
};

export class ConvertError extends Error {
  readonly status: number;
  constructor(readonly code: ConvertErrorCode, readonly detail?: string) {
    super(code);
    this.name = 'ConvertError';
    this.status = STATUS[code];
  }
}

/** Source types ConvertService turns into PDF here; anything else is the consumer's to convert first. */
export const CONVERT_FILE_TYPES = ['docx', 'doc', 'odt', 'rtf'] as const;
export type ConvertFileType = (typeof CONVERT_FILE_TYPES)[number];

export interface ConvertRequest {
  consumer: Consumer;
  sourceUrl: string;
  uploadUrl: string;
  fileType: ConvertFileType;
  /** Aborts when the consumer has gone away; the conversion then stops like at its deadline. */
  cancelled?: AbortSignal;
}

export interface ConvertResult {
  size: number;
  sha256: string;
}

type Log = (level: 'info' | 'warn', fields: Record<string, unknown>, msg: string) => void;

/** How often to repeat the request while DocumentServer answers "not finished". */
const POLL_INTERVAL_MS = 1000;

// Conversions in progress, per consumer and in total (in-process; one API instance per environment).
const running = new Map<string, number>();
let runningTotal = 0;

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

async function check(raw: string, hosts: readonly string[] | undefined, refusal: ConvertErrorCode): Promise<CheckedUrl> {
  try {
    return await checkUrl(raw, { allowHosts: hosts ?? [], local: !config.strict });
  } catch (err) {
    throw new ConvertError(refusal, err instanceof UrlRefused ? err.code : 'invalid');
  }
}

/** ConvertService error codes (DocumentServer API), with the source route's account of a failed download. */
function converterError(code: number, source: ReturnType<typeof peekSource>): ConvertError {
  if (code === -4) {
    if (source === 'too_large') return new ConvertError('input_too_large');
    if (source === 'refused') return new ConvertError('source_url_refused', 'at_fetch');
    if (source === 'busy') return new ConvertError('busy', 'source_reads');
    return new ConvertError('source_unavailable');
  }
  if (code === -10) return new ConvertError('input_too_large');
  if (code === -2) return new ConvertError('conversion_timeout', 'converter');
  return new ConvertError('conversion_failed', `converter_${code}`);
}

interface ConverterAnswer {
  error?: number;
  endConvert?: boolean;
  fileUrl?: string;
}

async function askConverter(body: Record<string, unknown>, signal: AbortSignal): Promise<ConverterAnswer> {
  const secret = config.onlyofficeJwtSecret;
  let res;
  try {
    res = await undiciFetch(`${config.onlyofficeUrl.replace(/\/$/, '')}/converter`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        Authorization: `Bearer ${jwt.sign({ payload: body }, secret, { algorithm: 'HS256', expiresIn: '5m' })}`,
      },
      body: JSON.stringify({ ...body, token: jwt.sign(body, secret, { algorithm: 'HS256', expiresIn: '5m' }) }),
      redirect: 'manual',
      signal,
    });
  } catch (err) {
    throw new ConvertError(isTimeout(err) ? 'conversion_timeout' : 'conversion_failed', 'converter_unreachable');
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new ConvertError('conversion_failed', `converter_http_${res.status}`);
  }
  try {
    return (await res.json()) as ConverterAnswer;
  } catch (err) {
    throw new ConvertError(isTimeout(err) ? 'conversion_timeout' : 'conversion_failed', 'converter_answer');
  }
}

/** Waits one progress-poll interval, or rejects as a timeout when `signal` aborts first. */
function pollWait(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ConvertError('conversion_timeout', 'poll'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, POLL_INTERVAL_MS);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** A healthy converter turns the sample into a PDF in a second or two; 20 s means it is wedged or starved. */
export const PROBE_TIMEOUT_MS = 20_000;

/**
 * The converter probe (EDIT-6.3, ADR F17): converts the built-in sample DOCX to PDF through
 * DocumentServer, under a fresh key each time (DocumentServer caches results by key), and reports
 * whether the converter answered within `PROBE_TIMEOUT_MS`. It reads nothing back and keeps nothing; the
 * PDF stays in DocumentServer's cache until its expiry (24 h, ADR F8), one small file per probe.
 * `detail` is a fixed code, never a URL or a DocumentServer message.
 */
export async function probeConverter(timeoutMs = PROBE_TIMEOUT_MS): Promise<{ ok: boolean; ms: number; detail: string }> {
  const started = Date.now();
  const signal = AbortSignal.timeout(timeoutMs);
  const body = {
    async: false,
    filetype: 'docx',
    outputtype: 'pdf',
    key: `probe_${randomUUID().replace(/-/g, '')}`,
    title: 'probe.docx',
    url: `${config.apiInternalUrl}${PROBE_SAMPLE_ROUTE}`,
  };
  const done = (ok: boolean, detail: string) => ({ ok, ms: Date.now() - started, detail });
  try {
    let answer = await askConverter(body, signal);
    while (!(typeof answer.error === 'number' && answer.error !== 0) && !answer.endConvert) {
      await pollWait(signal);
      answer = await askConverter(body, signal);
    }
    if (typeof answer.error === 'number' && answer.error !== 0) return done(false, `converter_${answer.error}`);
    if (typeof answer.fileUrl !== 'string') return done(false, 'no_result');
    return done(true, 'ok');
  } catch (err) {
    return done(false, err instanceof ConvertError ? (err.detail ?? err.code) : 'error');
  }
}

export async function convertToPdf(req: ConvertRequest, log: Log): Promise<ConvertResult> {
  const { consumer } = req;
  const conversion = randomUUID().replace(/-/g, '');
  const built = buildKey({ consumer: consumer.id, documentRef: `convert_${conversion}`, mode: 'v', revision: '0' });
  if (!built.ok) throw new ConvertError('conversion_failed', 'key');
  const key = built.key;
  const fields = { keyRef: keyRef(key), consumerId: consumer.id, sourceHost: hostOf(req.sourceUrl), uploadHost: hostOf(req.uploadUrl) };

  // Admission: nothing below runs, and nothing needs undoing, unless both limits admit it.
  const mine = running.get(consumer.id) ?? 0;
  if (mine >= config.convertConcurrency || runningTotal >= config.convertConcurrencyTotal) {
    const error = new ConvertError('busy', mine >= config.convertConcurrency ? 'consumer' : 'total');
    log('warn', { ...fields, code: error.code, detail: error.detail }, 'Document conversion failed');
    throw error;
  }
  running.set(consumer.id, mine + 1);
  runningTotal += 1;
  const deadline = AbortSignal.timeout(config.convertTimeoutMs);
  const finish = new AbortController();
  const signal = AbortSignal.any([deadline, finish.signal, ...(req.cancelled ? [req.cancelled] : [])]);
  try {
    await check(req.sourceUrl, consumer.convertSourceHosts, 'source_url_refused');
    const upload = await check(req.uploadUrl, consumer.convertUploadHosts, 'upload_url_refused');

    // 2. ConvertService, reading the source through the service's source route. The token's
    // lifetime is the deadline, and the source route admits it only while this conversion runs.
    expectSource(conversion);
    const token = sealSource({ c: consumer.id, k: key, f: req.sourceUrl, exp: Date.now() + config.convertTimeoutMs, h: 'convert', n: conversion }, config.sealKeys);
    const body = {
      async: false,
      filetype: req.fileType,
      outputtype: 'pdf',
      key,
      title: `document.${req.fileType}`,
      url: `${config.apiInternalUrl}/api/documents/source/${token}`,
    };
    let answer = await askConverter(body, signal);
    while (!(typeof answer.error === 'number' && answer.error !== 0) && !answer.endConvert) {
      // Not finished yet: DocumentServer's progress poll is the same request with the same key.
      await pollWait(signal);
      answer = await askConverter(body, signal);
    }
    if (typeof answer.error === 'number' && answer.error !== 0) throw converterError(answer.error, peekSource(conversion));
    if (typeof answer.fileUrl !== 'string') throw new ConvertError('conversion_failed', 'no_result');

    // 3. The PDF, whole, from DocumentServer's internal URL (only its own origins are accepted).
    let pdfUrl: string;
    try {
      if (!config.onlyofficeCallbackUrlOrigins.includes(new URL(answer.fileUrl).origin)) throw new Error('origin');
      pdfUrl = onBase(answer.fileUrl, config.onlyofficeUrl);
    } catch {
      throw new ConvertError('conversion_failed', 'result_origin');
    }
    let pdf;
    try {
      pdf = await undiciFetch(pdfUrl, { redirect: 'manual', headers: { 'accept-encoding': 'identity' }, signal });
    } catch (err) {
      throw new ConvertError(isTimeout(err) ? 'conversion_timeout' : 'conversion_failed', 'result_unreachable');
    }
    if (pdf.status !== 200) {
      await pdf.body?.cancel().catch(() => undefined);
      throw new ConvertError('conversion_failed', `result_http_${pdf.status}`);
    }
    const read = await readCapped(pdf, config.maxConvertOutputBytes);
    if (!read.ok) {
      if (read.reason === 'over_cap') throw new ConvertError('output_too_large');
      throw new ConvertError(signal.aborted && deadline.aborted ? 'conversion_timeout' : 'conversion_failed', `result_${read.reason}`);
    }
    if (read.size === 0) throw new ConvertError('conversion_failed', 'result_empty');

    // The PDF goes out as a web stream of views over the parts already held, with its exact length:
    // a Buffer body, or a Node stream body, would be copied by fetch.
    const hash = createHash('sha256');
    for (const part of read.parts) hash.update(part);
    let uploaded;
    try {
      uploaded = await safeFetch(upload, {
        method: 'PUT',
        headers: { 'content-type': 'application/pdf', 'content-length': String(read.size) },
        body: partsWebStream(read.parts),
        duplex: 'half',
        signal,
      });
    } catch (err) {
      throw new ConvertError(isTimeout(err) ? 'conversion_timeout' : 'upload_failed', 'upload_unreachable');
    }
    await uploaded.body?.cancel().catch(() => undefined);
    if (uploaded.status < 200 || uploaded.status >= 300) throw new ConvertError('upload_failed', `upload_http_${uploaded.status}`);

    const result = { size: read.size, sha256: hash.digest('hex') };
    log('info', { ...fields, size: result.size }, 'Document converted');
    return result;
  } catch (err) {
    const error = err instanceof ConvertError ? err : new ConvertError('conversion_failed', 'unexpected');
    log('warn', { ...fields, code: error.code, detail: error.detail }, 'Document conversion failed');
    throw error;
  } finally {
    // Every exit stops whatever is still running for this conversion: the source read, a result
    // read, an upload.
    finish.abort();
    endSource(conversion);
    const now = running.get(consumer.id) ?? 1;
    if (now <= 1) running.delete(consumer.id);
    else running.set(consumer.id, now - 1);
    runningTotal -= 1;
  }
}
