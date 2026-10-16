# Editor Service for Unified Document Authoring — Execution Plan

**Initiative ID:** udoc-editor-service
**Abbreviation:** EDIT
**Owner:** josh
**Status:** Active — drafted 2026-10-16; plan review attempt 1 **FAIL** (3 High, 12 Medium, 8 Nit), attempt 2 **PASS-WITH-NITS** (9 Medium, 7 Nit; `reviews/review-plan-attempt-{1,2}.md`), every finding applied the same day; **owner-approved 2026-10-16** with parent amendments A1–A5; moved to `active/`. Next: EDIT-4
**Last updated:** 2026-10-16
**Guidance:** [guidance.md](./guidance.md)
**Parent ecosystem initiative:** `unified-document-authoring` (UDOC), phase UDOC-1 — `~/dev/monolith-platform/.ai/ecosystem/initiatives/active/unified-document-authoring/plan.md`
**Numbering:** EDIT-*n* implements UDOC-1.*n*; EDIT-0 is this initiative's charter.

Estimates are engineering weeks for one senior developer working with Claude.

---

## Phase Overview

| Phase | Parent | Title | Status | Depends on |
|---|---|---|---|---|
| EDIT-0 | — | Charter, re-scope of `standalone-app`, plan review | Done 2026-10-16 | — |
| EDIT-4 | UDOC-1.4 | Log redaction (scheduled first: it closes live leaks) | Pending | EDIT-0 |
| EDIT-1 | UDOC-1.1 | Upgrade and the extended battery re-run | Pending | EDIT-0 |
| EDIT-2 | UDOC-1.2 | Profiles, stateless sessions, signed notifications, drop, the editor page | Pending | EDIT-1 (pinned release, measured retry behaviour), EDIT-4; UDOC-2.1 drafted alongside; `standalone-app` Phase 0 closed or re-baselined before EDIT-2 deploys |
| EDIT-3 | UDOC-1.3 | PDF conversion | Pending | EDIT-1, EDIT-2 (consumer registry, URL validator) |
| EDIT-5 | UDOC-1.5 | The panel bridge plugin | Pending | EDIT-1 (unproven items answered), EDIT-2 (profiles, plugin data) |
| EDIT-6 | UDOC-1.6 | Hosting and capacity | Pending | EDIT-2, EDIT-3, EDIT-5; a hosted path from DOC-DPP or the proven GCE path |
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

