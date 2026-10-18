// @ts-check
/**
 * The bridge's operations inside the editor (EDIT-5.3, UDOC D14). Each one is a single
 * `Asc.plugin.callCommand` function: one call is one undo step, and every anchor is found and
 * re-verified inside the same call, so nothing can move between reading and writing.
 *
 * These functions are serialised by `callCommand` and run in DocumentServer's document sandbox:
 * each must be self-contained (no closures, no imports, ES5-style syntax), reading its arguments
 * from `Asc.scope` and the document through `Api`. The tests run them against a fake `Api`.
 *
 * Anchors (applySuggestion, addComment) are `{ paragraphIndex, context, occurrence, find }`:
 * `paragraphIndex` indexes the body paragraphs `getText` returns, `occurrence` is the 0-based index
 * among the occurrences of `find` in that paragraph's text, and `context` is text around that
 * occurrence that must still be there. `Search` returns matches inside content controls too and in
 * document order (probed on 10.0.0.1), so the occurrence index maps onto its results; character
 * offsets are never used to build ranges (`GetRange` offsets drift once controls exist, EDIT-1).
 */

/* global Api, Asc */

/** Reads every story part the plugin API exposes, with each control's span, tag, kind, and row id. */
export function getText() {
  /** @param {ApiParagraph} p */
  function readParagraph(p) {
    var text = '';
    /** @type {Array<{ start: number, end: number, tag: string, kind: string, rowId: string | null }>} */
    var fields = [];
    var n = p.GetElementsCount();
    for (var j = 0; j < n; j++) {
      var el = p.GetElement(j);
      var type = el.GetClassType();
      var t = '';
      if (type === 'inlineLvlSdt') {
        t = el.GetRange().GetText();
        var tag = el.GetTag() || '';
        var kind = tag.indexOf('field:') === 0 ? 'field' : tag.indexOf('block:') === 0 ? 'block' : 'other';
        fields.push({ start: text.length, end: text.length + t.length, tag: tag, kind: kind, rowId: kind === 'other' ? null : tag.slice(tag.indexOf(':') + 1) });
      } else if (el.GetText) {
        t = el.GetText();
      }
      text += t;
    }
    return { text: text, fields: fields };
  }
  /** @param {ApiDocumentContent | null} content */
  function readContent(content) {
    /** @type {Array<{ text: string, fields: Array<{ start: number, end: number, tag: string, kind: string, rowId: string | null }> }>} */
    var out = [];
    if (!content) return out;
    var n = content.GetElementsCount();
    for (var k = 0; k < n; k++) {
      var el = content.GetElement(k);
      if (el.GetClassType() === 'paragraph') out.push(readParagraph(el));
    }
    return out;
  }
  var doc = Api.GetDocument();
  var body = [];
  var ps = doc.GetAllParagraphs();
  for (var i = 0; i < ps.length; i++) {
    var r = readParagraph(ps[i]);
    body.push({ index: i, text: r.text, fields: r.fields });
  }
  var headers = [];
  var footers = [];
  var sections = doc.GetSections();
  var types = ['default', 'first', 'even'];
  for (var s = 0; s < sections.length; s++) {
    for (var x = 0; x < types.length; x++) {
      var h = sections[s].GetHeader(types[x], false);
      if (h) headers.push({ section: s, type: types[x], paragraphs: readContent(h) });
      var f = sections[s].GetFooter(types[x], false);
      if (f) footers.push({ section: s, type: types[x], paragraphs: readContent(f) });
    }
  }
  var blocks = [];
  var all = doc.GetAllContentControls();
  for (var b = 0; b < all.length; b++) {
    if (all[b].GetClassType() === 'blockLvlSdt') {
      var btag = all[b].GetTag() || '';
      blocks.push({ tag: btag, kind: btag.indexOf('block:') === 0 ? 'block' : 'other', rowId: btag.indexOf('block:') === 0 ? btag.slice(6) : null });
    }
  }
  return { body: body, headers: headers, footers: footers, blocks: blocks };
}

/** Inserts a field control at the cursor: inline `field:<rowId>` (contentLocked) or block `block:<rowId>` (sdtContentLocked), D11. */
export function insertField() {
  var a = Asc.scope;
  var doc = Api.GetDocument();
  /** @param {ApiContentControl | ApiParagraph} target */
  function addValue(target) {
    var lines = String(a.value).split('\n');
    var run = Api.CreateRun();
    for (var i = 0; i < lines.length; i++) {
      if (i > 0) run.AddLineBreak();
      run.AddText(lines[i]);
    }
    target.AddElement(run, 0);
  }
  if (a.kind === 'block') {
    var block = Api.CreateBlockLvlSdt();
    var para = Api.CreateParagraph();
    addValue(para);
    block.AddElement(para, 0);
    block.SetTag('block:' + a.rowId);
    block.SetAlias(a.label);
    block.SetLock('sdtContentLocked');
    doc.InsertContent([block]);
    return { ok: true, result: { tag: 'block:' + a.rowId } };
  }
  var cc = Api.CreateInlineLvlSdt();
  addValue(cc);
  cc.SetTag('field:' + a.rowId);
  cc.SetAlias(a.label);
  cc.SetLock('contentLocked');
  var p = Api.CreateParagraph();
  p.AddInlineLvlSdt(cc);
  doc.InsertContent([p], true);
  return { ok: true, result: { tag: 'field:' + a.rowId } };
}

