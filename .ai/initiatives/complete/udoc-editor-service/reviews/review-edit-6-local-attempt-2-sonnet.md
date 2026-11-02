# Checkpoint review — EDIT-6.1–6.5 (the local half) — attempt 2 (Sonnet, verification)

Date: 2026-10-18. Reviewer: Sonnet (in-session subagent, fresh context, read-only).

**What the reviewer ran:**
- API: 234 tests, typecheck, lint.
- `node --check` on the battery files.
- `docker compose config` on the fragment; `caddy validate`.
- Throwaway Caddy containers:
  - routing variants: case, percent-encoding, `//`, and `..` on `/api/*` and `/health/*`, all still refused;
  - the error-log finding, reproduced.
- Throwaway DocumentServer containers, to check the declared volumes, logrotate, and how the entrypoint gates the bundled database and queue.
- A watchdog simulation under `env -i`, with about 25 scenarios.

**Verdict:** PASS-WITH-NITS. All 17 attempt-1 findings are fixed. No Critical, High, or Medium findings.

## New findings

### Low

1. **N1. The lock line silenced stderr for the rest of the run.** `exec 9>… 2>/dev/null` is an `exec` with no command, so the redirect stays in force afterwards. A later runtime error would print nothing and mail nothing.
2. **N2. Docker calls were unbounded.** A hung call would hold the lock for good, and every later run would exit 0 silently.

### Nits

3. **N3.** The env template's commented `ONLYOFFICE_CALLBACK_URL_ORIGINS` example used the old DocumentServer name.
4. **N4.** The Caddy `ERRORS.md` entry pointed to the nginx entry as "above"; it is below.
5. **N5.** `maxprocesscount` was described as "sized in 6.4"; 6.4 measured only memory.
6. **N6.** The restart-to-recovery time was given three different ways across the plan, the ADR, and the record.
7. **N7.** The ADR stated "that save needs the converter" as fact; it was not measured.
8. **N8.** The watchdog's comment on `fatal` was inaccurate.
9. **N9.** The registry choice: the docs committed to the Forgejo registry, while Platform's Forgejo exit (FEX-0.4) decides it.
10. **N10.** The probe's "keeps nothing" comment ignored the PDF that stays in DocumentServer's cache.
11. **N11.** The plan, handoff, and registry still carried the `<<E6R2>>` placeholders.

## Author's resolution (2026-10-18)

### The two Lows

- **N1:**
  - The fix: `{ exec 9>"$STATE/lock"; } 2>/dev/null || fatal …`.
  - Simulation: a runtime error injected after the lock now reaches stderr.
- **N2:**
  - Every `docker compose` call runs under `timeout` (`WATCH_CALL_SECONDS`, 120 s), the restart under 300 s, and `docker inspect` under 30 s.
  - Each run records when it took the lock. A run that finds the lock held for 30 minutes or more alerts "a docker call may be stuck"; a shorter hold stays silent.
  - Simulation: a 5-minute hold is silent; a 45-minute hold alerts.
- **Battery:** E6b re-run on the final script, `docs/spikes/results/10.0.0.1/2026-10-19-partial-0129.md`: pass.

### The nits

- **N3:** the example names `editor-documentserver-dev`.
- **N4:** the entry now says "the nginx error-log entry below".
- **N5:** "chosen for resilience, not measured", in the onlyoffice README and in plan 6.2.
- **N6:** "about 3 minutes (3 min 14 s)" in the plan and the ADR.
- **N7:** "presumably needs the converter, since the final save assembles the document (not measured)".
- **N8:** the comment is corrected.
- **N9:** reconciled while the review ran.
  - Platform's Forgejo exit (another session's initiative; deadline 2026-10-31) retires the Forgejo registry, and FEX-0.4 decides where editor images go. Artifact Registry `monolith-docs/editor-images` is recommended.
  - The fragment now names `<registry>/editor-api:<sha>`. The README, ADR decision 5, the plan, and the handoff say the stand-up waits for that decision.
  - That leaves one playbook deviation: DocumentServer from Docker Hub.
- **N10:** the comment says the PDF stays in DocumentServer's cache until its expiry.
- **N11:** filled with this verdict.
