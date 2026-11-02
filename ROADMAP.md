# Monolith Docs Roadmap

High-level feature and delivery status lives here. Detailed execution state lives in the linked initiative docs under `.ai/`.

## Repo Split (2026-09-02)

This repo is now `monolith-docs-editor`, the AGPL OnlyOffice editing service. The Monolith Docs product (e-signature, customer app, Platform SSO, tRPC, Next.js) moved to the private `monolith-docs` repo under the `esignature-platform` initiative (parent ESIG in Platform). The Standalone App initiative was re-scoped on 2026-10-16 to its Phase 0 and archived on 2026-10-31: the restructure is done, its GCE parity gate is superseded, and the editor-service work it implied is the EDIT initiative (UDOC-1).

## Active

### Editor Service for Unified Document Authoring (EDIT)

- Status: `active` (approved 2026-10-16; EDIT-4 log redaction code-complete and checkpoint-reviewed 2026-10-16; no hosted editor exists since the 2026-06-12 decommission, so it ships with the EDIT-6 stand-up; EDIT-1, the OnlyOffice 10.0.0.1 upgrade and repeatable battery, done 2026-10-18, Word round trip waived; EDIT-2, profiles, stateless sealed sessions, signed notifications, drop, and the editor page, code-complete and checkpoint-reviewed 2026-10-18, not deployed; EDIT-3, PDF conversion, code-complete and checkpoint-reviewed 2026-10-18 (found ADR F17, mitigated), not deployed; EDIT-5, the panel bridge plugin, code-complete and checkpoint-reviewed 2026-10-18 (ADR F18), not deployed; EDIT-6 hosting decided 2026-10-18 (the OVH VPS, `editor-dev.monolith.cx`), its local half (DocumentServer settings, the converter watchdog, capacity, the VPS fragment) code-complete and reviewed; EDIT-6.6, the dev stand-up at `editor-dev.monolith.cx`, done 2026-11-02; EDIT-2.9, editor-page `frame-ancestors`, code-complete and reviewed 2026-11-02; next: its image, then EDIT-6.7 acceptance)
- Parent: ecosystem initiative `unified-document-authoring` (UDOC) in Monolith Platform, phase UDOC-1
- Summary: Latest OnlyOffice Community with a repeatable battery re-run, named editor profiles, stateless per-open sessions in sealed editor URLs, signed and retried consumer notifications, drop, PDF conversion, log redaction, a product-agnostic panel bridge plugin, hosting and capacity, licence posture. Existing consumers keep the legacy open shape until they migrate.
- Plan: `.ai/initiatives/active/udoc-editor-service/plan.md`
- Guidance: `.ai/initiatives/active/udoc-editor-service/guidance.md`

## Complete

### Production Hardening

- Status: `completed` (2026-04-18)
- Summary: Security hardening, multi-consumer architecture, Cloudflare Tunnel infrastructure, and integration verification all landed and running in production. CRM and Connect round-trip documents live.
- Plan: `.ai/initiatives/complete/production-hardening/plan.md`
- Guidance: `.ai/initiatives/complete/production-hardening/guidance.md`

## Archive

### Standalone App

- Status: `archived` (2026-10-31)
- Summary: Re-scoped 2026-10-16 to Phase 0 (the pnpm + Turbo workspace restructure), which is done; its GCE parity gate was superseded when the hosts were deleted and EDIT changed the API. Placeholders removed; SA-1.7 moved to EDIT-2.9; SA-1.6 dropped.
- Plan: `.ai/initiatives/archive/standalone-app/plan.md`

### Deploy Pipeline Parity

- Status: `archived` (2026-10-31), never started
- Summary: Targeted the retired GCE stack. CI, the protected `main`, the image build (EGM), and the box's deploy script (Platform FEX-4.1) cover it; automated editor deploys are an EDIT follow-up.
- Plan: `.ai/initiatives/archive/deploy-pipeline-parity/plan.md`

### Monolith Docs Foundation And Integration

- Status: `archived`
- Summary: Original umbrella initiative. Phases 1-4 landed the API scaffold, OnlyOffice integration, GCS support, and hosted deployment scripts. Remaining follow-on work moved into dedicated initiatives.
- Plan: `.ai/initiatives/archive/monolith-docs/plan.md`
- Guidance: `.ai/initiatives/archive/monolith-docs/guidance.md`
- Follow-on initiatives:
  - `production-hardening`
  - `standalone-app`
