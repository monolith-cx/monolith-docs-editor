# Checkpoint review — EDIT-2 — attempt 4 (Sonnet, verification of the attempt-3 fixes)

Date: 2026-10-18. Reviewer: Sonnet (in-session subagent, fresh context, read-only). It ran the API tests (15 files, 192 passed) and typecheck and lint (clean), and probed with:

- a bare Fastify 5.8.5 route for the error handler;
- a bare `@fastify/cors` preflight;
- a 64 MB body to a client that never read;
- an upstream that dies after headers.

**Verdict:** PASS-WITH-NITS. No High or Medium findings.

## Attempt-3 findings

| Finding | Status |
|---|---|
| Sonnet M1: a gzip upstream got the compressed `Content-Length` forwarded | Fixed: the request asks for `identity`, and a length is trusted only when the answer is uncompressed. The real-socket test compares the bytes. |
| Sonnet M2: garbage tokens went unthrottled | Fixed: @fastify/rate-limit 10.3.0 passes the key to function-valued `max` and `timeWindow`. Tests: 5 × 404 then 429, and 10 fetches then 429 per token. |
| Sonnet N1: an over-cap answer came out in Fastify's default shape | Fixed: the route error handler answers `502 {"error":"source_over_cap"}`. Reproduced on a bare route. |
| Sonnet N2: the served and aborted log lines | Fixed. One nit follows. |
| Sonnet N3: the ADR sentence was garbled | Fixed. |
| Sonnet N4: the over-cap tests were not deterministic | Fixed: two deterministic tests. |
| Codex M1: CORS and `DELETE` | Fixed: documented as server-to-server. The preflight test is not vacuous: a bare CORS probe answers `GET, POST, OPTIONS`. |
| Codex M2: `_PREVIOUS` values in the duplicate check | Fixed, with a test. |

## Regression checks (all clean)

- The keyGenerator's cost is bounded: a length check, a regex, one AES-GCM decrypt, and a JSON parse.
- The per-address fallback uses the global limit and window, in its own store.
- `reply.send(err)` passes other errors through as before; the 429 still arrives.
- Backpressure holds: a client that never read logged `Premature close`, not "served".
- The docs agree with the code.
- `-partial-0929` started after the last edits.

## Nits

- **N-1.** "Served" was logged when the last chunk was buffered, not when the client had it.
- **N-2.** A negative or fractional `Content-Length` was accepted.
- **N-3.** The plan placeholders need this verdict.

## Author's resolution (2026-10-18)

- **N-1:** "Document source served" is logged only once the pipeline completed *and* the response's `finish` fired, in either order. Under `inject` the order differs, which the log test caught.
- **N-2:** a length is used only when it is a safe non-negative integer.
- **N-3:** the plan, handoff, and registries carry this verdict.

Verification:

- 192 tests pass; typecheck and lint are clean.
- The service items re-ran on this final code: `docs/spikes/results/10.0.0.1/2026-10-18-partial-0940`, 8 pass.
