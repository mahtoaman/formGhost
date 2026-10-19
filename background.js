/*!
 * FormGhost - https://github.com/mahtoaman/formghost
 * Copyright 2026 Aman Mahto (@mahtoaman)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 */
/* FormGhost service worker: IP region detection, one identity per site, blocklist, rules and remembered fields, filling tabs. */
importScripts('lib/locales.js', 'lib/data-in.js', 'lib/profile.js', 'lib/persona.js', 'lib/site.js', 'lib/rules.js');
// content/qa.js needs no DOM to load: its kinds name the 'Insert test value' items and its format() writes 'Copy as' text here
try { importScripts('content/qa.js'); } catch (e) { /* a built-in list of kinds, and the page's own formatter */ }

const DEFAULTS = {
  country: 'auto', phoneMode: 'smart', overwrite: false, requiredOnly: false, highlight: true, checkboxes: true, blocked: [], emailDomain: '', emailInbox: '', testPhones: false,
  edgeMode: false, sampleFiles: false, testCards: false,
};
const PHONE_MODES = ['smart', 'local', 'intl'];
const GEO_TTL = 6 * 60 * 60 * 1000;
const FALLBACK_TTL = 15 * 60 * 1000; // browser-language guess: retry the IP lookup sooner
const SESSION_TTL = 30 * 60 * 1000; // same identity across steps of one site for 30 min of activity
const MAX_SESSIONS = 20;
const MAX_HISTORY = 15;
const BULK_MAX = 500;
const ITEM_MAX = 8000; // chrome.storage.sync allows 8192 bytes per item (key + JSON)
const INJECT_MS = 10000; // a page with an alert() open, or one that never finishes loading, doesn't answer
const LOCK_MS = 20000;
const TITLE = 'FormGhost';
const HOMEPAGE = 'https://github.com/mahtoaman/formghost';
const NO_RUN = 'Chrome doesn’t let extensions run on this page.';
const SLOW = 'The page didn’t respond. Close any dialog on it or reload it, then try again.';
const SCOPES = ['page', 'form', 'field'];
const FORMATS = ['json', 'playwright', 'cypress'];
const COMMANDS = { fillPage: 'fill-page', fillForm: 'fill-form', fillField: 'fill-field', undo: 'undo-fill' };
// content scripts, in this order: the filler uses what the others define
const FILES = ['content/widgets.js', 'content/qa.js', 'content/overlay.js', 'content/filler.js'];
const { siteKey, hostKey, matchEntry, exactEntries, normEntry, inSite } = FG_SITE;
const { withPrefs } = FormGhost;
const RULES = FG_RULES;
const QA = self.__fgExt && self.__fgExt.qa;

// one line each time the service worker starts, in its own console only (never a page's; not under Node)
if (typeof ServiceWorkerGlobalScope === 'function' && self instanceof ServiceWorkerGlobalScope) {
  console.info(`FormGhost v${chrome.runtime.getManifest().version} by @mahtoaman - ${HOMEPAGE}`);
}

const PROVIDERS = [
  { url: 'https://ipwho.is/', map: (j) => j && j.success !== false && j.country_code && { code: j.country_code, country: j.country, region: j.region, city: j.city } },
  { url: 'https://get.geojs.io/v1/ip/geo.json', map: (j) => j && j.country_code && { code: j.country_code, country: j.country, region: j.region, city: j.city } },
  { url: 'https://ipapi.co/json/', map: (j) => j && j.country_code && { code: j.country_code, country: j.country_name, region: j.region, city: j.city } },
  { url: 'https://api.country.is/', map: (j) => j && j.country && { code: j.country, country: '', region: '', city: '' } },
];

/* Every handler that reads-modifies-writes storage runs on this one chain, so quick clicks can't interleave.
   Nothing that waits on a page runs on it, and a step that somehow never settles lets go after LOCK_MS. */
let chain = Promise.resolve();
function locked(fn) {
  const run = chain.then(fn);
  let t;
  chain = Promise.race([run, new Promise((r) => { t = setTimeout(r, LOCK_MS); })]).catch(() => {}).finally(() => clearTimeout(t));
  return run;
}
function timed(p, ms, msg) {
  let t;
  return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new Error(msg)), ms); })]).finally(() => clearTimeout(t));
}

// only the known settings: rules and remembered fields live under their own keys
async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  const s = { ...DEFAULTS };
  if (settings && typeof settings === 'object') for (const k of Object.keys(DEFAULTS)) if (Object.hasOwn(settings, k)) s[k] = settings[k];
  if (!Array.isArray(s.blocked)) s.blocked = [];
  return s;
}

/* 'rules' [{ id, site, match, value, on }] and 'overrides' { [siteKey]: [{ key, type }] }: each in storage.sync while it fits one item,
   in storage.local once it doesn't (local, when present, is the current copy) */
const bytes = (s) => { try { return encodeURIComponent(s).replace(/%[0-9A-F]{2}/gi, '_').length; } catch (e) { return s.length * 3; } }; // a lone surrogate: the worst case
async function getList(key) {
  const [l, s] = await Promise.all([chrome.storage.local.get(key), chrome.storage.sync.get(key)]);
  const v = l && key in l ? l[key] : s && s[key];
  return key === 'rules' ? (Array.isArray(v) ? v : []) : v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}
async function putList(key, v) {
  if (bytes(key + JSON.stringify(v)) <= ITEM_MAX) {
    try { await chrome.storage.sync.set({ [key]: v }); await chrome.storage.local.remove(key); return; } catch (e) { /* sync quota: keep it locally */ }
  }
  await chrome.storage.local.set({ [key]: v });
  try { await chrome.storage.sync.remove(key); } catch (e) { /* ignore */ }
}
const lists = async () => ({ rules: await getList('rules'), overrides: await getList('overrides') });
// what one page gets: its site's remembered fields, and the rules switched on for it as { match, value }
const rulesFor = (url, rules) => rules.filter((r) => r && r.on !== false && typeof r.match === 'string' && inSite(url, typeof r.site === 'string' ? r.site : ''))
  .map((r) => ({ match: r.match, value: r.value == null ? '' : String(r.value) }));
