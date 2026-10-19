/*!
 * FormGhost - https://github.com/mahtoaman/formghost
 * Copyright 2026 Aman Mahto (@mahtoaman)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 */
/* Library tests: persona consistency and FormGhost.withPrefs (lib/*.js), site keys and blocklist matching (lib/site.js),
   and background.js messages / menus / hotkeys against a stubbed chrome.*. More background messages are in bg.test.mjs.
   Run: node --test test/ */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* the background's import order; lib/data-in.js (curated IN reference data) is optional */
const LIBS = ['lib/locales.js', ...(existsSync(path.join(ROOT, 'lib/data-in.js')) ? ['lib/data-in.js'] : []), 'lib/profile.js', 'lib/persona.js'];

function load(files, globals = {}) {
  const ctx = vm.createContext({ console, URL, ...globals });
  for (const f of files) {
    const p = path.join(ROOT, f);
    if (!existsSync(p)) throw new Error(`${f} is missing`);
    vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: p });
  }
  return ctx;
}
/* A Date whose "now" is pinned, so age rules can be checked on edge days (leap day, New Year's Eve...). */
function pinnedDate(iso) {
  const now = new Date(iso).getTime();
  return class extends Date {
    constructor(...a) { if (a.length) super(...a); else super(now); }
    static now() { return now; }
  };
}

const D = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]];
const PERM = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]];
const verhoeff = (num) => { let c = 0; [...String(num)].reverse().forEach((ch, i) => { c = D[c][PERM[i % 8][+ch]]; }); return c === 0; };
const exactAge = (dob, now) => now.getFullYear() - dob.y - ((now.getMonth() + 1 < dob.m || (now.getMonth() + 1 === dob.m && now.getDate() < dob.d)) ? 1 : 0);
const pad = (n) => String(n).padStart(2, '0');
const realDate = (d) => { const t = new Date(d.y, d.m - 1, d.d); return t.getFullYear() === d.y && t.getMonth() === d.m - 1 && t.getDate() === d.d; };
/* Collects failures instead of stopping at the first, so one bad persona shows the pattern. */
function expectAll(list, fn, label) {
  const bad = [];
  for (const p of list) { const why = fn(p); if (why) bad.push(why); }
  assert.equal(bad.length, 0, `${bad.length}/${list.length} ${label}, e.g.\n  ${bad.slice(0, 5).join('\n  ')}`);
}

/* ---------------- personas ---------------- */
let G = null, libErr = null;
try { G = load(LIBS); } catch (e) { libErr = e; }
const lib = () => { if (libErr) throw libErr; return G; };
let inCache = null;
const IN = () => (inCache = inCache || Array.from({ length: 2000 }, () => lib().FormGhost.generate('IN')));
const TODAY = new Date();

test('libs load into a plain vm context and expose FormGhost.generate', () => {
  assert.equal(typeof lib().FormGhost.generate, 'function');
  assert.equal(typeof lib().FG_PROFILE, 'function');
});

test('2000 IN personas: Aadhaar is 12 digits, starts 2-9 and passes Verhoeff', () => {
  expectAll(IN(), (p) => (!/^[2-9]\d{11}$/.test(p.aadhaar) ? `bad shape ${p.aadhaar}` : !verhoeff(p.aadhaar) ? `Verhoeff fails ${p.aadhaar}` : ''), 'Aadhaar numbers invalid');
});

test('2000 IN personas: aadhaar/pan mirror ids.aadhaar/ids.pan', () => {
  expectAll(IN(), (p) => (p.ids.aadhaar !== p.aadhaar || p.ids.pan !== p.pan ? `${p.aadhaar}/${p.ids.aadhaar} ${p.pan}/${p.ids.pan}` : ''), 'mismatched');
});

test('2000 IN personas: exact age today from dob === age; dob is a real date with a matching iso', () => {
  expectAll(IN(), (p) => {
    const d = p.dob;
    if (!realDate(d)) return `not a real date ${JSON.stringify(d)}`;
    if (d.iso !== `${d.y}-${pad(d.m)}-${pad(d.d)}`) return `iso ${d.iso} vs ${d.y}-${d.m}-${d.d}`;
    const a = exactAge(d, TODAY);
    return a !== p.age ? `age ${p.age} but dob ${d.iso} gives ${a}` : '';
  }, 'personas with dob inconsistent with age');
});

test('2000 IN personas: gradYear <= current year - 1 and >= dob.y + 18', () => {
  const max = TODAY.getFullYear() - 1;
  expectAll(IN(), (p) => (p.gradYear > max || p.gradYear < p.dob.y + 18 ? `gradYear ${p.gradYear} (dob ${p.dob.y}, max ${max})` : ''), 'gradYears out of range');
});

test('2000 IN personas: PAN format AAAPL9999A with P as 4th char and surname initial as 5th', () => {
  expectAll(IN(), (p) => (!/^[A-Z]{3}P[A-Z]\d{4}[A-Z]$/.test(p.pan) ? `bad PAN ${p.pan}`
    : p.pan[4] !== p.lastName[0].toUpperCase() ? `PAN ${p.pan} vs surname ${p.lastName}` : ''), 'PANs invalid');
});

test('2000 IN personas: other generated data unchanged in shape', () => {
  expectAll(IN(), (p) => {
    if (!/^[6-9]\d{9}$/.test(p.phone.national) || p.phone.e164 !== '+91' + p.phone.national) return `phone ${JSON.stringify(p.phone)}`;
    if (!/^\d{6}$/.test(p.zip)) return `zip ${p.zip}`;
    if (!/^[^@\s]+@[^@\s]+\.[a-z.]+$/.test(p.email)) return `email ${p.email}`;
    if (p.age < 21 || p.age > 44) return `age ${p.age}`;
    if (['aadhaar', 'pan', 'passport', 'dl', 'voter'].some((k) => !p.ids[k])) return `ids ${Object.keys(p.ids)}`;
    return '';
  }, 'personas changed shape');
});

test('every country: exact age, real dob and gradYear bound (100 personas each)', () => {
  const max = TODAY.getFullYear() - 1, all = [];
  for (const { code } of lib().FormGhost.countries()) for (let i = 0; i < 100; i++) all.push(lib().FormGhost.generate(code));
  expectAll(all, (p) => (!realDate(p.dob) ? `${p.country} dob ${JSON.stringify(p.dob)}`
    : exactAge(p.dob, TODAY) !== p.age ? `${p.country} age ${p.age} dob ${p.dob.iso}`
      : p.gradYear > max || p.gradYear < p.dob.y + 18 ? `${p.country} gradYear ${p.gradYear} dob ${p.dob.y}` : ''), 'personas inconsistent');
});

for (const day of ['2028-02-29T12:00:00', '2027-01-01T00:30:00', '2026-12-31T23:30:00', '2027-03-01T09:00:00']) {
  test(`exact age holds when today is ${day.slice(0, 10)} (300 IN personas)`, () => {
    const Pinned = pinnedDate(day), now = new Pinned();
    const g = load(LIBS, { Date: Pinned });
    const list = Array.from({ length: 300 }, () => g.FormGhost.generate('IN'));
    expectAll(list, (p) => (!realDate(p.dob) ? `dob ${JSON.stringify(p.dob)}` : exactAge(p.dob, now) !== p.age ? `age ${p.age} dob ${p.dob.iso}`
      : p.gradYear > now.getFullYear() - 1 ? `gradYear ${p.gradYear}` : ''), `personas wrong on ${day.slice(0, 10)}`);
  });
}

test('an exact IP city wins over a substring match ("Visakhapatnam" contains "Patna")', () => {
  const list = Array.from({ length: 200 }, () => lib().FormGhost.generate('IN', 'Andhra Pradesh', 'Visakhapatnam'));
  expectAll(list, (p) => (p.city !== 'Visakhapatnam' ? `got ${p.city}, ${p.state}` : ''), 'personas in the wrong city');
});

/* ---------------- locate() matches whole names ---------------- */
test('city hint "Visakhapatnam" with no region gives Visakhapatnam (200 tries)', () => {
  const list = Array.from({ length: 200 }, () => lib().FormGhost.generate('IN', '', 'Visakhapatnam'));
  expectAll(list, (p) => (p.city !== 'Visakhapatnam' ? `got ${p.city}, ${p.state}` : ''), 'personas in the wrong city');
});

test('a hint that only contains a city name inside a word ("Patnagarh") never picks that city', () => {
  const list = Array.from({ length: 200 }, () => lib().FormGhost.generate('IN', 'Odisha', 'Patnagarh'));
  expectAll(list, (p) => (p.city === 'Patna' || p.state !== 'Odisha' ? `got ${p.city}, ${p.state}` : ''), 'personas placed by a substring');
});

test('whole-word matches still work both ways ("Greater Mumbai" → Mumbai, "Delhi" → New Delhi)', () => {
  const a = Array.from({ length: 100 }, () => lib().FormGhost.generate('IN', '', 'Greater Mumbai'));
  expectAll(a, (p) => (p.city !== 'Mumbai' ? `"Greater Mumbai" gave ${p.city}` : ''), 'personas in the wrong city');
  const b = Array.from({ length: 100 }, () => lib().FormGhost.generate('IN', '', 'Delhi'));
  expectAll(b, (p) => (p.city !== 'New Delhi' ? `"Delhi" gave ${p.city}` : ''), 'personas in the wrong city');
});

/* ---------------- persona extras ---------------- */
let allCache = null;
const ALL = () => (allCache = allCache || lib().FormGhost.countries().flatMap(({ code }) => Array.from({ length: 100 }, () => lib().FormGhost.generate(code))));
const LOC = (p) => lib().FG_LOCALES[p.country];
const clusterOf = (p) => LOC(p).clusters.find((c) => c.id === p.cluster);
const familyOf = (p) => (LOC(p).doubleSurname ? p.lastName.split(' ')[0] : p.lastName);
/* the first name of a relative called "<first> <family name>" (ES: first surname or both surnames), else null */
const firstOf = (p, name) => { for (const t of new Set([familyOf(p), p.lastName])) if (String(name).endsWith(' ' + t)) return String(name).slice(0, -t.length - 1); return null; };
const digitsOf = (x) => String(x && typeof x === 'object' ? x.national : x == null ? '' : x).replace(/\D/g, '');
const sameNumber = (a, b) => { const x = digitsOf(a), y = digitsOf(b); return x.length >= 7 && y.length >= 7 && (x.endsWith(y) || y.endsWith(x)); };
const RELATIONS = ['Father', 'Mother', 'Spouse', 'Brother', 'Sister'];
const BLOOD = ['O+', 'B+', 'A+', 'AB+', 'O-', 'B-', 'A-', 'AB-'];
const NOTICE = ['Immediate', '15 days', '30 days', '60 days', '90 days'];
/* {y,m,d} from a {y,m,d} object, 'YYYY-MM-DD' or 'DD/MM/YYYY' */
function ymd(x) {
  if (x && typeof x === 'object') return x.y ? { y: +x.y, m: +x.m, d: +x.d } : null;
  const s = String(x || ''), a = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/), b = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return a ? { y: +a[1], m: +a[2], d: +a[3] } : b ? { y: +b[3], m: +b[2], d: +b[1] } : null;
}
/* same object shape and country as the persona's phone: {cc, ccDigits, national, subscriber, display, e164} */
function phoneShape(ph, ref) {
  if (!ph || typeof ph !== 'object') return 'not an object';
  for (const k of ['cc', 'ccDigits', 'national', 'subscriber', 'display', 'e164']) if (typeof ph[k] !== 'string' || !ph[k]) return `no ${k}`;
  if (ph.cc !== ref.cc || ph.ccDigits !== ref.ccDigits) return 'another country code';
  if (ph.national.length !== ref.national.length) return 'another length';
  if (!ph.national.endsWith(ph.subscriber) || ph.national.length - ph.subscriber.length !== ref.national.length - ref.subscriber.length) return 'subscriber is not national minus the trunk prefix';
  if (ph.e164 !== ph.cc + ph.subscriber) return 'e164 is not cc + subscriber';
  if (ph.display.replace(/\D/g, '') !== ph.national.replace(/\D/g, '')) return 'display digits differ from national';
  return '';
}

test('persona.id is a 10-character string, unique over 2000 IN personas', () => {
  expectAll(IN(), (p) => (typeof p.id !== 'string' || p.id.length !== 10 ? `id ${JSON.stringify(p.id)}` : ''), 'bad ids');
  assert.equal(new Set(IN().map((p) => p.id)).size, IN().length, 'duplicate persona ids');
});

test('altPhone has the phone\'s shape and region but another number (every country, IN x2000)', () => {
  expectAll(ALL().concat(IN()), (p) => {
    const why = phoneShape(p.altPhone, p.phone);
    if (why) return `${p.country} altPhone ${why}: ${JSON.stringify(p.altPhone)}`;
    if (p.altPhone.national === p.phone.national) return `${p.country} altPhone is the phone ${p.phone.national}`;
    if (p.country === 'IN' && !/^[6-9]\d{9}$/.test(p.altPhone.national)) return `IN altPhone ${p.altPhone.national} is not a mobile number`;
    if (p.country === 'US' || p.country === 'CA') {
      const codes = clusterOf(p).cities.flatMap((c) => c.a || []);
      if (!codes.includes(p.altPhone.national.slice(0, 3))) return `${p.country} altPhone area code ${p.altPhone.national.slice(0, 3)} is not from the persona's region (${codes})`;
    }
    return '';
  }, 'alt phones wrong');
});

test('altEmail is a valid address, not the email, at another provider (every country)', () => {
  expectAll(ALL(), (p) => {
    if (typeof p.altEmail !== 'string' || !/^[^@\s]+@[^@\s]+\.[a-z.]+$/.test(p.altEmail)) return `${p.country} altEmail ${JSON.stringify(p.altEmail)}`;
    if (p.altEmail === p.email) return `${p.country} altEmail is the email ${p.email}`;
    return p.altEmail.split('@')[1] === p.email.split('@')[1] ? `${p.country} same provider: ${p.email} / ${p.altEmail}` : '';
  }, 'alt emails wrong');
});

