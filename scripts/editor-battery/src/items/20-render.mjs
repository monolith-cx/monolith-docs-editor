// Spike items 4 (PDF through ConvertService) and 5 (`{token}` survives an OnlyOffice save)
// on the pinned release (EDIT-1.4).
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { controls, paragraphs, refill, replaceDocumentXml } from '../docx.mjs';
import { Editor, buildConfig } from '../editor.mjs';
import { VALUES } from '../fixtures.mjs';
import { addFixture, fontsEmbedded, forceSave, squash, toPdf, uniqueKey } from '../flow.mjs';
import { dsExec, resetStub } from '../stack.mjs';

async function editedCopy(context, secrets, fixture, prefix) {
  const key = uniqueKey(prefix);
  const editor = await Editor.open(context, secrets.jwtSecret, buildConfig({ fixture, key }));
  // Type, and confirm the text reached the document; one retry covers a click that missed focus.
  let typed = false;
  for (let attempt = 0; attempt < 2 && !typed; attempt += 1) {
    await editor.focusDocument();
    await editor.selectText('ENDMARKER');
    await editor.press('End');
    await editor.type(' 44444 rep text');
    typed = (await editor.paragraphTexts()).some((t) => t.includes('44444 rep text'));
  }
  const pageEvents = typed ? null : await editor.page.evaluate(() => window.__events).catch(() => null);
  const saved = await forceSave(secrets.jwtSecret, key);
  await editor.close();
  return { ...saved, typed, pageEvents, key };
}

function item4(variant) {
  const fixture = variant === 'sdt' ? 'contract-sdt.docx' : 'contract-cl.docx';
  return {
    id: variant === 'sdt' ? '4' : '4cl',
    order: variant === 'sdt' ? 40 : 41,
    title: `PDF through ConvertService: fields where the editor shows them, fonts embedded (${variant === 'sdt' ? 'sdtContentLocked' : 'contentLocked'})`,
    parent: 'UDOC-1.1 / spike 4',
    async run({ context, secrets, work, image }) {
      await resetStub();
      const saved = await editedCopy(context, secrets, fixture, `i4${variant}`);
      if (!saved.event) return { result: 'fail', evidence: [`force-save produced no file (text typed ${saved.typed}; command answer ${JSON.stringify(saved.answer)}; editor events ${JSON.stringify(saved.pageEvents)})`, `DocumentServer log for the key: ${squash(await dsExec(image, secrets, `grep -h '${saved.key}' /var/log/onlyoffice/documentserver/docservice/out.log 2>/dev/null | tail -5`).catch(() => ''))}`] };
      const refilled = refill(saved.documentXml, { 'field:r3': '$77,777.00' });
      const name = await addFixture(work, `pdf-4${variant}.docx`, await replaceDocumentXml(saved.zip, refilled.xml));
      const pdf = await toPdf(secrets.jwtSecret, work, name);
      if (!pdf.text) return { result: 'fail', evidence: [`conversion answer ${JSON.stringify(pdf.answer)}`] };
      const text = squash(pdf.text);
      const sentence = `This Agreement starts on ${VALUES.r1} between Monolith and ${VALUES.r2}. The total is $77,777.00 payable ${VALUES.r4}.`;
      const inOrder = text.includes(sentence);
      const table = ['Widget', 'Gadget', '$25.00'].every((t) => text.includes(t));
      const { fonts, allEmbedded } = fontsEmbedded(pdf.fonts);
      const styled = fonts.some((f) => /bold/i.test(f.name)) && fonts.some((f) => /italic/i.test(f.name));
      const ok = inOrder && table && allEmbedded && styled && text.includes('44444 rep text');
      return {
        result: ok ? 'pass' : 'fail',
        evidence: [
          `refilled value and fields in reading order: ${inOrder}; table cells: ${table}; rep text: ${text.includes('44444 rep text')}`,
          `fonts: ${fonts.map((f) => `${f.name}(emb ${f.emb})`).join(', ')}; all embedded ${allEmbedded}; bold and italic faces present ${styled}`,
          `conversion: ${JSON.stringify(pdf.answer)}`,
        ],
      };
    },
  };
}

const item5 = {
  id: '5',
  order: 50,
  title: '`{token}` text survives an OnlyOffice save and merges with CRM’s docxtemplater options',
  parent: 'UDOC-1.1 / spike 5',
  async run({ context, secrets }) {
    await resetStub();
    const saved = await editedCopy(context, secrets, 'contract-cl.docx', 'i5');
    if (!saved.event) return { result: 'fail', evidence: [`force-save produced no file (text typed ${saved.typed}; command answer ${JSON.stringify(saved.answer)})`] };
    const zip = new PizZip(saved.buf);
    // CRM's merge options (DG): paragraphLoop, linebreaks, nullGetter returning ''.
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
    let error = null;
    try {
      doc.render({ customer_name: 'Merged Customer', total_amount: '$9.99' });
    } catch (err) {
      error = String(err && err.message ? err.message : err);
    }
    if (error) return { result: 'fail', evidence: [`merge threw: ${error}`] };
    const out = doc.getZip().file('word/document.xml').asText();
    const merged = paragraphs(out).some((t) => t.includes('Token check: Merged Customer and $9.99.'));
    const leftover = out.includes('{customer_name}') || out.includes('{total_amount}');
    const fieldsKept = controls(out).filter((c) => c.tag && c.tag.startsWith('field:')).length;
    const ok = merged && !leftover && fieldsKept === 6;
    return {
      result: ok ? 'pass' : 'fail',
      evidence: [
        `tokens merged (including the bold-run token): ${merged}; unmerged tokens left: ${leftover}`,
        `field controls still present after the merge: ${fieldsKept} of 6`,
      ],
    };
  },
};

export default [item4('sdt'), item4('cl'), item5];
