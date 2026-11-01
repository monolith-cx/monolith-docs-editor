# Standalone App Phase 0 Review — Attempt 3

Reviewer: Codex
Date: 2026-04-19
Review Type: Manual checkpoint re-review after first Track C dev deploy attempt

## New Evidence Captured

- Dev VM `monolith-docs-dev` successfully booted the reviewed app SHA `54f44871abc3623704c8ca6e2e0c0136258f406a`
- VM-local `curl http://127.0.0.1:3020/health` returned `{"status":"ok"}`
- VM-local `curl http://127.0.0.1:3020/api/status` returned `{"api":"ok","onlyoffice":"ok","onlyofficeResponse":"true"}`
- Deploy-state rollback anchor captured: previous SHA `d22ccd9b436ec4a2aefb6eab7ed6308165e58595`
- The dev VM was stopped after verification

## Findings

### M-1: The successful Track C VM-local deploy depended on local deploy-substrate fixes that are not committed yet

The first dev deploy attempt exposed two operator-script defects: `deploy.sh` did not restart existing terminated VMs before waiting on SSH, and `startup.sh` aborted the whole boot sequence when cloudflared installation failed. Those issues were fixed locally and the deploy then succeeded, but the fixes are not yet part of a committed SHA. That means the current Track C evidence is useful, but not yet durable enough to treat as checkpoint-closeout evidence.

References:
- `infrastructure/gce/deploy.sh`
- `infrastructure/gce/startup.sh`
- `.ai/handoffs/standalone-app.md`

### M-2: Phase 0 still lacks the remaining dev-hostname and rollback acceptance items

Track C now has VM-local health evidence, but the plan still requires running the relevant Track A checks against the dev deployment surface and dry-running rollback. The real CRM/Connect round-trip checks are also still open.

References:
- `.ai/initiatives/active/standalone-app/plan.md:126`
- `.ai/initiatives/active/standalone-app/plan.md:127`
- `.ai/initiatives/active/standalone-app/plan.md:128`
- `.ai/initiatives/active/standalone-app/plan.md:132`

## Completeness Assessment

`code-complete`

## Final Verdict

`FAIL`

Phase 0 is materially closer: the dev VM-local deploy path is now proven, the rollback base SHA is captured, and the dev VM is shut down. It still cannot close until the deploy-substrate fixes are committed and the remaining Track C / consumer-path evidence is collected.
