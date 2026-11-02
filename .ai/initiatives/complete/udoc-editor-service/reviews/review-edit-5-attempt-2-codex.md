# EDIT-5 checkpoint review — attempt 2 (Codex)

- Date: 2026-10-18. Reviewer: codex (gpt-5.6-luna), `ai-review --uncommitted --no-artifact`, with the untracked binaries (`apps/plugin/icon.png`, `scripts/editor-battery/corpus/*.docx`) held out of the tree for the run (not UTF-8) and restored afterwards.
- **Verdict:** FAIL (one High, three Medium).

## Attempt-1 findings

All four confirmed fixed:

- H2: the bridge has timeout and late-answer handling, and `bridge.test.mjs` covers queue release and clone failures.
- M1: `X-Forwarded-Host` is dropped (`app.ts`), with an `auth.test.ts` case.
- M2: `startupProblems()` includes `pluginProblems()`, with a startup test.
- M3: no `any` remains; `globals.d.ts` declares the OnlyOffice API.

The reviewer could not start the plugin's Vitest run in its sandbox (`ENOENT` on Vitest's temporary directory), so it did not reproduce the plugin test result.

## High

- **`apps/api/src/config.ts:102-106`.** `TRUST_PROXY` still accepts IPv6 ranges that trust every IPv4 client, such as `::/32` and `::ffff:0:0/96`. Fastify matches IPv4 clients against them, so forwarded addresses can be forged past the limiter.

## Medium

- **`apps/api/src/routes/plugin.ts:35-37, 61-66`.** The startup check is `existsSync` only: a directory or an unreadable file passes. Route registration only logged a failed read.
- **`scripts/check-plugin-deps.mjs:33-34`.** `allowedUrl()` admits root-relative URLs (`/external.js`).
- **`apps/api/src/config.ts:91-95, 210-211`.** A malformed entry (`TRUST_PROXY=not-an-ip`) is not reported, and Fastify throws while building the app.

## Author's resolution (2026-10-18)

- **High and the malformed-entry Medium:**
  - `trustProxyProblem` compiles each entry with `@fastify/proxy-addr`, the function Fastify uses, now a direct dependency at Fastify's own version. A parse failure is a config problem.
  - An IPv6 range broader than /32 is refused.
  - Any entry that trusts addresses in more than one IPv4 /8 is refused. All 256 /8 blocks are probed through the compiled function, which is exact for "broader than /8".
  - That covers netmask forms and every IPv6 range over the IPv4-mapped space: `::/32` to `::/80`, `::ffff:0:0/96` to `/103`, and `::ffff:0.0.0.0/96`.
  - proxy-addr's named private ranges are accepted.
  - Tests cover accepted values, broad values and malformed values.
- **Plugin files:** `pluginProblems` requires each file to be a regular file this process can read (`statSync().isFile()` plus `accessSync(R_OK)`). Route registration now reads every file or fails the boot, with no warning-and-continue path. A startup test covers a directory and an unreadable file.
- **Root-relative URLs:**
  - A page URL must be a relative path that stays inside the plugin, with no `..` or leading `/`, or a path on `{{DS}}/`.
  - Imports must resolve inside the plugin directory.
  - Planted tests cover `/x.js`, `../up.js`, `{{DS}}.evil.com/…`, `{{DS}}@evil.com/…` and `./../outside.js`, together with Sonnet's attempt-2 N4 list.
