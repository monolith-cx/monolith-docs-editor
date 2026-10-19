# Plan review — EGM, attempt 1

**Date:** 2026-10-19
**Reviewer:** Sonnet (in-session subagent, read-only). It verified the refs (`0 11`, a fast-forward), the public `github` remote with push protection on, the files and line numbers, no `@monolith-platform` use, and the `monolith-cx` org policy.
**Verdict:** PASS-WITH-NITS (4 Medium, 6 Low). All applied.

| # | Sev | Finding | Resolution |
|---|---|---|---|
| 1 | Med | Node 22 contradicts `engines` `>=24`, `.nvmrc` `24`, and `node:24-alpine`. | E3 and EGM-1.1 now use Node 24 with `node-version-file: .nvmrc`. |
| 2 | Med | The GHCR package will probably inherit **public** from the repo, and there is no REST endpoint to change it. | E4 makes it an owner decision (public recommended, since AGPL); EGM-2.2 checks visibility right after the first push. |
| 3 | Med | `EDITOR_ENV=local` alone fails at start (it needs `EDITOR_SEAL_KEYS`); the build context was unstated. | EGM-2.1: a throwaway seal key, `docker exec … wget /health`, the root context with `-f apps/api/Dockerfile`, and the `.dockerignore` facts. |
| 4 | Med | `.ai/registry.yml` is a shared dirty file as well, and no step committed the EGM entry or the untracked initiative. | EGM-0.1a commits them with `git apply --cached`; EGM-1 to EGM-3 run in a clean worktree. The risk row covers `teardown.sh`. |
| 5 | Low | The mirror key is `forgejo-push-mirror-v2` (id 162135820). | Named in EGM-0.5. |
| 6 | Low | Mixing `pnpm/action-setup` and corepack; dereferencing pins; the battery in CI; the timeout. | `corepack enable` only; pins dereferenced; the battery excluded; a 30-minute timeout. |
| 7 | Low | The grep missed the old repo path; `infrastructure/gce/startup.sh:14`; the compose comments would go stale. | Grep widened; `startup.sh` added to EGM-3.1; comments at lines 17 and 60–62 allowed in EGM-2.3. |
| 8 | Low | No precedent for a public transfer into `monolith-cx`; push protection could flag the test key. | Re-verify visibility and Actions after the transfer; push-protection handling added to EGM-0.2. |
| 9 | Low | FEX inconsistencies (compose `:44`, "8 commits", editor image listed as a deadline item, "FEX-2.4" in comments). | FEX fixed. The compose comments change in EGM-2.3. |
| 10 | Low | The Forgejo export needs a live host. | EGM-0.8 due by 2026-10-27. |
