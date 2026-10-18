# Spike: OnlyOffice for CRM contract editing (2026-10)

- Date: 2026-10-15/16 (one session, time-boxed)
- Original question: can OnlyOffice Docs Community let a CRM rep edit only designated sections of a DOCX contract template, with real formatting, and hand back a DOCX that CRM's existing docxtemplater + Gotenberg pipeline can merge and render?
- **Scope change (2026-10-16, from Josh via the coordinating session):** locked sections are dropped. The editor is a normal full editor, and merge fields are the only special objects. Merge values appear *before* editing and must be refillable later without touching the rep's edits. OnlyOffice produces the PDF. Both the DOCX and the PDF are kept. New item 9 asks whether a custom plugin can serve as an AI side panel. The current answer is the next section. The original locked-sections findings (items 1–2) are kept below as a record.
- Versions tested: **9.4.0.1** (primary), **8.3.3** (what the service runs today), and **10.0.0.1** (released 2026-10-12; used only to recheck the two locked-section defects).
- Status: throwaway spike. Nothing here is committed or deployed. Scratch stack: a compose project `oo-contract-spike` (OnlyOffice on 127.0.0.1:18094/18083/18100, Gotenberg 8 on 127.0.0.1:18030), a Node harness on :18090 that serves fixtures, the test plugin and a stand-in AI backend on :18091, and records callbacks, plus a scratch copy of `apps/api` on :13020. All of it has been torn down.
- Method: every claim below comes from real keyboard and mouse input in Chromium (Playwright) against the real editor, or from plugin calls made inside the real editor. The result was read back from OnlyOffice's document model (9.4 ships unminified) or from the DOCX it saved (8.3 and 10.0 are minified, so I saved and parsed instead). No customer data was used. The JWT secret and the protection password were random scratch values and were never logged. The only external request was one POST of `{"probe":true}` to httpbin.org (item 9e).

## Current answer (full editor + merge fields + AI panel)

**Stay on OnlyOffice Community, and upgrade the service to 10.0 (9.4 at minimum) before building the AI panel.** Every kept item passes on 9.4 and 10.0 Community without the Developer Edition. 8.3, which the service runs today, hosts the panel but loses the inserted half of a suggestion. 10.0 also keeps field formatting on a live refill, which 9.4 does not. Version coverage: items 7, 8 and 9a–9e were run on 9.4 and 10.0; 8.3 got the plugin probes only.

- Merge fields as inline content controls survive editing and saving with their tag, lock and formatting. They can be refilled in place outside the editor without disturbing a single byte of the rep's edits.
- Block tables can be refilled the same way.
- OnlyOffice's ConvertService renders the result correctly. LibreOffice garbles inline controls.
- A custom plugin works as a persistent right-side AI panel. It can read the document and the selection, write suggestions as real tracked changes, add comments, and call our backend over CORS.

The constraints worth carrying into the design are in "Design notes for the full-editor scope" below.

