# ADR: Hosting the editor on the VPS (EDIT-6, UDOC-1.6)

- **Status:** Accepted 2026-10-18. Josh decided the host and the dev hostname. The stand-up itself is pending, and each of its steps needs his approval.
- **Initiative:** `udoc-editor-service` (EDIT-6), parent UDOC-1.6; guidance E9.
- **Related:**
  - ADR `2026-10-17-onlyoffice-release-and-licence.md` (F1, F2, F3, F7, F15, F17);
  - Platform `docs/ecosystem/playbooks/vps-runtime.md`;
  - the runbook `infrastructure/vps/README.md`.

## Context

- **No editor host exists.** Both GCE VMs were deleted for cost on 2026-06-12; their snapshots were kept.
- **Every Monolith product runs on one VPS since 2026-07-25 (VPSM).**
  - The host is an OVH VPS in Hillsboro with 8 vCore and 22 GiB.
  - Each product runs as a compose project there, with dev and prod side by side behind one Caddy.
  - Images are pinned by SHA, and env files are generated from 1Password.
  - GCP keeps only Secret Manager, Artifact Registry, Pub/Sub, and backups.
- **CRM dev runs there** as `crm-api-dev` on the `monolith-dev` network.
- **What UDOC-1.6 needs:** the editor must be reachable from CRM dev, and a stub receiver on that network proves the notifications (A4).

## Decision

1. **Where.** The editor joins the VPS compose projects, dev first, as two services:
   - `editor-documentserver-<env>`, the pinned DocumentServer;
   - `editor-api-<env>`, this repository's API.

   Each name carries its environment, like every service on the box, because the shared Caddy joins both environments' networks. The API also answers on the alias `editor-api`, on its own environment's network only (point 3). Consumers on the box call `http://editor-api:3020`.

2. **Public host:** `editor-dev.monolith.cx`, with TLS at Caddy.
   - Caddy sends `/editor/*`, `/plugins/udoc-bridge/*`, and `/health` to the API.
   - It refuses `/api/*` (403) and `/health/*` (404).
   - Everything else goes to DocumentServer: its assets, its JS API, the co-editing WebSocket, and cache files. DocumentServer's own nginx refuses `/info/` to anyone but itself (F7).
   - Nothing outside the box needs the API in dev.
   - The host has no access log, because its paths carry capabilities (EDIT-4).
   - Caddy sets no `Referrer-Policy`, so the editor page's own `no-referrer` reaches the browser.
   - Prod hostnames are decided at the prod stand-up, and so are any off-box consumers.

3. **DocumentServer fetches directly only from the service** (F3, defence in depth).
   - `externalRequest.directIfIn` is `jwtToken: false` with `allowList: ["http://editor-api:3020/"]`.
   - Private addresses stay refused (`ALLOW_PRIVATE_IP_ADDRESS=false`).
   - Since EDIT-2, DocumentServer reads documents only from the service's source route and legacy uploads, and posts callbacks only to the service. So nothing it legitimately fetches lies outside that origin. A signed configuration naming any other private address is now refused by DocumentServer itself, not only by the service.
   - Outside `EDITOR_ENV=local`, the API refuses to start unless `API_INTERNAL_URL` is exactly `http://editor-api:3020`. Internal URLs are built by appending to it, so a trailing slash or a path would break every flow.
   - Every deployment gives the API that name: the alias on the VPS, and in the battery and the root compose file.

4. **The converter** (F17).
   - Two converter processes instead of one, so one wedged slot no longer stops every conversion, open, and save.
   - **The probe.** `GET /health/converter` converts a built-in sample within 20 s. It answers loopback callers only, checked by socket address, and Caddy never routes it.
   - **The watchdog.** A host cron script runs the probe every 5 minutes. After two consecutive failures it:
     1. waits for open editors to close, for at most 15 minutes;
     2. restarts DocumentServer in place (`docker compose restart`);
     3. waits for its health check and for font generation to finish (F15);
     4. probes again.

     Every step goes to its own log, and alerts are printed so cron mails them.
   - **Why a host script.** A container holding the Docker socket would be simpler, but the playbook's hardening baseline refuses it.

