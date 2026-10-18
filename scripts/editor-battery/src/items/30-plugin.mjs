// Spike items 9a–9e on the pinned release (EDIT-1.4): the plugin as a docked panel,
// reading the document, tracked suggestions with a comment, undo grouping, and
// network calls from the plugin's own origin.
import { count, paragraphs } from '../docx.mjs';
import { Editor, buildConfig } from '../editor.mjs';
import { VALUES } from '../fixtures.mjs';
import { forceSave, uniqueKey } from '../flow.mjs';
import { STUB_C, events, resetStub } from '../stack.mjs';

const FIXTURE = 'contract-cl.docx';

async function open(context, secrets, prefix) {
  const key = uniqueKey(prefix);
  const editor = await Editor.open(context, secrets.jwtSecret, buildConfig({ fixture: FIXTURE, key }));
  return { editor, key };
}

/** The spike's 9c recipe: one callCommand, track changes forced on then restored. */
export const SUGGEST = `function () {
  var d = Api.GetDocument();
  var prev = d.IsTrackRevisions();
  d.SetTrackRevisions(true);
  var found = d.Search(Asc.scope.find, true);
  if (!found || !found.length) { d.SetTrackRevisions(prev); return 'not-found'; }
  var r = found[0];
  r.Delete();
  r.AddText(Asc.scope.rep, 'after');
  var ins = d.Search(Asc.scope.rep, true);
  if (ins && ins.length) ins[0].AddComment(Asc.scope.note, 'Moli');
  d.SetTrackRevisions(prev);
  return 'ok';
}`;

const item9a = {
  id: '9a',
  order: 90,
  title: 'Plugin opens as a persistent right-side panel while editing continues',
  parent: 'UDOC-1.1 / spike 9a',
  async run({ context, secrets }) {
    await resetStub();
    const { editor } = await open(context, secrets, 'i9a');
    const panel = await (await editor.probe.frameElement()).boundingBox();
    const whole = await editor.page.locator('iframe[name="frameEditor"]').boundingBox();
    // The document area must have narrowed to make room for the panel, not be overlapped by it.
    const docArea = await editor.editorFrame().evaluate(() => {
      const el = document.querySelector('#editor_sdk') || document.querySelector('#id_main');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, width: r.width };
    });
    await editor.focusDocument();
    await editor.selectText('ENDMARKER');
    await editor.press('End');
    await editor.type(' 55555 typed with panel open');
    const typed = (await editor.paragraphTexts()).some((t) => t.includes('55555 typed with panel open'));
    const stillOpen = await editor.probe.evaluate(() => Boolean(window.__probe && window.__probe.ready)).catch(() => false);
    await editor.close();
    const narrowed = Boolean(docArea && whole && docArea.x + docArea.width <= panel.x - whole.x + 2);
    const docked = panel && whole && panel.x > whole.x + whole.width * 0.55 && panel.width >= 200 && panel.height >= 300 && narrowed;
    const ok = docked && typed && stillOpen;
    return {
      result: ok ? 'pass' : 'fail',
      evidence: [
        `panel box x=${Math.round(panel?.x)} w=${Math.round(panel?.width)} h=${Math.round(panel?.height)} within editor x=${Math.round(whole?.x)} w=${Math.round(whole?.width)}; document area ends at ${docArea ? Math.round(docArea.x + docArea.width) : 'n/a'} (narrowed beside the panel ${narrowed}): docked right ${docked}`,
        `typing in the document with the panel open: ${typed}; panel still running after typing: ${stillOpen}`,
      ],
    };
  },
};

const item9b = {
  id: '9b',
  order: 91,
  title: 'Plugin reads the whole document, paragraph boundaries, and the selection',
  parent: 'UDOC-1.1 / spike 9b',
  async run({ context, secrets }) {
    await resetStub();
    const { editor } = await open(context, secrets, 'i9b');
    const paras = await editor.paragraphTexts();
    await editor.focusDocument();
    await editor.selectText('between Monolith');
    const viaMethod = await editor.method('GetSelectedText', [{ Numbering: false, Math: false, TableCellSeparator: '\t', ParaSeparator: '\n', TabSymbol: '\t' }]);
    const viaApi = await editor.command('function () { return Api.GetDocument().GetRangeBySelect().GetText(); }', {}, { recalc: false });
    await editor.close();
    const valuesInline = paras.some((t) => t.includes(`starts on ${VALUES.r1} between Monolith and ${VALUES.r2}`));
    const cells = ['Widget', 'Gadget'].every((c) => paras.includes(c) || paras.some((t) => t.startsWith(c)));
    const ok = valuesInline && cells && viaMethod === 'between Monolith' && viaApi === 'between Monolith';
    return {
      result: ok ? 'pass' : 'fail',
      evidence: [
        `${paras.length} paragraphs; field values inline in paragraph text: ${valuesInline}; table cells as paragraphs: ${cells}`,
        `selection via GetSelectedText: ${JSON.stringify(viaMethod)}; via GetRangeBySelect: ${JSON.stringify(viaApi)}`,
      ],
    };
  },
};

