# Consumer integration guide

How an app (a *consumer*) opens documents in the Monolith editor service, receives saves, and
closes sessions. This is the service side of the ecosystem contract `document-editing.md`
(UDOC-2.1, drafted in Platform under `docs/ecosystem/contracts-draft/`). Written at EDIT-2
(2026-10-18) against OnlyOffice DocumentServer 10.0.0.1; the measured behaviour it relies on is in
`docs/adr/2026-10-17-onlyoffice-release-and-licence.md` (findings F1–F18).

The service is stateless: it keeps no session map and no database. Everything an editor page
needs travels in a sealed editor URL, and every DocumentServer callback is routed by the document
key to the consumer that opened it.

## 1. Registration

A consumer is an entry in the service's `CONSUMERS` (JSON). A consumer that uses the profile
surface carries every field below; the service refuses to start otherwise.

| Field | Meaning |
|---|---|
| `id` | `[0-9A-Za-z_-]+`. The first component of every key the consumer opens. |
| `auth` | `hmac` or `jwks`: how `open`, `drop`, and `forgotten` calls authenticate. These are server-to-server calls from the consumer's backend; the service's CORS admits only `GET` and `POST` and no browser should hold a consumer credential. `api-key` is accepted only under `EDITOR_ENV=local` (the scratch battery); the service refuses to start with one anywhere else. |
| `profiles` | Any of `document`, `template`, `view`. Absent: legacy request shape only (section 8). |
| `callbackUrl` | The one notification endpoint. https outside `EDITOR_ENV=local`; resolved and pinned to public addresses at every delivery; redirects are not followed. |
| `notificationSecretRef` | The environment variable holding the notification secret, named outright (e.g. `EDITOR_NOTIFY_SECRET_CRM`). `<name>_PREVIOUS` holds the previous secret during a rotation. |
| `panelOrigins` | Exact origins the consumer's panel pages are served from. |
| `fileHosts` | Hosts an `open` `fileUrl` may name. |
| `convertSourceHosts`, `convertUploadHosts` | Hosts a conversion may read from and upload to (EDIT-3). |
| `returnOrigin` | Where the expired page links back to. |

Secrets are created per environment in 1Password and Secret Manager and recorded by name in
`CREDENTIALS.md`. The consumer holds the same notification secret. Outside `local` the service
refuses to start when a profile consumer's secret is unset, when the current or previous value is
shorter than 32 bytes, or when two consumers name the same secret. At start it also resolves each
`callbackUrl` and logs a warning (never the URL) when a delivery would be refused.

## 2. Opening a document

`POST /api/documents/open`, authenticated as the consumer.

```json
{
  "profile": "document",
  "documentRef": "ctr_8f3k2",
  "revision": "14",
  "mode": "e",
  "fileUrl": "https://files.example.com/signed/…",
  "fileName": "Master services agreement.docx",
  "user": { "id": "u_123", "name": "Rep One" },
  "panelUrl": "https://crm.example.com/udoc/panel#t=<panel token>"
}
```

Answer: `{ "editorUrl": "https://editor…/editor/<sealed token>", "key": "crm.ctr_8f3k2.e14", "expiresAt": "…" }`.
Open `editorUrl` in an iframe or a tab. Nothing else is needed on the page.

### Profiles

| Profile | Mode | What the editor allows |
|---|---|---|
| `document` | `e` | Editing; a field's value (a `contentLocked` content control) cannot be typed over and its settings cannot be changed (`modifyContentControl: false`), but **a field can still be removed**: with its surrounding sentence (the loose lock, UDOC D11, ADR F9), or through the context menu's "Remove content control", which leaves its value behind as plain text (ADR F16). No Protection tab (`protect: false`); force-save on; the bridge plugin with the panel URL; the Plugin Manager disabled and the Plugins tab hidden. |
| `template` | `e` | As `document`. The panel decides what template authoring adds (EDIT-5). |
| `view` | `v` | Read-only; no plugins; no panel URL (sending one is refused). |

On every DocumentServer the service deploys, the built-in AI feature is off server-side
(`aiSettings.enable: false`) and the marketplace plugins are not installed
(`PLUGINS_ENABLED=false`); this is DocumentServer configuration, not image modification (ADR F4, F5).

