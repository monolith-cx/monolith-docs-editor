// Driving a real DocumentServer editor in Chrome (EDIT-1.2).
// Keyboard and mouse input go through Playwright; document reads and plugin API
// calls are evaluated inside the probe plugin's frame (the spike's method).
import { signJwt } from '../stub/jwt.mjs';
import { DS_PUBLIC, STUB_A, STUB_INTERNAL, sleep } from './stack.mjs';

export const PROBE_GUID = 'asc.{8C2F3A6E-5B1D-4C7A-9E2F-1A3B5C7D9E01}';
export const PROBE_CONFIG = `${STUB_A}/plugins/probe/config.json`;

export function buildConfig({ fixture, key, permissions = {}, mode = 'edit', user = { id: 'u1', name: 'Rep One' }, plugins = true, pluginOptions, customization = {}, extraEditorConfig = {} }) {
  const config = {
    document: {
      fileType: 'docx',
      key,
      title: fixture,
      url: `${STUB_INTERNAL}/fixtures/${fixture}`,
      permissions: { edit: mode === 'edit', modifyContentControl: false, protect: false, ...permissions },
    },
    documentType: 'word',
    editorConfig: {
      mode,
      lang: 'en',
      callbackUrl: `${STUB_INTERNAL}/callback`,
      user,
      customization: { forcesave: true, ...customization },
      ...extraEditorConfig,
    },
  };
  if (plugins) {
    config.editorConfig.plugins = {
      autostart: [PROBE_GUID],
      pluginsData: [PROBE_CONFIG],
      ...(pluginOptions ? { options: { [PROBE_GUID]: pluginOptions } } : {}),
    };
  }
  return config;
}

export class Editor {
  constructor(page, key) {
    this.page = page;
    this.key = key;
    this.probe = null;
  }

  /** Opens an editor page for `config`, waits for the document and (if registered) the probe plugin. */
  static async open(context, secret, config, { waitProbe = true, timeoutMs = 120_000 } = {}) {
    const signed = { ...config, token: signJwt(config, secret) };
    const res = await fetch(`${STUB_A}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: signed }),
    });
    const { id } = await res.json();
    const page = await context.newPage();
    page.on('pageerror', () => undefined);
    await page.goto(`${STUB_A}/editor/${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: timeoutMs });
    const editor = new Editor(page, config.document.key);
    if (waitProbe && config.editorConfig.plugins) await editor.waitProbe(timeoutMs);
    return editor;
  }

