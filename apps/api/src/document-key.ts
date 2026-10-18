/**
 * The document key (D13): `<consumer>.<documentRef>.<mode><revision>`, at most 128 characters
 * (DocumentServer's limit). Components use `[0-9A-Za-z_-]` only, so `.` separates them unambiguously.
 * `mode` is `e` for the editing key and `v` for a view key on a saved revision.
 */
import { KEY_COMPONENT } from './consumers.js';

export const MAX_KEY_LENGTH = 128;

export interface DocumentKey {
  consumer: string;
  documentRef: string;
  mode: 'e' | 'v';
  revision: string;
}

export type KeyRefusal = 'bad_component' | 'bad_mode' | 'too_long';

export function buildKey(parts: DocumentKey): { ok: true; key: string } | { ok: false; reason: KeyRefusal } {
  if (![parts.consumer, parts.documentRef, parts.revision].every((p) => KEY_COMPONENT.test(p))) {
    return { ok: false, reason: 'bad_component' };
  }
  if (parts.mode !== 'e' && parts.mode !== 'v') return { ok: false, reason: 'bad_mode' };
  const key = `${parts.consumer}.${parts.documentRef}.${parts.mode}${parts.revision}`;
  if (key.length > MAX_KEY_LENGTH) return { ok: false, reason: 'too_long' };
  return { ok: true, key };
}

export function parseKey(key: string): DocumentKey | null {
  if (key.length > MAX_KEY_LENGTH) return null;
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  const [consumer, documentRef, last] = parts as [string, string, string];
  const mode = last[0];
  const revision = last.slice(1);
  if ((mode !== 'e' && mode !== 'v') || !revision) return null;
  if (![consumer, documentRef, revision].every((p) => KEY_COMPONENT.test(p))) return null;
  return { consumer, documentRef, mode, revision };
}
