# EDIT-4 deploy and log purge — runbook

## Run result (2026-10-17): stopped at step 0 — there is no environment

Josh approved the full run on 2026-10-17 after `gcloud auth login`. The read-only survey (step 0) found:
- `gcloud compute instances list --project=monolith-docs`: **no instances**;
- `gcloud compute addresses list`: no reserved addresses;
- other accessible projects: no editor VM;
- `https://connect.monolithdocs.com/health` and `crm.`: **530** (Cloudflare error 1033, no tunnel connector);
- `https://app.monolithdocs.com/health`: timeout.

The cause is recorded in `deploy-pipeline-parity/plan.md` (Phase 4 note, 2026-06-12). Both VMs had been stopped for about two months. On 2026-06-12 they, their boot disks, and the `34.44.51.7` IP were **deleted** to stop spend. Final snapshots were kept: `monolith-docs-final-20260612` and `monolith-docs-dev-final-20260612`. The firewall rules remain.

Per Josh's instruction ("stop if anything at a check is unexpected"), nothing was pushed, deployed, or purged.

What this means:
- **Deploy:** there is nothing to deploy to. EDIT-4 ships with the next stand-up of the editor (EDIT-6 / DOC-DPP Phase 4, revised to a from-scratch us-west1 stand-up). Steps 1–3 below apply to that stand-up, minus the `deploy.sh prod` naming caveat once DOC-DPP fixes it.
- **Purge:** no live log exists. The only remaining copies of the old logs are inside the two snapshots. The signed URLs in them expired long ago (hours), and so did the editor sessions. The snapshots also serve as the environment's only backup, so purging them (deleting the snapshots, or restoring, scrubbing, and re-snapshotting) is a separate decision for Josh, not part of this runbook.

---

Drafted 2026-10-16 for Josh's approval. The steps below were never run. Every step that changes a hosted environment is marked **[changes env]**. The purge steps are irreversible and are marked **[irreversible]**.

## Why not just `infrastructure/gce/deploy.sh`

1. **Its prod target may not be live prod.** `deploy.sh prod` targets `monolith-docs-prod` in `us-west1-a`. `ERRORS.md` (2026-04-18/19) records live prod as the VM `monolith-docs` at static IP `34.44.51.7`, and DOC-DPP's us-west1 prod migration (Phase 4) is still planning. If `monolith-docs-prod` does not exist, the script **creates a new VM and firewall rule**. Step 0 checks; this runbook never runs `deploy.sh prod`.
2. **It upgrades DocumentServer as a side effect.** `startup.sh:153` runs `docker compose pull onlyoffice` on the floating `8.3` tag. A newer 8.3.x image would recreate the DocumentServer container and drop every open editor. Version changes belong to EDIT-1, so this runbook rebuilds **only the `api` service**.
3. **It does not touch nginx.** The nginx config is copied by hand (`startup.sh:185-187`).

## Preconditions (Josh)

- [ ] `gcloud auth login` (interactive; the stored token expired, and a session cannot prompt). The project is `monolith-docs`.
- [ ] Approve the push of `main` (`0158323`, `9f54904`) to Forgejo `origin`. Forgejo push-mirrors it to the public GitHub mirror, which the VMs clone from (`startup.sh:14`). The repo is AGPL and the mirror is public by design.
- [ ] Approve each **[changes env]** and **[irreversible]** group below. Answering "yes to the runbook" approves all of them in order. Anything unexpected at a check stops the run for a new decision.

## 0. Read-only survey

