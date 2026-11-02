// EDIT-6.7: the hosted acceptance run, through the public hosts, against the acceptance stub
// consumer (infrastructure/vps/acceptance-stub/). Not a battery item: it needs the hosted stack.
//
//   node src/hosted-acceptance.mjs
//
// The launch key is read from 1Password by this process (`op item get`) and is never printed or
// passed on a command line; everything printed goes through `redact` (hosted-acceptance-check.mjs,
// with the pass rule). Prints facts only.
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { acceptanceFailures, redact } from './hosted-acceptance-check.mjs';

const STUB = 'https://editor-stub-dev.monolith.cx';
const EDITOR = 'https://editor-dev.monolith.cx';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = execFileSync('op', ['item', 'get', 'Monolith Docs Editor — dev', '--vault', 'Dev', '--fields', 'label=EDITOR_STUB_LAUNCH_KEY', '--reveal'], { encoding: 'utf8' }).trim();

const safe = (text) => redact(text, key);

async function results() {
  const res = await fetch(`${STUB}/results?k=${encodeURIComponent(key)}`);
  return res.json();
}

function watchCsp(page, into) {
  page.on('console', (msg) => {
    if (/Content Security Policy|frame-ancestors/i.test(msg.text())) into.push(safe(msg.text()).slice(0, 200));
  });
}

async function run() {
  const evidence = {};
  let marker = null;
  // 0. TLS and HSTS on both public hosts.
  for (const [name, origin] of [['editor', EDITOR], ['stub', STUB]]) {
    const res = await fetch(`${origin}/health`);
    evidence[`${name}Hsts`] = { status: res.status, hsts: res.headers.get('strict-transport-security') };
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  try {
    // 1. The editor framed by its consumer, with the panel.
    const page = await context.newPage();
    const csp = [];
    watchCsp(page, csp);
    await page.goto(`${STUB}/launch?k=${encodeURIComponent(key)}`, { waitUntil: 'domcontentloaded' });
    const editorSrc = await page.locator('#editor').getAttribute('src');
    evidence.framedByStub = Boolean(editorSrc?.startsWith(`${EDITOR}/editor/`));
    const docKey = await page.locator('#editor').getAttribute('data-key');
    const editorFrame = page.frameLocator('#editor').locator('iframe[name="frameEditor"]');
    await editorFrame.waitFor({ timeout: 90_000 });
    let drawn = false;
    let panel = null;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline && (!drawn || !panel?.ready)) {
      const ds = page.frames().find((f) => f.name() === 'frameEditor');
      drawn = ds ? await ds.evaluate(() => Boolean(document.querySelector('#editor_sdk canvas'))).catch(() => false) : false;
      const panelFrame = page.frames().find((f) => f.url().startsWith(`${STUB}/panel/bridge.html`));
      panel = panelFrame ? await panelFrame.evaluate(() => ({ ready: Boolean(window.__panel?.ready), operations: window.__panel?.ready?.operations ?? [] })).catch(() => null) : null;
      await sleep(1000);
    }
    evidence.documentDrawn = drawn;
    evidence.panelReady = panel?.ready ?? false;
    evidence.panelOperations = panel?.operations ?? [];

    // 2. Edit, then close: DocumentServer sends the final save (status 2) only after a change.
    const box = await editorFrame.boundingBox();
    if (!box) throw new Error('the editor frame has no box to click into');
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5);
    await page.keyboard.press('Control+End');
    marker = `EDIT-6.7 acceptance ${new Date().toISOString()}`;
    evidence.typedMarker = marker;
    await page.keyboard.type(marker, { delay: 30 });
    await sleep(6000);
    evidence.cspViolations = csp.length;
    evidence.cspSamples = csp.slice(0, 3);
    await page.close();

    let saved = null;
    const saveDeadline = Date.now() + 90_000;
    while (Date.now() < saveDeadline && !saved) {
      saved = (await results()).results.find((x) => x.key === docKey && x.status === 2) ?? null;
      if (!saved) await sleep(3000);
    }
    evidence.finalSave = saved;
    evidence.sessionNotifications = (await results()).results.filter((x) => x.key === docKey).map((x) => ({ status: x.status, valid: x.valid, reason: x.reason }));

    // 3. Framed from any other origin: refused by frame-ancestors.
    const second = await context.newPage();
    await second.goto(`${STUB}/launch?k=${encodeURIComponent(key)}`, { waitUntil: 'domcontentloaded' });
    const secondSrc = await second.locator('#editor').getAttribute('src');
    await second.close();
    const other = await context.newPage();
    const refusals = [];
    watchCsp(other, refusals);
    await other.route('https://not-a-consumer.example/frame', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: `<!DOCTYPE html><iframe src="${secondSrc}" style="width:100%;height:600px;border:0"></iframe>` }),
    );
    await other.goto('https://not-a-consumer.example/frame', { waitUntil: 'domcontentloaded' });
    const foreignDeadline = Date.now() + 20_000;
    while (Date.now() < foreignDeadline && refusals.length === 0) await sleep(500);
    await sleep(2000);
    evidence.foreignFrame = { editorLoaded: other.frames().some((f) => f.name() === 'frameEditor'), refused: refusals.length > 0, sample: refusals[0] ?? null };
    await other.close();
  } finally {
    await browser.close();
  }

  const failures = acceptanceFailures(evidence, EDITOR, marker);
  return { result: failures.length ? 'fail' : 'pass', failures, ...evidence };
}

try {
  const outcome = await run();
  process.stdout.write(`${safe(JSON.stringify(outcome, null, 1))}\n`);
  process.exitCode = outcome.result === 'pass' ? 0 : 1;
} catch (err) {
  process.stderr.write(`hosted acceptance error: ${safe(err instanceof Error ? err.message : err)}\n`);
  process.exitCode = 2;
}
