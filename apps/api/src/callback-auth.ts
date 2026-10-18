/**
 * Verifying DocumentServer's callback (EDIT-2.4; fixes ERRORS.md 2026-10-16 09:20).
 *
 * The editor page embeds a config token signed with the same secret, so "a token that verifies"
 * proves nothing. A callback is accepted only when:
 *  - a token is present (mandatory outside EDITOR_ENV=local) in the forms measured in EDIT-1
 *    (ADR F2): `Authorization: Bearer <jwt>` whose claims wrap the body in `payload`, or a flat
 *    body `token`;
 *  - it is HS256 and carries no editor-config claims (`document`, `editorConfig`);
 *  - key, status, url, users, actions, lastsave, and forcesavetype are taken from the verified
 *    claims, and a body field that disagrees is refused;
 *  - the save URL's origin is one of DocumentServer's configured origins.
 */
import jwt from 'jsonwebtoken';

export interface VerifiedCallback {
  key: string;
  status: number;
  url?: string;
  users?: string[];
  actions?: Array<{ type: number; userid: string }>;
  lastsave?: string;
  forcesavetype?: number;
}

export type CallbackRefusal = 'missing_token' | 'invalid_token' | 'config_token' | 'mismatch' | 'bad_url_origin' | 'malformed';

export type CallbackCheck = { ok: true; callback: VerifiedCallback; verified: boolean } | { ok: false; reason: CallbackRefusal };

const FIELDS = ['key', 'status', 'url', 'users', 'actions', 'lastsave', 'forcesavetype'] as const;

function verify(token: string, secret: string): Record<string, unknown> | null {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    return typeof decoded === 'object' && decoded !== null ? (decoded as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function checkCallback(opts: {
  authorization: string | undefined;
  body: Record<string, unknown>;
  secret: string;
  allowedUrlOrigins: readonly string[];
  requireToken: boolean;
}): CallbackCheck {
  const { body } = opts;
  const headerToken = opts.authorization?.startsWith('Bearer ') ? opts.authorization.slice(7) : undefined;
  const bodyToken = typeof body['token'] === 'string' ? (body['token'] as string) : undefined;

  let claims: Record<string, unknown> | null = null;
  if (headerToken) {
    const decoded = verify(headerToken, opts.secret);
    if (!decoded) return { ok: false, reason: 'invalid_token' };
    claims = typeof decoded['payload'] === 'object' && decoded['payload'] !== null ? (decoded['payload'] as Record<string, unknown>) : decoded;
  } else if (bodyToken) {
    claims = verify(bodyToken, opts.secret);
    if (!claims) return { ok: false, reason: 'invalid_token' };
  } else if (opts.requireToken) {
    return { ok: false, reason: 'missing_token' };
  }

  if (claims && ('document' in claims || 'editorConfig' in claims)) return { ok: false, reason: 'config_token' };

  // Signed claims are the source of truth; the body may only repeat them.
  const source: Record<string, unknown> = claims ?? body;
  if (claims) {
    for (const f of FIELDS) {
      if (f in body && !same(body[f], claims[f])) return { ok: false, reason: 'mismatch' };
    }
  }

  const key = source['key'];
  const status = source['status'];
  if (typeof key !== 'string' || !key || typeof status !== 'number') return { ok: false, reason: 'malformed' };

  const url = typeof source['url'] === 'string' ? (source['url'] as string) : undefined;
  if (url) {
    let urlOrigin: string;
    try {
      urlOrigin = new URL(url).origin;
    } catch {
      return { ok: false, reason: 'bad_url_origin' };
    }
    if (!opts.allowedUrlOrigins.includes(urlOrigin)) return { ok: false, reason: 'bad_url_origin' };
  }

  const callback: VerifiedCallback = {
    key,
    status,
    ...(url ? { url } : {}),
    ...(Array.isArray(source['users']) ? { users: (source['users'] as unknown[]).map(String) } : {}),
    ...(Array.isArray(source['actions']) ? { actions: source['actions'] as Array<{ type: number; userid: string }> } : {}),
    ...(typeof source['lastsave'] === 'string' ? { lastsave: source['lastsave'] as string } : {}),
    ...(typeof source['forcesavetype'] === 'number' ? { forcesavetype: source['forcesavetype'] as number } : {}),
  };
  return { ok: true, callback, verified: Boolean(claims) };
}