- `gcloud compute instances list --project=monolith-docs`: identify live prod and dev (name, zone, status, IP). Confirm prod's IP is `34.44.51.7`.
- On each running VM over SSH:
  - `/opt/monolith-docs/.deploy-state/{current,previous}-sha` and `git -C /opt/monolith-docs rev-parse HEAD`;
  - `docker compose ps` and `docker info --format '{{.LoggingDriver}}'`;
  - whether `google-cloud-ops-agent` or another log shipper is installed;
  - `ls -la /var/log/nginx`;
  - the size of the `onlyoffice-log` volume;
  - the installed nginx site (`diff` against the repo's file).
- Activity: `docker compose logs api --since 2h | grep -c 'Document session created'`, to pick a quiet moment. An `api` restart loses the in-memory session map. Open editor pages then show "Session not found" on reload, and a save notification for a lost session is dropped. Today's consumers are `fastmail-connect` (view-only) and the Connect extension (editable, no callback), so no consumer save is lost. Check anyway.
- **Stop here** if prod is not where `ERRORS.md` says, or if a log shipper exists (purging a shipped copy is a separate decision).

## 1. Push **[changes env: remote]**

- `git push origin main`, then confirm GitHub shows `9f54904`. The mirror can lag; wait or trigger a sync.

## 2. Dev first **[changes env]**

The dev VM `monolith-docs-dev` (us-west1-a) is normally `TERMINATED`.
1. `gcloud compute instances start monolith-docs-dev --zone us-west1-a`.
2. Deploy over SSH (the API only):
   ```bash
   cd /opt/monolith-docs && PREV=$(git rev-parse HEAD) && sudo git fetch --prune origin && sudo git checkout --detach 9f54904 && sudo docker compose up -d --build --no-deps api
   ```
   Record `PREV` and `9f54904` in `.deploy-state/previous-sha` and `current-sha`.
3. Check health: `curl -fsS 127.0.0.1:3020/health` and `/api/status`.
4. Log check:
   - make a request that fails at open and one that opens and saves, against `127.0.0.1:3020`, using the dev consumer from `.env` or none if dev has auth off;
   - `docker compose logs api --since 10m | grep -Ec 'https?://[^ "]*[/?]'` must be 0.
5. nginx:
   - back up `/etc/nginx/sites-available/monolith-docs.conf` to `…conf.bak-20261016`;
   - copy the repo's file in, `nginx -t`, `systemctl reload nginx`;
   - `curl -k https://127.0.0.1/editor/x?y=1 -H 'Host: app.monolithdocs.com'`;
   - check that `tail /var/log/nginx/monolith-docs.access.log` shows `/editor/[redacted]`.
6. Leave dev running for step 4's purge, then stop it again (`gcloud compute instances stop`).

## 3. Prod **[changes env]**

The same as dev steps 2–5 on the live prod VM, at the quiet moment chosen in step 0.

Then check from outside:
- `https://app.monolithdocs.com/health`: 200;
- `/api/status`: 403 (blocked on the public host by design);
- `https://connect.monolithdocs.com/health` and `https://crm.monolithdocs.com/health`: 200;
- a `fastmail-connect` attachment preview opens (Josh, or skipped and recorded).

**Rollback:**
```bash
cd /opt/monolith-docs && sudo git checkout --detach "$PREV" && sudo docker compose up -d --build --no-deps api
```
For nginx: restore `…conf.bak-20261016`, `nginx -t`, reload.

## 4. Purge **[irreversible]**, on each VM, after its step 2 or 3 passed

- **API container logs:** `up --build` recreates the `api` container and Docker deletes the old container's log file with it. Confirm that the new container's log has no line older than the deploy.
- **DocumentServer container stdout** (its services log at WARN with `DOCID`): `sudo truncate -s 0 "$(docker inspect --format '{{.LogPath}}' <onlyoffice container>)"`. The container keeps running; this applies only when the logging driver is `json-file`. If it is `journald`: `sudo journalctl --rotate && sudo journalctl --vacuum-time=1s`, which removes **all** journal history on the VM, so it gets its own confirmation.
- **The DocumentServer log volume:** `docker compose exec onlyoffice sh -c 'find /var/log/onlyoffice -type f -name "*.log*" -exec truncate -s 0 {} +'`.
- **Host nginx:**
  ```bash
  sudo find /var/log/nginx -type f -name '*.gz' -delete && sudo truncate -s 0 /var/log/nginx/*.log /var/log/nginx/*.log.1
  ```
- **Out of scope, recorded:** disk snapshots and any external sink found in step 0.
- **Verify:** `sudo grep -rIlE 'X-Goog-Signature|md5=|/editor/[0-9a-f-]{36}' /var/log/nginx` finds nothing, and the same check inside the DocumentServer volume finds nothing.

## 5. Record

- Plan EDIT-4.3 status with the date, SHAs, and VMs.
- Both handoffs; the parent's UDOC-1.4 status.
- Move the `ERRORS.md` "not yet deployed" notes to "deployed <date>".
- Any surprise found in step 0 goes to `ERRORS.md`.
