import { buildApp } from './app.js';
import { config } from './config.js';
import { getConsumers } from './consumers.js';

const WEAK_SECRETS = new Set([
  'secret',
  'change-me-dev',
  'change-me-prod',
  'dev-only-secret-do-not-use-in-prod',
]);

function validateProductionConfig(): void {
  const isProduction = config.nodeEnv === 'production';

  if (config.onlyofficeJwtSecret.length < 32) {
    console.warn('WARNING: ONLYOFFICE_JWT_SECRET is shorter than 32 characters');
  }

  if (!isProduction) return;

  const fatal: string[] = [];

  if (WEAK_SECRETS.has(config.onlyofficeJwtSecret) || config.onlyofficeJwtSecret.startsWith('change-me')) {
    fatal.push('ONLYOFFICE_JWT_SECRET must be set to a strong random value in production');
  }

  if (!process.env['CONSUMERS'] && !process.env['CONSUMER_API_KEY']) {
    fatal.push('CONSUMERS or CONSUMER_API_KEY must be configured in production');
  }

  if (!process.env['CORS_ORIGINS']) {
    fatal.push('CORS_ORIGINS must be set in production (no wildcard allowed)');
  }

  if (config.corsOrigins === true) {
    fatal.push('CORS_ORIGINS cannot be wildcard (*) in production');
  }

  if (fatal.length > 0) {
    console.error('FATAL: Production configuration validation failed:');
    for (const msg of fatal) console.error(`  - ${msg}`);
    process.exit(1);
  }

  const consumers = getConsumers();
  console.info(`Monolith Docs starting in production mode with ${consumers.length} consumer(s): ${consumers.map(c => c.id).join(', ')}`);
}

validateProductionConfig();

const app = buildApp();

const shutdown = async () => {
  app.log.info('Shutting down gracefully...');
  await app.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.listen({ port: config.port, host: config.host }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info({ host: config.host, port: config.port }, 'Monolith Docs API listening');
});
