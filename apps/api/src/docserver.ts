/**
 * DocumentServer's command service (drop, forgotten files), called on its internal URL with
 * the JWT in both documented inbox forms (header with `payload`, and a body `token`), as the
 * EDIT-1 battery does. Error codes are mapped to names; nothing here logs a URL.
 */
import jwt from 'jsonwebtoken';
import { fetch as undiciFetch } from 'undici';

export interface CommandResult {
  error: number;
  url?: string;
  keys?: string[];
  [key: string]: unknown;
}

export const COMMAND_ERRORS: Record<number, string> = {
  0: 'ok',
  1: 'key_not_found',
  2: 'callback_url_not_correct',
  3: 'docserver_internal',
  4: 'no_changes',
  5: 'command_not_correct',
  6: 'invalid_token',
};

export async function command(dsUrl: string, secret: string, body: Record<string, unknown>, timeoutMs = 10_000): Promise<CommandResult> {
  const res = await undiciFetch(`${dsUrl.replace(/\/$/, '')}/command`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${jwt.sign({ payload: body }, secret, { algorithm: 'HS256', expiresIn: '5m' })}`,
    },
    body: JSON.stringify({ ...body, token: jwt.sign(body, secret, { algorithm: 'HS256', expiresIn: '5m' }) }),
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`command service answered ${res.status}`);
  return (await res.json()) as CommandResult;
}

/** Rewrites a DocumentServer file URL onto the given base (its public URL), keeping path and query. */
export function onBase(url: string, base: string): string {
  const u = new URL(url);
  // Replace the origin only: never resolve the path as a reference, which a `//host/…` path would turn into another host.
  return new URL(`${new URL(base).origin}${u.pathname}${u.search}`).toString();
}
