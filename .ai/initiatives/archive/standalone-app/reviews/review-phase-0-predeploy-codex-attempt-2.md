# Standalone App Phase 0 Pre-Deploy Safety Review — Codex Attempt 2

Reviewer: Codex
Date: 2026-04-19
Review Type: Pre-deploy safety review
Scope: Local Phase 0 safety gate before creating a deployable SHA

## Resolution Notes

### H-1 from attempt 1: Resolved

The hosted deploy path no longer bootstraps from the repo-root local-dev `.env.example`. `startup.sh` now requires a real `/opt/monolith-docs/.env`, points the operator at `infrastructure/environments/<env>/env.example`, and rejects unreplaced `<generate: ...>` placeholders before starting containers. `deploy.sh` also passes `deploy-env`, validates the remote `.env` state after SSH is available, and fails fast with a clear message instead of waiting on a misleading health timeout.

References:
- `infrastructure/gce/startup.sh:44`
- `infrastructure/gce/startup.sh:125`
- `infrastructure/gce/startup.sh:137`
- `infrastructure/gce/deploy.sh:82`
- `infrastructure/gce/deploy.sh:95`
- `infrastructure/gce/deploy.sh:165`

## Findings

No blocking pre-deploy findings in the local Phase 0 workspace after the hosted env bootstrap fix.

## Verification Assessment

Current local verification is sufficient for a pre-deploy checkpoint commit:

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

Notes:

- I re-ran `node scripts/validate-ai-workspace.mjs` after the latest doc and deploy-script updates and it passed.
- I was not able to run a shell parser over the Bash scripts from this environment because both WSL Bash and Git Bash hit local process-start issues, so deploy-script verification here is based on manual review plus the tightened failure paths.

## Completeness Assessment

`code-complete`

## Final Verdict

`PASS`

The Phase 0 workspace is now locally review-clean enough to justify creating a deployable checkpoint SHA. This is only the pre-deploy safety gate; final checkpoint closeout still depends on the real consumer-path checks and Track C deploy/rollback evidence.
