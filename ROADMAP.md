# Monolith Docs Roadmap

High-level feature and delivery status lives here. Detailed execution state lives in the linked initiative docs under `.ai/`.

## Repo Split (2026-09-02)

This repo is now `monolith-docs-editor`, the AGPL OnlyOffice editing service. The Monolith Docs product (e-signature, customer app, Platform SSO, tRPC, Next.js) moved to the private `monolith-docs` repo under the `esignature-platform` initiative (parent ESIG in Platform). The Standalone App initiative below needs re-scoping: Phase 0 (workspace restructure and headless parity) stays here; Phases 1 through 6 are superseded by the new repo and should be archived or reduced to editor-service work.

## Active

### Standalone App

- Status: `in_progress`
- Summary: Full standalone subscriber-facing surface with Platform SSO, database, provisioning, events, tRPC, and frontend. Phase 0 monorepo restructure is locally code-complete, but CRM/Connect parity evidence plus the dev deploy/rollback gate are still open before Phase 1 can start.
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
