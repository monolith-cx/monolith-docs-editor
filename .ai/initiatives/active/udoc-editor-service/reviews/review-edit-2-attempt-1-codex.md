# EDIT-2 checkpoint review — attempt 1 (Codex, substituting for DeepSeek)

- Date: 2026-10-18
- Reviewer: codex (gpt-5.6-luna) via `ai-review --provider codex --uncommitted --no-artifact`. DeepSeek, the configured second reviewer (E8), could not run: 1Password was not signed in on the host, so `ai-review` could not read its key; Codex is the configured backup.
- Scope: EDIT-2's uncommitted files (other sessions' files excluded by instruction).

**Verdict:** FAIL

## Critical issues

- None identified.

## High issues

- **DNS pinning is not applied to document URLs.** `POST /api/documents/open` calls `checkUrl()` but discards the returned resolved addresses, then seals the original hostname into the session at `apps/api/src/routes/documents.ts:146-165`. DocumentServer later fetches that hostname directly, allowing DNS rebinding after validation and undermining the EDIT-2.2 SSRF guarantee. Fix by making the DocumentServer fetch use the validated address/pinned transport, or proxy the fetch through a pinned service-side fetcher.

- **Strict startup behavior lacks coverage for missing notification secrets.** `consumerProblems()` enforces the secret at `apps/api/src/consumers.ts:165-179`, but tests do not verify that a profile-capable consumer with an unset `notificationSecretRef` causes startup refusal. This is explicitly required by EDIT-2.1/E4/E5. Add a test covering the startup validation path.

## Medium issues

- **Configuration accepts invalid numeric values.** `maxSessionMs` and `notifyTimeoutMs` accept `NaN`, zero, or negative values at `apps/api/src/config.ts:109-111`; `configProblems()` does not reject them at `apps/api/src/config.ts:122-143`. This can immediately expire sessions or create invalid timeout behavior. Validate finite positive values and enforce sensible bounds.

- **Notifications may include `downloadUrl` for non-save statuses.** `apps/api/src/routes/documents.ts:250` rewrites any callback URL, and `apps/api/src/notify.ts:50-63` includes it regardless of status. EDIT-2.4 specifies download URLs for statuses 2 and 6 only. Gate URL forwarding on `cb.status === 2 || cb.status === 6`.

- **The guide overstates drop revocation.** It says sealed tokens “cannot be revoked except by key drop or expiry” at `docs/guides/consumer-integration.md:95-98`, but `drop` only sends a DocumentServer command and does not invalidate the stateless token (`apps/api/src/routes/documents.ts:282-293`). Clarify that drop closes the current DocumentServer session but does not revoke an already-issued bearer URL.

- **The required load-time callback URL resolution warning is absent.** EDIT-2.1 requires callback URL resolution to be checked/warned at registration/load, while `apps/api/src/consumers.ts:113-124` validates only syntax/protocol and performs resolution only during delivery. Either implement the warning or explicitly document the deviation.

## Nits

- The `consumers.test.ts` hostname test only checks that `findConsumersByHostname` is a function rather than testing its filtering behavior (`apps/api/src/consumers.test.ts:64-72`).
- The API test suite could not be executed in this environment because Vitest attempted to write `.vite-temp` files and hit `EROFS`; typecheck and lint passed.

## Doc-sync recommendations

- Sync the parent Platform contract draft referenced by EDIT-2.7: `docs/ecosystem/contracts-draft/document-editing.md`, especially URL pinning, notification status payloads, and drop semantics.
- Update `docs/guides/consumer-integration.md` after resolving the token-revocation and status-specific `downloadUrl` behavior.
- Keep the deliberately deferred plan/registry/handoff sync unchanged for this review, per the requested scope.
