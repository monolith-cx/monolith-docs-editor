# Monolith Docs — Residual Errors

Durable follow-up log for concrete errors found during sessions and left unresolved at a stopping point. Managed per the global `CLAUDE.md` residual-error logging discipline.

## Unresolved

- [ ] 2026-10-16 09:20 PDT - `apps/api/src/routes/documents.ts:182`, `:194-217` - OnlyOffice callback JWT is not bound to the callback body, and the editor page hands out a token signed with the same secret
  - Observed via: code reading during the EDIT plan review (udoc-editor-service, review attempt 1, 2026-10-16). `GET /editor/:key` signs the editor config with `ONLYOFFICE_JWT_SECRET` and embeds it in the page; the callback route only checks that `req.body.token` verifies under that secret (no algorithm pin, no claim check, no comparison with the body) and then trusts `req.body.key`, `status`, and `url`.
  - Impact: anyone holding an editor URL can POST a forged status-2 callback with an attacker-chosen `url`: the service then fetches it (`transferToGcs` when `saveTo` is set) and forwards it to the consumer as a save. Consumers that trust the notification can have a working document replaced.
  - Left unresolved because: planning-only session; fix is planned in EDIT-2.4 (take key/status/url from the verified payload, pin HS256, refuse editor-config tokens, require the `url` origin to be DocumentServer's).

- [ ] 2026-10-16 09:20 PDT - `apps/api/src/storage.ts:109-125`, `:73`, `:161-163`; `apps/api/src/routes/documents.ts:22-26` - `open` signs any `bucket/object` path with the service's own GCS identity, and `saveTo` writes to any bucket
  - Observed via: code reading during the EDIT plan review (2026-10-16). `resolveDownloadUrl` returns any http(s) URL unchanged and turns a bare `bucket/object` into a v4 signed read URL using the service account; `saveTo` takes an arbitrary bucket/object for write-back; `validateSourceUrl` is pattern-only and is skipped for any URL containing `://api:` or `://onlyoffice`.
  - Impact: any authenticated consumer can read (and, via `saveTo`, overwrite) any object the service account can reach, including another consumer's files; a crafted hostname containing `://api:` bypasses the SSRF check.
  - Left unresolved because: planning-only session; fix is planned in EDIT-2.3 (profile shapes take validated https signed URLs only; the GCS path form, `saveTo`, and the substring exemption are removed) and EDIT-3.1 (a resolving URL validator).

- [ ] 2026-04-19 11:30 MDT - `apps/api/src/routes/files.ts:58-90` - Upload handler accepts any bytes as long as the filename extension is allowlisted; no magic-byte validation
  - Observed via: Fastmail Connect preview pipeline. Worker at `connect-api` was posting Fastmail's `/login/` HTML page (7,407 bytes) to `POST /api/files/upload` with filenames like `1 - DSI VIP Pricing.xlsx` and `Schmittle_Settlement_Offer_Letter.docx`. Docs accepted and stored each one at `/tmp/monolith-docs-uploads/<uuid>.<ext>`. OnlyOffice fetched the bytes and failed with "file content does not match the file extension" on xlsx or rendered the login HTML inside the Word viewer on docx. Confirmed by dumping stored files on `monolith-docs` VM — every recent upload is the identical 7,407-byte `<!DOCTYPE html>` blob.
  - Impact: Silent garbage-in/garbage-out at the Docs boundary. When a consumer's upload pipeline breaks (auth failure, wrong URL, redirect to a login page, etc.), Docs stores whatever bytes it gets and the failure only surfaces two hops later inside OnlyOffice with an opaque error. Wastes debugging time and hides upstream defects.
  - Left unresolved because: Root cause of the current incident was Worker-side (fixed in the fastmail-connect repo). Docs-side hardening is a separate, non-urgent change that should validate at least the minimum sniff for supported formats: `PK\x03\x04` for OOXML (docx/xlsx/pptx), `%PDF` for PDF, `{\rtf` for RTF, etc., and reject with a clear 400 when the body doesn't match the declared extension. Also worth considering: reject `text/html` or `application/json` request bodies outright at the multipart boundary.

## Resolved

- [x] 2026-04-18 12:30 MDT - `https://app.monolithdocs.com/` - Cloudflare 522 "Origin connection timed out" on every request
  - Observed via: `curl -I https://app.monolithdocs.com/health` and `curl https://app.monolithdocs.com/api/status` from an external network. Response: `HTTP/1.1 522` with `CF-RAY` header and `error code: 522` body. Timeout ~15s.
  - Contrast: `connect.monolithdocs.com/health` and `crm.monolithdocs.com/health` both return 200 OK with correct security headers. Those go through Cloudflare Tunnel → GCE localhost:3020. `app.monolithdocs.com` goes through Cloudflare DNS → GCE public IP → NGINX :443 and that path is not responding.
  - DNS resolves correctly to Cloudflare edge IPs (172.67.214.31, 104.21.23.229, plus IPv6). Cloudflare edge reaches back toward the origin and times out before NGINX answers.
  - Impact:
    - Headless consumer editors (CRM, Connect) render OnlyOffice JS from `ONLYOFFICE_PUBLIC_URL` — production value is `https://app.monolithdocs.com` per `infrastructure/environments/{dev,prod}/env.example`. If `app.` is down, every editor session would fail to bootstrap its DocumentServer client. Either production is using a different `ONLYOFFICE_PUBLIC_URL`, or headless editors have been broken and no one noticed, or the outage is very recent.
    - The `standalone-app` initiative plan (SA-6.2) assumes `app.monolithdocs.com` is the DocumentServer public origin for standalone editor sessions too. That assumption is unsound until this is restored.
    - Phase I integration testing in the `production-hardening` initiative cannot close cleanly — Phase I.1 item "Public API blocked (app.monolithdocs.com/api/* → 403)" is untestable while the origin is unreachable, and Phase I.3 security-headers check on `app.monolithdocs.com` is untestable for the same reason.
  - Candidate causes to investigate on the GCE VM:
    - NGINX not running / crashed (`systemctl status nginx`)
    - GCE firewall rule `allow-monolith-docs-prod` (or `-dev`) no longer allows `tcp:443` from Cloudflare IP ranges
    - VM public IP changed since Cloudflare A record was set (`gcloud compute instances describe` vs Cloudflare DNS)
    - Cloudflare origin certificate missing or expired at `/etc/ssl/cloudflare/origin.{pem,key}`
    - VM reachable but NGINX config has a syntax error preventing it from binding 443
  - Root cause: Cloudflare DNS A record for `app.monolithdocs.com` was pointing at `35.226.254.167` — the IP of a terminated dev VM (`monolith-docs-dev`, now TERMINATED with no external IP). The actual prod VM `monolith-docs` runs at `34.44.51.7`. Cloudflare edge was faithfully trying to reach the stale IP and timing out.
  - Diagnosis path: external probe → 522; direct origin probe via `curl --resolve app.monolithdocs.com:443:34.44.51.7` → 200 OK (ruled out origin/NGINX/firewall/cert); `gcloud compute instances list` revealed the IP mismatch; Cloudflare dashboard confirmed the stale A record.
  - Resolved: 2026-04-18 via Cloudflare A-record update `35.226.254.167 → 34.44.51.7`. Re-probed: `app.monolithdocs.com/health` → 200, `/api/status` → 403, HSTS + X-Content-Type-Options + Referrer-Policy all present, HTTP → HTTPS 301 redirect, `/web-apps/apps/api/documents/api.js` → 200 `application/javascript`. OnlyOffice asset bootstrap path is live.
  - Follow-up hardening (not done as part of this fix, flagged for future consideration): GCE IPs aren't stable across VM recreations; the `production-hardening` Phase N setup relied on manual DNS maintenance. Consider either reserving a static external IP for the prod VM (so recreations preserve the IP) or scripting the DNS update into `infrastructure/gce/deploy.sh` via Cloudflare API. Not blocking — just a latent operational foot-gun that surfaced this time.
  - Follow-up closed: 2026-04-19 — `34.44.51.7` reserved as a static external IP on the prod `monolith-docs` VM. VM recreations will now preserve the IP and the Cloudflare A record for `app.monolithdocs.com` stays valid without manual DNS maintenance.
