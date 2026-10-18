import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { BRIDGE_PLUGIN_GUID } from './editor-config.js';
import { resetConsumers, setConsumersForTest } from './consumers.js';

const DS = 'http://ds-public.test';

describe('GET /plugins/udoc-bridge/* (EDIT-5.1)', () => {
  it('serves the manifest with the GUID the editor config registers, CORS for DocumentServer, and no consumer auth', async () => {
    const res = await buildApp().inject({ method: 'GET', url: '/plugins/udoc-bridge/config.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ guid: string; variations: Array<{ type: string; isVisual: boolean; isModal: boolean }> }>()).toMatchObject({
      guid: BRIDGE_PLUGIN_GUID,
      variations: [{ type: 'panelRight', isVisual: true, isModal: false }],
    });
    expect(res.headers['access-control-allow-origin']).toBe(DS);
    expect(res.headers['content-security-policy']).toContain(`frame-ancestors 'self' ${DS}`);
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  it("renders the page with this environment's DocumentServer, a nonce, and a CSP framing only registered panels", async () => {
    setConsumersForTest([
      { id: 'crm', name: 'CRM', auth: { mode: 'api-key', key: 'k' }, profiles: ['document'], panelOrigins: ['https://crm.example.com'] },
      { id: 'docs', name: 'Docs', auth: { mode: 'api-key', key: 'k2' }, profiles: ['template'], panelOrigins: ['https://docs.example.com'] },
    ]);
    try {
      const res = await buildApp().inject({ method: 'GET', url: '/plugins/udoc-bridge/index.html' });
      expect(res.statusCode).toBe(200);
      const csp = String(res.headers['content-security-policy']);
      const nonce = /'nonce-([^']+)'/.exec(csp)?.[1] ?? '';
      expect(nonce.length).toBeGreaterThan(10);
      expect(res.body).toContain(`<script nonce="${nonce}" src="${DS}/sdkjs-plugins/v1/plugins.js"></script>`);
      expect(res.body).not.toContain('{{');
      expect(csp).toContain('frame-src https://crm.example.com https://docs.example.com');
      expect(csp).toContain(`frame-ancestors 'self' ${DS} https://crm.example.com https://docs.example.com`);
      expect(csp).toContain("default-src 'none'");
      expect(res.headers['referrer-policy']).toBe('no-referrer');
    } finally {
      resetConsumers();
    }
  });

  it('serves the bridge scripts and nothing else from the folder', async () => {
    const app = buildApp();
    for (const file of ['bridge.js', 'commands.js', 'icon.png']) {
      expect((await app.inject({ method: 'GET', url: `/plugins/udoc-bridge/${file}` })).statusCode).toBe(200);
    }
    for (const url of ['/plugins/udoc-bridge/package.json', '/plugins/udoc-bridge/commands.test.mjs', '/plugins/udoc-bridge/..%2f..%2fpackage.json', '/plugins/udoc-bridge/%2e%2e/config.json']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
  });

  it('allows unsafe-eval and the plugins.js style hash on the page only, a fresh nonce each time, and drops bad consumer origins', async () => {
    setConsumersForTest([
      { id: 'crm', name: 'CRM', auth: { mode: 'api-key', key: 'k' }, profiles: ['document'], panelOrigins: ['https://crm.example.com'] },
      { id: 'old', name: 'Old', auth: { mode: 'api-key', key: 'k2' }, panelOrigins: ["https://x.example.com; script-src *", 'not a url'], returnOrigin: 'https://ok.example.com/path' },
    ]);
    try {
      const app = buildApp();
      const page1 = String((await app.inject({ method: 'GET', url: '/plugins/udoc-bridge/index.html' })).headers['content-security-policy']);
      const page2 = String((await app.inject({ method: 'GET', url: '/plugins/udoc-bridge/index.html' })).headers['content-security-policy']);
      const script = String((await app.inject({ method: 'GET', url: '/plugins/udoc-bridge/bridge.js' })).headers['content-security-policy']);
      expect(page1).toContain("'unsafe-eval'");
      expect(page1).toContain("'sha256-+hyDP+n2vEbTIcp6afJ/mXciplsnk96LITgc0vUcp/M='");
      expect(page1).toContain("connect-src 'self'");
      expect(page1).not.toContain('script-src *');
      expect(page1).not.toContain('not a url');
      expect(page1).not.toContain('ok.example.com/path');
      expect(/'nonce-([^']+)'/.exec(page1)?.[1]).not.toBe(/'nonce-([^']+)'/.exec(page2)?.[1]);
      expect(script).not.toContain('unsafe-eval');
      expect(script).toContain("default-src 'none'");
    } finally {
      resetConsumers();
    }
  });

  it('answers 404 for prototype names and anything but GET', async () => {
    const app = buildApp();
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect((await app.inject({ method: 'GET', url: `/plugins/udoc-bridge/${name}` })).statusCode).toBe(404);
    }
    expect((await app.inject({ method: 'POST', url: '/plugins/udoc-bridge/config.json' })).statusCode).toBe(404);
  });

  it('is not rate limited per address (every editor in an office shares one)', async () => {
    const app = buildApp();
    const codes = new Set<number>();
    for (let i = 0; i < 120; i += 1) codes.add((await app.inject({ method: 'GET', url: '/plugins/udoc-bridge/bridge.js' })).statusCode);
    expect([...codes]).toEqual([200]);
  });
});
