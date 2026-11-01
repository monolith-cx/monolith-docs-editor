# Standalone App Handoff

Updated: 2026-10-31
Initiative: `standalone-app`
Lane: `archive`
Status: `archived`

**Archived 2026-10-31 (owner decision).** See the note at the top of `.ai/initiatives/archive/standalone-app/plan.md`: the restructure is done, the GCE parity gate is superseded, the placeholders are removed, SA-1.7 moved to EDIT-2.9, and SA-1.6 is dropped. Everything below is the April record, kept as history.
Current checkpoint: `Phase 0 (SA-0.0 through SA-0.5)`

## Current State

Phase 0 is locally code-complete for the repo restructure:

- pnpm + Turbo workspace landed
- `api/` moved to `apps/api/`
- `packages/db/` Prisma 7.7 scaffold landed
- `apps/web/` placeholder landed
- repo docs and control-plane files updated to the new layout
- GCE deploy scripts now deploy explicit refs and record current/previous SHAs
- the fresh-VM `deploy-ref` bug in `infrastructure/gce/startup.sh` is fixed
- a dev VM-local deploy test to SHA `54f44871abc3623704c8ca6e2e0c0136258f406a` succeeded; `/health` returned `{"status":"ok"}` and `/api/status` returned `{"api":"ok","onlyoffice":"ok","onlyofficeResponse":"true"}`
- the dev VM `monolith-docs-dev` was shut back down after verification

Checkpoint review status is still `FAIL` because the required external Phase 0 evidence is not captured yet. See:

- `.ai/initiatives/archive/standalone-app/reviews/review-phase-0-attempt-1.md`
- `.ai/initiatives/archive/standalone-app/reviews/review-phase-0-attempt-2.md`
- `.ai/initiatives/archive/standalone-app/reviews/review-phase-0-attempt-3.md`

Pre-deploy safety review status is now `PASS`. See:

- `.ai/initiatives/archive/standalone-app/reviews/review-phase-0-predeploy-codex.md`
- `.ai/initiatives/archive/standalone-app/reviews/review-phase-0-predeploy-codex-attempt-2.md`

## Verification Already Run

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

## Open Gates Before Phase 0 Can Close

- Commit and push the latest `deploy.sh` / `startup.sh` fixes used during the successful dev VM-local test
- Real CRM consumer round-trip verification against a committed SHA
- Real Connect consumer round-trip verification against a committed SHA
- Dev GCE deploy of the committed SHA using `infrastructure/gce/deploy.sh`
- Dev-hostname Track A items on the dev deployment, not just VM-local curls
- Rollback dry run on dev and recipe capture in the handoff and/or `ERRORS.md`
- Cross-project sync of `C:\Dev\monolith-platform\docs\ecosystem\integration-status\monolith-docs.yaml` if the Phase 0 path/tooling changes affect it

## Next Steps

1. Commit and push the post-`54f4487` deploy-substrate fixes in `infrastructure/gce/deploy.sh` and `infrastructure/gce/startup.sh`.
2. Re-run the dev deploy against that committed SHA.
3. Run the required consumer-path and dev-hostname checks, then dry-run rollback to `d22ccd9b436ec4a2aefb6eab7ed6308165e58595`.
4. Capture the rollback recipe and finish the checkpoint closeout review.
