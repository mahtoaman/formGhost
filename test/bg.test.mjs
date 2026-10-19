/*!
 * FormGhost - https://github.com/mahtoaman/formghost
 * Copyright 2026 Aman Mahto (@mahtoaman)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 */
/* Background tests (messages, menus, hotkeys and the popup's messages) against a stubbed chrome.*. Each frame's page is simulated:
   executeScript({ func, args }) runs func here with that frame's window / document / __formGhost / __fgExt, so the tests check what
   the background asks the page for, not how its injected functions are written. Run: node --test test/ */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = ['content/widgets.js', 'content/qa.js', 'content/overlay.js', 'content/filler.js']; // the order background.js injects them in
const COMMANDS = [{ name: 'fill-page', shortcut: '⌥⇧F' }, { name: 'fill-form', shortcut: '' }, { name: 'fill-field', shortcut: '' }, { name: 'undo-fill', shortcut: '' }];
const TABS = { 1: 'https://example.com/form', 2: 'https://other.org/signup', 3: 'https://shop.example.com/checkout', 4: 'https://blocked.org/x' };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 1500) { const end = Date.now() + ms; let v; while (!(v = await fn()) && Date.now() < end) await tick(5); return v; }
const plain = (x) => JSON.parse(JSON.stringify(x));
const norm = (f) => String(f).replace(/^\/+/, '');

