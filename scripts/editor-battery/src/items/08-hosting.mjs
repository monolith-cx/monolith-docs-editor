// EDIT-6 (parent UDOC-1.6): what the hosted editor depends on, proven on the pinned release before
// anything is deployed. E6a: DocumentServer's settings as the VPS runs them (private addresses
// refused, directIfIn limited to the service's internal origin) still carry every service flow.
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { convert as dsConvert } from '../editor.mjs';
import { squash, uniqueKey } from '../flow.mjs';
import { BATTERY_DIR, COMPOSE_COMMAND, STUB_INTERNAL, composeEnv, dsExec, events, resetStub, restartDs, restartDsInPlace, serviceExec, sleep, waitForEvent } from '../stack.mjs';
import service, { documentBody, openServicePage, openViaApi, savedText, typeAtDocumentEnd } from './05-service.mjs';
import convert, { convertViaApi } from './06-convert.mjs';
import bridge, { bridgeBody } from './07-bridge.mjs';
import { privateAddressProbe } from './40-unproven.mjs';

const item = (list, id) => {
  const found = list.find((i) => i.id === id);
  if (!found) throw new Error(`no battery item ${id}`);
  return found;
};

const e6a = {
  id: 'E6a',
  order: 18,
  title: "DocumentServer as the VPS runs it (private addresses refused, directIfIn limited to the service's internal origin): the service's flows still work, a signed private URL does not",
  parent: 'EDIT-6.2 / UDOC-1.6 (ADR F3)',
  timeoutMs: 1_500_000,
  async run(ctx) {
    const { image, secrets, context, work } = ctx;
    const reused = [item(service, 'S1'), item(service, 'S2'), item(convert, 'E3a'), item(bridge, 'E5b')];
    const evidence = [];
    let ok = true;
    let direct = null;
    try {
      await restartDs(image, secrets, { BATTERY_ALLOW_PRIVATE_IP: 'false' });
      const settings = await dsExec(image, secrets, 'cat /etc/onlyoffice/documentserver/local-production-linux.json').catch((e) => String(e));
      // The entrypoint writes allowPrivateIPAddress into local.json only when it is admitted; otherwise
      // default.json's false stands. Read both, and the environment the container got.
      const filter = await dsExec(image, secrets, "printf 'env=%s local=' \"$ALLOW_PRIVATE_IP_ADDRESS\"; grep -o '\"allowPrivateIPAddress\": *[a-z]*' /etc/onlyoffice/documentserver/local.json || printf 'unset'").catch((e) => String(e));
      const settled = /"jwtToken"\s*:\s*false/.test(settings) && settings.includes('http://editor-api:3020/') && filter.startsWith('env=false') && !/allowPrivateIPAddress": *true/.test(filter);
      ok = ok && settled;
      evidence.push(`DocumentServer settings: ${squash(settings)}; generated filter: ${squash(filter)}; as the VPS runs it ${settled}`);
      for (const r of reused) {
        const outcome = await r.run(ctx);
        ok = ok && outcome.result === 'pass';
        evidence.push(`${r.id} under these settings: ${outcome.result.toUpperCase()} (${squash((outcome.evidence ?? []).join(' | ')).slice(0, 400)})`);
      }
      direct = await privateAddressProbe(context, secrets, work, 'e6a');
      const refused = !direct.fetched && direct.callbacks === 0 && !direct.converted;
      ok = ok && refused;
      evidence.push(
        `a JWT-signed config and conversion naming the stub's private address directly: document fetched ${direct.fetched}, callbacks ${direct.callbacks}, conversion ${direct.converted ? 'succeeded' : `refused ${JSON.stringify(direct.convAnswer)}`}: refused ${refused}`,
      );
    } finally {
      await restartDs(image, secrets, { BATTERY_ALLOW_PRIVATE_IP: 'true' });
    }
    return { result: ok ? 'pass' : 'fail', evidence };
  },
};

