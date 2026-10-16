# Standalone App — Execution Plan

## Initiative ID: `standalone-app`

## Abbreviation: `SA`

> **Re-scoped 2026-10-16 (Phase 0 only).** After the 2026-09-02 repo split, the standalone product surface lives in the private `monolith-docs` repo. This initiative keeps **Phase 0** (workspace restructure and headless parity) and its open gates. **Phases 1–7 are superseded** and are kept below as a historical record only; do not implement them here. The editor-service work UDOC needs (profiles, stateless sessions, signed notifications, conversion, redaction, the panel plugin, hosting) is the `udoc-editor-service` (EDIT) initiative. Two items have no owner and are candidate follow-ups: SA-1.6 (`hostnameGuard` and production-strict `findConsumersByHostname`) and SA-1.7 (`allowedFrameAncestors` on the editor page). The Critical Constraint below ("headless API unmodified") applies to Phase 0 only; EDIT changes the headless API deliberately, keeping the legacy open shape for existing consumers (EDIT guidance E1). Because EDIT-4 and EDIT-2 change the headless API that Phase 0 verifies, Phase 0 must close (or its Track A matrix be re-baselined: EDIT-2 removes `/api/documents/:key/download` and `/api/sessions`) before EDIT-2 is deployed. The owner decided (2026-10-16) to keep this initiative active for Phase 0 and archive it once Phase 0 closes.

## Critical Constraint

The existing headless API (`/api/documents/open`, `/editor/:key`, `/api/documents/callback`, `/api/files/*`, `/api/sessions`, `/health`, `/api/status`) and the consumer auth system (`auth.ts`, `consumers.ts`) MUST remain fully functional and unmodified throughout all phases. CRM and Connect integrations are not touched.

Implementation note: preserving headless behavior requires an auth/routing refactor so standalone routes do not pass through the current global consumer-auth plugin.

## Sibling Initiative: `deploy-pipeline-parity`

Standalone product work and deployment-parity work are now intentionally split:

- Docs-local CI/CD, branch protection, dev-environment parity, and rollback automation live in `.ai/initiatives/planning/deploy-pipeline-parity/`.
- Phase 0 in this plan establishes the stable pnpm/Turbo workspace and command surface that DPP Phase 2 will protect with the repo `verify` workflow.
- Full deploy/rollback parity is intentionally not front-loaded before Phase 0, because doing so would automate a repo layout and runtime topology that this initiative immediately changes.
- Do not treat Standalone Phase 6 as deployment-complete while DPP Phase 4 is still open. The final standalone stack must be what the parity initiative actually automates.

---

## Phase 0: Monorepo restructure to Monolith convention

**Goal:** Bring the repo layout, package manager, and toolchain in line with `monolith-crm`, `monolith-platform`, and `monolith-connect` before any new code lands. Every sibling Monolith repo uses pnpm + Turbo + `apps/*` + `packages/*`; keeping Docs on npm-workspaces-with-single-`api/` would diverge further with every subsequent phase and block shared tooling.

**The "no behavior change" claim is aspirational, not free.** Phase 0 changes the build substrate (package manager, task orchestrator), the runtime (Node 22 → 24), and the DB tooling (Prisma 7.7 — new to this repo, but matching siblings). Any of these can break deploys or headless integrations even when route logic is untouched. Phase 0 acceptance is split into **mechanical** and **runtime** tracks so regressions in one do not hide the other, and closes with a deployed rollback-tested headless smoke gate.

`production-hardening` closed on 2026-04-18 (see [.ai/initiatives/complete/production-hardening/plan.md](.ai/initiatives/complete/production-hardening/plan.md)), so there is no active-initiative collision to coordinate around. Phase 0 starts clean.

Current state as of 2026-04-19: the repo restructure is locally code-complete, review attempt 2 resolved the fresh-VM `deploy-ref` bug in `infrastructure/gce/startup.sh`, and the pre-deploy safety review now passes after tightening the hosted `.env` bootstrap rules in `startup.sh` and `deploy.sh`. A dev VM-local deploy test against SHA `54f44871abc3623704c8ca6e2e0c0136258f406a` now succeeds and reports healthy `/health` and `/api/status`, but that Track C attempt used additional local deploy-substrate fixes (stopped-instance restart handling in `deploy.sh` and non-blocking cloudflared bootstrap in `startup.sh`) that are not committed yet. Phase 0 remains open until those fixes are durably committed and the remaining consumer-path / rollback gates are captured.

Checkpoint sequencing rule for Phase 0:

1. Finish the local repo/tooling changes and run the strongest local verification available.
2. Run a local pre-deploy safety review and fix any findings before creating a deployable SHA.
3. Only after the local safety review is clean enough to justify external testing should a commit/push be created for Track C.
4. Run Track C against that reviewed SHA and capture deploy/rollback evidence.
5. Run the final checkpoint closeout review against the full Phase 0 evidence before marking the phase complete.

Do not deploy unreviewed or known-broken Phase 0 code just to satisfy the rollback gate. Track C is acceptance evidence for reviewed code, not a substitute for the local review/fix loop.

Review intent for Phase 0 is explicitly split:

- Pre-deploy safety review: asks whether the local code and deploy substrate are safe enough to create a dev-testable SHA. This review can pass while Track C is still unrun.
- Checkpoint closeout review: asks whether the full Phase 0 acceptance set is complete, including Track C evidence and rollback capture. This review cannot pass until after the dev deploy work is done.

### SA-0.0 Pre-flight confirmation

- Confirm `.ai/registry.yml` and `ROADMAP.md` show `production-hardening` as `completed` (no open checkpoints that assume the pre-Phase-0 layout)
- Cross-project check: update `C:\Dev\monolith-platform\docs\ecosystem\integration-status\monolith-docs.yaml` if it references current paths that will change in Phase 0 (`api/` → `apps/api/`, npm → pnpm)
- Capture the current prod deployment snapshot — public IPs, Cloudflare A records, tunnel config — so rollback in SA-0.5 Track C has a known-good baseline to compare against. In particular record that prod VM is `monolith-docs` at `34.44.51.7` and that the Cloudflare `app` A record must point there (previous drift to a stale dev-VM IP was resolved in the `production-hardening` closeout; recurrence protection is a future hardening item, not in this scope).
- Status: In Progress — registry/ROADMAP are aligned; rollback baseline capture and the Platform integration-status sync still need to be recorded in the Phase 0 closeout.
- Acceptance: Registry and ROADMAP reflect production-hardening complete. Platform ecosystem integration-status file is current. Rollback baseline recorded in the Phase 0 handoff.

### SA-0.1 Migrate to pnpm + Turbo

- Replace `package-lock.json` with `pnpm-lock.yaml`; add `pnpm-workspace.yaml` with `apps/*` and `packages/*` entries
- Add `turbo.json` at the root mirroring Platform/CRM's task graph (`dev`, `build`, `lint`, `typecheck`, `test`)
- Root `package.json` switches `scripts` to `turbo run <task>` form; set `"packageManager": "pnpm@10.33.0+..."` matching sibling repos
- Bump `engines.node` from `>=22` to `>=24` and verify the Docker image and GCE startup scripts still pin compatible Node
- Update `scripts/validate-ai-workspace.mjs` if it references npm/workspaces paths that move
- Status: In Progress — pnpm + Turbo, Node 24, and the repo command surface landed; local `typecheck`, `lint`, `test`, and Docker verification passed, but headless parity evidence is still pending.
- Acceptance: `pnpm install` resolves cleanly; `pnpm run typecheck`, `pnpm run lint`, `pnpm run test` all pass; Docker Compose starts the existing API service; no behavior change in headless routes

### SA-0.2 Move `api/` to `apps/api/`

- Move the entire current `api/` tree to `apps/api/` preserving git history (`git mv`)
- Update the workspace name to `@monolith-docs/api` to match the sibling naming scheme (`@monolith/api`, `@monolith-platform/portal`, etc.)
- Update every path reference: `docker-compose.yml` build contexts and volume mounts, `Dockerfile` WORKDIR and COPY paths, `infrastructure/gce/startup.sh` and `deploy.sh`, NGINX config if it references paths, `scripts/*`, `.github/workflows/*` if present
- Update `tsconfig.json` paths, any `tsconfig.*.json` `extends`, Vitest config paths
- Verify `npm --prefix api run <x>` references in docs and CLAUDE.md no longer apply — update to `pnpm --filter @monolith-docs/api run <x>`
- Status: In Progress — `api/` moved to `apps/api/`, local compose/API health checks pass, and the deploy paths were updated; the real consumer round-trip gate is still open.
- Acceptance: `pnpm --filter @monolith-docs/api run typecheck|lint|test` all pass; `docker compose build && docker compose up -d` brings the full existing stack up; a round-trip document-open → edit → callback → close still works against a real consumer credential

### SA-0.3 Scaffold `packages/db/` under pnpm workspace

- Create `packages/db/` as `@monolith-docs/db` workspace package
- Pin `prisma@^7.7.0` and `@prisma/client@^7.7.0` to match the in-progress Prisma 7.7 migration in `monolith-platform/packages/db` and `monolith-crm/packages/db`. Docs starts on 7.7 rather than inheriting a later migration debt.
- Package-level `scripts`: `generate`, `migrate:dev`, `migrate:deploy`, `migrate:status`, `migrate:reset`
- Prisma schema file lives at `packages/db/prisma/schema.prisma`; migrations at `packages/db/prisma/migrations/`
- Empty placeholder schema — actual tables land in SA-1.2
- Add to root `onlyBuiltDependencies` the Prisma client/engines entries sibling repos already whitelist
- Status: In Progress — `packages/db/` and Prisma 7.7 landed and `generate` passes; root `onlyBuiltDependencies` alignment can be finalized with the rest of the Phase 0 closeout.
- Acceptance: `pnpm --filter @monolith-docs/db run generate` succeeds; `apps/api` can import `@monolith-docs/db` via `workspace:*`

### SA-0.4 Update `CLAUDE.md`, `README.md`, and verification commands

- Every command reference to `npm --prefix api run <x>` becomes `pnpm --filter @monolith-docs/api run <x>`
- Update the architecture diagram in `CLAUDE.md` to show `apps/` and `packages/` rather than a single `api/`
- Confirm the repo-local `/tests` skill points at the right commands
- Status: In Progress — `CLAUDE.md`, `README.md`, and the control-plane docs now point at pnpm/Turbo and `apps/*`; clean-checkout quickstart evidence is still bundled into the open Phase 0 gate.
- Acceptance: `CLAUDE.md` verification section lists commands that actually work against the new layout; `README.md` quickstart runs end-to-end without edits

