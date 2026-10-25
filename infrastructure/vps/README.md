# The editor on the VPS (EDIT-6, guidance E9)

The editor runs on the OVH VPS that hosts every Monolith product since the GCP exit (Platform
`docs/ecosystem/playbooks/vps-runtime.md`, VPSM). This directory holds what the editor contributes;
the box itself (Caddy, env files from 1Password, cron, backups, the deploy key, the health check)
follows the VPSM runbook, the way Monolith Docs contributes `infrastructure/docker-compose.docs.yml`.
Hosting decision, evidence, and operating rules: `docs/adr/2026-10-18-editor-hosting.md`.

| File | What it is |
|---|---|
| `docker-compose.editor.yml` | `editor-documentserver-<env>` and `editor-api-<env>`, merged into `/srv/monolith/<env>/docker-compose.yml` |
| `Caddyfile.editor` | The dev host's routes, merged into `/srv/monolith/caddy/Caddyfile` |
| `editor-api.env.example` | The API's env file: names only; values from 1Password |
| `editor-converter-watch.sh` | The converter watchdog (ADR F17), run by cron |
| `../onlyoffice/local-production-linux.json` | DocumentServer's settings, copied to `/srv/monolith/<env>/editor/onlyoffice/` |

The old GCE path (`../gce/`, `../cloudflare/`, `../nginx/`) stays for the return-to-GCP plan and is
not used on the VPS.