### EDIT-1.2 Rebuild the harness as `scripts/editor-battery/` (E3)
- A workspace package with: a scratch compose project (DocumentServer at the pinned tag, a scratch build of `apps/api`, a stub consumer serving fixtures, a notification receiver that records and can be told to fail or answer any status, a panel page, and an upload target); fixture generators (the spike's field-and-block fixture in `contentLocked` and `sdtContentLocked` variants, tables, header and footer fields); Playwright drivers using real keyboard and mouse input; a runner that writes `docs/spikes/results/<release>/<date>.{md,json}` with pass/fail and evidence per item.
- Loopback-only ports, random scratch secrets, strict timeouts.
- Acceptance: one command runs the whole battery from a clean checkout and tears down after itself.

### EDIT-1.3 Pin and upgrade
- Choose the newest Community tag (E2); pin tag and digest in `docker-compose.yml` and wherever the GCE environment files name the image; the existing tests pass; a local open/edit/save round trip works on the new release.

### EDIT-1.4 Re-run the spike's proven items on the pinned release
- Items 3, 4, 5, 7, 8, and 9a–9e as defined in the spike document.
- Items 3, 4, 7, and 8 again with inline fields locked **`contentLocked`** (D11), plus: deleting a sentence containing a field, copy-paste duplicating a field, and cut-and-paste of a field.

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
- DocumentServer's own request filtering (private-address refusal for `document.url` and conversion sources), its `maxDownloadBytes` limit, and its cache retention for edited and converted files.
- A version DOCX opened, edited, and saved in **Word desktop** and reopened in OnlyOffice. Needs a machine with Word; record who ran it and where. If it cannot be run, EDIT-1 stays open unless Josh waives this item in writing (recorded here).

### EDIT-1.6 ADR, fallbacks, registries
- `docs/adr/<date>-onlyoffice-release-and-licence.md`: the pinned release and digest, why, the release's AGPL additional terms and our posture (image unmodified; our plugin served separately), DocumentServer's cache retention, the measured callback horizon, and each fallback taken (parent Risks) with its evidence.
- Update the Stack line in `CLAUDE.md` (and reconcile its reviewer names with `.ai/iddp/config.json` and its "session TTL" rule with D13), `README.md` where it names 8.3, and the `tech_stack` line of `monolith-docs-editor` in Platform's `docs/ecosystem/project-registry.yaml`.
- Acceptance (parent UDOC-1.1): the script's output for every item above is saved in the repo; the ADR is in `docs/adr/`; any failure either takes the fallback named in the parent's Risks (recorded in the ADR) or stops EDIT and reopens D2 in the parent.

**Checkpoint:** single reviewer (Sonnet).

---

## EDIT-2 Profiles, sessions, notifications, and the editor page (UDOC-1.2)

**Goal:** consumers open stateless per-open sessions by named profile, get signed notifications that survive restarts and short outages, can drop a key, and the editor page is safe to render.

### EDIT-2.1 Configuration and secrets (E4, E5)
- Fold every `process.env` read (`consumers.ts:87,92,106`, `server.ts:27,31`, `files.ts:36-37`) into `config.ts`.
- `EDITOR_ENV` with strict-by-default behaviour (E4); seal keys; notification secrets (current and previous) resolved from `notificationSecretRef`; the DocumentServer JWT secret's strictness.
- Consumer registry: `profiles`, and for a profile-capable consumer `callbackUrl` (https, public address at load), `notificationSecretRef`, `panelOrigins`, `fileHosts`, `convertSourceHosts`, `convertUploadHosts`, `returnOrigin`; consumer ids restricted to `[0-9A-Za-z_-]`. A legacy-only entry stays valid (E5).
- Tests: `validateConsumersConfig` over `infrastructure/environments/{dev,prod}/env.example`'s `CONSUMERS` passes unchanged; a profile-capable entry missing a field fails; startup refuses each weak secret outside `EDITOR_ENV=local`.
- Each consumer's `notificationSecretRef` names its environment variable outright (e.g. `EDITOR_NOTIFY_SECRET_FASTMAIL_CONNECT`, plus an optional `<name>_PREVIOUS`); no name is derived from the id.
- `callbackUrl` is checked as https at load and its resolution only warned on; it is resolved and pinned through `safe-url` at every delivery.
- `EDITOR_ENV` also governs the `/files/` fixture route (only under `local`) and HSTS (everything but `local`). The dev and production VM env files (`infrastructure/environments/*/env.example` and the VMs' `.env`) gain `EDITOR_ENV` and the new secrets **before** EDIT-2 deploys, or the service refuses to start.
- Secrets created in 1Password and Secret Manager for dev; names in `CREDENTIALS.md` and the guide.

### EDIT-2.2 A resolving URL validator
- `apps/api/src/safe-url.ts`: parse, require https (the legacy internal `/api/files/` prefix is the one exception, matched exactly against `API_INTERNAL_URL`), check the host against the caller's allowlist, resolve DNS and refuse if **any** address is private, loopback, link-local, CGNAT (100.64/10), unique-local IPv6 (fc00::/7), IPv4-mapped IPv6 of any of those, unspecified, or a metadata name (`metadata.google.internal`, 169.254.169.254); return the pinned address for the fetch; fetches use `redirect: 'manual'`. Replaces `validateSourceUrl` and its `://api:` / `://onlyoffice` substring exemption.
- Error messages never include the URL (EDIT-4).

### EDIT-2.3 Profiles, sessions, and the key format (D13)
- `POST /api/documents/open` takes `profile: 'document' | 'template' | 'view'`, `documentRef`, `revision`, `mode` (`e` | `v`), `fileUrl`, `fileName`, `user`, and for `document`/`template` the panel URL. Allowed pairs: `document` and `template` only with `e`; `view` only with `v`. Each key component matches `[0-9A-Za-z_-]`; the key `<consumer>.<documentRef>.<mode><revision>` is at most 128 characters; a `.` anywhere in a component is refused.
- `fileUrl` must pass `safe-url` against the consumer's `fileHosts`. The GCS `bucket/object` form, `resolveDownloadUrl`'s signing with the service identity, `saveTo`, `transferToGcs`, and `generateUploadUrl` are removed; the `@google-cloud/storage` dependency goes unless another live path needs it (recorded either way).
- Profiles in a pure `buildEditorConfig(profile, session)`: `document` and `template` set `edit:true`, `permissions.modifyContentControl:false`, `permissions.protect:false`, the built-in AI plugin disabled, `customization.forcesave:true`, and `editorConfig.plugins` registering the bridge plugin with per-session plugin data (the panel URL with the panel token in its fragment, D14), the panel URL's origin one of `panelOrigins`; `view` is today's view mode. Unit tests per profile.
- Legacy shape (E1): no `profile` → `view` or `legacy-edit`; `callbackUrl`, `saveTo`, or a GCS path refused with `legacy_field_removed`; `fileUrl` is the service's own internal `/api/files/` prefix or any https URL that passes `safe-url`'s address checks (a legacy-only consumer has no `fileHosts`). A legacy-only consumer sending `profile` is refused with `profile_not_allowed`.
- Sealed token: AES-256-GCM, random 96-bit nonce, a one-byte key id bound as additional authenticated data, payload (profile, user, key, file URL, panel URL, consumer id, expiry) capped at 4 KB before sealing; expiry at most 12 hours and never past the signed file URL's own expiry when the URL states one. `maxParamLength` raised to fit the cap; tests at maximum input sizes. `/editor/<token>`: a valid token renders the editor; an expired token from a known consumer renders the expired page linking to that consumer's `returnOrigin`; a tampered or undecryptable token renders the same page with no link and no detail.
- The in-memory session map, its cleanup timer, `GET /api/documents/:key/download`, and `GET /api/sessions` are removed. No database is added.

### EDIT-2.4 Callback verification and notifications (D13, E6)
- **Callback trust (fixes the 2026-10-16 09:20 `ERRORS.md` entry):** the OnlyOffice → service JWT is mandatory outside `EDITOR_ENV=local`; accepted from the `Authorization` header or the body `token`; HS256 pinned; a token carrying editor-config claims (`document`, `editorConfig`) is refused; `key`, `status`, `url`, `users`, and `actions` are taken from the verified payload, and a body field that disagrees is refused; the `url` origin must be one of a configured set of DocumentServer origins (`ONLYOFFICE_CALLBACK_URL_ORIGINS`, defaulting to the internal and public DocumentServer origins), set from what EDIT-1.5 measured; the token shape accepted is the one EDIT-1.5 recorded. Test: the editor page's own token used as a callback token is refused.
- Routing by the key's consumer id to the registered `callbackUrl`. Body: the document key, `documentRef`, `revision`, mode, status, `downloadUrl` (statuses 2 and 6, rewritten to DocumentServer's configured base), `users`, `actions` (status 1), and a `deliveryId`. Statuses 1, 2, 3, 4, 6, and 7 are forwarded; others are acknowledged and logged by status only.
- `deliveryId` exists for statuses 2 and 6 only: SHA-256 (unkeyed, so secret rotation does not change it) over the key, status, and the save's own fields that EDIT-1.5 shows are stable across retries and distinct between saves (at least `url` and the force-save type); the consumer dedupes saves by it. Status-1, 3, 4, and 7 notifications carry no `deliveryId` and are idempotent by meaning (the consumer's lock logic treats a repeated connect as a renewal). If EDIT-1.5 finds retry bodies differ in the chosen fields, the guide states the dedupe rule the measurement supports.
- Signing: `X-Editor-Timestamp`, `X-Editor-Delivery`, and `X-Editor-Signature: v1=<hex HMAC-SHA256 over "<timestamp>.<body>">`, one `v1=` per active secret during a rotation overlap. No redirects; timeout below DocumentServer's callback timeout (E6).
- Answers to DocumentServer per E6. If EDIT-1.5 proved the forgotten-files commands: `GET /api/documents/keys/:key/forgotten` (the key's consumer only) answers the forgotten file's download URL or `none`.

### EDIT-2.5 Drop (D13)
- `POST /api/documents/keys/:key/drop` with `users` (the ids the consumer holds from status-1 notifications), consumer-authenticated, refused unless the key's consumer component is the caller; drives the command service's `drop` with its JWT; maps DocumentServer's result codes to named errors.

### EDIT-2.6 The editor page
- HTML-escape the title; escape `<`, `>`, `&`, U+2028, and U+2029 in the inline config JSON; a strict CSP with a per-response nonce allowing only DocumentServer's `api.js` origin for scripts and frames; the page carries nothing beyond what DocumentServer receives (the config, including the panel token per D14's accepted exposure).

