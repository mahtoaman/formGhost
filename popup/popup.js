/*!
 * FormGhost - https://github.com/mahtoaman/formghost
 * Copyright 2026 Aman Mahto (@mahtoaman)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 */
const $ = (s, r = document) => r.querySelector(s);
let TAB_ID = null;
const send = (msg) => chrome.runtime.sendMessage({ tabId: TAB_ID, ...msg });
let S = null;
const VERSION = (() => { try { return chrome.runtime.getManifest().version; } catch (e) { return ''; } })();

const HINTS = {
  smart: (p) => `Local number; adds ${p.cc} only when the field expects it.`,
  local: () => 'Always the local number, never a country code.',
  intl: (p) => `Always includes the country code (${p.cc}).`,
};

function hue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

function exampleFor(mode, ph) {
  if (mode === 'intl') return ph.e164;
  return ph.national;
}

// 'Alt+Shift+F' (Win/Linux) or '⌥⇧F' (macOS) -> ['Alt', '⇧', 'F']
const keysOf = (s) => (!s ? [] : s.includes('+') ? s.split('+') : [...s.match(/^[⌃⌥⇧⌘]*/)[0], s.replace(/^[⌃⌥⇧⌘]+/, '')]).filter(Boolean).map((k) => (k === 'Shift' ? '⇧' : k));
const kbds = (s) => keysOf(s).map((k) => Object.assign(document.createElement('kbd'), { textContent: k }));
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const svg = (d) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = d; return s; };
const X_ICON = '<path d="M6 6l12 12M18 6 6 18" />';
const plural = (n, w, many) => `${n} ${n === 1 ? w : many || w + 's'}`;
const shortcutsOf = (st) => st.shortcuts || { fillPage: st.shortcut || '' };
const phoneCopy = (ph) => (S.settings.phoneMode === 'intl' ? ph.e164 : ph.national);
const TESTING = [['edgeMode', 'edge cases'], ['sampleFiles', 'sample files'], ['testCards', 'test cards']];
const TOGGLES = ['overwrite', 'requiredOnly', 'checkboxes', 'highlight', 'testPhones', ...TESTING.map(([k]) => k)];
const countOf = (c) => (Array.isArray(c) ? c.length : c && typeof c === 'object' ? +c.count || 0 : +c || 0); // a bare number, { count, used } or a list
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
// rules / overrides may come with the settings or next to them (they have their own storage keys)
const rulesOf = (st) => (st && [st.rules, st.settings && st.settings.rules].find(Array.isArray)) || [];
const overridesOf = (st) => (st && [st.overrides, st.settings && st.settings.overrides].find(isObj)) || {};

function renderRegion(st) {
  const { geo, settings, effective } = st;
  const countries = st.countries || [];
  const eff = countries.find((c) => c.code === effective);
  const name = eff ? eff.name : effective;
  $('#ccBadge').textContent = effective;
  $('#regionName').textContent = name;
  const dot = $('#geoDot');
  dot.className = 'dot';
  let sub;
  if (settings.country !== 'auto') { sub = 'Chosen manually'; dot.classList.add('manual'); }
  else if (geo && geo.code !== effective) { sub = `${geo.country || geo.code} isn’t supported yet · using ${name}`; dot.classList.add('warn'); }
  else if (geo && geo.source === 'ip') { sub = `Detected via IP${geo.city || geo.region ? ' · ' + (geo.city || geo.region) : ''}`; dot.classList.add('live'); }
  else { sub = 'From browser language (IP lookup failed)'; dot.classList.add('warn'); }
  $('#regionSub').textContent = sub;

  const sel = $('#country');
  if (!sel.options.length && countries.length) {
    sel.add(new Option('Auto (from IP)', 'auto'));
    countries.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((c) => sel.add(new Option(c.name, c.code)));
  }
  sel.value = settings.country;
  $('#pillLabel').textContent = settings.country === 'auto' ? 'Auto' : settings.country;
}

function renderPersona(p, animate, session) {
  const card = $('#personaCard');
  const apply = () => {
    const av = $('#avatar');
    av.textContent = p.initials;
    av.style.setProperty('--h', hue(p.fullName));
    $('#pName').textContent = p.fullName;
    const kept = !!(session && session.steps && session.host), tail = kept ? `Kept for ${session.host} · step ${session.steps}` : p.jobTitle;
    $('#pMeta').textContent = `${p.gender === 'male' ? 'Male' : 'Female'} · ${p.age} yrs · ${tail}`;
    $('#pMeta').title = kept ? 'Same identity is used on every step of this site. Tap ↻ for a new one.' : '';
    $('#pEmail').textContent = p.email;
    $('#pCode').textContent = p.phone.cc;
    $('#pPhone').textContent = p.phone.display;
    $('#pAddr').textContent = `${p.address1}, ${p.city}, ${p.state} ${p.zip}`;
    card.classList.remove('swap');
  };
  if (animate) { card.classList.add('swap'); setTimeout(apply, 180); } else apply();
}

function renderPhone(st) {
  const { settings, persona } = st;
  const modes = ['smart', 'local', 'intl'];
  const i = modes.indexOf(settings.phoneMode);
  document.querySelectorAll('#phoneMode button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.phoneMode));
  $('#phoneMode .seg-ind').style.transform = `translateX(${Math.max(i, 0) * 100}%)`;
  $('#phoneHint').textContent = (HINTS[settings.phoneMode] || HINTS.smart)(persona.phone);
  $('#phoneExample').textContent = exampleFor(settings.phoneMode, persona.phone);
}

function renderSite(st) {
  const off = !!st.blocked, where = st.blockEntry || st.host || '', s = st.settings;
  document.body.classList.toggle('blocked', off);
  $('#offNote').hidden = !off;
  $('#offHost').textContent = where;
  $('#offNote').title = off ? `The shortcut and right-click menu won’t fill ${where}. Fill anyway still works.` : '';
  const testing = TESTING.filter(([k]) => s[k]).map(([, label]) => label);
  $('#testNote').hidden = !testing.length;
  $('#testText').textContent = testing.join(' · ');
  $('#testNote').title = s.edgeMode ? 'Fills use invalid and extreme values, to test your form’s validation' : '';
  $('.fill-label').textContent = off ? 'Fill anyway' : s.edgeMode ? 'Fill with edge cases' : s.requiredOnly ? 'Fill required fields' : 'Fill this page';
  $('#turnOff').hidden = off || !st.host;
  $('#turnOff').title = st.host ? `Stop the shortcut and right-click menu on ${st.host}` : '';
  const keys = kbds(shortcutsOf(st).fillPage);
  $('#kbd').replaceChildren(...keys);
  $('#kbd').hidden = off || !keys.length;
  const v = st.version || VERSION;
  $('#ver').textContent = v ? 'v' + v : '';
  $('#abVer').textContent = v ? 'v' + v : '';
  if (typeof st.inspecting === 'boolean') setPressed(st.inspecting);
}

function render(st, animatePersona) {
  if (!st || !st.persona || !st.settings) { if (st && st.error) toast(st.error, false); return; }
  const key = (x) => (x && x.persona ? `${x.persona.id || ''}|${x.persona.email}|${JSON.stringify(x.session)}` : '');
  const personaChanged = S && key(S) !== key(st);
  S = st;
  document.body.classList.remove('loading');
  renderRegion(st);
  renderPersona(st.persona, animatePersona && personaChanged, st.session);
  renderPhone(st);
  renderSite(st);
  if (sheet === $('#setSheet')) renderSettingsSheet(st);
  if (sheet === $('#detSheet')) renderDetails(st);
  const btn = $('#fill');
  if (!btn.classList.contains('busy')) btn.disabled = false;
}

// what a handler answers: the new state, { ok, state }, or { ok: false, error }; a bare { ok } re-reads the state
async function applyResult(res, fallback) {
  if (res && res.persona && res.settings) { render(res, false); return res; }
  if (res && res.state && res.state.persona) { render(res.state, false); return res; }
  if (!res || res.ok === false) throw new Error((res && res.error) || fallback || 'Something went wrong.');
  const st = await send({ type: 'state' });
  render(st, false);
  return res;
}

/* ---------- toast: a line of text, up to two actions; 'Copy as' opens a small menu above it ---------- */
let toastTimer, toastMs = 0, menuRun = null;
const CHEVRON = '<path d="m6 15 6-6 6 6" />';
function toast(text, ok = true, actions = null, title = '') {
  const t = $('#toast'), list = actions ? [].concat(actions) : [];
  closeMenu(false);
  t.classList.toggle('err', !ok);
  $('#tIcon').textContent = ok ? '✓' : '!';
  $('#tText').textContent = text;
  $('#tText').title = title || '';
  $('#tActs').replaceChildren(...list.map((a) => {
    const b = el('button', 't-act', a.label);
    if (a.menu) {
      b.classList.add('t-more');
      b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false');
      b.append(svg(CHEVRON));
      b.onclick = () => ($('#tMenu').hidden ? openMenu(b, a.menu) : closeMenu(true));
    } else b.onclick = () => { hideToast(); a.run(); };
    return b;
  }));
  t.classList.add('show');
  toastMs = list.length ? 5000 : 2600;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, toastMs);
}
function hideToast() { clearTimeout(toastTimer); closeMenu(false); $('#toast').classList.remove('show'); }
const toastHeld = () => { const t = $('#toast'); return t.matches(':hover') || t.matches(':focus-within') || !$('#tMenu').hidden; };
// Don't pull the toast (and its Undo) away from under the pointer or keyboard focus
['mouseenter', 'focusin'].forEach((ev) => $('#toast').addEventListener(ev, () => clearTimeout(toastTimer)));
['mouseleave', 'focusout'].forEach((ev) => $('#toast').addEventListener(ev, (e) => {
  if (!$('#toast').classList.contains('show') || (e.relatedTarget && $('#toast').contains(e.relatedTarget))) return;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastHeld() ? null : hideToast()), Math.min(toastMs, 2000));
}));

