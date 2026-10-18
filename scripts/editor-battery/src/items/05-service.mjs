// EDIT-1.3: the service itself (apps/api, built from this repo) opens, edits, and saves on the pinned release,
// using the legacy request shapes its two existing callers send (E1).
import { paragraphs } from '../docx.mjs';
import { Editor } from '../editor.mjs';
import { STUB_INTERNAL, resetStub, sleep, stub, waitForEvent } from '../stack.mjs';
import { openDocx } from '../docx.mjs';

const API = 'http://127.0.0.1:18204';

async function openViaApi(body) {
  const res = await fetch(`${API}/api/documents/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/** Opens an editor page the service rendered (not the stub's page) and waits for the document. */
async function openServicePage(context, editorUrl) {
  const page = await context.newPage();
  await page.goto(editorUrl, { waitUntil: 'domcontentloaded' });
  const frame = page.locator('iframe[name="frameEditor"]');
  await frame.waitFor({ timeout: 90_000 });
  await sleep(8000);
  return page;
}

const s1 = {
  id: 'S1',
  order: 5,
  title: 'The service on the pinned release: open, edit, save, and the consumer notification (legacy shape with a callback)',
  parent: 'EDIT-1.3',
  async run({ context }) {
    await resetStub();
    const opened = await openViaApi({
      fileUrl: `${STUB_INTERNAL}/fixtures/contract-cl.docx`,
      fileName: 'contract-cl.docx',
      callbackUrl: `${STUB_INTERNAL}/consumer-callback`,
      user: { id: 'u1', name: 'Rep One' },
    });
    if (opened.status !== 200) return { result: 'fail', evidence: [`open answered ${opened.status} ${JSON.stringify(opened.body)}`] };
    const page = await openServicePage(context, opened.body.editorUrl);
    const box = await page.locator('iframe[name="frameEditor"]').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' 10101 via service', { delay: 30 });
    await sleep(5000);
    const t = Date.now();
    await page.close();
    const consumer = await waitForEvent((e) => e.kind === 'consumer-callback' && e.t >= t, 90_000);
    let kept = false;
    if (consumer && consumer.saved && consumer.saved.file) {
      const { documentXml } = await openDocx(await stub(`/saved/${consumer.saved.file}`));
      kept = paragraphs(documentXml).some((p) => p.includes('10101 via service'));
    }
    const ok = Boolean(consumer) && consumer.status === 'saved' && kept;
    return {
      result: ok ? 'pass' : 'fail',
      evidence: [
        `open: ${opened.status}; editor URL served by the service`,
        `consumer notification: ${consumer ? `status ${consumer.status}, download URL ${consumer.hasDownloadUrl}, signature header ${consumer.signatureHeader} (unsigned today; EDIT-2 signs it)` : 'none'}`,
        `the saved file the consumer fetched holds the edit: ${kept}`,
      ],
    };
  },
};

const s2 = {
  id: 'S2',
  order: 6,
  title: 'The service on the pinned release: view-only legacy shape (fastmail-connect) and editable without a callback (Connect extension)',
  parent: 'EDIT-1.3 / E1',
  async run({ context, secrets }) {
    const { commandService } = await import('../editor.mjs');
    await resetStub();
    const evidence = [];
    let ok = true;
    for (const [label, body, editable] of [
      ['fastmail-connect (edit:false, download, print, no callback)', { fileUrl: `${STUB_INTERNAL}/fixtures/contract-cl.docx`, fileName: 'a.docx', user: { id: 'c1', name: 'Extension User' }, permissions: { edit: false, download: true, print: true } }, false],
      ['Connect extension (default permissions, no callback)', { fileUrl: `${STUB_INTERNAL}/fixtures/contract-cl.docx`, fileName: 'b.docx', user: { id: 'extension-user', name: 'Extension User' } }, true],
    ]) {
      const t = Date.now();
      const opened = await openViaApi(body);
      if (opened.status !== 200) {
        ok = false;
        evidence.push(`${label}: open answered ${opened.status}`);
        continue;
      }
      const page = await openServicePage(context, opened.body.editorUrl);
      // Loaded: DocumentServer fetched the file and drew the document canvas.
      const fetched = Boolean(await waitForEvent((e) => e.kind === 'fixture-fetch' && e.t >= t, 30_000));
      const canvas = await page.frames().find((f) => f.name() === 'frameEditor')?.evaluate(() => Boolean(document.querySelector('#editor_sdk canvas, #id_viewer canvas, canvas'))).catch(() => false);
      // Editable or not: type, give the editor time to send, then ask for a force-save.
      const box = await page.locator('iframe[name="frameEditor"]').boundingBox();
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.keyboard.type(' 30303', { delay: 30 });
      await sleep(5000);
      const fs = await commandService(secrets.jwtSecret, { c: 'forcesave', key: opened.body.key });
      await page.close();
      // error 0: changes reached the server (editable); error 4: no changes (view-only).
      const behaved = editable ? fs.error === 0 : fs.error === 4;
      if (!(fetched && canvas && behaved)) ok = false;
      evidence.push(`${label}: open 200; file fetched by DocumentServer ${fetched}; document canvas drawn ${Boolean(canvas)}; typed then force-save answered error ${fs.error} (${editable ? 'want 0: edits reached the server' : 'want 4: nothing changed, view-only held'})`);
    }
    return { result: ok ? 'pass' : 'fail', evidence };
  },
};

export default [s1, s2];
export { Editor };
