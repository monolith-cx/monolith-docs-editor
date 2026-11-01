# Deploy Pipeline Parity — Guidance

## Initiative ID: `deploy-pipeline-parity`

## Summary

Bring Monolith Docs onto the same delivery discipline defined by the ecosystem `deploy-pipeline-parity` initiative, but adapt the implementation to Docs' actual runtime shape: GCE VM(s), Docker Compose, OnlyOffice DocumentServer, NGINX, and Cloudflare Tunnel. The goal is parity of delivery invariants, not forced runtime symmetry with Platform's Cloud Run model.

This initiative is a sibling to `standalone-app`, not a replacement for it. `standalone-app` defines the product and runtime topology. `deploy-pipeline-parity` makes that topology safe to ship repeatedly by adding CI, branch protection, automated deploys, rollback, and a durable dev environment.

## Convention Source

Docs follows the conventions set by:

- `C:\Dev\monolith-platform\.ai\ecosystem\initiatives\planning\deploy-pipeline-parity\guidance.md`
- `C:\Dev\monolith-platform\.ai\ecosystem\initiatives\planning\deploy-pipeline-parity\plan.md`

Shared invariants we inherit:

- protected `main`
- CI-gated `dev`
- auto-deploy on push to `dev`
- reviewed promotion to `main`
- environment-specific secrets and hostnames using the `-dev` suffix
- explicit smoke checks
- environment-specific rollback

## Current State

- There is no repo-local `.github/workflows/` directory today.
- The local git state currently has `main` only; there is no `dev` branch yet.
- Deployment is manual and GCE-hosted:
  - `infrastructure/gce/deploy.sh` provisions a VM per environment
  - `infrastructure/gce/startup.sh` clones the repo and runs `docker compose up -d --build`
  - `infrastructure/nginx/monolith-docs.conf` fronts `app.monolithdocs.com`
  - `infrastructure/cloudflare/tunnel-config.yml` routes `connect.monolithdocs.com` and `crm.monolithdocs.com` to the API
- Hosted rollout still depends on manual steps for DNS, origin cert placement, tunnel setup, and NGINX install/reload.
- `ERRORS.md` already records public-IP drift as an operational risk; there is no automated protection against it yet.
- `standalone-app` Phase 0 will move the repo from `api/` + npm workspaces to `apps/api`, `apps/web`, `packages/db`, `pnpm`, and Turbo. Any CI/CD work that ignores that dependency will be short-lived.

## Goals

1. Add a repo-local CI `verify` workflow that becomes the required status check for `main` and `dev`.
2. Align Docs with the ecosystem `main`/`dev` promotion model without assuming Cloud Run.
3. Create a live `-dev` environment for Docs that matches the active hosted topology at each phase of the standalone initiative.
4. Replace manual "SSH in and pull latest" deployment with commit-SHA-based deploy and rollback automation.
5. Carry deployment parity through the standalone-era topology so the final `apps/api` + `apps/web` + OnlyOffice + Postgres + Redis stack is what actually gets automated.

## Non-Goals

- Not forcing Docs onto Cloud Run. OnlyOffice remains a stateful GCE-hosted service.
- Not making Docs identical to Platform's pipeline implementation. The invariant is shared; the mechanism can differ.
- Not front-loading the final standalone deployment automation before the standalone topology exists.
- Not treating the current manual GCE flow as acceptable long-term just because it worked for headless-only deployment.
- Not introducing a staging tier. The branch/environment model remains `dev` and `production`.

## Architecture Decisions

### AD-1: Parity is by delivery invariant, not by infrastructure clone

Docs adopts the ecosystem DPP contract at the policy level:

- CI gate before protected branches
- `dev` as the continuously deployed integration lane
- PR-gated production promotion
- env-specific secrets and rollback

Docs intentionally diverges from Platform's implementation details because Docs runs a co-located stack with stateful OnlyOffice and edge components that do not map cleanly to per-service Cloud Run deploys.

### AD-2: Sequence DPP around the standalone initiative

The standalone initiative is the runtime source of truth. DPP must not automate an obsolete shape.

