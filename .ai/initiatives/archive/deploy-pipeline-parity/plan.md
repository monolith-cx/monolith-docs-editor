# Deploy Pipeline Parity — Execution Plan

> **Archived 2026-10-31 (owner decision), never started.** It waited on `standalone-app` Phase 0 (archived the same day) and targeted a GCE + NGINX + Cloudflare Tunnel stack that no longer exists. What it was for landed elsewhere: CI and the protected `main` ruleset (EGM-1), the image build (EGM-2, the `Images` workflow), and the box's pull and deploy script (Platform FEX-4.1). Automated editor deploys are an EDIT follow-up (the VPS runbook deploys by hand until then). Nothing below is open work.

## Initiative ID: `deploy-pipeline-parity`

## Abbreviation: `DPP`

## Critical Constraint

Monolith Docs must follow the ecosystem deploy-pipeline-parity conventions without pretending Docs is a Cloud Run service. All CI/CD work in this initiative must preserve Docs' actual runtime boundary: GCE-hosted OnlyOffice, Fastify API, NGINX, Cloudflare Tunnel, and later the standalone `apps/web` + Postgres + Redis stack.

This initiative is also intentionally sequenced around `standalone-app`:

- DPP does not start meaningful implementation until `standalone-app` Phase 0 stabilizes paths and commands.
- DPP must be complete before `standalone-app` Phase 6 is considered deployment-complete.

---

## Phase 1: Audit And Target Shape

**Goal:** Ground the parity work in the repo's actual deploy surface and explicitly map it to the ecosystem DPP invariants.

### DPP-1.1 Git + workflow audit

- Confirm local branch model is `main` only and record the absence of `dev`
- Confirm there is no repo `.github/workflows/` directory today
- Record current verification commands from the repo (`npm`/`api/`) and note they will change under `standalone-app` Phase 0
- Status: Pending
- Acceptance: The plan records the actual starting state: no GitHub Actions, no `dev` branch, no branch protection

### DPP-1.2 Hosted stack audit

- Audit:
  - `infrastructure/gce/deploy.sh`
  - `infrastructure/gce/startup.sh`
  - `infrastructure/nginx/monolith-docs.conf`
  - `infrastructure/cloudflare/tunnel-config.yml`
  - `infrastructure/environments/*`
  - `ERRORS.md`
- Record the current manual steps that still gate a hosted deployment:
  - DNS record creation
  - origin cert placement
  - tunnel install/config
  - NGINX install/config/reload
  - repo checkout/pull on the VM
- Record the current prod operational risks, especially IP drift and env drift between the VM and the repo
- Status: Pending
- Acceptance: The plan distinguishes what is already scripted from what is still manual and risky

### DPP-1.3 Target delivery model

- Translate ecosystem DPP invariants into Docs-specific mechanics:
  - `verify` workflow instead of manual local-only checks
  - `dev` branch auto-deploy to a GCE-hosted `-dev` environment
  - PR-gated `main` deployment to prod
  - rollback by git SHA on the VM, not by Cloud Run revision
- Explicitly document the deliberate divergences from Platform's local DPP plan:
  - no Cloud Run
  - no Artifact Registry-centered deploy graph
  - no per-service fan-out deploy
- Lock the cross-initiative dependency points:
  - DPP Phase 2 blocked on `standalone-app` SA-0 closeout
  - DPP Phase 4 blocked on the final standalone deployment topology being present
- Status: Pending
- Acceptance: A Docs-specific parity model is documented and does not inherit Cloud Run assumptions by accident

### DPP-1.4 Phase 1 closeout

- Append the audit findings to this plan
- Confirm the sequencing with `standalone-app` is reflected in both initiatives
- Checkpoint review (Codex) PASS
- Status: Pending
- Acceptance: The repo-specific parity target is documented and review-passed before implementation starts

---

## Phase 2: CI Baseline And Branch Model

**Goal:** Add the minimum viable CI and branch-control surface after `standalone-app` Phase 0 stabilizes the workspace layout and command paths.

**Dependency:** `standalone-app` Phase 0 complete

### DPP-2.1 Add `verify` workflow

- Create repo-local GitHub Actions under `.github/workflows/`
- Implement a stable `verify` job name to serve as the protected-branch status check
- Run the post-Phase-0 commands, not the legacy npm layout:
  - workspace install
  - targeted repo typecheck/lint/test commands
  - `docker compose config`
