# Handoff — Editor Service for Unified Document Authoring (EDIT)

- **Updated:** 2026-10-25
- **Lane / status:** active / `active` (owner-approved 2026-10-16)
- **Parent:** Platform ecosystem initiative `unified-document-authoring` (UDOC), phase UDOC-1. EDIT-*n* implements UDOC-1.*n*.
- **Plan:** `.ai/initiatives/active/udoc-editor-service/plan.md` · **Guidance:** `guidance.md` (local decisions E1–E8)

## Where things stand

| Phase | State | Commit |
|---|---|---|
| EDIT-0 (charter) | Done | `0158323` |
| EDIT-4 (log redaction) | Code-complete and reviewed; not deployed (no hosted editor since the 2026-06-12 decommission) | `9f54904`, `28a27d9` |
| EDIT-1 (OnlyOffice 10.0.0.1 and the battery) | Done (U13 waived by Josh) | `dfbb48e` |
| EDIT-2 (UDOC-1.2) | Code-complete 2026-10-18; not deployed | `c7bfa21` |
| EDIT-3 (UDOC-1.3) | Code-complete 2026-10-18; not deployed | `0f70bf0` |
| EDIT-5 (UDOC-1.5) | Code-complete 2026-10-18; not deployed | `381d50b` |
| EDIT-6 (UDOC-1.6) | 6.1–6.5 (the local half) code-complete and reviewed 2026-10-18; 6.6–6.7 (the VPS stand-up and acceptance) await Josh's approval step by step | `deca209` |

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
  - (Superseded at EDIT-3, ADR F17: the route now reads each source whole before answering, within 30 s, at most 4 at once.)
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

### What EDIT-3 changed

- **Conversion:** `POST /api/documents/convert` (profile consumers) takes `sourceUrl`, `uploadUrl`, and `fileType`, and answers `{ size, sha256 }`. Named errors are listed in guide §6.
  - DocumentServer reads the source through the source route, with a token scoped to `convertSourceHosts` that is admitted only while the conversion runs.
  - The PDF is read whole and checked, then uploaded with `PUT` and its exact length to the pinned upload address. The consumer's storage never receives part of a file.
  - "Not finished" is re-polled until the deadline: 90 s, at most 95 s.
  - Limits: 2 conversions per consumer, 4 in total.
  - A caller that hangs up cancels its conversion.
- **ADR F17 (found by battery E3b):** a source download that ends part way, or a slow one, wedges DocumentServer's single converter for minutes or until a restart. The converter also serves every editor open.
  - The source route now reads every source whole before answering (`capped-read.ts`; at most 4 reads at once; 30 s).
  - DocumentServer gets a complete file or an error before any byte.
- **Memory:** each file is held once (never joined or copied). The ceiling is (source reads + conversions) × 100 MB, 800 MB by default.
- **Metadata addresses:** refused in every environment.
- **Records:** guide §6, contract 0.2.0-draft §5, ADR F17, and the EDIT-6 follow-ups: raise `maxprocesscount`, add a converter health check, set a container memory limit.
- **Reviews:** `reviews/review-edit-3-attempt-{1,2,3}-{sonnet,codex}.md`. Attempt 3: Codex PASS, Sonnet PASS-WITH-NITS (applied).
- **Battery:** `2026-10-18-partial-2002`, 10 pass.
- **Correction:** a cleanup glob briefly deleted EDIT-2's three committed `-partial-*` records from the worktree. They were restored byte-identical from `c7bfa21`; the review caught it.

### What EDIT-5 changed

- **The plugin, `apps/plugin/`:**
  - It is AGPL code, and the API serves it from `/plugins/udoc-bridge/`.
  - It is plain JavaScript with `// @ts-check`: no build step, no runtime dependencies.
  - Its lint is `scripts/check-plugin-deps.mjs`.
  - Recorded deviation from E7: no TypeScript build, because `callCommand` serialises each operation's source into DocumentServer's sandbox.
  - The API serves exactly five files. The service refuses to start unless they are readable regular files.
