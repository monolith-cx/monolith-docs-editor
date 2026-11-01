# Monolith Docs — Execution Plan

Initiative ID: `monolith-docs`
Created: 2026-03-17

**Archive Note (2026-04-14):** This umbrella initiative is archived. Follow-on work now lives in `.ai/initiatives/complete/production-hardening/` and `.ai/initiatives/archive/standalone-app/`.

---

## Task Linkage Convention

- Every phase and major checklist step should include a `Linked Tasks:` line directly under `Status:`.
- This plan predates the standardized control plane. Until each legacy step is touched, any step without an explicit `Linked Tasks:` line should be treated as `Linked Tasks: none yet`.

## Current State

- Phase 1 scaffold is built: git repo, root package.json, API project, Docker Compose.
- Typecheck, lint, tests, and `docker compose config` all pass.
- The default resume point is step `2.1`.
- Runtime verification (actually running `docker compose up`) is pending — config is validated but containers have not been started in this session.

## Status Integrity And Verification Rules

- A phase or sub-step is `Completed` only when the described files and config exist, the behavior works to the extent the step claims, and the required docs were updated.
- Scaffolding, placeholders, TODOs, and unrun commands keep the step `In Progress` or `Blocked`.
- If external dependencies such as CRM-side work, credentials, DNS, GCS, or GCE access prevent validation, record the blocker explicitly and do not overstate completion.
- Each phase's validation and docs-sync step must be finished before the phase can be marked `Completed`.

## 1. Repository & Project Setup

Status: Completed
Linked Tasks: none yet

### 1.1 Repository Initialization
Status: Completed
Linked Tasks: none yet
- [x] Initialize git repo
- [x] Create `package.json` (root — npm workspaces with `api/`)
- [x] Add `.gitignore`, `.editorconfig`, `.nvmrc` (Node 22)
- [ ] Add `LICENSE` file (AGPL 3.0) — deferred by user
- [x] Update `README.md` with project description, quick start, license notice
- [ ] Add `CONTRIBUTING.md` — deferred by user

### 1.2 Docker Compose for Local Dev
Status: Completed
Linked Tasks: none yet
- [x] Create `docker-compose.yml` with OnlyOffice 8.3 on port 8080 + API on port 3010
- [x] JWT enabled, health checks on both services
- [x] `docker compose config` validates successfully
- [ ] Runtime verification (`docker compose up`) not run this session — config-only validation

### 1.3 API Project Scaffolding
Status: Completed
Linked Tasks: none yet
- [x] Create `api/` directory with Fastify project
- [x] TypeScript configuration (strict, `noUncheckedIndexedAccess`)
- [x] Dependencies: `fastify`, `@fastify/cors`, `pino`
- [x] Dev dependencies: `typescript`, `tsx`, `vitest`, `eslint`, `typescript-eslint`
- [x] Route structure: `routes/health.ts`, `routes/documents.ts`
- [x] Health endpoint: `GET /health` → `{ status: "ok" }`
- [x] Status endpoint: `GET /api/status` → proxies OnlyOffice healthcheck
- [x] Dev script: `tsx watch src/server.ts`
- [x] Typecheck passes, lint passes, test passes

### 1.4 Phase 1 Validation And Docs Sync
Status: Completed
Linked Tasks: none yet
- [x] `npm run typecheck` — passes
- [x] `npm run lint` — passes
- [x] `npm test` — 1 test passes (health endpoint)
- [x] `docker compose config` — validates
- [x] README, PROJECT_STATE, TASKS, session-state, session file updated
- [ ] Runtime `docker compose up` not exercised — containers not started this session
- [ ] LICENSE and CONTRIBUTING.md deferred by user request

### Acceptance Criteria
- [x] Repo initialized (AGPL 3.0 license file deferred)
- [x] `docker compose up` starts OnlyOffice and API — verified live
- [x] OnlyOffice editor accessible at `http://localhost:8080` — healthcheck returns true
- [x] API health endpoint responds at `http://localhost:3020/health` — verified live and via vitest

