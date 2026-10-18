/**
 * Reads an HTTP response body whole into memory under a cap (EDIT-3, ADR F17). Used where a file
 * must be complete before anything is done with it: the source route (DocumentServer only ever gets
 * a complete file) and a conversion's PDF (the consumer's upload only ever gets a complete file).
 *
 * The file is held once: the body's chunks are kept as they arrive (never copied, never joined),
 * and `partsStream` sends them on as they are. A response that sends more than it declared is
 * refused like one that sends less.
 */
import { Readable } from 'node:stream';
import type { Response as UndiciResponse } from 'undici';

export type CappedRead =
  | { ok: true; parts: Buffer[]; size: number }
  | { ok: false; reason: 'over_cap' | 'cut' | 'aborted'; bytes: number; declared: number | null };

/**
 * The length an answer declares, only when it is uncompressed: fetch decompresses an encoded body,
 * so its `Content-Length` would count other bytes than the ones read.
 */
export function declaredLength(res: UndiciResponse): number | null {
  const encoding = (res.headers.get('content-encoding') ?? 'identity').trim().toLowerCase();
  if (encoding !== 'identity') return null;
  const raw = Number(res.headers.get('content-length') ?? NaN);
  return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}

export async function readCapped(res: UndiciResponse, cap: number): Promise<CappedRead> {
  const declared = declaredLength(res);
  const body = res.body;
  if (!body) return declared === 0 || declared === null ? { ok: true, parts: [], size: 0 } : { ok: false, reason: 'cut', bytes: 0, declared };
  if (declared !== null && declared > cap) {
    await body.cancel().catch(() => undefined);
    return { ok: false, reason: 'over_cap', bytes: 0, declared };
  }
  const parts: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of body) {
      const next = size + chunk.byteLength;
      if (next > cap || (declared !== null && next > declared)) {
        await body.cancel().catch(() => undefined);
        return { ok: false, reason: next > cap ? 'over_cap' : 'cut', bytes: next, declared };
      }
      parts.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      size = next;
    }
  } catch {
    return { ok: false, reason: 'aborted', bytes: size, declared };
  }
  if (declared !== null && size !== declared) return { ok: false, reason: 'cut', bytes: size, declared };
  return { ok: true, parts, size };
}

const SLICE = 64 * 1024;

function* slices(parts: readonly Buffer[]): Generator<Buffer> {
  for (const part of parts) {
    for (let at = 0; at < part.length; at += SLICE) yield part.subarray(at, Math.min(at + SLICE, part.length));
  }
}

/** The parts as a Node stream (a reply body), in slices of at most 64 KiB, without copying them. */
export function partsStream(parts: readonly Buffer[]): Readable {
  return Readable.from(slices(parts));
}

/**
 * The parts as a web stream (a fetch request body): undici copies every chunk of a Node stream body
 * into a new Uint8Array, a web stream's chunks it sends as they are (EDIT-3 review attempt 3).
 */
export function partsWebStream(parts: readonly Buffer[]): ReadableStream<Uint8Array> {
  const it = slices(parts);
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = it.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
  });
}
