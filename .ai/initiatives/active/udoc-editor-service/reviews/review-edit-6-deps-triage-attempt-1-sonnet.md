# Review — EDIT-6.6 prerequisite: dependency triage (attempt 1, Sonnet)

- **Date:** 2026-10-31
- **Reviewer:** Sonnet, in-session subagent, read-only
- **Branch:** `fix/edit-deps-triage` against `origin/main` (`729c168`)
- **Scope:** the Dependabot triage required by `ERRORS.md` (2026-10-19) before the VPS stand-up, and the `TRUST_PROXY` change it forced (Fastify 5.12 ignores a hop count)
- **Verdict:** **PASS-WITH-NITS.** No Critical or High findings.

## Verified by the reviewer

- **Ran:**
  - API `vitest run`: 235 tests in 17 files (234 on `origin/main` plus the new `req.ip` test). Plugin: 38 tests in 3 files, the same as `main`, so vitest 4 dropped no tests.
  - `tsc --noEmit` and `eslint src` clean.
  - `pnpm audit`: 3 moderate. `pnpm audit --prod`: 2 moderate.
  - `pnpm why vite`: only 7.3.7. The esbuild pin resolves to 0.28.2.
- **Read:**
  - `@monolith-docs/db` is unused by the API at build and run time. Its Dockerfile removals are consistent, since the frozen, filtered install already tolerated absent importers.
  - The `glob` call in `@fastify/static` 10.1.8 runs only with `wildcard: false`. The API sets no `wildcard` and registers the plugin only when `EDITOR_ENV=local`.
  - Fastify 5.12.7 turns a numeric `trustProxy` into "trust no one". `parseTrustProxy` never hands Fastify a number. The hop-count refusal applies in every `EDITOR_ENV`, and startup exits on it. No accepted value trusts arbitrary clients. The tests would fail on the old behaviour.
  - No non-AGPL-compatible package was added.

## Findings and what was done

| Severity | Finding | Resolution |
|---|---|---|
| Medium | `infrastructure/environments/{dev,prod}/env.example` still allowed "a hop count of at most 3" | Rewritten: addresses, CIDRs, or named ranges only, and why a hop count is refused |
| Medium | `.ai/handoffs/udoc-editor-service.md` (EDIT-5 section) still allowed a hop count | Superseding note added |
| Low | ADR decision 7's heading still read `TRUST_PROXY=1` | Retitled "Caddy, by its network subnet (was `TRUST_PROXY=1`…)" |
| Low | `@fastify/proxy-addr` declared `^5.1.0`, while the check and the `::/32` test depend on 5.1.2 | Raised to `^5.1.2` |
| Nit | `ERRORS.md` named `minimatch` under eslint only; it also sits under the unreachable `glob` | Both paths named |
| Nit | `trustProxyProblem`'s comment said "the function Fastify compiles"; it compiles per entry | Comment says per entry, and why that is equivalent |
| Nit | Dependabot's own count is unconfirmed until merge | Already stated; the entry stays open until then |

API tests re-run after the fixes: 235 pass, typecheck and lint clean.

## Not covered by this review

- No `docker build` and no browser battery. Both were run separately by the session: the image builds and answers `/health`, and the battery record is cited in the plan.
- The Prisma 7.10.1 bump in `packages/db` (outside the image) was checked only through the lockfile.
