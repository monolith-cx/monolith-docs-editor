// Synthetic DOCX fixtures (EDIT-1.2). No customer data: every value is made up.
import JSZip from 'jszip';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const run = (text, rPr = '') =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

let nextId = 1000;

/** An inline field control (D11): tag `field:<rowId>`, a lock, one value run. */
export function field(rowId, value, { lock = 'contentLocked', rPr = '', alias } = {}) {
  nextId += 1;
  return `<w:sdt><w:sdtPr>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:alias w:val="${esc(alias ?? rowId)}"/><w:tag w:val="field:${rowId}"/><w:id w:val="${nextId}"/><w:lock w:val="${lock}"/></w:sdtPr><w:sdtContent>${run(value, rPr)}</w:sdtContent></w:sdt>`;
}

export const para = (inner, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`;

function cell(text, bold = false) {
  return `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${para(run(text, bold ? '<w:b/>' : ''))}</w:tc>`;
}

export function table(rows) {
  const border = '<w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders>';
  const grid = `<w:tblGrid>${rows[0].map(() => '<w:gridCol w:w="3000"/>').join('')}</w:tblGrid>`;
  const trs = rows.map((r, i) => `<w:tr>${r.map((c) => cell(c, i === 0)).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/>${border}</w:tblPr>${grid}${trs}</w:tbl>`;
}

/** A block control (D11): tag `block:<rowId>`, locked `sdtContentLocked`, around block content. */
export function block(rowId, inner) {
  nextId += 1;
  return `<w:sdt><w:sdtPr><w:alias w:val="${esc(rowId)}"/><w:tag w:val="block:${rowId}"/><w:id w:val="${nextId}"/><w:lock w:val="sdtContentLocked"/></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Liberation Serif" w:hAnsi="Liberation Serif"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`;

/**
 * A DOCX from body XML. Options (EDIT-5 corpus): `header` and `footer` paragraph XML for a default
 * header and footer, and `trackRevisions` to turn track changes on in settings.xml.
 */
export async function buildDocx(bodyXml, { header, footer, trackRevisions = false } = {}) {
  const zip = new JSZip();
  const overrides = [];
  const rels = ['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'];
  let sectRefs = '';
  if (header) {
    zip.file('word/header1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr xmlns:w="${W_NS}" xmlns:r="${R_NS}">${header}</w:hdr>`);
    overrides.push('<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>');
    rels.push('<Relationship Id="rIdH1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>');
    sectRefs += '<w:headerReference w:type="default" r:id="rIdH1"/>';
  }
  if (footer) {
    zip.file('word/footer1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="${W_NS}" xmlns:r="${R_NS}">${footer}</w:ftr>`);
    overrides.push('<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>');
    rels.push('<Relationship Id="rIdF1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>');
    sectRefs += '<w:footerReference w:type="default" r:id="rIdF1"/>';
  }
  if (trackRevisions) {
    zip.file('word/settings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="${W_NS}"><w:trackRevisions/></w:settings>`);
    overrides.push('<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>');
    rels.push('<Relationship Id="rIdS1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>');
  }
  zip.file('[Content_Types].xml', CONTENT_TYPES.replace('</Types>', `${overrides.join('')}</Types>`));
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
  zip.file('word/styles.xml', STYLES);
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${bodyXml}<w:sectPr>${sectRefs}<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Known field values, so checks can find them in the editor and the saved file. */
export const VALUES = {
  r1: '2026-11-01',
  r2: 'Acme Testing LLC',
  r3: '$12,345.00',
  r4: 'Net 30',
  r5: 'FIELDFIVEVALUE',
};

/**
 * The spike's field-and-block fixture: inline fields with bold, italic and coloured runs
 * (one of them copied), a sentence that holds a field, `{token}` text for spike item 5,
 * and a locked block around a 3×3 table.
 */
export function contractBody(lock) {
  return [
    para(run('Services Agreement for ') + field('r2', VALUES.r2, { lock, rPr: '<w:b/><w:color w:val="1F4E79"/>' }), '<w:pStyle w:val="Heading1"/>'),
    para(
      run('This Agreement starts on ') +
        field('r1', VALUES.r1, { lock, rPr: '<w:b/>' }) +
        run(' between Monolith and ') +
        field('r2', VALUES.r2, { lock, rPr: '<w:i/>' }) +
        run('. The total is ') +
        field('r3', VALUES.r3, { lock, rPr: '<w:b/><w:color w:val="1F4E79"/>' }) +
        run(' payable ') +
        field('r4', VALUES.r4, { lock }) +
        run('.'),
    ),
    para(run('SENTENCEHOLDER keeps ') + field('r5', VALUES.r5, { lock }) + run(' inside it.')),
    para(run('Token check: {customer_name} and ') + run('{total_amount}', '<w:b/>') + run('.')),
    block('r6', table([['Item', 'Qty', 'Price'], ['Widget', '2', '$10.00'], ['Gadget', '1', '$25.00']])),
    para(run('ENDMARKER of document.')),
  ].join('');
}

export async function writeFixture(workDir, name, bodyXml) {
  const buf = await buildDocx(bodyXml);
  await writeFile(path.join(workDir, 'fixtures', name), buf);
  return buf;
}