const item9c = {
  id: '9c',
  order: 92,
  title: 'A suggestion lands as a tracked deletion and insertion with an anchored comment',
  parent: 'UDOC-1.1 / spike 9c',
  async run({ context, secrets }) {
    await resetStub();
    const { editor, key } = await open(context, secrets, 'i9c');
    const outcome = await editor.command(SUGGEST, { find: 'between Monolith', rep: 'between Monolith Inc.', note: 'Moli: use the legal name' });
    const track = await editor.command('function () { return Api.GetDocument().IsTrackRevisions(); }', {}, { recalc: false });
    const saved = await forceSave(secrets.jwtSecret, key);
    await editor.close();
    if (!saved.event) return { result: 'fail', evidence: [`recipe ${outcome}; force-save produced no file`] };
    const xml = saved.documentXml;
    const ins = count(xml, 'ins');
    const del = count(xml, 'del');
    const comments = saved.zip.file('word/comments.xml') ? await saved.zip.file('word/comments.xml').async('string') : '';
    const commentOk = comments.includes('Moli: use the legal name') && /w:author="Moli"/.test(comments);
    const anchored = count(xml, 'commentRangeStart') >= 1;
    const ok = outcome === 'ok' && ins >= 1 && del >= 1 && commentOk && anchored && track === false;
    return {
      result: ok ? 'pass' : 'fail',
      evidence: [
        `recipe: ${outcome}; track changes restored to off: ${track === false}`,
        `saved file: ${ins} w:ins, ${del} w:del; comment with author Moli: ${commentOk}; anchored range: ${anchored}`,
      ],
    };
  },
};

const item9d = {
  id: '9d',
  order: 93,
  title: 'One callCommand is one undo step; two calls need two undos',
  parent: 'UDOC-1.1 / spike 9d',
  async run({ context, secrets }) {
    await resetStub();
    const evidence = [];
    const { editor } = await open(context, secrets, 'i9d');
    await editor.command(SUGGEST, { find: 'payable', rep: 'remitted', note: 'Moli: wording' });
    await editor.focusDocument();
    await editor.press('Control+z');
    const afterOne = await editor.paragraphTexts();
    const commentsAfter = await editor.command('function () { return Api.GetDocument().GetAllComments().length; }', {}, { recalc: false });
    const undone = afterOne.some((t) => t.includes(' payable ')) && !afterOne.some((t) => t.includes('remitted')) && commentsAfter === 0;
    evidence.push(`single command + one undo: original text back ${undone}; comments left ${commentsAfter}`);
    await editor.close();

    const second = await open(context, secrets, 'i9d2');
    await second.editor.command(
      `function () { var d = Api.GetDocument(); var r = d.Search('payable', true)[0]; r.AddText(' promptly', 'after'); return 'ok'; }`,
    );
    await second.editor.command(`function () { var d = Api.GetDocument(); d.Search('promptly', true)[0].AddComment('two-step', 'Moli'); return 'ok'; }`);
    await second.editor.focusDocument();
    await second.editor.press('Control+z');
    const afterUndo1 = await second.editor.paragraphTexts();
    await second.editor.press('Control+z');
    const afterUndo2 = await second.editor.paragraphTexts();
    await second.editor.close();
    const needsTwo = afterUndo1.some((t) => t.includes('promptly')) && !afterUndo2.some((t) => t.includes('promptly'));
    evidence.push(`two commands: text still present after one undo and gone after two: ${needsTwo}`);
    return { result: undone && needsTwo ? 'pass' : 'fail', evidence };
  },
};

const item9e = {
  id: '9e',
  order: 94,
  title: 'The plugin calls our backend from our origin under ordinary CORS',
  parent: 'UDOC-1.1 / spike 9e',
  async run({ context, secrets }) {
    await resetStub();
    const { editor } = await open(context, secrets, 'i9e');
    const call = (p) =>
      editor.probe.evaluate(
        async (url) => {
          try {
            const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
            return { ok: r.ok, status: r.status };
          } catch (err) {
            return { ok: false, error: String(err) };
          }
        },
        `${STUB_C}${p}`,
      );
    const allowed = await call('/cors/yes');
    const blocked = await call('/cors/no');
    const pluginOrigin = await editor.probe.evaluate(() => location.origin);
    await editor.close();
    const seen = (await events()).filter((e) => e.kind === 'cors-call').map((e) => e.origin);
    const ok = allowed.ok && !blocked.ok && seen.every((o) => o === pluginOrigin);
    return {
      result: ok ? 'pass' : 'fail',
      evidence: [
        `plugin frame origin: ${pluginOrigin} (ours, not DocumentServer's)`,
        `POST with Access-Control-Allow-Origin: ${JSON.stringify(allowed)}; without: ${JSON.stringify(blocked)}`,
        `Origin header the backend saw: ${[...new Set(seen)].join(', ')}`,
      ],
    };
  },
};

export default [item9a, item9b, item9c, item9d, item9e];
export { paragraphs };