- **The bridge (`bridge.js`, `createBridge`):**
  - It frames the consumer panel named in the session's plugin data.
  - It accepts a message only from that frame's window and the registered panel origin, and posts only to that origin.
  - Requests run one at a time. Each settles once: by DocumentServer's answer, or after 30 s as `failed`.
  - `udocBridgeStats.ignored` counts dropped `udoc.*` messages.
  - Closing the panel goes through `button(-1)` and `executeCommand('close')`.
- **Operations (`commands.js`, protocol 1):**
  - `getText`, `getSelection`, `insertField`, `insertToken`, `applySuggestion`, and `addComment`.
  - Each operation is one `callCommand` and one undo step.
  - Anchors are a body paragraph index, a non-overlapping occurrence, and context, re-verified inside the command.
  - A suggestion's comment is placed on the inserted text by calculation, or answered `commentPlaced: false`.
  - An empty `replace` is a pure deletion and takes no comment.
  - Every text a panel writes refuses control characters, lone surrogates, and the signer-tag grammar, with caps.
- **Headers (ADR F18):**
  - `frame-ancestors` lists the whole frame chain.
  - The page's CSP adds `'unsafe-eval'`, `plugins.js`'s style hash, `style-src-attr 'unsafe-inline'`, and `connect-src 'self'`.
  - `config.json` carries CORS for DocumentServer.
  - nginx has `location /plugins/udoc-bridge/`.
