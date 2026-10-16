# Handoff — Editor Service for Unified Document Authoring (EDIT)

- **Updated:** 2026-10-16 12:40 PDT
- **Lane / status:** active / `active` (owner-approved 2026-10-16)
- **Parent:** Platform ecosystem initiative `unified-document-authoring` (UDOC), phase UDOC-1; EDIT-*n* implements UDOC-1.*n*
- **Plan:** `.ai/initiatives/active/udoc-editor-service/plan.md` · **Guidance:** `guidance.md` (local decisions E1–E8)

## What just happened
- EDIT-0 (the charter) is done:
  - plan review passed with nits;
  - Josh approved the plan and parent amendments A1–A5;
  - committed as `0158323`.
- **EDIT-4 (log redaction, UDOC-1.4) is code-complete and checkpoint-reviewed.**
  - Review attempts 1–3: FAIL, then PASS-WITH-NITS, then PASS-WITH-NITS (diff-only). Every finding was applied (`reviews/review-edit-4-attempt-{1,2,3}.md`).
  - `apps/api/src/log-safety.ts` (new) has five layers:
    - call sites log hosts and fingerprints (`hostOf`, `keyRef`);
    - error text passes through `safeErrorText`;
    - pino redacts URL-bearing fields, and an `err` serializer keeps only the type, the scrubbed message and stack, codes, and one level of cause;
    - the request serializer logs an allowlisted or masked path;
    - a `logMethod` hook scrubs every string argument and the string members of plain-object arguments.
  - Call sites changed:
    - `app.ts`: logger config, plus a `logStream` option for tests;
    - `routes/documents.ts`;
    - `routes/files.ts`: the upload id and file name are no longer logged;
    - `auth.ts`;
    - `storage.ts`: no URL in error text;
    - `server.ts`.
  - `infrastructure/nginx/monolith-docs.conf`: an allowlist `map`, a masked `log_format` with no query string and no Referer, and an explicit `error_log`.

## Verification that ran
- `pnpm --filter @monolith-docs/api run test`: 54 pass. `log-safety.test.ts` scans raw log output for:
  - an open failure, a successful save, a callback failure, and a callback error;
  - an upload plus the file fetch;
  - an auth failure;
  - an unhandled 500;
  - format arguments and redaction;
  - timing on hostile input.
- Typecheck, lint, `docker compose config`, and `validate-ai-workspace` are clean.
- nginx:
  - `nginx -t` passed in `nginx:1.27-alpine`;
  - a live run with 15 probes left 0 secrets in the access log;
  - the error log kept raw request lines (a recorded residual).
- The DocumentServer 8.3 image's log configuration was inspected.
- `pnpm install --frozen-lockfile` was run here, because `node_modules` was missing. No tracked file changed.

## Blockers and open items
- **EDIT-4 is not deployed.** The deploy and the EDIT-4.3 log purge are owner-approved actions. The purge covers the API container logs, the host nginx logs, and DocumentServer's `onlyoffice-log` volume.
- **Cloudflare (EDIT-4.2) is blocked.** There is no Cloudflare API access in this session, so request logging (Logpush) on the `monolithdocs.com` zone is unchecked.
- EDIT-6 needs an editor host for `crm-dev` and a stub receiver (A4).
- The Word desktop item (EDIT-1.5) needs a machine with Word, or Josh's written waiver.
- `standalone-app` Phase 0 must close, or be re-baselined, before EDIT-2 deploys.

## Errors
- **New unresolved errors found in EDIT-4**, logged in `ERRORS.md` (2026-10-16 12:11):
  - nginx's error log keeps raw request lines;
  - DocumentServer's own logs (the `onlyoffice-log` volume) carry `DOCID` and request lines.

  Both are residuals, mitigated by the purge and by EDIT-2.
- **Now `[x]` with `Resolved:` notes** (fixed in code, marked not yet deployed): the logged callback `url` at `documents.ts:213`, and the logged URLs at `:148`/`:262`/`:266`.
- **Still open, fixed at EDIT-2:** the 09:20 entries (forgeable callback, file-URL trust), the unsigned notification, and the editor page.

## Next step
EDIT-1 (UDOC-1.1):
1. Commit the spike document.
2. Rebuild the battery as `scripts/editor-battery/`.
3. Pin the newest Community DocumentServer.
4. Run the battery and the unproven items, including DocumentServer's log configuration.
5. Write the ADR.

Check `~/bin/heavy` first. The 8.3, 9.4.0.1, and 10.0.0.1 images are already pulled locally.

## Files
- `scripts/` (new `editor-battery/`)
- `docker-compose.yml`
- `docs/spikes/`
- `docs/adr/`
- the Stack line in `CLAUDE.md`

## Commit state
- The charter is `0158323` on `main`, not pushed. EDIT-4 is uncommitted and awaiting Josh's approval.
- The working tree also holds older sessions' uncommitted changes. Leave them out:
  - `.ai/handoffs/standalone-app.md`, `.ai/iddp/config.json`, `.ai/initiatives/active/standalone-app/plan.md`;
  - `deploy-pipeline-parity/*`;
  - their hunks in `.ai/registry.yml` and `ERRORS.md` (the coordinating session's four UDOC entries);
  - `.gitignore`, `CLAUDE.md`, `infrastructure/gce/teardown.sh`.
- The spike document is committed at EDIT-1.1.
