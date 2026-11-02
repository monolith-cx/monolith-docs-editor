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

- Parent ecosystem hub: Monolith Platform
- Primary consumer: Monolith CRM
- Durable ecosystem contracts and integration docs live in Monolith Platform's `docs/ecosystem/` (private)

## Architecture Patterns

- Keep Monolith Docs as a separate service; consumer apps integrate over API
- OnlyOffice is stateful and should be treated as a GCE-hosted service in production
- Signed URL round-trips are the core file model; avoid durable file storage by default
- Consumer auth, hostname binding, callback and notification security, and the sealed stateless sessions are core security boundaries
- Headless integrations and the future standalone app are different surfaces; do not blur them

## Work Tracking

- Maintainers track work privately in Linear; an effort bigger than one PR is a Linear project, never a new `.ai/` initiative. Contributors use GitHub issues and pull requests.
- Legacy initiatives not yet moved: `.ai/registry.yml`, `.ai/initiatives/<lane>/<initiative-id>/`, `ROADMAP.md`. Never tracked in both.
- Review: opposing review on the PR. Any other provider only with the repository owner's explicit approval for that use.

## Key Rules

- No `any`
- No `console.log`
- No direct `process.env` outside config helpers
- No proprietary business logic in this repo
- Shared-surface changes are contract-first
- Build prerequisites before dependent features
- Read `CLAUDE.md` for the full engineering conventions
