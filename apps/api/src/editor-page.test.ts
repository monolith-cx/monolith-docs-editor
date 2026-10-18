import { describe, expect, it } from 'vitest';
import { renderEditorPage, renderExpiredPage, scriptSafeJson } from './editor-page.js';

describe('editor page (EDIT-2.6)', () => {
  it('renders a hostile title and config inert', () => {
    const page = renderEditorPage({
      dsPublicUrl: 'https://app.example.com',
      title: '</title><script>alert(1)</script>',
      config: { editorConfig: { plugins: { options: { x: '</script><script>alert(2)</script>\u2028' } } } },
      token: 'a.b.c',
    });
    expect(page.html).not.toContain('<script>alert(1)</script>');
    expect(page.html).toContain('&lt;/title&gt;&lt;script&gt;');
    expect(page.html).not.toContain('</script><script>alert(2)');
    expect(page.html).toContain('\\u003c/script\\u003e');
    expect(page.html).not.toContain('\u2028');
  });

  it('carries a strict CSP with a nonce, admitting only DocumentServer for scripts and frames', () => {
    const page = renderEditorPage({ dsPublicUrl: 'https://app.example.com/', title: 't', config: {}, token: 't' });
    const nonce = /'nonce-([^']+)'/.exec(page.csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(page.csp).toContain("default-src 'none'");
    expect(page.csp).toContain(`script-src 'nonce-${nonce}' https://app.example.com`);
    expect(page.csp).toContain('frame-src https://app.example.com');
    expect(page.html.split(`nonce="${nonce}"`).length - 1).toBe(3);
    expect(page.html).toContain('https://app.example.com/web-apps/apps/api/documents/api.js');
  });

  it('expired page links back only when the consumer is known', () => {
    expect(renderExpiredPage('https://crm.example.com').html).toContain('href="https://crm.example.com"');
    expect(renderExpiredPage(undefined).html).not.toContain('href=');
  });

  it('scriptSafeJson escapes the characters that can end a script element or a string', () => {
    expect(scriptSafeJson('<>&\u2028\u2029')).toBe('"\\u003c\\u003e\\u0026\\u2028\\u2029"');
  });
});
