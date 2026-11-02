# Review — EDIT-2.9 editor-page framing (attempt 1, Sonnet)

- **Date:** 2026-11-02
- **Reviewer:** Sonnet, in-session subagent, read-only
- **Branch:** `feat/edit-2-9-frame-ancestors` against `origin/main` (`e84603b`)
- **Scope:** `frame-ancestors` on the editor and expired pages from the session's own consumer (`origins.ts`, `editor-page.ts`, `routes/documents.ts`, `routes/plugin.ts`, `app.ts`), tests, the consumer guide, the battery stub's `/frame` page and item S3, the plan's 2.9.b finding
- **Verdict:** **PASS-WITH-NITS.** No Critical or High findings.

## Verified by the reviewer

- 241 API tests in 18 files, typecheck, lint, and the workspace validator clean.
- The editor page reads only `findConsumerById(session.c)`; the plugin route still unions every consumer (the old expression, deduplicated).
- `openSession` names a consumer only for an expired token, after the HMAC check, so a tampered, malformed, or unknown-key token never does; a removed consumer gets `'none'` and no link.
- The `onSend` hook sets neither CSP nor `X-Frame-Options` on `/editor/`; nothing overwrites the route's CSP.
- The stub's `/frame` page admits only the service's editor prefix plus a token-shaped tail.

## Findings and what was done

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | Medium | `isOrigin` accepted hosts with `;`, `,`, `'`, and `*` (`https://a.com;script-src` is its own origin to the URL parser), which could add a directive or a wildcard to `frame-ancestors`; only a consumer's own config could supply one, and load validation did not refuse it | `isOrigin` also checks the shape (DNS labels or a bracketed IPv6 address, optional port); `consumers.ts`'s `isWebOrigin` uses it, so such an origin is refused at load; tests for all four characters in `origins.test.ts` and `consumers.test.ts` |
| 2 | Low | The unreadable-token route test asserted no status | 410 asserted for the tampered and malformed tokens |
| 3 | Low | S3's expected header was a literal | Built from `STUB_A` and `STUB_B`, with the compose registration named |
| 4 | Nit | `frameOrigins`' comment did not say the plugin unions every consumer | Said |
| 5 | Nit | The guide's cross-reference named no section | "section 3, Framing"; a changelog entry added |

After the fixes: 242 API tests, typecheck and lint clean; battery `2026-11-02-partial-0155` (S1, S3) passes on the pinned release.
