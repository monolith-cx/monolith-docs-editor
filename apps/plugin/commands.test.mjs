// The bridge operations against a fake OnlyOffice Api (EDIT-5.3). The real editor runs them in the
// battery (E5b); this pins the anchor rules, the refusals, and the argument checks.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OPERATIONS, addComment, applySuggestion, getText, insertField, insertToken, scopeFor } from './commands.js';

/**
 * A fake document: paragraphs of runs and inline controls, with a log of what was written. By default
 * a tracked deletion keeps its text (what 10.0.0.1 does, E5b) and the insertion lands right after it;
 * `dropDeleted` models an editor whose deletion removes the text, so the insertion lands at the anchor.
 */
function fakeDoc(paragraphs, { dropDeleted = false } = {}) {
  const log = [];
  let track = false;
  const mkRange = (p, at, len) => ({
    GetText: () => p.text().slice(at, at + len),
    Delete: () => {
      log.push(['delete', p.index, at, len]);
      if (!dropDeleted) return;
      let pos = at;
      let left = len;
      for (const el of p.els) {
        if (left > 0 && pos < el.text.length && el.tag === undefined) {
          const cut = Math.min(left, el.text.length - pos);
          el.text = el.text.slice(0, pos) + el.text.slice(pos + cut);
          left -= cut;
          pos = 0;
          continue;
        }
        pos = Math.max(0, pos - el.text.length);
      }
    },
    AddText: (t, where) => {
      log.push(['addText', p.index, t, where]);
      let pos = dropDeleted ? at : at + len;
      for (const el of p.els) {
        if (pos <= el.text.length && el.tag === undefined) {
          el.text = el.text.slice(0, pos) + t + el.text.slice(pos);
          return;
        }
        pos -= el.text.length;
      }
    },
    AddComment: (t, author) => log.push(['comment', p.index, at, t, author]),
  });
  const paras = paragraphs.map((source, index) => {
    const els = source.map((e) => ({ ...e }));
    const p = {
      index,
      els,
      text: () => els.map((e) => e.text).join(''),
      GetElementsCount: () => els.length,
      GetElement: (j) =>
        els[j].tag !== undefined
          ? { GetClassType: () => 'inlineLvlSdt', GetRange: () => ({ GetText: () => els[j].text }), GetTag: () => els[j].tag }
          : { GetClassType: () => 'run', GetText: () => els[j].text },
      Search: (s) => {
        const out = [];
        const t = p.text();
        for (let at = t.indexOf(s); at >= 0; at = t.indexOf(s, at + s.length)) out.push(mkRange(p, at, s.length));
        return out;
      },
      GetClassType: () => 'paragraph',
    };
    return p;
  });
  const doc = {
    GetAllParagraphs: () => paras,
    GetSections: () => [],
    GetAllContentControls: () => [],
    IsTrackRevisions: () => track,
    SetTrackRevisions: (v) => {
      log.push(['track', v]);
      track = v;
    },
    InsertContent: (content, inline) => log.push(['insert', content.length, Boolean(inline)]),
  };
  return { doc, log };
}

const SENTENCE = [{ text: 'This Agreement starts on ' }, { tag: 'field:r1', text: '2026-11-01' }, { text: ' between Monolith and ' }, { tag: 'field:r2', text: 'Monolith Holdings' }, { text: '.' }];

let made;
beforeEach(() => {
  made = [];
  globalThis.Api = {
    GetDocument: () => current.doc,
    CreateRun: () => {
      const r = { kind: 'run', parts: [], AddText: (t) => r.parts.push(t), AddLineBreak: () => r.parts.push('<br>') };
      made.push(r);
      return r;
    },
    CreateInlineLvlSdt: () => {
      const c = { kind: 'inline', els: [], AddElement: (e) => c.els.push(e), SetTag: (t) => (c.tag = t), SetAlias: (a) => (c.alias = a), SetLock: (l) => (c.lock = l) };
      made.push(c);
      return c;
    },
    CreateBlockLvlSdt: () => {
      const c = { kind: 'block', els: [], AddElement: (e) => c.els.push(e), SetTag: (t) => (c.tag = t), SetAlias: (a) => (c.alias = a), SetLock: (l) => (c.lock = l) };
      made.push(c);
      return c;
    },
    CreateParagraph: () => {
      const p = { kind: 'paragraph', els: [], AddElement: (e) => p.els.push(e), AddInlineLvlSdt: (e) => p.els.push(e), AddText: (t) => p.els.push(t) };
      made.push(p);
      return p;
    },
  };
});
afterEach(() => {
  delete globalThis.Api;
  delete globalThis.Asc;
});
let current;
const use = (paragraphs, options) => (current = fakeDoc(paragraphs, options));
const run = (fn, scope) => {
  globalThis.Asc = { scope };
  return fn();
};

