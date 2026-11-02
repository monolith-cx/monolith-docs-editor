# Review — EDIT-6.7 hosted acceptance (attempt 1: Sonnet and Codex)

- **Date:** 2026-11-02
- **Reviewers:** Sonnet (in-session subagent, read-only, checkpoint) and Codex (`ai-review --provider codex --uncommitted`, opposing review)
- **Branch:** `feat/edit-6-7-acceptance` against `origin/main` (`1edbb5d`), uncommitted
- **Scope:** the acceptance stub (`infrastructure/vps/acceptance-stub/`), the runner (`scripts/editor-battery/src/hosted-acceptance.mjs`), and the plan, handoff, registry, ROADMAP, and ADR records of the run
- **Verdicts:** Sonnet **PASS-WITH-NITS** (one Medium); Codex **FAIL** (two High). Every finding applied, then the acceptance re-run on the final code (pass, 04:15 UTC).

## Verified by the reviewers

- The stub's verification follows the guide's order (timestamp window, constant-time `v1` HMAC, key binding, `deliveryId`); a replay is acknowledged; downloads only from the editor origin; the HS256 consumer token is valid for `verifyHmacToken`; `serveFile` refuses traversal; the launch and results gates compare in constant time; the launch page escapes its values and sends a strict CSP.
- The runner matches the save by the session's own key and needs a console refusal for the foreign-frame check, so neither can pass by accident.
- No IP address or credential in the changes; workspace validator and `node --check` pass.

## Findings and what was done

| # | From | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | Codex | High | The plan accepted a save of status 2 or 6 while the runner required status 2 | The plan states the run's acceptance: the final save (status 2), which DocumentServer sends only after a change |
| 2 | Codex | High | No automated tests for the stub's verification | `scripts/editor-battery/test/acceptance-stub.test.mjs` (6 tests: launch gate and token, file serving, verified save and download, replay, forged, stale, unknown key, delivery mismatch, foreign origin, redirect, oversize body); the battery package's `test` script runs it under `pnpm test` in CI |
| 3 | Both | Medium | Unauthenticated callbacks grew `results` without bound on a public host | `results` capped at 200; `stale` and `bad_signature` refusals only counted |
| 4 | Sonnet | Low | 1 MB callback bodies; the request was not destroyed | 64 KiB cap; the request is destroyed past it |
| 5 | Sonnet | Low | A mismatched `deliveryId` was reported as `replay` and answered 200 | `delivery_mismatch`, answered 401; only a seen id is a replay |
| 6 | Sonnet | Low | The download followed redirects and was unbounded | `redirect: 'error'` and a 25 MiB cap |
| 7 | Sonnet | Low | A non-string `key` from `open` reached the page | Refused as an open failure |
| 8 | Sonnet | Low | The runner could print the launch key in an error, and sealed editor URLs in console samples | Everything printed is redacted (the key, and every URL to its origin); errors are caught and redacted |
| 9 | Sonnet | Low | "Typed text saved", "all six operations", and F2 were not asserted | The runner asserts `hasDocumentXml` and six operations; the plan says a status-2 save followed the edit and that F2 rests on the API's log |
| 10 | Codex | Medium | HSTS claimed but not checked | The runner asserts HSTS on both hosts |
| 11 | Codex | Medium | `console.log` in the runner; `process.env` read across the stub | `process.stdout.write`; the stub reads its environment in one `loadConfig` |
| 12 | Codex | Nit | `box` could be null | A clear error |
| 13 | Sonnet | Low | Handoff row and next-step line, and the registry notes, still said 6.7 pending | Updated |
| 14 | Sonnet | Nit | README said `init: true` without saying the box lacks it; "never a URL" wording; a random id in the startup line | A note under the block; "stores no secret, token, or URL"; the id removed |
| 15 | Codex | Nit | Download content type not checked | Not applied: DocumentServer's cache answers a generic type; the ZIP signature and `word/document.xml` are the check |
| 16 | Codex | Doc-sync | Platform integration status for the editor | At the EDIT close-out (DOC-5), when UDOC-1 is complete |

After the fixes: the stub's 6 tests pass; the acceptance re-ran and passed (HSTS on both hosts, framed editor and panel with six operations, 0 CSP violations, a verified final save downloaded from the editor origin only, foreign framing refused; the API's log shows both notifications forwarded and no callback refused).
