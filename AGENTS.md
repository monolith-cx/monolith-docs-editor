# Monolith Docs — Agent Context

Standalone AGPL document-editing service built around OnlyOffice DocumentServer with a thin Fastify API.

## Stack

- API: Fastify + TypeScript on `3020`
- Document engine: OnlyOffice DocumentServer `10.0.0.1` (pinned by digest, EDIT-1.3) on `8080`
- Storage: none held by the service; consumers pass short-lived signed file URLs, which the service fetches on DocumentServer's behalf (the source route), and store saves themselves; `/api/files/` keeps temporary legacy uploads
- Infrastructure: Docker Compose locally, GCE + NGINX + Cloudflare Tunnel for hosted environments
- Auth: consumer-issued integration credentials today, Platform SSO planned for the standalone app
- Runtime: Node.js `24+`, pnpm workspaces, Turbo, Vitest, ESLint

## Ecosystem

- Parent ecosystem hub: Monolith Platform (`C:\Dev\monolith-platform`)
- Primary consumer: Monolith CRM (`C:\Dev\monolith-crm`)
- Durable ecosystem contracts and integration docs live in `C:\Dev\monolith-platform\docs\ecosystem\`

## Architecture Patterns

- Keep Monolith Docs as a separate service; consumer apps integrate over API
- OnlyOffice is stateful and should be treated as a GCE-hosted service in production
- Signed URL round-trips are the core file model; avoid durable file storage by default
- Consumer auth, hostname binding, callback and notification security, and the sealed stateless sessions are core security boundaries
- Headless integrations and the future standalone app are different surfaces; do not blur them

## Roadmap And Initiative State

- High-level feature and delivery status: `ROADMAP.md`
- Initiative registry: `.ai/registry.yml`
- Initiative docs: `.ai/initiatives/<lane>/<initiative-id>/`
- Optional atomic backlog: `.ai/backlog.yml`
- IDDP policy: `.ai/iddp/config.json`
- No repo-level current file or session ledger is part of the active workflow
- Commits require explicit user approval, and doc sync is required before commits and phase close-outs

## Key Rules

- No `any`
- No `console.log`
- No direct `process.env` outside config helpers
- No proprietary business logic in this repo
- Shared-surface changes are contract-first
- Build prerequisites before dependent features
- Read `CLAUDE.md` for the full engineering conventions
