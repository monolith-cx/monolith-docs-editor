import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UrlRefused, checkUrl, isBlockedAddress, safeFetch } from './safe-url.js';

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'accepted';
  } catch (err) {
    return err instanceof UrlRefused ? err.code : 'other';
  }
}

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', '::', 'fc00::1', 'fd00:ec2::254', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::a9fe:a9fe', '2001:db8::1',
    // Embedded and special-use forms (EDIT-2 review attempt 1, M1).
    '::ffff:0:127.0.0.1', '::ffff:0:7f00:1', '2002:7f00:1::', '2002:a00:1::', '64:ff9b:1::7f00:1', 'fec0::1', '2001::', '2001:0:4136:e378::1', '100::1', '192.88.99.1',
  ])('blocks %s', (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:8.8.8.8', '2002:808:808::1', '64:ff9b::808:808'])('allows %s', (ip) => expect(isBlockedAddress(ip)).toBe(false));

  it('blocks anything that is not an IP address', () => expect(isBlockedAddress('example.com')).toBe(true));
});

describe('checkUrl: metadata endpoints (EDIT-3)', () => {
  it('refuses them even under EDITOR_ENV=local, by name and by address', async () => {
    for (const url of ['http://metadata.google.internal/computeMetadata/v1/', 'http://metadata/x', 'http://169.254.169.254/latest/meta-data/', 'http://[::ffff:169.254.169.254]/x', 'http://[fd00:ec2::254]/x']) {
      expect(await refusal(checkUrl(url, { local: true }))).toBe('metadata');
    }
    expect(await refusal(checkUrl('http://127.0.0.1:9/x', { local: true }))).toBe('accepted');
  });
});

describe('checkUrl (strict)', () => {
  it('refuses http, credentials, local names, and private address literals', async () => {
    expect(await refusal(checkUrl('http://8.8.8.8/x'))).toBe('scheme');
    expect(await refusal(checkUrl('https://user:pass@8.8.8.8/x'))).toBe('credentials');
    expect(await refusal(checkUrl('https://localhost/x'))).toBe('local_name');
    expect(await refusal(checkUrl('https://metadata.google.internal/x'))).toBe('metadata');
    expect(await refusal(checkUrl('https://files.internal/x'))).toBe('local_name');
    expect(await refusal(checkUrl('https://127.0.0.1/x'))).toBe('private_address');
    expect(await refusal(checkUrl('https://[::ffff:169.254.169.254]/x'))).toBe('metadata');
    expect(await refusal(checkUrl('https://[::ffff:10.0.0.1]/x'))).toBe('private_address');
    expect(await refusal(checkUrl('not a url'))).toBe('invalid');
  });

  it('enforces the host allowlist exactly, with no subdomains', async () => {
    expect(await refusal(checkUrl('https://8.8.8.8/x', { allowHosts: ['8.8.4.4'] }))).toBe('host_not_allowed');
    expect(await refusal(checkUrl('https://evil.storage.example.com/x', { allowHosts: ['storage.example.com'] }))).toBe('host_not_allowed');
    expect(await refusal(checkUrl('https://8.8.8.8/x', { allowHosts: ['8.8.8.8'] }))).toBe('accepted');
  });

  it('accepts the exact internal prefix and refuses a path that escapes it', async () => {
    const prefix = 'http://api:3020/api/files/';
    expect((await checkUrl('http://api:3020/api/files/abc.docx', { internalPrefix: prefix })).internal).toBe(true);
    expect(await refusal(checkUrl('http://api:3020/api/files/../admin', { internalPrefix: prefix }))).toBe('invalid');
  });

  it('allows http and private addresses only for EDITOR_ENV=local', async () => {
    expect(await refusal(checkUrl('http://127.0.0.1:9/x', { local: true }))).toBe('accepted');
  });
});

describe('safeFetch', () => {
  let port = 0;
  const server = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('pinned');
  });
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('connects to the checked address even when the name is given', async () => {
    const checked = await checkUrl(`http://localhost:${port}/ok`, { local: true });
    // Pin to 127.0.0.1 only, whatever localhost would resolve to now.
    checked.addresses = ['127.0.0.1'];
    const res = await safeFetch(checked);
    expect(await res.text()).toBe('pinned');
  });

  it('returns a redirect instead of following it', async () => {
    const res = await safeFetch(await checkUrl(`http://127.0.0.1:${port}/redirect`, { local: true }));
    expect(res.status).toBe(302);
  });
});
