// Spike items 3, 7, 8 on the pinned release, with `sdtContentLocked` (the spike's
// variant) and `contentLocked` (D11's ruling), plus delete-with-sentence,
// copy-paste duplication, and cut-and-paste of a field (EDIT-1.4).
import { controls, paragraphs, refill, replaceDocumentXml } from '../docx.mjs';
import { Editor, buildConfig } from '../editor.mjs';
import { VALUES, table } from '../fixtures.mjs';
import { addFixture, closeAndAwait, forceSave, uniqueKey } from '../flow.mjs';
import { resetStub } from '../stack.mjs';

const VARIANTS = {
  sdt: { fixture: 'contract-sdt.docx', lock: 'sdtContentLocked', label: 'sdtContentLocked' },
  cl: { fixture: 'contract-cl.docx', lock: 'contentLocked', label: 'contentLocked' },
};

/** The fixture's controls in document order, with the formatting each value run carries. */
const EXPECTED = [
  { tag: 'field:r2', value: VALUES.r2, rPr: 'b,color=1f4e79' },
  { tag: 'field:r1', value: VALUES.r1, rPr: 'b' },
  { tag: 'field:r2', value: VALUES.r2, rPr: 'i' },
  { tag: 'field:r3', value: VALUES.r3, rPr: 'b,color=1f4e79' },
  { tag: 'field:r4', value: VALUES.r4, rPr: '' },
  { tag: 'field:r5', value: VALUES.r5, rPr: '' },
  { tag: 'block:r6', value: null, rPr: null },
];

function checkControls(xml, lock, expected = EXPECTED) {
  const got = controls(xml);
  const problems = [];
  if (got.length !== expected.length) problems.push(`expected ${expected.length} controls, found ${got.length}`);
  expected.forEach((exp, i) => {
    const c = got[i];
    if (!c) return;
    const wantLock = exp.tag.startsWith('block:') ? 'sdtContentLocked' : lock;
    if (c.tag !== exp.tag) problems.push(`#${i} tag ${c.tag} ≠ ${exp.tag}`);
    if (c.lock !== wantLock) problems.push(`${exp.tag} lock ${c.lock} ≠ ${wantLock}`);
    if (exp.value !== null && c.text !== exp.value) problems.push(`${exp.tag} text "${c.text}" ≠ "${exp.value}"`);
    if (exp.rPr !== null && c.rPr !== exp.rPr) problems.push(`${exp.tag} rPr "${c.rPr}" ≠ "${exp.rPr}"`);
  });
  return problems;
}

async function openFresh(context, secrets, fixture, prefix, extra = {}) {
  const key = uniqueKey(prefix);
  const editor = await Editor.open(context, secrets.jwtSecret, buildConfig({ fixture, key, ...extra }));
  return { editor, key };
}

/** Types at the end of the last paragraph; digits first so autocorrect leaves the text alone. */
async function typeAtEnd(editor, text) {
  await editor.focusDocument();
  await editor.selectText('ENDMARKER');
  await editor.press('End');
  await editor.type(text);
}

function item3(variant) {
  const v = VARIANTS[variant];
  return {
    id: variant === 'sdt' ? '3' : '3cl',
    order: variant === 'sdt' ? 30 : 31,
    title: `Field and block controls survive force-save and close-save (${v.label})`,
    parent: 'UDOC-1.1 / spike 3',
    async run({ context, secrets }) {
      await resetStub();
      const { editor, key } = await openFresh(context, secrets, v.fixture, `i3${variant}`);
      await typeAtEnd(editor, ' 12345 first edit');
      const forced = await forceSave(secrets.jwtSecret, key);
      if (!forced.event) return { result: 'fail', evidence: [`force-save answer ${JSON.stringify(forced.answer)}; no status 6`] };
      const p1 = checkControls(forced.documentXml, v.lock);
      await typeAtEnd(editor, ' 67890 second edit');
      const closed = await closeAndAwait(editor, key);
      if (!closed.buf) return { result: 'fail', evidence: [`close gave ${JSON.stringify(closed.event && closed.event.status)}, no status-2 file`] };
      const p2 = checkControls(closed.documentXml, v.lock);
      const edits = paragraphs(closed.documentXml).some((t) => t.includes('12345 first edit') && t.includes('67890 second edit'));
      const ok = p1.length === 0 && p2.length === 0 && edits;
      return {
        result: ok ? 'pass' : 'fail',
        evidence: [
          `force-save (status 6): ${p1.length ? p1.join('; ') : 'all 7 controls keep tag, lock, value, and run formatting'}`,
          `close-save (status 2): ${p2.length ? p2.join('; ') : 'same'}`,
          `rep edits present in the final file: ${edits}`,
        ],
      };
    },
  };
}