- **`TRUST_PROXY`:**
  - The value is proxy addresses or CIDRs, a named private range, or a hop count of at most 3.
  - It is judged on the function `@fastify/proxy-addr` (Fastify's own, now a direct dependency) compiles from it. An unparseable entry, an IPv6 range broader than /32, or anything covering more than one IPv4 /8 is refused.
  - `X-Forwarded-Host` is dropped before anything reads it.
- **Docs:**
  - consumer guide §7 (the panel);
  - ADR F18;
  - E7 amended;
  - Platform contract `document-editing.md` 0.3.0-draft, §6.

### EDIT-5 verification

- **Tests:**
  - API: 230 tests; typecheck and lint clean.
  - Plugin: 38 tests (27 command tests, 7 bridge tests, 4 dependency-check tests); `tsc --checkJs` and the dependency check clean.
- **Battery on 10.0.0.1:**
  - `2026-10-18-partial-2242`: S0–S2, E2a–E2e, E3a–E3b, E5a, and E5d–E5f pass.
  - `-partial-2302`: E5a–E5c pass.
  - `2026-10-18-partial-2312`: E5b with the attempt-3 checks.
  - `-partial-2216` predates the attempt-2 fixes. Its E5c pass was not evidence for the same-origin case: that forger never loaded.
  - `-partial-2257` is an intermediate failing run.
- **Reviews:**
  - Attempts 1 and 2: FAIL from Sonnet and Codex.
  - Attempt 3: PASS-WITH-NITS from both. Every finding applied, including the Lows and nits.
  - Records: `reviews/review-edit-5-attempt-{1,2,3}-{sonnet,codex}.md`.
  - DeepSeek is still unavailable.

### What EDIT-6.1–6.5 changed (the local half)

- **Hosting, decided by Josh 2026-10-18 (guidance E9; ADR `docs/adr/2026-10-18-editor-hosting.md`):**
  - the OVH VPS, in the `monolith-dev` compose project, as `editor-documentserver-dev` and `editor-api-dev`;
  - the public host `editor-dev.monolith.cx`, behind the shared Caddy;
  - why: GCP compute was exited (VPSM), so GCE was not chosen.
- **DocumentServer's settings (6.2, F3 and F17):**
  - `directIfIn` is `jwtToken: false` with the allow-list `http://editor-api:3020/`, and private addresses are refused;
  - `maxprocesscount` is 2;
  - the API answers on `editor-api` everywhere, and outside `EDITOR_ENV=local` it refuses any other `API_INTERNAL_URL`.
- **The converter probe and the watchdog (6.3, F17):**
  - `GET /health/converter` answers loopback only.
  - `infrastructure/vps/editor-converter-watch.sh`, run by cron, restarts DocumentServer in place after two failures, once editors have closed (at most 15 minutes). It logs every step and prints only alerts.
- **Capacity (6.4):** DocumentServer about 370 MiB and the API under 40 MiB, idle and with six editors open. The limits are 3 GiB and 1.5 GiB. The Community build reports no connection cap.
- **The VPS fragment (6.5):** `infrastructure/vps/` holds the compose fragment, the Caddy block, the env template, the watchdog, and the runbook README.
- **Found:**
  - DocumentServer 10.0.0.1 runs no PostgreSQL, RabbitMQ, or Redis of its own.
  - The live editor count is `info.json`'s `quota.*.connectionsCount`.
  - A restart in place, with a healthy converter, saves what an open editor typed (E6e).
  - Caddy's error log records full request URIs (a new `ERRORS.md` entry).

### EDIT-6 local verification

- **Tests:** 234 API tests and 38 plugin tests; typecheck and lint clean. Compose (the root, the battery, and the fragment) and `caddy validate` pass.
- **Battery on 10.0.0.1:**
  - `2026-10-18-partial-2339`: S0–S2, E3a, E3b, and E5b with the new settings; U12 still records DocumentServer's own default.
  - `2026-10-19-partial-0022`: E6c, capacity.
  - `2026-10-19-partial-0057`: E6a, E6b, and E6d pass and E6e is recorded, after the review fixes.
  - `-0005` and `-0028` are earlier passes.
- **Review:** Sonnet, attempt 1 PASS-WITH-NITS (6 Medium, 11 Low, every finding applied); attempt 2 PASS-WITH-NITS (2 Low, 9 nits, all applied; E6b re-run on the final watchdog: `2026-10-19-partial-0129`, pass). Records: `reviews/review-edit-6-local-attempt-*-sonnet.md`.

## Blockers and open decisions (Josh)

- **Deploy gate:** EDIT-2 changes the headless API: it removes two routes and refuses the legacy shape from profile consumers. `standalone-app` Phase 0 must close or be re-baselined before EDIT-2 is deployed.
- **No environment exists.** EDIT-6.6 is the stand-up on the VPS (runbook `infrastructure/vps/README.md`), and each step needs Josh's approval:
  - secrets in 1Password, the env files, and Secret Manager;
  - DNS for `editor-dev.monolith.cx`;
  - the files and compose merge;
  - starting DocumentServer, then the API;
  - Caddy, including its error-log decision;
  - the watchdog's cron line and the `health-check.sh` entry.
- **Before the first deploy:**
  - the editor image: EGM-2 (this repo's `github-migration`) adds the `Images` workflow, which pushes `ghcr.io/monolith-cx/editor-api:<sha>`, and names it in the compose fragment. The image path is ready (EGM-2.2, 2026-10-25): the first image is `ghcr.io/monolith-cx/editor-api:43784d4ac36ac1818e983a392be35b71ad866023@sha256:622275c39c7df9c57365f908e8a83b404ed8e83e3cc595f8a2df715d8027c4f1`, and the package is private, so the box needs the token pull;
  - the box's pull: Platform FEX-4.1, `vps-deploy.sh`'s short-lived GHCR pull (no login kept on the box); until it lands, the runbook's by-hand pull;
  - a decision on Caddy's error log for this host (`ERRORS.md`).
- **Cloudflare (EDIT-4.2):** still blocked.
- **DeepSeek reviewer:** unavailable until `op` is signed in on this host.

## Errors

- Four `ERRORS.md` entries were resolved in code, not deployed: the unsigned notification, the editor page, callback trust, and file-URL trust.
- No new unresolved errors were found.
- F16 is a design finding, recorded in the ADR; it is not a defect.
- EDIT-3: one new unresolved error logged in `ERRORS.md` (2026-10-18 13:09): DocumentServer's converter wedges on a partial or slow source download (ADR F17). Known triggers are prevented in the service; recovery (health check and restart) is EDIT-6's.
- EDIT-5: no new unresolved errors. Two defects were found and fixed in this checkpoint: the empty-`replace` loop and the `TRUST_PROXY` breadth. Nothing was added to `ERRORS.md`.
- EDIT-6 (local half):
  - **New unresolved entry** in `ERRORS.md` (2026-10-18 17:58): the shared Caddy's error log records full request URIs, editor tokens included. It was observed in a container, and is decided at the stand-up.
  - **Updated entries:** DocumentServer's logs (retention is the image's logrotate) and the F17 converter (recovery built and proven). Both stay open until deployed.

## Next step

- EDIT-6.1–6.5 are committed and on GitHub `main`. `main` is protected since EGM-1: every change lands by PR with the `checks` check green.
- Then EDIT-6.6, once EGM-2 and FEX-4.1 are done, the VPS stand-up, step by step with Josh's approval per the runbook.
- Then EDIT-6.7, the acceptance: a stub consumer on `monolith-dev`, the editor with its panel through `editor-dev.monolith.cx`, a signed save verified, and F2's save-URL origin.

## Follow-ups noted

- `CLAUDE.md`'s reviewer lines carry another session's uncommitted edit that names MiniMax, which is retired. Reconcile them with `.ai/iddp/config.json` when that edit is resolved.
- SA-1.7 (editor-page `frame-ancestors`) is still a candidate follow-up; the guide states it.
- EDIT-6:
  - The in-process limiters must move before running several API instances.
  - DOC-DPP's working-tree Phase 4 (another session's, uncommitted) still describes GCE; its owner reconciles it with E9.
  - The editor image's CI is EGM-2 (`.github/workflows/images.yml`); `vps-deploy.sh` with `--no-deps` is still open (DOC-DPP, and Platform's FEX-4.1 for the pull).
  - The font-generation memory peak and large-document conversions were not measured; watch them on the box.
  - `standalone-app`'s plan and guidance (another session's files) still describe the default `API_INTERNAL_URL` as `http://api:3020`; since EDIT-6.2 it is `http://editor-api:3020`. Their owner reconciles it.
