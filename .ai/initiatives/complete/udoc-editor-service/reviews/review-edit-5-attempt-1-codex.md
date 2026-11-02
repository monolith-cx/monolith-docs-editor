# EDIT-5 checkpoint review — attempt 1 (Codex)

- Date: 2026-10-18. Reviewer: codex (gpt-5.6-luna), `ai-review --uncommitted --no-artifact`. The first run failed before reviewing: the untracked binaries (`apps/plugin/icon.png`, `scripts/editor-battery/corpus/*.docx`) made the prompt invalid UTF-8; they were moved out of the tree for the run and restored (they were not reviewed; they are generated or copied).

- **Verdict:** FAIL

- **Critical issues:** None.

- **High issues:**

  - `apps/api/src/config.ts:199` — `TRUST_PROXY` validation only rejects an exact wildcard value. A dangerous value such as `0.0.0.0/0,::/0` passes validation, while Fastify interprets comma-separated strings as multiple trusted proxies. This lets clients spoof forwarded addresses and bypass the rate limiter. Reject wildcard tokens after splitting and add tests in `apps/api/src/config.test.ts:63-69` for comma-separated wildcards.

  - `apps/plugin/bridge.js:30-129` — The non-trivial bridge runtime has no behavioral unit tests. `apps/plugin/commands.test.mjs:205-215` only checks source text for origin handling; actual bridge lifecycle behavior—panel URL rejection, `udoc.ready`, request queuing, response delivery, close handling, and forged messages—is covered only by the manually-run battery, not normal tests. Add a DOM/fake-window harness or equivalent automated tests. Missing coverage is a High issue under IDDP.

- **Medium issues:**

  - `apps/api/src/routes/plugin.ts:43-48` — Missing or unreadable plugin files are logged and the API still starts, producing a partially broken production deployment. Fail startup/config validation when required served assets are absent, or make the deployment check fail before launch.

  - `apps/plugin/bridge.js:36,52,59,61,92,122` and `apps/plugin/commands.js:232,240` — The change violates the repository’s explicit “No `any`” convention. The plain-JS deviation from E7 is documented, but it does not waive the type-safety rule. Replace these with structural JSDoc types or explicitly amend the convention.

- **Nits:** None.

- **Doc-sync recommendations:**

  - Replace `.ai/initiatives/active/udoc-editor-service/plan.md:25`’s `<<E5ROW>>` with the final status only after the findings are fixed and the two E8 reviewer records are captured.
  - Update `ROADMAP.md:13`, `.ai/registry.yml:35`, and `.ai/handoffs/udoc-editor-service.md:10-16`/`103` from “Next: EDIT-5” to the actual reviewed EDIT-5 state.
  - Add the checkpoint review record under `.ai/initiatives/active/udoc-editor-service/reviews/`.
  - After acceptance, sync the Platform contract/integration records, especially `docs/ecosystem/contracts-draft/document-editing.md` and `docs/ecosystem/integration-status/monolith-docs.yaml`.

## Author's resolution (2026-10-18)

- **H1:** `TRUST_PROXY` checks every list entry (wildcards and IPv4 ranges wider than /8 or IPv6 wider than /32 refused) and caps a hop count at 3; tests include `10.0.0.1, 0.0.0.0/0`. `X-Forwarded-Host` is also dropped (Sonnet M1), proven by a test that fails without it.
- **H2:** `bridge.js` is a testable `createBridge` core with 7 behaviour tests against a fake host (panel URL refusal, ready and hello, origin rules with a counter, one response per request in order, the timeout freeing the queue and ignoring a late answer, shape checks, an uncloneable result).
- **M1:** `pluginProblems()` makes a missing plugin file a startup problem (test).
- **M2:** no `any` remains: `globals.d.ts` declares the OnlyOffice surface the plugin uses; `tsc --checkJs` is clean.
