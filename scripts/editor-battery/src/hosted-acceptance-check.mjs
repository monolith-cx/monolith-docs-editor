// The hosted acceptance's pure parts (EDIT-6.7): what counts as a pass, and what may be printed.
// Kept apart from the browser run so both are tested (test/hosted-acceptance-check.test.mjs).

/** Text safe to print: the launch key removed, and every URL cut to its origin (an editor URL is a bearer capability). */
export function redact(text, key) {
  const withoutKey = key ? String(text).split(key).join('***') : String(text);
  // A backslash ends a URL too: printed text is JSON, where a quote after a URL is escaped.
  return withoutKey.replace(/https?:\/\/[^\s'"<>\\]+/g, (u) => {
    try {
      return `${new URL(u).origin}/…`;
    } catch {
      return '…';
    }
  });
}

/** What the shared Caddy sends for the editor's hosts (Caddyfile.editor). */
export const HSTS = 'max-age=31536000; includeSubDomains';
/** The bridge's protocol-1 operations (EDIT-5, consumer guide section 7). */
export const BRIDGE_OPERATIONS = ['getText', 'getSelection', 'insertField', 'insertToken', 'applySuggestion', 'addComment'];

const hstsOk = (e) => e?.status === 200 && e.hsts === HSTS;
const sameSet = (a, b) => Array.isArray(a) && a.length === b.length && b.every((x) => a.includes(x));

/** Every acceptance item EDIT-6.7 names, by the facts the run collected; F2 is read from the API's log. */
export function acceptanceFailures(evidence, editorOrigin, marker) {
  const failures = [];
  const check = (ok, what) => {
    if (!ok) failures.push(what);
  };
  check(hstsOk(evidence.editorHsts), 'editor host answers over TLS with HSTS');
  check(hstsOk(evidence.stubHsts), 'stub host answers over TLS with HSTS');
  check(evidence.framedByStub === true, 'the stub frames the editor');
  check(evidence.documentDrawn === true, 'the document drew');
  check(evidence.panelReady === true, 'the panel got udoc.ready');
  check(sameSet(evidence.panelOperations, BRIDGE_OPERATIONS), 'the panel lists the six bridge operations');
  check(evidence.cspViolations === 0, 'no CSP violation');
  const notes = evidence.sessionNotifications ?? [];
  check(notes.some((n) => n.status === 1 && n.valid === true), 'a verified status-1 notification for the session');
  check(notes.every((n) => n.valid === true), 'every notification for the session verified');
  const save = evidence.finalSave;
  check(save?.status === 2 && save?.valid === true, 'a verified final save (status 2)');
  check(save?.downloadOrigin === editorOrigin, 'the save downloaded from the editor origin');
  check(save?.downloaded?.zip === true && save?.downloaded?.hasDocumentXml === true, 'the save is a DOCX');
  check(Boolean(marker) && Array.isArray(save?.downloaded?.markers) && save.downloaded.markers.includes(marker), 'the typed text is in the saved document');
  check(evidence.foreignFrame?.refused === true && evidence.foreignFrame?.editorLoaded === false, 'another origin cannot frame the editor');
  return failures;
}
