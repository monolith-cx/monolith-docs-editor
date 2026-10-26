# Handoff — github-migration (EGM)

**Updated:** 2026-10-25 PDT (complete)
**Lane:** complete (2026-10-25).
**Plan:** `.ai/initiatives/complete/github-migration/plan.md` · **Parent:** Platform `forgejo-exit` (FEX-3.4, reported 2026-10-25)

## State

- **Source of truth:** GitHub `monolith-cx/monolith-docs-editor` (public, AGPL). `main` takes changes by pull request with the `checks` check green (ruleset `main-protection`). The old self-hosted origin is archived, and its export is in `monolith-cx/forgejo-archive` (`929965d`).
- **Image:** the manual `Images` workflow pushes `ghcr.io/monolith-cx/editor-api:<sha>`. The first image is `43784d4…@sha256:622275c3…`. The package is private by the owner's decision, so every pull logs in.
- **Close:** PR #6 merged as `73dd2a4`. The stale and merged branches are deleted on GitHub, so `main` is the only branch.

## Not EGM's

- **EDIT-6.6** (the VPS stand-up) waits on installing Platform's FEX-4.1 `vps-deploy.sh` on the box. That script is merged in Platform PR #134 (`7d76fde`); installing it needs the owner's approval. It binds `editor-api-<env>` to `ghcr.io/monolith-cx/editor-api`.
- **Dependabot:** 101 open alerts on 2026-10-25 (3 critical, 41 high), logged in `ERRORS.md`. Triage them before EDIT-6.6.
- **Main checkout:** uncommitted edits by an earlier session (standalone-app, DOC-DPP, `CLAUDE.md` reviewer lines, `.gitignore`, `teardown.sh`, `.ai/iddp/config.json`) wait on the owner's decision. A local remote named `forgejo` still points at the archived repo.

## Errors

No new unresolved errors.
