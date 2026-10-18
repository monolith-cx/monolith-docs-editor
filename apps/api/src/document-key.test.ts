import { describe, expect, it } from 'vitest';
import { buildKey, parseKey } from './document-key.js';

describe('document key (D13)', () => {
  it('builds and parses consumer.documentRef.modeRevision', () => {
    const built = buildKey({ consumer: 'crm', documentRef: 'doc_42', mode: 'e', revision: '7' });
    expect(built).toEqual({ ok: true, key: 'crm.doc_42.e7' });
    expect(parseKey('crm.doc_42.e7')).toEqual({ consumer: 'crm', documentRef: 'doc_42', mode: 'e', revision: '7' });
  });

  it('refuses a dot in any component, a bad mode, and keys over 128 characters', () => {
    expect(buildKey({ consumer: 'crm', documentRef: 'a.b', mode: 'e', revision: '1' })).toMatchObject({ ok: false, reason: 'bad_component' });
    expect(buildKey({ consumer: 'crm', documentRef: 'a', mode: 'x' as 'e', revision: '1' })).toMatchObject({ ok: false, reason: 'bad_mode' });
    expect(buildKey({ consumer: 'crm', documentRef: 'a'.repeat(130), mode: 'e', revision: '1' })).toMatchObject({ ok: false, reason: 'too_long' });
    expect(parseKey('legacy-uuid-from-before')).toBeNull();
    expect(parseKey('crm.doc.x1')).toBeNull();
  });
});
