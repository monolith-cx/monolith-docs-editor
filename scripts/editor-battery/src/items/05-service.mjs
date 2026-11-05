// The service itself (apps/api, built from this repo, EDITOR_ENV=local) on the pinned release:
// EDIT-1.3's round trip, and EDIT-2.8's real-editor acceptance (profiles, stateless sessions,
// signed notifications that survive a restart and a consumer outage, drop, the expired page).
import { controls, openDocx, paragraphs } from '../docx.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { STUB_A, STUB_B, STUB_C, STUB_INTERNAL, WORK_DIR, events, resetStub, restartApi, setConsumerMode, sleep, stub, waitForEvent } from '../stack.mjs';

const API = 'http://127.0.0.1:18204';

export async function openViaApi(secrets, body, legacy = false) {
  const res = await fetch(`${API}/api/documents/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${legacy ? secrets.legacyKey : secrets.apiKey}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

let docCounter = 0;
export function documentBody(over = {}) {
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
export async function openServicePage(context, editorUrl) {
  const page = await context.newPage();
  const cspViolations = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) cspViolations.push(msg.text().slice(0, 160));
  });
  await page.goto(editorUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('iframe[name="frameEditor"]').waitFor({ timeout: 90_000 });
  await waitForDrawn(page);
  return { page, cspViolations };
}

async function waitForDrawn(page) {
  const deadline = Date.now() + 90_000;
  for (;;) {
    const frame = page.frames().find((f) => f.name() === 'frameEditor');
    const drawn = frame ? await frame.evaluate(() => Boolean(document.querySelector('#editor_sdk canvas'))).catch(() => false) : false;
    if (drawn) break;
    if (Date.now() > deadline) throw new Error('editor never drew the document');
    await sleep(500);
  }
  await sleep(3000);
}

/** Opens an editor URL in `origin`'s `/frame` page; the page records every editor message its top window gets. */
export async function openFramed(context, origin, editorUrl) {
  const page = await context.newPage();
  const cspViolations = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) cspViolations.push(msg.text().slice(0, 160));
  });
  await page.addInitScript(() => {
    if (window !== window.top) return;
    window.__messages = [];
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'monolith-editor') window.__messages.push({ origin: e.origin, data: e.data });
    });
  });
  await page.goto(`${origin}/frame?src=${encodeURIComponent(editorUrl)}`, { waitUntil: 'domcontentloaded' });
  await waitForDrawn(page);
  return { page, cspViolations, editor: page.frameLocator('#framed').locator('iframe[name="frameEditor"]'), messages: () => page.evaluate(() => window.__messages) };
}

async function typeOnly(page, text, editor) {
  const box = await editor.boundingBox();
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text, { delay: 30 });
}

export async function typeAtDocumentEnd(page, text, editor = page.locator('iframe[name="frameEditor"]')) {
  await typeOnly(page, text, editor);
  await sleep(4000);
}

export async function savedText(event) {
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
      const internal = fileUrl.startsWith('http://editor-api:3020/api/files/');
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
  title: 'The document profile in a real editor: no lock option, no Protection tab, no AI tab, the Plugins tab offering only the panel; what "Remove content control" does',
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
    // With the bridge registered (EDIT-5) a Plugins tab shows; it must offer the panel alone (no Plugin Manager).
    let pluginButtons = [];
    if (tabs.some((t) => /^plugins$/i.test(t))) {
      await frame.locator('.ribtab > a', { hasText: 'Plugins' }).click();
      await sleep(800);
      pluginButtons = await frame.evaluate(() => [...new Set([...document.querySelectorAll('.panel[data-tab="plugins"] .btn-slot, .panel[data-tab="plugins"] button')].filter((b) => b.offsetParent).map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean))]);
      await frame.locator('.ribtab > a', { hasText: 'Home' }).click();
      await sleep(500);
    }
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
    // The document profile registers the bridge, so the Plugins tab must be there, offering the panel alone.
    const onlyPanel = pluginsTab && pluginButtons.length === 1 && /document\s*panel/i.test(pluginButtons[0]);
    const ok = menuOpened && !lockOption && !protection && !ai && onlyPanel;
    return {
      result: ok ? 'pass' : 'fail',
      evidence: [
        `visible toolbar tabs: ${tabs.join(', ')} (Protection ${protection}, AI ${ai}, Plugins ${pluginsTab}${pluginsTab ? `: offers ${JSON.stringify(pluginButtons)}, the panel alone ${onlyPanel}` : ''})`,
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

const s3 = {
  id: 'S3',
  order: 11.5,
  title: "The editor page is framed only by its own consumer's origins (frame-ancestors)",
  parent: 'EDIT-2.9',
  async run({ context, secrets }) {
    const opened = await openViaApi(secrets, documentBody({ mode: 'v', profile: 'view', panelUrl: undefined }));
    if (opened.status !== 200) return { result: 'fail', evidence: [`open answered ${opened.status} ${JSON.stringify(opened.body)}`] };
    const editorUrl = opened.body.editorUrl;
    const csp = (await fetch(editorUrl)).headers.get('content-security-policy') ?? '';
    const ancestors = /frame-ancestors ([^;]*)/.exec(csp)?.[1] ?? '(none sent)';
    const framedFrom = async (origin) => {
      const page = await context.newPage();
      const refusals = [];
      page.on('console', (msg) => {
        if (/frame-ancestors/i.test(msg.text())) refusals.push(msg.text().slice(0, 200));
      });
      await page.goto(`${origin}/frame?src=${encodeURIComponent(editorUrl)}`, { waitUntil: 'domcontentloaded' });
      // A framed editor page loads DocumentServer's editor in its own frame; a refused one loads nothing.
      let loaded = false;
      const deadline = Date.now() + 60_000;
      while (!loaded && Date.now() < deadline && refusals.length === 0) {
        loaded = page.frames().some((f) => f.name() === 'frameEditor');
        if (!loaded) await sleep(500);
      }
      await page.close();
      return { loaded, refusals };
    };
    const own = await framedFrom(STUB_A);
    const other = await framedFrom(STUB_C);
    // The battery consumer registers STUB_B as its panel origin and STUB_A as its return origin (compose.yml).
    const ok = ancestors === `'self' ${STUB_B} ${STUB_A}` && own.loaded && own.refusals.length === 0 && !other.loaded && other.refusals.length > 0;
    return {
      result: ok ? 'pass' : 'fail',
      evidence: [
        `frame-ancestors ${ancestors}`,
        `framed by the consumer's returnOrigin (18201): editor loaded ${own.loaded}, refusals ${own.refusals.length}`,
        `framed by an unregistered origin (18203): editor loaded ${other.loaded}; ${other.refusals[0] ?? 'no refusal logged'}`,
      ],
    };
  },
};

