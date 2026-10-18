import { createHash } from 'node:crypto';

/**
 * Log safety (EDIT-4 / UDOC-1.4): no log line may carry a URL that grants
 * access — a signed file URL, a consumer callback URL, OnlyOffice's download
 * URL, or a path whose segment is a bearer capability (an editor key, an
 * uploaded file id).
 *
 * Five layers, so one forgotten call site does not leak:
 * 1. call sites log hosts (`hostOf`) and fingerprints (`keyRef`), never URLs, keys, or file ids;
 * 2. error text passes through `safeErrorText` before it is logged;
 * 3. pino redacts the known URL-bearing field names (`LOG_REDACT_PATHS`), and the
 *    `err` serializer scrubs an error's message and stack and drops its other fields;
 * 4. the request serializer logs a path from an allowlist (`redactRequestPath`)
 *    instead of `req.url`: a route that is not known to be safe is masked;
 * 5. a pino `logMethod` hook (`scrubLogArguments`) removes URLs from every string
 *    argument and from the string members of plain-object arguments (one level),
 *    because Fastify logs a 500's raw error message as the line's `msg`.
 *
 * Limits: scrubbing removes `scheme://…` URLs and `host.tld/path` forms; it does
 * not recognise a bare `bucket/object` pair or a path without a host, so call
 * sites must not put storage object names or capability paths into text. Stack
 * frames (lines starting `at `) keep lowercase `file:///` and `node:` locations
 * (local code paths, not capabilities); every other stack line is scrubbed in full.
 * Every pattern is bounded and runs on input already cut to a fixed length, so a
 * long reflected string cannot stall the event loop.
 */

const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s"'<>]{1,4096}/gi;
// Case-sensitive on purpose: only lowercase `file:///` (a local path) and `node:` are kept.
const STACK_URL_IN_TEXT = /\b(?!file:\/\/\/|node:)[a-zA-Z][a-zA-Z0-9+.-]{0,31}:\/\/[^\s"'<>]{1,16000}/g;
const STACK_FRAME_LINE = /^\s*at\s/;
const SCHEMELESS_URL_IN_TEXT = /\b(?:[a-z0-9-]{1,63}\.){1,10}[a-z]{2,63}(?::\d{1,5})?\/[^\s"'<>]{0,4096}/gi;
const MAX_ERROR_TEXT = 500;
const MAX_MESSAGE_TEXT = 1000;
const MAX_STACK_TEXT = 4000;
/** Input is cut to this multiple of the output cap before any pattern runs. */
const SCAN_FACTOR = 4;

function scrubUrls(text: string, cap: number): string {
  return text
    .slice(0, cap * SCAN_FACTOR)
    .replace(URL_IN_TEXT, '[url]')
    .replace(SCHEMELESS_URL_IN_TEXT, '[url]')
    .slice(0, cap);
}

function scrubStack(stack: string): string {
  return stack
    .slice(0, MAX_STACK_TEXT * SCAN_FACTOR)
    .split('\n')
    .map((line) =>
      STACK_FRAME_LINE.test(line) ? line.replace(STACK_URL_IN_TEXT, '[url]') : scrubUrls(line, MAX_STACK_TEXT),
    )
    .join('\n')
    .slice(0, MAX_STACK_TEXT);
}

/** Replaces every URL in free text with `[url]` and caps its length. */
export function safeErrorText(text: string): string {
  return scrubUrls(text, MAX_ERROR_TEXT);
}

/** The host of an http(s) URL, or undefined for anything else (a GCS path, garbage). */
export function hostOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.host || undefined;
  } catch {
    return undefined;
  }
}

/**
 * A stable, non-reversible reference to a capability (a document key, which is
 * also the editor page's capability today, or an uploaded file id) for log
 * correlation. The value itself is never logged.
 */
