// The service itself (apps/api, built from this repo, EDITOR_ENV=local) on the pinned release:
// EDIT-1.3's round trip, and EDIT-2.8's real-editor acceptance (profiles, stateless sessions,
// signed notifications that survive a restart and a consumer outage, drop, the expired page).
import { controls, openDocx, paragraphs } from '../docx.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { STUB_INTERNAL, WORK_DIR, events, resetStub, restartApi, setConsumerMode, sleep, stub, waitForEvent } from '../stack.mjs';

const API = 'http://127.0.0.1:18204';

async function openViaApi(secrets, body, legacy = false) {
  const res = await fetch(`${API}/api/documents/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${legacy ? secrets.legacyKey : secrets.apiKey}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

let docCounter = 0;
function documentBody(over = {}) {
  docCounter += 1;
  return {
    profile: 'document',
    documentRef: `bat_${Date.now().toString(36)}_${docCounter}`,
    revision: '1',
    mode: 'e',
    fileUrl: `${STUB_INTERNAL}/fixtures/contract-cl.docx`,
    fileName: 'contract-cl.docx',
    user: { id: 'u1', name: 'Rep One' },
    panelUrl: 'http://127.0.0.1:18202/panel/index.html#pluginOrigin=http://127.0.0.1:18204',
    ...over,
  };
}

/** Opens a page the service rendered and waits until DocumentServer drew the document. */
async function openServicePage(context, editorUrl) {
  const page = await context.newPage();
  const cspViolations = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) cspViolations.push(msg.text().slice(0, 160));
  });
  await page.goto(editorUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('iframe[name="frameEditor"]').waitFor({ timeout: 90_000 });
  const deadline = Date.now() + 90_000;
  for (;;) {
    const frame = page.frames().find((f) => f.name() === 'frameEditor');
    const drawn = frame ? await frame.evaluate(() => Boolean(document.querySelector('#editor_sdk canvas'))).catch(() => false) : false;
    if (drawn) break;
    if (Date.now() > deadline) throw new Error('editor never drew the document');
    await sleep(500);
  }
  await sleep(3000);
  return { page, cspViolations };
}

async function typeAtDocumentEnd(page, text) {
  const box = await page.locator('iframe[name="frameEditor"]').boundingBox();
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text, { delay: 30 });
  await sleep(4000);
}

async function savedText(event) {
  if (!event?.saved?.file) return [];
  const { documentXml } = await openDocx(await stub(`/saved/${event.saved.file}`));
  return paragraphs(documentXml);
}

const s1 = {
  id: 'S1',
  order: 5,
  title: 'The service: a document session opens under its CSP, edits, and the consumer receives signed notifications',
  parent: 'EDIT-1.3 / EDIT-2.8',
  async run({ context, secrets }) {
    await resetStub();
    const opened = await openViaApi(secrets, documentBody());
    if (opened.status !== 200) return { result: 'fail', evidence: [`open answered ${opened.status} ${JSON.stringify(opened.body)}`] };
    const key = opened.body.key;
    const { page, cspViolations } = await openServicePage(context, opened.body.editorUrl);
    await typeAtDocumentEnd(page, ' 10101 via service');
    const t = Date.now();
    await page.close();
    const saved = await waitForEvent((e) => e.kind === 'consumer-callback' && e.key === key && e.status === 2 && e.t >= t, 90_000);
    const all = (await events()).filter((e) => e.kind === 'consumer-callback' && e.key === key);
    const kept = (await savedText(saved)).some((p) => p.includes('10101 via service'));
    // EDIT-2.2: DocumentServer fetches the service's source route; the service fetched the stub.
    const fetches = (await events()).filter((e) => e.kind === 'fixture-fetch');
    const viaService = fetches.length > 0 && fetches.every((e) => e.from === 'api');
    const allSigned = all.length > 0 && all.every((e) => e.signatureValid);
    const ok = Boolean(saved) && kept && allSigned && saved.deliveryId && saved.deliveryHeader === saved.deliveryId && cspViolations.length === 0 && viaService;
    return {
      result: ok ? 'pass' : 'fail',
      evidence: [
        `open ${opened.status}, key ${key}; editor drew the document under the page's CSP (violations: ${cspViolations.length ? cspViolations.join(' | ') : 'none'})`,
        `the consumer's file was fetched ${fetches.length} time(s), every time by the service (source route, pinned), never by DocumentServer: ${viaService} (fetchers: ${[...new Set(fetches.map((e) => e.from))].join(', ') || 'none'})`,
        `consumer notifications: ${all.map((e) => `${e.event}${e.actions ? JSON.stringify(e.actions.map((a) => a.type)) : ''}`).join(', ')}; every signature valid ${allSigned}`,
        `final save: deliveryId present and equal to its header ${Boolean(saved?.deliveryId && saved.deliveryHeader === saved.deliveryId)}; download URL origin ${saved?.downloadOrigin}; the saved file holds the edit ${kept}`,
      ],
    };
  },
};