const forcesave = async (key, token) => {
  const res = await fetch(`${API}/api/documents/keys/${key}/forcesave`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
};

/** Waits until the framed page's last editor message says `editing: false`, after at least `after` messages. */
async function waitForSent(framed, after) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const all = await framed.messages();
    if (all.length > after && all.at(-1).data.editing === false) return all;
    if (Date.now() > deadline) return all;
    await sleep(250);
  }
}

const s4 = {
  id: 'S4',
  order: 11.6,
  title: 'Saving on request through the service, and the editing state reaching only the framing consumer',
  parent: 'DOC-23',
  async run({ context, secrets }) {
    await resetStub();
    const opened = await openViaApi(secrets, documentBody());
    if (opened.status !== 200) return { result: 'fail', evidence: [`open answered ${opened.status} ${JSON.stringify(opened.body)}`] };
    const { key, editorUrl } = opened.body;
    const framed = await openFramed(context, STUB_A, editorUrl);

    // Nothing edited yet: a normal answer, and the file's key is live.
    const untouched = await forcesave(key, secrets.apiKey);
    const refused = await forcesave(key, secrets.legacyKey);
    const unknown = await forcesave(`battery.never_opened_${Date.now().toString(36)}.e1`, secrets.apiKey);

    // While the browser may still hold the edit. Which answer comes depends on when the editor's
    // batch lands, so a normal answer is required and the one given is recorded: a Save button has to deal with it.
    await typeOnly(framed.page, ' 20202 pending', framed.editor);
    const reported = (await framed.messages()).at(-1)?.data.editing;
    const whileEditing = await forcesave(key, secrets.apiKey);
    const sent1 = await waitForSent(framed, 0);
    await sleep(2000);

    const count = (await framed.messages()).length;
    const t = Date.now();
    await typeOnly(framed.page, ' 30303 on request', framed.editor);
    const sent2 = await waitForSent(framed, count);
    const save = await forcesave(key, secrets.apiKey);
    const saved = await waitForEvent((e) => e.kind === 'consumer-callback' && e.key === key && e.status === 6 && e.t >= t, 60_000);
    const kept = (await savedText(saved)).some((p) => p.includes('30303 on request'));
    const messages = await framed.messages();
    await framed.page.close();

    const exact = messages.every((m) => m.origin === API && Object.keys(m.data).join() === 'type,event,editing' && m.data.event === 'state' && typeof m.data.editing === 'boolean');
    const both = messages[0]?.data.editing === true && messages.at(-1)?.data.editing === false;

    // The consumer's other registered origin also gets it.
    const second = await openViaApi(secrets, documentBody());
    const panelHost = await openFramed(context, STUB_B, second.body.editorUrl);
    await typeOnly(panelHost.page, ' 40404', panelHost.editor);
    const panelMessages = await waitForSent(panelHost, 0);
    await panelHost.page.close();

    // An unregistered parent. frame-ancestors keeps it out (S3), so the header is removed here to
    // prove the second line alone: the message's target origin. A fulfilled page counts as public to
    // Chrome, which would then refuse it loopback addresses, so this browser has that check off.
    const third = await openViaApi(secrets, documentBody());
    const unchecked = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-features=LocalNetworkAccessChecks'] });
    const lifted = await unchecked.newContext();
    await lifted.route(`${API}/editor/*`, async (route) => {
      const response = await route.fetch();
      const { 'content-security-policy': _csp, ...headers } = response.headers();
      await route.fulfill({ response, headers });
    });
    const stranger = await openFramed(lifted, STUB_C, third.body.editorUrl);
    await typeOnly(stranger.page, ' 50505', stranger.editor);
    await sleep(8000);
    const strangerMessages = await stranger.messages();
    const strangerLoaded = stranger.page.frames().some((f) => f.name() === 'frameEditor');
    await unchecked.close();

    const ok = untouched.status === 200 && untouched.body.result === 'no_changes'
      && whileEditing.status === 200 && ['ok', 'no_changes'].includes(whileEditing.body.result)
      && refused.status === 403 && refused.body.error === 'not_your_key'
      && unknown.status === 404 && unknown.body.error === 'key_not_found'
      && save.status === 200 && save.body.result === 'ok' && Boolean(saved) && kept && saved.signatureValid
      && exact && both && sent1.length > 0 && sent2.length > count && framed.cspViolations.length === 0
      && panelMessages.length > 0 && panelMessages.every((m) => m.origin === API)
      && strangerLoaded && strangerMessages.length === 0;
    return {
      result: ok ? 'pass' : 'fail',
      evidence: [
        `no edits: ${untouched.status} ${JSON.stringify(untouched.body)}; another consumer: ${refused.status} ${JSON.stringify(refused.body)}; a key never opened: ${unknown.status} ${JSON.stringify(unknown.body)}`,
        `straight after typing, the page reporting editing:${reported}: ${whileEditing.status} ${JSON.stringify(whileEditing.body)}`,
        `after editing:false: ${save.status} ${JSON.stringify(save.body)}; status 6 reached the consumer ${Boolean(saved)}, signature valid ${saved?.signatureValid}, the saved file holds the edit ${kept}`,
        `framed by the returnOrigin: ${messages.map((m) => m.data.editing).join(', ')}; exact shape from the service's origin ${exact}; CSP violations ${framed.cspViolations.length}`,
        `framed by the panel origin: ${panelMessages.length} message(s)`,
        `framed by an unregistered origin with frame-ancestors lifted: editor loaded ${strangerLoaded}, ${strangerMessages.length} message(s)`,
      ],
    };
  },
};

