import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { resolveDownloadUrl, transferToGcs } from '../storage.js';
import { validateCallbackDomain } from '../consumers.js';
import { hostOf, keyRef, safeErrorText } from '../log-safety.js';

interface OpenRequestBody {
  fileUrl: string;
  /** Optional — if omitted, standalone mode: user downloads the edited file directly */
  callbackUrl?: string;
  fileName?: string;
  user: {
    id: string;
    name: string;
  };
  permissions?: {
    edit?: boolean;
    download?: boolean;
    print?: boolean;
  };
  /** Optional: GCS bucket + path where the saved document should be written back */
  saveTo?: {
    bucket: string;
    object: string;
  };
}

const openSchema = {
  body: {
    type: 'object',
    required: ['fileUrl', 'user'],
    properties: {
      fileUrl: { type: 'string', minLength: 1, maxLength: 2048 },
      callbackUrl: { type: 'string', maxLength: 2048 },
      fileName: { type: 'string', maxLength: 255 },
      user: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 128 },
          name: { type: 'string', minLength: 1, maxLength: 256 },
        },
        additionalProperties: false,
      },
      permissions: {
        type: 'object',
        properties: {
          edit: { type: 'boolean' },
          download: { type: 'boolean' },
          print: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      saveTo: {
        type: 'object',
        required: ['bucket', 'object'],
        properties: {
          bucket: { type: 'string', minLength: 1, maxLength: 255 },
          object: { type: 'string', minLength: 1, maxLength: 1024 },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
} as const;

const callbackSchema = {
  body: {
    type: 'object',
    required: ['key', 'status'],
    properties: {
      key: { type: 'string' },
      status: { type: 'number' },
      url: { type: 'string' },
      users: { type: 'array', items: { type: 'string' } },
      token: { type: 'string' },
    },
  },
} as const;

// In-memory session store
const sessions = new Map<string, {
  key: string;
  consumerId?: string;
  fileUrl: string;
  resolvedFileUrl: string;
  callbackUrl?: string;
  fileName: string;
  user: { id: string; name: string };
  permissions: { edit: boolean; download: boolean; print: boolean };
  saveTo?: { bucket: string; object: string };
  lastSavedUrl?: string;
  createdAt: number;
  lastActivityAt: number;
}>();

export async function documentRoutes(app: FastifyInstance): Promise<void> {

  // Session cleanup — remove expired sessions
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, session] of sessions) {
      if (now - session.lastActivityAt > config.sessionTtlMs) {
        sessions.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      app.log.info({ cleaned, remaining: sessions.size }, 'Expired sessions cleaned up');
    }
  }, config.sessionCleanupIntervalMs);

  app.addHook('onClose', () => clearInterval(cleanupInterval));

  // --- Document Open ---
  app.post<{ Body: OpenRequestBody }>('/api/documents/open', { schema: openSchema }, async (req, reply) => {
    const { fileUrl, callbackUrl, fileName, user, permissions, saveTo } = req.body;

    // Validate callback domain against consumer's allowed list
    if (callbackUrl && req.consumer) {
      const domainError = validateCallbackDomain(
        req.consumer,
        callbackUrl,
        config.nodeEnv === 'production',
      );
      if (domainError) {
        return reply.status(400).send({ error: domainError });
      }
    }

    const key = crypto.randomUUID();
    const resolvedFileName = fileName ?? inferFileName(fileUrl);
    const resolvedPermissions = {
      edit: permissions?.edit ?? true,
      download: permissions?.download ?? true,
      print: permissions?.print ?? true,
    };

    // Resolve GCS paths to signed URLs if needed
    let resolvedFileUrl: string;
    try {
      resolvedFileUrl = await resolveDownloadUrl(fileUrl);
    } catch (err: unknown) {
      const message = safeErrorText(err instanceof Error ? err.message : 'unknown error');
      req.log.error({ fileHost: hostOf(fileUrl), error: message }, 'Failed to resolve file URL');
      return reply.status(400).send({ error: `Failed to resolve file URL: ${message}` });
    }

    const now = Date.now();
    sessions.set(key, {
      key,
      consumerId: req.consumerId,
      fileUrl,
      resolvedFileUrl,
      callbackUrl,
      fileName: resolvedFileName,
      user,
      permissions: resolvedPermissions,
      saveTo,
      createdAt: now,
      lastActivityAt: now,
    });

    req.log.info({ keyRef: keyRef(key), consumerId: req.consumerId, userId: user.id }, 'Document session created');

    const editorUrl = `${config.apiPublicUrl}/editor/${key}`;

    return reply.send({ editorUrl, key });
  });

  // --- Editor Page ---
  app.get<{ Params: { key: string } }>('/editor/:key', async (req, reply) => {
    const session = sessions.get(req.params.key);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found or expired' });
    }

    const editorConfig = buildEditorConfig(session);
    const signedToken = jwt.sign(editorConfig, config.onlyofficeJwtSecret);

    const html = renderEditorPage({
      apiUrl: config.onlyofficePublicUrl,
      config: editorConfig,
      token: signedToken,
    });

    return reply.type('text/html').send(html);
  });

  // --- OnlyOffice Callback ---
  app.post<{ Body: OnlyOfficeCallback }>('/api/documents/callback', { schema: callbackSchema }, async (req, reply) => {
    // Verify OnlyOffice callback JWT when JWT is enabled with a real secret
    const isWeakSecret = !config.onlyofficeJwtSecret || config.onlyofficeJwtSecret === 'secret';
    const callbackToken = req.body.token;
    if (!isWeakSecret) {
      if (!callbackToken) {
        req.log.warn('OnlyOffice callback missing JWT token');
        return reply.status(403).send({ error: 'Missing callback token' });
      }
      try {
        jwt.verify(callbackToken, config.onlyofficeJwtSecret);
      } catch (err: unknown) {
        const message = safeErrorText(err instanceof Error ? err.message : 'unknown');
        req.log.warn({ error: message }, 'OnlyOffice callback JWT verification failed');
        return reply.status(403).send({ error: 'Invalid callback token' });
      }
    }

    const { key, status, url, users } = req.body;
    req.log.info({ keyRef: keyRef(key), status, downloadHost: hostOf(url), userCount: users?.length ?? 0 }, 'OnlyOffice callback received');

    // Status codes: https://api.onlyoffice.com/editors/callback
    // 1 = editing, 2 = ready to save, 4 = closed no changes, 6 = force save
    if ((status === 2 || status === 6) && url) {
      const session = sessions.get(key);
      if (!session) {
        req.log.warn({ keyRef: keyRef(key) }, 'Callback for unknown session');
        return reply.send({ error: 0 });
      }

      session.lastActivityAt = Date.now();

      let downloadUrl = url;

      // If saveTo was specified, transfer the file from OnlyOffice to GCS
      if (session.saveTo) {
        try {
          downloadUrl = await transferToGcs(
            url,
            session.saveTo.bucket,
            session.saveTo.object,
          );
          req.log.info({ keyRef: keyRef(key), bucket: session.saveTo.bucket }, 'Document saved to GCS');
        } catch (err: unknown) {
          const message = safeErrorText(err instanceof Error ? err.message : 'unknown error');
          req.log.error({ keyRef: keyRef(key), error: message }, 'Failed to transfer document to GCS');
          // Fall through — still notify consumer with the OnlyOffice download URL
        }
      }

      // Store the latest download URL for standalone mode
      session.lastSavedUrl = downloadUrl;

      // Notify consumer if callbackUrl was provided
      if (session.callbackUrl) {
        try {
          const callbackRes = await fetch(session.callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: status === 2 ? 'saved' : 'force-saved',
              downloadUrl,
              key,
              users,
            }),
          });

          if (!callbackRes.ok) {
            req.log.error({ keyRef: keyRef(key), callbackHost: hostOf(session.callbackUrl), status: callbackRes.status }, 'Consumer callback failed');
          }
        } catch (err: unknown) {
          const message = safeErrorText(err instanceof Error ? err.message : 'unknown error');
          req.log.error({ keyRef: keyRef(key), callbackHost: hostOf(session.callbackUrl), error: message }, 'Consumer callback error');
        }
      }

      // Clean up closed sessions (but not standalone — user may still need to download)
      if (status === 2 && session.callbackUrl) {
        sessions.delete(key);
      }
    }

    if (status === 4) {
      sessions.delete(key);
    }

    // OnlyOffice expects { "error": 0 } to acknowledge
    return reply.send({ error: 0 });
  });

  // --- Download endpoint for standalone mode ---
  app.get<{ Params: { key: string } }>('/api/documents/:key/download', async (req, reply) => {
    const session = sessions.get(req.params.key);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found or expired' });
    }
    if (!session.lastSavedUrl) {
      return reply.status(404).send({ error: 'No saved version available yet — save the document first' });
    }
    return reply.send({ downloadUrl: session.lastSavedUrl, fileName: session.fileName });
  });

  // --- Active Sessions (admin, scoped to consumer) ---
  app.get('/api/sessions', async (req, reply) => {
    let sessionList = Array.from(sessions.values());

    // Scope to requesting consumer when identified
    if (req.consumerId) {
      sessionList = sessionList.filter(s => s.consumerId === req.consumerId);
    }

    const list = sessionList.map(s => ({
      key: s.key,
      fileName: s.fileName,
      user: s.user,
      createdAt: new Date(s.createdAt).toISOString(),
      lastActivityAt: new Date(s.lastActivityAt).toISOString(),
    }));
    return reply.send({ sessions: list });
  });
}