test('maritalStatus is Married or Single, and Married gets likelier with age (2000 IN)', () => {
  expectAll(IN(), (p) => (!['Married', 'Single'].includes(p.maritalStatus) ? `maritalStatus ${JSON.stringify(p.maritalStatus)}` : ''), 'bad marital status');
  const rate = (lo, hi) => { const g = IN().filter((p) => p.age >= lo && p.age <= hi); return g.filter((p) => p.maritalStatus === 'Married').length / Math.max(1, g.length); };
  const young = rate(21, 27), old = rate(38, 44);
  assert.ok(old > young, `married share: ${(young * 100).toFixed(0)}% at 21-27 vs ${(old * 100).toFixed(0)}% at 38-44`);
  assert.ok(IN().some((p) => p.maritalStatus === 'Single') && IN().some((p) => p.maritalStatus === 'Married'), 'both values occur');
});

test('spouseName is always an opposite-gender first name from the same cluster + the family name', () => {
  expectAll(ALL().concat(IN()), (p) => {
    const opp = clusterOf(p)[p.gender === 'male' ? 'female' : 'male'], first = typeof p.spouseName === 'string' ? firstOf(p, p.spouseName) : null;
    if (first === null) return `${p.country} spouseName ${JSON.stringify(p.spouseName)} (family name ${familyOf(p)})`;
    return opp.includes(first) ? '' : `${p.country} ${p.gender} persona, spouse first name ${JSON.stringify(first)} is not a ${p.gender === 'male' ? 'female' : 'male'} name of cluster ${p.cluster}`;
  }, 'spouse names wrong');
});

test('emergency contact relation fits its name; its phone is a third distinct number', () => {
  expectAll(ALL().concat(IN()), (p) => {
    const e = p.emergency;
    if (!e || typeof e !== 'object' || typeof e.name !== 'string' || !e.name) return `${p.country} emergency ${JSON.stringify(e)}`;
    if (!RELATIONS.includes(e.relation)) return `${p.country} emergency relation ${JSON.stringify(e.relation)}`;
    const cl = clusterOf(p), first = firstOf(p, e.name);
    if (e.relation === 'Father' && e.name !== p.fatherName) return `Father ${e.name} but fatherName ${p.fatherName}`;
    if (e.relation === 'Mother' && e.name !== p.motherName) return `Mother ${e.name} but motherName ${p.motherName}`;
    if (e.relation === 'Spouse' && (e.name !== p.spouseName || p.maritalStatus !== 'Married')) return `Spouse ${e.name} (spouseName ${p.spouseName}, ${p.maritalStatus})`;
    if (e.relation === 'Brother' && (!first || !cl.male.includes(first) || e.name === p.fullName)) return `Brother ${e.name} (family ${familyOf(p)})`;
    if (e.relation === 'Sister' && (!first || !cl.female.includes(first) || e.name === p.fullName)) return `Sister ${e.name} (family ${familyOf(p)})`;
    if (digitsOf(e.phone).length < 7) return `${p.country} emergency phone ${JSON.stringify(e.phone)}`;
    if (sameNumber(e.phone, p.phone) || sameNumber(e.phone, p.altPhone)) return `${p.country} emergency phone ${digitsOf(e.phone)} repeats phone ${p.phone.national} / alt ${p.altPhone && p.altPhone.national}`;
    return '';
  }, 'emergency contacts wrong');
});

test('nominee is the spouse if married, else a parent; dob gives its age; the age is plausible', () => {
  expectAll(ALL().concat(IN()), (p) => {
    const n = p.nominee;
    if (!n || typeof n !== 'object' || typeof n.name !== 'string' || !n.name) return `${p.country} nominee ${JSON.stringify(n)}`;
    if (p.maritalStatus === 'Married') {
      if (!['Spouse', 'Wife', 'Husband'].includes(n.relation) || n.name !== p.spouseName) return `married: nominee ${n.name} (${n.relation}), spouse ${p.spouseName}`;
      if ((n.relation === 'Wife' && p.gender !== 'male') || (n.relation === 'Husband' && p.gender !== 'female')) return `${p.gender} persona with a ${n.relation}`;
    } else if (!(n.relation === 'Mother' && n.name === p.motherName) && !(n.relation === 'Father' && n.name === p.fatherName)) return `single: nominee ${n.name} (${n.relation}), parents ${p.fatherName} / ${p.motherName}`;
    const d = ymd(n.dob);
    if (!d || !realDate(d)) return `nominee dob ${JSON.stringify(n.dob)}`;
    if (exactAge(d, TODAY) !== +n.age) return `nominee age ${n.age} but dob ${JSON.stringify(n.dob)} gives ${exactAge(d, TODAY)}`;
    const parent = n.relation === 'Mother' || n.relation === 'Father';
    if (parent ? n.age < p.age + 15 || n.age > p.age + 50 : n.age < 18 || Math.abs(n.age - p.age) > 15) return `${n.relation} aged ${n.age} for a persona aged ${p.age}`;
    return '';
  }, 'nominees wrong');
});

test('the mother, emergency contact and nominee never carry the persona\'s own first name (every country x 1500)', () => {
  const list = lib().FormGhost.countries().flatMap(({ code }) => Array.from({ length: 1500 }, () => lib().FormGhost.generate(code)));
  expectAll(list, (p) => {
    for (const [k, name] of [['motherName', p.motherName], ['fatherName', p.fatherName], ['emergency', p.emergency.name], ['nominee', p.nominee.name], ['spouseName', p.spouseName]]) {
      if (firstOf(p, name) === p.firstName) return `${p.country} ${p.fullName}: ${k} ${name} has the same first name`;
    }
    return '';
  }, 'relatives named like the persona');
});

test('bloodGroup (weighted towards O+ / B+), noticePeriod and district on every persona', () => {
  expectAll(ALL().concat(IN()), (p) => (!BLOOD.includes(p.bloodGroup) ? `${p.country} bloodGroup ${JSON.stringify(p.bloodGroup)}`
    : !NOTICE.includes(p.noticePeriod) ? `${p.country} noticePeriod ${JSON.stringify(p.noticePeriod)}`
      : typeof p.district !== 'string' || !p.district.trim() ? `${p.country} district ${JSON.stringify(p.district)}` : ''), 'personas missing extras');
  const n = (g) => IN().filter((p) => p.bloodGroup === g).length;
  const neg = ['O-', 'B-', 'A-', 'AB-'].reduce((a, g) => a + n(g), 0);
  assert.ok(n('O+') + n('B+') > neg && n('O+') > n('AB-') && n('B+') > n('AB-'), `counts ${BLOOD.map((g) => g + ' ' + n(g)).join(', ')}`);
  assert.ok(NOTICE.every((x) => IN().some((p) => p.noticePeriod === x)), 'every notice period occurs in 2000 personas');
});

test('IN personas have tehsil, village and post office', () => {
  expectAll(IN(), (p) => ['tehsil', 'village', 'postOffice'].map((k) => (typeof p[k] !== 'string' || !p[k].trim() ? `${k} ${JSON.stringify(p[k])}` : '')).filter(Boolean).join(', '), 'IN personas missing fields');
});

test('no persona carries "undefined", "NaN" or "[object Object]" text', () => {
  // a standalone NaN / undefined (a value printed as text), not three letters inside a random password
  expectAll(ALL().concat(IN()), (p) => { const m = JSON.stringify(p).match(/.{0,40}((?<![A-Za-z])(undefined|NaN)(?![A-Za-z])|\[object Object\]).{0,20}/); return m ? `${p.country}: …${m[0]}…` : ''; }, 'personas with broken text');
});

test('a generated password never contains "NaN" / "null" / "undefined" letters (20 000 tries)', () => {
  const { FormGhost } = lib(), bad = [];
  for (let i = 0; i < 20000 && bad.length < 3; i++) { const pw = FormGhost.generate(i % 2 ? 'IN' : 'US').password; if (/nan|null|undefined/i.test(pw)) bad.push(pw); }
  assert.deepEqual(bad, []);
});

/* ---------------- FormGhost.withPrefs ---------------- */
const W = (p, s) => lib().FormGhost.withPrefs(p, { emailDomain: '', emailInbox: '', testPhones: false, ...s });
const alnum = (s) => String(s).replace(/[^a-z0-9]/gi, '').toLowerCase();
const fromLocal = (p, local) => !!alnum(local) && alnum(p.email.split('@')[0]).startsWith(alnum(local)); // the persona's local part, cleaned / cut
const PREF_SAMPLE = () => ALL().filter((_, i) => i % 4 === 0);
const plain = (x) => JSON.parse(JSON.stringify(x));

test('FormGhost.withPrefs exists, returns a copy and leaves the persona untouched', () => {
  assert.equal(typeof lib().FormGhost.withPrefs, 'function');
  for (const p of PREF_SAMPLE().slice(0, 40)) {
    const before = JSON.stringify(p), out = W(p, { emailInbox: 'you@gmail.com', emailDomain: 'example.com', testPhones: true });
    assert.notEqual(out, p, 'a new object');
    assert.equal(JSON.stringify(p), before, `${p.country} persona was changed`);
  }
});

test('withPrefs with empty settings changes nothing', () => {
  for (const p of PREF_SAMPLE()) assert.deepEqual(plain(W(p, {})), plain(p), p.country);
});

test('"Send to my inbox" plus-addresses email and altEmail: you+<local>@ / you+<local>.alt@', () => {
  expectAll(PREF_SAMPLE(), (p) => {
    const o = W(p, { emailInbox: 'you@gmail.com' }), m = /^you\+([a-z0-9.]{1,20})@gmail\.com$/.exec(o.email);
    if (!m) return `${p.email} → ${o.email}`;
    if (!fromLocal(p, m[1])) return `local part ${m[1]} is not from ${p.email}`;
    return o.altEmail === `you+${m[1]}.alt@gmail.com` ? '' : `altEmail ${o.altEmail} for ${o.email}`;
  }, 'inbox addresses wrong');
});

test('an email domain gives <local>@domain and <local>.alt@domain', () => {
  expectAll(PREF_SAMPLE(), (p) => {
    const o = W(p, { emailDomain: 'example.com' }), m = /^([a-z0-9.]{1,20})@example\.com$/.exec(o.email);
    if (!m) return `${p.email} → ${o.email}`;
    if (!fromLocal(p, m[1])) return `local part ${m[1]} is not from ${p.email}`;
    return o.altEmail === `${m[1]}.alt@example.com` ? '' : `altEmail ${o.altEmail} for ${o.email}`;
  }, 'domain addresses wrong');
});

test('a valid inbox wins over a domain; invalid inbox / domain values are ignored', () => {
  const p = lib().FormGhost.generate('IN');
  assert.match(W(p, { emailInbox: 'me@outlook.com', emailDomain: 'example.com' }).email, /^me\+[a-z0-9.]{1,20}@outlook\.com$/);
  for (const bad of ['you', 'you@', '@gmail.com', 'you@gmail', 'you me@gmail.com', 'you@gmail com', 'you@@gmail.com']) {
    const o = W(p, { emailInbox: bad });
    assert.deepEqual([o.email, o.altEmail], [p.email, p.altEmail], `inbox ${JSON.stringify(bad)} must be ignored`);
    assert.match(W(p, { emailInbox: bad, emailDomain: 'example.com' }).email, /@example\.com$/, `inbox ${JSON.stringify(bad)} falls back to the domain`);
  }
  for (const bad of ['example', '.com', 'exa mple.com', 'example.com/x']) {
    const o = W(p, { emailDomain: bad });
    assert.deepEqual([o.email, o.altEmail], [p.email, p.altEmail], `domain ${JSON.stringify(bad)} must be ignored`);
  }
});

test('withPrefs is deterministic per persona', () => {
  for (const p of PREF_SAMPLE()) {
    const s = { emailInbox: 'you@gmail.com', testPhones: true };
    assert.deepEqual(plain(W(p, s)), plain(W(p, s)), p.country);
    assert.deepEqual(plain(W(p, { emailDomain: 'example.com', testPhones: true })), plain(W(p, { emailDomain: 'example.com', testPhones: true })), p.country);
  }
});

const RESERVED = { US: /^(?!555)[2-9](?!11)\d\d55501\d\d$/, CA: /^(?!555)[2-9](?!11)\d\d55501\d\d$/, GB: /^07700900\d{3}$/, AU: /^049157\d{4}$/ };
for (const code of Object.keys(RESERVED)) {
  test(`test phones for ${code}: phone and altPhone are reserved fictional numbers with the same shape (200 personas)`, () => {
    const list = Array.from({ length: 200 }, () => lib().FormGhost.generate(code));
    expectAll(list, (p) => {
      const o = W(p, { testPhones: true });
      for (const k of ['phone', 'altPhone']) {
        const why = phoneShape(o[k], p.phone);
        if (why) return `${k} ${why}: ${JSON.stringify(o[k])}`;
        if (!RESERVED[code].test(o[k].national)) return `${k} ${o[k].national} is outside the reserved range`;
        if (Object.keys(o[k]).sort().join() !== Object.keys(p.phone).sort().join()) return `${k} keys ${Object.keys(o[k])}`;
      }
      return o.phone.national === o.altPhone.national ? `phone and altPhone are both ${o.phone.national}` : '';
    }, `${code} test numbers wrong`);
    assert.ok(new Set(list.map((p) => W(p, { testPhones: true }).phone.national)).size > 5, 'numbers vary between personas');
  });
}

test('test phones leave other countries\' numbers unchanged', () => {
  for (const code of ['IN', 'DE', 'FR', 'ES', 'BR', 'AE', 'PK', 'BD']) {
    for (let i = 0; i < 20; i++) {
      const p = lib().FormGhost.generate(code), o = W(p, { testPhones: true });
      assert.deepEqual(plain([o.phone, o.altPhone]), plain([p.phone, p.altPhone]), code);
    }
  }
});