### SA-0.5 Headless parity — concrete verification matrix

Codex correctly flagged that "full headless verification matrix" was under-specified. Define it explicitly as a checklist below. Record results in the checkpoint review document. This is the gate between Phase 0 and Phase 1.

Track sequencing note: Track C happens after the local pre-deploy safety review produces a reviewed SHA that is worth deploying. If that review still has unresolved findings, stop and fix them before pushing or deploying. If the dev deploy exposes new issues, fix them locally, re-review, and only then treat Track C as complete.

**Matrix is split into two tracks** so a mechanical-move regression is distinguishable from a runtime-upgrade regression:

#### Track A — Mechanical move only (SA-0.1, SA-0.2, SA-0.3 closed; Node still 22, no Prisma yet)

Run before bumping Node or introducing Prisma to isolate moveset failures from runtime failures.

- [ ] `pnpm --filter @monolith-docs/api run typecheck` passes
- [ ] `pnpm --filter @monolith-docs/api run lint` passes
- [ ] `pnpm --filter @monolith-docs/api run test` — all existing Vitest suites pass, zero skipped, zero new failures
- [ ] `docker compose build` — no errors
- [ ] `docker compose up -d` — all existing services (api, onlyoffice) healthy
- [ ] `curl http://localhost:3020/health` returns `{"ok":true}` (or existing shape)
- [ ] `curl http://localhost:3020/api/status` returns existing shape
- [ ] CRM consumer document open: `POST /api/documents/open` with a real CRM consumer bearer token and a GCS fixture file returns a valid `editorUrl`. Editor page loads at that URL.
- [ ] Connect consumer same: `POST /api/documents/open` with Connect's bearer + a fixture returns valid `editorUrl`; editor loads.
- [ ] OnlyOffice DocumentServer bootstraps in the iframe; WebSocket upgrade succeeds; co-edit indicator appears.
- [ ] Edit a document; wait for OnlyOffice auto-save; confirm `/api/documents/callback` fires over the internal docker path and the session `lastActivityAt` advances.
- [ ] Close the editor; `status=2` callback arrives; consumer callback (if configured) is invoked.
- [ ] `GET /api/documents/:key/download` returns a valid signed URL for the last saved version.
- [ ] Hostname binding enforcement: hit `POST /api/documents/open` on a hostname the consumer is not bound to → 401.
- [ ] Rate limiter, CORS headers, security headers (`X-Content-Type-Options` etc.) all present and unchanged vs pre-move baseline.
- [ ] Dev fixture surface: `curl http://localhost:3020/files/<fixture>` returns the expected content when `NODE_ENV !== 'production'`, and returns 404 (route not registered) when `NODE_ENV=production`. Vitest suites that depend on fixture-backed editor bootstrap still pass.

#### Track B — Runtime upgrades (SA-0.4 closes Track A; then bump Node to 24 and introduce Prisma 7.7)

- [ ] All Track A items re-run on Node 24 with `engines.node >=24` enforced
- [ ] `pnpm --filter @monolith-docs/db run generate` succeeds
- [ ] Prisma CLI version matches 7.7.x (`pnpm --filter @monolith-docs/db exec prisma --version`)
- [ ] Compare response payloads for every endpoint in Track A byte-for-byte with the baseline captured before Phase 0 (or at minimum, schema-compare)
- [ ] Compare logs for any new warnings or deprecation messages introduced by Node 24 or Prisma 7.7
- [ ] `docker compose down && docker compose up -d` cycle — confirm OnlyOffice WebSocket reconnects and in-flight sessions survive the restart the same way they did on Node 22

#### Track C — Deployed rollback gate (before closing Phase 0)

- [ ] Deploy restructured code to the dev GCE instance using the updated `infrastructure/gce/startup.sh` and `deploy.sh`
- [ ] Run Track A items against the dev deployment (dev hostnames, not localhost)
- [ ] Identified rollback path: document the exact commit SHA of the pre-Phase-0 baseline, confirm `git revert` or branch reset + redeploy brings the dev instance back to the baseline within 10 minutes, and record the rollback recipe in `ERRORS.md` or the initiative handoff. Do NOT close Phase 0 without this recipe recorded.
- [ ] Production deploy is out of scope for Phase 0 closeout — production migration happens in Phase 6 (SA-6.3). Phase 0 closes on dev verification only.

- Status: In Progress — local verification is green; a VM-local dev deploy to SHA `54f44871abc3623704c8ca6e2e0c0136258f406a` succeeded and the dev VM was shut back down, but the operator-script fixes used in that attempt are not committed yet, and the dev-hostname / rollback gates remain open.
- Acceptance: Every Track A and Track B item is checked. Track C rollback recipe is recorded and dry-run tested on dev. Any failure blocks Phase 1. Skipping or hand-waving a matrix item is grounds for checkpoint rejection.

---

## Phase 1: Database and infrastructure foundation

> **Superseded 2026-10-16** (Phases 1–7): see the re-scope note at the top. Kept as a record.

**Goal:** Add PostgreSQL, Prisma, and Redis to the repo. Establish the tenant/user data model and RLS. No auth, no frontend — just the data layer.

### SA-1.1 Add PostgreSQL and Redis to docker-compose

- Add `postgres` service (PostgreSQL 16, port 5432, `monolith_docs_dev` database)
- Add `redis` service (Redis 7, port 6379)
- Add persistent volumes for both
- Wire `DATABASE_URL` and `REDIS_URL` env vars into the `api` service
- Verify existing services (OnlyOffice, API) still start and function
- Status: Pending
- Acceptance: `docker compose up -d` starts all 4 services, existing health checks pass, `psql` connects to Postgres, `redis-cli ping` returns PONG

### SA-1.2 Add Prisma and define schema

- Build on the `packages/db/` scaffold from SA-0.3 (pnpm workspace, Prisma `^7.7.0`)
- The workspace is referenced from `apps/api` via `"@monolith-docs/db": "workspace:*"`
- Define schema with RLS-compatible tables:
  - `Tenant` (id, slug, name, status, platform_tenant_id [unique], firebase_tenant_id, plan_slug, created_at, updated_at)
  - `User` (id, tenant_id, email, first_name, last_name, role, status, platform_user_id, platform_sync_version, created_at, updated_at)
  - `LegalEntity` (id, tenant_id, platform_id, name, entity_type, record_number, display_name, ein, trade_name, incorporation_state, incorporation_country, platform_sync_version)
  - `BusinessUnit` (id, tenant_id, platform_id, legal_entity_id, short_code, name, business_unit_type, is_default, street, city, state, postal_code, country, email, phone, time_zone, display_name, record_number, platform_sync_version)
  - `BusinessUnitAffiliation` (id, tenant_id, user_id, business_unit_id, platform_id, role, relationship_type, is_primary, is_active, work_email, work_phone, platform_sync_version)
  - `RecentDocument` (id, tenant_id, user_id, platform_file_id, document_key, file_name, document_type, last_opened_at, created_at)
  - `EventInbox` (id, event_id [unique], event_type, tenant_id, source, status, payload, received_at, processed_at, attempts, last_error)
  - `EventOutbox` (id, event_id, event_type, tenant_id, source, payload, status, created_at, published_at, publish_attempts, last_error)
- Composite unique constraints: `User(tenant_id, platform_user_id)`, `User(tenant_id, email)`
- All tables include `tenant_id` for RLS
- Status: Pending
- Acceptance: `prisma migrate dev` creates migration, `prisma generate` succeeds, types importable from `@monolith-docs/db`

### SA-1.3 Add RLS policies

- SQL migration to enable RLS on all tenant-scoped tables
- Policy: `tenant_id = current_setting('app.current_tenant')::text`
- `withTenant(tenantId, callback)` utility that wraps Prisma interactive transactions with `SET LOCAL app.current_tenant`
- Status: Pending
- Acceptance: Direct query without `SET LOCAL` returns no rows; query with correct tenant returns expected rows

### SA-1.4 Add `@monolith-platform/sdk` dependency

- Configure `.npmrc` for Artifact Registry (`us-west1-npm.pkg.dev/monolith-platform/platform-npm/`)
- Install `@monolith-platform/sdk` in `apps/api`
- Create `apps/api/src/platform/client.ts` — singleton `PlatformClient` init on startup
  - Reads `PLATFORM_SERVICE_KEY`, `PLATFORM_API_URL`, `GCP_PROJECT_ID` from env
  - Configures `events.source = 'docs'`
  - Exposes `getClient()` (nullable) and `getClientOrThrow()`
  - Warns if service key not configured (dev mode)
- Add env vars to docker-compose `api` service
- Status: Pending
- Acceptance: API starts with and without `PLATFORM_SERVICE_KEY`; `getClient()` returns client when configured, null when not

### SA-1.5 Restructure Fastify registration around encapsulated subtrees

