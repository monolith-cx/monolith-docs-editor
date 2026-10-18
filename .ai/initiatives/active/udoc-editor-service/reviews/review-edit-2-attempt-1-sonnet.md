# Checkpoint review — EDIT-2 — attempt 1 (Sonnet)

Date: 2026-10-18. Reviewer: Sonnet (in-session subagent, fresh context). Read-only. It ran the API tests (13 files, 140 passed), typecheck (clean), and lint (clean), and probed `isBlockedAddress` / `checkUrl` with `tsx` from the scratchpad.

**Verdict:** FAIL. No Critical findings; the service code is sound. Three High findings (two guide/contract disagreements, one fake-success path), each small.

## Plan adherence (summary)

Met:

- 2.1: AI off; env reads folded into `config.ts`; `EDITOR_ENV` strictness; the registry fields.
- 2.2: in part; see M1 and M3.
- 2.3: profiles, key format, the sealed token, the GCS removal.
- 2.4: callback verification, signing, `deliveryId`, 503 semantics.
- 2.5: drop; see M8.
- 2.6: the editor page.
- 2.7: the reference verifier.
- 2.8: every real-editor and unit acceptance item, by the cited tests and battery items S1, S2, E2a–E2e, U9.

Not met:

- 2.1: the `callbackUrl` load-time resolution warning (M6).
- 2.7: the guide and contract disagree (H1, H2, M9).

Deferred, agreed:

- The dev secrets in 1Password and Secret Manager. No dev environment exists; record this as an explicit EDIT-6 stand-up item.

## High

**H1. The `downloadUrl` host rule is missing from the guide.**

- The guide omits it.
- The contract (§4.3) and the ERRORS.md Resolved note for the unsigned notification both claim the guide states it.
- Fix:
  - Add the rule to the guide: fetch `downloadUrl` only from the configured DocumentServer origin, which is `ONLYOFFICE_PUBLIC_URL`.
  - Apply the same rule to the forgotten-files `downloadUrl`.
  - Add "check the key is the document's current key".

**H2. The guide overstates the lock.**

- The guide says fields "can be filled but not deleted or re-configured". F9 and F16 show a field can be deleted, or unwrapped to plain text.
- Fix:
  - Rewrite the guide to say this.
  - Require D16 validation and per-save reporting of missing rows.
  - Add F16 to contract §8 and §9.

**H3. Forgotten files answer `none` when DocumentServer is failing (a fake success).**

- `GET .../forgotten` answers `{none:true}` for every DocumentServer error code, including 3, 5, and 6.
- `DELETE` answers 200 for a non-ok code.
- Fix:
  - Answer `none` only for error 1.
  - Answer 502 with the named error otherwise.
  - Add tests.

## Medium

- **M1.** `isBlockedAddress` allows several address forms:
  - `::ffff:0:a.b.c.d`;
  - 6to4 `2002::/16` embedding a private v4;
  - `64:ff9b:1::/48`;
  - `fec0::/10`, `2001::/32`, `100::/64`;
  - `192.88.99.0/24`.

  Unwrap the embedded v4 and block these, with test cases.
- **M2.** The "AI off" evidence shows the file is mounted, not that DocumentServer honours it. Add an effective-configuration assertion.
- **M3.** DNS rebinding of the DocumentServer-fetched `fileUrl` is unrecorded. It is bounded for profile consumers by `fileHosts`, and unbounded for legacy consumers. Record it or mitigate it.
- **M4.** Strict-mode wiring has no route-level test, and the battery runs only under `local`. The tests do not prove that:
  - an unsigned callback is refused with 403 in strict mode;
  - a private-address `fileUrl` is refused through the route.

  Separately, `notify.test` "private callback" only proves `scheme`.
- **M5.** Notification secrets:
  - no strength check;
  - the missing-secret startup check is untested;
  - duplicate `notificationSecretRef`s are accepted.
- **M6.** The `callbackUrl` load-time resolution warning (EDIT-2.1) is missing.
- **M7.** The legacy shape bypasses `fileHosts` for profile-capable consumers. Such a consumer's legacy keys also get notifications, contrary to the guide. Refuse the legacy shape for consumers with `profiles`. S2 should exercise the real `/api/files/upload` → internal `fileUrl` flow.
- **M8.** Drop maps every non-0, non-1 code to 409. Answer 404 for 1, 502 for 3 and 6, and 409 for 2, 4, and 5. Update the guide and add tests.
- **M9.** The guide and contract list `api-key` without saying it is refused outside `local`.
- **M10.** The saved battery results do not match the current E2a and U9 code. The ADR's F16 numbers cite a run with no saved record. Commit a current run's results.

## Nits

- `maxParamLength` should move to `routerOptions` (FSTDEP022).
- A `sealSession` misconfiguration answers `400 session_too_large`; it should be a 500.
- `onBase` turns a `//` pathname into a scheme-relative URL.
- A missing `lastsave` collapses `deliveryId`.
- The "maximum-size" token test is below `MAX_TOKEN_CHARS`.
- The `env.example` test covers prod only.
- The guide's §2 refusal list is incomplete.
- The guide should say the HMAC key is the secret's text (UTF-8).
- `.env.example` is stale.
- `CLAUDE.md:31` and `AGENTS.md:9` still say storage is GCS.
- `SAFE_PATHS` still lists `/api/sessions`.
- The editor page has no `frame-ancestors` (SA-1.7). Note it in the guide.
- Legacy `fileName: ""` is now refused.

## Security notes verified by the reviewer

- **Sealing:** AES-256-GCM, a random nonce, version and key id as AAD; fails closed.
- **Callback JWT:** HS256 pinned; a header token that fails verification does not fall through to the body token; body fields are compared with the claims.
- **Authorization:** drop and forgotten files check key ownership.
- **Signing:** HMAC over `timestamp.body` as sent; the verifier compares in constant time.
- **Logs:** no token, URL, or secret appears in a log line.
- **Dependencies:** the only addition is `undici`.
- **Pinned fetch:** `safeFetch` pins the addresses and returns redirects without following them.