/* withPrefs also rewrites the references' emails / phones, so those are stripped too */
test('withPrefs changes only email / altEmail / phone / altPhone (ids and everything else unchanged)', () => {
  const strip = (x) => {
    const c = plain(x); for (const k of ['email', 'altEmail', 'phone', 'altPhone']) delete c[k]; if (c.emergency) delete c.emergency.phone;
    if (Array.isArray(c.references)) c.references.forEach((r) => { if (r) { delete r.email; delete r.phone; } });
    return c;
  };
  for (const p of PREF_SAMPLE()) {
    const o = W(p, { emailInbox: 'you@gmail.com', emailDomain: 'example.com', testPhones: true });
    assert.deepEqual(plain(o.ids), plain(p.ids), `${p.country} ids`);
    assert.deepEqual(strip(o), strip(p), p.country);
  }
});

/* ---------------- ID document dates ---------------- */
/* The key names aren't fixed: idDates.passport / idDates.dl with issue / expiry are expected; a few other spellings are accepted. */
const ID_DOCS = { passport: ['passport', 'pp'], dl: ['dl', 'drivingLicence', 'drivingLicense', 'licence', 'license', 'driving'] };
const ID_KINDS = { issue: ['issue', 'issued', 'issueDate', 'issuedOn', 'dateOfIssue', 'doi', 'from'], expiry: ['expiry', 'expires', 'expiryDate', 'expiresOn', 'dateOfExpiry', 'validTill', 'validUpto', 'doe', 'to'] };
const cap = (s) => s[0].toUpperCase() + s.slice(1);
function idDate(p, doc, kind) {
  const D = (p && p.idDates) || {};
  for (const d of ID_DOCS[doc]) for (const k of ID_KINDS[kind]) {
    if (D[d] && typeof D[d] === 'object' && D[d][k]) return D[d][k];
    if (D[d + cap(k)]) return D[d + cap(k)];
  }
  return undefined;
}
const isoDay = (t) => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
const plusYears = (iso, n) => `${+iso.slice(0, 4) + n}${iso.slice(4)}`; // '2024-02-29' + 10 = '2034-02-29': fine for string comparison
const plusDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return isoDay(new Date(y, m - 1, d + n)); };
/* passport issued 1-9 years ago and valid 10 years; DL issued on / after the 18th birthday, not in the future, valid at most 20 years */
function idDatesWrong(p, now) {
  const today = isoDay(now), pi = idDate(p, 'passport', 'issue'), pe = idDate(p, 'passport', 'expiry'), di = idDate(p, 'dl', 'issue'), de = idDate(p, 'dl', 'expiry');
  if ([pi, pe, di, de].some((x) => typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x) || !realDate(ymd(x)))) return `${p.country} idDates ${JSON.stringify(p.idDates)}`;
  if (!(pi < pe) || !(di < de)) return `${p.country} an issue date is not before its expiry: ${JSON.stringify(p.idDates)}`;
  if (pi < plusDays(plusYears(today, -9), -1) || pi > plusDays(plusYears(today, -1), 1)) return `${p.country} passport issued ${pi}, not 1-9 years before ${today}`;
  if (pe < plusDays(plusYears(pi, 10), -1) || pe > plusDays(plusYears(pi, 10), 1)) return `${p.country} passport ${pi} → ${pe} is not valid for 10 years`;
  if (di < plusYears(p.dob.iso, 18)) return `${p.country} DL issued ${di} before the 18th birthday (dob ${p.dob.iso})`;
  if (di > today) return `${p.country} DL issued in the future (${di}, today ${today})`;
  if (de > plusDays(plusYears(di, 20), 1)) return `${p.country} DL ${di} → ${de} is valid for more than 20 years`;
  return '';
}

test('idDates hold passport and DL issue / expiry dates as real ISO strings (every country, IN x2000)', () => {
  expectAll(ALL().concat(IN()), (p) => {
    if (!p.idDates || typeof p.idDates !== 'object') return `${p.country} idDates ${JSON.stringify(p.idDates)}`;
    for (const doc of ['passport', 'dl']) for (const kind of ['issue', 'expiry']) {
      const v = idDate(p, doc, kind);
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !realDate(ymd(v))) return `${p.country} ${doc} ${kind} ${JSON.stringify(v)} in ${JSON.stringify(p.idDates)}`;
    }
    return '';
  }, 'personas without usable idDates');
});

test('issue < expiry; passport issued 1-9 years ago and valid 10 years; DL issued after the 18th birthday (every country, IN x2000)', () => {
  expectAll(ALL().concat(IN()), (p) => idDatesWrong(p, TODAY), 'personas with inconsistent ID dates');
});

test('a 10-year passport is an adult one: issued on or after the 18th birthday (every country, IN x2000)', () => {
  expectAll(ALL().concat(IN()), (p) => { const pi = idDate(p, 'passport', 'issue'); return typeof pi === 'string' && pi < plusYears(p.dob.iso, 18) ? `${p.country} aged ${p.age}: passport issued ${pi}, dob ${p.dob.iso}` : ''; }, 'passports issued to a minor');
});

test('IN driving licences: expiry at most 20 years after issue', () => {
  expectAll(IN(), (p) => { const di = idDate(p, 'dl', 'issue'), de = idDate(p, 'dl', 'expiry'); return !di || !de || de > plusDays(plusYears(di, 20), 1) ? `DL ${di} → ${de}` : ''; }, 'IN licences valid too long');
});

test('PAN and Aadhaar carry no expiry date', () => {
  expectAll(IN(), (p) => {
    const D = p.idDates || {};
    for (const doc of ['pan', 'aadhaar']) {
      if (D[doc] && typeof D[doc] === 'object' && ID_KINDS.expiry.some((k) => D[doc][k])) return `${doc} has an expiry: ${JSON.stringify(D[doc])}`;
      if (ID_KINDS.expiry.some((k) => D[doc + cap(k)])) return `${doc} has an expiry key: ${JSON.stringify(D)}`;
    }
    return '';
  }, 'IN personas with a PAN / Aadhaar expiry');
});

for (const day of ['2028-02-29T12:00:00', '2027-01-01T00:30:00', '2026-12-31T23:30:00']) {
  test(`ID dates stay consistent when today is ${day.slice(0, 10)} (300 IN personas)`, () => {
    const Pinned = pinnedDate(day), now = new Pinned(), g = load(LIBS, { Date: Pinned });
    expectAll(Array.from({ length: 300 }, () => g.FormGhost.generate('IN')), (p) => idDatesWrong(p, now), `personas wrong on ${day.slice(0, 10)}`);
  });
}

/* ---------------- landline ---------------- */
const STD = {
  'New Delhi': '011', Mumbai: '022', Kolkata: '033', Chennai: '044', Bengaluru: '080', Hyderabad: '040', Pune: '020', Ahmedabad: '079', Jaipur: '0141', Lucknow: '0522',
  Chandigarh: '0172', Kochi: '0484', Bhopal: '0755', Indore: '0731', Patna: '0612', Nagpur: '0712', Surat: '0261', Coimbatore: '0422', Visakhapatnam: '0891', Vijayawada: '0866',
  Guwahati: '0361', Bhubaneswar: '0674', Kanpur: '0512', Varanasi: '0542', Mangaluru: '0824', Mysuru: '0821', Madurai: '0452', Thiruvananthapuram: '0471', Dehradun: '0135',
  Ludhiana: '0161', Amritsar: '0183', Nashik: '0253', Vadodara: '0265', Rajkot: '0281', Ranchi: '0651', Raipur: '0771', Gurugram: '0124', Noida: '0120',
};
/* cities not listed above: their own real STD code, or the state capital's as a fallback */
const STD_OTHER = { Thane: ['022'], Howrah: ['033'], Panaji: ['0832'], Warangal: ['0870', '040'], Siliguri: ['0353', '033'], Gaya: ['0631', '0612'], Jamshedpur: ['0657', '0651'], Cuttack: ['0671', '0674'] };
/* a mobile number is not a landline */
const MOBILE_E164 = { GB: /^\+447/, AU: /^\+614/, DE: /^\+491[5-7]/, FR: /^\+33[67]/, ES: /^\+34[67]/, BR: /^\+55\d\d9\d{8}$/, AE: /^\+9715/, PK: /^\+923/, BD: /^\+8801/ };
const dig = (s) => String(s == null ? '' : s).replace(/\D/g, '');
/* { std, number, display, e164 }: e164 = +cc + std without its trunk 0 + number; display shows the same digits; not one of the persona's own numbers */
function landlineWrong(p) {
  const l = p.landline;
  if (!l || typeof l !== 'object') return `${p.country} landline ${JSON.stringify(l)}`;
  for (const k of ['std', 'number', 'display', 'e164']) if (typeof l[k] !== 'string' || (k !== 'std' && !l[k])) return `${p.country} landline.${k} ${JSON.stringify(l[k])} in ${JSON.stringify(l)}`;
  if (!/^\+\d{8,15}$/.test(l.e164)) return `${p.country} landline.e164 ${l.e164}`;
  if (dig(l.e164) !== p.phone.ccDigits + dig(l.std).replace(/^0/, '') + dig(l.number)) return `${p.country} e164 ${l.e164} is not +${p.phone.ccDigits} / ${l.std} / ${l.number}`;
  if (![dig(l.std) + dig(l.number), dig(l.e164), dig(l.std).replace(/^0/, '') + dig(l.number)].includes(dig(l.display))) return `${p.country} display ${l.display} shows other digits than ${l.std} ${l.number}`;
  if (MOBILE_E164[p.country] && MOBILE_E164[p.country].test(l.e164)) return `${p.country} landline ${l.e164} is a mobile number`;
  for (const [k, ph] of [['phone', p.phone], ['altPhone', p.altPhone], ['emergency phone', p.emergency && p.emergency.phone]]) if (ph && sameNumber(l.e164, ph)) return `${p.country} landline ${l.e164} is the ${k}`;
  if (p.country === 'IN') {
    if (!/^0[1-9]\d{1,3}$/.test(l.std)) return `IN STD code ${JSON.stringify(l.std)}`;
    if (!/^[2-9]\d+$/.test(l.number) || l.std.length - 1 + l.number.length !== 10) return `IN landline ${l.std} ${l.number}: the number after the 0 must be 10 digits, not starting 0/1`;
  }
  return '';
}

test('IN landlines use the real STD code of the persona\'s city (every listed city in the locale, 20 personas each)', () => {
  const found = [], bad = [];
  for (const [city, std] of Object.entries(STD)) {
    const list = Array.from({ length: 20 }, () => lib().FormGhost.generate('IN', '', city)).filter((p) => p.city === city);
    if (!list.length) continue; // not a city of the locale (Varanasi, Amritsar, Raipur)
    found.push(city);
    for (const p of list) { const l = p.landline || {}; if (l.std !== std) bad.push(`${city}: std ${JSON.stringify(l.std)}, want ${std}`); else { const why = landlineWrong(p); if (why) bad.push(`${city}: ${why}`); } }
  }
  assert.ok(found.length >= 30, `only ${found.length} listed cities found in the IN locale: ${found}`);
  assert.equal(bad.length, 0, `${bad.length} landlines wrong, e.g.\n  ${[...new Set(bad)].slice(0, 8).join('\n  ')}`);
});

test('IN cities without a listed code get their own STD code or the state capital\'s', () => {
  const bad = [];
  for (const [city, codes] of Object.entries(STD_OTHER)) {
    for (const p of Array.from({ length: 20 }, () => lib().FormGhost.generate('IN', '', city)).filter((x) => x.city === city)) {
      const l = p.landline || {};
      if (!codes.includes(l.std)) bad.push(`${city} (${p.state}): std ${JSON.stringify(l.std)}, want ${codes.join(' or ')}`);
    }
  }
  assert.equal(bad.length, 0, `${bad.length} wrong, e.g.\n  ${[...new Set(bad)].slice(0, 8).join('\n  ')}`);
});

test('every country has a plausible landline { std, number, display, e164 } that is none of the persona\'s numbers (every country, IN x2000)', () => {
  expectAll(ALL().concat(IN()), landlineWrong, 'landlines wrong');
});

/* ---------------- references ---------------- */
const REF_RELATIONS = ['Former manager', 'Colleague', 'Professor', 'Friend'];
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[a-z.]+$/i;
/* a surname of the cluster, or two of them (ES): the parts, else null */
function surnamesOf(rest, cl) {
  if (cl.last.includes(rest)) return [rest];
  for (const a of cl.last) if (rest.startsWith(a + ' ') && cl.last.includes(rest.slice(a.length + 1))) return [a, rest.slice(a.length + 1)];
  return null;
}
/* "<first> <surname(s)>" with both from cluster cl: { first, lasts }, else null */
function clusterName(name, cl) {
  for (const f of [...new Set(cl.male.concat(cl.female))].sort((a, b) => b.length - a.length)) {
    if (!String(name).startsWith(f + ' ')) continue;
    const lasts = surnamesOf(String(name).slice(f.length + 1), cl);
    if (lasts) return { first: f, lasts };
  }
  return null;
}
/* the national digits of a phone object or string (so a reserved-range check works on either) */
function nationalOf(ph, p) {
  if (ph && typeof ph === 'object') return dig(ph.national);
  const d = dig(ph), nat = dig(p.phone.national), sub = dig(p.phone.subscriber), cc = p.phone.ccDigits;
  return d.length !== nat.length && d.startsWith(cc) && d.length === cc.length + sub.length ? nat.slice(0, nat.length - sub.length) + d.slice(cc.length) : d;
}