- After `standalone-app` Phase 0, the repo's command surface and workspace layout are stable enough to add the CI `verify` job and branch protections.
- Before `standalone-app` Phase 6 closes, DPP must automate the final standalone-era deploy topology.

Practical rule:

- early DPP work = CI + branch model + current-stack dev deploy discipline
- late DPP work = final standalone deploy/rollback automation

### AD-3: Branch model is `main` + `dev`

Docs currently has only `main`. DPP establishes the same branch model used by the ecosystem plan:

- `main` is protected and production-reaching
- `dev` is the checked integration branch and the only branch that auto-deploys to the Docs dev environment

Branch protection is not applied until the repo has a stable `verify` workflow and status-check name.

### AD-4: Deploy and rollback are commit-SHA based on the VM, not image-tag based

The current GCE startup script already deploys from git checkout state, not Artifact Registry images. DPP keeps that basic model but makes it deterministic:

- deploy workflow targets a specific git SHA
- the VM checks out that SHA and rebuilds the compose stack in place
- rollback re-deploys an earlier known-good SHA

This matches the current repo reality and avoids inventing a half-Cloud-Run build pipeline for a stack that still deploys as a whole.

### AD-5: Docs uses whole-stack deploys, not per-service selective deploys

Platform's path-filter deploy fan-out is useful because Platform deploys separate Cloud Run services. Docs' hosted stack is co-located and tightly coupled:

- API
- OnlyOffice
- NGINX
- cloudflared
- later `apps/web`, Postgres, and Redis

Docs therefore deploys and smoke-tests the environment as a stack. Step-level smoke checks still distinguish failures by surface, but deploy orchestration remains whole-stack.

### AD-6: `-dev` naming is mandatory, but final standalone dev hostnames wait for the final topology

Docs inherits the ecosystem `-dev` naming convention for:

- VM names
- reserved IP resources
- secrets
- hostnames
- GitHub environments or workflow labels if introduced

Current hosted/headless dev hostnames can follow the existing `monolithdocs.com` family. Final standalone dev hostnames must be chosen only when the standalone edge topology is locked in Phase 6 so DPP does not pre-commit the wrong DNS shape.

### AD-7: Manual edge steps are debt, not an acceptable steady state

Origin certificates, NGINX reloads, tunnel route creation, and DNS changes are currently outside the automated path. DPP treats those as gaps to eliminate or codify so deploy parity is real rather than "automation plus a manual checklist."

## Risks

| Risk | Mitigation |
|---|---|
| CI/CD lands before `standalone-app` Phase 0 and bakes in obsolete `api/` + npm commands | DPP Phase 2 is explicitly blocked on standalone Phase 0 closeout |
| Docs copies Platform's Cloud Run assumptions and produces a fake parity plan | Guidance explicitly sets parity at the invariant layer and preserves the GCE/OnlyOffice architecture |
| Manual DNS/IP/cert drift keeps breaking hosted deploys | DPP phases include infra audit, static-address strategy, and scripted environment-specific deploy/rollback |
| Branch protection is enabled before `verify` exists | Branch protection is sequenced after the workflow and status-check name are stable |
| Early dev automation targets headless-only hostnames and has to be rewritten for standalone | DPP splits current-stack dev parity from standalone-era parity and treats the latter as the final closeout gate |

## Dependencies

- `standalone-app` Phase 0 must complete before DPP Phase 2 starts.
- `standalone-app` Phase 6 cannot close until DPP Phase 4 is complete.
- Ecosystem DPP standards remain the convention source, but Docs is a repo-local implementation because the ecosystem plan originally scoped Docs out before the standalone surface existed.

## Success Criteria

1. Docs has a repo-local `verify` workflow that is the required status check for protected branches.
2. Docs has both `main` and `dev`, with branch protections aligned to the ecosystem DPP model.
3. A live Docs dev environment deploys automatically from `dev` using `-dev`-named resources.
4. Production deploys are triggered from the reviewed `main` path, not from ad hoc SSH sessions.
5. Deploy and rollback target explicit SHAs and are documented and repeatable for both environments.
6. The final standalone-era topology, not the pre-standalone headless topology, is what the parity initiative closes against.
