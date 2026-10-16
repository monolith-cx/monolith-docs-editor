# Plan review — udoc-editor-service — attempt 1

Date: 2026-10-16. Reviewer: Sonnet (in-session subagent). Scope: `plan.md` and `guidance.md` against parent UDOC-1, the code in this repo, the two legacy consumers, and the `standalone-app` re-scope. Read-only; `scripts/validate-ai-workspace.mjs` passed.

## Verdict: FAIL (3 High, 12 Medium, 8 Nit)

## High

- **H1. Callback JWT not bound to the body** (EDIT-2.4; `documents.ts:194-217`, `:182-188`). The handler verifies `req.body.token` and then trusts `req.body.key`/`status`/`url`; the algorithm and claims are not pinned. `GET /editor/:key` puts a config JWT signed with the same secret in the page HTML, so anyone with an editor URL can forge a callback with any `url` and `status`. Under the new design the service would sign that forgery for the consumer; today it feeds `transferToGcs`. Fix: take key/status/url from the verified payload (header and body-token forms), pin HS256, reject tokens carrying editor-config claims, require payload key = body key, require the `url` origin to be DocumentServer's, test with the editor-page token as a callback token, and log the defect in `ERRORS.md`.
- **H2. E4/E5 production validation breaks the live legacy consumer on deploy.** E5 refuses a production consumer lacking the new fields; the prod example registers `fastmail-connect` with only `allowedCallbackDomains: []`; `consumers.ts:108-110` throws at startup in production. Fix: require the new fields only for consumers that opt into profiles; test `validateConsumersConfig` over the prod example.
- **H3. E6 acknowledges most 4xx, which can lose the final save** (401 from rotation or skew, 403/404 from a WAF or mid-deploy, 400 from a bug) with no store to replay from. Contradicts D13/UDOC-1.2. Fix: acknowledge only an explicit consumer signal (409/410 with `key_closed`); `{error:1}` otherwise; consumer timeout below DocumentServer's callback timeout (measure); a reconcile path through DocumentServer's forgotten-files commands proven in EDIT-1.5; word the acceptance to the measured retry horizon.

## Medium

- **M1.** "Outside local development"/"staging" do not exist in code (only `NODE_ENV === 'production'`); the deployed dev editor runs `NODE_ENV=development`. Define strict-by-default with an explicit local opt-out.
- **M2.** Serving the plugin needs: an nginx/tunnel location (nginx `location /` proxies to DocumentServer), the `auth.ts:257-269` public-path allowlist, framing and CORS headers (`app.ts:57-59` sets `X-Frame-Options: SAMEORIGIN` off `/api`), a limiter exemption (`app.ts:33-37`, no `trustProxy`), and the Dockerfile (copies only `apps/api` and `packages/db`).
- **M3.** Sequencing inversion: EDIT-2.8 needs the panel docked right, which needs EDIT-5.1, while EDIT-5 depends on EDIT-2.
- **M4.** Fastify `maxParamLength` defaults to 100, so `/editor/:token` 404s for a large token; cap the token and test maximum sizes. nginx and Cloudflare access logs record `/editor/<token>`; EDIT-4 covers only app logs.
- **M5.** A stateless service cannot know the key's users for `drop` (the consumer supplies them); status 1 needs `actions` forwarded; forward statuses 3 and 7.
- **M6.** A 5-minute window does not stop replay inside the window: add a signed delivery id stable across retries and a consumer dedupe rule; add two-secret overlap for notification-secret rotation.
- **M7.** Conversion SSRF: `validateSourceUrl` is not exported, pattern-only (no DNS resolution, IPv6 ULA/mapped, 100.64/10, `metadata.google.internal`); `transferToGcs` skips it for `://api:`/`://onlyoffice`; redirects unspecified; DocumentServer fetches the source so the input cap mechanism is unstated; DocumentServer's cache keeps the output. Fix: a resolving validator with a pinned address and `redirect: 'manual'`, a `convertSourceHosts` allowlist, remove the substring exemption, verify DocumentServer's request filtering, state the cap mechanism, record cache retention in the ADR.
- **M8.** `fileUrl` at `open`: `resolveDownloadUrl` passes any http(s) URL and signs a bare `bucket/object` with the service's own GCS identity (any consumer can read any bucket the service account sees); legacy uploads return `http://api:3020/api/files/...`. Profile shapes take validated https signed URLs only; legacy shapes the service's own `/api/files/` prefix; state the fate of `transferToGcs`, `generateUploadUrl`, and the GCS dependency.
- **M9.** Pin profile↔mode pairs; cap the key at DocumentServer's 128 characters; the expired page's "consumer origin" has no registry field, and a tampered token has no consumer.
- **M10.** E1 makes "one release, then removed" open-ended without amending the parent; the parent handoff does not record the follow-up or the child; EDIT-0.1 marked Done though the handoff was not updated; the Word item `Blocked` conflicts with the parent's acceptance (needs an owner waiver); the estimate exceeds the parent's but is called "in line".
- **M11.** EDIT-4 misses URLs in error text (`storage.ts:79,84,93,97` → `documents.ts:148`); `app.ts` has no `redact` config; pino needs nested paths. Scrub error text, scan raw log output for `https?://`, purge existing production logs.
- **M12.** `config.ts` is not the only env reader (`consumers.ts:87,92,106`, `server.ts:27,31`, `files.ts:36-37`); say how `notificationSecretRef` resolves; fold the reads into `config.ts`.

## Nit

- N1 bind the key-id byte as AES-GCM AAD; cap the token. N2 working-tree `CLAUDE.md` names MiniMax (retired) and session-TTL rules; reconcile. N3 standalone-app: add an ordering note (close or re-baseline Phase 0 before the EDIT-2 deploy), update Track A items that reference removed routes, fix the registry blocker "Phase 1 stays blocked". N4 name a fallback for per-session plugin data. N5 drain sessions open at deploy. N6 validate a registered `callbackUrl` as https and non-private. N7 CSP with a nonce on the editor page; say what legacy `view` does with download/print. N8 changelog for the old routes; `files.ts` unchanged.

## Parent coverage

| Parent | Coverage |
|---|---|
| UDOC-1.1 | Partial (Word item vs acceptance) |
| UDOC-1.2 | Partial (E1, E6, H1, M5) |
| UDOC-1.3 | Pass (needs M7) |
| UDOC-1.4 | Pass (see M11) |
| UDOC-1.5 | Pass (see M2, M3) |
| UDOC-1.6 | Pass |
| UDOC-1.7 | Pass |

Line references in the draft were confirmed; the legacy-consumer claims were confirmed; scheduling EDIT-4 first was judged sound.

## Disposition (2026-10-16)

H1 confirmed by reading `documents.ts:176-217` (the page token and the callback token share `ONLYOFFICE_JWT_SECRET`; body fields are trusted) and logged in `ERRORS.md`. H2 confirmed (`prod/env.example:20`, `consumers.ts:106-110`). Every finding addressed in the revised plan and guidance; see attempt 2.
