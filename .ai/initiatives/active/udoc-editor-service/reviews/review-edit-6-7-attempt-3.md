# Review — EDIT-6.7 hosted acceptance (attempt 3: Codex)

- **Date:** 2026-11-02
- **Reviewer:** Codex (`ai-review --provider codex --uncommitted`), opposing review of the attempt-2 fixes
- **Verdict:** **FAIL** (two High: false-pass paths in the pass rule). Every finding applied; the stub and runner were audited again for other false passes before re-running. The acceptance passed on the final code (04:25 UTC).

## Findings and what was done

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | High | The pass rule counted six operations instead of naming them, so a different protocol could pass | `BRIDGE_OPERATIONS` (the protocol-1 names) must match as a set; tests for a missing and a substituted operation |
| 2 | High | The typed text was never checked in the save; an unchanged fixture could pass | The stub reads `word/document.xml` from the saved DOCX (central directory, stored or deflated, Node's zlib, output capped) and records the acceptance markers it holds, tags stripped so a marker split across runs is found; the runner types a unique timestamped marker and the pass rule requires that marker; tests for a split-run marker, a non-DOCX download, an empty and a stale marker list, and no marker typed |
| 3 | Medium | HSTS accepted any positive `max-age` while the record claims the exact header | `HSTS` must equal `max-age=31536000; includeSubDomains`; a test for a shorter `max-age` |
| 4 | Doc-sync | The plan's checkpoint line named only Sonnet | It records the Codex opposing reviews since 2026-11-02 |
| 5 | Doc-sync | Platform integration status | At the EDIT close-out (DOC-5) |
| — | Found in the re-run | `redact` swallowed the backslash before an escaped quote in the printed JSON, which then did not parse | A backslash ends a URL; a test parses redacted JSON |

After the fixes: 11 tests pass; the final stub is on the box (sha256 `b7bc7e76…`, matching the branch); the acceptance passed with no failures, the marker typed in the run found in the saved document; the API's log shows no refused callback; Caddy logged no error.