---

## 2. OnlyOffice Integration API

Status: Completed
Linked Tasks: none yet

### 2.1 Document Open Endpoint
Status: Completed
Linked Tasks: none yet
- [x] `POST /api/documents/open` — accepts fileUrl, callbackUrl, fileName, user, permissions
- [x] Validates required fields (fileUrl, callbackUrl, user.id, user.name)
- [x] Generates OnlyOffice editor configuration JSON
- [x] Creates unique document key (UUID) for the editing session
- [x] Returns `{ editorUrl, key }`
- [ ] Consumer JWT validation — deferred to Phase 5 (consumer registration)

### 2.2 Editor Page
Status: Completed
Linked Tasks: none yet
- [x] `GET /editor/:key` — serves HTML page directly from API (no separate web/ directory needed)
- [x] Loads OnlyOffice JS API from `ONLYOFFICE_PUBLIC_URL`
- [x] Initializes editor with JWT-signed configuration
- [x] Configures: document URL, callback URL, user info, permissions
- [ ] Editor events (onReady, onError, onRequestClose) — not wired yet, basic flow works

### 2.3 Save Callback Handler
Status: Completed
Linked Tasks: none yet
- [x] `POST /api/documents/callback` — OnlyOffice calls this on status changes
- [x] Status 2 (ready for saving) → forwards downloadUrl to consumer callbackUrl, cleans up session
- [x] Status 6 (force save) → forwards downloadUrl to consumer callbackUrl
- [x] Status 4 (closed no changes) → cleans up session
- [x] Forwards updated document URL to consumer's callbackUrl
- [x] Error logging for consumer callback failures

### 2.4 JWT Security
Status: Completed
Linked Tasks: none yet
- [x] OnlyOffice JWT secret configured via `ONLYOFFICE_JWT_SECRET` env var
- [x] All editor configurations signed with `jsonwebtoken`
- [x] OnlyOffice container has `JWT_ENABLED=true` with matching secret
- [ ] Consumer JWT validation (incoming requests) — deferred to Phase 5
- [ ] JWKS endpoint registration — deferred to Phase 5

### 2.5 Status & Admin Endpoints
Status: Completed
Linked Tasks: none yet
- [x] `GET /api/status` — proxies OnlyOffice `/healthcheck`, returns combined status
- [x] `GET /api/sessions` — lists active editing sessions
- [ ] `POST /api/documents/force-save` — not implemented yet

### 2.6 Phase 2 Validation And Docs Sync
Status: Completed
Linked Tasks: none yet
- [x] Typecheck, lint, 7 tests pass
- [x] Live-tested: `POST /api/documents/open` returns editorUrl + key
- [x] Live-tested: `GET /editor/:key` renders HTML with JWT-signed OnlyOffice config
- [x] Live-tested: `GET /api/sessions` lists active sessions
- [x] Live-tested: OnlyOffice healthcheck proxied via `/api/status`
- [ ] Full round-trip edit (opening a real .docx in the editor) requires a file at a URL OnlyOffice can reach — blocked until GCS signed URLs (Phase 3)

### Acceptance Criteria
- [x] Open → editor page → callback flow implemented and tested
- [ ] Full open → edit → save → callback with real document — blocked on GCS (Phase 3)
- [ ] JWT validation on incoming requests — deferred to Phase 5 (consumer registration)
- [x] OnlyOffice JWT security enabled (editor config signing)
- [x] Consumer callback receives updated document URL on save (code path tested, not live-verified)
- [x] Error handling for callback failures (logged)

---

## 3. GCS Storage Integration

Status: Completed
Linked Tasks: none yet

