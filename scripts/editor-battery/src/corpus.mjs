// The EDIT-5.5 corpus: DOCX files that put fields, blocks, and template tokens where they are most
// likely to break, saved under scripts/editor-battery/corpus/ (committed). Battery item E5f opens each
// through the service, edits it, and checks the final save keeps every control and token.
//   node src/corpus.mjs     regenerates the files (synthetic text only)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { block, buildDocx, field, para, run, table } from './fixtures.mjs';

const tc = (inner) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${para(inner)}</w:tc>`;
const tbl = (rows) => {
  const border = '<w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders>';
  return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/>${border}</w:tblPr><w:tblGrid>${rows[0].map(() => '<w:gridCol w:w="3000"/>').join('')}</w:tblGrid>${rows.map((r) => `<w:tr>${r.map(tc).join('')}</w:tr>`).join('')}</w:tbl>`;
};
const end = para(run('ENDMARKER of document.'));

export const CORPUS = [
  { name: 'field-in-table-cell.docx', body: [tbl([[run('Party'), run('Signs on')], [field('c1', 'Acme Cell LLC'), field('c2', '2026-12-01')]]), end] },
  {
    name: 'field-in-header-and-footer.docx',
    body: [para(run('Body text with no fields.')), end],
    opts: { header: para(run('Prepared for ') + field('h1', 'HEADERVALUE')), footer: para(run('Reference ') + field('f1', 'FOOTERVALUE')) },
  },
  { name: 'field-next-to-token.docx', body: [para(run('Dear {customer.name},') + field('t1', 'FIELDBESIDETOKEN') + run('{total_amount} is due.')), end] },
  {
    name: 'field-at-line-wrap.docx',
    body: [para(run('This sentence is padded with enough ordinary words to reach the right margin so that the next field ') + field('w1', 'WRAPFIELDVALUE') + run(' starts or splits at a line wrap.')), end],
  },
  { name: 'token-split-across-runs.docx', body: [para(run('Hello {cust') + run('omer.na', '<w:b/>') + run('me}, welcome.')), end] },
  { name: 'block-around-multirow-table.docx', body: [block('b1', table([['Item', 'Qty'], ['Widget', '2'], ['Gadget', '1'], ['Gizmo', '5']])), end] },
  // Track changes switched on in settings (w:trackRevisions); the body holds no revisions yet. Edits
  // next to existing tracked changes are E5b's second suggestion, applied after its first.
  { name: 'tracked-changes-on.docx', body: [para(run('Tracked document starts ') + field('k1', 'TRACKEDVALUE') + run(' here.')), end], opts: { trackRevisions: true } },
  { name: 'loop-spanning-table-rows.docx', body: [tbl([[run('Name'), run('Qty')], [run('{#items}{name}'), run('{qty}')], [run('{price}'), run('{/items}')]]), end] },
  { name: 'copied-field.docx', body: [para(run('First copy ') + field('d1', 'COPIEDVALUE')), para(run('Second copy ') + field('d1', 'COPIEDVALUE')), end] },
];

export const CORPUS_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'corpus');

if (process.argv[1] && new URL(import.meta.url).pathname === path.resolve(process.argv[1])) {
  await mkdir(CORPUS_DIR, { recursive: true });
  for (const c of CORPUS) await writeFile(path.join(CORPUS_DIR, c.name), await buildDocx(c.body.join(''), c.opts ?? {}));
  process.stdout.write(`wrote ${CORPUS.length} files to ${CORPUS_DIR}\n`);
}
