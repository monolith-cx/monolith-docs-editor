// The bridge's behaviour against a fake page and plugin (EDIT-5.2, 5.4): panel URL checks, the
// handshake, origin rules, one response per request in order, and the timeout that keeps the queue
// moving when DocumentServer never answers. The real editor runs it in the battery (E5a–E5e).
import { describe, expect, it, vi } from 'vitest';
import { createBridge } from './bridge.js';

const PANEL = 'https://crm.example.com';

function harness({ answer, timeoutMs = 200 } = {}) {
  const posted = [];
  const panelWindow = { postMessage: (message, origin) => posted.push({ message, origin }) };
  let handler = null;
  const calls = [];
  const statuses = [];
  let onLoad = null;
  const plugin = {
    callCommand: (fn, close, calc, cb) => {
      calls.push(fn.name);
      if (answer) answer(fn.name, cb);
      else cb({ ok: true, result: {} });
    },
    executeMethod: (name, args, cb) => cb('selected words'),
    executeCommand: vi.fn(),
  };
  const scopes = [];
  const bridge = createBridge({
    createFrame: (src, load) => {
      onLoad = load;
      return { window: () => panelWindow, src };
    },
    listen: (h) => (handler = h),
    status: (t) => statuses.push(t),
    plugin,
    setScope: (s) => scopes.push(s),
    timeoutMs,
  });
  const send = (data, { source = panelWindow, origin = PANEL } = {}) => handler({ source, origin, data });
  const responses = () => posted.filter((p) => p.message.type === 'udoc.response').map((p) => p.message);
  const flush = () => new Promise((r) => setTimeout(r, 20));
  return { bridge, posted, send, responses, flush, calls, scopes, statuses, load: () => onLoad && onLoad(), panelWindow, plugin };
}

describe('createBridge', () => {
  it('refuses a panel URL whose origin is not the registered one, or no panel at all', () => {
    const h = harness();
    h.bridge.start({ panelUrl: 'https://evil.example.com/p', panelOrigin: PANEL });
    expect(h.statuses).toEqual(['The panel address does not match its origin.']);
    const h2 = harness();
    h2.bridge.start(undefined);
    expect(h2.statuses).toEqual(['No panel for this session.']);
  });

  it('sends udoc.ready to the exact panel origin on load and on hello', () => {
    const h = harness();
    h.bridge.start({ panelUrl: `${PANEL}/panel#t=1`, panelOrigin: PANEL });
    h.load();
    h.send({ type: 'udoc.hello' });
    const ready = h.posted.filter((p) => p.message.type === 'udoc.ready');
    expect(ready).toHaveLength(2);
    expect(ready[0]).toEqual({ message: { type: 'udoc.ready', protocol: 1, operations: ['getText', 'getSelection', 'insertField', 'insertToken', 'applySuggestion', 'addComment'] }, origin: PANEL });
  });

  it('ignores messages from another window or another origin, and counts the protocol ones', async () => {
    const h = harness();
    h.bridge.start({ panelUrl: `${PANEL}/panel`, panelOrigin: PANEL });
    h.send({ type: 'udoc.request', id: 1, op: 'insertToken', args: { token: 'x' } }, { source: {} });
    h.send({ type: 'udoc.request', id: 2, op: 'insertToken', args: { token: 'x' } }, { origin: 'https://evil.example.com' });
    // DocumentServer's own plugin traffic is not a forged request and is not counted.
    h.send({ type: 'onCommandCallback', guid: 'x' }, { source: {} });
    h.send('plain string', { source: {} });
    await h.flush();
    expect(h.calls).toEqual([]);
    expect(h.responses()).toEqual([]);
    expect(h.bridge.stats.ignored).toBe(2);
  });

  it('answers every well-formed request once, in order, with only the operation keys in scope', async () => {
    const h = harness();
    h.bridge.start({ panelUrl: `${PANEL}/panel`, panelOrigin: PANEL });
    h.send({ type: 'udoc.request', id: 'a', op: 'insertToken', args: { token: '{x}', extra: 'dropped' } });
    h.send({ type: 'udoc.request', id: 'b', op: 'getSelection' });
    h.send({ type: 'udoc.request', id: 'c', op: 'nope' });
    h.send({ type: 'udoc.request', id: 'd', op: 'insertField', args: { label: 'x', value: 'y', kind: 'inline' } });
    h.send({ type: 'udoc.request', op: 'getText' }); // no id: dropped
    await h.flush();
    expect(h.responses()).toEqual([
      { type: 'udoc.response', id: 'c', ok: false, error: 'unsupported' },
      { type: 'udoc.response', id: 'd', ok: false, error: 'invalid_args' },
      { type: 'udoc.response', id: 'a', ok: true, result: {} },
      { type: 'udoc.response', id: 'b', ok: true, result: { text: 'selected words' } },
    ]);
    expect(h.scopes).toEqual([{ token: '{x}' }]);
  });

  it('answers failed when DocumentServer never answers, frees the queue, and ignores the late answer', async () => {
    let late = null;
    const h = harness({
      timeoutMs: 50,
      answer: (name, cb) => {
        if (name === 'insertToken' && !late) late = cb;
        else cb({ ok: true, result: {} });
      },
    });
    h.bridge.start({ panelUrl: `${PANEL}/panel`, panelOrigin: PANEL });
    h.send({ type: 'udoc.request', id: 1, op: 'insertToken', args: { token: 'x' } });
    h.send({ type: 'udoc.request', id: 2, op: 'insertToken', args: { token: 'y' } });
    await vi.waitFor(() => expect(h.responses()).toHaveLength(2), { timeout: 2000 });
    late({ ok: true, result: {} });
    await h.flush();
    expect(h.responses()).toEqual([
      { type: 'udoc.response', id: 1, ok: false, error: 'failed' },
      { type: 'udoc.response', id: 2, ok: true, result: {} },
    ]);
    expect(h.bridge.stats.timedOut).toBe(1);
  });

  it('treats a getText answer without a body, or a throwing command, as failed', async () => {
    const h = harness({
      answer: (name, cb) => {
        if (name === 'getText') cb(undefined);
        else throw new Error('sandbox');
      },
    });
    h.bridge.start({ panelUrl: `${PANEL}/panel`, panelOrigin: PANEL });
    h.send({ type: 'udoc.request', id: 1, op: 'getText' });
    h.send({ type: 'udoc.request', id: 2, op: 'insertToken', args: { token: 'x' } });
    await h.flush();
    expect(h.responses()).toEqual([
      { type: 'udoc.response', id: 1, ok: false, error: 'failed' },
      { type: 'udoc.response', id: 2, ok: false, error: 'failed' },
    ]);
  });

  it('still answers a request whose result cannot be cloned', async () => {
    const h = harness();
    h.bridge.start({ panelUrl: `${PANEL}/panel`, panelOrigin: PANEL });
    let first = true;
    h.panelWindow.postMessage = (message, origin) => {
      if (first && message.type === 'udoc.response') {
        first = false;
        throw new Error('DataCloneError');
      }
      h.posted.push({ message, origin });
    };
    h.send({ type: 'udoc.request', id: 7, op: 'insertToken', args: { token: 'x' } });
    await h.flush();
    expect(h.responses()).toEqual([{ type: 'udoc.response', id: 7, ok: false, error: 'failed' }]);
  });
});