| # | Item | Result on 9.4 Community | Evidence and notes |
|---|------|------|------|
| 3 | Content controls survive save | **PASS** | `field:*` (inline) and `block:*` (block) controls keep tag, `w:lock`, and run properties through edit + force-save + close-save. Also passed through the real `apps/api` callback flow. OnlyOffice drops `<w:text/>`, so plain-text controls come back as rich text. Harmless for refill |
| 4 | PDF via OnlyOffice ConvertService (primary) | **PASS** | Bold/italic/colour fields, bullets, tables and refilled values render as in the editor; all fonts embedded. Gotenberg (secondary) mis-renders inline controls: "Renamed Customer LLC" overprints line 1, and field baselines shift. It needs controls unwrapped first, so OnlyOffice should be the PDF path |
| 5 | docxtemplater `{token}` survives an OnlyOffice save | **PASS** | Locked or plain `{token}`s, including one in its own bold run, merge with CRM's exact options after an OnlyOffice save. Typed `{…}` text is still parsed by docxtemplater. With field controls as the merge mechanism, docxtemplater is needed only for the first fill, if at all (see design notes) |
| 6 | Community vs Developer Edition gating | **PASS** (no gate hit) | Used here and working on Community: content-control locks, `permissions.modifyContentControl`, `permissions.protect`, `editorConfig.plugins` (`autostart`, `pluginsData`), plugin `callCommand`/`executeMethod`, ConvertService. Gated on Community: `docEditor.createConnector` (Automation API), absent from `api.js` on 8.3/9.4/10.0; and the plugin method `StartAction("GroupActions")`, which the 9.4 SDK documents as "available only for ONLYOFFICE Docs Enterprise and ONLYOFFICE Docs Developer" and implements as an empty stub (`baseEditorsApi.prototype.startGroupActions = function(pr){}`). Neither is needed (see 9d). No other method in the 9.4 plugin API carries that note |
| 7 | Inline locked `field:<token>` controls survive save and refill in place | **PASS** (9.4, 10.0) | 6 inline controls (`field:contract.start_date` ×2, `field:account.name` ×2, `field:contract.total`, `field:contract.payment_terms`), in body text and a heading. In the editor: typing into a field, Backspace/Delete at its edge, and select-across + Delete or type never change its value. After save every field kept tag, `sdtContentLocked`, and `rPr` (`<w:b/>`; `<w:i/>`; `<w:b/><w:color w:val="1f4e79"/>`). Refill script rewrote only those `sdtContent`s. An assertion proved the rest of `document.xml` byte-identical. Reopened: new values shown, still locked, rep's edits intact. **Same on 10.0**: attacks refused, save kept tags/locks/`rPr`, a 10.0-saved file refilled byte-safely, reopened in 10.0 with the new values and locks, and rendered correctly in 10.0's ConvertService |
| 7′ | Lock choice for fields | **Decision needed** | `sdtContentLocked`: field can't be deleted, **and a paragraph containing a field can't be deleted** (triple-click + Delete refused). `contentLocked`: value still uneditable, but deleting the sentence removes the field with it. Pick per field, or `contentLocked` everywhere plus a CRM check for required fields |
| 8 | `block:line_items` table refill | **PASS** (9.4, 10.0) | Locked block control around a 3×3 table; typing in it refused; survived save; whole `sdtContent` replaced with a regenerated 4-row table; reopened and rendered correctly in the editor and in OnlyOffice's PDF |
| 9a | Plugin as a persistent side panel | **PASS** (9.4, 10.0, 8.3) | `config.json` variation `"type": "panelRight"`, `"isVisual": true`, `"isModal": false`, `"isInsideMode": true`, `"size": [360, 600]`; loaded through `editorConfig.plugins = { autostart: ["asc.{GUID}"], pluginsData: ["https://…/config.json"] }` and served from our own origin (needs `Access-Control-Allow-Origin` on `config.json`). Opens docked right beside the document, stays open while editing, and has its own close and undock buttons |
| 9b | Read whole document, selection, paragraph boundaries | **PASS** (9.4, 10.0, 8.3) | `callCommand(() => Api.GetDocument().GetAllParagraphs().map(p => p.GetText()))` returns every paragraph (table cells come back as paragraphs ending `\t`). `executeMethod("GetSelectedText", [{ParaSeparator:"\n",…}])` and `Api.GetDocument().GetRangeBySelect().GetText()` both return the selection. Field values appear inline in the text |
| 9c | Write as tracked suggestions; anchored comment | **PASS** (9.4, 10.0); **FAIL on 8.3** | **Recommended recipe, one `callCommand`:** `d.SetTrackRevisions(true)`; `r = d.Search(find)[0]`; `r.Delete()`; `r.AddText(rep, "after")`; `d.Search(rep)[0].AddComment(note, "Spike AI")`; restore the previous track state. Result: one tracked deletion + one tracked insertion (clean redline), a comment anchored to the inserted text, and one undo step. Saved as `w:del`/`w:ins` + `comments.xml`; accept/reject in the normal review UI. Order matters: `AddText` *before* `Delete`, or a comment on the text being deleted, loses the insertion or the comment. Alternatives that also track but need two calls: select + `executeMethod("PasteText")` (clean) or `"ReplaceTextSmart"` (character-level diff). Caveats: revisions are attributed to the **signed-in rep** (the comment carries the AI author); the comment date is written as local time labelled UTC. **8.3:** the deletion is tracked but the insertion is lost, and the comment falls back to the whole paragraph |
| 9d | Undo grouping | **PASS** (by design rule) | One `callCommand` holding all of a suggestion's edits is one undo step (9.4, 10.0, 8.3). `StartAction("GroupActions")` is Developer/Enterprise-only and a no-op on Community. Tested with the AI plugin's exact call (`["GroupActions"]`, no description), with and without its `Asc.Editor` wrapper, on 9.4 and 10.0: two `callCommand`s still needed two undos. That explains the gap with OnlyOffice's custom-AI-tools guide, which assumes a paid edition. Rule: one AI suggestion = one `callCommand` |
| 9g | Live refill of `field:` controls while the document is open (extra) | **PASS** (10.0); **PASS\*** (9.4) | One `callCommand`: for each `field:*` control, `SetLock("unlocked")` → `RemoveAllElements()` → `AddText(value)` → restore `SetLock`. Values update, controls are relocked, one undo reverts. 10.0 keeps the field's bold/colour; 9.4 drops the run formatting (the copy of the first run's `TextPr` didn't take there). Also confirms a plugin, like dev tools, can unlock any control, so the server check in the design notes stays mandatory |
| 9e | Network from the plugin to our AI backend | **PASS** (9.4, 10.0, 8.3) | The plugin iframe runs on the origin that hosts the plugin (our origin), not the DocumentServer's. The editor page sends no CSP or X-Frame-Options, so nothing in OnlyOffice blocks `fetch`. A cross-origin POST with `Access-Control-Allow-Origin` succeeded; without it the browser blocked it ("Failed to fetch"). A POST to external HTTPS (httpbin.org) succeeded. Ordinary browser CORS applies; in production the plugin must be served over HTTPS (mixed content) |
| 9f | Built-in AI plugin as fallback | **Recorded, not tested** | Per OnlyOffice docs: custom providers are a JS file with `class Provider extends AI.Provider` (`super(name, url, key, addon)`), **uploaded per user through the AI tab UI**; no central preconfiguration documented. Requests come from the DocumentServer origin with `Authorization: Bearer <key>` from the browser, so the key is client-side. Custom tools (`new RegisteredFunction({ name, parameters, examples, description })`, `func.call = async (params) => …`) are beta and need a fork and rebuild of the AI plugin. The built-in AI tab is visible by default on 9.4 Community (not shown on 10.0). Weaker than a custom panel for us: key in the browser, per-user setup, fork to extend |

