# Standalone App — Guidance

## Initiative ID: `standalone-app`

> **Re-scoped 2026-10-16 (Phase 0 only).** After the 2026-09-02 repo split, the standalone product surface lives in the private `monolith-docs` repo. This initiative keeps **Phase 0** (workspace restructure and headless parity) and its open gates. **Phases 1–7 are superseded** and are kept below as a historical record only; do not implement them here. The editor-service work UDOC needs (profiles, stateless sessions, signed notifications, conversion, redaction, the panel plugin, hosting) is the `udoc-editor-service` (EDIT) initiative. Two items have no owner and are candidate follow-ups: SA-1.6 (`hostnameGuard` and production-strict `findConsumersByHostname`) and SA-1.7 (`allowedFrameAncestors` on the editor page). The Critical Constraint below ("headless API unmodified") applies to Phase 0 only; EDIT changes the headless API deliberately, keeping the legacy open shape for existing consumers (EDIT guidance E1). Because EDIT-4 and EDIT-2 change the headless API that Phase 0 verifies, Phase 0 must close (or its Track A matrix be re-baselined: EDIT-2 removes `/api/documents/:key/download` and `/api/sessions`) before EDIT-2 is deployed. The owner decided (2026-10-16) to keep this initiative active for Phase 0 and archive it once Phase 0 closes.

## Summary

Transform Monolith Docs from a headless embed service into a first-class Monolith Platform product at `docs.monolith.cx`. Authenticated users with a Docs subscription can sign in, create documents, upload from desktop, and edit in the browser — without launching from CRM or Connect. The existing headless consumer infrastructure continues to run on `monolithdocs.com` as a private inter-service domain for CRM, Connect, and fastmail-connect integrations.

**Critical constraint:** The existing headless API must continue working exactly as-is from the point of view of CRM and Connect. They continue calling `/api/documents/open`, receiving `editorUrl`, embedding `/editor/:key`, and using the current callback/download flows. The standalone app is additive, but it does require route-level auth isolation and a first-party app API surface so the existing consumer-authenticated headless routes are not exposed or regressed.

---

## Architecture Decisions

### 1. Backend: Keep Fastify, add tRPC + Prisma + PostgreSQL

The existing Fastify API remains the host for the headless editor/session flows. New standalone surfaces are added alongside it:

- **tRPC router** mounted at `/trpc` via `@trpc/server/adapters/fastify` — serves the frontend (dashboard, recent docs, user prefs, file management)
- **Prisma + PostgreSQL** — tenant, user, org structure, recent docs, event inbox/outbox tables. RLS for tenant isolation (same pattern as CRM/Connect).
- **Platform SDK** (`@monolith-platform/sdk`) — singleton `PlatformClient` for entitlements, events, user/org queries.
- **Route/auth split** — consumer auth remains responsible for headless routes; Platform session auth applies only to standalone routes. This requires explicit Fastify plugin encapsulation or equivalent route namespacing. It is not safe to rely on the current global auth plugin as-is.

**Rationale:** Docs is AGPL and intentionally lean. NestJS would bloat the surface. Fastify + tRPC gives the frontend the same DX as CRM/Connect without the framework weight. Adding Prisma is necessary because the standalone app needs persistent state (tenants, users, recent docs, event tracking). The explicit route/auth split preserves the current headless boundary instead of weakening it.

**Headless route behavior is NOT modified.** The consumer auth system (`auth.ts`, `consumers.ts`) continues to handle the current headless API requests. However, the current global Fastify auth registration must be refactored so standalone routes (`/trpc`, `/auth/*`, and any first-party app routes) are excluded from consumer bearer-token auth and instead use Platform session auth.

### 2. Frontend: Current STACK-aligned Next.js + `@monolith-platform/ui`, in `apps/web/`

Frontend target matches `monolith-platform/apps/portal` so shared tooling, auth patterns, and UI primitives transfer directly.

