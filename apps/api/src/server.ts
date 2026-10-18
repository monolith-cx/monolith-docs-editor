import { buildApp } from './app.js';
import { config } from './config.js';
import { getConsumers, warnOnCallbackResolution } from './consumers.js';
import { startupProblems } from './startup.js';

/** Refuses to start on any configuration problem (E4); outside EDITOR_ENV=local the checks are strict. */
function validateConfig(): void {
  const problems = startupProblems();
  if (problems.length > 0) {
    console.error(`FATAL: configuration invalid for EDITOR_ENV=${config.editorEnv}:`);
    for (const msg of problems) console.error(`  - ${msg}`);
    process.exit(1);
  }
  const consumers = getConsumers();
  console.info(`Monolith Docs editor service starting (EDITOR_ENV=${config.editorEnv}) with ${consumers.length} consumer(s): ${consumers.map((c) => c.id).join(', ')}`);
}

validateConfig();

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
  void warnOnCallbackResolution((fields, msg) => app.log.warn(fields, msg));
});
