# Checkpoint review — EDIT-4 — attempt 3 (diff-only)

Date: 2026-10-16. Reviewer: Sonnet (in-session subagent).

Scope: `apps/api/src/log-safety.ts`, `log-safety.test.ts`, `server.ts`; `app.ts` was read for the hook wiring.

Method:
- Ran the API tests: 53 pass.
- Timed hostile inputs against a scratch copy outside the repo, deleted afterwards.

## Verdict: PASS-WITH-NITS (0 High, 0 Medium, 3 Low, 2 Nit)

- **Medium A (stack scrub): fixed and tested.**
  - `file:` and `node:` frames survive.
  - The first line is scrubbed in full.
  - One level of `cause` is serialized.
- **Medium B (regex cost): fixed.** Every probed shape finished in ≤ 4 ms on 100k characters, across `safeErrorText`, `serializeError`, and `scrubLogArguments`. Shapes probed:
  - `a.`, `a-`, `ab.`, `a-a.`;
  - 100k `a` with no dots;
  - `a:`, runs of `/`, `a://`, `http://`;
  - `x.com:11111`;
  - 62- and 63-character labels, 10-label chains.
- **Slicing before scrubbing:** no partial URL with a secret is left at the cut.
- **The hook (C) and `server.ts` (D): no regression.**
  - Errors and Fastify's `req` and `res` pass through to their serializers.
  - The binding is preserved.

### Findings
1. **Low:** the case-insensitive `STACK_URL_IN_TEXT` lets `File://host/p?tok=…` and `FILE:///…` past the `(?!file:|node:)` lookahead.
2. **Low:** stack lines after the first get only the scheme pattern. A multi-line message's continuation line holding a scheme-less signed URL survived.
3. **Low:** the `{1,4096}` tail bound in the stack pattern lets the tail of a URL longer than 4096 characters survive.
4. **Nit:** no tests cover findings 1–3, and the timing test covers only the `a.` shape.
5. **Nit:** plain-object string members are cut to 1000 characters. This is acceptable and documented.

No new unresolved errors need an `ERRORS.md` entry.

## Disposition (2026-10-16)

All applied:
1. The stack pattern is case-sensitive and keeps only lowercase `file:///` and `node:`, so `File://` and `file://host` are scrubbed.
2. `scrubStack` scrubs every non-frame line (any line not starting `at `) with the full patterns.
3. The stack tail bound is the whole scan window (16000).
4. Two tests were added:
   - one covering a continuation line, `File://`, `file://host`, a 5000-character URL tail, and a kept `file:///` frame;
   - a timing test over six hostile shapes, under 500 ms.

The suite now has 54 tests; typecheck and lint are clean. Checkpoint review complete.
