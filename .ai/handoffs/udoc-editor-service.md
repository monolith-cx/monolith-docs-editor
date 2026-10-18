# Handoff — Editor Service for Unified Document Authoring (EDIT)

- **Updated:** 2026-10-17 23:45 PDT
- **Lane / status:** active / `active` (owner-approved 2026-10-16)
- **Parent:** Platform ecosystem initiative `unified-document-authoring` (UDOC), phase UDOC-1; EDIT-*n* implements UDOC-1.*n*
- **Plan:** `.ai/initiatives/active/udoc-editor-service/plan.md` · **Guidance:** `guidance.md` (local decisions E1–E8)

## Where things stand
- **EDIT-0 (charter):** done; committed `0158323`.
- **EDIT-4 (log redaction):** code-complete and reviewed; committed `9f54904`. Not deployed: no hosted editor exists since the 2026-06-12 decommission (`deploy-edit-4.md`; committed `28a27d9`).
- **EDIT-1 (OnlyOffice upgrade and battery):** built and run in full; checkpoint review attempt 1 FAIL, attempt 2 PASS-WITH-NITS with every finding applied (`reviews/review-edit-1-attempt-{1,2}.md`); uncommitted, awaiting Josh's commit approval.
  - Battery: `scripts/editor-battery/` (README there).
  - Results: `docs/spikes/results/10.0.0.1/2026-10-18.{md,json}`. 36 items: 24 pass, 4 pass with a finding (the loose lock), 7 recorded, 1 blocked, 0 fail.
  - ADR: `docs/adr/2026-10-17-onlyoffice-release-and-licence.md` (F1–F15).
  - `docker-compose.yml` pins `10.0.0.1@sha256:ca17889f…`.

## What EDIT-1 found (details in the ADR)
- **F1:** only the final save (status 2) is retried, and only on HTTP 429/5xx (4 attempts, 1/2/4 s). `{"error":1}` and 401 get no retry. Statuses 1, 4, and 6 get one attempt. Failed final saves wait in the forgotten-files store. E6 now answers 503; force-save notifications are best effort.
- **F2:** the save `url` changes on every retry, so `deliveryId` uses `key`, `status`, and `lastsave`.
- **F3:** URLs inside JWT-signed configs bypass DocumentServer's private-address filter (control proved it), so the service is the only SSRF gate.
- **F4, F5:** a server-side AI feature and ten built-in third-party plugins are on by default. EDIT-2.1 and EDIT-2.3 handle them.
- **F9:** with `contentLocked` a rep can remove a whole field with ordinary keystrokes. The value is never changed in part. `sdtContentLocked` refuses all of these.
- **F14:** release an edit lock only when `users` is empty or on status 4 / final 2. Statuses 3 and 7 were not measured.
- **F15:** about 2 minutes after start, DocumentServer restarts its own services (font generation), dropping open editors. Deploys must wait for that.

## Verification that ran
- Full battery on a fresh stack (above).
- API: 54 tests, typecheck, lint.
- `docker compose config`; `validate-ai-workspace`.
- `node --check` on every battery file.

## Blockers and open decisions (Josh)
- **D11 / F9:** Josh confirmed on 2026-10-17 that the loose lock stands.
- **U13:** no Word desktop is available (Josh has OnlyOffice desktop only). It stays blocked until Word is found (Word for the web as a stand-in, if Josh accepts it) or Josh waives it in writing.
- **Cloudflare (EDIT-4.2)** is still blocked (no API access).
- EDIT-6 is a from-scratch stand-up (no host exists).

## Errors
- No new unresolved errors were found in EDIT-1.
- The `ERRORS.md` residual for DocumentServer's own logs gained a 2026-10-17 update with 10.0's behaviour (F6).

## Next step
EDIT-2 (profiles, stateless sessions, signed notifications, drop, the editor page), with UDOC-2.1's contract drafted alongside. U13 stays open on Word. Then EDIT-2 (profiles, sessions, notifications) with UDOC-2.1's contract drafted alongside.

## Follow-ups noted
- `CLAUDE.md`'s reviewer lines carry another session's uncommitted edit that still names MiniMax (retired). Reconcile them with `.ai/iddp/config.json` when that edit is resolved.

## Commit state
- Committed on `main`, not pushed: `0158323`, `9f54904`, `28a27d9`.
- EDIT-1 is uncommitted:
  - battery, results, ADR, spike document;
  - compose pin, stack lines, workspace and lockfile;
  - plan, guidance, handoff, registry, ROADMAP;
  - `ERRORS.md` note.
- Older sessions' uncommitted work stays out:
  - `.ai/handoffs/standalone-app.md`, `.ai/iddp/config.json`, the standalone-app plan;
  - `deploy-pipeline-parity/*`, `.gitignore`, `infrastructure/gce/teardown.sh`;
  - `CLAUDE.md`'s reviewer lines and the other hunks of `.ai/registry.yml`.