### Design notes for the full-editor scope

- **Fields are the merge.** Fill values into `field:<token>` controls when the document is created, and refill by rewriting those controls' `sdtContent` (keep the first run's `rPr`, one `w:t`). Use a namespace-preserving XML parser in production; the spike used regex. docxtemplater is then unnecessary after the first fill. If the first fill still uses docxtemplater on the template, do it **before** the rep ever edits, so typed `{…}` text never reaches it.
- **Editor profile.** Pass `permissions.modifyContentControl: false`. Otherwise "Content control settings → Locking" lets a rep unlock and edit a field (confirmed on 8.3/9.4/10.0). `apps/api` can't pass it today: contract change.
- **CRM must not trust the return.** Locks are enforced only in the browser. On save, CRM should check every expected `field:`/`block:` control is present once (or as many times as the template had it), with its tag, and refuse or repair otherwise.
- **PDF.** OnlyOffice ConvertService directly on the refilled DOCX. Don't send inline-control DOCX to Gotenberg without unwrapping.
- **AI panel.** Host the plugin on our HTTPS origin, register it per session through `editorConfig.plugins`, call our backend with CORS limited to our origin, and keep model keys server-side. Each suggestion is the single-`callCommand` recipe in 9c (track on, delete, add after, comment on the inserted text, track restored): a clean redline the rep accepts or rejects, undone in one step. Don't rely on `GroupActions` (paid editions only). Revisions show the rep as author, so the AI comment carries the attribution.
- **Fields while the document is open.** The same plugin can refill `field:*` controls live (9g). Prefer 10.0 for that, since 9.4 drops the field formatting.
- **Turn off the built-in AI tab** for this profile on 9.4 (it is on by default and its key storage is client-side).

