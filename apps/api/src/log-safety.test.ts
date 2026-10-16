import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { resetConsumers, setConsumersForTest } from './consumers.js';
import {
  hostOf,
  keyRef,
  LOG_REDACT_PATHS,
  redactRequestPath,
  safeErrorText,
  scrubLogArguments,
  serializeError,
} from './log-safety.js';

/** Any absolute URL that carries a path or a query: the thing no log line may hold. */
const URL_WITH_PATH_OR_QUERY = /[a-z][a-z0-9+.-]*:\/\/[^\s"'\\/?]*[/?][^\s"'\\]*/i;

function captureLogs() {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')));
  return { stream, text: () => chunks.join('') };
}

function expectNoAccessGrantingUrls(raw: string, secrets: string[]) {
  expect(raw.length).toBeGreaterThan(0);
  expect(raw).not.toMatch(URL_WITH_PATH_OR_QUERY);
  for (const secret of secrets) {
    expect(raw).not.toContain(secret);
  }
}

const SIGNED_FILE_URL = 'https://storage.googleapis.com/bucket/contract.docx?X-Goog-Signature=SECRET_FILE_SIG';
const CALLBACK_URL = 'https://api.example.com/hooks/docs?token=SECRET_CALLBACK_TOKEN';

async function openSession(app: ReturnType<typeof buildApp>) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/documents/open',
    payload: {
      fileUrl: SIGNED_FILE_URL,
      callbackUrl: CALLBACK_URL,
      fileName: 'contract.docx',
      user: { id: 'user-1', name: 'Test User' },
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ key: string }>().key;
}

function saveCallback(key: string) {
  return {
    method: 'POST' as const,
    url: '/api/documents/callback',
    payload: {
      key,
      status: 2,
      url: `http://onlyoffice/cache/files/${key}/output.docx/output.docx?md5=SECRET_DS_MD5&expires=1`,
      users: ['user-1'],
    },
  };
}

