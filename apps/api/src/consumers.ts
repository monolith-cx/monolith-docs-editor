/**
 * Consumer registration: which apps can call the editor service, and how.
 *
 * Consumers are configured through `CONSUMERS` (JSON) so the service stays stateless:
 *   CONSUMERS='[{"id":"crm","name":"Monolith CRM","auth":{...},"hostname":"crm.example",...}]'
 * For a quick local setup, `CONSUMER_API_KEY` creates one api-key consumer (refused outside `local`).
 *
 * A consumer opts into the profile surface (EDIT-2, guidance E5) with `profiles`; only such an
 * entry must carry the registration fields below. A legacy-only entry (today's `fastmail-connect`)
 * stays valid as it is, so a deploy never takes a live consumer down.
 */
import { config } from './config.js';
import { UrlRefused, checkUrl } from './safe-url.js';

export interface JwksAuth {
  mode: 'jwks';
  jwksUrl: string;
  audience?: string;
  issuer?: string;
}

export interface ApiKeyAuth {
  mode: 'api-key';
  key: string;
}

export interface HmacAuth {
  mode: 'hmac';
  secret: string;
  issuer: string;
  audience?: string;
}

export type Profile = 'document' | 'template' | 'view';

export interface Consumer {
  id: string;
  name: string;
  auth: JwksAuth | ApiKeyAuth | HmacAuth;
  /** Bind this consumer to a specific request hostname. Only requests on this hostname can authenticate as this consumer. */
  hostname?: string;
  /** Legacy: domains once allowed for a per-request callbackUrl. The legacy shape refuses callbackUrl since EDIT-2 (E1). */
  allowedCallbackDomains?: string[];

  /** Profiles this consumer may open (E5). Absent: legacy request shape only. */
  profiles?: Profile[];
  /** The one notification endpoint (https outside `local`). */
  callbackUrl?: string;
  /** Name of the environment variable holding the notification secret; `<name>_PREVIOUS` holds the previous one during rotation. */
  notificationSecretRef?: string;
  /** Exact origins the consumer's panel pages are served from. */
  panelOrigins?: string[];
  /** Hosts an `open` fileUrl may name. */
  fileHosts?: string[];
  /** Hosts a conversion may read from and upload to (EDIT-3). */
  convertSourceHosts?: string[];
  convertUploadHosts?: string[];
  /** The origin the expired page links back to. */
  returnOrigin?: string;
}

/** Consumer ids are the first component of every document key: `[0-9A-Za-z_-]` only (D13). */
export const KEY_COMPONENT = /^[0-9A-Za-z_-]+$/;
export const PROFILES: readonly Profile[] = ['document', 'template', 'view'];

let consumers: Consumer[] | undefined;

function isWebOrigin(value: string, strict: boolean): boolean {
  try {
    const u = new URL(value);
    if (u.origin !== value) return false;
    return u.protocol === 'https:' || (!strict && u.protocol === 'http:');
  } catch {
    return false;
  }
}

