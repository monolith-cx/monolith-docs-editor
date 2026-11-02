# Monolith Docs Editor

> **Repo split (2026-09-02):** this repo was renamed from `monolith-docs` to `monolith-docs-editor`. It is the AGPL OnlyOffice-backed headless editing service only. The proprietary Monolith Docs product (e-signature and the customer app) lives in the private `monolith-cx/monolith-docs` repo on GitHub and talks to this service over HTTP. Since 2026-10-19 (EGM-0) the source of truth is GitHub `monolith-cx/monolith-docs-editor` (public, AGPL); `main` takes changes by pull request with the `checks` check green (`.github/workflows/ci.yml`, EGM-1), and the manual `Images` workflow pushes `ghcr.io/monolith-cx/editor-api:<sha>` (EGM-2). The old self-hosted origin is archived (EGM-0.8).


Open-source document editing service built on [OnlyOffice DocumentServer](https://www.onlyoffice.com/developer-edition.aspx). It provides browser-based DOCX editing with real-time collaboration and integrates with external applications over a lightweight API boundary.

## Quick Start

**Prerequisites:** Docker, Docker Compose, Node.js 24+, pnpm 10+

```bash
git clone https://github.com/monolith-cx/monolith-docs-editor.git
cd monolith-docs-editor
corepack enable
cp .env.example .env
docker compose up -d

# or develop the API locally
pnpm install
pnpm run dev
```

Once running:

- **API health:** <http://localhost:3020/health>
- **OnlyOffice editor:** <http://localhost:8080>
- **Combined status:** <http://localhost:3020/api/status>

## Architecture

```text
monolith-docs/
├── apps/
│   ├── api/              Thin Node.js + Fastify API layer
│   │   └── src/
│   │       ├── routes/   Health, document, upload, and callback endpoints
│   │       ├── auth.ts   Consumer auth and hostname enforcement
│   │       ├── consumers.ts consumer config resolution
│   │       ├── safe-url.ts, session-token.ts, notify.ts  URL gate, sealed sessions, signed notifications
│   │       └── server.ts Entry point
│   └── plugin/           The panel bridge plugin (EDIT-5), served by the API
├── infrastructure/       GCP deployment scripts and hosted env config
├── docs/                 Technical and architectural docs
└── .ai/                  Initiative tracking and review workflow
```

| Component | Purpose |
| --------- | ------- |
| **OnlyOffice DocumentServer** | Core document editing engine |
| **API** | Consumer auth, profiles and sealed editor sessions, callback verification, signed notifications, health checks |
| **Infrastructure** | GCE deployment and hosted service config |

## Integration Model

Monolith Docs runs as a separate service. Consuming apps integrate via API:

```text
Consumer App → POST /api/documents/open → { editorUrl }
User edits document in Monolith Docs
Monolith Docs → POST {callbackUrl} → Consumer stores updated file
```

## Development

```bash
corepack enable
pnpm install
pnpm run dev
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm run test
docker compose config
```

## Current Source Of Truth

- `CLAUDE.md` — repo-wide engineering rules and architecture constraints
- Work and delivery status: Linear (`CLAUDE.md` § Work Tracking)
- `ROADMAP.md`, `.ai/registry.yml` — status of legacy initiatives not yet moved to Linear
- `.ai/initiatives/<lane>/<initiative-id>/guidance.md` — initiative-specific constraints
- `.ai/initiatives/<lane>/<initiative-id>/plan.md` — initiative execution status and acceptance criteria

## AI Skills

These skills drive the `.ai` control plane, which applies only to legacy initiatives not yet moved to Linear (`CLAUDE.md` § Work Tracking):

- `/control-plane setup` — onboard a new repo or migrate an old repo to the new `.ai` structure
- `/control-plane audit` — inspect the repo for stale control-plane files, drift, or inconsistencies
- `/control-plane fix` — repair control-plane issues found in the audit
- `/initiative checkpoint` — stop at a checkpoint boundary, run verification, run checkpoint review, run doc sync, then ask whether to commit
- `/initiative review` — manually trigger a review without committing
- `/initiative phase-close` — run the phase closeout review, doc sync, then ask whether to commit
- `/initiative doc-sync` — reconcile `plan.md`, `.ai/registry.yml`, and `ROADMAP.md` without implying review passed
- `/initiative handoff` — generate or refresh `.ai/handoffs/<initiative-id>.md` for the next fresh session
- `/tests audit|design|run|coverage` — inspect and run the verification stack

Reviewer defaults (legacy initiatives only; Linear work follows `CLAUDE.md` § Work Tracking):

- checkpoint and phase closeout: one opposing reviewer, `codex` when Claude implemented and `sonnet` (a Claude subagent) when Codex implemented (`opposing_review` in `.ai/iddp/config.json`)
- no fallback, backup, panel or frontend extra reviewer; any other provider only with the repository owner's explicit approval for that use

Commit policy:

- every commit requires explicit user approval
- doc sync runs before any approved commit
- the repo does not use commit-ready stamp files

## License

[AGPL-3.0](LICENSE) — required because OnlyOffice DocumentServer is AGPL-licensed. All source code in this repo is open source.

## Notes

- The active AI workflow lives under `.ai/`, not `docs/`.
- `docs/` is reserved for technical, architectural, and product documentation.
