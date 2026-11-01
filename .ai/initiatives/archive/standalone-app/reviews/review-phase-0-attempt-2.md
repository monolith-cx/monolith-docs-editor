# Standalone App Phase 0 Review — Attempt 2

Reviewer: Codex
Date: 2026-04-18
Review Type: Manual checkpoint re-review after fixing H-1
Requested Reviewer: Claude Sonnet
Requested Reviewer Availability: Unavailable in the local environment (`claude`, `claude-code`, and `anthropic` CLIs not installed)

## Resolution Notes

### H-1 from attempt 1: Resolved

`infrastructure/gce/startup.sh` now fetches instance metadata through `curl` when available, falls back to `wget` when available, and installs `curl` before the metadata lookup if neither tool exists yet. That removes the fresh-VM path where `deploy-ref` could be lost before the repo checkout step.

References:
- `infrastructure/gce/startup.sh:16`
- `infrastructure/gce/startup.sh:21`
- `infrastructure/gce/startup.sh:42`

## Remaining Findings

### M-1: The checkpoint is still not review-complete because the required external parity evidence is missing

The plan makes real-consumer headless verification and a dev-hosted rollback test mandatory before Phase 0 can close. Local typecheck, lint, test, Docker, and health checks are useful evidence for the mechanical move, but they do not satisfy the required CRM/Connect round-trip checks or the deployed rollback gate. There is still no Phase 0 handoff recording the rollback baseline or the dry-run recipe.

References:
- `.ai/initiatives/active/standalone-app/plan.md:35`
- `.ai/initiatives/active/standalone-app/plan.md:38`
- `.ai/initiatives/active/standalone-app/plan.md:96`
- `.ai/initiatives/active/standalone-app/plan.md:123`
- `.ai/handoffs/.gitkeep:1`

### M-2: Track A and Track B were not captured in the order the plan requires

The plan explicitly requires Track A to run before the Node 24 bump and before introducing Prisma so runtime-upgrade failures remain separable from the mechanical repo move. The current branch is already on `engines.node >=24` and includes the Prisma workspace scaffold, so the ordered Track A evidence the plan asked for was not preserved. That remains a plan-adherence and diagnosability gap even though the current local verification is green.

References:
- `.ai/initiatives/active/standalone-app/plan.md:85`
- `.ai/initiatives/active/standalone-app/plan.md:87`
- `package.json:18`
- `packages/db/package.json:21`
- `packages/db/package.json:25`

## Acceptance Criteria Assessment

### SA-0.0 Pre-flight confirmation

- Registry / roadmap state: Pass
- Cross-project integration-status update: Partial
- Rollback baseline recorded in a Phase 0 handoff: Fail
- Result: Partial

### SA-0.1 Migrate to pnpm + Turbo

- `pnpm install` / workspace resolution: Pass
- Root `typecheck`, `lint`, `test`: Pass
- Docker Compose starts the existing stack locally: Pass
- No behavior change in headless routes: Partial, because real consumer verification is still missing
- Result: Partial

### SA-0.2 Move `api/` to `apps/api/`

- `@monolith-docs/api` commands pass locally: Pass
- Local `docker compose build && up -d`: Pass
- Real consumer round-trip against actual credentials: Fail
- Result: Partial

### SA-0.3 Scaffold `packages/db/`

- Workspace package exists and is importable: Pass
- `pnpm --filter @monolith-docs/db run generate`: Pass
- Result: Pass

### SA-0.4 Update docs and verification commands

- `CLAUDE.md` / `README.md` command surface updated to the new layout: Pass
- Commands verified locally: Pass
- Result: Pass

### SA-0.5 Headless parity matrix

- Track A local mechanical items: Partial
- Track A real CRM / Connect items: Fail
- Track B runtime-upgrade comparison evidence: Partial
- Track C dev deploy and rollback recipe: Fail
- Result: Fail

## Verification Assessment

Verified after the H-1 fix:

- manual inspection of the GCE startup script change
- `git diff -- infrastructure/gce/startup.sh`

Environment limitation:

- Git Bash syntax-check execution failed locally with an MSYS process-creation error before parsing the file

Previously completed local verification still stands:

- `node scripts/validate-ai-workspace.mjs`
- `node scripts/run-turbo.mjs typecheck`
- `node scripts/run-turbo.mjs lint`
- `node scripts/run-turbo.mjs test`
- `pnpm --filter @monolith-docs/db run generate`
- `pnpm --filter @monolith-docs/db exec prisma --version`
- `docker compose build`
- `docker compose up -d`
- `curl http://localhost:3020/health`
- `curl http://localhost:3020/api/status`
- `docker compose down && docker compose up -d`

Verification is still insufficient for checkpoint closeout because the plan requires real consumer-path verification and a deployed dev rollback dry run.

## Completeness Assessment

`code-complete`

Phase 0 remains locally code-complete for the workspace/tooling restructure, but it is not checkpoint-complete under the written plan.

## Final Verdict

`FAIL`

The deploy-script blocker from attempt 1 is fixed. Phase 0 still cannot close until the real CRM/Connect parity checks, dev deploy, and rollback evidence are captured.
