# Monolith Docs Roadmap

High-level feature and delivery status lives here. Detailed execution state lives in the linked initiative docs under `.ai/`.

## Repo Split (2026-09-02)

This repo is now `monolith-docs-editor`, the AGPL OnlyOffice editing service. The Monolith Docs product (e-signature, customer app, Platform SSO, tRPC, Next.js) moved to the private `monolith-docs` repo under the `esignature-platform` initiative (parent ESIG in Platform). The Standalone App initiative below was re-scoped on 2026-10-16: Phase 0 (workspace restructure and headless parity) stays here; Phases 1 through 7 are superseded by the new repo, and the editor-service work they implied is now the EDIT initiative (UDOC-1).

## Active

### Editor Service for Unified Document Authoring (EDIT)

- Status: `active` (approved 2026-10-16; EDIT-4 log redaction code-complete and checkpoint-reviewed 2026-10-16; no hosted editor exists since the 2026-06-12 decommission, so it ships with the EDIT-6 stand-up; EDIT-1, the OnlyOffice 10.0.0.1 upgrade and repeatable battery, done 2026-10-18, Word round trip waived; EDIT-2, profiles, stateless sealed sessions, signed notifications, drop, and the editor page, code-complete and checkpoint-reviewed 2026-10-18, not deployed; EDIT-3, PDF conversion, code-complete and checkpoint-reviewed 2026-10-18 (found ADR F17, mitigated), not deployed; next: EDIT-5)
- Parent: ecosystem initiative `unified-document-authoring` (UDOC) in Monolith Platform, phase UDOC-1
- Summary: Latest OnlyOffice Community with a repeatable battery re-run, named editor profiles, stateless per-open sessions in sealed editor URLs, signed and retried consumer notifications, drop, PDF conversion, log redaction, a product-agnostic panel bridge plugin, hosting and capacity, licence posture. Existing consumers keep the legacy open shape until they migrate.
- Plan: `.ai/initiatives/active/udoc-editor-service/plan.md`
- Guidance: `.ai/initiatives/active/udoc-editor-service/guidance.md`

### Standalone App (re-scoped 2026-10-16: Phase 0 only)

- Status: `in_progress`
- Summary: Re-scoped to Phase 0 (workspace restructure and headless parity), which is locally code-complete with its `fastmail-connect` verification gate still open. Phases 1–7 (standalone product surface) are superseded: the product moved to the private `monolith-docs` repo, and the editor-service work UDOC needs is in Editor Service for Unified Document Authoring below. SA-1.6 (`hostnameGuard`) and SA-1.7 (editor-page `frame-ancestors`) are candidate follow-ups. The owner (2026-10-16) keeps it active for Phase 0 and archives it once Phase 0 closes.
- Plan: `.ai/initiatives/active/standalone-app/plan.md`
- Guidance: `.ai/initiatives/active/standalone-app/guidance.md`

## Complete

### Production Hardening

- Status: `completed` (2026-04-18)
- Summary: Security hardening, multi-consumer architecture, Cloudflare Tunnel infrastructure, and integration verification all landed and running in production. CRM and Connect round-trip documents live.
- Plan: `.ai/initiatives/complete/production-hardening/plan.md`
- Guidance: `.ai/initiatives/complete/production-hardening/guidance.md`

## Planning

### Deploy Pipeline Parity

- Status: `planning`
- Summary: CI baseline, protected `main`/`dev`, automated GCE deploys, rollback, and dev-environment parity for the standalone-era Docs stack using ecosystem DPP conventions adapted to OnlyOffice on GCE.
- Plan: `.ai/initiatives/planning/deploy-pipeline-parity/plan.md`
- Guidance: `.ai/initiatives/planning/deploy-pipeline-parity/guidance.md`

## Archive

### Monolith Docs Foundation And Integration

- Status: `archived`
- Summary: Original umbrella initiative. Phases 1-4 landed the API scaffold, OnlyOffice integration, GCS support, and hosted deployment scripts. Remaining follow-on work moved into dedicated initiatives.
- Plan: `.ai/initiatives/archive/monolith-docs/plan.md`
- Guidance: `.ai/initiatives/archive/monolith-docs/guidance.md`
- Follow-on initiatives:
  - `production-hardening`
  - `standalone-app`