- ADR F16's question, whether the plugin can withdraw "Remove content control", was not probed at EDIT-5 and stays open. UDOC-3's D16 validation is the control either way.

## Commit state

- Committed on `main`, and on GitHub since EGM-0.4 (2026-10-19): `0158323`, `9f54904`, `28a27d9`, `dfbb48e`, `5e5baba`, `c7bfa21` (EDIT-2, with Josh's approval 2026-10-18; Platform `61babd8`).
- `0f70bf0` (EDIT-3, with Josh's approval 2026-10-18; Platform `eb4b8ab`).
- `381d50b` (EDIT-5, with Josh's approval 2026-10-18; Platform `5c83e07`).
- `deca209` (EDIT-6.1–6.5, with Josh's approval 2026-10-18; Platform `9fc33ff`). After it: the image registry corrected to GHCR (Platform's Forgejo exit `5edb756`), committed as `44d097b`. From 2026-10-25 the EDIT-6.6 prerequisites cite EGM-2 and FEX-4.1, through the EGM-2 PR.
- Older sessions' uncommitted work stays out:
  - `.ai/handoffs/standalone-app.md` and `.ai/iddp/config.json`;
  - the standalone-app plan and its review files;
  - `deploy-pipeline-parity/*`, `.gitignore`, and `infrastructure/gce/teardown.sh`;
  - `CLAUDE.md`'s reviewer lines and the other hunks of `.ai/registry.yml`.
