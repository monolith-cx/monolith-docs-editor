# EDIT-3 checkpoint review — attempt 2 (Codex)

- Date: 2026-10-18. Reviewer: codex (gpt-5.6-luna), `ai-review --uncommitted --no-artifact`.

- **Verdict:** FAIL

- **Critical issues:** None.

- **High issues**

  - **H1 — Memory ceiling is still overstated.** For chunked responses without `Content-Length`, `readCapped()` retains all chunk views and then allocates a second full buffer via `Buffer.concat()`. During concatenation, both copies can coexist, so the documented `(sourceConcurrency + convertConcurrencyTotal) × 100 MB = 800 MB` ceiling is not true.  
    Fix `apps/api/src/capped-read.ts:31-52` to avoid the second full allocation, or revise the configured capacity/documented host sizing to account for the peak. Add a concurrent chunked-response memory-bound test.

  - **H2 — Missing regression coverage for overlong declared output.** The new integrity check for `size > declared` at `apps/api/src/capped-read.ts:39-42` is untested. The conversion tests cover a short result and gzip, but not a response that sends more bytes than its declared `Content-Length`. This is a required failure path because it protects against uploading malformed output.  
    Add a test asserting `conversion_failed` and zero upload bytes for an overlong declared result.

- **Medium issues**

  - **M1 — Conversion timeout is not bounded above.** `EDITOR_CONVERT_TIMEOUT_MS` is only checked for positivity at `apps/api/src/config.ts:161-164`; an operator can configure it above Cloudflare’s stated 100-second proxy limit despite the code and guide promising a 90-second deadline.  
    Either enforce a maximum below 100 seconds or document that hosted deployments must not override the default.

- **Nits:** None material.

- **Doc-sync recommendations**

  - Correct the memory-ceiling statement in `.ai/initiatives/active/udoc-editor-service/plan.md:202`, `docs/adr/2026-10-17-onlyoffice-release-and-licence.md` F17, and the environment examples after fixing or recalculating the peak.
  - Add the overlong-result behavior to the EDIT-3 test/evidence notes.

Prior findings: H1 conversion-token reuse is fixed (`routes/documents.ts:351-356`, regression test at `documents.test.ts:424-435`); M1 local-mode documentation and M2 pre-upload validation are fixed. Typecheck and lint pass.

## Author's resolution (2026-10-18)

- **H1:** `readCapped` keeps the parts as received and never joins them; the source route and the upload send them as 64 KiB views (`partsStream`) with the exact length, so each file is held once (also Sonnet's finding that fetch copies a `Buffer` body). Battery E3a shows the streamed upload carries its `Content-Length` through the pinned agent.
- **H2:** `capped-read.test.ts` covers a body longer than declared, shorter than declared, over the cap by declaration and by count, an encoded answer's length ignored, and slicing without copies.
- **M1:** `EDITOR_CONVERT_TIMEOUT_MS` above 95 s is refused at start (test).
