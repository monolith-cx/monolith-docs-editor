// @ts-check
/**
 * The panel bridge (EDIT-5, UDOC D14). DocumentServer opens this page as a right-side panel; it
 * loads the consumer's panel page from the session's plugin data in an iframe and answers that page's
 * requests with the operation set in `commands.js`.
 *
 * Origin rules (D14, EDIT-5.4): a message is accepted only when it comes from the panel iframe's own
 * window *and* the session's registered panel origin; every message is posted to that exact origin,
 * never `*`. Anything else is dropped without an answer (counted in `window.udocBridgeStats`).
 *
 * Protocol (consumer guide §7):
 *   plugin → panel  { type: 'udoc.ready', protocol, operations }   when the panel has loaded, and on 'udoc.hello'
 *   panel → plugin  { type: 'udoc.hello' }
 *   panel → plugin  { type: 'udoc.request', id, op, args }         id: a string or a number
 *   plugin → panel  { type: 'udoc.response', id, ok: true, result } | { type: 'udoc.response', id, ok: false, error }
 * Every well-formed request gets exactly one response: an operation DocumentServer never answers is
 * answered `failed` after `timeoutMs`, and the queue moves on (a late answer is ignored).
 * `stats.ignored` counts dropped protocol messages (`type` starting `udoc.`) from anywhere else.
 * Errors: stale_anchor, inside_field, not_found, unsupported, invalid_args, failed.
 */
import { OPERATIONS, PROTOCOL_VERSION, scopeFor } from './commands.js';

/** @typedef {{ ok: boolean, result?: unknown, error?: string }} Answer */
/** @typedef {{ postMessage(message: unknown, targetOrigin: string): void }} PanelWindow */
/**
 * What the bridge needs from its page; the tests pass fakes.
 * @typedef {{
 *   createFrame(src: string, onLoad: () => void): { window: () => PanelWindow | null },
 *   listen(handler: (event: { source: unknown, origin: string, data: unknown }) => void): void,
 *   status(text: string | null): void,
 *   plugin: AscPlugin,
 *   setScope(scope: Record<string, unknown>): void,
 *   timeoutMs?: number,
 * }} Host
 */