/** Configuration errors (empty = valid). `strict` is everything except `EDITOR_ENV=local`. */
export function validateConsumersConfig(consumerList: Consumer[], strict: boolean): string[] {
  const errors: string[] = [];

  const ids = new Set<string>();
  for (const c of consumerList) {
    if (ids.has(c.id)) errors.push(`Duplicate consumer ID: ${c.id}`);
    ids.add(c.id);
    if (!KEY_COMPONENT.test(c.id)) errors.push(`Consumer ${c.id}: id must match [0-9A-Za-z_-]`);
  }

  const hostnames = new Set<string>();
  for (const c of consumerList) {
    if (c.hostname) {
      if (hostnames.has(c.hostname)) errors.push(`Duplicate consumer hostname: ${c.hostname}`);
      hostnames.add(c.hostname);
    }
  }

  for (const c of consumerList) {
    if (c.auth.mode === 'hmac') {
      if (c.auth.secret.length < 32) errors.push(`Consumer ${c.id}: HMAC secret must be at least 32 characters`);
      if (!c.auth.issuer) errors.push(`Consumer ${c.id}: HMAC auth requires an issuer`);
    }
    if (c.auth.mode === 'jwks' && !c.auth.jwksUrl?.startsWith('https://')) {
      errors.push(`Consumer ${c.id}: JWKS URL must start with https://`);
    }
    if (c.auth.mode === 'api-key' && strict) {
      errors.push(`Consumer ${c.id}: API key auth mode is only allowed with EDITOR_ENV=local (use hmac or jwks)`);
    }

    if (c.profiles === undefined) {
      // A legacy-only consumer gets no notifications; registration fields meant for them are a mistake.
      if (c.callbackUrl !== undefined || c.notificationSecretRef !== undefined) {
        errors.push(`Consumer ${c.id}: callbackUrl and notificationSecretRef need profiles (a legacy-only consumer receives no notifications)`);
      }
      continue;
    }
    // A profile-capable consumer must carry its whole registration (E5).
    if (!Array.isArray(c.profiles) || c.profiles.length === 0 || c.profiles.some((p) => !PROFILES.includes(p))) {
      errors.push(`Consumer ${c.id}: profiles must be a non-empty list of ${PROFILES.join(', ')}`);
    }
    if (!c.callbackUrl) {
      errors.push(`Consumer ${c.id}: profile-capable consumers need callbackUrl`);
    } else {
      try {
        const u = new URL(c.callbackUrl);
        if (u.protocol !== 'https:' && (strict || u.protocol !== 'http:')) {
          errors.push(`Consumer ${c.id}: callbackUrl must be https`);
        }
      } catch {
        errors.push(`Consumer ${c.id}: callbackUrl is not a URL`);
      }
    }
    if (!c.notificationSecretRef || !/^EDITOR_NOTIFY_SECRET_[A-Z0-9_]+$/.test(c.notificationSecretRef) || c.notificationSecretRef.endsWith('_PREVIOUS')) {
      errors.push(`Consumer ${c.id}: notificationSecretRef must name an EDITOR_NOTIFY_SECRET_* variable not ending in _PREVIOUS`);
    }
    for (const field of ['fileHosts', 'convertSourceHosts', 'convertUploadHosts'] as const) {
      const list = c[field];
      if (!Array.isArray(list) || list.length === 0 || list.some((h) => typeof h !== 'string' || !h || h.includes('/'))) {
        errors.push(`Consumer ${c.id}: ${field} must be a non-empty list of host names`);
      }
    }
    if (!Array.isArray(c.panelOrigins) || c.panelOrigins.some((o) => !isWebOrigin(o, strict))) {
      errors.push(`Consumer ${c.id}: panelOrigins must be a list of https origins`);
    }
    if (!c.returnOrigin || !isWebOrigin(c.returnOrigin, strict)) {
      errors.push(`Consumer ${c.id}: returnOrigin must be an https origin`);
    }
  }

  return errors;
}

function parseConsumers(): Consumer[] {
  if (config.consumersJson) return JSON.parse(config.consumersJson) as Consumer[];
  if (config.consumerApiKey) {
    return [{ id: 'default', name: 'Default API Key Consumer', auth: { mode: 'api-key', key: config.consumerApiKey } }];
  }
  // No consumers: auth is off, which configProblems refuses outside `local`.
  return [];
}

