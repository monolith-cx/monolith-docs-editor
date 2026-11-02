# EDIT-3 checkpoint review — attempt 3 (Codex, narrow verification)

- Date: 2026-10-18. Reviewer: codex (gpt-5.6-luna), `ai-review --uncommitted --no-artifact`. Its read-only sandbox could not run Vitest (EROFS); the tests pass locally (220).

- **Verdict:** PASS

- **Critical issues:** None.

- **High issues:** None.

- **Medium issues:** None.

- **Nits:** Vitest could not be rerun because Vite attempted to write `.vite-temp` in the read-only workspace. Typecheck and lint passed; prior attempt-2 evidence reports 220 tests passing.

Attempt-2 findings:

- H1 — **Fixed.** `readCapped()` retains chunks without joining; `partsStream()` sends views only ([capped-read.ts:28-62](/home/josh/dev/monolith-docs-editor/apps/api/src/capped-read.ts:28)).
- H2 — **Fixed.** Overlong and short declared bodies are covered ([capped-read.test.ts:22-24](/home/josh/dev/monolith-docs-editor/apps/api/src/capped-read.test.ts:22)).
- M1 — **Fixed.** Timeout values above 95 seconds are rejected and tested ([config.ts:178-180](/home/josh/dev/monolith-docs-editor/apps/api/src/config.ts:178), [config.test.ts:51-60](/home/josh/dev/monolith-docs-editor/apps/api/src/config.test.ts:51)).

Sonnet attempt-2 findings:

- N1 — **Fixed.** No joins or `Buffer` upload body copies remain ([capped-read.ts:36-62](/home/josh/dev/monolith-docs-editor/apps/api/src/capped-read.ts:36), [convert.ts:238-249](/home/josh/dev/monolith-docs-editor/apps/api/src/convert.ts:238)).
- N2 — **Fixed.** Conversion signal is captured before DNS resolution and checked afterward ([routes/documents.ts:351-372](/home/josh/dev/monolith-docs-editor/apps/api/src/routes/documents.ts:351)).
- N3 — **Fixed.** An ending conversion destroys an in-progress source response ([routes/documents.ts:410-413](/home/josh/dev/monolith-docs-editor/apps/api/src/routes/documents.ts:410)).
- N4 — **Fixed.** Empty PDFs fail before upload ([convert.ts:231-236](/home/josh/dev/monolith-docs-editor/apps/api/src/convert.ts:231)).
- N5 — **Fixed.** Contract and ADR wording reflect the actual busy/retry behavior.
- N6 — **Fixed.** Caller disconnect cancels the conversion ([routes/documents.ts:479-490](/home/josh/dev/monolith-docs-editor/apps/api/src/routes/documents.ts:479)).
- N7 — **Fixed.** Poll abort listeners are removed on timer completion ([convert.ts:197-207](/home/josh/dev/monolith-docs-editor/apps/api/src/convert.ts:197)).
- N8 — **Fixed.** Source-slot release is tested after hang-up ([documents.test.ts:578-604](/home/josh/dev/monolith-docs-editor/apps/api/src/documents.test.ts:578)).
- N9 — **Fixed.** Contract formatting and guide ordering are updated.

- **Doc-sync recommendations:** None for EDIT-3; the plan, ADR, guide, environment examples, and handoff are synchronized with the implementation.