  async waitProbe(timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const frame = this.page.frames().find((f) => f.url().includes('/plugins/probe/index.html'));
      if (frame) {
        const ready = await frame.evaluate(() => Boolean(window.__probe && window.__probe.ready)).catch(() => false);
        if (ready) {
          this.probe = frame;
          return frame;
        }
      }
      if (Date.now() > deadline) throw new Error('probe plugin did not start');
      await sleep(500);
    }
  }

  editorFrame() {
    return this.page.frames().find((f) => f.name() === 'frameEditor') ?? null;
  }

  async probeState() {
    return this.probe.evaluate(() => JSON.parse(JSON.stringify(window.__probe)));
  }

  /**
   * Runs `fn` (source text of a function using `Api` and `Asc.scope`) through the
   * plugin's callCommand, with `scope` as Asc.scope; resolves to its return value.
   */
  async command(fnSource, scope = {}, { recalc = true } = {}) {
    return this.probe.evaluate(
      ({ src, scope: s, recalc: rc }) =>
        new Promise((resolve) => {
          window.Asc.scope = s;
          const fn = (0, eval)(`(${src})`);
          window.Asc.plugin.callCommand(fn, false, rc, (result) => resolve(result === undefined ? null : result));
        }),
      { src: fnSource, scope, recalc },
    );
  }

  async method(name, args = []) {
    return this.probe.evaluate(
      ({ name: n, args: a }) =>
        new Promise((resolve) => {
          window.Asc.plugin.executeMethod(n, a, (result) => resolve(result === undefined ? null : result));
        }),
      { name, args },
    );
  }

  /** Puts keyboard focus in the document canvas (one click in the page margin area). */
  async focusDocument() {
    const box = await this.page.locator('iframe[name="frameEditor"]').boundingBox();
    await this.page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
    await sleep(300);
  }

  /** Selects the content of the control tagged `tag` (or collapses to its start/end). */
  async selectControl(tag, where = 'all') {
    return this.command(
      `function () {
        var doc = Api.GetDocument();
        var all = doc.GetAllContentControls();
        for (var i = 0; i < all.length; i++) {
          if (all[i].GetTag() === Asc.scope.tag) {
            var range = all[i].GetRange();
            if (Asc.scope.where === 'start') range = range.GetRange(0, 0);
            if (Asc.scope.where === 'end') { var t = range.GetText(); range = range.GetRange(t.length, t.length); }
            range.Select();
            return true;
          }
        }
        return false;
      }`,
      { tag, where },
    );
  }

  /** Selects the first occurrence of `text` in the document. */
  async selectText(text) {
    return this.command(
      `function () {
        var found = Api.GetDocument().Search(Asc.scope.text, true);
        if (!found || !found.length) return false;
        found[0].Select();
        return true;
      }`,
      { text },
    );
  }

  async paragraphTexts() {
    return this.command(
      `function () {
        return Api.GetDocument().GetAllParagraphs().map(function (p) { return p.GetText(); });
      }`,
      {},
      { recalc: false },
    );
  }

  async controlsInEditor() {
    return this.command(
      `function () {
        return Api.GetDocument().GetAllContentControls().map(function (c) {
          return { tag: c.GetTag(), lock: c.GetLock(), text: c.GetRange().GetText() };
        });
      }`,
      {},
      { recalc: false },
    );
  }

  async type(text) {
    await this.page.keyboard.type(text, { delay: 30 });
    await sleep(300);
  }

  async press(key, times = 1) {
    for (let i = 0; i < times; i += 1) {
      await this.page.keyboard.press(key);
      await sleep(80);
    }
    await sleep(300);
  }

  /**
   * Copy or cut the current selection with the editor's own handler: `execCommand` right
   * after a real click (Chrome requires that user activation), capturing what the editor
   * writes. Headless Chrome has no browser accelerators, so Ctrl+C never fires the event.
   */
  async clipboard(action) {
    return this.editorFrame().evaluate((kind) => {
      window.__clip = null;
      window.addEventListener(
        kind,
        (ev) => {
          const data = {};
          for (const t of ev.clipboardData.types) data[t] = ev.clipboardData.getData(t);
          window.__clip = data;
        },
        { once: true },
      );
      const ok = document.execCommand(kind);
      return { ok, types: window.__clip ? Object.keys(window.__clip) : [], target: document.activeElement ? document.activeElement.tagName + (document.activeElement.id ? '#' + document.activeElement.id : '') : 'none' };
    }, action);
  }

  /** Pastes the captured copy at the caret through the plugin method PasteHtml (the editor's own HTML, which carries its internal data). */
  async pasteCaptured() {
    const html = await this.editorFrame().evaluate(() => (window.__clip ? window.__clip['text/html'] ?? null : null));
    if (!html) return false;
    const answer = await this.method('PasteHtml', [html]);
    await sleep(1500);
    return answer !== false;
  }

  /**
   * Selects from the first occurrence of `fromText` through `to`: a control tag (`field:…`)
   * or text. Uses Search + ExpandTo: paragraph character offsets from GetText do not match
   * GetRange positions once content controls are involved.
   */
  async selectFromTo(fromText, to) {
    return this.command(
      `function () {
        var d = Api.GetDocument();
        var a = d.Search(Asc.scope.from, true);
        if (!a || !a.length) return null;
        var b;
        if (Asc.scope.to.indexOf('field:') === 0 || Asc.scope.to.indexOf('block:') === 0) {
          var cc = d.GetAllContentControls().filter(function (c) { return c.GetTag() === Asc.scope.to; })[0];
          b = cc ? cc.GetRange() : null;
        } else {
          var found = d.Search(Asc.scope.to, true);
          b = found && found.length ? found[0] : null;
        }
        if (!b) return null;
        var full = a[0].ExpandTo(b);
        full.Select();
        return full.GetText();
      }`,
      { from: fromText, to },
    );
  }

  async close() {
    await this.page.close().catch(() => undefined);
  }
}

/** DocumentServer's command service, JWT in the body and the header (the documented inbox forms). */
export async function commandService(secret, body) {
  const res = await fetch(`${DS_PUBLIC}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${signJwt({ payload: body }, secret)}` },
    body: JSON.stringify({ ...body, token: signJwt(body, secret) }),
  });
  const text = await res.text();
  try {
    return { http: res.status, ...JSON.parse(text) };
  } catch {
    return { http: res.status, raw: text.slice(0, 200) };
  }
}

/** DocumentServer's conversion service, synchronous. */
export async function convert(secret, body) {
  const res = await fetch(`${DS_PUBLIC}/converter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${signJwt({ payload: body }, secret)}` },
    body: JSON.stringify({ ...body, token: signJwt(body, secret) }),
  });
  const text = await res.text();
  try {
    return { http: res.status, ...JSON.parse(text) };
  } catch {
    return { http: res.status, raw: text.slice(0, 200) };
  }
}
