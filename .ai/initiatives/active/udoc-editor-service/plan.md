# Editor Service for Unified Document Authoring — Execution Plan

**Initiative ID:** udoc-editor-service
**Abbreviation:** EDIT
**Owner:** josh
**Status:** Active — drafted 2026-10-16; plan review attempt 1 **FAIL** (3 High, 12 Medium, 8 Nit), attempt 2 **PASS-WITH-NITS** (9 Medium, 7 Nit; `reviews/review-plan-attempt-{1,2}.md`), every finding applied the same day; **owner-approved 2026-10-16** with parent amendments A1–A5; moved to `active/`. EDIT-4 code-complete and checkpoint-reviewed 2026-10-16 (`reviews/review-edit-4-attempt-{1,2,3}.md`: FAIL, PASS-WITH-NITS, PASS-WITH-NITS; every finding applied), not deployed. EDIT-1 done 2026-10-18 (committed `dfbb48e`; review attempt 2 PASS-WITH-NITS, applied; U13 waived by Josh). EDIT-2 code-complete 2026-10-18 (two reviewers, Sonnet and Codex substituting for DeepSeek: attempts 1 and 2 FAIL, attempt 3 PASS-WITH-NITS from both, every finding applied, attempt-4 verification PASS-WITH-NITS, nits applied; `reviews/review-edit-2-*.md`), not deployed. EDIT-3 code-complete 2026-10-18 (Sonnet + Codex: attempt 1 PASS-WITH-NITS and FAIL, attempt 2 PASS-WITH-NITS and FAIL, attempt 3 PASS-WITH-NITS and PASS, every finding applied; `reviews/review-edit-3-*.md`; ADR F17 found and mitigated), not deployed. EDIT-5 code-complete 2026-10-18 (Sonnet + Codex: attempts 1 and 2 FAIL from both, attempt 3 PASS-WITH-NITS from both, every finding applied; `reviews/review-edit-5-*.md`; ADR F18), not deployed. EDIT-6: hosting decided by Josh 2026-10-18 (E9, the VPS); 6.1–6.5 code-complete (Sonnet: attempt 1 PASS-WITH-NITS, every finding applied; attempt 2 PASS-WITH-NITS (2 Low, 9 nits, all applied); ADR `2026-10-18-editor-hosting.md`); next: EDIT-6.6, the stand-up, with Josh's approval per step.
**Last updated:** 2026-10-18
**Guidance:** [guidance.md](./guidance.md)
**Parent ecosystem initiative:** `unified-document-authoring` (UDOC), phase UDOC-1 — `~/dev/monolith-platform/.ai/ecosystem/initiatives/active/unified-document-authoring/plan.md`
**Numbering:** EDIT-*n* implements UDOC-1.*n*; EDIT-0 is this initiative's charter.

Estimates are engineering weeks for one senior developer working with Claude.

---

## Phase Overview

