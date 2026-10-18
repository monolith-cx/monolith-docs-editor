import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateConsumersConfig, findConsumersByHostname, notificationSecretProblems, notificationSecrets, resetConsumers, setConsumersForTest } from './consumers.js';
import type { Consumer } from './consumers.js';

describe('validateConsumersConfig', () => {
  it('returns empty array for valid config', () => {
    const consumers: Consumer[] = [
      { id: 'a', name: 'A', auth: { mode: 'hmac', secret: 'a'.repeat(32), issuer: 'iss-a' }, hostname: 'a.example.com' },
      { id: 'b', name: 'B', auth: { mode: 'jwks', jwksUrl: 'https://b.example.com/.well-known/jwks.json' }, hostname: 'b.example.com' },
    ];
    expect(validateConsumersConfig(consumers, false)).toEqual([]);
  });

  it('rejects duplicate consumer IDs', () => {
    const consumers: Consumer[] = [
      { id: 'dup', name: 'A', auth: { mode: 'hmac', secret: 'x'.repeat(32), issuer: 'iss' } },
      { id: 'dup', name: 'B', auth: { mode: 'hmac', secret: 'y'.repeat(32), issuer: 'iss' } },
    ];
    const errors = validateConsumersConfig(consumers, false);
    expect(errors).toContainEqual(expect.stringContaining('Duplicate consumer ID'));
  });

  it('rejects duplicate hostnames', () => {
    const consumers: Consumer[] = [
      { id: 'a', name: 'A', auth: { mode: 'hmac', secret: 'x'.repeat(32), issuer: 'iss' }, hostname: 'same.com' },
      { id: 'b', name: 'B', auth: { mode: 'hmac', secret: 'y'.repeat(32), issuer: 'iss' }, hostname: 'same.com' },
    ];
    const errors = validateConsumersConfig(consumers, false);
    expect(errors).toContainEqual(expect.stringContaining('Duplicate consumer hostname'));
  });

  it('rejects HMAC secret shorter than 32 chars', () => {
    const consumers: Consumer[] = [
      { id: 'a', name: 'A', auth: { mode: 'hmac', secret: 'short', issuer: 'iss' } },
    ];
    const errors = validateConsumersConfig(consumers, false);
    expect(errors).toContainEqual(expect.stringContaining('at least 32 characters'));
  });

  it('rejects JWKS URL not starting with https://', () => {
    const consumers: Consumer[] = [
      { id: 'a', name: 'A', auth: { mode: 'jwks', jwksUrl: 'http://insecure.com/jwks' } },
    ];
    const errors = validateConsumersConfig(consumers, false);
    expect(errors).toContainEqual(expect.stringContaining('must start with https://'));
  });

  it('rejects api-key mode outside EDITOR_ENV=local', () => {
    const consumers: Consumer[] = [
      { id: 'a', name: 'A', auth: { mode: 'api-key', key: 'test-key' } },
    ];
    const errors = validateConsumersConfig(consumers, true);
    expect(errors).toContainEqual(expect.stringContaining('only allowed with EDITOR_ENV=local'));
  });

  it('allows api-key mode with EDITOR_ENV=local', () => {
    const consumers: Consumer[] = [
      { id: 'a', name: 'A', auth: { mode: 'api-key', key: 'test-key' } },
    ];
    expect(validateConsumersConfig(consumers, false)).toEqual([]);
  });
});

describe('findConsumersByHostname', () => {
  it('returns the consumers bound to the hostname, else the unbound ones', () => {
    const bound: Consumer = { id: 'a', name: 'A', auth: { mode: 'api-key', key: 'ka' }, hostname: 'a.example.com' };
    const other: Consumer = { id: 'b', name: 'B', auth: { mode: 'api-key', key: 'kb' }, hostname: 'b.example.com' };
    const unbound: Consumer = { id: 'c', name: 'C', auth: { mode: 'api-key', key: 'kc' } };
    setConsumersForTest([bound, other, unbound]);
    try {
      expect(findConsumersByHostname('a.example.com').map((c) => c.id)).toEqual(['a']);
      expect(findConsumersByHostname('elsewhere.example.com').map((c) => c.id)).toEqual(['c']);
    } finally {
      resetConsumers();
    }
  });
});