/** The API's converter probe, called as the watchdog calls it: inside the API container, on loopback. */
async function probe(image, secrets) {
  const out = await serviceExec(
    image,
    secrets,
    'api',
    `node -e "fetch('http://127.0.0.1:3020/health/converter',{signal:AbortSignal.timeout(30000)}).then(async (r)=>process.stdout.write(r.status+' '+(await r.text())),()=>process.stdout.write('none'))"`,
  ).catch((e) => `error ${String(e).slice(0, 120)}`);
  return { status: Number(out.split(' ')[0]) || 0, text: out };
}

/**
 * Runs the VPS watchdog script against this stack. Resolves with its exit code, what it printed (its
 * alerts, which cron mails), and the lines it added to its log.
 */
async function watchdog(image, secrets, stateDir, drainMinutes = 0) {
  const logFile = path.join(stateDir, 'watch.log');
  const before = await readFile(logFile, 'utf8').catch(() => '');
  const script = path.join(BATTERY_DIR, '..', '..', 'infrastructure', 'vps', 'editor-converter-watch.sh');
  const env = {
    ...composeEnv(image, secrets),
    WATCH_COMPOSE: COMPOSE_COMMAND,
    WATCH_API_SERVICE: 'api',
    WATCH_DS_SERVICE: 'ds',
    WATCH_STATE_DIR: stateDir,
    WATCH_LOG: logFile,
    WATCH_FAILURES: '2',
    WATCH_DRAIN_MINUTES: String(drainMinutes),
    WATCH_READY_SECONDS: '600',
  };
  const run = await new Promise((resolve) => {
    execFile('bash', [script], { env, timeout: 900_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, printed: squash(`${stdout} ${stderr}`) });
    });
  });
  const after = await readFile(logFile, 'utf8').catch(() => '');
  return { ...run, out: squash(after.slice(before.length)) };
}

