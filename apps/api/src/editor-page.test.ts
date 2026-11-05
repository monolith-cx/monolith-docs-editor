import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { renderEditorPage, renderExpiredPage, scriptSafeJson } from './editor-page.js';

describe('editor page (EDIT-2.6)', () => {
  it('renders a hostile title and config inert', () => {
    const page = renderEditorPage({
      dsPublicUrl: 'https://app.example.com',
      title: '</title><script>alert(1)</script>',
      config: { editorConfig: { plugins: { options: { x: '</script><script>alert(2)</script>\u2028' } } } },
      token: 'a.b.c',
      frameAncestors: "'none'",
      hostOrigins: [],
    });
    expect(page.html).not.toContain('<script>alert(1)</script>');
    expect(page.html).toContain('&lt;/title&gt;&lt;script&gt;');
    expect(page.html).not.toContain('</script><script>alert(2)');
    expect(page.html).toContain('\\u003c/script\\u003e');
    expect(page.html).not.toContain('\u2028');
  });

  it('carries a strict CSP with a nonce, admitting only DocumentServer for scripts and frames', () => {
    const page = renderEditorPage({ dsPublicUrl: 'https://app.example.com/', title: 't', config: {}, token: 't', frameAncestors: "'self' https://crm.example.com", hostOrigins: ['https://crm.example.com'] });
    const nonce = /'nonce-([^']+)'/.exec(page.csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(page.csp).toContain("default-src 'none'");
    expect(page.csp).toContain(`script-src 'nonce-${nonce}' https://app.example.com`);
    expect(page.csp).toContain('frame-src https://app.example.com');
    expect(page.csp).toContain("frame-ancestors 'self' https://crm.example.com");
    expect(page.html.split(`nonce="${nonce}"`).length - 1).toBe(3);
    expect(page.html).toContain('https://app.example.com/web-apps/apps/api/documents/api.js');
  });

  describe('editing state to the host page (DOC-23)', () => {
    /** Runs the page's inline script against a fake DocsAPI; a framed page gets a parent that records what it is sent. */
    function load(hostOrigins: string[], framed: boolean) {
      const { html } = renderEditorPage({ dsPublicUrl: 'https://app.example.com', title: 't', config: { document: {} }, token: 'a.b.c', frameAncestors: "'none'", hostOrigins });
      const inline = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
      const posted: Array<{ message: unknown; targetOrigin: unknown }> = [];
      const window: { parent?: unknown } = {};
      window.parent = framed ? { postMessage: (message: unknown, targetOrigin: unknown) => posted.push({ message, targetOrigin }) } : window;
      let created: { token?: string; events?: { onDocumentStateChange: (event: { data: unknown }) => void } } | undefined;
      const DocEditor = function (_id: string, cfg: typeof created) {
        created = cfg;
      };
      runInNewContext(inline, { window, DocsAPI: { DocEditor } });
      // The message crosses the vm's realm; JSON gives it this realm's prototypes for toEqual.
      return { created, posted: () => JSON.parse(JSON.stringify(posted)) as typeof posted };
    }

    it('sends the exact message to the registered origin, for both states', () => {
      const { created, posted } = load(['https://crm.example.com'], true);
      expect(created?.token).toBe('a.b.c');
      created?.events?.onDocumentStateChange({ data: true });
      created?.events?.onDocumentStateChange({ data: false });
      expect(posted()).toEqual([
        { message: { type: 'monolith-editor', event: 'state', editing: true }, targetOrigin: 'https://crm.example.com' },
        { message: { type: 'monolith-editor', event: 'state', editing: false }, targetOrigin: 'https://crm.example.com' },
      ]);
    });

    it('targets only registered origins, each by its exact origin and never a wildcard', () => {
      const origins = ['https://panel.example.com', 'https://crm.example.com'];
      const { created, posted } = load(origins, true);
      created?.events?.onDocumentStateChange({ data: true });
      expect(posted().map((p) => p.targetOrigin)).toEqual(origins);
    });

    it('wires nothing and sends nothing when no origin is registered', () => {
      const { created, posted } = load([], true);
      expect(created?.events).toBeUndefined();
      expect(posted()).toEqual([]);
    });

    it('wires nothing and sends nothing when the page is not framed', () => {
      const { created, posted } = load(['https://crm.example.com'], false);
      expect(created?.events).toBeUndefined();
      expect(posted()).toEqual([]);
    });

    it('reports editing as a strict boolean, whatever DocumentServer sends', () => {
      const { created, posted } = load(['https://crm.example.com'], true);
      created?.events?.onDocumentStateChange({ data: 'true' });
      expect(posted()[0]?.message).toEqual({ type: 'monolith-editor', event: 'state', editing: false });
    });

    it('renders a hostile origin list inert', () => {
      const { html } = renderEditorPage({ dsPublicUrl: 'https://app.example.com', title: 't', config: {}, token: 't', frameAncestors: "'none'", hostOrigins: ['</script><script>alert(1)</script>'] });
      expect(html).not.toContain('<script>alert(1)');
    });
  });

  it('expired page links back only when the consumer is known', () => {
    const known = renderExpiredPage('https://crm.example.com', "'self' https://crm.example.com");
    expect(known.html).toContain('href="https://crm.example.com"');
    expect(known.csp).toContain("frame-ancestors 'self' https://crm.example.com");
    const unknown = renderExpiredPage(undefined, "'none'");
    expect(unknown.html).not.toContain('href=');
    expect(unknown.csp).toContain("frame-ancestors 'none'");
  });

  it('scriptSafeJson escapes the characters that can end a script element or a string', () => {
    expect(scriptSafeJson('<>&\u2028\u2029')).toBe('"\\u003c\\u003e\\u0026\\u2028\\u2029"');
  });
});