The editor's locks are enforced only in the browser. **Validate every file you get back** (UDOC
D16): each field control names a row you know, keeps its lock, and holds one value run; and on
every save, report each field row whose control is gone, not only the required ones at finalize.

### Keys and revisions

The document key is `<consumer>.<documentRef>.<mode><revision>`, at most 128 characters, each
component `[0-9A-Za-z_-]+` (a `.` anywhere is refused). DocumentServer treats one key as one
co-editing session over one file version, so:

- Bump `revision` whenever the stored file changes outside the editor (a save you stored, an
  upload, a restore). Reusing a key over a different file shows users stale content.
- Everyone editing the same version together must get the same key: use the same
  `documentRef`, `revision`, and mode.
- `view` keys (`v`) never collide with editing keys (`e`).

### File URLs

`fileUrl` must be https, name a host in `fileHosts`, and resolve only to public addresses
(private, loopback, link-local, CGNAT, unique-local and site-local IPv6, IPv4 embedded in IPv6 —
mapped, translated, 6to4, NAT64 — Teredo, and metadata names are refused).

DocumentServer never sees this URL. Its configuration names the service's own source route
(`/api/documents/source/<sealed source token>` on the internal URL); when DocumentServer asks for
the document, the service checks the URL again against your current registration, resolves it,
and fetches it on exactly the addresses it checked, without following redirects, within
`EDITOR_SOURCE_TIMEOUT_MS` (30 s) and `EDITOR_MAX_SOURCE_BYTES` (100 MB, DocumentServer's own
default). The service reads the whole file before handing it on (ADR F17: a download that ends part
way, or a slow one, blocks DocumentServer's one converter for every document), so serve it
promptly: a source that is slower than the deadline fails the open. A name that resolves publicly at `open` and privately later cannot steer that fetch
inward (DocumentServer's own address filter is bypassed for signed configurations, ADR F3, so it
could not be relied on). Answer the fetch with `200` and the file; a redirect or any other status
fails the open. Each source token lives 5 minutes (a new one is minted every time the editor page
loads) and admits at most 10 fetches; requests whose token does not open are limited per address
like every other route. The service asks for the file uncompressed (`Accept-Encoding: identity`)
and refuses a body that ends short of its declared `Content-Length`.

Use a short-lived signed URL: the session never outlives the URL's stated expiry (GCS and S3 v4,
or an `Expires` epoch parameter).

### Refusals

`400` with `error`: `key_fields_required`, `profile_mode_mismatch`, `bad_key:<reason>`,
`file_url_refused:<code>` (`invalid`, `scheme`, `credentials`, `host_not_allowed`, `local_name`,
`private_address`, `unresolvable`), `file_url_expired`, `panel_url_required`,
`panel_url_invalid`, `panel_origin_not_registered`, `field_not_allowed` (a legacy field on the
profile shape), `profile_required` (the legacy shape from a profile consumer, section 8),
`session_too_large`. `403 profile_not_allowed`. `401` with `Missing Authorization header` or
`Invalid or expired credentials`. `500 seal_unavailable` (the service has no usable seal key).

## 3. Editor URLs

The editor URL carries an AES-256-GCM sealed token (profile, consumer, key, user, file URL,
panel URL, expiry; at most 4 KB). It is valid for at most 12 hours (`EDITOR_MAX_SESSION_MS` can
shorten it) and never past the file URL's expiry. Treat it as a bearer credential for that
session. The service stores nothing, so **nothing revokes an issued editor URL before it
expires**: a drop ends DocumentServer's current session for the key, but loading the same URL
again opens the key again. Bound that by keeping the signed file URL short-lived, and by answering
any notification for a key you have closed with `409 {"code":"key_closed"}` (section 4).

The page does not yet send `frame-ancestors` (a recorded follow-up), so any site can frame it;
what a framing site can do is limited to what the URL's holder can already do.

