# Checkpoint review — EDIT-6.1–6.5 (the local half) — attempt 1 (Sonnet)

Date: 2026-10-18. Reviewer: Sonnet (in-session subagent, fresh context, read-only).

**What the reviewer ran:**
- API: 234 tests, typecheck, lint.
- `node --check` on the battery files; `bash -n` on the watchdog.
- A simulation of the watchdog against a stub `docker compose`, covering eleven scenarios.
- `docker compose config` on the fragment.
- The image's nginx configuration, read with `docker save`.
- The battery records 2339, 0005, 0022, and 0028, against the plan and the ADR figures, and the record times against the file times.

**Verdict:** PASS-WITH-NITS. No Critical or High findings; 6 Medium and 11 Low.

## Medium

1. **M1. No alert reached a person.** The cron line redirected all output to a file. Cron mails only what a job prints, so nothing was ever mailed.
2. **M2. Caddy would replace the editor page's `Referrer-Policy: no-referrer`** with `strict-origin-when-cross-origin`. The `-Server` delete defers the header block, and the editor URL's path is a capability.
3. **M3. Service names would collide once prod exists.** The shared Caddy joins both environments' networks, so `editor-api` would resolve in both.
4. **M4. A wrong `API_INTERNAL_URL` passed the startup check.** The check compared origins only, so a trailing slash or a path passed while breaking every internal URL.
5. **M5. Log retention.**
   - DocumentServer's log retention was unset, though `ERRORS.md` said EDIT-6 sets it.
   - Neither container had a log-rotation driver.
   - Caddy's error log records request URIs.
6. **M6. An API deploy could recreate DocumentServer.** `up -d editor-api` also converges DocumentServer. A recreate's consequences were understated, because DocumentServer's internal databases looked unpersisted.

## Low

- **L1. Stale state.** The failure count and the drain clock survived a run with no answer.
- **L2. An unwritable state directory** made the watchdog silently do nothing.
- **L3. Restart errors** were discarded.
- **L4. The exit-code comment** was incomplete.
- **L5.** `08-hosting.mjs` changed after record `-0005`.
- **L6. The ADR's E6b bullet** was stale: run 2 waits and run 3 restarts.
- **L7. Evidence overclaimed.**
  - E6d tests plain GETs, not the WebSocket, TLS, or forwarded headers.
  - `/info/info.json` was not checked through Caddy.
  - The README's E2b claim said more than E2b tests.
- **L8. Deviations from the playbook went unstated:** DocumentServer comes from Docker Hub, and deploys are by hand.
- **L9. Monitoring and resources.**
  - The containers are not in `health-check.sh`.
  - The fragment's health check was weaker than the image's own.
  - The font-generation memory peak was not measured.
- **L10. Operational gaps.**
  - The watchdog was not paused for a planned DocumentServer update.
  - The README did not say that hostname binding cannot separate consumers on the box.
  - The README's compose commands lacked the working directory.
- **L11.** `auth.ts` imported the converter module.

## Author's resolution (2026-10-18)

### M1, alerts

- **Change:** every step goes to the watchdog's own log (`WATCH_LOG`). Alerts are also printed, so cron mails them:
  - the converter wedged and waiting;
  - restarting, and the outcome;
  - no answer from the probe;
  - state it cannot keep.
- **Change:** the cron line has no redirect. The README says mail needs the box's local mail to be deliverable.
- **Evidence:** E6b asserts that run 1 prints nothing and that the waiting and restart runs print their alerts (`2026-10-19-partial-0057`).

### M2, Referrer-Policy

- **Change:** `Referrer-Policy` is removed from the Caddy block, and the block says why.
- **Evidence:** E6d asserts the editor page has `Referrer-Policy: no-referrer` through Caddy (`-0057`).

### M3, names

- **Change:** the services are `editor-api-<env>` and `editor-documentserver-<env>`. The API keeps the alias `editor-api` on its own environment's network only. Caddy targets the `-dev` names.
- **Change:** the battery carries the `-dev` aliases. The ADR, the plan, guidance E9, `CLAUDE.md`, the watchdog's defaults, and the README are updated.

