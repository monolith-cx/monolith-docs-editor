/**
 * The origins a consumer's app frames the service from (EDIT-2.9, EDIT-5.1): its panel origins and its
 * return origin. Both the editor page and the bridge plugin's files build `frame-ancestors` from these,
 * so a value reaches a CSP header only through `isOrigin`.
 */
import type { Consumer } from './consumers.js';

// A host of DNS labels or a bracketed IPv6 address, and an optional port. WHATWG URL parsing keeps
// `;`, `,`, `'`, and `*` in a host (`https://a.com;script-src` is its own origin), and any of them in a
// CSP source list could add a directive or a wildcard, so the shape is checked as well as the parse.
const ORIGIN_SHAPE = /^https?:\/\/(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

/** Only exact web origins reach a CSP header (legacy-only consumers' entries are not validated at load). */
export function isOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || !ORIGIN_SHAPE.test(value)) return false;
  try {
    const u = new URL(value);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === value;
  } catch {
    return false;
  }
}

/** One consumer's framing origins, exact origins only, each once. The editor page takes its own consumer's; the plugin's files take every consumer's (the plugin is not per-session). */
export function frameOrigins(consumer: Consumer): string[] {
  return [...new Set([...(consumer.panelOrigins ?? []), ...(consumer.returnOrigin ? [consumer.returnOrigin] : [])].filter(isOrigin))];
}

/**
 * `frame-ancestors` for a page shown only inside one consumer's app: the service itself and that
 * consumer's origins, or `'none'` when there is no consumer or it registered no origin.
 */
export function consumerFrameAncestors(consumer: Consumer | undefined): string {
  const origins = consumer ? frameOrigins(consumer) : [];
  return origins.length ? ["'self'", ...origins].join(' ') : "'none'";
}