function openMenu(btn, run) {
  const m = $('#tMenu');
  menuRun = run; m.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  clearTimeout(toastTimer);
  $('button', m).focus();
}
function closeMenu(focusBtn) {
  const m = $('#tMenu'), b = $('#tActs .t-more');
  if (m.hidden) return;
  m.hidden = true;
  if (b) { b.setAttribute('aria-expanded', 'false'); if (focusBtn) b.focus(); }
}
$('#tMenu').addEventListener('click', (e) => {
  const item = e.target.closest('[data-fmt]'), run = menuRun;
  if (!item || !run) return;
  closeMenu(true);
  run(item.dataset.fmt, $('#tActs .t-more'));
});
$('#tMenu').addEventListener('keydown', (e) => {
  const items = [...$('#tMenu').querySelectorAll('button')], i = items.indexOf(document.activeElement);
  const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
  if (to != null) { e.preventDefault(); items[(to + items.length) % items.length].focus(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
  else if (e.key === 'Tab') closeMenu(false);
});
document.addEventListener('pointerdown', (e) => { if (!$('#tMenu').hidden && !e.target.closest('#tMenu, .t-more')) closeMenu(false); });

function flash(btn, text) {
  if (!btn || !btn.isConnected) return;
  const label = btn.firstChild;
  btn._label = btn._label || label.textContent;
  label.textContent = text; btn.classList.add('done');
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { label.textContent = btn._label; btn.classList.remove('done'); }, 1500);
}

async function setSettings(patch) { const st = await send({ type: 'setSettings', patch }); render(st, true); return st; }

async function setBlocked(block, keyboard) {
  if (!S) return;
  const was = S.blockEntry || S.host;
  const st = await send({ type: 'blockSite', block });
  render(st, false);
  if (!st || !st.persona) return;
  // a '*.host' entry made on another subdomain stays: only Settings can remove it
  if (!block && st.blocked) return toast(`Still off: ${st.blockEntry || was} covers this site`, false, { label: 'Settings', run: () => openSheet('setSheet') });
  toast(block ? `Turned off on ${st.blockEntry || st.host}` : `Turned on for ${was}`);
  if (keyboard) $(block ? '#turnOn' : '#turnOff').focus(); // the clicked button just got hidden
}

async function copyText(row, val) {
  if (!val) return;
  try { await navigator.clipboard.writeText(val); } catch (e) { return; }
  const em = row.querySelector('em');
  row.classList.add('copied'); em.textContent = 'copied';
  clearTimeout(row._t);
  row._t = setTimeout(() => { row.classList.remove('copied'); em.textContent = 'copy'; }, 1200);
}

function copy(li) {
  if (!S) return;
  const p = S.persona;
  copyText(li, { email: p.email, phone: phoneCopy(p.phone), address: p.fullAddress }[li.dataset.copy]);
}

async function undo(tabId) {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'undo', tabId });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Couldn’t undo the fill.');
    toast(res.count ? `Restored ${plural(res.count, 'field')}` : 'Nothing to undo on this page', !!res.count);
  } catch (e) { toast(e.message || String(e), false); }
}

// the last fill on this tab, as test code: JSON / Playwright / Cypress
const FORMATS = { json: 'JSON', playwright: 'Playwright', cypress: 'Cypress' };
async function copyFill(tabId, format, btn) {
  try {
    const res = await send({ type: 'copyFill', tabId, format });
    if (!res || !res.ok || typeof res.text !== 'string') throw new Error((res && res.error) || 'Nothing to copy from this fill.');
    await navigator.clipboard.writeText(res.text);
    if (btn && btn.isConnected && $('#toast').classList.contains('show')) { flash(btn, 'Copied'); btn.title = `Copied as ${FORMATS[format] || format}`; }
    else toast(`Copied as ${FORMATS[format] || format}`);
  } catch (e) { toast(e.message || String(e), false); }
}

/* ---------- inspect: labels on the page showing what each field gets; they stay after the popup closes (state.inspecting) ---------- */
function setPressed(on) {
  const b = $('#inspect');
  b.setAttribute('aria-pressed', String(!!on));
  b.title = on ? 'Hide the field labels on the page' : 'Show on the page what each field will get';
}
async function inspect() {
  const b = $('#inspect'), on = b.getAttribute('aria-pressed') !== 'true';
  if (TAB_ID == null || b.disabled) return;
  b.disabled = true;
  try {
    const res = await send({ type: 'inspect', tabId: TAB_ID, on });
    if (!res || res.ok === false) throw new Error((res && res.error) || 'Couldn’t reach this page.');
    setPressed(on);
    if (!on) return toast('Field labels hidden');
    const known = res.count != null || Array.isArray(res.items), n = countOf(res.count != null ? res.count : res.items);
    toast(!known ? 'Field labels shown · Esc on the page hides them' : n ? `Labelled ${plural(n, 'field')} · Esc on the page hides them` : 'No fields to label on this page', !known || !!n);
  } catch (e) { toast(e.message || String(e), false); } finally { b.disabled = false; }
}

