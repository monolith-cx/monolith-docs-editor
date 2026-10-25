# Editor GitHub Migration — Guidance

**Initiative ID:** github-migration
**Abbreviation:** EGM
**Owner:** josh
**Parent:** monolith-platform `.ai/ecosystem/initiatives/active/forgejo-exit` (FEX), step FEX-3.4. The parent owns the org, the registry, and VPS-pull decisions. This child carries out the editor's side.
**Sibling:** monolith-docs `github-migration` (GHM). The steps here follow GHM's, where it has already proved them.
**Status:** Active. Drafted 2026-10-19 at the owner's direction ("draft the monolith-docs-editor child initiative … including merging Forgejo main into local main and the first push to GitHub. Ask me before any push"). Plan review: PASS-WITH-NITS (Sonnet, 2026-10-19), every finding applied (`reviews/review-plan-attempt-1.md`).
**Hard deadline:** 2026-10-31. The Forgejo host at `git.altuslabs.dev` goes away.
**Last updated:** 2026-10-19

---

## Why this initiative exists

The editor repo still treats Forgejo as its source of truth.

| # | Dependency | State on 2026-10-19 | What fails without Forgejo |
|---|---|---|---|
| 1 | Source of truth | `origin` = `ssh://git@git.altuslabs.dev:2222/altus-labs-dev/monolith-docs-editor.git`. GitHub `altus-labs-dev/monolith-docs-editor` (**public**, AGPL) is its push mirror, at `32bb2db`. `CLAUDE.md:3` says "Origin is Forgejo … GitHub is a public push mirror". | No canonical remote. |
| 2 | Work that exists only locally | Local `main` had 10 commits on no remote (EDIT-1 to EDIT-6), and its history had **diverged** from Forgejo, which carried the September CI PR #1 that local `main` never pulled. Bundled in `monolith-cx/forgejo-archive` release `editor-main-2026-10-19`. Merged locally on 2026-10-19 as `d778652`, so `main` is now 11 commits ahead of GitHub and 0 behind. | Without the bundle and a push, the commits would exist only on this machine. |
| 3 | CI | `.forgejo/workflows/ci.yml` (from PR #1): lint, typecheck, test, and build on Node 22. It used `actions/*@v4` tags. | No CI anywhere. GitHub has only the auto-enabled CodeQL. |
| 4 | Images | `infrastructure/vps/docker-compose.editor.yml:63` names `<registry>/editor-api:<sha>`. EDIT-6 (commit `44d097b`) already describes the registry as GHCR and leaves the exact name, the CI build, and the cutover to this child. **No `editor-api` image was ever pushed to Forgejo**: the FEX-2.2 inventory found only `docs-api` and `docs-web`. | Nothing breaks yet, but EDIT-6.6 can't stand the editor up without an image source. |
| 5 | Records | `CLAUDE.md`, `README.md`, `infrastructure/vps/README.md`, and ADR `docs/adr/2026-10-18-editor-hosting.md` item 5 still mention Forgejo or Artifact Registry. So do Platform's `project-registry.yaml`, and handoff and plan text in `.ai/`. | The docs describe a system that no longer exists. |

The editor does **not** consume `@monolith-platform/*` packages: no `package.json` names the scope, and there is no `.npmrc` route. So FEX-2's package work does not touch this repo.

## Scope

- The first push of the merged `main` to GitHub, without force. Then retire the Forgejo mirror and the mirror's GitHub credential.
- Move the repo into `monolith-cx` with a transfer. It stays **public**, because it is AGPL.
- Port CI to GitHub Actions with SHA-pinned actions, as the org requires. Protect `main` with a ruleset.
- An `editor-api` image workflow that pushes to `ghcr.io/monolith-cx/editor-api` with `GITHUB_TOKEN`, and repoint the compose fragment. The VPS pulls with the deploy job's short-lived token (FEX-4.1). The stand-up itself stays EDIT-6.6.
- A doc sweep, including superseding ADR item 5.

## Out of scope

- EDIT-6.6, the VPS stand-up, which UDOC-1 owns. This child only provides the image path, and coordinates so the two don't edit the same files at the same time.
- The uncommitted working-tree edits found on 2026-10-19 (`standalone-app` Phase 0 files, `CLAUDE.md`, `registry.yml`, `.gitignore`, `infrastructure/gce/teardown.sh`, two review files). They belong to another session and are never staged by this initiative. Every commit here stages only this initiative's own paths and hunks.
- Platform records: FEX-5 changes those.

## Decisions

**E1. GitHub `monolith-cx/monolith-docs-editor` becomes the source of truth.**
- Order (GHM's D10):
  1. Disable the Forgejo push mirror.
  2. Push `main` to GitHub without force (a fast-forward from `32bb2db`).
  3. Delete the mirror's GitHub deploy key.
  4. Transfer the repo to `monolith-cx`.
  5. Swap the remotes.
- Forgejo is archived later (owner).

**E2. The repo stays public.**
- AGPL code is public by design, and pushing to the public repo is publishing. The new commits (10, plus the merge `d778652`, so 11 ahead of GitHub) were scanned on 2026-10-19 and are clean: doc tables, an all-`0x01` test seal key, and `<op>` placeholders in the example env files.
- The owner confirms before the push. That is the "ask before any push" instruction.
- `monolith-cx` limits *members* to private repo creation. A transfer by an org owner is expected to keep the repo public. If GitHub refuses, the owner decides: keep it in `altus-labs-dev`, or allow public repos in `monolith-cx`.

**E3. CI is GitHub Actions on `ubuntu-24.04`, ported from the Forgejo workflow.**
- **Node 24**, from `.nvmrc` (`node-version-file: .nvmrc`). That matches `engines` (`>=24`) and the Dockerfile (`node:24-alpine`); the Forgejo workflow's Node 22 was out of spec.
- pnpm through `corepack enable`, as the Forgejo job did. The repo's `scripts/bin/pnpm` wrapper runs `corepack pnpm` and `packageManager` carries a sha512, so mixing in `pnpm/action-setup` could give two disagreeing pnpms.
- Every action is pinned to a full SHA.
- `permissions: contents: read`.
- No secrets.
- The required check is `checks`, the Forgejo job's name.
- Rulesets on `main`, following the playbook: a PR plus the required check, no force-push, no deletion, and admin bypass only through a PR.
- The repo has only `main`, with no `dev`. Its existing flow stays: work on branches, merge to `main`.

**E4. The image is `ghcr.io/monolith-cx/editor-api`, built by a workflow in this repo with `GITHUB_TOKEN` under an `images` Environment.** As in GHM, the Environment admits only `main`.
- **Visibility (owner decision at EGM-2.2):** a package first pushed with the source label links to this public repo and probably inherits **public**. There is no REST endpoint to change it.
  - Recommended: leave it public. The source is AGPL and public, and the image holds no secrets.
  - The alternative: set it to private in the package settings right after the first push, and record how long it was public.
  - The VPS's short-lived `packages: read` pull works either way.
  - **Decided 2026-10-25: private.** The first push (EGM-2.2) came up private, not public, and was never public. The owner chose to keep it private, so nothing was changed in the package settings and every pull needs a token.
- The VPS pulls with the deploy job's short-lived token (FEX-4.1).
- There is nothing to copy from Forgejo, because no image exists there.

**E5. Coordination with EDIT.**
- EDIT-6.6 (the stand-up) uses whatever image path EGM-2 lands.
- EGM touches `infrastructure/vps/docker-compose.editor.yml` and `infrastructure/vps/README.md` only in the image lines.
- Any change to EDIT's plan or handoff is a one-line pointer to this initiative.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Pushing to a public repo publishes the commits for good | High if a secret is in them | The scan is clean (E2), and the owner approves before the push. The private bundle is the fallback. |
| The transfer turns the repo private, or is refused, because of the org's private-only creation policy | Medium | The owner decides at EGM-0.6 (E2). Nothing else depends on the transfer before 10-31 except the GHCR namespace. If the repo stays in `altus-labs-dev` for now, the image workflow can still push to `ghcr.io/altus-labs-dev/editor-api` and move later. |
| Another session's uncommitted edits in this checkout get swept into a commit | Medium | `CLAUDE.md`, `.ai/registry.yml`, and `infrastructure/gce/teardown.sh` are shared dirty files. EGM-0 commits the initiative files and the registry hunk with `git apply --cached` from a hand-built patch. EGM-1 to EGM-3 work in a **clean worktree** off `origin/main`, so the other session's hunks can't mix in. Review `git diff --cached` before every commit. |
| EDIT-6.6 and EGM-2 edit the same compose fragment | Low | E5. Only the image lines, done in one PR. |
| CI fails on GitHub after it was green on Forgejo (versions, runner) | Low | Fix the environment, not the code. A real defect goes to `ERRORS.md`. |

## Acceptance (initiative)

1. GitHub holds `main` at `d778652` or its descendant, pushed without force, and the evidence is recorded. The Forgejo mirror and its GitHub credential are gone.
2. The repo is `monolith-cx/monolith-docs-editor`, public, and local `origin` points there.
3. `.github/workflows/ci.yml` is green on a PR and on a push to `main`. The ruleset is active, and its negative tests are recorded. `.forgejo/` is deleted.
4. The image workflow pushes `ghcr.io/monolith-cx/editor-api:<sha>`, and the compose fragment names it.
5. `CLAUDE.md`, `README.md`, `infrastructure/vps/README.md`, and the ADR describe GitHub and GHCR. ADR item 5 is superseded with a dated note. A grep for live references to `forgejo`, `altuslabs.dev`, and `pkg.dev` finds none.
6. Items 1–5 are done before 2026-10-31.