- Located at `apps/web/` as `@monolith-docs/web` in the pnpm workspace (Phase 0 establishes the layout).
- Next.js 16.x, React 19.x, App Router, TypeScript 6.0.3
- `@monolith-platform/ui` from Artifact Registry — shared component library (not a local copy; CRM and Platform portal already consume it the same way)
- tRPC 11 + `@tanstack/react-query` + `superjson` for data fetching — same versions as `apps/portal`
- Tailwind 4 with `@tailwindcss/postcss`; VS Code Modern theme via CSS variables from `@monolith-platform/ui`
- Lucide React icons, Radix UI primitives, CVA variants, `cn()` utility
- Same header (56px, app switcher, notifications, profile dropdown), color scheme, theme modes (light/dark/system), density settings (compact/default/comfy)
- No Next.js proxy for `/trpc` or `/auth/*` — direct calls to `api.docs.monolith.cx` (first-party cookies; see Hostname Architecture)
- Playwright for E2E

### 2a. Monorepo convention (Phase 0)

The entire repo is reshaped in Phase 0 to match the sibling Monolith repos. This is a hard prerequisite, not a cleanup task.

- **Package manager:** pnpm 10+, `pnpm-workspace.yaml` with `apps/*` and `packages/*`
- **Build orchestrator:** Turbo 2.5+, `turbo.json` mirroring Platform/CRM task graph
- **Layout:** `apps/api` (existing Fastify service, moved from root `api/`), `apps/web` (new Next.js frontend), `packages/db` (new Prisma workspace)
- **Node:** `>=24` (up from `>=22`)
- **TypeScript:** `6.0.3`
- **Prisma:** `^7.7.0` for both `prisma` and `@prisma/client` — matches the in-progress Prisma 7.7 migration in `monolith-platform/packages/db` and `monolith-crm/packages/db`. Docs lands on 7.7 from day one, avoiding a later migration debt.
- **Version policy:** Newly introduced Docs packages should start on the current ecosystem-approved stack baseline from `monolith-platform`'s `stack-upgrade` initiative at implementation time. Do not intentionally scaffold new Docs surfaces on superseded majors just because an older draft mentioned them. If Docs needs to diverge, record the reason in this initiative first.

### 3. Auth: Platform SSO (NOT Firebase client SDK)

Docs follows the same SSO flow as CRM and Connect:

1. Unauthenticated user visits `docs.monolith.cx`
2. Frontend calls `https://api.docs.monolith.cx/auth/me` (with `credentials: 'include'`); if no session, redirect to the Platform login gateway URL (value taken from `auth-sso.md`; `login.monolithplatform.com` in contract v1.0.0, subject to UNIFY DNS changes) with `redirect_uri=https://api.docs.monolith.cx/auth/callback`
3. Platform login gateway handles Firebase Auth (Docs never touches Firebase directly)
4. Platform redirects back with `?code=<auth-code>`
5. Docs server exchanges code with Platform API (`POST /auth/exchange`) — **server-side only**
6. Platform returns verified session: `{ userId, email, tenantId, tenantSlug, role }`
7. Docs signs its own JWT (HS256), stores in httpOnly cookie (`docs_session`) scoped to `api.docs.monolith.cx` with `SameSite=Lax`
8. All subsequent requests verified locally from the cookie — no round-trip to Platform. Because `docs.monolith.cx` and `api.docs.monolith.cx` are same-site under the `monolith.cx` registrable domain, the cookie is first-party and not subject to Safari ITP or third-party cookie restrictions.

**Docs does NOT:**
- Use Firebase client SDK or Firebase Admin SDK
- Store or reuse Platform's JWT
- Call Platform on every request (only on initial code exchange)
- Verify Platform JWTs locally — after the exchange, Docs trusts its own session cookie just like CRM and Connect

**Logout is global, not local-only.** `POST /auth/logout` clears the Docs session cookie, revokes active standalone editor sessions for the logging-out user, and returns a `logoutUrl` pointing at Platform's logout gateway. The frontend navigates the browser to that URL so the Platform gateway session is cleared too, and the user lands on a dedicated `/signed-out` page. This avoids the silent re-auth trap that would occur if Docs only cleared its own cookie and redirected the user back through Platform login while the gateway session was still alive.