/** @param {Host} host */
export function createBridge(host) {
  const timeoutMs = host.timeoutMs ?? 30_000;
  /** @type {{ frame: { window: () => PanelWindow | null } | null, origin: string | null, queue: Promise<unknown>, stats: { ignored: number, answered: number, timedOut: number } }} */
  const state = { frame: null, origin: null, queue: Promise.resolve(), stats: { ignored: 0, answered: 0, timedOut: 0 } };

  /** @param {Record<string, unknown>} message */
  function post(message) {
    const win = state.frame ? state.frame.window() : null;
    if (!win || !state.origin) return;
    try {
      win.postMessage(message, state.origin);
    } catch {
      // A message the browser cannot clone: answer that instead, so the request still gets a response.
      if (message.type === 'udoc.response') {
        try {
          win.postMessage({ type: 'udoc.response', id: message.id, ok: false, error: 'failed' }, state.origin);
        } catch {
          /* the panel is gone */
        }
      }
    }
  }

  function ready() {
    post({ type: 'udoc.ready', protocol: PROTOCOL_VERSION, operations: Object.keys(OPERATIONS) });
  }

  /**
   * Runs one operation, after the ones before it, settled exactly once: by DocumentServer's answer
   * or by the timeout.
   * @param {string} op @param {unknown} args @returns {Promise<Answer>}
   */
  function run(op, args) {
    const operation = Object.prototype.hasOwnProperty.call(OPERATIONS, op) ? OPERATIONS[op] : undefined;
    if (!operation) return Promise.resolve({ ok: false, error: 'unsupported' });
    const a = /** @type {Record<string, unknown>} */ (args && typeof args === 'object' && !Array.isArray(args) ? args : {});
    let valid = false;
    try {
      valid = operation.valid(a);
    } catch {
      valid = false;
    }
    if (!valid) return Promise.resolve({ ok: false, error: 'invalid_args' });
    /** @type {Promise<Answer>} */
    const task = state.queue.then(
      () =>
        new Promise((resolve) => {
          let settled = false;
          /** @param {Answer} answer */
          const settle = (answer) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(answer);
          };
          const timer = setTimeout(() => {
            state.stats.timedOut += 1;
            settle({ ok: false, error: 'failed' });
          }, timeoutMs);
          try {
            if (op === 'getSelection') {
              host.plugin.executeMethod('GetSelectedText', [{ Numbering: false, Math: false, TableCellSeparator: '\t', ParaSeparator: '\n', TabSymbol: '\t' }], (text) =>
                settle({ ok: true, result: { text: typeof text === 'string' ? text : '' } }),
              );
              return;
            }
            if (!operation.command) {
              settle({ ok: false, error: 'unsupported' });
              return;
            }
            host.setScope(JSON.parse(JSON.stringify(scopeFor(operation.keys, a))));
            const readOnly = op === 'getText';
            host.plugin.callCommand(operation.command, false, !readOnly, (answer) => {
              const r = /** @type {{ ok?: unknown, result?: unknown, error?: unknown, body?: unknown } | null | undefined} */ (answer);
              if (readOnly) settle(r && typeof r === 'object' && Array.isArray(r.body) ? { ok: true, result: r } : { ok: false, error: 'failed' });
              else if (r && r.ok === true) settle({ ok: true, result: r.result || {} });
              else settle({ ok: false, error: r && typeof r.error === 'string' ? r.error : 'failed' });
            });
          } catch {
            settle({ ok: false, error: 'failed' });
          }
        }),
    );
    state.queue = task.catch(() => undefined);
    return task;
  }

  /** @param {{ source: unknown, origin: string, data: unknown }} event */
  function onMessage(event) {
    const win = state.frame ? state.frame.window() : null;
    const data = /** @type {{ type?: unknown, id?: unknown, op?: unknown, args?: unknown } | null} */ (event.data && typeof event.data === 'object' ? event.data : null);
    if (!win || event.source !== win || event.origin !== state.origin) {
      // Counted only when it speaks the protocol: DocumentServer's own plugin traffic reaches this
      // window too and is none of the bridge's business.
      if (data && typeof data.type === 'string' && data.type.indexOf('udoc.') === 0) state.stats.ignored += 1;
      return;
    }
    if (!data) return;
    if (data.type === 'udoc.hello') {
      ready();
      return;
    }
    if (data.type !== 'udoc.request' || (typeof data.id !== 'string' && typeof data.id !== 'number')) return;
    const id = data.id;
    run(String(data.op), data.args).then(
      (answer) => {
        state.stats.answered += 1;
        post({ type: 'udoc.response', id, ...answer });
      },
      () => post({ type: 'udoc.response', id, ok: false, error: 'failed' }),
    );
  }

  /**
   * Hosts the panel page named by the session's plugin data (`editorConfig.plugins.options`, keyed
   * by this plugin's GUID; the service checked the URL's origin against the consumer's `panelOrigins`).
   * @param {unknown} options
   */
  function start(options) {
    const o = /** @type {{ panelUrl?: unknown, panelOrigin?: unknown } | null} */ (options && typeof options === 'object' ? options : null);
    if (!o || typeof o.panelUrl !== 'string' || typeof o.panelOrigin !== 'string') {
      host.status('No panel for this session.');
      return;
    }
    let url = null;
    try {
      url = new URL(o.panelUrl);
    } catch {
      url = null;
    }
    if (!url || url.origin !== o.panelOrigin) {
      host.status('The panel address does not match its origin.');
      return;
    }
    state.origin = o.panelOrigin;
    host.listen(onMessage);
    state.frame = host.createFrame(url.href, ready);
    host.status(null);
  }

  return { start, onMessage, stats: state.stats };
}

// In the plugin page: wire the bridge to the DOM and DocumentServer's plugin object.
if (typeof window !== 'undefined' && window.Asc) {
  const asc = window.Asc;
  const bridge = createBridge({
    createFrame(src, onLoad) {
      const frame = document.createElement('iframe');
      frame.title = 'Document panel';
      frame.src = src;
      frame.addEventListener('load', onLoad);
      const host = document.getElementById('panel');
      if (host) host.appendChild(frame);
      return { window: () => frame.contentWindow };
    },
    listen(handler) {
      window.addEventListener('message', (event) => handler({ source: event.source, origin: event.origin, data: event.data }));
    },
    status(text) {
      const el = document.getElementById('status');
      if (!el) return;
      if (text === null) el.remove();
      else el.textContent = text;
    },
    plugin: asc.plugin,
    setScope(scope) {
      asc.scope = scope;
    },
  });
  window.udocBridgeStats = bridge.stats;
  asc.plugin.init = function () {
    bridge.start((asc.plugin.info || {}).options);
  };
  // The panel's close button arrives as button(-1): the plugin must close itself (OnlyOffice's
  // contract, ADR F18). The Plugins tab's "Document panel" button opens it again with the same data.
  asc.plugin.button = function (id) {
    if (id === -1) asc.plugin.executeCommand('close', '');
  };
}