## Superseded: locked-sections verdict (items 1–2)

Kept as the record of the original question. The scope change above makes it moot.

**Stay on OnlyOffice, using the content-control design (variant B1 below), on 9.4+.** The approval depends on three server-side pieces, and those pieces are part of the design, not optional hardening. Don't start a Syncfusion evaluation now. Start one only if reps reject the Enter-key behaviour described under B1 once they've used it.

Why:

- No variant is restriction-tight in the editor alone. Both workable variants have one editor defect each, and neither defect is fixed in 10.0.
- The content-control variant (B1) never lets a user change or delete locked text, and never lets a user delete a section. Its defect only adds user text *outside* a section, where a deterministic server-side normaliser can find it and fold it back in.
- The protection variant (A1) has the nicer editing feel. But its defect can silently destroy a section's editability, and that damage persists in the saved file. A1 also doesn't work on 8.3.
- The locks are enforced only by the browser editor, whichever variant is used. Anyone holding the editor session can get around the UI (dev tools, a crafted DOCX). So CRM has to validate the returned DOCX against the template regardless of which editor it uses. That makes the server pieces mandatory and keeps B1's defect cheap to absorb.

The three server pieces: (1) a structural validator and normaliser, (2) a merge guard that keeps section text away from docxtemplater, and (3) stripping the content controls before Gotenberg. All three were prototyped here and are described under "What the design must include".

## Pass/fail per item (original locked-sections scope)

Legend: PASS = works as required. PASS* = works with the stated caveat. FAIL = does not meet the requirement.

| # | Item | B1: content-control locks (9.4) | A1: readOnly protection + editing exceptions (9.4) | 8.3 | 10.0 |
|---|------|------|------|------|------|
| 1a | Document protection / `permissions` config | n/a | **PASS\***. `readOnly` + `w:permStart/permEnd` ranges work; needs `permissions.protect:false` or a password hash, otherwise one click on "Protect Document" removes protection. Defect: emptying a range deletes it (see below) | **FAIL**: ranges unsupported, whole document read-only | Same as 9.4; range defect still present |
| 1a′ | `permissions.edit:false` + `fillForms:true` | **FAIL**: plain rich-text controls are not fillable; nothing can be typed | — | — | — |
| 1a″ | `documentProtection w:edit="forms"` | — | **FAIL** for formatting: typing, Enter, and clearing work inside controls, but bold/italic are silently dropped | — | — |
| 1a‴ | `permissions.review:true`, `edit:false` | — | **FAIL**: unrestricted editing with track changes on (locked text editable) | — | — |
| 1b | Per-control locks (`w:lock`) | **PASS\***. Locked text refuses typing, Backspace/Delete, cut, Enter, formatting, select-across-and-delete, select-all-and-delete. Needs `permissions.modifyContentControl:false`, otherwise "Content control settings → Locking" lets any user untick the lock and edit. Defect: Enter at the end of a section leaves the section | n/a | **PASS\***, same as 9.4 including the defect | **PASS\***, same as 9.4 including the defect |
| 1b′ | Nested: one locked parent with section children (B2) | **FAIL**: children inherit the parent's lock; nothing is editable | — | — | — |
| 1b″ | Locked blocks + unlocked section controls (B3) | **FAIL**: the section control can be deleted (clear it, then Backspace), and the Enter defect is still there | — | — | — |
| 2 | Inside a section: paragraphs, bullets, bold/italic, font size, paste a table | **PASS\***. All work; the pasted HTML table lands inside the section. Paragraphs can only be added by splitting mid-text: Enter at the end of the last paragraph leaves the section, and Enter at the start of the first is refused | **PASS\***. All work, and Enter at either end stays inside. Selecting the whole range *including its paragraph mark* (triple-click, Shift+End from Home) and deleting is refused; drag-selecting the text works | B1 as 9.4 | B1 as 9.4 |
| 2′ | Locked text cannot be edited or deleted | **PASS** (with `modifyContentControl:false`) | **PASS** (with `protect:false` or a password) | PASS (B1) | PASS (B1, A1) |
| 2″ | A section cannot be deleted | **PASS**: "Remove content control" is disabled; clearing and then Backspace/Delete keeps the control | **FAIL in effect**: the control survives, but deleting its last character removes the editing range, so the section becomes read-only. Undo restores it; saving does not. Reproduced on 10.0, where the saved DOCX had no range left | B1 PASS | B1 PASS, A1 FAIL |
| 3 | Saved file keeps controls, tags, locks, ranges; reopen restores restrictions | **PASS**: tags `section:*`/`locked:*` and `w:lock` values are byte-identical after save; reopen enforces the same locks. Also verified through the real `apps/api` flow (`force-saved` then `saved` callback to the consumer) | **PASS** until a range collapses: `documentProtection` and the ranges are preserved and enforced on reopen | B1 PASS | B1 PASS |
| 4 | Fidelity: LibreOffice/Gotenberg vs OnlyOffice ConvertService | **PASS\***. OnlyOffice matches the editor. LibreOffice offsets and on some lines clips the first line of every block content control; unwrapping the controls before conversion fixes that. Remaining differences are listed below | same | not tested | not tested |
| 5 | `{token}` merge compatibility | **PASS**: locked `{token}`s survive save (including a bold token in its own run) and merge with CRM's exact docxtemplater options. **Risk confirmed**: a `{token}` typed into a section merges, and a typed `{#deals}` fails the whole merge (`unclosed_loop`). The section-splice merge guard (below) closes both | same | — | — |
| 6 | Automation API / connector / plugins | Nothing used here needs them. `docEditor.createConnector` (Automation API) is **absent** from Community `api.js` on 8.3, 9.4 and 10.0. Plugins and `docbuilder` ship in the Community image. `permissions.modifyContentControl` and `permissions.protect` work on Community | same | same | same |

