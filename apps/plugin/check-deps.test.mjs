// The dependency guard fails on a planted @monolith-platform import (EDIT-5.6).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const here = path.dirname(new URL(import.meta.url).pathname);
const script = path.join(here, '..', '..', 'scripts', 'check-plugin-deps.mjs');
const check = (dir) => {
  try {
    execFileSync(process.execPath, [script, dir], { stdio: 'pipe' });
    return 'passed';
  } catch (err) {
    return String(err.stderr);
  }
};

describe('scripts/check-plugin-deps.mjs', () => {
  it('passes the plugin as it is', () => {
    expect(check(here)).toBe('passed');
  });

  it('fails on a planted @monolith-platform import, a third-party import, a remote script, and a runtime dependency', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'plugin-deps-'));
    try {
      for (const f of ['package.json', 'bridge.js', 'commands.js', 'index.html', 'config.json']) cpSync(path.join(here, f), path.join(dir, f));
      writeFileSync(path.join(dir, 'planted.js'), "import { Shell } from '@monolith-platform/ui';\nimport x from 'left-pad';\n");
      writeFileSync(path.join(dir, 'remote.html'), '<script src="https://cdn.example.com/x.js"></script>');
      const out = check(dir);
      expect(out).toContain('planted.js: names an @monolith package');
      expect(out).toContain('planted.js: imports left-pad');
      expect(out).toContain('remote.html: <script> loads https://cdn.example.com/x.js');
      writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: { lodash: '1' } }));
      expect(check(dir)).toContain('runtime dependencies lodash');
      writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', optionalDependencies: { left: '1' }, peerDependencies: { right: '1' } }));
      const deps = check(dir);
      expect(deps).toContain('optionalDependencies left');
      expect(deps).toContain('peerDependencies right');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('catches the other ways to load code: dynamic imports, workers, preloads, frames, inline modules, subdirectories', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'plugin-deps-'));
    try {
      for (const f of ['package.json', 'bridge.js', 'commands.js', 'index.html', 'config.json']) cpSync(path.join(here, f), path.join(dir, f));
      writeFileSync(
        path.join(dir, 'sneaky.js'),
        "const u = 'https://cdn.example.com/x.js';\nimport(`https://cdn.example.com/y.js`);\nimport(u);\nimportScripts('https://cdn.example.com/w.js');\nnew Worker('https://cdn.example.com/k.js');\nimport('./ok.js');\n",
      );
      writeFileSync(
        path.join(dir, 'page.html'),
        '<link rel="modulepreload" href="https://cdn.example.com/m.js"><iframe src="https://evil.example.com"></iframe><script src=https://cdn.example.com/u.js></script><script type="module">import "https://cdn.example.com/i.js";</script>',
      );
      mkdirSync(path.join(dir, 'lib'));
      writeFileSync(path.join(dir, 'lib', 'deep.js'), "import x from 'left-pad';\n");
      const out = check(dir);
      expect(out).toContain('sneaky.js: dynamic import(`https://cdn.example.com/y.js`)');
      expect(out).toContain('sneaky.js: dynamic import(u)');
      expect(out).not.toContain("import('./ok.js')");
      expect(out).toContain('sneaky.js: importScripts');
      expect(out).toContain('sneaky.js: starts a worker');
      expect(out).toContain('page.html: <link> loads https://cdn.example.com/m.js');
      expect(out).toContain('page.html: <iframe> loads https://evil.example.com');
      expect(out).toContain('page.html: <script> loads https://cdn.example.com/u.js');
      expect(out).toContain('page.html (inline script): imports https://cdn.example.com/i.js');
      expect(out).toContain(`${path.join('lib', 'deep.js')}: imports left-pad`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('catches escapes from the plugin directory, look-alike DocumentServer URLs, and the other file kinds (EDIT-5 review attempt 2)', () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'plugin-deps-'));
    const dir = path.join(parent, 'plugin');
    try {
      mkdirSync(dir);
      for (const f of ['package.json', 'bridge.js', 'commands.js', 'index.html', 'config.json']) cpSync(path.join(here, f), path.join(dir, f));
      writeFileSync(path.join(dir, 'escape.js'), "import a from './../outside.js';\nimport b from '../outside.js';\nimport('./../../far.js');\nimport ok from './commands.js';\n");
      writeFileSync(
        path.join(dir, 'urls.html'),
        '<script src="/x.js"></script><script src="{{DS}}.evil.com/a.js"></script><script src="{{DS}}@evil.com/b.js"></script><script src="../up.js"></script><script src="./bridge.js"></script><script src="{{DS}}/sdkjs-plugins/v1/plugins.js"></script>' +
          '<base href="https://evil.example.com/"><meta http-equiv="refresh" content="0;url=https://evil.example.com"><style>@import url(https://evil.example.com/s.css);</style>',
      );
      for (const ext of ['cjs', 'mts', 'cts', 'jsx']) writeFileSync(path.join(dir, `kind.${ext}`), "import x from 'left-pad';\n");
      writeFileSync(path.join(dir, '.hidden.js'), "import x from 'left-pad';\n");
      writeFileSync(path.join(dir, 'served.test.js'), "import x from 'left-pad';\n");
      writeFileSync(path.join(dir, 'terse.js'), "import\"left-pad\";\nimport/**/'right-pad';\nimport y from`up-pad`;\nconst s = document.createElement('script');\n");
      writeFileSync(path.join(dir, 'inline.html'), '<script type=module>import"https://evil.example.com/a.js"</script><script data-src="x" type="module">import "https://evil.example.com/b.js"</script>');
      mkdirSync(path.join(dir, 'vendor'));
      writeFileSync(path.join(dir, 'vendor', 'package.json'), JSON.stringify({ name: 'v', dependencies: { lodash: '1' } }));
      const out = check(dir);
      expect(out).toContain('escape.js: imports ./../outside.js');
      expect(out).toContain('escape.js: imports ../outside.js');
      expect(out).toContain("escape.js: dynamic import('./../../far.js')");
      expect(out).not.toContain('imports ./commands.js');
      for (const url of ['/x.js', '{{DS}}.evil.com/a.js', '{{DS}}@evil.com/b.js', '../up.js']) expect(out).toContain(`urls.html: <script> loads ${url}`);
      expect(out).not.toContain('loads ./bridge.js');
      expect(out).not.toContain('loads {{DS}}/sdkjs-plugins');
      expect(out).toContain('urls.html: <base>');
      expect(out).toContain('urls.html: meta refresh');
      expect(out).toContain('urls.html: CSS @import');
      for (const ext of ['cjs', 'mts', 'cts', 'jsx']) expect(out).toContain(`kind.${ext}: imports left-pad`);
      expect(out).toContain('.hidden.js: imports left-pad');
      expect(out).toContain('served.test.js: imports left-pad');
      expect(out).toContain('terse.js: imports left-pad');
      expect(out).toContain('terse.js: imports right-pad');
      expect(out).toContain('terse.js: imports from a template literal');
      expect(out).toContain('terse.js: creates a script element');
      expect(out).toContain('inline.html (inline script): imports https://evil.example.com/a.js');
      expect(out).toContain('inline.html (inline script): imports https://evil.example.com/b.js');
      expect(out).toContain(`${path.join('vendor', 'package.json')}: runtime dependencies lodash`);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
