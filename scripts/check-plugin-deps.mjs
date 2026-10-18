#!/usr/bin/env node
// The bridge plugin's dependency guard (EDIT-5.1, guidance E7). The plugin is AGPL code served into
// DocumentServer; it must never carry proprietary Monolith code or third-party code. Fails when:
//  - any package.json under the plugin declares dependencies, optionalDependencies, or
//    peerDependencies (devDependencies for tests and typechecking are fine);
//  - a source file imports anything but a relative module that stays inside the plugin directory,
//    imports dynamically from anything but such a string literal, or loads code another way
//    (importScripts, new Worker, SharedWorker, a created <script> element, `from` a template literal);
//  - an HTML or SVG file loads a script, a module preload, a stylesheet, or a frame from anywhere but
//    a relative path inside the plugin or a path on the rendered DocumentServer origin (`{{DS}}/…`),
//    carries a `<base>` or a meta refresh, or an inline module script that imports;
//  - any page or stylesheet uses CSS `@import`;
//  - any file names an `@monolith-*` package.
// Every file under the plugin directory is checked, subdirectories and dotfiles included, except
// node_modules, the .turbo cache, binary images, and the top-level `*.test.mjs` files (never served:
// the API serves a fixed list of five files, `apps/api/src/routes/plugin.ts`; tests plant the
// patterns this script looks for).
// Usage: node scripts/check-plugin-deps.mjs [pluginDir]   (default apps/plugin)
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'apps', 'plugin'));
const problems = [];

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.turbo') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else yield full;
  }
}

/** A path that, resolved from `fromDir`, stays inside the plugin directory. */
const inside = (fromDir, rel) => {
  const target = path.resolve(fromDir, rel);
  return target.startsWith(root + path.sep);
};

/** A relative path: plain segments, no scheme, no leading slash, no `..`, nothing but path characters. */
const RELATIVE = /^(?:\.\/)?[\w-][\w.-]*(?:\/[\w-][\w.-]*)*$/;

/** A module specifier a plugin file may import: `./` or `../` relative, resolving inside the plugin. */
const allowedSpec = (fromDir, spec) => /^\.\.?\//.test(spec) && inside(fromDir, spec);

/** A URL a plugin page may load: a relative path inside the plugin, or a path on DocumentServer's rendered origin. */
const allowedUrl = (fromDir, u) =>
  u.startsWith('{{DS}}/') ? RELATIVE.test(u.slice('{{DS}}/'.length)) : RELATIVE.test(u) && !u.split('/').includes('..') && inside(fromDir, u);

const BINARY = /\.(png|ico|jpe?g|gif|webp)$/i;

for await (const file of files(root)) {
  const name = path.relative(root, file);
  const dir = path.dirname(file);
  if (BINARY.test(name)) continue;
  if (/^[^/\\]+\.test\.mjs$/.test(name)) continue;
  const text = await readFile(file, 'utf8');
  if (path.basename(name) === 'package.json') {
    let pkg = null;
    try {
      pkg = JSON.parse(text);
    } catch {
      problems.push(`${name}: not valid JSON`);
    }
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      if (pkg && pkg[field] && Object.keys(pkg[field]).length > 0) problems.push(`${name}: ${field === 'dependencies' ? 'runtime dependencies' : field} ${Object.keys(pkg[field]).join(', ')}`);
    }
  } else if (/@monolith[-/]/.test(text)) {
    problems.push(`${name}: names an @monolith package`);
  }
  const checkJs = (source, where) => {
    // Block comments go first, so `import/**/'x'` reads as `import 'x'`.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const m of code.matchAll(/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]/gm)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec && !allowedSpec(dir, spec)) problems.push(`${where}: imports ${spec}`);
    }
    for (const m of code.matchAll(/\bimport\s*\(\s*([^)]*)\)/g)) {
      const literal = /^['"]([^'"]*)['"]$/.exec(m[1].trim());
      if (!literal || !allowedSpec(dir, literal[1])) problems.push(`${where}: dynamic import(${m[1].trim().slice(0, 60)})`);
    }
    if (/\bfrom\s*`/.test(code)) problems.push(`${where}: imports from a template literal`);
    if (/\bcreateElement\s*\(\s*['"`]script['"`]/i.test(code)) problems.push(`${where}: creates a script element`);
    if (/\bimportScripts\s*\(/.test(code)) problems.push(`${where}: importScripts`);
    if (/\bnew\s+(?:Shared)?Worker\s*\(/.test(code)) problems.push(`${where}: starts a worker`);
  };
  if (/\.[mc]?[jt]sx?$/.test(name)) checkJs(text, name);
  if (/\.(html?|svg|css)$/.test(name) && /@import\b/i.test(text)) problems.push(`${name}: CSS @import`);
  if (/\.(html?|svg)$/.test(name)) {
    for (const m of text.matchAll(/<(script|link|iframe|frame|embed|object)\b[^>]*?\b(?:src|href|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      const url = m[2] ?? m[3] ?? m[4] ?? '';
      if (!allowedUrl(dir, url)) problems.push(`${name}: <${m[1].toLowerCase()}> loads ${url}`);
      if (/^(iframe|frame|embed|object)$/i.test(m[1])) problems.push(`${name}: <${m[1].toLowerCase()}> in the page (the panel frame is created by bridge.js)`);
    }
    if (/<base\b/i.test(text)) problems.push(`${name}: <base>`);
    if (/<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i.test(text)) problems.push(`${name}: meta refresh`);
    for (const m of text.matchAll(/<script\b(?![^>]*\ssrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) checkJs(m[1], `${name} (inline script)`);
  }
}

if (problems.length > 0) {
  process.stderr.write(`plugin dependency check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('plugin dependency check passed\n');
