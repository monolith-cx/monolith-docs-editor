import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { authPlugin } from './auth.js';
import { healthRoutes } from './routes/health.js';
import { documentRoutes } from './routes/documents.js';
import { fileRoutes } from './routes/files.js';
import { LOG_REDACT_CENSOR, LOG_REDACT_PATHS, scrubLogArguments, serializeError, serializeRequest } from './log-safety.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = config.nodeEnv === 'production';

export interface BuildAppOptions {
  /** Log destination; tests inject a stream to assert on real log lines. */
  logStream?: NodeJS.WritableStream;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      ...(options.logStream ? { stream: options.logStream } : {}),
      redact: { paths: LOG_REDACT_PATHS, censor: LOG_REDACT_CENSOR },
      serializers: { req: serializeRequest, err: serializeError },
      hooks: {
        logMethod(args, method) {
          method.apply(this, scrubLogArguments(args) as Parameters<typeof method>);
        },
      },
    },
  });

  app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
    maxAge: 86400,
  });

  app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

  app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    allowList: (req) => req.url === '/api/documents/callback',
  });

  app.register(authPlugin);

  // Security headers
  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-XSS-Protection', '0');

    if (isProduction) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    if (req.url.startsWith('/editor/')) {
      // Editor pages are loaded in iframes by consuming apps (Fastmail Connect, CRM).
      // Allow cross-origin framing — no X-Frame-Options or restrictive CSP.
    } else if (req.url.startsWith('/api/')) {
      reply.header('X-Frame-Options', 'DENY');
      reply.header('Content-Security-Policy', "default-src 'none'");
    } else {
      reply.header('X-Frame-Options', 'SAMEORIGIN');
    }
  });

  // Serve test fixture files at /files/ — dev/test only
  if (!isProduction) {
    app.register(fastifyStatic, {
      root: path.join(__dirname, 'fixtures'),
      prefix: '/files/',
      decorateReply: false,
    });
  }

  app.register(healthRoutes);
  app.register(documentRoutes);
  app.register(fileRoutes);

  return app;
}
