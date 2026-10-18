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

  consumersJson: string | undefined;
  consumerApiKey: string | undefined;
  /** Notification secrets by environment variable name (only `EDITOR_NOTIFY_SECRET_*`). */
  notifySecrets: Record<string, string>;

  uploadDir: string;
  uploadTtlMs: number;
}

const ENVS: readonly EditorEnv[] = ['local', 'dev', 'staging', 'production'];
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
    apiInternalUrl: env['API_INTERNAL_URL'] ?? 'http://api:3020',

    corsOrigins: parseCorsOrigins(env['CORS_ORIGINS']),
    rateLimitMax: Number(env['RATE_LIMIT_MAX'] ?? 100),
    rateLimitWindowMs: Number(env['RATE_LIMIT_WINDOW_MS'] ?? 60_000),

    sealKeys: parseSealKeys(env['EDITOR_SEAL_KEYS']),
    maxSessionMs: Math.min(Number(env['EDITOR_MAX_SESSION_MS'] ?? TWELVE_HOURS_MS), TWELVE_HOURS_MS),
    notifyTimeoutMs: Number(env['EDITOR_NOTIFY_TIMEOUT_MS'] ?? 10_000),
    sourceTimeoutMs: Number(env['EDITOR_SOURCE_TIMEOUT_MS'] ?? 120_000),
    maxSourceBytes: Number(env['EDITOR_MAX_SOURCE_BYTES'] ?? DEFAULT_MAX_SOURCE_BYTES),

    consumersJson: env['CONSUMERS'],
    consumerApiKey: env['CONSUMER_API_KEY'],
    notifySecrets,

    uploadDir: env['UPLOAD_DIR'] ?? '/tmp/monolith-docs-uploads',
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
    ['PORT', cfg.port, 1],
    ['RATE_LIMIT_MAX', cfg.rateLimitMax, 1],
    ['RATE_LIMIT_WINDOW_MS', cfg.rateLimitWindowMs, 1],
    ['UPLOAD_TTL_MS', cfg.uploadTtlMs, 1],
  ];
  for (const [name, value, min] of positive) {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < min) problems.push(`${name} must be a whole number of at least ${min}`);
  }
  if (cfg.notifyTimeoutMs >= 600_000) problems.push("EDITOR_NOTIFY_TIMEOUT_MS must stay below DocumentServer's 10-minute callback timeout");
  if (!cfg.strict) return problems;

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
