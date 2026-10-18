import { describe, expect, it } from 'vitest';
import { configProblems, loadConfig } from './config.js';

const strong = {
  EDITOR_SEAL_KEYS: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
  ONLYOFFICE_JWT_SECRET: 'x'.repeat(40),
  CORS_ORIGINS: 'https://crm.example.com',
  CONSUMERS: '[]',
  API_PUBLIC_URL: 'https://app.example.com',
  ONLYOFFICE_PUBLIC_URL: 'https://app.example.com',
};

describe('config (E4)', () => {
  it('is strict by default: unset EDITOR_ENV means production', () => {
    const cfg = loadConfig({});
    expect(cfg.editorEnv).toBe('production');
    expect(cfg.strict).toBe(true);
  });

  it('accepts a complete strict configuration', () => {
    expect(configProblems(loadConfig({ ...strong, EDITOR_ENV: 'production' }), 'production')).toEqual([]);
  });

  it('refuses weak secrets, wildcard CORS, no consumers, and http public URLs outside local', () => {
    const problems = configProblems(loadConfig({ EDITOR_SEAL_KEYS: strong.EDITOR_SEAL_KEYS, ONLYOFFICE_JWT_SECRET: 'secret' }), undefined).join(' | ');
    for (const word of ['ONLYOFFICE_JWT_SECRET', 'CORS_ORIGINS', 'CONSUMERS', 'API_PUBLIC_URL', 'ONLYOFFICE_PUBLIC_URL']) {
      expect(problems).toContain(word);
    }
  });

  it('relaxes everything but the seal key with EDITOR_ENV=local', () => {
    expect(configProblems(loadConfig({ EDITOR_ENV: 'local', EDITOR_SEAL_KEYS: strong.EDITOR_SEAL_KEYS }), 'local')).toEqual([]);
    expect(configProblems(loadConfig({ EDITOR_ENV: 'local' }), 'local').join(' ')).toContain('EDITOR_SEAL_KEYS');
  });

  it('refuses a bad EDITOR_ENV, short keys, more than two keys, and colliding key ids', () => {
    expect(configProblems(loadConfig({ ...strong, EDITOR_ENV: 'prod' }), 'prod').join(' ')).toContain('EDITOR_ENV');
    expect(configProblems(loadConfig({ ...strong, EDITOR_SEAL_KEYS: 'AQEB' }), undefined).join(' ')).toContain('32 bytes');
    const k = strong.EDITOR_SEAL_KEYS;
    expect(configProblems(loadConfig({ ...strong, EDITOR_SEAL_KEYS: `${k},${k},${k}` }), undefined).join(' ')).toContain('at most two');
    expect(configProblems(loadConfig({ ...strong, EDITOR_SEAL_KEYS: `${k},${k}` }), undefined).join(' ')).toContain('key id');
  });

  it('refuses numbers that are not whole and positive (a typo must not become NaN, zero, or negative)', () => {
    for (const [name, value] of [['EDITOR_MAX_SESSION_MS', 'abc'], ['EDITOR_NOTIFY_TIMEOUT_MS', '0'], ['EDITOR_SOURCE_TIMEOUT_MS', '-5'], ['EDITOR_MAX_SOURCE_BYTES', '1.5'], ['PORT', '']]) {
      expect(configProblems(loadConfig({ ...strong, [name as string]: value }), undefined).join(' ')).toContain(name);
    }
    expect(configProblems(loadConfig({ ...strong, EDITOR_NOTIFY_TIMEOUT_MS: '600000' }), undefined).join(' ')).toContain('10-minute');
  });

  it('bounds the in-memory caps and the conversion limits (ADR F17)', () => {
    expect(configProblems(loadConfig({ ...strong, EDITOR_MAX_SOURCE_BYTES: '104857601' }), undefined).join(' ')).toContain('EDITOR_MAX_SOURCE_BYTES');
    expect(configProblems(loadConfig({ ...strong, EDITOR_MAX_CONVERT_OUTPUT_BYTES: '104857601' }), undefined).join(' ')).toContain('EDITOR_MAX_CONVERT_OUTPUT_BYTES');
    expect(configProblems(loadConfig({ ...strong, EDITOR_CONVERT_CONCURRENCY: '5', EDITOR_CONVERT_CONCURRENCY_TOTAL: '4' }), undefined).join(' ')).toContain('must not exceed');
    expect(configProblems(loadConfig({ ...strong, EDITOR_CONVERT_TIMEOUT_MS: '120000' }), undefined).join(' ')).toContain('at most 95000');
    for (const name of ['EDITOR_SOURCE_CONCURRENCY', 'EDITOR_CONVERT_TIMEOUT_MS', 'EDITOR_CONVERT_CONCURRENCY_TOTAL']) {
      expect(configProblems(loadConfig({ ...strong, [name]: '0' }), undefined).join(' ')).toContain(name);
    }
    const defaults = loadConfig({});
    expect([defaults.sourceTimeoutMs, defaults.sourceConcurrency, defaults.convertTimeoutMs, defaults.convertConcurrency, defaults.convertConcurrencyTotal]).toEqual([30_000, 4, 90_000, 2, 4]);
  });

  it('caps the session lifetime at 12 hours and defaults the callback URL origins to DocumentServer', () => {
    const cfg = loadConfig({ EDITOR_MAX_SESSION_MS: String(48 * 3600_000), ONLYOFFICE_URL: 'http://onlyoffice:80', ONLYOFFICE_PUBLIC_URL: 'https://app.example.com' });
    expect(cfg.maxSessionMs).toBe(12 * 3600_000);
    expect(cfg.onlyofficeCallbackUrlOrigins).toEqual(['http://onlyoffice', 'https://app.example.com']);
  });

  it('collects only EDITOR_NOTIFY_SECRET_* variables as notification secrets', () => {
    const cfg = loadConfig({ EDITOR_NOTIFY_SECRET_CRM: 'a', OTHER_SECRET: 'b' });
    expect(cfg.notifySecrets).toEqual({ EDITOR_NOTIFY_SECRET_CRM: 'a' });
  });
});
