# Editor GitHub Migration — Execution Plan

**Initiative ID:** github-migration
**Abbreviation:** EGM
**Owner:** josh
**Parent:** monolith-platform `forgejo-exit` (FEX-3.4). Sibling: monolith-docs `github-migration` (GHM).
**Status:** Active. Drafted 2026-10-19; plan review PASS-WITH-NITS, every finding applied. **EGM-0.1–0.7 done 2026-10-19** with the owner's approval: the source of truth is `monolith-cx/monolith-docs-editor` (public), and `main` is at `e07f189`. Still open: EGM-0.8, the Forgejo export (due by 10-27).
**Hard deadline:** 2026-10-31
**Last updated:** 2026-10-19
**Guidance:** [guidance.md](./guidance.md)

**Owner approval** marks every push, transfer, mirror or key change, ruleset, secret, or registry setting. The exact command is written here before it runs.

**Staging rule:** this checkout holds another session's uncommitted edits, including in `CLAUDE.md`, `.ai/registry.yml`, and `infrastructure/gce/teardown.sh` (see guidance, Out of scope).
- EGM-0.1a commits only this initiative's new files and its registry entry; the registry hunk goes in with `git apply --cached`.
- EGM-1 to EGM-3 run in a clean worktree off `origin/main` (`~/dev/monolith-docs-editor-egm`).
- `git diff --cached` is reviewed before every commit.

## Phase Overview

| Ref | Phase | Target | Depends on | Status |
|---|---|---|---|---|
| EGM-0 | First push and cutover into `monolith-cx` | 2026-10-20 | — | **0.1–0.7 done 2026-10-19**; 0.8 (export) open |
| EGM-1 | CI on GitHub Actions and the `main` ruleset | 2026-10-22 | EGM-0 | Planned |
| EGM-2 | `editor-api` image to GHCR | 2026-10-24 | EGM-1; FEX-4.1 for the VPS pull | Planned |
| EGM-3 | Doc sweep and close | 2026-10-28 | EGM-2 | Planned |

**Reviewers:** Sonnet for each checkpoint; DeepSeek, Sonnet, and Codex at the close. Only workflow YAML and docs are reviewed; this repo has no customer data.

**Every checkpoint summary states whether new unresolved errors were found and whether they were added to `ERRORS.md`.**

## EGM-0 First push and cutover into `monolith-cx`