/** Inserts a template token as plain text at the cursor. */
export function insertToken() {
  var p = Api.CreateParagraph();
  p.AddText(String(Asc.scope.token));
  Api.GetDocument().InsertContent([p], true);
  return { ok: true, result: {} };
}

/**
 * Replaces one anchored occurrence as a tracked change (track changes forced on, then restored even
 * if an edit throws), with an optional comment on the inserted text, in one call (the spike's 9c
 * recipe). The comment's place is computed, not guessed: the paragraph's length change tells whether
 * the tracked deletion kept its text (the insertion then follows it) or not (the insertion is at the
 * anchor), the inserted text must be found exactly there, and otherwise the answer says the comment
 * was not placed rather than putting it on the wrong text. An empty `replace` is a pure deletion and
 * takes no comment (the argument check refuses one: there is no inserted text to carry it).
 */
export function applySuggestion() {
  var a = Asc.scope;
  var doc = Api.GetDocument();
  var ps = doc.GetAllParagraphs();
  if (a.paragraphIndex < 0 || a.paragraphIndex >= ps.length) return { ok: false, error: 'stale_anchor' };
  var p = ps[a.paragraphIndex];
  /** @param {ApiParagraph} para */
  function readText(para) {
    var out = '';
    for (var j = 0; j < para.GetElementsCount(); j++) {
      var el = para.GetElement(j);
      out += el.GetClassType() === 'inlineLvlSdt' ? el.GetRange().GetText() : el.GetText ? el.GetText() : '';
    }
    return out;
  }
  /** Non-overlapping occurrences, as Search finds them. @param {string} hay @param {string} needle */
  function occurrences(hay, needle) {
    /** @type {number[]} */
    var out = [];
    if (!needle) return out;
    for (var at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) out.push(at);
    return out;
  }
  var text = '';
  var spans = [];
  for (var j = 0; j < p.GetElementsCount(); j++) {
    var el = p.GetElement(j);
    var t = el.GetClassType() === 'inlineLvlSdt' ? el.GetRange().GetText() : el.GetText ? el.GetText() : '';
    if (el.GetClassType() === 'inlineLvlSdt') spans.push([text.length, text.length + t.length]);
    text += t;
  }
  if (text.indexOf(a.context) < 0) return { ok: false, error: 'stale_anchor' };
  var offsets = occurrences(text, a.find);
  if (a.occurrence >= offsets.length) return { ok: false, error: 'not_found' };
  var start = offsets[a.occurrence];
  var end = start + a.find.length;
  var covered = false;
  for (var c = text.indexOf(a.context); c >= 0; c = text.indexOf(a.context, c + 1)) {
    if (c <= start && end <= c + a.context.length) covered = true;
  }
  if (!covered) return { ok: false, error: 'stale_anchor' };
  for (var s = 0; s < spans.length; s++) {
    if (start < spans[s][1] && spans[s][0] < end) return { ok: false, error: 'inside_field' };
  }
  var found = p.Search(a.find, true);
  if (!found || found.length !== offsets.length) return { ok: false, error: 'stale_anchor' };
  var range = found[a.occurrence];
  var prev = doc.IsTrackRevisions();
  var placed = false;
  doc.SetTrackRevisions(true);
  try {
    range.Delete();
    if (a.replace) range.AddText(a.replace, 'after');
    if (a.comment && a.replace) {
      var text2 = readText(p);
      var grown = text2.length - text.length;
      var at = grown === a.replace.length ? end : grown === a.replace.length - a.find.length ? start : -1;
      if (at >= 0 && text2.substr(at, a.replace.length) === a.replace) {
        var all = occurrences(text2, a.replace);
        var idx = -1;
        for (var q = 0; q < all.length; q++) if (all[q] === at) idx = q;
        var hits = p.Search(a.replace, true) || [];
        if (idx >= 0 && hits.length === all.length && hits[idx]) {
          hits[idx].AddComment(a.comment.text, a.comment.author);
          placed = true;
        }
      }
    }
  } finally {
    doc.SetTrackRevisions(prev);
  }
  return { ok: true, result: a.comment ? { commentPlaced: placed } : {} };
}

