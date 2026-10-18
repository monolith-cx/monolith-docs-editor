/**
 * Stateless per-open sessions (D13, EDIT-2.3): everything the editor page needs travels in the
 * editor URL as a sealed token, so the service keeps no session state.
 *
 * Format (base64url): version (1) | key id (1) | nonce (12) | ciphertext | tag (16).
 * AES-256-GCM with the version, the key id, and the token's purpose bound as additional
 * authenticated data, so an editor token never opens as a source token or the reverse. The key id
 * is the first byte of SHA-256(key), so a rotated-out key (the second entry of EDITOR_SEAL_KEYS)
 * still opens its tokens until they expire. The payload is capped at 4 KB before sealing.
 *
 * Two purposes:
 *  - `editor`: the editor URL (`/editor/<token>`), held by the browser;
 *  - `source`: the document URL DocumentServer fetches (`/api/documents/source/<token>`), so the
 *    service, not DocumentServer, fetches the consumer's file on a pinned address (EDIT-2.2).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 1;
export const MAX_PAYLOAD_BYTES = 4096;
/** The longest token the router must accept: header + nonce + payload + tag, base64url. */
export const MAX_TOKEN_CHARS = Math.ceil(((2 + 12 + MAX_PAYLOAD_BYTES + 16) * 4) / 3) + 4;

export interface SessionPayload {
  /** Profile: document | template | view, or the legacy configurations (E1). */
  p: 'document' | 'template' | 'view' | 'legacy-edit' | 'legacy-view';
  /** Consumer id. */
  c: string;
  /** Document key. */
  k: string;
  /** User. */
  u: { id: string; name: string };
  /** File URL handed to DocumentServer. */
  f: string;
  /** File name (title). */
  n: string;
  /** Panel URL (document/template), with the panel token in its fragment. */
  pu?: string;
  /** Legacy permissions. */
  perm?: { download: boolean; print: boolean };
  /** Expiry, epoch milliseconds. */
  exp: number;
}

/** What a source token carries: the consumer, the document key (for logs), the file URL, the expiry. */
export interface SourcePayload {
  c: string;
  k: string;
  f: string;
  exp: number;
}

type Purpose = 'editor' | 'source';
const PURPOSE_BYTE: Record<Purpose, number> = { editor: 0x45, source: 0x53 };

export type OpenResult<T = SessionPayload> =
  | { ok: true; payload: T }
  | { ok: false; reason: 'malformed' | 'unknown_key' | 'tampered' | 'expired'; consumer?: string };

function keyId(key: Buffer): number {
  return createHash('sha256').update(key).digest()[0] ?? 0;
}

function aad(header: Buffer, purpose: Purpose): Buffer {
  return Buffer.concat([header, Buffer.from([PURPOSE_BYTE[purpose]])]);
}

function seal(purpose: Purpose, payload: object, keys: Buffer[]): string {
  const key = keys[0];
  if (!key || key.length !== 32) throw new SealError('no_key');
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  if (plain.length > MAX_PAYLOAD_BYTES) throw new SealError('too_large');
  const header = Buffer.from([VERSION, keyId(key)]);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(header, purpose));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([header, nonce, body, cipher.getAuthTag()]).toString('base64url');
}

function open<T extends { exp: number; c: string }>(purpose: Purpose, token: string, keys: Buffer[], now: number): OpenResult<T> {
  if (token.length > MAX_TOKEN_CHARS || !/^[A-Za-z0-9_-]+$/.test(token)) return { ok: false, reason: 'malformed' };
  const raw = Buffer.from(token, 'base64url');
  if (raw.length < 2 + 12 + 16 + 1 || raw[0] !== VERSION) return { ok: false, reason: 'malformed' };
  const key = keys.find((k) => keyId(k) === raw[1]);
  if (!key) return { ok: false, reason: 'unknown_key' };
  const header = raw.subarray(0, 2);
  const nonce = raw.subarray(2, 14);
  const tag = raw.subarray(raw.length - 16);
  const body = raw.subarray(14, raw.length - 16);
  let payload: T;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(aad(header, purpose));
    decipher.setAuthTag(tag);
    payload = JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')) as T;
  } catch {
    return { ok: false, reason: 'tampered' };
  }
  if (typeof payload.exp !== 'number' || !(payload.exp > now)) return { ok: false, reason: 'expired', consumer: payload.c };
  return { ok: true, payload };
}

/** Sealing failed: no usable key (a server misconfiguration) or a payload over the cap. */
export class SealError extends Error {
  constructor(readonly code: 'no_key' | 'too_large') {
    super(code);
    this.name = 'SealError';
  }
}

export function sealSession(payload: SessionPayload, keys: Buffer[]): string {
  return seal('editor', payload, keys);
}

export function openSession(token: string, keys: Buffer[], now = Date.now()): OpenResult {
  return open<SessionPayload>('editor', token, keys, now);
}

export function sealSource(payload: SourcePayload, keys: Buffer[]): string {
  return seal('source', payload, keys);
}

export function openSource(token: string, keys: Buffer[], now = Date.now()): OpenResult<SourcePayload> {
  return open<SourcePayload>('source', token, keys, now);
}

/**
 * The expiry a signed file URL states, when it states one: GCS v4 (`X-Goog-Date` + `X-Goog-Expires`),
 * S3 v4 (`X-Amz-Date` + `X-Amz-Expires`), or an epoch-seconds `Expires` / `expires` parameter.
 */
export function signedUrlExpiry(raw: string): number | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const q = url.searchParams;
  for (const [dateKey, ttlKey] of [['X-Goog-Date', 'X-Goog-Expires'], ['X-Amz-Date', 'X-Amz-Expires']] as const) {
    const date = q.get(dateKey);
    const ttl = q.get(ttlKey);
    if (date && ttl) {
      const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(date);
      if (m) {
        const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
        return Date.UTC(y, mo - 1, d, h, mi, s) + Number(ttl) * 1000;
      }
    }
  }
  const epoch = q.get('Expires') ?? q.get('expires');
  if (epoch && /^\d{9,11}$/.test(epoch)) return Number(epoch) * 1000;
  return null;
}

/** A session's expiry: at most `maxMs` from now and never past the file URL's own expiry. */
export function sessionExpiry(fileUrl: string, maxMs: number, now = Date.now()): number {
  const cap = now + maxMs;
  const fileExpiry = signedUrlExpiry(fileUrl);
  return fileExpiry === null ? cap : Math.min(cap, fileExpiry);
}