**Every step that changes the VPS, DNS, 1Password, or Secret Manager needs Josh's approval first**
(the initiative's rule), and runs in the order below. Commands assume the dev project and are run as
the operator in `/srv/monolith/dev` (`cd /srv/monolith/dev` first; `-p monolith-dev` names the project).

## Names

Each service carries its environment (`editor-api-dev`), like every service on the box, because the
shared Caddy joins both environments' networks and must reach one of them unambiguously. The API also
answers on the alias `editor-api` on its own environment's network only: DocumentServer's directIfIn
allow-list names `http://editor-api:3020/`, and the API refuses any other `API_INTERNAL_URL` outside
`EDITOR_ENV=local`. Consumers on the box (CRM dev) call `http://editor-api:3020` from their own
environment's network.

## Images

- **The API:** `ghcr.io/monolith-cx/editor-api:<sha>`, built from this repository's root with
  `apps/api/Dockerfile` (no private packages: the repository is AGPL and has none) by the `Images`
  workflow (`.github/workflows/images.yml`, EGM-2). It runs by hand from `main` only, in the
  `images` Environment, with `GITHUB_TOKEN`; it starts the image and checks `/health` before it
  pushes, never pushes a tag that already exists, and reports the digest in the run summary. The
  tag is the full commit SHA; pin the fragment's image line to `…:<sha>@sha256:<digest>`. Images
  go to GHCR per Platform's Forgejo exit (owner-approved 2026-10-18; Artifact Registry rejected).
- **Pulling on the box** follows Platform's FEX-4.1 pattern: no `docker login` stays on the VPS. A
  `packages: read` token arrives on stdin, is used through a temporary `DOCKER_CONFIG` for the one
  pull, and the directory is deleted. Until FEX-4.1 lands in `vps-deploy.sh`, the deployer does the
  same by hand, with Josh's approval, in a subshell so the temporary login is removed even when
  the pull fails. The token is never an argument or an inline `echo`: paste it when `docker login`
  waits on stdin (then Ctrl-D), or pipe it from a command that does not print it (`op read …`).
  If the package is public (EGM-2.2, guidance E4), skip the login and pull directly.
  ```bash
  (
    export DOCKER_CONFIG="$(mktemp -d)"; trap 'rm -rf "$DOCKER_CONFIG"' EXIT
    docker login ghcr.io -u <github-user> --password-stdin   # a token with read:packages
    docker pull ghcr.io/monolith-cx/editor-api:<sha>@sha256:<digest>
  )
  ```
- **DocumentServer:** the pinned release by tag and digest, from Docker Hub
  (`onlyoffice/documentserver:10.0.0.1@sha256:ca17…`). The playbook still says "Artifact Registry
  only", which the Forgejo exit replaces with GHCR; either way this is a third-party image pulled by
  digest. The digest fixes the bytes, and it changes only through a full battery run (E2, ADR
  2026-10-17); mirroring it into GHCR is an option the stand-up may take.
- **Deploys are by hand** until CI exists: `vps-deploy.sh` runs `up -d <svc>` without `--no-deps`,
  which could recreate DocumentServer (below).

## First stand-up (dev)

1. **Secrets** (1Password, then the env files, then Google Secret Manager in `monolith-docs`, together):
   the DocumentServer JWT secret, the seal key, and one notification secret per consumer. The env
   files are `env/editor-api.env` (from `editor-api.env.example`) and `env/editor-documentserver.env`
   (`JWT_SECRET=` the API's `ONLYOFFICE_JWT_SECRET`), both 0600.
2. **DNS:** `editor-dev.monolith.cx` to the VPS, like the other `-dev` hosts.
3. **Files:** `local-production-linux.json` to `/srv/monolith/dev/editor/onlyoffice/`; the fragment
   merged into `/srv/monolith/dev/docker-compose.yml` with `<env>` = `dev` and `<sha>` the API image;
   `docker compose -p monolith-dev config -q` must pass.
4. **Start DocumentServer first, and wait** (ADR F15): it restarts its own services about two minutes
   after it reports healthy, once background font generation ends, dropping any editor already open.
   Watch its memory while it does (E6c did not measure the font-generation peak against the 3 GiB limit):
   ```bash
   docker compose -p monolith-dev up -d editor-documentserver-dev
   docker stats --no-stream monolith-dev-editor-documentserver-dev-1
   # healthy, and font generation finished:
   docker compose -p monolith-dev exec -T editor-documentserver-dev sh -c "pgrep -f '[d]ocumentserver-generate-allfonts' || echo fonts-done"
   docker inspect -f '{{.State.OOMKilled}}' monolith-dev-editor-documentserver-dev-1   # must be false
   ```
5. **Start the API without touching DocumentServer:**
   `docker compose -p monolith-dev up -d --no-deps editor-api-dev`. It refuses to start on a
   configuration problem and says which (`startupProblems`).
6. **Caddy:** merge `Caddyfile.editor`, restart the Caddy container (no `caddy reload`: `admin off`).
   Decide Caddy's error log for this host here (ERRORS.md, 2026-10-18): on an upstream failure it
   records the request URI, which for `/editor/<token>` is a capability.
7. **Checks:** `https://editor-dev.monolith.cx/health` is 200; `/api/status`, `/health/converter`, and
   `/info/info.json` are refused through Caddy; inside the API container the converter probe answers 200:
   ```bash
   docker compose -p monolith-dev exec -T editor-api-dev node -e "fetch('http://127.0.0.1:3020/health/converter').then(async(r)=>console.log(r.status, await r.text()))"
   ```
8. **Monitoring:**
   - The watchdog: the script to `/srv/monolith/bin/editor-converter-watch.sh` (root, 0755), and
     `/etc/cron.d/monolith-editor-converter`, with no redirect (cron mails what it prints, and it
     prints only alerts; the steps go to its own log, `/srv/monolith/backup/editor-converter-watch.log`):
     ```
     */5 * * * * root WATCH_API_SERVICE=editor-api-dev WATCH_DS_SERVICE=editor-documentserver-dev /srv/monolith/bin/editor-converter-watch.sh
     ```
     Cron's mail reaches a person only if the box's local mail is deliverable (the playbook's caveat
     for `health-check.sh`); check it.
   - Add both containers to `/srv/monolith/bin/health-check.sh`'s critical container list, so a
     stopped editor alerts like every other service.
9. **Acceptance:** EDIT-6.7 (the stub consumer on `monolith-dev`, the editor opened with the panel
   through Caddy, a signed save notification verified, the F2 save-URL origin checked).

## Deploying a new API image

1. Run the `Images` workflow on `main` and pull the reported digest (above).
2. Repin `editor-api-dev`'s image line and `docker compose -p monolith-dev up -d --no-deps editor-api-dev`,
   then the checks. `--no-deps` matters: without it, `up` also converges DocumentServer, so any edit
   to its block since the last start would recreate it and drop every open editor. (`vps-deploy.sh`
   runs `up -d <svc>` without it; another reason deploys stay by hand for now.)
3. An API restart does not drop open editors: DocumentServer holds them, and a save that lands while
   the API is down is retried for about 7 seconds (ADR F1) and then kept in DocumentServer's
   forgotten-files store for the consumer to collect. Battery E2b proved a save still arrives after an
   API restart; it did not test reopening an editor URL across one.

## Updating DocumentServer, or changing its block

Only after a full battery run on the new release (E2). Recreating the container drops every open
editor and starts font generation again (F15). Its on-disk state survives in its named volumes;
what an open editor had not yet saved is battery E6e's record (ADR, "Capacity and restarts"). So:
drain first (no open editors: `quota.edit.connectionsCount` and `quota.view.connectionsCount` in
`info.json`, read inside the container), comment out the watchdog's cron line for the window, then
`docker compose -p monolith-dev up -d editor-documentserver-dev`, wait as in the first stand-up, and
restore the cron line. To change only `local-production-linux.json`, edit the file in place and
`docker compose -p monolith-dev restart editor-documentserver-dev`: the file is bind-mounted, and a
file replaced by a new inode is seen only after a recreate.

## Rollback

Repoint `editor-api-dev` to the previous SHA (the compose file's history on the box) and
`up -d --no-deps editor-api-dev`. The editor keeps no database, so there is no schema to revert.

## The converter watchdog (ADR F17)

DocumentServer's converter serves conversions and every editor open and save. If it wedges, the
API's probe (`GET /health/converter`, loopback only) fails; after two failed runs the watchdog waits
for open editors to close (at most 15 minutes from the first), restarts DocumentServer with
`docker compose restart` (the same container: fast, no recreate), waits for its health check and font
generation, and probes again. Every step goes to its log; alerts are printed for cron's mail. Its exit
codes are listed in the script. Proven on the pinned release by battery E6b (and by a simulation of
its failure paths during the EDIT-6 review).

## Capacity

Measured by battery E6c on the pinned release (EDIT-6.4); the memory limits in the fragment come
from it. Figures and the VPS budget they take are in the ADR.

## Secrets

Every secret added or rotated changes in 1Password, the VPS env file, and Google Secret Manager in
the same change (the playbook's Secret Lifecycle rule). Seal keys rotate by putting the new key first
and keeping the previous one until the longest session has expired (12 hours).

## Hostname binding

Every consumer on the box calls the same name, `editor-api`, so hostname binding cannot tell them
apart, and only one consumer can be bound to a hostname. In dev, consumers stay unbound and rely on
their own credentials; the prod stand-up decides per-consumer hostnames if off-box consumers return.
