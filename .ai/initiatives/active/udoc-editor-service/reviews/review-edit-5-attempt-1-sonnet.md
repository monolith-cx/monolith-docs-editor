# Checkpoint review — EDIT-5 — attempt 1 (Sonnet)

Date: 2026-10-18. Reviewer: Sonnet (in-session subagent, fresh context, read-only).

What the reviewer ran:

- Plugin: 13 tests, typecheck, and the dependency check.
- API: 225 tests, typecheck, and lint.
- Probes:
  - the `callCommand` functions are ES5 with no free variables other than `Api` and `Asc` (ESLint `no-undef` at `ecmaVersion` 5);
  - the validators, the comment placement, and the Search-count check, against fakes;
  - `trustProxy` on a bare Fastify instance;
  - the dependency check against a planted directory.

**Verdict:** FAIL (two High findings).

## High

**H1. `applySuggestion` could put its comment on the deleted text, or skip it silently.**

- When `find` contains `replace` ("beta gamma" → "beta"), the first occurrence of `replace` at or after the anchor is inside the tracked deletion.
- When no match was found, the comment was dropped and the answer was still `ok`.
- The test fake made the same assumption as the code, so it could not catch this.

**H2. One unanswered `callCommand` or `executeMethod` wedged the queue forever.** Related gaps:

- `getText` returning `undefined` counted as a success;
- a `DataCloneError` in `post` meant the request got no response;
- the doc claim "every request gets one response" was therefore untrue.

## Medium

- **M1. `trustProxy` let `X-Forwarded-Host` choose `req.hostname`.** That bypasses the consumer hostname binding: neither nginx nor the tunnel sets the header. One hop count also cannot fit both the nginx path and the tunnel path.
- **M2. `insertField` accepted a missing or non-string `rowId`.** `String(undefined)` matches the pattern.
- **M3. The signer-tag rule was missing on some text.** `label`, `comment.text`, `comment.author`, and `author` were not checked.
- **M4. Occurrences were counted with overlap.** `Search` probably counts without overlap.
- **M5. Track changes stayed on if the edit threw.**
- **M6. Doc claims went further than the evidence:**
  - undo was proven only for `applySuggestion`;
  - comment placement was not verified;
  - ADR F18's "lost on close" was inferred, not measured;
  - the guide's argument rules overstated the checks;
  - E7 still said TypeScript.

## Nits

- The rate-limit `allowList` was not limited to GET.
- Legacy consumers' origins could reach the CSP header unvalidated.
- `TRUST_PROXY` lists such as `10.0.0.1,0.0.0.0/0` were accepted, and hop counts were unbounded.
- The scope copied unknown keys.
- The forbidden-character regex had literal U+FFFE/U+FFFF characters, admitted lone surrogates and CR, and used a `//` comment inside a `callCommand` body.
- The dependency check could be bypassed by:
  - dynamic `import()` with a template literal or a variable;
  - `importScripts`, `new Worker`, `<link rel=modulepreload>`, `<iframe src>`;
  - an inline `import` in a module script, an unquoted `src`;
  - files in subdirectories;
  - optional or peer dependencies.
- E2a passed without a Plugins tab.
- E5c had no positive control and no same-origin, wrong-window case.
- `plugin.test.ts` had gaps:
  - prototype names, non-GET methods;
  - the CSP shape, and nonce freshness.
- A missing plugin file only warned.
- The tracked-changes corpus file had no revisions.

## Author's resolution (2026-10-18)

### H1

- The insertion point is computed from the paragraph's length change: if the tracked deletion kept its text, the insertion follows it; otherwise it sits at the anchor.
- The point is then confirmed with `substr` and matched to `Search` by index.
- The answer is `{ commentPlaced: true|false }`, never a bare `ok` with a guessed place.
- Tests:
  - a unit test for "beta gamma" → "beta";
  - E5b on the real editor checks that both comment ranges in the saved file enclose the `w:ins` and no `w:del`, including "Token check" → "Token".

### H2

- Each operation is settled once, by DocumentServer's answer or a 30 s timeout. The queue moves on and a late answer is ignored.
- `getText` needs a `body` array.
- `post` answers `failed` when a result cannot be cloned.
- 7 behaviour tests cover this. The guide says "every well-formed request".

### Mediums

- **M1:** an early hook drops `X-Forwarded-Host`; the test fails without it. The env examples recommend proxy addresses or CIDRs and explain the hop difference.
- **M2:** `rowId` must be a string (test).
- **M3:** every text field is checked for the signer tag and forbidden characters (tests). The guide names the fields and the caps, and records the cross-boundary residual.
- **M4:** occurrences are counted without overlap. E5b proves `Search` does the same on the real editor ("aaaa", second "aa").
- **M5:** `finally` restores track changes (test).
- **M6:** E5d also proves one undo removes an inserted field. Comment placement is verified (H1). ADR F18 says "inferred from F11, not measured" and records the measured `Search` and tracked-deletion facts. The guide's rules are precise. E7 is amended.

### Nits

All applied, except the corpus file with existing revisions:

- `allowList` is GET-only.
- Origins pass through `isOrigin` before reaching a header.
- `TRUST_PROXY` list entries are checked and hop counts are capped.
- The scope comes from per-operation keys (`scopeFor`, tested).
- The forbidden characters cover escapes, lone surrogates, and CR (single-line fields); no `//` comments remain in command bodies.
- The dependency check catches each bypass listed (a planted test).
- E2a requires the Plugins tab.
- E5c has a same-origin forger page and a positive control (`window.udocBridgeStats.ignored`).
- `plugin.test.ts` gains prototype names, POST, the CSP shape, a nonce per response, and filtering of bad consumer origins.
- A missing plugin file is a startup problem.

The corpus file with existing revisions is not added. Suggestions next to existing tracked changes are covered by E5b, which applies a second suggestion into a document that already has tracked changes from the first.

Verification: plugin 26 tests, API 229, typecheck, lint, and the dependency check are clean. Battery E2a and E5b–E5d pass on the real editor.
