# The acceptance stub consumer (EDIT-6.7)

A stand-in product on `monolith-dev`. It lets the hosted editor be accepted end to end before a real consumer exists: the editor framed with the panel, a signed save notification verified, and DocumentServer's save URL origin checked (ADR F2). It is not a product and holds no customer data. It runs for an acceptance run and is stopped afterwards.

`server.mjs` has no dependencies. Its routes are listed at the top of the file. It stores no secret, token, or URL: only facts, in memory and bounded (the last 200 results, 100 issued keys, 1000 delivery ids; unauthenticated refusals are only counted). Its tests are `scripts/editor-battery/test/acceptance-stub.test.mjs`; the runner's pass rule is `scripts/editor-battery/src/hosted-acceptance-check.mjs`, tested beside it.

## On the box

| Piece | Where |
|---|---|
| Host | `editor-stub-dev.monolith.cx`, an A record to the VPS (DNS only) |
| Files | `/srv/monolith/dev/editor/stub/`: `server.mjs`, `panel/bridge.html` (copied from `scripts/editor-battery/stub/panel/`), `fixtures/acceptance.docx` (built by the battery's `buildDocx(contractBody('contentLocked'))`, synthetic) |
| Env file | `/srv/monolith/dev/env/editor-stub-dev.env` (`deploy:monolith-deploy` 0640): `CONSUMER_HMAC_SECRET`, `NOTIFY_SECRET` (the API's `EDITOR_NOTIFY_SECRET_ACCEPTANCE`), `LAUNCH_KEY` |
| Consumer | `acceptance` in `editor-api-dev.env`'s `CONSUMERS` |

Compose service, added to `/srv/monolith/dev/docker-compose.yml` under the deploy lock:

```yaml
  editor-stub-dev:
    image: node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85
    command: ["node", "/stub/server.mjs"]
    init: true
    env_file: [/srv/monolith/dev/env/editor-stub-dev.env]
    environment:
      PORT: "8080"
      STUB_DIR: /stub
      STUB_ORIGIN: https://editor-stub-dev.monolith.cx
      EDITOR_API: http://editor-api:3020
      EDITOR_PUBLIC_ORIGIN: https://editor-dev.monolith.cx
      CONSUMER_ISSUER: acceptance
    volumes: ["/srv/monolith/dev/editor/stub:/stub:ro"]
    read_only: true
    user: node
    networks: [monolith-dev]
    restart: "no"
    mem_limit: 128m
    logging:
      driver: json-file
      options: { max-size: "5m", max-file: "2" }
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://127.0.0.1:8080/health"]
      interval: 15s
      timeout: 5s
      retries: 3
```

The box's service (2026-11-02) predates `init: true`: without it, node runs as PID 1, ignores SIGTERM, and the stub exits 137 when stopped. Add it at the next compose change.

The consumer entry in `CONSUMERS`, with the secret written by the secrets script and never shown:

```json
{"id":"acceptance","name":"Acceptance stub","auth":{"mode":"hmac","secret":"<CONSUMER_HMAC_SECRET>","issuer":"acceptance"},
 "profiles":["document","view"],"callbackUrl":"https://editor-stub-dev.monolith.cx/callback",
 "notificationSecretRef":"EDITOR_NOTIFY_SECRET_ACCEPTANCE","panelOrigins":["https://editor-stub-dev.monolith.cx"],
 "returnOrigin":"https://editor-stub-dev.monolith.cx","fileHosts":["editor-stub-dev.monolith.cx"],
 "convertSourceHosts":["editor-stub-dev.monolith.cx"],"convertUploadHosts":["editor-stub-dev.monolith.cx"]}
```

Caddy: a site block, and the stub's error logger added to the editor's URI filter, because the launch URL carries the key:

```caddy
editor-stub-dev.monolith.cx {
	log editor-stub {
		output discard
	}
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options nosniff
		-Server
	}
	reverse_proxy editor-stub-dev:8080
}
```

In the global block, `include http.log.error.editor http.log.error.editor-stub` on the `editor-errors` logger, and the same two names on `default`'s `exclude`.

## A run

The runner is `scripts/editor-battery/src/hosted-acceptance.mjs` (`node src/hosted-acceptance.mjs` from that package, with the stub running): it reads the launch key from 1Password itself, drives Chrome through the public hosts, and prints facts. By hand:

1. Start the stub with `docker compose -p monolith-dev up -d --no-deps editor-stub-dev`.
2. Open `https://editor-stub-dev.monolith.cx/launch?k=<LAUNCH_KEY>` in a browser.
3. Type, save, and close.
4. Read `https://editor-stub-dev.monolith.cx/results?k=<LAUNCH_KEY>`.
5. Stop the stub with `docker compose -p monolith-dev stop editor-stub-dev`.

Keep the launch key out of shell history and logs: read it from 1Password into the browser or the runner.