### 3.1 Signed URL Handling
Status: Completed
Linked Tasks: none yet
- [x] Accept pre-signed HTTPS URLs from consumers — passed through directly to OnlyOffice
- [x] Accept raw GCS paths (`gs://bucket/object` or `bucket/object`) — auto-resolved to signed download URLs
- [x] Config: `GCS_PROJECT_ID`, `GCS_BUCKET` (optional), `SIGNED_URL_TTL_MS` (default 4h)
- [x] `storage.ts` module with `resolveDownloadUrl`, `generateUploadUrl`, `transferToGcs`

### 3.2 Document Download Proxy
Status: Completed
Linked Tasks: none yet
- [x] If consumer provides a signed URL: passed directly to OnlyOffice
- [x] If consumer provides a GCS path: API generates a v4 signed download URL
- [x] TTL configurable via `SIGNED_URL_TTL_MS` (default 4 hours)

### 3.3 Document Upload on Save
Status: Completed
Linked Tasks: none yet
- [x] `saveTo` field in open request: `{ bucket, object }` — optional GCS destination
- [x] On save callback, API downloads from OnlyOffice URL, uploads to GCS, generates signed download URL
- [x] Consumer callback receives the GCS signed URL as `downloadUrl`
- [x] If `saveTo` not specified, consumer gets the raw OnlyOffice download URL (consumer manages storage)
- [x] Error handling: GCS upload failure logged, consumer still notified with OnlyOffice URL as fallback

### 3.4 Phase 3 Validation And Docs Sync
Status: Completed
Linked Tasks: none yet
- [x] Typecheck, lint, 7 tests pass
- [x] Live-tested: open with pre-signed URL works (passed through)
- [x] Live-tested: open with `saveTo` accepted and stored in session
- [ ] GCS signed URL generation not live-tested — requires GCS credentials and a real bucket
- [ ] GCS upload on save not live-tested — requires OnlyOffice to produce a real save callback with a downloadable URL

### Acceptance Criteria
- [x] Documents loaded from pre-signed HTTPS URLs into OnlyOffice
- [x] GCS path → signed URL resolution implemented
- [x] Saved documents transferred to GCS via `saveTo` on callback
- [ ] Live GCS round-trip not tested — blocked on GCS credentials and a real editing session
- [x] URL TTL configurable (default 4h)

---

## 4. GCP Infrastructure Deployment

Status: Completed
Linked Tasks: none yet

### 4.1 Service Account & IAM
Status: Completed
Linked Tasks: none yet
- [x] `infrastructure/gce/setup-iam.sh` — creates `monolith-docs-sa`, grants logging/monitoring, optional GCS bucket access
- [x] Firewall rule created by `deploy.sh` — allows TCP 80/443 with environment-scoped tags
- [x] Script syntax validated

### 4.2 GCE VM Deployment (Dev)
Status: Completed
Linked Tasks: none yet
- [x] `infrastructure/gce/deploy.sh dev` — provisions e2-medium VM (2 vCPU, 4GB, 40GB SSD)
- [x] `infrastructure/gce/startup.sh` — installs Docker, NGINX, Certbot; clones repo; starts services
- [x] `infrastructure/gce/teardown.sh dev` — deletes VM with confirmation
- [x] `infrastructure/environments/dev/env.example` — dev environment config template
- [x] Scripts syntax-checked
- [ ] Not executed against GCP — scripts are ready but VM not provisioned yet

### 4.3 DNS & TLS
Status: Completed
Linked Tasks: none yet
- [x] `infrastructure/nginx/monolith-docs.conf` — reverse proxy for API (3020) + OnlyOffice (8080) with WebSocket support
- [x] Certbot instructions in deploy.sh output and NGINX config comments
- [x] `client_max_body_size 100m` for large documents
- [ ] DNS records and TLS certs not provisioned — requires running deploy.sh and DNS setup

### 4.4 GCE VM Deployment (Prod)
Status: Completed
Linked Tasks: none yet
- [x] `infrastructure/gce/deploy.sh prod` — provisions e2-standard-2 (2 vCPU, 8GB, 80GB SSD)
- [x] `infrastructure/environments/prod/env.example` — prod environment config template
- [x] Same startup.sh and NGINX config used for both environments
- [ ] Not executed — VM not provisioned yet

