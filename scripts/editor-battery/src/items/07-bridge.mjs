// EDIT-5 (parent UDOC-1.5): the panel bridge plugin in a real editor on the pinned release, served by
// the service, hosting the stub consumer's panel page (stub/panel/bridge.html) on its own origin.
import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { CORPUS, CORPUS_DIR } from '../corpus.mjs';
import { controls, count, openDocx } from '../docx.mjs';
import { resetStub, sleep, stub, waitForEvent } from '../stack.mjs';
import { documentBody, openServicePage, openViaApi, typeAtDocumentEnd } from './05-service.mjs';

const PANEL = 'http://127.0.0.1:18202/panel/bridge.html';
const PLUGIN_ORIGIN = 'http://127.0.0.1:18204';

export function bridgeBody(over = {}) {
  return documentBody({ panelUrl: `${PANEL}#pluginOrigin=${PLUGIN_ORIGIN}&token=battery-panel-token`, ...over });
}

/** The plugin's and the panel's frames inside a service editor page. */
export function bridgeFrames(page) {
  const plugin = page.frames().find((f) => f.url().includes('/plugins/udoc-bridge/index.html'));
  const panel = page.frames().find((f) => f.url().startsWith(PANEL));
  return { plugin, panel };
}

/** Opens a document session with the bridge and waits until the panel has the plugin's 'udoc.ready'. */
export async function openBridge(context, secrets, over = {}) {
  const opened = await openViaApi(secrets, bridgeBody(over));
  if (opened.status !== 200) throw new Error(`open answered ${opened.status} ${JSON.stringify(opened.body)}`);
  const { page, cspViolations } = await openServicePage(context, opened.body.editorUrl);
  const deadline = Date.now() + 60_000;
  for (;;) {
    const { panel } = bridgeFrames(page);
    const ready = panel ? await panel.evaluate(() => window.__panel && window.__panel.ready).catch(() => null) : null;
    if (ready) return { page, key: opened.body.key, ready, cspViolations };
    if (Date.now() > deadline) {
      const frames = page.frames().map((f) => f.url().slice(0, 90));
      throw new Error(`panel never got udoc.ready (frames: ${frames.join(' | ')})`);
    }
    await sleep(500);
  }
}

/** Sends one request from the panel page and returns the plugin's answer. */
export async function request(page, op, args = {}) {
  const { panel } = bridgeFrames(page);
  return panel.evaluate(({ op: o, args: a }) => window.__panel.request(o, a), { op, args });
}

const e5a = {
  id: 'E5a',
  order: 14,
  title: 'The bridge plugin in a document session: docked right, hosting the consumer panel, which gets udoc.ready',
  parent: 'EDIT-5.1, 5.2, 5.6 / UDOC-1.5',
  async run({ context, secrets }) {
    const { page, ready, cspViolations } = await openBridge(context, secrets);
    const { plugin, panel } = bridgeFrames(page);
    const pluginBox = await (await plugin.frameElement()).boundingBox();
    const whole = await page.locator('iframe[name="frameEditor"]').boundingBox();
    const panelState = await panel.evaluate(() => ({ token: window.__panel.token, ignored: window.__panel.ignored.length }));
    const text = await request(page, 'getText');
    await page.close();
    const docked = pluginBox && whole && pluginBox.x > whole.x + whole.width * 0.55 && pluginBox.width >= 200 && pluginBox.height >= 300;
    const fields = text.ok ? text.result.body.flatMap((p) => p.fields.map((f) => f.tag)) : [];
    const ok = docked && ready.protocol === 1 && ready.operations.length === 6 && text.ok && fields.includes('field:r1') && panelState.token === 'battery-panel-token' && cspViolations.length === 0;
    return {
      result: ok ? 'pass' : 'fail',
      evidence: [
        `plugin panel box x=${Math.round(pluginBox?.x)} w=${Math.round(pluginBox?.width)} h=${Math.round(pluginBox?.height)} within editor x=${Math.round(whole?.x)} w=${Math.round(whole?.width)}: docked right ${docked}`,
        `udoc.ready: protocol ${ready.protocol}, operations ${ready.operations.join(', ')}; panel token from its fragment ${panelState.token === 'battery-panel-token'}; messages the panel ignored ${panelState.ignored}`,
        `getText: ok ${text.ok}, ${text.ok ? text.result.body.length : 0} body paragraphs, fields ${fields.join(', ')}; CSP violations on the editor page ${cspViolations.length}`,
      ],
    };
  },
};

