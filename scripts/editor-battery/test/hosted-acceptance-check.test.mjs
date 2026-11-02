import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BRIDGE_OPERATIONS, HSTS, acceptanceFailures, redact } from '../src/hosted-acceptance-check.mjs';

const EDITOR = 'https://editor-dev.monolith.cx';
const MARKER = 'EDIT-6.7 acceptance 2026-11-02T04:19:41.123Z';
const passing = () => ({
  editorHsts: { status: 200, hsts: HSTS },
  stubHsts: { status: 200, hsts: HSTS },
  framedByStub: true,
  documentDrawn: true,
  panelReady: true,
  panelOperations: [...BRIDGE_OPERATIONS].reverse(),
  cspViolations: 0,
  sessionNotifications: [
    { status: 1, valid: true, reason: null },
    { status: 2, valid: true, reason: null },
  ],
  finalSave: { status: 2, valid: true, downloadOrigin: EDITOR, downloaded: { bytes: 26081, zip: true, hasDocumentXml: true, markers: [MARKER] } },
  foreignFrame: { editorLoaded: false, refused: true },
});

test('a complete run passes', () => {
  assert.deepEqual(acceptanceFailures(passing(), EDITOR, MARKER), []);
});

test('each missing fact fails the run, naming that fact', () => {
  const cases = [
    [(e) => (e.editorHsts.hsts = null), 'editor host answers over TLS with HSTS'],
    [(e) => (e.stubHsts = { status: 200, hsts: 'max-age=0' }), 'stub host answers over TLS with HSTS'],
    [(e) => (e.editorHsts.hsts = 'max-age=60'), 'editor host answers over TLS with HSTS'],
    [(e) => (e.framedByStub = false), 'the stub frames the editor'],
    [(e) => (e.documentDrawn = false), 'the document drew'],
    [(e) => (e.panelReady = false), 'the panel got udoc.ready'],
    [(e) => e.panelOperations.pop(), 'the panel lists the six bridge operations'],
    [(e) => (e.panelOperations[0] = 'deleteDocument'), 'the panel lists the six bridge operations'],
    [(e) => (e.cspViolations = 1), 'no CSP violation'],
    [(e) => (e.sessionNotifications = [{ status: 2, valid: true }]), 'a verified status-1 notification for the session'],
    [(e) => e.sessionNotifications.push({ status: 2, valid: false, reason: 'replay' }), 'every notification for the session verified'],
    [(e) => (e.finalSave = null), 'a verified final save (status 2)'],
    [(e) => (e.finalSave.status = 6), 'a verified final save (status 2)'],
    [(e) => (e.finalSave.downloadOrigin = 'https://elsewhere.example'), 'the save downloaded from the editor origin'],
    [(e) => (e.finalSave.downloaded = { refused: 'download origin is not the editor' }), 'the save is a DOCX'],
    [(e) => (e.finalSave.downloaded.hasDocumentXml = false), 'the save is a DOCX'],
    [(e) => (e.finalSave.downloaded.markers = []), 'the typed text is in the saved document'],
    [(e) => (e.finalSave.downloaded.markers = ['EDIT-6.7 acceptance 2026-11-01T00:00:00.000Z']), 'the typed text is in the saved document'],
    [(e) => (e.foreignFrame.editorLoaded = true), 'another origin cannot frame the editor'],
    [(e) => (e.foreignFrame.refused = false), 'another origin cannot frame the editor'],
  ];
  for (const [mutate, expected] of cases) {
    const evidence = passing();
    mutate(evidence);
    assert.ok(acceptanceFailures(evidence, EDITOR, MARKER).includes(expected), `${mutate} should fail: ${expected}`);
  }
});

test('no marker typed is a failure', () => {
  assert.ok(acceptanceFailures(passing(), EDITOR, null).includes('the typed text is in the saved document'));
});

test('redaction removes the key and cuts every URL to its origin', () => {
  const key = 'k3y-VALUE_123';
  const text = `page.goto: net::ERR at https://editor-stub-dev.monolith.cx/launch?k=${key} and Framing 'https://editor-dev.monolith.cx/editor/SEALED.TOKEN' refused; raw ${key}`;
  const out = redact(text, key);
  assert.ok(!out.includes(key));
  assert.ok(!out.includes('SEALED.TOKEN'));
  assert.ok(!out.includes('/launch'));
  assert.ok(out.includes('https://editor-stub-dev.monolith.cx/…'));
  assert.ok(out.includes('https://editor-dev.monolith.cx/…'));
  assert.equal(redact('no secrets here', ''), 'no secrets here');
  const json = JSON.stringify({ sample: `directive "frame-ancestors 'self' https://editor-stub-dev.monolith.cx". blocked` });
  assert.doesNotThrow(() => JSON.parse(redact(json, key)));
});