/* ---------- sheets ---------- */
let sheet = null, opener = null;
function openSheet(id, section) {
  if (!S) return;
  if (sheet) closeSheet(false);
  const sh = $('#' + id);
  opener = $(id === 'setSheet' ? '#openSettings' : '#openDetails');
  if (id === 'setSheet') renderSettingsSheet(S, true); else { pwShown.clear(); renderDetails(S); }
  sh.hidden = false; sh.scrollTop = 0; sh.classList.remove('scrolled');
  $('#main').inert = true;
  sheet = sh;
  const sec = section && $(section, sh);
  if (sec) sh.scrollTop = sec.offsetTop - $('.sheet-head', sh).offsetHeight - 4;
  $('[data-close]', sh).focus({ preventScroll: true });
}
function closeSheet(restore = true) {
  if (!sheet) return;
  const a = document.activeElement;
  if (a && a.matches('.input') && sheet.contains(a)) a.blur(); // commits a typed value (change fires on blur)
  sheet.hidden = true; sheet = null;
  $('#main').inert = false;
  if (restore && opener) opener.focus();
}
document.querySelectorAll('.sheet').forEach((sh) => {
  $('[data-close]', sh).addEventListener('click', () => closeSheet());
  sh.addEventListener('scroll', () => sh.classList.toggle('scrolled', sh.scrollTop > 2), { passive: true });
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#tMenu').hidden) { e.preventDefault(); return closeMenu(true); }
  if (ruleEdit && $('#rForm').contains(document.activeElement)) { e.preventDefault(); return closeRuleForm(true); }
  if (sheet) { e.preventDefault(); closeSheet(); }
});

/* ---------- settings sheet ---------- */
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const HOST = /^(?:\*\.)?(?:\[[0-9a-f:.]+\]|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?::\d{1,5})?(?:\/\S*)?$/;
const FIELDS = {
  emailDomain: {
    hint: () => (S.settings.emailInbox ? 'Not used while “Send to my inbox” is set' : 'Every email becomes name@this domain'),
    clean: (v) => v.trim().toLowerCase().replace(/^@+/, ''),
    check: (v) => (!v || (v.length <= 253 && DOMAIN.test(v)) ? '' : 'Enter a domain like example.com'),
  },
  emailInbox: {
    hint: () => 'Uses you+name@… so every signup lands in your inbox',
    clean: (v) => v.trim().toLowerCase(),
    check: (v) => {
      if (!v) return '';
      const [user, dom, extra] = v.split('@');
      if (extra === undefined && user && user.includes('+')) return 'Leave out the +tag, FormGhost adds one per identity';
      return extra === undefined && /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(user || '') && DOMAIN.test(dom || '') ? '' : 'Enter an address like you@gmail.com';
    },
  },
};
const fieldTimers = {};
function fieldMsg(id, text, tone) {
  const m = $(`#${id}Msg`), i = $('#' + id);
  clearTimeout(fieldTimers[id]);
  m.textContent = text || FIELDS[id].hint();
  m.className = 'f-msg' + (tone ? ' ' + tone : '');
  i.classList.toggle('bad', tone === 'err');
  i.setAttribute('aria-invalid', String(tone === 'err'));
  if (tone === 'ok') fieldTimers[id] = setTimeout(() => fieldMsg(id), 1600);
}

async function saveField(id) {
  if (!S) return;
  const f = FIELDS[id], i = $('#' + id), v = f.clean(i.value), err = f.check(v);
  if (err) return fieldMsg(id, err, 'err');
  i.value = v;
  if (v === (S.settings[id] || '')) return fieldMsg(id);
  const st = await setSettings({ [id]: v });
  if (st && st.settings) fieldMsg(id, v ? 'Saved' : 'Cleared', 'ok');
}