## What worked: exact template and config (B1)

Every block of the body is a block-level content control. Locked text is wrapped in `sdtContentLocked` controls tagged `locked:<n>`. Each editable section is a rich-text control tagged `section:<key>` with `sdtLocked`, so its content is editable but the control cannot be deleted. There are no bare top-level paragraphs.

```xml
<!-- locked block -->
<w:sdt><w:sdtPr><w:alias w:val="Locked fees"/><w:tag w:val="locked:fees"/><w:id w:val="1003"/>
  <w:lock w:val="sdtContentLocked"/><w:richText/></w:sdtPr>
<w:sdtContent>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">2. Fees</w:t></w:r></w:p>
  <w:p><w:r><w:t xml:space="preserve">Customer shall pay {total_amount} within {payment_terms} days of invoice. Fees exclude taxes.</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">3. Special Terms</w:t></w:r></w:p>
</w:sdtContent></w:sdt>
<!-- editable section -->
<w:sdt><w:sdtPr><w:alias w:val="Special Terms"/><w:tag w:val="section:special_terms"/><w:id w:val="1004"/>
  <w:lock w:val="sdtLocked"/><w:richText/></w:sdtPr>
<w:sdtContent><w:p><w:r><w:t xml:space="preserve">Enter any special terms here.</w:t></w:r></w:p></w:sdtContent></w:sdt>
```

OnlyOffice reads these as `Asc.c_oAscSdtLockType` `SdtContentLocked` (1) and `SdtLocked` (2). On save it rewrites `sdtPr` as `alias, tag, w15:appearance boundingBox, id, lock` and drops `<w:richText/>`, which is harmless because rich text is the default. It also writes an empty `<w:documentProtection/>` into `settings.xml`.

Editor config. These are the keys that matter, on top of what `buildEditorConfig` sends today:

```jsonc
{
  "document": {
    "permissions": {
      "edit": true,
      "modifyContentControl": false, // REQUIRED: hides "Content control settings" (lock bypass)
      "protect": false               // hides the Protection tab (users cannot add or remove protection)
    }
  },
  "editorConfig": { "customization": { "forcesave": true } }
}
```

