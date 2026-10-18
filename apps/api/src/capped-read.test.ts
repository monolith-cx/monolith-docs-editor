import { describe, expect, it } from 'vitest';
import { Response } from 'undici';
import { partsStream, partsWebStream, readCapped } from './capped-read.js';

function stream(chunks: Buffer[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(new Uint8Array(chunk));
      c.close();
    },
  });
}
const res = (chunks: Buffer[], headers: Record<string, string> = {}) => new Response(stream(chunks), { headers });

describe('readCapped (EDIT-3, ADR F17)', () => {
  it('keeps the parts as they came, never joined, and checks them against the declared length', async () => {
    const read = await readCapped(res([Buffer.from('abc'), Buffer.from('def')], { 'content-length': '6' }), 100);
    expect(read).toMatchObject({ ok: true, size: 6 });
    if (read.ok) expect(read.parts.map(String)).toEqual(['abc', 'def']);
  });

  it('refuses a body that sends more than it declared, and one that sends less', async () => {
    expect(await readCapped(res([Buffer.from('abcdef')], { 'content-length': '3' }), 100)).toMatchObject({ ok: false, reason: 'cut' });
    expect(await readCapped(res([Buffer.from('ab')], { 'content-length': '3' }), 100)).toMatchObject({ ok: false, reason: 'cut' });
  });

  it('refuses over the cap, by declaration before reading and by count without one', async () => {
    expect(await readCapped(res([Buffer.alloc(10)], { 'content-length': '10' }), 5)).toMatchObject({ ok: false, reason: 'over_cap', bytes: 0 });
    expect(await readCapped(res([Buffer.alloc(3), Buffer.alloc(3)]), 5)).toMatchObject({ ok: false, reason: 'over_cap' });
  });

  it('ignores the length of an encoded answer (fetch decompresses it)', async () => {
    expect(await readCapped(res([Buffer.alloc(8)], { 'content-encoding': 'gzip', 'content-length': '2' }), 100)).toMatchObject({ ok: true, size: 8 });
  });

  it('sends the parts on in slices of at most 64 KiB without copying', async () => {
    const big = Buffer.alloc(150 * 1024, 7);
    const out: Buffer[] = [];
    for await (const chunk of partsStream([big, Buffer.from('z')])) out.push(chunk as Buffer);
    expect(out.map((c) => c.length)).toEqual([65536, 65536, 22528, 1]);
    expect(out[0]?.buffer).toBe(big.buffer);
    const web: Uint8Array[] = [];
    for await (const chunk of partsWebStream([big])) web.push(chunk);
    expect(web.map((c) => c.byteLength)).toEqual([65536, 65536, 22528]);
    expect(web[0]?.buffer).toBe(big.buffer);
  });
});