/** Uploads a fixture through the service's legacy upload route, as fastmail-connect's proxy does; returns its internal fileUrl. */
async function uploadViaApi(secrets, name) {
  const form = new FormData();
  form.append('file', new Blob([await readFile(path.join(WORK_DIR, 'fixtures', name))]), name);
  const res = await fetch(`${API}/api/files/upload`, { method: 'POST', headers: { authorization: `Bearer ${secrets.legacyKey}` }, body: form });
  const body = await res.json();
  if (!res.ok) throw new Error(`upload answered ${res.status} ${JSON.stringify(body)}`);
  return body.fileUrl;
}

const s2 = {
  id: 'S2',
  order: 6,
  title: 'The service: the legacy flows of fastmail-connect (upload, then view-only) and the Connect extension (upload, then editable, no callback)',
  parent: 'EDIT-1.3 / E1',
  async run({ context, secrets }) {
    const { commandService } = await import('../editor.mjs');
    await resetStub();
    const evidence = [];
    let ok = true;
    for (const [label, bodyFor, editable] of [
      // fastmail-connect billing/packages/api/src/routes/docs-proxy.ts:197-233 (upload, then open)
      ['fastmail-connect (edit:false, download, print, no callback)', (fileUrl) => ({ fileUrl, fileName: 'a.docx', user: { id: 'c1', name: 'Extension User' }, permissions: { edit: false, download: true, print: true } }), false],
      // monolith-connect apps/extension/src/lib/docs-api.ts:43-77 (upload, then open)
      ['Connect extension (default permissions, no callback)', (fileUrl) => ({ fileUrl, fileName: 'b.docx', user: { id: 'extension-user', name: 'Extension User' } }), true],
    ]) {
      const fileUrl = await uploadViaApi(secrets, 'contract-cl.docx');
      const internal = fileUrl.startsWith('http://api:3020/api/files/');
      const opened = await openViaApi(secrets, bodyFor(fileUrl), true);
      if (opened.status !== 200) {
        ok = false;
        evidence.push(`${label}: open answered ${opened.status} ${JSON.stringify(opened.body)}`);
        continue;
      }
      const { page } = await openServicePage(context, opened.body.editorUrl);
      await typeAtDocumentEnd(page, ' 30303');
      const fs = await commandService(secrets.jwtSecret, { c: 'forcesave', key: opened.body.key });
      await page.close();
      const behaved = editable ? fs.error === 0 : fs.error === 4;
      if (!(internal && behaved)) ok = false;
      evidence.push(`${label}: uploaded through /api/files/upload (internal fileUrl ${internal}); open 200 (key ${opened.body.key}); DocumentServer drew the uploaded file; typed then force-save answered error ${fs.error} (${editable ? 'want 0: edits reached the server' : 'want 4: view-only held'})`);
    }
    return { result: ok ? 'pass' : 'fail', evidence };
  },
};