/** The entries the File menu shows in the session `opened` names. */
async function fileMenu(context, opened) {
  const { page } = await openServicePage(context, opened.body.editorUrl);
  const frame = page.frames().find((f) => f.name() === 'frameEditor');
  await frame.locator('.ribtab a[data-tab="file"]').first().click();
  await sleep(1500);
  const shown = await frame.evaluate(() => ['fm-btn-download', 'fm-btn-print'].filter((id) => document.getElementById(id)?.offsetParent));
  await page.close();
  return shown;
}

const s5 = {
  id: 'S5',
  order: 11.7,
  title: 'Download and print follow the permissions a profile open sets',
  parent: 'DOC-23',
  async run({ context, secrets }) {
    const byDefault = await fileMenu(context, await openViaApi(secrets, documentBody()));
    const limited = await fileMenu(context, await openViaApi(secrets, documentBody({ permissions: { download: false, print: false } })));
    const printOnly = await fileMenu(context, await openViaApi(secrets, documentBody({ permissions: { download: false } })));
    const ok = byDefault.length === 2 && limited.length === 0 && printOnly.join() === 'fm-btn-print';
    return {
      result: ok ? 'pass' : 'fail',
      evidence: [`File menu by default: ${byDefault.join(', ')}; download and print off: ${limited.join(', ') || 'neither'}; download off: ${printOnly.join(', ')}`],
    };
  },
};

export default [s1, s2, e2a, e2b, e2c, e2d, e2e, s3, s4, s5];
