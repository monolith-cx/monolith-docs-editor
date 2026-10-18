/**
 * Editor configuration per named profile (D13, EDIT-2.3). Pure: no I/O, no clock, no env.
 *
 * `document` and `template` are full editing with the locks enforceable: content-control
 * settings hidden (`modifyContentControl:false`, or a rep could unlock a field), the Protection
 * tab hidden, force-save on, the bridge plugin registered with per-session data, and the plugin
 * marketplace disabled. DocumentServer runs with `PLUGINS_ENABLED=false` (no built-in plugins
 * installed; ADR F5) and its server-side AI off (ADR F4). DocumentServer's About entry and legal
 * notices are never hidden (licence terms 1 and 3, ADR).
 *
 * `legacy-edit` and `legacy-view` are the configurations the pre-profile request shape produced (E1).
 */
import type { SessionPayload } from './session-token.js';

/** The bridge plugin (EDIT-5); its GUID is fixed in source. */
export const BRIDGE_PLUGIN_GUID = 'asc.{6F1C0E5A-2B7D-4E3A-9C1B-5D8E7F2A4B60}';
/** DocumentServer's Plugin Manager (marketplace) — disabled in every profile (ADR F5). */
export const PLUGIN_MANAGER_GUID = 'asc.{AA2EA9B6-9EC2-415F-9762-634EE8D9A95E}';

export interface EditorConfigContext {
  /** Where DocumentServer posts its callbacks (the service, on its internal URL). */
  callbackUrl: string;
  /** The bridge plugin's config.json, served by the service (EDIT-5). */
  bridgePluginConfigUrl: string;
  /**
   * The URL DocumentServer fetches the document from: the service's own source route for a
   * consumer's file (so the service fetches it on a pinned address), or the legacy internal
   * `/api/files/` URL as it is.
   */
  documentUrl: string;
}

const SPREADSHEET = new Set(['xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'fods', 'csv', 'xlst', 'xltx', 'xltm']);
const PRESENTATION = new Set(['ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'ppsm', 'odp', 'fodp', 'pot', 'potx', 'potm']);
const PDF = new Set(['pdf', 'djvu', 'xps']);

function extension(fileName: string): string {
  return (fileName.split('.').pop() ?? '').toLowerCase();
}

export function documentType(fileName: string): 'word' | 'cell' | 'slide' | 'pdf' {
  const ext = extension(fileName);
  if (SPREADSHEET.has(ext)) return 'cell';
  if (PRESENTATION.has(ext)) return 'slide';
  if (PDF.has(ext)) return 'pdf';
  return 'word';
}

export interface EditorConfig {
  document: {
    fileType: string;
    key: string;
    title: string;
    url: string;
    permissions: Record<string, boolean>;
  };
  documentType: string;
  editorConfig: {
    /** Absent for legacy-view, which never set it (E1: the pre-profile configuration, unchanged). */
    mode?: 'edit' | 'view';
    callbackUrl: string;
    user: { id: string; name: string };
    lang: string;
    customization: Record<string, unknown>;
    plugins?: {
      autostart: string[];
      pluginsData: string[];
      options: Record<string, unknown>;
      disable: string[];
    };
  };
}

export function buildEditorConfig(session: SessionPayload, ctx: EditorConfigContext): EditorConfig {
  const base = {
    fileType: extension(session.n) || 'docx',
    key: session.k,
    title: session.n,
    url: ctx.documentUrl,
  };
  const user = { id: session.u.id, name: session.u.name };

  if (session.p === 'document' || session.p === 'template') {
    const panelOrigin = session.pu ? new URL(session.pu).origin : undefined;
    return {
      document: {
        ...base,
        permissions: { edit: true, modifyContentControl: false, protect: false, download: true, print: true, review: true, comment: true },
      },
      documentType: documentType(session.n),
      editorConfig: {
        mode: 'edit',
        callbackUrl: ctx.callbackUrl,
        user,
        lang: 'en',
        customization: { forcesave: true, compactHeader: true },
        plugins: {
          autostart: [BRIDGE_PLUGIN_GUID],
          pluginsData: [ctx.bridgePluginConfigUrl],
          // Per-session plugin data reaches the plugin as Asc.plugin.info.options (battery U2).
          options: { [BRIDGE_PLUGIN_GUID]: { profile: session.p, panelUrl: session.pu ?? null, panelOrigin: panelOrigin ?? null } },
          disable: [PLUGIN_MANAGER_GUID],
        },
      },
    };
  }

  if (session.p === 'view' || session.p === 'legacy-view') {
    const perm = session.perm ?? { download: true, print: true };
    return {
      document: { ...base, permissions: { edit: false, download: perm.download, print: perm.print } },
      documentType: documentType(session.n),
      editorConfig: {
        ...(session.p === 'view' ? { mode: 'view' as const } : {}),
        callbackUrl: ctx.callbackUrl,
        user,
        lang: 'en',
        // View-only: a clean, minimal viewer (the pre-profile view configuration).
        customization: {
          compactHeader: true,
          toolbarHideFileName: true,
          hideRightMenu: true,
          hideLeftMenu: true,
          toolbar: false,
          header: false,
          statusBar: false,
          plugins: false,
        },
      },
    };
  }

  // legacy-edit: the pre-profile editing configuration, unchanged (E1).
  const perm = session.perm ?? { download: true, print: true };
  return {
    document: { ...base, permissions: { edit: true, download: perm.download, print: perm.print } },
    documentType: documentType(session.n),
    editorConfig: {
      mode: 'edit',
      callbackUrl: ctx.callbackUrl,
      user,
      lang: 'en',
      customization: { forcesave: true, compactHeader: true },
    },
  };
}
