# Checkpoint review — EDIT-2 — attempt 2 (Sonnet)

Date: 2026-10-18. Reviewer: Sonnet (in-session subagent, fresh context, read-only).

What the reviewer ran:

- API tests: 14 files, 176 passed.
- Typecheck and lint: clean.
- Four throwaway probes from the scratchpad:
  - auth-bypass paths;
  - 404 log lines;
  - source-route streaming and client abort;
  - the size cap and `onBase`.

**Verdict:** FAIL. No Critical finding. Of the 25 attempt-1 findings, all are fixed except M10, which waits on the battery record.

## Attempt-1 findings

Fixed:

- Sonnet H1, H2, H3.
- Sonnet M1, M2 (in code; the battery decides it), M3/Codex H1 (the source route; token confusion closed by the purpose byte; no path reopens the hole).
- Sonnet M7, M8, M9, and all 13 Sonnet nits.
- Codex M1, M2, M3, and the hostname nit.

Fixed with residual gaps (see M4 below):

- M4: strict-mode wiring. `strict-routes.test.ts` does run strict.
- M5/Codex H2: tested at unit level only.
- M6/Codex M4: implemented and wired, but untested.

Pending:

- M10: the new battery record had not yet landed.

Auth exemption probes all returned 401: `/api/documents/source/../keys/…`, `%2e%2e`, `/editor/../api/…`, `/api/files/../…`.

## New findings

### High

**H1. Fastify's default 404 logs the full URL.**

- What is logged:
  - `Route GET:/editor/<token>/ not found` carries a full 12-hour editor token.
  - `/api/documents/source/<token>/x` leaks a source token the same way.
  - `/api/documents/<key>/download` leaks a document key.
- Why the scrubber misses it: base64url tokens have no dotted host for it to match.
- This breaks EDIT-4's rule and contract §3.2.
- Fix:
  - A `setNotFoundHandler` that logs the redacted path only.
  - A `log-safety.test.ts` case.

### Medium

**M1. The source stream is not torn down when DocumentServer disconnects.**

- Cause: `pipe()` does not destroy the source when the destination closes.
- Probe result: after the client aborted, the service kept pulling (19 MB in 8 s) until the 120 s timeout.
- Fix:
  - Use `pipeline`, or destroy both ends on `reply.raw` `close`.
  - Add a test.

**M2. The source token lives as long as the session (up to 12 h).**

- The token is visible to the browser and in DocumentServer's logs.
- Every replay makes the service fetch up to 100 MB from the consumer's host.
- The per-IP limiter puts every document's fetch from DocumentServer into one bucket.
- Fix:
  - About a 5-minute token.
  - A separate limit for the source route.
  - A test that an old token is refused.

**M3. Docs cite battery results that had not landed.** Affected: the plan (2.1, 2.2), the ERRORS.md notes, and ADR F16. Re-check each against the record.

**M4. Test gaps.**

- The size-cap test passes if the request rejects.
- Untested: a declared length over the cap; a mid-stream upstream failure.
- The source route's refusal under strict at fetch time is not tested.
- `warnOnCallbackResolution` has no test.
- The `consumerProblems()` composition is not tested.

### Nits

- In `validateConsumersConfig`:
  - `callbackUrl` or `notificationSecretRef` without `profiles` skips validation;
  - a ref ending in `_PREVIOUS` is accepted;
  - the same secret value under two names is not detected.
- `run.mjs`: a same-minute `--only` run overwrites a partial record.
- env examples: the notification-secret comment sits above the source-limit lines.
- `vitest.config.ts`: the comment is stale.
- `package.json`: the fastify range `^5.3.3` predates `routerOptions`.
- Pending doc sync:
  - the plan header still says "Next: EDIT-2";
  - plan line 110 says "F1–F15";
  - the registry and handoff are not updated.

## Accuracy checks by the reviewer

The guide, contract, and code agree on:

- the drop and forgotten-file answers;
- `downloadUrl` for statuses 2 and 6 only;
- the `deliveryId` rules;
- the source-route limits;
- `profile_required`;
- `api-key` being local only;
- the HMAC key being the secret's text.

The only mismatch was contract §3.2's "redacted from logs" (H1).
