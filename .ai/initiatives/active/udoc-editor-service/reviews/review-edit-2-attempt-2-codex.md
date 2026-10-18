# EDIT-2 checkpoint review — attempt 2 (Codex, substituting for DeepSeek)

- Date: 2026-10-18
- Reviewer: codex (gpt-5.6-luna) via `ai-review --provider codex --uncommitted --no-artifact`; DeepSeek still unavailable (1Password not signed in on the host).
- Scope: EDIT-2 after the attempt-1 fixes.
- Author's note: H2 misread `2026-10-18.{md,json}` (EDIT-1's committed record, unchanged) as EDIT-2's result; EDIT-2's runs are `2026-10-18-0834` (full) and the service-item re-run on the final code. H1 and M1 were fixed with the attempt-2 batch.

**Verdict:** FAIL

**Critical issues**

None.

**High issues**

- **Startup refusal for missing notification secrets is still not integration-tested.** The implementation calls `consumerProblems()` during startup in [server.ts:5-17](/home/josh/dev/monolith-docs-editor/apps/api/src/server.ts:5), but tests only exercise the helper directly in [consumers.test.ts:81-103](/home/josh/dev/monolith-docs-editor/apps/api/src/consumers.test.ts:81). Add a test proving a strict profile consumer with an unset secret prevents startup.

- **Acceptance evidence is stale and contradicts the new implementation.** The committed battery result still records unsigned notifications and DocumentServer fetching files directly at [2026-10-18.md:12-13](/home/josh/dev/monolith-docs-editor/docs/spikes/results/10.0.0.1/2026-10-18.md:12), and U9 still records AI enabled/plugins installed at [2026-10-18.md:42](/home/josh/dev/monolith-docs-editor/docs/spikes/results/10.0.0.1/2026-10-18.md:42). The plan still has `<<ACCEPTANCE>>` at [plan.md:184](/home/josh/dev/monolith-docs-editor/.ai/initiatives/active/udoc-editor-service/plan.md:184). Run the battery later as instructed, replace the stale results, and then complete the acceptance status.

**Medium issues**

- **Source-stream failures occur after a 200 response has begun.** The cap and upstream stream errors are handled through a `Transform` after headers are sent in [documents.ts:291-308](/home/josh/dev/monolith-docs-editor/apps/api/src/routes/documents.ts:291). This can expose DocumentServer to a truncated 200 response rather than a clear 502. The test explicitly accepts either an exception or partial payload at [documents.test.ts:308-314](/home/josh/dev/monolith-docs-editor/apps/api/src/documents.test.ts:308). Buffer/preflight sufficiently to reject before headers, or explicitly define and test the connection-abort behavior.

**Nits**

None.

**Doc-sync recommendations**

- After the battery run, update [udoc-editor-service/plan.md:130-184](/home/josh/dev/monolith-docs-editor/.ai/initiatives/active/udoc-editor-service/plan.md:130) and regenerate `docs/spikes/results/10.0.0.1/2026-10-18.md`/`.json`.
- Sync the external Platform contract `docs/ecosystem/contracts-draft/document-editing.md` with the source-route, notification, and drop semantics before commit/closeout.

Attempt-1 findings H1, M1–M4, and Sonnet’s H1–H3 are otherwise addressed in code and documentation.