- Start with whole-repo verification rather than premature path-filter fan-out
- Status: Pending
- Acceptance: PRs can trigger a working `verify` job against the post-Phase-0 repo layout

### DPP-2.2 Extend CI to both protected branches

- Trigger `verify` on PRs targeting `main`
- Trigger `verify` on PRs targeting `dev`
- Keep the status-check name stable so branch rules can bind to it once and stay valid
- Status: Pending
- Acceptance: `verify` runs identically for `main` and `dev` PRs

### DPP-2.3 Create `dev` branch and apply branch protection

- Create the long-lived `dev` branch once `verify` is live
- Apply the ecosystem DPP protection model:
  - `main`: require PR + passing `verify`; no force-push; no delete
  - `dev`: require passing `verify`; direct push allowed; no force-push; no delete
- Record the exact GitHub ruleset or fallback mechanism used
- Status: Pending
- Acceptance: Docs has the same branch model as the ecosystem DPP plan, bound to a real CI check

### DPP-2.4 Phase 2 closeout

- Verify the `verify` workflow is green on a representative PR
- Verify branch protection behavior on `main` and `dev`
- Update docs that reference the old local verification commands if DPP introduced workflow-specific expectations
- Checkpoint review (Codex) PASS
- Status: Pending
- Acceptance: Docs now has a real CI gate and a usable `main`/`dev` model before deploy automation expands

---

## Phase 3: Current-Stack Dev Deploy And Rollback

**Goal:** Replace the current manual hosted-dev workflow with an automated, SHA-targeted dev deployment for the existing hosted stack.

**Dependency:** DPP Phase 2 complete

### DPP-3.1 Harden the GCE deploy substrate

- Refactor the current GCE scripts so they can deploy a specific git SHA rather than `git pull` the moving branch head
- Make the deploy scripts idempotent for repeated dev deploys
- Decide and implement the stable-address strategy for the dev VM so DNS does not drift on recreation
- Move environment-specific assumptions out of manual operator memory and into repo-managed scripts or config
- Status: Pending
- Acceptance: The repo can drive an explicit-SHA deploy to the dev VM without relying on "SSH in and pull latest"

### DPP-3.2 Add dev deploy workflow

- Trigger on push to `dev`
- Authenticate to the Docs GCP project with the least-privilege deploy identity that fits the GCE model
- Target the Docs dev VM and deploy the pushed SHA
- Run smoke checks for the current hosted surface, at minimum:
  - `/health`
  - `/api/status`
  - public editor bootstrap / OnlyOffice asset reachability on the dev hostname
- Status: Pending
- Acceptance: A push to `dev` updates the Docs dev environment automatically and smoke checks the result

### DPP-3.3 Add dev rollback workflow

- Add a workflow-dispatch rollback path for dev
- Roll back by previously deployed SHA
- Re-run the smoke checks after rollback
- Record the operator-visible rollback procedure in repo docs
- Status: Pending
- Acceptance: Dev rollback is no longer an ad hoc SSH procedure

### DPP-3.4 Dev hostname and edge parity for the current stack

- Apply the ecosystem `-dev` naming convention to the current hosted/headless surfaces
- Lock the current-stack dev hostnames for:
  - public editor/OnlyOffice surface
  - consumer API tunnel hostnames
- Ensure the edge config, tunnel config, and scripts agree on those names
- Status: Pending
- Acceptance: The current-stack dev environment is reachable, named consistently, and deploy-driven from `dev`

### DPP-3.5 Phase 3 closeout

- Run a real push-to-dev deployment
- Run a real dev rollback
- Capture smoke evidence in the review artifact
- Refresh the handoff with the current dev deploy/rollback recipe
- Checkpoint review (Codex) PASS
- Status: Pending
- Acceptance: Docs has a live, automated dev environment for the current hosted stack

---

## Phase 4: Standalone-Era Deployment Parity

**Goal:** Carry the parity work forward to the final standalone topology so the production-ready standalone stack is what the automation actually manages.

**Dependencies:**

- DPP Phase 3 complete
- `standalone-app` runtime topology available through the deployment layer

### DPP-4.1 Extend deploy automation to the final stack

- Update the deploy path for the final standalone runtime:
  - `apps/api`
  - `apps/web`
  - OnlyOffice
  - Postgres
  - Redis
  - NGINX
  - cloudflared
