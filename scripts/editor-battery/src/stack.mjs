// Scratch stack lifecycle (EDIT-1.2): compose up with random secrets, wait for health, tear down.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const BATTERY_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const WORK_DIR = path.join(BATTERY_DIR, '.work');

export const DS_PUBLIC = 'http://127.0.0.1:18200';
export const STUB_A = 'http://127.0.0.1:18201';
export const STUB_B = 'http://127.0.0.1:18202';
export const STUB_C = 'http://127.0.0.1:18203';
/** How DocumentServer (inside compose) reaches the stub. */
export const STUB_INTERNAL = 'http://stub:18201';

export function newSecrets() {
  return {
    jwtSecret: randomBytes(32).toString('base64url'),
    sealKey: randomBytes(32).toString('base64url'),
    notifySecret: randomBytes(32).toString('base64url'),
    apiKey: randomBytes(16).toString('base64url'),
    legacyKey: randomBytes(16).toString('base64url'),
  };
}

function composeEnv(image, secrets, extra = {}) {
  return {
    ...process.env,
    BATTERY_DS_IMAGE: image,
    BATTERY_JWT_SECRET: secrets.jwtSecret,
    BATTERY_SEAL_KEY: secrets.sealKey,
    BATTERY_NOTIFY_SECRET: secrets.notifySecret,
    BATTERY_API_KEY: secrets.apiKey,
    BATTERY_LEGACY_KEY: secrets.legacyKey,
    ...extra,
  };
}

async function compose(args, env, timeoutMs = 600_000, extraFiles = []) {
  const files = ['compose.yml', ...extraFiles].flatMap((f) => ['-f', path.join(BATTERY_DIR, f)]);
  return run('docker', ['compose', ...files, ...args], {
    cwd: BATTERY_DIR,
    env,
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
}

export async function prepareWork() {
  await rm(WORK_DIR, { recursive: true, force: true });
  await mkdir(path.join(WORK_DIR, 'fixtures'), { recursive: true });
  await mkdir(path.join(WORK_DIR, 'saved'), { recursive: true });
  // Created here, not by the stub (root in its container), so the next run can clean it.
  await mkdir(path.join(WORK_DIR, 'uploads'), { recursive: true });
}

/**
 * DocumentServer's entrypoint generates fonts in the background after the healthcheck
 * already passes, then restarts docservice and converter (documentserver-generate-allfonts.sh),
 * which drops every open editor ("Connection is lost"). Wait for that to finish.
 */
async function waitDsSettled(image, secrets, timeoutMs = 600_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const out = await compose(
      ['exec', '-T', 'ds', 'sh', '-c', "pgrep -f '[d]ocumentserver-generate-allfonts' >/dev/null && echo busy || echo idle; curl -fsS http://localhost/healthcheck || true"],
      composeEnv(image, secrets),
      60_000,
    ).then((r) => r.stdout).catch(() => 'busy');
    if (out.includes('idle') && out.includes('true')) return Date.now() - (deadline - timeoutMs);
    if (Date.now() > deadline) throw new Error('DocumentServer did not settle (font generation still running)');
    await sleep(3000);
  }
}

/** Starts the stack; resolves to the milliseconds DocumentServer took to settle after reporting healthy. */
export async function up(image, secrets, extra = {}) {
  // --build: the api image is this checkout's service; a cached image would test stale code.
  await compose(['up', '-d', '--build', '--wait', '--wait-timeout', '420'], composeEnv(image, secrets, extra), 900_000);
  return waitDsSettled(image, secrets);
}

export async function down(image, secrets) {
  await compose(['down', '-v', '--remove-orphans'], composeEnv(image, secrets), 180_000).catch(() => undefined);
}

export async function dsExec(image, secrets, command) {
  const { stdout } = await compose(['exec', '-T', 'ds', 'sh', '-c', command], composeEnv(image, secrets), 120_000);
  return stdout;
}

export async function dsLogs(image, secrets) {
  const { stdout } = await compose(['logs', '--no-color', 'ds'], composeEnv(image, secrets), 120_000);
  return stdout;
}

export async function restartDs(image, secrets, extra = {}, extraFiles = []) {
  await compose(['up', '-d', '--wait', '--wait-timeout', '420', '--force-recreate', 'ds'], composeEnv(image, secrets, extra), 600_000, extraFiles);
  await waitDsSettled(image, secrets);
}

export async function stub(pathname, init = {}) {
  const res = await fetch(`${STUB_A}${pathname}`, init);
  if (!res.ok) throw new Error(`stub ${pathname}: ${res.status}`);
  return res.headers.get('content-type')?.includes('json') ? res.json() : Buffer.from(await res.arrayBuffer());
}

export async function resetStub() {
  await stub('/control/reset', { method: 'POST' });
}

export async function setCallbackMode(mode) {
  await stub('/control/callback-mode', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
}

export async function setConsumerMode(failCount, failStatus = 503) {
  await stub('/control/consumer-mode', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ failCount, failStatus }),
  });
}

export async function restartApi(image, secrets) {
  await compose(['restart', 'api'], composeEnv(image, secrets), 180_000);
  for (let i = 0; i < 60; i += 1) {
    const ok = await fetch('http://127.0.0.1:18204/health').then((r) => r.ok).catch(() => false);
    if (ok) return;
    await sleep(1000);
  }
  throw new Error('api did not come back after restart');
}

export async function events() {
  return stub('/events');
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls the stub's event log until `predicate` matches an event or the timeout passes. */
export async function waitForEvent(predicate, timeoutMs = 60_000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const list = await events();
    const hit = list.find(predicate);
    if (hit) return hit;
    if (Date.now() > deadline) return null;
    await sleep(intervalMs);
  }
}