/** Adds a comment on one anchored occurrence. */
export function addComment() {
  var a = Asc.scope;
  var ps = Api.GetDocument().GetAllParagraphs();
  if (a.paragraphIndex < 0 || a.paragraphIndex >= ps.length) return { ok: false, error: 'stale_anchor' };
  var p = ps[a.paragraphIndex];
  var text = '';
  for (var j = 0; j < p.GetElementsCount(); j++) {
    var el = p.GetElement(j);
    text += el.GetClassType() === 'inlineLvlSdt' ? el.GetRange().GetText() : el.GetText ? el.GetText() : '';
  }
  if (text.indexOf(a.context) < 0) return { ok: false, error: 'stale_anchor' };
  var offsets = [];
  if (!a.find) return { ok: false, error: 'not_found' };
  for (var at = text.indexOf(a.find); at >= 0; at = text.indexOf(a.find, at + a.find.length)) offsets.push(at);
  if (a.occurrence >= offsets.length) return { ok: false, error: 'not_found' };
  var start = offsets[a.occurrence];
  var covered = false;
  for (var c = text.indexOf(a.context); c >= 0; c = text.indexOf(a.context, c + 1)) {
    if (c <= start && start + a.find.length <= c + a.context.length) covered = true;
  }
  if (!covered) return { ok: false, error: 'stale_anchor' };
  var found = p.Search(a.find, true);
  if (!found || found.length !== offsets.length) return { ok: false, error: 'stale_anchor' };
  found[a.occurrence].AddComment(a.text, a.author);
  return { ok: true, result: {} };
}

// --- Argument checks (run in the plugin frame, before any command) ---

/**
 * Characters that never belong in text written to the document: C0 controls except tab and newline,
 * U+FFFE/U+FFFF, and lone surrogates (all invalid in XML).
 */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?:^|[^\ud800-\udbff])[\udc00-\udfff]/;
/** The signer-tag grammar (`\s1\`), refused in every string a panel writes (D15). */
const SIGNER_TAG = /\\[A-Za-z]+\d+\\/;
const ROW_ID = /^[0-9A-Za-z_-]{1,64}$/;

/** Free text written to the document: a string, within its cap, no forbidden character, no signer tag. @param {unknown} v @param {number} max @param {boolean} [singleLine] */
function text(v, max, singleLine) {
  return typeof v === 'string' && v.length > 0 && v.length <= max && !FORBIDDEN.test(v) && !SIGNER_TAG.test(v) && !(singleLine && /[\r\n]/.test(v));
}

/** @param {unknown} v */
function isIndex(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 100000;
}

/** @typedef {{ paragraphIndex?: unknown, occurrence?: unknown, find?: unknown, context?: unknown }} AnchorArgs */

/** @param {AnchorArgs} a */
function anchorValid(a) {
  return isIndex(a.paragraphIndex) && isIndex(a.occurrence) && text(a.find, 1000) && text(a.context, 4000) && String(a.context).indexOf(String(a.find)) >= 0;
}

/** @typedef {Record<string, unknown>} Args */

/**
 * The operation set (D14): the command each runs, its argument check, and the keys it reads (the
 * command's scope is built from these alone). An operation is added, never changed in place.
 * @type {Record<string, { command: (() => unknown) | null, keys: string[], valid: (a: Args) => boolean }>}
 */
export const OPERATIONS = {
  getText: { command: getText, keys: [], valid: () => true },
  getSelection: { command: null, keys: [], valid: () => true },
  insertField: {
    command: insertField,
    keys: ['rowId', 'label', 'value', 'kind'],
    valid: (a) =>
      typeof a.rowId === 'string' &&
      ROW_ID.test(a.rowId) &&
      text(a.label, 200, true) &&
      typeof a.value === 'string' &&
      a.value.length <= 10000 &&
      !FORBIDDEN.test(a.value) &&
      !SIGNER_TAG.test(a.value) &&
      (a.kind === 'inline' || a.kind === 'block'),
  },
  insertToken: { command: insertToken, keys: ['token'], valid: (a) => text(a.token, 200, true) },
  applySuggestion: {
    command: applySuggestion,
    keys: ['paragraphIndex', 'context', 'occurrence', 'find', 'replace', 'comment'],
    valid: (a) => {
      const comment = /** @type {{ text?: unknown, author?: unknown } | undefined} */ (a.comment);
      return (
        anchorValid(a) &&
        typeof a.replace === 'string' &&
        a.replace.length <= 4000 &&
        !FORBIDDEN.test(a.replace) &&
        !SIGNER_TAG.test(a.replace) &&
        !/[\r\n]/.test(a.replace) &&
        (comment === undefined || (a.replace.length > 0 && typeof comment === 'object' && comment !== null && text(comment.text, 2000) && text(comment.author, 100, true)))
      );
    },
  },
  addComment: { command: addComment, keys: ['paragraphIndex', 'context', 'occurrence', 'find', 'text', 'author'], valid: (a) => anchorValid(a) && text(a.text, 2000) && text(a.author, 100, true) },
};

/**
 * The scope a command reads: only the operation's keys, and only a comment's own two fields, so
 * nothing else a panel sends travels into the document sandbox.
 * @param {string[]} keys @param {Args} a @returns {Args}
 */
export function scopeFor(keys, a) {
  /** @type {Args} */
  const out = {};
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(a, k)) continue;
    const v = a[k];
    if (k === 'comment' && v && typeof v === 'object') {
      const c = /** @type {{ text?: unknown, author?: unknown }} */ (v);
      out[k] = { text: c.text, author: c.author };
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** The protocol version the plugin speaks; an operation is only ever added. */
export const PROTOCOL_VERSION = 1;