**The canonical logout URL comes from `auth-sso.md`, not from this guidance.** The current [auth-sso.md](C:/Dev/monolith-platform/docs/ecosystem/contracts/auth-sso.md) does not yet document a logout endpoint — extending it is plan step SA-2.0 and is a hard prerequisite for SA-2.2. Do not wire Docs to a speculative logout hostname. `PLATFORM_LOGOUT_URL` in Docs config reads from whatever the updated contract specifies, nothing else.

CRM's current logout is local-only — it clears the CRM cookie and redirects to `platformSdk.loginUrl` without calling Platform logout. That is a latent issue in CRM but is explicitly out of scope for this initiative; Docs sets the better pattern that CRM can adopt later.

**CSRF defense-in-depth:** `SameSite=Lax` is not sufficient on its own because any subdomain under `*.monolith.cx` is same-site. Every cookie-authenticated state-changing standalone route enforces an `Origin` header check matching the Docs frontend origin. This rule applies uniformly to `POST /auth/logout` and every `POST /trpc/*` mutation (see plan SA-4.1 CSRF section) — it is not deferred or opt-in.

**Auth contract references:**
- `C:\Dev\monolith-platform\docs\ecosystem\contracts\auth-sso.md` (v1.0.0)
- `C:\Dev\monolith-platform\docs\ecosystem\contracts\auth-adoption-standard.md` (v1.0.0)

### 4. Entitlements: Platform SDK with fail-open caching