- An expired token from a known consumer shows a page that links to `returnOrigin`.
- A tampered or unknown token shows the same page with no link and no detail.
- The page sends `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, and a strict CSP
  with a per-response nonce that admits only DocumentServer's origin.

**Seal-key rotation.** `EDITOR_SEAL_KEYS` holds the current key and optionally the previous one
(base64url, 32 bytes each, comma-separated, current first). New tokens are sealed with the
current key; tokens sealed with the previous key still open until they expire. Remove the
previous key after the longest session (12 hours).

## 4. Notifications

The service forwards DocumentServer's callbacks to your `callbackUrl` as a signed POST.

```json
{
  "key": "crm.ctr_8f3k2.e14",
  "documentRef": "ctr_8f3k2",
  "revision": "14",
  "mode": "e",
  "status": 2,
  "event": "saved",
  "downloadUrl": "https://ds…/cache/files/…",
  "users": ["u_123"],
  "lastsave": "2026-10-18T10:00:00.000Z",
  "deliveryId": "9c1e…"
}
```

| status | event | Meaning | Carries |
|---|---|---|---|
| 1 | `editing` | A connection opened or closed (`actions[].type` 1 or 0) | `users`, `actions` |
| 2 | `saved` | Final save after the last editor closed with changes | `downloadUrl`, `deliveryId` |
| 3 | `save_error` | DocumentServer could not build the final file | — |
| 4 | `closed` | The last editor closed without changes | — |
| 6 | `force_saved` | A force-save while editing continues | `downloadUrl`, `deliveryId` |
| 7 | `force_save_error` | A force-save failed | — |

Before storing a save, check that `key` is the document's **current** key (a save for an older
revision or a closed key is answered `409 {"code":"key_closed"}`), and fetch `downloadUrl` **only
from the DocumentServer origin you configured** — the service's `ONLYOFFICE_PUBLIC_URL`, which it
puts on every `downloadUrl` it forwards (forgotten files included); refuse any other origin.
Download promptly (the URL is short-lived), validate the file (section 2), store it, then bump
your revision for the next open. Only statuses 2 and 6 carry a `downloadUrl`.

### Verifying

Every notification carries:

- `X-Editor-Timestamp`: Unix seconds.
- `X-Editor-Signature`: `v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>`. The HMAC key
  is the secret's text exactly as configured (its UTF-8 bytes; a base64-looking secret is not
  decoded). During a rotation there is one `v1=` per active secret, comma-separated.
- `X-Editor-Delivery`: the `deliveryId` (statuses 2 and 6 only).

Verify in this order, against the raw body before parsing:

1. The timestamp is within 5 minutes of your clock.
2. One `v1=` value matches under your current or previous secret, compared in constant time.
3. The body's `key` is one you issued.
4. For statuses 2 and 6, `deliveryId` equals `X-Editor-Delivery` and has not been processed.

The reference implementation is `apps/api/src/reference/verify-notification.ts` (its tests run
in this repo); port it. When it reports `replay` for a save you already stored, answer `200`
so the service stops retrying.

`deliveryId` is SHA-256 over the key, status, `lastsave`, and (for status 6) `forcesavetype`.
It is stable across DocumentServer's retries of one save and distinct between saves, and it does
not change when secrets rotate. Statuses 1, 3, 4, and 7 carry no `deliveryId` and are idempotent
by meaning.

**Notification-secret rotation.** Set the new secret as `<ref>` and the old as `<ref>_PREVIOUS`
on the service, accept both on the consumer, then remove the previous one from both after the
timestamp window has passed.

### Answering

| Your answer | What happens |
|---|---|
| `2xx` | Delivered. |
| `409` or `410` with `{"code":"key_closed"}` | Acknowledged: you no longer want this key (it is not retried). |
| Anything else (including `401`, `4xx`, `5xx`, a timeout, or a network failure) | The service answers DocumentServer `503`, asking for a retry. |

DocumentServer retries **only the final save (status 2)**, three times at 1, 2, and 4 seconds
(ADR F1): roughly a 7-second horizon plus each attempt's time (the service waits at most
`EDITOR_NOTIFY_TIMEOUT_MS`, 10 seconds by default). Every other status gets exactly one
attempt. So:

- The final save is the authoritative copy. Force-save notifications are best effort.
- A final save that was never acknowledged is kept by DocumentServer in its forgotten-files
  store. Recover it with `GET /api/documents/keys/:key/forgotten` → `{ "downloadUrl": … }` or
  `{ "none": true }` (DocumentServer holds nothing for the key), store it, then release it with
  `DELETE` on the same path (`{ "result": "ok" }`, `404` when nothing is held). Both answer `502`
  with DocumentServer's named error when it is failing — that is never a "none": retry later.
  Reconcile any key whose closing sequence did not end in a stored save.
- Respond within the timeout; store asynchronously if you must, but only answer `2xx` once the
  save is durably queued.

### Edit locks

One user in two tabs produces connect, connect, then a disconnect when one tab closes, while
`users` still lists the user (ADR F14). Release an edit lock only when a status-1 notification's
`users` list is empty, or on status 4 or a final status 2 — never on a bare disconnect. Treat a
repeated connect as a renewal.

## 5. Closing a session (drop)

`POST /api/documents/keys/:key/drop` with `{ "users": ["u_123"] }` (the ids you hold from status-1
notifications), authenticated as the key's own consumer (another consumer gets `403 not_your_key`).
DocumentServer disconnects those users; when the last one leaves, the usual final notification
follows: status 2 if there were changes, status 4 if not. Answers: `{ "result": "ok" }`;
`404 key_not_found` when DocumentServer has no open session for the key; `409` with
`callback_url_not_correct`, `no_changes`, or `command_not_correct` (about the request);
`502` with `docserver_internal` or `invalid_token` (a fault in DocumentServer or in the service's
configuration), or `docserver_unreachable`. A drop does not revoke issued editor URLs (section 3).

## 6. Conversion (EDIT-3)

`POST /api/documents/convert`, authenticated as a profile consumer (a legacy-only consumer gets
`403 profile_not_allowed`), turns a document in your storage into a PDF in your storage. The
service keeps neither file and writes nothing to disk.

```json
{ "sourceUrl": "https://files.example.com/signed-read/…", "uploadUrl": "https://files.example.com/signed-write/…", "fileType": "docx" }
```

- `sourceUrl` is checked like an editing `fileUrl` (section 2) against `convertSourceHosts`;
  `uploadUrl` against `convertUploadHosts`. Both must be https and resolve to public addresses
  (`EDITOR_ENV=local`, the scratch battery, also admits http and private addresses); neither is
  ever a cloud metadata address, in any environment.
- `fileType` is `docx`, `doc`, `odt`, or `rtf`; without it the source URL's extension decides,
  else `docx`.
- DocumentServer reads the source through the service's source route (section 2), so the service
  fetches it whole on the checked addresses with no redirects and under `EDITOR_MAX_SOURCE_BYTES`,
  and only while this conversion runs (its source token is refused once the conversion has ended).
- The service reads the PDF whole and checks it against its declared length, then uploads it with
  `PUT`, `Content-Type: application/pdf`, and its `Content-Length` to the checked upload address,
  without following a redirect. Your storage never receives part of a file. Use a signed upload URL
  that accepts that.
- Answer: `{ "size": <bytes>, "sha256": "<hex>" }` once your upload host answered `2xx`. Check the
  stored object against both.

| Status | `error` | Meaning |
|---|---|---|
| 400 | `source_url_refused` | The source URL failed the checks (also when refused at fetch time). |
| 400 | `upload_url_refused` | The upload URL failed the checks. |
| 413 | `input_too_large` | The source is over the input cap. |
| 413 | `output_too_large` | The PDF is over `EDITOR_MAX_CONVERT_OUTPUT_BYTES` (100 MB). |
| 502 | `source_unavailable` | The source host did not answer `200` (a redirect counts) or could not be reached. |
| 504 | `conversion_timeout` | The whole request ran past `EDITOR_CONVERT_TIMEOUT_MS` (90 s by default, at most 95 s: under the 100 s a proxied request is held open). While DocumentServer answers "not finished" the service asks again each second until then. |
| 502 | `conversion_failed` | DocumentServer could not convert the document, or returned an empty or incomplete PDF. |
| 502 | `upload_failed` | The upload host refused, redirected, or could not be reached. |
| 429 | `busy` | You already have `EDITOR_CONVERT_CONCURRENCY` (2) conversions running, the service has `EDITOR_CONVERT_CONCURRENCY_TOTAL` (4) running for everyone, or its source reads are all in use; retry later. |

A converted PDF stays in DocumentServer's cache for up to 24 hours (ADR F8) on our own
infrastructure; nothing else keeps it. Convert a finalized document only: tracked changes render
as both the deleted and inserted text and comments are dropped (ADR F12), which is why finalize
requires none (UDOC D16).

## 7. The panel (EDIT-5)

The `document` and `template` profiles open a right-side panel, **Document panel**, hosted by the
bridge plugin. The plugin loads your `panelUrl` in an iframe and answers that page's requests with
a fixed set of operations on the open document. Your proprietary UI lives in your page; the plugin
is a thin AGPL bridge served from the service's own origin (`API_PUBLIC_URL`, the **plugin origin**).

The user can close the panel (its × button) and reopen it from the **Plugins** tab, which offers
the Document panel and nothing else; reloading the editor page brings it back with the same
`panelUrl`. Each time, your page is loaded fresh and receives `udoc.ready` again.

### Your panel page

- **Origin checks:** accept a message only when `event.origin` is the plugin origin and
  `event.source === window.parent`; post only with `targetOrigin` set to the plugin origin, never `*`.
- **Framing:** send `Content-Security-Policy: frame-ancestors` listing exactly the frame chain: the
  plugin origin (`API_PUBLIC_URL`, which also serves the editor page), DocumentServer's public origin,
  and your own origin when your app embeds the editor page.
- **The panel token** travels in the URL fragment (`#…`), visible to the editor page and to
  DocumentServer (accepted exposure, UDOC D14): give it a short lifetime, scope it to the one
  document, and exchange it for a short pass held in memory; never put the pass in a query string.