// Each attack returns whether its selection was made; a failed selection fails the item
// (a no-op must never pass as "refused").
const ATTACKS = [
  { id: 'type-over', run: async (e) => { const ok = await e.selectControl('field:r3', 'all'); await e.type('9'); return ok; } },
  { id: 'backspace-inside-end', run: async (e) => { const ok = await e.selectControl('field:r3', 'end'); await e.press('Backspace', 2); return ok; } },
  { id: 'delete-inside-start', run: async (e) => { const ok = await e.selectControl('field:r3', 'start'); await e.press('Delete', 2); return ok; } },
  { id: 'backspace-after-field', run: async (e) => { const ok = await e.selectText(' payable '); await e.press('ArrowLeft'); await e.press('Backspace', 2); return ok; } },
  { id: 'delete-before-field', run: async (e) => { const ok = await e.selectText('The total is '); await e.press('ArrowRight'); await e.press('Delete', 2); return ok; } },
  {
    id: 'select-across-type',
    run: async (e) => {
      const sel = await e.selectFromTo('total is', ' payable');
      await e.type('Z');
      return typeof sel === 'string' && sel.includes(VALUES.r3);
    },
  },
];

/** Proves keystrokes still reach the document after an attack: a marker typed at the end must land. */
async function keystrokesLand(editor, marker) {
  await editor.selectText('ENDMARKER');
  await editor.press('End');
  await editor.type(marker);
  return (await editor.paragraphTexts()).some((t) => t.includes(marker.trim()));
}

function item7(variant) {
  const v = VARIANTS[variant];
  return {
    id: variant === 'sdt' ? '7' : '7cl',
    order: variant === 'sdt' ? 70 : 71,
    title: `Inline locked fields refuse edits, survive save, refill in place, reopen (${v.label})`,
    parent: 'UDOC-1.1 / spike 7',
    timeoutMs: 900_000,
    async run({ context, secrets, work }) {
      await resetStub();
      const evidence = [];
      const removals = [];
      let attackFail = false;
      for (const attack of ATTACKS) {
        const { editor } = await openFresh(context, secrets, v.fixture, `i7${variant}${attack.id.slice(0, 6)}`);
        await editor.focusDocument();
        const selected = await attack.run(editor);
        const r3 = (await editor.controlsInEditor()).filter((c) => c.tag === 'field:r3');
        const para = (await editor.paragraphTexts())[1] ?? '';
        const live = await keystrokesLand(editor, ' 4242 live');
        await editor.close();
        if (!selected || !live) attackFail = true;
        const intact = r3.length === 1 && r3[0].text === VALUES.r3;
        const removedWhole = r3.length === 0;
        // A loose lock may lose the whole field with its sentence (D11); it must never be partly changed.
        // Strict lock: every attack refused. Loose lock (D11): the value is never changed in part;
        // whether the field may disappear as a unit is reported, not assumed (see the item's findings).
        const acceptable = v.lock === 'contentLocked' ? intact || removedWhole : intact;
        if (!acceptable) attackFail = true;
        if (removedWhole) removals.push(attack.id);
        const around = para.slice(Math.max(0, para.indexOf('total') - 4), para.indexOf('total') + 40);
        evidence.push(`${attack.id}: selection made ${Boolean(selected)}; ${intact ? 'value intact' : removedWhole ? `field removed whole; sentence now "${around.replace(/\s+/g, ' ').trim()}"` : `CHANGED to ${JSON.stringify(r3.map((c) => c.text))}`}; keystrokes still land ${live}`);
      }
      // Save, refill outside the editor, reopen.
      const { editor, key } = await openFresh(context, secrets, v.fixture, `i7${variant}refill`);
      await typeAtEnd(editor, ' 24680 rep text');
      const saved = await forceSave(secrets.jwtSecret, key);
      await editor.close();
      if (!saved.event) return { result: 'fail', evidence: [...evidence, 'force-save produced no file'] };
      const saveProblems = checkControls(saved.documentXml, v.lock);
      const NEW = { 'field:r1': '2027-01-15', 'field:r2': 'Renamed Customer LLC', 'field:r3': '$99,999.00', 'field:r4': 'Net 45', 'field:r5': 'NEWFIVE' };
      const refilled = refill(saved.documentXml, NEW);
      const name = await addFixture(work, `refilled-7${variant}.docx`, await replaceDocumentXml(saved.zip, refilled.xml));
      const second = await openFresh(context, secrets, name, `i7${variant}reopen`);
      const reopened = await second.editor.controlsInEditor();
      const paras = await second.editor.paragraphTexts();
      await typeAtEnd(second.editor, ' 13579 after refill');
      const resaved = await forceSave(secrets.jwtSecret, second.key);
      await second.editor.close();
      const expectedAfter = EXPECTED.map((e) => (e.value === null ? e : { ...e, value: NEW[e.tag] }));
      const resaveProblems = resaved.event ? checkControls(resaved.documentXml, v.lock, expectedAfter) : ['re-save produced no file'];
      const reopenOk =
        reopened.filter((c) => c.tag.startsWith('field:')).every((c) => c.text === NEW[c.tag]) &&
        paras.some((t) => t.includes('24680 rep text'));
      evidence.push(
        `save: ${saveProblems.length ? saveProblems.join('; ') : 'tags, locks, values, formatting kept'}`,
        `refill: ${refilled.edited} controls rewritten; everything outside them byte-identical: ${refilled.outsideIdentical}`,
        `reopen: new values shown ${reopenOk}; locks in editor ${[...new Set(reopened.map((c) => String(c.lock)))].join('/')}; rep text kept`,
        `re-save after refill: ${resaveProblems.length ? resaveProblems.join('; ') : 'formatting and locks kept'}`,
      );
      if (removals.length) {
        evidence.push(`FINDING: with ${v.label} a rep removes the whole field with ordinary keystrokes (${removals.join(', ')}); the server sees a missing field row (D16)`);
      }
      const ok = !attackFail && saveProblems.length === 0 && refilled.outsideIdentical && reopenOk && resaveProblems.length === 0;
      return { result: !ok ? 'fail' : removals.length ? 'finding' : 'pass', evidence, findings: removals };
    },
  };
}

