// Shared flows for battery items: save round trips, conversion, and PDF inspection.
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { openDocx } from './docx.mjs';
import { commandService, convert } from './editor.mjs';
import { DS_PUBLIC, STUB_INTERNAL, sleep, stub, waitForEvent } from './stack.mjs';

const exec = promisify(execFile);
let seq = 0;

export const uniqueKey = (prefix) => `${prefix}-${Date.now().toString(36)}-${(seq += 1)}`;

/** Force-saves `key` and returns the saved document (status 6), or null with the command's answer. */
export async function forceSave(secret, key, sinceT = 0) {
  // The editor sends typed changes to the server in batches; error 4 means none have arrived yet.
  let answer = await commandService(secret, { c: 'forcesave', key });
  for (let i = 0; answer.error === 4 && i < 20; i += 1) {
    await sleep(1500);
    answer = await commandService(secret, { c: 'forcesave', key });
  }
  const event = await waitForEvent((e) => e.kind === 'callback' && e.key === key && e.status === 6 && e.saved?.file && e.t > sinceT, 60_000);
  if (!event) return { answer, event: null };
  const buf = await stub(`/saved/${event.saved.file}`);
  return { answer, event, buf, ...(await openDocx(buf)) };
}

/** Closes the page and waits for the final save (status 2) or closed-without-changes (status 4). */
export async function closeAndAwait(editor, key, timeoutMs = 90_000, settleMs = 5000) {
  // Give the editor time to send its last batch of changes before the tab goes away.
  await sleep(settleMs);
  const t = Date.now();
  await editor.close();
  const event = await waitForEvent((e) => e.kind === 'callback' && e.key === key && (e.status === 2 || e.status === 4) && e.t >= t, timeoutMs);
  if (!event || event.status !== 2 || !event.saved?.file) return { event, buf: null };
  const buf = await stub(`/saved/${event.saved.file}`);
  return { event, buf, ...(await openDocx(buf)) };
}

/** Writes `buf` as a fixture DocumentServer can fetch, returning its file name. */
export async function addFixture(work, name, buf) {
  await writeFile(path.join(work, 'fixtures', name), buf);
  return name;
}

/** Converts a fixture to PDF through ConvertService and returns the PDF path and tool output. */
export async function toPdf(secret, work, fixtureName, extra = {}) {
  const key = uniqueKey('conv');
  const answer = await convert(secret, {
    async: false,
    filetype: 'docx',
    outputtype: 'pdf',
    key,
    title: fixtureName,
    url: `${STUB_INTERNAL}/fixtures/${fixtureName}`,
    ...extra,
  });
  if (!answer.fileUrl) return { answer };
  const u = new URL(answer.fileUrl);
  const res = await fetch(new URL(u.pathname + u.search, DS_PUBLIC));
  const pdf = path.join(work, 'saved', `${key}.pdf`);
  await writeFile(pdf, Buffer.from(await res.arrayBuffer()));
  const fonts = (await exec('pdffonts', [pdf])).stdout;
  const text = (await exec('pdftotext', ['-layout', pdf, '-'])).stdout;
  return { answer: { endConvert: answer.endConvert, percent: answer.percent, fileUrlOrigin: u.origin }, pdf, fonts, text };
}

/** Rows of pdffonts output with their `emb` column; every font must be embedded. */
export function fontsEmbedded(pdffontsOut) {
  const lines = pdffontsOut.split('\n');
  const header = lines[0] ?? '';
  const typeAt = header.indexOf('type');
  const embAt = header.indexOf('emb');
  const fonts = lines.slice(2).filter((l) => l.trim()).map((l) => ({ name: l.slice(0, typeAt).trim(), emb: l.slice(embAt, embAt + 3).trim() }));
  return { fonts, allEmbedded: fonts.length > 0 && fonts.every((f) => f.emb === 'yes') };
}

export const squash = (s) => s.replace(/\s+/g, ' ').trim();

export { sleep };