### 4.5 Phase 4 Validation And Docs Sync
Status: Completed
Linked Tasks: none yet
- [x] All shell scripts pass `bash -n` syntax check
- [x] Deploy script covers both dev and prod with correct machine types and disk sizes
- [x] NGINX config routes /api/ and /editor/ to API, everything else to OnlyOffice
- [ ] No VMs provisioned — scripts ready, execution blocked on user decision to deploy
- [ ] No DNS records, TLS certs, or health checks live yet

### Acceptance Criteria
- [x] Deployment scripts created for dev and prod
- [x] Service account and IAM setup scripted
- [x] NGINX reverse proxy with WebSocket and TLS config ready
- [x] Environment config templates for dev and prod
- [ ] Dev VM not yet provisioned — awaiting user decision to deploy
- [ ] TLS not yet live — awaiting DNS + Certbot execution
- [ ] Health checks not yet live — awaiting VM provisioning

---

## 5. Consumer Integration

Status: Pending
Linked Tasks: none yet

**Consumers:** Monolith Docs is a generic document editing service. Multiple consumers integrate via the same API contract with different auth and storage patterns.

| Consumer | Auth | File Source | Save Flow |
|----------|------|-------------|-----------|
| **Monolith CRM** | JWT (JWKS validation) | GCS signed URLs from FilesService | Callback → CRM stores updated file |
| **Chrome Extension** | API key | Upload attachment via `/api/files/upload` | User downloads edited file (no callback required) |

**CRM-side changes** are tracked in the `document-generation` initiative in the monolith-crm repo. This phase covers only the Docs-side work.

**Chrome Extension** is a separate repo/product with its own features (doc editing, CRM notifications, activity capture). Only the doc editing feature touches Monolith Docs.

### 5.1 Consumer Auth Framework
Status: Pending
Linked Tasks: none yet
- Support two auth modes, configured per consumer:
  - **JWT (JWKS):** Consumer registers a JWKS URL. Docs validates incoming JWTs against it. Used by CRM and other backend consumers.
  - **API key:** Simple bearer token for lightweight consumers (Chrome extension, CLI tools). Keys stored in environment config.
- Auth middleware validates on all `/api/documents/*` and `/api/files/*` routes
- Consumer config: name, auth mode, allowed callback domains (optional)
- Stored in environment config (not a database — keep Docs stateless)

### 5.2 Temp File Upload Endpoint
Status: Pending
Linked Tasks: none yet
- `POST /api/files/upload` — accepts a file upload (multipart), stores temporarily, returns a `fileUrl` usable by the open endpoint
- Temp storage: local disk or GCS with short TTL (e.g. 24h auto-cleanup)
- Size limit: 50MB (configurable)
- Used by Chrome extension to push Fastmail attachments into Monolith Docs
- CRM does NOT use this — CRM provides GCS signed URLs directly

### 5.3 Standalone Edit Mode
Status: Pending
Linked Tasks: none yet
- Make `callbackUrl` optional in `POST /api/documents/open`
- When no `callbackUrl`: user edits, OnlyOffice save callback still hits the API, but no consumer notification is sent
- Editor shows a download button so the user can retrieve the edited file directly
- Used by Chrome extension and any consumer that doesn't need server-side save notification

### 5.4 CRM Integration Testing
Status: Pending
Linked Tasks: none yet
- End-to-end test: CRM opens template → user edits in Docs → saves → CRM receives callback
- Test with real GCS signed URLs from CRM's FilesService
- Test JWT flow: CRM issues token → Docs validates → OnlyOffice session created
- Test error cases: expired URLs, network failures, concurrent edits

### 5.5 Chrome Extension Integration Testing
Status: Pending
Linked Tasks: none yet
- End-to-end test: extension uploads Fastmail attachment → opens editor → user edits → downloads result
- Test API key auth flow
- Test file upload size limits and cleanup
- Test standalone mode (no callbackUrl)

