# EDIT-3 checkpoint review — attempt 1 (Codex)

- Date: 2026-10-18
- Reviewer: codex (gpt-5.6-luna) via `ai-review --provider codex --uncommitted --no-artifact`. The plan asks for a single Sonnet reviewer at EDIT-3; Codex was added because this checkpoint also reworked EDIT-2's source route (a security surface E8 reviews with two).

- **Verdict:** FAIL

- **Critical issues**

  None.

- **High issues**

  - **Conversion source tokens remain usable after conversion completion, enabling post-completion SSRF/memory consumption.**  
    `endSource()` deletes the conversion slot, but the source route treats a missing slot as a normal non-conversion signal and still fetches the source. A delayed/retried DocumentServer request can therefore use the still-valid token until expiry and trigger another full bounded source read.  
    Fix: for `h === 'convert'`, require an active `source-outcomes` slot; otherwise return 404 before `checkUrl`/fetch. Add a regression test for a source request after conversion timeout/completion.  
    References: [apps/api/src/routes/documents.ts:368-397](/home/josh/dev/monolith-docs-editor/apps/api/src/routes/documents.ts:368), [apps/api/src/source-outcomes.ts:17-36](/home/josh/dev/monolith-docs-editor/apps/api/src/source-outcomes.ts:17), [apps/api/src/convert.ts:239-243](/home/josh/dev/monolith-docs-editor/apps/api/src/convert.ts:239)

  - **Output memory limits are not safely bounded by configuration.**  
    `EDITOR_MAX_CONVERT_OUTPUT_BYTES` accepts any positive integer, and chunked conversion results are accumulated in memory via `chunks` plus `Buffer.concat`. Multiple consumers can therefore cause very large allocations, despite the stated memory-DoS focus.  
    Fix: enforce a documented maximum output cap and/or add a process-wide conversion memory budget; avoid retaining both chunk arrays and the concatenated buffer where possible. Add tests for oversized configured caps and concurrent chunked outputs.  
    References: [apps/api/src/config.ts:157-160](/home/josh/dev/monolith-docs-editor/apps/api/src/config.ts:157), [apps/api/src/convert.ts:199-212](/home/josh/dev/monolith-docs-editor/apps/api/src/convert.ts:199)

- **Medium issues**

  - **Consumer guide contradicts local-mode behavior.**  
    Section 6 says both URLs “must be https,” but the implementation intentionally accepts HTTP when `EDITOR_ENV=local`; the battery and tests rely on that behavior.  
    Fix: document HTTPS as the production requirement and explicitly describe local HTTP behavior.  
    Reference: [docs/guides/consumer-integration.md:257-259](/home/josh/dev/monolith-docs-editor/docs/guides/consumer-integration.md:257)

  - **The upload can receive partial output before a declared-length mismatch is detected.**  
    For a declared PDF length, the stream is uploaded immediately and only afterward checked with `size !== declared`. A truncated or malformed DocumentServer response may therefore leave a partial object at the consumer’s upload target even though the API returns `upload_failed`.  
    Fix: either buffer and validate before upload, or require upload targets to support abort/rollback semantics and document that partial objects may need cleanup. Add a test for short and overlong declared result bodies.  
    Reference: [apps/api/src/convert.ts:194-230](/home/josh/dev/monolith-docs-editor/apps/api/src/convert.ts:194)

- **Nits**

  - `buildKey()` occurs after incrementing the concurrency counter and before entering the `try/finally`; an unexpected key-build failure would leak the counter. Move key construction inside the protected block or decrement before throwing.  
    Reference: [apps/api/src/convert.ts:107-118](/home/josh/dev/monolith-docs-editor/apps/api/src/convert.ts:107)

  - The conversion route passes detailed internal error strings into logs (`detail`), so keep those values constrained to non-URL/non-secret codes as the implementation evolves.  
    Reference: [apps/api/src/convert.ts:235-237](/home/josh/dev/monolith-docs-editor/apps/api/src/convert.ts:235)

- **Doc-sync recommendations**

  - Update the EDIT-3 phase overview from `Pending` to the intended checkpoint state in [.ai/initiatives/active/udoc-editor-service/plan.md:24](/home/josh/dev/monolith-docs-editor/.ai/initiatives/active/udoc-editor-service/plan.md:24), after the findings are resolved.
  - Correct the local-vs-production URL statement in [docs/guides/consumer-integration.md:257-259](/home/josh/dev/monolith-docs-editor/docs/guides/consumer-integration.md:257).
  - Add the conversion-token lifecycle invariant and output-memory bound to the EDIT-3 plan/ADR if adopted.

TypeScript passed. The Vitest command could not start because the read-only workspace prevented Vite from writing its temporary cache file; no Docker or battery was started.

## Author's resolution (2026-10-18)

- **H1:** a conversion-scoped source token is admitted only while its conversion's slot exists (`sourceActive`); a late fetch gets 404 before any check or fetch. Test: "admits a conversion token only while its conversion runs".
- **H2:** `EDITOR_MAX_CONVERT_OUTPUT_BYTES` and `EDITOR_MAX_SOURCE_BYTES` are capped at 100 MB at start; `EDITOR_CONVERT_CONCURRENCY_TOTAL` (4) bounds conversions for everyone; chunks are no longer copied (`capped-read.ts`: one preallocated buffer when the length is declared, views joined once otherwise). The ceiling, (`EDITOR_SOURCE_CONCURRENCY` + `EDITOR_CONVERT_CONCURRENCY_TOTAL`) × 100 MB = 800 MB by default, is in the env examples, the plan, and EDIT-6. Tests: config bounds, the total limit.
- **M1:** the guide states https and public addresses, with `local` admitting http and private addresses.
- **M2:** the PDF is read whole and checked against its declared length before the upload; the consumer's storage never receives part of a file. Test: a result short of its length fails before the upload.
- **Nits:** the key is built before admission (a long consumer id leaks no slot; test); `detail` stays a fixed code (documented in `convert.ts`).