const e2a = {
  id: 'E2a',
  order: 7,
  title: 'The document profile in a real editor: no lock option, no Protection tab, no AI tab, no Plugins tab; what "Remove content control" does',
  parent: 'EDIT-2.8',
  async run({ context, secrets }) {
    await resetStub();
    const opened = await openViaApi(secrets, documentBody());
    if (opened.status !== 200) return { result: 'fail', evidence: [`open answered ${opened.status}`] };
    const key = opened.body.key;
    const { page } = await openServicePage(context, opened.body.editorUrl);
    const frame = page.frames().find((f) => f.name() === 'frameEditor');
    // Visible tabs only: contextual tabs (Header & Footer, Chart design) and a hidden Plugins tab stay in the DOM.
    const tabs = await frame.evaluate(() =>
      Array.from(document.querySelectorAll('.ribtab > a'))
        .filter((a) => a.offsetParent !== null)
        .map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    );
    // Put the caret inside the first field (paragraph 2, "This Agreement starts on |2026-11-01") and open the context menu.
    const box = await page.locator('iframe[name="frameEditor"]').boundingBox();
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5);
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Home');
    for (let i = 0; i < 27; i += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+F10');
    await sleep(1500);
    const menu = await frame.evaluate(() =>
      Array.from(document.querySelectorAll('.dropdown-menu li a'))
        .filter((a) => a.offsetParent !== null)
        .map((a) => (a.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    );
    const menuOpened = menu.length > 0;
    const lockOption = menu.some((m) => /content control settings|control settings|lock/i.test(m));
    const removeOffered = menu.some((m) => /remove content control/i.test(m));
    // Measure the offered removal: click it, close, and compare the saved file's controls with the fixture's.
    let removal = 'not offered';
    if (removeOffered) {
      await frame.locator('.dropdown-menu li a:visible', { hasText: /remove content control/i }).first().click();
      await sleep(2500);
      const t = Date.now();
      await page.close();
      const saved = await waitForEvent((e) => e.kind === 'consumer-callback' && e.key === key && (e.status === 2 || e.status === 4) && e.t >= t, 90_000);
      if (saved?.status === 2) {
        const before = controls((await openDocx(await readFile(path.join(WORK_DIR, 'fixtures', 'contract-cl.docx')))).documentXml);
        const after = controls((await openDocx(await stub(`/saved/${saved.saved.file}`))).documentXml);
        const gone = before.filter((c) => !after.some((a) => a.tag === c.tag)).map((c) => `${c.tag} ("${c.text}")`);
        const text = (await savedText(saved)).find((p) => p.includes('This Agreement starts on')) ?? '';
        removal = `controls before ${before.length}, after ${after.length}; removed: ${gone.join(', ') || 'none'}; paragraph now "${text}"`;
      } else {
        removal = `no save after the click (terminal ${saved?.event ?? 'none'}): the removal was refused`;
      }
    } else {
      await page.close();
    }
    const protection = tabs.some((t) => /protection/i.test(t));
    const ai = tabs.some((t) => /^ai$/i.test(t));
    const pluginsTab = tabs.some((t) => /^plugins$/i.test(t));
    const ok = menuOpened && !lockOption && !protection && !ai && !pluginsTab;
    return {
      result: ok ? 'pass' : 'fail',
      evidence: [
        `visible toolbar tabs: ${tabs.join(', ')} (Protection ${protection}, AI ${ai}, Plugins ${pluginsTab})`,
        `context menu inside a field opened ${menuOpened}: ${menu.slice(0, 18).join(' | ')}; a lock or content-control settings option ${lockOption}`,
        `"Remove content control" under modifyContentControl:false: ${removal}`,
      ],
    };
  },
};

const e2b = {
  id: 'E2b',
  order: 8,
  title: 'A service restart between an edit and the save still delivers the save (stateless sessions)',
  parent: 'EDIT-2.8',
  async run({ context, secrets, image }) {
    await resetStub();
    const opened = await openViaApi(secrets, documentBody());
    const key = opened.body.key;
    const { page } = await openServicePage(context, opened.body.editorUrl);
    await typeAtDocumentEnd(page, ' 20202 before restart');
    await restartApi(image, secrets);
    const t = Date.now();
    await page.close();
    const saved = await waitForEvent((e) => e.kind === 'consumer-callback' && e.key === key && e.status === 2 && e.t >= t, 90_000);
    const kept = (await savedText(saved)).some((p) => p.includes('20202 before restart'));
    return {
      result: saved && saved.signatureValid && kept ? 'pass' : 'fail',
      evidence: [`after restarting the service, the final save reached the consumer ${Boolean(saved)}, signed ${saved?.signatureValid}, holding the edit ${kept}`],
    };
  },
};

const e2c = {
  id: 'E2c',
  order: 9,
  title: 'A consumer that is down (503) or refusing (401) at the final save, then recovered within the retry horizon, receives the save',
  parent: 'EDIT-2.8 / E6',
  timeoutMs: 600_000,
  async run({ context, secrets }) {
    const evidence = [];
    let ok = true;
    for (const failStatus of [503, 401]) {
      await resetStub();
      const opened = await openViaApi(secrets, documentBody());
      const key = opened.body.key;
      const { page } = await openServicePage(context, opened.body.editorUrl);
      await typeAtDocumentEnd(page, ` 4040${failStatus} outage`);
      await setConsumerMode(2, failStatus);
      const t = Date.now();
      await page.close();
      const saved = await waitForEvent((e) => e.kind === 'consumer-callback' && e.key === key && e.status === 2 && e.answered === 200 && e.t >= t, 90_000);
      const attempts = (await events()).filter((e) => e.kind === 'consumer-callback' && e.key === key && e.status === 2);
      const kept = (await savedText(saved)).some((p) => p.includes(`4040${failStatus} outage`));
      const sameId = new Set(attempts.map((e) => e.deliveryId)).size === 1;
      if (!(saved && kept && attempts.length === 3 && sameId)) ok = false;
      evidence.push(`consumer answering ${failStatus} twice: ${attempts.length} delivery attempt(s) (${attempts.map((e) => e.answered).join(', ')}); the third delivered the save ${Boolean(saved)} holding the edit ${kept}; one deliveryId across attempts ${sameId}`);
    }
    return { result: ok ? 'pass' : 'fail', evidence };
  },
};

const e2d = {
  id: 'E2d',
  order: 10,
  title: 'Drop through the service: with edits the consumer gets the final save, without edits a closed notification',
  parent: 'EDIT-2.5 / EDIT-2.8',
  async run({ context, secrets }) {
    const evidence = [];
    let ok = true;
    for (const withEdits of [true, false]) {
      await resetStub();
      const opened = await openViaApi(secrets, documentBody());
      const key = opened.body.key;
      const { page } = await openServicePage(context, opened.body.editorUrl);
      if (withEdits) await typeAtDocumentEnd(page, ' 50505 before drop');
      const t = Date.now();
      const res = await fetch(`${API}/api/documents/keys/${key}/drop`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secrets.apiKey}` },
        body: JSON.stringify({ users: ['u1'] }),
      });
      const answer = await res.json();
      const terminal = await waitForEvent((e) => e.kind === 'consumer-callback' && e.key === key && (e.status === 2 || e.status === 4) && e.t >= t, 60_000);
      await page.close();
      const kept = withEdits ? (await savedText(terminal)).some((p) => p.includes('50505 before drop')) : null;
      const right = withEdits ? terminal?.status === 2 && kept : terminal?.status === 4;
      if (!(res.ok && right)) ok = false;
      evidence.push(`${withEdits ? 'with edits' : 'no edits'}: drop answered ${res.status} ${JSON.stringify(answer)}; terminal notification ${terminal?.event ?? 'none'}${withEdits ? `; holds the edit ${kept}` : ''}`);
    }
    const foreign = await fetch(`${API}/api/documents/keys/battery.x.e1/drop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secrets.legacyKey}` },
      body: JSON.stringify({ users: ['u1'] }),
    });
    if (foreign.status !== 403) ok = false;
    evidence.push(`another consumer dropping this consumer's key: ${foreign.status}`);
    return { result: ok ? 'pass' : 'fail', evidence };
  },
};

const e2e = {
  id: 'E2e',
  order: 11,
  title: 'Tampered and unknown editor tokens show the expired page; refusals at open',
  parent: 'EDIT-2.8',
  async run({ secrets }) {
    const opened = await openViaApi(secrets, documentBody());
    const url = opened.body.editorUrl;
    const tampered = `${url.slice(0, -4)}${url.endsWith('AAAA') ? 'BBBB' : 'AAAA'}`;
    const t1 = await fetch(tampered);
    const page1 = await t1.text();
    const refusals = {};
    for (const [label, body] of [
      ['dot in key', documentBody({ documentRef: 'a.b' })],
      ['view on e key', documentBody({ profile: 'view', panelUrl: undefined })],
      ['panel on unregistered origin', documentBody({ panelUrl: 'http://127.0.0.1:18203/panel' })],
      ['file host not registered', documentBody({ fileUrl: 'http://ds/x.docx' })],
    ]) {
      const r = await openViaApi(secrets, body);
      refusals[label] = `${r.status} ${r.body.error}`;
    }
    const legacyCallback = await openViaApi(secrets, { fileUrl: `${STUB_INTERNAL}/fixtures/contract-cl.docx`, user: { id: 'u', name: 'U' }, callbackUrl: 'http://stub:18201/x' }, true);
    const ok =
      t1.status === 410 &&
      !page1.includes('href=') &&
      Object.values(refusals).every((v) => v.startsWith('400') || v.startsWith('403')) &&
      legacyCallback.status === 400;
    return {
      result: ok ? 'pass' : 'fail',
      evidence: [
        `tampered token: ${t1.status}, expired page without a link ${!page1.includes('href=')}, CSP ${Boolean(t1.headers.get('content-security-policy'))}`,
        `refused at open: ${Object.entries(refusals).map(([k, v]) => `${k} → ${v}`).join('; ')}; legacy callbackUrl → ${legacyCallback.status} ${legacyCallback.body.error}`,
      ],
    };
  },
};

export default [s1, s2, e2a, e2b, e2c, e2d, e2e];
