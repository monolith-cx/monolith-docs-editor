import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { probeConverter } from '../convert.js';
import { PROBE_ROUTE, PROBE_SAMPLE_ROUTE } from '../health-paths.js';
import { safeErrorText } from '../log-safety.js';

/** The sample DocumentServer converts for the probe: the built-in fixture (copied into the image). */
const SAMPLE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'sample.docx'));

/** The probe takes a converter slot, so only the host's watchdog may call it: a direct loopback connection. */
function fromLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

let probing = false;

const isProduction = config.strict;

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply) => {
    return reply.send({ status: 'ok' });
  });

  // DocumentServer fetches the probe's sample from the API's internal origin (EDIT-6.3). Nothing secret.
  app.get(PROBE_SAMPLE_ROUTE, async (_req, reply) => {
    return reply.header('Cache-Control', 'no-store').type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').send(SAMPLE);
  });

  // The converter probe (EDIT-6.3, ADR F17), for the watchdog through `docker compose exec`. The
  // socket address decides, never a forwarded header; anything else is told the route does not exist.
  // Caddy never routes /health/* (infrastructure/vps/).
  app.get(PROBE_ROUTE, async (req, reply) => {
    if (!fromLoopback(req.socket.remoteAddress)) return reply.status(404).send({ error: 'not_found' });
    if (probing) return reply.status(429).send({ status: 'busy' });
    probing = true;
    try {
      const result = await probeConverter();
      if (!result.ok) req.log.warn({ detail: result.detail, ms: result.ms }, 'Converter probe failed');
      return reply.status(result.ok ? 200 : 503).send({ status: result.ok ? 'ok' : 'unhealthy', ms: result.ms, ...(result.ok ? {} : { detail: result.detail }) });
    } finally {
      probing = false;
    }
  });

  app.get('/api/status', async (_req, reply) => {
    try {
      const res = await fetch(`${config.onlyofficeUrl}/healthcheck`);
      const text = await res.text();
      const onlyofficeOk = res.ok && text.toLowerCase().includes('true');
      return reply.send({
        api: 'ok',
        onlyoffice: onlyofficeOk ? 'ok' : 'unhealthy',
        ...(isProduction ? {} : { onlyofficeResponse: text }),
      });
    } catch (err: unknown) {
      const message = safeErrorText(err instanceof Error ? err.message : 'unknown error');
      return reply.send({
        api: 'ok',
        onlyoffice: 'unreachable',
        ...(isProduction ? {} : { error: message }),
      });
    }
  });
}
