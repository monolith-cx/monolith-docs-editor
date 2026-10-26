# Checkpoint review — EGM-2.1, 2.3, 2.4 — attempt 1 (Sonnet)

Date: 2026-10-25. Reviewer: Sonnet (in-session subagent, fresh context, read-only).

**What the reviewer ran:** actionlint 1.7.7 on the worktree (clean); read the workflow against Docs'
`images.yml`, this repo's `ci.yml`, the Dockerfile, `config.ts`, `routes/health.ts`, and Platform's
FEX plan. It did not rebuild the image; the author's local build and smoke run are below.

**Verdict:** PASS-WITH-NITS. No Critical, High, or Medium findings.

Confirmed: `permissions: {}` at the top and `contents: read` + `packages: write` on the job only;
the `images` Environment plus `if: main`; `GITHUB_TOKEN` only in `docker/login-action`; no `${{ }}`
in any `run:` body; SHA pins equal to Docs'; the smoke step fails on an exited container, a wrong
body, and a 30 s timeout, and its trap keeps the exit status; the tag check never overwrites an
existing tag and stops on an unclear answer; nothing claims the image or the Environment exists.

## Findings and resolution

### Low

1. **`docker-compose.editor.yml:5` still named `<registry>`.** Fixed: "Replace <env> (dev, prod) and <sha>".
2. **README pull: "pasted or piped" invited `echo $TOKEN |`.** Fixed: the token is never an argument
   or an inline `echo`; paste it at the stdin prompt or pipe it from a command that does not print it.
3. **README pull: the temporary login survived a failed pull.** Fixed: the commands run in a subshell
   with `trap 'rm -rf "$DOCKER_CONFIG"' EXIT` right after `mktemp -d`.
4. **EGM-0.8's done note sits in front of the original instruction text.** Not changed: it is this
   plan's convention for every checked item (EGM-0.1–0.7, EGM-1.x); rewriting only 0.8 would make it
   the odd one out.

### Nits

- **Smoke container had network.** Fixed: `--network none`, as Docs' smoke runs; re-run locally on a
  fresh build: `/health` answered `{"status":"ok"}`.
- **The "absent" grep duplicates Docs' tested `tagState`.** Not changed: the same two strings and the
  same refuse-on-anything-else rule, in a one-workflow repo; the reviewer called it acceptable.
- **"the monolith-cx org requires it" is not verifiable from the repo.** Not changed: EGM-0.6
  recorded the org's SHA-pin policy on the transferred repo, and `ci.yml` carries the same line.
- **A public package needs no login.** Fixed: the README says so (EGM-2.2, guidance E4).

## Author's evidence

- `docker build -f apps/api/Dockerfile .` from the worktree: exit 0 (the `scripts/editor-battery`
  workspace entry does not break the filtered install).
- The smoke commands against that image: `{"status":"ok"}` after 2 s; without `EDITOR_SEAL_KEYS` the
  container exits with "EDITOR_SEAL_KEYS must hold at least one key", which the step's `Running`
  check reports.
- actionlint 1.7.7 clean after the fixes; `node scripts/validate-ai-workspace.mjs` passed.

No new unresolved errors; nothing added to `ERRORS.md`.
