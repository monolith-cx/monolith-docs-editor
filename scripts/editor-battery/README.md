# Editor battery

A repeatable check of OnlyOffice DocumentServer behaviour that UDOC depends on (EDIT-1, parent UDOC-1.1). It rebuilds the 2026-10 spike harness as a script: a scratch stack, synthetic fixtures, and real-editor checks in Chrome.

```bash
pnpm --filter @monolith-docs/editor-battery battery            # everything, then tear down
pnpm --filter @monolith-docs/editor-battery battery --only 3,7cl --keep   # some items; leave the stack up
pnpm --filter @monolith-docs/editor-battery battery --only 9c --reuse     # attach to a kept stack
pnpm --filter @monolith-docs/editor-battery battery --image onlyoffice/documentserver:<tag>@sha256:<digest>
```

Each run writes `docs/spikes/results/<release>/<date>.{md,json}`. The date is UTC, so an evening run in Pacific time carries the next day's date. A partial run (`--only`) gets a `-partial-<time>` suffix. A release counts as proven only by a full run with no `fail` or `error`; a `blocked` item keeps the release unproven on that item until it runs or Josh waives it in writing. `--render <json>` regenerates a run's Markdown from its JSON.

Prerequisites: Docker with Compose v2, the system Google Chrome (Playwright drives it through `channel: 'chrome'`), and poppler-utils (`pdffonts`, `pdftotext`). The compose project name and the loopback ports are fixed, so only **one battery runs at a time** on a machine.

Result values:

| Value | Meaning |
|---|---|
| `pass` | Proven. |
| `finding` | Passes its acceptance, but shows a behaviour the owner must see (the loose-lock removals). |
| `record` | A measurement that later design steps cite. |
| `blocked` | Needs something the machine lacks. |
| `fail` / `error` | Did not hold, or did not run. |

## What it starts

`compose.yml`, project `editor-battery`, all ports on loopback:

| Service | Port | Role |
|---|---|---|
| `ds` | 18200 | DocumentServer at the pinned tag and digest (`src/run.mjs` `PINNED_IMAGE`), JWT on, private addresses allowed so it can reach the stub (U12 turns this off to test the default), hardened as every deployment is (EDIT-2): `aiSettings.enable: false` from `infrastructure/onlyoffice/local-production-linux.json` and `PLUGINS_ENABLED=false` |
| `stub` | 18201–18203 | A consumer stand-in: fixtures, editor pages, the probe plugin, the callback receiver, a panel page on a second origin, and a third origin for CORS. The receiver answers `ok`, `error` (HTTP 200 `{"error":1}`), `http401`, `http429`, `http500`, `http503`, or `hang`, and records a per-field fingerprint of each signed payload (never the values) |
| `api` | 18204 | This repo's `apps/api`, rebuilt from its Dockerfile on every run (`up --build`), `EDITOR_ENV=local`, with two consumers: `battery` (every profile, notifications to the stub's `/consumer-callback`) and `legacy` (the legacy request shape only) |

The JWT secret, seal key, notification secret, and both consumer API keys are random for each run. They are written to `.work/.secret` (gitignored) only with `--keep`, so that `--reuse` can attach.

The stub's `/consumer-callback` verifies each notification's signature and records whether it was valid, the `deliveryId` and its header, the status, and what it answered; `/control/consumer-mode` makes it fail the next N notifications with a chosen status (E2c).

## How it drives the editor

- **Input:** keyboard and mouse input are real (Playwright with the system Chrome).
- **Document reads and plugin API calls:** these run inside the probe plugin's frame (`stub/plugins/probe`, test-only, never served by the service).
- **Selections:** made with `Search` and `ExpandTo`. Character offsets taken from `GetText` do not match `GetRange` positions once content controls are present.
- **Clipboard:** headless Chrome runs no Ctrl+C or Ctrl+V. Copying therefore uses the editor's own handler through `execCommand('copy')` after a real click. Pasting uses the plugin method `PasteHtml` with the HTML the editor wrote. A cut is that copy followed by Delete.
- **Saves:**
  - force-saves go through the command service, retrying while it answers `error 4` (changes not yet on the server);
  - close-saves wait about 5 seconds before closing the tab, because keystrokes the browser has not yet sent are lost (U14).

## Items

| Group | Items |
|---|---|
| Stack and service | S0; S1 (a `document` session through the service, signed notifications), S2 (the exact legacy request bodies) |
| EDIT-2 acceptance | E2a (the `document` profile's UI; F16), E2b (a service restart between edit and save), E2c (consumer 503 and 401, then recovery), E2d (drop with and without edits), E2e (tampered token, refusals at open) |
| Spike items on the pinned release | 3, 4, 5, 7, 8, 9a–9e, each field item on `sdtContentLocked` and `contentLocked` (`cl` suffix) |
| Loose-lock behaviour | 7d (delete with the sentence), 7p (copy-paste), 7x (cut-and-paste) |
| Unproven before EDIT-1 | U1–U14 (see the plan's EDIT-1.5) |

## Safety

- Fixtures are generated, and every value in them is made up.
- Nothing leaves the machine except image pulls.
- Results go to `docs/spikes/results/<release>/<date>.{md,json}` (`--only` runs add `-partial-<hhmm>`); a second run on the same date gets its start time, so a record is never overwritten.
- DocumentServer plus Chrome needs several GB of memory. Check `~/bin/heavy` first, and run one battery at a time.
