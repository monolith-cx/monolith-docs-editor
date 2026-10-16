# Checkpoint review — EDIT-4 — attempt 2

Date: 2026-10-16. Reviewer: Sonnet (in-session subagent, fresh context). Method:
- re-ran the API tests (50 pass);
- probed the hook, the `err` serializer, and the regexes in a scratch test file, deleted afterwards;
- relied on the implementer's nginx evidence.

## Verdict: PASS-WITH-NITS (2 Medium to fix before commit, plus Low/Nit). Completeness: code-complete.

The attempt-1 record was missing from `reviews/` when this ran, so the reviewer judged from the implementer's summary. It has since been written. Cloudflare is recorded honestly as Blocked. EDIT-4.3 (purge) and the deploy are owner actions outside this checkpoint.

### Findings

- **A. Medium — the stack scrub destroys production stack frames.** The API is ESM, so its frames read `file:///app/dist/…:10:5`, and `URL_IN_TEXT` rewrites them to `[url]`. The test only asserted the absence of `https://`. Fix:
  - keep `file:` URLs in stacks;
  - test that a `file:///…:10:5` frame survives;
  - Nit: keep the `cause` chain's code and scrubbed message, since an undici `fetch failed` hides its ECONNREFUSED there.
- **B. Medium — quadratic regex cost.** `SCHEMELESS_URL_IN_TEXT` backtracks on dotted runs: 20k characters took 0.77 s and 100k took 19 s. `scrubUrls` runs before the length cap. The hook runs on every string log argument, including reflected input. Fix: slice before scrubbing, bound the label repetition, and add a timing test.
- **C. Low.** The hook scrubs only top-level strings, so `log.info('x %o', {u: 'https://…'})` leaks. Nothing in the repo does this. The header says "Four layers" but lists five.
- **D. Nit.** `server.ts:67` now logs `listening at [url]`. Over-redaction of ordinary text is harmless. Scheme-less forms with no dot and bare paths are not scrubbed (no capability found there).
- **E.** `redactRequestPath`: no issues.
- **F.** nginx: no defect found. The map order is correct and `$uri` is query-free and merged. The error-log residual is recorded honestly.
- **G.** `ERRORS.md` is accurate. Two things are missing: the handoff is stale and must be refreshed before commit, and the checkpoint summary must name the two new residuals.

### EDIT-4.4 acceptance

- Raw-log tests, scan with no URL that carries a path or query: **Pass**.
- `ERRORS.md` entries `[x]` with `Resolved:`: **Pass**.
- Re-scan at EDIT-2 and EDIT-3: pending by design.
- 4.2 overall: **Partial** (Cloudflare Blocked, recorded honestly).

### Required before commit

Fix A, fix B, refresh the handoff, write the attempt-1 record. A diff-only re-check of A and B is enough.

## Disposition (2026-10-16)

All applied:
- **A:** `file:` and `node:` frames are kept, `cause` is serialized one level, and a test checks the frame survives.
- **B:** input is sliced to four times the cap before scrubbing; DNS labels are bounded at 63 characters, at most 10 of them; a 100k-character input is timed in a test.
- **C:** the hook also scrubs string members of plain-object arguments (shallow copy), and the header is corrected.
- **D:** `server.ts` logs host and port as fields.
- **G:** the attempt-1 record is written and the handoff is refreshed.

The diff-only re-check of A and B follows in the attempt-3 note.
