#!/usr/bin/env node
/*!
 * FormGhost - https://github.com/mahtoaman/formghost
 * Copyright 2026 Aman Mahto (@mahtoaman)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 */
/* Builds dist/formghost-v<version>.zip for the Chrome Web Store with the `zip` command. The zip holds the extension with its
   LICENSE, NOTICE and README (Apache-2.0 §4); test/, scripts/, .github/, dist/ and dotfiles stay out.
   Usage: node scripts/pack.mjs */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['manifest.json', 'background.js', 'LICENSE', 'NOTICE', 'README.md'];
const DIRS = ['content', 'lib', 'popup', 'icons'];
const NOT_SHIPPED = /^(test|scripts|\.github|dist)\/|(^|\/)\./;
const REPO = 'https://github.com/mahtoaman/formghost';
const HEADER = ['github.com/mahtoaman/formghost', 'Aman Mahto (@mahtoaman)', 'Apache License, Version 2.0'];
const die = (msg) => { console.error(`pack: ${msg}`); process.exit(1); };
const abs = (rel) => path.join(ROOT, rel);

for (const f of [...FILES, ...DIRS]) if (!existsSync(abs(f))) die(`${f} is missing`);
const manifest = JSON.parse(readFileSync(abs('manifest.json'), 'utf8'));
const version = manifest.version;
if (!/^\d+(\.\d+){0,3}$/.test(version || '')) die(`manifest.json has no valid version (${JSON.stringify(version)})`);

// every file the zip will hold; dotfiles (.DS_Store, editor leftovers) stay out
const walk = (rel) => (statSync(abs(rel)).isDirectory()
  ? readdirSync(abs(rel)).filter((n) => !n.startsWith('.')).sort().flatMap((n) => walk(`${rel}/${n}`))
  : [rel]);
const list = [...FILES, ...DIRS.flatMap(walk)];

// Apache-2.0 §4: the package keeps LICENSE, NOTICE, the credits and every source file's copyright header
const bare = list.filter((f) => /\.(m?js|css|html)$/.test(f) && !HEADER.every((h) => readFileSync(abs(f), 'utf8').slice(0, 800).includes(h)));
if (bare.length) die(`these files lost the FormGhost copyright header (see CONTRIBUTING.md):\n  ${bare.join('\n  ')}`);
if (manifest.homepage_url !== REPO) die(`manifest.json must keep "homepage_url": "${REPO}"`);
if (!readFileSync(abs('NOTICE'), 'utf8').includes('Aman Mahto (@mahtoaman)')) die('NOTICE lost its attribution to Aman Mahto (@mahtoaman)');

const probe = spawnSync('zip', ['-v'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) die('the `zip` command was not found; install it (e.g. `apt-get install zip`) and try again');

const out = `dist/formghost-v${version}.zip`;
mkdirSync(abs('dist'), { recursive: true });
rmSync(abs(out), { force: true }); // zip would otherwise add to an old archive
const run = spawnSync('zip', ['-X', '-q', '-9', out, ...list], { cwd: ROOT, stdio: 'inherit' });
if (run.error || run.status !== 0) die(`zip failed (${run.error ? run.error.message : `exit ${run.status}`})`);

// what went in, read back from the archive when unzip is around
const listed = spawnSync('unzip', ['-Z1', out], { cwd: ROOT, encoding: 'utf8' });
if (!listed.error && listed.status === 0) {
  const names = listed.stdout.split('\n').filter(Boolean);
  const stray = names.filter((n) => NOT_SHIPPED.test(n));
  if (stray.length) die(`unexpected files in ${out}:\n  ${stray.join('\n  ')}`);
  for (const f of ['manifest.json', 'LICENSE', 'NOTICE']) if (!names.includes(f)) die(`${f} is not at the root of ${out}`);
}
console.log(`${out}  ${list.length} files, ${(statSync(abs(out)).size / 1024).toFixed(1)} KB  (FormGhost ${version})`);
