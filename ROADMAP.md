# Monolith Docs Roadmap

High-level feature and delivery status lives here. Detailed execution state lives in the linked initiative docs under `.ai/`.

## Repo Split (2026-09-02)

This repo is now `monolith-docs-editor`, the AGPL OnlyOffice editing service. The Monolith Docs product (e-signature, customer app, Platform SSO, tRPC, Next.js) moved to the private `monolith-docs` repo under the `esignature-platform` initiative (parent ESIG in Platform). The Standalone App initiative was re-scoped on 2026-10-16 to its Phase 0 and archived on 2026-10-31: the restructure is done, its GCE parity gate is superseded, and the editor-service work it implied is the EDIT initiative (UDOC-1).

## Active

No initiative is active in this repo; the editor's follow-ups are tracked as issues outside it (DOC-6, -7, -8, -19, -20).

## Complete

### Editor Service for Unified Document Authoring (EDIT)

- Status: `completed` 2026-11-02 (UDOC-1, EDIT-1 to EDIT-7, accepted on editor-dev `editor-dev.monolith.cx`; close-out in the plan, reviewer Codex; licence: AGPL peer). History in the plan and handoff.
- Parent: ecosystem initiative `unified-document-authoring` (UDOC) in Monolith Platform, phase UDOC-1
- Summary: Latest OnlyOffice Community with a repeatable battery re-run, named editor profiles, stateless per-open sessions in sealed editor URLs, signed and retried consumer notifications, drop, PDF conversion, log redaction, a product-agnostic panel bridge plugin, hosting and capacity, licence posture. Existing consumers keep the legacy open shape until they migrate.
- Plan: `.ai/initiatives/complete/udoc-editor-service/plan.md`
- Guidance: `.ai/initiatives/complete/udoc-editor-service/guidance.md`

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
