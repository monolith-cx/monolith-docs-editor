/**
 * The only module that reads `process.env` (CLAUDE.md). Everything else takes
 * configuration from here.
 *
 * Strict by default (EDIT-2.1, guidance E4): `EDITOR_ENV` is `local`, `dev`,
 * `staging`, or `production`, and an unset value means `production`. Only
 * `local` relaxes the rules (weak secrets, http and private addresses for the
 * scratch battery, the `/files/` fixture route, no HSTS); `server.ts` refuses
 * to start on any problem `configProblems` reports.
 */

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import proxyAddr from '@fastify/proxy-addr';

export type EditorEnv = 'local' | 'dev' | 'staging' | 'production';

export interface Config {
  editorEnv: EditorEnv;
  /** Everything except `local`. */
  strict: boolean;
  port: number;
  host: string;
  logLevel: string;

  onlyofficeUrl: string;
  onlyofficePublicUrl: string;
  onlyofficeJwtSecret: string;
  /** Origins DocumentServer's save URLs may carry (ADR F2): internal and public by default. */
  onlyofficeCallbackUrlOrigins: string[];

  apiPublicUrl: string;
  apiInternalUrl: string;

  corsOrigins: string[] | true;
  rateLimitMax: number;
  rateLimitWindowMs: number;

  /** AES-256-GCM keys for sealed editor tokens, current first, at most two (E4). */
  sealKeys: Buffer[];
  /** Upper bound on an editor token's lifetime (D13). */
  maxSessionMs: number;
  /** Consumer notification timeout; below DocumentServer's 10-minute callback timeout (E6). */
  notifyTimeoutMs: number;
  /** The source route's limits when it fetches a consumer's file for DocumentServer (EDIT-2.2). */
  sourceTimeoutMs: number;
  maxSourceBytes: number;
  /** Source reads at once; each holds its file in memory until it is complete (ADR F17). */
  sourceConcurrency: number;
  /** Conversion (EDIT-3): the whole request's deadline, concurrent conversions per consumer, the PDF's cap. */
  convertTimeoutMs: number;
  convertConcurrency: number;
  convertConcurrencyTotal: number;
  maxConvertOutputBytes: number;

  consumersJson: string | undefined;
  consumerApiKey: string | undefined;
  /** Notification secrets by environment variable name (only `EDITOR_NOTIFY_SECRET_*`). */
  notifySecrets: Record<string, string>;

  uploadDir: string;
  /**
   * Which proxies' forwarded addresses to believe (Fastify `trustProxy`): a list of addresses/CIDRs,
   * never "everyone", which would let a client choose its own address for the limiter, and never a hop
   * count, which Fastify 5.12 ignores (it trusts no proxy, since a hop count cannot check the peer).
   */
  trustProxy: string | false;
  /** The bridge plugin's files (EDIT-5): `apps/plugin` in the repository and in the image. */
  pluginDir: string;
  uploadTtlMs: number;
}

const ENVS: readonly EditorEnv[] = ['local', 'dev', 'staging', 'production'];
/**
 * The service's internal origin, the one origin DocumentServer fetches from directly (its
 * `externalRequest.directIfIn.allowList` in `infrastructure/onlyoffice/local-production-linux.json`,
 * EDIT-6.2): the source route, legacy uploads, and callbacks. Every deployment names the API
 * `editor-api` (the VPS service; a network alias elsewhere), so the allow-list is one fixed value.
 */
export const DOCUMENTSERVER_DIRECT_ORIGIN = 'http://editor-api:3020';
const WEAK_SECRETS = new Set(['secret', 'change-me-dev', 'change-me-prod', 'dev-only-secret-do-not-use-in-prod']);
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
/** DocumentServer's own default `maxDownloadBytes`. */
const DEFAULT_MAX_SOURCE_BYTES = 104_857_600;