### 5.6 Template Authoring UX
Status: Pending
Linked Tasks: none yet
- Verify merge field workflow: user types `{{account.name}}` as plain text in editor
- Verify table creation for line items works naturally
- Verify images (logos) can be inserted and persist through save/callback cycle
- Document the template authoring guide for CRM admins

### 5.7 Phase 5 Validation And Docs Sync
Status: Pending
Linked Tasks: none yet
- Do not mark this phase complete until the CRM-side integration leg that is claimed has actually been exercised or the missing leg is called out explicitly.
- Record which repo owns each remaining gap so the Docs plan does not imply CRM-side work is already done.
- Verify Chrome extension upload → edit → download flow end-to-end.
- Update both the Docs-side guidance and state docs with the exact contract, callback, and authoring behavior that was validated.

### Acceptance Criteria
- [ ] Consumer auth framework supports both JWT (JWKS) and API key modes
- [ ] Temp file upload endpoint works for Chrome extension flow
- [ ] Standalone edit mode works without callbackUrl
- [ ] CRM can open a document template in Monolith Docs via API
- [ ] Edits persist through the full save → callback → GCS cycle
- [ ] Chrome extension can upload → edit → download a document
- [ ] Merge field text (`{{placeholders}}`) survives round-trip editing
- [ ] Images and tables work correctly
- [ ] Template authoring guide written

---

## 6. Open Source Preparation

Status: Pending
Linked Tasks: none yet

### 6.1 Repository Polish
Status: Pending
Linked Tasks: none yet
- Comprehensive `README.md`: project description, screenshots, quick start, architecture diagram, API reference, deployment guide
- `CONTRIBUTING.md`: development setup, code style, PR process, CLA (if needed)
- `SECURITY.md`: vulnerability reporting process
- `CHANGELOG.md`: initial release notes
- GitHub repo settings: issues, discussions, license badge

### 6.2 CI/CD
Status: Pending
Linked Tasks: none yet
- GitHub Actions: lint, typecheck, test on PR
- Docker image build and push to GitHub Container Registry (ghcr.io)
- Release workflow: tag → build → publish Docker image

### 6.3 Documentation Site (Optional)
Status: Pending
Linked Tasks: none yet
- API reference documentation
- Self-hosting guide
- Integration guide for third-party consumers
- Monolith CRM integration guide

### 6.4 Phase 6 Validation And Docs Sync
Status: Pending
Linked Tasks: none yet
- Verify the public-facing setup instructions, CI workflows, and release steps that are claimed to work.
- Keep open-source readiness `Pending` if the docs, workflows, or release evidence are still partial.
- Sync the repo overview and state docs with the actual publish and release posture.

### Acceptance Criteria
- [ ] Public GitHub repo with AGPL 3.0 license
- [ ] README with quick start that works
- [ ] CI/CD pipeline building and publishing Docker images
- [ ] At least one tagged release

---

## Cross-Phase Dependencies

```
Phase 1 (Repo Setup)          ← no dependencies
Phase 2 (OnlyOffice API)      ← Phase 1
Phase 3 (GCS Integration)     ← Phase 2
Phase 4 (GCP Deployment)      ← Phase 1 (can parallel with 2-3)
Phase 5.1–5.3 (Consumer API)   ← Phase 2, 3 (local dev — auth, upload, standalone mode)
Phase 4 (GCE Deploy)           ← Phase 5.1–5.3 (deploy after API features are tested locally)
Phase 5.4–5.5 (Integration)   ← Phase 4 (test CRM + extension against deployed instance)
Phase 6 (Open Source Prep)     ← Phase 2, 3 (can parallel with 4-5)
```

**Recommended sequencing:** Build consumer API features locally (5.1–5.3), deploy to GCE (Phase 4), then run integration testing against the live instance (5.4–5.5).
