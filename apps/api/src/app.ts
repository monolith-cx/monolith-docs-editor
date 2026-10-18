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
import { MAX_TOKEN_CHARS } from './session-token.js';
import { LOG_REDACT_CENSOR, LOG_REDACT_PATHS, redactRequestPath, scrubLogArguments, serializeError, serializeRequest } from './log-safety.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isLocal = !config.strict;
// Sealed editor tokens travel in the path (EDIT-2.3).
const MAX_PARAM_LENGTH = MAX_TOKEN_CHARS + 16;

export interface BuildAppOptions {
  /** Log destination; tests inject a stream to assert on real log lines. */
  logStream?: NodeJS.WritableStream;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    // A sealed editor token travels as one path parameter (EDIT-2.3); top-level maxParamLength is deprecated (FSTDEP022).
    routerOptions: { maxParamLength: MAX_PARAM_LENGTH },
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
    // A route's own policy wins: the editor page carries its token in the URL and sends no-referrer.
    if (!reply.hasHeader('Referrer-Policy')) reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-XSS-Protection', '0');

    if (!isLocal) {
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
  if (isLocal) {
    app.register(fastifyStatic, {
      root: path.join(__dirname, 'fixtures'),
      prefix: '/files/',
      decorateReply: false,
    });
  }

  app.register(healthRoutes);
  app.register(documentRoutes);
  app.register(fileRoutes);

  // Fastify's own 404 message names the full URL ("Route GET:/editor/<token>/ not found"), which
  // would put a sealed token or a document key in the log (EDIT-4). Log the redacted path only.
  app.setNotFoundHandler((req, reply) => {
    req.log.info({ path: redactRequestPath(req.url) }, 'Route not found');
    return reply.status(404).send({ error: 'not_found' });
  });

  return app;
}