// --- Types ---

interface OnlyOfficeCallback {
  key: string;
  status: number;
  url?: string;
  users?: string[];
  token?: string;
}

// --- Helpers ---

function buildEditorConfig(session: {
  key: string;
  resolvedFileUrl: string;
  fileName: string;
  user: { id: string; name: string };
  permissions: { edit: boolean; download: boolean; print: boolean };
}) {
  return {
    document: {
      fileType: session.fileName.split('.').pop() ?? 'docx',
      key: session.key,
      title: session.fileName,
      url: session.resolvedFileUrl,
      permissions: {
        edit: session.permissions.edit,
        download: session.permissions.download,
        print: session.permissions.print,
      },
    },
    editorConfig: {
      callbackUrl: `${config.apiInternalUrl}/api/documents/callback`,
      user: {
        id: session.user.id,
        name: session.user.name,
      },
      lang: 'en',
      customization: session.permissions.edit
        ? {
            forcesave: true,
            compactHeader: true,
          }
        : {
            // View-only mode: strip UI to a clean, minimal viewer
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
    documentType: getDocumentType(session.fileName),
  };
}

/** Extract filename from URL, falling back to document.docx */
function inferFileName(fileUrl: string): string {
  try {
    const pathname = new URL(fileUrl).pathname;
    const basename = pathname.split('/').pop();
    if (basename && basename.includes('.')) return basename;
  } catch { /* not a valid URL */ }
  return 'document.docx';
}

/** Map file extension to OnlyOffice documentType */
function getDocumentType(fileName: string): 'word' | 'cell' | 'slide' | 'pdf' {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();

  const spreadsheetExts = new Set([
    'xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'fods', 'csv', 'xlst', 'xltx', 'xltm',
  ]);
  const presentationExts = new Set([
    'ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'ppsm', 'odp', 'fodp', 'pot', 'potx', 'potm',
  ]);
  const pdfExts = new Set(['pdf', 'djvu', 'xps']);

  if (spreadsheetExts.has(ext)) return 'cell';
  if (presentationExts.has(ext)) return 'slide';
  if (pdfExts.has(ext)) return 'pdf';
  return 'word';
}

function renderEditorPage(opts: {
  apiUrl: string;
  config: ReturnType<typeof buildEditorConfig>;
  token: string;
}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${opts.config.document.title} — Monolith Docs</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #editor { width: 100%; height: 100%; overflow: hidden; }
  </style>
</head>
<body>
  <div id="editor"></div>
  <script src="${opts.apiUrl}/web-apps/apps/api/documents/api.js"></script>
  <script>
    new DocsAPI.DocEditor("editor", {
      ...${JSON.stringify(opts.config)},
      token: "${opts.token}"
    });
  </script>
</body>
</html>`;
}
