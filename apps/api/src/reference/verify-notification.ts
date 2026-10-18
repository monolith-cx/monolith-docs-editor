/**
 * Reference verifier for editor-service notifications (EDIT-2.7). The consumer guide quotes this
 * file; consumers port it. It checks, in order:
 *  1. the timestamp is within the window (default 5 minutes) of the consumer's clock;
 *  2. one `v1=` signature matches HMAC-SHA256("<timestamp>.<raw body>") under one of the
 *     consumer's secrets (current, or previous during rotation), compared in constant time;
 *  3. the body's key is one the consumer issued (key binding);
 *  4. a save (status 2 or 6) carries a deliveryId the consumer has not processed (replay).
 * Verify against the raw request body, before any JSON parsing.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifyInput {
  rawBody: string;
  timestampHeader: string | undefined;
  signatureHeader: string | undefined;
  deliveryHeader: string | undefined;
  secrets: readonly string[];
  /** Is this a document key the consumer issued and still expects notifications for? */
  isKnownKey: (key: string) => boolean;
  /** Has this deliveryId already been processed? (Keep ids at least as long as the window.) */
  seenDelivery: (id: string) => boolean;
  nowSeconds?: number;
  windowSeconds?: number;
}

export type VerifyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; reason: 'stale' | 'bad_signature' | 'malformed' | 'unknown_key' | 'replay' };

function hexEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export function verifyNotification(input: VerifyInput): VerifyResult {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const window = input.windowSeconds ?? 300;
  const ts = Number(input.timestampHeader);
  if (!input.timestampHeader || !Number.isInteger(ts) || Math.abs(now - ts) > window) return { ok: false, reason: 'stale' };

  const given = (input.signatureHeader ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('v1='))
    .map((s) => s.slice(3));
  const matches = input.secrets.some((secret) => {
    const expected = createHmac('sha256', secret).update(`${input.timestampHeader}.${input.rawBody}`).digest('hex');
    return given.some((g) => hexEqual(g, expected));
  });
  if (!matches) return { ok: false, reason: 'bad_signature' };

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(input.rawBody) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof body['key'] !== 'string' || !input.isKnownKey(body['key'])) return { ok: false, reason: 'unknown_key' };
  const status = body['status'];
  if (status === 2 || status === 6) {
    const id = body['deliveryId'];
    if (typeof id !== 'string' || id !== input.deliveryHeader || input.seenDelivery(id)) return { ok: false, reason: 'replay' };
  }
  return { ok: true, body };
}
