# Project Conventions — Monolith Docs Editor

> **Repo split (2026-09-02):** renamed from `monolith-docs` to `monolith-docs-editor`. Scope is the AGPL OnlyOffice headless editing service and its deploy substrate only. Product, e-signature, Platform SSO, tRPC, and the Next.js frontend now live in the private `monolith-docs` repo; do not build them here. The `standalone-app` initiative below must be re-scoped before it resumes. Origin is Forgejo (`git.altuslabs.dev:2222`); GitHub is a public push mirror.

Monolith Docs is a standalone AGPL document-editing service built around OnlyOffice DocumentServer with a thin Fastify API. Consuming products integrate over API; they do not embed proprietary logic into this repo.

## Commit Authorship

- Do not add `Co-Authored-By: Claude` or any other AI attribution trailer unless the user explicitly asks for it.

## Platform Integration

This repo integrates with Monolith Platform for future standalone auth, entitlements, provisioning, and shared ecosystem contracts.

- Platform ecosystem docs: `C:\Dev\monolith-platform\docs\ecosystem\`
- Integration status: `C:\Dev\monolith-platform\docs\ecosystem\integration-status\monolith-docs.yaml`
- Shared contracts: `C:\Dev\monolith-platform\docs\ecosystem\contracts\`
- Shared playbooks: `C:\Dev\monolith-platform\docs\ecosystem\playbooks\`
- Cross-project parent initiatives: `C:\Dev\monolith-platform\.ai\ecosystem\initiatives\`

Rules:

- Before changing a shared Platform surface, read the relevant contract first.
- Shared-surface changes are contract-first. Update the contract before or alongside the implementation.
- When work changes real integration state, update the integration-status file in Platform during closeout.

## Stack And Ports

- API: Fastify + TypeScript on `3020`
- OnlyOffice DocumentServer: `10.0.0.1` (pinned by digest in `docker-compose.yml`; change only through a battery run, `scripts/editor-battery/`) on `8080`
- Storage: none held by the service; consumers pass short-lived signed file URLs, which the service fetches on DocumentServer's behalf (the source route), and store saves themselves; `/api/files/` keeps temporary legacy uploads
- Infrastructure: Docker Compose locally, GCE + NGINX + Cloudflare Tunnel for hosted environments
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
  web/            standalone frontend workspace (scaffolded in Phase 0)

packages/
  db/             Prisma workspace and schema

infrastructure/
  deploy/        hosted environment scripts and config

docs/
  adr/           durable architecture records
```

Core patterns:

- Monolith Docs stays a separate service. Consumer apps integrate over API, not by embedding proprietary code here.
- OnlyOffice is stateful. Treat GCE-hosted deployment as the default production shape, not Cloud Run.
- Files are transient. The service should round-trip documents through signed URLs rather than storing them permanently.
- Headless integrations must remain isolated from the future standalone app surface.
- Consumer auth and hostname binding are core security boundaries for headless usage.

## Non-Negotiables

- No `any`
- No `console.log`
- No direct `process.env` access outside centralized config loading
- No business logic that belongs in consumer apps
- No fake success paths around OnlyOffice callbacks, signed URL handling, or consumer auth
- No permanent document storage unless an initiative explicitly introduces it
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

## Initiative Workflow

Non-trivial work should be tracked in initiative docs under `.ai/initiatives/`.

- `ROADMAP.md` is the high-level feature and delivery summary.
- `.ai/registry.yml` is the initiative index.
- `.ai/initiatives/{active|planning|complete|archive}/{id}/guidance.md` owns durable initiative-specific decisions.
- `.ai/initiatives/{active|planning|complete|archive}/{id}/plan.md` owns execution status and acceptance criteria.
- `.ai/backlog.yml` is optional and should only be used if atomic task tracking adds value beyond initiative plans.
- There is no repo-level current file, session ledger, or repo-global handoff file in the active workflow.
- Initiative handoffs live in `.ai/handoffs/<initiative-id>.md`. Read one only when resuming that initiative and a handoff is present.
- `/initiative checkpoint` and `/initiative phase-close` refresh the initiative handoff after doc sync. `/initiative handoff` can be run manually at any time.
- Infer current work from the user request, `ROADMAP.md`, `.ai/registry.yml`, and the relevant initiative docs.
- Manual reviews are allowed at any time.
- Stop coding at checkpoint boundaries and run the checkpoint review before continuing.
- Checkpoint reviews default to Codex for a single reviewer. When two reviewers are needed, use Codex + Sonnet. Add Kimi for frontend-heavy work when the extra UI review is useful.
- Phase close-outs require multiple reviewers and default to Codex + Sonnet, with Kimi added for frontend-heavy work when useful.
- Run doc sync before any commit and at every phase close-out.
- Never commit automatically. Every commit requires explicit user approval.
- The active workflow does not use commit-ready stamps or approval stamp files.
- See `README.md` for the short skill-selection guide.

Do not treat retired docs-based control-plane files or legacy plan directories as active unless the current repo docs explicitly point to them.