/** The body paragraph index holding `needle`, from a getText answer. */
function indexOf(text, needle) {
  return text.result.body.find((p) => p.text.includes(needle))?.index ?? -1;
}

/** Closes the editor and returns the final save's document.xml and comments.xml. */
async function closeAndSave(page, key) {
  // Changes not yet sent when a tab closes are lost (ADR F11); let the editor send them first.
  await sleep(5000);
  const t = Date.now();
  await page.close();
  const saved = await waitForEvent((e) => e.kind === 'consumer-callback' && e.key === key && (e.status === 2 || e.status === 4) && e.t >= t, 90_000);
  if (!saved || saved.status !== 2 || !saved.saved?.file) return { saved, xml: '', comments: '' };
  const { zip, documentXml } = await openDocx(await stub(`/saved/${saved.saved.file}`));
  const comments = zip.file('word/comments.xml') ? await zip.file('word/comments.xml').async('string') : '';
  return { saved, xml: documentXml, comments };
}

const e5b = {
  id: 'E5b',
  order: 15,
  title: 'Every bridge operation round-trips from the consumer panel, refusals included, and the saved file holds the results',
  parent: 'EDIT-5.3, 5.6 / UDOC-1.5',
  timeoutMs: 300_000,
  async run({ context, secrets }) {
    await resetStub();
    const { page, key } = await openBridge(context, secrets);
    const evidence = [];
    const box = await page.locator('iframe[name="frameEditor"]').boundingBox();
    // getSelection: select the first line with the keyboard.
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Shift+End');
    const selection = await request(page, 'getSelection');
    const before = await request(page, 'getText');
    const sentence = indexOf(before, 'between Monolith and');
    const payable = indexOf(before, 'payable');
    // Cursor at the end of the document for the insertions.
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.keyboard.press('Control+End');
    const inline = await request(page, 'insertField', { rowId: 'r9', label: 'Ninth', value: 'INSERTEDNINE', kind: 'inline' });
    const token = await request(page, 'insertToken', { token: '{customer.name}' });
    const block = await request(page, 'insertField', { rowId: 'b9', label: 'Block nine', value: 'BLOCKNINE', kind: 'block' });
    const suggest = await request(page, 'applySuggestion', { paragraphIndex: sentence, context: 'between Monolith and', occurrence: 0, find: 'between Monolith', replace: 'between Monolith Inc.', comment: { text: 'Moli: use the legal name', author: 'Moli' } });
    const comment = await request(page, 'addComment', { paragraphIndex: payable, context: 'payable', occurrence: 0, find: 'payable', text: 'Rep: confirm terms', author: 'Rep' });
    // find contains replace: the comment must still land on the inserted text, not the deleted one.
    const tokenLine = indexOf(before, 'Token check');
    const shorter = await request(page, 'applySuggestion', { paragraphIndex: tokenLine, context: 'Token check:', occurrence: 0, find: 'Token check', replace: 'Token', comment: { text: 'Moli: shorter', author: 'Moli' } });
    // Repeated text: occurrences are counted without overlap, as Search counts them.
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.keyboard.press('Control+End');
    await request(page, 'insertToken', { token: 'aaaa' });
    const repeatedAt = indexOf(await request(page, 'getText'), 'aaaa');
    const repeated = await request(page, 'addComment', { paragraphIndex: repeatedAt, context: 'aaaa', occurrence: 1, find: 'aa', text: 'second pair', author: 'Rep' });
    // A pure deletion (empty replace): one tracked deletion, nothing inserted; a comment on it is refused.
    const holder = indexOf(before, 'SENTENCEHOLDER');
    const deletion = await request(page, 'applySuggestion', { paragraphIndex: holder, context: 'SENTENCEHOLDER keeps ', occurrence: 0, find: 'keeps ', replace: '' });
    const deletionComment = await request(page, 'applySuggestion', { paragraphIndex: holder, context: 'SENTENCEHOLDER', occurrence: 0, find: 'SENTENCEHOLDER', replace: '', comment: { text: 'x', author: 'y' } });
    const refusals = {
      inside_field: await request(page, 'applySuggestion', { paragraphIndex: sentence, context: 'starts on 2026-11-01', occurrence: 0, find: '2026-11-01', replace: 'x' }),
      stale_anchor: await request(page, 'applySuggestion', { paragraphIndex: sentence, context: 'between Moon and', occurrence: 0, find: 'between', replace: 'x' }),
      not_found: await request(page, 'addComment', { paragraphIndex: sentence, context: 'between', occurrence: 7, find: 'between', text: 'x', author: 'y' }),
      unsupported: await request(page, 'deleteEverything', {}),
      invalid_args: await request(page, 'insertField', { rowId: 'r.1', label: 'x', value: 'x', kind: 'inline' }),
    };
    const after = await request(page, 'getText');
    const afterFields = after.result.body.flatMap((p) => p.fields.map((f) => f.tag));
    const { saved, xml, comments } = await closeAndSave(page, key);
    /** The text inside the range of the comment by `author` whose text includes `note`. */
    const commentRange = (note) => {
      const m = [...comments.matchAll(/<w:comment\b[^>]*w:id="(\d+)"[^>]*>([\s\S]*?)<\/w:comment>/g)].find((c) => c[2].includes(note));
      if (!m) return '';
      const id = m[1];
      const startAt = xml.indexOf(`<w:commentRangeStart w:id="${id}"`);
      const endAt = xml.indexOf(`<w:commentRangeEnd w:id="${id}"`);
      return startAt >= 0 && endAt > startAt ? xml.slice(startAt, endAt) : '';
    };
    const legal = commentRange('Moli: use the legal name');
    const short = commentRange('Moli: shorter');
    const onInserted = (range, inserted) => range.includes('<w:ins') && range.includes(inserted) && !range.includes('<w:del');
    const legalPlaced = onInserted(legal, 'between Monolith Inc.') && suggest.result?.commentPlaced === true;
    const shortPlaced = onInserted(short, 'Token') && shorter.result?.commentPlaced === true;
    /** The visible text of a stretch of document.xml. */
    const wt = (s) => [...s.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
    // The "second pair" comment covers exactly the second "aa" of "aaaa": its range reads "aa", and
    // the text of its paragraph before the range ends with the first "aa".
    const pairRange = commentRange('second pair');
    /** Where the paragraph holding offset `at` starts: the last `<w:p>` or `<w:p …>` before it (never `<w:pPr>`). */
    const paraStart = (at) => {
      let start = -1;
      for (const m of xml.slice(0, at).matchAll(/<w:p[ >]/g)) start = m.index;
      return start;
    };
    const pairStart = xml.indexOf(pairRange);
    const pairPara = pairStart >= 0 && paraStart(pairStart) >= 0 ? xml.slice(paraStart(pairStart), pairStart) : '';
    const pairPlaced = repeated.ok && wt(pairRange) === 'aa' && wt(pairPara).endsWith('aa') && !wt(pairPara).endsWith('aaa');
    const holderPara = (() => {
      const at = xml.indexOf('SENTENCEHOLDER');
      return at >= 0 && paraStart(at) >= 0 ? xml.slice(paraStart(at), xml.indexOf('</w:p>', at)) : '';
    })();
    const holderDels = (holderPara.match(/<w:del\b/g) || []).length;
    const deletedRight =
      deletion.ok &&
      JSON.stringify(deletion.result) === '{}' &&
      holderDels === 1 &&
      /<w:del\b[\s\S]*?<w:delText[^>]*>keeps <\/w:delText>/.test(holderPara) &&
      !/<w:ins\b/.test(holderPara) &&
      deletionComment.ok === false &&
      deletionComment.error === 'invalid_args';
    const ctl = xml ? controls(xml) : [];
    const r9 = ctl.find((c) => c.tag === 'field:r9');
    const b9 = ctl.find((c) => c.tag === 'block:b9');
    const refusedRight = Object.entries(refusals).every(([name, a]) => a.ok === false && a.error === name);
    const ok =
      selection.ok && selection.result.text.length > 0 &&
      [inline, token, block, suggest, comment, shorter, repeated, deletion].every((a) => a.ok) &&
      legalPlaced &&
      pairPlaced &&
      deletedRight &&
      shortPlaced &&
      refusedRight &&
      afterFields.includes('field:r9') &&
      r9?.lock === 'contentLocked' && r9.text === 'INSERTEDNINE' &&
      b9?.lock === 'sdtContentLocked' && b9.text.includes('BLOCKNINE') &&
      xml.includes('{customer.name}') &&
      xml && count(xml, 'ins') >= 1 && count(xml, 'del') >= 1 &&
      /w:author="Moli"/.test(comments) && comments.includes('Moli: use the legal name') && comments.includes('Rep: confirm terms');
    evidence.push(
      `getSelection: ${JSON.stringify(selection.result?.text).slice(0, 60)}; getText before: ${before.result.body.length} paragraphs`,
      `insertField inline ${JSON.stringify(inline)}, insertToken ${token.ok}, insertField block ${JSON.stringify(block)}, applySuggestion ${suggest.ok}, addComment ${comment.ok}`,
      `comments on the inserted text, not the deleted: "use the legal name" ${legalPlaced}, find ⊃ replace ("Token check" → "Token") ${shortPlaced}; repeated text "aaaa", second "aa": ${repeated.ok ? 'ok' : JSON.stringify(repeated)}, comment range reads "${wt(pairRange)}" after "${wt(pairPara).slice(-6)}" (Search counts without overlap) ${pairPlaced}`,
      `pure deletion ("keeps " → ""): ${JSON.stringify(deletion)}, saved with ${holderDels} w:del ("keeps ") and no w:ins in its paragraph: ${deletedRight}; with a comment → ${deletionComment.ok ? 'ok?!' : deletionComment.error}`,
      `refusals: ${Object.entries(refusals).map(([n, a]) => `${n} → ${a.ok ? 'ok?!' : a.error}`).join(', ')}`,
      `final notification ${saved ? `status ${saved.status}` : 'none'}; saved file: field:r9 ${r9 ? `${r9.lock} "${r9.text}"` : 'missing'}; block:b9 ${b9 ? `${b9.lock} "${b9.text}"` : 'missing'}; token present ${xml.includes('{customer.name}')}; w:ins ${xml ? count(xml, 'ins') : 0}, w:del ${xml ? count(xml, 'del') : 0}; comments by Moli and Rep ${/w:author="Moli"/.test(comments) && comments.includes('Rep: confirm terms')}`,
    );
    return { result: ok ? 'pass' : 'fail', evidence };
  },
};

const e5c = {
  id: 'E5c',
  order: 16,
  title: 'Origin rules: forged requests from the editor page and DocumentServer are ignored by the plugin; the panel ignores anything but the plugin',
  parent: 'EDIT-5.4, 5.6 / D14',
  async run({ context, secrets }) {
    await resetStub();
    const { page } = await openBridge(context, secrets);
    const { plugin, panel } = bridgeFrames(page);
    const ds = page.frames().find((f) => f.name() === 'frameEditor');
    const forged = { type: 'udoc.request', id: 'forged', op: 'insertToken', args: { token: 'FORGEDTOKEN' } };
    const initial = await plugin.evaluate(() => window.udocBridgeStats.ignored);
    // From the service's own editor page (top) and from DocumentServer's frame, into the plugin's frame.
    await page.evaluate((msg) => {
      const f = document.querySelector('iframe[name="frameEditor"]');
      const pluginWin = f && f.contentWindow && f.contentWindow.frames;
      for (let i = 0; pluginWin && i < pluginWin.length; i++) pluginWin[i].postMessage(msg, '*');
    }, forged);
    await ds.evaluate((msg) => {
      for (let i = 0; i < window.frames.length; i++) window.frames[i].postMessage(msg, '*');
    }, forged);
    const before = await plugin.evaluate(() => window.udocBridgeStats.ignored);
    // From a page on the panel's own origin, but another window: framed by the panel page itself. A
    // forger framed by the service's editor page never loaded (run 2257: no such frame), so before
    // that run this case was not exercised.
    await panel.evaluate(() => {
      const f = document.createElement('iframe');
      f.src = '/panel/forger.html';
      document.body.appendChild(f);
    });
    await sleep(2000);
    const afterForger = await plugin.evaluate(() => window.udocBridgeStats.ignored);
    const forgerFrame = page.frames().find((f) => f.url().endsWith('/panel/forger.html'));
    const forgerSaid = forgerFrame ? await forgerFrame.evaluate(() => document.body.textContent) : 'no forger frame';
    // Into the panel, pretending to be the plugin's answer, from DocumentServer's frame.
    await ds.evaluate(() => {
      for (let i = 0; i < window.frames.length; i++) {
        const w = window.frames[i];
        for (let j = 0; j < w.frames.length; j++) w.frames[j].postMessage({ type: 'udoc.ready', protocol: 99, operations: [] }, '*');
      }
    });
    await sleep(2000);
    const text = await request(page, 'getText');
    const forgedLanded = text.result.body.some((p) => p.text.includes('FORGEDTOKEN') || p.text.includes('FORGEDSAMEORIGIN'));
    const after = await plugin.evaluate(() => window.udocBridgeStats);
    const panelState = await panel.evaluate(() => ({ ignored: window.__panel.ignored, readyCount: window.__panel.readyCount, protocol: window.__panel.ready.protocol, responses: window.__panel.responses.map((r) => r.id) }));
    const pluginOrigin = await plugin.evaluate(() => location.origin);
    await page.close();
    // Positive control: each forged message reached the plugin and was counted as ignored, exactly:
    // one from the editor page and one from DocumentServer's frame, then one from the same-origin forger.
    const reached = before - initial === 2 && afterForger - before === 1 && after.ignored === afterForger;
    const ok = !forgedLanded && reached && !panelState.responses.some((r) => String(r).startsWith('forged')) && panelState.protocol === 1 && panelState.ignored.length >= 1;
    return {
      result: ok ? 'pass' : 'fail',
      evidence: [
        `forged insertToken from the editor page, from DocumentServer's frame, and from a page on the panel's own origin in another window reached the document ${forgedLanded}; the bridge's ignored count went ${initial} → ${before} (editor page and DocumentServer frame) → ${afterForger} (same-origin forger, which reported "${forgerSaid}"), ${after.ignored} at the end: each arrived and was dropped ${reached}; responses to forged ids ${panelState.responses.filter((r) => String(r).startsWith('forged')).length}`,
        `panel ignored ${panelState.ignored.length} message(s) not from the plugin (${[...new Set(panelState.ignored.map((m) => m.origin))].join(', ')}); its ready stayed protocol ${panelState.protocol}`,
        `plugin origin ${pluginOrigin}; the bridge never posts to '*' (apps/plugin check-deps and commands tests pin the source)`,
      ],
    };
  },
};

const e5d = {
  id: 'E5d',
  order: 17,
  title: 'One applySuggestion is one undo step; a stale anchor is refused after the user edits the paragraph',
  parent: 'EDIT-5.3, 5.6',
  async run({ context, secrets }) {
    await resetStub();
    const { page, key } = await openBridge(context, secrets);
    const before = await request(page, 'getText');
    const i = indexOf(before, 'payable');
    const original = before.result.body[i].text;
    const applied = await request(page, 'applySuggestion', { paragraphIndex: i, context: 'payable', occurrence: 0, find: 'payable', replace: 'remitted', comment: { text: 'Moli: wording', author: 'Moli' } });
    const box = await page.locator('iframe[name="frameEditor"]').boundingBox();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.keyboard.press('Control+z');
    await sleep(1000);
    const undone = await request(page, 'getText');
    const restored = undone.result.body[i].text === original;
    // An insertion is one undo step too.
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.keyboard.press('Control+End');
    const inserted = await request(page, 'insertField', { rowId: 'u1', label: 'Undo me', value: 'UNDOFIELD', kind: 'inline' });
    const withField = (await request(page, 'getText')).result.body.some((p) => p.fields.some((f) => f.tag === 'field:u1'));
    await page.keyboard.press('Control+z');
    await sleep(1000);
    const fieldGone = !(await request(page, 'getText')).result.body.some((p) => p.fields.some((f) => f.tag === 'field:u1'));
    // The user edits a paragraph after the panel read it: the anchor read before no longer holds.
    const title = indexOf(undone, 'Services Agreement');
    const fresh = await request(page, 'addComment', { paragraphIndex: title, context: 'Services Agreement', occurrence: 0, find: 'Services', text: 'probe', author: 'Rep' });
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.keyboard.press('Control+Home');
    for (let k = 0; k < 3; k += 1) await page.keyboard.press('Delete');
    await sleep(1000);
    const stale = await request(page, 'applySuggestion', { paragraphIndex: title, context: 'Services Agreement', occurrence: 0, find: 'Services', replace: 'Supply' });
    await request(page, 'getText');
    const { xml } = await closeAndSave(page, key);
    const ok = applied.ok && restored && inserted.ok && withField && fieldGone && fresh.ok && stale.ok === false && stale.error === 'stale_anchor';
    return {
      result: ok ? 'pass' : 'fail',
      evidence: [
        `applySuggestion with a comment ${applied.ok}; one Ctrl+Z restored the paragraph exactly ${restored} ("${undone.result.body[i].text.slice(0, 80)}")`,
        `insertField then one Ctrl+Z: the field was there ${withField} and is gone ${fieldGone}`,
        `the anchor held before the user's edit (addComment ${fresh.ok}); after the user deleted the title's first three characters the same anchor answered ${JSON.stringify(stale)}`,
        `saved file after the undo: w:ins ${count(xml, 'ins')}, w:del ${count(xml, 'del')} (the user's own deletion is not tracked)`,
      ],
    };
  },
};

/** Waits until the panel frame exists and has a udoc.ready (counting from `after`). */
async function waitReady(page, after = 0, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { panel } = bridgeFrames(page);
    const n = panel ? await panel.evaluate(() => (window.__panel ? window.__panel.readyCount : 0)).catch(() => 0) : 0;
    if (n > after) return true;
    if (Date.now() > deadline) return false;
    await sleep(500);
  }
}

