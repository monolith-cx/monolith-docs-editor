# Project Conventions — Monolith Docs Editor

> **Repo split (2026-09-02):** renamed from `monolith-docs` to `monolith-docs-editor`. Scope is the AGPL OnlyOffice headless editing service and its deploy substrate only. Product, e-signature, Platform SSO, tRPC, and the Next.js frontend now live in the private `monolith-docs` repo; do not build them here. The `standalone-app` initiative was archived on 2026-10-31. Since 2026-10-19 (EGM-0) the source of truth is GitHub `monolith-cx/monolith-docs-editor` (public, AGPL); `main` takes changes by pull request with the `checks` check green (`.github/workflows/ci.yml`, EGM-1), and the manual `Images` workflow pushes `ghcr.io/monolith-cx/editor-api:<sha>` (EGM-2). The old self-hosted origin is archived (EGM-0.8).

Monolith Docs is a standalone AGPL document-editing service built around OnlyOffice DocumentServer with a thin Fastify API. Consuming products integrate over API; they do not embed proprietary logic into this repo.

## Commit Authorship

- Do not add `Co-Authored-By: Claude` or any other AI attribution trailer unless the user explicitly asks for it.

## Platform Integration

This repo integrates with Monolith Platform for future standalone auth, entitlements, provisioning, and shared ecosystem contracts.

- Platform ecosystem docs: `monolith-platform/docs/ecosystem/` (private repository)
- Shared contracts: `monolith-platform/docs/ecosystem/contracts/`
- Shared playbooks: `monolith-platform/docs/ecosystem/playbooks/`
- Cross-product work and sequencing: tracked privately by the maintainers; nothing in it is needed to build or test this repo

Rules:

- Before changing a shared Platform surface, read the relevant contract first.
- Shared-surface changes are contract-first. Update the contract before or alongside the implementation.
- When work changes real integration state, update the integration-status file in Platform during closeout.

## Stack And Ports

- API: Fastify + TypeScript on `3020`
- OnlyOffice DocumentServer: `10.0.0.1` (pinned by digest in `docker-compose.yml`; change only through a battery run, `scripts/editor-battery/`) on `8080`
- Storage: none held by the service; consumers pass short-lived signed file URLs, which the service fetches on DocumentServer's behalf (the source route), and store saves themselves; `/api/files/` keeps temporary legacy uploads
- Infrastructure: Docker Compose locally; hosted environments run on the Monolith VPS as compose services behind its Caddy (`infrastructure/vps/`, ADR `docs/adr/2026-10-18-editor-hosting.md`, guidance E9). The GCE + NGINX + Cloudflare Tunnel files stay only for the return-to-GCP plan
- Auth: consumer-issued integration credentials today, Platform SSO planned for the standalone app surface
- Runtime: Node.js `24+`, pnpm workspaces, Turbo, TypeScript `6.0.3`
- Validation: Vitest, ESLint, TypeScript compiler, Docker Compose checks

## Architecture

High-level shape:

```text
apps/
  api/
    src/
      routes/      health, document, upload, and callback routes
      auth.ts      consumer auth and request identity enforcement
      consumers.ts consumer config and hostname binding
      safe-url.ts  the only gate for document, callback, and conversion URLs (resolve, refuse private addresses, pin)
      session-token.ts  sealed per-open editor tokens (stateless sessions, EDIT-2)
      notify.ts    signed consumer notifications; reference/verify-notification.ts is the consumer-side verifier
      convert.ts   PDF conversion through the source route and a pinned upload (EDIT-3)
      capped-read.ts, source-outcomes.ts  whole reads under a cap; a conversion's source outcome and abort
  plugin/         the panel bridge plugin (EDIT-5): plain JS with @ts-check, no build, served by apps/api at /plugins/udoc-bridge/

infrastructure/
  deploy/        hosted environment scripts and config

docs/
  adr/           durable architecture records
```

Core patterns:

