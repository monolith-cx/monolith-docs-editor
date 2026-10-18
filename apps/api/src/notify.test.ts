import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Consumer } from './consumers.js';
import { buildNotification, deliver, deliveryId, signatureHeader } from './notify.js';
import { verifyNotification } from './reference/verify-notification.js';

const secrets = ['current-secret-0123456789abcdef', 'previous-secret-0123456789abcdef'];
let port = 0;
let answer: { status: number; body?: string; delayMs?: number; redirect?: boolean } = { status: 200 };
let received: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = [];

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    received.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
    setTimeout(() => {
      if (answer.redirect) {
        res.writeHead(307, { location: 'http://127.0.0.1:1/x' });
        return res.end();
      }
      res.writeHead(answer.status, { 'content-type': 'application/json' });
      res.end(answer.body ?? '{}');
    }, answer.delayMs ?? 0);
  });
});

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  answer = { status: 200 };
  received = [];
});

const consumer = (): Consumer => ({ id: 'crm', name: 'CRM', auth: { mode: 'api-key', key: 'k' }, callbackUrl: `http://127.0.0.1:${port}/notify` });
const save = { key: 'crm.d1.e3', status: 2, url: 'https://ds/x', users: ['u1'], lastsave: '2026-10-18T01:02:03.000Z' };
const keyParts = { consumer: 'crm', documentRef: 'd1', mode: 'e' as const, revision: '3' };

describe('deliveryId (ADR F2)', () => {
  it('is stable for one save and distinct between saves; never derived from the URL', () => {
    expect(deliveryId(save)).toBe(deliveryId({ ...save, url: 'https://ds/re-signed?md5=other' }));
    expect(deliveryId(save)).not.toBe(deliveryId({ ...save, lastsave: '2026-10-18T01:05:00.000Z' }));
    expect(deliveryId({ ...save, status: 6, forcesavetype: 1 })).not.toBe(deliveryId(save));
    expect(deliveryId({ key: 'crm.d1.e3', status: 1, users: ['u1'] })).toBeUndefined();
  });

  it('keeps force-saves without lastsave apart; a final save without it stays stable (one per key)', () => {
    const force = { key: 'crm.d1.e3', status: 6, forcesavetype: 1, users: ['u1'] };
    expect(deliveryId(force)).not.toBe(deliveryId(force));
    const final = { key: 'crm.d1.e3', status: 2, users: ['u1'] };
    expect(deliveryId(final)).toBe(deliveryId(final));
  });

  it('forwards a download URL only for saves (statuses 2 and 6)', () => {
    expect(buildNotification({ ...save, status: 3 }, keyParts, undefined).downloadUrl).toBeUndefined();
    expect(buildNotification(save, keyParts, 'https://ds-public/x').downloadUrl).toBe('https://ds-public/x');
  });
});

describe('deliver', () => {
  const run = (over: Partial<Parameters<typeof deliver>[0]> = {}) =>
    deliver({ consumer: consumer(), secrets, notification: buildNotification(save, keyParts, 'https://ds-public/x'), timeoutMs: 500, local: true, ...over });

  it('signs with every active secret, and the reference verifier accepts it once', async () => {
    expect(await run()).toMatchObject({ answer: 'ack' });
    const got = received[0];
    expect(got).toBeDefined();
    const seen = new Set<string>();
    const verify = (sec: string[]) =>
      verifyNotification({
        rawBody: got?.body ?? '',
        timestampHeader: got?.headers['x-editor-timestamp'] as string,
        signatureHeader: got?.headers['x-editor-signature'] as string,
        deliveryHeader: got?.headers['x-editor-delivery'] as string,
        secrets: sec,
        isKnownKey: (k) => k === 'crm.d1.e3',
        seenDelivery: (id) => seen.has(id),
      });
    const first = verify([secrets[1] as string]);
    expect(first.ok).toBe(true);
    if (first.ok) seen.add(String(first.body['deliveryId']));
    expect(verify([secrets[0] as string])).toMatchObject({ ok: false, reason: 'replay' });
    expect(verify(['someone-else'])).toMatchObject({ ok: false, reason: 'bad_signature' });
  });

  it('acknowledges 2xx and an explicit key_closed; asks DocumentServer to retry everything else', async () => {
    answer = { status: 410, body: '{"code":"key_closed"}' };
    expect(await run()).toMatchObject({ answer: 'ack-closed' });
    answer = { status: 409, body: '{"code":"conflict"}' };
    expect(await run()).toMatchObject({ answer: 'retry' });
    for (const status of [401, 403, 404, 429, 500, 503]) {
      answer = { status };
      expect(await run()).toMatchObject({ answer: 'retry', consumerStatus: status });
    }
  });

  it('times out, and never follows a redirect', async () => {
    answer = { status: 200, delayMs: 1500 };
    expect(await run({ timeoutMs: 200 })).toMatchObject({ answer: 'retry', error: 'timeout' });
    answer = { status: 200, redirect: true };
    expect(await run()).toMatchObject({ answer: 'retry', consumerStatus: 307 });
  });

  it('refuses an http callback, and a private address even over https, outside EDITOR_ENV=local', async () => {
    expect(await run({ local: false })).toMatchObject({ answer: 'retry', error: 'scheme' });
    expect(await run({ local: false, consumer: { ...consumer(), callbackUrl: 'https://127.0.0.1:9/notify' } })).toMatchObject({ answer: 'retry', error: 'private_address' });
  });

  it('formats the signature header as comma-joined v1= entries', () => {
    expect(signatureHeader(secrets, '1', '{}')).toMatch(/^v1=[0-9a-f]{64},v1=[0-9a-f]{64}$/);
  });
});

describe('reference verifier', () => {
  const sign = (body: string, ts: string, secret: string) => signatureHeader([secret], ts, body);
  const base = (body: Record<string, unknown>, ts: number) => {
    const raw = JSON.stringify(body);
    return { rawBody: raw, timestampHeader: String(ts), signatureHeader: sign(raw, String(ts), 's'), deliveryHeader: body['deliveryId'] as string | undefined, secrets: ['s'], isKnownKey: () => true, seenDelivery: () => false, nowSeconds: 1000 };
  };

  it('refuses stale timestamps, unknown keys, and a delivery header that does not match the body', () => {
    expect(verifyNotification(base({ key: 'k', status: 1 }, 1000 - 301))).toMatchObject({ ok: false, reason: 'stale' });
    expect(verifyNotification({ ...base({ key: 'k', status: 1 }, 1000), isKnownKey: () => false })).toMatchObject({ ok: false, reason: 'unknown_key' });
    expect(verifyNotification({ ...base({ key: 'k', status: 2, deliveryId: 'a' }, 1000), deliveryHeader: 'b' })).toMatchObject({ ok: false, reason: 'replay' });
  });

  it('delivers two genuine connect events by the same user (no deliveryId, both accepted)', () => {
    expect(verifyNotification(base({ key: 'k', status: 1, users: ['u1'] }, 1000)).ok).toBe(true);
    expect(verifyNotification(base({ key: 'k', status: 1, users: ['u1'] }, 1001)).ok).toBe(true);
  });
});
