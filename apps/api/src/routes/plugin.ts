/**
 * The panel bridge plugin's files (EDIT-5.1, guidance E7), served from the service's own public
 * origin (`API_PUBLIC_URL`), the one plugin origin per environment that consumers' panel pages trust.
 *
 *   GET /plugins/udoc-bridge/config.json   the plugin's manifest (CORS for DocumentServer's origin)
 *   GET /plugins/udoc-bridge/index.html    rendered: DocumentServer's plugin API from this environment, a nonce
 *   GET /plugins/udoc-bridge/bridge.js, commands.js, icon.png
 *
 * Exactly these files, read once; framed only within DocumentServer, the service's own editor page,
 * and registered consumers' origins; the page may frame only the registered consumers' panel origins. No consumer auth (DocumentServer's editor fetches
 * them) and no per-address rate limit (every editor in an office shares an address).
 */
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { accessSync, constants, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { getConsumers } from '../consumers.js';

export const PLUGIN_PREFIX = '/plugins/udoc-bridge/';

/** The stylesheet DocumentServer 10.0.0.1's plugins.js injects into a plugin page. */
const PLUGINS_JS_STYLE_HASH = 'sha256-+hyDP+n2vEbTIcp6afJ/mXciplsnk96LITgc0vUcp/M=';

const FILES: Record<string, string> = {
  'config.json': 'application/json; charset=utf-8',
  'index.html': 'text/html; charset=utf-8',
  'bridge.js': 'text/javascript; charset=utf-8',
  'commands.js': 'text/javascript; charset=utf-8',
  'icon.png': 'image/png',
};

/** A regular file this process can read (a directory or an unreadable file serves nothing). */
function readableFile(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** The panel cannot load without every served file; the service refuses to start (EDIT-5 review). */
export function pluginProblems(): string[] {
  const missing = Object.keys(FILES).filter((name) => !readableFile(path.join(config.pluginDir, name)));
  return missing.length ? [`the bridge plugin is missing ${missing.join(', ')} in EDITOR_PLUGIN_DIR (${config.pluginDir}), or they are not readable files`] : [];
}

/** Only exact web origins reach a CSP header (legacy-only consumers' entries are not validated at load). */
function isOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === value;
  } catch {
    return false;
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export async function pluginRoutes(app: FastifyInstance): Promise<void> {
  const files = new Map<string, Buffer>();
  // Read once at boot; a file that cannot be read stops the boot (startupProblems reports it first).
  for (const name of Object.keys(FILES)) files.set(name, await readFile(path.join(config.pluginDir, name)));
  const ds = originOf(config.onlyofficePublicUrl) ?? '';
  // frame-ancestors is checked against every ancestor, not only the parent: the plugin page sits in
  // DocumentServer's frame, inside the service's own editor page, inside the consumer's app when it
  // embeds the editor. So: DocumentServer, the service itself, and the registered consumers' origins.
  const ancestors = () => {
    const consumers = getConsumers().flatMap((c) => [...(c.panelOrigins ?? []), ...(c.returnOrigin ? [c.returnOrigin] : [])]).filter(isOrigin);
    return ["'self'", ds, ...new Set(consumers)].join(' ');
  };

  app.get<{ Params: { file: string } }>(`${PLUGIN_PREFIX}:file`, async (req, reply) => {
    const name = req.params.file;
    const type = Object.prototype.hasOwnProperty.call(FILES, name) ? FILES[name] : undefined;
    const body = type ? files.get(name) : undefined;
    if (!type || !body) return reply.status(404).send({ error: 'not_found' });
    reply.header('Cache-Control', name === 'index.html' ? 'no-store' : 'no-cache');
    if (name === 'config.json') reply.header('Access-Control-Allow-Origin', ds);
    if (name !== 'index.html') {
      reply.header('Content-Security-Policy', `default-src 'none'; frame-ancestors ${ancestors()}`);
      return reply.type(type).send(body);
    }
    const nonce = randomBytes(16).toString('base64');
    const panels = [...new Set(getConsumers().flatMap((c) => c.panelOrigins ?? []).filter(isOrigin))];
    reply.header(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        // DocumentServer's plugins.js evaluates strings (measured on 10.0.0.1, ADR F18); without
        // 'unsafe-eval' the plugin never initialises. Only this page allows it.
        `script-src 'nonce-${nonce}' 'self' 'unsafe-eval' ${ds}`,
        // plugins.js injects one stylesheet of its own (10.0.0.1; this is its hash, ADR F18) and sets
        // style attributes; any other style element still needs the nonce. A release that changes the
        // stylesheet fails battery E5a's CSP check.
        `style-src 'nonce-${nonce}' 'self' ${ds} '${PLUGINS_JS_STYLE_HASH}'`,
        "style-src-attr 'unsafe-inline'",
        `img-src 'self' data: ${ds}`,
        // DocumentServer's plugins.js reads this plugin's own config.json.
        "connect-src 'self'",
        `frame-src ${panels.length ? panels.join(' ') : "'none'"}`,
        "base-uri 'none'",
        "form-action 'none'",
        `frame-ancestors ${ancestors()}`,
      ].join('; '),
    );
    reply.header('Referrer-Policy', 'no-referrer');
    const html = body.toString('utf8').split('{{DS}}').join(ds).split('{{NONCE}}').join(nonce);
    return reply.type(type).send(html);
  });
}
