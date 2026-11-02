# EDIT-2 checkpoint review — attempt 3 (Codex, substituting for DeepSeek)

- Date: 2026-10-18
- Reviewer: codex (gpt-5.6-luna) via `ai-review --provider codex --uncommitted --no-artifact`; DeepSeek still unavailable (1Password not signed in on the host).
- Author's note: both Mediums applied — consumer calls documented as server-to-server with a test that a DELETE preflight is not admitted; `_PREVIOUS` values included in the duplicate-secret check, with a test. The EROFS nit is the reviewer's read-only sandbox (tests pass locally: 192).

**Verdict:** PASS-WITH-NITS

**Critical issues**

None.

**High issues**

None. Prior findings are addressed:

- Startup secret refusal is covered by [`startup.ts:8-10`](/home/josh/dev/monolith-docs-editor/apps/api/src/startup.ts:8) and [`startup.test.ts:41-51`](/home/josh/dev/monolith-docs-editor/apps/api/src/startup.test.ts:41).
- Source-token expiry/rate limiting and stream teardown are implemented at [`documents.ts:265-330`](/home/josh/dev/monolith-docs-editor/apps/api/src/routes/documents.ts:265).
- 404 URL redaction is implemented at [`app.ts:95-100`](/home/josh/dev/monolith-docs-editor/apps/api/src/app.ts:95).
- Fresh EDIT-2 battery evidence is recorded in `docs/spikes/results/10.0.0.1/2026-10-18-0834.*` and `2026-10-18-partial-0907.*`.

**Medium issues**

- CORS does not allow `DELETE`, although the documented forgotten-file release endpoint is `DELETE /api/documents/keys/:key/forgotten` ([`app.ts:43-47`](/home/josh/dev/monolith-docs-editor/apps/api/src/app.ts:43), [`documents.ts:421-434`](/home/josh/dev/monolith-docs-editor/apps/api/src/routes/documents.ts:421)). Add `DELETE` to the CORS methods or explicitly document that this endpoint is server-to-server only, with a corresponding test.

- Notification-secret duplicate detection only compares current secrets, not `_PREVIOUS` rotation secrets ([`consumers.ts:198-209`](/home/josh/dev/monolith-docs-editor/apps/api/src/consumers.ts:198)). Validate previous-secret collisions across consumers too.

**Nits**

- API tests could not execute because Vitest attempted to write under the read-only filesystem (`EROFS`); typecheck and lint passed.
- The plan still contains the intentional `<<PHASE>>` placeholder at [`plan.md:23`](/home/josh/dev/monolith-docs-editor/.ai/initiatives/active/udoc-editor-service/plan.md:23).

**Doc-sync recommendations**

After this verdict, update:

- `.ai/initiatives/active/udoc-editor-service/plan.md` with the final checkpoint status.
- `ROADMAP.md` to reflect EDIT-2’s checkpoint result.
- `.ai/registry.yml` and the relevant handoff with the finalized phase state.
- Platform’s `docs/ecosystem/contracts-draft/document-editing.md` to ensure the source-route, notification, forgotten-file, and drop semantics match this implementation.
