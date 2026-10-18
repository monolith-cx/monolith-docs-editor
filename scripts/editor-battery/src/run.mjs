#!/usr/bin/env node
// Editor battery runner (EDIT-1.2). One command from a clean checkout:
//   pnpm --filter @monolith-docs/editor-battery battery [--only 3,7cl] [--keep] [--reuse] [--image ref]
// --keep leaves the stack up and its scratch secret in .work/ (gitignored); --reuse attaches to it.
// Brings up the scratch stack, runs every item against the pinned DocumentServer,
// writes docs/spikes/results/<release>/<date>.{md,json}, and tears the stack down.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { contractBody, writeFixture } from './fixtures.mjs';
import { BATTERY_DIR, WORK_DIR, down, newSecrets, prepareWork, up } from './stack.mjs';

/** The pinned release (EDIT-1.3): tag for humans, digest for reproducibility. */
export const PINNED_IMAGE = 'onlyoffice/documentserver:10.0.0.1@sha256:ca17889f10b11141cc6441836aebdd2835cf3e1b49681b2fd6e155c94b7850b3';

function parseArgs(argv) {
  const args = { only: null, keep: false, reuse: false, image: process.env.BATTERY_DS_IMAGE ?? PINNED_IMAGE };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--only') args.only = new Set(argv[++i].split(','));
    else if (argv[i] === '--keep') args.keep = true;
    else if (argv[i] === '--reuse') {
      args.reuse = true;
      args.keep = true;
    }
    else if (argv[i] === '--image') args.image = argv[++i];
  }
  return args;
}

async function loadItems() {
  const dir = path.join(BATTERY_DIR, 'src', 'items');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.mjs')).sort();
  const items = [];
  for (const f of files) {
    const mod = await import(path.join(dir, f));
    for (const item of [].concat(mod.default)) items.push(item);
  }
  return items.sort((a, b) => a.order - b.order);
}

function releaseOf(image) {
  return /:([^@]+)/.exec(image.split('/').pop())?.[1] ?? 'unknown';
}

function markdown(meta, results) {
  const icon = { pass: 'PASS', finding: 'PASS, WITH FINDING', fail: 'FAIL', blocked: 'BLOCKED', record: 'RECORDED', error: 'ERROR' };
  const lines = [
    `# Editor battery — ${meta.release} — ${meta.date}`,
    '',
    `- Image: \`${meta.image}\``,
    `- Started: ${meta.started}; finished: ${meta.finished}; host: ${meta.host}`,
    `- Runner: \`pnpm --filter @monolith-docs/editor-battery battery${meta.only ? ` --only ${meta.only}` : ''}\``,
    `- Totals: ${Object.entries(meta.totals).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `- DocumentServer settle after healthy (font generation and its service restart, ADR F15): ${meta.dsSettleSeconds ?? 'n/a'} s`,
    '',
    '| # | Item | Parent | Result | Evidence |',
    '|---|---|---|---|---|',
    ...results.map((r) => {
      const evidence = r.evidence.map((e) => e.replace(/\s*\r?\n\s*/g, ' ').trim()).join('<br>').replace(/\|/g, '\\|');
      return `| ${r.id} | ${r.title} | ${r.parent} | **${icon[r.result] ?? r.result}** | ${evidence} |`;
    }),
    '',
  ];
  return lines.join('\n');
}

async function main() {
  const renderAt = process.argv.indexOf('--render');
  if (renderAt !== -1) {
    // Re-render a run's Markdown from its JSON (no stack needed).
    const jsonPath = path.resolve(process.argv[renderAt + 1]);
    const { meta, results } = JSON.parse(await readFile(jsonPath, 'utf8'));
    await writeFile(jsonPath.replace(/\.json$/, '.md'), markdown(meta, results));
    process.stdout.write(`rendered ${jsonPath.replace(/\.json$/, '.md')}\n`);
    return;
  }
  const args = parseArgs(process.argv.slice(2));
  const items = (await loadItems()).filter((i) => !args.only || args.only.has(i.id));
  const secretFile = path.join(WORK_DIR, '.secret');
  const secrets = args.reuse ? JSON.parse(await readFile(secretFile, 'utf8')) : newSecrets();
  const started = new Date();
  if (!args.reuse) await prepareWork();
  await writeFixture(WORK_DIR, 'contract-sdt.docx', contractBody('sdtContentLocked'));
  await writeFixture(WORK_DIR, 'contract-cl.docx', contractBody('contentLocked'));
  for (const item of items) if (item.fixtures) await item.fixtures(WORK_DIR);

  process.stdout.write(`battery: ${items.length} item(s) on ${args.image}\n`);
  let settleMs = null;
  if (!args.reuse) {
    try {
      settleMs = await up(args.image, secrets);
    } catch (err) {
      if (!args.keep) await down(args.image, secrets);
      throw err;
    }
  }
  if (args.keep) await writeFile(secretFile, JSON.stringify(secrets), { mode: 0o600 });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  try {
    for (const item of items) {
      const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
      const t0 = Date.now();
      let outcome;
      try {
        outcome = await Promise.race([
          item.run({ image: args.image, secrets, context, browser, work: WORK_DIR }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('item timeout')), item.timeoutMs ?? 600_000)),
        ]);
      } catch (err) {
        outcome = { result: 'error', evidence: [`threw: ${String(err && err.message ? err.message : err).slice(0, 300)}`] };
      }
      await context.close().catch(() => undefined);
      const r = { id: item.id, title: item.title, parent: item.parent, ...outcome, seconds: Math.round((Date.now() - t0) / 1000) };
      results.push(r);
      process.stdout.write(`  [${r.result}] ${r.id} ${r.title} (${r.seconds}s)\n`);
    }
  } finally {
    await browser.close().catch(() => undefined);
    if (!args.keep) await down(args.image, secrets);
  }
  const finished = new Date();
  const totals = results.reduce((acc, r) => ({ ...acc, [r.result]: (acc[r.result] ?? 0) + 1 }), {});
  const release = releaseOf(args.image);
  const date = started.toISOString().slice(0, 10);
  const meta = {
    release,
    date,
    image: args.image,
    started: started.toISOString(),
    finished: finished.toISOString(),
    host: os.hostname(),
    only: args.only ? [...args.only].join(',') : null,
    // ADR F15: DocumentServer restarts its own services after background font generation; items start after that.
    dsSettleSeconds: settleMs === null ? null : Math.round(settleMs / 1000),
    totals,
  };
  const outDir = path.resolve(BATTERY_DIR, '..', '..', 'docs', 'spikes', 'results', release);
  await mkdir(outDir, { recursive: true });
  const stamp = `${date}${args.only ? `-partial-${started.toISOString().slice(11, 16).replace(':', '')}` : ''}`;
  await writeFile(path.join(outDir, `${stamp}.json`), `${JSON.stringify({ meta, results }, null, 2)}\n`);
  await writeFile(path.join(outDir, `${stamp}.md`), markdown(meta, results));
  process.stdout.write(`results: docs/spikes/results/${release}/${stamp}.{md,json}\n`);
  if (results.some((r) => r.result === 'error' || r.result === 'fail')) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
  process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
  process.exit(2);
});
