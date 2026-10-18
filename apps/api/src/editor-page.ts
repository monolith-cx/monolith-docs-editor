/**
 * The editor page and the expired page (EDIT-2.6). Everything interpolated is escaped:
 * the title as HTML text, the config as JSON safe inside a <script> element (`<`, `>`, `&`,
 * U+2028, U+2029 escaped), and the page carries a strict CSP with a per-response nonce that
 * admits only DocumentServer's origin for scripts and frames. The page holds nothing beyond
 * what DocumentServer receives (the signed config, including the panel token, D14).
 */
import { randomBytes } from 'node:crypto';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/** JSON that cannot close a <script> element or break a JavaScript string. */
export function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .split(LINE_SEPARATOR).join('\\u2028')
    .split(PARAGRAPH_SEPARATOR).join('\\u2029');
}

export interface RenderedPage {
  html: string;
  csp: string;
}

function csp(nonce: string, dsOrigin: string | null): string {
  const ds = dsOrigin ? ` ${dsOrigin}` : '';
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'${ds}`,
    `style-src 'nonce-${nonce}'`,
    `frame-src${ds || " 'none'"}`,
    `img-src${ds} data:`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function renderEditorPage(opts: { dsPublicUrl: string; title: string; config: unknown; token: string }): RenderedPage {
  const nonce = randomBytes(16).toString('base64');
  const dsOrigin = originOf(opts.dsPublicUrl);
  const apiJs = `${opts.dsPublicUrl.replace(/\/$/, '')}/web-apps/apps/api/documents/api.js`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(opts.title)} — Monolith Docs</title>
  <style nonce="${nonce}">
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #editor { width: 100%; height: 100%; overflow: hidden; }
  </style>
</head>
<body>
  <div id="editor"></div>
  <script nonce="${nonce}" src="${escapeHtml(apiJs)}"></script>
  <script nonce="${nonce}">
    var editorConfig = ${scriptSafeJson(opts.config)};
    editorConfig.token = ${scriptSafeJson(opts.token)};
    new DocsAPI.DocEditor("editor", editorConfig);
  </script>
</body>
</html>`;
  return { html, csp: csp(nonce, dsOrigin) };
}

/**
 * Shown for an expired, tampered, or unknown editor token. It links back to the consumer only
 * when the token named one (an expired token); it never says which check failed.
 */
export function renderExpiredPage(returnOrigin: string | undefined): RenderedPage {
  const nonce = randomBytes(16).toString('base64');
  const link = returnOrigin ? `<p><a href="${escapeHtml(returnOrigin)}" target="_top" rel="noopener">Go back and open the document again</a></p>` : '';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Editor session ended — Monolith Docs</title>
  <style nonce="${nonce}">
    body { font: 15px/1.5 system-ui, sans-serif; margin: 3rem auto; max-width: 32rem; padding: 0 1rem; color: #222; }
  </style>
</head>
<body>
  <h1>This editor session has ended</h1>
  <p>The link is no longer valid. Open the document again from the app you came from.</p>
  ${link}
</body>
</html>`;
  return { html, csp: csp(nonce, null) };
}
