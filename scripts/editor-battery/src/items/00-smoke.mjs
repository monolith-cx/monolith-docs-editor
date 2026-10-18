// S0: the stack works end to end — open, read through the probe, force-save, fetch the saved file.
import { controls, openDocx, paragraphs } from '../docx.mjs';
import { Editor, buildConfig } from '../editor.mjs';
import { forceSave } from '../flow.mjs';
import { resetStub, stub } from '../stack.mjs';

export default {
  id: 'S0',
  order: 0,
  title: 'Stack smoke: open, probe plugin reads, force-save round trip',
  parent: 'EDIT-1.2',
  async run({ context, secrets }) {
    await resetStub();
    const key = `smoke-${Date.now()}`;
    const editor = await Editor.open(context, secrets.jwtSecret, buildConfig({ fixture: 'contract-sdt.docx', key }));
    const paras = await editor.paragraphTexts();
    const inEditor = await editor.controlsInEditor();
    await editor.focusDocument();
    await editor.selectText('ENDMARKER');
    await editor.press('End');
    await editor.type(' smoke edit');
    const fsResult = await forceSave(secrets.jwtSecret, key);
    const fs = fsResult.answer;
    const saved = fsResult.event;
    await editor.close();
    if (!saved) {
      return { result: 'fail', evidence: [`forcesave answer ${JSON.stringify(fs)}`, 'no status-6 callback with a saved file'] };
    }
    const { documentXml } = await openDocx(await stub(`/saved/${saved.saved.file}`));
    const ctl = controls(documentXml);
    return {
      result: paras.length > 3 && ctl.length >= 6 && paragraphs(documentXml).some((t) => t.toLowerCase().includes('smoke edit')) ? 'pass' : 'fail',
      evidence: [
        `paragraphs read via probe: ${paras.length}; controls in editor: ${inEditor.length}`,
        `forcesave answer: ${JSON.stringify(fs)}; callback token ${saved.tokenPlace}/${saved.payloadShape}; url origin ${saved.urlOrigin}`,
        `saved file controls: ${ctl.map((c) => `${c.tag}(${c.lock})`).join(', ')}`,
      ],
    };
  },
};
