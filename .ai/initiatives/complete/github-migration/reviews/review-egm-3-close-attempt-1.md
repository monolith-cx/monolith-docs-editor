# Close review — EGM (phase close at EGM-3.3) — attempt 1

Date: 2026-10-25. Scope: the uncommitted EGM-3 diff on `docs/egm-3-close` (base `origin/main` `5e80087`).

| Reviewer | How | Verdict |
|---|---|---|
| Sonnet | in-session subagent, fresh context, read-only; verified claims with `gh api`, `gh run view`, `gh pr view`, `git`; re-ran the grep | PASS-WITH-NITS |
| Codex | `ai-review --provider codex --mode phase-close --uncommitted --no-artifact` (gpt-5.6-luna, read-only sandbox) | PASS-WITH-NITS |
| DeepSeek | `ai-review --provider deepseek …`, twice | **Not run:** both attempts ended in a 401 from DeepSeek naming a key that is not the configured one (a different suffix each time), while `iddp-provider test deepseek` answered 200 with the configured key. A defect in the review transport, outside this repo; Codex already sits on the panel, so no substitute was added. |

## Findings and resolution

### Sonnet

1. **High — the Dependabot count was wrong.** 30 was GitHub's first page. Fixed: the paginated count is 101 open (3 critical, 41 high, 50 medium, 7 low), in `ERRORS.md` and the EGM handoff.
2. **Low — the EDIT handoff pointer said the move was closed.** Fixed: "EGM-0 to EGM-2 are done … EGM-3 closes it".
3. **Low — acceptance item 6 read as done.** Fixed: pending until the close review and the FEX report.
4. **Low — `checks` on PRs #4 and #5 was unconfirmed.** Confirmed: `checks=SUCCESS` on both (`gh pr view --json statusCheckRollup`); no wording change.
5. **Nit — say the `ERRORS.md` change is a re-count, not a new error.** Fixed in the handoff's Errors section.

### Codex

1. **Medium — guidance header and "Why this initiative exists" read as current.** Fixed: `Last updated` 2026-10-25 with the current state, and the section now says the table is the 2026-10-19 record.
2. **Nit — no test asserts `startup.sh`'s repository URL.** Not changed: the GCE path is unused on the VPS and kept for the return-to-GCP plan; a one-string change does not warrant a test harness for a script nothing runs.
3. **Doc sync — keep the registry `in_progress` until EGM-3.3 ends.** Done: still `in_progress`; the notes now say EGM-3.3 is in progress.

## Evidence

`node scripts/validate-ai-workspace.mjs` passed after the fixes. No new unresolved errors; the `ERRORS.md` change is a re-count on the existing Dependabot entry.