- [x] **EGM-0.1** Protect and reconcile.
  - Local `main` (`44d097b`, 10 commits on no remote) and Forgejo `main` (`32bb2db`, the September CI PR #1) were bundled into `monolith-cx/forgejo-archive` release `editor-main-2026-10-19` (FEX-0.0).
  - On 2026-10-19 Forgejo `main` was merged into local `main` with `git merge --no-ff origin/main`, giving `d778652`. The merge was clean, and it adds only `.forgejo/workflows/ci.yml`.
  - `git rev-list --left-right --count github/main...main` is `0 11`, so the push is a fast-forward.
- [x] **EGM-0.1a** (Done: `e07f189`. The registry hunk was staged with `git hash-object` and `update-index`, so the other session's DOC-DPP edits stayed unstaged.) **Owner approval:** commit `.ai/initiatives/active/github-migration/` (untracked) and the EGM entry in `.ai/registry.yml` onto local `main`. The registry hunk goes in through `git apply --cached`, so the other session's DOC-DPP hunks stay unstaged. The first push then carries the initiative.
- [x] **EGM-0.2** (Done 16:39 PDT. All 12 commits scanned. The only hits were test fixtures (`startup-test…` and `test-onlyoffice…` JWT strings, the all-`0x01` seal key) and a public CSP hash. `.env.example` holds placeholders only. Push protection raised nothing.) Secret check before publishing. The 2026-10-19 scan of the ten commits was clean (guidance E2). Re-run it on `github/main..main` (11 commits plus the 0.1a commit) immediately before 0.4, and record the result. GitHub's secret-scanning push protection is on for this repo. If it flags the all-`0x01` test seal key, the push is refused, which is a safe failure; resolve it by reviewing that one hit, never by bypassing protection blindly.
- [x] **EGM-0.3** (Done 2026-10-19 16:40 PDT. `remote_mirror_x5rMT8OXok0` was deleted (204) and `push_mirrors` now lists nothing.) **Owner approval:** delete the Forgejo push mirror through the API. Use the `forgejo-api-claude` token through the 1Password service account, never printed, as Docs' GHM-0.5 did: list `push_mirrors`, delete the one targeting GitHub, and re-list to confirm it's empty. Record the time.
- [x] **EGM-0.4** (Done. `32bb2db..e07f189` as a fast-forward, and `ls-remote` equals local `main`. GitHub's push notice reported **76 Dependabot alerts** on the default branch (1 critical, 31 high, 39 moderate, 5 low), logged in `ERRORS.md`.) **Owner approval: the first push to the public repo.**
  ```bash
  git push github main:main
  ```
  It must be a fast-forward from `32bb2db`. A rejection means stop and reconcile; never use `--force`. Afterwards `git ls-remote github refs/heads/main` must equal local `main`. Record both.
- [x] **EGM-0.5** (Done. Key 162135820 `forgejo-push-mirror-v2` was deleted, and the repo has 0 keys.) **Owner approval:** delete the mirror's GitHub deploy key. The key is `forgejo-push-mirror-v2`, id **162135820**, write access (listed 2026-10-19). List again with `gh api repos/altus-labs-dev/monolith-docs-editor/keys` and delete exactly that id. If the mirror used a PAT instead, revoke it. Record which it was.
- [x] **EGM-0.6** (Done. It is `monolith-cx/monolith-docs-editor`, **visibility public**, default branch `main`, Actions enabled with the org's SHA-pin policy, and `main` is at `e07f189`. The old URL redirects.) **Owner approval:** transfer the repo.
  ```bash
  gh api --method POST /repos/altus-labs-dev/monolith-docs-editor/transfer -f new_owner=monolith-cx
  ```
  Confirm the visibility stays **public** (guidance E2), Actions is enabled, and the refs are unchanged. There's no precedent in this org for a public repo transfer, and an enterprise policy could refuse it; the fallback is in guidance E2. Never create a repo with the old name in `altus-labs-dev`, because the redirect depends on it.
- [x] **EGM-0.7** (Done. `origin` points to `monolith-cx`, `forgejo` is the old remote, and `main` tracks `origin/main`.) Swap the remotes:
  ```bash
  git remote rename origin forgejo
  git remote set-url github git@github.com:monolith-cx/monolith-docs-editor.git
  git remote rename github origin
  git fetch origin
  git branch -u origin/main main
  git remote set-head origin -a
  ```
- [ ] **EGM-0.8** **Owner approval, by 2026-10-27 at the latest, because it needs a live Forgejo:** export Forgejo's PRs (#1 and any others), issues, and releases as JSON into `monolith-cx/forgejo-archive`, as GHM-0.3 did. Archive the Forgejo repo read-only only after the export is confirmed.

**Acceptance:**
- GitHub `main` equals the merged local `main`, reached without force.
- The mirror and its credential are gone.
- The repo is `monolith-cx/monolith-docs-editor`, public, and `origin` points there.
- The export is archived.

**Checkpoint:** EGM-0. Sonnet.

## EGM-1 CI on GitHub Actions and the `main` ruleset

- [ ] **EGM-1.1** Write `.github/workflows/ci.yml`, ported from `.forgejo/workflows/ci.yml`:
  - triggers: `pull_request` and `push` to `main`;
  - job `checks` on `ubuntu-24.04`, with `permissions: contents: read` and a concurrency group that cancels superseded PR runs only;
  - `timeout-minutes: 30`;
  - SHA-pinned `actions/checkout` (with `persist-credentials: false`) and `actions/setup-node` (`node-version-file: .nvmrc`, so Node 24). Pins are resolved by dereferencing the tag to its commit, checking for annotated tag objects;
  - `corepack enable`, then `pnpm install --frozen-lockfile`, lint, typecheck, test, and build, through the repo's turbo wrapper, as the Forgejo job does;
  - the OnlyOffice battery (`scripts/editor-battery`, Docker-based) is **not** run in CI. Confirm that `pnpm test` and `build` don't invoke it;
  - actionlint clean.
- [ ] **EGM-1.2** Delete `.forgejo/` in the same PR. Open the PR into `main`, run it until green, and record the run id and its timings. A failure caused by the runner is fixed in the workflow. A real defect gets its own commit and goes to `ERRORS.md`.
- [ ] **EGM-1.3** **Owner approval:** the `main` ruleset, from `rulesets/main-protection.json`, written in this step as part of this initiative and applied with `gh api --input`. It requires a pull request and the `checks` check, blocks non-fast-forward pushes and deletion, and gives the org admin bypass only through a PR. Run negative tests on a scratch ruleset for `ruleset-probe/*`, as GHM-2.7 did: a direct push to `main` is refused, and a PR without a passing check is blocked.

**Acceptance:**
- CI is green on the PR and on the push to `main`.
- `.forgejo/` is gone.
- The ruleset is active, and its negative tests are recorded.

**Checkpoint:** EGM-1. Sonnet.

## EGM-2 `editor-api` image to GHCR

- [ ] **EGM-2.1** Write `.github/workflows/images.yml`:
  - `workflow_dispatch` (and later a push to `main`, if the owner wants that);
  - `environment: images`, whose branch policy admits only `main`. **Owner approval** to create it;
  - `permissions: { contents: read, packages: write }`;
  - `docker/login-action` and `docker/build-push-action`, SHA-pinned;
  - the build context is the repo root with `-f apps/api/Dockerfile`. `.dockerignore` strips `docs`, `infrastructure`, `scripts`, `apps/web`, `.ai`, and `.git`, and the first build proves that the filtered install still works with `pnpm-workspace.yaml` listing `scripts/editor-battery`;
  - `load: true`, then a smoke run. Start the container detached with `EDITOR_ENV=local` and a throwaway `EDITOR_SEAL_KEYS` generated in the job (the format is in `config.ts` `parseSealKeys`; `local` still requires a seal key). Run `docker exec <ctr> wget -qO- http://127.0.0.1:3020/health` with no published port. `/health` needs no DocumentServer, but it does read `dist/fixtures/sample.docx`. Then `docker push`;
  - the tag `ghcr.io/monolith-cx/editor-api:<sha>`, `provenance: false`, and the label `org.opencontainers.image.source=https://github.com/monolith-cx/monolith-docs-editor`.
- [ ] **EGM-2.2** **Owner approval:** run it, and record the digest. Check the package's visibility **immediately**. It probably comes up public, inherited from the repo. Apply the owner's E4 decision in the package settings (a UI step), and record it.
- [ ] **EGM-2.3** Repoint `infrastructure/vps/docker-compose.editor.yml:63` to `ghcr.io/monolith-cx/editor-api:<sha>`, changing only the image line and its comments at lines 17 and 60–62, which cite the old "FEX-2.4" and registry wording (guidance E5). In `infrastructure/vps/README.md`, the pull section states the FEX-4.1 short-lived pull: no `docker login` stays on the box.
- [ ] **EGM-2.4** Tell EDIT: one line in its handoff saying that the image path for EDIT-6.6 is ready.

**Acceptance:**
- The image is built and pushed by the workflow with `GITHUB_TOKEN`, and it passed the smoke run.
- The compose fragment names it.

**Checkpoint:** EGM-2. Sonnet.

## EGM-3 Doc sweep and close

- [ ] **EGM-3.1** Docs:
  - `CLAUDE.md`: the line-3 source of truth and CI. Edit it in the clean worktree; the other session's hunk is near line 140.
  - `infrastructure/gce/startup.sh:14`: `REPO_URL` points at the old GitHub path, which works through the redirect. Update it to `monolith-cx`.
  - `README.md`.
  - `infrastructure/vps/README.md`.
  - ADR `docs/adr/2026-10-18-editor-hosting.md`: item 5 gets a dated supersession note pointing at FEX and EGM.
  - `.ai/handoffs/udoc-editor-service.md`: one pointer line only.
- [ ] **EGM-3.2** Grep proof: `grep -rIniE "forgejo|altuslabs\.dev|pkg\.dev|altus-labs-dev/monolith-docs-editor" --exclude-dir={node_modules,.git}`. Only historical records may match; list each one with its reason.
- [ ] **EGM-3.3** Close: acceptance items 1–6 with evidence, the close review (DeepSeek, Sonnet, Codex), doc sync, and the handoff `.ai/handoffs/github-migration.md`. Report to FEX-3.4 and FEX-5.

## Inventory

- 2026-10-19 merge: `d778652` = `44d097b` (EDIT-6 docs) + `32bb2db` (Forgejo CI PR #1). The bundle is in the archive release `editor-main-2026-10-19`.

## Blockers

- The owner's yes for every push (EGM-0.4 and later).
- The visibility question at the transfer (guidance E2), if GitHub raises it.
- FEX-4.1 (the `vps-deploy.sh` short-lived pull) before EDIT-6.6 can pull the image.

## Open items

_None yet._
