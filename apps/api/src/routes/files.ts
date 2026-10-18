import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { writeFile, mkdir, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { keyRef } from '../log-safety.js';

const ALLOWED_EXTENSIONS = new Set([
  // Word processing
  '.docx', '.doc', '.odt', '.rtf', '.txt', '.html', '.htm', '.mht', '.epub', '.fb2',
  // Spreadsheets
  '.xlsx', '.xls', '.ods', '.csv',
  // Presentations
  '.pptx', '.ppt', '.odp',
  // PDF
  '.pdf',
]);

const MIME_TYPES: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pdf': 'application/pdf',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.csv': 'text/csv',
  '.rtf': 'application/rtf',
  '.txt': 'text/plain',
};

// Temp upload directory — cleaned up after TTL expires
const UPLOAD_DIR = config.uploadDir;
const UPLOAD_TTL_MS = config.uploadTtlMs;

// Track uploads for cleanup
const uploads = new Map<string, { path: string; createdAt: number }>();

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  await mkdir(UPLOAD_DIR, { recursive: true });

  // Periodic cleanup of expired uploads
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, upload] of uploads) {
      if (now - upload.createdAt > UPLOAD_TTL_MS) {
        unlink(upload.path).catch(() => {});
        uploads.delete(id);
      }
    }
  }, 60 * 60 * 1000); // Check every hour

  app.addHook('onClose', () => clearInterval(cleanupInterval));

  app.post('/api/files/upload', async (req, reply) => {
    const file = await req.file();
    if (!file) {
      return reply.status(400).send({ error: 'No file provided' });
    }

    const ext = path.extname(file.filename).toLowerCase() || '.docx';

    // Validate file type
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      req.log.warn({ ext }, 'File upload rejected: unsupported file type');
      return reply.status(400).send({
        error: `File type '${ext}' is not supported. Allowed types: ${[...ALLOWED_EXTENSIONS].join(', ')}`,
      });
    }

    const id = randomUUID();
    const filename = `${id}${ext}`;
    const filePath = path.join(UPLOAD_DIR, filename);

    const buffer = await file.toBuffer();
    await writeFile(filePath, buffer);

    uploads.set(id, { path: filePath, createdAt: Date.now() });

    // Return a fileUrl that OnlyOffice can reach (internal API URL)
    const fileUrl = `${config.apiInternalUrl}/api/files/${id}${ext}`;
    const publicUrl = `${config.apiPublicUrl}/api/files/${id}${ext}`;

    req.log.info({ fileRef: keyRef(id), ext, size: buffer.length }, 'File uploaded');

    return reply.send({ id, fileUrl, publicUrl, filename: file.filename });
  });

  // Serve uploaded files (OnlyOffice downloads from here)
  app.get<{ Params: { filename: string } }>('/api/files/:filename', async (req, reply) => {
    const { filename } = req.params;
    const id = path.basename(filename, path.extname(filename));
    const upload = uploads.get(id);

    if (!upload) {
      return reply.status(404).send({ error: 'File not found or expired' });
    }

    const stream = createReadStream(upload.path);
    const fileStat = await stat(upload.path);
    return reply
      .header('Content-Type', MIME_TYPES[path.extname(filename).toLowerCase()] ?? 'application/octet-stream')
      .header('Content-Length', fileStat.size)
      .send(stream);
  });
}