test('references are two people with name, phone, email, relation, company and years known (every country, IN x2000)', () => {
  expectAll(ALL().concat(IN()), (p) => {
    const r = p.references;
    if (!Array.isArray(r) || r.length !== 2) return `${p.country} references ${JSON.stringify(r)}`;
    for (const [i, x] of r.entries()) {
      const at = `${p.country} reference ${i + 1}`;
      if (!x || typeof x !== 'object') return `${at} ${JSON.stringify(x)}`;
      if (typeof x.name !== 'string' || !x.name.trim()) return `${at} name ${JSON.stringify(x.name)}`;
      if (!REF_RELATIONS.includes(x.relation)) return `${at} relation ${JSON.stringify(x.relation)}`;
      if (typeof x.company !== 'string' || !x.company.trim()) return `${at} company ${JSON.stringify(x.company)}`;
      if (typeof x.email !== 'string' || !EMAIL_SHAPE.test(x.email)) return `${at} email ${JSON.stringify(x.email)}`;
      if (dig(x.phone && typeof x.phone === 'object' ? x.phone.national : x.phone).length < 7) return `${at} phone ${JSON.stringify(x.phone)}`;
      if (x.phone && typeof x.phone === 'object') { const why = phoneShape(x.phone, p.phone); if (why) return `${at} phone ${why}: ${JSON.stringify(x.phone)}`; }
      const y = Number(x.yearsKnown);
      if (!Number.isInteger(y) || y < 1 || y > p.age) return `${at} yearsKnown ${JSON.stringify(x.yearsKnown)} (persona aged ${p.age})`;
    }
    return '';
  }, 'personas with malformed references');
});

test('reference names come from the persona\'s cluster and share no first name or surname with the persona or each other', () => {
  expectAll(ALL().concat(IN()), (p) => {
    const cl = clusterOf(p), mine = surnamesOf(p.lastName, cl) || [p.lastName], r = p.references || [];
    const parts = r.map((x) => clusterName(x && x.name, cl));
    for (const [i, s] of parts.entries()) {
      if (!s) return `${p.country} reference ${JSON.stringify(r[i] && r[i].name)} is not a ${p.cluster} first name + surname`;
      if (s.first === p.firstName) return `${p.country} ${p.fullName}: reference ${r[i].name} has the persona's first name`;
      if (s.lasts.some((l) => mine.includes(l))) return `${p.country} ${p.fullName}: reference ${r[i].name} has the persona's surname`;
    }
    if (r.length === 2 && r[0].name === r[1].name) return `${p.country} both references are ${r[0].name}`;
    return '';
  }, 'references named like the persona');
});

test('reference phones and emails differ from the persona\'s (phone, alt, emergency, landline; email, alt) and from each other', () => {
  expectAll(ALL().concat(IN()), (p) => {
    const r = p.references || [], own = [p.phone, p.altPhone, p.emergency && p.emergency.phone, p.landline && p.landline.e164].filter(Boolean);
    const mails = [p.email, p.altEmail].map((e) => String(e).toLowerCase());
    for (const [i, x] of r.entries()) {
      if (own.some((o) => sameNumber(o, x.phone))) return `${p.country} reference ${i + 1} phone ${dig(x.phone && x.phone.national || x.phone)} is one of the persona's numbers`;
      if (mails.includes(String(x.email).toLowerCase())) return `${p.country} reference ${i + 1} email ${x.email} is the persona's`;
    }
    if (r.length === 2 && sameNumber(r[0].phone, r[1].phone)) return `${p.country} both references have the phone ${dig(r[0].phone && r[0].phone.national || r[0].phone)}`;
    if (r.length === 2 && String(r[0].email).toLowerCase() === String(r[1].email).toLowerCase()) return `${p.country} both references have the email ${r[0].email}`;
    return '';
  }, 'references reusing numbers / emails');
});

test('withPrefs rewrites reference emails for "Send to my inbox" / an email domain (distinct, the rest unchanged)', () => {
  expectAll(PREF_SAMPLE(), (p) => {
    for (const [s, re] of [[{ emailInbox: 'you@gmail.com' }, /^you\+[^@\s]+@gmail\.com$/], [{ emailDomain: 'example.com' }, /^[^@\s]+@example\.com$/]]) {
      const o = W(p, s), r = o.references, seen = [o.email, o.altEmail].map((e) => String(e).toLowerCase());
      if (!Array.isArray(r) || r.length !== 2) return `${p.country} references after withPrefs ${JSON.stringify(r)}`;
      for (const [i, x] of r.entries()) {
        const at = `${p.country} ${JSON.stringify(s)} reference ${i + 1}`;
        if (!re.test(String(x.email))) return `${at}: email ${p.references[i].email} → ${x.email}`;
        if (seen.includes(String(x.email).toLowerCase())) return `${at}: email ${x.email} repeats another address`;
        seen.push(String(x.email).toLowerCase());
        for (const k of ['name', 'relation', 'company', 'yearsKnown', 'phone']) if (JSON.stringify(x[k]) !== JSON.stringify(p.references[i][k])) return `${at}: ${k} changed`;
      }
    }
    return '';
  }, 'reference emails not rewritten');
});

for (const code of Object.keys(RESERVED)) {
  test(`test phones for ${code} reach the references too: reserved, distinct, same shape (100 personas)`, () => {
    expectAll(Array.from({ length: 100 }, () => lib().FormGhost.generate(code)), (p) => {
      const o = W(p, { testPhones: true }), r = o.references, used = [o.phone, o.altPhone, o.emergency && o.emergency.phone].filter(Boolean);
      if (!Array.isArray(r) || r.length !== 2) return `references ${JSON.stringify(r)}`;
      for (const [i, x] of r.entries()) {
        if (x.phone && typeof x.phone === 'object') { const why = phoneShape(x.phone, p.phone); if (why) return `reference ${i + 1} phone ${why}: ${JSON.stringify(x.phone)}`; }
        if (typeof x.phone !== typeof p.references[i].phone) return `reference ${i + 1} phone changed type`;
        const n = nationalOf(x.phone, p);
        if (!RESERVED[code].test(n)) return `reference ${i + 1} phone ${n} is outside the reserved range`;
        if (used.some((u) => sameNumber(u, x.phone))) return `reference ${i + 1} phone ${n} repeats another number`;
        used.push(x.phone);
      }
      return '';
    }, `${code} reference test numbers wrong`);
  });
}

test('test phones leave other countries\' reference phones unchanged', () => {
  for (const code of ['IN', 'DE', 'FR', 'BR', 'AE']) {
    for (let i = 0; i < 20; i++) {
      const p = lib().FormGhost.generate(code), o = W(p, { testPhones: true });
      assert.deepEqual(plain((o.references || []).map((x) => x.phone)), plain((p.references || []).map((x) => x.phone)), code);
    }
  }
});

/* ---------------- Indian business IDs, Brazilian CPF / CNPJ ---------------- */
/* Key names aren't fixed: an ID is looked up by a path segment (persona.gstin, persona.ids.gstin, persona.business.gstin, etc). */
function leavesOf(o, pre = '', out = [], depth = 0) {
  if (o && typeof o === 'object' && depth < 5) for (const [k, v] of Object.entries(o)) {
    const p = pre ? `${pre}.${k}` : k;
    if (typeof v === 'string') out.push([p, v]); else leavesOf(v, p, out, depth + 1);
  }
  return out;
}
const idOf = (p, seg, val) => { const hit = leavesOf(p).find(([k, v]) => k.split('.').some((s) => seg.test(s)) && (!val || val.test(v))); return hit ? hit[1] : undefined; };
const ID_KEYS = {
  gstin: [/^gst(in)?(no|num|number)?$/i], tan: [/^tan(no|num|number)?$/i], cin: [/^cin(no|num|number)?$/i], udyam: [/^(udyam|udyog)/i],
  uan: [/^uan(no|num|number)?$/i], vehicle: [/vehicle|^(rc|reg|registration|vehicleReg)(no|num|number)?$/i, /^[A-Z]{2}[\s-]?\d/],
  cpf: [/^cpf$/i], cnpj: [/cnpj/i],
};
const ID = (p, k) => idOf(p, ...ID_KEYS[k]);
/* GST state codes, and the two-letter codes CIN / Udyam / vehicle numbers use (old and new spellings both accepted) */
const GST_STATE = { Delhi: '07', 'Uttar Pradesh': '09', Haryana: '06', Rajasthan: '08', Chandigarh: '04', Punjab: '03', Uttarakhand: '05', 'Madhya Pradesh': '23',
  Maharashtra: '27', Gujarat: '24', Goa: '30', Karnataka: '29', 'Tamil Nadu': '33', Telangana: '36', 'Andhra Pradesh': '37', Kerala: '32', 'West Bengal': '19',
  Bihar: '10', Jharkhand: '20', Odisha: '21', Assam: '18', 'Himachal Pradesh': '02', 'Jammu and Kashmir': '01', Chhattisgarh: '22', Puducherry: '34' };