- `panelUrl`'s origin must be one of your `panelOrigins` (refused at `open` otherwise).

### Messages

```js
// panel → plugin
{ type: 'udoc.hello' }                                  // ask for udoc.ready again
{ type: 'udoc.request', id: 'r1', op: 'getText', args: {} }
// plugin → panel
{ type: 'udoc.ready', protocol: 1, operations: ['getText', 'getSelection', 'insertField', 'insertToken', 'applySuggestion', 'addComment'] }
{ type: 'udoc.response', id: 'r1', ok: true, result: { … } }
{ type: 'udoc.response', id: 'r1', ok: false, error: 'stale_anchor' }
```

The plugin sends `udoc.ready` when your page has loaded and again on `udoc.hello`. Every
well-formed request (`type: 'udoc.request'` with a string or number `id`) gets exactly one response
with its `id`; anything else is dropped. Operations run one at a time in the order received;
refusals (`unsupported`, `invalid_args`) answer at once. An operation DocumentServer does not finish
within 30 seconds answers `failed` and the next one runs; the editor may still apply it later, so
after a `failed` re-read with `getText` before retrying an insertion, or it may land twice. Each
operation that changes the document is **one undo step**.

### Operations (protocol 1)

| `op` | `args` | `result` |
|---|---|---|
| `getText` | — | `{ body: [{ index, text, fields }], headers: [{ section, type, paragraphs }], footers: […], blocks: [{ tag, kind, rowId }] }`; each field is `{ start, end, tag, kind: 'field' \| 'block' \| 'other', rowId }`, with offsets into its paragraph's `text` |
| `getSelection` | — | `{ text }` |
| `insertField` | `{ rowId, label, value, kind: 'inline' \| 'block' }` | `{ tag }`: inserts at the cursor a `field:<rowId>` inline control with the loose lock (`contentLocked`) or a `block:<rowId>` block control with the strict lock (`sdtContentLocked`); a newline in `value` becomes a line break (UDOC D11) |
| `insertToken` | `{ token }` | `{}`: plain text at the cursor (template mode) |
| `applySuggestion` | `{ paragraphIndex, context, occurrence, find, replace, comment?: { text, author } }` | `{}`, or `{ commentPlaced }` with a comment: replaces the anchored text as a tracked change (track changes forced on, then restored, also if the edit fails) and puts the comment on the inserted text; `commentPlaced: false` means the inserted text could not be located exactly and no comment was added (the suggestion itself was applied; for example "b" → "bb", where the kept deleted text and the inserted text run together as "bbb"). An empty `replace` is a pure deletion and takes no comment (`invalid_args`); comment first with `addComment`, then delete |
| `addComment` | `{ paragraphIndex, context, occurrence, find, text, author }` | `{}` |