describe('notificationSecretProblems (EDIT-2.1, E4)', () => {
  const strong = 's'.repeat(32);
  it('refuses a profile consumer whose secret is unset', () => {
    expect(notificationSecretProblems([profileConsumer({ notificationSecretRef: 'EDITOR_NOTIFY_SECRET_CRM' })], {}, true)).toEqual([
      'Consumer crm: EDITOR_NOTIFY_SECRET_CRM is not set',
    ]);
  });
  it('refuses a short current or previous secret outside local, and accepts it locally', () => {
    const c = [profileConsumer({ notificationSecretRef: 'EDITOR_NOTIFY_SECRET_CRM' })];
    expect(notificationSecretProblems(c, { EDITOR_NOTIFY_SECRET_CRM: 'short' }, true)).toHaveLength(1);
    expect(notificationSecretProblems(c, { EDITOR_NOTIFY_SECRET_CRM: strong, EDITOR_NOTIFY_SECRET_CRM_PREVIOUS: 'short' }, true)).toEqual([
      'Consumer crm: EDITOR_NOTIFY_SECRET_CRM_PREVIOUS must be a random value of at least 32 bytes',
    ]);
    expect(notificationSecretProblems(c, { EDITOR_NOTIFY_SECRET_CRM: 'short' }, false)).toEqual([]);
    expect(notificationSecretProblems(c, { EDITOR_NOTIFY_SECRET_CRM: strong }, true)).toEqual([]);
  });
  it('refuses the same secret value under two names, a ref ending in _PREVIOUS, and a callbackUrl without profiles', () => {
    const list = [profileConsumer({ notificationSecretRef: 'EDITOR_NOTIFY_SECRET_A' }), profileConsumer({ id: 'docs', notificationSecretRef: 'EDITOR_NOTIFY_SECRET_B' })];
    expect(notificationSecretProblems(list, { EDITOR_NOTIFY_SECRET_A: strong, EDITOR_NOTIFY_SECRET_B: strong }, true)).toEqual([
      'Consumers crm and docs use the same notification secret value; each consumer needs its own',
    ]);
    expect(validateConsumersConfig([profileConsumer({ notificationSecretRef: 'EDITOR_NOTIFY_SECRET_CRM_PREVIOUS' })], true).join(' ')).toContain('not ending in _PREVIOUS');
    const rotating = notificationSecretProblems(list, { EDITOR_NOTIFY_SECRET_A: strong, EDITOR_NOTIFY_SECRET_B: 't'.repeat(32), EDITOR_NOTIFY_SECRET_B_PREVIOUS: strong }, true);
    expect(rotating).toEqual(['Consumers crm and docs use the same notification secret value; each consumer needs its own']);
    const legacy: Consumer = { id: 'old', name: 'Old', auth: { mode: 'hmac', secret: 'q'.repeat(32), issuer: 'old' }, callbackUrl: 'https://old.example.com/cb' };
    expect(validateConsumersConfig([legacy], true).join(' ')).toContain('need profiles');
  });

  it('refuses two consumers sharing one secret', () => {
    const list = [profileConsumer({ notificationSecretRef: 'EDITOR_NOTIFY_SECRET_X' }), profileConsumer({ id: 'docs', notificationSecretRef: 'EDITOR_NOTIFY_SECRET_X' })];
    expect(notificationSecretProblems(list, { EDITOR_NOTIFY_SECRET_X: strong }, true)).toEqual([
      'Consumers crm and docs share EDITOR_NOTIFY_SECRET_X; each consumer needs its own notification secret',
    ]);
  });
});

