import { Storage } from '@google-cloud/storage';
import { config } from './config.js';

const MIME_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  pdf: 'application/pdf',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  csv: 'text/csv',
  rtf: 'application/rtf',
  txt: 'text/plain',
};

function mimeFromPath(path: string): string {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

let storage: Storage | undefined;

function getStorage(): Storage {
  if (!storage) {
    storage = new Storage({
      projectId: config.gcsProjectId || undefined,
    });
  }
  return storage;
}

/**
 * Check whether a URL is already a signed/full HTTP URL or a raw GCS path
 * like "gs://bucket/path/to/file.docx" or just "bucket/path/to/file.docx".
 */
function isSignedUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * Parse a GCS path into bucket and object name.
 * Accepts "gs://bucket/object" or "bucket/object".
 */
function parseGcsPath(path: string): { bucket: string; object: string } {
  const cleaned = path.replace(/^gs:\/\//, '');
  const slashIndex = cleaned.indexOf('/');
  if (slashIndex === -1) {
    throw new Error('Invalid GCS path: expected bucket/object');
  }
  return {
    bucket: cleaned.slice(0, slashIndex),
    object: cleaned.slice(slashIndex + 1),
  };
}

// SSRF protection — reject private/internal IP ranges
const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
];

const PRIVATE_HOSTNAMES = new Set(['localhost', '[::1]']);

// Known Docker-internal hostnames that are safe in dev
const DOCKER_INTERNAL_PATTERNS = ['://onlyoffice', '://api:'];

function validateSourceUrl(url: string, allowHttp: boolean): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid source URL');
  }

  if (!allowHttp && parsed.protocol !== 'https:') {
    throw new Error('Source URL must use HTTPS in production');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname;
  if (PRIVATE_HOSTNAMES.has(hostname.toLowerCase())) {
    throw new Error(`Source URL points to a private/internal address: ${hostname}`);
  }
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new Error(`Source URL points to a private/internal address: ${hostname}`);
    }
  }
}

const MAX_DOWNLOAD_SIZE = 200 * 1024 * 1024; // 200MB
const FETCH_TIMEOUT_MS = 30_000; // 30 seconds

/**
 * If the input is already a signed URL, return it as-is.
 * If it's a GCS path, generate a signed download URL.
 */
export async function resolveDownloadUrl(fileUrl: string): Promise<string> {
  if (isSignedUrl(fileUrl)) {
    return fileUrl;
  }

  const { bucket, object } = parseGcsPath(fileUrl);
  const [url] = await getStorage()
    .bucket(bucket)
    .file(object)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + config.signedUrlTtlMs,
    });

  return url;
}

/**
 * Generate a signed upload URL for a given GCS destination.
 * Used when saving an edited document back to GCS.
 */
export async function generateUploadUrl(
  bucket: string,
  object: string,
): Promise<string> {
  const [url] = await getStorage()
    .bucket(bucket)
    .file(object)
    .getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + config.signedUrlTtlMs,
      contentType: 'application/octet-stream',
    });

  return url;
}

/**
 * Download a file from a URL and upload it to GCS.
 * Used in the save callback to transfer the edited document from OnlyOffice to GCS.
 */
export async function transferToGcs(
  sourceUrl: string,
  destinationBucket: string,
  destinationObject: string,
): Promise<string> {
  const isProduction = config.nodeEnv === 'production';
  const isDev = !isProduction;

  // Skip SSRF check for known Docker-internal hostnames in dev
  const isDockerInternal = DOCKER_INTERNAL_PATTERNS.some(p => sourceUrl.includes(p));
  if (!isDockerInternal) {
    validateSourceUrl(sourceUrl, isDev);
  }

  const res = await fetch(sourceUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download from source: ${res.status} ${res.statusText}`);
  }

  // Check content-length before buffering
  const contentLength = res.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_DOWNLOAD_SIZE) {
    throw new Error(`Source file too large: ${contentLength} bytes (max ${MAX_DOWNLOAD_SIZE})`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());

  if (buffer.length > MAX_DOWNLOAD_SIZE) {
    throw new Error(`Downloaded file too large: ${buffer.length} bytes (max ${MAX_DOWNLOAD_SIZE})`);
  }

  const file = getStorage().bucket(destinationBucket).file(destinationObject);
  await file.save(buffer, {
    contentType: mimeFromPath(destinationObject),
    resumable: false,
  });

  // Return a signed download URL for the consumer
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + config.signedUrlTtlMs,
  });

  return url;
}