const e5e = {
  id: 'E5e',
  order: 18,
  title: 'Closing and reopening the panel, and reloading the editor page three minutes after open, both bring the panel back working',
  parent: 'EDIT-5.2, 5.6',
  timeoutMs: 600_000,
  async run({ context, secrets }) {
    await resetStub();
    const openedAt = Date.now();
    const { page } = await openBridge(context, secrets);
    const ds = () => page.frames().find((f) => f.name() === 'frameEditor');
    await ds().locator('button[aria-label="Close plugin"]').click();
    await sleep(2000);
    const closed = !bridgeFrames(page).plugin;
    await ds().locator('.ribtab > a', { hasText: 'Plugins' }).click();
    await sleep(800);
    await ds().locator('.panel[data-tab="plugins"] .btn-slot:visible, .panel[data-tab="plugins"] button:visible', { hasText: /Document\s*panel/ }).first().click();
    const reopened = await waitReady(page, 0);
    const afterReopen = reopened ? await request(page, 'getText') : { ok: false };
    // Reload the editor page three minutes after the session opened.
    const wait = Math.max(0, 180_000 - (Date.now() - openedAt));
    await sleep(wait);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const reloaded = await waitReady(page, 0, 90_000);
    const afterReload = reloaded ? await request(page, 'getText') : { ok: false };
    const elapsed = Math.round((Date.now() - openedAt) / 1000);
    await page.close();
    const ok = closed && reopened && afterReopen.ok && reloaded && afterReload.ok;
    return {
      result: ok ? 'pass' : 'fail',
      evidence: [
        `close button closed the panel (plugin frame gone) ${closed}; reopened from the Plugins tab: udoc.ready ${reopened}, getText ${afterReopen.ok}`,
        `editor page reloaded ${elapsed}s after the session opened: udoc.ready ${reloaded}, getText ${afterReload.ok}${afterReload.ok ? ` (${afterReload.result.body.length} paragraphs)` : ''}`,
      ],
    };
  },
};

