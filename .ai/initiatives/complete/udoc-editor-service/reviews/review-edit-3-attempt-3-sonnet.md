# Checkpoint review — EDIT-3 — attempt 3 (Sonnet, narrow verification)

Date: 2026-10-18. Reviewer: Sonnet (in-session subagent, fresh context, read-only). It ran the API tests (220/220), typecheck, and lint (clean). It also ran memory and connection probes (`p/*.mjs` in the scratchpad), including a receiver in a separate process.

**Verdict:** PASS-WITH-NITS. No Critical or High findings. Every finding from attempt 2 is fixed: N1–N9, plus Codex H1, H2, and M1.

## What the probes measured

- **Reading and sending a source:** a 100 MB source read and sent through `partsStream` held 100 MB of distinct ArrayBuffers, and the send added about 8 MB RSS.
- **Tiny-chunk sources are not amplified:** 6 MB arriving in 1-byte chunks retained 5.7 MB.
- **The streamed upload:** with `duplex: 'half'` the receiver got `content-length: 104857600` and no chunked encoding.
- **Stream versus `Buffer`:** the same file sent as a `Buffer` body peaked at about 737 MB RSS, against about 336 MB for the stream.
- **The response's `close` event:** it fires on a client disconnect, and does not fire after a normal response (20 keep-alive responses, 0 spurious).
- **The source route's abort listener:** it does nothing after a normal finish (20 sends, 0 destroys).

## New findings

**N10 (Low).** undici wraps a Node `Readable` request body and copies each 64 KiB chunk. A 100 MB upload peaked at about 215 MB of ArrayBuffers until GC. A web `ReadableStream` that enqueues the same views stayed at 100 MB.

Nits:

- The guide does not state the 95 s maximum.
- An abort can land in the microtask between the end of the read and the listener's registration.
- There is no route-level test for a result longer than declared.
- One contract line is 154 characters, and the guide's error table is not sorted by status.

## Author's resolution (2026-10-18)

- **N10:** the upload body is `partsWebStream(read.parts)`, a web `ReadableStream` whose `pull` enqueues the same views. A unit test asserts `.buffer` identity. `partsStream` stays the reply body (Fastify takes a Node stream).
- **95 s:** stated in the guide's timeout row.
- **The microtask gap:** a conversion signal already aborted at that point answers 404 before the listener is added.
- **The route-level overlong case:** not added. HTTP/1.1 framing makes the receiving client stop at the declared length, so a route test cannot produce the condition. The unit test on `readCapped` (6 bytes against a declared 3) is the evidence.
- **The contract's long line:** wrapped. The guide's table groups the rows by cause, which is intentional.

Verification:

- 220 tests pass; typecheck and lint are clean.
- Battery `docs/spikes/results/10.0.0.1/2026-10-18-partial-2002`: 10 of 10 pass.