`modifyContentControl` was confirmed on 8.3, 9.4 and 10.0: with `false` the menu item is gone, and with the default (`true`) the bypass works. `apps/api/src/routes/documents.ts` has no way to pass either key today, so through the current service a rep can unlock any control. That's a contract change; see the follow-ups.

### The B1 defect, precisely

Pressing Enter with the caret at the end of a section's **last** paragraph creates a new top-level paragraph *after* the section control, outside every control. Text typed there is unprotected body text. The same happens with unlocked sections (B3), on 8.3 and on 10.0. With no locked neighbour (the plain fixture), Enter stays inside, so the trigger looks like "the next block is a content control". Enter at the start of the first paragraph is refused. Enter anywhere mid-text splits inside the section as expected.

Consequence: the locked blocks stay intact, but a saved file can contain top-level `<w:p>`/`<w:tbl>` elements between `section:X` and the next `locked:*` block. The normaliser below folds them into `section:X`.

## Runner-up: A1 (protection + editing exceptions)

```xml
<!-- settings.xml -->
<w:documentProtection w:edit="readOnly" w:enforcement="1"/>
<!-- document.xml: written block-level around the section; OnlyOffice moves the markers inline into the first/last paragraph on load and saves them there -->
<w:permStart w:id="2" w:edGrp="everyone"/><w:sdt>…section:special_terms…</w:sdt><w:permEnd w:id="2"/>
```

- Without `permissions.protect:false`, the Protection tab's "Protect Document" toggle removes enforcement in one click (no password). A SHA-512 `w:hashValue`/`w:saltValue`/`w:spinCount="100000"` password kept enforcement on in 9.4.
- Fatal defect: when the last character inside a range is deleted, OnlyOffice deletes the `permStart`/`permEnd` pair. The section is read-only from then on, and if the document is saved in that state the range is gone from the file. Reproduced on 9.4 and 10.0. A variant that ended the range at the start of the next locked paragraph (A1S) kept the range alive but let users type at the start of that locked paragraph. Rejected.
- 8.3 does not support editing exceptions at all; the whole document opens read-only.

## Fidelity (item 4)

The test DOCX after merge had: title, locked headings, a bold token, italic text, an 18 pt line, two bullets, a pasted 2×2 HTML table, a locked bordered 3×2 table, and an italic footer line.

| | OnlyOffice ConvertService (9.4) | Gotenberg 8 / LibreOffice, controls kept | Gotenberg after unwrapping `w:sdt` |
|---|---|---|---|
| First line inside each section | correct | shifted ~2 px right; in one file the descenders of the first line were clipped | correct |
| Bold / italic / size / bullets | correct | correct | correct |
| Pasted table | column widths as edited | autofit narrower: "Milestone" wraps to "Mileston/e" | same as left |
| Vertical rhythm | slightly tighter after tables (~10 pt over the page) | baseline | baseline |
| Fonts | Liberation Serif, OpenSymbol, Times New Roman (from the pasted HTML), all embedded | Liberation + OpenSymbol embedded; **Times-Roman not embedded** (base-14 fallback) because the Gotenberg image has no Times New Roman | same |

Implications: unwrap the content controls (and drop `permStart`/`permEnd`) after merge and before Gotenberg; this was prototyped. Pasted content brings its own fonts, so either normalise run fonts in sections to the template's fonts or install the same fonts in Gotenberg. A non-embedded font is undesirable in a PDF that Docs will seal.

## Merge (item 5)

- CRM's options (`paragraphLoop`, `linebreaks`, `nullGetter: ''`) with docxtemplater 3.68.6 from the CRM workspace merged every locked token in the OnlyOffice-saved files, including `{customer_name}` split across a bold run.
- **Injection, confirmed.** `{secret_internal_note}` typed into a section was replaced with the context value. A typed `{#deals}` made `new Docxtemplater()` throw `unclosed_loop`. CRM catches that as `DocxMergeError`, so it is a denial of the whole contract rather than a crash.
- **Guard that worked:** before merge, replace each `section:*` control's `sdtContent` with one paragraph holding `{@__section_n}`. Merge with the original section XML as the raw-XML value. docxtemplater re-inserts it verbatim and never parses it. Result: `{customer_name}`, `{secret_internal_note}` and `{#deals}` stayed literal, locked tokens merged, and the controls survived. Production code should do this with a real XML parser rather than the spike's regex, and should also refuse a section whose XML contains `w:sdt`, `w:fldSimple`/`w:instrText` (fields), or external relationships.

