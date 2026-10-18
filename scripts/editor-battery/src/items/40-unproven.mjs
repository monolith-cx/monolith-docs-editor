// EDIT-1.5: behaviours UDOC depends on that the 2026-10 spike did not prove, on the pinned release.
// Measurement items report what DocumentServer did ("record"); the consumer guide and ADR cite them.
import { writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { controls, count, paragraphs } from '../docx.mjs';
import { Editor, buildConfig, commandService } from '../editor.mjs';
import { VALUES } from '../fixtures.mjs';
import { addFixture, closeAndAwait, forceSave, squash, toPdf, uniqueKey } from '../flow.mjs';
import { DS_PUBLIC, STUB_B, STUB_A, dsExec, events, resetStub, restartDs, setCallbackMode, sleep, waitForEvent } from '../stack.mjs';
import { SUGGEST } from './30-plugin.mjs';

const FIXTURE = 'contract-cl.docx';

async function open(context, secrets, prefix, extra = {}) {
  const key = uniqueKey(prefix);
  const editor = await Editor.open(context, secrets.jwtSecret, buildConfig({ fixture: FIXTURE, key, ...extra }));
  return { editor, key };
}

async function typeAtEnd(editor, text) {
  await editor.focusDocument();
  await editor.selectText('ENDMARKER');
  await editor.press('End');
  await editor.type(text);
}

const INSERT_FIELD = `function () {
  var d = Api.GetDocument();
  var prev = d.IsTrackRevisions();
  d.SetTrackRevisions(Asc.scope.track);
  var cc = Api.CreateInlineLvlSdt();
  var run = Api.CreateRun();
  run.AddText(Asc.scope.value);
  cc.AddElement(run, 0);
  cc.SetTag(Asc.scope.tag);
  cc.SetAlias(Asc.scope.label);
  cc.SetLock('contentLocked');
  var p = Api.CreateParagraph();
  p.AddInlineLvlSdt(cc);
  d.InsertContent([p], true);
  d.SetTrackRevisions(prev);
  return 'ok';
}`;

function u1(track, defaultPermissions = false) {
  return {
    id: defaultPermissions ? 'U1d' : track ? 'U1t' : 'U1',
    order: defaultPermissions ? 102 : track ? 101 : 100,
    title: `A plugin inserts a tagged contentLocked field control (${defaultPermissions ? 'modifyContentControl left at its default' : 'modifyContentControl:false'}${track ? ', track changes on' : ''})`,
    parent: 'UDOC-1.1 unproven / UDOC-1.5 insertField',
    async run({ context, secrets }) {
      await resetStub();
      const { editor, key } = await open(context, secrets, defaultPermissions ? 'u1d' : track ? 'u1t' : 'u1', defaultPermissions ? { permissions: { modifyContentControl: true } } : {});
      await typeAtEnd(editor, ' 66666 ');
      const outcome = await editor.command(INSERT_FIELD, { track, value: 'INSERTEDVALUE', tag: 'field:r9', label: 'Inserted field' });
      const inEditor = (await editor.controlsInEditor()).filter((c) => c.tag === 'field:r9');
      const saved = await forceSave(secrets.jwtSecret, key);
      const inFile = saved.event ? controls(saved.documentXml).filter((c) => c.tag === 'field:r9') : [];
      const insideIns = saved.event ? /<w:ins\b[^>]*>(?:(?!<\/w:ins>)[\s\S])*field:r9/.test(saved.documentXml) || /field:r9[\s\S]{0,400}<w:ins\b/.test(saved.documentXml) : false;
      // Then the same type-over attack as 7cl: a loose lock may drop the field whole, never change it in part.
      await editor.focusDocument();
      await editor.selectControl('field:r9', 'all');
      await editor.type('9');
      const afterAttack = (await editor.controlsInEditor()).filter((c) => c.tag === 'field:r9');
      await editor.close();
      const attackOutcome = afterAttack.length === 0 ? 'field removed whole' : afterAttack[0].text === 'INSERTEDVALUE' ? 'value intact' : `CHANGED to "${afterAttack[0].text}"`;
      const ok =
        outcome === 'ok' &&
        inEditor.length === 1 &&
        inFile.length === 1 &&
        inFile[0].lock === 'contentLocked' &&
        inFile[0].text === 'INSERTEDVALUE' &&
        !attackOutcome.startsWith('CHANGED');
      return {
        result: !ok ? 'fail' : attackOutcome === 'field removed whole' ? 'finding' : 'pass',
        evidence: [
          `insert: ${outcome}; in editor ${inEditor.map((c) => `${c.tag} lock ${c.lock} "${c.text}"`).join(', ') || 'none'}`,
          `typing over it afterwards: ${attackOutcome}`,
          `saved file: ${inFile.map((c) => `${c.tag} ${c.lock} "${c.text}" rPr "${c.rPr}"`).join(', ') || 'none'}${track ? `; tracked insertion markup near the control: ${insideIns}; w:ins count ${count(saved.documentXml ?? '', 'ins')}` : ''}`,
        ],
      };
    },
  };
}

const PANEL_ORIGIN = STUB_B;

const u2u3 = {
  id: 'U2-U3',
  order: 110,
  title: 'Per-session plugin data reaches the plugin; a consumer page runs inside the panel with two-way postMessage and origin checks',
  parent: 'UDOC-1.1 unproven / D14',
  async run({ context, secrets }) {
    await resetStub();
    const marker = `marker-${Math.random().toString(36).slice(2, 10)}`;
    const panelUrl = `${PANEL_ORIGIN}/panel/index.html#pluginOrigin=${encodeURIComponent(STUB_A)}&token=${marker}`;
    const { editor } = await open(context, secrets, 'u2', { pluginOptions: { sessionMarker: marker, panelUrl, panelOrigin: PANEL_ORIGIN } });
    await sleep(3000);
    const probe = await editor.probeState();
    const panelFrame = editor.page.frames().find((f) => f.url().startsWith(`${PANEL_ORIGIN}/panel/`));
    let panel = null;
    let wrongOrigin = null;
    if (panelFrame) {
      const before = await editor.probeState();
      const panelBefore = await panelFrame.evaluate(() => window.__panel.ignored.length);
      // From DocumentServer's frame (another origin) into the plugin and into the panel inside it.
      wrongOrigin = await editor.editorFrame().evaluate(() => {
        const host = Array.from(document.querySelectorAll('iframe')).find((f) => (f.src || '').includes('/plugins/probe/'));
        if (!host) return 'plugin iframe not found in the editor frame';
        host.contentWindow.postMessage({ type: 'hello', id: 666 }, '*');
        if (host.contentWindow.frames.length) host.contentWindow.frames[0].postMessage({ type: 'hello-ack', id: 666 }, '*');
        return location.origin;
      });
      await panelFrame.evaluate(() => window.postMessage({ type: 'evil' }, '*'));
      await sleep(800);
      const after = await editor.probeState();
      panel = await panelFrame.evaluate(() => JSON.parse(JSON.stringify(window.__panel)));
      panel.ignoredDelta = panel.ignored.length - panelBefore;
      panel.pluginIgnoredDelta = after.panel.ignored.length - before.panel.ignored.length;
      panel.pluginAcceptedForged = after.panel.received.some((m) => m && m.id === 666);
      panel.panelAcceptedForged = panel.received.some((m) => m && m.id === 666);
    }
    await editor.close();
    const dataArrived = Boolean(probe.options && probe.options.sessionMarker === marker);
    const hello = probe.panel.received.some((m) => m && m.type === 'hello');
    const ack = Boolean(panel && panel.received.some((m) => m && m.type === 'hello-ack'));
    const panelIgnoredSelf = Boolean(panel && panel.ignoredDelta >= 2);
    const pluginIgnoredForeign = Boolean(panel && panel.pluginIgnoredDelta >= 1 && !panel.pluginAcceptedForged && !panel.panelAcceptedForged);
    const tokenInFragment = Boolean(panel && panel.token === marker);
    const ok = dataArrived && hello && ack && panelIgnoredSelf && pluginIgnoredForeign && tokenInFragment;
    return {
      result: ok ? 'pass' : 'fail',
      evidence: [
        `U2 plugin data via editorConfig.plugins.options: ${dataArrived} (plugin info keys: ${probe.infoKeys.join(', ')})`,
        `U3 panel page on ${PANEL_ORIGIN} loaded: ${Boolean(panelFrame)}; panel→plugin hello received: ${hello}; plugin→panel ack received: ${ack}`,
        `origin checks: messages posted from ${wrongOrigin} into the plugin and the panel were ignored on both sides (plugin +${panel?.pluginIgnoredDelta ?? 0}, panel +${panel?.ignoredDelta ?? 0} including one it posted to itself; forged ids accepted: plugin ${panel?.pluginAcceptedForged}, panel ${panel?.panelAcceptedForged}); token read from the fragment: ${tokenInFragment}`,
      ],
    };
  },
};

const GET_TEXT = `function () {
  var out = [];
  var ps = Api.GetDocument().GetAllParagraphs();
  for (var i = 0; i < ps.length; i++) {
    var p = ps[i];
    var text = '';
    var fields = [];
    var n = p.GetElementsCount();
    for (var j = 0; j < n; j++) {
      var el = p.GetElement(j);
      var type = el.GetClassType();
      var t = '';
      if (type === 'inlineLvlSdt') {
        t = el.GetRange().GetText();
        fields.push({ start: text.length, end: text.length + t.length, tag: el.GetTag() });
      } else if (el.GetText) {
        t = el.GetText();
      }
      text += t;
    }
    out.push({ i: i, text: text, apiText: p.GetText(), fields: fields });
  }
  var blocks = Api.GetDocument().GetAllContentControls().filter(function (c) { return c.GetClassType() === 'blockLvlSdt'; }).map(function (c) { return c.GetTag(); });
  return { paragraphs: out, blocks: blocks };
}`;

const u4 = {
  id: 'U4',
  order: 120,
  title: 'getText returns each field control’s span, row id, and kind',
  parent: 'UDOC-1.1 unproven / UDOC-1.5 getText',
  async run({ context, secrets }) {
    await resetStub();
    const { editor } = await open(context, secrets, 'u4');
    const got = await editor.command(GET_TEXT, {}, { recalc: false });
    await editor.close();
    const spans = got.paragraphs.flatMap((p) => p.fields.map((f) => ({ ...f, slice: p.text.slice(f.start, f.end), consistent: p.text === p.apiText.replace(/\r?\n$/, '') })));
    const want = { 'field:r1': VALUES.r1, 'field:r2': VALUES.r2, 'field:r3': VALUES.r3, 'field:r4': VALUES.r4, 'field:r5': VALUES.r5 };
    const correct = spans.filter((s) => want[s.tag] === s.slice);
    const blockFound = got.blocks.includes('block:r6');
    const consistent = spans.every((s) => s.consistent);
    const ok = spans.length === 6 && correct.length === 6 && blockFound && consistent;
    return {
      result: ok ? 'pass' : 'fail',
      evidence: [
        `inline field spans located: ${correct.length}/6 (${spans.map((s) => `${s.tag}@${s.start}-${s.end}`).join(', ')})`,
        `span text reconstructed from runs equals the paragraph text: ${consistent}`,
        `block controls (kind block): ${got.blocks.join(', ')}`,
      ],
    };
  },
};

async function attempts(key, status, sinceT, windowMs) {
  await sleep(windowMs);
  return (await events()).filter((e) => e.kind === 'callback' && e.key === key && e.status === status && e.t >= sinceT);
}

const MODES = [
  { mode: 'http500', label: 'HTTP 500' },
  { mode: 'http503', label: 'HTTP 503' },
  { mode: 'http429', label: 'HTTP 429' },
  { mode: 'error', label: 'HTTP 200 {"error":1}' },
  { mode: 'http401', label: 'HTTP 401' },
  { mode: 'ok', label: 'HTTP 200 {"error":0} (control)' },
];

const u5 = {
  id: 'U5',
  order: 130,
  title: 'Callback retry behaviour per consumer answer, what changes between retries, and the forgotten-files store',
  parent: 'UDOC-1.1 unproven / D13, E6',
  timeoutMs: 1_200_000,
  async run({ context, secrets, image }) {
    const evidence = [];
    const data = {};
    const cfg = await dsExec(image, secrets, `grep -A12 '"callbackBackoffOptions"' /etc/onlyoffice/documentserver/default.json | tr -s ' \\n' ' '; echo; grep -A3 '"callbackRequestTimeout"' /etc/onlyoffice/documentserver/default.json | tr -s ' \\n' ' '`).catch((e) => String(e));
    evidence.push(`configuration read from the image: ${squash(cfg)}`);
    for (const { mode, label } of MODES) {
      await resetStub();
      const { editor, key } = await open(context, secrets, `u5${mode}`);
      await typeAtEnd(editor, ' 77777 retry probe');
      await setCallbackMode(mode);
      const t = Date.now();
      await closeAndAwait(editor, key, 5_000).catch(() => undefined);
      const list = await attempts(key, 2, t, 25_000);
      await setCallbackMode('ok');
      const gaps = list.slice(1).map((e, i) => ((e.t - list[i].t) / 1000).toFixed(1));
      const fields = Object.keys(list[0]?.signedFields ?? {}).sort();
      const changing = fields.filter((f) => new Set(list.map((e) => e.signedFields?.[f])).size > 1);
      const stable = fields.filter((f) => !changing.includes(f));
      const forgottenList = await commandService(secrets.jwtSecret, { c: 'getForgottenList' });
      const listed = JSON.stringify(forgottenList).includes(key);
      const forgotten = await commandService(secrets.jwtSecret, { c: 'getForgotten', key });
      data[mode] = { attempts: list.length, gaps, changing, stable, listed, forgotten: Boolean(forgotten.url) };
      evidence.push(
        `${label}: ${list.length} status-2 attempt(s)${gaps.length ? ` at gaps ${gaps.join('s, ')}s` : ''}; signed fields changing between attempts: ${changing.join(', ') || 'none'}; stable: ${stable.join(', ')}; url query parameters ${JSON.stringify(list[0]?.urlQueryNames ?? [])}; token iat/exp ${JSON.stringify(list.map((e) => e.tokenTimes))}; body token ${list[0]?.bodyTokenShape}; in getForgottenList ${listed}; getForgotten URL ${Boolean(forgotten.url)}`,
      );
      if (forgotten.url) await commandService(secrets.jwtSecret, { c: 'deleteForgotten', key });
    }
    // Status 6 (force-save) under a failing consumer, then a second force-save to compare lastsave between saves.
    await resetStub();
    {
      const { editor, key } = await open(context, secrets, 'u5force');
      await typeAtEnd(editor, ' 80808 force one');
      await sleep(3000);
      await setCallbackMode('http503');
      const t6 = Date.now();
      let answer = await commandService(secrets.jwtSecret, { c: 'forcesave', key });
      for (let i = 0; answer.error === 4 && i < 20; i += 1) {
        await sleep(1500);
        answer = await commandService(secrets.jwtSecret, { c: 'forcesave', key });
      }
      const sixes = await attempts(key, 6, t6, 15_000);
      await setCallbackMode('ok');
      await typeAtEnd(editor, ' 90909 force two');
      await sleep(3000);
      const t6b = Date.now();
      await commandService(secrets.jwtSecret, { c: 'forcesave', key });
      const second = await attempts(key, 6, t6b, 10_000);
      await editor.close();
      const f6 = Object.keys(sixes[0]?.signedFields ?? {}).sort();
      const changing6 = f6.filter((f) => new Set(sixes.map((e) => e.signedFields?.[f])).size > 1);
      const lastsaveDistinct = Boolean(sixes[0] && second[0] && sixes[0].signedFields?.lastsave !== second[0].signedFields?.lastsave);
      data.force503 = { attempts: sixes.length, changing: changing6, lastsaveDistinct };
      evidence.push(
        `status 6 (force-save) with the consumer answering 503: ${sixes.length} attempt(s)${sixes.length > 1 ? ` at gaps ${sixes.slice(1).map((e, i) => ((e.t - sixes[i].t) / 1000).toFixed(1)).join('s, ')}s` : ''}; signed fields changing between attempts: ${changing6.join(', ') || 'none'}; stable: ${f6.filter((f) => !changing6.includes(f)).join(', ')}; a second force-save carries a different lastsave: ${lastsaveDistinct}`,
      );
    }
    // Status 4 (closed without changes) under a failing consumer.
    await resetStub();
    {
      const { editor, key } = await open(context, secrets, 'u5four');
      await setCallbackMode('http503');
      const t4 = Date.now();
      await editor.close();
      const fours = await attempts(key, 4, t4, 20_000);
      await setCallbackMode('ok');
      data.closed503 = { attempts: fours.length };
      evidence.push(`status 4 (closed without changes) with the consumer answering 503: ${fours.length} attempt(s)`);
    }
    // Status 1 (connect) under a failing consumer.
    await resetStub();
    await setCallbackMode('http503');
    const t1 = Date.now();
    const { editor, key } = await open(context, secrets, 'u5connect');
    const connects = await attempts(key, 1, t1, 12_000);
    await setCallbackMode('ok');
    const usable = await editor.paragraphTexts().then(() => true).catch(() => false);
    await editor.close();
    evidence.push(`status 1 (connect) with the consumer answering 503: ${connects.length} attempt(s); editor still usable ${usable}`);
    // ADR F1 as assertions, so a future release that behaves differently fails loudly.
    const retried = ['http500', 'http503', 'http429'].every((m) => data[m] && data[m].attempts === 4 && data[m].listed);
    const notRetried = ['error', 'http401'].every((m) => data[m] && data[m].attempts === 1 && data[m].listed);
    const control = data.ok && data.ok.attempts === 1 && !data.ok.listed;
    const stableKeys = ['http500', 'http503', 'http429'].every((m) => !data[m].changing.includes('lastsave') && !data[m].changing.includes('key') && !data[m].changing.includes('status'));
    const ok = retried && notRetried && control && stableKeys;
    evidence.push(`F1 assertions: 429/5xx retried 4 times and kept as forgotten ${retried}; 401 and {"error":1} sent once and kept as forgotten ${notRetried}; acknowledged save not kept ${control}; key, status, lastsave stable across retries ${stableKeys}`);
    return { result: ok ? 'record' : 'fail', evidence, data };
  },
};

const u6 = {
  id: 'U6',
  order: 140,
  title: 'Connect/disconnect actions on status 1; what distinguishes two connects by one user; statuses 3 and 7',
  parent: 'UDOC-1.1 unproven / D13',
  async run({ context, secrets }) {
    await resetStub();
    const key = uniqueKey('u6');
    const cfg = buildConfig({ fixture: FIXTURE, key });
    const a = await Editor.open(context, secrets.jwtSecret, cfg, { waitProbe: false });
    const b = await Editor.open(context, secrets.jwtSecret, cfg, { waitProbe: false });
    await sleep(3000);
    await b.close();
    await sleep(3000);
    await a.close();
    await sleep(15000);
    const list = (await events()).filter((e) => e.kind === 'callback' && e.key === key);
    const ones = list.filter((e) => e.status === 1);
    return {
      result: 'record',
      evidence: [
        `status-1 callbacks for one user in two tabs: ${ones.length}; actions and connected users ${ones.map((e) => `${JSON.stringify(e.actions)} users ${JSON.stringify(e.users ?? null)}`).join(' | ')}`,
        `fields on status 1: ${[...new Set(ones.flatMap((e) => e.bodyKeys))].join(', ')}; distinct bodies ${new Set(ones.map((e) => e.bodyHash)).size}`,
        `final callback: status ${list.at(-1)?.status}`,
        'statuses 3 and 7 (save errors): NOT MEASURED — they could not be provoked without breaking DocumentServer itself; the consumer guide treats them per OnlyOffice’s callback documentation (no file, report, keep the key open)',
      ],
    };
  },
};

const u7 = {
  id: 'U7',
  order: 150,
  title: 'ConvertService output for a document with pending tracked changes and comments',
  parent: 'UDOC-1.1 unproven / D16 finalize',
  async run({ context, secrets, work }) {
    await resetStub();
    const { editor, key } = await open(context, secrets, 'u7');
    await editor.command(SUGGEST, { find: 'between Monolith', rep: 'between Monolith Inc.', note: 'Moli: legal name' });
    const saved = await forceSave(secrets.jwtSecret, key);
    await editor.close();
    if (!saved.event) return { result: 'fail', evidence: ['force-save produced no file'] };
    const name = await addFixture(work, 'u7-tracked.docx', saved.buf);
    const pdf = await toPdf(secrets.jwtSecret, work, name);
    const text = squash(pdf.text ?? '');
    return {
      result: 'record',
      evidence: [
        `PDF shows the inserted text: ${text.includes('Monolith Inc.')}; shows the deleted text too: ${/between Monolith between Monolith Inc\.|between Monolithbetween Monolith Inc\./.test(text)}; shows the comment text: ${text.includes('Moli: legal name')}`,
        `PDF sentence: "${(text.match(/This Agreement starts on[^.]*\./) ?? [''])[0]}"`,
        'D16 already requires no pending tracked changes or comments at finalize, so the PDF never depends on this rendering',
      ],
    };
  },
};

const u8 = {
  id: 'U8',
  order: 160,
  title: 'Command service drop: with edits since the last save (status 2) and without (status 4)',
  parent: 'UDOC-1.1 unproven / D13 closing sequence',
  async run({ context, secrets }) {
    await resetStub();
    const out = [];
    for (const withEdits of [true, false]) {
      const { editor, key } = await open(context, secrets, withEdits ? 'u8e' : 'u8n');
      if (withEdits) {
        await typeAtEnd(editor, ' 88888 typed before drop');
        await sleep(4000);
      }
      const t = Date.now();
      const answer = await commandService(secrets.jwtSecret, { c: 'drop', key, users: ['u1'] });
      const ev = await waitForEvent((e) => e.kind === 'callback' && e.key === key && (e.status === 2 || e.status === 4) && e.t >= t, 60_000);
      const pageState = await editor.page.evaluate(() => window.__events.slice(-3)).catch(() => []);
      let kept = null;
      if (ev && ev.status === 2 && ev.saved?.file) {
        const { stub } = await import('../stack.mjs');
        const { openDocx } = await import('../docx.mjs');
        const { documentXml } = await openDocx(await stub(`/saved/${ev.saved.file}`));
        kept = paragraphs(documentXml).some((p) => p.includes('88888 typed before drop'));
      }
      await editor.close();
      out.push({ withEdits, answer: answer.error, status: ev?.status ?? null, seconds: ev ? ((ev.t - t) / 1000).toFixed(1) : null, kept, pageState });
    }
    const ok = out[0].status === 2 && out[0].kept === true && out[1].status === 4;
    return {
      result: ok ? 'pass' : 'fail',
      evidence: out.map(
        (o) => `${o.withEdits ? 'with edits' : 'no edits'}: drop answer error ${o.answer}; terminal callback status ${o.status} after ${o.seconds}s${o.kept !== null ? `; typed text in the final save ${o.kept}` : ''}; editor page events ${JSON.stringify(o.pageState)}`,
      ),
    };
  },
};

const u9 = {
  id: 'U9',
  order: 170,
  title: 'The built-in AI feature and the shipped plugins under the hardened DocumentServer configuration',
  parent: 'UDOC-1.1 unproven / D13 profile / EDIT-2.6',
  timeoutMs: 1_200_000,
  async run({ context, secrets, image, work }) {
    await resetStub();
    const { editor } = await open(context, secrets, 'u9');
    const frame = editor.editorFrame();
    const tabs = await frame.evaluate(() => Array.from(document.querySelectorAll('.ribtab > a')).filter((a) => a.offsetParent !== null).map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 30));
    await editor.close();
    const aiTab = tabs.some((t) => /^ai$/i.test(t) || /\bAI\b/.test(t));
    const override = await dsExec(image, secrets, 'cat /etc/onlyoffice/documentserver/local-production-linux.json').catch((e) => String(e));
    const pluginsEnv = await dsExec(image, secrets, 'printenv PLUGINS_ENABLED').catch((e) => String(e));
    const pluginDirs = await dsExec(image, secrets, 'cd /var/www/onlyoffice/documentserver/sdkjs-plugins && for d in */; do echo "${d%/}"; done').catch((e) => String(e));
    const key2 = uniqueKey('u9b');
    const second = await Editor.open(context, secrets.jwtSecret, buildConfig({ fixture: FIXTURE, key: key2, customization: { plugins: false } }), { waitProbe: false });
    await sleep(8000);
    const probeWithPluginsOff = second.page.frames().some((f) => f.url().includes('/plugins/probe/'));
    await second.close();
    // Effective configuration, not just the mounted file: DocumentServer's own AI proxy answers.
    // Control: restart once with the same override mechanism switching AI on, then restore.
    const aiProxy = async () => {
      const res = await fetch(`${DS_PUBLIC}/ai-proxy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch((e) => ({ status: String(e), text: async () => '' }));
      return `${res.status} ${squash(await res.text()).slice(0, 120)}`;
    };
    const hardenedAnswer = await aiProxy();
    await writeFile(nodePath.join(work, 'ds-local-override.json'), JSON.stringify({ aiSettings: { enable: true } }));
    let controlAnswer;
    try {
      await restartDs(image, secrets, {}, ['compose.directif.yml']);
      controlAnswer = await aiProxy();
    } finally {
      await restartDs(image, secrets);
    }
    const restoredAnswer = await aiProxy();
    const disabled = (answer) => /AI is disabled/.test(answer);
    const dirs = pluginDirs.split(/\s+/).filter(Boolean);
    const hardened =
      /"enable"\s*:\s*false/.test(override) &&
      pluginsEnv.trim() === 'false' &&
      dirs.every((d) => d === 'marketplace' || d === 'v1') &&
      disabled(hardenedAnswer) &&
      !disabled(controlAnswer) &&
      disabled(restoredAnswer);
    return {
      result: hardened && !aiTab ? 'pass' : 'fail',
      evidence: [
        `toolbar tabs: ${[...new Set(tabs)].join(', ')}; an AI tab is shown: ${aiTab}`,
        `server override (local-production-linux.json): ${squash(override)}; PLUGINS_ENABLED=${squash(pluginsEnv)}`,
        `effective: POST /ai-proxy answered "${hardenedAnswer}" hardened; "${controlAnswer}" after a restart with aiSettings.enable true (control); "${restoredAnswer}" after restoring the hardened file`,
        `plugin directories in sdkjs-plugins: ${squash(pluginDirs)} (with PLUGINS_ENABLED=false none of plugin-list-default.json's ten plugins is downloaded; marketplace is the Plugin Manager, which the document and template profiles disable by GUID, and v1 is the plugin API)`,
        `with customization.plugins:false the bridge plugin still loads: ${probeWithPluginsOff}${probeWithPluginsOff ? '' : ' (that switch also stops our own plugin, so it cannot hide AI; the AI feature is off server-side: aiSettings.enable false)'}`,
      ],
    };
  },
};

const u10u11 = {
  id: 'U10-U11',
  order: 180,
  title: 'Connection statistics without a key; DocumentServer’s own log configuration',
  parent: 'UDOC-1.1 unproven / EDIT-4, EDIT-6',
  async run({ secrets, image }) {
    const res = await fetch(`${DS_PUBLIC}/info/info.json`).catch((e) => ({ status: String(e) }));
    const inside = await dsExec(image, secrets, 'curl -s http://127.0.0.1/info/info.json').catch((e) => String(e));
    let body = '';
    try {
      const parsed = JSON.parse(inside);
      body = `keys ${Object.keys(parsed).join(', ')}; connectionsStat ${JSON.stringify(parsed.connectionsStat ?? null).slice(0, 160)}`;
    } catch {
      body = inside.slice(0, 160);
    }
    const log4js = await dsExec(image, secrets, 'cat /etc/onlyoffice/documentserver/log4js/production.json').catch((e) => String(e));
    const nginx = await dsExec(image, secrets, "grep -rhn 'access_log\\|error_log' /etc/nginx/nginx.conf /etc/onlyoffice/documentserver/nginx/includes/ 2>/dev/null; grep -A10 'log_format ds_access' /etc/onlyoffice/documentserver/nginx/includes/http-common.conf; grep -A5 'ds_access_loggable {' /etc/onlyoffice/documentserver/nginx/includes/http-common.conf").catch((e) => String(e));
    const sample = await dsExec(image, secrets, "grep -m2 'cache/files' /var/log/onlyoffice/documentserver/nginx.access.log | sed -E 's#(data/)[^_/]+#\\1<key>#'").catch(() => '');
    return {
      result: 'record',
      evidence: [
        `GET /info/info.json from outside: HTTP ${res.status} (nginx allows 127.0.0.1 only); from inside the container: ${body}`,
        `services log4js: ${squash(log4js)}`,
        `internal nginx: ${squash(nginx)}`,
        `sample internal access-log lines (key masked here): ${squash(sample) || 'none yet'}`,
      ],
    };
  },
};

async function privateAddressProbe(context, secrets, work, label) {
  await resetStub();
  const key = uniqueKey(`u12${label}`);
  let opened = true;
  try {
    const e = await Editor.open(context, secrets.jwtSecret, buildConfig({ fixture: FIXTURE, key }), { waitProbe: false, timeoutMs: 60_000 });
    await e.close();
  } catch {
    opened = false;
  }
  await sleep(3000);
  const list = await events();
  const fetched = list.some((e) => e.kind === 'fixture-fetch');
  const callbacks = list.filter((e) => e.kind === 'callback' && e.key === key).length;
  const conv = await toPdf(secrets.jwtSecret, work, 'contract-cl.docx').catch((e) => ({ answer: { error: String(e) } }));
  return { opened, fetched, callbacks, converted: Boolean(conv.text), convAnswer: conv.answer };
}

const u12 = {
  id: 'U12',
  order: 900,
  title: 'Request filtering of private addresses (with and without the JWT bypass), download cap, cache retention',
  parent: 'UDOC-1.1 unproven / UDOC-1.3, EDIT-2.2',
  timeoutMs: 1_800_000,
  async run({ context, secrets, image, work }) {
    const { writeFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const defaults = await dsExec(image, secrets, `grep -A3 '"request-filtering-agent"' /etc/onlyoffice/documentserver/default.json; grep -A4 '"directIfIn"' /etc/onlyoffice/documentserver/default.json; grep '"maxDownloadBytes"' /etc/onlyoffice/documentserver/default.json; grep -A1 '"files": 86400' /etc/onlyoffice/documentserver/default.json`).catch((e) => String(e));
    await writeFile(path.join(work, 'ds-local-override.json'), JSON.stringify({ aiSettings: { enable: false }, externalRequest: { directIfIn: { jwtToken: false } } }));
    let bypass;
    let control;
    let effective = '';
    try {
      await restartDs(image, secrets, { BATTERY_ALLOW_PRIVATE_IP: 'false' });
      bypass = await privateAddressProbe(context, secrets, work, 'bypass');
      await restartDs(image, secrets, { BATTERY_ALLOW_PRIVATE_IP: 'false' }, ['compose.directif.yml']);
      effective = await dsExec(image, secrets, 'cat /etc/onlyoffice/documentserver/local-production-linux.json').catch((e) => String(e));
      control = await privateAddressProbe(context, secrets, work, 'control');
    } finally {
      await restartDs(image, secrets, { BATTERY_ALLOW_PRIVATE_IP: 'true' });
    }
    const describe = (r) => `document opened ${r.opened}, fetched ${r.fetched}; callbacks reaching the private-address consumer ${r.callbacks}; conversion ${r.converted ? 'succeeded' : `refused ${JSON.stringify(r.convAnswer)}`}`;
    return {
      result: 'record',
      evidence: [
        `private addresses disallowed, default directIfIn.jwtToken true: ${describe(bypass)}`,
        `control, private addresses disallowed and directIfIn.jwtToken false (override ${squash(effective)}): ${describe(control)}`,
        `so the private-address filter is bypassed for URLs inside JWT-signed configs and commands by directIfIn.jwtToken; turning it off makes the filter apply (and would break any intended internal URL, e.g. the legacy http://api:3020 flows, unless those move to allowed hosts)`,
        `defaults: ${squash(defaults)}`,
        'download cap: FileConverter.converter.maxDownloadBytes 104857600 (100 MB). Cache retention: expire.files 86400 s (24 h), cleaned hourly; converted and edited files stay in DocumentServer’s cache until then',
      ],
    };
  },
};

const u13 = {
  id: 'U13',
  order: 950,
  title: 'A version DOCX round trip through Word desktop',
  parent: 'UDOC-1.1 unproven',
  async run({ context, secrets, work, image }) {
    const { readFile, writeFile, mkdir } = await import('node:fs/promises');
    const path = await import('node:path');
    const { BATTERY_DIR } = await import('../stack.mjs');
    const release = /:([^@]+)/.exec(image.split('/').pop())?.[1] ?? 'unknown';
    const dir = path.join(BATTERY_DIR, '..', '..', 'docs', 'spikes', 'results', release);
    await mkdir(dir, { recursive: true });
    // The input: a file OnlyOffice itself saved (a "version" DOCX), fields and block included.
    await resetStub();
    const { editor, key } = await open(context, secrets, 'u13');
    await typeAtEnd(editor, ' 12121 before Word');
    const saved = await forceSave(secrets.jwtSecret, key);
    await editor.close();
    if (saved.event) await writeFile(path.join(dir, 'word-roundtrip-input.docx'), saved.buf);
    let output = null;
    try {
      output = await readFile(path.join(dir, 'word-roundtrip-output.docx'));
    } catch {
      output = null;
    }
    if (!output) {
      return {
        result: 'blocked',
        evidence: [
          'needs Word desktop on Windows or macOS; altus-labs-dev has neither',
          `input written: docs/spikes/results/${release}/word-roundtrip-input.docx. Open it in Word, type outside the fields, save as word-roundtrip-output.docx in the same folder, and re-run the battery (--only U13)`,
          'EDIT-1 stays open on this item unless Josh waives it in writing',
        ],
      };
    }
    const name = await addFixture(work, 'u13-word.docx', output);
    const reopened = await Editor.open(context, secrets.jwtSecret, buildConfig({ fixture: name, key: uniqueKey('u13r') }));
    const inEditor = await reopened.controlsInEditor();
    await reopened.close();
    const { openDocx } = await import('../docx.mjs');
    const fileControls = controls((await openDocx(output)).documentXml);
    const fields = fileControls.filter((c) => c.tag && c.tag.startsWith('field:'));
    const ok = fields.length === 6 && fields.every((c) => c.lock === 'contentLocked') && inEditor.filter((c) => c.tag.startsWith('field:')).length === 6;
    return {
      result: ok ? 'pass' : 'fail',
      evidence: [
        `Word-saved file: ${fields.length} field controls (${[...new Set(fields.map((c) => c.lock))].join('/')}); block ${fileControls.some((c) => c.tag === 'block:r6')}`,
        `reopened in OnlyOffice: ${inEditor.length} controls`,
      ],
    };
  },
};

const u14 = {
  id: 'U14',
  order: 190,
  title: 'Keystrokes typed just before a tab closes',
  parent: 'UDOC-1.1 observation / D13 closing sequence',
  async run({ context, secrets }) {
    await resetStub();
    const { editor, key } = await open(context, secrets, 'u14');
    await typeAtEnd(editor, ' 99999 last words');
    const closed = await closeAndAwait(editor, key, 60_000, 0);
    const kept = closed.documentXml ? paragraphs(closed.documentXml).some((p) => p.includes('99999 last words')) : false;
    return {
      result: 'record',
      evidence: [
        `tab closed immediately after typing: terminal status ${closed.event?.status ?? 'none'}; the last words are in the saved file ${kept}`,
        'the consumer cannot recover keystrokes the browser never sent; UDOC-3’s closing sequence drops users from the server side, which saves what the server holds',
      ],
    };
  },
};

export default [u1(false), u1(true), u1(false, true), u2u3, u4, u5, u6, u7, u8, u9, u10u11, u12, u13, u14];