// 'https://www.Shop.example.com/' -> 'shop.example.com'; keeps '*.', ':port' and '/Path' (paths are case-sensitive)
function cleanEntry(v) {
  const [, host, path] = v.trim().replace(/^[a-z][a-z\d+.-]*:\/\//i, '').replace(/[?#].*$/, '').match(/^([^/]*)(.*)$/);
  return host.toLowerCase().replace(/^(\*\.)?www\./, '$1').replace(/\.(?=$|:)/, '') + (path === '/' ? '' : path);
}
let blockedQueue = Promise.resolve();
const editBlocked = (fn) => (blockedQueue = blockedQueue.then(() => setSettings({ blocked: fn(S.settings.blocked || []) })).catch((e) => toast(e.message || String(e), false)));

// a small status line under a group: tone 'ok' fades back to the default after a moment
const msgTimers = {};
function groupMsg(id, def, text, tone) {
  const m = $('#' + id);
  clearTimeout(msgTimers[id]);
  m.textContent = text || def;
  m.className = 'f-msg grp-msg' + (tone ? ' ' + tone : '');
  if (tone === 'ok') msgTimers[id] = setTimeout(() => groupMsg(id, def), 2400);
}

function renderSettingsSheet(st, fresh) {
  const s = st.settings;
  TOGGLES.forEach((id) => { $('#' + id).checked = !!s[id]; });
  Object.keys(FIELDS).forEach((id) => { // keep what the person is typing, and an invalid value they still have to fix
    const i = $('#' + id), m = $(`#${id}Msg`);
    if (fresh || (document.activeElement !== i && !i.classList.contains('bad'))) i.value = s[id] || '';
    if (fresh || !/\b(err|ok)\b/.test(m.className)) fieldMsg(id);
  });
  $('#pvEmail').textContent = st.persona.email;
  $('#pvPhone').textContent = `${st.persona.phone.cc} ${st.persona.phone.display}`;

  const list = (s.blocked || []).map((entry) => {
    const li = el('li'), host = el('span', 'b-host', entry), x = el('button', 'icon-btn sm');
    host.title = entry;
    host.classList.toggle('here', entry === st.blockEntry);
    x.setAttribute('aria-label', `Remove ${entry}`); x.title = 'Remove';
    x.append(svg(X_ICON));
    x.addEventListener('click', () => {
      const idx = [...li.parentNode.children].indexOf(li);
      bMsg();
      editBlocked((b) => b.filter((e) => e !== entry)).then(() => { // focus the row that took its place
        const items = $('#bList').children, b = items[Math.min(idx, items.length - 1)];
        if (sheet) (b ? $('button', b) : $('#bInput')).focus();
      });
    });
    li.append(host, x);
    return li;
  });
  $('#bList').replaceChildren(...list);
  if (fresh) { $('#bInput').value = ''; bMsg(); }

  const sc = shortcutsOf(st);
  $('#scList').replaceChildren(...[['fillPage', 'Fill this page'], ['fillForm', 'Fill this form'], ['fillField', 'Fill this field'], ['undo', 'Undo last fill']].map(([k, label]) => {
    const row = el('div', 'sc-row'), keys = kbds(sc[k]), shown = el('span', keys.length ? 'sc-keys' : 'sc-none', keys.length ? null : 'Not set'), btn = el('button', 'link', 'Change');
    shown.append(...keys);
    btn.title = 'Opens Chrome’s keyboard shortcuts page';
    btn.setAttribute('aria-label', `Change shortcut: ${label}`);
    btn.addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
    row.append(el('span', '', label), shown, btn);
    return row;
  }));

  if (fresh) { closeRuleForm(false); resetImport(); groupMsg('bkMsg', ''); groupMsg('bulkMsg', BULK_HINT); }
  renderRules(st, fresh);
  renderOverrides(st, fresh);
  renderBulk(st, fresh);
}

function bMsg(text, tone) {
  const m = $('#bMsg');
  m.textContent = text || '*.host also covers every subdomain';
  m.className = 'f-msg b-msg' + (tone ? ' ' + tone : '');
  $('#bInput').classList.toggle('bad', tone === 'err');
}

/* ---------- rules: [{ id, site, match, value, on }]; site '' = every site. lib/rules.js (when loaded) checks them as the background does ---------- */
const RULE_CAP = 300, MATCH_MAX = 500, VALUE_MAX = 2000;
const TOKENS = ['firstName', 'lastName', 'fullName', 'email', 'phone', 'city', 'state', 'zip', 'company', 'persona.jobTitle', 'random:8', 'digits:6', 'pick:a|b|c', 'date:+7d:YYYY-MM-DD', 'uuid'];
const TOKEN_OK = /^(?:persona\.[A-Za-z_$][\w$]*(?:\.[\w$]+)*|firstName|lastName|fullName|email|phone|city|state|zip|company|random:\d{1,4}|digits:\d{1,4}|pick:[^{}]+|date(?::[^{}]*)?|uuid)$/;
// a repeated group that itself repeats, e.g. (a+)+ or (\w+\s?)*: it can take forever on a long label
const NESTED = /\((?:[^()\\]|\\.)*(?:[+*]|\{\d+,\d*\})(?:[^()\\]|\\.)*\)(?:[+*]|\{\d+,\d*\})/;
const isEvery = (site) => !site || site === '*';
// as the background matches: the site key, the exact host, or a '*.host' entry (paths and ports aside)
const ruleHere = (r, st) => isEvery(r.site) || r.site === st.site || r.site === st.host || (/^\*\./.test(r.site) && !!st.host && (st.host === r.site.slice(2) || st.host.endsWith(r.site.slice(1))));
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
let ruleEdit = null, rulesKey = '', rulesQueue = Promise.resolve();
const newId = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function checkMatch(m) {
  if (!m) return 'Say which field: a selector, /regex/ or name=…';
  if (m.length > MATCH_MAX) return `Keep it under ${MATCH_MAX} characters`;
  const R = globalThis.FG_RULES;
  if (R && R.badMatch && R.kindOf) { const why = R.badMatch(m); return !why ? '' : R.kindOf(m) === 'css' ? 'Not a CSS selector, /regex/ or name=…' : cap(why); }
  const re = m.match(/^\/([\s\S]+)\/([a-z]*)$/), kv = m.match(/^(name|id|label)\s*=\s*([\s\S]*)$/i);
  if (re) {
    if (/[^imsu]|(.).*\1/.test(re[2])) return 'Use only the i, m, s and u flags';
    if (NESTED.test(re[1])) return 'A repeat inside a repeat can hang the page; simplify it';
    try { new RegExp(re[1], re[2]); } catch (e) { return 'That regex doesn’t compile'; }
    return '';
  }
  if (kv) return kv[2].trim() ? '' : `Add the field’s ${kv[1].toLowerCase()} after ${kv[1].toLowerCase()}=`;
  try { document.createDocumentFragment().querySelector(m); return ''; } catch (e) { return 'Not a CSS selector, /regex/ or name=…'; }
}
function checkValue(v) {
  if (!v) return ['Type a value, or a token like {{email}}', 'err'];
  if (v.length > VALUE_MAX) return [`Keep the value under ${VALUE_MAX} characters`, 'err'];
  const bad = [...v.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((x) => x[1]).find((t) => !TOKEN_OK.test(t));
  return bad != null ? [`{{${bad}}} isn’t a token, so it fills as nothing`, 'warn'] : ['', ''];
}
const cleanSite = (v) => (isEvery(v.trim()) ? '' : cleanEntry(v));
const cleanMatch = (m) => m.trim().replace(/^(name|id|label)\s*=\s*/i, (x, k) => k.toLowerCase() + '=');

function rMsg(text, tone, input) {
  const m = $('#rMsg');
  m.textContent = text || '';
  m.className = 'f-msg' + (tone ? ' ' + tone : '');
  ['#rSite', '#rMatch', '#rValue'].forEach((s) => { const i = $(s), bad = input === s && tone === 'err'; i.classList.toggle('bad', bad); i.setAttribute('aria-invalid', String(bad)); });
}

function editRules(fn) {
  const run = rulesQueue.then(async () => applyResult(await send({ type: 'setRules', rules: fn(rulesOf(S)) }), 'Couldn’t save the rules.'));
  rulesQueue = run.catch(() => {});
  return run;
}

function renderRules(st, force) {
  const rules = rulesOf(st), here = rules.filter((r) => ruleHere(r, st));
  const k = JSON.stringify([rules, ruleEdit, st.site]);
  $('#rNew').disabled = rules.length >= RULE_CAP;
  $('#rNew').title = rules.length >= RULE_CAP ? `Up to ${RULE_CAP} rules; remove one to add another` : '';
  $('#rulesNote').textContent = rules.length ? `${plural(rules.length, 'rule')}${st.site ? ` · ${here.length} here` : ''}` : 'A fixed value for matching fields';
  if (!force && k === rulesKey) return;
  rulesKey = k;
  const form = $('#rForm'), list = $('#rList'), act = document.activeElement, inForm = form.contains(act);
  const items = rules.map((r) => {
    const li = el('li', 'r-item');
    li.dataset.id = r.id;
    if (ruleEdit === r.id) { li.classList.add('editing'); li.append(form); return li; }
    li.classList.toggle('off', r.on === false);
    const sw = el('label', 'toggle mini'), cb = el('input'), main = el('button', 'r-main'), sub = el('span', 'r-sub'), x = el('button', 'icon-btn sm');
    cb.type = 'checkbox'; cb.checked = r.on !== false;
    cb.setAttribute('aria-label', `Use the rule for ${r.match}`);
    cb.addEventListener('change', () => editRules((rs) => rs.map((y) => (y.id === r.id ? { ...y, on: cb.checked } : y))).catch((e) => { cb.checked = !cb.checked; toast(e.message, false); }));
    sw.append(cb, el('span', 'sw'));
    main.type = 'button'; main.title = 'Edit rule';
    const site = isEvery(r.site) ? 'every site' : r.site === st.site ? 'this site' : r.site, where = el('span', '', site);
    where.title = isEvery(r.site) ? 'Every site' : r.site;
    sub.append(el('span', '', '→ ' + r.value), where);
    main.append(el('span', 'r-match mono', r.match), sub);
    main.setAttribute('aria-label', `Edit rule: ${r.match} gets ${r.value}, on ${site}`);
    main.addEventListener('click', () => openRuleForm(r.id));
    x.type = 'button'; x.title = 'Remove'; x.setAttribute('aria-label', `Remove the rule for ${r.match}`);
    x.append(svg(X_ICON));
    x.addEventListener('click', () => {
      const idx = [...list.children].indexOf(li);
      editRules((rs) => rs.filter((y) => y.id !== r.id)).then(() => {
        const left = list.children, b = left[Math.min(idx, left.length - 1)];
        if (sheet) (b ? $('.r-main', b) || $('input', b) : $('#rNew')).focus();
      }, (e) => toast(e.message, false));
    });
    li.append(sw, main, x);
    return li;
  });
  if (ruleEdit !== 'new' && ruleEdit && !rules.some((r) => r.id === ruleEdit)) { ruleEdit = 'new'; $('#rSave').textContent = 'Add rule'; } // removed meanwhile: the typing becomes a new rule
  if (!ruleEdit || ruleEdit === 'new') list.after(form);
  list.replaceChildren(...items);
  if (inForm && act.isConnected && document.activeElement !== act) act.focus();
}

function openRuleForm(id) {
  const r = rulesOf(S).find((x) => x.id === id);
  ruleEdit = r ? r.id : 'new';
  $('#rSite').value = r ? (isEvery(r.site) ? '' : r.site) : S.site || '';
  $('#rMatch').value = r ? r.match : '';
  $('#rValue').value = r ? r.value : '';
  $('#rSave').textContent = r ? 'Save' : 'Add rule';
  rMsg();
  $('#rForm').hidden = false; $('#rNew').hidden = true;
  renderRules(S, true);
  $('#rMatch').focus();
}
function closeRuleForm(focus) {
  const was = ruleEdit;
  ruleEdit = null;
  $('#rForm').hidden = true; $('#rNew').hidden = false;
  $('#rList').after($('#rForm'));
  if (S && was) renderRules(S, true);
  if (focus) { const li = was && was !== 'new' && $(`#rList li[data-id="${CSS.escape(was)}"] .r-main`); (li || $('#rNew')).focus(); }
}

$('#rNew').addEventListener('click', () => openRuleForm(null));
$('#rCancel').addEventListener('click', () => closeRuleForm(true));
['#rSite', '#rMatch', '#rValue'].forEach((s) => $(s).addEventListener('input', () => { if ($(s).classList.contains('bad')) rMsg(); }));
$('#rValue').addEventListener('change', () => { const [t, tone] = checkValue($('#rValue').value); if (tone === 'warn') rMsg(t, tone); });
$('#rForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!S || !ruleEdit) return;
  const site = cleanSite($('#rSite').value), match = cleanMatch($('#rMatch').value), value = $('#rValue').value;
  if (site && (!HOST.test(site) || /\.\./.test(site))) return rMsg('Use example.com or *.example.com; leave it empty for every site', 'err', '#rSite');
  const mErr = checkMatch(match);
  if (mErr) return rMsg(mErr, 'err', '#rMatch');
  const [vErr, tone] = checkValue(value);
  if (tone === 'err') return rMsg(vErr, 'err', '#rValue');
  if (tone === 'warn' && $('#rMsg').textContent !== vErr) return rMsg(vErr, 'warn'); // said once; saving again keeps it
  const id = ruleEdit, rule = { site, match, value };
  try {
    await editRules((rs) => (id === 'new' ? (rs.length >= RULE_CAP ? rs : rs.concat({ id: newId(), ...rule, on: true })) : rs.map((r) => (r.id === id ? { ...r, ...rule } : r))));
    closeRuleForm(true);
    toast(id === 'new' ? 'Rule added' : 'Rule saved');
  } catch (err) { rMsg(err.message || String(err), 'err'); }
});
$('#tokList').replaceChildren(...TOKENS.map((t) => {
  const b = el('button', 'tok', `{{${t}}}`);
  b.type = 'button'; b.title = `Insert {{${t}}}`;
  b.addEventListener('click', () => {
    const i = $('#rValue'), at = i.selectionStart ?? i.value.length, end = i.selectionEnd ?? at, ins = `{{${t}}}`;
    i.value = i.value.slice(0, at) + ins + i.value.slice(end);
    i.focus(); i.setSelectionRange(at + ins.length, at + ins.length);
    rMsg();
  });
  return b;
}));

/* ---------- remembered fields: { [site]: [{ key, type }] }, set from right-click → Fill field as ---------- */
const TYPE_LABEL = { fullName: 'Full name', name: 'Full name', firstName: 'First name', lastName: 'Last name', email: 'Email', phone: 'Phone', address: 'Address', address1: 'Address', city: 'City', state: 'State', zip: 'PIN / ZIP', pin: 'PIN / ZIP', pincode: 'PIN / ZIP', postal: 'PIN / ZIP', dob: 'Date of birth', company: 'Company', jobTitle: 'Job title', number: 'Number', text: 'Text', skip: 'Skipped' };
const typeLabel = (t) => TYPE_LABEL[t] || String(t || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
let ovKey = '';
function renderOverrides(st, force) {
  const all = overridesOf(st), box = $('#ovList');
  const sites = Object.keys(all).filter((k) => Array.isArray(all[k]) && all[k].some((o) => o && o.key)).sort((a, b) => (b === st.site) - (a === st.site) || a.localeCompare(b));
  const k = JSON.stringify([all, st.site]);
  if (!force && k === ovKey) return;
  ovKey = k;
  if (!sites.length) return box.replaceChildren(el('p', 'empty', 'Right-click a field → Fill field as… and FormGhost remembers it for that site.'));
  const at = [...box.querySelectorAll('button')].indexOf(document.activeElement), out = [];
  sites.forEach((site) => {
    const items = all[site].filter((o) => o && o.key), head = el('div', 'ov-site');
    head.append(el('span', '', site));
    if (site === st.site) head.append(el('span', 'here', 'this site'));
    head.append(el('span', 'ov-n', String(items.length)));
    out.push(head);
    items.forEach((o) => {
      const row = el('div', 'ov-item'), key = el('span', 'ov-key mono', o.key), type = el('span', 'ov-type', typeLabel(o.type)), x = el('button', 'icon-btn sm');
      key.title = o.key;
      x.title = 'Forget'; x.setAttribute('aria-label', `Forget ${o.key} on ${site}`);
      x.append(svg(X_ICON));
      x.addEventListener('click', async () => {
        x.disabled = true;
        try { await applyResult(await send({ type: 'removeOverride', site, key: o.key }), 'Couldn’t forget that field.'); } catch (e) { x.disabled = false; toast(e.message, false); }
      });
      row.append(key, type, x);
      out.push(row);
    });
  });
  box.replaceChildren(...out);
  if (at >= 0 && sheet) { const bs = box.querySelectorAll('button'); if (bs.length) bs[Math.min(at, bs.length - 1)].focus(); }
}

/* ---------- backup: export to formghost-settings.json, import with a preview (merge or replace) ---------- */
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })), a = el('a');
  a.href = url; a.download = name; a.hidden = true;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