## What the design must include

1. **Editor profile.** `modifyContentControl:false` and `protect:false` in the service's editor config, set by a named profile (for example `profile: "contract-sections"`) rather than raw passthrough. Also disable the 9.4 "AI" toolbar plugin for this profile: it's present by default in 9.4 Community, and its egress was not assessed. 10.0 showed no AI tab.
2. **Template linter (CRM, at template upload).** The body must be only block-level `w:sdt`. Every control is either `locked:*` + `sdtContentLocked` or `section:*` + `sdtLocked`. Tags are unique, sections are not nested, and no `{` `}` appears inside a section's default content.
3. **Return validator and normaliser (CRM, on save callback).** Every `locked:*` control must be identical to the template's, compared on canonicalised XML or at least text plus run properties. Every `section:*` appears exactly once, in template order. Top-level blocks found between `section:X` and the next control are moved into `section:X` (the B1 defect). Anything else outside a control is rejected.
4. **Merge guard.** Splice sections out, merge, and splice them back as raw XML, as described above.
5. **Pre-PDF cleanup.** Unwrap `w:sdt` and drop `w:perm*` after merge, and normalise or install fonts before Gotenberg.

## Not verified / limits

- Paste was simulated with a synthetic `ClipboardEvent` carrying `text/html`, not the OS clipboard.
- Keyboard formatting on a collapsed caret at the very start of a paragraph was inconsistent in my automation. Selection-based bold/italic/size was confirmed on B1, A1 and the plain fixture, so I treat this as an automation artefact, but a human pass is worth five minutes.
- Co-editing (two users at once), mobile view, the Word desktop round-trip of these files, and track-changes interplay were not tested.
- Fidelity was checked on one page at 70–150 dpi by eye plus `pdffonts`; there was no pixel diff.
- 8.3 and 10.0 were covered only by the key tests (type in section, type in locked text, Enter at end, clear then type, settings/protection UI), not the full battery.
- The licensing and AGPL attribution changes in 9.4 were taken from the brief, not re-verified.

## Follow-ups (not done here)

Full-editor scope (current):

- Contract-first: a Platform ecosystem initiative plus a `monolith-docs-editor` API contract change for an editor profile on `POST /api/documents/open`: `modifyContentControl:false`, plugin registration (`editorConfig.plugins`), built-in AI tab off. Today `permissions` accepts only `edit`/`download`/`print`, and `buildEditorConfig` ignores the rest.
- CRM: field-control fill/refill with a real XML parser, a return check that every `field:`/`block:` control is still present, and the `sdtContentLocked` vs `contentLocked` decision (7′).
- AI panel, not yet tested: co-editing (two users) while a suggestion is written, plugin behaviour in view mode, and a suggestion that spans a `field:` control.
- Service upgrade 8.3 → 10.0 is a prerequisite for the AI panel (9c fails on 8.3). Items 7, 8 and 9a–9e passed on 9.4 and 10.0.

Original locked-sections scope (historical):

- CRM: template linter, return validator/normaliser, merge guard, pre-PDF unwrap.
- Optional: a Community plugin that catches Enter at a section's end, to remove the B1 defect in the editor. Not prototyped; plugins are available in Community.
- Re-evaluate A1 if OnlyOffice fixes empty editing ranges; it gives the better editing experience.
- Syncfusion Document Editor (restricted editing regions) only if a rep UX review rejects B1's Enter behaviour even with the normaliser.

Unresolved errors found during the spike: one, recorded in `ERRORS.md`. `apps/api/src/routes/documents.ts:213` logs OnlyOffice's callback `url`, a working download link to the user's document, at info level.
