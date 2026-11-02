import { describe, expect, it } from 'vitest';
import type { Consumer } from './consumers.js';
import { consumerFrameAncestors, frameOrigins, isOrigin } from './origins.js';

const consumer = (extra: Partial<Consumer>): Consumer => ({ id: 'c', name: 'C', auth: { mode: 'api-key', key: 'k' }, ...extra });

describe('framing origins (EDIT-2.9)', () => {
  it('admits only exact web origins', () => {
    expect(isOrigin('https://crm.example.com')).toBe(true);
    expect(isOrigin('http://127.0.0.1:18202')).toBe(true);
    expect(isOrigin('http://[::1]:8080')).toBe(true);
    // Each of these is its own origin to the URL parser; none may reach a CSP source list.
    for (const bad of ['https://crm.example.com/', 'https://crm.example.com/path', "https://x.example.com; script-src *", 'https://a.com;script-src', 'https://a;b.com', 'https://a.com,b', 'https://*.a.com', "https://a'b.com", 'not a url', 'ftp://x.example.com', '*', 42, undefined]) {
      expect(isOrigin(bad)).toBe(false);
    }
  });

  it("collects a consumer's panel and return origins once each, dropping anything that is not an origin", () => {
    const c = consumer({ panelOrigins: ['https://panel.example.com', 'https://crm.example.com', 'https://bad.example.com/x'], returnOrigin: 'https://crm.example.com' });
    expect(frameOrigins(c)).toEqual(['https://panel.example.com', 'https://crm.example.com']);
  });

  it("frame-ancestors is 'self' plus the consumer's origins, or 'none'", () => {
    expect(consumerFrameAncestors(consumer({ panelOrigins: ['https://panel.example.com'], returnOrigin: 'https://crm.example.com' }))).toBe("'self' https://panel.example.com https://crm.example.com");
    expect(consumerFrameAncestors(consumer({ returnOrigin: 'https://crm.example.com' }))).toBe("'self' https://crm.example.com");
    expect(consumerFrameAncestors(consumer({}))).toBe("'none'");
    expect(consumerFrameAncestors(consumer({ panelOrigins: ['javascript:alert(1)'], returnOrigin: 'https://x.example.com; frame-ancestors *' }))).toBe("'none'");
    expect(consumerFrameAncestors(undefined)).toBe("'none'");
  });
});
