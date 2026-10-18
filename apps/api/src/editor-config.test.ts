import { describe, expect, it } from 'vitest';
import { BRIDGE_PLUGIN_GUID, PLUGIN_MANAGER_GUID, buildEditorConfig } from './editor-config.js';
import type { SessionPayload } from './session-token.js';

const ctx = { callbackUrl: 'http://api:3020/api/documents/callback', bridgePluginConfigUrl: 'https://editor.example.com/plugins/udoc-bridge/config.json', documentUrl: 'http://api:3020/api/documents/source/tok' };
const session = (p: SessionPayload['p'], over: Partial<SessionPayload> = {}): SessionPayload => ({
  p, c: 'crm', k: 'crm.d1.e1', u: { id: 'u1', name: 'Rep' }, f: 'https://files.example.com/a.docx', n: 'Contract.docx', exp: 1, ...over,
});

describe('buildEditorConfig per profile (D13)', () => {
  for (const profile of ['document', 'template'] as const) {
    it(`${profile}: editable, locks enforceable, bridge plugin with session data, marketplace disabled`, () => {
      const cfg = buildEditorConfig(session(profile, { pu: 'https://crm.example.com/panel#token=abc' }), ctx);
      expect(cfg.document.permissions).toMatchObject({ edit: true, modifyContentControl: false, protect: false });
      expect(cfg.editorConfig.mode).toBe('edit');
      expect(cfg.document.url).toBe(ctx.documentUrl);
      expect(cfg.editorConfig.customization).toMatchObject({ forcesave: true });
      expect(cfg.editorConfig.customization).not.toHaveProperty('about');
      expect(cfg.editorConfig.plugins).toEqual({
        autostart: [BRIDGE_PLUGIN_GUID],
        pluginsData: [ctx.bridgePluginConfigUrl],
        options: { [BRIDGE_PLUGIN_GUID]: { profile, panelUrl: 'https://crm.example.com/panel#token=abc', panelOrigin: 'https://crm.example.com' } },
        disable: [PLUGIN_MANAGER_GUID],
      });
      expect(cfg.editorConfig.callbackUrl).toBe(ctx.callbackUrl);
    });
  }

  it('view: read-only viewer, no plugins', () => {
    const cfg = buildEditorConfig(session('view', { k: 'crm.d1.v1' }), ctx);
    expect(cfg.document.permissions).toMatchObject({ edit: false });
    expect(cfg.editorConfig.mode).toBe('view');
    expect(cfg.editorConfig.customization).toMatchObject({ plugins: false });
    expect(cfg.editorConfig.plugins).toBeUndefined();
  });

  it('legacy-view and legacy-edit reproduce the pre-profile configurations (E1)', () => {
    const view = buildEditorConfig(session('legacy-view', { perm: { download: true, print: false } }), ctx);
    expect(view.editorConfig).not.toHaveProperty('mode');
    expect(view.document.permissions).toEqual({ edit: false, download: true, print: false });
    const edit = buildEditorConfig(session('legacy-edit', { perm: { download: true, print: true } }), ctx);
    expect(edit.document.permissions).toEqual({ edit: true, download: true, print: true });
    expect(edit.editorConfig.customization).toEqual({ forcesave: true, compactHeader: true });
    expect(edit.editorConfig.plugins).toBeUndefined();
  });

  it('derives the document type from the file name', () => {
    expect(buildEditorConfig(session('view', { n: 'book.xlsx' }), ctx).documentType).toBe('cell');
    expect(buildEditorConfig(session('view', { n: 'deck.pptx' }), ctx).documentType).toBe('slide');
  });
});
