# Checkpoint review — EDIT-5 — attempt 2 (Sonnet)

Date: 2026-10-18. Reviewer: Sonnet (in-session subagent, fresh context, read-only).

What the reviewer ran:

- Plugin: 26 tests, `tsc --checkJs`, the dependency check.
- API: 229 tests, typecheck, lint.
- Probes:
  - the five `callCommand` functions parse as ES5, with only `/** */` comments in their bodies;
  - `applySuggestion` against a fake with tracked deletions kept and dropped, in five placement cases;
  - the real `@fastify/proxy-addr` against `TRUST_PROXY` values;
  - the dependency check against a planted directory;
  - the validator on an empty `replace`.

It did not run the battery; it read the 2216 record and the item code.

**Verdict:** FAIL (one High, one Medium).

## Attempt-1 findings

- Fixed: H1, H2, M1, M2, M3, M4, M5, and Codex H2, M1, M2.
- M6 mostly fixed: the plan still said "13 plugin tests" (N6), and the `TRUST_PROXY` claim was not yet true (N2).
- Codex H1 partially fixed (N2).

Comment placement, with tracked deletions kept and dropped:

| Case | Result |
|---|---|
| `replace` also elsewhere in the paragraph | Correct |
| `replace === find` | Correct |
| `find` ⊃ `replace` | Correct |
| `replace` before the find | Correct |
| `replace` ⊃ `find` ("b" → "bb") | Kept: honest `commentPlaced: false` |

## New findings

### High

**N1. An empty `replace` with a comment loops forever.** `occurrences(text2, '')` never advances, inside DocumentServer's document sandbox, so it freezes the tab. The bridge's timeout cannot recover the editor. Empty `replace` was untested everywhere.

### Medium

**N2. `TRUST_PROXY` still admits "everyone".**

- `::ffff:0:0/96` and `::/32` to `::/80` cover every IPv4 client.
- The netmask form `0.0.0.0/128.0.0.0` passes.

Compile with proxy-addr and refuse what trusts public addresses.

### Low

- **N3.** A timed-out `failed` operation may still apply later; a retried insertion could duplicate. The guide should say to re-read first.
- **N4.** Dependency-check bypasses:
  - `./../..` escapes;
  - `{{DS}}.evil.com` and `{{DS}}@evil.com`;
  - `<base>`, meta refresh and CSS `@import`;
  - `.cjs`, `.mts`, `.cts` and `.jsx` files, and dotfiles;
  - a nested `package.json`;
  - any `*.test.js` file was exempt.
- **N5.** E5c asserts `ignored >= 1`, where the record shows exact counts. E5b does not check where the "second pair" comment landed. `onInserted` has an unused parameter.

### Nits

**N6.**

- The plan's test count is stale.
- The unit fake models only deletions that keep their text.
- `tracked-changes-on.docx` has no revisions.

## Author's resolution (2026-10-18)

- **N1:**
  - `occurrences` returns nothing for an empty needle, and `addComment` refuses an empty `find`.
  - An empty `replace` is a pure deletion: `AddText` is skipped, and the argument check refuses a comment with it (`invalid_args`).
  - If a comment reaches the command anyway, the answer is `commentPlaced: false`.
  - The guide and contract §6 say so: comment first with `addComment`, then delete.
  - The unit test runs under a 2 s limit.
  - E5b adds a pure deletion on the real editor and checks the saved paragraph holds one `w:del` of "keeps " and no `w:ins`, and that a comment on a deletion is `invalid_args`.
- **N2:** see Codex attempt 2. The value is compiled with proxy-addr; IPv6 below /32 is refused, and so is any entry covering more than one IPv4 /8 (probed through the compiled function), which catches the mapped ranges and the netmask. Tests cover every value listed. The plan wording is corrected.
- **N3:** one sentence in guide §7 and in contract §6: after `failed`, re-read with `getText` before retrying. The queue is not capped, because a panel sends one request per user action.
- **N4:**
  - Imports and page URLs must resolve inside the plugin directory.
  - A page URL is a plain relative path or `{{DS}}/<path>`.
  - `<base>`, meta refresh and CSS `@import` are refused.
  - Every script extension and every dotfile is checked; only the `.turbo` cache and `node_modules` are skipped.
  - Every `package.json` is checked.
  - Only top-level `*.test.mjs` files are exempt; the API never serves them, since it serves a fixed list of five files.
  - A planted test covers each case.
- **N5:**
  - E5c records the ignored count before forging and asserts exactly 2 more from the editor page and DocumentServer's frame, then exactly 1 more from the same-origin forger.
  - E5b checks the "second pair" comment's range reads "aa" after a paragraph text ending in exactly "aa".
  - The unused parameter is removed.

  Exact counting exposed something attempt 1 had wrong:

  - The same-origin forger never ran. It was framed by the service's editor page and never loaded (run 2257: no forger frame).
  - Its "positive control" in run 2216 was DocumentServer's own plugin traffic, which the bridge then counted as ignored.
  - So attempt 1's resolution, "E5c has a same-origin forger page and a positive control", was not true.

  Fixes:

  - `stats.ignored` now counts only protocol messages (`type` starting `udoc.`), with a unit test that DocumentServer-style traffic is not counted.
  - The panel page frames the forger: same origin as the panel, another window. It posts to the plugin frame and reports what it did.
  - E5c asserts exact deltas: 0 → 2 → 3, and still 3 at the end. Run 2302 passes.
- **Battery evidence for this attempt:**
  - Run 2242: S0–S2, E2a–E2e, E3a–E3b, E5a and E5d–E5f pass. E5b failed on a test bug: the pure deletion's `context` lacked `find`'s trailing space, and the request was rightly refused as `invalid_args`. E5c failed as described above.
  - Run 2257: E5a and E5b pass; E5c failed (no forger frame).
  - Run 2302: E5a–E5c pass.
  - Since 2242, `commands.js` is unchanged, and `bridge.js` changed only in what it counts.
- **N6:**
  - The plan now says 27 command tests and 38 plugin tests in all.
  - The fake gains a dropped-text mode, and the five placement cases run in both modes as unit tests.
  - The corpus file keeps its name. A comment in `corpus.mjs` says track changes are on and the body holds no revisions yet; E5b's second suggestion covers edits beside existing ones.
