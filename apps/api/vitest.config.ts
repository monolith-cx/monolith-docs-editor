import { defineConfig } from 'vitest/config';

// Tests run as EDITOR_ENV=local with fixed, test-only secrets. Strict-mode behaviour is covered by
// unit tests that build configurations explicitly (loadConfig, validateConsumersConfig) and by
// strict-routes.test.ts and startup.test.ts, which reload the modules under EDITOR_ENV=production.
export default defineConfig({
  test: {
    env: {
      EDITOR_ENV: 'local',
      // Current and previous seal keys (32 bytes each, distinct key ids).
      EDITOR_SEAL_KEYS: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE,AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI',
      ONLYOFFICE_JWT_SECRET: 'test-onlyoffice-jwt-secret-0123456789abcdef',
      // A loopback port the route tests serve a fake command service on.
      ONLYOFFICE_URL: 'http://127.0.0.1:18999',
      ONLYOFFICE_PUBLIC_URL: 'http://ds-public.test',
      API_PUBLIC_URL: 'http://editor.test',
      API_INTERNAL_URL: 'http://editor-api:3020',
      EDITOR_NOTIFY_SECRET_TEST: 'test-notify-secret-current-0123456789',
      EDITOR_NOTIFY_SECRET_TEST_PREVIOUS: 'test-notify-secret-previous-0123456789',
      EDITOR_NOTIFY_TIMEOUT_MS: '1500',
    },
  },
});