// { settings, rules, overrides, sites, history } → '9 settings · 3 rules · 4 remembered fields on 2 sites'
function countsText(c) {
  if (typeof c === 'string') return c;
  if (!isObj(c)) return '';
  const n = (k) => (Number.isFinite(c[k]) ? c[k] : 0);
  return [
    n('settings') && plural(n('settings'), 'setting'), n('rules') && plural(n('rules'), 'rule'),
    n('overrides') && plural(n('overrides'), 'remembered field') + (n('sites') ? ` on ${plural(n('sites'), 'site')}` : ''),
    n('history') && plural(n('history'), 'recent identity', 'recent identities'),
  ].filter(Boolean).map((x) => x.replace(/ /g, '\u00a0')).join(' · '); // wraps between the counts only
}
const fileName = (res, def) => (res && typeof res.filename === 'string' && /^[\w. ()-]{1,80}$/.test(res.filename) ? res.filename : def);
let pendingImport = null, armTimer;
function resetImport() {
  pendingImport = null;
  $('#bkPreview').hidden = true; $('#bkFile').value = '';
  disarm();
}
function disarm() { clearTimeout(armTimer); const b = $('#bkReplace'); b.classList.remove('armed'); b.textContent = 'Replace'; }

$('#bkExport').addEventListener('click', async () => {
  const b = $('#bkExport');
  b.disabled = true;
  try {
    const res = await send({ type: 'exportSettings', includeHistory: $('#bkHistory').checked });
    if (!res || !res.ok || typeof res.json !== 'string') throw new Error((res && res.error) || 'Couldn’t export the settings.');
    const name = fileName(res, 'formghost-settings.json');
    download(name, res.json, 'application/json');
    groupMsg('bkMsg', '', `Saved ${name}`, 'ok');
  } catch (e) { groupMsg('bkMsg', '', e.message || String(e), 'err'); } finally { b.disabled = false; }
});
$('#bkImport').addEventListener('click', () => $('#bkFile').click());
$('#bkFile').addEventListener('change', async () => {
  const f = $('#bkFile').files[0];
  resetImport();
  if (!f) return;
  if (f.size > 2 * 1024 * 1024) return groupMsg('bkMsg', '', 'That file is too big for a FormGhost backup', 'err');
  let text;
  try { text = await f.text(); JSON.parse(text); } catch (e) { return groupMsg('bkMsg', '', 'That file isn’t JSON', 'err'); }
  try { // checked whole by the background first: nothing is written until Merge or Replace
    const res = await send({ type: 'importSettings', json: text, mode: 'merge', dryRun: true });
    if (!res || res.ok === false) throw new Error((res && res.error) || 'Couldn’t read that file.');
    if (!res.dryRun) { await applyResult(res); return groupMsg('bkMsg', '', `Merged${countsText(res.summary) ? ': ' + countsText(res.summary) : ''}`, 'ok'); }
    pendingImport = text;
    $('#bkName').textContent = f.name;
    $('#bkCounts').textContent = countsText(res.summary) || 'Nothing new to import';
    groupMsg('bkMsg', '');
    $('#bkPreview').hidden = false;
    $('#bkMerge').focus();
  } catch (e) { groupMsg('bkMsg', '', e.message || String(e), 'err'); }
});
$('#bkCancel').addEventListener('click', () => { resetImport(); $('#bkImport').focus(); });
async function runImport(mode) {
  if (!pendingImport) return;
  const bs = ['#bkMerge', '#bkReplace'].map((s) => $(s));
  bs.forEach((b) => { b.disabled = true; });
  try {
    const res = await send({ type: 'importSettings', json: pendingImport, mode });
    if (!res || res.ok === false) throw new Error((res && res.error) || 'Couldn’t import that file.');
    resetImport();
    await applyResult(res);
    const sum = countsText(res.summary);
    groupMsg('bkMsg', '', `${mode === 'replace' ? 'Replaced' : 'Merged'}${sum ? ': ' + sum : ''}`, 'ok');
    $('#bkImport').focus();
  } catch (e) { groupMsg('bkMsg', '', e.message || String(e), 'err'); } finally { bs.forEach((b) => { b.disabled = false; }); }
}
$('#bkMerge').addEventListener('click', () => runImport('merge'));
$('#bkReplace').addEventListener('click', () => { // two clicks: replacing drops what is there now
  const b = $('#bkReplace');
  if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Replace all?'; armTimer = setTimeout(disarm, 3000); return; }
  disarm(); runImport('replace');
});