**Problem being solved.** The current `authPlugin` at [apps/api/src/auth.ts:63](apps/api/src/auth.ts#L63) is wrapped with `fastify-plugin` (`fp`) and registered on the root app in [apps/api/src/app.ts:39](apps/api/src/app.ts#L39). `fastify-plugin` **de-encapsulates** the plugin, so the `onRequest` hook it installs applies to every child context for the entire app lifetime. The hook handles the split today via URL-path carve-outs (`/health`, `/api/status`, `/editor/`, `/api/documents/callback`, `/api/files/`). That pattern does not extend safely to standalone — any new standalone route (`/auth/*`, `/trpc/*`, `/internal/*`) would hit consumer bearer-token auth first and fail before Platform session auth could run.

A "separate plugin scope for standalone" is NOT sufficient if consumer auth stays on the root. Child plugins inherit parent hooks. The fix must remove consumer auth from the root context entirely.

**Target structure.** `buildApp()` becomes:

```ts
export function buildApp() {
  const app = Fastify({ ... });
  app.register(cors, ...);
  app.register(multipart, ...);
  app.register(rateLimit, ...);
  app.register(cookie); // @fastify/cookie on root — passive parsing, no auth

  // Security headers hook stays on root — it sets headers for everyone
  app.addHook('onSend', securityHeadersHook);

  // Public routes — no auth, no hostname guard (except the always-public ones)
  app.register(publicRoutes); // /health, /api/status

  // Shared OnlyOffice-authenticated route — reachable on editor-session hostnames
  app.register(async (scope) => {
    scope.addHook('onRequest', hostnameGuard(EDITOR_SESSION_HOSTNAMES));
    scope.register(onlyofficeCallbackRoutes); // POST /api/documents/callback
    // Note: public-edge exposure of this route is blocked at NGINX; see SA-6.2.
    // This registration exists for the internal API_INTERNAL_URL path only.
  });

  // Editor page — session-key-bound, hostname-constrained, Platform-session-gated for standalone
  app.register(async (scope) => {
    scope.addHook('onRequest', hostnameGuard(EDITOR_SESSION_HOSTNAMES));
    scope.addHook('preHandler', standaloneEditorSessionGate); // SA-2.6
    scope.register(editorRoutes); // GET /editor/:key, GET /api/documents/:key/download (both session-key-bound, Platform-session-gated when session.authSource === 'platform')
  });

  // Upload fixture/file-fetch by UUID — session-bound, no consumer auth.
  // OnlyOffice DocumentServer fetches the source file via this path during editor bootstrap.
  app.register(async (scope) => {
    scope.addHook('onRequest', hostnameGuard(EDITOR_SESSION_HOSTNAMES));
    scope.register(fileDownloadRoutes); // GET /api/files/:filename
  });

  // Headless consumer subtree — consumer auth + consumer-only hostname guard
  app.register(async (scope) => {
    scope.addHook('onRequest', hostnameGuard(CONSUMER_HOSTNAMES)); // connect., crm.
    scope.addHook('onRequest', consumerAuthHook); // formerly authPlugin, now scoped
    scope.register(consumerRoutes); // POST /api/documents/open, POST /api/files/upload, GET /api/sessions
  });

  // Standalone subtree — Platform session auth + standalone-only hostname guard
  app.register(async (scope) => {
    scope.addHook('onRequest', hostnameGuard(STANDALONE_HOSTNAMES)); // api.docs.monolith.cx
    scope.addHook('onRequest', platformAuthHook); // SA-2.3
    scope.addHook('preHandler', tenantContextHook); // SA-2.4
    scope.register(authRoutes);      // /auth/callback, /auth/me, /auth/logout
    scope.register(trpcRoutes);      // /trpc/*
  });

  // Internal service-to-service subtree — service-key or OIDC auth, standalone hostname only
  app.register(async (scope) => {
    scope.addHook('onRequest', hostnameGuard(STANDALONE_HOSTNAMES));
    scope.addHook('onRequest', serviceKeyOrOidcHook);
    scope.register(provisionRoutes);      // POST /internal/provision (service key)
    scope.register(eventReceiverRoutes);  // POST /internal/events (Pub/Sub OIDC)
  });

  return app;
}
```

Key rules:

- `consumerAuthHook` (formerly exported as `authPlugin`) is no longer wrapped with `fastify-plugin`. It is a plain function attached to the consumer subtree's `onRequest` hook. It never runs on standalone, editor, callback, file-download, or public routes.
- `platformAuthHook` is similarly scoped to the standalone subtree only. Consumer routes never see Platform session cookies.
- `hostnameGuard` is a new utility (SA-1.6) that rejects requests arriving on disallowed hostnames. Applies before auth so cross-hostname leaks 404 before any token is inspected.
- Every subtree that creates or operates on editor sessions uses `hostnameGuard(EDITOR_SESSION_HOSTNAMES)`. The callback route is the only one where that allowlist includes all three (connect., crm., api.docs.monolith.cx) — but NGINX still 404s the callback on the public edge; the hostname guard is defense in depth for the rare misconfiguration where a public-edge rule leaks.
- Public routes (`/health`, `/api/status`) are not hostname-guarded — they work everywhere.
- Existing `authPlugin` export and `fp` wrapper are deleted in the restructure. Tests that register the root app with `authPlugin` are updated to use the new `buildApp()` shape.

**Subtasks:**

- SA-1.5.a Extract the current `authPlugin` body into a plain `consumerAuthHook` function. Remove the `fp` wrapper. Keep the decorator registrations (`consumer`, `consumerId`, `jwtPayload`) but move them into the consumer subtree.
- SA-1.5.b Rewrite `buildApp()` per the structure above. Add `@fastify/cookie` to root (passive parsing only — no auth logic).
- SA-1.5.c Create per-route-family route modules and split the current `routes/documents.ts` and `routes/files.ts`. Complete route inventory — every existing route must land in exactly one subtree:
  - `routes/public.ts` — `GET /health`, `GET /api/status`
  - `routes/consumer.ts` — `POST /api/documents/open`, `POST /api/files/upload`, `GET /api/sessions`
  - `routes/editor.ts` — `GET /editor/:key`, `GET /api/documents/:key/download` (both session-key-bound; Platform-session-gated when `session.authSource === 'platform'`)
  - `routes/file-download.ts` — `GET /api/files/:filename` (session-bound UUID, OnlyOffice fetches source file here)
  - `routes/onlyoffice-callback.ts` — `POST /api/documents/callback` (OnlyOffice JWT; internal `API_INTERNAL_URL` only; NGINX 404s on every public edge)
  - `routes/auth.ts` — `GET /auth/callback`, `GET /auth/me`, `POST /auth/logout`
  - `routes/trpc.ts` — `POST /trpc/*`
  - `routes/provision.ts` — `POST /internal/provision` (service key)
  - `routes/events.ts` — `POST /internal/events` (Pub/Sub OIDC)
  - **Dev-only fixture surface.** The current [apps/api/src/app.ts:62-69](apps/api/src/app.ts#L62-L69) registers `fastify-static` at `/files/` serving `apps/api/src/fixtures/` when `!isProduction`. This is retained behind the same `!isProduction` guard, registered on a dedicated dev-only subtree with `hostnameGuard(EDITOR_SESSION_HOSTNAMES)` (so even in dev the fixture surface cannot bleed onto standalone hostnames without being explicitly allowed). In production the subtree is not registered at all. Document as `routes/dev-fixtures.ts`.
  - No route from the current codebase is left unaccounted for. If a new route is added later, the initiative plan must be updated to place it in a subtree; accepting a route without a subtree assignment is grounds for checkpoint rejection.
- SA-1.5.d Move the security-headers `onSend` hook into a named function registered on root. Do NOT hardcode a static `frame-ancestors` list here — framing policy is per-request and hostname-aware; it is set by the editor route handler in SA-6.2 (standalone uses `frame-ancestors https://docs.monolith.cx`; headless uses a consumer-specific origin from `Consumer.allowedFrameAncestors` added in SA-1.7). The `onSend` hook only emits the static headers (`X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security` in prod) and delegates framing/script CSP to the editor handler.
- SA-1.5.e Update every existing test that imports `authPlugin` or expects global consumer auth. Add new tests:
  - Consumer bearer token on `api.docs.monolith.cx` → 404 (hostname guard) before auth runs
  - Missing cookie on `api.docs.monolith.cx/trpc/*` → 401 (platform auth)
  - Consumer token on `connect.monolithdocs.com/api/documents/open` → 200 (unchanged)
  - Consumer token on `connect.monolithdocs.com/auth/me` → 404 (hostname guard blocks standalone routes on headless hostname)
  - `docs_session` cookie on `crm.monolithdocs.com/trpc/*` → 404
- Status: Pending
- Acceptance: `authPlugin` no longer exists as a global-scope plugin. `buildApp()` structure matches the target above. All new and existing tests pass. Hitting `/trpc/health.check` on `connect.monolithdocs.com` with a valid consumer bearer returns 404, not 401 or 200. Hitting `/api/documents/open` on `api.docs.monolith.cx` with any credential returns 404.

### SA-1.6 Add `hostnameGuard` utility and edge Host-normalization contract

- Create `apps/api/src/http/hostname-guard.ts`
- Exports `hostnameGuard(allowlist: string[])` returning a Fastify `onRequest` hook
- Reads `req.hostname` (Fastify-normalized; strips port)
- Behavior is controlled by `DOCS_HOSTNAME_GUARD_MODE` env var:
  - `strict` (default in production and CI): hostname NOT in allowlist → 404, no body, no allowlist leak in headers or logs
  - `warn` (default in local dev only, must be explicitly enabled): hostname not in allowlist → log a warning and pass through. Meant only for `localhost`-style dev where hostnames may not match prod.
  - The mode is logged at startup. CI sets `DOCS_HOSTNAME_GUARD_MODE=strict` to catch route bleed locally before it ships.
- Constants `CONSUMER_HOSTNAMES`, `STANDALONE_HOSTNAMES`, `EDITOR_SESSION_HOSTNAMES` live in `apps/api/src/http/hostnames.ts` and are env-driven so dev/staging/prod can have different values
- Also tighten `findConsumersByHostname()` in [apps/api/src/consumers.ts](apps/api/src/consumers.ts): in production, do NOT fall back to unbound consumers when no bound match exists. Return empty. The dev-compat fallback stays behind a `config.nodeEnv !== 'production'` guard. This closes the "unbound consumer on the wrong hostname" bleed Codex flagged in High #4.
- **Edge Host-normalization contract (required for defense in depth to actually work):** app-level guards trust `req.hostname`, which is derived from the `Host` header. If the edge does not normalize `Host`, an attacker-controlled or misrouted header can bypass the guard. Docs' production edge is **Cloudflare Tunnel (cloudflared) directly to `localhost:3020` and `localhost:3000`** — there is no intermediate NGINX on the current headless path (see [infrastructure/cloudflare/tunnel-config.yml](infrastructure/cloudflare/tunnel-config.yml)). The edge contract must therefore be expressed in cloudflared terms, not NGINX terms:
  1. Cloudflare edge rejects TLS handshakes whose SNI does not match a configured hostname. Hostnames are declared in Cloudflare DNS + the tunnel's Public Hostnames config per environment.
  2. Each `ingress` rule in `tunnel-config.yml` sets `originRequest.httpHostHeader: <matched-hostname>`. This forces cloudflared to rewrite `Host` to the rule's matched value before forwarding to the local service, overriding whatever the client sent.
  3. `X-Forwarded-Host` is not trusted by Fastify — `req.hostname` reads from the forwarded `Host` (already normalized by step 2), not `X-Forwarded-Host`.
  4. The `- service: http_status:404` catch-all rule remains the last ingress entry so unmatched hostnames never reach Fastify.
- **NGINX path for `app.monolithdocs.com`:** this hostname does not go through the tunnel — it reaches the GCE VM via Cloudflare DNS → public IP → NGINX on `:443` (see [infrastructure/nginx/monolith-docs.conf](infrastructure/nginx/monolith-docs.conf)). The NGINX server block MUST set `proxy_set_header Host $server_name;` on every `location` block (currently uses `$host`, which passes through the client-supplied header) and must not trust upstream `X-Forwarded-Host`. Full details in SA-6.2.
- SA-6.2 adds concrete subtasks to extend `tunnel-config.yml` with four ingress rules (`docs.monolith.cx`, `api.docs.monolith.cx`, `connect.monolithdocs.com`, `crm.monolithdocs.com`) each with `originRequest.httpHostHeader`, and to tighten the existing NGINX config for `app.monolithdocs.com`. Acceptance: prod-path crafted-Host test through the tunnel is rewritten correctly; prod-path crafted-Host test through NGINX is also rewritten correctly; unmatched hostnames return 404 at both edges.
- Status: Pending
- Acceptance: Unit tests cover allowlist hit / miss, mode behavior, and `findConsumersByHostname` prod strictness. Integration test: consumer configured without `hostname` field + production node env → all consumer-auth requests fail with 503 (no bound consumers), not silently authorize. Prod-path test: sending `Host: api.docs.monolith.cx` to the `connect.` edge returns edge-level rejection, not an upstream 200.

### SA-1.7 Extend `Consumer` config with `allowedFrameAncestors`

- Add `allowedFrameAncestors?: string[]` to `Consumer` in [apps/api/src/consumers.ts](apps/api/src/consumers.ts)
- Each entry is a full origin (scheme + host, no trailing slash): e.g., `['https://app.connect.example.com']`
- The editor route handler (SA-6.2 CSP section) resolves the request's consumer (via `findConsumersByHostname`) and emits `frame-ancestors` containing the consumer's allowed origins. Standalone requests use a hardcoded `frame-ancestors https://docs.monolith.cx`.
- If a consumer has no `allowedFrameAncestors` set in production, emit `frame-ancestors 'none'` and log a warning — fail closed, not open.
- Environment configs supply dev/staging/prod values separately (dev can include `http://localhost:*` explicitly)
- Update existing consumer definitions in `consumers.ts` / `.env.example` to include this field
- Status: Pending
- Acceptance: Editor page framed by an origin in the consumer's allowlist loads; framed by any other origin, browser blocks the frame. Consumer with no allowlist in production emits `frame-ancestors 'none'` and the warning appears in logs.

---

## Phase 2: Platform SSO authentication

**Goal:** Users can sign in via Platform SSO and get a Docs session. No frontend yet — tested via direct HTTP calls.

### SA-2.0 Ecosystem prerequisite — extend `auth-sso.md` with logout spec

This step is an ecosystem-layer deliverable that blocks SA-2.2. It does not belong to Docs alone; it is coordinated through the Platform ecosystem.

- Extend [C:/Dev/monolith-platform/docs/ecosystem/contracts/auth-sso.md](C:/Dev/monolith-platform/docs/ecosystem/contracts/auth-sso.md) with a dedicated Logout section covering:
  - Canonical logout URL — one value, versioned like the rest of the contract. Do not pre-commit a specific hostname in this plan; `auth-sso.md` is the single source of truth and the UNIFY DNS initiative may alter the login-gateway hostname independently.
  - `redirect_uri` parameter semantics: required, allowlisted per product in Platform admin, must match exactly (same rules as login `redirect_uri`)
  - Session-scope behavior: does Platform logout also invalidate Firebase refresh tokens, revoke product sessions across all products, or only clear the gateway cookie? This affects whether Docs needs to do anything beyond redirecting.
  - Browser-side contract: logout gateway clears the gateway session cookie, then 302s to `redirect_uri`. Product is responsible for clearing its own product session before sending the user to the logout URL.
  - How the product registers its logout `redirect_uri` with Platform (same allowlist table as login, or separate?)
- Update the contract version and changelog entry
- Cross-project work: this step is an ecosystem initiative responsibility. Docs cannot ship SA-2.2 until this contract update lands.
- Status: Pending — blocked on Platform ecosystem sign-off
- Acceptance: `auth-sso.md` has a Logout section with the fields above. The canonical logout URL is listed. Docs config (`PLATFORM_LOGOUT_URL`) sources its value from the contract, not the plan.

### SA-2.1 Session service

- Create `apps/api/src/platform/session.ts`
- HS256 JWT signing/verification with `DOCS_SESSION_SECRET` env var
- Payload: `{ platformUserId, platformTenantId, tenantSlug, email, role }`
- 24-hour expiry, issuer `monolith-docs`
- `sign(payload)` → JWT string
- `verify(token)` → payload or throws
- Status: Pending
- Acceptance: Unit tests for sign/verify, expired token rejection, tampered token rejection

### SA-2.2 Auth callback route

- Create `apps/api/src/routes/auth.ts`
- `GET /auth/callback?code=<code>` — exchanges code with Platform API (`POST /auth/exchange`)
  - Server-side only, never client-side
  - On success: sign Docs JWT, set `docs_session` httpOnly cookie, redirect to frontend
  - On failure: redirect to frontend with error
- `GET /auth/me` — returns current user from session cookie (or 401)
- `POST /auth/logout` — **global logout, not local-only**:
  - **Blocked on ecosystem contract update.** The current [auth-sso.md](C:/Dev/monolith-platform/docs/ecosystem/contracts/auth-sso.md) does not document a logout endpoint; it only specifies the login gateway hostname (`login.monolithplatform.com` today, subject to the pending UNIFY DNS rename). Before implementing `/auth/logout`, the Platform ecosystem contract must be extended with: canonical logout URL, accepted `redirect_uri` semantics, redirect-URI allowlisting rules, session-scope behavior (does Platform logout also terminate Firebase refresh tokens?), and the expected browser-side flow. This is SA-2.0 below. Do not hardcode a logout URL in Docs until that contract lands.
  - Clears the `docs_session` cookie on the response
  - Revokes any live standalone editor sessions owned by the logging-out user (see SA-2.6 revoke-on-logout). Must happen before the cookie is cleared so the session-store lookup still has the Platform user identity.
  - Returns `{ logoutUrl: "<PLATFORM_LOGOUT_URL>?redirect_uri=<DOCS_FRONTEND_ORIGIN>/signed-out" }` where `PLATFORM_LOGOUT_URL` is read from config, whose value comes from the canonical URL in the updated `auth-sso.md` contract. `DOCS_FRONTEND_ORIGIN` is the Docs frontend origin for the current environment.
  - Frontend is responsible for navigating the browser to `logoutUrl` after receiving the response. This kills the Platform gateway session too, so the user is not silently re-auth'd on the next visit.
  - CSRF protection: require `Origin` header to match `DOCS_FRONTEND_ORIGIN` (reject otherwise). `SameSite=Lax` does not protect against sibling-origin POSTs under `monolith.cx`, so this guard is required on every state-changing standalone route — logout is the minimum.
- Register routes in `app.ts` (public paths, no consumer auth)
- Cookie settings: httpOnly, secure (prod), sameSite `lax` (prod and dev), maxAge 24h, no `Domain` attribute (host-only cookie scoped to `api.docs.monolith.cx`). `SameSite=Lax` is sufficient because `docs.monolith.cx` and `api.docs.monolith.cx` are same-site under the `monolith.cx` registrable domain, so same-site fetches include the cookie without needing `SameSite=None`.
- Redirect URI must match Platform registration exactly: `https://api.docs.monolith.cx/auth/callback` in production
- Status: Pending
- Acceptance: Hit callback with valid code → cookie set → `/auth/me` returns user. Invalid code → error redirect. POST `/auth/logout` with matching Origin → cookie cleared, response includes `logoutUrl` pointing at Platform logout. POST `/auth/logout` with missing/mismatched Origin → 403. After following the returned `logoutUrl`, Platform gateway session is cleared and user lands on `/signed-out`; reloading `docs.monolith.cx` redirects to Platform login instead of silently re-authing.

### SA-2.3 Platform auth hook (Fastify)

- Create `apps/api/src/platform/auth-hook.ts`
- `platformAuthHook` — Fastify `onRequest` hook
  - Reads `docs_session` cookie
  - Verifies JWT via session service
  - Sets `request.platformUserId`, `request.platformTenantId`, `request.authSource`
  - Returns 401 if missing/invalid (for protected routes)
- Only applied to `/trpc` and `/auth/me` routes — NOT to existing headless routes
- Status: Pending
- Acceptance: Protected route returns 401 without cookie, 200 with valid cookie. Existing headless routes unaffected.

### SA-2.4 Tenant context hook (Fastify)

- Create `apps/api/src/platform/tenant-hook.ts`
- `tenantContextHook` — Fastify `preHandler` hook
  - Resolves local tenant by `platform_tenant_id` (unscoped query)
  - Resolves local user by `(tenant_id, platform_user_id)` with `withTenant()`
  - Fetches active business unit affiliations
  - Resolves `businessUnitId` from `X-Business-Unit-Id` header or primary affiliation
  - Sets `request.tenantId`, `request.userId`, `request.userRole`, `request.businessUnitId`
  - Returns 403 if tenant not found, user not found, or user suspended
- Status: Pending
- Acceptance: With valid session + provisioned tenant/user → context populated. Missing tenant → 403. Suspended user → 403.

### SA-2.5 Register callback URL with Platform

- Register `https://api.docs.monolith.cx/auth/callback` (prod) and `http://localhost:3020/auth/callback` (dev) in Platform's `Product.allowed_redirect_uris` for the Docs product
- Create Docs service key in Platform, store in `CREDENTIALS.md`
- Status: Pending
- Acceptance: Platform allows redirect to registered URLs

### SA-2.6 Standalone editor session gate and revoke-on-logout

**Problem being solved.** `/editor/:key` is session-key-bound but otherwise public — anyone with a live URL can load the document. For headless consumers, the key is unguessable and only the consumer knows it, which is acceptable within the consumer's trust boundary. For standalone, a leaked URL (email forwarding, browser history, shared-device shoulder-surfing) bypasses the Platform session boundary entirely. The session key alone is not the right bar for a first-party product surface.

**Design:**

- Extend the in-memory session shape to record origin:
  - `authSource: 'consumer' | 'platform'`
  - For standalone sessions: `platformUserId`, `platformTenantId`
  - For consumer sessions: `consumerId` (already tracked)
- Create `apps/api/src/http/editor-session-gate.ts` exporting `standaloneEditorSessionGate` as a Fastify `preHandler` hook:
  - Look up the session by `:key` parameter
  - If `session.authSource === 'consumer'` → pass through (existing headless behavior unchanged)
  - If `session.authSource === 'platform'`:
    - Require `docs_session` cookie on the request
    - Verify the cookie (reuse `platformAuthHook` logic or call the session service directly)
    - Require `cookie.platformUserId === session.platformUserId` AND `cookie.platformTenantId === session.platformTenantId`
    - On any failure → 401 with a minimal HTML response that tells the user to return to `https://docs.monolith.cx` and sign in (no redirect chain — avoid loops if the cookie is stale)
- Wire the gate into the editor subtree in SA-1.5's `buildApp()` (already referenced in that step)
- **Standalone session TTL tracks the Platform cookie, not a shorter wall-clock window.** The design premise is that the cookie-gate on every editor load is the real identity enforcement; the session's own TTL is garbage collection for orphaned sessions, not an access-control boundary. This avoids the mid-edit-death failure mode that would come from assuming OnlyOffice save-status callbacks fire often enough to keep `lastActivityAt` fresh — that assumption is OnlyOffice-version-dependent and fragile.
  - New env var `STANDALONE_SESSION_TTL_MS` defaulting to `24 * 60 * 60 * 1000` (24h, matching the Platform cookie expiry)
  - Headless `SESSION_TTL_MS` unchanged at 24h (consumer contract)
  - The existing cleanup loop at [apps/api/src/routes/documents.ts:101-114](apps/api/src/routes/documents.ts#L101-L114) continues to run unchanged. A standalone session's `lastActivityAt` gets bumped by (a) OnlyOffice save-status callbacks when they fire, (b) the `standaloneEditorSessionGate` when the editor page is loaded with a valid cookie. Even if (a) never fires for a given session, (b) covers the tab-reload case.
  - **Active-edit safety:** a user editing continuously for 23 hours without reloading the tab will not have the session expire mid-edit — the 24h TTL is compared against `lastActivityAt`, which was bumped at session creation. Beyond 24h of continuous editing without any callback and without any reload, the session cleanup loop would evict it; this is a corner case (continuous 24h+ editing session with no auto-save callbacks at all) that we accept rather than solve with a client-side heartbeat. Auto-save in OnlyOffice defaults to fire well within this window; the probe in SA-6.2 CSP compatibility explicitly exercises auto-save cadence.
- **The real security boundaries are elsewhere:**
  - `standaloneEditorSessionGate` checks the Platform cookie on every `/editor/:key` load. Cookie expired (24h after issue) → 401, regardless of session TTL.
  - Revoke-on-logout (SA-2.2) deletes all of the user's standalone sessions immediately when they sign out.
  - The session key itself is unguessable, and never escapes the authenticated-user's browser for standalone sessions.
- **What we do NOT do, and why:**
  - No client-side heartbeat ping from the editor HTML. Adding one would require expanding the CSP nonce pattern, adding a new unauthenticated endpoint that bumps session activity, and introducing a timer-based behavior that's hard to test. The Platform cookie check already covers the security goal.
  - No shorter-than-cookie TTL. The earlier draft proposed 1h and then 8h; both would have created user-visible session-death surprises without meaningful security benefit over the cookie gate.
- **Acceptance probe (part of SA-2.6 closure, not just assumption):** during the OnlyOffice 8.3 CSP probe (SA-6.2), also record the observed save-status callback cadence during a 2-hour continuous-edit session. Confirm that `lastActivityAt` is bumped at least once. If callbacks are observed to be sparser than the 24h TTL window (unlikely given auto-save defaults), revisit this design before lock.
- **Revoke-on-logout:** when `POST /auth/logout` runs (SA-2.2), iterate the session store and delete every session where `authSource === 'platform'` AND `platformUserId` matches the cookie's user. This closes the attack window: a leaked URL that was valid before logout stops working immediately after.
  - Document that consumer sessions for the same underlying Platform user (if any cross-pollination ever existed) are not touched — consumer sessions are bound to the consumer's trust boundary, not the Platform user.
  - When Redis replaces the in-memory session store later, add an index on `platformUserId` for O(1) revocation.

- Status: Pending
- Acceptance:
  - Standalone session opened by user A → editor loads with A's cookie → 200. Same URL loaded by user B with B's cookie → 401. Same URL loaded with no cookie → 401.
  - After `POST /auth/logout` by user A, reloading any previously-open standalone editor URL owned by A → 401 within seconds.
  - Headless consumer sessions are unaffected: same URL with no cookie still loads (existing behavior).
  - Standalone session TTL is 24h, matching Platform cookie expiry. Active-editing test: 2-hour continuous-edit session with default OnlyOffice auto-save fires at least one callback that bumps `lastActivityAt`; no mid-edit eviction observed. Tab reload bumps `lastActivityAt` via the gate, extending the TTL window.
  - Platform cookie expiry is the real access boundary; once the cookie expires, the editor gate blocks loads even if the session record still exists.
  - OnlyOffice save-status callback cadence observed during the 2-hour probe is recorded in the SA-2.6 checkpoint review, so the "24h TTL is safely longer than any callback gap" claim has empirical backing rather than assumption.

---

## Phase 3: Provisioning and event infrastructure

**Goal:** Platform can provision tenants into Docs. Docs receives and processes Platform events.

### SA-3.1 Provisioning endpoint

- Create `apps/api/src/routes/provision.ts`
- `POST /internal/provision` — service key auth via `Authorization: ServiceKey <key>`
  - Validates service key (bcrypt hash lookup or SDK verification)
  - Parses `ProvisionRequest` body (tenant, owner, users, org structure, plan)
  - Idempotent: if tenant with same `platform_tenant_id` exists, verify and return success
  - Creates: Tenant + all Users + LegalEntities + BusinessUnits + Affiliations
  - All within a single transaction
  - Returns `{ success: true }` or `{ success: false, error: "..." }`
  - 30-second timeout
- Register in `app.ts` (not behind consumer auth or platform auth — uses service key)
- Status: Pending
- Acceptance: POST with valid service key + payload creates tenant with all related records. Repeat call is idempotent. Invalid key returns 401.

### SA-3.2 Event receiver endpoint

- Create `apps/api/src/platform/event-receiver.ts`
- `POST /internal/events` — receives Pub/Sub push messages
  - Public route (Pub/Sub authenticates via OIDC)
  - Production: verify OIDC JWT from `Authorization: Bearer <token>` against `https://oauth2.googleapis.com/tokeninfo`
  - Decode base64-encoded Pub/Sub message body
  - Parse `PlatformEventEnvelope` (validate eventId, eventType, tenantId, source)
  - Dedup via `EventInbox` table (check event_id, skip if already processed)
  - Insert to inbox with status `enqueued`
  - Process inline via event handler (SA-3.3)
  - Always return 204 (ack to Pub/Sub regardless of processing outcome)
- Status: Pending
- Acceptance: Valid Pub/Sub push message → stored in inbox → processed → 204. Duplicate message → idempotent 204. Invalid payload → logged, 204.

### SA-3.3 Event handler (sovereignty sync)

- Create `apps/api/src/platform/event-handler.ts`
- Dispatches by `eventType` to specific handlers
- All handlers resolve local tenant by `platform_tenant_id` first (skip if not found)
- Version conflict resolution: skip write if `incoming.version <= stored.platform_sync_version`

- **Tenant events:**
  - `platform.tenant.deactivated` → update tenant status
  - `platform.tenant.suspended` → update tenant status
  - `platform.tenant.reactivated` → update tenant status
  - `platform.tenant.deleted` → mark tenant deleted

- **User events:**
  - `platform.user.invited` → create user with status `invited`
  - `platform.user.activated` → update status to `active`
  - `platform.user.deactivated` → update status to `suspended`
  - `platform.user.updated` → merge changes (name, email)
  - `platform.user.role.changed` → update role

- **Seat events:**
  - `platform.seat.granted` → create or activate user for Docs product
  - `platform.seat.revoked` → suspend user for Docs product

- **Subscription events:**
  - `platform.subscription.created` → update tenant plan_slug
  - `platform.subscription.changed` → update plan_slug, invalidate entitlement cache
  - `platform.subscription.cancelled` → update tenant status, invalidate cache

- **Org structure events:**
  - `platform.org.legal_entity.*` → CRUD local LegalEntity records
  - `platform.org.business_unit.*` → CRUD local BusinessUnit records
  - `platform.org.affiliation.*` → CRUD local BusinessUnitAffiliation records

- Status: Pending
- Acceptance: Each event type creates/updates correct records. Version conflicts are handled. Missing tenant skips gracefully.

### SA-3.4 Event outbox publisher

- Create `apps/api/src/platform/outbox-publisher.ts`
- Notify-driven batch publisher (not interval-polled)
- `notify()` method triggers `setImmediate` publish batch
- Batch size: 50 rows, max 10 attempts per row
- Publishes via `platform.events.publish()` from SDK
- Startup sweep on init: publish any unpublished rows from prior crashes
- Helper: `enqueueEvent(tx, { eventType, tenantId, data, businessUnitId? })` — writes to outbox within caller's transaction

- Status: Pending
- Acceptance: Enqueued event is published within seconds. Failed publish retries up to 10 times. Startup sweep catches orphaned rows.

### SA-3.5 Entitlement checking

- Create `apps/api/src/platform/entitlements.ts`
- Two layers (matching CRM/Connect pattern):
  - `EntitlementService` class — for use in route handlers
  - `requireDocsEntitlement(platformTenantId)` standalone function — for tRPC middleware
- 60-second TTL cache per tenant
- Allowed statuses: `active`, `trialing`, `past_due`
- Fail-open on Platform errors (log warning, allow access)
- `invalidateEntitlementCache(tenantId)` — called by event handler on subscription events

- Status: Pending
- Acceptance: First call hits Platform API. Second call within 60s uses cache. Subscription event invalidates cache. Platform down → access allowed.

---

## Phase 4: tRPC router and API layer

**Goal:** Frontend-facing API for dashboard, document operations, and user data. Tested via HTTP before frontend exists.

### SA-4.1 tRPC setup on Fastify

- Install `@trpc/server` with Fastify adapter
- Create `apps/api/src/trpc/init.ts`
  - Context builder: extract `tenantId`, `platformTenantId`, `userId`, `userRole`, `businessUnitId` from request (set by hooks in Phase 2)
  - `publicProcedure` — no auth required
  - `protectedProcedure` — requires tenantId + userId, checks entitlement, and enforces the CSRF rule below
  - `adminProcedure` — requires admin/owner role (plus protectedProcedure's checks)
- Mount at `/trpc` in the standalone subtree (SA-1.5) with platform auth + tenant context hooks applied
- Existing routes at `/api/*` are NOT affected

**CSRF on tRPC (required, not deferred):**

`SameSite=Lax` does not prevent sibling-origin cookie-bearing POSTs under `*.monolith.cx`. Every cookie-authenticated tRPC call is CSRF-exposed without an explicit check. `httpBatchLink` sends batched POSTs to `/trpc`, and the frontend cannot override the browser-supplied `Origin` header programmatically — the browser always sets it, so `Origin` is the correct signal.

- Add a `csrfHook` Fastify `onRequest` hook, registered inside the standalone subtree before the tRPC plugin, that applies to every POST/PUT/PATCH/DELETE to `/trpc` (mutations) AND `/auth/logout`:
  - Read request `Origin` header
  - Require exact match against the configured `DOCS_FRONTEND_ORIGIN` (prod: `https://docs.monolith.cx`; dev: `http://localhost:3000`)
  - Missing `Origin` on a state-changing request → 403
  - Mismatched `Origin` → 403
  - GET requests skip this check (no state change; cookie-bearing GETs can't be weaponized for CSRF against mutations)
- The tRPC adapter batch endpoint is always POST, even for query batches. The CSRF hook must NOT block query-only batches — but because tRPC batches can mix queries and mutations in one POST, the conservative rule is: apply `Origin` check to all `POST /trpc/*` requests. Pure query batches from the browser will still have a correct `Origin`, so this is not a functional regression; it is only additional tightening.
- Tests:
  - `POST /trpc/dashboard.recentDocs` with valid cookie and no `Origin` → 403
  - `POST /trpc/dashboard.recentDocs` with valid cookie and `Origin: https://evil.monolith.cx` → 403
  - `POST /trpc/dashboard.recentDocs` with valid cookie and `Origin: https://docs.monolith.cx` → 200
- Document the rule in guidance.md so future procedures inherit it without re-deciding.
- `X-Business-Unit-Id` custom header stays in the allowed CORS list (SA-6.2); presence of a custom header is a weaker CSRF signal (preflight required) but we do not rely on it — `Origin` is the binding check.

- Status: Pending
- Acceptance: `POST /trpc/health.check` returns OK. Protected procedure returns 401 without session. CSRF tests above pass. `POST /auth/logout` CSRF behavior is identical (already specified in SA-2.2; the hook is shared). Existing `/api/*` routes still work.

### SA-4.2 Dashboard procedures

- `dashboard.recentDocs` — list recent documents for current user (from RecentDocument table)
- `dashboard.stats` — document count, active sessions (optional v1)
- `documents.create` — create new blank document (Word/Excel/PowerPoint)
  - Creates document session via existing session manager
  - Creates backing file in Platform storage and stores `platform_file_id`
  - Records in RecentDocument
  - Enqueues `docs.document.created` event
  - Returns `{ editorUrl, key }`
- `documents.uploadAndOpen` — upload file from desktop, open in editor
  - Accepts multipart file or upload metadata flow from frontend
  - Stores via Platform storage (`requestUploadUrl` + client upload + `confirmUpload`)
  - Uses Platform-provided thumbnails (`getThumbnailUrl`) for recent-doc / dashboard previews
  - Creates document session
  - Records in RecentDocument
  - Returns `{ editorUrl, key }`

- Status: Pending
- Acceptance: Create document returns valid editorUrl that opens OnlyOffice. Upload opens document. Recent docs list shows opened documents.

### SA-4.3 User and tenant procedures

- `user.me` — current user profile from session
- `user.preferences` — get/set user preferences (theme, density — stored in Redis)
- `tenant.info` — current tenant name, plan, status

- Status: Pending
- Acceptance: All procedures return correct data scoped to authenticated user/tenant.

---

## Phase 5: Next.js frontend

**Goal:** User-facing web app at `docs.monolith.cx` with dashboard, document creation, and editor. Frontend calls the Fastify API at `api.docs.monolith.cx` (same-site under `monolith.cx` for first-party cookies).

### SA-5.1 Scaffold Next.js app

Target stack matches `monolith-platform/apps/portal` so shared tooling (UI components, tRPC setup, auth context patterns) transfers cleanly.

Version policy: use the current ecosystem-approved frontend baseline at implementation time, not stale draft-era pins. As of this plan refresh, that means Next.js 16.x on React 19.x, aligned with the active Platform `stack-upgrade` initiative.

- Create `apps/web/` as `@monolith-docs/web` workspace package
- Next.js 16.x, React 19.x, App Router, TypeScript 6.0.3
- Dependencies (pinned to match Platform portal versions):
  - `@monolith-platform/ui` from Artifact Registry (`^0.1.0` or current)
  - `@tanstack/react-query` `^5.75.0`
  - `@trpc/client` `^11.1.0`, `@trpc/react-query` `^11.1.0`
  - `superjson` `^2.2.2`
  - `lucide-react` `^0.460.0`
  - `jose` `^4.15.0` (if any client-side token inspection is ever needed; otherwise skip)
  - `next` `^16.1.0` or the current validated 16.x patch from Platform STACK, `react` / `react-dom` on the current validated 19.x patch
- Dev dependencies:
  - `tailwindcss` `^4.1.0`, `@tailwindcss/postcss` `^4.1.0`
  - `@playwright/test` `^1.59.1`
  - `@types/node` `^24.0.0`, `@types/react` `^19.1.0`, `@types/react-dom` `^19.1.0`
  - `typescript` `6.0.3`
- Configure Tailwind 4 with Platform UI theme variables (VS Code Modern scheme) — copy the Tailwind config pattern from `monolith-platform/apps/portal`
- **Do NOT configure a Next.js proxy for `/trpc` or `/auth/*`.** The frontend calls `https://api.docs.monolith.cx` directly; session cookies are first-party under `monolith.cx`. Proxying would break the host-only cookie model.
- `next.config.ts` sets only whatever is strictly needed (headers/rewrites for static assets, no API proxy)
- Add `web` service to docker-compose (port 3000, depends on api). In dev the frontend runs at `http://localhost:3000` and calls the API at `http://localhost:3020` — same-site under `localhost`, so `SameSite=Lax` works locally just as it does in prod.
- Root Turbo `dev` task adds `apps/web#dev` alongside `apps/api#dev`
- Status: Pending
- Acceptance: `pnpm --filter @monolith-docs/web run dev` starts Next.js on port 3000. Platform UI components render with correct theme. Direct fetch to `http://localhost:3020/auth/me` from the dev frontend succeeds with `credentials: 'include'` and cookie is stored against `localhost:3020`.

### SA-5.2 Auth flow in frontend

- `PlatformAuthContext` provider
  - On mount: call `https://api.docs.monolith.cx/auth/me` (with `credentials: 'include'`) to check for existing session
  - If no session: redirect to Platform login gateway with `redirect_uri=https://api.docs.monolith.cx/auth/callback`
  - After SSO callback: `/auth/me` returns user → context populated
  - `signOut()` calls `POST /auth/logout` (with `credentials: 'include'` and explicit `Origin` header), reads the returned `{ logoutUrl }`, then navigates `window.location.href = logoutUrl` so the browser follows Platform's logout and lands on `/signed-out`
- `/signed-out` page: static landing with "You've been signed out" message and a "Sign back in" button that triggers the normal login redirect flow
- Protected layout wrapper: redirects unauthenticated users to Platform login

- Status: Pending
- Acceptance: Unauthenticated visit → redirect to Platform login. After login → dashboard loads on `docs.monolith.cx` with session cookie set by `api.docs.monolith.cx`. Sign out → browser follows Platform logout URL → lands on `/signed-out`. Reloading `docs.monolith.cx` after sign-out does NOT silently re-auth; it redirects back to Platform login.

### SA-5.3 tRPC client setup

- Configure tRPC client with `httpBatchLink` pointing at `https://api.docs.monolith.cx/trpc`
- `fetch` option must include `credentials: 'include'` so the `docs_session` cookie is sent on cross-origin (but same-site) requests from `docs.monolith.cx` to `api.docs.monolith.cx`
- No Authorization header needed — session is in the httpOnly cookie, sent automatically once `credentials: 'include'` is set
- Integrate with React Query for caching
- Type-safe hooks: `trpc.dashboard.recentDocs.useQuery()`, etc.

- Status: Pending
- Acceptance: tRPC queries return data. Type errors caught at compile time. React Query caching works.

### SA-5.4 App shell (header, navigation, layout)

- Root layout with theme provider (light/dark/system, density)
- `PreferencesContext` — stored in localStorage as `monolith-preferences` (same key as CRM/Connect)
- Header: 56px, left: logo/nav, right: app switcher (Grid3X3), notifications (Bell), user profile dropdown
- Profile dropdown: name, email, tenant, theme switcher, density selector, sign out
- App switcher: links to CRM, Connect, Docs, Platform portal
- Responsive layout

- Status: Pending
- Acceptance: Header matches CRM/Connect visually. Theme toggle works. App switcher shows all Monolith products. Density settings apply.

### SA-5.5 Dashboard page

- Document type picker: create new Word, Excel, or PowerPoint document (icons + labels)
- Upload from desktop: file input accepting allowed document types
- Recent documents list: type icon, file name, last opened timestamp, Platform thumbnail when available, click to reopen
- Empty state for new users

- Status: Pending
- Acceptance: Create new document → opens editor in new tab/page. Upload file → opens editor. Recent docs populate after opening documents.

### SA-5.6 Editor page integration

- Route: `/editor/[key]` in Next.js
- Wraps the existing OnlyOffice embed page (`/editor/:key` from Fastify)
- Can either iframe the existing editor page or render the OnlyOffice config directly
- Back-to-dashboard navigation
- Save status indicator

- Status: Pending
- Acceptance: Editor loads and is fully functional. Document edits save correctly. User can navigate back to dashboard.

---

## Phase 6: Infrastructure and deployment

**Goal:** Production deployment with all services running.

### SA-6.1 Docker Compose finalization

- All services: OnlyOffice, API, PostgreSQL, Redis, Next.js frontend
- Health checks for all services
- Environment variable documentation in `.env.example`
- Dev vs. prod compose profiles if needed

- Status: Pending
- Acceptance: `docker compose up -d` starts everything. All health checks pass.

### SA-6.2 NGINX routing update

**Hostname families:**

- `docs.monolith.cx` → Next.js frontend (port 3000). Public browser entry point for the standalone product.
- `api.docs.monolith.cx` → Fastify API (port 3020). Serves `/auth/*`, `/trpc`, `/internal/*`, `/editor/*` for standalone sessions, and `/health` / `/api/status`.
- `connect.monolithdocs.com` → Fastify API (port 3020). Serves the existing headless consumer surface for Connect. Unchanged.
- `crm.monolithdocs.com` → Fastify API (port 3020). Serves the existing headless consumer surface for CRM. Unchanged.

**Route exposure rules (enforced at NGINX):**

- Consumer-authenticated routes (`/api/documents/open`, `/api/files/upload`, `/api/sessions`) are reachable ONLY on `connect.` and `crm.monolithdocs.com`. Block on `docs.monolith.cx` and `api.docs.monolith.cx`.
- Standalone routes (`/auth/*`, `/trpc`, `/internal/*`) are reachable ONLY on `api.docs.monolith.cx`. Block on `connect.` and `crm.monolithdocs.com`.
- OnlyOffice → API callback is an **internal-only path**: the editor config's `callbackUrl` uses `API_INTERNAL_URL` (default `http://api:3020`, the docker service name), which is reachable only from OnlyOffice DocumentServer on the same docker network. `/api/documents/callback` is NOT exposed on any public edge — not on `connect.`/`crm.monolithdocs.com`, not on `api.docs.monolith.cx`. NGINX on every public hostname should explicitly block or 404 this path. The browser sees the internal URL in the OnlyOffice config but cannot reach it from outside the VM; DocumentServer is the only caller.
- `/editor/:key` is reachable on any hostname that created the session. For standalone sessions, the editor is served from `api.docs.monolith.cx/editor/:key` and framed by `docs.monolith.cx`.
- `/health` and `/api/status` remain public on all hostnames.
- Because `/api/documents/callback` stays internal, every save (for both headless and standalone) uses the docker-network path `http://api:3020`, never Cloudflare / NGINX / public TLS. Save reliability is not coupled to the public edge.

**CORS on `api.docs.monolith.cx`:**

- `Access-Control-Allow-Origin: https://docs.monolith.cx` (specific, not `*`)
- `Access-Control-Allow-Credentials: true`
- Allowed methods: `GET, POST, OPTIONS`
- Allowed headers: `Content-Type, X-Business-Unit-Id`
- Preflight caching as appropriate

**OnlyOffice DocumentServer public origin:**

The editor iframe served at `api.docs.monolith.cx/editor/:key` does not contain the editor itself — it bootstraps OnlyOffice's client JS from `ONLYOFFICE_PUBLIC_URL` (see [apps/api/src/routes/documents.ts:421](apps/api/src/routes/documents.ts#L421)) and opens a WebSocket to DocumentServer for co-editing and save-status updates. That origin must be explicitly assigned for standalone — it was not in the previous plan draft.

- Keep `ONLYOFFICE_PUBLIC_URL=https://app.monolithdocs.com` as the DocumentServer public origin for both headless and standalone. `app.monolithdocs.com` already proxies `/web-apps/*`, `/sdkjs/*`, `/fonts/*`, `/cache/*`, `/doc/*` (WebSocket upgrade), and other DocumentServer paths to the internal `http://onlyoffice:80`. This is the same proxying pattern headless consumers already use (CRM and Connect iframes at `connect./crm.monolithdocs.com/editor/:key` also load DocumentServer assets cross-origin from `app.monolithdocs.com`). No new hostname is introduced.
- `app.monolithdocs.com` is re-scoped under UNIFY from "standalone frontend hostname" to "DocumentServer public origin hostname, internal infrastructure." It is not marketed and not linked from `monolith.cx`. Only DocumentServer proxy paths live here; consumer API routes remain blocked on this hostname.
- WebSocket upgrade on `app.monolithdocs.com/doc/*` must be preserved. This traffic rides the Cloudflare DNS → public IP → NGINX → OnlyOffice path (the existing NGINX `location /` block handles the `Upgrade` / `Connection: upgrade` headers, see [infrastructure/nginx/monolith-docs.conf](infrastructure/nginx/monolith-docs.conf)). It is NOT routed through Cloudflare Tunnel. Confirm the WS upgrade is not regressed by any NGINX changes made in SA-6.2 or by UNIFY edge changes.
- Alternative considered but rejected for v1: proxying DocumentServer assets through `api.docs.monolith.cx/web-apps/*` for a same-origin standalone bootstrap. Same-origin is cleaner for CSP but adds NGINX complexity, duplicates WS-upgrade configuration, and is not required for correctness — cross-origin asset loading already works for headless. Deferred to a future optimization initiative.

**CSP and framing:**

- `docs.monolith.cx` CSP:
  - `frame-src https://api.docs.monolith.cx`
  - `connect-src https://api.docs.monolith.cx <PLATFORM_LOGIN_ORIGIN>` where `<PLATFORM_LOGIN_ORIGIN>` is the canonical origin recorded in `auth-sso.md` (see SA-2.2 and SA-6.4). Do not hardcode `login.monolith.cx` or `login.monolithplatform.com` in the plan — take the value from the contract at implementation time.
  - No direct DocumentServer references — the frontend never loads DocumentServer directly; only the iframed editor page does.
- `api.docs.monolith.cx` editor-page responses are generated per-request by the editor route handler (not by the root `onSend` hook — see SA-1.5.d). The handler:
  1. Generates a cryptographically random `nonce` (base64-encoded, 128-bit) for each response
  2. Adds `nonce="<nonce>"` to the inline `<script>` tag in the page template at [apps/api/src/routes/documents.ts:422-427](apps/api/src/routes/documents.ts#L422-L427) — the inline `new DocsAPI.DocEditor(...)` bootstrap stays inline but becomes CSP-compliant without needing `'unsafe-inline'`
  3. Resolves `frame-ancestors` per-request:
     - Standalone request (hostname = `api.docs.monolith.cx`): `frame-ancestors https://docs.monolith.cx`
     - Headless request (hostname = `connect.` or `crm.monolithdocs.com`): `frame-ancestors` joins `Consumer.allowedFrameAncestors` (from SA-1.7); if empty, `frame-ancestors 'none'` + warning log
  4. Emits the full CSP:
     - `frame-ancestors <per-request resolution above>`
     - `default-src 'none'`
     - `script-src 'self' 'nonce-<nonce>' https://app.monolithdocs.com`
     - `style-src 'self' 'unsafe-inline' https://app.monolithdocs.com` (OnlyOffice inlines styles at runtime; switch to nonce-based styles only if OnlyOffice adds support — not today)
     - `img-src 'self' data: https://app.monolithdocs.com`
     - `font-src 'self' https://app.monolithdocs.com`
     - `connect-src 'self' https://app.monolithdocs.com wss://app.monolithdocs.com`
     - `frame-src https://app.monolithdocs.com`
     - `worker-src blob:` (OnlyOffice creates workers from blob URLs for some features)
     - `child-src blob:` (legacy fallback for browsers that honor `child-src` over `worker-src`/`frame-src`)
     - `object-src 'none'`
     - `base-uri 'self'`
     - `form-action 'none'`
**OnlyOffice 8.3 CSP compatibility gate (blocks SA-6.2 lock).**

The nonce-based CSP above is designed on the assumption that OnlyOffice 8.3 loads its runtime code exclusively via external `<script src>` tags (which `script-src 'self' https://app.monolithdocs.com` permits) and does NOT inject unnonced inline `<script>` blocks at runtime. That assumption MUST be verified empirically against the installed DocumentServer version before the plan locks this CSP.

Compatibility probe (run once against the actual OnlyOffice 8.3 container in dev):

1. Deploy Docs with the proposed CSP enforcing (not `Content-Security-Policy-Report-Only` — strict enforcement).
2. Open a standalone document editor session at `api.docs.monolith.cx/editor/:key` framed by `docs.monolith.cx`.
3. Open DevTools → Console + Network. Look for any CSP violation reports, blocked inline `<script>` nodes, blocked eval, blocked Worker/Blob creation, blocked inline event handlers (`onclick=` etc.), blocked inline styles beyond what `'unsafe-inline'` on `style-src` covers.
4. Exercise: document open, type edits, auto-save, manual save, close/reopen, co-editing with a second browser, force-save, presence indicator, comments panel, version history (if available), export to PDF. Each feature must not emit CSP violations.
5. Run headless consumer flows on `connect.monolithdocs.com/editor/:key` with the same CSP — same probe, same features.

Decision tree based on probe outcome:

- **No violations:** lock the CSP as designed.
- **OnlyOffice injects inline scripts at runtime without a nonce:** the `'strict-dynamic'` fallback does NOT help here — `'strict-dynamic'` applies to scripts loaded by already-trusted scripts (extends trust to their dynamic imports) but does not cover inline injection. If inline injection is the failure mode, options are (a) add `'unsafe-inline'` to `script-src` and accept the reduced guarantee (document the tradeoff), (b) patch OnlyOffice to use nonces (unlikely feasible on AGPL upstream without a fork), or (c) move the editor to a dedicated OnlyOffice-owned origin with its own lax CSP and rely on cross-origin isolation instead of in-page CSP. Option (a) is the pragmatic v1 fallback; document the security delta explicitly.
- **OnlyOffice uses eval/Function/dynamic code:** add `'wasm-unsafe-eval'` and/or `'unsafe-eval'` to `script-src`, document the tradeoff, and verify no other CSP violations remain.
- **Worker/Blob creation fails:** `worker-src blob:` is already included; if OnlyOffice uses `SharedWorker` or imports from additional origins, extend accordingly.
- **Co-editing WebSocket fails:** confirm `connect-src wss://app.monolithdocs.com` is present in the editor-page CSP, and the WS handshake succeeds at the `app.monolithdocs.com` edge (Cloudflare → public IP → NGINX → OnlyOffice; NOT the tunnel). The NGINX `location /` block already carries `Upgrade` / `Connection: upgrade`.

Record the probe outcome and final CSP in the SA-6.2 checkpoint review. Do not ship a weaker CSP to prod without an explicit security review sign-off.

- Existing `connect.` / `crm.` editor CSP applies the same policy, with `frame-ancestors` driven by each consumer's `allowedFrameAncestors`. No more permissive "allow any" framing.

**Two edge topologies — document and preserve the split:**

The current Docs deployment has two different edge paths depending on hostname. Preserve both rather than trying to unify them in this initiative:

1. **NGINX path (`app.monolithdocs.com` only):** Cloudflare DNS → GCE VM public IP → NGINX on `:443` → upstream `onlyoffice` (`127.0.0.1:8080`) for DocumentServer assets and `upstream api` (`127.0.0.1:3020`) for `/health` and `/editor/`. See [infrastructure/nginx/monolith-docs.conf](infrastructure/nginx/monolith-docs.conf). TLS terminates at NGINX with Cloudflare origin certificate.
2. **Cloudflare Tunnel path (everything else):** cloudflared outbound from GCE VM → direct to `localhost:3020` (Fastify) or `localhost:3000` (Next.js). No NGINX hop. See [infrastructure/cloudflare/tunnel-config.yml](infrastructure/cloudflare/tunnel-config.yml). TLS terminates at Cloudflare edge.

Host-normalization rules per topology (SA-1.6):

- **NGINX (`app.monolithdocs.com`):** add `proxy_set_header Host $server_name;` to every `location` block in the existing server (currently passes through `$host`). Ignore `X-Forwarded-Host` on the upstream. No tunnel entry for `app.monolithdocs.com`.
- **Cloudflare Tunnel (`docs.monolith.cx`, `api.docs.monolith.cx`, `connect.monolithdocs.com`, `crm.monolithdocs.com`):** each ingress rule sets `originRequest.httpHostHeader: <matched-hostname>`.

Target `tunnel-config.yml` after Phase 6:

```yaml
ingress:
  - hostname: docs.monolith.cx
    service: http://localhost:3000
    originRequest:
      httpHostHeader: docs.monolith.cx
  - hostname: api.docs.monolith.cx
    service: http://localhost:3020
    originRequest:
      httpHostHeader: api.docs.monolith.cx
  - hostname: connect.monolithdocs.com
    service: http://localhost:3020
    originRequest:
      httpHostHeader: connect.monolithdocs.com
  - hostname: crm.monolithdocs.com
    service: http://localhost:3020
    originRequest:
      httpHostHeader: crm.monolithdocs.com
  - service: http_status:404
```

`app.monolithdocs.com` is intentionally NOT in the tunnel ingress — its traffic path is Cloudflare → public IP → NGINX, unchanged. Do not move it into the tunnel as part of this initiative; that's a separate infra decision with its own risk (certificate management shifts, upstream performance changes, WebSocket behavior reverification).

Acceptance for the edge configuration:

- Prod-path crafted-Host test: send `Host: api.docs.monolith.cx` through the `connect.monolithdocs.com` tunnel entry; cloudflared rewrites it to `connect.monolithdocs.com`; Fastify sees `connect.monolithdocs.com`; consumer subtree accepts the request on its real hostname.
- OnlyOffice asset probe on `app.monolithdocs.com`: `curl -I https://app.monolithdocs.com/web-apps/apps/api/documents/api.js` returns 200 with OnlyOffice JS content-type headers.
- OnlyOffice WebSocket probe on `app.monolithdocs.com`: open a real editor session; confirm the `wss://app.monolithdocs.com/doc/<id>/c/...` upgrade succeeds and stays connected for at least 10 minutes.
- Standalone editor probe via the tunnel: open `https://api.docs.monolith.cx/editor/:key` (tunnel → Fastify), confirm the rendered HTML references `https://app.monolithdocs.com/web-apps/...` in the `<script src>` and the browser loads those assets cross-origin without CSP violations.

**Other:**

- Static asset caching for Next.js
- WebSocket support for OnlyOffice on `app.monolithdocs.com/doc/*` (existing, unchanged)
- TLS certs required for `docs.monolith.cx`, `api.docs.monolith.cx`, and `app.monolithdocs.com` (Cloudflare-managed; `app.` cert already exists)

- Status: Pending
- Acceptance: Frontend loads at `docs.monolith.cx`. tRPC calls from `docs.monolith.cx` to `api.docs.monolith.cx` succeed with session cookie attached. Headless consumer API remains isolated to `connect.` and `crm.monolithdocs.com`. Standalone routes return 404 on headless hostnames; headless consumer routes return 404 on standalone hostnames. Editor iframe loads from `api.docs.monolith.cx` under `docs.monolith.cx` and is rejected if framed by any other origin. DocumentServer JS bootstraps from `https://app.monolithdocs.com/web-apps/*` and WebSocket connects to `wss://app.monolithdocs.com/doc/*`; co-editing and save-status both work end-to-end. Attempting to load DocumentServer paths on `api.docs.monolith.cx` or `docs.monolith.cx` returns 404.

### SA-6.3 GCE deployment updates

- Update `infrastructure/gce/startup.sh` for PostgreSQL + Redis
- Update `infrastructure/gce/deploy.sh` for frontend build
- Add Prisma migration step to deployment
- Environment configs for dev and prod

- Status: Pending
- Acceptance: Deploy script provisions full stack on GCE VM.

### SA-6.4 Platform integration registration

- Register Docs product in Platform (if not already)
- Create production service key, store in `CREDENTIALS.md`
- Register provisioning URL: `https://api.docs.monolith.cx/internal/provision`
- Register auth callback URLs: `https://api.docs.monolith.cx/auth/callback` (prod) and `http://localhost:3020/auth/callback` (dev)
- Capture Platform logout URL in Docs API config as `PLATFORM_LOGOUT_URL`. The value is sourced exclusively from the logout section added to `auth-sso.md` in SA-2.0 — do not hardcode a URL in plan, guidance, or environment templates ahead of that contract update. Used by `POST /auth/logout` to build the `logoutUrl` response (see SA-2.2). Register the Docs logout `redirect_uri` (`https://docs.monolith.cx/signed-out` in prod) per the allowlisting rules defined by the updated contract.
- Create Pub/Sub topic `monolith-docs-events`
- Create Pub/Sub push subscription for Platform events → `https://api.docs.monolith.cx/internal/events`
- Update Platform integration status: `C:\Dev\monolith-platform\docs\ecosystem\integration-status\monolith-docs.yaml`
- Contract sync (all in `C:\Dev\monolith-platform\docs\ecosystem\contracts\`). Every contract below must be updated to reflect Docs' new surface and versioned accordingly. Contract drift at lock time is grounds for rejecting the phase closeout:
  - `auth-sso.md` — Docs' registered redirect URI and logout URL state; confirm the logout section added in SA-2.0 is live and referenced
  - `auth-adoption-standard.md` — Docs' adoption status, session-lifetime policy (24h Platform cookie, 24h standalone editor session TTL tracked to the cookie per SA-2.6), global-logout adoption
  - `provisioning.md` — Docs' provisioning endpoint URL, idempotency behavior, supported `ProvisionRequest` fields consumed by Docs
  - `platform-events.md` — Docs eventing status (no longer deferred once Phase 3 lands), list of inbound event types Docs consumes, list of outbound event types Docs publishes (`docs.document.created` / `.updated` / `.deleted` / `docs.session.started` / `.ended`), topic name `monolith-docs-events`, subscription endpoint
  - `licensing-entitlements.md` — Docs entitlement key (`docs`), allowed statuses (`active` / `trialing` / `past_due`), cache TTL (60s), fail-open behavior, invalidation triggers
  - `storage.md` — Docs storage dependencies: standalone uses `requestUploadUrl` + `confirmUpload`, Platform thumbnails via `getThumbnailUrl`. Note the headless `/api/files/upload` flow remains on local temp storage pending STOR-7 (Phase 7)
- Any contract that does not yet exist but is required by Docs' implementation must be created as part of this phase, not quietly assumed.

- Status: Pending
- Acceptance: Platform can provision tenants into Docs. Events flow bidirectionally. Auth SSO redirects work.

---

## Phase 7: STOR-7 coordination and Docs-specific storage follow-up

**Goal:** Align standalone Docs storage adoption with Platform's STOR-7 track and close any Docs-specific gaps that remain after the initial standalone cut.

### SA-7.1 Track Docs work against Platform STOR-7

- Mirror Docs storage adoption against `C:\Dev\monolith-platform\.ai\ecosystem\initiatives\active\tenant-storage\plan.md` Phase 7
- Record any Docs-specific OnlyOffice compatibility decisions required for upload/download URL usage, save flows, or preview handling
- Headless API file upload (`/api/files/upload`) remains unchanged unless a separate Docs storage decision explicitly expands STOR-7 into headless flows

- Status: Pending
- Acceptance: Docs standalone storage plan stays aligned with Platform STOR-7 and any remaining Docs-specific compatibility work is explicitly documented instead of hidden in the standalone plan

---

## Future (not in this initiative)

- Cloud storage browsing (GDrive, OneDrive, Dropbox)
- Template gallery / marketplace
- CRM file browsing from standalone dashboard
- Collaboration features (shared editing sessions, comments)
- Document versioning / history
- Migrate `@monolith-platform/ui` if Platform publishes breaking changes
- Advanced entitlement features (document limits, storage quotas, AI features)

---

## Sequencing and dependencies

```text
Phase 0 (monorepo restructure) ──────┐
                                      ▼
Phase 1 (database) ──────────────────┐
                                      ├─→ Phase 3 (provisioning + events)
Phase 2 (auth) ──────────────────────┤
                                      ├─→ Phase 4 (tRPC router)
                                      │         │
                                      │         ▼
                                      ├─→ Phase 5 (frontend)
                                      │         │
                                      │         ▼
                                      └─→ Phase 6 (deployment)
                                                │
                                                ▼
                                      Phase 7 (STOR-7 coordination + Docs follow-up)
```

Phase 0 is a hard prerequisite for every subsequent phase — all later phases assume pnpm + Turbo + `apps/*` + `packages/*` layout. Close Phase 0 completely before starting Phase 1 or 2.
Phases 1 and 2 can be worked in parallel (no dependencies between them) once Phase 0 is closed.
Phase 3 depends on Phase 1 (database).
Phase 4 depends on Phases 1, 2, and 3.
Phase 5 depends on Phase 4.
Phase 6 depends on Phase 5.
Phase 7 depends on Platform STOR-7 coordination, not on storage availability.