- `platform.entitlements.check(platformTenantId, 'docs')` → returns plan, status, features
- 60-second TTL cache (matches Platform's server-side cache)
- Fail-open: if Platform is unreachable, allow access (same as CRM/Connect)
- Cache invalidated immediately on `platform.subscription.changed` / `cancelled` events
- Two layers: NestJS-style service for internal use + standalone function for tRPC middleware

### 5. Events: Pub/Sub outbox/inbox (same pattern as CRM/Connect)

**Inbound (Platform → Docs):**
- `POST /internal/events` endpoint — receives Pub/Sub push messages
- OIDC token verification in production
- Event inbox table for deduplication (idempotent processing)
- Sovereignty handler syncs: tenant, user, org structure, subscription state
- Events to handle:
  - `platform.tenant.*` (created, deactivated, suspended, reactivated, deleted)
  - `platform.user.*` (invited, activated, deactivated, updated, role.changed)
  - `platform.seat.granted`, `platform.seat.revoked`
  - `platform.subscription.*` (created, changed, cancelled)
  - `platform.org.*` (legal entities, business units, affiliations CRUD)

**Outbound (Docs → Platform):**
- Transactional outbox pattern: write to `event_outbox` in same transaction as mutation
- Background publisher polls and publishes to `monolith-docs-events` Pub/Sub topic
- Events to publish:
  - `docs.document.created`, `docs.document.updated`, `docs.document.deleted`
  - `docs.session.started`, `docs.session.ended`

### 6. Provisioning: `/internal/provision` endpoint

Platform calls this when a tenant subscribes to Docs:

- **Request:** `ProvisionRequest` with tenant, owner, users, org structure, plan info
- **Response:** `{ success: boolean, error?: string }`
- **Must be idempotent** — same tenantId returns success without duplicates
- **30-second timeout**
- **Actions:** Create local tenant + users + org structure records, apply plan defaults
- **Auth:** Service key verification (`Authorization: ServiceKey <key>`)

**Contract reference:** `C:\Dev\monolith-platform\docs\ecosystem\contracts\provisioning.md` (v2.0.0)

### 7. Storage: Platform storage from day one for standalone

Platform storage is now available and already adopted in CRM. Standalone Docs should use it from the first standalone release:
- Standalone uploads use `platform.storage.requestUploadUrl()` + `confirmUpload()` and store Platform file IDs, not local temp-file paths
- Platform owns blob storage, file metadata, signed download URLs, and thumbnails
- Standalone recent-doc / reopen flows must reference Platform file IDs so documents survive API restarts and temp-file cleanup
- The current local temp upload storage remains only for the existing headless `/api/files/upload` path until STOR-7 covers Docs-specific headless/storage decisions
- The GCS signed URL flow for headless consumers is unchanged
- Docs can use Platform-provided thumbnails directly via `platform.storage.getThumbnailUrl()`; no Docs-local thumbnail pipeline is needed for standalone uploads

### 8. Database schema (new)

Docs currently has no database. The standalone app requires:

```
Tenant
  id, slug, name, status, platform_tenant_id (unique), firebase_tenant_id, plan_slug
  
User
  id, tenant_id, email, first_name, last_name, role, status
  platform_user_id, platform_sync_version

LegalEntity
  id, tenant_id, platform_id, name, entity_type, ...

BusinessUnit
  id, tenant_id, platform_id, legal_entity_id, short_code, name, ...

BusinessUnitAffiliation
  id, tenant_id, user_id, business_unit_id, platform_id, role, is_primary, ...

RecentDocument
  id, tenant_id, user_id, platform_file_id, document_key, file_name, document_type, last_opened_at

EventInbox
  id, event_id (unique), event_type, tenant_id, source, status, payload, received_at, processed_at, attempts

EventOutbox
  id, event_id, event_type, tenant_id, source, payload, status, created_at, published_at, publish_attempts, last_error
```

RLS enforced via `SET LOCAL app.current_tenant = <tenant_id>` on every request (same as CRM/Connect).

### 9. Guard chain (Fastify adaptation)

CRM/Connect use NestJS guards. Docs adapts this to Fastify hooks:

1. **`platformAuthHook`** (onRequest) — reads `docs_session` cookie, verifies JWT, sets `request.platformUserId` + `request.platformTenantId`
2. **`tenantContextHook`** (preHandler) — resolves local tenant by `platform_tenant_id`, resolves local user by `(tenant_id, platform_user_id)`, sets `request.tenantId` + `request.userId` + `request.userRole` + `request.businessUnitId`

These hooks apply only to `/trpc` and `/auth/*` routes. Existing headless routes continue using consumer auth. This requires route encapsulation so the current global `authPlugin` does not intercept standalone requests before the Platform hooks run.

---

## What Does NOT Change

| Surface | Status |
|---------|--------|
| `POST /api/documents/open` | Unchanged — consumer auth |
| `GET /editor/:key` | Unchanged — session-bound |
| `POST /api/documents/callback` | Unchanged — OnlyOffice JWT |
| `GET /api/files/:filename` | Unchanged — unguessable UUID |
| `POST /api/files/upload` | Unchanged — consumer auth |
| `GET /api/sessions` | Unchanged — consumer auth |
| `GET /health`, `GET /api/status` | Unchanged — public |
| Consumer auth contracts for headless routes | Unchanged |
| Docker Compose (OnlyOffice + API) | Extended (add PostgreSQL, Redis) |
| NGINX config | Extended (add frontend routing) |

---

## Dependencies

| Dependency | Status | Impact |
|-----------|--------|--------|
| `@monolith-platform/sdk` | Published to Artifact Registry | Install as dependency |
| `@monolith-platform/ui` | Published to Artifact Registry | Install as dependency |
| Platform SSO (login gateway) | Live | Need callback URL registered |
| Platform provisioning | Live | Need provision_url registered |
| Platform Pub/Sub topics | Live | Need `monolith-docs-events` topic + subscriptions |
| Platform service key | Needs creation | Register Docs as a product in Platform |
| Platform storage | Live | Use for standalone uploads, downloads, and thumbnails from v1 |
| PostgreSQL | New for Docs | Add to docker-compose |
| Redis | New for Docs | Add to docker-compose (sessions, entitlement cache) |

---

## Hostname Architecture

Docs has two hostname families reflecting two architecturally distinct use cases. The split is a deliberate outcome of the monolith.cx ecosystem unification work: the first-party standalone product joins the rest of the Monolith apps on `monolith.cx`, while the headless consumer infrastructure stays on the existing internal service domain.

### First-party standalone product (customer-facing, on `monolith.cx`)

- `docs.monolith.cx` — Next.js frontend. Public browser entry point.
- `api.docs.monolith.cx` — Fastify API. Serves `/auth/*`, `/trpc`, `/internal/*`, `/editor/*` for standalone sessions, plus `/health` and `/api/status`.

### Headless consumer infrastructure (internal, on `monolithdocs.com`)

- `connect.monolithdocs.com` — Fastmail Connect tunnel. Headless consumer API, unchanged.
- `crm.monolithdocs.com` — CRM tunnel. Headless consumer API, unchanged.

### Rules

- `docs.monolith.cx` and `api.docs.monolith.cx` are the first-party customer surface. Session cookies are first-party because both live under the `monolith.cx` registrable domain — avoids Safari ITP and third-party cookie restrictions that would break cross-site cookie auth on `api.monolithdocs.com`.
- `connect.monolithdocs.com` and `crm.monolithdocs.com` are private inter-service hostnames. Not marketed, not linked from `monolith.cx`, treated as internal infrastructure.
- Consumer-authenticated routes (`/api/documents/open`, `/api/files/upload`, `/api/sessions`) are reachable ONLY on `connect.` and `crm.monolithdocs.com`.
- Standalone routes (`/auth/*`, `/trpc`, `/internal/*`) are reachable ONLY on `api.docs.monolith.cx`.
- `/api/documents/callback` is **internal-only** via `API_INTERNAL_URL` (default `http://api:3020`). It is NOT reachable on any public hostname — NGINX on every public edge returns 404 for this path. DocumentServer reaches it over the docker-internal network; the browser never does. See plan.md SA-6.2 for the full rule and the SA-1.5 `hostnameGuard` wiring (defense in depth). Do not treat this as a public-edge carve-out; earlier drafts of this guidance did, and that was wrong.
- `/api/files/:filename` download (session-bound UUID, no consumer auth) is reachable on editor-session hostnames (`connect.`, `crm.`, `api.docs.monolith.cx`) because OnlyOffice DocumentServer needs to GET the document during editor bootstrap. The session-key UUID is the auth boundary for this path.
- `/editor/:key` is reachable on whichever hostname created the session. Standalone editors are served from `api.docs.monolith.cx` and framed by `docs.monolith.cx`.
- Headless hostnames stay frozen. Consumer auth + hostname binding logic in `auth.ts`/`consumers.ts` is not migrated or unified with standalone auth — that is an explicit non-goal.
- No unified API gateway. Fastify is one process; hostname routing is enforced at NGINX with route allowlists per hostname.

### Rationale for the split

1. **No public contract on headless.** Only CRM, Connect, and fastmail-connect call the headless API. Not Zapier, not partners. Migrating headless hostnames would be pure cost with zero user-facing upside.
2. **Cookie first-party-ness.** First-party standalone auth requires frontend and API under the same registrable domain. Cross-site cookie auth from `docs.monolith.cx` to `api.monolithdocs.com` would require `SameSite=None` and would be squeezed by Safari ITP and the ongoing Chrome third-party cookie deprecation.
3. **AGPL hygiene.** OnlyOffice-backed AGPL-exposed surfaces stay on `monolithdocs.com`; the closed-source Monolith product surface lives on `monolith.cx`. Cleaner architectural and legal boundary.
4. **Consumer hostname stability.** The per-consumer tunnel pattern (`connect.` and `crm.`) keeps working with zero cutover risk for CRM and Connect.

---

## AGPL Considerations

- All code in this repo is AGPL 3.0 (required by OnlyOffice)
- `@monolith-platform/sdk` and `@monolith-platform/ui` are dependencies, not embedded — AGPL allows this
- The SSO flow calls Platform API over HTTP — no code coupling
- Prisma + PostgreSQL are MIT/Apache licensed — compatible with AGPL
