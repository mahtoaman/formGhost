/*!
 * FormGhost - https://github.com/mahtoaman/formghost
 * Copyright 2026 Aman Mahto (@mahtoaman)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 */
/* FormGhost: fill rules and remembered fields: validation, caps, settings-file checks, a fallback export format. Pure: no chrome.* APIs. */
(function (G) {
  const LIMITS = { rules: 300, value: 2000, match: 500, regex: 200, repeat: 1000, perSite: 200, overrides: 2000, key: 300, history: 15, json: 2e6, depth: 12 };
  const BAD = new Set(['__proto__', 'constructor', 'prototype']);
  const TYPE = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/, ID = /^[A-Za-z0-9_-]{1,40}$/;
  const RE = /^\/([\s\S]+)\/([a-z]*)$/, ATTR = /^(name|id|label)=([\s\S]*)$/i;
  const plain = (o) => !!o && typeof o === 'object' && Object.prototype.toString.call(o) === '[object Object]';
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const newId = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const okSite = (s) => typeof s === 'string' && s.length > 0 && s.length <= 260 && !BAD.has(s) && !/[\s/?#\\"'<>]/.test(s);

  // '/regex/flags' on the field's hint, 'name=' / 'id=' / 'label=' exact, anything else a CSS selector
  const kindOf = (m) => (RE.test(m) ? 'regex' : ATTR.test(m) ? 'attr' : 'css');

  /* Patterns that can take exponential time: a repeated group that itself repeats ((a+)+, (\w*)*, (x?y?){2,}), a repeated group
     with alternatives that can overlap ((a|ab)*, and any whose alternatives hold a class, an escape class or a dot: (\w|\d)+, ([a-z]|_)*),
     backreferences, and huge {n,m} counts. Hints are short, so polynomial ones are fine. */
  const LIT = /^(?:[^\\[\].*+?{}()|^$]|\\[^dDwWsSpPuxc0-9bBk])*$/; // plain text and escaped punctuation only
  function quant(s, j) {
    const c = s[j];
    if (c === '*' || c === '+') return { many: true };
    if (c === '?') return { many: false };
    const m = c === '{' && s.slice(j).match(/^\{(\d+)(,(\d*))?\}/);
    if (!m) return null;
    const lo = +m[1], hi = m[2] ? (m[3] === '' ? Infinity : +m[3]) : lo;
    return { many: hi > 1, big: lo > LIMITS.repeat || (hi !== Infinity && hi > LIMITS.repeat) };
  }
  function risky(s) {
    const stack = [{ q: false, alt: false, nested: false, start: -1 }];
    let cls = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i], top = stack[stack.length - 1];
      if (c === '\\') { if (!cls && /[1-9k]/.test(s[i + 1] || '')) return 'backreferences aren’t allowed'; i++; continue; }
      if (cls) { if (c === ']') cls = false; continue; }
      if (c === '[') { cls = true; continue; }
      if (c === '(') {
        top.nested = true; stack.push({ q: false, alt: false, nested: false, start: i });
        const mod = s.slice(i + 1).match(/^\?(?:[:=!]|<[=!]|<[A-Za-z]\w*>)/); // (?: (?= (?! (?<= (?<! (?<name>
        if (mod) i += mod[0].length;
        continue;
      }
      if (c === '|') { top.alt = true; continue; }
      if (c === ')') {
        const g = stack.pop();
        if (!stack.length) return 'unbalanced parentheses';
        const after = quant(s, i + 1);
        if (after && after.big) return 'repeat counts above 1000 aren’t allowed';
        if (after && after.many && g.q) return 'a repeated group that repeats inside can hang (e.g. (a+)+)';
        if (after && after.many && g.alt) {
          const alts = s.slice(g.start + 1, i).replace(/^\?(?:[:=!]|<[=!]|<[A-Za-z]\w*>)/, '').split('|');
          if (g.nested || alts.some((a) => !LIT.test(a))) return 'a repeated group of alternatives that can overlap can hang (e.g. (\\w|\\d)+): use one class such as [\\w-]+';
          if (alts.some((a, k) => alts.some((b, l) => k !== l && b.startsWith(a)))) return 'a repeated group with overlapping alternatives can hang (e.g. (a|ab)*)';
        }
        if (g.q || after) stack[stack.length - 1].q = true;
        continue;
      }
      const q = quant(s, i);
      if (q) { if (q.big) return 'repeat counts above 1000 aren’t allowed'; top.q = true; }
    }
    return cls ? 'unclosed [' : stack.length > 1 ? 'unbalanced parentheses' : '';
  }
  function badRegex(m) {
    const [, src, flags] = m.match(RE);
    if (src.length > LIMITS.regex) return `the pattern is longer than ${LIMITS.regex} characters`;
    if (!/^[imsu]*$/.test(flags) || new Set(flags).size !== flags.length) return 'only the flags i, m, s and u are allowed';
    const r = risky(src);
    if (r) return r;
    try { new RegExp(src, flags); } catch (e) { return 'the regular expression doesn’t compile'; }
    return '';
  }

  /* A real parse where there is a DOM (popup, tests); a structural check in the service worker. Nothing touches a page. */
  function badSelector(s) {
    const doc = G.document;
    if (doc && typeof doc.createDocumentFragment === 'function') {
      try { doc.createDocumentFragment().querySelector(s); return ''; } catch (e) { return 'isn’t a valid CSS selector'; }
    }
    const open = [];
    let q = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') { i++; continue; }
      if (q) { if (c === q) q = ''; continue; }
      if (c === '"' || c === "'") q = c;
      else if (c === '[' || c === '(') open.push(c);
      else if (c === '=' && open[open.length - 1] !== '[') return 'can’t contain “=” outside [ ]';
      else if (c === ']' || c === ')') { if (open.pop() !== (c === ']' ? '[' : '(')) return 'has unbalanced brackets'; }
      else if ('{};<@!`%&/'.includes(c) || c < ' ') return `can’t contain “${c < ' ' ? '\\x' + c.charCodeAt(0).toString(16) : c}”`;
    }
    if (q) return 'has an unclosed quote';
    if (open.length) return 'has unbalanced brackets';
    if (/^\s*[>+~,]|[>+~,]\s*$|,\s*,/.test(s) || !/[A-Za-z*#.[:]/.test(s)) return 'isn’t a valid CSS selector';
    return '';
  }

  function badMatch(m) {
    const k = kindOf(m);
    if (k === 'regex') return badRegex(m);
    if (k === 'attr') return m.match(ATTR)[2].trim() ? '' : 'needs a value after =';
    return badSelector(m);
  }

  /* One rule { id, site, match, value, on } → [rule, ''] or [null, why]. site '' = every site; normSite tidies the others.
     strict: unknown keys are an error (a settings file), else dropped (the popup). */
  function cleanRule(r, { normSite, strict } = {}) {
    if (!plain(r)) return [null, 'isn’t an object'];
    const extra = Object.keys(r).find((k) => !['id', 'site', 'match', 'value', 'on'].includes(k));
    if (extra && (strict || BAD.has(extra))) return [null, `has an unknown field “${extra}”`];
    if (r.id != null && (typeof r.id !== 'string' || !ID.test(r.id))) return [null, 'has a bad id'];
    if (r.site != null && typeof r.site !== 'string') return [null, 'site must be text'];
    if (typeof r.match !== 'string' || !r.match.trim()) return [null, 'needs a field to match'];
    if (r.value != null && typeof r.value !== 'string' && typeof r.value !== 'number') return [null, 'value must be text'];
    if (r.on != null && typeof r.on !== 'boolean') return [null, 'on must be true or false'];
    let site = (r.site || '').trim();
    if (site === '*' || /^(all|any)( sites)?$/i.test(site)) site = '';
    if (site) {
      site = normSite ? normSite(site) : site.toLowerCase();
      if (!site || site.length > 260 || BAD.has(site)) return [null, 'site isn’t a host name'];
    }
    let match = r.match.trim();
    if (match.length > LIMITS.match) return [null, `match is longer than ${LIMITS.match} characters`];
    const a = match.match(ATTR);
    if (a) match = a[1].toLowerCase() + '=' + a[2].trim();
    const why = badMatch(match);
    if (why) return [null, `match ${why}`];
    const value = r.value == null ? '' : String(r.value);
    if (value.length > LIMITS.value) return [null, `value is longer than ${LIMITS.value} characters`];
    return [{ id: r.id || newId(), site, match, value, on: r.on !== false }, ''];
  }

  // a whole list: { rules } or { error, index }; a repeated id gets a new one
  function cleanRules(list, opts = {}) {
    if (!Array.isArray(list)) return { error: 'Rules must be a list.' };
    if (list.length > LIMITS.rules) return { error: `Too many rules (at most ${LIMITS.rules}).` };
    const out = [], ids = new Set();
    for (let i = 0; i < list.length; i++) {
      const [r, why] = cleanRule(list[i], opts);
      if (!r) return { error: `Rule ${i + 1} ${why}.`, index: i };
      if (ids.has(r.id)) r.id = newId() + i;
      ids.add(r.id);
      out.push(r);
    }
    return { rules: out };
  }

  /* Remembered fields { [siteKey]: [{ key, type }] }: one entry per key (the last wins), at most 200 per site and 2000 in all */
  function cleanEntry(e) {
    if (!plain(e)) return [null, 'isn’t an object'];
    const extra = Object.keys(e).find((k) => k !== 'key' && k !== 'type');
    if (extra) return [null, `has an unknown field “${extra}”`];
    if (typeof e.key !== 'string' || !e.key || e.key.length > LIMITS.key || /[\u0000-\u001f]/.test(e.key)) return [null, 'has a bad field key'];
    if (typeof e.type !== 'string' || !TYPE.test(e.type)) return [null, 'has a bad type'];
    return [{ key: e.key, type: e.type }, ''];
  }
  const countOverrides = (map) => Object.values(map || {}).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0);
  function cleanOverrides(map) {
    if (!plain(map)) return { error: 'Remembered fields must be an object of sites.' };
    const out = {};
    for (const [site, list] of Object.entries(map)) {
      if (!okSite(site)) return { error: `“${String(site).slice(0, 40)}” isn’t a site.` };
      if (!Array.isArray(list)) return { error: `Remembered fields for ${site} must be a list.` };
      const seen = new Map();
      for (let i = 0; i < list.length; i++) {
        const [e, why] = cleanEntry(list[i]);
        if (!e) return { error: `Remembered field ${i + 1} on ${site} ${why}.` };
        seen.delete(e.key); seen.set(e.key, e);
      }
      if (seen.size > LIMITS.perSite) return { error: `Too many remembered fields on ${site} (at most ${LIMITS.perSite}).` };
      if (seen.size) out[site] = [...seen.values()];
    }
    if (countOverrides(out) > LIMITS.overrides) return { error: `Too many remembered fields (at most ${LIMITS.overrides}).` };
    return { overrides: out };
  }
  // a copy with { key, type } remembered on site (moved to the newest place); the oldest go past the caps
  function setOverride(map, site, key, type) {
    const [e] = cleanEntry({ key, type });
    if (!e || !okSite(site)) return map;
    const out = { ...(map || {}) }, list = (out[site] || []).filter((x) => x.key !== key).concat(e).slice(-LIMITS.perSite);
    delete out[site]; out[site] = list; // the site last changed goes last, so the caps drop the least recent first
    let extra = countOverrides(out) - LIMITS.overrides;
    for (const s of Object.keys(out)) {
      if (extra <= 0) break;
      const cut = Math.min(extra, out[s].length - (s === site ? 1 : 0));
      out[s] = out[s].slice(cut); extra -= cut;
      if (!out[s].length) delete out[s];
    }
    return out;
  }
  // a copy without that key (no key: the whole site)
  function dropOverride(map, site, key) {
    const out = { ...(map || {}) };
    if (typeof site !== 'string' || !has(out, site)) return out;
    const list = key == null ? [] : out[site].filter((x) => x.key !== key);
    if (list.length) out[site] = list; else delete out[site];
    return out;
  }

  /* A settings file: JSON text → { data: { settings?, rules?, overrides?, history? } } or { error }. Only known keys, checked types,
     never __proto__ / constructor / prototype anywhere. env: { checkSettings(obj) → { settings } | { error }, normSite, checkPersona? } */
  function unsafe(v, depth) {
    if (depth > LIMITS.depth) return 'is nested too deeply';
    if (Array.isArray(v)) { for (const x of v) { const w = unsafe(x, depth + 1); if (w) return w; } return ''; }
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) { if (BAD.has(k)) return `contains a forbidden key “${k}”`; const w = unsafe(v[k], depth + 1); if (w) return w; }
    }
    return '';
  }
  /* the shape of sample values (freshly generated personas): the types seen, an object's keys (the ones every sample has are required) and an
     array's items; misfit(shape, v) → '' or the path of the first key that is unknown, missing or of another type */
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  function shapeOf(vals) {
    const sh = { t: new Set(vals.map(typeOf)) }, objs = vals.filter(plain), arrs = vals.filter(Array.isArray);
    if (objs.length) {
      sh.k = Object.create(null); sh.req = new Set();
      for (const k of new Set(objs.flatMap(Object.keys))) {
        const xs = objs.filter((o) => has(o, k));
        sh.k[k] = shapeOf(xs.map((o) => o[k]));
        if (xs.length === objs.length) sh.req.add(k);
      }
    }
    if (arrs.length) sh.i = shapeOf(arrs.flat());
    return sh;
  }
  function misfit(sh, v, at = '', optional = null, depth = 0) { // optional: keys that may be missing (newer than some files)
    const t = typeOf(v);
    if (!sh || !sh.t.has(t) || depth > LIMITS.depth) return at || '(top)';
    if (t === 'object' && sh.k) {
      for (const k of Object.keys(v)) if (!has(sh.k, k)) return `${at}.${k}`;
      for (const k of sh.req) if (!has(v, k) && !(optional && optional.has(k))) return `${at}.${k}`;
      for (const k of Object.keys(v)) { const w = misfit(sh.k[k], v[k], `${at}.${k}`, optional, depth + 1); if (w) return w; }
    }
    if (t === 'array') for (const x of v) { const w = misfit(sh.i, x, `${at}[]`, optional, depth + 1); if (w) return w; }
    return '';
  }

  function cleanHistory(list) {
    if (!Array.isArray(list)) return { error: 'History must be a list.' };
    if (list.length > LIMITS.history) return { error: `History has more than ${LIMITS.history} identities.` };
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const h = list[i], n = `History entry ${i + 1}`;
      if (!plain(h) || Object.keys(h).some((k) => !['persona', 'site', 'ts', 'usedPassword'].includes(k))) return { error: `${n} isn’t an identity.` };
      const p = h.persona;
      if (!plain(p) || typeof p.id !== 'string' || !ID.test(p.id) || typeof p.country !== 'string' || !/^[A-Z]{2}$/.test(p.country)
        || ['fullName', 'email'].some((k) => typeof p[k] !== 'string')) return { error: `${n} has no usable identity.` };
      if (JSON.stringify(p).length > 100000) return { error: `${n} is too large.` };
      if (h.site != null && (typeof h.site !== 'string' || h.site.length > 260)) return { error: `${n} has a bad site.` };
      if (!Number.isFinite(h.ts)) return { error: `${n} has no time.` };
      if (h.usedPassword != null && (typeof h.usedPassword !== 'string' || h.usedPassword.length > 200)) return { error: `${n} has a bad password.` };
      out.push({ persona: p, site: h.site || '', ts: h.ts, ...(h.usedPassword ? { usedPassword: h.usedPassword } : {}) });
    }
    return { history: out };
  }
  function checkImport(text, env = {}) {
    if (typeof text !== 'string' || !text.trim()) return { error: 'The file is empty.' };
    if (text.length > LIMITS.json) return { error: 'The file is too large for a FormGhost settings file.' };
    let o;
    try { o = JSON.parse(text); } catch (e) { return { error: 'The file isn’t valid JSON.' }; }
    if (!plain(o)) return { error: 'The file isn’t a FormGhost settings file.' };
    const bad = unsafe(o, 0);
    if (bad) return { error: `The file ${bad}.` };
    const extra = Object.keys(o).find((k) => !['app', 'version', 'generator', 'exportedAt', 'settings', 'rules', 'overrides', 'history'].includes(k));
    if (extra) return { error: `The file has an unknown key “${extra.slice(0, 40)}”.` };
    if (o.app != null && o.app !== 'FormGhost') return { error: 'The file isn’t a FormGhost settings file.' };
    if (o.version != null && (typeof o.version !== 'string' || o.version.length > 20)) return { error: 'The file has a bad version.' };
    // generator: the export's credit line ('FormGhost 2.0.0 by @mahtoaman (…)'); a short string, otherwise ignored
    if (o.generator != null && (typeof o.generator !== 'string' || o.generator.length > 300)) return { error: 'The file has a bad generator.' };
    if (o.exportedAt != null && typeof o.exportedAt !== 'string' && !Number.isFinite(o.exportedAt)) return { error: 'The file has a bad export date.' };
    const data = {};
    let { rules, overrides } = o;
    if (o.settings != null) {
      if (!plain(o.settings)) return { error: 'Settings must be an object.' };
      const s = { ...o.settings };
      for (const k of ['rules', 'overrides']) {
        if (!has(s, k)) continue;
        if (o[k] != null) return { error: `${k} appears twice in the file.` };
        if (k === 'rules') rules = s.rules; else overrides = s.overrides;
        delete s[k];
      }
      const r = env.checkSettings ? env.checkSettings(s) : { settings: s };
      if (r.error) return { error: r.error };
      data.settings = r.settings;
    }
    if (rules != null) { const r = cleanRules(rules, { normSite: env.normSite, strict: true }); if (r.error) return { error: r.error }; data.rules = r.rules; }
    if (overrides != null) { const r = cleanOverrides(overrides); if (r.error) return { error: r.error }; data.overrides = r.overrides; }
    if (o.history != null) {
      const r = cleanHistory(o.history);
      if (r.error) return { error: r.error };
      // checkPersona(p) → true, or why not (a country FormGhost doesn't know, a persona not shaped like the ones it makes)
      if (env.checkPersona) for (let i = 0; i < r.history.length; i++) { const w = env.checkPersona(r.history[i].persona); if (w !== true) return { error: `History entry ${i + 1} ${typeof w === 'string' && w ? w : 'is from a country FormGhost doesn’t know'}.` }; }
      data.history = r.history;
    }
    if (!Object.keys(data).length) return { error: 'The file has nothing to import.' };
    return { data };
  }

  /* The fill's records as text when the page's own formatter (content/qa.js) is missing: JSON only */
  const format = (records, fmt) => (fmt === 'json' || !fmt ? JSON.stringify((Array.isArray(records) ? records : []).filter(plain), null, 2) : '');

  G.FG_RULES = { LIMITS, kindOf, risky, badRegex, badSelector, badMatch, cleanRule, cleanRules, cleanOverrides, setOverride, dropOverride, countOverrides, checkImport, format, okSite, shapeOf, misfit };
})(typeof globalThis !== 'undefined' ? globalThis : self);
