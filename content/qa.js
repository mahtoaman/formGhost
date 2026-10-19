/*!
 * FormGhost - https://github.com/mahtoaman/formghost
 * Copyright 2026 Aman Mahto (@mahtoaman)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 */
/* FormGhost: QA helpers: edge-case values, sample upload files, test card numbers and test-script export.
   window.__fgExt.qa = { v, kinds, edge(kindId, el), file(hint, accept), card(part, brand[, el][, persona]), format(records, fmt) }.
   Touches no page state and needs no DOM to load, so the service worker can importScripts it for kinds / format. */
(() => {
  const VERSION = (() => { try { return chrome.runtime.getManifest().version || 'dev'; } catch (e) { return 'dev'; } })();
  const G = globalThis, X = (G.__fgExt = G.__fgExt || {});
  if (X.qa && X.qa.v === VERSION) return;

  const isEl = (x) => !!x && typeof x === 'object' && x.nodeType === 1;
  const attr = (el, k) => (isEl(el) && el.getAttribute(k)) || '';
  const num = (v) => (v === '' || v == null || !isFinite(+v) ? null : +v);
  const clean = (n) => String(Number((+n).toPrecision(12)));
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const typeOf = (el) => {
    if (!isEl(el)) return 'text';
    const t = el.tagName.toLowerCase();
    return t === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : t === 'textarea' || t === 'select' ? t : 'text';
  };
  function hintOf(el) {
    if (!isEl(el)) return '';
    let lab = '';
    try { lab = [...(el.labels || [])].map((l) => l.textContent).join(' '); } catch (e) { /* ignore */ }
    try { lab += ' ' + attr(el, 'aria-labelledby').split(/\s+/).map((id) => { const x = id && el.ownerDocument.getElementById(id); return x ? x.textContent : ''; }).join(' '); } catch (e) { /* ignore */ }
    return [attr(el, 'name'), el.id, attr(el, 'autocomplete'), attr(el, 'placeholder'), attr(el, 'aria-label'), attr(el, 'title'), lab]
      .join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[_\-.:]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
  }
  const maxLen = (el) => (isEl(el) && el.maxLength > 0 ? el.maxLength : 0);

  /* ---------- edge values ---------- */
  const KINDS = [
    ['long', 'Very long text'], ['unicode', 'Unicode + emoji'], ['rtl', 'Right-to-left text'], ['apostrophe', "O'Brien-Smith name"],
    ['spaces', 'Padded with spaces'], ['html', 'HTML-like text'], ['email', 'Invalid email'], ['below', 'Below minimum'], ['above', 'Above maximum'],
    ['zero', 'Zero'], ['negative', 'Negative number'], ['huge', 'Huge number'], ['decimal', 'Decimal number'], ['past', 'Far-past date'], ['future', 'Far-future date'],
  ].map(([id, label]) => ({ id, label }));
  const TEXTS = {
    unicode: { first: 'Zoë 李娜 😀', last: 'Ñúñez-Łukasz 山田', full: 'Zoë Ñúñez 李娜 😀', email: 'zoë.李娜@exämple.com', number: '١٢٣', text: 'Ünïcödé ñ ç ß ø · 中文 日本語 한국어 · 😀 👍🏽 👨‍👩‍👧' },
    rtl: { first: 'مريم', last: 'العلي', full: 'مريم العلي', email: 'مريم@example.com', number: '٤٢', text: 'مرحبا بالعالم — שלום עולם (123) FormGhost' },
    apostrophe: { first: 'Mary-Jane', last: "O'Brien-Smith", full: "Mary-Jane O'Brien-Smith", email: "mary-jane.o'brien-smith@example.com", number: "1'000", text: "Mary-Jane O'Brien-Smith" },
    html: { text: '<b>fg</b>' },
  };
  /* invalid both to type=email and to the usual name@host.tld check; one per call, in turn */
  const BAD_EMAILS = ['plainaddress', 'test@', '@example.com', 'test@@example.com', 'test @example.com', 'test@exa mple.com', 'test.example.com'];
  let badEmail = 0;
  const FIRST = /first|given|\bf ?name\b|forename|vorname|pr[eé]nom|\bnombre\b|\bnome\b(?! ?completo)/;
  const LAST = /last ?name|family|surname|\bl ?name\b|nachname|apellido|cognome|sobrenome|\bnom\b(?! ?complet)/;
  const NAME = /name|\bnom\b|\bnome\b|\bnombre\b/;
  function role(el, t) {
    if (t === 'email') return 'email';
    if (t === 'number' || t === 'range') return 'number';
    const h = hintOf(el);
    return FIRST.test(h) ? 'first' : LAST.test(h) ? 'last' : NAME.test(h) && !/user ?name|company|business|file|domain/.test(h) ? 'full' : 'text';
  }
  function long(el, t) {
    const ml = maxLen(el), n = Math.min(ml ? ml * 5 : 1000, 10000);
    if (t === 'number' || t === 'range') return '9'.repeat(Math.min(n, 300));
    if (t === 'tel') return '9'.repeat(n);
    if (t === 'email') return 'a'.repeat(Math.max(1, n - 12)) + '@example.com';
    if (t === 'url') return 'https://example.com/' + 'a'.repeat(Math.max(1, n - 20));
    const s = 'FormGhost long text sample ';
    return s.repeat(Math.ceil(n / s.length)).slice(0, n).replace(/\s$/, '.');
  }
  function sample(t) {
    return { email: 'test@example.com', number: '42', range: '42', tel: '9876543210', url: 'https://example.com', date: '2000-01-01', month: '2000-01', time: '12:00' }[t] || 'FormGhost';
  }
  function bound(el, kind) {
    const min = num(attr(el, 'min') || attr(el, 'aria-valuemin')), max = num(attr(el, 'max') || attr(el, 'aria-valuemax'));
    const st = attr(el, 'step').trim().toLowerCase(), any = st === 'any', step = num(st) > 0 ? num(st) : 1;
    if (kind === 'below') return clean(min != null ? min - step : -1);
    if (kind === 'above') return clean(max != null ? max + step : 1e9);
    if (kind === 'decimal') {
      let base = min != null ? min : 1;
      if (max != null && base + 1 > max) base = max - 1;
      return any ? clean(base + 0.123456789) : clean(base + (step % 1 === 0 ? 0.5 : step / 2));
    }
    return { zero: '0', negative: '-1', huge: '1000000000' }[kind];
  }
  /* ---------- dates ---------- */
  const DAY = 864e5;
  function parseLimit(s, t) {
    let m = /^(\d{4,6})-W(\d\d)$/.exec(s);
    if (m) { const j4 = Date.UTC(+m[1], 0, 4), mon = j4 - ((new Date(j4).getUTCDay() + 6) % 7) * DAY; return new Date(mon + (m[2] - 1) * 7 * DAY); }
    m = /^(\d{4,6})-(\d\d)(?:-(\d\d))?/.exec(s);
    return m ? new Date(Date.UTC(+m[1], m[2] - 1, t === 'month' ? 1 : +(m[3] || 1))) : null;
  }
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)));
    const j4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    return `${t.getUTCFullYear()}-W${pad(1 + Math.round(((t - j4) / DAY - 3 + ((j4.getUTCDay() + 6) % 7)) / 7))}`;
  }
  const fmtDate = (d, f) => f.replace(/YYYY|YY|MM|M|DD|D/g, (k) => ({
    YYYY: pad(d.getUTCFullYear(), 4), YY: pad(d.getUTCFullYear() % 100), MM: pad(d.getUTCMonth() + 1), M: String(d.getUTCMonth() + 1), DD: pad(d.getUTCDate()), D: String(d.getUTCDate()),
  })[k]);
  function textFormat(el) {
    const s = [attr(el, 'placeholder'), attr(el, 'data-date-format'), attr(el, 'data-format'), attr(el, 'aria-label')].join(' ');
    const m = /(?:^|[^a-z])([dmy]{1,4})([/.\- ])([dmy]{1,4})\2([dmy]{1,4})(?![a-z])/i.exec(s);
    if (!m || new Set((m[1] + m[3] + m[4]).toLowerCase()).size !== 3) return 'YYYY-MM-DD';
    return [m[1], m[3], m[4]].map((p) => p.toUpperCase().replace(/^Y{1,3}$/, 'YY').replace(/^Y{4,}$/, 'YYYY')).join(m[2]);
  }
  function dateEdge(el, t, future) {
    if (t === 'time') return future ? '23:59' : '00:00';
    const lim = parseLimit(attr(el, future ? 'max' : 'min'), t), dir = future ? 1 : -1;
    let d = future ? new Date(Date.UTC(2099, 11, 31)) : new Date(Date.UTC(1900, 0, 1));
    if (lim) d = t === 'month' ? new Date(Date.UTC(lim.getUTCFullYear(), lim.getUTCMonth() + dir, 1)) : new Date(+lim + dir * (t === 'week' ? 7 : 1) * DAY);
    if (t === 'week') return isoWeek(d);
    if (t === 'month') return fmtDate(d, 'YYYY-MM');
    if (t === 'datetime-local') return fmtDate(d, 'YYYY-MM-DD') + (future ? 'T23:59' : 'T00:00');
    return fmtDate(d, t === 'date' ? 'YYYY-MM-DD' : textFormat(el));
  }

  function edge(kindId, el) {
    const t = typeOf(el), k = String(kindId || '');
    if (k === 'long') return long(el, t);
    if (TEXTS[k]) { const v = TEXTS[k], r = role(el, t); return v[r] || (r === 'first' || r === 'last' ? v.full : '') || v.text; }
    if (k === 'spaces') {
      const cur = isEl(el) ? (typeof el.value === 'string' ? el.value : el.isContentEditable ? el.textContent : '') : '';
      return '   ' + ((cur || '').trim() || sample(t)) + '   ';
    }
    if (k === 'email') return BAD_EMAILS[badEmail++ % BAD_EMAILS.length];
    if (/^(date|month|week|datetime-local|time)$/.test(t) && (k === 'below' || k === 'above')) return dateEdge(el, t, k === 'above');
    if (k === 'below' || k === 'above' || k === 'zero' || k === 'negative' || k === 'huge' || k === 'decimal') return bound(el, k);
    if (k === 'past' || k === 'future') return dateEdge(el, t, k === 'future');
    return '';
  }

  /* ---------- test cards ---------- */
  const CARDS = {
    visa: { n: '4242424242424242', cvc: '123', g: [4, 4, 4, 4] },
    visa2: { n: '4111111111111111', cvc: '123', g: [4, 4, 4, 4] },
    mastercard: { n: '5555555555554444', cvc: '123', g: [4, 4, 4, 4] },
    amex: { n: '378282246310005', cvc: '1234', g: [4, 6, 5] },
    discover: { n: '6011111111111117', cvc: '123', g: [4, 4, 4, 4] },
  };
  function brandOf(b) {
    const s = String(b || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return /amex|americanexpress|^3[47]/.test(s) ? 'amex' : /master|^mc$|^5[1-5]/.test(s) ? 'mastercard' : /discover|^6011/.test(s) ? 'discover'
      : /4111|generic|visa2/.test(s) ? 'visa2' : 'visa';
  }
  function option(el, test) {
    const o = [...el.options].filter((x) => !x.disabled && x.value !== '');
    const hit = o.find((x) => test(x.value.trim()) || test(x.text.trim()));
    return hit ? hit.value : o.length ? o[o.length - 1].value : '';
  }
  function card(part, brand, a, b) {
    const el = [a, b].find(isEl) || null, P = [a, b].find((x) => x && typeof x === 'object' && !isEl(x)) || null;
    const c = CARDS[brandOf(brand)], y = new Date().getFullYear() + 3, yy = pad(y % 100), t = typeOf(el), ml = maxLen(el);
    const ph = (attr(el, 'placeholder') + ' ' + attr(el, 'aria-label')).toLowerCase();
    if (part === 'number') {
      const spaced = c.n.length + c.g.length - 1;
      const sep = /(\d|x|•|\*){4}-(\d|x|•|\*){4}/.test(ph) ? '-' : ml && ml < spaced ? '' : /(\d|x|•|\*|0){4} (\d|x|•|\*|0){4}/.test(ph) || ml === spaced ? ' ' : '';
      let i = 0;
      return c.g.map((g) => c.n.slice(i, (i += g))).join(sep);
    }
    if (part === 'exp') {
      if (t === 'month') return `${y}-12`;
      if (t === 'date') return `${y}-12-31`;
      if (/mm ?[/-]? ?yyyy/.test(ph) || (ml === 7 && !/yy/.test(ph))) return `12/${y}`;
      if (/mm \/ yy/.test(ph)) return `12 / ${yy}`;
      if (/mm-yy/.test(ph)) return `12-${yy}`;
      if (/mmyy/.test(ph) || ml === 4) return `12${yy}`;
      return `12/${yy}`;
    }
    if (part === 'expMonth') return t === 'select' ? option(el, (s) => /^0?12$|^dec|^12\b/i.test(s)) : ml === 1 ? '9' : '12';
    if (part === 'expYear') return t === 'select' ? option(el, (s) => s === String(y) || s === yy) : ml === 2 || /\byy\b/.test(ph) ? yy : String(y);
    if (part === 'cvc') return ml && ml < c.cvc.length ? '123'.slice(0, ml) : c.cvc;
    if (part === 'name') return (P && (P.fullName || P.name)) || 'Test User';
    if (part === 'zip') return String((P && (P.zip || P.postalCode)) || '42424');
    return '';
  }

  /* ---------- sample files ---------- */
  const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const le = (n, w) => Array.from({ length: w }, (_, i) => (n >>> (8 * i)) & 255);
  const ascii = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 255);
  const utf8 = (s) => new TextEncoder().encode(s);
  const cat = (parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; parts.forEach((p) => { out.set(p, o); o += p.length; }); return out; };
  const b64 = (s) => { const bin = atob(s); return Uint8Array.from(bin, (ch) => ch.charCodeAt(0)); };

  /* zlib stream, fixed Huffman codes, runs of a repeated byte as distance-1 matches: flat images shrink to a few KB */
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  function zlib(d) {
    const out = [0x78, 0x01];
    let acc = 0, bits = 0;
    const put = (v, n) => { for (let i = 0; i < n; i++) { acc |= ((v >>> i) & 1) << bits; if (++bits === 8) { out.push(acc); acc = bits = 0; } } };
    const code = (v, n) => { let r = 0; for (let i = 0; i < n; i++) r = (r << 1) | ((v >>> i) & 1); put(r, n); };
    const sym = (s) => (s < 144 ? code(0x30 + s, 8) : s < 256 ? code(0x190 + s - 144, 9) : s < 280 ? code(s - 256, 7) : code(0xc0 + s - 280, 8));
    put(1, 1); put(1, 2);
    for (let i = 0; i < d.length;) {
      let run = 0;
      if (i) while (run < 258 && i + run < d.length && d[i + run] === d[i - 1]) run++;
      if (run >= 3) { let c = 28; while (LBASE[c] > run) c--; sym(257 + c); put(run - LBASE[c], LEXT[c]); put(0, 5); i += run; } else sym(d[i++]);
    }
    sym(256);
    if (bits) out.push(acc);
    let a = 1, b = 0;
    for (let i = 0; i < d.length; i++) { a = (a + d[i]) % 65521; b = (b + a) % 65521; }
    return Uint8Array.from(out.concat(be32(((b << 16) | a) >>> 0)));
  }
  function png(w, h, f) {
    const row = w * 3 + 1, raw = new Uint8Array(row * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const g = f(x + 0.5, y + 0.5), o = y * row + 1 + x * 3; raw[o] = raw[o + 1] = raw[o + 2] = g; }
    const chunk = (type, data) => { const td = cat([ascii(type), data]); return cat([Uint8Array.from(be32(data.length)), td, Uint8Array.from(be32(crc32(td)))]); };
    return cat([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', Uint8Array.from([...be32(w), ...be32(h), 8, 2, 0, 0, 0])), chunk('IDAT', zlib(raw)), chunk('IEND', new Uint8Array(0))]);
  }
  function signature() {
    const w = 300, h = 100, m = new Uint8Array(w * h);
    const dot = (x, y) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X1 = Math.round(x + dx), Y1 = Math.round(y + dy); if (dx * dx + dy * dy <= 3 && X1 >= 0 && X1 < w && Y1 >= 0 && Y1 < h) m[Y1 * w + X1] = 1; } };
    for (let t = 0; t <= 1; t += 1 / 5000) dot(30 + 230 * t + 14 * Math.sin(2 * Math.PI * 7 * t), 50 - 20 * Math.sin(2 * Math.PI * 3.5 * t) * Math.exp(-1.2 * t) - 8 * Math.cos(2 * Math.PI * 7 * t));
    for (let t = 0; t <= 1; t += 1 / 3000) dot(45 + 220 * t, 80 + 3 * Math.sin(2 * Math.PI * t));
    return png(w, h, (x, y) => (m[Math.floor(y) * w + Math.floor(x)] ? 26 : 255));
  }
  const IMG = {
    ghost: () => png(64, 64, (x, y) => {
      const eye = (x - 26) ** 2 + (y - 29) ** 2 < 10 || (x - 38) ** 2 + (y - 29) ** 2 < 10;
      const body = (y < 28 ? (x - 32) ** 2 + (y - 28) ** 2 < 289 : x > 15 && x < 49 && y < 47 + 3 * Math.cos(((x - 15) / 34) * 6 * Math.PI));
      return body && !eye ? 255 : 24;
    }),
    photo: () => png(240, 300, (x, y) => (((x - 120) / 52) ** 2 + ((y - 118) / 62) ** 2 < 1 || ((x - 120) / 108) ** 2 + ((y - 318) / 120) ** 2 < 1 || (Math.abs(x - 120) < 26 && y > 160 && y < 215) ? 96 : 226)),
    signature,
  };
  /* the same pictures, encoded once (formats a page can't be asked to make synchronously) */
  const EMBED = {
    jpg: { photo: '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', signature: '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', ghost: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAkGBwgHBgkIBwgKCgkLDRYPDQwMDRsUFRAWIB0iIiAdHx8kKDQsJCYxJx8fLT0tMTU3Ojo6Iys/RD84QzQ5Ojf/2wBDAQoKCg0MDRoPDxo3JR8lNzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzf/wAARCABAAEADASIAAhEBAxEB/8QAGwAAAwADAQEAAAAAAAAAAAAAAAUHAwYIAgT/xAAsEAABAwMCBAYCAwEAAAAAAAABAgMEAAURBiESEyIxBxQ2QXWzMmEVI0JR/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJHRRRQFFNtN6buupp6IdpirdJUEuPEHlsg53WrHSMA/s4wATtVas/gbBQzm93eS66pKTww0pbShWOoZUFcQzjBwnt232CH0VcLx4GwVs5sl3ktOpSo8MxKXErVjpGUhPCM5ycK79tt5LqTTd10zPXDu0VbRCilt4A8t4DG6FY6hgj9jOCAdqBTRRRQFFFOdFesrD8lH+xNB0poXTLGk9OsW5rqeP9spYWVBbxACiMgdOwA2GwGd8mtgr4r3IkxLNPkwGefLZjOOMNcJVzFhJKU4G5yQBgb1MvBzWWpNSXmdGvL/AJuI1GDgd8ulHLXxABOUgDqBUcHJ6duxoK1Wv660yxqzTr9ud6Xh/bFWVlIQ8AQknAPTuQdjsTjfBrRfGPWWpNN3mDGsz/lIjsYuF3y6V8xfEQU5UCOkBJwMHq37iqbZJEmXZoEmezyJb0Ztx9rhKeWspBUnB3GCSMHeg4/opzrX1lfvkpH2KpNQFOdFesrD8lH+xNJqc6K9ZWH5KP8AYmg60orSNQ+JVqseroun3mlrK1JTLklYQiMVgFGc/kMEFRyAAfc5Adaz1PE0lY3LnMQt0lQbZZR3dcIJCc/5GASSfYHucAg9opFozU8TVtjbucNC2iFFt5lfdpwAEpz/AKGCCCPYjscgJdPeJVqvmrpWn2WloKFKTEkhYWiSUAleMfiMAlJyQQPY4BCBa19ZX75KR9iqTU51r6yv3yUj7FUmoCs0KW/Amx5kRfLkR3EutLwDwqScg4Ox3HvWGig9vvOyHnH33FuuuKK1uLUVKWonJJJ7kn3phe9Q3e/eW/mJ70vyrfKZ5h/Ef9/ajgZUck4GScUsooGdk1Dd7D5n+HnvRPNN8p7ln8h/39KGThQwRk4IzS9h52O82+w4tp1tQWhxCilSFA5BBHYg+9eKKDNNlvz5siZLXzJEhxTrq8AcSlHJOBsNz7VhoooP/9k=' },
    webp: { photo: 'UklGRiwEAABXRUJQVlA4ICAEAABQJgCdASrwACwBPp1On0ylpCKiJTFoILATiWlu4XPxG/NX8x57FvD3M2jnYbKCcx0QNIp+VdCd3FPzneohk74iQmlViHTBHkSE0qsQ6YI8iQmlViE+AqH/7E1+m/bIDrSqxDjwASOF/xCQT5M0rvRtzQB8RHQCulCcPVKdMa2R6YI7aYOgRbS71Td1CmCPHLMwy/dTzB6BfD3X8B387cpdfxQk6pTw91/D59vSH2Kx4BxYc57yHTSRM+xGlMC/gXm5tmIB3fESDpk2ZGCaVWGlALK7z/twr/3DwJaROzqoDpd5JfmW8rovrwQJXFxnUxnIAPUmT49bq7VYhG7fVh+Uf8d90blT/zbsY91SE1NhD7/ZiCIP1A2IdMEdqjNNS8QaOEQNp3xEhNCayrXavz+IAU0qsQ6YF32TUgAA/v6NgAEyJBTpLquieQp0sPCl9BlOUO7cT4oYqY2agL83DAy+OILBrKiqI0Db3FsDmHgT+EQNwfPbhLNmEKu/OfeR4sFUNmUPq7Jjz++wOBn0F46VVrpVgyyLI/pkjt7dSqSODYR2fSioTL1ensP76UL2fsNmJsBtsEBRAYEmpaFJiShRT0uP3hhTjiTxDgJwlUP2ZzMOLP0zPGlzDpYvT6r4W5QsWUWjm/JXaFLxn0fz4kLIa3gBdAbUOFtJDM5yt4Z8ED2AjnNYXBlLzOHeWwgx/5jqAutl5h25tdC0980gOqNT0qdYJ46bSxLl4qLRVHmJ7Iq0sBG/rnwi8U3bliqjtrwToD62p6lG/o4WaV9GFxyXUxTLCSarXfHwBbRhJvo85znGopH0WT9ea2gIt/FhYJrNEYoGGH+w0YcZ72gawJHoAPTpnD8T6lVQZ2SL9gwISVaYmS8vCIeQy6Wi1IO+NUdV7Ea5n4iXLSsDYdlwcu+iBPF38Q8B49zT26zfoSRwucIDDNibpKVNZwJSSAGfNwC5gcGdD8wN0hgsuxEQdnPnC/aq7PwoRcT3kUsVw+/R4fTjNj7WuPAomZ2vEXIC1eVT8oIhnqAgoK7oUzn5+MDcmEYSSpv22AMn2a3kbigFnM6ByIU9URCU7eLNZGYOvBgAQaNIKRhVOwkn3tczyzyuNm7iqzrPW2B2VOuvaPr7cMZXIWs6C1Snr4F2AL83KYV8BLoWlCvguObcsLNIwtQ5QgApbJDCSNiM+vOk4EsHBsBSO/CGdIOexV0wjDgjPRhYKqBNVfJeW+Lo0O9L7ZIN8guhLt0jXvHLpKSAxQK8rKioenzSJNskEmFMEL85EYT5TsL8LXZRs2pPrPr1YvOEadzpTVrHJtem7ZD55l0dnYXnR6XpZYUdzW9VF/X6MH93Gv87L2wlxEoXby3g5PWlWhsQh4lws+DZQPgUDA7x39csz/QQYXhARcQHtwAAAAA=', signature: 'UklGRvgGAABXRUJQVlA4IOwGAABwLACdASosAWQAPp1Ko0qlpKOhqffJCLATiWlu4XNBG/OZ8Jfznsz/wnQWeiPYv01MTdZr6v+SvMf+3fir2AHsBfif8O/1X9U/aLyK+3bqj6AXsT8r/3f27+ghqBXmfmv/KvBv+P/6j2AP4p6J/6b/vf8Z/PvQ1+M/3f9jfgH/m/9H9Jn//+8L9nfZZ/X0tjYYzUdymqO5TVHcpqjuU1R3Kao1U+XK7fzsLGD73+P5KvQ7WOgZjZNu68MCwymEdQjWL/rfIrIFT8Hn+Is988/bfDkqLDvti3dMCaGCGYTXN0Z0rEv6KFhLLFx1DSHWRYo3eh6H7y4OgPYmAsD1RYwLAO7eyPX22sucn8IOgXV25JWhreZgGw8RIHDUuPPvvRdUkwsOMd/URNKhHyRr+/h0dsGgySKxEasEtQjVGlJqJ0qLnawS+Qy8KsNLDtLx80BjT+fOjaTraGIHCr0tdfN0d1/cWyIyKdHcpnQAAP7/FIAIPw/8Ov+eFaYI1xhqPa15gL3bp0hbBuuzB4iwFVO/bDzvy5Ba5bnCKnPJT7Jhn0jB5vFaHV3l4piWiTGGF1p529mwfhWp8jFDz13NtCS9p1HkDV69gARvfOUerIw0Rwuq2REIw8GJcfWlhP+Qve/7T9nlnggwmJM/N5doBXJeMUlH5saBrYfWj38FbhQpE3XGFbg74nZHFGR0mDhh0GZ3/w3Jv9EzdHn7FcixFZNpP1VgTQq/y2c1WFhysD+/77+/jDr1yDbQqMiO3/iK2EuaTusTHkh8XnV7bIyCDKfbnzL/zyA/ZxUpbeJ0hHQOGDnFKlrhmCXOoncElewuMnkZ73ehtFNsLeOTKaaKdc8b6brDUfsdVL7ObYgEgzUZcAgh/8RlTghCy3wSYtnv0t58n6R2fqsKffnIwjxT1Ae/i3pddpSJBVxz8/C8OsUUDHJqjTOH3uwhLwDblSkHactHAOg+Zwa0Tq1uCHI37UJ0EYhqaqfDxRidRIsd5+szMl7u7hOz78S4J33CuRO2igrYGciR770toOFVcZyKiZN3Ty/erXuN8NnuXT0bg1sdvyzrmrT6hRjQJHeJTO1NUnl9SsyohgW3/G1t8VjiyDcBcQ+1u7SuRmJ+qNa6QoFUJwGjj/ovNgdlH08ziq6suLQpfN2V8ITDnw1XLl3IDdKjL/ay3mKvO1Au6QlVs+UNKKbSETopVaJvF8Eo2a5RPkiRRApmnz7EIdZEsLnebxBgDlsPDsM5gUSd6dVZyVxoxMAJiqMCcrL3e/jXvYt3qbMdWzxM9/Pl/2fFE08hTJs8INHH/PuLypvlM/QvEMBxlFVG9+OWGHEbVmU3p8PO14xQ6i4WkoryNOiSRhkgVkryBxmTXaLuVawV182bYndSjHWQ2eLHdMsLL6NPhxUp5Ge/FnLw/BGsbiZWbMs8lNEGpEp+YSsbIHaP3L0EkcLRuuqW7U2aCeNt4Sabe0pyqu3MwNBw+W7h8GRuT/Gv+RrePxY2RKmh6bN/S0Ke2miy9Zwn8MizNXALX+7JNHXT/uTLJ7IKcHRnbV6+atws8uzDO2TFnxD4zZE/nJw7fiO5ntpSMkdo2er5DWMyiWSJBUlVmTTmFVOVo19ddeBL4g1mqzShnwV1xffOjg1xY5OGA1mf7AI2Ux813jfyi//Ml2ZhoPHlfAZeXdgJO2+eQJrjC0lzFaAZf+MDfhH7PXOMRV841HjUI3gr03mhuZpuqXGmm9bfY/VQNMo/3cg0ZP53FR6LS6vEbuy7Tl80WetBwsi3iCw/vW8IdRSNCEJdON1zyeOYsbF5GaWeeCXXdXzAcn9/8lItmD+aQM2wnr5llMfJ6yiFWgtml5fCb/Rdw5cXekpv0SgjIIMmZ41R39LFwqkaqDQYwEtLBDYpPm89N2hbMQWJLbu/fNpN+fU5S/s1pwD63s7/BTgM06R+MHDJJmu0yYqSvgJrQaxawhJG/Mou0kytrSsB8YdNNXllSoceW0PqTMA2SHEIRXt5C0OZHrwY+buSvFL/hvfbnYTFbL0/WSPuDciGdupQeK8e1ROuWIdYC7d4anN48lhf5fiu5hxbzFfgASN0B6MFRcyruUIgXI/h9NF8Sjn+pGgC6jhQBHJZavTZagbbu3sDgfzfA2pLRa359HldWwqwJDQleLR0LYUgHzUtrslITkdjfbAx3yZp+YAcqVmVDvumD1I3LpiIbBJY/V/VCcZeSt9kK520UFRGRbP+uMT8pZADFMFf2J6TNj5VNLDOUOWyoUY1YQiZMOYyBSJQxpn4ZFp/5Fyc/s00YBWN6lv5xM05IZvnqfxvDwqJ2ZTgH62EVFGTp+2hIAXBVZjCLLF1Y2TMhVMS5cRIp21AAAAAAA==', ghost: 'UklGRpwBAABXRUJQVlA4IJABAABwDACdASpAAEAAPo04lUglI6IhPfIoAKARiWkAFeI/zfsirgP8N+LvmAbozGRdoBV3n9F9t3sC+evYI/jn8/3y/9jk0ynDX36mXBZZUpD5AuQPqIUy6gV/eMSlSSO1F6OzTPWkRCBsqpgCaAAA/vmQ7BFn0P824XK+IMf/qzWCXjtYjGJiO3h3zPg7BoM4yp5wzpqmFrZ00OYDbqohx33fknxMf5qXDWl/WiT1x3+wmjnFZS5PT5AI6kIV73dmTx/wDsXi4ZFm22cGXt5Ydh2xRRghz6W53aVe1xh24xDe0X/di09Qwf4g7sZ8zsEIyLdjdFHLsLhkWbbZvSmPMxpKa4mwrO8UdBvlF4ymyg7fgAY4EgGqwXkuwdPNTQPXem7x/YuB1Cf9kKJQbm7oZHZob986OkPAGB++/Wr/p+emicPjr9piKJP3kUwMnFMHiCP/q74bsxEbiGIec39EMPlA4wgyUEaws/6WDHtwgXH66/agG3q90hbMWK1h/9u0jnM+sdRuxB4CrMSYbkkK4AAA' },
    gif: { photo: 'R0lGODdh8AAsAYEAAOLi4mBgYAAAAAAAACwAAAAA8AAsAUAI/wABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsqXLlzBjypxJs6bNmzhz6tx5MYDPn0CB8hxKFGPQo0iTKl2KtKhTmkyjSp1KNejTqyGrat3KNSrWrxK7ih1L9ijYswbLql1LFi1YtnDjbnX7VK7du0zpFsXLt69PvXv9CoYL2Ongw20LX0XMWKpiuo0jB3hMWaDku5UzL7xMVbPniZzNfh4dNrRQ0qgdmj6dunXC1T9dV4Y9WPZL2rgd266Yu3fc3QN9C2esebjx1WePKx++c7nz5zKfS5/+VyX169dLYt++HST37905gv8fnx24+fPo06tfz769+/fw48ufT78+z9r2HzvPr5M8a/4p+acbgFkJqBWB4hk4FoI9KZgYg6U5+CCED0lYFoURWjgXhhRpOBWHGnnYFIgfaUiideWdaBNuKgYGW4tEsQjjfbTNOBN3NmYk4oYn7kjcez4a11qQ3xVGpImGHankTUo2qdRtTka5VIBSVumVSFZm2VlHWna5ZY5ghinmmGSWaeaZaKap5ppstunmm3DGKeecdNZpZ2Zy3QkTZ3oWKFyfFlEHaEPkDVqQhID6WOeScErpppVsaqmml2h6WR2ZlsaGaaaTbZppmZx2OmaoZn56JqVpSrompI82OSeRd4r/aKiChqZVZK2bQYdrhjLuGmiNvhoFbLC/vkhsscgdy9uwyvIaWrMdMgstQ0JOiyidrHoaqqYkbvtlft5eCGS4mJlHLmKpnfvsbOpKm1y7f34F734uzktvTvbiWFO+40XHr38u/evgSgJfa1LBHmqHcMJYLiyrdw7vWGLEiiZIccU6XgzrtBx37PHHIIcs8sgkl2zyySinrPLKLLfs8sswxyzzzDTXbPPNOOes88489+yzbAv+fCheOzc2s7Eqx1uyciNL9zF21t4arIC+0jqrhYkybCfGrwaJ7ZFyOtlolK06GmmVZ2d7apepsr02qqBa+rbb2sItJql10303p3Gb/zoq33mr+rffexNeuN6DI3644H1n2TbjpTo+qeSTm522q2VjnvnGY3Mep+dhS6wnkllbfTXVVferrL5ROw3yvSJXi3KvSbt7Mu0p4z677SbrfjvvSwNPsu+9C9+08bEjHzLxwSNdu/O5Kw+t682iPujDXTO6quJgett9uyoKTCHFAGp8aXzmj9he+lOqx/6Au71flW3yc5Vu/WKNhv+E+u2vVv/+YwtgApgntBCQaPI6IALrokC+JKmBfhkKBA/TnAlSECcW/NG+MqhBf3Gwg1D6oNH2JELJhLCEkWkJCtdFpRXyCSUuTNbBYshCktBQhg27oWlsqMMd5rCHNfQIECZxyKUhEnEjRjxixpLoQ4sx8YVIfKISlyXFIDaoilAUFhateJCAAAA7', signature: 'R0lGODdhLAFkAIEAAP///xoaGgAAAAAAACwAAAAALAFkAEAI/wABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsqXLlzBjypxJs6bNlgFy6tzJs6fPniB/Ch0KNCTRoz9JHj2Y9KZTAD4JRo2JNIDEqjkpDtWqE+HOp2CZfuVZk6zUrjK/is0atq1RtmutwlQbNy3QqW7zdqyqt69fv1iL/h0YuLDgwVANw0XMuLHjx5AjS55MubLly5gza97MubPnz6BDl+UrurTpj0Ifpo6L1OtqhURd0yU8++xrg0sTYj3tEe/N2zNzTxTOG2NtgcdZJkeO9mXztcWfPi+4fGXr6Nizq1TMvbp2k93Df/8fT768+fPo06tfz769+/fw48ufT7++/fv48+vfz78/a8MukebfZYcNB9xVWyWW3FjERRTeg3JBBCGA5TX132ILJaiahcwVqNt0tIEoW1EcMmQWdSK+12BwvlVUIlcebihgfQdSRdaJdj2H44Au0rWjcyJ6h1KKHfJoEZFCgochbktatyCRRprYZIg5LplkSrFF2SOIP87VopadaQjmmN9NaOaZD4KG5ppszkjmm3DGKeecdNZp55145qnnnnz26eefgAYq6KCEFmrooYgmquiijDbq6KOQRirppJRWauloX16aHYWaFremkmni1OWdJZYq5kVtvrhlqlc2xOqoYbXr6lCNUpo6W4tZzpprh3cddl2tu/KaoKqeZspkjLateCyypy774ZTJ7tjshSFCiV6mxoJqFrEjosVtt7TChiS07EWVrXLTuvqrgbCqy6Ws6YVrY7tAfpvhuvadW6+9221LL6n8Otncvyf9SLCcJx6s7bIR7jvin7UpPFJ18L7V8LF+PknukORWHNS4F+cJcsgCk8zrvNNJTCaU1mpLssoi4asnyxsXTCLMJekL8JQex5xupxbr2DPQnilL9NFID/jq0gFnJi9nTOu8UdSUUe1y1CYX3TRmWHed9Ndghy322GSXbfbZaKetdmUBAQA7', ghost: 'R0lGODdhQABAAIEAAP///xgYGAAAAAAAACwAAAAAQABAAEAI/AADCBxIsKDBgwgTKlzIsKHDhxAXAphIsaLFixYjRsTIsaNHjQw9ihwJAKREkigvmlQ48WBFhC8NtlxJs6bNmzhxosz5MGVKngQ5ysxYUChQn0hLHo3ZUWDTAESBSp1KtarVq1izajWZdKbWrk+pgh05NSxUjEGN8lQ7UGVRtEvHipQql2zcumx1enUatW3fs0q3Ch5MuLDhw4gTK17MuLFYuIuTFsa7Fe/ex5YpVs3sli7nmHc/X76ZF7Dmt51zlk7NlzVptrBL2xT99zXt0bNv466pezfN3oFV9/a8F7Lp062D61V+fChyv8xnJ/R9drrj69iza9/OvTvIgAA7' },
  };
  function pdf(title) {
    const esc = (s) => s.replace(/[\\()]/g, '\\$&');
    const text = [[24, 760, 'FormGhost sample'], [12, 732, `${title} - sample file for form testing.`], [10, 712, 'Generated in your browser by FormGhost. Not a real document.'], [10, 696, 'FormGhost sample · github.com/mahtoaman/formghost']]
      .map(([size, y, s]) => `BT /F1 ${size} Tf 72 ${y} Td (${esc(s)}) Tj ET`).join('\n');
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`, `<< /Title (${esc(title)}) /Producer (FormGhost) >>`];
    let s = '%PDF-1.4\n';
    const off = objs.map((o, i) => { const at = s.length; s += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
    const xref = s.length;
    s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => pad(o, 10) + ' 00000 n \n').join('')}`
      + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return ascii(s);
  }
  function zip(entries) {
    const local = [], central = [];
    let off = 0;
    const date = ((2026 - 1980) << 9) | (1 << 5) | 1;
    for (const [name, data] of entries) {
      const n = ascii(name), crc = crc32(data), common = [...le(20, 2), 0, 0, 0, 0, ...le(0, 2), ...le(date, 2), ...le(crc, 4), ...le(data.length, 4), ...le(data.length, 4), ...le(n.length, 2), 0, 0];
      const head = cat([Uint8Array.from([...le(0x04034b50, 4), ...common]), n, data]);
      central.push(cat([Uint8Array.from([...le(0x02014b50, 4), ...le(20, 2), ...common, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...le(off, 4)]), n]));
      local.push(head);
      off += head.length;
    }
    const cd = cat(central);
    return cat([...local, cd, Uint8Array.from([...le(0x06054b50, 4), 0, 0, 0, 0, ...le(entries.length, 2), ...le(entries.length, 2), ...le(cd.length, 4), ...le(off, 4), 0, 0])]);
  }
  function docx(title) {
    const x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n', p = (s) => `<w:p><w:r><w:t>${s}</w:t></w:r></w:p>`;
    return zip([
      ['[Content_Types].xml', utf8(x + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')],
      ['_rels/.rels', utf8(x + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')],
      ['word/document.xml', utf8(x + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p('FormGhost sample')}${p(`${title} - sample file for form testing.`)}<w:sectPr/></w:body></w:document>`)],
    ]);
  }
  function wav() {
    const n = 4000, h = [...ascii('RIFF'), ...le(36 + n, 4), ...ascii('WAVEfmt '), ...le(16, 4), ...le(1, 2), ...le(1, 2), ...le(8000, 4), ...le(8000, 4), ...le(1, 2), ...le(8, 2), ...ascii('data'), ...le(n, 4)];
    return cat([Uint8Array.from(h), new Uint8Array(n).fill(128)]);
  }
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#18181b"/>'
    + '<path d="M15 28a17 17 0 0 1 34 0v19l-5.7-3-5.6 3-5.7-3-5.7 3-5.6-3-5.7 3z" fill="#fff"/><circle cx="26" cy="29" r="3" fill="#18181b"/><circle cx="38" cy="29" r="3" fill="#18181b"/></svg>';
  /* [mime, extensions, other mimes that mean it] */
  const FMT = {
    png: ['image/png', '.png'], jpg: ['image/jpeg', '.jpg .jpeg .jfif .pjpeg .pjp', 'image/jpg image/pjpeg'], webp: ['image/webp', '.webp'], gif: ['image/gif', '.gif'],
    svg: ['image/svg+xml', '.svg'], pdf: ['application/pdf', '.pdf', 'application/x-pdf'], docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
    txt: ['text/plain', '.txt .text'], csv: ['text/csv', '.csv'], json: ['application/json', '.json'], zip: ['application/zip', '.zip', 'application/x-zip-compressed'],
    wav: ['audio/wav', '.wav', 'audio/x-wav audio/wave audio/vnd.wave'],
  };
  const IMAGE_FIRST = ['png', 'jpg', 'webp', 'gif', 'pdf', 'svg', 'docx', 'txt'], DOC_FIRST = ['pdf', 'docx', 'png', 'jpg', 'webp', 'gif', 'txt', 'svg'];
  const ALL = Object.keys(FMT);
  /* [hint, base name, title, picture (null: a document), format to try first] */
  const KINDS_OF_FILE = [
    [/\bsign(ature)?s?\b|\bsig\b|signature/, 'signature', 'Signature', 'signature'],
    [/photo ?id\b|id ?proof|identity|proof|\bkyc\b|aadha?ar|\bpan\b|voter|licen[cs]e|passport(?! ?(size|photo|pic))|\bid\b|\bdl\b/, 'id-proof', 'ID proof', null],
    [/photo|picture|\bpic\b|avatar|selfie|head ?shot|portrait|passport/, 'photo', 'Photo', 'photo'],
    [/resume|r[eé]sum[eé]|\bcv\b|curriculum|bio ?data/, 'resume', 'Resume', null],
    [/cover ?letter/, 'cover-letter', 'Cover letter', null],
    [/certificate|mark ?sheet|transcript|degree|diploma/, 'certificate', 'Certificate', null],
    [/logo/, 'logo', 'Logo', 'ghost'],
    [/icon|banner|thumbnail|image|\bimg\b/, 'image', 'Image', 'ghost'],
    [/\bcsv\b|spreadsheet/, 'data', 'Data', null, 'csv'],
    [/\bjson\b/, 'data', 'Data', null, 'json'],
    [/audio|voice|recording|\bwav\b/, 'audio', 'Audio', null, 'wav'],
    [/\bzip\b|archive/, 'archive', 'Archive', null, 'zip'],
  ];
  function parseAccept(a) { return String(a || '').toLowerCase().split(',').map((s) => s.split(';')[0].trim()).filter(Boolean); }
  function allowed(acc, f) {
    const [mime, exts, alias = ''] = FMT[f], ex = exts.split(' ');
    if (!acc.length) return ex[0];
    for (const t of acc) {
      if (t[0] === '.' && ex.includes(t)) return t;
      if (t === '*' || t === '*/*' || t === mime || alias.split(' ').includes(t) || (t.endsWith('/*') && mime.startsWith(t.slice(0, -1)))) return ex[0];
    }
    return '';
  }
  const memo = new Map();
  const once = (k, f) => { if (!memo.has(k)) memo.set(k, f()); return memo.get(k); };
  function bytes(f, title, pic) {
    if (f === 'png') return once('png:' + pic, IMG[pic]);
    if (EMBED[f]) { const e = EMBED[f], src = e[pic] || e.photo || e.ghost; return src ? once(f + ':' + pic, () => b64(src)) : null; }
    if (f === 'pdf') return once('pdf:' + title, () => pdf(title));
    if (f === 'docx') return once('docx:' + title, () => docx(title));
    if (f === 'wav') return once('wav', wav);
    if (f === 'zip') return once('zip', () => zip([['sample.txt', utf8('FormGhost sample file.\n')]]));
    return utf8({ svg: SVG, txt: `FormGhost sample\n${title} - sample file for form testing.\n`, csv: 'name,email,phone\nFormGhost Sample,sample@example.com,0000000000\n', json: '{ "name": "FormGhost sample", "sample": true }\n' }[f]);
  }
  function file(hint, accept) {
    if (isEl(hint)) { if (accept == null) accept = attr(hint, 'accept'); hint = hintOf(hint); }
    const h = String(hint || '').toLowerCase().replace(/[_\-.]+/g, ' '), acc = parseAccept(accept);
    const [, base, title, pic, first] = KINDS_OF_FILE.find(([re]) => re.test(h)) || [null, 'document', 'Document', null];
    const order = [...new Set([first, ...(pic ? IMAGE_FIRST : DOC_FIRST), ...ALL].filter(Boolean))];
    for (const f of order) {
      const ext = allowed(acc, f), data = ext && bytes(f, title, pic || 'ghost');
      if (data) return new File([data], base + ext, { type: FMT[f][0], lastModified: Date.now() });
    }
    return null;
  }

  /* ---------- export ---------- */
  const lit = (s) => "'" + String(s == null ? '' : s).replace(/[\\'\u0000-\u001f\u007f\u2028\u2029]/g, (ch) => ({ '\\': '\\\\', "'": "\\'", '\n': '\\n', '\r': '\\r', '\t': '\\t' })[ch]
    || '\\u' + pad(ch.charCodeAt(0).toString(16), 4)) + "'";
  const note = (s) => String(s == null ? '' : s).replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const ARIA = /\[role=["']?(checkbox|switch|radio)\b/; // not an <input>: Cypress's check() can't, a click can
  const isOff = (v) => v === false || v === 0 || /^(false|off|no|0|unchecked)$/i.test(String(v == null ? '' : v).trim());
  const mimeOf = (name) => { const e = '.' + String(name).toLowerCase().split('.').pop(); const f = ALL.find((k) => FMT[k][1].split(' ').includes(e)); return f ? FMT[f][0] : 'application/octet-stream'; };
  /* records as the filler writes them: { selector, label, cat, value, kind } + frame (selectors of the frames it is in, outermost first), lib, multi,
     search (a box to type the option in), aria (a role=checkbox / radio, not an <input>), hidden (an <input> with no box), label_for (the selector is
     the <label> of such an input: Playwright's check() acts on its control, Cypress clicks it), picker (a read-only date box) */
  const FLAGS = ['multi', 'search', 'aria', 'hidden', 'picker', 'label_for'];
  function rows(records) {
    return (Array.isArray(records) ? records : []).filter((r) => r && typeof r === 'object').map((r) => {
      const fr = typeof r.frame === 'string' ? [r.frame] : Array.isArray(r.frame) ? r.frame.filter((f) => typeof f === 'string' && f).slice(0, 10) : [];
      const x = {
        selector: typeof r.selector === 'string' ? r.selector : '', label: r.label == null ? '' : String(r.label), cat: r.cat == null ? '' : String(r.cat),
        value: Array.isArray(r.value) ? r.value.map(String) : typeof r.value === 'boolean' ? r.value : r.value == null ? '' : String(r.value),
        kind: /^(fill|check|select|choose|file)$/.test(r.kind) ? r.kind : 'fill', ...(fr.length ? { frame: fr } : {}),
        ...(typeof r.lib === 'string' && /^[\w-]{1,20}$/.test(r.lib) ? { lib: r.lib } : {}),
      };
      for (const k of FLAGS) if (r[k] === true) x[k] = true;
      return x;
    });
  }
  const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const cssStr = (s) => '"' + String(s).replace(/["\\]/g, '\\$&').replace(/[\n\r\f]/g, ' ') + '"';
  /* antd renders its options without role=option (a 0×0 copy has it), each titled with its label */
  const antOpt = (v) => `.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title=${cssStr(v)}]`;
  /* a read-only / date picker box: through flatpickr when it is one (its alt input shows altFormat), else the value and its events */
  const SET_JS = '(el, v) => { const fp = el._flatpickr || (el.previousElementSibling || {})._flatpickr; if (fp) { fp.setDate(v, true, el === fp.altInput ? fp.config.altFormat : fp.config.dateFormat); return; } '
    + "el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }";
  const CREDIT = '// Generated by FormGhost (https://github.com/mahtoaman/formghost) - by @mahtoaman'; // the first line of Playwright / Cypress exports
  function where() {
    try { if (typeof document !== 'undefined' && /^https?:$/.test(location.protocol)) return location.origin + location.pathname; } catch (e) { /* ignore */ }
    return '';
  }
  function playwright(list, url) {
    const out = [CREDIT, "import { test } from '@playwright/test';", '', "test('fill form (FormGhost)', async ({ page }) => {", `  // await page.goto(${lit(url || 'https://example.com/form')});`];
    for (const r of list) {
      const c = r.label || r.cat ? ` // ${note(r.label || r.cat)}` : '';
      if (!r.selector) { out.push(`  // skipped (no stable selector): ${note(r.label || r.cat)} = ${note(r.value)}`); continue; }
      const B = 'page' + (r.frame || []).map((f) => `.frameLocator(${lit(f)})`).join(''), L = `${B}.locator(${lit(r.selector)})`, force = r.hidden ? '{ force: true }' : '';
      if (r.kind === 'check') out.push(`  await ${L}.${isOff(r.value) ? 'uncheck' : 'check'}(${force});${c}`);
      else if (r.kind === 'select') out.push(`  await ${L}.selectOption(${Array.isArray(r.value) ? `[${r.value.map(lit).join(', ')}]` : lit(r.value)});${c}`);
      else if (r.kind === 'file') out.push(`  await ${L}.setInputFiles({ name: ${lit(r.value || 'sample.txt')}, mimeType: ${lit(mimeOf(r.value || 'sample.txt'))}, buffer: Buffer.from('FormGhost sample') });${c}`);
      else if (r.kind === 'choose') { // the option of exactly that name (a name: match alone takes any option containing it)
        const opt = r.lib === 'antd' ? `${B}.locator(${lit(antOpt(r.value))}).first()` : `${B}.getByRole('option', { name: ${lit(r.value)}, exact: true })`; // antd tags lists the typed text too
        out.push(`  // custom widget: ${note(r.label || r.cat)} → ${note(r.value)}`, r.search ? `  await ${L}.fill(${lit(r.value)});` : `  await ${L}.click();`, `  await ${opt}.click();`);
        if (r.multi) out.push("  await page.keyboard.press('Escape'); // a multi-select keeps its list open");
      } else if (r.picker) out.push(`  await ${L}.evaluate(${SET_JS}, ${lit(r.value)});${c} (read-only / date picker box)`);
      else out.push(`  await ${L}.fill(${lit(r.value)});${c}`);
    }
    out.push('});', '');
    return out.join('\n');
  }
  function cypress(list, url) {
    const typed = (v) => String(v).replace(/[{]/g, '{{}');
    const out = [CREDIT, "describe('FormGhost', () => {", "  it('fills the form', () => {", `    // cy.visit(${lit(url || 'https://example.com/form')});`];
    for (const r of list) {
      const c = r.label || r.cat ? ` // ${note(r.label || r.cat)}` : '';
      if (!r.selector) { out.push(`    // skipped (no stable selector): ${note(r.label || r.cat)} = ${note(r.value)}`); continue; }
      // a control in a frame: through each frame's document (a frame of another origin needs chromeWebSecurity: false)
      const fr = r.frame || [], B = fr.length ? fr.map((f, i) => `${i ? '.find' : 'cy.get'}(${lit(f)}).its('0.contentDocument.body')`).join('') : '';
      if (fr.length) out.push(`    // in a frame: ${note(fr.join(' > '))}`);
      const L = B ? `${B}.find(${lit(r.selector)})` : `cy.get(${lit(r.selector)})`, In = (sel) => (B ? `${B}.find(${sel})` : `cy.get(${sel})`), force = r.hidden ? '{ force: true }' : '';
      if (r.kind === 'check') out.push(r.aria || r.label_for || ARIA.test(r.selector) ? `    ${L}.click(); // ${isOff(r.value) ? 'off' : 'on'}: ${note(r.label || r.cat)}` : `    ${L}.${isOff(r.value) ? 'uncheck' : 'check'}(${force});${c}`);
      else if (r.kind === 'select') out.push(`    ${L}.select(${Array.isArray(r.value) ? `[${r.value.map(lit).join(', ')}]` : lit(r.value)});${c}`);
      else if (r.kind === 'file') out.push(`    ${L}.selectFile({ contents: Cypress.Buffer.from('FormGhost sample'), fileName: ${lit(r.value || 'sample.txt')}, mimeType: ${lit(mimeOf(r.value || 'sample.txt'))} });${c}`);
      else if (r.kind === 'choose') { // the option of exactly that text (cy.contains with a string takes any option containing it)
        const exact = `new RegExp(${lit('^\\s*' + reEsc(r.value) + '\\s*$')})`;
        out.push(`    // custom widget: ${note(r.label || r.cat)} → ${note(r.value)}`, r.search ? `    ${L}.clear().type(${lit(typed(r.value))});` : `    ${L}.click();`,
          r.lib === 'antd' ? `    ${In(lit(antOpt(r.value)))}.click();` : `    ${B ? `${B}.find('[role="option"], [role="menuitem"], li').contains` : 'cy.contains'}(${B ? '' : `'[role="option"], [role="menuitem"], li', `}${exact}).click();`);
        if (r.multi) out.push("    cy.get('body').type('{esc}'); // a multi-select keeps its list open");
      } else if (r.picker) out.push(`    ${L}.invoke('val', ${lit(r.value)}).trigger('input', { force: true }).trigger('change', { force: true });${c} (read-only / date picker box)`);
      else out.push(r.value === '' ? `    ${L}.clear();${c}` : `    ${L}.clear().type(${lit(typed(r.value))});${c}`);
    }
    out.push('  });', '});', '');
    return out.join('\n');
  }
  function format(records, fmt, opts) {
    const list = rows(records), url = (opts && typeof opts.url === 'string' && opts.url) || where();
    if (fmt === 'playwright') return playwright(list, url);
    if (fmt === 'cypress') return cypress(list, url);
    return JSON.stringify(list, null, 2);
  }

  X.qa = { v: VERSION, kinds: KINDS, edge, file, card, format };
})();