const overridesFor = (site, overrides) => (site && Object.hasOwn(overrides, site) && Array.isArray(overrides[site]) ? overrides[site] : []);

async function fetchJSON(url, ms = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

// Offline / blocked / manual country: the browser language region (en-IN -> IN)
function langGeo() {
  const m = ((self.navigator && navigator.language) || 'en-US').match(/[-_]([A-Za-z]{2})$/);
  return { code: (m ? m[1] : 'US').toUpperCase(), country: '', region: '', city: '', source: 'language', ts: Date.now() };
}

async function detectGeo(force = false, settings = null) {
  const { geo } = await chrome.storage.local.get('geo');
  if (!force && geo && Date.now() - geo.ts < (geo.source === 'ip' ? GEO_TTL : FALLBACK_TTL)) return geo;
  if (!force && settings && settings.country !== 'auto') return geo || langGeo(); // country picked by hand: no network
  for (const p of PROVIDERS) { // one at a time, so only one provider sees the request
    try {
      const g = p.map(await fetchJSON(p.url));
      if (g && g.code) {
        const out = { ...g, code: g.code.toUpperCase(), source: 'ip', ts: Date.now() };
        await chrome.storage.local.set({ geo: out });
        return out;
      }
    } catch (e) { /* try next provider */ }
  }
  const out = langGeo();
  await chrome.storage.local.set({ geo: out });
  return out;
}

function effective(settings, geo) {
  if (settings.country !== 'auto' && FormGhost.supported(settings.country)) return settings.country;
  return geo && FormGhost.supported(geo.code) ? geo.code : 'US';
}

function make(settings, geo) {
  const code = effective(settings, geo), same = geo && geo.code === code;
  return FormGhost.generate(code, same ? geo.region : '', same ? geo.city : '');
}
// personas from before 2.0 lack its IDs and real IN post offices / branches (from before 1.3 no id, before 1.4 no document dates):
// they are replaced, not shown half-filled
const fits = (p, settings, geo) => !!(p && p.ids && p.id && p.idDates && p.schema >= 2 && p.country === effective(settings, geo));

async function newPersona(settings, geo) {
  const persona = make(settings, geo);
  await chrome.storage.local.set({ persona });
  return persona;
}

/* 'persona' is the NEXT identity: the first site you fill gets it, then a fresh one takes its place.
   One picked from Recent ('picked' = its id) stays next even when it is from another country. */
async function nextPersona(settings, geo) {
  const { persona, picked } = await chrome.storage.local.get(['persona', 'picked']);
  return fits(persona, settings, geo) || (persona && persona.id && persona.id === picked) ? persona : newPersona(settings, geo);
}

/* 'sessions' = { [siteKey]: { persona, ts, steps, picked?, usedPassword? } }: one identity per site while you move through its steps.
   usedPassword: the password the filler wrote there when the site's rules made it change the persona's; later fills there send it.
   Reading never deletes; idle (> 30 min) or wrong-country entries are just ignored and dropped on the next save.
   One picked by hand from Recent (picked) is kept even when it is from another country. */
async function liveSessions(settings, geo) {
  const { sessions } = await chrome.storage.local.get('sessions');
  const now = Date.now();
  return Object.fromEntries(Object.entries(sessions || {}).filter(([, s]) => s && now - s.ts <= SESSION_TTL && (fits(s.persona, settings, geo) || (s.picked && s.persona && s.persona.id))));
}
const saveSessions = (live) => chrome.storage.local.set({ sessions: Object.fromEntries(Object.entries(live).sort((a, b) => b[1].ts - a[1].ts).slice(0, MAX_SESSIONS)) });
const sessionOut = (site, s) => (s ? { host: site, steps: s.steps, ...(s.usedPassword ? { usedPassword: s.usedPassword } : {}) } : null);

/* 'history' = the last MAX_HISTORY identities that filled a site, newest first, one entry per persona (raw, as generated),
   with the password used on that site when it differs. */
async function getHistory() {
  const { history } = await chrome.storage.local.get('history');
  return (Array.isArray(history) ? history : []).filter((h) => h && h.persona && h.persona.id);
}
async function remember(persona, site, usedPassword) {
  const rest = (await getHistory()).filter((h) => h.persona.id !== persona.id);
  await chrome.storage.local.set({ history: [{ persona, site, ts: Date.now(), ...(usedPassword ? { usedPassword } : {}) }, ...rest].slice(0, MAX_HISTORY) });
}

async function tabUrl(tabId) {
  if (tabId == null) return '';
  try { return (await chrome.tabs.get(tabId)).url || ''; } catch (e) { return ''; }
}

// { fillPage, fillForm, fillField, undo }: the keys set at chrome://extensions/shortcuts, '' when none
async function shortcuts() {
  let all = [];
  try { all = (await chrome.commands.getAll()) || []; } catch (e) { /* no commands API: no keys */ }
  return Object.fromEntries(Object.entries(COMMANDS).map(([k, name]) => { const c = all.find((x) => x.name === name); return [k, (c && c.shortcut) || '']; }));
}

/* Read-only for identity: shows the site's live identity, else the next one. Never rotates or deletes.
   Personas go out with the safe-test-data settings applied; storage keeps them as generated.
   settings carries the rules and every site's remembered fields too. */
async function state(tabId, forceGeo = false) {
  const settings = await getSettings();
  const geo = await detectGeo(forceGeo, settings);
  const url = await tabUrl(tabId), site = siteKey(url), blockEntry = matchEntry(url, settings.blocked);
  const s = site ? (await liveSessions(settings, geo))[site] : null;
  const persona = s ? s.persona : await nextPersona(settings, geo);
  const keys = await shortcuts();
  const history = (await getHistory()).sort((a, b) => b.ts - a.ts)
    .map((h) => ({ id: h.persona.id, fullName: h.persona.fullName, email: withPrefs(h.persona, settings).email, site: h.site, ts: h.ts, country: h.persona.country }));
  return {
    settings: { ...settings, ...(await lists()) }, geo, persona: withPrefs(persona, settings), session: sessionOut(site, s),
    site, host: hostKey(url), blocked: !!blockEntry, blockEntry, shortcut: keys.fillPage, shortcuts: keys, version: chrome.runtime.getManifest().version,
    effective: effective(settings, geo), countries: FormGhost.countries(), history, inspecting: !!(await tabGet('inspect', tabId)),
  };
}

// What the popup sends, tidied: known settings only, blocklist entries normalised ('https://www.x.com/' → 'x.com') and de-duplicated, text trimmed
function cleanPatch(patch) {
  const p = {};
  for (const [k, v] of Object.entries(patch && typeof patch === 'object' ? patch : {})) if (Object.hasOwn(DEFAULTS, k)) p[k] = v;
  if ('blocked' in p) p.blocked = [...new Set((Array.isArray(p.blocked) ? p.blocked : []).map(normEntry).filter(Boolean))];
  for (const k of ['emailDomain', 'emailInbox']) if (k in p) p[k] = p[k] == null ? '' : String(p[k]).trim();
  for (const k of Object.keys(p)) if (typeof DEFAULTS[k] === 'boolean') p[k] = !!p[k];
  if ('phoneMode' in p && !PHONE_MODES.includes(p.phoneMode)) delete p.phoneMode;
  if ('country' in p && (typeof p.country !== 'string' || (p.country !== 'auto' && !FormGhost.supported(p.country)))) delete p.country;
  return p;
}
// A settings file's settings: every key known and of its type, or an error
function checkSettings(s) {
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (!Object.hasOwn(DEFAULTS, k)) return { error: `The file has an unknown setting “${k.slice(0, 40)}”.` };
    const d = DEFAULTS[k];
    const ok = Array.isArray(d) ? Array.isArray(v) && v.length <= 500 && v.every((x) => typeof x === 'string' && x.length <= 300) : typeof v === typeof d && (typeof v !== 'string' || v.length <= 300);
    if (!ok) return { error: `The setting “${k}” has the wrong type.` };
    out[k] = Array.isArray(v) ? v.slice() : v;
  }
  if ('country' in out && out.country !== 'auto' && !FormGhost.supported(out.country)) return { error: `FormGhost has no data for the country “${out.country.slice(0, 10)}”.` };
  if ('phoneMode' in out && !PHONE_MODES.includes(out.phoneMode)) return { error: 'The phone format in the file is unknown.' };
  if ('blocked' in out) {
    const b = out.blocked.map(normEntry);
    if (b.some((x) => !x)) return { error: 'A site in the file’s “off” list isn’t a host name.' };
    out.blocked = [...new Set(b)];
  }
  for (const k of ['emailDomain', 'emailInbox']) if (k in out) out[k] = out[k].trim();
  return { settings: out };
}

