# Review — `standalone-app` close-out (attempt 1, Sonnet)

- **Date:** 2026-10-31
- **Reviewer:** Sonnet, in-session subagent, read-only
- **Scope:** branch `chore/sa-closeout` against `origin/main` (`5397cf7`) and Platform `docs/udoc-sa-closeout`: `standalone-app` and `deploy-pipeline-parity` archived, `packages/db` and `apps/web` removed, SA-1.7 moved to EDIT-2.9, SA-1.6 dropped, the image digest and the owner decisions recorded
- **Verdict:** **PASS-WITH-NITS.** One Medium, nine Low, two Nits.

## Verified by the reviewer

- The workspace validator passes.
- Nothing that builds or runs references the removed packages: the Dockerfile copies only `apps/api` and `apps/plugin`. `.github/`, `scripts/`, `package.json`, and `turbo.json` are also clean.
- The registry, ROADMAP, Platform's UDOC plan and handoff, and the digest agree.
- Dropping SA-1.6 is sound: `auth.ts` verifies each candidate's HMAC or JWKS token, so the token identifies the consumer.

## Findings and what was done

| Severity | Finding | Resolution |
|---|---|---|
| Medium | EDIT-2.9.c gave the expired page `'none'`. It has no `frame-ancestors` today, and it is shown inside the consumer's frame. | Same rule as the editor page: the named consumer's origins, otherwise `'none'`; a route test for each case |
| Low | EDIT-2.9.b left the legacy-consumer default implicit | States that a framing legacy consumer breaks until it registers an origin; the check of both legacy callers is an acceptance item; it notes that CSP is the only control (no `X-Frame-Options`) and that the `app.ts` comment changes |
| Low | EDIT-2.9.a did not say where `isOrigin` lives | It moves to a module shared by both routes |
| Low | The EDIT handoff still listed the Phase 0 deploy gate as a blocker | Struck through as resolved |
| Low | The EDIT handoff still called SA-1.7 a candidate follow-up | Now points to EDIT-2.9 |
| Low | The EDIT handoff's notes on another session's standalone-app and DPP files were stale | Removed, and the commit-state note rewritten |
| Low | `CLAUDE.md` said `standalone-app` must be re-scoped | Now says it was archived on 2026-10-31 |
| Low | A `consumers.ts` comment pointed at SA-1.6 | Reworded |
| Low | EDIT guidance listed both initiatives as live | Updated |
| Low | Archived docs linked to old paths | Repointed in the plans, the handoff, and the old umbrella's docs. The review records keep their historical paths. |
| Nit | `github-migration` cites `apps/web` and the old path | Left as is: a completed historical record |
| Nit | Platform's own `deploy-pipeline-parity` is a different initiative | No change; the text says "the editor's" |

After the fixes: the validator passes and the API typecheck is clean. The only code change is a comment.
