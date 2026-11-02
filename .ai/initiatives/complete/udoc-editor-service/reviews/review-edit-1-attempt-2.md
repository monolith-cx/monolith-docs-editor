# Checkpoint review — EDIT-1 — attempt 2

Date: 2026-10-17. Reviewer: Sonnet (in-session subagent, fresh context).

Checks the reviewer ran:
- `node --check` on every battery file;
- read the whole harness, the results (totals agree: 24 pass, 4 finding, 7 record, 1 blocked, 0 fail; 36 items), the ADR, the plan, the guidance, the handoff, and the Platform diffs;
- read the 10.0.0.1 image (entrypoint, `documentserver-generate-allfonts.sh`);
- read the 8.3 image (`callbackBackoffOptions.retries` 0);
- confirmed no JWT-like strings in the results.

## Verdict: PASS-WITH-NITS (0 High, 2 Medium, 6 Nit). Completeness: complete except U13 (Word), which is declared blocked.

## Attempt-1 findings

- **H1:** resolved for status 2. Status 6 was still open (see N1).
- **M1–M11:** all resolved.
  - M1: `finding` is a distinct result.
  - M2: every selection is asserted, and a keystroke marker proves input still lands.
  - M3: forged messages from DocumentServer's origin are ignored on both sides.
  - M4: S2 proves the file loaded, the canvas was drawn, and force-save answers error 4 for view-only versus error 0 for editable.
  - M5: the evidence is no longer truncated.
  - M6: F14 records the lock rule, and statuses 3 and 7 are marked not measured.
  - M7: the clipboard simulation is stated.
  - M8: the `jwtToken:false` control flips every outcome, and the restore runs in `finally`.
  - M9: the caveats are stated, the 8.3 claim was verified, and E7 is fixed.
  - M10: the deferrals are recorded.
  - M11: docs synced.
- **Nits:** all resolved.

## New findings

- **N1 (Medium):** the `deliveryId` rule claims `lastsave` and `forcesavetype` are stable across status-6 retries, but U5 only failed status-2 saves. Status 4 and 6 retries, and the distinctness of `lastsave` across two saves, are unmeasured. The EDIT-1.5 status line overclaims. Measure them or label them.
- **N2 (Medium):** U5 asserts almost nothing, so a future release could contradict F1 and still report `record`. Assert F1's counts.
- **N3 (Nit):** ADR F9 lists 7dcl, which is `pass` (the expected D11 behaviour).
- **N4 (Nit):** U2-U3 checks source and origin together; the ADR wording should say so.
- **N5 (Nit):** F15 is not reproduced in the results. Record the settle time.
- **N6 (Nit):** a `waitDsSettled` throw leaves the stack running. Wrap `up()`.
- **N7 (Nit):**
  - the plan still says F1–F13;
  - `CLAUDE.md`'s "session TTL" rule is not reconciled, and no follow-up is recorded;
  - the stale EDIT-2.4 sentence remains;
  - the U12 control's "callbacks stopped" is vacuous, because the document never opened.
- **N8 (Nit):**
  - the F4 AI off-switch is unexercised;
  - the README should say a proven run needs zero `blocked`;
  - item 4 has a stray `; docker` in a command string.

Per item:

| Item | Result |
|---|---|
| EDIT-1.1 | pass |
| EDIT-1.2 | pass |
| EDIT-1.3 | pass |
| EDIT-1.4 | pass |
| EDIT-1.5 | partial (N1) |
| EDIT-1.6 | pass with nits |

## Disposition (2026-10-17)

- **N1:** U5 now fails a status-6 force-save (503) and a status-4 close (503), records which fields change, and compares `lastsave` across two force-saves.
- **N2:** U5 asserts F1:
  - 429 and 5xx: 4 attempts, kept as forgotten;
  - 401 and `{"error":1}`: 1 attempt, kept;
  - an acknowledged save: not kept;
  - `key`, `status`, and `lastsave` stable across retries.
- **N3, N4, N7, N8:** wording fixed in the ADR and the plan. The F4 off-switch is explicitly left to EDIT-2.3. The `CLAUDE.md` session-TTL rule is a follow-up for EDIT-2, when the session map is removed.
- **N5:** run metadata and Markdown record DocumentServer's settle time.
- **N6:** `up()` failure tears the stack down.
- **N8 code:** the stray command text is removed.
- A final full run records the new U5; its numbers are in the plan and the ADR.