function parseList(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function parseCorsOrigins(raw: string | undefined): string[] | true {
  if (!raw || raw === '*') return true; // fastify/cors uses `true` for wildcard
  return parseList(raw);
}

function parseSealKeys(raw: string | undefined): Buffer[] {
  return parseList(raw).map((k) => Buffer.from(k, 'base64url'));
}

function parseTrustProxy(raw: string | undefined): string | false {
  const v = raw?.trim();
  return v ? v : false;
}

/**
 * What is wrong with a TRUST_PROXY list, judged entry by entry on the function `@fastify/proxy-addr`
 * compiles (Fastify splits the list on commas and compiles the same entries, so a parse here cannot
 * disagree with Fastify's): a hop count (Fastify 5.12 ignores one), an entry it cannot parse
 * (Fastify would throw at boot), an IPv6 range broader than /32, or any entry that covers addresses
 * in two different IPv4 /8 blocks. That last test is exact for "broader than /8" (a range of /7 or
 * wider holds two adjacent /8 blocks whole, a /8 or narrower lies inside one) and catches every form
 * that reaches IPv4 clients: a netmask, and an IPv6 range covering the IPv4-mapped space (`::/32`,
 * `::ffff:0:0/96`), which Fastify matches IPv4 clients against.
 */
export function trustProxyProblem(list: string): string | null {
  for (const entry of list.split(',').map((e) => e.trim())) {
    // Fastify 5.12 ignores a hop count and trusts no proxy, so the limiter would see only the proxy.
    if (/^\d+$/.test(entry)) return 'TRUST_PROXY must name the proxy by address or CIDR, not a hop count (Fastify ignores hop counts and trusts no proxy)';
    // proxy-addr's named private ranges: fixed, and never public addresses.
    if (entry === 'loopback' || entry === 'linklocal' || entry === 'uniquelocal') continue;
    let trust: (addr: string, i: number) => boolean;
    try {
      trust = proxyAddr.compile(entry);
    } catch {
      return `TRUST_PROXY entry "${entry.slice(0, 64)}" is not an address, a CIDR, or loopback/linklocal/uniquelocal`;
    }
    const slash = entry.lastIndexOf('/');
    if (slash !== -1 && isIP(entry.slice(0, slash)) === 6 && Number(entry.slice(slash + 1)) < 32) {
      return 'TRUST_PROXY must name the proxies, never everyone (no IPv6 range broader than /32)';
    }
    const blocks = new Set<number>();
    // Both forms an IPv4 client arrives in: plain, and IPv4-mapped on a dual-stack socket.
    for (let octet = 0; octet < 256; octet++) if (trust(`${octet}.0.0.1`, 0) || trust(`::ffff:${octet}.0.0.1`, 0)) blocks.add(octet);
    if (blocks.size > 1) return 'TRUST_PROXY must name the proxies, never everyone (no range that covers more than one IPv4 /8)';
  }
  return null;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const rawEnv = env['EDITOR_ENV'] ?? 'production';
  const editorEnv = (ENVS as readonly string[]).includes(rawEnv) ? (rawEnv as EditorEnv) : 'production';
  const onlyofficeUrl = env['ONLYOFFICE_URL'] ?? 'http://onlyoffice:80';
  const onlyofficePublicUrl = env['ONLYOFFICE_PUBLIC_URL'] ?? 'http://localhost:8080';
  const callbackOrigins = parseList(env['ONLYOFFICE_CALLBACK_URL_ORIGINS']);
  const notifySecrets: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith('EDITOR_NOTIFY_SECRET_') && value) notifySecrets[name] = value;
  }
  return {
    editorEnv,
    strict: editorEnv !== 'local',
    port: Number(env['PORT'] ?? 3020),
    host: env['HOST'] ?? '0.0.0.0',
    logLevel: env['LOG_LEVEL'] ?? 'info',

    onlyofficeUrl,
    onlyofficePublicUrl,
    onlyofficeJwtSecret: env['ONLYOFFICE_JWT_SECRET'] ?? 'secret',
    onlyofficeCallbackUrlOrigins: callbackOrigins.length
      ? callbackOrigins
      : [originOf(onlyofficeUrl), originOf(onlyofficePublicUrl)].filter((o): o is string => Boolean(o)),

    apiPublicUrl: env['API_PUBLIC_URL'] ?? 'http://localhost:3020',
    apiInternalUrl: env['API_INTERNAL_URL'] ?? DOCUMENTSERVER_DIRECT_ORIGIN,

    corsOrigins: parseCorsOrigins(env['CORS_ORIGINS']),
    rateLimitMax: Number(env['RATE_LIMIT_MAX'] ?? 100),
    rateLimitWindowMs: Number(env['RATE_LIMIT_WINDOW_MS'] ?? 60_000),

    sealKeys: parseSealKeys(env['EDITOR_SEAL_KEYS']),
    maxSessionMs: Math.min(Number(env['EDITOR_MAX_SESSION_MS'] ?? TWELVE_HOURS_MS), TWELVE_HOURS_MS),
    notifyTimeoutMs: Number(env['EDITOR_NOTIFY_TIMEOUT_MS'] ?? 10_000),
    // Short on purpose: while a source is read, DocumentServer's one converter waits for it (ADR F17).
    sourceTimeoutMs: Number(env['EDITOR_SOURCE_TIMEOUT_MS'] ?? 30_000),
    maxSourceBytes: Number(env['EDITOR_MAX_SOURCE_BYTES'] ?? DEFAULT_MAX_SOURCE_BYTES),
    sourceConcurrency: Number(env['EDITOR_SOURCE_CONCURRENCY'] ?? 4),
    // Under the 100 s a Cloudflare-proxied request is held open, so the consumer always gets the answer.
    convertTimeoutMs: Number(env['EDITOR_CONVERT_TIMEOUT_MS'] ?? 90_000),
    convertConcurrency: Number(env['EDITOR_CONVERT_CONCURRENCY'] ?? 2),
    convertConcurrencyTotal: Number(env['EDITOR_CONVERT_CONCURRENCY_TOTAL'] ?? 4),
    maxConvertOutputBytes: Number(env['EDITOR_MAX_CONVERT_OUTPUT_BYTES'] ?? DEFAULT_MAX_SOURCE_BYTES),

    consumersJson: env['CONSUMERS'],
    consumerApiKey: env['CONSUMER_API_KEY'],
    notifySecrets,

    uploadDir: env['UPLOAD_DIR'] ?? '/tmp/monolith-docs-uploads',
    trustProxy: parseTrustProxy(env['TRUST_PROXY']),
    // From apps/api/src or apps/api/dist, two levels up is apps/.
    pluginDir: env['EDITOR_PLUGIN_DIR'] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugin'),
    uploadTtlMs: Number(env['UPLOAD_TTL_MS'] ?? 24 * 60 * 60 * 1000),
  };
}

