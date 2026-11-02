# Checkpoint review — EDIT-2 — attempt 3 (Sonnet)

Date: 2026-10-18. Reviewer: Sonnet (in-session subagent, fresh context, read-only). It ran the API tests (15 files, 188 passed), typecheck and lint (clean), and three scratchpad probes against the real app: the cap, mid-stream failure, a gzip upstream, a garbage-token flood, and log capture across hostile URLs.

**Verdict:** PASS-WITH-NITS. No Critical or High findings. Two Mediums, both reproduced by probe.

## Attempt-2 findings

All fixed:

- Sonnet H1, M1, M2 (with the side effect in M2 below), M3 (every battery claim checked row by row against `2026-10-18-0834` and `-partial-0907`), M4, and the nits.
- Codex H1 and M1. Codex H2 was not a defect: EDIT-1's record is unchanged.

## New findings

### Medium

- **M1. A gzip-encoded upstream got a short file under a forwarded `Content-Length`.**
  - Cause: undici decompresses the body, but the header still counted the compressed bytes.
  - Probe: 200,000 bytes gzipped to 229. The service sent `Content-Length: 229` with 200,460 bytes on the wire, and the client read 229 with no error.
  - Fix:
    - Ask the upstream for `identity`.
    - Never forward a length for an encoded answer.
    - Add a test.
- **M2. Garbage tokens got their own rate-limit buckets.**
  - Effect: the route lost its per-address limit (probe: 300 garbage requests, no 429).
  - A flood could also churn the store and reset a valid token's counter.
  - Fix:
    - Key on the token only when it opens; otherwise key by address with the global limit.
    - Add a test.

### Nits

- **N1.** An over-cap error before headers answers in Fastify's default shape, at error level.
- **N2.** "Served" is logged before the body is sent, and the abort log has no reason. A client hang-up should not warn.
- **N3.** The ADR's F4/F5 sentence is garbled.
- **N4.** The cap test accepts either outcome. Make it two deterministic tests.
- **N5.** Doc sync is still pending.

## Author's resolution (2026-10-18)

Every finding was applied:

- **M1:**
  - The upstream is asked for `accept-encoding: identity`.
  - A length is forwarded only when `content-encoding` is `identity`.
  - New test: "serves a compressed upstream whole".
- **M2:**
  - The keyGenerator keys on the token when `openSource` opens it, else on `ip:<addr>`.
  - `max` and `timeWindow` are functions of the key: per-token 10 per 5 minutes, otherwise the global per-address limit.
  - New test: 6 garbage tokens at a limit of 5 give a 429.
- **N1:** a route `errorHandler` answers `502 {"error":"source_over_cap"}` as JSON and drops any forwarded length. Without the drop, the first version hung, because the route had already set the file's type; the new test caught it.
- **N2:** the outcome is logged in the `pipeline` callback, with the reason `over_cap`, `upstream`, or `client_closed`. `client_closed` logs at info.
- **N3:** the ADR now states U9's three answers.
- **N4:** two deterministic tests: an over-cap first chunk answers 502; a cut after headers fails the body read.

Verification:

- 192 tests pass; typecheck and lint are clean.
- The service items re-ran on the final code: `2026-10-18-partial-0929`, 8 pass.