const e6b = {
  id: 'E6b',
  order: 19,
  title: 'The converter watchdog: with both converter slots wedged the probe fails; after two failures the watchdog waits while an editor is open, restarts DocumentServer once none is, and the probe passes again; the probe answers only loopback',
  parent: 'EDIT-6.3 / UDOC-1.6 (ADR F17, F15)',
  timeoutMs: 1_800_000,
  async run({ image, secrets, work, context }) {
    const evidence = [];
    const stateDir = path.join(work, 'watch-state');
    await rm(stateDir, { recursive: true, force: true });
    await mkdir(stateDir, { recursive: true });
    const before = await probe(image, secrets);
    // From the host, through the published port: the API sees Docker's gateway, not loopback.
    const outside = await fetch('http://127.0.0.1:18204/health/converter').then((r) => r.status, (e) => String(e));
    const sample = await fetch('http://127.0.0.1:18204/health/converter-sample.docx').then(async (r) => `${r.status} ${(await r.arrayBuffer()).byteLength} bytes`, (e) => String(e));
    // An editor open before the converter wedges (a wedged converter also blocks opens, F17): the
    // watchdog must wait for it rather than drop it, so DocumentServer's live count has to reach it.
    const opened = await openViaApi(secrets, bridgeBody());
    const page = opened.status === 200 ? await openServicePage(context, opened.body.editorUrl).then((r) => r.page, () => null) : null;
    // ADR F17's recipe, once per converter slot: a source that sends 19 bytes and drops, straight to DocumentServer.
    const slots = Number((/"maxprocesscount"\s*:\s*(\d+)/.exec(await dsExec(image, secrets, 'cat /etc/onlyoffice/documentserver/local-production-linux.json').catch(() => '')) ?? [])[1] ?? 1);
    for (let i = 0; i < slots; i += 1) {
      void dsConvert(secrets.jwtSecret, { async: true, filetype: 'docx', outputtype: 'pdf', key: uniqueKey('wedge'), title: 'cut.docx', url: `${STUB_INTERNAL}/sources/cut.docx` }).catch(() => undefined);
    }
    await sleep(8000);
    const wedged = await probe(image, secrets);
    const first = await watchdog(image, secrets, stateDir, 15);
    const waiting = await watchdog(image, secrets, stateDir, 15);
    if (page) await page.close().catch(() => undefined);
    await sleep(10_000);
    const second = await watchdog(image, secrets, stateDir, 15);
    const after = await probe(image, secrets);
    const ok =
      before.status === 200 &&
      page !== null &&
      outside === 404 &&
      sample.startsWith('200') &&
      wedged.status === 503 &&
      first.code === 1 &&
      /failed \(1 of 2/.test(first.out) &&
      first.printed === '' &&
      waiting.code === 1 &&
      /waiting for open editors to close \(open: [1-9]/.test(waiting.out) &&
      /waiting for open editors/.test(waiting.printed) &&
      second.code === 4 &&
      /restarting ds \(open editors: 0/.test(second.out) &&
      /converter probe ok/.test(second.out) &&
      /restarting ds/.test(second.printed) &&
      /converter probe ok/.test(second.printed) &&
      after.status === 200;
    evidence.push(
      `probe before: ${before.text}; from the host through the published port: ${outside} (loopback only); the sample: ${sample}`,
      `wedged ${slots} converter slot(s) with ADR F17's dropped source; probe then: ${wedged.text}`,
      `watchdog run 1: exit ${first.code}: ${first.out.slice(0, 300)} (printed for cron's mail: ${first.printed ? 'something' : 'nothing'})`,
      `watchdog run 2, with the editor still open (open ${opened.status}, page ${page ? 'loaded' : 'did not load'}): exit ${waiting.code}: ${waiting.out.slice(0, 300)} (printed: ${waiting.printed ? 'the alert' : 'nothing'})`,
      `watchdog run 3, after it closed: exit ${second.code}: ${second.out.slice(0, 400)} (printed: ${second.printed ? 'the alerts' : 'nothing'})`,
      `probe after: ${after.text}`,
    );
    return { result: ok ? 'pass' : 'fail', evidence };
  },
};

/** Memory of the stack's containers, in MiB, from `docker stats` (one sample). */
async function memory() {
  const out = await new Promise((resolve) => {
    execFile('docker', ['stats', '--no-stream', '--format', '{{.Name}}\t{{.MemUsage}}'], { timeout: 60_000 }, (err, stdout) => resolve(err ? '' : stdout));
  });
  const unit = { B: 1 / 1048576, KiB: 1 / 1024, MiB: 1, GiB: 1024 };
  const of = (name) => {
    const line = out.split('\n').find((l) => l.startsWith(`editor-battery-${name}-`));
    const m = line && /\t([\d.]+)(B|KiB|MiB|GiB)/.exec(line);
    return m ? Math.round(Number(m[1]) * unit[m[2]]) : null;
  };
  return { ds: of('ds'), api: of('api') };
}

const e6c = {
  id: 'E6c',
  order: 20,
  title: "Capacity on the pinned release: DocumentServer's and the API's memory idle, with 1, 3, and 6 editors open, and during conversions; the connection statistics and limits it reports",
  parent: 'EDIT-6.4 / UDOC-1.6',
  timeoutMs: 1_200_000,
  async run({ image, secrets, context }) {
    const evidence = [];
    const pages = [];
    const samples = [];
    const sample = async (label) => {
      await sleep(5000);
      const m = await memory();
      samples.push({ label, ...m });
      return m;
    };
    let info = '';
    try {
      await sample('idle');
      for (const target of [1, 3, 6]) {
        while (pages.length < target) {
          // A document session as consumers open it: with the bridge plugin hosting the stub panel.
          const opened = await openViaApi(secrets, bridgeBody());
          if (opened.status !== 200) throw new Error(`open answered ${opened.status} ${JSON.stringify(opened.body)}`);
          pages.push((await openServicePage(context, opened.body.editorUrl)).page);
        }
        await sample(`${target} editor(s) open`);
      }
      info = await dsExec(image, secrets, 'curl -s http://127.0.0.1/info/info.json').catch((e) => String(e));
      // Conversions while the editors stay open: as many as the service admits at once (4 in total).
      const peak = { ds: 0, api: 0 };
      const running = Promise.all(
        [1, 2, 3, 4].map((n) => convertViaApi(secrets, { sourceUrl: `${STUB_INTERNAL}/fixtures/contract-cl.docx`, uploadUrl: `${STUB_INTERNAL}/upload/capacity-${n}.pdf` })),
      );
      let done = false;
      void running.finally(() => (done = true));
      while (!done) {
        const m = await memory();
        peak.ds = Math.max(peak.ds, m.ds ?? 0);
        peak.api = Math.max(peak.api, m.api ?? 0);
        await sleep(1000);
      }
      const answers = await running;
      samples.push({ label: '6 editors open + 4 conversions (peak)', ...peak });
      evidence.push(`conversions during the peak: ${answers.map((a) => a.status).join(', ')}`);
    } finally {
      for (const p of pages) await p.close().catch(() => undefined);
    }
    const ds = (label) => samples.find((s) => s.label === label)?.ds ?? null;
    const perEditor = ds('6 editor(s) open') !== null && ds('1 editor(s) open') !== null ? Math.round((ds('6 editor(s) open') - ds('1 editor(s) open')) / 5) : null;
    let stats = '';
    try {
      const parsed = JSON.parse(info);
      stats = `connectionsStat ${JSON.stringify(parsed.connectionsStat).slice(0, 400)}; licenseInfo ${JSON.stringify(parsed.licenseInfo).slice(0, 400)}; quota ${JSON.stringify(parsed.quota).slice(0, 300)}`;
    } catch {
      stats = squash(info).slice(0, 600);
    }
    evidence.push(
      `memory (MiB, docker stats): ${samples.map((s) => `${s.label}: DocumentServer ${s.ds}, API ${s.api}`).join('; ')}`,
      `DocumentServer per additional open editor: about ${perEditor} MiB`,
      `info.json with 6 editors open: ${stats}`,
    );
    return { result: samples.length >= 5 && samples.every((s) => s.ds !== null) ? 'record' : 'fail', evidence };
  },
};

/** Runs a command on the host; resolves with its exit code and output (never rejects). */
function host(cmd, args, timeout = 300_000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, out: `${stdout}${stderr}` }));
  });
}