### EDIT-2.7 The consumer guide and reference verifier
- `docs/guides/consumer-integration.md` (new): profiles and allowed modes; the legacy shape and its removal condition; the key format and revision rules; sealed editor URLs, seal-key rotation, and the expired page; notifications (statuses, body, `deliveryId` and the consumer's dedupe rule, signature, a 5-minute timestamp window, secret rotation overlap, E6's retry semantics and measured horizon, the forgotten-files endpoint or the stated limit); drop; conversion (EDIT-3); plugin data (EDIT-5); a changelog naming the removed routes and fields (`/api/documents/:key/download`, `/api/sessions`, per-request `callbackUrl`, `saveTo`, GCS paths). `files.ts` upload behaviour is unchanged by EDIT.
- Reference verifier code (TypeScript, constant-time compare, timestamp window, delivery dedupe, key binding) in a snippet file the repo's tests import.
- Checked against UDOC-2.1's contract draft in Platform at this checkpoint.

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

**Checkpoint:** two reviewers (E8).

---

## EDIT-3 PDF conversion (UDOC-1.3)

**Goal:** a consumer converts a DOCX in its storage to PDF through OnlyOffice's ConvertService without the service keeping either file.

### EDIT-3.1 Endpoint
- `POST /api/documents/convert` (profile-capable consumers): `sourceUrl` and `uploadUrl`, each through `safe-url` (EDIT-2.2) against the consumer's `convertSourceHosts` and `convertUploadHosts`.
- The service sends ConvertService a JWT-signed request for the source; DocumentServer fetches it (its own request filtering on, verified in EDIT-1.5) and its `maxDownloadBytes` set to the input cap; the service then streams the result from DocumentServer's internal URL to the pinned upload address with a byte counter enforcing the output cap, and answers `{ size, sha256 }`.

