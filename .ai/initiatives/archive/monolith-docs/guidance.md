# Monolith Docs — Architecture Guidance

Initiative ID: `monolith-docs`
Created: 2026-03-17

**Archive Note (2026-04-14):** This umbrella initiative is archived. Follow-on work now lives in `.ai/initiatives/complete/production-hardening/` and `.ai/initiatives/archive/standalone-app/`.

---

## Overview

Monolith Docs is an open-source (AGPL 3.0) document editing service built on OnlyOffice DocumentServer. It provides browser-based DOCX editing with real-time collaboration, designed to integrate with external applications via a lightweight API contract.

The primary consumer is Monolith CRM, where it serves as the template authoring experience for the document generation pipeline (DOCX templates with merge fields → docxtemplater → Gotenberg → PDF).

## Product Vision

```
Monolith Product Family:
  ├── Monolith CRM        (proprietary SaaS — CRM, commerce, field service)
  ├── Monolith Docs        (open source AGPL — document editing)
  └── Future products...   (e-sign, portal, etc.)
```

### Business Model

- **Free tier:** Self-host from the public GitHub repo
- **Paid tier:** Monolith Docs Cloud — hosted, managed, SLA, backups
- **Integration revenue:** CRM integration connector is a paid feature of Monolith CRM
- **Support plans:** Paid support for self-hosted deployments

### Licensing Boundary

The AGPL boundary is this repo only. Consuming applications (Monolith CRM) communicate via API and maintain their own proprietary licenses. This is the same model used by GitLab, Nextcloud, and Collabora with OnlyOffice.

**Critical:** Never embed OnlyOffice as an iframe inside a proprietary application. Always open Monolith Docs in a separate tab/window or as a standalone URL. This maintains the clean licensing separation.

---

## OnlyOffice DocumentServer

### What It Provides

- Full DOCX/XLSX/PPTX editor in the browser (Word-like UX)
- Real-time collaborative editing
- Track changes, comments, revision history
- Document conversion (DOCX ↔ PDF, ODT, etc.)
- Callback API — notifies the consuming app when a document is saved

### Internal Architecture (Inside the Docker Container)

| Service | Port | Purpose |
|---------|------|---------|
| NGINX | 80/443 | Reverse proxy, static assets, WebSocket upgrade |
| DocService (Node.js) | 8000 | Core editing service, collaboration engine |
| FileConverter (Node.js) | — | Document format conversion |
| SpellChecker | — | Spell checking service |
| PostgreSQL | 5432 | Session state, collaboration history |
| Redis | 6379 | Caching, pub/sub for real-time sync |
| RabbitMQ | 5672 | Async task queue (conversions, cleanup) |

All services run inside a single Docker container by default (`onlyoffice/documentserver` image). For production scale, they can be split into separate containers.

### Resource Requirements

| Tier | CPU | RAM | Disk | Max Concurrent Editors |
|------|-----|-----|------|----------------------|
| Minimum | 2 cores | 4 GB | 40 GB | ~20 |
| Recommended | 4 cores | 8 GB | 80 GB | ~100 |
| Production | 4+ cores | 8+ GB | 80+ GB | ~1000 (4-core tested) |

Idle memory usage: ~1-1.5 GB (PostgreSQL + Redis + Node.js services running).

### Why NOT Cloud Run

OnlyOffice is stateful — it runs PostgreSQL, Redis, and RabbitMQ internally. Cloud Run expects stateless containers. Options:

- **GCE (Compute Engine)** — simplest, single VM, cheapest for dev
- **GKE Autopilot** — if we need auto-scaling later
- **Cloud Run** — not viable for OnlyOffice itself (the thin API layer could run on Cloud Run separately if needed)

---

## API Layer

A thin Node.js API that sits in front of OnlyOffice and handles:

### 1. Document Open Flow

```
Consumer calls: POST /api/documents/open
{
  fileUrl: "https://storage.googleapis.com/...",   // GCS signed download URL
  callbackUrl: "https://api.monolithcrm.com/...",  // Where to POST on save
  token: "eyJ...",                                  // Consumer-issued JWT
  user: {
    id: "user-uuid",
    name: "Josh",
    email: "josh@example.com"
  },
  permissions: {
    edit: true,
    download: true,
    print: true
  }
}

Response:
{
  editorUrl: "https://docs.monolithcrm.com/editor/session-id"
}
```

### 2. Editor Page

The editor page loads OnlyOffice with the document configuration. OnlyOffice downloads the file from `fileUrl`, opens it in the editor.

### 3. Save Callback

When the user closes the editor (or auto-save triggers), OnlyOffice calls the Monolith Docs API, which then calls the consumer's `callbackUrl`:

```
POST {callbackUrl}
{
  status: "saved",          // or "closed", "error"
  downloadUrl: "https://...", // URL to download the updated .docx
  key: "document-key",
  users: ["user-uuid"]
}
```

The consumer (CRM) downloads the updated `.docx` and stores it via its own file management system.

### 4. Auth Model

- Monolith Docs trusts JWTs issued by consuming applications
- Each consuming app registers a public key / JWKS endpoint with Monolith Docs
- The JWT contains: user identity, document permissions, callback URL
- OnlyOffice's own JWT security is also enabled (signs editor config to prevent tampering)

### 5. Health & Status

- `GET /health` — API health
- `GET /api/status` — OnlyOffice DocumentServer status (proxies to `/healthcheck`)

---

## GCP Deployment

### Dev Environment

```
GCE VM: monolith-docs-dev (e2-medium, 2 vCPU, 4GB RAM)
  ├── Docker Compose
  │   ├── onlyoffice/documentserver (port 8080)
  │   └── monolith-docs-api (port 3010)
  ├── NGINX (host level, optional — or just expose ports)
  └── Auto-shutdown schedule (evenings/weekends to save cost)
```

