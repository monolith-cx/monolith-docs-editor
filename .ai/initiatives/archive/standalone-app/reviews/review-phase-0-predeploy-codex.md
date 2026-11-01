# Standalone App Phase 0 Pre-Deploy Safety Review — Codex

Reviewer: Codex
Date: 2026-04-19
Review Type: Pre-deploy safety review
Scope: Local Phase 0 safety gate before creating a deployable SHA

## Findings

### H-1: Fresh hosted deploys can report success while booting an unconfigured development-mode stack

`infrastructure/gce/startup.sh` copies `.env.example` into place when `.env` is missing and then immediately starts `docker compose`. `.env.example` only contains local-development defaults, and `docker-compose.yml` falls back to `NODE_ENV=development`, localhost public URLs, empty consumer auth config, and a dev JWT secret. Because `apps/api/src/server.ts` only enforces strict config checks when `NODE_ENV=production`, a brand-new VM can pass `/health` and `/api/status` with an effectively local-dev configuration. That means `deploy.sh` can declare the deploy healthy even though the hosted environment is not actually configured for real consumer or edge use.

References:
- `infrastructure/gce/startup.sh:113`
- `infrastructure/gce/startup.sh:118`
- `infrastructure/gce/startup.sh:127`
- `docker-compose.yml:28`
- `docker-compose.yml:31`
- `docker-compose.yml:35`
- `apps/api/src/server.ts:12`
- `apps/api/src/server.ts:19`

## Verification Assessment

Local verification is otherwise strong for a pre-deploy checkpoint commit:

- `node scripts/validate-ai-workspace.mjs`
- `node scripts/run-turbo.mjs typecheck`
- `node scripts/run-turbo.mjs lint`
- `node scripts/run-turbo.mjs test`
- `node scripts/run-turbo.mjs build`
- `pnpm --filter @monolith-docs/db run generate`
- `pnpm --filter @monolith-docs/db exec prisma --version`
- `docker compose build`
- `docker compose up -d`
- `curl http://localhost:3020/health`
- `curl http://localhost:3020/api/status`
- `docker compose down && docker compose up -d`

That is enough to justify a deployable SHA only after the hosted env bootstrap issue above is fixed. In the current state, the deploy substrate can produce a false-positive “healthy deploy”.

## Completeness Assessment

`code-complete`

## Final Verdict

`FAIL`

The workspace/tooling restructure looks locally ready, but the hosted deploy path is still unsafe as a pre-deploy gate because a fresh VM can come up with placeholder `.env` values and still satisfy the current health checks.
