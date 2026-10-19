#!/usr/bin/env node
/*!
 * FormGhost - https://github.com/mahtoaman/formghost
 * Copyright 2026 Aman Mahto (@mahtoaman)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 */
/* Runs test/fixtures.html in headless Chrome and prints PASS/FAIL per check; exits 1 on any failure.
   Usage: node test/run.mjs [--fails] [case-id-prefix]     Chrome: $CHROME or the macOS default path.
   With CI set (GitHub Actions), Chrome runs with --no-sandbox: CI runners often can't start its sandbox (Ubuntu 24.04 restricts user namespaces). */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TIMEOUT = 150e3;
const argv = process.argv.slice(2);
const onlyFails = argv.includes('--fails');
const only = argv.find((a) => !a.startsWith('--'));
const page = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures.html')).href + (only ? '?only=' + encodeURIComponent(only) : '');

const die = (msg, detail) => { console.error('FAIL  ' + msg); if (detail) console.error(detail); process.exit(1); };
if (!existsSync(CHROME)) die(`Chrome not found at ${CHROME} (set CHROME=/path/to/chrome)`);

const profile = mkdtempSync(path.join(tmpdir(), 'formghost-test-'));
const args = ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--virtual-time-budget=30000', '--dump-dom',
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', ...(process.env.CI ? ['--no-sandbox'] : []), page];
let out = '', err = '', timedOut = false;
const status = await new Promise((resolve) => {
  const child = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, TIMEOUT);
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('error', (e) => { clearTimeout(timer); resolve(e); });
  child.on('close', (code) => { clearTimeout(timer); resolve(code); });
});
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
if (status instanceof Error) die(`could not start Chrome: ${status.message}`);

const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const title = unescape((out.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
const pre = (out.match(/<pre id="results"[^>]*>([\s\S]*?)<\/pre>/) || [])[1];
if (!/^FG-RESULT \d+\/\d+$/.test(title) || !pre) {
  die(`fixtures never reported a result (title ${JSON.stringify(title)}${timedOut ? ', Chrome killed after ' + TIMEOUT / 1e3 + 's' : ''}, exit ${status}).`
    + ' The harness or a script it loads crashed or hung.', err.trim().split('\n').slice(-15).join('\n'));
}
let data;
try { data = JSON.parse(unescape(pre)); } catch (e) { die('could not parse the results JSON: ' + e.message); }

let fails = 0;
const items = {};
for (const r of data.results) {
  const it = (items[r.item] = items[r.item] || [0, 0]);
  it[1]++;
  if (r.pass) it[0]++; else fails++;
  if (onlyFails && r.pass) continue;
  const runs = r.runs > 1 ? ` ×${r.runs}` : '';
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.case.padEnd(22)} ${r.check}${runs}`);
  if (!r.pass) console.log(`      expected: ${r.expected}\n      actual:   ${r.actual}`);
}
console.log('\n' + Object.entries(items).map(([k, [p, t]]) => `${k} ${p}/${t}`).join('  '));
if (typeof data.ms === 'number') console.log(`page time ${(data.ms / 1e3).toFixed(1)} s of the 29.7 s budget`);
console.log(`FG-RESULT ${data.pass}/${data.total}${data.reason !== 'done' ? ` (${data.reason})` : ''}${fails ? ` (${fails} failing)` : ''}`);
process.exit(fails || data.reason !== 'done' || data.pass !== data.total ? 1 : 0);