**Anchors.** `paragraphIndex` is a body paragraph's `index` from `getText`; `occurrence` is the
0-based index among the non-overlapping occurrences of `find` in that paragraph's `text` (counted
left to right, as the editor's search counts them: in "aaaa", "aa" occurs twice); `context` is text around
that occurrence, which must still be there. The anchor is found and re-checked inside the same edit,
so a paragraph the user changed since your `getText` is refused, never guessed. A suggestion or
comment is anchored in the body only.

**Errors.** `stale_anchor` (the paragraph is gone or the context no longer surrounds the occurrence:
read `getText` again), `not_found` (no such occurrence), `inside_field` (the text lies in a field
control: suggestions never edit field values), `invalid_args`, `unsupported` (unknown `op`),
`failed`.

**Argument rules.** `rowId` is a string matching `[0-9A-Za-z_-]{1,64}`. No text the panel writes
(`value`, `label`, `token`, `replace`, comment `text`, `author`, and the anchor's `find` and
`context`) may contain control characters other than tab and newline, U+FFFE/U+FFFF, a lone
surrogate, or the signer-tag grammar (`\s1\`, UDOC D15). `label`, `token`, `replace`, and `author`
are single-line. Caps: `value` 10,000 characters, `context` 4,000, `replace` 4,000, comment `text`
2,000, `find` 1,000, `label` 200, `token` 200, `author` 100. Only the operation's own arguments
reach the editor; other keys are dropped. A replacement that completes a signer tag together with
the text around it is not detected: Docs' own anchor check at send time is the backstop.

**What the bridge does not guarantee.** The editor enforces locks only in the browser: a field can
still be removed by the user (ADR F9, F16), so validate every saved file (section 2). Tracked changes
and comments render in a PDF (ADR F12): finalize only documents with none pending.

## 8. The legacy request shape

A request without `profile` is the legacy shape, kept for `fastmail-connect` and the Connect
extension until they move to profiles (E1):

```json
{ "fileUrl": "https://…", "fileName": "a.docx", "user": { "id": "…", "name": "…" },
  "permissions": { "edit": false, "download": true, "print": true } }
```

`permissions.edit` false opens view-only, otherwise editable. Only a consumer registered without
`profiles` may use it; a profile consumer's legacy request is refused (`profile_required`), so
its keys always get the profile rules. Legacy sessions send no notifications (a legacy-only
consumer has no `callbackUrl`). The `fileUrl` is the service's own internal `/api/files/` URL
(from `POST /api/files/upload`, handed to DocumentServer as it is) or any https URL that passes
the address checks (fetched through the source route like a profile file). An empty `fileName`
falls back to the URL's. Refused: `callbackUrl`, `saveTo`, a GCS `bucket/object` path
(`legacy_field_removed`), and any profile field without `profile` (`profile_required`). The
shape is removed once no registered consumer uses it.

## 9. Changelog

**EDIT-5 (2026-10-18).** Added: the panel bridge (section 7), served from `/plugins/udoc-bridge/` on
the service's origin; protocol 1 with six operations.

**EDIT-3 (2026-10-18).** Added: `POST /api/documents/convert` (section 6). Changed: metadata
addresses are refused everywhere, `EDITOR_ENV=local` included; the source route reads the whole
file before DocumentServer gets any of it (ADR F17), within `EDITOR_SOURCE_TIMEOUT_MS`, now 30 s,
so a source slower than that fails the open; too many reads at once answer DocumentServer `503`
(it was observed to retry a failed source download three times, a second apart).

**EDIT-2 (2026-10-18).** Added: profiles, sealed editor URLs, the source route (DocumentServer
fetches documents through the service), signed notifications, drop, the forgotten-files
endpoints, the expired page. Changed: the legacy shape is refused from profile consumers. Removed:

- `GET /api/documents/:key/download` and `GET /api/sessions` (the session map is gone);
- the per-request `callbackUrl` and `saveTo` fields (notifications go to the registered
  `callbackUrl`; the consumer stores the file);
- GCS `bucket/object` file references and the service's own bucket access;
- `SESSION_TTL_MS` (sessions now end at the sealed token's expiry).

The `/api/files/` upload behaviour is unchanged.