/* ---------- bulk export: N raw identities (safe test data applied) as CSV / JSON ---------- */
const BULK_HINT = 'Up to 500 · safe test data settings applied';
let bulkFmt = 'csv';
function renderBulk(st, fresh) {
  const sel = $('#bulkCountry'), countries = st.countries || [];
  if (!sel.options.length && countries.length) countries.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((c) => sel.add(new Option(c.name, c.code)));
  if (fresh || !sel.value) sel.value = st.effective;
  const i = bulkFmt === 'json' ? 1 : 0;
  document.querySelectorAll('#bulkFmt button').forEach((b, j) => { b.classList.toggle('on', j === i); b.setAttribute('aria-checked', String(j === i)); });
  $('#bulkFmt .seg-ind').style.transform = `translateX(${i * 100}%)`;
}
document.querySelectorAll('#bulkFmt button').forEach((b) => b.addEventListener('click', () => { bulkFmt = b.dataset.v; if (S) renderBulk(S); }));
$('#bulkCount').addEventListener('input', () => { if ($('#bulkCount').classList.contains('bad')) { $('#bulkCount').classList.remove('bad'); groupMsg('bulkMsg', BULK_HINT); } });
$('#bulk').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!S) return;
  const n = Number($('#bulkCount').value), cc = $('#bulkCountry').value || S.effective, b = $('#bulkGo');
  if (!Number.isInteger(n) || n < 1 || n > 500) { $('#bulkCount').classList.add('bad'); return groupMsg('bulkMsg', BULK_HINT, 'Choose a whole number from 1 to 500', 'err'); }
  b.disabled = true;
  try {
    const res = await send({ type: 'bulkExport', count: n, format: bulkFmt, country: cc });
    if (!res || !res.ok || typeof res.text !== 'string') throw new Error((res && res.error) || 'Couldn’t make the identities.');
    download(fileName(res, `formghost-${cc.toLowerCase()}-${n}.${bulkFmt}`), res.text, bulkFmt === 'csv' ? 'text/csv' : 'application/json');
    groupMsg('bulkMsg', BULK_HINT, `Saved ${plural(n, 'identity', 'identities')} as ${bulkFmt.toUpperCase()}`, 'ok');
  } catch (err) { groupMsg('bulkMsg', BULK_HINT, err.message || String(err), 'err'); } finally { b.disabled = false; }
});

/* ---------- details sheet ---------- */
const ID_LABEL = { aadhaar: 'Aadhaar', pan: 'PAN', passport: 'Passport', voter: 'Voter ID', ssn: 'SSN', sin: 'SIN', nino: 'NI number', tfn: 'TFN', medicare: 'Medicare', uan: 'UAN', abha: 'ABHA', eshram: 'e-Shram', ration: 'Ration card', rationCard: 'Ration card', cpf: 'CPF', rg: 'RG', nif: 'NIF', steuerId: 'Tax ID', insee: 'INSEE', gstin: 'GSTIN', tan: 'TAN', cin: 'CIN', udyam: 'Udyam no.', cnpj: 'CNPJ' };
const NATIONAL_ID = { PK: 'CNIC', BD: 'NID', AE: 'Emirates ID', ES: 'DNI', GB: 'NI number' };
const VEHICLE = /^(vehicle\w*|rc|vrn)$/i;
const idLabel = (k, cc) => (k === 'dl' ? (cc === 'US' || cc === 'CA' ? 'Driver’s license' : 'Driving licence') : k === 'nationalId' ? NATIONAL_ID[cc] || 'National ID' : VEHICLE.test(k) ? 'Vehicle no.' : ID_LABEL[k] || k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase()));
const BANK = [['accountNumber', 'Account no.'], ['ifsc', 'IFSC'], ['routing', 'Routing no.'], ['sortCode', 'Sort code'], ['iban', 'IBAN'], ['bsb', 'BSB'], ['transit', 'Transit no.'], ['institution', 'Institution'], ['swift', 'SWIFT / BIC'], ['bankName', 'Bank'], ['branch', 'Branch'], ['upi', 'UPI']];
// the company's registrations: shown under Company, wherever the persona keeps them (ids, the top level, or a business / company object)
const BIZ_IDS = ['gstin', 'tan', 'cin', 'udyam', 'cnpj'];
const OWN_IDS = ['uan', 'cpf'];

const str = (x) => (x == null || typeof x === 'object' || x === '' ? '' : String(x));
const idVal = (x) => (isObj(x) ? str(x.display || x.formatted || x.number || x.value) : str(x));
function dateText(d, p) {
  if (d && typeof d === 'object' && !d.y && typeof d.iso === 'string') d = d.iso;
  if (typeof d === 'string') { const m = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (!m) return d; d = { y: +m[1], m: +m[2], d: +m[3] }; }
  if (!d || !d.y || !d.m || !d.d) return '';
  const parts = { D: String(d.d).padStart(2, '0'), M: String(d.m).padStart(2, '0'), Y: String(d.y) };
  return (p.dateOrder || 'DMY').split('').map((k) => parts[k]).join(p.dateSep || '/');
}
const yrs = (n) => (str(n) ? [`${n} yrs`, String(n)] : '');
const years = (n) => (str(n) ? [plural(+n, 'year'), String(n)] : '');
const phoneRow = (ph) => (!ph || typeof ph !== 'object' ? str(ph) : ph.national ? [`${ph.cc || ''} ${ph.display || ph.national}`.trim(), phoneCopy(ph)] : str(ph.e164 || ph.display));
// { std: '011', number: '23456789', display, e164 }: shown as the country writes it (+code in front unless it starts with the trunk 0), copied as digits or +E.164
function landRow(l, cc) {
  if (!l || typeof l !== 'object') return str(l);
  const shown = str(l.display) || [str(l.std), str(l.number)].filter(Boolean).join(' ');
  return shown ? [/^[0+]/.test(shown) || !cc ? shown : `${cc} ${shown}`, S.settings.phoneMode === 'intl' && str(l.e164) ? l.e164 : str(l.national) || shown.replace(/[^\d+]/g, '')] : '';
}
// idDates: { passport: { issue, expiry }, dl: {…} } (ISO strings); flat keys like 'passportExpiry' also read
const ISSUED = /^(issue|issued|issueDate|issuedOn|dateOfIssue|from|validFrom)$/i, EXPIRES = /^(expiry|expires|expiryDate|expiresOn|dateOfExpiry|to|validTill|validUntil|validUpto)$/i;
const docKey = (k) => (/^(dl|driv|licen[cs]e)/i.test(k) ? 'dl' : /^passport/i.test(k) ? 'passport' : k);
function docDates(all) {
  const out = {}, put = (doc, k, v) => { const w = ISSUED.test(k) ? 'issue' : EXPIRES.test(k) ? 'expiry' : ''; if (w && v) (out[docKey(doc)] = out[docKey(doc)] || {})[w] = v; };
  Object.entries(all && typeof all === 'object' ? all : {}).forEach(([doc, v]) => {
    if (v && typeof v === 'object' && !v.y && !v.iso) Object.entries(v).forEach(([k, x]) => put(doc, k, x));
    else { const m = doc.match(/^(.+?)(Issue\w*|Expir\w*|Valid\w*)$/); if (m) put(m[1], m[2], v); }
  });
  return out;
}
function usedPassword(st) {
  const s = st.session, pw = s && str(s.usedPassword);
  return pw && pw !== st.persona.password ? [pw, `on ${s.host || st.site || 'this site'}`] : null;
}
// [[key, value]] of the persona's own IDs (ids first, then the top-level ones ids lacks), and of its company's
function idParts(p) {
  const ids = isObj(p.ids) ? p.ids : {}, biz = [p.business, p.companyIds, p.companyInfo].filter(isObj);
  const own = Object.keys(ids).filter((k) => !BIZ_IDS.includes(k)).map((k) => [k, ids[k]]);
  OWN_IDS.concat(Object.keys(p).filter((k) => VEHICLE.test(k))).forEach((k) => { if (idVal(p[k]) && !own.some(([o]) => o === k || (VEHICLE.test(o) && VEHICLE.test(k)))) own.push([k, p[k]]); });
  const company = BIZ_IDS.map((k) => [k, [ids[k], p[k], ...biz.map((b) => b[k])].find((v) => idVal(v))]).filter(([, v]) => v);
  return [own, company];
}

