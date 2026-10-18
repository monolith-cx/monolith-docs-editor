import { describe, expect, it } from 'vitest';
import { MAX_PAYLOAD_BYTES, MAX_TOKEN_CHARS, SealError, openSession, openSource, sealSession, sealSource, sessionExpiry, signedUrlExpiry } from './session-token.js';
import type { SessionPayload } from './session-token.js';

const current = Buffer.alloc(32, 1);
const previous = Buffer.alloc(32, 2);
const payload = (over: Partial<SessionPayload> = {}): SessionPayload => ({
  p: 'document', c: 'crm', k: 'crm.doc1.e1', u: { id: 'u1', name: 'Rep' }, f: 'https://files.example.com/a.docx', n: 'a.docx', exp: Date.now() + 60_000, ...over,
});

describe('sealed sessions (D13)', () => {
  it('round-trips and hides its contents', () => {
    const token = sealSession(payload(), [current]);
    expect(token).not.toContain('crm');
    const opened = openSession(token, [current]);
    expect(opened.ok && opened.payload.k).toBe('crm.doc1.e1');
  });

  it('never opens an editor token as a source token, or the reverse (purpose bound in the AAD)', () => {
    const editor = sealSession(payload(), [current]);
    const source = sealSource({ c: 'crm', k: 'crm.d1.e1', f: 'https://files.test/a.docx', exp: Date.now() + 60_000 }, [current]);
    expect(openSource(editor, [current])).toMatchObject({ ok: false, reason: 'tampered' });
    expect(openSession(source, [current])).toMatchObject({ ok: false, reason: 'tampered' });
    expect(openSource(source, [current])).toMatchObject({ ok: true });
  });

  it('separates a missing key (misconfiguration) from an oversized payload', () => {
    expect(() => sealSession(payload(), [])).toThrow(SealError);
    expect(() => sealSession(payload({ n: 'x'.repeat(5000) }), [current])).toThrow('too_large');
  });

  it('opens a token sealed with the previous key while that key is configured', () => {
    const token = sealSession(payload(), [previous]);
    expect(openSession(token, [current, previous]).ok).toBe(true);
    expect(openSession(token, [current])).toMatchObject({ ok: false, reason: 'unknown_key' });
  });

  it('refuses a tampered token and names the consumer of an expired one', () => {
    const token = sealSession(payload(), [current]);
    const flipped = token.slice(0, 20) + (token[20] === 'A' ? 'B' : 'A') + token.slice(21);
    expect(openSession(flipped, [current]).ok).toBe(false);
    const expired = sealSession(payload({ exp: Date.now() - 1 }), [current]);
    expect(openSession(expired, [current])).toMatchObject({ ok: false, reason: 'expired', consumer: 'crm' });
    expect(openSession('not!a!token', [current])).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('caps the payload and keeps the largest token within the router limit', () => {
    expect(() => sealSession(payload({ f: `https://x/${'a'.repeat(MAX_PAYLOAD_BYTES)}` }), [current])).toThrow();
    const big = sealSession(payload({ f: `https://x/${'a'.repeat(MAX_PAYLOAD_BYTES - 400)}` }), [current]);
    expect(big.length).toBeLessThanOrEqual(MAX_TOKEN_CHARS);
    expect(openSession(big, [current]).ok).toBe(true);
  });
});

describe('expiry', () => {
  it('reads GCS v4, S3 v4, and epoch expiries from signed URLs', () => {
    expect(signedUrlExpiry('https://s/x?X-Goog-Date=20261018T000000Z&X-Goog-Expires=3600')).toBe(Date.UTC(2026, 9, 18, 1, 0, 0));
    expect(signedUrlExpiry('https://s/x?X-Amz-Date=20261018T000000Z&X-Amz-Expires=60')).toBe(Date.UTC(2026, 9, 18, 0, 1, 0));
    expect(signedUrlExpiry('https://s/x?Expires=1792300000')).toBe(1792300000_000);
    expect(signedUrlExpiry('https://s/x')).toBeNull();
  });

  it('never outlives the file URL or the configured maximum', () => {
    const now = Date.UTC(2026, 9, 18, 0, 0, 0);
    expect(sessionExpiry('https://s/x', 12 * 3600_000, now)).toBe(now + 12 * 3600_000);
    expect(sessionExpiry('https://s/x?X-Goog-Date=20261018T000000Z&X-Goog-Expires=600', 12 * 3600_000, now)).toBe(now + 600_000);
  });
});