### M4, `API_INTERNAL_URL`

- **Change:** the check is an exact match. The test now refuses a trailing slash and a path.

### M5, logs

- **Finding:** DocumentServer's logs are rotated by the image's own logrotate: daily, 30 kept, compressed (`/etc/logrotate.d/ds.conf`).
- **Change:** `json-file` rotation (10 MB × 3) on both containers.
- **Observed:** Caddy's error log, in a `caddy:2.10.2` container with no upstreams, wrote the full URI of `/editor/<token>?…` and of a signed cache URL.
- **Recorded in:**
  - a new `ERRORS.md` entry;
  - the ADR;
  - the Caddyfile comment;
  - the runbook's step 6 and plan 6.6, which decide it at the stand-up.
- **Recorded in:** the DocumentServer-logs `ERRORS.md` entry, updated with the retention.

### M6, recreates

- **Change:** the runbook deploys with `up -d --no-deps` and says why. It notes that `vps-deploy.sh` lacks it.
- **Finding:** checked on the pinned image, 10.0.0.1 runs no PostgreSQL, RabbitMQ, or Redis of its own. A throwaway container ran only `docservice`, `converter`, nginx, cron, and font generation.
- **Change:** the fragment mounts the image's declared directories as named volumes: `Data`, `/var/lib/onlyoffice`, and the logs. An interim draft also named `/var/lib/postgresql`, `rabbitmq`, and `redis`; those were removed once the check showed this release does not use them.
- **Evidence:** a new battery item, E6e (`-0057`), records a restart in place with unsaved typing. With a healthy converter, DocumentServer sent the final save one second in, with the edit, and the editor showed "Connection is lost". The wedged-converter case is stated as unmeasured.
- **Change:** the runbook explains bind-mounted configuration and a restart.

### L1–L4, the watchdog

- **Changes:**
  - L1: a run with no answer clears the count and the drain clock.
  - L2: an unwritable state directory or log exits 5 with a message.
  - L3: a failed restart's last line is alerted, and the next run retries.
  - L4: the exit codes are listed in the header.
- **Evidence:** a fake-compose simulation in the scratchpad showed silent healthy runs, exit 1, exit 2 with the state reset, waiting, exit 3 with the daemon's error, exit 4, and exit 5.

### L5–L7, evidence and claims

- **L5:** E6a, E6b, and E6d were re-run with E6e after every change (`-0057`), and pass.
- **L6:** the ADR is rewritten with the three-run sequence.
- **L7:**
  - E6d now also checks that `/info/info.json` is 403 and the editor page's `Referrer-Policy`.
  - The ADR and the plan say TLS, HSTS, the WebSocket, and forwarded headers are proven at 6.7.
  - The README's E2b claim now says only what E2b tests.

### L8–L11, the rest

- **L8:** both deviations are named in the README and in ADR decision 5.
- **L9:**
  - Plan 6.6 and the runbook add both containers to `health-check.sh`.
  - The fragment's health check is the image's own, so the body must be `true`.
  - The runbook watches memory and `OOMKilled` over the first start.
- **L10:**
  - The runbook pauses the watchdog's cron line for a planned update.
  - A hostname-binding section is added.
  - Commands run in `/srv/monolith/dev` with `-p monolith-dev`.
- **L11:** `health-paths.ts` holds the probe's paths. `auth.ts` imports it, not the converter module.

### Verification after the fixes

- **API:** 234 tests, plus the IPv4-mapped loopback cases; typecheck and lint clean.
- **Plugin:** 38 tests.
- **Validation:** workspace validation passes.
- **Compose:** the root, battery, and fragment files pass `config`.
- **Caddy:** `caddy validate` passes.
- **Watchdog:** `bash -n` passes.
- **Battery `-0057`:** E6a, E6b, and E6d pass; E6e is recorded.
