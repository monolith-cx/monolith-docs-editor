# Handoff — Editor Service for Unified Document Authoring (EDIT)

- **Updated:** 2026-10-18
- **Lane / status:** active / `active` (owner-approved 2026-10-16)
- **Parent:** Platform ecosystem initiative `unified-document-authoring` (UDOC), phase UDOC-1. EDIT-*n* implements UDOC-1.*n*.
- **Plan:** `.ai/initiatives/active/udoc-editor-service/plan.md` · **Guidance:** `guidance.md` (local decisions E1–E8)

## Where things stand

| Phase | State | Commit |
|---|---|---|
| EDIT-0 (charter) | Done | `0158323` |
| EDIT-4 (log redaction) | Code-complete and reviewed; not deployed (no hosted editor since the 2026-06-12 decommission) | `9f54904`, `28a27d9` |
| EDIT-1 (OnlyOffice 10.0.0.1 and the battery) | Done (U13 waived by Josh) | `dfbb48e` |
| EDIT-2 (UDOC-1.2) | Code-complete 2026-10-18; not deployed; uncommitted | — |

EDIT-2's detail is in the plan's EDIT-2.1–2.8 status lines.

### What EDIT-2 changed

- **Profiles:** `document`, `template`, `view`, plus the legacy shape (E1). The legacy shape is refused from profile consumers (`profile_required`).
- **Keys:** `<consumer>.<documentRef>.<mode><revision>`.
- **Sessions:** stateless. AES-256-GCM sealed editor tokens (12 h at most); the expired page.
- **Callback trust:** HS256 pinned; fields come from the verified payload; the `url` origin is checked.
- **Notifications:** signed (`X-Editor-Signature: v1=…`), with a `deliveryId`. The service answers DocumentServer 503 so a final save is retried (F1).
- **Drop and forgotten files:** `drop`; forgotten-file get and release.
- **The editor page:** escaping and a nonce CSP.
- **The source route** (from the checkpoint review):
  - DocumentServer never receives a consumer's file URL. It fetches `/api/documents/source/<sealed source token>`, and the service fetches the file on the checked addresses.
  - Limits: 5-minute tokens, 10 fetches each; no redirects; `identity` encoding; a 100 MB cap; a 120 s timeout.
  - Teardown when DocumentServer hangs up.
- **Configuration:**
  - Strict `EDITOR_ENV`; every env read is in `config.ts`, with numbers validated.
  - Notification secrets: at least 32 bytes, never shared.
  - The startup `callbackUrl` warning.
- **DocumentServer hardening** (configuration only):
  - `aiSettings.enable: false`, mounted from `infrastructure/onlyoffice/`;
  - `PLUGINS_ENABLED=false`.
- **Removed:** the session map, `/api/sessions`, `/api/documents/:key/download`, `saveTo`, the per-request `callbackUrl`, GCS paths, `storage.ts`, and `@google-cloud/storage`.
- **New documents:**
  - `docs/guides/consumer-integration.md`, the consumer guide;
  - `apps/api/src/reference/verify-notification.ts`, the reference verifier;
  - Platform `docs/ecosystem/contracts-draft/document-editing.md` 0.1.0-draft (UDOC-2.1).

### Verification that ran

- **API:** 192 tests (15 files), including `strict-routes.test.ts` and `startup.test.ts` under `EDITOR_ENV=production`. Typecheck and lint are clean. `validate-ai-workspace` and `docker compose config` pass.
- **Battery on 10.0.0.1:**
  - `docs/spikes/results/10.0.0.1/2026-10-18-0834`: the full run. 30 pass, 4 pass-with-finding (the loose lock, as at EDIT-1), 6 recorded, 1 blocked (U13, waived), 0 fail.
  - `-partial-0907`: S0, S1, S2, E2a–E2e and U9 on the attempt-2 code.
  - `-partial-0929`: the same items after the attempt-3 fixes, all pass.
  - `-partial-0940`: S0, S1, S2 and E2a–E2e on the final code (after the attempt-4 nits), all pass.
  - EDIT-1's `2026-10-18.{md,json}` is unchanged.
  - The runner now rebuilds the API image on every run (`up --build`) and never overwrites a record.
- **Reviews (E8: two reviewers):**
  - Sonnet, plus Codex substituting for DeepSeek, because 1Password was not signed in on the host.
  - Attempts 1 and 2: FAIL. Attempt 3: PASS-WITH-NITS from both. Every finding was applied.
  - Attempt-4 verification (Sonnet): PASS-WITH-NITS, nits applied.
  - Records: `reviews/review-edit-2-attempt-*.md`.

### New finding

- **ADR F16:** under `modifyContentControl: false`, the context menu's "Remove content control" unwraps a `contentLocked` field and leaves its value as plain text.
- This is carried to UDOC-3's D16 validation, which must report missing rows on every save, and to the contract (§8, §9).
- EDIT-5 checks whether the bridge plugin can withdraw the menu item.

## Blockers and open decisions (Josh)

- **Deploy gate:** EDIT-2 changes the headless API: it removes two routes and refuses the legacy shape from profile consumers. `standalone-app` Phase 0 must close or be re-baselined before EDIT-2 is deployed.
- **No environment exists.** EDIT-6 is a from-scratch stand-up. EDIT-2.1's dev secrets (1Password, Secret Manager, `CREDENTIALS.md`) are created then; the env examples list every name.
- **Cloudflare (EDIT-4.2):** still blocked.
- **DeepSeek reviewer:** unavailable until `op` is signed in on this host.

## Errors

- Four `ERRORS.md` entries were resolved in code, not deployed: the unsigned notification, the editor page, callback trust, and file-URL trust.
- No new unresolved errors were found.
- F16 is a design finding, recorded in the ADR; it is not a defect.

## Next step

- EDIT-3 (PDF conversion), which uses the same source route for `sourceUrl`.
- Then EDIT-5 (the bridge plugin).

## Follow-ups noted

- `CLAUDE.md`'s reviewer lines carry another session's uncommitted edit that names MiniMax, which is retired. Reconcile them with `.ai/iddp/config.json` when that edit is resolved.
- SA-1.7 (editor-page `frame-ancestors`) is still a candidate follow-up; the guide states it.
- EDIT-6:
  - DocumentServer's `directIfIn.jwtToken=false` with an allow-list, as defence in depth (F3);
  - the in-process rate limiter, when there are several instances.

## Commit state

- Committed on `main`, not pushed: `0158323`, `9f54904`, `28a27d9`, `dfbb48e`.
- EDIT-2 is uncommitted and awaits Josh's approval.
- Older sessions' uncommitted work stays out:
  - `.ai/handoffs/standalone-app.md` and `.ai/iddp/config.json`;
  - the standalone-app plan and its review files;
  - `deploy-pipeline-parity/*`, `.gitignore`, and `infrastructure/gce/teardown.sh`;
  - `CLAUDE.md`'s reviewer lines and the other hunks of `.ai/registry.yml`.
