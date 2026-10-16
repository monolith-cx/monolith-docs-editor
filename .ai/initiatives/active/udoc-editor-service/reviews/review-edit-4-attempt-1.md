# Checkpoint review — EDIT-4 — attempt 1

Date: 2026-10-16. Reviewer: Sonnet (in-session subagent). Re-ran the API suite (46 pass), typecheck, and lint; read every log call, `app.ts`, `log-safety.ts` and its test, and the nginx diff. The nginx and Cloudflare claims rest on the implementer's evidence.

(This record was first written by a shell command that did not run, because a preceding command in the same `&&` chain failed. It was rewritten from the review's text after attempt 2 pointed out its absence.)

## Verdict: FAIL (2 High, 3 Medium, 5 Nit). Completeness: code-complete.

### High
1. `routes/files.ts:87` logs the upload `id`, which is the capability for the unauthenticated `GET /api/files/<id><ext>`, and no test covers the upload route. Fix: log a fingerprint instead, drop `filename` (customer text) at `:68` and `:87`, and add a raw-log upload test.
2. EDIT-4.4 item 2 is not done. The two logging `ERRORS.md` entries are unchecked with no `Resolved:` note, and the nginx error-log residual is not recorded.

### Medium
1. The nginx map misses DocumentServer paths that carry the document id: `/downloadas/`, `/printfile/`, `/upload/`, `/downloadfile/`, and their version-prefixed forms. Safer: invert the map so `$uri` is logged only for static prefixes and everything else is masked to its first segment.
2. DocumentServer's own logs (the `onlyoffice-log` volume, `/var/log/onlyoffice`) are an unrecorded residual. Add them to `ERRORS.md` and to the EDIT-4.3 purge scope.
3. The Cloudflare check is "not checkable" rather than done. Record it as blocked and name the missing evidence.

### Nit
1. The nginx comment says the error log is "kept at `error` level on purpose", but the file sets no `error_log`.
2. `redactRequestPath` is case-sensitive and prefix-only, so `//editor/KEY` or `/Editor/KEY` would be logged unmasked.
3. `safeErrorText` only matches `scheme://`, so scheme-less signed URLs pass through.
4. `LOG_REDACT_PATHS` reaches only one level down, so an unhandled error's `err.config.url` could be logged. Add an `err` serializer.
5. `documents.ts` uses `app.log` and `req.log` inconsistently, so some lines have no `reqId`.

### Acceptance (EDIT-4.4)
- Raw-log scan for an open failure, a callback failure, and a successful save: **Partial** (the upload route is outside the scan).
- `ERRORS.md` entries checked with `Resolved:`: **Fail**.
- EDIT-2 and EDIT-3 re-run the scan: a forward obligation.

## Disposition (2026-10-16)

Every finding was fixed before attempt 2:
- **High 1:** `files.ts` logs `fileRef` and `ext`, and there is a raw-log upload-and-fetch test.
- **High 2:** both `ERRORS.md` entries are checked with `Resolved:` notes, and two residuals are added.
- **Medium 1:** the nginx map is now an allowlist (DocumentServer's own static-route pattern, otherwise the first segment), proven live: 15 probes, 0 secrets in the access log.
- **Medium 2:** DocumentServer 8.3's log configuration was inspected and recorded in `ERRORS.md`, and the purge scope was widened.
- **Medium 3:** Cloudflare is recorded as Blocked in plan EDIT-4.2.
- **Nits:**
  - an explicit `error_log … error` was added;
  - `redactRequestPath` is now an allowlist;
  - a scheme-less URL pattern was added;
  - an `err` serializer plus a `logMethod` hook were added (the new 500 test found Fastify logging the raw error message as `msg`);
  - all logging in request handlers now goes through `req.log`.