const TOKEN = /\{[#/^]?[A-Za-z_][\w.]*\}/g;

/** Every control (tag, lock, text) and every template token in the body, headers, and footers. */
async function signature(buf) {
  const { zip } = await openDocx(buf);
  const parts = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n)).sort();
  const out = { controls: [], tokens: [], parts: [] };
  for (const name of parts) {
    const xml = await zip.file(name).async('string');
    const kind = name.replace(/^word\/|\d*\.xml$/g, '');
    out.parts.push(kind);
    for (const c of controls(xml)) out.controls.push(`${kind}:${c.tag}|${c.lock}|${c.text}`);
    const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
    for (const t of text.match(TOKEN) ?? []) out.tokens.push(`${kind}:${t}`);
  }
  out.controls.sort();
  out.tokens.sort();
  return out;
}

const e5f = {
  id: 'E5f',
  order: 19,
  title: 'The corpus survives an OnlyOffice save with every field, block, and token intact',
  parent: 'EDIT-5.5, 5.6',
  timeoutMs: 900_000,
  async fixtures(work) {
    for (const c of CORPUS) await copyFile(path.join(CORPUS_DIR, c.name), path.join(work, 'fixtures', c.name));
  },
  async run({ context, secrets, work }) {
    const evidence = [];
    let ok = true;
    for (const c of CORPUS) {
      await resetStub();
      const before = await signature(await readFile(path.join(work, 'fixtures', c.name)));
      const opened = await openViaApi(secrets, bridgeBody({ fileUrl: `http://stub:18201/fixtures/${c.name}`, fileName: c.name }));
      if (opened.status !== 200) {
        ok = false;
        evidence.push(`${c.name}: open answered ${opened.status}`);
        continue;
      }
      const { page } = await openServicePage(context, opened.body.editorUrl);
      let storyNote = '';
      if (c.name === 'field-in-header-and-footer.docx') {
        // getText reads the header and footer stories too (EDIT-5.3).
        await waitReady(page, 0);
        const text = await request(page, 'getText');
        const tags = (stories) => (text.ok ? text.result[stories].flatMap((h) => h.paragraphs.flatMap((p) => p.fields.map((f) => f.tag))) : []);
        const found = tags('headers').includes('field:h1') && tags('footers').includes('field:f1');
        if (!found) ok = false;
        storyNote = `; getText found the header field ${tags('headers').join(',') || 'none'} and footer field ${tags('footers').join(',') || 'none'}`;
      }
      await typeAtDocumentEnd(page, ' 60606');
      const { saved } = await closeAndSave(page, opened.body.key);
      if (!saved || saved.status !== 2) {
        ok = false;
        evidence.push(`${c.name}: no final save (${saved ? `status ${saved.status}` : 'none'})`);
        continue;
      }
      const after = await signature(await stub(`/saved/${saved.saved.file}`));
      const same = JSON.stringify(before.controls) === JSON.stringify(after.controls) && JSON.stringify(before.tokens) === JSON.stringify(after.tokens);
      if (!same) ok = false;
      evidence.push(
        `${c.name}: ${same ? 'intact' : 'CHANGED'} — controls ${before.controls.length}→${after.controls.length}, tokens ${before.tokens.length}→${after.tokens.length} across ${after.parts.join('+')}` +
          storyNote +
          (same ? '' : `; before ${JSON.stringify(before)} after ${JSON.stringify(after)}`.slice(0, 600)),
      );
    }
    return { result: ok ? 'pass' : 'fail', evidence };
  },
};

export default [e5a, e5b, e5c, e5d, e5e, e5f];