async function writeSettings(next, cur) {
  await chrome.storage.sync.set({ settings: next });
  if (next.country !== cur.country) { // history stays: it is a list of who you were, not of who you'll be
    await chrome.storage.local.remove('sessions');
    await newPersona(next, await detectGeo(false, next));
  }
}

async function setSettings(tabId, patch) {
  const p = patch && typeof patch === 'object' ? patch : {};
  // the lists ride along to their own keys, both checked before either is written
  const r = 'rules' in p ? RULES.cleanRules(p.rules, { normSite: normEntry }) : {}, o = 'overrides' in p ? RULES.cleanOverrides(p.overrides) : {};
  if (r.error || o.error) return { ok: false, error: r.error || o.error, ...(r.error ? { index: r.index } : {}) };
  if (r.rules) await putList('rules', r.rules);
  if (o.overrides) await putList('overrides', o.overrides);
  const cur = await getSettings();
  await writeSettings({ ...cur, ...cleanPatch(p) }, cur);
  return state(tabId);
}

async function saveRules(rules) {
  const r = RULES.cleanRules(rules, { normSite: normEntry });
  if (r.error) return { ok: false, error: r.error, index: r.index };
  await putList('rules', r.rules);
  return { ok: true };
}
async function setRules(tabId, rules) {
  const r = await saveRules(rules);
  return r.error ? r : { ...(await state(tabId)), ok: true };
}

// a remembered field forgotten (no key: every one of that site; no site: this tab's)
async function removeOverride(tabId, site, key) {
  const s = typeof site === 'string' && site ? site : siteKey(await tabUrl(tabId));
  await putList('overrides', RULES.dropOverride(await getList('overrides'), s, typeof key === 'string' ? key : null));
  return { ...(await state(tabId)), ok: true };
}

/* Backup: { app, version, generator, exportedAt, settings, rules, overrides, history? } (an import ignores generator) */
async function exportSettings(includeHistory) {
  const version = chrome.runtime.getManifest().version;
  const out = { app: 'FormGhost', version, generator: `FormGhost ${version} by @mahtoaman (${HOMEPAGE})`, exportedAt: new Date().toISOString(), settings: await getSettings(), ...(await lists()) };
  if (includeHistory) out.history = await getHistory();
  return { ok: true, json: JSON.stringify(out, null, 2), filename: 'formghost-settings.json' };
}

/* A persona in a settings file must be shaped like the ones FormGhost makes for its country (same keys, same types; 'neighborhood' may be
   missing, being newer): a hand-edited or broken one would break the popup and every fill once it is picked from Recent */
const OPTIONAL_KEYS = new Set(['neighborhood']);
const shapes = new Map();
function checkPersona(p) {
  if (!FormGhost.supported(p.country)) return 'is from a country FormGhost doesn’t know';
  if (!shapes.has(p.country)) shapes.set(p.country, RULES.shapeOf(Array.from({ length: 60 }, () => FormGhost.generate(p.country))));
  const w = RULES.misfit(shapes.get(p.country), p, '', OPTIONAL_KEYS);
  return w ? `has an identity FormGhost can’t use (${w.replace(/^\./, '').slice(0, 60)})` : true;
}

/* Restore: the file is checked whole before anything is written. 'replace' swaps each section the file has (settings missing from it go
   back to their defaults); 'merge' adds to what is here (the file wins on the same setting, rule id or field). dryRun: the summary only. */
