/*!
 * FormGhost - https://github.com/mahtoaman/formghost
 * Copyright 2026 Aman Mahto (@mahtoaman)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 */
/* Attribution checks. The Apache License 2.0 requires copies to keep the copyright and attribution notices in the source files
   (Section 4(c)) and the NOTICE file's attributions (Section 4(d)). These tests fail when a source file loses its header, LICENSE
   is changed or missing, NOTICE loses its attribution, or the credits leave the manifest, the popup, exported test scripts or
   CODEOWNERS. Run: node --test test/ */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/mahtoaman/formghost';
const OWNER = 'Aman Mahto (@mahtoaman)';
const COPYRIGHT = /Copyright \d{4}(?:\s*[-–]\s*\d{4})? Aman Mahto \(@mahtoaman\)/;
const APACHE = /Licensed under the Apache License,? Version 2\.0/;
/* https://www.apache.org/licenses/LICENSE-2.0.txt (raw sha256 cfc7749b…3d30), hashed after norm() so line endings and
   blank edges don't matter but any change to the text does */
const LICENSE_SHA256 = '50e6751797c50dedd75ef1b8a0d9e42f5f8472e9fbce91f34718e9f97b0c780a';
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist']);
const SOURCE = /\.(m?js|cjs|css|html?)$/i;

const has = (f) => existsSync(path.join(ROOT, f));
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const norm = (s) => s.split('\n').map((l) => l.trimEnd()).join('\n').trim() + '\n';
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

/* every source file in the repository; dot-folders other than .github are local tool folders */
function sources(dir = '') {
  const out = [];
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && (!e.name.startsWith('.') || e.name === '.github')) out.push(...sources(rel)); }
    else if (e.isFile() && SOURCE.test(e.name)) out.push(rel);
  }
  return out.sort();
}

/* the comment a file starts with: after a #! line in a script, after <!doctype html> in a page */
function leadingComment(rel) {
  let s = read(rel);
  if (s.startsWith('#!')) s = s.slice(s.indexOf('\n') + 1);
  s = s.trimStart();
  const [open, close] = /\.html?$/i.test(rel) ? ['<!--', '-->'] : ['/*', '*/'];
  if (open === '<!--') s = s.replace(/^<!doctype html[^>]*>/i, '').trimStart();
  const end = s.indexOf(close);
  return s.startsWith(open) && end > 0 ? s.slice(open.length, end) : '';
}

function headerProblems(rel) {
  const c = leadingComment(rel);
  if (!c) return 'does not start with the FormGhost header comment';
  const miss = [];
  if (!c.includes('github.com/mahtoaman/formghost')) miss.push(REPO);
  if (!COPYRIGHT.test(c) || !c.includes('@mahtoaman')) miss.push(`Copyright … ${OWNER}`);
  if (!APACHE.test(c)) miss.push('Licensed under the Apache License, Version 2.0');
  return miss.length ? `header is missing: ${miss.join(' | ')}` : '';
}

test('Attribution: every .js / .mjs / .css / .html file starts with the FormGhost copyright header', () => {
  const files = sources();
  for (const f of ['background.js', 'content/filler.js', 'content/qa.js', 'lib/persona.js', 'popup/popup.html', 'popup/popup.css', 'popup/popup.js', 'test/fixtures.html', 'test/attribution.test.mjs']) {
    assert.ok(files.includes(f), `${f} is checked (found ${files.length} source files)`);
  }
  const bad = files.map((f) => [f, headerProblems(f)]).filter(([, why]) => why).map(([f, why]) => `${f}: ${why}`);
  assert.deepEqual(bad, [], `Apache-2.0 §4(c): keep this header at the top of every source file:\n/*!\n * FormGhost - ${REPO}\n * Copyright 2026 ${OWNER}\n * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.\n */\n\n${bad.join('\n')}`);
});

test('Attribution: LICENSE is the unchanged Apache License 2.0 text', () => {
  assert.ok(has('LICENSE'), 'LICENSE is missing');
  const s = read('LICENSE');
  assert.match(s, /Apache License/, 'LICENSE names the Apache License');
  assert.match(s, /Version 2\.0/, 'LICENSE is Version 2.0');
  assert.equal(sha256(norm(s)), LICENSE_SHA256, 'LICENSE differs from https://www.apache.org/licenses/LICENSE-2.0.txt');
});

test("Attribution: NOTICE keeps FormGhost's copyright and attribution to Aman Mahto (@mahtoaman)", () => {
  assert.ok(has('NOTICE'), 'NOTICE is missing (Apache-2.0 §4(d))');
  const s = read('NOTICE');
  assert.match(s, /^FormGhost\n/, 'NOTICE starts with the product name');
  assert.ok(s.includes(OWNER), `NOTICE names ${OWNER}`);
  assert.match(s, COPYRIGHT, 'NOTICE has the copyright line');
  assert.ok(s.includes(`This product includes software developed by ${OWNER}`), 'NOTICE has the attribution sentence');
  assert.ok(s.includes(REPO), `NOTICE links ${REPO}`);
});

test('Attribution: manifest.json points to the project homepage', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.equal(m.homepage_url, REPO);
});

test('Attribution: the popup shows the @mahtoaman credit', () => {
  const visible = read('popup/popup.html').replace(/<!--[\s\S]*?-->/g, ''); // the header comment doesn't count
  assert.ok(visible.includes('@mahtoaman'), 'popup/popup.html shows "@mahtoaman" outside comments');
  assert.ok(visible.includes('https://github.com/mahtoaman'), 'popup/popup.html links to github.com/mahtoaman');
});

test('Attribution: Playwright and Cypress scripts exported by content/qa.js carry the FormGhost credit', () => {
  const win = { console, navigator: { language: 'en' } };
  win.window = win; win.self = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  vm.runInContext(read('content/qa.js'), ctx, { filename: 'content/qa.js' });
  const qa = ctx.__fgExt && ctx.__fgExt.qa;
  assert.equal(typeof (qa && qa.format), 'function', 'content/qa.js sets __fgExt.qa.format');
  const records = [{ selector: '#email', label: 'Email', cat: 'email', value: 'asha@example.com', kind: 'fill' }];
  for (const fmt of ['playwright', 'cypress']) {
    const out = String(qa.format(records, fmt, { url: 'https://example.com/form' }));
    assert.ok(out.includes('github.com/mahtoaman/formghost'), `${fmt} export credits ${REPO}:\n${out.split('\n').slice(0, 4).join('\n')}`);
  }
});

test('Attribution: CODEOWNERS makes @mahtoaman the owner of every file', () => {
  assert.ok(has('.github/CODEOWNERS'), '.github/CODEOWNERS is missing');
  assert.match(read('.github/CODEOWNERS'), /^\*\s+(?:\S+\s+)*@mahtoaman\b/m, 'a "* @mahtoaman" rule');
});

test('Attribution: README and the project docs credit Aman Mahto (@mahtoaman)', () => {
  assert.ok(has('README.md'), 'README.md is missing');
  for (const f of ['README.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'CHANGELOG.md'].filter(has)) {
    const s = read(f);
    assert.ok(s.includes('Aman Mahto') && s.includes('@mahtoaman') && s.includes('github.com/mahtoaman/formghost'), `${f} keeps the credit line`);
  }
});
