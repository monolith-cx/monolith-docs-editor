# Checkpoint review — EDIT-3 — attempt 1 (Sonnet)

Date: 2026-10-18. Reviewer: Sonnet (in-session subagent, fresh context, read-only). It ran the API tests (205/205), typecheck, and lint, and two undici probes: abort of a trickling source, and a result body after a failed upload.

**Verdict:** PASS-WITH-NITS. No Critical or High findings. The core design holds.

Checked and sound:

- the whole-file source read and its aborts;
- the `sourceReads` counter;
- the gzip handling on the source read;
- the converter `fileUrl` origin check;
- the re-check at fetch time;
- the pinned upload without redirects;
- the size and sha256, taken over exactly the bytes sent;
- logs that carry hosts and codes only;
- token scoping in code;
- the contract's §5 and §3.4.

## Medium

- **M1.** The `running` counter leaked when the key failed to build (`buildKey` sits after the increment and outside `try`/`finally`). An over-long consumer id leaves that consumer `busy` forever.
- **M2.** The plan said "Met", but the evidence was weaker for three cases:
  - the metadata case was refused as `host_not_allowed`, not as metadata;
  - there were no strict-mode conversion tests;
  - token scoping was untested because the test consumers' host lists were identical.
- **M3.** DocumentServer's result stream was not cancelled when the upload failed. It stayed open until the deadline, up to 120 s.
- **M4.** A gzip-encoded DocumentServer result was mishandled: no `identity`, and the declared length was trusted.
- **M5.** Memory was bounded more loosely than documented:
  - chunks were copied;
  - concurrency was per consumer only, and the output cap had no bound;
  - the source slot was released before the response flushed;
  - the ceiling was not recorded.
- **M6.** The 120 s conversion deadline exceeds Cloudflare's 100 s proxy read timeout. This is reasoned, not measured.
- **M7.** Evidence and doc sync:
  - six committed EDIT-2 records were deleted from the worktree;
  - the handoff and the EDIT-2.2 status were stale;
  - the plan, registry, and handoff states were pending.

## Nits

- Timeouts were classified as other errors.
- The source route's `busy` mapped to `source_unavailable`.
- Setup ran outside `try`, and a hang-up during DNS was missed.
- Abort reasons were all logged as `timeout`.
- Tests were missing for:
  - the source timeout;
  - a result that dies part way, and a gzip result;
  - the new config variables;
  - convert-route logging.
- Docs:
  - the 503 was missing from the route comment;
  - the guide changelog lacked the source-route change;
  - `CLAUDE.md` did not list `source-outcomes.ts`;
  - the contract had an over-long line.
- `safe-url`: the metadata names were redundant in `LOCAL_NAMES`, and the scope under `local` needed a comment.
- `endConvert:false` was not re-polled.

## Author's resolution (2026-10-18)

### M1

- The key is built before admission, so nothing needs undoing.
- Test: a 90-character consumer id fails three times and is never `busy`.

### M2

- The metadata check runs before the allowlist.
- Tests:
  - "refuses a metadata source even when the consumer lists its address";
  - strict-mode conversion refusals in `strict-routes.test.ts` (http and private, for both the source and the upload);
  - token scoping in both directions, with differing host lists.

### M3

- Every exit aborts one controller shared by the source read, the result read, and the upload.
- The result is read whole before the upload, so nothing remains open after a failed upload.

### M4

- The result fetch asks for `identity`, and a length is trusted only for an uncompressed answer (`capped-read.ts`).
- Test: a gzip result arrives whole.

### M5

- Chunks are not copied: views, or one preallocated buffer.
- `EDITOR_CONVERT_CONCURRENCY_TOTAL` (4) limits conversions overall.
- Both caps are at most 100 MB, checked at start.
- The source slot is released on the response's `finish` or `close`.
- The ceiling formula is in the env examples, the plan, and EDIT-6. EDIT-6 also adds a container memory limit.

### M6

- The deadline defaults to 90 s.

### M7

- The six records were restored byte-identical from `c7bfa21`; a cleanup glob had removed them.
- The EDIT-2.2 status and the handoff carry "superseded at EDIT-3" notes.
- The doc sync follows this review.

### Nits

- Timeouts and aborts map to `conversion_timeout`.
- A `busy` outcome from the source route maps to `busy`.
- The source route checks `reply.raw.destroyed` after DNS and logs the reasons `hung_up`, `conversion_ended`, or `timeout`.
- Tests added:
  - the source timeout;
  - a result short of its length, and a gzip result;
  - config bounds and defaults;
  - convert-route logging.
- Docs: the route comment, the guide changelog, `CLAUDE.md`, and the contract line are updated.
- `safe-url`: the redundant names are removed, and the comment states the scope under `local`.
- "Not finished" is re-polled each second until the deadline, with a test.

### Verification

- 214 tests pass; typecheck and lint are clean.
- The service battery items re-ran on this code.
