# Checkpoint review — EDIT-1 — attempt 1

Date: 2026-10-17. Reviewer: Sonnet (in-session subagent). The reviewer did not run the battery. Checks that ran:
- `node --check` on every battery file;
- API tests (54 pass);
- `docker compose config` and `validate-ai-workspace`;
- the pinned digest against Docker Hub;
- the image's `LICENSE.txt` additional terms and default configuration, read directly from the image.

## Verdict: FAIL (1 High, 11 Medium, 5 Nit). Completeness: code-complete.

### High
- **H1 — U5 does not measure what EDIT-2.4's `deliveryId` relies on.**
  - Only raw-body hashes are compared. Whether `url` (with its query) and the force-save type stay the same across retries is never recorded.
  - The backoff and timeout line is a literal string, not script output.
  - Only HTTP 500 was exercised, so E6's 503 and the 429 retry case are untested.
  - There is no negative control: the forgotten list is never checked for an acknowledged save.

### Medium
- **M1** — Loose-lock removals pass as plain PASS (7cl, U1, U1t). Totals can hide a result D11 may not accept. Give these items a distinct result.
- **M2** — Strict-lock attacks can pass vacuously. Selection results are ignored, and "value intact" is also what a no-op looks like. Assert each selection, and prove keystrokes reach the document after each attack (7, 7d, 8).
- **M3** — U2-U3 does not exercise the origin checks its title and the ADR claim: the plugin ignored 0 messages, and the panel only rejected a message it posted to itself. Post wrong-origin messages into both, or retitle.
- **M4** — S2 can pass with the editor not loaded: it checks only that the iframe exists, and its error check is always empty. Nothing shows that view-only was applied.
- **M5** — Evidence was truncated:
  - F4's `allowBrowserProxy` was cut by `head -4`;
  - F6's log format and paths were cut by `.slice(0,300)`.
  Widen the extraction and regenerate the results.
- **M6** — The ADR omits U6. In U6, a disconnect of one tab arrives while the same user is still connected in another tab, and the two connects are indistinguishable apart from the token. A lock released on disconnect would release early. Statuses 3 and 7 are unmeasured and not stated as such. Add a stronger lock rule to EDIT-2.4.
- **M7** — F10 and 7p/7x do not say the clipboard is simulated (`execCommand('copy')`, then `PasteHtml`; cut is copy plus Delete).
- **M8** — F3 claims callback URLs too, but only config and conversion URLs were measured. The `directIfIn.jwtToken` cause is inferred, with no control that flips it. U12 restores DocumentServer outside a `finally`.
- **M9** — Smaller gaps:
  - F2's "public origin" was seen only on loopback;
  - the shape of the body `token` was not recorded;
  - "8.3 had no retries" has no evidence in the repo;
  - E7 still names `pluginsData` as the per-session mechanism, but U2 proved `editorConfig.plugins.options`.
- **M10** — EDIT-1.2 deliverables were not built: header and footer fixtures, an upload target, and a receiver that answers any status. Build them or defer them explicitly.
- **M11** — Doc sync pending:
  - the registry note;
  - the EDIT handoff;
  - parent UDOC-1.2's "a short outage drops no save" needs the forgotten-files caveat;
  - the checkpoint summary must state whether new unresolved errors were found.

### Nit
- 9a checks the panel's position, not that the document canvas narrowed.
- The stub's root check has no path separator.
- The compose project name and ports are fixed. Document the one-run-at-a-time rule.
- The README omits its prerequisites.
- U1 never runs without `modifyContentControl:false`.
- The results file is dated in UTC; say so once.

### Per item
| Item | Result |
|---|---|
| EDIT-1.1 | Pass |
| EDIT-1.2 | Partial (M10) |
| EDIT-1.3 | Pass (S2 weak, M4) |
| EDIT-1.4 | Partial (M1, M2, M7) |
| EDIT-1.5 | Partial (H1, M3, M6, M8; the Word item correctly blocked) |
| EDIT-1.6 | Partial (M5, M6, M9, M11) |

Harness safety and repo hygiene were judged good:
- loopback-only ports;
- a random secret, stored only with `--keep`;
- no JWT in the results;
- the probe never served by the service;
- synthetic fixtures;
- AGPL-compatible dependencies.

## Disposition (2026-10-17)

All findings fixed before attempt 2; the details are in attempt 2's record.
