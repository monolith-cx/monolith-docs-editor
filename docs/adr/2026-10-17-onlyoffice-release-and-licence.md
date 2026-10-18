# ADR: OnlyOffice DocumentServer release, licence posture, and what the battery found

- **Status:** Accepted for EDIT-1 (UDOC-1.1), 2026-10-17. Revisit on every release change (only through a battery run).
- **Initiative:** `udoc-editor-service` (EDIT-1), parent UDOC-1.1.
- **Evidence:**
  - battery runs in `docs/spikes/results/10.0.0.1/`; the full run is the one without a `-partial-` suffix;
  - the spike `docs/spikes/2026-10-contract-sections.md`;
  - the harness `scripts/editor-battery/`.

## Decision

1. **Pin `onlyoffice/documentserver:10.0.0.1@sha256:ca17889f10b11141cc6441836aebdd2835cf3e1b49681b2fd6e155c94b7850b3`.**
   - 10.0.0.1 (released 2026-10-12) is the newest Community release on 2026-10-17.
   - It was pinned by tag and index digest in `docker-compose.yml`, and the battery uses the same reference.
   - Earlier releases were ruled out:
     - 8.3, which the service ran, loses the inserted half of a tracked suggestion (spike 9c) and has no callback retries;
     - 9.4 drops field formatting on a live refill (spike 9g).
   - A newer release is adopted only after a full battery run on it.
2. **The image ships unmodified.** Configuration is supplied through DocumentServer's own environment variables and configuration files, not by changing its code or assets. Our panel plugin is a separate program, served by our service from its own origin (D14, E7), and is licensed AGPL-3.0 like this repository.
3. **No fallback from the parent's Risks is needed.** Every item the spike had not proved passed on 10.0.0.1:
   - a plugin creates a tagged `contentLocked` control, also with track changes on (U1, U1t);
   - per-session plugin data reaches the plugin (U2);
   - a consumer page runs inside the panel with two-way `postMessage`, and messages from another frame are refused on both sides (U3; source and origin are checked together, so the test cannot separate the two);
   - `getText` returns field spans, row ids, and kinds (U4);
   - drop produces a final save or a closed-without-changes notification (U8).

   The Word desktop round trip (U13) could not run (no machine with Word) and was **waived by Josh on 2026-10-18**.

## Licence posture

DocumentServer 10.0 is licensed under the AGPL v3 together with Ascensio System SIA's additional terms. These are appended to `/var/www/onlyoffice/documentserver/LICENSE.txt` in the image, and the 2026 file headers refer to them:

1. **Retain notices and attribution** (§§4, 5, 7(b)).
2. **Mark modified versions** as modified, with dates, as based on ONLYOFFICE.
3. **Show Appropriate Legal Notices in the UI.** They must identify ONLYOFFICE, say that the version may be modified, and give access to the licence.
4. **No trademark licence** (§7(e)).
5. **Non-code assets are CC BY-SA 4.0.**

Our posture:
- **Term 2** does not apply, because we do not modify the program.
- **Terms 1 and 3** mean the editor profiles must never remove DocumentServer's About entry or other legal notices through `customization`. EDIT-2.3's profiles keep them.
- **Term 4:** our products do not use ONLYOFFICE names or logos as their own.
- **AGPL §13:** users interact with an unmodified DocumentServer, whose corresponding source is upstream's; the About entry links it. This repository's own AGPL code is published through the public mirror.

This is an engineering record, not legal advice. Josh's licence decision (Developer Edition or AGPL peer) is EDIT-7.

## Findings that change the design

Each finding names the step that absorbs it. Item ids refer to the battery.