describe('getText', () => {
  it('returns body paragraphs with each field control span, tag, kind, and row id', () => {
    use([SENTENCE]);
    const got = run(getText, {});
    const p = got.body[0];
    expect(p.text).toBe('This Agreement starts on 2026-11-01 between Monolith and Monolith Holdings.');
    expect(p.fields).toEqual([
      { start: 25, end: 35, tag: 'field:r1', kind: 'field', rowId: 'r1' },
      { start: 57, end: 74, tag: 'field:r2', kind: 'field', rowId: 'r2' },
    ]);
  });
});

describe('applySuggestion', () => {
  const anchor = { paragraphIndex: 0, context: 'between Monolith and', occurrence: 0, find: 'Monolith', replace: 'Monolith Inc.' };

  it('replaces the anchored occurrence as one tracked change and restores track changes', () => {
    use([SENTENCE]);
    expect(run(applySuggestion, anchor)).toEqual({ ok: true, result: {} });
    expect(current.log).toEqual([['track', true], ['delete', 0, 44, 8], ['addText', 0, 'Monolith Inc.', 'after'], ['track', false]]);
  });

  it('refuses an occurrence inside a field control', () => {
    use([SENTENCE]);
    expect(run(applySuggestion, { ...anchor, context: 'Monolith Holdings', occurrence: 1 })).toEqual({ ok: false, error: 'inside_field' });
    expect(current.log).toEqual([]);
  });

  it('refuses a stale anchor: missing context, a context not around the occurrence, or a gone paragraph', () => {
    use([SENTENCE]);
    expect(run(applySuggestion, { ...anchor, context: 'between Monolith or' })).toEqual({ ok: false, error: 'stale_anchor' });
    expect(run(applySuggestion, { ...anchor, context: 'Agreement', find: 'Monolith' })).toEqual({ ok: false, error: 'stale_anchor' });
    expect(run(applySuggestion, { ...anchor, paragraphIndex: 3 })).toEqual({ ok: false, error: 'stale_anchor' });
    expect(run(applySuggestion, { ...anchor, occurrence: 5 })).toEqual({ ok: false, error: 'not_found' });
    expect(current.log).toEqual([]);
  });

  it('places the comment on the inserted text even when find contains replace; reports when it cannot', () => {
    use([[{ text: 'alpha beta gamma' }]]);
    const placed = run(applySuggestion, { paragraphIndex: 0, context: 'alpha beta gamma', occurrence: 0, find: 'beta gamma', replace: 'beta', comment: { text: 'shorter', author: 'Moli' } });
    expect(placed).toEqual({ ok: true, result: { commentPlaced: true } });
    // The deleted "beta gamma" (6-16) stays as tracked text; the inserted "beta" starts at 16.
    expect(current.log.find((e) => e[0] === 'comment')).toEqual(['comment', 0, 16, 'shorter', 'Moli']);
  });

  it('counts occurrences without overlap, as Search does', () => {
    use([[{ text: 'aaaa' }]]);
    expect(run(addComment, { paragraphIndex: 0, context: 'aaaa', occurrence: 1, find: 'aa', text: 'second pair', author: 'Rep' })).toEqual({ ok: true, result: {} });
    expect(current.log).toEqual([['comment', 0, 2, 'second pair', 'Rep']]);
    expect(run(addComment, { paragraphIndex: 0, context: 'aaaa', occurrence: 2, find: 'aa', text: 'x', author: 'Rep' })).toEqual({ ok: false, error: 'not_found' });
  });

  it('restores track changes when an edit throws', () => {
    use([SENTENCE]);
    const p = current.doc.GetAllParagraphs()[0];
    const search = p.Search;
    p.Search = (t) => search(t).map((r) => ({ ...r, Delete: () => { throw new Error('sandbox'); } }));
    expect(() => run(applySuggestion, anchor)).toThrow('sandbox');
    expect(current.doc.IsTrackRevisions()).toBe(false);
  });

  it('applies a pure deletion without inserting anything, and never loops on an empty needle', () => {
    use([[{ text: 'alpha beta gamma' }]]);
    expect(run(applySuggestion, { paragraphIndex: 0, context: 'alpha beta gamma', occurrence: 0, find: 'beta ', replace: '' })).toEqual({ ok: true, result: {} });
    expect(current.log).toEqual([['track', true], ['delete', 0, 6, 5], ['track', false]]);
    // A comment on a pure deletion is refused before the command; were one to reach it, it is not placed.
    expect(OPERATIONS.applySuggestion.valid({ paragraphIndex: 0, context: 'alpha beta', occurrence: 0, find: 'beta', replace: '', comment: { text: 'why', author: 'Moli' } })).toBe(false);
    expect(OPERATIONS.applySuggestion.valid({ paragraphIndex: 0, context: 'alpha beta', occurrence: 0, find: 'beta', replace: '' })).toBe(true);
    use([[{ text: 'alpha beta gamma' }]]);
    expect(run(applySuggestion, { paragraphIndex: 0, context: 'alpha beta gamma', occurrence: 0, find: 'beta', replace: '', comment: { text: 'why', author: 'Moli' } })).toEqual({ ok: true, result: { commentPlaced: false } });
    expect(current.log.some((e) => e[0] === 'comment')).toBe(false);
  }, 2000);

  // Where the comment lands, with the deletion's text kept (10.0.0.1) and dropped (any other editor):
  // always on the inserted text, or `commentPlaced: false`.
  const cases = [
    { name: 'replace also elsewhere', text: 'Acme and Acme Corp', find: 'Acme', occurrence: 0, context: 'Acme and', replace: 'Corp', kept: 4, dropped: 0 },
    { name: 'replace equals find', text: 'pay the fee now', find: 'fee', occurrence: 0, context: 'the fee now', replace: 'fee', kept: 11, dropped: 8 },
    { name: 'find contains replace', text: 'alpha beta gamma', find: 'beta gamma', occurrence: 0, context: 'alpha beta gamma', replace: 'beta', kept: 16, dropped: 6 },
    { name: 'replace before the find', text: 'net 30 days', find: 'days', occurrence: 0, context: '30 days', replace: 'net', kept: 11, dropped: 7 },
    { name: 'replace contains find', text: 'a b c', find: 'b', occurrence: 0, context: 'a b c', replace: 'bb', kept: null, dropped: 2 },
  ];
  for (const c of cases) {
    for (const dropDeleted of [false, true]) {
      it(`comment placement: ${c.name}, deleted text ${dropDeleted ? 'dropped' : 'kept'}`, () => {
        use([[{ text: c.text }]], { dropDeleted });
        const got = run(applySuggestion, { paragraphIndex: 0, context: c.context, occurrence: c.occurrence, find: c.find, replace: c.replace, comment: { text: 'n', author: 'Moli' } });
        const want = dropDeleted ? c.dropped : c.kept;
        expect(got).toEqual({ ok: true, result: { commentPlaced: want !== null } });
        const comment = current.log.find((e) => e[0] === 'comment');
        if (want === null) expect(comment).toBeUndefined();
        else expect(comment).toEqual(['comment', 0, want, 'n', 'Moli']);
      });
    }
  }

  it('anchors the comment on the inserted text, right after the tracked deletion', () => {
    use([SENTENCE]);
    run(applySuggestion, { ...anchor, comment: { text: 'use the legal name', author: 'Moli' } });
    // The deleted "Monolith" (44-52) stays as tracked text; the insertion starts at 52.
    expect(current.log.find((e) => e[0] === 'comment')).toEqual(['comment', 0, 52, 'use the legal name', 'Moli']);
  });
});