describe('log output carries no access-granting URL (EDIT-4)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetConsumers();
  });

  it('an open failure logs neither the file reference nor its secret', async () => {
    const logs = captureLogs();
    const app = buildApp({ logStream: logs.stream });

    const res = await app.inject({
      method: 'POST',
      url: '/api/documents/open',
      payload: { fileUrl: 'gs://SECRET_BUCKET_NAME', user: { id: 'user-1', name: 'Test User' } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).not.toContain('SECRET_BUCKET_NAME');
    expect(logs.text()).toContain('Failed to resolve file URL');
    expectNoAccessGrantingUrls(logs.text(), ['SECRET_BUCKET_NAME']);
    await app.close();
  });

  it('a successful save logs no signed URL, callback URL, download URL, or editor key', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const logs = captureLogs();
    const app = buildApp({ logStream: logs.stream });

    const key = await openSession(app);
    const page = await app.inject({ method: 'GET', url: `/editor/${key}?ref=SECRET_QUERY` });
    expect(page.statusCode).toBe(200);
    const saved = await app.inject(saveCallback(key));
    expect(saved.json()).toEqual({ error: 0 });
    expect(fetchMock).toHaveBeenCalledOnce();

    const raw = logs.text();
    expect(raw).toContain('OnlyOffice callback received');
    expect(raw).toContain(`"keyRef":"${keyRef(key)}"`);
    expect(raw).toContain('"path":"/editor/[redacted]"');
    expectNoAccessGrantingUrls(raw, [key, 'SECRET_FILE_SIG', 'SECRET_CALLBACK_TOKEN', 'SECRET_DS_MD5', 'SECRET_QUERY']);
    await app.close();
  });

  it('a consumer callback failure logs only the callback host', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const logs = captureLogs();
    const app = buildApp({ logStream: logs.stream });

    const key = await openSession(app);
    await app.inject(saveCallback(key));

    const raw = logs.text();
    expect(raw).toContain('Consumer callback failed');
    expect(raw).toContain('"callbackHost":"api.example.com"');
    expectNoAccessGrantingUrls(raw, [key, 'SECRET_CALLBACK_TOKEN', 'SECRET_DS_MD5']);
    await app.close();
  });

  it('a consumer callback error whose message carries the URL is scrubbed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED while calling ${CALLBACK_URL}`);
    }));
    const logs = captureLogs();
    const app = buildApp({ logStream: logs.stream });

    const key = await openSession(app);
    await app.inject(saveCallback(key));

    const raw = logs.text();
    expect(raw).toContain('Consumer callback error');
    expect(raw).toContain('connect ECONNREFUSED while calling [url]');
    expectNoAccessGrantingUrls(raw, [key, 'SECRET_CALLBACK_TOKEN']);
    await app.close();
  });

  it('an upload and the file fetch log neither the file id nor the customer file name', async () => {
    const logs = captureLogs();
    const app = buildApp({ logStream: logs.stream });
    const boundary = '----edit4boundary';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="Acme SECRET_FILENAME Contract.docx"',
      'Content-Type: application/octet-stream',
      '',
      'PK\u0003\u0004 test bytes',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(uploaded.statusCode).toBe(200);
    const { id } = uploaded.json<{ id: string }>();
    const fetched = await app.inject({ method: 'GET', url: `/api/files/${id}.docx` });
    expect(fetched.statusCode).toBe(200);

    const raw = logs.text();
    expect(raw).toContain('File uploaded');
    expect(raw).toContain(`"fileRef":"${keyRef(id)}"`);
    expect(raw).toContain('"path":"/api/files/[redacted]"');
    expectNoAccessGrantingUrls(raw, [id, 'SECRET_FILENAME']);
    await app.close();
  });

  it('an auth failure logs a masked path', async () => {
    resetConsumers();
    setConsumersForTest([{ id: 'test-apikey', name: 'Test', auth: { mode: 'api-key', key: 'test-dev-key' } }]);
    const logs = captureLogs();
    const app = buildApp({ logStream: logs.stream });

    const res = await app.inject({ method: 'GET', url: '/api/documents/SECRET_KEY_SEGMENT/download?sig=SECRET_QUERY' });
    expect(res.statusCode).toBe(401);

    const raw = logs.text();
    expect(raw).toContain('Auth failed');
    expect(raw).toContain('"path":"/api/documents/[redacted]"');
    expectNoAccessGrantingUrls(raw, ['SECRET_KEY_SEGMENT', 'SECRET_QUERY']);
    await app.close();
  });

  it('an unhandled error is logged with its URLs scrubbed and its extra fields dropped', async () => {
    const logs = captureLogs();
    const app = buildApp({ logStream: logs.stream });
    app.get('/boom', async () => {
      throw Object.assign(new Error('fetch https://ds.example/cache/x?md5=SECRET_ERR_MSG failed'), {
        config: { url: 'https://ds.example/cache/x?md5=SECRET_ERR_CONFIG' },
      });
    });

    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);

    const raw = logs.text();
    expect(raw).toContain('fetch [url] failed');
    expectNoAccessGrantingUrls(raw, ['SECRET_ERR_MSG', 'SECRET_ERR_CONFIG']);
    await app.close();
  });

  it('format arguments and plain-object members are scrubbed by the logMethod hook', async () => {
    const logs = captureLogs();
    const app = buildApp({ logStream: logs.stream });
    app.log.info('saw %s and %o', 'https://x.example/a?sig=SECRET_FMT_STRING', { u: 'https://x.example/b?sig=SECRET_FMT_OBJECT' });
    app.log.info({ note: 'see https://x.example/c?sig=SECRET_MEMBER' }, 'member');
    expectNoAccessGrantingUrls(logs.text(), ['SECRET_FMT_STRING', 'SECRET_FMT_OBJECT', 'SECRET_MEMBER']);
    await app.close();
  });

  it('pino redacts URL-bearing fields that reach a logger directly', async () => {
    const logs = captureLogs();
    const app = buildApp({ logStream: logs.stream });
    app.log.info(
      { fileUrl: SIGNED_FILE_URL, nested: { downloadUrl: 'https://ds.example/cache/x?md5=SECRET_NESTED' } },
      'direct',
    );
    expectNoAccessGrantingUrls(logs.text(), ['SECRET_FILE_SIG', 'SECRET_NESTED']);
    expect(logs.text()).toContain('"fileUrl":"[redacted]"');
    await app.close();
  });
});

describe('redactRequestPath', () => {
  it('masks capability segments and drops every query string', () => {
    expect(redactRequestPath('/editor/0b0e4c1f-key')).toBe('/editor/[redacted]');
    expect(redactRequestPath('//editor/0b0e4c1f-key')).toBe('/editor/[redacted]');
    expect(redactRequestPath('/Editor/0b0e4c1f-key')).toBe('/Editor/[redacted]');
    expect(redactRequestPath('/api/files/1234.docx')).toBe('/api/files/[redacted]');
    expect(redactRequestPath('/api/documents/abc/download')).toBe('/api/documents/[redacted]');
    expect(redactRequestPath('/plugins/udoc-bridge/s/sealed/config.json')).toBe('/plugins/[redacted]');
    expect(redactRequestPath('/api/documents/callback?token=x')).toBe('/api/documents/callback?[redacted]');
    expect(redactRequestPath('/api/files/upload')).toBe('/api/files/upload');
    expect(redactRequestPath('/health')).toBe('/health');
    expect(redactRequestPath('/single-segment')).toBe('/[redacted]');
    expect(redactRequestPath('/')).toBe('/');
  });
});