function item7d(variant) {
  const v = VARIANTS[variant];
  return {
    id: variant === 'sdt' ? '7d' : '7dcl',
    order: variant === 'sdt' ? 72 : 73,
    title: `Deleting a sentence that holds a field (${v.label})`,
    parent: 'UDOC-1.1 / D11 loose lock',
    async run({ context, secrets }) {
      await resetStub();
      const { editor, key } = await openFresh(context, secrets, v.fixture, `i7d${variant}`);
      await editor.focusDocument();
      const selectedText = await editor.command(
        `function () {
          var p = Api.GetDocument().GetAllParagraphs()[2];
          p.GetRange().Select();
          return p.GetText();
        }`,
      );
      await editor.press('Delete');
      await editor.press('Delete');
      const live = await keystrokesLand(editor, ' 5353 live');
      const after = await editor.controlsInEditor();
      const paras = await editor.paragraphTexts();
      await typeAtEnd(editor, ' 11111 mark');
      const saved = await forceSave(secrets.jwtSecret, key);
      await editor.close();
      const inEditorR5 = after.filter((c) => c.tag === 'field:r5').length;
      const sentence = paras.some((t) => t.includes('SENTENCEHOLDER'));
      const inFile = saved.event ? controls(saved.documentXml).filter((c) => c.tag === 'field:r5').length : -1;
      // D11: with contentLocked the field goes with its sentence; sdtContentLocked refuses (spike 7').
      const expectRemoved = v.lock === 'contentLocked';
      const selectedRight = typeof selectedText === 'string' && selectedText.includes('SENTENCEHOLDER');
      const ok = selectedRight && live && (expectRemoved ? inEditorR5 === 0 && !sentence && inFile === 0 : inEditorR5 === 1 && inFile === 1);
      return {
        result: ok ? 'pass' : 'fail',
        evidence: [
          `paragraph selected ${selectedRight}; after Delete: field r5 controls in editor ${inEditorR5}; sentence text present ${sentence}; keystrokes still land ${live}`,
          `saved file field r5 controls: ${inFile}`,
          `expected: ${expectRemoved ? 'field removed with its sentence (loose lock, D11)' : 'deletion refused (strict lock, spike 7′)'}`,
        ],
      };
    },
  };
}

async function selectSpan(editor, from, toTag) {
  return editor.selectFromTo(from, toTag);
}