/* a recording qa.format for the page side (the background may format in the page or itself) */
const QA_STUB = {
  v: 'test', kinds: [{ id: 'long', label: 'Long text' }],
  edge: () => 'x', file: () => null, card: () => '',
  format(records, fmt) {
    const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    if (fmt === 'json') return JSON.stringify(records);
    if (fmt === 'playwright') return records.map((r) => `await page.locator(${q(r.selector)}).fill(${q(r.value)});`).join('\n');
    return records.map((r) => `cy.get(${q(r.selector)}).clear().type(${q(r.value)});`).join('\n');
  },
};
/* one frame of a tab: __formGhost answers with opt.fill(frameId, P, o) / opt.records[frameId], and logs every call */
function fakePage(tabId, frameId, opt, meta) {
  const log = [];
  const fg = {
    v: '2.0.0',
    fill(P, o) {
      log.push(['fill', P, o, meta.call]);
      const r = typeof opt.fill === 'function' ? opt.fill(frameId, P, o, tabId) : opt.fill;
      return r === undefined ? { count: 0, used: {}, report: { filled: 0, skipped: {} } } : r;
    },
    undo(id) { log.push(['undo', id]); return 0; },
    inspect() { return []; },
    modal() { return null; },
    where() { return { path: [], real: false }; },
    records() { log.push(['records']); return (opt.records && opt.records[frameId]) || []; },
    overlay(on, o) { log.push(['overlay', on, o]); return true; },
    insertEdge(k) { log.push(['insertEdge', k]); return { count: 1, used: {} }; },
  };
  const document = { hasFocus: () => true, readyState: 'complete', querySelector: () => null, querySelectorAll: () => [], activeElement: null, body: {}, documentElement: {} };
  const win = { __formGhost: fg, __fgExt: { qa: QA_STUB, widgets: { v: 'test' }, overlay: { v: 'test', show() {}, hide() {} } }, document, location: { href: TABS[tabId] || 'https://example.com/' } };
  win.window = win; win.self = win; win.top = win;
  return { win, log, fg };
}
/* chrome.storage.sync with its real limits when quota is on: 8 KB an item, 100 KB in all */
function storageArea(mem, k, quota) {
  return {
    get: async (key) => (key == null ? structuredClone(mem[k])
      : typeof key === 'object' && !Array.isArray(key) ? Object.fromEntries(Object.entries(key).map(([x, d]) => [x, x in mem[k] ? structuredClone(mem[k][x]) : d]))
        : Object.fromEntries([].concat(key).filter((x) => x in mem[k]).map((x) => [x, structuredClone(mem[k][x])]))),
    set: async (o) => {
      if (quota && k === 'sync') {
        for (const [a, b] of Object.entries(o)) if (a.length + JSON.stringify(b).length > 8192) throw new Error(`QUOTA_BYTES_PER_ITEM quota exceeded (${a})`);
        const all = { ...mem[k], ...o };
        if (Object.entries(all).reduce((n, [a, b]) => n + a.length + JSON.stringify(b).length, 0) > 102400) throw new Error('QUOTA_BYTES quota exceeded');
      }
      for (const [a, b] of Object.entries(o)) mem[k][a] = structuredClone(b);
    },
    remove: async (key) => { for (const x of [].concat(key)) delete mem[k][x]; },
    clear: async () => { mem[k] = {}; },
    getBytesInUse: async () => JSON.stringify(mem[k]).length,
    QUOTA_BYTES_PER_ITEM: 8192, QUOTA_BYTES: 102400,
  };
}
function loadBg({ tabs = TABS, frames = [0], page = {}, mem, quota = false, commands = COMMANDS } = {}) {
  mem = mem || { sync: {}, local: {}, session: {} };
  const calls = [], menus = [], on = {}, badges = [], pages = new Map(), store = {}, meta = { call: -1 };
  const pageOf = (tabId, frameId) => { const k = `${tabId}:${frameId}`; if (!pages.has(k)) pages.set(k, fakePage(tabId, frameId, page, meta)); return pages.get(k); };
  let cur = null;
  const exec = async (o) => {
    calls.push(o);
    const t = o.target || {};
    if (!(t.tabId in tabs)) throw new Error(`No tab with id: ${t.tabId}.`);
    const ids = t.frameIds ? [...t.frameIds] : t.allFrames ? frames : [0];
    if (o.files) return ids.map((frameId) => ({ frameId, result: null }));
    // every frame runs at once, as in Chrome; a promise a frame returns is waited for
    const runs = ids.map((frameId) => {
      let result, error;
      cur = pageOf(t.tabId, frameId).win; meta.call = calls.indexOf(o);
      try { result = o.func(...(o.args || [])); } catch (e) { error = e.message; } finally { cur = null; }
      return Promise.resolve(result).then((x) => ({ frameId, result: error || x === undefined ? null : plain(x), ...(error ? { error } : {}) }), (e) => ({ frameId, result: null, error: e.message }));
    });
    return Promise.all(runs);
  };
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const ev = () => ({ addListener: () => {}, removeListener: () => {}, hasListener: () => false });
  const chrome = {
    storage: { sync: storageArea(mem, 'sync', quota), local: storageArea(mem, 'local'), session: storageArea(mem, 'session'), onChanged: ev() },
    tabs: { get: async (id) => { if (!(id in tabs)) throw new Error(`No tab with id: ${id}.`); return { id, url: tabs[id] }; }, query: async () => [], create: async (o) => o, onRemoved: ev(), onUpdated: ev(), onActivated: ev() },
    scripting: { executeScript: exec },
    commands: { getAll: async () => structuredClone(commands), onCommand: { addListener: (f) => (on.command = f) } },
    runtime: { id: 'test', getManifest: () => manifest, getURL: (p) => `chrome-extension://test/${p}`, onMessage: { addListener: (f) => (on.msg = f) }, onInstalled: { addListener: (f) => (on.installed = f) }, onStartup: ev() },
    action: { setBadgeText: async (o) => badges.push(['text', o.tabId, o.text]), setBadgeBackgroundColor: async () => {}, setBadgeTextColor: async () => {}, setTitle: async (o) => badges.push(['title', o.tabId, o.title]) },
    contextMenus: {
      removeAll: (cb) => { menus.length = 0; if (cb) cb(); return Promise.resolve(); },
      create: (o, cb) => { menus.push(o); if (cb) cb(); return o.id; },
      update: async () => {}, remove: async () => {},
      onClicked: { addListener: (f) => (on.menu = f) },
    },
  };
  const ctx = vm.createContext({
    chrome, console, URL, AbortController, structuredClone, navigator: { language: 'en-IN' }, clearTimeout,
    TextEncoder, TextDecoder, Blob, crypto: globalThis.crypto, btoa, atob,
    setTimeout: (f, ms, ...a) => setTimeout(f, ms >= 5000 && ms <= 60000 ? 50 : ms, ...a), // injection timeouts run in 50 ms
    fetch: async () => ({ ok: true, json: async () => ({ success: true, country_code: 'IN', country: 'India', region: 'Karnataka', city: 'Bengaluru' }) }),
  });
  ctx.self = ctx;
  /* page globals exist only while a func runs in a frame (a service worker has no window / document) */
  for (const k of ['window', 'document', '__formGhost', '__fgExt']) {
    Object.defineProperty(ctx, k, { configurable: true, get: () => (cur ? (k === 'window' ? cur : cur[k]) : store[k]), set: (v) => { if (cur) cur[k] = v; else store[k] = v; } });
  }
  ctx.importScripts = (...files) => files.forEach((f) => vm.runInContext(readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  vm.runInContext(readFileSync(path.join(ROOT, 'background.js'), 'utf8'), ctx, { filename: 'background.js' });
  // sender: the popup's ({}) unless given (a content script's: { tab: { id }, url, frameId })
  const send = (msg, ms = 3000, sender = {}) => new Promise((res) => {
    const t = setTimeout(() => res({ timedOut: true }), ms);
    const r = on.msg(msg, sender, (x) => { clearTimeout(t); res(x === undefined ? undefined : plain(x)); });
    if (r !== true && r && typeof r.then === 'function') r.then((x) => { if (x !== undefined) { clearTimeout(t); res(plain(x)); } });
  });
  const logOf = (tabId, frameId) => pageOf(tabId, frameId).log;
  const fills = (tabId, frameId) => logOf(tabId, frameId).filter((x) => x[0] === 'fill');
  const lastOpts = (tabId, frameId = 0) => { const f = fills(tabId, frameId).at(-1); return f ? f[2] : null; };
  const menu = async (info, tab) => { const r = on.menu(info, tab); if (r && typeof r.then === 'function') await r; await tick(40); };
  return { mem, calls, menus, on, badges, send, logOf, fills, lastOpts, menu, ctx };
}
const installMenus = async (B) => { assert.equal(typeof B.on.installed, 'function', 'onInstalled listener'); B.on.installed({ reason: 'install' }); await tick(40); };
const has = (list, want) => (list || []).some((x) => Object.entries(want).every(([k, v]) => x && x[k] === v));

/* ---------------- injection order, frame results, report ---------------- */
test('a page fill injects widgets / qa / overlay / filler in that order into every frame, before the fill runs', async () => {
  const B = loadBg({ frames: [0, 3], page: { fill: { count: 1, used: {}, report: { filled: 1, skipped: {} } } } });
  const r = await B.send({ type: 'fill', tabId: 1 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const fileCalls = B.calls.filter((c) => c.files);
  assert.deepEqual(fileCalls.flatMap((c) => c.files.map(norm)), CONTENT, 'files injected, in order');
  assert.ok(fileCalls.every((c) => c.target.allFrames === true), 'into every frame');
  assert.equal(B.fills(1, 0).length + B.fills(1, 3).length, 2, 'each frame filled once');
  const lastFile = B.calls.lastIndexOf(fileCalls.at(-1));
  assert.ok(B.fills(1, 0).concat(B.fills(1, 3)).every((f) => f[3] > lastFile), 'the files go in before the page is asked to fill');
});

test('a menu-targeted fill injects the same files, in order, into the clicked frame only', async () => {
  const B = loadBg({ frames: [0, 7], page: { fill: { count: 1, used: { fieldKey: 'k1' }, report: { filled: 1, skipped: {} } } } });
  await B.menu({ menuItemId: 'fg-fill-form', frameId: 7, editable: true, pageUrl: TABS[1] }, { id: 1, url: TABS[1] });
  const fileCalls = B.calls.filter((c) => c.files);
  assert.deepEqual(fileCalls.flatMap((c) => c.files.map(norm)), CONTENT);
  assert.ok(fileCalls.every((c) => JSON.stringify(c.target.frameIds) === '[7]' && !c.target.allFrames), JSON.stringify(fileCalls.map((c) => c.target)));
  assert.equal(B.fills(1, 7).length, 1); assert.equal(B.fills(1, 0).length, 0);
});

test('async frame results are summed and their reports merged: { filled, skipped: { reason: n } }', async () => {
  const reports = { 0: { count: 2, used: {}, report: { filled: 2, skipped: { card: 1 } } }, 3: { count: 1, used: {}, report: { filled: 1, skipped: { card: 2, code: 1 } } }, 5: 0 };
  const B = loadBg({ frames: [0, 3, 5, 6], page: { fill: (f) => (f === 6 ? Promise.resolve(null) : new Promise((r) => setTimeout(() => r(reports[f]), 20))) } });
  const r = await B.send({ type: 'fill', tabId: 1 });
  assert.deepEqual([r.ok, r.count], [true, 3]);
  assert.ok(r.report && typeof r.report === 'object', `a report in the reply: ${JSON.stringify(r)}`);
  assert.equal(r.report.filled, 3);
  assert.deepEqual(plain(r.report.skipped), { card: 3, code: 1 });
});

/* ---------------- settings ---------------- */
test('edgeMode / sampleFiles / testCards default to false and reach the filler; a change reaches it too', async () => {
  const B = loadBg({ page: { fill: { count: 1, used: {} } } });
  const st = await B.send({ type: 'state', tabId: 1 });
  assert.deepEqual([st.settings.edgeMode, st.settings.sampleFiles, st.settings.testCards], [false, false, false]);
  await B.send({ type: 'fill', tabId: 1 });
  let o = B.lastOpts(1);
  assert.deepEqual([o.edgeMode, o.sampleFiles, o.testCards], [false, false, false]);
  await B.send({ type: 'setSettings', tabId: 1, patch: { edgeMode: true, sampleFiles: true, testCards: true } });
  await B.send({ type: 'fill', tabId: 1 });
  o = B.lastOpts(1);
  assert.deepEqual([o.edgeMode, o.sampleFiles, o.testCards], [true, true, true]);
});

const RULE = (id, site, match, value, on = true) => ({ id, site, match, value, on });
const rulesOf = async (B, tabId = 1) => { await B.send({ type: 'fill', tabId }); const o = B.lastOpts(tabId) || {}; return (o.rules || []).map((r) => ({ match: r.match, value: r.value })); };

test('setRules: the filler gets only this site\'s enabled rules ({ match, value })', async () => {
  const B = loadBg({ page: { fill: { count: 1, used: {} } } });
  const r = await B.send({ type: 'setRules', rules: [RULE('r1', 'example.com', '#email', '{{email}}'), RULE('r2', 'example.com', '/coupon/i', 'FG10'), RULE('r3', 'example.com', 'name=promo', 'X'),
    RULE('r4', 'example.com', 'label=Favourite colour', 'Blue', false), RULE('r5', 'other.org', '#x', 'Z')] });
  assert.ok(r && r.ok !== false, JSON.stringify(r));
  const mine = await rulesOf(B, 1);
  for (const m of ['#email', '/coupon/i', 'name=promo']) assert.ok(mine.some((x) => x.match === m), `${m} reaches example.com (got ${JSON.stringify(mine)})`);
  assert.ok(!mine.some((x) => x.match === 'label=Favourite colour'), 'a rule turned off stays home');
  assert.ok(!mine.some((x) => x.match === '#x'), 'another site\'s rule stays home');
  assert.equal(mine.find((x) => x.match === '#email').value, '{{email}}', 'templates go to the page as written');
  const theirs = await rulesOf(B, 2);
  assert.deepEqual(theirs.map((x) => x.match), ['#x']);
});

for (const [why, bad] of [
  ['an invalid CSS selector', RULE('b1', 'example.com', 'div[', 'v')], ['an unclosed attribute selector', RULE('b2', 'example.com', 'input[name="x"', 'v')],
  ['a regex that does not compile', RULE('b3', 'example.com', '/(ab/i', 'v')], ['a catastrophic regex (a+)+', RULE('b4', 'example.com', '/(a+)+$/', 'v')],
  ['a catastrophic regex (\\w+\\s?)*', RULE('b5', 'example.com', '/(\\w+\\s?)*$/', 'v')], ['an over-long regex', RULE('b6', 'example.com', '/' + 'a'.repeat(5000) + '/', 'v')],
  ['a value over 2000 characters', RULE('b7', 'example.com', '#long', 'x'.repeat(2001))], ['an empty match', RULE('b8', 'example.com', '', 'v')],
  ['a non-boolean on', { ...RULE('b10', 'example.com', '#on', 'v'), on: 'yes' }], ['an object value', RULE('b11', 'example.com', '#obj', { toString: 'x' })],
  // alternatives that overlap through a class (8 s on 26 digits + '!')
  ['a catastrophic regex (\\w|\\d)+$', RULE('b12', 'example.com', '/(\\w|\\d)+$/', 'v')], ['a catastrophic regex (\\d|\\w)*x', RULE('b13', 'example.com', '/(\\d|\\w)*x/', 'v')],
  ['a catastrophic regex ([a-z]|_)+$', RULE('b14', 'example.com', '/([a-z]|_)+$/', 'v')], ['a catastrophic regex (.|x)*y', RULE('b15', 'example.com', '/(.|x)*y/', 'v')],
]) {
  test(`setRules rejects ${why} (it never reaches the page)`, async () => {
    const B = loadBg({ page: { fill: { count: 1, used: {} } } });
    const r = await B.send({ type: 'setRules', rules: [bad] });
    assert.ok(r !== undefined && !r.timedOut, 'setRules answers');
    const mine = await rulesOf(B, 1);
    assert.ok(!mine.some((x) => x.match === bad.match), `${JSON.stringify(bad.match).slice(0, 40)} reached the filler (reply ${JSON.stringify(r).slice(0, 200)})`);
  });
}

test('setRules: a numeric value reaches the page as a string, or not at all', async () => {
  const B = loadBg({ page: { fill: { count: 1, used: {} } } });
  await B.send({ type: 'setRules', rules: [RULE('n1', 'example.com', '#num', 42)] });
  const hit = (await rulesOf(B, 1)).find((x) => x.match === '#num');
  assert.ok(!hit || hit.value === '42', JSON.stringify(hit));
});

test('a value of exactly 2000 characters and the usual selectors / regexes / name= / id= / label= are accepted', async () => {
  const B = loadBg({ page: { fill: { count: 1, used: {} } } });
  const ok = [RULE('a1', 'example.com', '#a', 'y'.repeat(2000)), RULE('a2', 'example.com', 'form .row > input:nth-of-type(2)', 'v'), RULE('a3', 'example.com', 'input[name="email"]', 'v'),
    RULE('a4', 'example.com', '/pin ?code/i', 'v'), RULE('a5', 'example.com', 'id=nick', 'v'), RULE('a6', 'example.com', 'label=Pet name', 'v')];
  await B.send({ type: 'setRules', rules: ok });
  const mine = await rulesOf(B, 1);
  for (const r of ok) assert.ok(mine.some((x) => x.match === r.match && x.value === r.value), `${r.match} kept`);
});

test('at most 300 rules are kept', async () => {
  const B = loadBg({ page: { fill: { count: 1, used: {} } } });
  const r = await B.send({ type: 'setRules', rules: Array.from({ length: 301 }, (_, i) => RULE(`c${i}`, 'example.com', `#f${i}`, `v${i}`)) });
  const mine = await rulesOf(B, 1);
  assert.ok(mine.length <= 300, `${mine.length} rules reach the page (reply ok ${r && r.ok})`);
});

test('300 long rules outgrow chrome.storage.sync\'s 8 KB items: kept anyway (own keys or storage.local), and after a restart', async () => {
  const mem = { sync: {}, local: {}, session: {} };
  const B = loadBg({ mem, quota: true, page: { fill: { count: 1, used: {} } } });
  const rules = Array.from({ length: 300 }, (_, i) => RULE(`q${i}`, 'example.com', `#field-${i}`, `${i}:` + 'v'.repeat(1500)));
  const r = await B.send({ type: 'setRules', rules });
  assert.ok(r && r.ok !== false, `setRules ok (${JSON.stringify(r).slice(0, 200)})`);
  assert.equal((await rulesOf(B, 1)).length, 300, 'all 300 reach the page');
  for (const [k, v] of Object.entries(mem.sync)) assert.ok(k.length + JSON.stringify(v).length <= 8192, `sync item ${k} is over 8 KB`);
  const B2 = loadBg({ mem, quota: true, page: { fill: { count: 1, used: {} } } });
  assert.equal((await rulesOf(B2, 1)).length, 300, 'a restarted worker still has them');
});

/* ---------------- context menu ---------------- */
const FIELD_AS = [
  [/^full name$/i, ['fullName']], [/^first name$/i, ['firstName']], [/^last name$/i, ['lastName']], [/^e-?mail$/i, ['email']], [/^phone$/i, ['phone']],
  [/^address$/i, ['address1', 'address', 'fullAddress']], [/^city$/i, ['city']], [/^state$/i, ['state']], [/^pin ?\/ ?zip( code)?$|^zip ?\/ ?pin/i, ['zip']],
  [/^date of birth$/i, ['dob']], [/^company$/i, ['company']], [/^job title$/i, ['jobTitle']], [/^number$/i, ['number']], [/^text$/i, ['text', 'message', 'other']],
  [/^skip this field$/i, ['skip']],
];
const parentOf = (B, re) => B.menus.find((m) => re.test(String(m.title)) && !m.parentId);
const kidsOf = (B, p) => B.menus.filter((m) => p && m.parentId === p.id);

test('editable context menu has "Fill field as ▸" (the 15 types + Forget this field) and "Insert test value ▸"; the old items stay', async () => {
  const B = loadBg();
  await installMenus(B);
  const ids = B.menus.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, 'menu ids are unique');
  for (const id of ['fg-fill', 'fg-fill-form', 'fg-fill-field', 'fg-undo']) assert.ok(ids.includes(id), `${id} kept`);
  const fa = parentOf(B, /^fill field as/i), it = parentOf(B, /^insert test value/i);
  assert.ok(fa, `"Fill field as" missing (titles ${B.menus.map((m) => m.title)})`);
  assert.ok(it, '"Insert test value" missing');
  for (const p of [fa, it]) assert.deepEqual([...(p.contexts || [])], ['editable'], `${p.title} contexts`);
  const kids = kidsOf(B, fa).map((m) => String(m.title));
  for (const [re] of FIELD_AS) assert.ok(kids.some((t) => re.test(t)), `Fill field as ▸ ${re} (have ${kids.join(', ')})`);
  assert.ok(kids.some((t) => /^forget this field$/i.test(t)), 'Forget this field');
  assert.ok(kidsOf(B, it).length >= 6, `Insert test value has the qa kinds (${kidsOf(B, it).map((m) => m.title)})`);
});

test('each "Fill field as" type fills the clicked frame\'s field with forceType and remembers it for the site; Forget removes it', async () => {
  let key = 'k0';
  const B = loadBg({ frames: [0, 7], page: { fill: (f, P, o) => (o.scope === 'field' ? { count: o.forceType === 'skip' ? 0 : 1, used: { fieldKey: key }, report: { filled: 1, skipped: {} } } : { count: 2, used: {}, report: { filled: 2, skipped: {} } }) } });
  await installMenus(B);
  const kids = kidsOf(B, parentOf(B, /^fill field as/i));
  const want = [];
  for (const [i, [re, types]] of FIELD_AS.entries()) {
    const item = kids.find((m) => re.test(String(m.title)));
    if (!item) { assert.fail(`no item for ${re}`); continue; }
    key = `key-${i}`;
    const before = B.fills(1, 7).length;
    await B.menu({ menuItemId: item.id, parentMenuItemId: item.parentId, frameId: 7, editable: true, pageUrl: TABS[1] }, { id: 1, url: TABS[1] });
    await until(() => B.fills(1, 7).length > before);
    const o = B.lastOpts(1, 7);
    assert.ok(o, `${item.title}: frame 7 filled`);
    assert.deepEqual([o.scope, o.frameTargeted], ['field', true], `${item.title}: a targeted field fill`);
    assert.ok(types.includes(o.forceType), `${item.title}: forceType ${JSON.stringify(o.forceType)}, want ${types.join(' | ')}`);
    want.push({ key, type: o.forceType });
  }
  assert.equal(B.fills(1, 0).length, 0, 'other frames are not filled');
  await tick(20);
  await B.send({ type: 'fill', tabId: 1 });
  const ov = B.lastOpts(1, 0).overrides || [];
  for (const w of want) assert.ok(has(ov, w), `override ${JSON.stringify(w)} reaches the next fill on the site (got ${JSON.stringify(ov).slice(0, 300)})`);
  await B.send({ type: 'fill', tabId: 3 }); // shop.example.com: the same site
  assert.ok(has(B.lastOpts(3, 0).overrides, want[3]), 'the same site (another subdomain) gets them too');
  await B.send({ type: 'fill', tabId: 2 });
  assert.ok(!has(B.lastOpts(2, 0).overrides, { key: want[3].key }), 'another site does not');
  key = want[3].key;
  const forget = kidsOf(B, parentOf(B, /^fill field as/i)).find((m) => /^forget this field$/i.test(String(m.title)));
  await B.menu({ menuItemId: forget.id, parentMenuItemId: forget.parentId, frameId: 7, editable: true, pageUrl: TABS[1] }, { id: 1, url: TABS[1] });
  await tick(20);
  await B.send({ type: 'fill', tabId: 1 });
  assert.ok(!has(B.lastOpts(1, 0).overrides, { key: want[3].key }), 'Forget this field removes that key\'s override');
  assert.ok(has(B.lastOpts(1, 0).overrides, want[4]), 'and only that one');
});

test('removeOverride { site, key } forgets one remembered field', async () => {
  const B = loadBg({ frames: [0, 7], page: { fill: (f, P, o) => (o.scope === 'field' ? { count: 1, used: { fieldKey: 'name:notes' } } : { count: 1, used: {} }) } });
  await installMenus(B);
  const email = kidsOf(B, parentOf(B, /^fill field as/i)).find((m) => /^e-?mail$/i.test(String(m.title)));
  await B.menu({ menuItemId: email.id, parentMenuItemId: email.parentId, frameId: 7, editable: true, pageUrl: TABS[1] }, { id: 1, url: TABS[1] });
  await tick(20);
  await B.send({ type: 'fill', tabId: 1 });
  assert.ok(has(B.lastOpts(1, 0).overrides, { key: 'name:notes', type: 'email' }), 'remembered');
  const r = await B.send({ type: 'removeOverride', site: 'example.com', key: 'name:notes' });
  assert.ok(r && r.ok !== false, JSON.stringify(r));
  await B.send({ type: 'fill', tabId: 1 });
  assert.ok(!has(B.lastOpts(1, 0).overrides, { key: 'name:notes' }), 'forgotten');
});

/* the qa kinds as content/qa.js lists them (loaded into a bare window), or null when it can't load outside a page */
function qaKinds() {
  try {
    const win = { console, navigator: { language: 'en' } }; win.window = win; win.self = win;
    const c = vm.createContext(win);
    vm.runInContext(readFileSync(path.join(ROOT, 'content/qa.js'), 'utf8'), c);
    const k = c.__fgExt && c.__fgExt.qa && c.__fgExt.qa.kinds;
    return Array.isArray(k) ? k.map((x) => x.id) : null;
  } catch (e) { return null; }
}
test('each "Insert test value" item calls insertEdge(kind) in the clicked frame only, with one of qa.kinds', async () => {
  const B = loadBg({ frames: [0, 7] });
  await installMenus(B);
  const kids = kidsOf(B, parentOf(B, /^insert test value/i)), kinds = qaKinds(), seen = [];
  assert.ok(kids.length >= 6);
  for (const item of kids) {
    const before = B.logOf(1, 7).filter((x) => x[0] === 'insertEdge').length;
    await B.menu({ menuItemId: item.id, parentMenuItemId: item.parentId, frameId: 7, editable: true, pageUrl: TABS[1] }, { id: 1, url: TABS[1] });
    const got = await until(() => B.logOf(1, 7).filter((x) => x[0] === 'insertEdge').length > before);
    assert.ok(got, `${item.title}: insertEdge called in frame 7`);
    const k = B.logOf(1, 7).filter((x) => x[0] === 'insertEdge').at(-1)[1];
    assert.ok(typeof k === 'string' && k, `${item.title}: kind ${JSON.stringify(k)}`);
    if (kinds) assert.ok(kinds.includes(k), `${item.title}: ${k} is one of qa.kinds (${kinds.join(', ')})`);
    seen.push(k);
  }
  assert.equal(new Set(seen).size, seen.length, 'each item its own kind');
  assert.equal(B.logOf(1, 0).filter((x) => x[0] === 'insertEdge').length, 0, 'frame 0 untouched');
  const fileCalls = B.calls.filter((c) => c.files);
  assert.ok(fileCalls.length && fileCalls.every((c) => JSON.stringify(c.target.frameIds) === '[7]'), 'the modules are injected into frame 7 first');
});

/* ---------------- inspect, copyFill, export / import, bulk export ---------------- */
test('inspect { on } turns the overlay on / off in every frame', async () => {
  const B = loadBg({ frames: [0, 3] });
  let r = await B.send({ type: 'inspect', tabId: 1, on: true });
  assert.ok(r && r.ok !== false && !r.timedOut, JSON.stringify(r));
  for (const f of [0, 3]) assert.deepEqual(B.logOf(1, f).filter((x) => x[0] === 'overlay').map((x) => x[1]), [true], `frame ${f}`);
  r = await B.send({ type: 'inspect', tabId: 1, on: false });
  for (const f of [0, 3]) assert.deepEqual(B.logOf(1, f).filter((x) => x[0] === 'overlay').map((x) => x[1]), [true, false], `frame ${f}`);
});

test('copyFill { format } formats records() of the frames that filled last (json / playwright / cypress)', async () => {
  const records = {
    0: [{ selector: '#email', label: 'Email', cat: 'email', value: "o'neil@example.com", kind: 'fill' }, { selector: '#terms', label: 'I agree', cat: 'checkbox', value: 'true', kind: 'check' }],
    3: [{ selector: '#stale', label: 'Old', cat: 'city', value: 'Pune', kind: 'fill' }], // an older fill in frame 3; its last fill changed nothing
  };
  const B = loadBg({ frames: [0, 3], page: { records, fill: (f) => (f === 0 ? { count: 2, used: {}, report: { filled: 2, skipped: {} } } : { count: 0, used: {}, report: { filled: 0, skipped: {} } }) } });
  await B.send({ type: 'fill', tabId: 1 });
  let r = await B.send({ type: 'copyFill', tabId: 1, format: 'json' });
  assert.ok(r && r.ok === true && typeof r.text === 'string', JSON.stringify(r));
  const arr = JSON.parse(r.text);
  assert.ok(Array.isArray(arr), 'a JSON array');
  assert.deepEqual(arr.map((x) => x.selector), ['#email', '#terms']);
  for (const [fmt, re] of [['playwright', /page\.locator\(/], ['cypress', /cy\.get\(/]]) {
    r = await B.send({ type: 'copyFill', tabId: 1, format: fmt });
    assert.ok(r && r.ok === true, `${fmt}: ${JSON.stringify(r)}`);
    assert.match(r.text, re, fmt);
    assert.ok(r.text.includes('#email') && !r.text.includes('#stale'), `${fmt}: only the frame that filled last: ${r.text}`);
  }
});

const settingsLike = (o) => o && typeof o === 'object' && !Array.isArray(o) && Array.isArray(o.blocked);
function findDeep(o, pred, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 4) return null;
  if (pred(o)) return o;
  for (const v of Object.values(o)) { const x = findDeep(v, pred, depth + 1); if (x) return x; }
  return null;
}
async function configured() {
  const B = loadBg({ frames: [0, 7], page: { fill: (f, P, o) => (o.scope === 'field' ? { count: 1, used: { fieldKey: 'name:notes' } } : { count: 2, used: {}, report: { filled: 2, skipped: {} } }) } });
  await installMenus(B);
  await B.send({ type: 'setSettings', tabId: 1, patch: { emailDomain: 'example.com', overwrite: true, edgeMode: true, sampleFiles: true, testCards: true, requiredOnly: true } });
  await B.send({ type: 'blockSite', tabId: 4, block: true });
  await B.send({ type: 'setRules', rules: [RULE('r1', 'example.com', '#a', 'A {{firstName}}'), RULE('r2', 'other.org', '#b', 'B')] });
  const email = kidsOf(B, parentOf(B, /^fill field as/i)).find((m) => /^e-?mail$/i.test(String(m.title)));
  await B.menu({ menuItemId: email.id, parentMenuItemId: email.parentId, frameId: 7, editable: true, pageUrl: TABS[1] }, { id: 1, url: TABS[1] });
  await tick(20);
  await B.send({ type: 'fill', tabId: 1 }); // history
  return B;
}
const exportText = async (B, msg = {}) => { const r = await B.send({ type: 'exportSettings', ...msg }); assert.ok(r && r.ok === true, `exportSettings: ${JSON.stringify(r).slice(0, 200)}`); return typeof r.json === 'string' ? r.json : JSON.stringify(r.json); };
const KEYS = ['emailDomain', 'overwrite', 'edgeMode', 'sampleFiles', 'testCards', 'requiredOnly', 'blocked'];
const pick = (s) => Object.fromEntries(KEYS.map((k) => [k, s && s[k]]));
async function siteView(B) {
  await B.send({ type: 'fill', tabId: 1 });
  const o = B.lastOpts(1, 0) || {};
  return { rules: (o.rules || []).map((r) => [r.match, r.value]), overrides: (o.overrides || []).map((r) => [r.key, r.type]), settings: pick((await B.send({ type: 'state', tabId: 1 })).settings) };
}

test('exportSettings → importSettings (replace) round-trips settings, rules and remembered fields into a fresh install', async () => {
  const A = await configured(), text = await exportText(A);
  JSON.parse(text);
  const want = await siteView(A);
  assert.ok(want.rules.length && want.overrides.length && want.settings.blocked.length, `the export has something in it: ${JSON.stringify(want)}`);
  const B = loadBg({ frames: [0, 7], page: { fill: { count: 1, used: {} } } });
  const r = await B.send({ type: 'importSettings', json: text, mode: 'replace' });
  assert.ok(r && r.ok === true, `import: ${JSON.stringify(r).slice(0, 300)}`);
  assert.ok(r.summary, 'a summary for the popup');
  assert.deepEqual(await siteView(B), want);
});

test('history goes into the export only with includeHistory, and comes back with the import', async () => {
  const A = await configured(), h = A.mem.local.history && A.mem.local.history[0] && A.mem.local.history[0].persona;
  assert.ok(h && h.email, 'a fill made a history entry');
  assert.ok(!(await exportText(A)).includes(h.email), 'no persona without includeHistory');
  const text = await exportText(A, { includeHistory: true });
  assert.ok(text.includes(h.email), 'the persona with includeHistory');
  const B = loadBg();
  const r = await B.send({ type: 'importSettings', json: text, mode: 'replace' });
  assert.ok(r && r.ok === true, JSON.stringify(r).slice(0, 300));
  assert.ok((await B.send({ type: 'state', tabId: 1 })).history.some((x) => x.id === h.id), 'the imported history is listed');
});

test('importSettings merge keeps this install\'s rules and adds the file\'s; replace drops them', async () => {
  const text = await exportText(await configured());
  for (const [mode, keep] of [['merge', true], ['replace', false]]) {
    const B = loadBg({ page: { fill: { count: 1, used: {} } } });
    await B.send({ type: 'setRules', rules: [RULE('mine', 'example.com', '#mine', 'M')] });
    const r = await B.send({ type: 'importSettings', json: text, mode });
    assert.ok(r && r.ok === true, `${mode}: ${JSON.stringify(r).slice(0, 300)}`);
    const rules = await rulesOf(B, 1);
    assert.ok(rules.some((x) => x.match === '#a'), `${mode}: the file's rule is there`);
    assert.equal(rules.some((x) => x.match === '#mine'), keep, `${mode}: this install's own rule ${keep ? 'kept' : 'dropped'}`);
  }
});

/* hostile files: each is refused as a whole, nothing changes and nothing is polluted */
const HOSTILE = [
  ['not JSON', () => 'not json {'], ['a JSON array', () => '[]'], ['JSON null', () => 'null'], ['a JSON string', () => '"settings"'],
  ['__proto__ at the top', (t) => t.replace(/^\s*\{/, '{"__proto__":{"polluted":"yes"},')],
  ['__proto__ in the settings', (t) => { const o = JSON.parse(t), s = findDeep(o, settingsLike); Object.defineProperty(s, '__proto__', { value: { polluted: 'yes' }, enumerable: true, configurable: true, writable: true }); return JSON.stringify(o); }],
  ['constructor.prototype in the settings', (t) => { const o = JSON.parse(t); findDeep(o, settingsLike).constructor = { prototype: { polluted: 'yes' } }; return JSON.stringify(o); }],
  ['prototype in a rule', (t) => { const o = JSON.parse(t), r = findDeep(o, (x) => x.match === '#a'); r.prototype = { polluted: 'yes' }; return JSON.stringify(o); }],
  ['an unknown settings key', (t) => { const o = JSON.parse(t); findDeep(o, settingsLike).evalMe = 'alert(1)'; return JSON.stringify(o); }],
  ['an unknown top-level key', (t) => { const o = JSON.parse(t); o.payload = { x: 1 }; return JSON.stringify(o); }],
  ['overwrite as a string', (t) => { const o = JSON.parse(t); findDeep(o, settingsLike).overwrite = 'yes'; return JSON.stringify(o); }],
  ['blocked as a string', (t) => { const o = JSON.parse(t); findDeep(o, settingsLike).blocked = 'example.com'; return JSON.stringify(o); }],
  ['a rule with a catastrophic regex', (t) => { const o = JSON.parse(t); findDeep(o, (x) => x.match === '#a').match = '/(a+)+$/'; return JSON.stringify(o); }],
  ['a rule value over 2000 characters', (t) => { const o = JSON.parse(t); findDeep(o, (x) => x.match === '#a').value = 'x'.repeat(5000); return JSON.stringify(o); }],
  ['rules as an object', (t) => { const o = JSON.parse(t), p = findDeep(o, (x) => Array.isArray(x.rules)); p.rules = { 0: p.rules[0] }; return JSON.stringify(o); }],
  ['an override with a numeric type', (t) => { const o = JSON.parse(t), r = findDeep(o, (x) => x.key === 'name:notes'); r.type = 42; return JSON.stringify(o); }],
];
for (const [why, make] of HOSTILE) {
  test(`importSettings refuses ${why} and changes nothing`, async () => {
    const A = await configured(), base = await exportText(A);
    let text;
    try { text = make(base); } catch (e) { assert.fail(`the export has no place for this (${e.message}): ${base.slice(0, 300)}`); }
    const B = loadBg({ page: { fill: { count: 1, used: {} } } });
    await B.send({ type: 'setRules', rules: [RULE('mine', 'example.com', '#mine', 'M')] });
    await B.send({ type: 'setSettings', tabId: 1, patch: { emailDomain: 'mine.test' } });
    const before = await siteView(B);
    for (const mode of ['merge', 'replace']) {
      const r = await B.send({ type: 'importSettings', json: text, mode });
      assert.ok(r && r.ok === false, `${mode}: refused (got ${JSON.stringify(r).slice(0, 200)})`);
    }
    assert.equal(vm.runInContext('({}).polluted', B.ctx), undefined, 'the worker\'s Object.prototype is clean');
    assert.equal(({}).polluted, undefined);
    assert.deepEqual(await siteView(B), before, 'nothing changed');
  });
}

/* remembered fields in an export: { site: [{ key, type }] } wherever the export keeps them */
const overridesIn = (text) => { const o = JSON.parse(text), m = findDeep(o, (x) => Object.values(x).some((v) => Array.isArray(v) && v.some((y) => y && typeof y.key === 'string' && typeof y.type === 'string'))); return m || {}; };
test('remembered fields are capped at 200 a site and 2000 in all (an import over the caps is refused or trimmed)', async () => {
  const base = await exportText(await configured()), o = JSON.parse(base), map = findDeep(o, (x) => Array.isArray(x['example.com']) && x['example.com'].some((y) => y && y.key === 'name:notes'));
  assert.ok(map, 'the export keeps remembered fields by site');
  map['example.com'] = Array.from({ length: 250 }, (_, i) => ({ key: `k${i}`, type: 'email' }));
  for (let s = 0; s < 11; s++) map[`site${s}.com`] = Array.from({ length: 190 }, (_, i) => ({ key: `s${s}k${i}`, type: 'city' }));
  const B = loadBg({ page: { fill: { count: 1, used: {} } } });
  const r = await B.send({ type: 'importSettings', json: JSON.stringify(o), mode: 'replace' });
  assert.ok(r && !r.timedOut, 'answers');
  if (r.ok === false) return;
  const after = overridesIn(await exportText(B)), sizes = Object.values(after).map((v) => (Array.isArray(v) ? v.length : 0));
  assert.ok((after['example.com'] || []).length <= 200, `example.com keeps ${(after['example.com'] || []).length}`);
  assert.ok(sizes.reduce((a, b) => a + b, 0) <= 2000, `${sizes.reduce((a, b) => a + b, 0)} in all`);
  await B.send({ type: 'fill', tabId: 1 });
  assert.ok((B.lastOpts(1, 0).overrides || []).length <= 200, 'the page gets at most 200');
});

/* RFC 4180 CSV */
function csvRows(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}
test('bulkExport json: raw generated personas of the country, after withPrefs', async () => {
  const B = loadBg();
  await B.send({ type: 'setSettings', tabId: 1, patch: { emailDomain: 'example.com' } });
  const r = await B.send({ type: 'bulkExport', count: 25, format: 'json', country: 'IN' }, 10000);
  assert.ok(r && r.ok === true && typeof r.text === 'string', JSON.stringify(r).slice(0, 200));
  const list = JSON.parse(r.text);
  assert.equal(list.length, 25);
  assert.ok(list.every((p) => p.country === 'IN' && /@example\.com$/.test(p.email) && p.dob && p.phone), 'IN personas with the email domain applied');
  assert.equal(new Set(list.map((p) => p.id || p.email)).size, 25, 'distinct personas');
  const us = JSON.parse((await B.send({ type: 'bulkExport', count: 3, format: 'json', country: 'US' }, 10000)).text);
  assert.ok(us.length === 3 && us.every((p) => p.country === 'US'));
});

test('bulkExport csv: a header of flattened common columns and one row per persona', async () => {
  const B = loadBg();
  const r = await B.send({ type: 'bulkExport', count: 40, format: 'csv', country: 'IN' }, 10000);
  assert.ok(r && r.ok === true && typeof r.text === 'string', JSON.stringify(r).slice(0, 200));
  const rows = csvRows(r.text), head = rows[0].map((h) => h.trim());
  for (const re of [/first.?name/i, /last.?name/i, /e-?mail/i, /phone|mobile/i, /city/i, /state/i, /zip|pin|postal/i, /dob|birth/i]) assert.ok(head.some((h) => re.test(h)), `a ${re} column in ${head.join(', ')}`);
  assert.equal(rows.length, 41, 'header + 40 rows');
  assert.ok(rows.every((x) => x.length === head.length), 'every row has every column');
  const em = head.findIndex((h) => /e-?mail/i.test(h) && !/alt/i.test(h));
  assert.ok(rows.slice(1).every((x) => /^[^@\s]+@[^@\s]+\.[a-z.]+$/i.test(x[em])), 'emails in the email column');
  assert.ok(!/\[object Object\]|undefined|NaN/.test(r.text), 'flattened, no object / undefined text');
});

test('bulkExport caps the count at 500', async () => {
  const B = loadBg();
  const r = await B.send({ type: 'bulkExport', count: 501, format: 'json', country: 'IN' }, 20000);
  assert.ok(r && !r.timedOut, 'answers');
  assert.ok(r.ok === false || JSON.parse(r.text).length <= 500, `${r.ok ? JSON.parse(r.text).length : 'refused'}`);
});

/* ---------------- manifest ---------------- */
test('manifest 2.0.0, no new permissions, no static content scripts; every injected file exists', () => {
  const m = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(m.version, '2.0.0');
  assert.deepEqual([...m.permissions].sort(), ['activeTab', 'contextMenus', 'scripting', 'storage']);
  assert.deepEqual([...m.host_permissions].sort(), ['https://api.country.is/*', 'https://get.geojs.io/*', 'https://ipapi.co/*', 'https://ipwho.is/*']);
  assert.ok(!m.content_scripts, 'content scripts are injected on demand');
  for (const f of CONTENT.concat(['lib/rules.js', 'lib/site.js'])) assert.ok(existsSync(path.join(ROOT, f)), `${f} exists`);
});

/* ---------------- rule validation, inspect sync, import safety ---------------- */
test('repeated groups of plain, non-overlapping words (and escaped punctuation) are still accepted', async () => {
  const B = loadBg({ page: { fill: { count: 1, used: {} } } });
  const ok = [RULE('k1', 'example.com', '/(foo|bar)+/i', 'v'), RULE('k2', 'example.com', '/^(mr|mrs)\\.? /i', 'v'), RULE('k3', 'example.com', '/(\\.|-)+/', 'v'), RULE('k4', 'example.com', '/[\\w-]+@x/', 'v')];
  await B.send({ type: 'setRules', rules: ok });
  const mine = await rulesOf(B, 1);
  for (const r of ok) assert.ok(mine.some((x) => x.match === r.match), `${r.match} kept (got ${JSON.stringify(mine)})`);
});

test("Inspect gets the site's rules, remembered fields and the Testing switches, as a fill would", async () => {
  const B = loadBg({ frames: [0, 3] });
  await B.send({ type: 'setSettings', tabId: 1, patch: { testCards: true, sampleFiles: true, overrides: { 'example.com': [{ key: 'input:text name=nick', type: 'skip' }], 'other.org': [{ key: 'k2', type: 'email' }] } } });
  await B.send({ type: 'setRules', rules: [RULE('i1', 'example.com', 'name=nick', 'Fixed'), RULE('i2', 'other.org', '#x', 'Z'), RULE('i3', 'example.com', '#off', 'O', false)] });
  const r = await B.send({ type: 'inspect', tabId: 1, on: true });
  assert.ok(r && r.ok !== false, JSON.stringify(r));
  for (const f of [0, 3]) {
    const call = B.logOf(1, f).filter((x) => x[0] === 'overlay').at(-1), o = call && call[2];
    assert.ok(o && typeof o === 'object', `frame ${f}: overlay(true, options) (got ${JSON.stringify(call)})`);
    assert.deepEqual((o.rules || []).map((x) => [x.match, x.value]), [['name=nick', 'Fixed']], `frame ${f}: this site's enabled rules`);
    assert.ok(has(o.overrides, { key: 'input:text name=nick', type: 'skip' }) && !has(o.overrides, { key: 'k2' }), `frame ${f}: this site's remembered fields (${JSON.stringify(o.overrides)})`);
    assert.deepEqual([o.testCards, o.sampleFiles, o.edgeMode], [true, true, false], `frame ${f}: the Testing switches`);
  }
});

const PAGE = (tabId, frameId = 0) => ({ id: 'test', tab: { id: tabId, url: TABS[tabId] }, frameId, url: TABS[tabId], origin: new URL(TABS[tabId]).origin });
test("the overlay's Esc / close chip in any frame turns Inspect off in every frame of its tab", async () => {
  const B = loadBg({ frames: [0, 3, 5] });
  await B.send({ type: 'inspect', tabId: 1, on: true });
  assert.equal((await B.send({ type: 'state', tabId: 1 })).inspecting, true, 'Inspect is on');
  const r = await B.send({ type: 'inspect', on: false }, 3000, PAGE(1, 3)); // from frame 3's overlay.js: no tabId, the sender's tab
  assert.ok(r && r.ok !== false && !r.timedOut, JSON.stringify(r));
  for (const f of [0, 3, 5]) assert.deepEqual(B.logOf(1, f).filter((x) => x[0] === 'overlay').map((x) => x[1]), [true, false], `frame ${f}: overlay off`);
  assert.equal((await B.send({ type: 'state', tabId: 1 })).inspecting, false, 'the popup no longer shows Inspect as on');
  assert.equal(B.logOf(2, 0).filter((x) => x[0] === 'overlay').length, 0, 'another tab is left alone');
});

test('a page (content script) can only turn Inspect off in its own tab; every other message from it is refused', async () => {
  const B = loadBg({ frames: [0], page: { fill: { count: 1, used: {} } } });
  await B.send({ type: 'inspect', tabId: 2, on: true });
  for (const msg of [{ type: 'setRules', rules: [RULE('x1', 'example.com', '#evil', 'X')] }, { type: 'inspect', tabId: 1, on: true }, { type: 'exportSettings', includeHistory: true },
    { type: 'setSettings', tabId: 1, patch: { overwrite: true } }, { type: 'fill', tabId: 1 }, { type: 'inspect', tabId: 2, on: false }]) {
    const before = B.logOf(2, 0).filter((x) => x[0] === 'overlay').length;
    const r = await B.send(msg, 3000, PAGE(1));
    if (msg.type === 'inspect' && msg.on === false) { // its own tab (1), never the tab it names
      assert.equal(B.logOf(2, 0).filter((x) => x[0] === 'overlay').length, before, 'tab 2 untouched');
      continue;
    }
    assert.ok(r && r.ok === false && !r.json, `${msg.type} from a page is refused (got ${JSON.stringify(r).slice(0, 120)})`);
  }
  assert.ok(!(await rulesOf(B, 1)).some((x) => x.match === '#evil'), 'no rule was added');
  assert.equal((await B.send({ type: 'state', tabId: 1 })).settings.overwrite, false, 'no setting changed');
  assert.equal((await B.send({ type: 'state', tabId: 2 })).inspecting, true, "tab 2's Inspect is still on");
});

test("an import whose settings can't be kept (over the 8 KB sync item) fails in the preview and writes nothing", async () => {
  const B = loadBg({ quota: true, page: { fill: { count: 1, used: {} } } });
  const file = JSON.stringify({ app: 'FormGhost', version: '2.0.0', settings: { blocked: Array.from({ length: 400 }, (_, i) => `a-rather-long-subdomain-${i}.example-site.com`) }, rules: [RULE('imp1', 'example.com', '#imported', 'I')] });
  const dry = await B.send({ type: 'importSettings', json: file, mode: 'merge', dryRun: true });
  assert.ok(dry && dry.ok === false && /large|long/i.test(dry.error || ''), `the preview refuses it (${JSON.stringify(dry)})`);
  const r = await B.send({ type: 'importSettings', json: file, mode: 'merge' });
  assert.ok(r && r.ok === false, JSON.stringify(r).slice(0, 200));
  assert.ok(!(await rulesOf(B, 1)).some((x) => x.match === '#imported'), "the file's rule was not written");
  assert.deepEqual((await B.send({ type: 'state', tabId: 1 })).settings.blocked, [], 'settings unchanged');
});

/* a history persona from a real export, edited */
async function historyFile(edit) {
  const A = await configured(), o = JSON.parse(await exportText(A, { includeHistory: true }));
  assert.ok(Array.isArray(o.history) && o.history[0] && o.history[0].persona, 'the export has a history entry');
  edit(o.history[0].persona);
  return JSON.stringify(o);
}
for (const [why, edit] of [
  ['a phone that is a number', (p) => { p.phone = 5; }], ['a password that is an object', (p) => { p.password = { a: 1 }; }], ['no phone', (p) => { delete p.phone; }],
  ['no address', (p) => { delete p.address1; }], ['a date of birth as text', (p) => { p.dob = '1990-01-01'; }], ['ids as a list', (p) => { p.ids = ['x']; }],
  ['an unknown field', (p) => { p.evil = 'x'; }], ['a phone without its parts', (p) => { p.phone = { display: 'x' }; }], ['languages as text', (p) => { p.languages = 'English'; }],
]) {
  test(`importSettings refuses a history identity with ${why}, and nothing changes`, async () => {
    const text = await historyFile(edit), B = loadBg({ page: { fill: { count: 1, used: {} } } });
    const before = (await B.send({ type: 'state', tabId: 1 })).history.length;
    for (const mode of ['merge', 'replace']) {
      const r = await B.send({ type: 'importSettings', json: text, mode });
      assert.ok(r && r.ok === false && /identity|history/i.test(r.error || ''), `${mode}: refused (got ${JSON.stringify(r).slice(0, 200)})`);
    }
    assert.equal((await B.send({ type: 'state', tabId: 1 })).history.length, before, 'Recent unchanged');
  });
}
test('a history identity as FormGhost made it (an older BR one without a neighbourhood too) is accepted and can be used', async () => {
  const text = await historyFile(() => {}), B = loadBg({ page: { fill: { count: 1, used: {} } } });
  const r = await B.send({ type: 'importSettings', json: text, mode: 'replace' });
  assert.ok(r && r.ok === true, JSON.stringify(r).slice(0, 200));
  const id = JSON.parse(text).history[0].persona.id;
  const used = await B.send({ type: 'usePersona', tabId: 1, id });
  assert.ok(used && used.persona && used.persona.phone && used.persona.phone.display, 'Use here gives a whole identity');
  const br = B.ctx.FormGhost.generate('BR');
  delete br.neighborhood;
  br.locations.forEach((l) => delete l.neighborhood);
  const o = JSON.parse(text);
  o.history = [{ persona: br, site: 'example.com', ts: Date.now() }];
  const r2 = await loadBg().send({ type: 'importSettings', json: JSON.stringify(o), mode: 'merge' });
  assert.ok(r2 && r2.ok === true, `a BR identity from before neighbourhoods (${JSON.stringify(r2).slice(0, 200)})`);
});