function detailGroups(p, st) {
  const em = p.emergency || {}, nom = p.nominee || {}, dates = docDates(p.idDates), used = usedPassword(st), land = p.landline || {};
  const refs = (Array.isArray(p.references) ? p.references : []).filter((r) => r && typeof r === 'object');
  const [own, company] = idParts(p);
  return [
    ['Identity', [
      ['Full name', p.fullName], ['Username', p.username], ['Password', p.password, 'pw'], ...(used ? [['Password used', used[0], 'pw', used[1]]] : []),
      ['Date of birth', dateText(p.dob, p)], ['Age', yrs(p.age)],
      ['Gender', p.gender === 'male' ? 'Male' : p.gender === 'female' ? 'Female' : str(p.gender)], ['Father', p.fatherName], ['Mother', p.motherName],
      ['Marital status', p.maritalStatus], ['Spouse', p.spouseName], ['Blood group', p.bloodGroup], // spouse-name fields get it even when single
    ]],
    ['Contact', [
      ['Email', p.email], ['Alt email', p.altEmail], ['Phone', phoneRow(p.phone)], ['Alt phone', phoneRow(p.altPhone)],
      ['Landline', landRow(p.landline, p.phone && p.phone.cc)], [p.country === 'IN' ? 'STD code' : 'Area code', typeof land === 'object' ? land.std : '', 'sub', 'Landline'], ['Address', p.fullAddress],
      ['District', p.district], ['Tehsil', p.tehsil], ['Village', p.village], ['Post office', p.postOffice],
    ]],
    ['IDs', own.flatMap(([k, v]) => { const label = idLabel(k, p.country), d = dates[k] || {}; return [[label, idVal(v)], ['Issued', dateText(d.issue, p), 'sub', label], ['Expires', dateText(d.expiry, p), 'sub', label]]; })],
    ['Bank', BANK.map(([k, label]) => [label, p[k]])],
    ['Work', [['Company', p.company], ...company.map(([k, v]) => [idLabel(k, p.country), idVal(v), 'sub', 'Company']), ['Job title', p.jobTitle], ['Experience', years(p.experience)], ['Qualification', p.qualification], ['University', p.university], ['Notice period', p.noticePeriod]]],
    ['Emergency contact', [['Name', em.name], ['Relation', em.relation], ['Phone', phoneRow(em.phone)]]],
    ['Nominee', [['Name', nom.name], ['Relation', nom.relation], ['Date of birth', dateText(nom.dob, p)], ['Age', yrs(nom.age)]]],
    ['References', refs.map((r) => [['Name', r.name], ['Relation', r.relation], ['Company', r.company], ['Job title', r.jobTitle], ['Phone', phoneRow(r.phone)], ['Email', r.email], ['Known for', years(r.yearsKnown)]]), 'blocks'],
  ];
}