describe('addComment', () => {
  it('comments on the anchored occurrence and refuses a stale anchor', () => {
    use([SENTENCE]);
    expect(run(addComment, { paragraphIndex: 0, context: 'starts on', occurrence: 0, find: 'starts', text: 'check', author: 'Rep' })).toEqual({ ok: true, result: {} });
    expect(current.log).toEqual([['comment', 0, 15, 'check', 'Rep']]);
    expect(run(addComment, { paragraphIndex: 0, context: 'ends on', occurrence: 0, find: 'ends', text: 'x', author: 'y' })).toEqual({ ok: false, error: 'stale_anchor' });
  });
});

describe('insertField and insertToken', () => {
  it('inserts an inline field with the loose lock, a line break for a newline', () => {
    use([SENTENCE]);
    expect(run(insertField, { rowId: 'r9', label: 'Start date', value: 'line one\nline two', kind: 'inline' })).toEqual({ ok: true, result: { tag: 'field:r9' } });
    const cc = made.find((m) => m.kind === 'inline');
    expect(cc).toMatchObject({ tag: 'field:r9', alias: 'Start date', lock: 'contentLocked' });
    expect(cc.els[0].parts).toEqual(['line one', '<br>', 'line two']);
    expect(current.log).toEqual([['insert', 1, true]]);
  });

  it('inserts a block field with the strict lock', () => {
    use([SENTENCE]);
    run(insertField, { rowId: 'b1', label: 'Line items', value: 'rows', kind: 'block' });
    expect(made.find((m) => m.kind === 'block')).toMatchObject({ tag: 'block:b1', lock: 'sdtContentLocked' });
    expect(current.log).toEqual([['insert', 1, false]]);
  });

  it('inserts a token as plain text', () => {
    use([SENTENCE]);
    run(insertToken, { token: '{customer.name}' });
    expect(made.find((m) => m.kind === 'paragraph').els).toEqual(['{customer.name}']);
  });
});

