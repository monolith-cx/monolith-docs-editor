// Reading saved DOCX files and refilling field controls (EDIT-1.4).
// Checks use a real XML parser; the refill splices the raw XML so that every
// byte outside the rewritten `sdtContent` stays as DocumentServer wrote it.
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export async function openDocx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const documentXml = await zip.file('word/document.xml').async('string');
  const parts = Object.keys(zip.files).sort();
  return { zip, documentXml, parts };
}

export function parse(xml) {
  return new DOMParser().parseFromString(xml, 'text/xml');
}

const wAttr = (el, name) => (el ? el.getAttributeNS(W_NS, name) || el.getAttribute(`w:${name}`) : null);
const kids = (el, local) => Array.from(el.childNodes).filter((n) => n.nodeType === 1 && n.localName === local);
const first = (el, local) => (el ? kids(el, local)[0] ?? null : null);

function textOf(el) {
  return Array.from(el.getElementsByTagNameNS(W_NS, 't')).map((t) => t.textContent).join('');
}

/** Run properties as a compact, order-independent signature, e.g. "b,color=1F4E79". */
export function rPrSignature(rPr) {
  if (!rPr) return '';
  return Array.from(rPr.childNodes)
    .filter((n) => n.nodeType === 1)
    .map((n) => (wAttr(n, 'val') ? `${n.localName}=${wAttr(n, 'val').toLowerCase()}` : n.localName))
    .filter((s) => !s.startsWith('rFonts') && !s.startsWith('lang'))
    .sort()
    .join(',');
}

/** Every content control in the main story: tag, lock, block or inline, text, first value run's formatting. */
export function controls(xml) {
  const doc = parse(xml);
  return Array.from(doc.getElementsByTagNameNS(W_NS, 'sdt')).map((sdt) => {
    const pr = first(sdt, 'sdtPr');
    const content = first(sdt, 'sdtContent');
    const runs = content ? Array.from(content.getElementsByTagNameNS(W_NS, 'r')) : [];
    const firstRun = runs[0] ?? null;
    const inline = Boolean(sdt.parentNode) && sdt.parentNode.localName === 'p';
    return {
      tag: wAttr(first(pr, 'tag'), 'val'),
      lock: wAttr(first(pr, 'lock'), 'val'),
      block: !inline,
      text: content ? textOf(content) : '',
      runCount: runs.length,
      rPr: rPrSignature(first(firstRun, 'rPr')),
    };
  });
}

/** Paragraph texts of the main story, in order (table cells included). */
export function paragraphs(xml) {
  const doc = parse(xml);
  return Array.from(doc.getElementsByTagNameNS(W_NS, 'p')).map(textOf);
}

export function count(xml, local) {
  return parse(xml).getElementsByTagNameNS(W_NS, local).length;
}

function findSdtRanges(xml) {
  const ranges = [];
  const stack = [];
  const re = /<w:sdt(?=[\s>])|<\/w:sdt>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[0] === '</w:sdt>') {
      const start = stack.pop();
      if (start !== undefined) ranges.push({ start, end: m.index + m[0].length, depth: stack.length });
    } else {
      stack.push(m.index);
    }
  }
  return ranges;
}

const escXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Rewrites the `sdtContent` of each top-level control whose tag is a key of `values`
 * (inline: one run carrying the first run's properties; block: the given raw XML).
 * Returns the new XML and whether everything outside the rewritten regions is byte-identical.
 */
export function refill(xml, values, blocks = {}) {
  const ranges = findSdtRanges(xml).sort((a, b) => a.start - b.start);
  const edits = [];
  for (const r of ranges) {
    const seg = xml.slice(r.start, r.end);
    const tag = /<w:tag w:val="([^"]+)"/.exec(seg)?.[1];
    if (!tag || (!(tag in values) && !(tag in blocks))) continue;
    if (edits.some((e) => r.start < e.end && r.end > e.start)) continue;
    const open = seg.indexOf('<w:sdtContent>');
    const close = seg.lastIndexOf('</w:sdtContent>');
    if (open === -1 || close === -1) continue;
    const inner = seg.slice(open + '<w:sdtContent>'.length, close);
    let replacement;
    if (tag in blocks) {
      replacement = blocks[tag];
    } else {
      const rPr = /<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/.exec(inner)?.[1] ?? '';
      replacement = `<w:r>${rPr}<w:t xml:space="preserve">${escXml(values[tag])}</w:t></w:r>`;
    }
    edits.push({ start: r.start + open + '<w:sdtContent>'.length, end: r.start + close, replacement });
  }
  edits.sort((a, b) => b.start - a.start);
  let out = xml;
  for (const e of edits) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  const skeleton = (s, es) => {
    let k = s;
    for (const e of es) k = k.slice(0, e.start) + '\u0000' + k.slice(e.end);
    return k;
  };
  const newEdits = [];
  let shift = 0;
  for (const e of [...edits].sort((a, b) => a.start - b.start)) {
    newEdits.push({ start: e.start + shift, end: e.start + shift + e.replacement.length });
    shift += e.replacement.length - (e.end - e.start);
  }
  const outsideIdentical =
    skeleton(xml, [...edits].sort((a, b) => b.start - a.start)) === skeleton(out, newEdits.sort((a, b) => b.start - a.start));
  return { xml: out, edited: edits.length, outsideIdentical };
}

export async function replaceDocumentXml(zip, xml) {
  zip.file('word/document.xml', xml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export function serialize(node) {
  return new XMLSerializer().serializeToString(node);
}