async function importSettings(tabId, json, mode = 'merge', dryRun = false) {
  if (mode == null) mode = 'merge';
  if (mode !== 'merge' && mode !== 'replace') return { ok: false, error: 'Import as “merge” or “replace”.' };
  const text = typeof json === 'string' ? json : json && typeof json === 'object' ? JSON.stringify(json) : '';
  const { data, error } = RULES.checkImport(text, { checkSettings, normSite: normEntry, checkPersona });
  if (error) return { ok: false, error };
  const replace = mode === 'replace', cur = await getSettings(), have = await lists();
  const summary = {
    mode, settings: data.settings ? Object.keys(data.settings).length : 0, rules: data.rules ? data.rules.length : 0,
    overrides: data.overrides ? RULES.countOverrides(data.overrides) : 0, sites: data.overrides ? Object.keys(data.overrides).length : 0, history: data.history ? data.history.length : 0,
  };
  let settings = cur, rules = null, overrides = null, history = null;
  if (data.settings) {
    settings = replace ? { ...DEFAULTS, ...data.settings } : { ...cur, ...data.settings };
    if (!replace && data.settings.blocked) settings.blocked = [...new Set([...cur.blocked, ...data.settings.blocked])];
  }
  if (data.rules) {
    const byId = new Map(replace ? [] : have.rules.filter((r) => r && r.id).map((r) => [r.id, r]));
    data.rules.forEach((r) => byId.set(r.id, r));
    rules = [...byId.values()];
    if (rules.length > RULES.LIMITS.rules) return { ok: false, error: `That would make more than ${RULES.LIMITS.rules} rules.` };
  }
  if (data.overrides) {
    const m = {};
    if (!replace) for (const [s, l] of Object.entries(have.overrides)) if (Array.isArray(l)) m[s] = l.slice();
    for (const [s, l] of Object.entries(data.overrides)) m[s] = [...(m[s] || []).filter((e) => !l.some((x) => x.key === e.key)), ...l];
    const c = RULES.cleanOverrides(m);
    if (c.error) return { ok: false, error: c.error };
    overrides = c.overrides;
  }
  if (data.history) {
    const mine = replace ? [] : (await getHistory()).filter((h) => !data.history.some((x) => x.persona.id === h.persona.id));
    history = [...data.history, ...mine].sort((a, b) => b.ts - a.ts).slice(0, MAX_HISTORY);
  }
  // settings live in one storage.sync item (8 KB): one that can't be written fails the whole import, before anything is written
  if (data.settings && bytes('settings' + JSON.stringify(settings)) > ITEM_MAX) return { ok: false, error: 'The file’s settings are too large to keep (its “off” list is too long).' };
  if (dryRun) return { ok: true, dryRun: true, summary };
  if (data.settings) await writeSettings(settings, cur); // the one write that can fail on quota goes first
  if (rules) await putList('rules', rules);
  if (overrides) await putList('overrides', overrides);
  if (history) await chrome.storage.local.set({ history });
  const st = await state(tabId);
  return { ...st, ok: true, summary, state: st };
}

/* ↻ in the popup: a new identity for this site if it has one, otherwise a new "next" identity. */
async function shuffle(tabId) {
  const settings = await getSettings();
  const geo = await detectGeo(false, settings);
  const site = siteKey(await tabUrl(tabId)), sessions = await liveSessions(settings, geo);
  if (site && sessions[site]) { sessions[site] = { persona: make(settings, geo), ts: Date.now(), steps: 0 }; await saveSessions(sessions); }
  else await newPersona(settings, geo);
  return state(tabId);
}

/* 'Use here' in Recent: this site gets that identity back (a fresh session, with the password it used here); with no site it becomes the next identity. */
async function usePersona(tabId, id) {
  const settings = await getSettings();
  const geo = await detectGeo(false, settings);
  const h = (await getHistory()).find((x) => x.persona.id === id);
  if (!h) return { ok: false, error: 'That identity is no longer in Recent.' };
  const site = siteKey(await tabUrl(tabId));
  if (site) {
    const sessions = await liveSessions(settings, geo);
    const pw = h.site === site && h.usedPassword;
    sessions[site] = { persona: h.persona, ts: Date.now(), steps: 0, picked: true, ...(pw ? { usedPassword: pw } : {}) };
    await saveSessions(sessions);
  } else await chrome.storage.local.set({ persona: h.persona, picked: h.persona.id });
  return state(tabId);
}

/* 'Turn off here' adds this exact host. 'Turn on' removes only the entries naming this page:
   the exact host (or host/path), or '*.host' when this IS that host, never a parent domain's '*.' entry. */
async function blockSite(tabId, block) {
  const settings = await getSettings();
  const url = await tabUrl(tabId), host = hostKey(url);
  let blocked = settings.blocked;
  if (block) { if (host && !matchEntry(url, blocked)) blocked = blocked.concat(host); }
  else { const mine = exactEntries(url, blocked); blocked = blocked.filter((e) => !mine.includes(e)); }
  await chrome.storage.sync.set({ settings: { ...settings, blocked } });
  return state(tabId);
}

/* Bulk export: count (≤ 500) fresh identities of a country (default: the one in use), safe-test-data settings applied, as CSV or JSON */
async function bulkExport({ count, format, country } = {}) {
  const fmt = format == null ? 'csv' : format;
  if (fmt !== 'csv' && fmt !== 'json') return { ok: false, error: 'Export as CSV or JSON.' };
  const n = count == null ? 10 : Math.max(1, Math.min(BULK_MAX, Math.floor(Number(count)) || 1));
  const settings = await getSettings();
  let code = typeof country === 'string' && country && country !== 'auto' ? country.toUpperCase() : '';
  if (code && !FormGhost.supported(code)) return { ok: false, error: 'FormGhost has no data for that country.' };
  if (!code) code = effective(settings, await detectGeo(false, settings));
  // as generated, minus 'locations' (the filler's per-state fallbacks, most of each persona's size)
  const list = Array.from({ length: n }, () => { const { locations, ...p } = withPrefs(FormGhost.generate(code), settings); return p; });
  return { ok: true, text: fmt === 'csv' ? FormGhost.csv(list) : JSON.stringify(list, null, 2), count: n, format: fmt, country: code, filename: `formghost-${code.toLowerCase()}-${n}.${fmt}` };
}