const CADDY_IMAGE = 'caddy:2.10.2';
const CADDY_NAME = 'editor-battery-caddy';
const CADDY_PORT = 18205;

const e6d = {
  id: 'E6d',
  order: 21,
  title: "The VPS Caddy block routes the editor's public host as designed: editor pages, the plugin, and /health to the API; /api/* and /health/* refused; everything else to DocumentServer",
  parent: 'EDIT-6.5 / UDOC-1.6',
  timeoutMs: 600_000,
  async run({ work }) {
    const evidence = [];
    // infrastructure/vps/Caddyfile.editor as it ships, with only the site address swapped for plain HTTP
    // (no certificate on a scratch stack), on the battery's network where the upstreams' names resolve.
    const source = await readFile(path.join(BATTERY_DIR, '..', '..', 'infrastructure', 'vps', 'Caddyfile.editor'), 'utf8');
    if (!source.includes('editor-dev.monolith.cx {')) throw new Error('Caddyfile.editor has no editor-dev.monolith.cx site');
    const file = path.join(work, 'Caddyfile');
    await writeFile(file, `{\n\tadmin off\n\tauto_https off\n}\n${source.replace('editor-dev.monolith.cx {', `http://:${CADDY_PORT} {`)}`);
    await host('docker', ['rm', '-f', CADDY_NAME]);
    const started = await host('docker', ['run', '-d', '--name', CADDY_NAME, '--network', 'editor-battery_default', '-p', `127.0.0.1:${CADDY_PORT}:${CADDY_PORT}`, '-v', `${file}:/etc/caddy/Caddyfile:ro`, CADDY_IMAGE]);
    if (started.code !== 0) return { result: 'error', evidence: [`caddy did not start: ${squash(started.out).slice(0, 300)}`] };
    try {
      await sleep(3000);
      const at = `http://127.0.0.1:${CADDY_PORT}`;
      const get = async (p) => {
        const r = await fetch(`${at}${p}`, { redirect: 'manual' });
        return { status: r.status, type: r.headers.get('content-type') ?? '', body: (await r.text()).slice(0, 200), nosniff: r.headers.get('x-content-type-options'), referrer: r.headers.get('referrer-policy') };
      };
      const checks = [
        ['/health reaches the API', '/health', (r) => r.status === 200 && r.body.includes('"status":"ok"')],
        ['/api/status is refused', '/api/status', (r) => r.status === 403 && r.body.includes('not available on this hostname')],
        ['/api/documents/open is refused', '/api/documents/open', (r) => r.status === 403],
        ['/health/converter is refused', '/health/converter', (r) => r.status === 404],
        ['/health/converter-sample.docx is refused', '/health/converter-sample.docx', (r) => r.status === 404],
        ['the bridge plugin comes from the API', '/plugins/udoc-bridge/config.json', (r) => r.status === 200 && r.body.includes('Document panel')],
        // The editor page's own Referrer-Policy must survive Caddy: its path is a capability (EDIT-4).
        ['an editor page goes to the API with its no-referrer policy intact (a bad token gets its expired page)', '/editor/not-a-token', (r) => r.status >= 400 && r.status < 500 && /html/.test(r.type) && r.referrer === 'no-referrer'],
        ["DocumentServer's connection statistics stay inside its container (F7)", '/info/info.json', (r) => r.status === 403],
        ["DocumentServer's health check comes from DocumentServer", '/healthcheck', (r) => r.status === 200 && r.body.trim() === 'true'],
        ["DocumentServer's JS API comes from DocumentServer", '/web-apps/apps/api/documents/api.js', (r) => r.status === 200 && /javascript/.test(r.type)],
      ];
      let ok = true;
      for (const [label, p, test] of checks) {
        const r = await get(p);
        const passed = test(r) && r.nosniff === 'nosniff';
        ok = ok && passed;
        evidence.push(`${label}: ${p} → ${r.status} ${r.type.split(';')[0]}${r.referrer ? `, Referrer-Policy ${r.referrer}` : ''}${passed ? '' : ` (body ${squash(r.body).slice(0, 120)})`}: ${passed}`);
      }
      return { result: ok ? 'pass' : 'fail', evidence };
    } finally {
      await host('docker', ['rm', '-f', CADDY_NAME]);
    }
  },
};

const e6e = {
  id: 'E6e',
  order: 22,
  title: "What a DocumentServer restart in place (the watchdog's action) does to an open editor with unsaved typing: is the edit saved, kept, or lost",
  parent: 'EDIT-6.3 / UDOC-1.6 (ADR F17)',
  timeoutMs: 1_200_000,
  async run({ image, secrets, context }) {
    await resetStub();
    const opened = await openViaApi(secrets, documentBody());
    if (opened.status !== 200) throw new Error(`open answered ${opened.status} ${JSON.stringify(opened.body)}`);
    const key = opened.body.key;
    const { page } = await openServicePage(context, opened.body.editorUrl);
    await typeAtDocumentEnd(page, ' 60606 before the restart');
    const t0 = Date.now();
    await restartDsInPlace(image, secrets);
    const restartedIn = Math.round((Date.now() - t0) / 1000);
    // Give the open page time to notice and reconnect, then close it as a user would.
    await sleep(30_000);
    const banner = await page
      .frames()
      .find((f) => f.name() === 'frameEditor')
      ?.evaluate(() => document.body.innerText.match(/(connection|reconnect|error|lost)[^\n]{0,80}/i)?.[0] ?? '')
      .catch(() => '');
    const t = Date.now();
    await page.close();
    const final = await waitForEvent((e) => e.kind === 'consumer-callback' && e.key === key && (e.status === 2 || e.status === 4) && e.t >= t0, 120_000);
    const kept = final && final.status === 2 ? (await savedText(final)).some((p) => p.includes('60606 before the restart')) : false;
    const seen = (await events()).filter((e) => e.kind === 'consumer-callback' && e.key === key).map((e) => `${e.status}@${Math.round((e.t - t0) / 1000)}s`);
    return {
      result: 'record',
      evidence: [
        `typed " 60606 before the restart" (no force-save), restarted DocumentServer in place (compose restart, ${restartedIn}s to ready), waited 30 s, closed the page ${Math.round((t - t0) / 1000)} s after the restart began`,
        `the editor showed: ${banner ? `"${squash(banner)}"` : 'no connection message found'}`,
        `consumer notifications for the key after the restart: ${seen.join(', ') || 'none'}; final: ${final ? `status ${final.status}` : 'none within 120 s'}; the typed text in the saved file: ${kept}`,
      ],
    };
  },
};

export default [e6a, e6b, e6c, e6d, e6e];
