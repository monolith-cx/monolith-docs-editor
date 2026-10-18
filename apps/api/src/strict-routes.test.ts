/**
 * The routes under a strict EDITOR_ENV (EDIT-2 review attempt 1, M4). Every other route test and
 * the battery run with EDITOR_ENV=local, which relaxes the callback token and the URL rules; this
 * file loads the modules afresh under `production` so the strict wiring itself is exercised.
 */
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const JWT_SECRET = 'strict-test-jwt-secret-0123456789abcdef';

let mod: {
  buildApp: typeof import('./app.js').buildApp;
  sealSource: typeof import('./session-token.js').sealSource;
  sealKeys: Buffer[];
  setConsumersForTest: typeof import('./consumers.js').setConsumersForTest;
  resetConsumers: typeof import('./consumers.js').resetConsumers;
};

beforeAll(async () => {
  vi.resetModules();
  vi.stubEnv('EDITOR_ENV', 'production');
  vi.stubEnv('ONLYOFFICE_JWT_SECRET', JWT_SECRET);
  vi.stubEnv('CORS_ORIGINS', 'https://crm.example.com');
  vi.stubEnv('API_PUBLIC_URL', 'https://editor.example.com');
  vi.stubEnv('ONLYOFFICE_PUBLIC_URL', 'https://ds.example.com');
  const app = await import('./app.js');
  const consumers = await import('./consumers.js');
  const tokens = await import('./session-token.js');
  const cfg = await import('./config.js');
  mod = { buildApp: app.buildApp, sealSource: tokens.sealSource, sealKeys: cfg.config.sealKeys, setConsumersForTest: consumers.setConsumersForTest, resetConsumers: consumers.resetConsumers };
  // Set directly: the strict loader refuses api-key consumers, and these tests are about the routes.
  mod.setConsumersForTest([
    {
      id: 'crm',
      name: 'CRM',
      auth: { mode: 'api-key', key: 'crm-key' },
      profiles: ['document', 'view'],
      callbackUrl: 'https://crm.example.com/udoc/notify',
      notificationSecretRef: 'EDITOR_NOTIFY_SECRET_TEST',
      panelOrigins: ['https://crm.example.com'],
      fileHosts: ['127.0.0.1', 'localhost'],
      convertSourceHosts: ['127.0.0.1', '8.8.8.8'],
      convertUploadHosts: ['127.0.0.1', '8.8.8.8'],
      returnOrigin: 'https://crm.example.com',
    },
  ]);
});

afterAll(() => {
  mod.resetConsumers();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const open = (fileUrl: string) =>
  mod.buildApp().inject({
    method: 'POST',
    url: '/api/documents/open',
    headers: { authorization: 'Bearer crm-key', host: 'editor.example.com' },
    payload: { profile: 'view', documentRef: 'd1', revision: '1', mode: 'v', fileUrl, user: { id: 'u1', name: 'Rep' } },
  });

describe('strict EDITOR_ENV', () => {
  it('refuses an http fileUrl and a private address over https at open', async () => {
    expect((await open('http://127.0.0.1/a.docx')).json()).toEqual({ error: 'file_url_refused:scheme' });
    expect((await open('https://127.0.0.1/a.docx')).json()).toEqual({ error: 'file_url_refused:private_address' });
    expect((await open('https://localhost/a.docx')).json()).toEqual({ error: 'file_url_refused:local_name' });
  });

  it('refuses at fetch time a source token whose file is http or private (no fetch is made)', async () => {
    for (const f of ['http://127.0.0.1:9/a.docx', 'https://127.0.0.1:9/a.docx']) {
      const token = mod.sealSource({ c: 'crm', k: 'crm.d1.e1', f, exp: Date.now() + 60_000 }, mod.sealKeys);
      const res = await mod.buildApp().inject({ method: 'GET', url: `/api/documents/source/${token}` });
      expect(res.statusCode).toBe(404);
    }
  });

  it('refuses http and private conversion URLs, source and upload, before anything is fetched', async () => {
    const convert = (sourceUrl: string, uploadUrl: string) =>
      mod.buildApp().inject({ method: 'POST', url: '/api/documents/convert', headers: { authorization: 'Bearer crm-key', host: 'editor.example.com' }, payload: { sourceUrl, uploadUrl } });
    expect((await convert('http://127.0.0.1/a.docx', 'https://8.8.8.8/u')).json()).toEqual({ error: 'source_url_refused' });
    expect((await convert('https://127.0.0.1/a.docx', 'https://8.8.8.8/u')).json()).toEqual({ error: 'source_url_refused' });
    expect((await convert('https://8.8.8.8/a.docx', 'http://127.0.0.1/u')).json()).toEqual({ error: 'upload_url_refused' });
    expect((await convert('https://8.8.8.8/a.docx', 'https://127.0.0.1/u')).json()).toEqual({ error: 'upload_url_refused' });
  });

  it('refuses a callback without a DocumentServer token', async () => {
    const res = await mod.buildApp().inject({
      method: 'POST',
      url: '/api/documents/callback',
      payload: { key: 'crm.d1.e1', status: 2, url: 'https://ds.example.com/cache/files/x/output.docx', users: ['u1'] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('accepts a signed callback (the token itself is not the obstacle)', async () => {
    const payload = { key: 'unknown-shape-key', status: 4, users: ['u1'] };
    const res = await mod.buildApp().inject({
      method: 'POST',
      url: '/api/documents/callback',
      headers: { authorization: `Bearer ${jwt.sign({ payload }, JWT_SECRET)}` },
      payload,
    });
    expect(res.json()).toEqual({ error: 0 });
  });
});