| # | Finding on 10.0.0.1 | Consequence |
|---|---|---|
| F1 | DocumentServer retries a callback only when the consumer answers HTTP 429 or 5xx (measured for 500, 503, and 429: 4 attempts each, 1 s / 2 s / 4 s apart; configuration read from the image: `callbackBackoffOptions` 3 retries, factor 2, `httpStatus` `429,500-599`). An HTTP 200 with `{"error":1}`, or a 401, gets exactly one attempt. **Only the final save (status 2) is retried.** A failed force-save (status 6), closed-without-changes (status 4), or connect (status 1) notification gets exactly one attempt, even on 503 (U5). Every unacknowledged final save lands in the **forgotten-files store** (`getForgottenList` / `getForgotten` / `deleteForgotten` return it), while an acknowledged save does not (control) (U5). 8.3's `default.json` sets `callbackBackoffOptions.retries` to 0 (read from the local `onlyoffice/documentserver:8.3` image on 2026-10-17). | EDIT-2.4: when the consumer is unreachable or failing, the service answers DocumentServer with HTTP 503, not `{"error":1}` (corrects E6). Recovery after the roughly 7-second retry horizon is the forgotten-files endpoint, which the guide documents. A missed status-6, 4, or 1 notification is not redelivered. The guide therefore makes the closing sequence's final save (status 2, retried and kept as forgotten) the authoritative copy, treats force-save notifications as best effort, and has the consumer re-derive lock state from the next notification or the drop's answer. |
| F2 | The callback's JWT arrives in the `Authorization` header with the body wrapped in `payload`; the copy in the body's `token` is flat. The save `url` carried DocumentServer's public origin as the browser reached it. That was seen on loopback only and is re-verified behind nginx and the tunnel at EDIT-6. Across retries of one save, `url` and `changesurl` change (each send re-signs them: `md5`, `expires`) and the tokens' `iat` and `exp` move. `key`, `status`, `lastsave`, `history`, `users`, `actions`, `filetype`, and `notmodified` stay the same. Two force-saves of one document carry different `lastsave` values (U5). | EDIT-2.4: verify the header form and use `payload`'s fields; accept the configured set of DocumentServer origins. `deliveryId` = SHA-256 over `key`, `status`, `lastsave` (plus `forcesavetype` for status 6), never `url` and never the raw body. |
| F3 | `externalRequest.directIfIn.jwtToken` is `true` by default. With private addresses disallowed, a JWT-signed config naming a private-address document was fetched, its callbacks reached the private-address consumer, and a signed conversion succeeded. With `jwtToken` set to `false` through configuration (the control), the document was not fetched (so no callbacks could follow) and the conversion was refused with `-4` (U12). That is how the old `http://api:3020` flows worked without `ALLOW_PRIVATE_IP_ADDRESS`. | The service, which signs every config and command, is the only gate for document, callback, and conversion URLs. EDIT-2.2's resolving validator is mandatory, and EDIT-3 must not rely on DocumentServer's filter. Setting `jwtToken` to `false` would add defence in depth, but it would also block the intended internal hosts (the service's own callback route, `http://api:3020`) unless they are allow-listed in `directIfIn.allowList`. Decided at EDIT-6, with the hosting. |
| F4 | A server-side AI feature is on by default: `aiSettings.enable: true`, with a browser proxy, `allowBrowserProxy: true`. No AI tab shows in the default UI. `customization.plugins: false` would also stop our own bridge plugin (U9). | EDIT-2.3: switch AI off in DocumentServer's own configuration for every environment (`aiSettings.enable: false`), not in the editor UI. The battery has not yet exercised that switch; EDIT-2.3 verifies it. Record it in the hosting setup (EDIT-6). |
| F5 | Ten built-in plugins load by default, several of which can send content to third parties: translator, youtube, zotero, mendeley, ocr, speech, and others. A plugin marketplace is also present (U9). | EDIT-2.3: the `document` and `template` profiles must keep document content away from third-party plugins. Mechanism to be chosen at EDIT-2 (DocumentServer's default plugin list through configuration, without modifying the image). Until then the battery records the list on each release. |
| F6 | DocumentServer's own logs still name documents. The services log at WARN with `DOCID`. A new internal nginx access log (JSON, `$uri` without query strings) records `/cache/files/data/<key>_…` paths. Its nginx error log records request lines (U10–U11). | The `ERRORS.md` residual for DocumentServer's logs stands. EDIT-2's sealed tokens make keys non-capabilities, and the hosting setup (EDIT-6) sets retention for the `onlyoffice-log` volume. |
| F7 | Connection statistics (`/info/info.json`) are served only to `127.0.0.1` inside the container (U10). | The deploy drain check reads them with `docker exec … curl http://127.0.0.1/info/info.json`, as the runbook proposed. |
| F8 | Files stay in DocumentServer's cache for 24 h (`expire.files`) and downloads are capped at 100 MB (`maxDownloadBytes`) (U12). | EDIT-3: the guide states that a converted file stays in DocumentServer's cache for up to 24 h. The service's own input cap must sit at or below 100 MB. |
| F9 | **The loose lock `contentLocked`** (D11's ruling) behaves as follows (7cl, U1, U1t, U1d, reported as `finding`, not `pass`; 7dcl, removal with the sentence, is the expected D11 behaviour and passes). <br>• A field is never changed partly. <br>• Selecting it and typing deletes the whole field, and the typed character is dropped. <br>• Two Backspaces right after it delete it. <br>• A selection across it deletes it with its sentence. <br>With `sdtContentLocked`, all of these are refused (7, 7d). | D11 holds: the value cannot be altered. The field, however, is a unit a rep can remove with ordinary keystrokes, and the server sees a missing field row (D16; required fields block finalize). **Josh confirmed on 2026-10-17 that D11 stands with this behaviour** (recorded in the parent guidance's Owner rulings). |
| F10 | Copy-paste of a span holding a field duplicates the field, with its tag and lock, under both locks. Cut-and-paste moves a loose field. A strict field refuses deletion, so a cut copies it (7p, 7x). The clipboard was **simulated**: headless Chrome runs no Ctrl+C or Ctrl+V. The copy used the editor's own handler (`execCommand('copy')` after a real click), the paste went through the plugin method `PasteHtml` with that HTML, and a cut was copy plus Delete. A real-clipboard check, and a paste from another document (D16's stripped case), belong to EDIT-5's corpus. | D16 already treats copies of a known row as valid and refreshes every copy. A pasted control from another document is stripped by D16. No change. |
| F11 | Keystrokes typed in the last moment before a tab closes are lost: the editor had not sent them (U14). Drop saves what the server holds within about 0.5 s (U8). | The D13 closing sequence (drop, then await the final save) is the right primitive. CRM's page should warn before unload while the editor has unsent changes (UDOC-3.3 note). |
| F12 | Tracked changes render in the ConvertService PDF as both the deleted and the inserted text. Comments are dropped (U7). | D16's finalize rule (no pending tracked changes or comments) is required, not optional. |
| F13 | Autocorrect capitalises the first word after a full stop. | UX only. The battery types digits first. |
| F14 | One user in two tabs produces three status-1 notifications: connect, connect, then a disconnect (`actions` type 0) when one tab closes, while `users` still lists the user. The two connects are indistinguishable apart from the token. The last close sends status 4, not another disconnect (U6). **Statuses 3 and 7 (save errors) were not measured**: they could not be provoked without breaking DocumentServer. | EDIT-2.4 and the consumer guide: release an edit lock only when a status-1 notification's `users` list is empty, or on status 4 or a final status 2, never on a bare disconnect. Statuses 3 and 7 follow OnlyOffice's documentation: no file, report it, keep the key open. |
| F15 | After every container start, the image's entrypoint generates fonts in the background. The healthcheck already passes during that time. When generation finishes, about 2 minutes after start, the entrypoint **restarts `docservice` and `converter`** (`documentserver-generate-allfonts.sh` calls `supervisorctl restart`). Every open editor then shows "Connection is lost" (warning −18), and the server forgets its session, so a force-save answers `error 1`. Found when a battery item opened its editor inside that window. | Hosting (EDIT-6): a deploy routes users to a new container only after font generation has finished (`pgrep -f '[d]ocumentserver-generate-allfonts'` is empty and the healthcheck answers). Alternatively, prebuild the fonts (for example a persisted `AllFonts.js`) so that startup does not regenerate them. The battery waits for the same condition after every start and restart. |

## Consequences

- `docker-compose.yml` runs 10.0.0.1, so any future stand-up gets the release proven here.
- EDIT-2's design absorbs F1–F5. Its plan text is updated with these corrections before EDIT-2 starts.
- Josh confirmed F9 (D11 stands) on 2026-10-17. U13: Josh waived U13 in writing on 2026-10-18 ("Just waive it"): there is no Word desktop on the battery host or on Josh's Windows machine (OnlyOffice desktop only). D16's validation of every returned file is the safeguard for files edited elsewhere; `--only U13` re-runs the check when Word is available.