function friendly(err) {
  const m = String((err && err.message) || err);
  if (/cannot be scripted|chrome:\/\/|chrome-extension|webstore|edge:\/\//i.test(m) || /Cannot access a chrome/i.test(m)) return NO_RUN;
  if (/Cannot access contents|permission/i.test(m)) return 'No access to this page. Open the popup on the page and try again.';
  if (/showing error page|error page/i.test(m)) return 'This page didn’t load. Reload it, then try again.';
  if (/No frame with id/i.test(m)) return 'That part of the page is gone. Reload it, then try again.';
  if (/No tab/i.test(m)) return 'No active tab found.';
  return m;
}

const scriptable = (url) => !url || /^(https?|file):/i.test(url); // not view-source:, chrome:, about:…
const run = (target, func, args) => timed(chrome.scripting.executeScript({ target, injectImmediately: true, func, ...(args ? { args } : {}) }), INJECT_MS, SLOW);
const inject = (target) => timed(chrome.scripting.executeScript({ target, files: FILES, injectImmediately: true }), INJECT_MS, SLOW);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
/* A frame answers a count, or { count, used: { password?, fieldKey? }, report: { filled, skipped: { reason: n } } }
   (used.password: the one it wrote after fitting the site's rules; used.fieldKey: the field a 'field' fill targeted) */
const countOf = (x) => (Number.isFinite(x) ? x : x && Number.isFinite(x.count) ? x.count : 0);
const total = (results) => (results || []).reduce((a, r) => a + countOf(r && r.result), 0);
const usedOf = (results, k) => (results || []).map((r) => r && r.result && r.result.used && r.result.used[k]);
const passwordUsed = (results, own) => usedOf(results, 'password').find((pw) => typeof pw === 'string' && pw && pw !== own) || '';
const fieldKeyOf = (results) => usedOf(results, 'fieldKey').find((k) => typeof k === 'string' && k) || '';
const framesOf = (results) => (results || []).filter((r) => r && countOf(r.result) > 0 && Number.isInteger(r.frameId)).map((r) => r.frameId);
function reportOf(results) {
  const rep = { filled: 0, skipped: {} };
  for (const r of results || []) {
    const x = r && r.result, p = x && typeof x === 'object' && x.report && typeof x.report === 'object' ? x.report : null;
    rep.filled += p && Number.isFinite(p.filled) ? p.filled : countOf(x);
    const sk = p && p.skipped && typeof p.skipped === 'object' ? p.skipped : {};
    for (const [k, n] of Object.entries(sk)) if (k !== '__proto__' && Number.isFinite(n) && n > 0) rep.skipped[k] = (Object.hasOwn(rep.skipped, k) ? rep.skipped[k] : 0) + n;
  }
  return rep;
}

/* Fills and undos of one site run in turn: one identity per site, and an undo never overtakes the fill it undoes.
   Other sites don't wait for them. */
const flights = new Map();
async function inTurn(tabId, fn) {
  const key = siteKey(await tabUrl(tabId)) || '#' + tabId;
  const prev = flights.get(key) || Promise.resolve(), go = prev.then(fn), done = go.catch(() => {});
  flights.set(key, done);
  done.then(() => flights.get(key) === done && flights.delete(key));
  return go;
}
/* o: { force, scope: 'page' | 'form' | 'field', frameId (right-click menu: the frame clicked),
   forceType (menu 'Fill field as': fill it as that type and remember it), forget (menu 'Forget this field') } */
const fillTab = (tabId, o = {}) => inTurn(tabId, () => fillOnce(tabId, o));
const undoTab = (tabId) => inTurn(tabId, () => undoOnce(tabId));

/* Storage steps take the lock; the injection does not, so one stuck page (alert open, still loading) can't hold up other tabs. */
async function fillOnce(tabId, { force = false, scope = 'page', frameId, forceType = '', forget = false } = {}) {
  scope = SCOPES.includes(scope) ? scope : 'page';
  const pre = await locked(async () => {
    const settings = await getSettings(), url = await tabUrl(tabId);
    if (!force && matchEntry(url, settings.blocked)) return { blocked: true, host: hostKey(url) };
    const geo = await detectGeo(false, settings), site = siteKey(url), s = site ? (await liveSessions(settings, geo))[site] : null;
    const { rules, overrides } = await lists();
    // a field being forgotten fills as detected, without what was remembered for it
    const extra = { rules: rulesFor(url, rules), overrides: forget ? [] : overridesFor(site, overrides) };
    if (s) return { settings, geo, url, site, extra, persona: s.persona, usedPassword: s.usedPassword };
    // take the next identity now and line up a fresh one, so a fill on another site meanwhile gets a different one
    const persona = await nextPersona(settings, geo), spare = site ? await newPersona(settings, geo) : null;
    return { settings, geo, url, site, extra, persona, spare };
  });
  if (pre.blocked) return { ok: false, blocked: true, host: pre.host };
  const { settings, geo, url, site, extra, persona: raw, spare } = pre;
  const persona = withPrefs(raw, settings);
  // a site whose rules changed the password gets that password again (its login step), as the base for any further fitting
  const sent = pre.usedPassword ? { ...persona, password: pre.usedPassword } : persona;
  // A form/field picked from the right-click menu: only the frame clicked. Otherwise every frame, and each one checks its own focus.
  const targeted = scope !== 'page' && Number.isInteger(frameId) && frameId >= 0;
  const fillId = newId(); // undo reverts this fill only, in the frames it changed
  let count = 0, error = '', usedPassword = '', report = { filled: 0, skipped: {} }, fieldKey = '';
  if (!scriptable(url)) error = NO_RUN;
  else {
    try {
      const target = targeted ? { tabId, frameIds: [frameId] } : { tabId, allFrames: true };
      await inject(target);
      const only = scope === 'page' ? await modalFrames(tabId) : null;
      const results = await run(only ? { tabId, frameIds: only } : target, (p, o) => (window.__formGhost ? window.__formGhost.fill(p, o) : 0),
        [sent, { ...settings, ...extra, scope, frameTargeted: targeted, fillId, ...(forceType ? { forceType } : {}) }]);
      count = total(results);
      report = reportOf(results);
      fieldKey = scope === 'field' ? fieldKeyOf(results) : '';
      usedPassword = count > 0 ? passwordUsed(results, persona.password) : '';
      if (count > 0) await setLastFill(tabId, fillId, framesOf(results)); // a fill that changed nothing keeps the previous one undoable
    } catch (e) { error = friendly(e); }
  }
  const s = await locked(async () => {
    // 'Fill field as' remembers the type for this field on this site; 'Forget this field' drops it
    if (!error && site && fieldKey && (forceType || forget)) {
      const ov = await getList('overrides');
      await putList('overrides', forget ? RULES.dropOverride(ov, site, fieldKey) : RULES.setOverride(ov, site, fieldKey, forceType));
    }
    if (!error && count > 0 && site) { // the site keeps this identity (re-read: a fill elsewhere may have saved meanwhile)
      // an identity from another country can only be here because it was picked from Recent: keep it picked, or the next read drops it
      const sessions = await liveSessions(settings, geo), cur = sessions[site] || { persona: raw, steps: 0, ...(fits(raw, settings, geo) ? {} : { picked: true }) };
      sessions[site] = { ...cur, steps: cur.steps + 1, ts: Date.now(), ...(usedPassword ? { usedPassword } : {}) };
      await saveSessions(sessions);
      await remember(sessions[site].persona, site, sessions[site].usedPassword);
      return sessions[site];
    }
    const { persona: next } = await chrome.storage.local.get('persona'); // nothing filled: it stays the next identity
    if (spare && next && next.id === spare.id) await chrome.storage.local.set({ persona: raw });
    return null;
  });
  if (error) return { ok: false, error };
  badge(tabId, String(count));
  return { ok: true, count, used: persona, persona, session: sessionOut(site, s), scope, report, ...(fieldKey ? { fieldKey } : {}) };
}

/* Puts back what the last fill changed. Every frame is asked; only the frames that fill changed restore, the others drop older records.
   Identities are left alone. */
async function undoOnce(tabId) {
  if (!scriptable(await tabUrl(tabId))) return { ok: false, error: NO_RUN };
  try {
    const results = await run({ tabId, allFrames: true }, (id) => (window.__formGhost && window.__formGhost.undo ? window.__formGhost.undo(id) : 0), [await tabGet('lastFill', tabId)]);
    await setLastFill(tabId, null);
    return { ok: true, count: total(results) };
  } catch (e) { return { ok: false, error: friendly(e) }; }
}

/* 'Insert test value ▸': the focused field of the clicked frame gets an edge-case value (content/qa.js), undoable like a field fill.
   The undo id is the one the frame recorded (its own if it ignores ours; none → every frame's last record). */
async function edgeOnce(tabId, kind, frameId) {
  const settings = await getSettings(), url = await tabUrl(tabId);
  if (matchEntry(url, settings.blocked)) return { ok: false, blocked: true, host: hostKey(url) };
  if (!scriptable(url)) return { ok: false, error: NO_RUN };
  const targeted = Number.isInteger(frameId) && frameId >= 0, target = targeted ? { tabId, frameIds: [frameId] } : { tabId, allFrames: true };
  const fillId = newId();
  try {
    await inject(target);
    const results = await run(target, (k, o) => {
      const g = window.__formGhost;
      if (!g || typeof g.insertEdge !== 'function') return 0;
      const done = (r) => (r && typeof r === 'object' ? { ...r, lastId: g.lastId } : { count: Number(r) || 0, lastId: g.lastId });
      const r = g.insertEdge(k, o);
      return r && typeof r.then === 'function' ? r.then(done) : done(r);
    }, [kind, { ...settings, scope: 'field', frameTargeted: targeted, fillId }]);
    const count = total(results);
    if (count > 0) {
      const ids = [...new Set((results || []).map((r) => r && r.result && r.result.lastId).filter((x) => typeof x === 'string' && x))];
      await setLastFill(tabId, ids.includes(fillId) ? fillId : ids.length === 1 ? ids[0] : null, framesOf(results));
    }
    badge(tabId, String(count));
    return { ok: true, count };
  } catch (e) { return { ok: false, error: friendly(e) }; }
}

/* Inspect: every frame shows what each field would be filled as (or why it is skipped), with the site's rules, remembered fields and the
   Testing switches a fill would use; off removes the tags */
async function inspectTab(tabId, on) {
  const url = await tabUrl(tabId);
  if (!scriptable(url)) return { ok: false, error: NO_RUN };
  try {
    const target = { tabId, allFrames: true };
    let opts = null;
    if (on) {
      const settings = await getSettings(), { rules, overrides } = await lists();
      opts = { rules: rulesFor(url, rules), overrides: overridesFor(siteKey(url), overrides), testCards: !!settings.testCards, sampleFiles: !!settings.sampleFiles, edgeMode: !!settings.edgeMode };
      await inject(target);
    }
    const results = await run(target, (v, o) => (window.__formGhost && window.__formGhost.overlay ? window.__formGhost.overlay(v, o) : 0), [on, opts]);
    await tabSet('inspect', tabId, on || null);
    return { ok: true, on, count: total(results) };
  } catch (e) { return { ok: false, error: friendly(e) }; }
}

/* 'Copy as ▸': the last fill's records (from the frames it changed) as JSON / Playwright / Cypress, formatted by content/qa.js
   (here when the worker has it, else in the page; plain JSON when neither does) */
async function copyFill(tabId, format) {
  if (!FORMATS.includes(format)) return { ok: false, error: 'Copy as JSON, Playwright or Cypress.' };
  const url = await tabUrl(tabId);
  if (!scriptable(url)) return { ok: false, error: NO_RUN };
  const frames = (await tabGet('lastFrames', tabId)) || [];
  const ask = (target) => run(target, () => (window.__formGhost && window.__formGhost.records ? window.__formGhost.records() : []));
  try {
    let results;
    try { results = await ask(frames.length ? { tabId, frameIds: frames } : { tabId, allFrames: true }); } catch (e) {
      if (!frames.length) throw e;
      results = await ask({ tabId, allFrames: true }); // that frame is gone: whatever the others have
    }
    const got = (results || []).filter((r) => r && Array.isArray(r.result) && r.result.length), records = got.flatMap((r) => r.result);
    if (!records.length) return { ok: false, error: 'Nothing to copy yet: fill the page first.' };
    let text = '';
    try { if (QA && typeof QA.format === 'function') text = QA.format(records, format, { url: /^https?:/i.test(url) ? url.replace(/[?#].*$/, '') : '' }); } catch (e) { /* the page's below */ }
    if (typeof text !== 'string') text = '';
    if (!text) try {
      const [out] = await run({ tabId, frameIds: [Number.isInteger(got[0].frameId) ? got[0].frameId : 0] }, (recs, f) => {
        const q = window.__fgExt && window.__fgExt.qa;
        return q && typeof q.format === 'function' ? q.format(recs, f) : null;
      }, [records, format]);
      text = out && typeof out.result === 'string' ? out.result : '';
    } catch (e) { /* the fallback below */ }
    text = text || RULES.format(records, format);
    return text ? { ok: true, text, format, count: records.length } : { ok: false, error: 'Reload the page and fill it again, then copy.' };
  } catch (e) { return { ok: false, error: friendly(e) }; }
}

/* Per-tab values storage.session keeps while the worker sleeps: lastFill (the id of the tab's last fill that changed something),
   lastFrames (the frames it changed), inspect (Inspect is on) */
const TAB_VALUES = ['lastFill', 'lastFrames', 'inspect'];
const tabMem = new Map();
async function tabGet(name, tabId) {
  if (tabId == null) return null;
  const k = name + ':' + tabId;
  if (tabMem.has(k)) return tabMem.get(k);
  try { const v = (await chrome.storage.session.get(k))[k]; return v === undefined ? null : v; } catch (e) { return null; }
}
async function tabSet(name, tabId, v) {
  const k = name + ':' + tabId;
  tabMem.set(k, v == null ? null : v);
  try { await (v == null ? chrome.storage.session.remove(k) : chrome.storage.session.set({ [k]: v })); } catch (e) { /* no session storage: memory only */ }
}
async function setLastFill(tabId, id, frames) {
  await tabSet('lastFill', tabId, id || null);
  if (id || frames) await tabSet('lastFrames', tabId, frames && frames.length ? frames : null);
}

/* A modal open in the top frame covers the frames behind it, which can't see it: a page fill then goes only to frame 0 (when the
   dialog's own controls are what it fills) and the frames inside the dialog. null: no such modal, every frame fills. */
async function modalFrames(tabId) {
  const [top] = (await run({ tabId, frameIds: [0] }, () => (window.__formGhost && window.__formGhost.modal ? window.__formGhost.modal() : null))) || [];
  const m = top && top.result;
  if (!m || typeof m !== 'object' || !Array.isArray(m.frames)) return null;
  if (!m.frames.length) return m.own ? [0] : null;
  const all = await run({ tabId, allFrames: true }, (idx) => (window.__formGhost && window.__formGhost.where ? window.__formGhost.where(idx) : null), [m.frames]);
  const inside = (all || []).filter((r) => r && r.frameId > 0 && r.result && Array.isArray(r.result.path) && m.frames.includes(r.result.path[0]));
  if (!m.own && !inside.some((r) => r.result.real)) return null; // e.g. a cookie-consent frame with nothing to fill: the page fills as usual
  return [...(m.own ? [0] : []), ...inside.map((r) => r.frameId)];
}

/* One clear-timer per tab, so an old timer can't wipe a newer badge. A title explains OFF / ! on hover. */
const timers = new Map();
function badge(tabId, text, title = '') {
  if (tabId == null || tabId < 0) return;
  const a = chrome.action, quiet = () => {};
  a.setBadgeBackgroundColor({ tabId, color: text === '!' ? '#b91c1c' : '#18181b' }).catch(quiet);
  a.setBadgeText({ tabId, text }).catch(quiet);
  a.setTitle({ tabId, title: title || TITLE }).catch(quiet);
  clearTimeout(timers.get(tabId));
  timers.set(tabId, setTimeout(() => {
    timers.delete(tabId);
    a.setBadgeText({ tabId, text: '' }).catch(quiet);
    a.setTitle({ tabId, title: TITLE }).catch(quiet);
  }, title ? 8000 : 2500));
}

/* Hotkey / context menu: no popup to show errors, so the badge and its tooltip do. */
function quietly(tabId, res) {
  if (res.blocked) badge(tabId, 'OFF', `FormGhost is off on ${res.host}, open the popup to fill anyway`);
  else if (!res.ok) badge(tabId, '!', res.error || 'Something went wrong.');
}
const quickFill = async (tabId, o = {}) => quietly(tabId, await fillTab(tabId, o).catch((e) => ({ ok: false, error: friendly(e) })));
const quickEdge = async (tabId, kind, frameId) => quietly(tabId, await inTurn(tabId, () => edgeOnce(tabId, kind, frameId)).catch((e) => ({ ok: false, error: friendly(e) })));
async function quickUndo(tabId) {
  const res = await undoTab(tabId).catch((e) => ({ ok: false, error: friendly(e) }));
  if (!res.ok) badge(tabId, '!', res.error || 'Something went wrong.');
  else badge(tabId, res.count ? '↺' + res.count : '0');
}

const HANDLERS = {
  state: (m) => locked(() => state(m.tabId)),
  refreshGeo: (m) => locked(() => state(m.tabId, true)),
  setSettings: (m) => locked(() => setSettings(m.tabId, m.patch)),
  shuffle: (m) => locked(() => shuffle(m.tabId)),
  fill: (m) => fillTab(m.tabId, { force: !!m.force, scope: m.scope }), // locks its own storage steps
  undo: (m) => undoTab(m.tabId),
  usePersona: (m) => locked(() => usePersona(m.tabId, m.id)),
  blockSite: (m) => locked(() => blockSite(m.tabId, !!m.block)),
  setRules: (m) => locked(() => setRules(m.tabId, m.rules)),
  removeOverride: (m) => locked(() => removeOverride(m.tabId, m.site, m.key)),
  exportSettings: (m) => locked(() => exportSettings(!!m.includeHistory)),
  importSettings: (m) => locked(() => importSettings(m.tabId, m.json, m.mode, !!m.dryRun)),
  inspect: (m) => inspectTab(m.tabId, !!m.on),
  copyFill: (m) => inTurn(m.tabId, () => copyFill(m.tabId, m.format)), // after a fill still running there
  bulkExport: (m) => bulkExport(m),
};

/* The popup may send any of these. A page's frame (content/overlay.js: Esc or its close chip) may only turn Inspect off, in its own tab. */
const fromPage = (sender) => !!(sender && sender.tab) && !String(sender.url || '').startsWith(chrome.runtime.getURL(''));
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (fromPage(sender)) {
    if (!(msg && msg.type === 'inspect' && msg.on === false && Number.isInteger(sender.tab.id))) { send({ ok: false }); return false; }
    inspectTab(sender.tab.id, false).then(send, (e) => send({ ok: false, error: friendly(e) }));
    return true;
  }
  const h = msg && Object.hasOwn(HANDLERS, msg.type) && HANDLERS[msg.type];
  if (!h) { send({ ok: false }); return false; }
  Promise.resolve().then(() => h(msg)).then(send, (e) => send({ ok: false, error: friendly(e) }));
  return true;
});

const MENU = [
  ['fg-fill', 'Fill this page', ['page', 'frame', 'editable']],
  ['fg-fill-form', 'Fill this form', ['editable']],
  ['fg-fill-field', 'Fill this field', ['editable']],
  ['fg-as', 'Fill field as', ['editable']],
  ['fg-edge', 'Insert test value', ['editable']],
  ['fg-undo', 'Undo last fill', ['page', 'frame', 'editable']],
];
// 'Fill field as ▸' → fg-as-<type>: fills the clicked field as that type and remembers it for the site; fg-as-forget fills it as detected and forgets
const AS_TYPES = [['fullName', 'Full name'], ['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'], ['phone', 'Phone'], ['address1', 'Address'],
  ['city', 'City'], ['state', 'State'], ['zip', 'PIN/ZIP'], ['dob', 'Date of birth'], ['company', 'Company'], ['jobTitle', 'Job title'], ['number', 'Number'],
  ['text', 'Text'], ['-'], ['skip', 'Skip this field'], ['forget', 'Forget this field']];
// 'Insert test value ▸' → fg-edge-<kind>: the kinds of content/qa.js
const EDGE_KINDS = QA && Array.isArray(QA.kinds) && QA.kinds.some((k) => k && /^[\w-]{1,40}$/.test(k.id))
  ? QA.kinds.filter((k) => k && /^[\w-]{1,40}$/.test(k.id)).map((k) => [k.id, String(k.label || k.id).slice(0, 60)])
  : [['long', 'Very long text'], ['unicode', 'Unicode + emoji'], ['rtl', 'Right-to-left text'], ['apostrophe', "O'Brien-Smith name"], ['spaces', 'Padded with spaces'],
    ['html', 'HTML-like text'], ['email', 'Invalid email'], ['below', 'Below minimum'], ['above', 'Above maximum'], ['zero', 'Zero'], ['negative', 'Negative number'],
    ['huge', 'Huge number'], ['decimal', 'Decimal number'], ['past', 'Far-past date'], ['future', 'Far-future date']];
const MENU_SCOPE = { 'fg-fill': 'page', 'fg-fill-form': 'form', 'fg-fill-field': 'field' };
const COMMAND_SCOPE = { 'fill-page': 'page', 'fill-form': 'form', 'fill-field': 'field' };

function buildMenus() {
  const add = (o) => chrome.contextMenus.create(o);
  for (const [id, title, contexts] of MENU) {
    add({ id, title, contexts });
    if (id === 'fg-as') AS_TYPES.forEach(([t, name]) => add(t === '-' ? { id: 'fg-as-sep', parentId: id, type: 'separator', contexts } : { id: 'fg-as-' + t, parentId: id, title: name, contexts }));
    if (id === 'fg-edge') EDGE_KINDS.forEach(([k, name]) => add({ id: 'fg-edge-' + k, parentId: id, title: name, contexts }));
  }
}

chrome.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
  chrome.contextMenus.removeAll(buildMenus);
  locked(async () => {
    await chrome.storage.local.remove('session'); // pre-1.2 single-site session; identities now live in 'sessions'
    // Overwrite is off by default from 1.2; people updating from older versions who never changed it keep it on.
    const { settings } = await chrome.storage.sync.get('settings');
    if (reason === 'update' && /^(0|1\.[01])(\.|$)/.test(previousVersion || '') && !(settings && 'overwrite' in settings)) {
      await chrome.storage.sync.set({ settings: { ...(settings || {}), overwrite: true } });
    }
    if ((await getSettings()).country === 'auto') await detectGeo(true);
  }).catch(() => {});
});

// Form / field from the menu: only the frame that was right-clicked fills (it knows which control was clicked)
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !(tab.id >= 0)) return;
  const id = String(info.menuItemId), as = id.startsWith('fg-as-') && id.slice(6), kind = id.startsWith('fg-edge-') && id.slice(8);
  if (id === 'fg-undo') quickUndo(tab.id);
  else if (MENU_SCOPE[id]) quickFill(tab.id, { scope: MENU_SCOPE[id], frameId: info.frameId });
  else if (as && AS_TYPES.some(([t]) => t === as && t !== '-')) quickFill(tab.id, { scope: 'field', frameId: info.frameId, ...(as === 'forget' ? { forget: true } : { forceType: as }) });
  else if (kind && EDGE_KINDS.some(([k]) => k === kind)) quickEdge(tab.id, kind, info.frameId);
});

chrome.tabs.onRemoved.addListener((tabId) => { for (const n of TAB_VALUES) tabSet(n, tabId, null); });
// a page that navigates loses its Inspect tags
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info && info.status === 'loading' && tabMem.get('inspect:' + tabId) !== null) tabSet('inspect', tabId, null); });

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (!COMMAND_SCOPE[cmd] && cmd !== 'undo-fill') return;
  const t = tab && tab.id >= 0 ? tab : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!t || t.id == null) return;
  if (cmd === 'undo-fill') quickUndo(t.id);
  else quickFill(t.id, { scope: COMMAND_SCOPE[cmd] });
});