### EDIT-3.2 Bounds and errors
- Input cap (DocumentServer's `maxDownloadBytes`), output cap (stream counter), an overall timeout, and a per-consumer concurrency limit (in-process; one API instance per environment). Named errors: `source_url_refused`, `upload_url_refused`, `input_too_large`, `output_too_large`, `conversion_timeout`, `conversion_failed`, `upload_failed`, `busy`.
- The service writes nothing to disk; DocumentServer's cache retention for the converted output is recorded in the ADR (EDIT-1.6) and stated in the guide; only hosts and sizes are logged.

### EDIT-3.3 Acceptance (parent UDOC-1.3)
- The spike's field-and-block fixture converts with fonts embedded (`pdffonts`) and fields where the editor shows them (battery item).
- An http URL, a private address, a metadata address, an oversized input, a timeout, and an unreachable upload URL each answer their named error; a redirect from the source or upload host is not followed.
- The consumer guide documents the endpoint.

**Checkpoint:** single reviewer (Sonnet).

---

## EDIT-4 Log redaction (UDOC-1.4)

**Goal:** no log line carries a URL that grants access. Scheduled first because the leaks are live in production.

### EDIT-4.1 Remove the fields and scrub messages
- Drop OnlyOffice's callback `url` (`documents.ts:213`), the signed `fileUrl` (`:148`), and `callbackUrl` (`:262`, `:266`) from log fields; log the host only where it helps.
- Remove URLs from thrown error messages (`validateSourceUrl`'s messages at `storage.ts:80`–`:97` and any other `${url}` in an error) so `error: message` fields carry none.

### EDIT-4.2 Redaction configuration
- Add a pino `redact` configuration in `app.ts` covering `url`, `fileUrl`, `callbackUrl`, `downloadUrl`, `saveTo`, `sourceUrl`, `uploadUrl` at the top level and nested (`*.url` and the like); serialize `req.url` without path or query for the callback route, `/editor/*`, and `/plugins/udoc-bridge/s/*`.
- nginx: a `log_format` that masks the path for `/editor/` and `/plugins/udoc-bridge/s/` on `app.monolithdocs.com`'s server block. Cloudflare: record whether request logging (Logpush or similar) is enabled for the zone and what it captures; masking there is a follow-up if it is.

### EDIT-4.3 Purge (owner-approved action)
- With Josh's approval: rotate and purge the production and dev VMs' container logs (and any sink they feed) that hold signed URLs, after the fix is deployed.

### EDIT-4.4 Acceptance (parent UDOC-1.4)
- Tests capture raw log output for an open failure, a callback failure, and a successful save, and a scan of the raw text finds no `http://` or `https://` URL with a path or query.
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

### EDIT-5.2 The panel host
- Loads the consumer's panel page from the session's plugin data in an iframe; reloading or reopening the panel reloads it with the same plugin data. If EDIT-1.5 took the per-session `config.json` fallback, the panel URL comes from there.

### EDIT-5.3 The operation set (D14)
- `getText`: every story part the plugin API exposes, with paragraph indexes and each field control's span, row id, and kind.
- `getSelection`.
- `insertField { rowId, label, value, inline | block }`: a `field:`/`block:` control with the D11 lock.
- `insertToken { token }`.
- `applySuggestion { paragraphIndex, context, occurrence, find, replace }`: located and re-verified, refused inside a field control, applied in one `callCommand` with track changes forced on and restored (the spike's 9c recipe).
- `addComment { paragraphIndex, context, occurrence, find, text, author }`.
- Every request carries an id; every answer is `{ id, ok, result | error }` with named errors (`stale_anchor`, `inside_field`, `not_found`, `unsupported`).

### EDIT-5.4 Origin rules (D14)
- The plugin accepts messages only from the session's panel origin and only from its own iframe's `contentWindow`; it posts only with that exact `targetOrigin`. The battery's stub consumer page checks the plugin's origin and `event.source`. Nothing is ever posted with `targetOrigin` `*`.

### EDIT-5.5 Corpus
- Saved DOCX files under `scripts/editor-battery/corpus/`: a field in a table cell, in a header and in a footer, next to a `{token}`, at a line-wrap boundary; a token split across runs; a block around a multi-row table; a document with tracked changes on; a `{#loop}…{/loop}` spanning table rows in a template; a copied field.

### EDIT-5.6 Acceptance (parent UDOC-1.5, and the panel item of UDOC-1.2)
- In a `document` session on the pinned release the panel is docked right.
- A stub consumer page inside the panel round-trips every operation.
- A message from any other origin is ignored on both sides; nothing is posted with `targetOrigin` `*`.
- Each corpus file survives an OnlyOffice save with its controls and tokens intact.
- One `applySuggestion` is one undo step; a stale anchor is refused.
- Closing and reopening the panel, and reloading the editor page three minutes after open, both bring the panel back working.
- If EDIT-1 took a fallback, this phase implements it instead, and the ADR and consumer guide record it before UDOC-3.4 starts in CRM.
- The dependency check fails on a planted `@monolith-platform/*` import (test).

**Checkpoint:** two reviewers (E8).

---

## EDIT-6 Hosting and capacity (UDOC-1.6)

**Goal:** the editor runs where CRM's dev environment can reach it and be reached by it, sized and documented.

### EDIT-6.1 Hosting choice
- Read DOC-DPP's status first. Choose per environment (dev at minimum) between the proven GCE + Cloudflare Tunnel path and DOC-DPP's target, and record it in an ADR. One API instance per environment (the conversion limiter is in-process).

### EDIT-6.2 Capacity
- Measure the pinned release's concurrent-connection behaviour (not press reports) and memory per open editor; size the host for the expected concurrent editors.

### EDIT-6.3 Secrets and reachability
- DocumentServer JWT, consumer credentials, notification secrets, and seal keys in 1Password and Secret Manager for each environment deployed. Notifications, conversion fetches and uploads, and panel pages reach and are reachable from the host: CRM dev's notification endpoint, Platform storage's hosts, and CRM's panel origin.

### EDIT-6.4 Acceptance (parent UDOC-1.6)
- The editor opens from `crm-dev` with the panel loaded and a signed save notification reaches CRM. Under proposed amendment A4, a stub receiver on the `crm-dev` network (verifying the signature with the guide's reference verifier) satisfies this at UDOC-1.6 and CRM's own receiver is proven at UDOC-3.3; without A4's approval this item waits on UDOC-3.3 and close-out records it as the one open item.
- Hosting and sizing are written down.

**Checkpoint:** single reviewer (Sonnet).

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
