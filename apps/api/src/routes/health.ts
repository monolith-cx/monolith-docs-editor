import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { safeErrorText } from '../log-safety.js';

const isProduction = config.strict;

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply) => {
    return reply.send({ status: 'ok' });
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
