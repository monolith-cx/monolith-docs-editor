/**
 * Signed consumer notifications (D13, EDIT-2.4; fixes ERRORS.md 2026-10-16 00:40, unsigned notification).
 *
 * Each POST to the consumer's registered callbackUrl carries:
 *   X-Editor-Timestamp: <unix seconds>
 *   X-Editor-Delivery:  <deliveryId> (statuses 2 and 6 only)
 *   X-Editor-Signature: v1=<hex HMAC-SHA256 of "<timestamp>.<body>"> (one per active secret during rotation)
 * The callback URL is resolved and pinned at every delivery (safe-url), redirects are not followed,
 * and the timeout is below DocumentServer's own callback timeout (E6).
 *
 * `deliveryId` = SHA-256 over key, status, lastsave (and forcesavetype for status 6): measured
 * stable across retries and distinct between saves (battery U5, ADR F2). It is unkeyed so secret
 * rotation does not change it, and never includes the URL (re-signed on every send).
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { Consumer } from './consumers.js';
import type { VerifiedCallback } from './callback-auth.js';
import type { DocumentKey } from './document-key.js';
import { UrlRefused, checkUrl, safeFetch } from './safe-url.js';

export const STATUS_EVENTS: Record<number, string> = {
  1: 'editing',
  2: 'saved',
  3: 'save_error',
  4: 'closed',
  6: 'force_saved',
  7: 'force_save_error',
};

export interface Notification {
  key: string;
  documentRef: string;
  revision: string;
  mode: 'e' | 'v';
  status: number;
  event: string;
  downloadUrl?: string;
  users: string[];
  actions?: Array<{ type: number; userid: string }>;
  lastsave?: string;
  deliveryId?: string;
}

export function deliveryId(cb: VerifiedCallback): string | undefined {
  if (cb.status !== 2 && cb.status !== 6) return undefined;
  // DocumentServer always sent lastsave in the battery (F2). Without it, a final save is still unique
  // (one per key; keys are never reused), but two force-saves would collide and the second would be
  // dropped as a replay, so a force-save without lastsave gets a random component (status 6 is never
  // retried, U5, so nothing needs its id to repeat).
  const lastsave = cb.lastsave ?? (cb.status === 6 ? `random:${randomUUID()}` : '');
  const parts = [cb.key, String(cb.status), lastsave, cb.status === 6 ? String(cb.forcesavetype ?? '') : ''];
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

export function buildNotification(cb: VerifiedCallback, key: DocumentKey, downloadUrl: string | undefined): Notification {
  const id = deliveryId(cb);
  return {
    key: cb.key,
    documentRef: key.documentRef,
    revision: key.revision,
    mode: key.mode,
    status: cb.status,
    event: STATUS_EVENTS[cb.status] ?? 'unknown',
    ...(downloadUrl ? { downloadUrl } : {}),
    users: cb.users ?? [],
    ...(cb.actions ? { actions: cb.actions } : {}),
    ...(cb.lastsave ? { lastsave: cb.lastsave } : {}),
    ...(id ? { deliveryId: id } : {}),
  };
}

export function signatureHeader(secrets: readonly string[], timestamp: string, body: string): string {
  return secrets.map((s) => `v1=${createHmac('sha256', s).update(`${timestamp}.${body}`).digest('hex')}`).join(',');
}

/** What to tell DocumentServer: acknowledge, or ask it to retry (HTTP 503; ADR F1). */
export type DeliveryOutcome =
  | { answer: 'ack'; consumerStatus: number }
  | { answer: 'ack-closed'; consumerStatus: number }
  | { answer: 'retry'; consumerStatus?: number; error?: string };

export async function deliver(opts: {
  consumer: Consumer;
  secrets: readonly string[];
  notification: Notification;
  timeoutMs: number;
  local: boolean;
  now?: number;
}): Promise<DeliveryOutcome> {
  const { consumer, notification } = opts;
  if (!consumer.callbackUrl || opts.secrets.length === 0) return { answer: 'retry', error: 'not_configured' };
  let checked;
  try {
    checked = await checkUrl(consumer.callbackUrl, { local: opts.local });
  } catch (err) {
    return { answer: 'retry', error: err instanceof UrlRefused ? err.code : 'url_check_failed' };
  }
  const body = JSON.stringify(notification);
  const timestamp = String(Math.floor((opts.now ?? Date.now()) / 1000));
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-editor-timestamp': timestamp,
    'x-editor-signature': signatureHeader(opts.secrets, timestamp, body),
  };
  if (notification.deliveryId) headers['x-editor-delivery'] = notification.deliveryId;
  try {
    const res = await safeFetch(checked, { method: 'POST', headers, body, signal: AbortSignal.timeout(opts.timeoutMs) });
    const text = await res.text().catch(() => '');
    if (res.status >= 200 && res.status < 300) return { answer: 'ack', consumerStatus: res.status };
    // The consumer's explicit "this key is closed, stop" (E6).
    if (res.status === 409 || res.status === 410) {
      try {
        if ((JSON.parse(text) as { code?: unknown }).code === 'key_closed') return { answer: 'ack-closed', consumerStatus: res.status };
      } catch {
        // not JSON: fall through to retry
      }
    }
    return { answer: 'retry', consumerStatus: res.status };
  } catch (err) {
    return { answer: 'retry', error: err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
}