const pwShown = new Set(); // names of the passwords shown in clear
const COPY = new WeakMap();
// kind 'pw': masked, with a show/hide eye (note: a second line of the label); 'sub': indented under the row above (note: that row's label, for screen readers)
function detailRow(label, value, kind, note) {
  const [shown, val] = Array.isArray(value) ? value : [str(value), str(value)];
  if (!shown || /\bundefined\b|\bNaN\b|\[object /.test(shown)) return null;
  const name = kind === 'sub' ? `${note} ${label}` : note ? `${label} ${note}` : label, open = kind !== 'pw' || pwShown.has(name);
  const lower = name.replace(/\b[A-Z](?![A-Z])/g, (c) => c.toLowerCase()); // keeps PAN, IFSC, STD
  const row = el('button', 'd-row'), k = el('span', 'd-k'), v = el('span', 'd-v', open ? null : '•'.repeat(Math.min(shown.length, 14)));
  if (open) shown.split(/(?=@)/).forEach((part, i) => v.append(...(i ? [document.createElement('wbr'), part] : [part]))); // emails wrap before the @
  else { v.classList.add('mask'); v.setAttribute('aria-label', 'hidden password'); }
  if (kind === 'sub') { k.classList.add('sub'); k.append(el('span', 'vh', note + ' '), label); }
  else { k.append(label); if (note) { const n = el('span', 'd-note', note); n.title = note; k.append(' ', n); } }
  row.append(k, v, el('em', '', 'copy'));
  row.title = `Copy ${lower}`;
  COPY.set(row, val);
  if (kind !== 'pw') return row;
  const wrap = el('div', 'd-pw'), eye = el('button', 'icon-btn');
  eye.setAttribute('aria-pressed', String(open));
  eye.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} ${lower}`); eye.title = eye.getAttribute('aria-label');
  eye.append(svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />' + (open ? '' : '<path d="m4 4 16 16" />')));
  eye.addEventListener('click', () => { if (!pwShown.delete(name)) pwShown.add(name); renderDetails(S); });
  wrap.append(row, eye);
  return wrap;
}

function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (!ts || isNaN(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

async function usePersona(id, name) {
  const st = await send({ type: 'usePersona', id });
  if (!st || !st.persona) return toast((st && st.error) || 'Couldn’t switch identity.', false);
  render(st, true);
  const first = st.persona.firstName || (name || '').split(' ')[0];
  toast(st.site && st.session ? `Using ${first} on ${st.site}` : `${first} is up next`);
}

function renderDetails(st) {
  const p = st.persona, body = $('#detBody'), top = $('#detSheet').scrollTop, out = [];
  $('#detSub').textContent = p.fullName;
  const rowsOf = (rows) => rows.map(([label, value, kind, note]) => detailRow(label, value, kind, note)).filter(Boolean);
  detailGroups(p, st).forEach(([title, rows, blocks]) => {
    const items = blocks ? rows.map(rowsOf).filter((r) => r.length).map((r) => { const b = el('div', 'd-block'); b.append(...r); return b; }) : rowsOf(rows);
    if (!items.length) return;
    const g = el('div', 'group');
    g.append(...items);
    out.push(el('h3', 'sec', title), g);
  });
  const hist = (Array.isArray(st.history) ? st.history : []).filter((h) => h && h.id && h.fullName);
  const hg = el('div', 'group');
  if (!hist.length) hg.append(el('p', 'empty', 'Identities you fill with show up here.'));
  hist.forEach((h) => {
    const item = el('div', 'h-item'), main = el('div', 'h-main');
    main.append(el('div', 'h-name', h.fullName));
    if (h.email) main.append(el('div', 'h-mail', h.email));
    const meta = [h.site, ago(h.ts), h.country && h.country !== st.effective ? h.country : ''].filter(Boolean).map((t) => el('span', '', t)); // only a long site gets cut
    if (meta.length) { const m = el('div', 'h-meta'); m.append(...meta); main.append(m); }
    item.append(main);
    if (h.id === p.id) item.append(el('span', 'h-now', 'In use'));
    else {
      const b = el('button', 'btn-sm use', 'Use here');
      b.title = st.site ? `Use ${h.fullName} on ${st.site}` : `Use ${h.fullName} for the next fill`;
      b.addEventListener('click', () => usePersona(h.id, h.fullName));
      item.append(b);
    }
    hg.append(item);
  });
  out.push(el('h3', 'sec', 'Recent identities'), hg);
  const at = [...body.querySelectorAll('button')].indexOf(document.activeElement); // re-render keeps focus in place
  body.replaceChildren(...out);
  $('#detSheet').scrollTop = top;
  if (at >= 0) { const bs = body.querySelectorAll('button'); bs[Math.min(at, bs.length - 1)].focus(); }
}

$('#detBody').addEventListener('click', (e) => { const row = e.target.closest('.d-row'); if (row) copyText(row, COPY.get(row)); });

/* ---------- events ---------- */
$('#country').addEventListener('change', (e) => setSettings({ country: e.target.value }));

document.querySelectorAll('#phoneMode button').forEach((b) => b.addEventListener('click', () => setSettings({ phoneMode: b.dataset.v })));

TOGGLES.forEach((id) => $('#' + id).addEventListener('change', (e) => setSettings({ [id]: e.target.checked })));

Object.keys(FIELDS).forEach((id) => {
  const i = $('#' + id);
  i.addEventListener('change', () => saveField(id)); // fires on Enter and on blur
  i.addEventListener('input', () => { if (i.classList.contains('bad')) fieldMsg(id); });
});

$('#bAdd').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!S) return;
  const i = $('#bInput'), v = cleanEntry(i.value);
  if (!v) return bMsg('Type a site to block', 'err');
  if (!HOST.test(v) || /\.\./.test(v)) return bMsg('Use host, *.host, host:port or host/path', 'err');
  if ((S.settings.blocked || []).includes(v)) return bMsg('Already in the list', 'err');
  i.value = '';
  editBlocked((b) => (b.includes(v) ? b : b.concat(v))).then(() => bMsg(`Blocked ${v}`, 'ok'));
});
$('#bInput').addEventListener('input', () => { if ($('#bInput').classList.contains('bad')) bMsg(); });

$('#openSettings').addEventListener('click', () => openSheet('setSheet'));
$('#openDetails').addEventListener('click', () => openSheet('detSheet'));
$('#testEdit').addEventListener('click', () => openSheet('setSheet', '#secTesting'));
$('#inspect').addEventListener('click', inspect);

$('#shuffle').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.classList.remove('spin'); void btn.offsetWidth; btn.classList.add('spin');
  render(await send({ type: 'shuffle' }), true);
});

$('#refreshGeo').addEventListener('click', async () => {
  $('#regionSub').textContent = 'Checking your IP…';
  render(await send({ type: 'refreshGeo' }), true);
  if (S) toast(`Region: ${$('#regionName').textContent}`);
});

$('#turnOff').addEventListener('click', (e) => setBlocked(true, !e.detail));
$('#turnOn').addEventListener('click', (e) => setBlocked(false, !e.detail));

document.querySelectorAll('.p-rows li').forEach((li) => {
  li.addEventListener('click', () => copy(li));
  li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copy(li); } });
});

// { filled, skipped: { reason: n } } across frames → '12 filled · 3 skipped', the reasons for the tooltip
const REASONS = {
  hidden: 'hidden', readonly: 'read-only', disabled: 'disabled', card: 'card fields', trap: 'bot traps', code: 'codes / captchas', ext: 'extensions', ref: 'reference numbers',
  other: 'unrecognised', unknown: 'unrecognised', type: 'unsupported types', picker: 'date pickers', widget: 'widgets', off: 'marked off', filled: 'already filled',
  value: 'already filled', optional: 'optional', skip: 'set to skip', override: 'set to skip', rule: 'set by rules', file: 'file uploads', payment: 'payment frames', hosted: 'payment frames',
  prefilled: 'already filled', nodata: 'no matching data', otp: 'one-time codes', forced: 'set to skip', editor: 'rich-text editors',
};
const reasonText = (r) => REASONS[r] || String(r).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
function fillSummary(res, n) {
  const rep = isObj(res.report) ? res.report : {}, filled = Number.isFinite(+rep.filled) && rep.filled != null ? +rep.filled : n;
  const skipped = isObj(rep.skipped) ? Object.entries(rep.skipped).filter(([, c]) => +c > 0).sort((a, b) => b[1] - a[1]) : [];
  const nSkip = skipped.reduce((a, [, c]) => a + +c, 0);
  return { filled, nSkip, text: `${filled ? `${filled} filled` : 'Nothing filled'}${nSkip ? ` · ${nSkip} skipped` : ''}`, why: nSkip ? 'Skipped: ' + skipped.map(([r, c]) => `${c} ${reasonText(r)}`).join(', ') : '' };
}

$('#fill').addEventListener('click', async () => {
  if (!S) return;
  const btn = $('#fill');
  btn.disabled = true; btn.classList.add('busy');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab found.');
    const res = await send({ type: 'fill', tabId: tab.id, force: !!S.blocked, scope: 'page' });
    if (res && res.blocked) {
      const host = res.host || S.host, st = await send({ type: 'state' });
      render(st && st.persona ? st : { ...S, blocked: true, host }, false);
      return toast(`Off on ${host} · use Fill anyway`, false);
    }
    if (!res || !res.ok) throw new Error((res && res.error) || 'Something went wrong.');
    const n = countOf(res.count), who = [res.persona, res.used, S.persona].find((x) => x && x.firstName) || { firstName: 'this identity' };
    const sum = fillSummary(res, n);
    if (n === 0) toast(sum.nSkip ? sum.text : S.settings.requiredOnly ? 'No required fields found on this page' : 'No fillable fields found on this page', false, null, sum.why);
    else {
      const as = `Filled as ${who.fullName || who.firstName}${res.session ? ` · step ${res.session.steps} on ${res.session.host}` : ''}`;
      toast(sum.text, true, [{ label: 'Undo', run: () => undo(tab.id) }, { label: 'Copy as', menu: (fmt, b) => copyFill(tab.id, fmt, b) }], [as, sum.why].filter(Boolean).join('\n'));
    }
    render({ ...S, persona: res.persona || S.persona, session: res.session || null }, true);
    if (n > 0) send({ type: 'state' }).then((st) => st && st.persona && render(st, false)).catch(() => {}); // history changed
  } catch (e) {
    toast(e.message || String(e), false);
  } finally {
    btn.disabled = false; btn.classList.remove('busy');
  }
});

// the author's GitHub links (header, About): a new tab, as the popup can't navigate itself
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-ext]');
  if (!a || !/^https:\/\/github\.com\//.test(a.href)) return;
  e.preventDefault();
  chrome.tabs.create({ url: a.href });
});

/* ---------- boot ---------- */
document.body.classList.add('loading');
$('#ver').textContent = VERSION ? 'v' + VERSION : '';
$('#abVer').textContent = VERSION ? 'v' + VERSION : '';
chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  TAB_ID = tab ? tab.id : null;
  $('#inspect').disabled = TAB_ID == null;
  return send({ type: 'state' });
}).then((st) => render(st, false)).catch((e) => toast(e.message || String(e), false));