describe('helpers', () => {
  it('safeErrorText replaces URLs of any scheme and caps length', () => {
    expect(safeErrorText('failed https://a.example/x?y=1 and gs://b/c')).toBe('failed [url] and [url]');
    expect(safeErrorText('GET storage.googleapis.com/b/o?X-Goog-Signature=abc failed')).toBe('GET [url] failed');
    expect(safeErrorText('file contract.docx rejected')).toBe('file contract.docx rejected');
    expect(safeErrorText('x'.repeat(2000))).toHaveLength(500);
  });

  it('hostOf returns the host or undefined', () => {
    expect(hostOf('https://api.example.com:8443/cb?t=1')).toBe('api.example.com:8443');
    expect(hostOf('bucket/object')).toBeUndefined();
    expect(hostOf('gs://bucket/object')).toBeUndefined();
    expect(hostOf(undefined)).toBeUndefined();
  });

  it('keyRef is stable and does not contain the key', () => {
    expect(keyRef('abc')).toBe(keyRef('abc'));
    expect(keyRef('abc')).not.toContain('abc');
    expect(keyRef('abc')).toHaveLength(12);
  });

  it('serializeError keeps local stack frames and one level of cause', () => {
    const err = new Error('outer', { cause: Object.assign(new Error('connect to https://x.example/a?s=SECRET_CAUSE'), { code: 'ECONNREFUSED' }) });
    err.stack = 'Error: outer\n    at handler (file:///app/dist/routes/documents.js:10:5)\n    at node:internal/process/task_queues:95:5';
    const out = serializeError(err);
    expect(out.stack).toContain('file:///app/dist/routes/documents.js:10:5');
    expect(out.stack).toContain('node:internal/process/task_queues:95:5');
    expect(out.cause).toEqual({ type: 'Error', message: 'connect to [url]', code: 'ECONNREFUSED' });
  });

  it('serializeError scrubs URLs on message continuation lines and non-local frames', () => {
    const err = new Error('first line\nsecond line storage.googleapis.com/b/o?sig=SECRET_LINE2');
    err.stack = [
      'Error: first line',
      'second line storage.googleapis.com/b/o?sig=SECRET_LINE2',
      '    at a (File://host/p?tok=SECRET_UPPER_FILE)',
      '    at b (file://host/p?tok=SECRET_TWO_SLASH)',
      `    at c (https://x.example/${'A'.repeat(5000)}?sig=SECRET_LONG_TAIL)`,
      '    at d (file:///app/dist/server.js:1:1)',
    ].join('\n');
    const out = serializeError(err);
    for (const secret of ['SECRET_LINE2', 'SECRET_UPPER_FILE', 'SECRET_TWO_SLASH', 'SECRET_LONG_TAIL', 'AAAAAAAAAA']) {
      expect(out.stack).not.toContain(secret);
    }
    expect(out.stack).toContain('file:///app/dist/server.js:1:1');
  });

  it('scrubbing stays fast on long adversarial input', () => {
    const shapes = ['a.'.repeat(50_000), 'a-'.repeat(50_000), 'a'.repeat(100_000), 'a:'.repeat(50_000), '/'.repeat(100_000), 'http://'.repeat(15_000)];
    const started = performance.now();
    for (const hostile of shapes) {
      safeErrorText(hostile);
      serializeError(Object.assign(new Error(hostile), { stack: `Error: ${hostile}\n${`    at x (${hostile.slice(0, 200)}:1:1)\n`.repeat(500)}` }));
      scrubLogArguments([hostile, { field: hostile }]);
    }
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('serializeError keeps type and codes, scrubs text, drops other fields', () => {
    const err = Object.assign(new Error('see https://x.example/a?s=1'), { code: 'ECONNREFUSED', config: { url: 'https://x.example/a' } });
    const out = serializeError(err);
    expect(out.message).toBe('see [url]');
    expect(out.code).toBe('ECONNREFUSED');
    expect(out).not.toHaveProperty('config');
    expect(out.stack).not.toContain('https://');
  });

  it('redaction paths cover each URL field at the top level and one level down', () => {
    expect(LOG_REDACT_PATHS).toEqual(expect.arrayContaining(['fileUrl', '*.fileUrl', 'downloadUrl', '*.downloadUrl', 'callbackUrl']));
  });
});
