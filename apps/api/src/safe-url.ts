/**
 * The only gate for URLs the service hands to DocumentServer or fetches itself (EDIT-2.2).
 *
 * DocumentServer fetches any URL inside a JWT-signed config or command directly, bypassing
 * its own private-address filter (`externalRequest.directIfIn.jwtToken`, ADR F3, battery U12),
 * so every document, callback, and conversion URL is checked here before it is signed or fetched:
 * https only, the host on the caller's allowlist, and every address the name resolves to public.
 * Fetches are pinned to exactly the checked addresses and never follow redirects, so a DNS
 * answer that changes between the check and the connection cannot steer a request inward.
 *
 * Error messages never carry the URL (EDIT-4).
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import type { RequestInit as UndiciRequestInit, Response as UndiciResponse } from 'undici';

export type UrlRefusal = 'invalid' | 'scheme' | 'credentials' | 'host_not_allowed' | 'local_name' | 'private_address' | 'metadata' | 'unresolvable';

export class UrlRefused extends Error {
  constructor(readonly code: UrlRefusal) {
    super(`URL refused: ${code}`);
    this.name = 'UrlRefused';
  }
}

export interface UrlPolicy {
  /** Exact host names (no subdomains) the URL may name; omit to allow any public host. */
  allowHosts?: readonly string[];
  /** Only for `EDITOR_ENV=local`: allow http and private addresses (the scratch battery). */
  local?: boolean;
  /** An exact internal prefix accepted without resolution (the legacy `/api/files/` route, E1). */
  internalPrefix?: string;
}

export interface CheckedUrl {
  url: URL;
  /** The addresses the host resolved to when checked; empty for an accepted internal prefix. */
  addresses: string[];
  internal: boolean;
}

const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa'];
const LOCAL_NAMES = new Set(['localhost']);
/**
 * Cloud metadata endpoints: refused in every environment, `local` included (EDIT-3), by name and by
 * address (and IPv4-mapped forms). Outside `local` the private-address check covers the rest of
 * 169.254/16 and every embedded form; under `local` only these exact endpoints are refused.
 */
const METADATA_NAMES = new Set(['metadata', 'metadata.google.internal']);
const METADATA_V4 = '169.254.169.254';
const METADATA_V6 = [0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254];

function isMetadataAddress(ip: string): boolean {
  if (isIP(ip) === 4) return ip === METADATA_V4;
  const h = expandV6(ip);
  if (!h) return false;
  if (h.every((x, i) => x === METADATA_V6[i])) return true;
  // IPv4-mapped (::ffff:a.b.c.d) in any spelling.
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    const hi = h[6] ?? 0;
    const lo = h[7] ?? 0;
    return `${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}` === METADATA_V4;
  }
  return false;
}

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const V4_BLOCKED: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function blockedV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