const profileConsumer = (over: Partial<Consumer> = {}): Consumer => ({
  id: 'crm',
  name: 'CRM',
  auth: { mode: 'hmac', secret: 'z'.repeat(32), issuer: 'crm' },
  hostname: 'crm.example.com',
  profiles: ['document', 'view'],
  callbackUrl: 'https://crm.example.com/editor/notifications',
  notificationSecretRef: 'EDITOR_NOTIFY_SECRET_CRM',
  panelOrigins: ['https://crm.example.com'],
  fileHosts: ['storage.example.com'],
  convertSourceHosts: ['storage.example.com'],
  convertUploadHosts: ['storage.example.com'],
  returnOrigin: 'https://crm.example.com',
  ...over,
});

describe('profile-capable consumers (E5)', () => {
  it('accepts a complete registration', () => {
    expect(validateConsumersConfig([profileConsumer()], true)).toEqual([]);
  });

  it('requires every registration field once profiles are declared', () => {
    for (const field of ['callbackUrl', 'notificationSecretRef', 'panelOrigins', 'fileHosts', 'convertSourceHosts', 'convertUploadHosts', 'returnOrigin'] as const) {
      const c: Consumer = { ...profileConsumer(), [field]: undefined };
      expect(validateConsumersConfig([c], true).join(' ')).toContain(field);
    }
  });

  it('refuses http origins and callbacks when strict, allows them with EDITOR_ENV=local', () => {
    const c = profileConsumer({ callbackUrl: 'http://stub:18201/cb', panelOrigins: ['http://127.0.0.1:18202'], returnOrigin: 'http://127.0.0.1:18201' });
    expect(validateConsumersConfig([c], true).length).toBeGreaterThan(0);
    expect(validateConsumersConfig([c], false)).toEqual([]);
  });

  it('refuses unknown profiles, ids outside [0-9A-Za-z_-], and badly named secret refs', () => {
    expect(validateConsumersConfig([profileConsumer({ profiles: ['admin' as never] })], true).join(' ')).toContain('profiles');
    expect(validateConsumersConfig([profileConsumer({ id: 'crm.prod' })], true).join(' ')).toContain('[0-9A-Za-z_-]');
    expect(validateConsumersConfig([profileConsumer({ notificationSecretRef: 'CRM_SECRET' })], true).join(' ')).toContain('notificationSecretRef');
  });

  it('keeps a legacy-only consumer valid (E1)', () => {
    const legacy: Consumer = { id: 'fastmail-connect', name: 'Connect for Fastmail', auth: { mode: 'hmac', secret: 's'.repeat(32), issuer: 'connect-billing-api' }, hostname: 'connect.monolithdocs.com', allowedCallbackDomains: [] };
    expect(validateConsumersConfig([legacy], true)).toEqual([]);
  });

  // The dev example carries no CONSUMERS line: the dev VM's consumers are set on the VM (EDIT-6 stand-up).
  it('accepts the CONSUMERS in the production environment example unchanged', () => {
    const file = readFileSync(path.resolve(__dirname, '../../../infrastructure/environments/prod/env.example'), 'utf8');
    const line = file.split('\n').find((l) => l.startsWith('CONSUMERS='));
    expect(line).toBeDefined();
    const json = (line ?? '').slice('CONSUMERS='.length).replace(/^'|'$/g, '');
    const list = JSON.parse(json) as Consumer[];
    // The example's HMAC secret is a placeholder; substitute a real-length one for the check.
    for (const c of list) if (c.auth.mode === 'hmac') c.auth.secret = 'p'.repeat(32);
    expect(validateConsumersConfig(list, true)).toEqual([]);
  });

  it('resolves notification secrets by the variable the consumer names, previous last', () => {
    const c = profileConsumer({ notificationSecretRef: 'EDITOR_NOTIFY_SECRET_TEST' });
    expect(notificationSecrets(c)).toEqual(['test-notify-secret-current-0123456789', 'test-notify-secret-previous-0123456789']);
  });
});