/** Problems that stop the service from starting (E4); outside `local` the list is longer. */
export function configProblems(cfg: Config, rawEditorEnv: string | undefined): string[] {
  const problems: string[] = [];
  if (rawEditorEnv !== undefined && !(ENVS as readonly string[]).includes(rawEditorEnv)) {
    problems.push(`EDITOR_ENV must be one of ${ENVS.join(', ')}`);
  }
  if (cfg.sealKeys.length === 0) problems.push('EDITOR_SEAL_KEYS must hold at least one key');
  if (cfg.sealKeys.length > 2) problems.push('EDITOR_SEAL_KEYS holds at most two keys (current, previous)');
  if (cfg.sealKeys.some((k) => k.length !== 32)) problems.push('every EDITOR_SEAL_KEYS key must be 32 bytes (base64url)');
  const ids = cfg.sealKeys.map((k) => createHash('sha256').update(k).digest()[0]);
  if (new Set(ids).size !== ids.length) problems.push('the two EDITOR_SEAL_KEYS keys share a key id; generate a new current key');
  // Numbers: a typo must not become NaN, zero, or a negative limit (an instantly expiring session, an instant timeout).
  const positive: Array<[string, number, number]> = [
    ['EDITOR_MAX_SESSION_MS', cfg.maxSessionMs, 60_000],
    ['EDITOR_NOTIFY_TIMEOUT_MS', cfg.notifyTimeoutMs, 100],
    ['EDITOR_SOURCE_TIMEOUT_MS', cfg.sourceTimeoutMs, 1_000],
    ['EDITOR_MAX_SOURCE_BYTES', cfg.maxSourceBytes, 1],
    ['EDITOR_SOURCE_CONCURRENCY', cfg.sourceConcurrency, 1],
    ['EDITOR_CONVERT_TIMEOUT_MS', cfg.convertTimeoutMs, 1_000],
    ['EDITOR_CONVERT_CONCURRENCY', cfg.convertConcurrency, 1],
    ['EDITOR_CONVERT_CONCURRENCY_TOTAL', cfg.convertConcurrencyTotal, 1],
    ['EDITOR_MAX_CONVERT_OUTPUT_BYTES', cfg.maxConvertOutputBytes, 1],
    ['PORT', cfg.port, 1],
    ['RATE_LIMIT_MAX', cfg.rateLimitMax, 1],
    ['RATE_LIMIT_WINDOW_MS', cfg.rateLimitWindowMs, 1],
    ['UPLOAD_TTL_MS', cfg.uploadTtlMs, 1],
  ];
  for (const [name, value, min] of positive) {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < min) problems.push(`${name} must be a whole number of at least ${min}`);
  }
  // DocumentServer itself refuses downloads over 100 MB (ADR F8); a larger cap here would only move the refusal.
  if (cfg.maxSourceBytes > DEFAULT_MAX_SOURCE_BYTES) problems.push(`EDITOR_MAX_SOURCE_BYTES must be at most ${DEFAULT_MAX_SOURCE_BYTES} (DocumentServer's own download cap)`);
  // Files are held in memory whole (ADR F17): the caps bound the ceiling,
  // (EDITOR_SOURCE_CONCURRENCY + EDITOR_CONVERT_CONCURRENCY_TOTAL) x 100 MB at most.
  if (cfg.maxConvertOutputBytes > DEFAULT_MAX_SOURCE_BYTES) problems.push(`EDITOR_MAX_CONVERT_OUTPUT_BYTES must be at most ${DEFAULT_MAX_SOURCE_BYTES}`);
  // A Cloudflare-proxied request is held open 100 s; past that the consumer never gets the answer.
  if (cfg.convertTimeoutMs > 95_000) problems.push('EDITOR_CONVERT_TIMEOUT_MS must be at most 95000 (a proxied request is held open 100 s)');
  const trustProblem = cfg.trustProxy ? trustProxyProblem(cfg.trustProxy) : null;
  if (trustProblem) problems.push(trustProblem);
  if (cfg.convertConcurrency > cfg.convertConcurrencyTotal) problems.push('EDITOR_CONVERT_CONCURRENCY must not exceed EDITOR_CONVERT_CONCURRENCY_TOTAL');
  if (cfg.notifyTimeoutMs >= 600_000) problems.push("EDITOR_NOTIFY_TIMEOUT_MS must stay below DocumentServer's 10-minute callback timeout");
  if (!cfg.strict) return problems;

  // DocumentServer fetches directly only from its allow-listed origin; any other internal URL would
  // fail every open and conversion behind its private-address filter. Exactly this value: every
  // internal URL is built as `${apiInternalUrl}/api/...`, so a trailing slash or a path breaks them all.
  if (cfg.apiInternalUrl !== DOCUMENTSERVER_DIRECT_ORIGIN) {
    problems.push(`API_INTERNAL_URL must be ${DOCUMENTSERVER_DIRECT_ORIGIN} (DocumentServer's directIfIn allow-list, infrastructure/onlyoffice/local-production-linux.json)`);
  }

  const jwt = cfg.onlyofficeJwtSecret;
  if (WEAK_SECRETS.has(jwt) || jwt.startsWith('change-me') || Buffer.byteLength(jwt) < 32) {
    problems.push('ONLYOFFICE_JWT_SECRET must be a strong random value of at least 32 bytes');
  }
  if (cfg.corsOrigins === true) problems.push('CORS_ORIGINS must list origins (no wildcard)');
  if (!cfg.consumersJson && !cfg.consumerApiKey) problems.push('CONSUMERS must be configured');
  if (!cfg.apiPublicUrl.startsWith('https://')) problems.push('API_PUBLIC_URL must be https');
  if (!cfg.onlyofficePublicUrl.startsWith('https://')) problems.push('ONLYOFFICE_PUBLIC_URL must be https');
  return problems;
}

export const config: Config = loadConfig(process.env);
export const rawEditorEnv: string | undefined = process.env['EDITOR_ENV'];
