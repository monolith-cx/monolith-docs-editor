# Handoff — github-migration (EGM)

**Updated:** 2026-10-25 PDT (EGM-3.1 and 3.2 done; close review attempt 1 passed with nits, all fixed)
**Lane:** active, in progress (closes at EGM-3.3).
**Plan:** `.ai/initiatives/active/github-migration/plan.md` · **Parent:** Platform `forgejo-exit` (FEX-3.4)
**Deadline:** 2026-10-31. The old self-hosted origin goes away.

## State

- **EGM-0 done.** The source of truth is GitHub `monolith-cx/monolith-docs-editor` (public, AGPL), `main` a fast-forward from the old origin; mirror and key deleted. 0.8 (2026-10-25): the export is in `monolith-cx/forgejo-archive` (`929965d`), and the old repo is archived.
- **EGM-1 done.** `.github/workflows/ci.yml` (`checks`) is green on PRs and on `main`; ruleset `main-protection` is active (PR plus `checks`, no force-push, no deletion), negative tests recorded; `.forgejo/` is gone.
- **EGM-2 done.** `.github/workflows/images.yml` (manual, `main` only through the `images` Environment, `GITHUB_TOKEN`) built, smoked, and pushed `ghcr.io/monolith-cx/editor-api:43784d4ac36ac1818e983a392be35b71ad866023@sha256:622275c39c7df9c57365f908e8a83b404ed8e83e3cc595f8a2df715d8027c4f1` (run 40233680582). The package is private by the owner's decision (guidance E4), so every pull logs in.
- **EGM-3.1, 3.2 done** on `docs/egm-3-close`: `CLAUDE.md`, `README.md`, `startup.sh:14`, the ADR's item 5 note, one pointer each in the EDIT handoff and `deploy-edit-4.md`; the grep proof lists every remaining match with its reason.

## Next

1. Close review attempt 1 is done (`reviews/review-egm-3-close-attempt-1.md`): Sonnet and Codex PASS-WITH-NITS, all fixed; DeepSeek did not run (401 in `ai-review`'s transport although `iddp-provider test deepseek` passes).
2. Owner approval: delete the stale `forge/ci` branch on GitHub (from the old PR #1) and the merged EGM branches; optionally remove the local `forgejo` remote in `~/dev/monolith-docs-editor`.
3. Open the close PR (owner approval), then move the initiative to `complete/` and set the registry entry.
4. Report to Platform: FEX-3.4 (EGM complete) and FEX-5 (records). That edit lands with the Platform push (its local `dev` has unpushed FEX commits), on a branch from `origin/dev`.

## Not EGM's

- **EDIT-6.6** (the VPS stand-up) waits on Platform FEX-4.1, the short-lived pull in `vps-deploy.sh`.
- **Dependabot:** 101 open alerts on 2026-10-25 (3 critical, 41 high, 50 medium, 7 low; paginated count), logged in `ERRORS.md` on 2026-10-19; triage before EDIT-6.6.
- **Main checkout:** uncommitted edits by an earlier session (standalone-app, DOC-DPP, `CLAUDE.md` reviewer lines, `.gitignore`, `teardown.sh`, `.ai/iddp/config.json`) wait on the owner's decision; EGM never stages them.

## Errors

No new unresolved errors found in EGM-3. The `ERRORS.md` change is a re-count on the existing 2026-10-19 Dependabot entry, not a new error.