const ST2 = { Delhi: ['DL'], 'Uttar Pradesh': ['UP'], Haryana: ['HR'], Rajasthan: ['RJ'], Chandigarh: ['CH'], Punjab: ['PB'], Uttarakhand: ['UK', 'UR', 'UA'], 'Madhya Pradesh': ['MP'],
  Maharashtra: ['MH'], Gujarat: ['GJ'], Goa: ['GA'], Karnataka: ['KA'], 'Tamil Nadu': ['TN'], Telangana: ['TG', 'TS'], 'Andhra Pradesh': ['AP'], Kerala: ['KL'], 'West Bengal': ['WB'],
  Bihar: ['BR'], Jharkhand: ['JH'], Odisha: ['OD', 'OR'], Assam: ['AS'], 'Himachal Pradesh': ['HP'], Chhattisgarh: ['CG', 'CT'] };
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/* GSTIN: state code + PAN + entity character + 'Z' + the mod-36 check character */
function gstinWrong(g) {
  if (typeof g !== 'string' || !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return `shape ${JSON.stringify(g)}`;
  let sum = 0;
  for (let i = 0; i < 14; i++) { const x = B36.indexOf(g[i]) * (i % 2 ? 2 : 1); sum += Math.floor(x / 36) + (x % 36); }
  return B36[(36 - (sum % 36)) % 36] === g[14] ? '' : `check character of ${g}`;
}
const cpfOk = (s) => {
  const d = String(s).replace(/\D/g, ''); if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n) => { let t = 0; for (let i = 0; i < n; i++) t += +d[i] * (n + 1 - i); const r = (t * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === +d[9] && dv(10) === +d[10];
};
const cnpjOk = (s) => {
  const d = String(s).replace(/\D/g, ''); if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const W = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const dv = (n) => { let t = 0; for (let i = 0; i < n; i++) t += +d[i] * W[i + 13 - n]; const r = t % 11; return r < 2 ? 0 : 11 - r; };
  return dv(12) === +d[12] && dv(13) === +d[13];
};
let brCache = null;
const BR = () => (brCache = brCache || Array.from({ length: 2000 }, () => lib().FormGhost.generate('BR')));

test('checksum helpers agree with published examples', () => {
  assert.equal(gstinWrong('27AAPFU0939F1ZV'), ''); assert.notEqual(gstinWrong('27AAPFU0939F1ZW'), ''); assert.equal(gstinWrong('29AAGCB7383J1Z4'), '');
  assert.ok(cpfOk('529.982.247-25') && !cpfOk('529.982.247-24') && !cpfOk('111.111.111-11'));
  assert.ok(cnpjOk('11.222.333/0001-81') && !cnpjOk('11.222.333/0001-82'));
});

test('2000 IN personas have a GSTIN with a valid mod-36 check character, their state\'s GST code and a PAN inside', () => {
  expectAll(IN(), (p) => {
    const g = ID(p, 'gstin'), why = gstinWrong(g);
    if (why) return `GSTIN ${why}`;
    if (GST_STATE[p.state] && g.slice(0, 2) !== GST_STATE[p.state]) return `GSTIN ${g} starts ${g.slice(0, 2)}, ${p.state} is ${GST_STATE[p.state]}`;
    return /^[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]$/.test(g.slice(2, 12)) ? '' : `GSTIN ${g}: ${g.slice(2, 12)} is not a PAN`;
  }, 'GSTINs wrong');
  assert.ok(new Set(IN().map((p) => ID(p, 'gstin'))).size > 1000, 'GSTINs vary between personas');
});

test('TAN is AAAA99999A, its first three letters the same for every persona of a city (the city code)', () => {
  const byCity = new Map();
  expectAll(IN(), (p) => {
    const t = ID(p, 'tan');
    if (typeof t !== 'string' || !/^[A-Z]{4}\d{5}[A-Z]$/.test(t)) return `TAN ${JSON.stringify(t)}`;
    byCity.set(p.city, (byCity.get(p.city) || new Set()).add(t.slice(0, 3)));
    return '';
  }, 'TANs wrong');
  const mixed = [...byCity].filter(([, s]) => s.size > 1).map(([c, s]) => `${c}: ${[...s].join('/')}`);
  assert.deepEqual(mixed, [], 'one TAN city code per city');
});

test('CIN is L/U + 5-digit industry + the state\'s code + a past year + ownership + 6 digits (listed ones are PLC)', () => {
  const year = TODAY.getFullYear();
  expectAll(IN(), (p) => {
    const c = ID(p, 'cin'), m = /^([LU])(\d{5})([A-Z]{2})(\d{4})(PLC|PTC|GOI|SGC|FTC|GAP|NPL|ULL|ULT|OPC|FLC|GAT)(\d{6})$/.exec(String(c));
    if (!m) return `CIN ${JSON.stringify(c)}`;
    if (ST2[p.state] && !ST2[p.state].includes(m[3])) return `CIN ${c}: state ${m[3]}, ${p.state} is ${ST2[p.state].join('/')}`;
    if (+m[4] > year || +m[4] < 1850) return `CIN ${c}: year ${m[4]}`;
    return m[1] === 'L' && m[5] !== 'PLC' ? `CIN ${c}: a listed company must be PLC` : '';
  }, 'CINs wrong');
});

test('Udyam is UDYAM-XX-00-0000000 with the state\'s code; UAN is 12 digits starting 10 / 11', () => {
  expectAll(IN(), (p) => {
    const u = ID(p, 'udyam'), m = /^UDYAM-([A-Z]{2})-(\d{2})-(\d{7})$/.exec(String(u));
    if (!m) return `Udyam ${JSON.stringify(u)}`;
    if (ST2[p.state] && !ST2[p.state].includes(m[1])) return `Udyam ${u}: ${m[1]}, ${p.state} is ${ST2[p.state].join('/')}`;
    const n = ID(p, 'uan');
    return typeof n === 'string' && /^1[01]\d{10}$/.test(n) ? '' : `UAN ${JSON.stringify(n)}`;
  }, 'Udyam / UAN wrong');
});

test('a vehicle registration number (state code + RTO + series + number, e.g. KA 03 MN 4821) from the persona\'s state', () => {
  expectAll(IN(), (p) => {
    const v = ID(p, 'vehicle'), m = /^([A-Z]{2})[ -]?(\d{1,2})([A-Z]?)[ -]?([A-Z]{1,3})[ -]?(\d{4})$/.exec(String(v));
    if (!m) return `vehicle ${JSON.stringify(v)}`;
    if (ST2[p.state] && !ST2[p.state].includes(m[1])) return `vehicle ${v}: ${m[1]}, ${p.state} is ${ST2[p.state].join('/')}`;
    return m[5] === '0000' || +m[2] === 0 ? `vehicle ${v}: RTO / number zero` : '';
  }, 'vehicle numbers wrong');
});

test('2000 BR personas have a CPF ###.###.###-## and a company CNPJ ##.###.###/####-##, both with valid check digits', () => {
  expectAll(BR(), (p) => {
    const c = ID(p, 'cpf'), j = ID(p, 'cnpj');
    if (typeof c !== 'string' || !/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(c)) return `CPF ${JSON.stringify(c)}`;
    if (!cpfOk(c)) return `CPF ${c} check digits`;
    if (typeof j !== 'string' || !/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(j)) return `CNPJ ${JSON.stringify(j)}`;
    return cnpjOk(j) ? '' : `CNPJ ${j} check digits`;
  }, 'CPF / CNPJ wrong');
  assert.ok(new Set(BR().map((p) => ID(p, 'cpf'))).size > 1500, 'CPFs vary between personas');
});

test('the new IDs are additive: every country still has its old ids, and other countries get no CPF / GSTIN', () => {
  expectAll(ALL(), (p) => {
    if (!p.ids || typeof p.ids !== 'object' || !Object.keys(p.ids).length) return `${p.country} ids ${JSON.stringify(p.ids)}`;
    if (p.country !== 'BR' && ID(p, 'cpf')) return `${p.country} has a CPF`;
    return p.country !== 'IN' && ID(p, 'gstin') ? `${p.country} has a GSTIN` : '';
  }, 'personas with misplaced ids');
});

/* ---------------- real IN pincodes / post offices / IFSC from lib/data-in.js ---------------- */
/* The data's shape isn't fixed: every pincode / IFSC in it is found with the strings next to it (its record) and, per level up the
   tree, the key it sits under plus that level's own strings, so "filed under <city>" can be read whatever the layout. */
const PIN_RE = /^[1-9]\d{5}$/, IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ALIAS = { Bengaluru: ['Bangalore'], Gurugram: ['Gurgaon'], Mumbai: ['Bombay'], Kolkata: ['Calcutta'], Chennai: ['Madras'], Mysuru: ['Mysore'], Mangaluru: ['Mangalore'],
  Thiruvananthapuram: ['Trivandrum'], Kochi: ['Cochin', 'Ernakulam'], Vadodara: ['Baroda'], Panaji: ['Panjim'], Visakhapatnam: ['Vizag'], 'New Delhi': ['Delhi'], Gaya: ['Gaya'] };
const BANK_OF = { SBIN: /state bank/i, HDFC: /hdfc/i, ICIC: /icici/i, UTIB: /axis/i, KKBK: /kotak/i, PUNB: /punjab national/i, BARB: /baroda/i, CNRB: /canara/i, UBIN: /union bank/i,
  IDIB: /^indian bank/i, BKID: /bank of india/i, IOBA: /indian overseas/i, YESB: /yes bank/i, INDB: /indusind/i, IDFB: /idfc/i, FDRL: /federal/i, MAHB: /maharashtra/i, CBIN: /central bank/i,
  UCBA: /uco/i, KARB: /karnataka bank/i, KVBL: /karur/i, SIBL: /south indian/i, RATN: /rbl/i };
/* the first digit of a pincode is its postal zone */
const PIN_ZONE = { Delhi: 1, Haryana: 1, Punjab: 1, Chandigarh: 1, 'Himachal Pradesh': 1, 'Uttar Pradesh': 2, Uttarakhand: 2, Rajasthan: 3, Gujarat: 3, Maharashtra: 4, 'Madhya Pradesh': 4,
  Goa: 4, Chhattisgarh: 4, Karnataka: 5, Telangana: 5, 'Andhra Pradesh': 5, 'Tamil Nadu': 6, Kerala: 6, 'West Bengal': 7, Odisha: 7, Assam: 7, Bihar: 8, Jharkhand: 8 };
const lc = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
const poCore = (s) => lc(s).replace(/[.()]/g, ' ').replace(/\b(s|b|h|g|sub|head|branch|post)\s*o(ffice)?\s*$/, '').replace(/\b(gpo|so|bo|ho)\s*$/, '').replace(/\s+/g, ' ').trim();
let dataIdx;
function inData() {
  if (dataIdx !== undefined) return dataIdx;
  const f = path.join(ROOT, 'lib/data-in.js');
  if (!existsSync(f)) return (dataIdx = null);
  const ctx = vm.createContext({ console }), before = new Set(Object.getOwnPropertyNames(ctx));
  vm.runInContext(readFileSync(f, 'utf8'), ctx, { filename: f });
  const roots = Object.getOwnPropertyNames(ctx).filter((k) => !before.has(k)).map((k) => [k, ctx[k]]).filter(([, v]) => v && typeof v === 'object');
  const hits = new Map(), src = readFileSync(f, 'utf8');
  const prims = (n) => Object.values(n).filter((v) => typeof v === 'string' || typeof v === 'number').map(String);
  const deepStr = (n, d = 0, out = []) => { if (n && typeof n === 'object' && d < 3) Object.values(n).forEach((v) => (typeof v === 'string' || typeof v === 'number' ? out.push(String(v)) : deepStr(v, d + 1, out))); return out; };
  const add = (code, rec, levels) => { if (!hits.has(code)) hits.set(code, []); hits.get(code).push({ rec, levels }); };
  const seen = new Set();
  const walk = (node, levels) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const own = prims(node);
    for (const [k, v] of Array.isArray(node) ? node.map((x, i) => [i, x]) : Object.entries(node)) {
      const key = typeof k === 'string' ? k : '';
      if (typeof v === 'string' || typeof v === 'number') {
        const s = String(v);
        if (PIN_RE.test(s) || IFSC_RE.test(s)) add(s, own, levels.concat([own]));
      }
      if (key && (PIN_RE.test(key) || IFSC_RE.test(key))) add(key, deepStr(v).concat(own), levels.concat([[key, ...own]]));
      if (v && typeof v === 'object') walk(v, levels.concat([[key, ...own]]));
    }
  };
  for (const [k, v] of roots) walk(v, [[k]]);
  return (dataIdx = { hits, src, roots: roots.map(([k]) => k) });
}
const CITY_NAMES = () => [...new Set(lib().FG_LOCALES.IN.clusters.flatMap((c) => c.cities.map((x) => x.n || x.name || x.city)).filter(Boolean))];
const namesOf = (city) => [city, ...(ALIAS[city] || [])].map(lc);
/* '' when one place the code is filed puts it under the persona's city: the nearest level naming a city of the locale, above the
   record itself (a record may name its district, which can be another city's name) */
function filedUnder(code, city) {
  const D = inData(), list = D.hits.get(code) || [], mine = namesOf(city), others = CITY_NAMES().filter((c) => c !== city).flatMap(namesOf);
  const why = [];
  for (const { levels } of list) {
    let verdict = '';
    for (let i = levels.length - 1; i >= 0; i--) {
      const labels = levels[i].map(lc);
      if (labels.some((l) => mine.includes(l))) { verdict = 'ok'; break; }
      const o = labels.find((l) => others.includes(l));
      if (o && i < levels.length - 1) { verdict = `filed under ${o}`; break; }
    }
    if (verdict === 'ok') return '';
    why.push(verdict || 'under no city');
  }
  return list.length ? `${code} ${why.join('; ')}` : `${code} is not in lib/data-in.js`;
}

test('lib/data-in.js holds real IN reference data: a source comment, 3-8 pincodes and 2+ IFSC codes per IN city', (t) => {
  const D = inData();
  if (!D) { t.skip('lib/data-in.js is missing (generated values are kept when the dataset could not be downloaded)'); return; }
  assert.match(D.src.slice(0, 600), /\/[*/][^\n]*(source|razorpay|india ?post|data\.gov\.in|ifsc|pincode)/i, 'a one-line source comment near the top');
  const bad = [];
  for (const city of CITY_NAMES()) {
    const pins = [...D.hits.keys()].filter((c) => PIN_RE.test(c) && !filedUnder(c, city)), ifsc = [...D.hits.keys()].filter((c) => IFSC_RE.test(c) && !filedUnder(c, city));
    if (pins.length < 3 || pins.length > 8) bad.push(`${city}: ${pins.length} pincodes`);
    if (ifsc.length < 2) bad.push(`${city}: ${ifsc.length} IFSC codes`);
  }
  assert.deepEqual(bad, [], `cities without enough curated data (roots ${D.roots.join(', ')})`);
});

test('2000 IN personas: the pincode is one of lib/data-in.js\'s for the persona\'s city, with that record\'s post office and district', (t) => {
  if (!inData()) { t.skip('lib/data-in.js is missing'); return; }
  expectAll(IN(), (p) => {
    if (PIN_ZONE[p.state] && +String(p.zip)[0] !== PIN_ZONE[p.state]) return `${p.city}, ${p.state}: pincode ${p.zip} is outside zone ${PIN_ZONE[p.state]}`;
    const why = filedUnder(String(p.zip), p.city);
    if (why) return `${p.city}: ${why}`;
    const recs = inData().hits.get(String(p.zip)).map((h) => h.rec.map(lc));
    if (!recs.some((r) => r.some((s) => poCore(s) && (poCore(s) === poCore(p.postOffice) || lc(p.postOffice).startsWith(poCore(s)))))) return `${p.city} ${p.zip}: post office ${JSON.stringify(p.postOffice)} is not the record's (${recs.map((r) => r.join(' | ')).join(' / ')})`;
    if (!recs.some((r) => r.includes(lc(p.district)))) return `${p.city} ${p.zip}: district ${JSON.stringify(p.district)} is not the record's (${recs.map((r) => r.join(' | ')).join(' / ')})`;
    return '';
  }, 'IN pincodes not from the curated data');
});

test('2000 IN personas: the IFSC is one of lib/data-in.js\'s for the persona\'s city and bank, with that branch', (t) => {
  if (!inData()) { t.skip('lib/data-in.js is missing'); return; }
  expectAll(IN(), (p) => {
    if (typeof p.ifsc !== 'string' || !IFSC_RE.test(p.ifsc)) return `IFSC ${JSON.stringify(p.ifsc)}`;
    const re = BANK_OF[p.ifsc.slice(0, 4)];
    if (re && !re.test(p.bankName)) return `IFSC ${p.ifsc} is not a ${p.bankName} code`;
    const why = filedUnder(p.ifsc, p.city);
    if (why) return `${p.city}: ${why}`;
    const recs = inData().hits.get(p.ifsc).map((h) => h.rec.map(lc)), br = lc(p.branch);
    return recs.some((r) => r.some((s) => s && s !== lc(p.ifsc) && s.length > 2 && (br.includes(s) || s.includes(br.split(',')[0])))) ? ''
      : `${p.ifsc}: branch ${JSON.stringify(p.branch)} is not the record's (${recs.map((r) => r.join(' | ')).join(' / ')})`;
  }, 'IN IFSC codes not from the curated data');
});

/* ---------------- lib/site.js ---------------- */
let SITE = null, siteErr = null;
try { SITE = load(['lib/site.js']).FG_SITE; if (!SITE) siteErr = new Error('lib/site.js did not define globalThis.FG_SITE'); } catch (e) { siteErr = e; }
const site = () => { if (siteErr) throw siteErr; return SITE; };

test('lib/site.js loads without chrome.* and exports siteKey / hostKey / matchEntry', () => {
  const S = site();
  for (const k of ['siteKey', 'hostKey', 'matchEntry']) assert.equal(typeof S[k], 'function', k);
});

const SITE_KEYS = [
  ['https://www.example.com/path?q=1', 'example.com'],
  ['https://example.com', 'example.com'],
  ['https://app.example.com/login', 'example.com'],
  ['https://a.b.example.com:8443/x', 'example.com'],
  ['https://WWW.Example.COM/', 'example.com'],
  ['https://docs.google.com/document/d/1/edit', 'google.com'],
  ['https://www.irctc.co.in/nget/train-search', 'irctc.co.in'],
  ['https://services.gst.gov.in/services/login', 'gst.gov.in'],
  ['https://portal.iitb.ac.in/', 'iitb.ac.in'],
  ['https://www.bbc.co.uk/news', 'bbc.co.uk'],
  ['https://login.example.com.au/', 'example.com.au'],
  ['https://my-app-git-feature-x-team.vercel.app/signup', 'my-app-git-feature-x-team.vercel.app'],
  ['https://my-app.vercel.app/', 'my-app.vercel.app'],
  ['https://deploy-preview-42--site.netlify.app/', 'deploy-preview-42--site.netlify.app'],
  ['https://octo.github.io/repo/', 'octo.github.io'],
  ['https://abc-123.up.railway.app/', 'abc-123.up.railway.app'],
  ['https://preview.my-site.pages.dev/', 'my-site.pages.dev'],
  ['https://1a2b-3c4d.ngrok-free.app/form', '1a2b-3c4d.ngrok-free.app'],
  ['http://localhost:3000/login', 'localhost:3000'],
  ['http://localhost:5173/', 'localhost:5173'],
  ['http://localhost/', 'localhost'],
  ['http://app.localhost:8080/', 'app.localhost:8080'],
  ['http://printer.local:631/', 'printer.local:631'],
  ['http://127.0.0.1:8000/admin', '127.0.0.1:8000'],
  ['http://192.168.1.10/', '192.168.1.10'],
  ['http://[::1]:3000/', '[::1]:3000'],
  ['file:///Users/me/form.html', 'file'],
  ['chrome://extensions/', ''],
  ['about:blank', ''],
  ['chrome-extension://abcdefghijklmnop/popup/popup.html', ''],
  ['', ''],
  ['not a url', ''],
];
for (const [url, want] of SITE_KEYS) test(`siteKey(${JSON.stringify(url)}) === ${JSON.stringify(want)}`, () => assert.equal(site().siteKey(url), want));

const HOST_KEYS = [
  ['https://www.example.com/a', 'example.com'],
  ['https://app.example.com:8443/x', 'app.example.com:8443'],
  ['https://docs.google.com/forms/d/x', 'docs.google.com'],
  ['https://example.com:443/', 'example.com'],
  ['https://www.irctc.co.in/', 'irctc.co.in'],
  ['http://localhost:3000/', 'localhost:3000'],
  ['http://127.0.0.1:5500/index.html', '127.0.0.1:5500'],
];
for (const [url, want] of HOST_KEYS) test(`hostKey(${JSON.stringify(url)}) === ${JSON.stringify(want)}`, () => assert.equal(site().hostKey(url), want));

/* 'host' (also 'host:port', 'host/path') matches only that exact host, www. ignored; '*.host' matches the host
   and every subdomain. A few rows note where a bare host used to also match its subdomains and no longer does. */
const MATCHES = [
  ['https://app.mycompany.com/dashboard', ['mycompany.com'], null], // exact-host match only; 'mycompany.com' alone would no longer match
  ['https://mycompany.com/', ['mycompany.com'], 'mycompany.com'],
  ['https://www.mycompany.com/', ['mycompany.com'], 'mycompany.com'],
  ['https://mycompany.com/', ['www.mycompany.com'], 'www.mycompany.com'],
  ['https://staging.mycompany.com/', ['www.mycompany.com'], null], // "Turn off here" on www must not block staging
  ['https://staging.mycompany.com/', ['mycompany.com'], null],
  ['https://App.MyCompany.com/', ['mycompany.com'], null], // exact-host match only; 'mycompany.com' alone would no longer match
  ['https://App.MyCompany.com/', ['app.mycompany.com'], 'app.mycompany.com'],
  ['https://notmycompany.com/', ['mycompany.com'], null],
  ['https://mycompany.com.evil.io/', ['mycompany.com'], null],
  ['https://staging.mycompany.com/', ['app.mycompany.com'], null],
  ['https://app.mycompany.com/', [], null],
  ['https://a.example.com/', ['b.example.com', 'example.com'], null], // exact-host match only; 'example.com' alone would no longer match
  ['https://a.example.com/', ['b.example.com', '*.example.com'], '*.example.com'],
  ['https://staging.mycompany.com/', ['*.mycompany.com'], '*.mycompany.com'],
  ['https://a.b.mycompany.com/', ['*.mycompany.com'], '*.mycompany.com'],
  ['https://mycompany.com/', ['*.mycompany.com'], '*.mycompany.com'],
  ['https://www.mycompany.com/', ['*.mycompany.com'], '*.mycompany.com'],
  ['https://notmycompany.com/', ['*.mycompany.com'], null],
  ['https://mycompany.com.evil.io/', ['*.mycompany.com'], null],
  ['https://app.mycompany.com/x', ['https://app.mycompany.com'], 'https://app.mycompany.com'],
  ['http://localhost:3000/x', ['localhost:3000'], 'localhost:3000'],
  ['http://localhost:5173/', ['localhost:3000'], null],
  ['http://localhost:5173/', ['localhost'], 'localhost'],
  ['http://app.localhost:8080/', ['localhost'], null],
  ['https://app.mycompany.com:8443/', ['app.mycompany.com'], 'app.mycompany.com'],
  ['https://app.mycompany.com:8443/', ['app.mycompany.com:9000'], null],
  ['https://app.mycompany.com:8443/', ['app.mycompany.com:8443'], 'app.mycompany.com:8443'],
  ['https://app.mycompany.com:8443/', ['mycompany.com:8443'], null],
  ['https://docs.google.com/document/d/1/edit', ['docs.google.com/forms'], null],
  ['https://docs.google.com/forms/d/e/abc/viewform', ['docs.google.com/forms'], 'docs.google.com/forms'],
  ['https://docs.google.com/document/d/1/edit', ['docs.google.com/document', 'google.com'], 'docs.google.com/document'],
  ['https://mail.google.com/', ['docs.google.com/document', 'google.com'], null], // exact-host match only; 'google.com' alone would no longer match
  ['https://mail.google.com/', ['docs.google.com/document', '*.google.com'], '*.google.com'],
  ['https://mail.google.com/forms/x', ['google.com/forms'], null],
  ['http://localhost:3000/admin/users', ['localhost:3000/admin'], 'localhost:3000/admin'],
  ['http://localhost:3000/login', ['localhost:3000/admin'], null],
  ['http://localhost:4000/admin', ['localhost:3000/admin'], null],
];
for (const [url, entries, want] of MATCHES) {
  test(`matchEntry(${JSON.stringify(url)}, ${JSON.stringify(entries)}) === ${JSON.stringify(want)}`, () => assert.equal(site().matchEntry(url, entries), want));
}

/* ---------------- background.js (stubbed chrome.*) ---------------- */
/* Loads the real service worker into a vm. exec(opts) stands in for chrome.scripting.executeScript;
   timers asked for 10 s (the injection timeout) run in 50 ms so a stuck page can be tested quickly. */
const COMMANDS = [{ name: 'fill-page', shortcut: '⌥⇧F' }, { name: 'fill-form', shortcut: '' }, { name: 'fill-field', shortcut: '' }, { name: 'undo-fill', shortcut: '' }];
function loadBg({ tabs = {}, exec, commands = COMMANDS } = {}) {
  const mem = { sync: {}, local: {}, session: {} }, badges = [], calls = [], on = {}, menus = [];
  const area = (k) => ({
    get: async (key) => (key == null ? structuredClone(mem[k])
      : typeof key === 'object' && !Array.isArray(key) ? Object.fromEntries(Object.entries(key).map(([x, d]) => [x, x in mem[k] ? structuredClone(mem[k][x]) : d]))
        : Object.fromEntries([].concat(key).filter((x) => x in mem[k]).map((x) => [x, structuredClone(mem[k][x])]))),
    set: async (o) => { for (const [a, b] of Object.entries(o)) mem[k][a] = structuredClone(b); },
    remove: async (key) => { for (const x of [].concat(key)) delete mem[k][x]; },
  });
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const ev = () => ({ addListener: () => {}, removeListener: () => {} });
  const chrome = {
    storage: { sync: area('sync'), local: area('local'), session: area('session'), onChanged: ev() },
    tabs: { get: async (id) => { if (!(id in tabs)) throw new Error(`No tab with id: ${id}.`); return { id, url: tabs[id] }; }, query: async () => [], create: async (o) => o, onRemoved: ev(), onUpdated: ev(), onActivated: ev() },
    scripting: { executeScript: async (o) => { calls.push(o); return exec ? exec(o) : o.files ? [{}] : [{ result: 3 }]; } },
    commands: { getAll: async () => structuredClone(commands), onCommand: { addListener: (f) => (on.command = f) } },
    runtime: { getManifest: () => manifest, onMessage: { addListener: (f) => (on.msg = f) }, onInstalled: { addListener: (f) => (on.installed = f) }, onStartup: ev() },
    action: { setBadgeText: async (o) => badges.push(['text', o.tabId, o.text]), setBadgeBackgroundColor: async () => {}, setBadgeTextColor: async () => {}, setTitle: async (o) => badges.push(['title', o.tabId, o.title]) },
    contextMenus: {
      removeAll: (cb) => { menus.length = 0; if (cb) cb(); return Promise.resolve(); },
      create: (o, cb) => { menus.push(o); if (cb) cb(); return o.id; },
      onClicked: { addListener: (f) => (on.menu = f) },
    },
  };
  const ctx = vm.createContext({
    chrome, console, URL, AbortController, structuredClone, navigator: { language: 'en-IN' }, clearTimeout,
    TextEncoder, TextDecoder, Blob, crypto: globalThis.crypto, btoa, atob, // a service worker has these too
    setTimeout: (f, ms, ...a) => setTimeout(f, ms === 10000 ? 50 : ms, ...a),
    fetch: async () => ({ ok: true, json: async () => ({ success: true, country_code: 'IN', country: 'India', region: 'Karnataka', city: 'Bengaluru' }) }),
  });
  ctx.self = ctx;
  ctx.importScripts = (...files) => files.forEach((f) => vm.runInContext(readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  vm.runInContext(readFileSync(path.join(ROOT, 'background.js'), 'utf8'), ctx, { filename: 'background.js' });
  const send = (msg, ms = 2000) => new Promise((res) => {
    const t = setTimeout(() => res({ timedOut: true }), ms);
    on.msg(msg, {}, (r) => { clearTimeout(t); res(JSON.parse(JSON.stringify(r))); });
  });
  return { mem, badges, calls, on, send, menus };
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const TABS = { 1: 'https://shop.example.com/signup', 2: 'https://app.mycompany.com/onboarding', 3: 'view-source:https://example.com/', 4: 'https://www.example.com/checkout' };

test('background: a fill on a view-source: tab returns a friendly error and injects nothing', async () => {
  const B = loadBg({ tabs: TABS });
  const r = await B.send({ type: 'fill', tabId: 3 });
  assert.deepEqual([r.ok, r.error], [false, 'Chrome doesn’t let extensions run on this page.']);
  assert.equal(B.calls.length, 0);
});

test('background: a page that never answers does not lock other tabs; the fill ends with a friendly timeout', async () => {
  const B = loadBg({ tabs: TABS, exec: (o) => (o.target.tabId === 1 ? new Promise(() => {}) : o.files ? [{}] : [{ result: 2 }]) });
  const stuck = B.send({ type: 'fill', tabId: 1 });
  await tick(5);
  const st = await B.send({ type: 'state', tabId: 2 }, 500);
  assert.ok(st.persona, 'state for another tab answered while the fill is stuck');
  const other = await B.send({ type: 'fill', tabId: 2 }, 500);
  assert.equal(other.count, 2, 'a fill on another site goes ahead');
  const r = await stuck;
  assert.equal(r.ok, false);
  assert.match(r.error, /didn’t respond/);
  assert.ok(B.calls.every((c) => c.injectImmediately === true), 'injectImmediately: true, so a page still loading is not waited on');
});

test('background: hotkey on an error page shows "!" with a friendly title', async () => {
  const B = loadBg({ tabs: TABS, exec: async () => { throw new Error('Frame with ID 0 is showing error page'); } });
  B.on.command('fill-page', { id: 4 });
  await tick(50);
  assert.deepEqual(B.badges.filter((b) => b[1] === 4), [['text', 4, '!'], ['title', 4, 'This page didn’t load. Reload it, then try again.']]);
});

test('background: two sites filled at once get different identities; one site filled twice at once keeps one', async () => {
  const B = loadBg({ tabs: { ...TABS, 5: 'https://shop.example.com/step-2' } });
  const [a, b] = await Promise.all([B.send({ type: 'fill', tabId: 1 }), B.send({ type: 'fill', tabId: 2 })]);
  assert.notEqual(a.persona.email, b.persona.email);
  const [c, d] = await Promise.all([B.send({ type: 'fill', tabId: 4 }), B.send({ type: 'fill', tabId: 5 })]);
  assert.equal(c.persona.email, a.persona.email, 'example.com keeps its identity');
  assert.equal(d.persona.email, a.persona.email);
  assert.deepEqual([c.session.steps, d.session.steps].sort(), [2, 3]);
});

test('background: a fill that fills nothing keeps the next identity for the next site', async () => {
  const B = loadBg({ tabs: TABS, exec: (o) => (o.files ? [{}] : [{ result: 0 }]) });
  const before = (await B.send({ type: 'state', tabId: 1 })).persona;
  const r = await B.send({ type: 'fill', tabId: 1 });
  assert.deepEqual([r.ok, r.count, r.session], [true, 0, null]);
  assert.equal((await B.send({ type: 'state', tabId: 2 })).persona.email, before.email);
});

/* ---------------- background messages: fill, undo, menus, hotkeys, history ---------------- */
/* A filler call gets [persona, settings]; an undo call runs a func that calls __formGhost.undo(). */
const fillCall = (c) => !!(c.func && Array.isArray(c.args) && c.args[0] && typeof c.args[0] === 'object' && 'email' in c.args[0]);
const undoCall = (c) => !!c.func && !fillCall(c) && /undo/.test(String(c.func));
const frames = (results) => [].concat(results).map((result) => ({ result }));
const execWith = ({ fill = 3, undo = [2, 1] } = {}) => (o) => (o.files ? [{}] : undoCall(o) ? frames(undo) : frames(fill));
const INBOX = /^you\+[a-z0-9.]{1,20}@gmail\.com$/;
const MC = { 1: 'https://www.mycompany.com/x', 2: 'https://staging.mycompany.com/', 3: 'https://mycompany.com/a' };

test('"Turn off here" adds the exact host; other subdomains stay on', async () => {
  const B = loadBg({ tabs: MC });
  const r = await B.send({ type: 'blockSite', tabId: 1, block: true });
  assert.deepEqual(r.settings.blocked, ['mycompany.com']);
  assert.deepEqual([r.blocked, r.blockEntry], [true, 'mycompany.com']);
  assert.equal((await B.send({ type: 'state', tabId: 2 })).blocked, false, 'staging.mycompany.com is not blocked by www.mycompany.com');
  assert.equal((await B.send({ type: 'state', tabId: 3 })).blocked, true, 'mycompany.com is the same host as www.mycompany.com');
});

test('"Turn on" removes only entries matching this exact URL (a *. entry only on its apex)', async () => {
  const B = loadBg({ tabs: MC });
  B.mem.sync.settings = { blocked: ['mycompany.com', '*.mycompany.com', 'staging.mycompany.com', 'staging.mycompany.com:8443', 'example.com'] };
  let r = await B.send({ type: 'blockSite', tabId: 2, block: false });
  assert.deepEqual(r.settings.blocked, ['mycompany.com', '*.mycompany.com', 'staging.mycompany.com:8443', 'example.com'], 'on staging: only the staging entry goes');
  r = await B.send({ type: 'blockSite', tabId: 3, block: false });
  assert.deepEqual(r.settings.blocked, ['staging.mycompany.com:8443', 'example.com'], 'on the apex: the exact entry and *.mycompany.com go');
  assert.equal(r.blocked, false);
});

test('settings default emailDomain "", emailInbox "", testPhones false', async () => {
  const st = await loadBg({ tabs: TABS }).send({ type: 'state', tabId: 1 });
  assert.deepEqual([st.settings.emailDomain, st.settings.emailInbox, st.settings.testPhones], ['', '', false]);
});

test('popup and filler get the persona after withPrefs; stored identities stay raw', async () => {
  const B = loadBg({ tabs: TABS, exec: execWith() });
  await B.send({ type: 'setSettings', tabId: 1, patch: { emailInbox: 'you@gmail.com' } });
  const st = await B.send({ type: 'state', tabId: 1 });
  assert.match(st.persona.email, INBOX);
  assert.match(st.persona.altEmail, /^you\+[a-z0-9.]{1,20}\.alt@gmail\.com$/);
  const r = await B.send({ type: 'fill', tabId: 1 });
  assert.match(r.persona.email, INBOX);
  const c = B.calls.find(fillCall);
  assert.ok(c, 'the filler was called');
  assert.match(c.args[0].email, INBOX, 'the filler gets the withPrefs persona');
  assert.ok(!JSON.stringify([B.mem.local.persona, B.mem.local.sessions, B.mem.local.history]).includes('you+'), 'storage keeps raw personas');
});

test('a page fill reports scope "page"', async () => {
  const B = loadBg({ tabs: TABS, exec: execWith() });
  const r = await B.send({ type: 'fill', tabId: 1 });
  assert.deepEqual([r.ok, r.count, r.scope], [true, 3, 'page']);
  assert.equal(B.calls.find(fillCall).args[1].scope || 'page', 'page');
});

test('popup form / field fills go to every frame with o.scope (no frameTargeted); 0 filled is ok', async () => {
  for (const scope of ['form', 'field']) {
    const B = loadBg({ tabs: TABS, exec: execWith({ fill: [0, 0] }) });
    const r = await B.send({ type: 'fill', tabId: 1, scope });
    assert.deepEqual([r.ok, r.count, r.scope], [true, 0, scope]);
    const c = B.calls.find(fillCall);
    assert.ok(c, `${scope}: the filler was called`);
    assert.equal(c.target.allFrames, true, `${scope}: all frames`);
    assert.equal(c.args[1].scope, scope);
    assert.ok(!c.args[1].frameTargeted, `${scope}: each frame decides by its own focus`);
  }
});

test('a blocked site refuses every scope from the popup unless forced', async () => {
  const B = loadBg({ tabs: TABS, exec: execWith() });
  B.mem.sync.settings = { blocked: ['shop.example.com'] };
  for (const scope of ['page', 'form', 'field']) {
    const r = await B.send({ type: 'fill', tabId: 1, scope });
    assert.deepEqual([r.ok, r.blocked], [false, true], scope);
  }
  assert.equal(B.calls.filter(fillCall).length, 0, 'nothing injected');
  assert.equal((await B.send({ type: 'fill', tabId: 1, scope: 'field', force: true })).ok, true, 'force fills anyway');
});

test('context menu has Fill this page / form / field and Undo last fill with their contexts', async () => {
  const B = loadBg({ tabs: TABS });
  assert.equal(typeof B.on.installed, 'function', 'onInstalled listener');
  B.on.installed({ reason: 'install' });
  await tick(30);
  const by = Object.fromEntries(B.menus.map((m) => [m.id, m]));
  const want = { 'fg-fill': [/^Fill this page/, ['editable', 'frame', 'page']], 'fg-fill-form': [/^Fill this form/, ['editable']], 'fg-fill-field': [/^Fill this field/, ['editable']], 'fg-undo': [/^Undo last fill/, ['editable', 'frame', 'page']] };
  for (const [id, [title, contexts]] of Object.entries(want)) {
    assert.ok(by[id], `${id} missing (have ${Object.keys(by)})`);
    assert.match(by[id].title, title, id);
    assert.deepEqual([...(by[id].contexts || [])].sort(), contexts, `${id} contexts`);
  }
});

test('menu Fill this form / field inject only into the clicked frame, frame-targeted', async () => {
  for (const [id, scope] of [['fg-fill-form', 'form'], ['fg-fill-field', 'field']]) {
    const B = loadBg({ tabs: TABS, exec: execWith() });
    B.on.menu({ menuItemId: id, frameId: 7, editable: true, pageUrl: TABS[1] }, { id: 1, url: TABS[1] });
    await tick(60);
    const c = B.calls.find(fillCall);
    assert.ok(c, `${id}: the filler was called`);
    assert.deepEqual([...(c.target.frameIds || [])], [7], `${id}: only frame 7`);
    assert.ok(!c.target.allFrames, `${id}: not all frames`);
    assert.deepEqual([c.args[1].scope, c.args[1].frameTargeted], [scope, true], id);
  }
});

test('hotkeys fill-form / fill-field go to every frame with that scope', async () => {
  for (const [cmd, scope] of [['fill-form', 'form'], ['fill-field', 'field']]) {
    const B = loadBg({ tabs: TABS, exec: execWith() });
    B.on.command(cmd, { id: 1, url: TABS[1] });
    await tick(60);
    const c = B.calls.find(fillCall);
    assert.ok(c, `${cmd}: the filler was called`);
    assert.equal(c.target.allFrames, true, cmd);
    assert.equal(c.args[1].scope, scope, cmd);
    assert.ok(!c.args[1].frameTargeted, cmd);
  }
});

test('menu and hotkey scoped fills respect the blocklist', async () => {
  const B = loadBg({ tabs: TABS, exec: execWith() });
  B.mem.sync.settings = { blocked: ['shop.example.com'] };
  B.on.menu({ menuItemId: 'fg-fill-field', frameId: 3, editable: true }, { id: 1, url: TABS[1] });
  B.on.command('fill-form', { id: 1, url: TABS[1] });
  await tick(80);
  assert.equal(B.calls.filter(fillCall).length, 0, 'blocked: nothing injected');
  B.on.menu({ menuItemId: 'fg-fill-field', frameId: 3, editable: true }, { id: 2, url: TABS[2] });
  B.on.command('fill-form', { id: 2, url: TABS[2] });
  await tick(80);
  assert.equal(B.calls.filter(fillCall).length, 2, 'the same menu item and hotkey fill a site that is not blocked');
});

test('undo runs in every frame, sums the counts and never touches identities', async () => {
  const B = loadBg({ tabs: TABS, exec: execWith({ undo: [2, 1, undefined] }) });
  await B.send({ type: 'fill', tabId: 1 });
  const keep = () => JSON.stringify([B.mem.local.sessions, B.mem.local.persona, B.mem.local.history]);
  const before = keep();
  const r = await B.send({ type: 'undo', tabId: 1 });
  assert.deepEqual([r.ok, r.count], [true, 3]);
  const c = B.calls.filter(undoCall).at(-1);
  assert.ok(c, 'an undo script ran');
  assert.deepEqual([c.target.tabId, c.target.allFrames], [1, true]);
  assert.equal(keep(), before, 'sessions / persona / history unchanged');
});

test('hotkey undo-fill and menu Undo last fill show ↺N, or 0 when nothing was undone', async () => {
  const A = loadBg({ tabs: TABS, exec: execWith({ undo: [2, 1] }) });
  A.on.command('undo-fill', { id: 1, url: TABS[1] });
  await tick(60);
  assert.ok(A.badges.some((b) => b[0] === 'text' && b[1] === 1 && b[2] === '↺3'), JSON.stringify(A.badges));
  const B = loadBg({ tabs: TABS, exec: execWith({ undo: [0] }) });
  B.on.menu({ menuItemId: 'fg-undo', frameId: 0 }, { id: 2, url: TABS[2] });
  await tick(60);
  assert.ok(B.badges.some((b) => b[0] === 'text' && b[1] === 2 && b[2] === '0'), JSON.stringify(B.badges));
});

test('fills record history: unique per identity, newest first, at most 15, stored raw', async () => {
  const tabs = {};
  for (let i = 1; i <= 17; i++) tabs[i] = `https://www.site${i}.com/signup`;
  const B = loadBg({ tabs, exec: execWith() });
  const ids = [];
  for (let i = 1; i <= 17; i++) { ids.push((await B.send({ type: 'fill', tabId: i })).persona.id); await tick(2); }
  assert.equal(new Set(ids).size, 17, 'each site got its own identity');
  let st = await B.send({ type: 'state', tabId: 1 });
  assert.deepEqual(st.history.map((h) => h.id), ids.slice(2).reverse(), 'the 15 newest, newest first');
  assert.deepEqual(st.history.map((h) => h.site), ids.slice(2).map((_, k) => `site${17 - k}.com`));
  for (const h of st.history) assert.ok(typeof h.fullName === 'string' && h.fullName && typeof h.email === 'string' && h.email && typeof h.ts === 'number', JSON.stringify(h));
  await B.send({ type: 'fill', tabId: 5 }); // the same site again: same identity, moved to the front, not duplicated
  st = await B.send({ type: 'state', tabId: 1 });
  assert.equal(st.history.length, 15);
  assert.equal(st.history[0].id, ids[4]);
  assert.equal(st.history.filter((h) => h.id === ids[4]).length, 1);
  const stored = B.mem.local.history;
  assert.ok(Array.isArray(stored) && stored.length === 15 && stored.every((h) => h.persona && h.persona.id && h.site && h.ts), 'storage.local history = [{persona, site, ts}]');
});

test('history emails are shown after withPrefs but stored raw', async () => {
  const B = loadBg({ tabs: TABS, exec: execWith() });
  await B.send({ type: 'fill', tabId: 1 });
  await B.send({ type: 'fill', tabId: 2 });
  const st = await B.send({ type: 'setSettings', tabId: 1, patch: { emailDomain: 'example.com' } });
  assert.equal(st.history.length, 2);
  assert.ok(st.history.every((h) => /@example\.com$/.test(h.email)), JSON.stringify(st.history.map((h) => h.email)));
  assert.ok(B.mem.local.history.every((h) => !/@example\.com$/.test(h.persona.email)), 'stored raw');
});

test('usePersona binds a recent identity to this tab\'s site as a fresh session', async () => {
  const B = loadBg({ tabs: TABS, exec: execWith() });
  const a = (await B.send({ type: 'fill', tabId: 1 })).persona, b = (await B.send({ type: 'fill', tabId: 2 })).persona;
  assert.notEqual(a.id, b.id);
  const r = await B.send({ type: 'usePersona', id: a.id, tabId: 2 });
  assert.equal(r.persona.id, a.id, 'the response is the state with that identity');
  assert.deepEqual(r.session, { host: 'mycompany.com', steps: 0 });
  assert.equal((await B.send({ type: 'state', tabId: 2 })).persona.id, a.id);
  const f = await B.send({ type: 'fill', tabId: 2 });
  assert.deepEqual([f.persona.id, f.session.steps], [a.id, 1]);
});

test('usePersona on a tab without a site makes it the next identity', async () => {
  const B = loadBg({ tabs: { ...TABS, 9: 'chrome://extensions/', 10: 'https://new-site.org/join' }, exec: execWith() });
  const a = (await B.send({ type: 'fill', tabId: 1 })).persona;
  const r = await B.send({ type: 'usePersona', id: a.id, tabId: 9 });
  assert.equal(r.persona.id, a.id);
  assert.equal((await B.send({ type: 'state', tabId: 10 })).persona.id, a.id, 'a new site now gets it');
});

test('usePersona without a site keeps a recent identity from another country as the next one', async () => {
  const B = loadBg({ tabs: { ...TABS, 9: 'chrome://extensions/', 10: 'https://new-site.org/join' }, exec: execWith() });
  const a = (await B.send({ type: 'fill', tabId: 1 })).persona;
  await B.send({ type: 'setSettings', tabId: 1, patch: { country: a.country === 'US' ? 'GB' : 'US' } });
  const r = await B.send({ type: 'usePersona', id: a.id, tabId: 9 });
  assert.equal(r.persona.id, a.id, 'the response shows the identity picked, not a fresh one');
  const f = await B.send({ type: 'fill', tabId: 10 });
  assert.equal(f.persona.id, a.id, 'the next site fills with it');
  assert.notEqual((await B.send({ type: 'state', tabId: 9 })).persona.id, a.id, 'after that the next identity is a fresh one again');
  // the site keeps the picked identity on later steps although it is from another country
  const st = await B.send({ type: 'state', tabId: 10 });
  assert.deepEqual([st.persona.id, st.session && st.session.steps], [a.id, 1], 'state for that site still shows the picked identity');
  const f2 = await B.send({ type: 'fill', tabId: 10 });
  assert.deepEqual([f2.persona.id, f2.session.steps], [a.id, 2], 'step 2 fills with the same identity');
});

test('shuffle and a country change keep the history', async () => {
  const B = loadBg({ tabs: TABS, exec: execWith() });
  const a = (await B.send({ type: 'fill', tabId: 1 })).persona;
  await B.send({ type: 'shuffle', tabId: 1 });
  const st = await B.send({ type: 'setSettings', tabId: 1, patch: { country: 'US' } });
  assert.ok(st.history.some((h) => h.id === a.id), JSON.stringify(st.history));
});

test('state.shortcuts lists the four commands ("" when unassigned) and keeps state.shortcut', async () => {
  const B = loadBg({ tabs: TABS, commands: [{ name: '_execute_action', shortcut: '' }, { name: 'fill-page', shortcut: '⌥⇧F' }, { name: 'fill-form', shortcut: '⌥⇧G' }, { name: 'fill-field' }, { name: 'undo-fill', shortcut: '⌥⇧Z' }] });
  const st = await B.send({ type: 'state', tabId: 1 });
  assert.deepEqual(st.shortcuts, { fillPage: '⌥⇧F', fillForm: '⌥⇧G', fillField: '', undo: '⌥⇧Z' });
  assert.equal(st.shortcut, '⌥⇧F');
});

test('the state response carries every documented key', async () => {
  const st = await loadBg({ tabs: TABS }).send({ type: 'state', tabId: 1 });
  for (const k of ['settings', 'geo', 'persona', 'session', 'site', 'host', 'blocked', 'blockEntry', 'shortcut', 'shortcuts', 'version', 'effective', 'countries', 'history']) assert.ok(k in st, `state.${k} missing`);
  assert.equal(st.version, '2.0.0');
  assert.ok(Array.isArray(st.history));
  for (const k of ['id', 'altPhone', 'altEmail', 'spouseName', 'emergency', 'nominee', 'bloodGroup', 'maritalStatus', 'noticePeriod']) assert.ok(k in st.persona, `state.persona.${k} missing`);
});

/* each fill carries an id; undo hands the tab's last one to every frame, so frames the last fill didn't change keep their values */
const fillIdOf = (c) => c.args[1].fillId;
test('undo passes the id of the tab\'s last fill that changed something, then forgets it', async () => {
  let fill = 2;
  const B = loadBg({ tabs: TABS, exec: (o) => (o.files ? [{}] : undoCall(o) ? frames([1, 0]) : fillCall(o) ? frames(fill) : frames(null)) });
  await B.send({ type: 'fill', tabId: 1 });
  const first = fillIdOf(B.calls.filter(fillCall).at(-1));
  assert.ok(typeof first === 'string' && first, 'the filler gets o.fillId');
  fill = 0;
  await B.send({ type: 'fill', tabId: 1, scope: 'field' }); // nothing changed: the first fill stays the one to undo
  assert.notEqual(fillIdOf(B.calls.filter(fillCall).at(-1)), first, 'every fill has its own id');
  const r = await B.send({ type: 'undo', tabId: 1 });
  assert.deepEqual([r.ok, r.count], [true, 1]);
  const u = B.calls.filter(undoCall);
  assert.deepEqual([...u.at(-1).args], [first], 'undo asks the frames for the first fill');
  await B.send({ type: 'undo', tabId: 1 });
  assert.deepEqual([...B.calls.filter(undoCall).at(-1).args], [null], 'after an undo no fill is pending');
  assert.equal(B.mem.session['lastFill:1'], undefined);
  fill = 3;
  await B.send({ type: 'fill', tabId: 2 });
  assert.equal(B.mem.session['lastFill:2'], fillIdOf(B.calls.filter(fillCall).at(-1)), 'kept in storage.session while the worker sleeps');
});

/* a modal open in the top frame covers the frames behind it */
function modalExec({ modal = null, where = [], fill = 2 } = {}) {
  return (o) => {
    if (o.files) return [{}];
    if (fillCall(o)) return (o.target.frameIds || [0, 1, 2, 3]).map((frameId) => ({ frameId, result: fill }));
    const src = String(o.func);
    if (/\.modal\b/.test(src)) return [{ frameId: 0, result: modal }];
    if (/\.where\b/.test(src)) return where.map(([frameId, path, real]) => ({ frameId, result: { path, real } }));
    return frames(0);
  };
}
test('a page fill with a modal in the top frame fills only frame 0 and the frames inside the dialog', async () => {
  const fillTarget = async (opts) => {
    const B = loadBg({ tabs: TABS, exec: modalExec(opts) }), r = await B.send({ type: 'fill', tabId: 1 }), t = B.calls.filter(fillCall).at(-1).target;
    return [r, { allFrames: t.allFrames, frameIds: t.frameIds && [...t.frameIds] }];
  };
  let [r, t] = await fillTarget();
  assert.equal(t.allFrames, true, 'no modal: every frame');
  [r, t] = await fillTarget({ modal: { own: true, frames: [] } });
  assert.deepEqual([t.allFrames, t.frameIds], [undefined, [0]], 'a dialog with its own form: only the top frame');
  assert.equal(r.count, 2);
  [r, t] = await fillTarget({ modal: { own: false, frames: [1] }, where: [[0, [], false], [4, [0], true], [7, [1], true], [9, [1, 0], false]] });
  assert.deepEqual(t.frameIds, [7, 9], 'a sign-in form in a frame inside the dialog: that frame (and its own frames), not the page behind');
  [r, t] = await fillTarget({ modal: { own: true, frames: [1] }, where: [[4, [0], true], [7, [1], false]] });
  assert.deepEqual(t.frameIds, [0, 7], 'the dialog\'s controls and its frame');
  [r, t] = await fillTarget({ modal: { own: false, frames: [1] }, where: [[4, [0], true], [7, [1], false]] });
  assert.equal(t.allFrames, true, 'a dialog whose only frame has nothing to fill (cookie consent) changes nothing');
  const B = loadBg({ tabs: TABS, exec: modalExec({ modal: { own: true, frames: [] } }) });
  await B.send({ type: 'fill', tabId: 1, scope: 'form' });
  assert.ok(!B.calls.some((c) => /\.modal\b/.test(String(c.func))), 'form / field fills don\'t look for a modal (each frame checks its own focus)');
});

/* the version is 2.0.0; commands and permissions are unchanged */
test('manifest 2.0.0, new commands without default keys, no new permissions', () => {
  const m = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(m.version, '2.0.0');
  assert.equal(m.commands['fill-page'].suggested_key.default, 'Alt+Shift+F');
  for (const c of ['fill-form', 'fill-field', 'undo-fill']) {
    assert.ok(m.commands[c] && m.commands[c].description, `${c} with a description`);
    assert.ok(!('suggested_key' in m.commands[c]), `${c} has no suggested_key`);
  }
  assert.deepEqual([...m.permissions].sort(), ['activeTab', 'contextMenus', 'scripting', 'storage']);
  assert.deepEqual([...m.host_permissions].sort(), ['https://api.country.is/*', 'https://get.geojs.io/*', 'https://ipapi.co/*', 'https://ipwho.is/*']);
});

/* ---------------- background messages: multi-frame fills, passwords, required-only ---------------- */
const fillWith = (fill) => (o) => (o.files ? [{}] : fillCall(o) ? frames(typeof fill === 'function' ? fill(o) : fill) : frames(0));

test('frame results may be numbers or { count, used }; the counts are summed', async () => {
  const B = loadBg({ tabs: TABS, exec: fillWith([{ count: 2, used: {} }, 1, { count: 0, used: {} }, null, undefined]) });
  const r = await B.send({ type: 'fill', tabId: 1 });
  assert.deepEqual([r.ok, r.count], [true, 3]);
  assert.equal(r.session && r.session.steps, 1, 'the site keeps the identity');
  const u = loadBg({ tabs: TABS, exec: fillWith([{ count: 4 }]) });
  assert.equal((await u.send({ type: 'fill', tabId: 1 })).count, 4, '{ count } without used');
});

test('a { count: 0 } result fills nothing, like 0: no session, the next identity stays next', async () => {
  const B = loadBg({ tabs: TABS, exec: fillWith([{ count: 0, used: {} }]) });
  const before = (await B.send({ type: 'state', tabId: 1 })).persona;
  const r = await B.send({ type: 'fill', tabId: 1 });
  assert.deepEqual([r.ok, r.count, r.session], [true, 0, null]);
  assert.equal((await B.send({ type: 'state', tabId: 2 })).persona.email, before.email);
});

test('a password the filler adapted is kept on the site\'s session; state() returns it as session.usedPassword', async () => {
  const B = loadBg({ tabs: TABS, exec: fillWith([{ count: 2, used: { password: 'Kq7#tiny' } }, { count: 1, used: {} }]) });
  const r = await B.send({ type: 'fill', tabId: 1 });
  assert.deepEqual([r.ok, r.count], [true, 3]);
  const st = await B.send({ type: 'state', tabId: 4 }); // www.example.com/checkout: the same site as shop.example.com
  assert.ok(st.session, 'the site has a session');
  assert.equal(st.session.usedPassword, 'Kq7#tiny');
  assert.equal(st.session.host, 'example.com');
  assert.notEqual(st.persona.password, 'Kq7#tiny', 'the persona keeps its own password');
  assert.ok(JSON.stringify(B.mem.local.sessions || {}).includes('Kq7#tiny'), 'stored with the site\'s session');
  const other = await B.send({ type: 'state', tabId: 2 });
  assert.ok(!other.session || other.session.usedPassword === undefined, 'another site shows no used password');
});

test('the next fill on that site sends its used password (login step), the reply and storage keep the persona\'s', async () => {
  const B = loadBg({ tabs: TABS, exec: fillWith((o) => [{ count: 1, used: { password: 'Kq7tinyPw' } }]) });
  const r1 = await B.send({ type: 'fill', tabId: 1 });
  const own = r1.persona.password;
  assert.equal(B.calls.filter(fillCall).at(-1).args[0].password, own, 'the first fill sends the persona\'s own password');
  const r2 = await B.send({ type: 'fill', tabId: 4 }); // the same site
  assert.equal(B.calls.filter(fillCall).at(-1).args[0].password, 'Kq7tinyPw', 'the site\'s used password goes to the filler');
  assert.equal(r2.persona.password, own, 'the reply carries the persona as generated');
  assert.equal(r2.session.usedPassword, 'Kq7tinyPw');
  await B.send({ type: 'fill', tabId: 2 }); // another site
  assert.notEqual(B.calls.filter(fillCall).at(-1).args[0].password, 'Kq7tinyPw', 'other sites never get it');
});

test('the persona\'s own password reported back is not stored as usedPassword', async () => {
  const B = loadBg({ tabs: TABS, exec: fillWith((o) => [{ count: 1, used: { password: o.args[0].password } }]) });
  await B.send({ type: 'fill', tabId: 1 });
  const st = await B.send({ type: 'state', tabId: 1 });
  assert.ok(st.session, 'the site has a session');
  assert.equal(st.session.usedPassword, undefined);
});

test('requiredOnly defaults to false and reaches the filler like the other settings', async () => {
  const B = loadBg({ tabs: TABS, exec: execWith() });
  const st = await B.send({ type: 'state', tabId: 1 });
  assert.equal(st.settings.requiredOnly, false);
  await B.send({ type: 'fill', tabId: 1 });
  assert.equal(B.calls.filter(fillCall).at(-1).args[1].requiredOnly, false);
  const s2 = await B.send({ type: 'setSettings', tabId: 1, patch: { requiredOnly: true } });
  assert.equal(s2.settings.requiredOnly, true);
  await B.send({ type: 'fill', tabId: 1 });
  assert.equal(B.calls.filter(fillCall).at(-1).args[1].requiredOnly, true);
});

test('state.persona carries idDates, landline and references; "Send to my inbox" reaches the references\' emails', async () => {
  const B = loadBg({ tabs: TABS, exec: execWith() });
  let st = await B.send({ type: 'state', tabId: 1 });
  for (const k of ['idDates', 'landline', 'references']) assert.ok(k in st.persona, `state.persona.${k} missing`);
  st = await B.send({ type: 'setSettings', tabId: 1, patch: { emailInbox: 'you@gmail.com' } });
  assert.ok(Array.isArray(st.persona.references) && st.persona.references.length === 2, 'two references');
  for (const r of st.persona.references) assert.match(String(r.email), /^you\+[^@\s]+@gmail\.com$/);
  assert.ok(!JSON.stringify([B.mem.local.persona, B.mem.local.sessions]).includes('you+'), 'storage keeps raw personas');
});

/* ---------------- locale and regex edge cases ---------------- */
test('BR personas carry a neighbourhood (bairro) for every city, the per-state locations too; other countries keep none', () => {
  if (libErr) throw libErr;
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const p = G.FormGhost.generate('BR');
    assert.ok(typeof p.neighborhood === 'string' && p.neighborhood && p.neighborhood !== p.address2 && p.neighborhood !== p.city, `${p.city}: ${JSON.stringify(p.neighborhood)}`);
    assert.ok(p.locations.every((l) => typeof l.neighborhood === 'string' && l.neighborhood), 'every location has one');
    seen.add(p.city);
  }
  assert.ok(seen.size >= 5, `several cities (${[...seen]})`);
  for (const c of ['IN', 'US', 'DE']) assert.equal(G.FormGhost.generate(c).neighborhood, undefined, c);
});

test('FG_RULES.badMatch rejects repeated groups whose alternatives overlap through a class, and stays quick on what it accepts', () => {
  const R = load(['lib/rules.js']).FG_RULES;
  for (const m of ['/(\\w|\\d)+$/', '/(\\d|\\w)*x/', '/([a-z]|_)+$/', '/(.|x)+y/', '/(a|ab)*/', '/(a+)+$/', '/((a)|b)+/']) assert.ok(R.badMatch(m), `${m} rejected`);
  for (const m of ['/(foo|bar)+/i', '/pin ?code/i', '/(\\.|-)+/', '/^(mr|mrs)\\.? /i', '/[\\w-]+@/']) assert.equal(R.badMatch(m), '', `${m} accepted`);
  const t0 = Date.now();
  for (const m of ['/(foo|bar)+$/', '/(\\.|-)+$/', '/[\\w-]+$/']) new RegExp(m.slice(1, -1)).test('foo'.repeat(30) + '-'.repeat(30) + '1'.repeat(30) + '!');
  assert.ok(Date.now() - t0 < 200, 'accepted patterns run in linear time');
});