5. **Images.**
   - The API image is built from a committed tree and pushed, tagged with its SHA, to GHCR under the `monolith-cx` org, per Platform's Forgejo exit (owner-approved 2026-10-18: images go to GHCR, Artifact Registry is rejected, the Forgejo registry goes away on 2026-10-31). The exact name, CI, and cutover are the Forgejo exit's editor child (FEX-2.4); the VPS's GHCR login is FEX-3. The stand-up waits for both.
   - DocumentServer is pulled from Docker Hub by tag and digest, and changes only through a battery run. It is a third-party image outside both the playbook's old rule and GHCR; mirroring it is an option at the stand-up.
   - Deploys are by hand until CI exists (DOC-DPP, and the Forgejo exit's editor child), with `up -d --no-deps editor-api-<env>`. `vps-deploy.sh` runs a plain `up -d`, which would also converge DocumentServer and could recreate it.

6. **One API instance per environment.** The rate, source-read, and conversion limiters are in process.

7. **Proxy trust: `TRUST_PROXY=1`**, one hop (Caddy).
   - Callers on the box connect directly and send no forwarded header.
   - A caller on the box that forged one could choose only its own rate-limit identity.
   - `X-Forwarded-Host` is dropped regardless (EDIT-5).

8. **State and logs.**
   - DocumentServer 10.0.0.1 runs no PostgreSQL, RabbitMQ, or Redis of its own; it runs only `docservice`, `converter`, nginx, and cron (checked on the pinned image). Its on-disk state is in the image's declared directories, mounted as named volumes so a recreate keeps them: `/var/www/onlyoffice/Data`, `/var/lib/onlyoffice`, and `/var/log/onlyoffice`.
   - Its logs are rotated by the image's own logrotate: daily, 30 kept, compressed.
   - Both containers' stdout is capped by `json-file` rotation.

9. **Secrets** follow the playbook's Secret Lifecycle rule: 1Password, the VPS env file, and Google Secret Manager (project `monolith-docs`) change together.

## Evidence (battery, pinned release 10.0.0.1)

Records are in `docs/spikes/results/10.0.0.1/`.

- **E6a (`2026-10-19-partial-0057`; earlier `-0005`).** DocumentServer ran as the VPS runs it.
  - The service's flows passed: S1, S2, E3a, and E5b.
  - A signed configuration and conversion naming a private address directly were refused (`error -4`).
- **E6b (`-0057`).** With both converter slots wedged by F17's dropped source, the probe answered 503 after 20 s. Then the watchdog ran three times:

  | Run | What it did | Printed for cron's mail |
  |---|---|---|
  | 1 | Counted one failure | Nothing |
  | 2 | Saw one open editor and waited | The alert |
  | 3 | After the editor closed, saw none, restarted DocumentServer, and waited until it was ready | The restart alerts |

  The probe passed again about 3 minutes later (3 min 14 s). A caller that is not loopback gets 404. The watchdog's other failure paths were simulated during the EDIT-6 review:
  - the API down;
  - `info.json` unavailable;
  - a failed restart;
  - an unwritable state directory.
- **E6c (`-0022`):** capacity (below), and the live editor count the watchdog reads: `quota.edit.connectionsCount` plus `quota.view.connectionsCount` in `info.json`.
- **E6d (`-0057`).** A real Caddy served the shipped block on the battery network, and plain requests followed point 2:
  - the editor page kept `Referrer-Policy: no-referrer`;
  - `/info/info.json` was refused with 403.

  E6d did not exercise TLS, HSTS, the WebSocket, or the forwarded headers DocumentServer uses to build its public URLs. Those are proven at EDIT-6.7, with a browser through the real host, together with F2's save-URL origin.
- **E6e (`-0057`): a restart in place, with a healthy converter.**
  - A user typed in an open editor without saving, and DocumentServer was restarted in place.
  - DocumentServer sent the final save (status 2) one second into the restart, and the typed text was in it.
  - The open editor showed "Connection is lost".
  - Whether a restart keeps unsaved work when the converter is wedged was not measured. That is the watchdog's case, and that save presumably needs the converter, since the final save assembles the document (not measured). So the watchdog waits for editors to close first, and a wedge is an alert.

## Capacity and restarts

E6c (`-0022`) ran on this development box. Memory is from `docker stats`, so it excludes the page cache:

| State | DocumentServer | API |
|---|---|---|
| Idle, after font generation | 364 MiB | 33 MiB |
| 1 editor open | 366 MiB | 36 MiB |
| 3 editors open | 366 MiB | 36 MiB |
| 6 editors open | 368 MiB | 37 MiB |
| 6 editors open, conversions running* | 368 MiB | 38 MiB |

\* The service admitted 2 of 4 conversions at once (the per-consumer limit). The peak was sampled each second.

- **An open editor costs DocumentServer under 1 MiB at this document's size.** The editor's own work runs in the browser.
- **Connections are not capped by this build.** With six editors open, `info.json` reported `quota.edit.connectionsCount` 6. Its licence info reported `connections` 2147483647 for the Community build.
- **Not measured:**
  - large documents;
  - a converter process on a 100 MB file;
  - DocumentServer's peak during font generation at start-up (F15). The runbook watches memory and `OOMKilled` over the first start.
- **Limits:**
  - DocumentServer: `mem_limit` 3 GiB. That is about eight times the measured steady state, as headroom for the unmeasured cases.
  - API: 1.5 GiB. That is above its file ceiling ((source reads + conversions) × 100 MB = 800 MB by default) plus the runtime.
  - Together they reserve nothing but cap 4.5 GiB of the VPS's 22 GiB. Revisit both after a week of the VPSM health check's memory readings.
- **Restarts and recreates.**
  - A restart in place (the watchdog) and a recreate (an update) both drop open editors. Both keep DocumentServer's on-disk state in its volumes.
  - With a healthy converter, a restart saved what an open editor had typed (E6e). A recreate was not exercised.
  - Updates therefore drain first (runbook), and API deploys use `--no-deps` so they never recreate DocumentServer.

## Consequences

- **Shared memory.** The editor shares the VPS's memory with every product's dev and prod. Its limits are part of the box's budget. Both containers join `health-check.sh`'s critical list at the stand-up.
- **When the watchdog restarts.** It restarts DocumentServer only for a wedged converter, which already blocks opens and saves. Each restart is mailed.
- **Caddy's error log** records the full request URI when an upstream fails, including live editor tokens (observed; `ERRORS.md`, 2026-10-18). The box's log settings for this host are decided at the stand-up.
- **`/api/*` is unreachable from outside the box in dev.** An off-box consumer (the Connect extension, fastmail-connect) needs a decision at the prod stand-up: a consumer hostname routed to the API, as the old tunnel hostnames were.
- **Hostname binding cannot separate consumers on the box,** since all of them call `editor-api`. Dev consumers stay unbound.
- **DOC-DPP.** Its working-tree Phase 4 (GCE, us-west1) is overtaken for hosting; its owner reconciles it.
- The old GCE files stay for the return-to-GCP plan.

## Alternatives considered

- **A GCE VM behind a Cloudflare Tunnel** (the pre-2026-06 path). Not chosen: GCP compute was exited, it adds a VM bill, and CRM dev could reach it only over the public internet.
- **DocumentServer's private-address filter off** (`ALLOW_PRIVATE_IP_ADDRESS=true`, the old GCE setting). Not chosen: the allow-list keeps every intended fetch working with the filter on.
- **A watchdog container with the Docker socket.** Refused by the playbook's hardening baseline.
- **Unqualified service names** (`editor-api` as the service). Not chosen: the shared Caddy would resolve `editor-api` in both environments' networks once prod exists.
