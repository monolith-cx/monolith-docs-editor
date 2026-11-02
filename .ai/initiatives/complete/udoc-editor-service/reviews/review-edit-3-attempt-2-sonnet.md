# Checkpoint review — EDIT-3 — attempt 2 (Sonnet)

Date: 2026-10-18. Reviewer: Sonnet (in-session subagent, fresh context, read-only). It ran the API tests (214/214) and typecheck and lint (clean), plus four probes. Two of them matter below:

- `p2.mjs`: undici copies a `Buffer` request body.
- `p3.mjs`: a stream body uploads at about 1× memory.

**Verdict:** PASS-WITH-NITS. No Critical or High findings.

## Attempt 1

All findings are fixed except these:

- **Sonnet M5 and Codex H2, memory: partial.** The caps, the overall limit, and the no-copy reads are in place, but the stated ceiling was understated (N1 below).
- **Codex H1, the token after its conversion: fixed,** with a narrow race left over (N2 below).
- **The EDIT-2 records** were restored and show no diff against `c7bfa21`.
- **The battery record `-partial-1935`** postdates every source change.

## Leak audit by the reviewer

No leak was found:

- `sourceReads`: synchronous increment, guarded release, release on `finish`, `close`, and `catch`.
- `running` and `runningTotal`: synchronous admission, a single `finally`.
- The poll loop is bounded by the deadline.
- A fresh conversion cannot match a stale token.

## New findings

### Medium

**N1. The memory ceiling was understated in five places.**

- Upload: the fetch body was a `Buffer`, which undici copies, so the PDF was held about three times over.
- Chunked reads: the read joined its parts with `Buffer.concat`, so the file was held twice during the join.

### Low

- **N2.** A conversion that ends during the source route's DNS wait leaves its read unstoppable, because the signal is taken after the await.
- **N3.** Nothing stops a send that is already under way when its conversion ends.
- **N4.** An empty PDF counts as success.
- **N5.** Three doc claims go further than the evidence:
  - the contract's `busy` line;
  - ADR F17's "only until the deadline", while DocumentServer retries the download;
  - the changelog's "retries a 503", which was not measured.

### Nits

- **N6.** `/convert` is not cancelled when the caller hangs up.
- **N7.** The poll loop leaks one abort listener per second.
- **N8.** No test shows that a source slot is released.
- **N9.** The contract has an over-long line, and the guide's error table is out of order.

## Author's resolution (2026-10-18)

- **N1:** no copies or joins anywhere.
  - `readCapped` keeps the parts as received.
  - `partsStream` sends them on as 64 KiB `subarray` views, with the exact `Content-Length`.
  - The upload uses a stream body with `duplex: 'half'`.
  - The ceiling statement in the env examples and the plan now reflects one copy per file.
  - Battery E3a shows the streamed upload carries its length through `safeFetch`'s pinned agent.
- **N2:** the conversion's signal is taken at admission, before any await.
  - A conversion token with no live signal is refused.
  - After DNS, an ended conversion answers 404.
- **N3:** when the conversion's signal aborts while its file is still being sent, `reply.raw` is destroyed.
- **N4:** an empty PDF fails with `conversion_failed` (`result_empty`), and nothing is uploaded (test).
- **N5:**
  - The contract's `busy` line now names all three causes.
  - ADR F17 says the hold can repeat for each download attempt, and that this is not measured for a slow source.
  - The changelog says "observed to retry a failed source download".
- **N6:** a consumer hanging up cancels its conversion. The handler listens for the response's `close` (the request's `close` fires once its body has been read), so the retry is not refused as busy. Tested over a real connection.
- **N7:** the timer removes its abort listener.
- **N8:** the read-limit test now shows the next read is admitted after a hang-up.
- **N9:** the contract line is re-wrapped and the table re-ordered.

Verification:

- 220 tests pass; typecheck and lint are clean.
- Battery `docs/spikes/results/10.0.0.1/2026-10-18-partial-1949`: 10 of 10 pass.
