# Checkpoint review — EDIT-5 — attempt 3 (Sonnet)

Date: 2026-10-18. Reviewer: Sonnet (in-session subagent, fresh context, read-only).

What the reviewer ran:

- Plugin: 38 tests, typecheck, the dependency check.
- API: 230 tests, typecheck, lint.
- `trustProxyProblem` through tsx:
  - refused `::/32`, `::/80`, `::ffff:0:0/96`, `/103`, `::ffff:0.0.0.0/96`, `0.0.0.0/128.0.0.0`, `10.0.0.0/7`, `fc00::/7`, and others;
  - accepted `172.18.0.0/16`, `loopback, uniquelocal`, `::ffff:0:0/104`, `2001:db8::/32`, and others;
  - reported malformed and non-contiguous masks.
- About 45 planted dependency-check cases.
- An ES5 and self-containment probe of the command functions.
- The battery records 2242 and 2302, read against the item code and the file timestamps.

**Verdict:** PASS-WITH-NITS. Every attempt-2 finding is fixed: N1–N6, plus Codex's High and three Mediums. No Critical, High, or Medium findings.

## Low

**L1. `check-plugin-deps.mjs` still missed some import forms.**

- A no-space import, `import"x"`, in `.js` and in inline module scripts.
- A `data-src` attribute, which hid an inline module script from the check (`\bsrc` matches after `-`).
- Lower priority:
  - `document.createElement('script')`;
  - `import/**/'x'`;
  - ``from`x` ``.

**L2. E5b's pure-deletion check asserted less than its evidence line claimed.**

- It did not count `w:del` elements.
- `lastIndexOf('<w:p')` can match `<w:pPr>`, so the paragraph slice could start mid-paragraph. The same applies to the "second pair" slice.

## Nits

- `bridge.test.mjs` waits a fixed 150 ms against a 50 ms timeout.
- The top-level `*.test.mjs` exemption is harmless, because the API serves only the five fixed files.

Found no new unresolved errors outside this checkpoint.

## Author's resolution (2026-10-18)

- **L1:**
  - Block comments are stripped before matching, and the bare import pattern is `^\s*import\s*['"]`.
  - `from` a template literal and a created `<script>` element are refused.
  - The inline-script lookahead is `\ssrc`, so `data-src` no longer hides a module script.
  - A planted test covers each case (`terse.js`, `inline.html` in `check-deps.test.mjs`).
- **L2:**
  - Paragraphs are located by `/<w:p[ >]/`, never `<w:pPr>`.
  - E5b asserts exactly one `w:del` (reading "keeps ") and no `w:ins` in the paragraph. The evidence line prints the count.
  - The "second pair" slice uses the same locator.
  - E5b was re-run on the real editor: `docs/spikes/results/10.0.0.1/2026-10-18-partial-2312.md` passes (one `w:del` reading "keeps ", no `w:ins` in its paragraph; the second-pair range reads "aa").
- **Nit 1:** the late-answer test now waits for both responses with `vi.waitFor` instead of a fixed sleep.
- **Nit 2:** left as is; the API serves a fixed list.