export function keyRef(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

const REDACTED = '[redacted]';

/** Exact request paths that carry no capability and may be logged as they are. */
const SAFE_PATHS = new Set([
  '/health',
  '/api/status',
  '/api/documents/open',
  '/api/documents/callback',
  '/api/documents/convert',
  '/api/files/upload',
]);

/**
 * The request path as it may appear in a log. The query string is never kept.
 * A path on the allowlist is logged as it is; anything else keeps only its first
 * segment (its first two under `/api/`) and masks the rest, so a new route, a
 * capability segment, or an odd spelling (`//editor/x`, `/Editor/x`) is never
 * logged in full.
 */
export function redactRequestPath(rawUrl: string): string {
  const queryStart = rawUrl.indexOf('?');
  const rawPath = queryStart === -1 ? rawUrl : rawUrl.slice(0, queryStart);
  const query = queryStart === -1 ? '' : `?${REDACTED}`;

  if (SAFE_PATHS.has(rawPath)) return `${rawPath}${query}`;

  const segments = rawPath.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) return `/${query}`;
  const keep = segments[0]?.toLowerCase() === 'api' && segments.length > 2 ? 2 : 1;
  const kept = segments.slice(0, Math.min(keep, segments.length - 1));
  if (kept.length === 0) return `/${REDACTED}`;
  return `/${kept.map((segment) => encodeURIComponent(decodeSafe(segment))).join('/')}/${REDACTED}`;
}

function decodeSafe(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

const URL_FIELDS = [
  'url',
  'fileUrl',
  'resolvedFileUrl',
  'callbackUrl',
  'downloadUrl',
  'lastSavedUrl',
  'editorUrl',
  'publicUrl',
  'saveTo',
  'sourceUrl',
  'uploadUrl',
  'token',
] as const;

/** pino redaction paths: each URL-bearing field at the top level and one level down. */
export const LOG_REDACT_PATHS: string[] = URL_FIELDS.flatMap((field) => [field, `*.${field}`]);

export const LOG_REDACT_CENSOR = REDACTED;

interface SerializableRequest {
  method: string;
  url: string;
  hostname?: string;
  ip?: string;
}

/** Fastify `req` serializer: logs `path` (allowlisted or masked), never `url`. */
export function serializeRequest(req: SerializableRequest): Record<string, string | undefined> {
  return {
    method: req.method,
    path: redactRequestPath(req.url),
    hostname: req.hostname,
    remoteAddress: req.ip,
  };
}

interface SerializableError {
  name?: string;
  message?: string;
  stack?: string;
  code?: unknown;
  statusCode?: unknown;
  cause?: unknown;
}

function codeOf(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

interface SerializedError {
  [key: string]: unknown;
  type: string;
  message: string;
  stack: string;
}

/**
 * pino `err` serializer: type, scrubbed message and stack, the code fields, and
 * one level of `cause` (type, scrubbed message, code). Every other enumerable
 * property (an HTTP client's `config.url`, a response body) is dropped.
 */
export function serializeError(err: SerializableError): SerializedError {
  const cause = err.cause instanceof Error ? (err.cause as SerializableError) : undefined;
  return {
    type: err.name ?? 'Error',
    message: safeErrorText(err.message ?? ''),
    stack: scrubStack(err.stack ?? ''),
    code: codeOf(err.code),
    statusCode: typeof err.statusCode === 'number' ? err.statusCode : undefined,
    cause: cause
      ? { type: cause.name ?? 'Error', message: safeErrorText(cause.message ?? ''), code: codeOf(cause.code) }
      : undefined,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function scrubArgument(arg: unknown): unknown {
  if (typeof arg === 'string') return scrubUrls(arg, MAX_MESSAGE_TEXT);
  if (!isPlainObject(arg)) return arg;
  const copy: Record<string, unknown> = { ...arg };
  for (const [field, value] of Object.entries(copy)) {
    if (typeof value === 'string') copy[field] = scrubUrls(value, MAX_MESSAGE_TEXT);
  }
  return copy;
}

/**
 * pino `hooks.logMethod` body: scrubs URLs from every string argument (the
 * message and its format args) and from the string members of plain-object
 * arguments, one level deep, on a shallow copy.
 */
export function scrubLogArguments(args: unknown[]): unknown[] {
  return args.map(scrubArgument);
}