Estimated cost: ~$25/mo (with auto-shutdown), ~$50/mo (always on).

### Prod Environment

```
GCE VM: monolith-docs-prod (e2-standard-2, 2 vCPU, 8GB RAM)
  ├── Docker Compose
  │   ├── onlyoffice/documentserver (port 8080)
  │   └── monolith-docs-api (port 3010)
  ├── NGINX (TLS termination, proxying)
  └── Persistent disk for OnlyOffice data
```

### DNS

- Dev: `docs-dev.monolithcrm.com` → GCE VM external IP
- Prod: `docs.monolithcrm.com` → Load balancer or GCE VM

### GCS Integration

Monolith Docs does NOT manage its own file storage. Files flow through GCS signed URLs:

1. Consumer generates a signed download URL for the .docx
2. OnlyOffice downloads from that URL
3. On save, OnlyOffice produces an updated .docx
4. Monolith Docs API generates a temporary signed upload URL (or the consumer provides one)
5. Updated file is written to GCS
6. Consumer is notified via callback

The Monolith Docs service account needs `roles/storage.objectViewer` on the shared GCS bucket (or the consumer always provides fully-signed URLs so no GCS permissions are needed on the Docs side).

---

## Consumer Integration Model

Monolith Docs is a generic document editing service. Multiple consumers integrate via the same API with different auth and storage patterns.

### Consumer 1: Monolith CRM (Proprietary — lives in monolith-crm repo)

- Auth: JWT with JWKS validation
- Files: GCS signed URLs from CRM's FilesService
- Save: Callback → CRM stores updated file
- CRM's `document-generation` initiative adds: "Edit in Monolith Docs" button, signed URL generation, callback endpoint, File record update

**Template Authoring Flow:**
1. Admin navigates to Settings → Document Templates in CRM
2. Clicks "Design in Monolith Docs" → CRM calls `POST /api/documents/open` with signed URL + callback URL
3. Editor opens in new tab → admin designs template with `{{merge.fields}}`
4. On save → OnlyOffice → Docs API → CRM callback → CRM stores updated .docx
5. CRM uses docxtemplater + Gotenberg to merge data and produce PDFs

### Consumer 2: Chrome Extension (Separate repo — multi-feature extension)

- Auth: API key (simple bearer token)
- Files: Upload attachment via `POST /api/files/upload` (temp storage)
- Save: Standalone mode — user downloads edited file directly (no callback)
- Extension also has CRM notifications and activity capture features (those don't touch Monolith Docs)

**Fastmail Attachment Edit Flow:**
1. User views email in Fastmail with .docx attachment
2. Extension provides "Edit in Monolith Docs" action
3. Extension downloads attachment → uploads to `POST /api/files/upload` → gets `fileUrl`
4. Extension calls `POST /api/documents/open` (no callbackUrl) → gets `editorUrl`
5. Opens editor in new tab → user edits → downloads result

---

## Non-Negotiables

1. **AGPL compliance** — all code in this repo is open source. No proprietary code.
2. **Clean API boundary** — consuming apps integrate via REST API only. No iframe embedding in proprietary apps.
3. **Stateless API layer** — the thin API has no database of its own. All document state is in OnlyOffice.
4. **Signed URL file access** — files are never stored permanently in Monolith Docs. Always GCS signed URLs.
5. **JWT auth** — all API calls authenticated. OnlyOffice JWT security enabled.
6. **No business logic** — Monolith Docs is a document editor, not a CRM. Template management, merge fields, PDF generation all live in the consumer.

---

## Implementation Quality Bar

- Inspect the actual repo state before describing current surfaces. The API, web app, Docker Compose file, and package manifests are planned until they are created.
- Build small vertical slices that are runnable end-to-end. Avoid broad scaffolding with large TODO gaps while claiming progress as if the flow already works.
- Resolve contract and operational questions in docs first when the correct behavior is not obvious. Guessing through integration details creates bad defaults that are expensive to unwind later.
- Keep the initiative plan, project state, tasks, and session docs aligned with reality in the same session as the change.

## Status Integrity And Completion Rules

- Checklist steps and phases stay `In Progress` or `Blocked` until the implementation, config, validation, and docs for that scope are all done.
- Placeholder env vars, stub endpoints, mocked callbacks, or untested compose files do not count as done.
- End-to-end claims require the actual path to be exercised, or the exact missing leg to be called out plainly.
- If CRM-side work, credentials, DNS, GCS, or GCE dependencies block completion, record that dependency instead of implying the Docs side is fully finished.

## Integration Quality Gates

- Document open flow must define request validation, editor key generation, callback domain constraints, permission mapping, and signed URL TTL expectations.
- Save callback handling must define status mapping, duplicate callback and idempotency behavior, retry strategy, timeout handling, and how consumer failures surface to operators.
- JWT handling must keep consumer JWT validation separate from OnlyOffice JWT signing, with clear secret or key sources and rotation expectations.
- GCS file handling must define who signs download and upload URLs, expected expiry windows, content-type expectations, and cleanup or error behavior when upload or callback steps fail.
- Infrastructure changes must document persistence expectations, health checks, ports, TLS termination, secret management, backup or restore assumptions, and rollback notes before they are considered complete.

---

## Future Possibilities

- **Monolith Docs Cloud** — hosted multi-tenant version (paid SaaS)
- **Spreadsheet support** — OnlyOffice also handles .xlsx
- **Presentation support** — OnlyOffice also handles .pptx
- **Plugin marketplace** — OnlyOffice supports editor plugins
- **API expansion** — batch conversion, document comparison, version diff
- **Community contributions** — open-source repo invites external contributors