function expandV6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  // A trailing dotted IPv4 (::ffff:1.2.3.4) becomes two hextets.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (isIP(tail) !== 4) return null;
    const n = v4ToInt(tail);
    text = `${text.slice(0, lastColon + 1)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, rest] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = rest !== undefined && rest !== '' ? rest.split(':') : [];
  const fill = text.includes('::') ? 8 - left.length - right.length : 0;
  const parts = [...left, ...Array<string>(Math.max(fill, 0)).fill('0'), ...right];
  if (parts.length !== 8) return null;
  return parts.map((p) => parseInt(p, 16));
}

function blockedV6(ip: string): boolean {
  const h = expandV6(ip);
  if (!h) return true;
  const allZeroUntil = (n: number) => h.slice(0, n).every((x) => x === 0);
  if (h.every((x) => x === 0)) return true; // ::
  if (allZeroUntil(7) && h[7] === 1) return true; // ::1
  const first = h[0] ?? 0;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site local (deprecated)
  if (first === 0x2001 && h[1] === 0x0db8) return true; // documentation
  if (first === 0x2001 && h[1] === 0x0000) return true; // 2001::/32 Teredo (embeds an obfuscated IPv4)
  if (first === 0x0100 && h.slice(1, 4).every((x) => x === 0)) return true; // 100::/64 discard
  if (first === 0x64 && h[1] === 0xff9b && h[2] === 0x0001) return true; // 64:ff9b:1::/48 local-use NAT64 (RFC 8215)
  const embedded = (hi: number, lo: number) => `${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}`;
  if (allZeroUntil(5) && h[5] === 0xffff) return blockedV4(embedded(h[6] ?? 0, h[7] ?? 0)); // ::ffff:a.b.c.d (mapped)
  if (allZeroUntil(4) && h[4] === 0xffff && h[5] === 0) return blockedV4(embedded(h[6] ?? 0, h[7] ?? 0)); // ::ffff:0:a.b.c.d (translated)
  if (allZeroUntil(6)) return blockedV4(embedded(h[6] ?? 0, h[7] ?? 0)); // ::a.b.c.d (deprecated compatible)
  if (first === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) return blockedV4(embedded(h[6] ?? 0, h[7] ?? 0)); // NAT64
  if (first === 0x2002) return blockedV4(embedded(h[1] ?? 0, h[2] ?? 0)); // 2002::/16 6to4 (embeds an IPv4)
  return false;
}

/** True when an address must never be contacted from the service or DocumentServer. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return blockedV4(ip);
  if (family === 6) return blockedV6(ip);
  return true;
}

function isLocalName(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return LOCAL_NAMES.has(h) || LOCAL_SUFFIXES.some((s) => h.endsWith(s));
}

/** Checks a URL against the policy and resolves it; throws `UrlRefused`. */
export async function checkUrl(raw: string, policy: UrlPolicy = {}): Promise<CheckedUrl> {
  if (policy.internalPrefix && raw.startsWith(policy.internalPrefix)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new UrlRefused('invalid');
    }
    // The prefix must be the whole origin and path head, with nothing smuggled after it.
    if (!url.href.startsWith(policy.internalPrefix) || url.username || url.password) throw new UrlRefused('invalid');
    return { url, addresses: [], internal: true };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlRefused('invalid');
  }
  if (url.protocol !== 'https:' && !(policy.local && url.protocol === 'http:')) throw new UrlRefused('scheme');
  if (url.username || url.password) throw new UrlRefused('credentials');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  // Before the allowlist, so a metadata endpoint is named as one even when it is not on the list.
  if (METADATA_NAMES.has(host.replace(/\.$/, '')) || (isIP(host) && isMetadataAddress(host))) throw new UrlRefused('metadata');
  if (policy.allowHosts && !policy.allowHosts.map((h) => h.toLowerCase()).includes(host)) {
    throw new UrlRefused('host_not_allowed');
  }
  if (!policy.local && isLocalName(host)) throw new UrlRefused('local_name');

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
    } catch {
      throw new UrlRefused('unresolvable');
    }
  }
  if (addresses.length === 0) throw new UrlRefused('unresolvable');
  if (addresses.some(isMetadataAddress)) throw new UrlRefused('metadata');
  if (!policy.local && addresses.some(isBlockedAddress)) throw new UrlRefused('private_address');
  return { url, addresses, internal: false };
}

/** An undici dispatcher whose lookup answers only with the checked addresses. */
export function pinnedAgent(checked: CheckedUrl): Agent {
  const addresses = checked.addresses;
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        const entries = addresses.map((address) => ({ address, family: isIP(address) === 6 ? 6 : 4 }));
        if (options && (options as { all?: boolean }).all) {
          callback(null, entries);
        } else {
          const first = entries[0];
          if (!first) callback(new Error('no address'), '', 4);
          else callback(null, first.address, first.family);
        }
      },
    },
  });
}

/** Fetches a checked URL on its pinned addresses; redirects are returned, never followed. */
export async function safeFetch(checked: CheckedUrl, init: UndiciRequestInit = {}): Promise<UndiciResponse> {
  if (checked.internal) return undiciFetch(checked.url, { ...init, redirect: 'manual' });
  const dispatcher = pinnedAgent(checked);
  try {
    return await undiciFetch(checked.url, { ...init, redirect: 'manual', dispatcher });
  } finally {
    // The response body is consumed by the caller before the agent's sockets matter; close lazily.
    void dispatcher.close().catch(() => undefined);
  }
}
