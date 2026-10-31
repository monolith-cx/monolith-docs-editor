import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { buildApp } from './app.js';
import { resetConsumers, setConsumersForTest } from './consumers.js';
import type { Consumer } from './consumers.js';

const HMAC_SECRET = 'a-very-long-secret-that-is-at-least-32-characters';

function freshApp(consumerList?: Consumer[]) {
  resetConsumers();
  if (consumerList) {
    setConsumersForTest(consumerList);
  }
  return buildApp();
}

const hmacConsumers: Consumer[] = [{
  id: 'test-hmac',
  name: 'Test HMAC',
  auth: { mode: 'hmac', secret: HMAC_SECRET, issuer: 'test-issuer' },
}];

const apiKeyConsumers: Consumer[] = [{
  id: 'test-apikey',
  name: 'Test API Key',
  auth: { mode: 'api-key', key: 'test-dev-key' },
}];

const payload = { fileUrl: 'https://127.0.0.1/test.docx', user: { id: 'u1', name: 'User' } };

describe('HMAC auth', () => {
  it('authenticates with valid HMAC JWT', async () => {
    const app = freshApp(hmacConsumers);
    const token = jwt.sign({ sub: 'preview' }, HMAC_SECRET, {
      algorithm: 'HS256', issuer: 'test-issuer', expiresIn: '5m',
    });
    const res = await app.inject({
      method: 'POST', url: '/api/documents/open',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects expired HMAC JWT', async () => {
    const app = freshApp(hmacConsumers);
    const token = jwt.sign({ sub: 'preview' }, HMAC_SECRET, {
      algorithm: 'HS256', issuer: 'test-issuer', expiresIn: '-1s',
    });
    const res = await app.inject({
      method: 'POST', url: '/api/documents/open',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects HMAC JWT with wrong secret', async () => {
    const app = freshApp(hmacConsumers);
    const token = jwt.sign({ sub: 'preview' }, 'wrong-secret-that-is-long-enough-32chars', {
      algorithm: 'HS256', issuer: 'test-issuer', expiresIn: '5m',
    });
    const res = await app.inject({
      method: 'POST', url: '/api/documents/open',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects HMAC JWT with wrong issuer', async () => {
    const app = freshApp(hmacConsumers);
    const token = jwt.sign({ sub: 'preview' }, HMAC_SECRET, {
      algorithm: 'HS256', issuer: 'wrong-issuer', expiresIn: '5m',
    });
    const res = await app.inject({
      method: 'POST', url: '/api/documents/open',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects request with missing auth header', async () => {
    const app = freshApp(hmacConsumers);
    const res = await app.inject({
      method: 'POST', url: '/api/documents/open',
      payload,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('API key auth', () => {
  it('authenticates with valid API key', async () => {
    const app = freshApp(apiKeyConsumers);
    const res = await app.inject({
      method: 'POST', url: '/api/documents/open',
      headers: { authorization: 'Bearer test-dev-key' },
      payload,
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects invalid API key', async () => {
    const app = freshApp(apiKeyConsumers);
    const res = await app.inject({
      method: 'POST', url: '/api/documents/open',
      headers: { authorization: 'Bearer wrong-key' },
      payload,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Dev mode', () => {
  it('skips auth when no consumers configured', async () => {
    const app = freshApp(); // no consumers = empty
    const res = await app.inject({
      method: 'POST', url: '/api/documents/open',
      payload,
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('Auth-exempt paths', () => {
  it('/health does not require auth', async () => {
    const app = freshApp(hmacConsumers);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('/editor/:token does not require auth (an unknown token gets the expired page)', async () => {
    const app = freshApp(hmacConsumers);
    const res = await app.inject({ method: 'GET', url: '/editor/some-token' });
    expect(res.statusCode).toBe(410);
  });

  it('/api/documents/callback does not require consumer auth', async () => {
    const app = freshApp(hmacConsumers);
    const res = await app.inject({
      method: 'POST', url: '/api/documents/callback',
      payload: { key: 'nonexistent', status: 4 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ error: 0 });
  });
});

describe('Hostname binding behind a trusted proxy (EDIT-5 review)', () => {
  it('ignores X-Forwarded-Host, so trusting the proxy for addresses cannot move a request to another consumer', async () => {
    const { config } = await import('./config.js');
    const trust = config.trustProxy;
    // inject() connects from 127.0.0.1: the proxy is trusted, so only the dropped header protects the binding.
    config.trustProxy = '127.0.0.1';
    try {
      const app = freshApp([
        { id: 'connect', name: 'Connect', auth: { mode: 'api-key', key: 'connect-key' }, hostname: 'connect.example' },
        { id: 'crm', name: 'CRM', auth: { mode: 'api-key', key: 'crm-key' }, hostname: 'crm.example' },
      ]);
      const spoofed = await app.inject({
        method: 'POST',
        url: '/api/documents/open',
        headers: { host: 'connect.example', 'x-forwarded-host': 'crm.example', authorization: 'Bearer crm-key' },
        payload,
      });
      expect(spoofed.statusCode).toBe(401);
      const honest = await app.inject({ method: 'POST', url: '/api/documents/open', headers: { host: 'crm.example', authorization: 'Bearer crm-key' }, payload });
      expect(honest.statusCode).toBe(200);
    } finally {
      config.trustProxy = trust;
    }
  });
});

describe('Client addresses behind the trusted proxy (EDIT-6.6, Fastify 5.12)', () => {
  it('takes the forwarded address only from the named proxy, so the limiter sees each browser', async () => {
    const { config } = await import('./config.js');
    const trust = config.trustProxy;
    config.trustProxy = '10.0.0.2';
    try {
      const app = freshApp();
      app.get('/__ip-probe', async (req) => ({ ip: req.ip }));
      const viaProxy = await app.inject({ method: 'GET', url: '/__ip-probe', remoteAddress: '10.0.0.2', headers: { 'x-forwarded-for': '198.51.100.7' } });
      expect(viaProxy.json()).toEqual({ ip: '198.51.100.7' });
      const forged = await app.inject({ method: 'GET', url: '/__ip-probe', remoteAddress: '203.0.113.9', headers: { 'x-forwarded-for': '198.51.100.7' } });
      expect(forged.json()).toEqual({ ip: '203.0.113.9' });
    } finally {
      config.trustProxy = trust;
    }
  });
});
