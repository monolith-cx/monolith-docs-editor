import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { config } from './config.js';
import { findConsumersByHostname, getConsumers } from './consumers.js';
import type { Consumer, HmacAuth, JwksAuth } from './consumers.js';
import { redactRequestPath, safeErrorText } from './log-safety.js';

declare module 'fastify' {
  interface FastifyRequest {
    consumer?: Consumer;
    consumerId?: string;
    jwtPayload?: jwt.JwtPayload;
  }
}

const jwksClients = new Map<string, jwksClient.JwksClient>();

function getJwksClient(jwksUrl: string): jwksClient.JwksClient {
  let client = jwksClients.get(jwksUrl);
  if (!client) {
    client = jwksClient({ jwksUri: jwksUrl, cache: true, rateLimit: true });
    jwksClients.set(jwksUrl, client);
  }
  return client;
}

async function verifyJwksToken(token: string, auth: JwksAuth): Promise<jwt.JwtPayload> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      (header, callback) => {
        const client = getJwksClient(auth.jwksUrl);
        client.getSigningKey(header.kid, (err, key) => {
          if (err || !key) return callback(err ?? new Error('No signing key found'));
          callback(null, key.getPublicKey());
        });
      },
      {
        audience: auth.audience,
        issuer: auth.issuer,
      },
      (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded as jwt.JwtPayload);
      },
    );
  });
}

function verifyHmacToken(token: string, auth: HmacAuth): jwt.JwtPayload {
  const decoded = jwt.verify(token, auth.secret, {
    algorithms: ['HS256'],
    issuer: auth.issuer,
    audience: auth.audience,
  });
  if (typeof decoded === 'string') {
    throw new Error('Unexpected string JWT payload');
  }
  return decoded;
}

export const authPlugin = fp(async function authPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest('consumer', undefined);
  app.decorateRequest('consumerId', undefined);
  app.decorateRequest('jwtPayload', undefined);

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // Public paths — no auth needed
    if (req.url === '/health' || req.url === '/api/status' || req.url.startsWith('/editor/')) {
      return;
    }

    // OnlyOffice callback — skips consumer auth (route handler verifies OnlyOffice JWT)
    if (req.url === '/api/documents/callback') {
      return;
    }

    // File serving — OnlyOffice fetches uploaded files by unguessable UUID
    if (req.method === 'GET' && req.url.startsWith('/api/files/')) {
      return;
    }

    // In production, consumers MUST be configured
    const isProduction = config.nodeEnv === 'production';
    const allConsumers = getConsumers();
    if (allConsumers.length === 0) {
      if (isProduction) {
        req.log.error('No consumers configured in production — rejecting all API requests');
        return reply.status(503).send({ error: 'Service not configured' });
      }
      // Dev mode: skip auth when no consumers configured
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.log.warn({ path: redactRequestPath(req.url), method: req.method, ip: req.ip }, 'Auth failed: missing or malformed Authorization header');
      return reply.status(401).send({ error: 'Missing Authorization header' });
    }

    const token = authHeader.slice(7);
    const hostname = req.hostname;
    const candidates = findConsumersByHostname(hostname);

    // Try API key (dev only — production rejects api-key consumers at startup)
    for (const c of candidates) {
      if (c.auth.mode === 'api-key' && c.auth.key === token) {
        req.consumer = c;
        req.consumerId = c.id;
        return;
      }
    }

    // Try HMAC consumers
    for (const c of candidates) {
      if (c.auth.mode !== 'hmac') continue;
      try {
        const payload = verifyHmacToken(token, c.auth);
        req.consumer = c;
        req.consumerId = c.id;
        req.jwtPayload = payload;
        return;
      } catch (err: unknown) {
        const message = safeErrorText(err instanceof Error ? err.message : 'unknown');
        req.log.debug({ consumerId: c.id, error: message }, 'HMAC verification failed, trying next consumer');
      }
    }

    // Try JWKS consumers
    for (const c of candidates) {
      if (c.auth.mode !== 'jwks') continue;
      try {
        const payload = await verifyJwksToken(token, c.auth);
        req.consumer = c;
        req.consumerId = c.id;
        req.jwtPayload = payload;
        return;
      } catch (err: unknown) {
        const message = safeErrorText(err instanceof Error ? err.message : 'unknown');
        req.log.debug({ consumerId: c.id, error: message }, 'JWKS verification failed, trying next consumer');
      }
    }

    // All auth methods exhausted
    req.log.warn(
      { path: redactRequestPath(req.url), method: req.method, ip: req.ip, hostname, candidateCount: candidates.length },
      'Auth failed: no matching consumer for token',
    );
    return reply.status(401).send({ error: 'Invalid or expired credentials' });
  });
});