| Phase | Parent | Title | Status | Depends on |
|---|---|---|---|---|
| EDIT-0 | — | Charter, re-scope of `standalone-app`, plan review | Done 2026-10-16 | — |
| EDIT-4 | UDOC-1.4 | Log redaction | Code-complete, checkpoint review PASS-WITH-NITS 2026-10-16 (attempt 3, nits applied). No environment exists to deploy to (decommissioned 2026-06-12, found 2026-10-17): ships with the EDIT-6 stand-up. Open: Cloudflare check (blocked); old logs survive only in the 2026-06-12 snapshots (owner decision) | EDIT-0 |
| EDIT-1 | UDOC-1.1 | Upgrade and the extended battery re-run | **Done 2026-10-18**: battery run in full on 10.0.0.1 (24 pass, 4 pass-with-finding for the loose lock, 7 recorded, 0 fail); U13 (Word desktop) waived by Josh; review attempt 2 PASS-WITH-NITS, applied; committed `dfbb48e` | EDIT-0 |
| EDIT-2 | UDOC-1.2 | Profiles, stateless sessions, signed notifications, drop, the editor page | **Code-complete 2026-10-18**: 192 API tests; battery records `2026-10-18-0834` (full, 0 fail) and `-partial-0907`/`-0929`/`-0940` (service items; `-0940` on the final code; all pass); review attempt 3 PASS-WITH-NITS from Sonnet and Codex, every finding applied, attempt-4 verification PASS-WITH-NITS, nits applied. Not deployed (no environment; dev secrets deferred to the EDIT-6 stand-up); `standalone-app` Phase 0 closes or is re-baselined before it deploys. New: ADR F16 | EDIT-1 (pinned release, measured retry behaviour), EDIT-4; UDOC-2.1 drafted alongside; `standalone-app` Phase 0 closed or re-baselined before EDIT-2 deploys |
| EDIT-3 | UDOC-1.3 | PDF conversion | **Code-complete 2026-10-18**: `POST /api/documents/convert` through the source route and a pinned upload; 220 API tests; battery `2026-10-18-partial-2002` (all service items, 10 pass); review attempt 3 PASS (Codex) and PASS-WITH-NITS (Sonnet), every finding applied. Found ADR F17 (DocumentServer's one converter wedges on a partial or slow source download); the source route now reads every source whole. Not deployed | EDIT-1, EDIT-2 (consumer registry, URL validator) |
| EDIT-5 | UDOC-1.5 | The panel bridge plugin | **Code-complete 2026-10-18**: `apps/plugin/` (plain JavaScript, `// @ts-check`, no build step: a recorded deviation from E7) served by the API from `/plugins/udoc-bridge/`; protocol 1 with six operations; 230 API tests, 38 plugin tests; battery `2026-10-18-partial-2242` (service and bridge items) plus `-partial-2302` (E5a–E5c) and `-partial-2312` (E5b on the final code), all pass; review attempt 3 PASS-WITH-NITS from Sonnet and Codex, every finding applied. Found: ADR F18 (the plugin page's CSP needs). F16's open question (can the plugin withdraw "Remove content control") was not probed and stays open. Not deployed | EDIT-1 (unproven items answered), EDIT-2 (profiles, plugin data) |
| EDIT-6 | UDOC-1.6 | Hosting and capacity | **In progress**: hosting decided by Josh 2026-10-18 (E9: the OVH VPS, `monolith-dev`, `editor-dev.monolith.cx`). 6.1–6.5 (the local half) code-complete 2026-10-18: DocumentServer's settings (directIfIn allow-list, two converter processes), the converter probe and host watchdog, capacity, and `infrastructure/vps/`; 234 API tests; battery `2026-10-19-partial-0057` (E6a, E6b, E6d pass; E6e recorded) and `-0022` (E6c); review attempt 1 PASS-WITH-NITS (every finding applied), attempt 2 PASS-WITH-NITS (2 Low, 9 nits, all applied). New: ADR `2026-10-18-editor-hosting.md`. 6.6–6.7 (the stand-up and acceptance) await Josh's approval | EDIT-2, EDIT-3, EDIT-5; a hosted path from DOC-DPP or the proven GCE path |
| EDIT-7 | UDOC-1.7 | Licence posture (owner decision) | Pending | none; recorded before close-out |
| Close-out | — | Phase close-out and parent sync | Pending | all |

Order of work: EDIT-0 → EDIT-4 → EDIT-1 → EDIT-2 → EDIT-3 → EDIT-5 → EDIT-6 → close-out. EDIT-7 can be recorded at any point. Every phase ends at a checkpoint (`/initiative checkpoint`): verification, review, doc sync, handoff, then a commit only with Josh's approval. **Every deploy and every change to a hosted environment (including log purges) needs Josh's approval**, and runs after open editors drain: by DocumentServer's connection statistics if EDIT-1.5 proves them, otherwise in an announced maintenance window.

Verification at every checkpoint: `pnpm --filter @monolith-docs/api run typecheck`, `pnpm --filter @monolith-docs/api run lint`, `pnpm --filter @monolith-docs/api run test`, `docker compose config`, `node scripts/validate-ai-workspace.mjs`; from EDIT-5 on, the plugin's build and `scripts/check-plugin-deps.mjs`; from EDIT-1 on, the battery items the phase touches. Real-editor items count only when run against the pinned release, and say where they ran. Check `~/bin/heavy` before any battery run.

---

## EDIT-0 Charter

### EDIT-0.1 File the initiative
- Create this plan and guidance under `.ai/initiatives/active/udoc-editor-service/`; register it in `.ai/registry.yml` with `parent_ecosystem_initiative: unified-document-authoring`; add it to `ROADMAP.md`; list it as the UDOC-1 child in Platform's `.ai/ecosystem/registry.yml`, the UDOC plan header, Platform's `ROADMAP.md`, and the UDOC handoff (with the legacy-consumer migration follow-up and the proposed parent amendments below); write this initiative's handoff.
- Status: Done 2026-10-16 (drafted, not committed).

### EDIT-0.2 Re-scope `standalone-app`
- Per this repo's `ROADMAP.md` repo-split note: `standalone-app` keeps Phase 0 (workspace restructure and headless parity) and its open Phase 0 gates; Phases 1–7 are **superseded** (the product surface moved to the private `monolith-docs` repo; the editor-service pieces UDOC needs are here). SA-1.6 (`hostnameGuard`, production-strict `findConsumersByHostname`) and SA-1.7 (`allowedFrameAncestors` on the editor page) are **not** in UDOC-1's scope and are recorded as candidate follow-ups. Phase 0 must close (or its Track A matrix be re-baselined: the `/api/documents/:key/download` and `/api/sessions` items are removed by EDIT-2) before EDIT-2 is deployed, because EDIT-4 and EDIT-2 change the headless API Phase 0 verifies. Josh (2026-10-16): keep `standalone-app` active for Phase 0, archive it once Phase 0 closes.
- Acceptance: `standalone-app`'s plan, guidance, registry entry, and ROADMAP entry say Phase 0 only, with Phases 1–7 superseded, the two follow-ups named, and the ordering note; no blocker still describes Phase 1 as pending work.
- Status: Done 2026-10-16.

### EDIT-0.3 Proposed parent amendments (owner)
- **A1 (E1):** the legacy open shape stays until `fastmail-connect` and the Connect extension migrate (parent UDOC-1.2 says "one release").
- **A2 (estimate):** UDOC-1 from 3.5–5 to 4–5.5 weeks (the legacy path, the callback and URL-trust fixes, the forgotten-files reconcile; EDIT-0's charter time is not counted).
- **A3 (panel item):** UDOC-1.2's acceptance item "the panel docked right" is proven at UDOC-1.5 (EDIT-5.6), since the plugin does not exist until then; UDOC-1.2 is reported done without it only if A3 is approved, otherwise UDOC-1.2 stays open until EDIT-5.6.
- **A4 (UDOC-1.6 acceptance):** a signed save notification reaches a **stub receiver on the `crm-dev` network** at UDOC-1.6 (proving reachability and signing), and CRM's real receiver is proven at UDOC-3.3; otherwise UDOC-1.6 waits on UDOC-3.3, which depends on UDOC-1 (circular).
- **A5 (CI):** until DOC-DPP gives this repo a CI workflow, the parent's "CI check" on the plugin's dependencies is enforced by the checkpoint verification list and a planted-import test.
- All recorded in the parent plan as proposed, applied only on Josh's approval.
- Status: Done 2026-10-16 — Josh approved A1–A5; applied to the parent plan's UDOC-1.2, 1.5, 1.6, and 3.3 text and its estimates.

### EDIT-0.4 Plan review and approval
- Adversarial plan review (Sonnet, in-session) against the parent's UDOC-1 text and the code; findings fixed; Josh approves; the initiative moves to `active/`.
- Acceptance: a PASS or PASS-WITH-NITS record under `reviews/` with every finding addressed; approval recorded in the status line.
- Status: Done 2026-10-16 — attempt 2 PASS-WITH-NITS, all applied; Josh approved; moved to `active/`.

---

## EDIT-1 Upgrade and the extended battery re-run (UDOC-1.1)

**Goal:** the service runs the pinned latest Community release, and every behaviour UDOC depends on is proven on it by a repeatable script, or its fallback is chosen.

### EDIT-1.1 Commit the spike
- Commit `docs/spikes/2026-10-contract-sections.md` as it stands (the parent requires it). Later fixes are separate edits with a dated note.
- Status: staged with the EDIT-1 checkpoint (2026-10-17).

### EDIT-1.2 Rebuild the harness as `scripts/editor-battery/` (E3)
- A workspace package with: a scratch compose project (DocumentServer at the pinned tag, a scratch build of `apps/api`, a stub consumer serving fixtures, a notification receiver that records and can be told to fail or answer any status, a panel page); fixture generators (the spike's field-and-block fixture in `contentLocked` and `sdtContentLocked` variants, tables). **Deferred by design (2026-10-17, review EDIT-1 M10):** header and footer fields belong to EDIT-5.5's corpus, and the conversion upload target to EDIT-3, where they are first exercised; Playwright drivers using real keyboard and mouse input; a runner that writes `docs/spikes/results/<release>/<date>.{md,json}` with pass/fail and evidence per item.
- Loopback-only ports, random scratch secrets, strict timeouts.
- Acceptance: one command runs the whole battery from a clean checkout and tears down after itself.
- Status: Done 2026-10-17. `scripts/editor-battery/` (README there): compose project with DocumentServer, a stub consumer on three origins, and `apps/api` built from this repo; 36 items; `--keep`/`--reuse` for iteration, `--render` to re-render a run. Harness notes found while building it: headless Chrome runs no clipboard shortcuts (copy uses the editor's handler after a real click, paste uses `PasteHtml`); `GetRange` offsets differ from `GetText` offsets once controls exist (selections use `Search` + `ExpandTo`); force-save retries while the server answers `error 4`.

### EDIT-1.3 Pin and upgrade
- Choose the newest Community tag (E2); pin tag and digest in `docker-compose.yml` and wherever the GCE environment files name the image; the existing tests pass; a local open/edit/save round trip works on the new release.
- Status: Done 2026-10-17. `onlyoffice/documentserver:10.0.0.1@sha256:ca17889f…50b3` pinned in `docker-compose.yml` (the GCE env files do not name the image); the API's 54 tests pass; S1/S2 run the service itself, built from its Dockerfile, through open, edit, save, and the consumer notification on 10.0.0.1, in both legacy request shapes.

### EDIT-1.4 Re-run the spike's proven items on the pinned release
- Items 3, 4, 5, 7, 8, and 9a–9e as defined in the spike document.
- Items 3, 4, 7, and 8 again with inline fields locked **`contentLocked`** (D11), plus: deleting a sentence containing a field, copy-paste duplicating a field, and cut-and-paste of a field.
- Status: Done 2026-10-17: every item holds (`docs/spikes/results/10.0.0.1/2026-10-18.md`); 7cl and U1/U1t/U1d report `finding` rather than `pass` because of the loose-lock behaviour below. The clipboard items simulate copy and paste (ADR F10). **Josh confirmed on 2026-10-17 that D11 stands (ADR F9):** with `contentLocked` a field's value is never changed in part, but the field is a unit a rep removes with ordinary keystrokes (typing over a selected field, two Backspaces after it, a selection across it); `sdtContentLocked` refuses all of these. D11's ruling stands as written unless Josh changes it; the consequence is that D16's missing-row handling and required fields carry the weight.

### EDIT-1.5 Prove the unproven items
- A plugin creating a tagged `contentLocked` control, also with `modifyContentControl:false` and with track changes on.
- Per-session plugin data reaching the plugin (fallback if not: a per-session `config.json`, E7).
- A consumer page running inside the plugin panel with a two-way `postMessage`.
- `getText` returning each field control's span, row id (from the tag), and kind (`field` / `block`).
- DocumentServer's callback behaviour when the consumer answers an error, per status (1, 2, 4, 6): its callback timeout, retry count and spacing, what happens after the last retry, whether a retry's body is byte-identical to the first attempt, and whether the forgotten-files commands (`getForgottenList`, `getForgotten`) return the unacknowledged save (feeds E6).
- The callback's exact shape on the pinned release: the origin of the `url` it emits (internal or public, depending on host headers behind nginx and the tunnel) and the verified JWT's shape (body token versus header token whose claims wrap the body in `payload`).
- Statuses 3 and 7 (save errors) and the `actions` array on status 1 (connect versus disconnect); which fields distinguish two connect events by the same user.
- How the built-in AI tab is turned off while the bridge plugin still loads (`customization.plugins:false` would disable both).
- Whether DocumentServer exposes connection statistics without a document key (e.g. `/info/info.json`), for the drain check.
- ConvertService output for a document with pending tracked changes and comments.
- The command service's drop with edits since the last save (status 2 expected) and without (status 4 expected), given the users from status-1 notifications.
- Probe plugins used here live under `scripts/editor-battery/` and are never served by the API.
- DocumentServer's own log configuration on the pinned release (internal nginx access and error logs, the services' log level and pattern; 8.3 logs `DOCID` at WARN), recorded in the ADR.
- DocumentServer's own request filtering (private-address refusal for `document.url` and conversion sources), its `maxDownloadBytes` limit, and its cache retention for edited and converted files.
- A version DOCX opened, edited, and saved in **Word desktop** and reopened in OnlyOffice. Needs a machine with Word; record who ran it and where. If it cannot be run, EDIT-1 stays open unless Josh waives this item in writing (recorded here).
- 2026-10-17: Josh has no Word desktop either (OnlyOffice desktop only on Windows).
- **Waived 2026-10-18.** Josh waived U13 in writing on 2026-10-18 ("Just waive it"): there is no Word desktop on the battery host or on Josh's Windows machine (OnlyOffice desktop only). Consequence: a DOCX version edited in Word desktop and returned is unproven; D16's validation of every returned file (field rows, locks, value runs, content rules) is the safeguard, and a Word round trip can be re-run any time with `--only U13` once Word is available. The battery keeps reporting U13 as `blocked`.
- Status (2026-10-17): every item passed or was recorded except the following. **Statuses 3 and 7 (save errors) are not measured**: they could not be provoked without breaking DocumentServer (ADR F14). Callback behaviour was measured per status: only status 2 is retried, while statuses 1, 4, and 6 get one attempt (ADR F1). The Word round trip is **Blocked**: `docs/spikes/results/10.0.0.1/word-roundtrip-input.docx` is written by the battery; saving it from Word as `word-roundtrip-output.docx` beside it and running `--only U13` completes the check. No fallback from the parent's Risks was needed (U1–U4 and U8 pass).

### EDIT-1.6 ADR, fallbacks, registries
- `docs/adr/<date>-onlyoffice-release-and-licence.md`: the pinned release and digest, why, the release's AGPL additional terms and our posture (image unmodified; our plugin served separately), DocumentServer's cache retention, the measured callback horizon, and each fallback taken (parent Risks) with its evidence.
- Update the Stack line in `CLAUDE.md` (and reconcile its reviewer names with `.ai/iddp/config.json` and its "session TTL" rule with D13), `README.md` where it names 8.3, and the `tech_stack` line of `monolith-docs-editor` in Platform's `docs/ecosystem/project-registry.yaml`.
- Acceptance (parent UDOC-1.1): the script's output for every item above is saved in the repo; the ADR is in `docs/adr/`; any failure either takes the fallback named in the parent's Risks (recorded in the ADR) or stops EDIT and reopens D2 in the parent.
- Status: ADR `docs/adr/2026-10-17-onlyoffice-release-and-licence.md` (release, licence posture with the image's additional terms, findings F1–F15 at EDIT-1, F16 added at EDIT-2, and the steps that absorb them); `CLAUDE.md` and `AGENTS.md` stack lines and Platform's `project-registry.yaml` tech-stack line updated; F1–F5 folded into EDIT-2's text and E6 corrected. `CLAUDE.md`'s "preserve session TTL behavior" rule stays until EDIT-2 removes the session map, and EDIT-2's doc sync rewrites it to D13's stateless sessions. `CLAUDE.md`'s reviewer lines are not changed here: they carry another session's uncommitted edit, which still names MiniMax (retired) as a reviewer; reconciling them with `.ai/iddp/config.json` is a follow-up for whoever owns that edit (handoff).

**Checkpoint:** single reviewer (Sonnet).

---

## EDIT-2 Profiles, sessions, notifications, and the editor page (UDOC-1.2)

**Goal:** consumers open stateless per-open sessions by named profile, get signed notifications that survive restarts and short outages, can drop a key, and the editor page is safe to render.

### EDIT-2.1 Configuration and secrets (E4, E5)
- DocumentServer's own configuration for every environment switches its server-side AI feature off (`aiSettings.enable: false`; on by default in 10.0 with a browser proxy, ADR F4), supplied as configuration, never by changing the image.
- Fold every `process.env` read (`consumers.ts:87,92,106`, `server.ts:27,31`, `files.ts:36-37`) into `config.ts`.
- `EDITOR_ENV` with strict-by-default behaviour (E4); seal keys; notification secrets (current and previous) resolved from `notificationSecretRef`; the DocumentServer JWT secret's strictness.
- Consumer registry: `profiles`, and for a profile-capable consumer `callbackUrl` (https, public address at load), `notificationSecretRef`, `panelOrigins`, `fileHosts`, `convertSourceHosts`, `convertUploadHosts`, `returnOrigin`; consumer ids restricted to `[0-9A-Za-z_-]`. A legacy-only entry stays valid (E5).
- Tests: `validateConsumersConfig` over `infrastructure/environments/{dev,prod}/env.example`'s `CONSUMERS` passes unchanged; a profile-capable entry missing a field fails; startup refuses each weak secret outside `EDITOR_ENV=local`.
- Each consumer's `notificationSecretRef` names its environment variable outright (e.g. `EDITOR_NOTIFY_SECRET_FASTMAIL_CONNECT`, plus an optional `<name>_PREVIOUS`); no name is derived from the id.
- `callbackUrl` is checked as https at load and its resolution only warned on; it is resolved and pinned through `safe-url` at every delivery.
- `EDITOR_ENV` also governs the `/files/` fixture route (only under `local`) and HSTS (everything but `local`). The dev and production VM env files (`infrastructure/environments/*/env.example` and the VMs' `.env`) gain `EDITOR_ENV` and the new secrets **before** EDIT-2 deploys, or the service refuses to start.
- Secrets created in 1Password and Secret Manager for dev; names in `CREDENTIALS.md` and the guide.
- Status: Done in code 2026-10-18. `config.ts` holds every env read (incl. `EDITOR_SOURCE_TIMEOUT_MS`, `EDITOR_MAX_SOURCE_BYTES`; every number validated whole and positive); `consumerProblems` refuses an unset, short (<32 bytes outside `local`), or shared notification secret (`notificationSecretProblems`); `warnOnCallbackResolution` warns at start, without the URL, when a `callbackUrl` would be refused; DocumentServer's AI is off by a mounted `infrastructure/onlyoffice/local-production-linux.json` and `PLUGINS_ENABLED=false`, proven effective by U9 (`/ai-proxy` answers `AI is disabled`; a control restart with AI on answers otherwise). **Deferred to the EDIT-6 stand-up:** creating the dev secrets in 1Password and Secret Manager and naming them in `CREDENTIALS.md` — no dev environment exists (decommissioned 2026-06-12), so there is nothing to put them in yet; the env examples list every name.

### EDIT-2.2 A resolving URL validator
- This validator is the **only** gate for document, callback, and conversion URLs: DocumentServer fetches any URL inside a JWT-signed config or command directly, bypassing its own private-address block (`externalRequest.directIfIn.jwtToken`, ADR F3, U12).
- `apps/api/src/safe-url.ts`: parse, require https (the legacy internal `/api/files/` prefix is the one exception, matched exactly against `API_INTERNAL_URL`), check the host against the caller's allowlist, resolve DNS and refuse if **any** address is private, loopback, link-local, CGNAT (100.64/10), unique-local IPv6 (fc00::/7), IPv4-mapped IPv6 of any of those, unspecified, or a metadata name (`metadata.google.internal`, 169.254.169.254); return the pinned address for the fetch; fetches use `redirect: 'manual'`. Replaces `validateSourceUrl` and its `://api:` / `://onlyoffice` substring exemption.
- Error messages never include the URL (EDIT-4).
- Status: Done in code 2026-10-18. `safe-url.ts` blocks the listed ranges plus every IPv4-in-IPv6 form (mapped, translated, compatible, 6to4, NAT64 well-known and local-use), Teredo, site-local, discard, and 6to4-relay. **Added at the checkpoint review (Codex H1 / Sonnet M3):** DocumentServer is never handed a consumer's file URL; its config names the service's source route (`GET /api/documents/source/<sealed source token>`, the token's purpose bound in the AAD), and the service re-checks the URL against the consumer's current registration and fetches it on the checked addresses (no redirects, 120 s, 100 MB), so DNS rebinding between `open` and DocumentServer's fetch is closed. Attempt 2 tightened it: a source token lives 5 minutes (one per page load) and admits 10 fetches (rate-limited per token, not per address); `pipeline` plus a close hook stop pulling from the consumer the moment DocumentServer hangs up; a declared `Content-Length` is forwarded and a cut is a protocol error, never a short 200; unmatched routes log a redacted path instead of Fastify's full-URL 404 message (attempt-2 H1, an EDIT-4 guarantee). Attempt 3: the upstream is asked for `identity` and a compressed answer's length is never forwarded (it would have cut a gzip-served file short); a token that does not open is limited per address like every other route; an over-cap first chunk answers `502 {"error":"source_over_cap"}`; the served/aborted log carries a reason (`over_cap`, `upstream`, `client_closed`). **Superseded at EDIT-3 (ADR F17):** the route no longer streams; it reads every source whole (`capped-read.ts`) and answers only then, with the exact length or an error before any byte, within a 30 s default (`EDITOR_SOURCE_TIMEOUT_MS`), bounded by `EDITOR_SOURCE_CONCURRENCY` (4; 503 beyond). The legacy internal `/api/files/` URL is handed over as it is. Battery S1 shows the file fetched only by the service.

### EDIT-2.3 Profiles, sessions, and the key format (D13)
- `POST /api/documents/open` takes `profile: 'document' | 'template' | 'view'`, `documentRef`, `revision`, `mode` (`e` | `v`), `fileUrl`, `fileName`, `user`, and for `document`/`template` the panel URL. Allowed pairs: `document` and `template` only with `e`; `view` only with `v`. Each key component matches `[0-9A-Za-z_-]`; the key `<consumer>.<documentRef>.<mode><revision>` is at most 128 characters; a `.` anywhere in a component is refused.
- `fileUrl` must pass `safe-url` against the consumer's `fileHosts`. The GCS `bucket/object` form, `resolveDownloadUrl`'s signing with the service identity, `saveTo`, `transferToGcs`, and `generateUploadUrl` are removed; the `@google-cloud/storage` dependency goes unless another live path needs it (recorded either way).
- Profiles in a pure `buildEditorConfig(profile, session)`: `document` and `template` set `edit:true`, `permissions.modifyContentControl:false`, `permissions.protect:false`, keep DocumentServer's About and legal notices (licence terms 1 and 3, ADR), keep document content away from the built-in third-party plugins (translator, youtube, zotero, mendeley, ocr, speech, the marketplace; mechanism chosen here without modifying the image, ADR F5), `customization.forcesave:true`, and `editorConfig.plugins` registering the bridge plugin with per-session plugin data (the panel URL with the panel token in its fragment, D14), the panel URL's origin one of `panelOrigins`; `view` is today's view mode. Unit tests per profile.
- Legacy shape (E1): no `profile` → `view` or `legacy-edit`; `callbackUrl`, `saveTo`, or a GCS path refused with `legacy_field_removed`; `fileUrl` is the service's own internal `/api/files/` prefix or any https URL that passes `safe-url`'s address checks (a legacy-only consumer has no `fileHosts`). A legacy-only consumer sending `profile` is refused with `profile_not_allowed`.
- Sealed token: AES-256-GCM, random 96-bit nonce, a one-byte key id bound as additional authenticated data, payload (profile, user, key, file URL, panel URL, consumer id, expiry) capped at 4 KB before sealing; expiry at most 12 hours and never past the signed file URL's own expiry when the URL states one. `maxParamLength` raised to fit the cap; tests at maximum input sizes. `/editor/<token>`: a valid token renders the editor; an expired token from a known consumer renders the expired page linking to that consumer's `returnOrigin`; a tampered or undecryptable token renders the same page with no link and no detail.
- The in-memory session map, its cleanup timer, `GET /api/documents/:key/download`, and `GET /api/sessions` are removed. No database is added.
- Status: Done in code 2026-10-18. Profiles in `editor-config.ts`; keys in `document-key.ts`; sealed tokens in `session-token.ts` (a missing seal key is a 500 `seal_unavailable`, an oversized payload a 400); the session map, `/api/sessions`, `/api/documents/:key/download`, `storage.ts`, and `@google-cloud/storage` are gone (no other live path needed GCS). The legacy shape is refused from a profile-capable consumer (`profile_required`, review M7) so its keys always get the profile rules; an empty legacy `fileName` falls back to the URL's as before. `maxParamLength` set through `routerOptions`.

### EDIT-2.4 Callback verification and notifications (D13, E6)
- **Callback trust (fixes the 2026-10-16 09:20 `ERRORS.md` entry):** the OnlyOffice → service JWT is mandatory outside `EDITOR_ENV=local`; accepted from the `Authorization` header or the body `token`; HS256 pinned; a token carrying editor-config claims (`document`, `editorConfig`) is refused; `key`, `status`, `url`, `users`, and `actions` are taken from the verified payload, and a body field that disagrees is refused; the `url` origin must be one of a configured set of DocumentServer origins (`ONLYOFFICE_CALLBACK_URL_ORIGINS`, defaulting to the internal and public DocumentServer origins), set from what EDIT-1.5 measured; the token shape accepted is the one EDIT-1.5 recorded. Test: the editor page's own token used as a callback token is refused.
- Routing by the key's consumer id to the registered `callbackUrl`. Body: the document key, `documentRef`, `revision`, mode, status, `downloadUrl` (statuses 2 and 6, rewritten to DocumentServer's configured base), `users`, `actions` (status 1), and a `deliveryId`. Statuses 1, 2, 3, 4, 6, and 7 are forwarded; others are acknowledged and logged by status only.
- **Lock signals (battery U6, ADR F14):** a status-1 disconnect (`actions` type 0) means one connection ended, not that the user left: one user in two tabs produced connect, connect, disconnect while still connected in the other tab, and the two connects were indistinguishable apart from the token. The guide tells consumers to release an edit lock only when a status-1 notification's `users` list is empty or a status 4 / final status 2 arrives, never on a bare disconnect.
- `deliveryId` exists for statuses 2 and 6 only: SHA-256 (unkeyed, so secret rotation does not change it) over `key`, `status`, `lastsave`, and for status 6 `forcesavetype`, taken from the verified `payload`. These fields were measured stable across status-2 retries and distinct between saves (two force-saves carry different `lastsave`, U5). Status 6 is never retried (U5), so for it `deliveryId` only distinguishes saves. Never `url` or `changesurl` (re-signed on every send) and never the raw body (ADR F2); the consumer dedupes saves by it. Status-1, 3, 4, and 7 notifications carry no `deliveryId` and are idempotent by meaning (the consumer's lock logic treats a repeated connect as a renewal).
- Signing (headers and body shape per the EDIT-1 ADR: DocumentServer's own JWT arrives in `Authorization` with the body under `payload`; its download URL carries the public origin, ADR F2): `X-Editor-Timestamp`, `X-Editor-Delivery`, and `X-Editor-Signature: v1=<hex HMAC-SHA256 over "<timestamp>.<body>">`, one `v1=` per active secret during a rotation overlap. No redirects; timeout below DocumentServer's callback timeout (E6).
- Answers to DocumentServer per E6 (HTTP 503 to request a retry, ADR F1). `GET /api/documents/keys/:key/forgotten` (the key's consumer only) answers the forgotten file's download URL or `none`, and `DELETE` on it releases the file after the consumer stored it (U5 proved the commands).
- Status: Done in code 2026-10-18. `callback-auth.ts`, `notify.ts`, `reference/verify-notification.ts`. `downloadUrl` is forwarded for statuses 2 and 6 only; a force-save without `lastsave` gets a random `deliveryId` component (status 6 is never retried), a final save without it stays stable. Forgotten files answer `none` only for DocumentServer's "unknown key" and `502` with the named error for any fault (review H3), never a quiet `none`. Battery E2b (restart between edit and save) and E2c (503×2 and 401×2, then the save, one `deliveryId`).

### EDIT-2.5 Drop (D13)
- `POST /api/documents/keys/:key/drop` with `users` (the ids the consumer holds from status-1 notifications), consumer-authenticated, refused unless the key's consumer component is the caller; drives the command service's `drop` with its JWT; maps DocumentServer's result codes to named errors.
- Status: Done in code 2026-10-18. Errors mapped `1 → 404`, `3, 6 → 502` (DocumentServer or configuration fault), `2, 4, 5 → 409` (review M8). Battery E2d: a drop with edits gives the final save, without edits a closed notification; another consumer gets 403. A drop does not revoke an issued editor URL (stated in the guide and contract).

### EDIT-2.6 The editor page
- HTML-escape the title; escape `<`, `>`, `&`, U+2028, and U+2029 in the inline config JSON; a strict CSP with a per-response nonce allowing only DocumentServer's `api.js` origin for scripts and frames; the page carries nothing beyond what DocumentServer receives (the config, including the panel token per D14's accepted exposure).
- Status: Done in code 2026-10-18. `editor-page.ts`; `frame-ancestors` stays SA-1.7's follow-up, stated in the guide. Battery S1: no CSP violation in a real editor.

### EDIT-2.7 The consumer guide and reference verifier
- `docs/guides/consumer-integration.md` (new): profiles and allowed modes; the legacy shape and its removal condition; the key format and revision rules; sealed editor URLs, seal-key rotation, and the expired page; notifications (statuses, body, `deliveryId` and the consumer's dedupe rule, signature, a 5-minute timestamp window, secret rotation overlap, E6's retry semantics and measured horizon, the forgotten-files endpoint or the stated limit); drop; conversion (EDIT-3); plugin data (EDIT-5); a changelog naming the removed routes and fields (`/api/documents/:key/download`, `/api/sessions`, per-request `callbackUrl`, `saveTo`, GCS paths). `files.ts` upload behaviour is unchanged by EDIT.
- Reference verifier code (TypeScript, constant-time compare, timestamp window, delivery dedupe, key binding) in a snippet file the repo's tests import.
- Checked against UDOC-2.1's contract draft in Platform at this checkpoint.
- Status: Done 2026-10-18. `docs/guides/consumer-integration.md` and the reference verifier; checked against Platform's `contracts-draft/document-editing.md` 0.1.0-draft (UDOC-2.1), which was written alongside and revised with the same review fixes.

### EDIT-2.8 Acceptance (parent UDOC-1.2)
- Unit tests per profile on the built config, including the plugin registration and plugin data for `document` and `template`.
- On the pinned release, in a real editor: a `document` session shows no lock option, no Protection tab, and no built-in AI tab. (The parent's "panel docked right" is proven at EDIT-5.6 under proposed amendment A3; without A3's approval, UDOC-1.2 is reported open until then.)
- A panel URL on an unregistered origin is refused.
- A service restart between edit and save still delivers the save.
- With the consumer unavailable at the final save and then recovered within the measured retry horizon, the save arrives; a 401 from the consumer is retried, not acknowledged.
- A tampered or expired editor URL token shows the expired page; a token sealed with the previous seal key still opens until it expires.
- A key containing `.`, a key over 128 characters, and a `view` profile on an `e` key are each refused at `open`.
- A forged notification, a replayed save (same `deliveryId`), two genuine connect events by the same user (both delivered), and the editor page's token used as a callback token are each refused by the guide's reference verifier or the callback route.
- A title containing `</title><script>` and a plugin datum containing `</script>` render inert.
- Drop disconnects the editor and produces its final save, or a closed-without-changes notification when nothing changed.
- A `fileUrl` outside `fileHosts`, a private address, and a GCS path are refused.
- The legacy shapes still open: the battery replays the exact request bodies of `fastmail-connect` (`docs-proxy.ts:197-233`, view-only) and the Connect extension (`docs-api.ts:43-77`, editable, no callback) against the scratch stack; the dev deployment is additional evidence when it is up.
- The `ERRORS.md` entries for the unsigned notification, the editor page, the callback trust, and the file-URL trust are checked with `Resolved:` notes.
- Status: Met in code and on the pinned release, 2026-10-18. Unit and route tests: 192 (15 files) incl. `strict-routes.test.ts` and `startup.test.ts` under `EDITOR_ENV=production`; typecheck and lint clean. Battery records (EDIT-1's `2026-10-18.{md,json}` is unchanged): `docs/spikes/results/10.0.0.1/2026-10-18-0834.{md,json}` — the full battery on the attempt-1 code, 30 pass, 4 pass-with-finding (7cl, U1, U1t, U1d: the loose lock, as at EDIT-1), 6 recorded, 1 blocked (U13, waived), 0 fail — then `2026-10-18-partial-0907.{md,json}` — S0, S1, S2, E2a–E2e, U9 on the attempt-2 code, 9 pass — `2026-10-18-partial-0929.{md,json}` — S0, S1, S2, E2a–E2e after the attempt-3 fixes, 8 pass — and `2026-10-18-partial-0940.{md,json}` — the same items on the final code (after the attempt-4 nits), 8 pass (the review fixes touched only the service, which the EDIT-1 items and U9 do not exercise). Per bullet: no lock option, Protection, AI, or Plugins tab in a `document` session (E2a); an unregistered panel origin refused (E2e, route test); a restart between edit and save delivers (E2b); a consumer down (503) or refusing (401) then recovered gets the save, one `deliveryId` (E2c); tampered token → expired page (E2e), expired and previous-key tokens (route tests); `.` in a key, a key over 128, `view` on an `e` key refused (route tests, E2e); a forged or replayed notification, two connects, and the page token as a callback token refused (`notify.test.ts`, `callback-auth.test.ts`, `documents.test.ts`); a hostile title and plugin datum inert (`editor-page.test.ts`); drop gives the final save or a closed notification (E2d); a `fileUrl` outside `fileHosts`, a private address, and a GCS path refused (route and strict tests, E2e); the legacy flows still open, uploaded through `/api/files/upload` (S2); the four `ERRORS.md` entries resolved. Newly found: ADR F16 ("Remove content control" unwraps a field), carried to UDOC-3's D16 validation. Not deployed: no environment exists; `standalone-app` Phase 0 closes or is re-baselined before EDIT-2 deploys (it removes `/api/sessions` and `/api/documents/:key/download` and refuses the legacy shape from profile consumers).

**Checkpoint:** two reviewers (E8).

---

## EDIT-3 PDF conversion (UDOC-1.3)

**Goal:** a consumer converts a DOCX in its storage to PDF through OnlyOffice's ConvertService without the service keeping either file.

### EDIT-3.1 Endpoint
- `POST /api/documents/convert` (profile-capable consumers): `sourceUrl` and `uploadUrl`, each through `safe-url` (EDIT-2.2) against the consumer's `convertSourceHosts` and `convertUploadHosts`.
- The service sends ConvertService a JWT-signed request for the source; DocumentServer fetches it (its own request filtering on, verified in EDIT-1.5) and its `maxDownloadBytes` set to the input cap; the service then streams the result from DocumentServer's internal URL to the pinned upload address with a byte counter enforcing the output cap, and answers `{ size, sha256 }`.
- Status: Done in code 2026-10-18 (`apps/api/src/convert.ts`, route in `routes/documents.ts`). Deviation from the text above, recorded: DocumentServer does not fetch `sourceUrl` itself (EDIT-1.5 proved its filter is bypassed for signed requests, ADR F3); it reads the service's source route with a source token scoped to `convertSourceHosts` (the EDIT-2.2 mechanism), so the service fetches the source on the checked addresses under the input cap. The PDF is read whole from DocumentServer's internal URL (uncompressed, under the output cap, checked against its declared length) and only then uploaded to the pinned upload address with `PUT`, `Content-Type: application/pdf`, and its `Content-Length`, so the consumer's storage never receives part of a file (review: Codex M2); the answer is `{ size, sha256 }`. While DocumentServer answers "not finished" the same request is repeated each second until the deadline (its documented progress poll). A conversion's source token is admitted only while its conversion runs (review: Codex H1).

### EDIT-3.2 Bounds and errors
- Input cap (DocumentServer's `maxDownloadBytes`), output cap (stream counter), an overall timeout, and a per-consumer concurrency limit (in-process; one API instance per environment). Named errors: `source_url_refused`, `upload_url_refused`, `input_too_large`, `output_too_large`, `conversion_timeout`, `conversion_failed`, `upload_failed`, `busy`.
- The service writes nothing to disk; DocumentServer's cache retention for the converted output is recorded in the ADR (EDIT-1.6) and stated in the guide; only hosts and sizes are logged.
- Status: Done in code 2026-10-18. Caps: input `EDITOR_MAX_SOURCE_BYTES` and output `EDITOR_MAX_CONVERT_OUTPUT_BYTES` (each at most 100 MB, refused at start otherwise), deadline `EDITOR_CONVERT_TIMEOUT_MS` (90 s, under Cloudflare's 100 s proxy read timeout), `EDITOR_CONVERT_CONCURRENCY` per consumer (2) and `EDITOR_CONVERT_CONCURRENCY_TOTAL` (4). Files are held in memory whole and once (kept as received, sent on as 64 KiB views, never joined; a `Buffer` request body would have been copied by fetch, review attempt 2), so the ceiling is (`EDITOR_SOURCE_CONCURRENCY` + `EDITOR_CONVERT_CONCURRENCY_TOTAL`) × 100 MB, 800 MB by default plus transport buffers (review: Codex H2, Sonnet M5); EDIT-6 sizes the host for it. `EDITOR_CONVERT_TIMEOUT_MS` is refused above 95 s. An empty PDF is a failure; a consumer that hangs up cancels its conversion. Named errors as listed plus `source_unavailable` (the source host answered other than 200 or could not be reached; DocumentServer reports all of these as "download failed", so the source route records the reason under the conversion's id, `source-outcomes.ts`). Metadata addresses are now refused in every environment, `local` included (`safe-url.ts`). **Found by E3b, ADR F17:** a source download that ends part way, or a slow one, wedges DocumentServer's single converter, which also serves every editor open, for minutes or until a restart. The source route now reads every source whole before answering (bounded by `EDITOR_SOURCE_CONCURRENCY`, 4), so DocumentServer gets a complete file with its length or an error before any byte; `EDITOR_SOURCE_TIMEOUT_MS` lowered to 30 s, since a slow source holds the converter until then; a conversion that ends aborts its source read. DocumentServer's 24 h cache retention for the PDF is stated in the guide (ADR F8).

### EDIT-3.3 Acceptance (parent UDOC-1.3)
- The spike's field-and-block fixture converts with fonts embedded (`pdffonts`) and fields where the editor shows them (battery item).
- An http URL, a private address, a metadata address, an oversized input, a timeout, and an unreachable upload URL each answer their named error; a redirect from the source or upload host is not followed.
- The consumer guide documents the endpoint.
- Status: Met in code and on the pinned release, 2026-10-18. Battery `docs/spikes/results/10.0.0.1/2026-10-18-partial-2002.{md,json}` (all service items on the final code, 10 pass): E3a converts both field-and-block fixtures through the service, with fonts embedded (`pdffonts`), the field sentence as the editor shows it (`pdftotext`), size and sha256 matching the uploaded bytes, and the source and upload made by the service only; E3b answers a metadata source and upload, a redirecting source and upload (not followed), an input over the battery's 5 MB cap, a never-finishing source (20 s battery deadline), an unreachable upload, and a source that drops part way with their named errors, and a good conversion succeeds after all of them (ADR F17); S0–E2e pass again on the read-whole source route. An http URL and a private address are refused outside `local` only, proven by `strict-routes.test.ts` (conversion source and upload cases) and the route tests (the battery runs `local`). API: 220 tests. The guide documents the endpoint (§6).

**Checkpoint:** single reviewer (Sonnet).

---

## EDIT-4 Log redaction (UDOC-1.4)

**Goal:** no log line carries a URL that grants access. Scheduled first because the leaks were believed live in production; on 2026-10-17 the survey for its deploy found the hosted environment had been decommissioned on 2026-06-12 (see `deploy-edit-4.md`).

### EDIT-4.1 Remove the fields and scrub messages
- Drop OnlyOffice's callback `url` (`documents.ts:213`), the signed `fileUrl` (`:148`), and `callbackUrl` (`:262`, `:266`) from log fields; log the host only where it helps.
- Remove URLs from thrown error messages (`validateSourceUrl`'s messages at `storage.ts:80`–`:97` and any other `${url}` in an error) so `error: message` fields carry none.

### EDIT-4.2 Redaction configuration
- Add a pino `redact` configuration in `app.ts` covering `url`, `fileUrl`, `callbackUrl`, `downloadUrl`, `saveTo`, `sourceUrl`, `uploadUrl` at the top level and nested (`*.url` and the like); serialize `req.url` without path or query for the callback route, `/editor/*`, and `/plugins/udoc-bridge/s/*`.
- nginx: a `log_format` that logs an allowlisted path (the health check and DocumentServer's static asset routes) and masks every other path to its first segment, with no query string and no Referer, on `app.monolithdocs.com`'s server blocks; an explicit `error_log … error`. Cloudflare: record whether request logging (Logpush or similar) is enabled for the zone and what it captures; masking there is a follow-up if it is.
- A pino `logMethod` hook scrubs URLs from every string argument (Fastify logs a 500's raw error message as the line's `msg`), and an `err` serializer keeps only type, scrubbed message and stack, and codes.
- Status (2026-10-16): done in code and tests. nginx config validated (`nginx -t`) and exercised in an `nginx:1.27-alpine` container: 15 probes including `/editor/`, `/cache/files/`, `/doc/<key>/`, `/downloadas/`, `/printfile/`, `/upload/`, `/downloadfile/`, `//editor/` gave 0 secrets in the access log. **Cloudflare: Blocked** — this session has no Cloudflare API access (the connector is unauthorized), so whether the zone has Logpush or request logging, and what it captures, is unrecorded; Josh or a session with Cloudflare access must check the `monolithdocs.com` zone. `cloudflared` runs at its default log level (`tunnel-config.yml` sets none), which does not log request URLs.

### EDIT-4.3 Purge (owner-approved action)
- With Josh's approval, after the fix is deployed: rotate and purge, on the production and dev VMs, the API container's logs, the host nginx logs (`/var/log/nginx/`, including the error log), and DocumentServer's `onlyoffice-log` volume (`/var/log/onlyoffice`: its internal nginx error log and its WARN lines carrying `DOCID`), plus any sink they feed.
- Status (2026-10-17): **nothing to purge on a live host.** The runbook (`deploy-edit-4.md`) stopped at its survey: no VM, no IP, no live logs in project `monolith-docs`; the environment was decommissioned on 2026-06-12. The old logs survive only in the snapshots `monolith-docs-final-20260612` and `monolith-docs-dev-final-20260612` (also the only backup); whether to delete or scrub them is Josh's decision. The fix deploys with the first stand-up (EDIT-6).

### EDIT-4.4 Acceptance (parent UDOC-1.4)
- Status (2026-10-16): items 1 and 2 met in code (54 API tests, typecheck, lint; `ERRORS.md` entries `[x]` with `Resolved:` notes, marked not yet deployed); item 3 is a forward obligation on EDIT-2 and EDIT-3. EDIT-4 as a whole stays open for the Cloudflare check (blocked, EDIT-4.2) and the owner-approved deploy and purge (EDIT-4.3).
- Tests capture raw log output for an open failure, a callback failure, and a successful save, and a scan of the raw text finds no `http://` or `https://` URL with a path or query. (Also covered: a callback error whose message carries the URL, an upload and the file fetch, an auth failure, an unhandled 500, and direct logger calls.)
- The two logging `ERRORS.md` entries (`:213`; `:148`/`:262`/`:266`) are checked with `Resolved:` notes.
- EDIT-2 and EDIT-3 re-run the scan over their new routes before their own checkpoints.

**Checkpoint:** single reviewer (Sonnet).

---

## EDIT-5 The panel bridge plugin (UDOC-1.5)

**Goal:** one product-agnostic plugin that hosts the consumer's panel page and exposes a fixed operation set over `postMessage`.

### EDIT-5.1 Package, serving, and headers (E7)
- `apps/plugin/` with `config.json` (`panelRight`, `isVisual`, non-modal, inside mode) and a fixed GUID; built static assets.
- **One plugin origin per environment:** the API's own public origin, `API_PUBLIC_URL` (production `https://app.monolithdocs.com`, reached through nginx), recorded in the consumer guide as the origin each consumer's panel page checks and lists in `frame-ancestors` (D14), and as the origin the editor page and the plugin trust. Serving: a route under `/plugins/udoc-bridge/` and an nginx `location /plugins/udoc-bridge/` (proxy to the API) ahead of `location /`; added to the consumer-auth public paths (`auth.ts:69-82`); exempt from the per-IP limiter (and `trustProxy` set for the tunnel so the limiter sees client addresses); framing allowed for DocumentServer's public origin only (replacing `SAMEORIGIN` on this path), CORS on `config.json`; the API Dockerfile copies the built bundle.
- `scripts/check-plugin-deps.mjs` in the checkpoint verification list, plus a planted-import test; it moves into CI when DOC-DPP's verify workflow lands (proposed amendment A5).
- Status: Done in code 2026-10-18. **Deviation from E7, recorded:** `apps/plugin/` is plain JavaScript with `// @ts-check` and no build step (typechecked by `tsc --checkJs`, tested by Vitest), because `callCommand` serialises each operation's source into DocumentServer's sandbox, so the operations must be self-contained functions anyway; the image copies the five served files. `apps/api/src/routes/plugin.ts` serves exactly `config.json`, `index.html` (rendered with this environment's DocumentServer origin and a nonce), `bridge.js`, `commands.js`, and `icon.png`; consumer-auth and rate-limit exempt; nginx `location /plugins/udoc-bridge/` ahead of DocumentServer's catch-all; `TRUST_PROXY` (the proxies' addresses or CIDRs, proxy-addr's named private ranges, or a hop count of at most 3) so the limiter sees client addresses, judged on the function Fastify itself compiles from it (`@fastify/proxy-addr`): an entry it cannot parse, an IPv6 range broader than /32, or an entry covering more than one IPv4 /8 (a netmask, or an IPv6 range over the IPv4-mapped space such as `::ffff:0:0/96`) is a config problem (review attempts 1 and 2: Codex H1, Sonnet N2); `X-Forwarded-Host` is dropped so trusting a proxy never changes a consumer's hostname binding (review: Sonnet M1, Codex H1); the service refuses to start unless the five plugin files are readable regular files (Codex M1, attempt-2 Medium), and route registration fails rather than serving a partial plugin. Headers per ADR F18: `frame-ancestors` lists the whole frame chain (`'self'`, DocumentServer, registered consumer origins), not DocumentServer alone; the page's CSP allows `'unsafe-eval'`, `plugins.js`'s stylesheet by hash, style attributes, and `connect-src 'self'`, as DocumentServer's plugin API requires; frames only registered panel origins. `scripts/check-plugin-deps.mjs` is the plugin's `lint` (runs in `pnpm lint`): it also catches dynamic imports, workers, `importScripts`, preloads, frames, inline module scripts, imports or URLs that leave the plugin directory (`../`, root-relative `/x.js`), look-alike DocumentServer URLs (`{{DS}}.evil.com`), `<base>`, meta refresh, CSS `@import`, every script extension and dotfiles, nested `package.json` files, and optional or peer dependencies, each with a planted test.

### EDIT-5.2 The panel host
- Loads the consumer's panel page from the session's plugin data in an iframe; reloading or reopening the panel reloads it with the same plugin data. If EDIT-1.5 took the per-session `config.json` fallback, the panel URL comes from there.
- Status: Done 2026-10-18. `bridge.js` (a testable `createBridge` core, 7 behaviour tests, no `any`: hand-declared OnlyOffice types in `globals.d.ts`) loads `panelUrl` from `Asc.plugin.info.options` (U2's mechanism; the per-session `config.json` fallback was not needed), refuses a URL whose origin differs from `panelOrigin`, and sends `udoc.ready` on load and on `udoc.hello`. Every well-formed request gets exactly one response: an operation DocumentServer does not finish within 30 s answers `failed` and the queue moves on, a late answer is ignored, an uncloneable result still answers (review: Sonnet H2). The panel's close button arrives as `button(-1)`, and the plugin closes itself; the Plugins tab reopens it (E5e).

### EDIT-5.3 The operation set (D14)
- `getText`: every story part the plugin API exposes, with paragraph indexes and each field control's span, row id, and kind.
- `getSelection`.
- `insertField { rowId, label, value, inline | block }`: a `field:`/`block:` control with the D11 lock.
- `insertToken { token }`.
- `applySuggestion { paragraphIndex, context, occurrence, find, replace }`: located and re-verified, refused inside a field control, applied in one `callCommand` with track changes forced on and restored (the spike's 9c recipe).
- `addComment { paragraphIndex, context, occurrence, find, text, author }`.
- Every request carries an id; every answer is `{ id, ok, result | error }` with named errors (`stale_anchor`, `inside_field`, `not_found`, `unsupported`).
- Status: Done 2026-10-18 (`apps/plugin/commands.js`, 27 command tests against a fake `Api` that models a tracked deletion keeping or dropping its text; E5b in a real editor). Each operation is one `callCommand`, so one undo step (E5d), finding and re-verifying its anchor inside that command: a body paragraph index, the 0-based occurrence of `find`, and `context` around it. `ApiParagraph.Search` returns matches inside controls in document order (probed), so occurrences map onto its results, and character offsets are never used. `getText` also reads header and footer stories (E5f). `applySuggestion` takes an optional comment in the same command and places it on the inserted text by computing where the insertion went (from the paragraph's length change) and confirming it, answering `commentPlaced`, never a guessed place (review: Sonnet H1; E5b checks the comment ranges enclose the insertion, also when `find` contains `replace`); an empty `replace` is a pure deletion and takes no comment (`invalid_args`; review attempt 2 N1: an empty needle would have looped forever in the sandbox, E5b checks the saved deletion); track changes are restored in a `finally`; occurrences are counted without overlap, as `Search` counts them (E5b). Errors: the four named plus `invalid_args` and `failed`. Arguments refuse control characters, lone surrogates, and the signer-tag grammar in every text a panel writes (D15), with length caps; only the operation's own keys reach the sandbox.

### EDIT-5.4 Origin rules (D14)
- The plugin accepts messages only from the session's panel origin and only from its own iframe's `contentWindow`; it posts only with that exact `targetOrigin`. The battery's stub consumer page checks the plugin's origin and `event.source`. Nothing is ever posted with `targetOrigin` `*`.
- Status: Done 2026-10-18. The plugin accepts only `event.source === frame.contentWindow && event.origin === panelOrigin` and posts only to `panelOrigin` (a source test pins it); the stub panel page checks the plugin origin and `event.source`. E5c (run 2302): forged requests from the editor page, from DocumentServer's frame, and from a page on the panel's own origin in another window (framed by the panel itself, posting to the plugin) changed nothing and got no response. The bridge's ignored counter, which counts only `udoc.*` messages, moved by exactly 2 and then 1, so each one arrived and was dropped; the panel ignored a forged `udoc.ready`. Until review attempt 2 the same-origin case had not run: its forger, framed by the service's editor page, never loaded, and the counter also counted DocumentServer's own plugin traffic (run 2216's pass was not evidence for it).

### EDIT-5.5 Corpus
- Saved DOCX files under `scripts/editor-battery/corpus/`: a field in a table cell, in a header and in a footer, next to a `{token}`, at a line-wrap boundary; a token split across runs; a block around a multi-row table; a document with tracked changes on; a `{#loop}…{/loop}` spanning table rows in a template; a copied field.
- Status: Done 2026-10-18. `scripts/editor-battery/corpus/` holds the nine cases (generated by `src/corpus.mjs`, committed). A real-clipboard paste and a paste from another document are not in it: headless Chrome has no clipboard (ADR F10), and the simulated copy and paste stay in EDIT-1's 7p and 7x.

### EDIT-5.6 Acceptance (parent UDOC-1.5, and the panel item of UDOC-1.2)
- In a `document` session on the pinned release the panel is docked right.
- A stub consumer page inside the panel round-trips every operation.
- A message from any other origin is ignored on both sides; nothing is posted with `targetOrigin` `*`.
- Each corpus file survives an OnlyOffice save with its controls and tokens intact.
- One `applySuggestion` is one undo step; a stale anchor is refused.
- Closing and reopening the panel, and reloading the editor page three minutes after open, both bring the panel back working.
- If EDIT-1 took a fallback, this phase implements it instead, and the ADR and consumer guide record it before UDOC-3.4 starts in CRM.
- The dependency check fails on a planted `@monolith-platform/*` import (test).
- Status: Met on the pinned release, 2026-10-18. Battery evidence on the code after review attempt 2:
  - `docs/spikes/results/10.0.0.1/2026-10-18-partial-2242.{md,json}`: S0–S2, E2a–E2e, E3a–E3b, E5a, and E5d–E5f pass.
  - `2026-10-18-partial-2302.{md,json}`: E5a–E5c pass.
  - `2026-10-18-partial-2312`: E5b re-run with the attempt-3 checks (exactly one `w:del`, paragraphs located without `<w:pPr>`).
  - Between those runs, `commands.js` did not change; `bridge.js` changed only in which dropped messages it counts.
  - `partial-2216` predates the attempt-2 fixes, and its E5c pass was not evidence for the same-origin case. `partial-2257` is an intermediate failing run. Both are kept as history.
  - Per item:
  - **E5a:** the panel docked right (about 400 px) in a `document` session, the stub consumer page got `udoc.ready` with the six operations, no CSP violation.
  - **E5b:** every operation round-trips from the stub page, with the five refusals; comments land on the inserted text (also when `find` contains `replace`); repeated text is counted without overlap, and the "second pair" comment's range reads exactly the second "aa"; a pure deletion is saved as one `w:del` with no `w:ins`, and a comment on it is `invalid_args`; the saved file holds `field:r9` (`contentLocked`), `block:b9` (`sdtContentLocked`), the token, the tracked change, and both comments.
  - **E5c:** forged requests from the editor page, DocumentServer's frame, and a same-origin page in another window were ignored, and the counter moved by exactly 2 and then 1. The panel ignored a forged `udoc.ready`.
  - **E5d:** one suggestion is one undo step; a stale anchor is refused after a user edit.
  - **E5e:** close and reopen from the Plugins tab, and a reload 182 s after open, both bring the panel back working.
  - **E5f:** every corpus file survives a save with its controls and tokens intact, and `getText` reads the header and footer fields.
  - **E2a** now also checks that the Plugins tab offers only the panel.
  - **Tests:** the dependency check fails on a planted `@monolith-platform` import (`apps/plugin/check-deps.test.mjs`); API 230 tests, plugin 38.
  - **Fallbacks:** EDIT-1 took none, so none was implemented. New: ADR F18.

**Checkpoint:** two reviewers (E8).

---

## EDIT-6 Hosting and capacity (UDOC-1.6)

**Goal:** the editor runs where CRM's dev environment can reach it and be reached by it, sized and documented.

### EDIT-6.1 Hosting choice (decided: guidance E9)
- **Found 2026-10-17: no editor host exists in any environment** (decommissioned 2026-06-12; public hosts answer 530 or time out). EDIT-6 is a from-scratch stand-up and the first deploy of everything EDIT ships (EDIT-4 onward).
- **Decided by Josh 2026-10-18 (E9):** the OVH VPS, in the `monolith-dev` compose project, at `editor-dev.monolith.cx` behind the shared Caddy. GCP compute was exited on 2026-07-25 (VPSM), so the plan's earlier choice between GCE + Cloudflare Tunnel and DOC-DPP's target is moot; DOC-DPP's working-tree Phase 4 (another session's, uncommitted) still describes GCE and needs reconciling by its owner (handoff follow-up).
- Record the decision, the routing, and the operating rules in an ADR: `docs/adr/2026-10-18-editor-hosting.md`. One API instance per environment (the conversion, source-read, and rate limiters are in-process).
- Status: Done 2026-10-18. ADR `docs/adr/2026-10-18-editor-hosting.md`.

### EDIT-6.2 DocumentServer settings (ADR F3, F17)
- `FileConverter.converter.maxprocesscount` raised from 1 to 2, chosen for resilience (one wedged slot no longer stops everything), not measured.
- `externalRequest.directIfIn`: `jwtToken: false` with `allowList: ["http://editor-api:3020/"]`, so DocumentServer fetches directly only from the service's internal origin (the source route, legacy uploads, callbacks) and its private-address filter applies to everything else (defence in depth for F3). The API answers on `editor-api` in every deployment: a network alias on the VPS (the service is `editor-api-<env>`), in the root compose file, and in the battery.
- Acceptance: a battery item with DocumentServer's private addresses refused (the VPS setting) opens, edits, and saves a document through the service, converts a document, and opens a legacy upload, while a signed config naming a private address directly is refused; the existing service and bridge items still pass with the new settings.
- Status: Done 2026-10-18.
  - `infrastructure/onlyoffice/local-production-linux.json` and its README carry the settings.
  - `editor-api` is now the default `API_INTERNAL_URL`. Outside `EDITOR_ENV=local` the API refuses any other value (`DOCUMENTSERVER_DIRECT_ORIGIN`, test).
  - The root compose file and the battery give the API the `editor-api` alias. On the VPS the services are `editor-api-<env>` and `editor-documentserver-<env>`, and `editor-api` is an alias on the environment's own network (review M3). The check is an exact match, so a trailing slash or a path is refused (review M4).
  - **Battery E6a** (`2026-10-19-partial-0057`, after the review fixes; first passed in `-0005`):
    - S1, S2, E3a, and E5b pass with private addresses refused;
    - a signed configuration and conversion naming a private address directly are refused (`error -4`).
  - **Run `2026-10-18-partial-2339`:** S0–S2, E3a, E3b, and E5b pass with the new settings. Its E6a failed only on a settings check that read the wrong file (fixed). U12 now pins both its runs, so it still records DocumentServer's own default.

### EDIT-6.3 Converter probe and watchdog (ADR F17)
- The API: `GET /health/converter` converts a built-in sample DOCX to PDF through DocumentServer (fetched from the API's own internal origin, a fresh key each time) within 20 s and answers 200 or 503. It answers loopback callers only (by socket address, not a forwarded header) and Caddy never routes it, since each call takes a converter slot.
- The host: `infrastructure/vps/editor-converter-watch.sh`, run by cron every 5 minutes, calls the probe through `docker compose exec`. After two consecutive failures it waits for open editors to close (a bounded wait; a wedged converter already blocks saves and opens), then restarts DocumentServer in place (`docker compose restart`: the same container, no recreate; what an open editor had not saved is battery E6e's record), waits for font generation and the health check (F15), probes again, logs every step, and prints only alerts (cron mails them). It never touches anything but the editor's two services.
- Acceptance: unit and route tests for the probe; a battery item that wedges the converter (F17's dropped-source recipe, directly against DocumentServer), shows the probe failing, runs the watchdog against the battery stack, and shows the probe passing again afterwards.
- Status: Done 2026-10-18.
  - **The probe:** `probeConverter` and two routes in `routes/health.ts`, with tests: fresh keys, the sample, refusals, timeouts, loopback by socket only, one probe at a time. 234 API tests.
  - **The watchdog:** `infrastructure/vps/editor-converter-watch.sh`.
  - **Battery E6b** (`2026-10-19-partial-0129` on the final watchdog; also `-0057` after review attempt 1, first passed in `-0028`):
    - with both slots wedged, the probe answered 503 (`converter_unreachable`, 20 s);
    - run 1 counted one failure;
    - run 2 saw one open editor and waited;
    - after the editor closed, run 3 saw none, restarted DocumentServer, and waited for it to be ready;
    - the probe was 200 again about 3 minutes later (3 min 14 s in `-0057`);
    - the probe is 404 to a caller that is not loopback;
    - only alerts are printed for cron's mail (review M1).
  - The watchdog's other failure paths were simulated in review: the API down, an unwritable state directory, and a failed restart (review L1–L4).
  - **Battery E6e** (`-0057`, recorded): with a healthy converter, restarting DocumentServer in place while an editor held unsaved typing sent the final save (status 2) one second into the restart, with the typed text; the editor showed "Connection is lost". With a wedged converter this was not measured, so the watchdog waits for editors to close and alerts.
  - The live editor count comes from `info.json`'s `quota` (E6c).

### EDIT-6.4 Capacity
- Measure on the pinned release, on the battery stack: DocumentServer's and the API's memory idle and with 1, 3, and 6 editors open, and with conversions running; DocumentServer's container memory over font generation. Size the containers' memory limits from it (above the API's file ceiling, (`EDITOR_SOURCE_CONCURRENCY` + `EDITOR_CONVERT_CONCURRENCY_TOTAL`) × 100 MB, 800 MB by default) and record the VPS budget it takes. Concurrent-connection behaviour of the Community edition (its connection cap) is read from the pinned release, not press reports.
- Status: Recorded 2026-10-18 (battery E6c, `2026-10-19-partial-0022`).
  - **Memory:** DocumentServer 364 MiB idle and 368 MiB with six editors open and conversions running; the API 33–38 MiB.
  - **Connections:** the Community build reports no connection cap (`licenseInfo.connections` 2147483647). `quota.edit.connectionsCount` is the live count.
  - **Limits:** DocumentServer 3 GiB, the API 1.5 GiB (reasons in the hosting ADR).
  - **Not measured:**
    - large documents;
    - a converter on a 100 MB file;
    - the font-generation peak. These are revisited from the VPS health check's memory readings.

### EDIT-6.5 The VPS fragment
- `infrastructure/vps/`: the compose fragment (`editor-documentserver-<env>`, `editor-api-<env>`; `NODE_ENV=production`, `restart: unless-stopped`, memory limits, health checks, the env's network, the DocumentServer data volume), the Caddy block for `editor-dev.monolith.cx`, the env template (names only, never values), the watchdog and its cron line, and a README runbook: images (the editor API image from this repo, SHA-pinned in GHCR under `monolith-cx` per Platform's Forgejo exit, whose editor child FEX-2.4 does the cutover; DocumentServer by tag and digest), the first start (wait for font generation, F15), deploy with drain, rollback, and the Secret Lifecycle rule.
- The old GCE path (`infrastructure/gce/`, `infrastructure/cloudflare/`, `infrastructure/nginx/`) stays for the prod decision and the return-to-GCP plan; its README says so.
- Status: Done 2026-10-18.
  - `infrastructure/vps/`: the fragment (`docker compose config` passes), `Caddyfile.editor` (`caddy validate` passes on 2.10.2), `editor-api.env.example`, the watchdog, and `README.md` (the runbook).
  - **Battery E6d** (`2026-10-19-partial-0057`; first passed in `-0005`): a real Caddy serving the shipped block on the battery network routes the paths as designed:
    - `/health`, `/editor/*`, and the plugin go to the API;
    - `/api/*` is 403 and `/health/*` is 404;
    - DocumentServer's health check and JS API come from DocumentServer;
    - the editor page keeps its `Referrer-Policy: no-referrer` (review M2: Caddy sets none);
    - `/info/info.json` is refused with 403 (F7).
  - TLS, HSTS, the WebSocket, and DocumentServer's forwarded headers are proven at 6.7, not by E6d.
  - The fragment also sets `json-file` log rotation on both containers (review M5) and named volumes for DocumentServer's on-disk state (10.0.0.1 runs no PostgreSQL, RabbitMQ, or Redis of its own; checked). The runbook deploys with `up -d --no-deps` (review M6).
  - `CLAUDE.md` names the VPS as the hosted shape.

### EDIT-6.6 Secrets and the stand-up (environment: each step needs Josh's approval)
- The editor image in GHCR (Forgejo exit FEX-2.4) and the VPS's GHCR login (FEX-3); then the DocumentServer JWT, the seal keys, the consumer credentials, and the notification secrets for dev in 1Password, the VPS env file, and Google Secret Manager (`monolith-docs` project), together. DNS for `editor-dev.monolith.cx`, the Caddy block, the images pushed, the services started per the runbook, and the watchdog's cron line installed.
- Monitoring: the watchdog's cron line; both containers added to the box's `health-check.sh` critical list; cron mail checked deliverable; DocumentServer's memory and `OOMKilled` watched over its first font generation (E6c did not measure that peak). Caddy's error log for this host decided (ERRORS.md, 2026-10-18).
- Reachability: the API reaches DocumentServer and the consumers' hosts; DocumentServer reaches the API by compose name; browsers reach `editor-dev.monolith.cx`; CRM dev reaches the API by compose name.

### EDIT-6.7 Acceptance (parent UDOC-1.6)
- The editor opens from `crm-dev` with the panel loaded and a signed save notification reaches CRM. Under amendment A4 (approved 2026-10-16), a stub receiver on the `monolith-dev` network (verifying the signature with the guide's reference verifier) satisfies this at UDOC-1.6, and CRM's own receiver is proven at UDOC-3.3.
- The F2 re-verification behind the real proxy: the save `url` origin DocumentServer reports is one `ONLYOFFICE_CALLBACK_URL_ORIGINS` admits.
- Hosting and sizing are written down (ADR, runbook).

Two checkpoints: **6.1–6.5** (local; single reviewer, Sonnet) before anything touches the VPS, then **6.6–6.7** (the stand-up).

**Checkpoints:** as above (Sonnet).

---

## EDIT-7 Licence posture (UDOC-1.7, owner)

- Josh records the Developer Edition decision: buy (fold-in becomes possible, as a separate initiative) or stay an AGPL peer. The rest of UDOC assumes the peer arrangement. Recorded in guidance and the parent's Owner rulings.

---

## Close-out

- Phase close-out per `/initiative phase-close`: DeepSeek + Sonnet + Codex (E8); every parent UDOC-1 acceptance item shown with evidence; the consumer guide matches UDOC-2.1; Platform's `integration-status` for `monolith-docs-editor` is UDOC-2.2's (coordinated, not duplicated); the parent plan's UDOC-1.x statuses, registry, ROADMAP, and handoff updated; this initiative moved to `complete/`.

---

## Estimates

| Phase | Weeks |
|---|---|
| EDIT-0 | 0.1 |
| EDIT-4 | 0.3 |
| EDIT-1 | 1–1.5 (harness rebuild and the unproven items are the bulk) |
| EDIT-2 | 1.25–1.75 (adds the callback and URL-trust fixes and the forgotten-files path) |
| EDIT-3 | 0.5 |
| EDIT-5 | 0.75–1 |
| EDIT-6 | 0.25–0.5 (excluding DOC-DPP's own work) |
| **Total** | **≈ 4.2–5.7**; without EDIT-0, ≈ 4–5.5 for UDOC-1 itself, the parent's UDOC-1 estimate as amended (A2, from 3.5–5) |

## Blockers and dependencies

- EDIT-6 depends on a reachable editor host for `crm-dev` (DOC-DPP planning; Platform DPP Phase 5) and on a CRM notification receiver for its last acceptance item.
- The Word desktop item in EDIT-1.5 needs a machine with Word, or Josh's written waiver.
- UDOC-2.1's contract draft (Platform) is written alongside EDIT-2 and EDIT-5.
- `standalone-app` Phase 0 closes or is re-baselined before EDIT-2 is deployed.
- Removing the legacy open shape (E1) depends on `fastmail-connect` and the Connect extension migrating; not an EDIT acceptance.

## Assumptions

- The parent's decisions and Risks stand as written on 2026-10-16, with amendments A1–A5 (approved 2026-10-16).
- One API instance per environment.
- The DocumentServer image is used unmodified.

## Unresolved errors

- Open in `ERRORS.md` and fixed here: the unsigned notification, the editor page, the callback trust, and the file-URL trust (EDIT-2); the logged URLs and the callback `url` (EDIT-4).
- Open in `ERRORS.md` and **not** in scope: the upload handler's missing magic-byte check (`files.ts:58-90`, 2026-04-19).
- **New, found in plan review attempt 1 and logged 2026-10-16 09:20:** the callback JWT not bound to the body (`documents.ts:182`, `:194-217`) and the consumer-supplied GCS path signed with the service identity plus `saveTo` to any bucket (`storage.ts:109-125`).