- Monolith Docs stays a separate service. Consumer apps integrate over API, not by embedding proprietary code here.
- OnlyOffice is stateful. The hosted shape is a long-lived DocumentServer container on the VPS (`editor-documentserver-<env>`, restarted in place by the converter watchdog, recreated only for an update after a drain), not Cloud Run. The API answers on `editor-api` in every deployment (an alias on its own environment's network on the VPS, where the service is `editor-api-<env>`): DocumentServer's `directIfIn` allow-list names `http://editor-api:3020/`, and outside `EDITOR_ENV=local` the API refuses any other `API_INTERNAL_URL`.
- Files are transient. The service should round-trip documents through signed URLs rather than storing them permanently.
- Headless integrations must remain isolated from the future standalone app surface.
- Consumer auth and hostname binding are core security boundaries for headless usage.

## Non-Negotiables

- No `any`
- No `console.log`
- No direct `process.env` access outside centralized config loading
- No business logic that belongs in consumer apps
- No fake success paths around OnlyOffice callbacks, signed URL handling, or consumer auth
- No permanent document storage unless an approved project decision (or a legacy initiative) explicitly introduces it
- Do not collapse the AGPL boundary by moving proprietary integration behavior into this repo

## Engineering Workflow

- Read the current implementation before changing it.
- Trace the full dependency chain before changing behavior: API routes, auth, consumer config, storage integration, OnlyOffice flow, deployment config, and docs.
- Build prerequisites first. If a feature depends on auth, signed URL support, storage, or deployment wiring, land that before the higher-level surface.
- Fix root causes, not symptoms.
- If code and docs disagree, trust the current code and reconcile the docs explicitly.
- When work changes externally shared behavior, update the contract or integration doc in the same closeout.

## Definition Of Done

- A change is not done until the implementation, config, docs, and validation for that scope are all complete.
- An API or integration change is not done until request/response behavior, auth expectations, error handling, and callback behavior are all accounted for.
- OnlyOffice or storage changes are not done until the round-trip behavior and failure paths are considered together.
- Infrastructure work is not done until ports, health checks, env wiring, and restart behavior are reconciled with the actual deployment path.
- Do not mark work complete without meaningful verification evidence.

## Auth And Integration Model

- Headless consumer integrations authenticate through consumer-issued credentials plus hostname binding.
- The future standalone app should use Platform SSO; do not back-port standalone auth assumptions into current headless flows.
- Monolith CRM and other consumers remain responsible for tenant/business rules. Docs only enforces the document-service contract.
- Callback and editor access flows must preserve consumer isolation.

## API And Runtime Rules

- Keep request validation, auth, and storage handling explicit.
- Routes stay thin where possible; shared logic belongs in reusable modules.
- Preserve the stateless session model (EDIT-2, UDOC D13): no session map and no database; everything an editor page needs travels in the sealed token, and callbacks route by the document key's consumer. Preserve notification signing and `deliveryId` stability, callback verification from the verified JWT payload, and hostname-aware access checks.
- Every URL the service or DocumentServer fetches on a consumer's behalf passes `safe-url.ts`; DocumentServer bypasses its own address filter for signed configs (ADR F3).
- `docs/guides/consumer-integration.md` is the consumer-facing description of the API; change it with the API.
- The bridge plugin (`apps/plugin/`) is AGPL and stays a thin bridge: no runtime dependencies, no `@monolith-*` code, relative imports only (`scripts/check-plugin-deps.mjs`). Its `callCommand` functions are self-contained and find every anchor inside the same command; operations are only ever added (protocol versioning). Its page CSP is the narrowest DocumentServer allows (ADR F18); never widen it beyond that page.
- DocumentServer only ever receives a complete source file or an error before any byte: the source route reads the whole file first (ADR F17). A partial or slow download wedges DocumentServer's one converter, which also serves every editor open; never stream a source to it.
- Signed URL fetch/upload behavior must remain observable and bounded; do not hide timeout, SSRF, or invalid input risks.
- Treat infrastructure secrets and consumer credentials as configuration, never hardcoded logic.

## Verification

- Run the strongest relevant checks for each touched surface.
- Use `pnpm --filter @monolith-docs/api run typecheck`, `pnpm --filter @monolith-docs/api run lint`, `pnpm --filter @monolith-docs/api run test`, and `docker compose config` where appropriate.
- The plugin: `pnpm --filter @monolith-docs/plugin run typecheck|test|lint`; `lint` is `scripts/check-plugin-deps.mjs`, which must pass at every checkpoint (it moves into CI with DOC-DPP).
- Do not claim OnlyOffice, callback, notification, or hosted integration flows are verified if you did not actually exercise them.
- Treat weak verification as `code-complete`, not `complete`.

## Work Tracking

Maintainers track this repo's work in Linear (the Docs team, label "Docs Editor") under the Monolith workflow, which is private. Nothing in it is needed to build, test, or contribute here; outside contributors use GitHub issues and pull requests.

- An effort bigger than one PR is a Linear project: phases are milestones, PR-sized steps are issues. Never start a new `.ai/` initiative. Put the issue id in the branch name or PR title.
- Legacy initiatives: one under `.ai/initiatives/` that has not yet moved to Linear keeps its `plan.md`, `guidance.md`, handoff, `.ai/registry.yml` entry and `ROADMAP.md` line until it moves, and is never tracked in both. A moved initiative is frozen as history.
- A legacy initiative's owner keeps its IDDP flow until it moves: stop at checkpoint boundaries and run the checkpoint review, run doc sync before every commit and at phase close-out, and refresh its handoff (`/initiative checkpoint`, `/initiative phase-close`, `/initiative handoff`). Other review providers still need the repository owner's explicit approval for each use.
- Review is opposing review on the PR: Claude implements and Codex reviews, or the reverse. Fix, then re-review the final head. Any other provider only with the repository owner's explicit approval for that use; the reviewer defaults in `.ai/iddp/config.json` apply only to legacy initiatives.
- Never put private contracts, process records, customer data, or credentials in this repo.
- Never commit automatically. Every commit, push and merge needs the repository owner's explicit approval.