- Ensure the deploy scripts understand the post-Phase-0 workspace layout
- Ensure migrations and environment bootstrapping are part of the deploy path rather than a manual side task
- Status: Pending
- Acceptance: The automated deploy path targets the same topology the standalone initiative actually ships

### DPP-4.2 Extend smoke checks to standalone surfaces

- Add smoke verification for the final standalone architecture, including:
  - frontend reachability
  - API reachability
  - editor bootstrap path
  - DB/Redis-backed app boot
  - route isolation and hostname routing where applicable
- Distinguish "current stack" smoke checks from "standalone-era" smoke checks so failures are diagnosable
- Status: Pending
- Acceptance: Deploy automation verifies the real standalone surfaces, not just the old headless-only stack

### DPP-4.3 Add production deploy and rollback parity

- Wire the reviewed promotion path on `main` to production deploy
- Add production rollback by SHA using the same deploy substrate
- Ensure prod and dev are isolated by config, hostnames, and secrets
- Status: Pending
- Acceptance: Dev and prod now share the same delivery model, adapted to Docs' GCE stack

### DPP-4.4 Final hostname and edge alignment

- Codify the final standalone-era hostname matrix once `standalone-app` Phase 6 locks it
- Update:
  - Cloudflare Tunnel config
  - NGINX config
  - environment files
  - deploy/startup scripts
  - smoke checks
- Confirm the `-dev` naming convention for standalone hostnames is applied to the final chosen DNS pattern
- Status: Pending
- Acceptance: The final edge topology is automated and internally consistent across repo docs, config, and workflows

### DPP-4.5 Phase 4 closeout

- Execute a real dev deploy against the final standalone stack
- Execute a real production-path dry run or production rollout when ready under the reviewed `main` flow
- Verify rollback for at least one standalone-era deployment
- Checkpoint review (Codex) PASS
- Status: Pending
- Acceptance: Standalone deployment parity exists before `standalone-app` Phase 6 is treated as complete

---

## Phase 5: Initiative Closeout

**Goal:** Close the Docs-local DPP initiative once CI, branch protection, dev parity, and standalone-era production parity are all real.

### DPP-5.1 Closeout verification

- Confirm the success criteria in guidance are met with evidence
- Confirm `standalone-app` no longer carries manual-deploy-only gaps that belong to DPP
- Confirm rollback instructions are current
- Status: Pending
- Acceptance: There is no remaining gap between how Docs is supposed to ship and how it actually ships

### DPP-5.2 Doc sync

- Update:
  - `ROADMAP.md`
  - `.ai/registry.yml`
  - `.ai/handoffs/deploy-pipeline-parity.md`
  - any infra docs changed by the implementation
- Update cross-repo integration-status docs if the surrounding closeout has write access to them
- Status: Pending
- Acceptance: Docs and infra documentation match the delivered pipeline reality

### DPP-5.3 Phase close review

- Run multi-reviewer closeout review per IDDP defaults when tooling is available
- Fix findings until the initiative is genuinely closeable
- Status: Pending
- Acceptance: Closeout review passes with zero unresolved delivery, rollback, or doc-drift findings

---

## Sequencing With `standalone-app`

```text
standalone-app Phase 0 ──────┐
                             ├─→ DPP Phase 2 (CI + branch model)
                             ├─→ DPP Phase 3 (current-stack dev parity)
                             │
standalone-app Phases 1-5 ───┤
                             └─→ DPP Phase 4 (final standalone deploy parity)
                                        │
                                        └─→ standalone-app Phase 6 closeout
```

Rules:

- Do not implement DPP Phase 2 before `standalone-app` Phase 0 closes.
- Do not treat `standalone-app` Phase 6 as done while DPP Phase 4 is still open.
- If the standalone topology changes materially during implementation, update this plan before continuing deploy automation.

---

## Known Gaps / Deferred Questions

- Whether Docs should eventually build/publish deploy artifacts outside the VM flow is intentionally deferred. The current parity target is deterministic SHA-based VM deployment.
- Cross-repo integration-status updates in `monolith-platform` are part of closeout if write access is available; they are not a prerequisite for drafting this local initiative.
- If GitHub plan limitations prevent the preferred protection mechanism, record and use the documented fallback without changing the invariant.