describe('argument checks', () => {
  const v = (op, a) => OPERATIONS[op].valid(a);
  it('refuses bad row ids, control characters, the signer-tag grammar, and anchors whose context lacks find', () => {
    expect(v('insertField', { rowId: 'r1', label: 'A', value: 'x', kind: 'inline' })).toBe(true);
    expect(v('insertField', { rowId: 'r.1', label: 'A', value: 'x', kind: 'inline' })).toBe(false);
    expect(v('insertField', { rowId: 'r1', label: 'A', value: 'x\u0007', kind: 'inline' })).toBe(false);
    expect(v('insertField', { rowId: 'r1', label: 'A', value: 'sign here \\s1\\', kind: 'inline' })).toBe(false);
    expect(v('insertField', { rowId: 'r1', label: 'A', value: 'x', kind: 'table' })).toBe(false);
    expect(v('insertToken', { token: 'a\nb' })).toBe(false);
    expect(v('applySuggestion', { paragraphIndex: 0, context: 'abc', occurrence: 0, find: 'zzz', replace: 'y' })).toBe(false);
    expect(v('applySuggestion', { paragraphIndex: 0, context: 'abc', occurrence: 0, find: 'b', replace: 'y\\s2\\' })).toBe(false);
    expect(v('applySuggestion', { paragraphIndex: -1, context: 'abc', occurrence: 0, find: 'b', replace: 'y' })).toBe(false);
    expect(v('addComment', { paragraphIndex: 0, context: 'abc', occurrence: 0, find: 'b', text: 't', author: 'a' })).toBe(true);
  });

  it('refuses a missing or non-string row id, the signer tag in any text, line breaks in single-line text, lone surrogates', () => {
    expect(v('insertField', { label: 'A', value: 'x', kind: 'inline' })).toBe(false);
    expect(v('insertField', { rowId: 7, label: 'A', value: 'x', kind: 'inline' })).toBe(false);
    expect(v('insertField', { rowId: ['r1'], label: 'A', value: 'x', kind: 'inline' })).toBe(false);
    expect(v('insertField', { rowId: 'r1', label: 'sign \\s1\\', value: 'x', kind: 'inline' })).toBe(false);
    expect(v('applySuggestion', { paragraphIndex: 0, context: 'abc', occurrence: 0, find: 'b', replace: 'y', comment: { text: 'see \\s2\\', author: 'M' } })).toBe(false);
    expect(v('applySuggestion', { paragraphIndex: 0, context: 'abc', occurrence: 0, find: 'b', replace: 'y', comment: { text: 'ok', author: 'M\\a1\\' } })).toBe(false);
    expect(v('addComment', { paragraphIndex: 0, context: 'abc', occurrence: 0, find: 'b', text: 't', author: 'a\\z9\\' })).toBe(false);
    expect(v('insertToken', { token: 'a\rb' })).toBe(false);
    expect(v('insertToken', { token: 'a\ud800b' })).toBe(false);
    expect(v('insertToken', { token: '\ud83d\ude00' })).toBe(true);
  });

  it('builds the command scope from the operation keys only', () => {
    expect(scopeFor(OPERATIONS.applySuggestion.keys, { paragraphIndex: 1, find: 'a', context: 'a', occurrence: 0, replace: 'b', comment: { text: 't', author: 'a', extra: 1 }, other: 'x' })).toEqual({
      paragraphIndex: 1, find: 'a', context: 'a', occurrence: 0, replace: 'b', comment: { text: 't', author: 'a' },
    });
    expect(scopeFor(OPERATIONS.getText.keys, { anything: 1 })).toEqual({});
  });
});

describe('origin rules in the source (EDIT-5.4)', () => {
  it("never posts to '*'", () => {
    const bridge = readFileSync(new URL('./bridge.js', import.meta.url), 'utf8');
    expect(bridge).not.toMatch(/postMessage\([^)]*['"]\*['"]/);
  });
});
