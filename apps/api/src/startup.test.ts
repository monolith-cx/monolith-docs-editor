/**
 * Startup refusal and the startup callbackUrl warning, under a strict EDITOR_ENV (EDIT-2 review
 * attempt 2: Codex H1, Sonnet M4). Modules are loaded afresh per case with the environment stubbed.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const STRICT = {
  EDITOR_ENV: 'production',
  ONLYOFFICE_JWT_SECRET: 'startup-test-jwt-secret-0123456789abcdef',
  CORS_ORIGINS: 'https://crm.example.com',
  API_PUBLIC_URL: 'https://editor.example.com',
  ONLYOFFICE_PUBLIC_URL: 'https://ds.example.com',
};

const crm = (callbackUrl = 'https://crm.example.com/udoc/notify') => ({
  id: 'crm',
  name: 'CRM',
  auth: { mode: 'hmac', secret: 'h'.repeat(32), issuer: 'crm' },
  profiles: ['document'],
  callbackUrl,
  notificationSecretRef: 'EDITOR_NOTIFY_SECRET_STARTUP_CRM',
  panelOrigins: ['https://crm.example.com'],
  fileHosts: ['files.example.com'],
  convertSourceHosts: ['files.example.com'],
  convertUploadHosts: ['files.example.com'],
  returnOrigin: 'https://crm.example.com',
});

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...STRICT, ...env })) vi.stubEnv(k, v);
  // The vitest config's own notification secrets must not satisfy this consumer's ref.
  return { startup: await import('./startup.js'), consumers: await import('./consumers.js') };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('startupProblems under EDITOR_ENV=production', () => {
  it("refuses to start when a profile consumer's notification secret is unset", async () => {
    const { startup } = await load({ CONSUMERS: JSON.stringify([crm()]) });
    expect(startup.startupProblems()).toContain('Consumer crm: EDITOR_NOTIFY_SECRET_STARTUP_CRM is not set');
  });

  it('refuses a short secret, and starts with a strong one', async () => {
    const weak = await load({ CONSUMERS: JSON.stringify([crm()]), EDITOR_NOTIFY_SECRET_STARTUP_CRM: 'short' });
    expect(weak.startup.startupProblems().join(' ')).toContain('at least 32 bytes');
    const strong = await load({ CONSUMERS: JSON.stringify([crm()]), EDITOR_NOTIFY_SECRET_STARTUP_CRM: 's'.repeat(40) });
    expect(strong.startup.startupProblems()).toEqual([]);
  });
});

describe('the bridge plugin files (EDIT-5)', () => {
  it('refuses to start when a served plugin file is missing', async () => {
    const { startup } = await load({ CONSUMERS: JSON.stringify([crm()]), EDITOR_NOTIFY_SECRET_STARTUP_CRM: 's'.repeat(40), EDITOR_PLUGIN_DIR: '/nonexistent-plugin-dir' });
    expect(startup.startupProblems().join(' ')).toContain('the bridge plugin is missing config.json, index.html, bridge.js, commands.js, icon.png');
  });

  it('refuses a plugin file that is a directory or cannot be read', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'plugin-files-'));
    try {
      for (const name of ['index.html', 'bridge.js', 'commands.js', 'icon.png']) writeFileSync(path.join(dir, name), 'x');
      mkdirSync(path.join(dir, 'config.json'));
      const { startup } = await load({ CONSUMERS: JSON.stringify([crm()]), EDITOR_NOTIFY_SECRET_STARTUP_CRM: 's'.repeat(40), EDITOR_PLUGIN_DIR: dir });
      expect(startup.startupProblems().join(' ')).toContain('the bridge plugin is missing config.json in');
      rmSync(path.join(dir, 'config.json'), { recursive: true });
      writeFileSync(path.join(dir, 'config.json'), '{}');
      chmodSync(path.join(dir, 'bridge.js'), 0o000);
      // Root reads anything; the check is meaningful only for an ordinary user.
      if (process.getuid?.() !== 0) expect(startup.startupProblems().join(' ')).toContain('the bridge plugin is missing bridge.js in');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('warnOnCallbackResolution', () => {
  it('warns, without the URL, when a callbackUrl would be refused at delivery', async () => {
    const { consumers } = await load({ CONSUMERS: JSON.stringify([crm('https://127.0.0.1/udoc/notify')]), EDITOR_NOTIFY_SECRET_STARTUP_CRM: 's'.repeat(40) });
    const warn = vi.fn();
    await consumers.warnOnCallbackResolution(warn);
    expect(warn).toHaveBeenCalledWith({ consumerId: 'crm', reason: 'private_address' }, 'Consumer callbackUrl would be refused at delivery');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('127.0.0.1');
  });
});
