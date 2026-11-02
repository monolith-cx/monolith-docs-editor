# Review — EDIT-6.7 hosted acceptance (attempt 2: Codex)

- **Date:** 2026-11-02
- **Reviewer:** Codex (`ai-review --provider codex --uncommitted`), opposing review of the attempt-1 fixes
- **Verdict:** **FAIL** (two High). Every finding applied; before applying, the whole surface (stub, runner, tests, docs) was audited again so the fixes land as one batch. The acceptance re-ran on the final code and passed (04:19 UTC).

## Findings and what was done

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | High | The runner recorded but did not assert the status-1 notification the plan cites | The pass rule requires a verified status-1 notification for the session, and every notification for the session verified |
| 2 | High | The runner's pass rule and redaction had no tests | Both moved to a pure module, `scripts/editor-battery/src/hosted-acceptance-check.mjs` (`acceptanceFailures` names each failed item; `redact`); `test/hosted-acceptance-check.test.mjs` covers a complete run, each missing fact naming its own failure, and redaction of the key and of sealed URLs |
| 3 | Medium | `issuedKeys` and `seenDeliveries` were unbounded | Bounded sets (100 keys, 1000 delivery ids) that forget the oldest |
| 4 | Medium | `Buffer.from(hex)` truncation let a valid signature carry a non-hex suffix | Only `v1=` followed by exactly 64 hex characters is considered; a regression test sends a suffixed signature |
| 5 | Nit | The stub test hid the child's stderr | Captured and included when the stub fails to start |
| 6 | Nit | `readCapped` should cancel the body past the cap | Leaving the `for await` loop cancels the stream; the comment says so |
| 7 | Doc-sync | The CI comment said the battery defines no test script | It says the battery's `test` runs only the pure tests under `test/` |
| 8 | Doc-sync | Platform integration status | At the EDIT close-out (DOC-5) |

After the fixes: 9 tests pass (`pnpm test` in `scripts/editor-battery`); the final stub is on the box (sha256 `366ddeb2…`, matching the branch) and the acceptance passed with no failures; the API's log shows no refused callback.