function clipboardItem(variant, mode) {
  const v = VARIANTS[variant];
  const copy = mode === 'copy';
  return {
    id: `${copy ? '7p' : '7x'}${variant === 'sdt' ? '' : 'cl'}`,
    order: (copy ? 74 : 76) + (variant === 'sdt' ? 0 : 1),
    title: `${copy ? 'Copy-paste duplicates' : 'Cut-and-paste moves'} a field (${v.label})`,
    parent: 'UDOC-1.1 / D11, D16',
    async run({ context, secrets }) {
      await resetStub();
      const { editor, key } = await openFresh(context, secrets, v.fixture, `i7${mode}${variant}`);
      await editor.focusDocument();
      const tag = copy ? 'field:r4' : 'field:r1';
      const selected = copy ? await selectSpan(editor, ' payable ', tag) : await selectSpan(editor, 'starts on ', tag);
      await editor.focusDocument();
      const reselected = copy ? await selectSpan(editor, ' payable ', tag) : await selectSpan(editor, 'starts on ', tag);
      // A real Ctrl+X is the editor's copy plus deleting the selection; headless Chrome runs neither shortcut.
      const types = await editor.clipboard('copy');
      if (!copy) {
        // The editor's copy leaves focus in its paste bin: put focus and the selection back first.
        await editor.focusDocument();
        await selectSpan(editor, 'starts on ', tag);
        await editor.press('Delete');
      }
      await editor.selectText('ENDMARKER');
      await editor.press('End');
      const pasted = await editor.pasteCaptured();
      const after = await editor.controlsInEditor();
      const paras = await editor.paragraphTexts();
      await typeAtEnd(editor, ' 22222 mark');
      const saved = await forceSave(secrets.jwtSecret, key);
      await editor.close();
      const inEditor = after.filter((c) => c.tag === tag);
      const inFile = saved.event ? controls(saved.documentXml).filter((c) => c.tag === tag) : [];
      const lastPara = paras.find((t) => t.includes('ENDMARKER')) ?? '';
      const pastedAtEnd = lastPara.includes(copy ? VALUES.r4 : VALUES.r1);
      const originalGone = copy ? true : !(paras[1] ?? '').includes(VALUES.r1);
      // A strict field refuses deletion, so a cut can only copy it; a loose field moves.
      const strict = v.lock === 'sdtContentLocked';
      const wantCount = copy || strict ? 2 : 1;
      const locksKept = inFile.every((c) => c.lock === v.lock);
      const originOk = copy || strict ? true : originalGone;
      const ok = selected && reselected && inEditor.length === wantCount && inFile.length === wantCount && pastedAtEnd && originOk && locksKept;
      return {
        result: ok ? 'pass' : 'fail',
        evidence: [
          `selected "${selected}"; clipboard formats the editor wrote: ${types.types.join(', ') || 'none'}; pasted through PasteHtml ${pasted}${copy ? '' : '; cut simulated as copy + Delete'}`,
          `${tag} controls in editor after paste ${inEditor.length} (want ${wantCount}); pasted at end ${pastedAtEnd}; original location ${copy ? 'kept' : `emptied ${originalGone}${strict ? ' (strict lock: deletion refused, so the cut copies)' : ''}`}`,
          `saved file ${tag}: ${inFile.map((c) => `${c.lock}/"${c.text}"`).join(', ') || 'none'}`,
        ],
      };
    },
  };
}

function item8() {
  return {
    id: '8',
    order: 80,
    title: 'Block control around a table refills in place and refuses typing',
    parent: 'UDOC-1.1 / spike 8',
    async run({ context, secrets, work }) {
      await resetStub();
      const { editor, key } = await openFresh(context, secrets, VARIANTS.cl.fixture, 'i8');
      await typeAtEnd(editor, ' 33333 rep text');
      const saved = await forceSave(secrets.jwtSecret, key);
      await editor.close();
      if (!saved.event) return { result: 'fail', evidence: ['force-save produced no file'] };
      const rows = [['Item', 'Qty', 'Price'], ['Widget', '2', '$10.00'], ['Gadget', '1', '$25.00'], ['Thingamajig', '4', '$7.50']];
      const refilled = refill(saved.documentXml, {}, { 'block:r6': table(rows) });
      const name = await addFixture(work, 'refilled-8.docx', await replaceDocumentXml(saved.zip, refilled.xml));
      const second = await Editor.open(context, secrets.jwtSecret, buildConfig({ fixture: name, key: uniqueKey('i8re') }));
      const before = (await second.controlsInEditor()).find((c) => c.tag === 'block:r6');
      await second.focusDocument();
      const selectedCell = await second.selectText('Thingamajig');
      await second.type('X');
      const after = (await second.controlsInEditor()).find((c) => c.tag === 'block:r6');
      const live = await keystrokesLand(second, ' 6464 live');
      await second.close();
      const ok = selectedCell && live && refilled.outsideIdentical && before && before.text.includes('Thingamajig') && after && after.text === before.text;
      return {
        result: ok ? 'pass' : 'fail',
        evidence: [
          `refill: block rewritten with a 4-row table; outside byte-identical ${refilled.outsideIdentical}`,
          `reopen: block shows the new row ${Boolean(before && before.text.includes('Thingamajig'))}; lock ${before && before.lock}`,
          `cell text selected ${Boolean(selectedCell)}; typing inside the block refused: ${Boolean(after && before && after.text === before.text)}; keystrokes still land outside it ${live}`,
        ],
      };
    },
  };
}

export default [
  item3('sdt'),
  item3('cl'),
  item7('sdt'),
  item7('cl'),
  item7d('sdt'),
  item7d('cl'),
  clipboardItem('sdt', 'copy'),
  clipboardItem('cl', 'copy'),
  clipboardItem('sdt', 'cut'),
  clipboardItem('cl', 'cut'),
  item8(),
];