export function getConsumers(): Consumer[] {
  if (consumers) return consumers;
  const parsed = parseConsumers();
  const errors = validateConsumersConfig(parsed, config.strict);
  if (errors.length > 0 && config.strict) {
    throw new Error(`Invalid consumer configuration:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }
  consumers = parsed;
  return consumers;
}

/** Consumer configuration problems, for startup reporting; never throws. */
export function consumerProblems(): string[] {
  let list: Consumer[];
  try {
    list = parseConsumers();
  } catch {
    return ['CONSUMERS is not valid JSON'];
  }
  return [...validateConsumersConfig(list, config.strict), ...notificationSecretProblems(list, config.notifySecrets, config.strict)];
}

/**
 * Notification secrets (EDIT-2.1, E4): each profile-capable consumer's secret is set, no two
 * consumers share one (a shared secret would let one consumer's notifications verify as the
 * other's), and outside `local` the current and previous values are at least 32 bytes.
 */
export function notificationSecretProblems(list: readonly Consumer[], secrets: Readonly<Record<string, string>>, strict: boolean): string[] {
  const problems: string[] = [];
  const owners = new Map<string, string>();
  const valueOwners = new Map<string, { id: string; ref: string }>();
  for (const c of list) {
    const ref = c.notificationSecretRef;
    if (!ref) continue;
    const other = owners.get(ref);
    if (other) problems.push(`Consumers ${other} and ${c.id} share ${ref}; each consumer needs its own notification secret`);
    owners.set(ref, c.id);
    const current = secrets[ref];
    if (!current) {
      problems.push(`Consumer ${c.id}: ${ref} is not set`);
      continue;
    }
    // The same value under two names is a shared secret too (a shared name is reported above),
    // current and previous alike: during a rotation either one verifies a notification.
    for (const value of [current, secrets[`${ref}_PREVIOUS`]]) {
      if (!value) continue;
      const sameValue = valueOwners.get(value);
      if (sameValue && sameValue.ref !== ref) problems.push(`Consumers ${sameValue.id} and ${c.id} use the same notification secret value; each consumer needs its own`);
      if (!sameValue) valueOwners.set(value, { id: c.id, ref });
    }
    if (!strict) continue;
    for (const [name, value] of [[ref, current], [`${ref}_PREVIOUS`, secrets[`${ref}_PREVIOUS`]]] as const) {
      if (value !== undefined && Buffer.byteLength(value) < 32) problems.push(`Consumer ${c.id}: ${name} must be a random value of at least 32 bytes`);
    }
  }
  return problems;
}

/**
 * Resolves each consumer's callbackUrl once at startup and warns when it would be refused at
 * delivery (EDIT-2.1: checked as https at load, resolution only warned on; every delivery
 * resolves and pins it again). Never logs the URL.
 */
export async function warnOnCallbackResolution(warn: (fields: Record<string, unknown>, msg: string) => void): Promise<void> {
  for (const c of getConsumers()) {
    if (!c.callbackUrl) continue;
    try {
      await checkUrl(c.callbackUrl, { local: !config.strict });
    } catch (err) {
      warn({ consumerId: c.id, reason: err instanceof UrlRefused ? err.code : 'invalid' }, 'Consumer callbackUrl would be refused at delivery');
    }
  }
}

/** Reset cached consumers (for testing) */
export function resetConsumers(): void {
  consumers = undefined;
}

/** Force set consumers for testing (bypasses env parsing) */
export function setConsumersForTest(list: Consumer[]): void {
  consumers = list;
}

export function findConsumerById(id: string): Consumer | undefined {
  return getConsumers().find((c) => c.id === id);
}

export function findConsumerByApiKey(key: string): Consumer | undefined {
  return getConsumers().find((c) => c.auth.mode === 'api-key' && c.auth.key === key);
}

export function getJwksConsumers(): Consumer[] {
  return getConsumers().filter((c) => c.auth.mode === 'jwks');
}

export function getHmacConsumers(): Consumer[] {
  return getConsumers().filter((c) => c.auth.mode === 'hmac');
}

/**
 * Find consumers that can authenticate on the given hostname.
 * If any consumers are bound to this hostname, return only those.
 * If none are bound, return consumers with no hostname set (unchanged behaviour; SA-1.6 is a separate follow-up).
 */
export function findConsumersByHostname(hostname: string): Consumer[] {
  const all = getConsumers();
  const bound = all.filter((c) => c.hostname === hostname);
  return bound.length > 0 ? bound : all.filter((c) => !c.hostname);
}

/** The notification secrets for a consumer: current first, then the previous one during rotation. */
export function notificationSecrets(consumer: Consumer): string[] {
  const ref = consumer.notificationSecretRef;
  if (!ref) return [];
  return [config.notifySecrets[ref], config.notifySecrets[`${ref}_PREVIOUS`]].filter((s): s is string => Boolean(s));
}
