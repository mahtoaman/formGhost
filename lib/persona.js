/*!
 * FormGhost - https://github.com/mahtoaman/formghost
 * Copyright 2026 Aman Mahto (@mahtoaman)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 */
/* FormGhost: builds one consistent fake identity for a country (and region, if known). */
(function (G) {
  const R = G.FG_R;
  const L = G.FG_LOCALES;

  const JOBS = ['Software Engineer', 'Product Manager', 'Business Analyst', 'Marketing Executive', 'Sales Manager', 'Accountant', 'HR Executive', 'Data Analyst', 'Graphic Designer', 'Operations Manager', 'Customer Success Lead', 'QA Engineer', 'Project Coordinator', 'Content Writer'];

  const ascii = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-zA-Z]/g, '').toLowerCase();

  // folded words for name matching: 'São Paulo' → 'sao paulo', 'Nordrhein-Westfalen' → 'nordrhein westfalen'
  const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // names IP lookups use that differ from ours
  const AKA = {
    bangalore: 'bengaluru', bombay: 'mumbai', gurgaon: 'gurugram', vizag: 'visakhapatnam', vishakhapatnam: 'visakhapatnam', mysore: 'mysuru', mangalore: 'mangaluru',
    calcutta: 'kolkata', trivandrum: 'thiruvananthapuram', cochin: 'kochi', ernakulam: 'kochi', madras: 'chennai', poona: 'pune', baroda: 'vadodara', panjim: 'panaji',
    orissa: 'odisha', uttaranchal: 'uttarakhand', pondicherry: 'puducherry', munich: 'munchen', cologne: 'koln', bavaria: 'bayern', hesse: 'hessen',
    'north rhine westphalia': 'nordrhein westfalen', seville: 'sevilla', catalonia: 'cataluna', andalusia: 'andalucia', 'basque country': 'pais vasco',
    'valencian community': 'comunidad valenciana', occitania: 'occitanie', chittagong: 'chattogram',
  };
  const words = (a, b) => !!a && !!b && (' ' + a + ' ').includes(' ' + b + ' ');
  // Whole names only: exact (or abbreviation) first, then whole words either way ('Delhi' ↔ 'New Delhi'); never inside a word ('Visakhapatnam' ⊅ 'Patna')
  function byName(list, hint, name, abbr) {
    let h = fold(hint); h = AKA[h] || h;
    if (!h) return [];
    const exact = list.filter((x) => fold(name(x)) === h || (abbr && fold(abbr(x)) === h));
    return exact.length ? exact : list.filter((x) => words(h, fold(name(x))) || words(fold(name(x)), h));
  }

  function locate(C, regionHint, cityHint) {
    const all = [], extra = [];
    C.clusters.forEach((cl) => { cl.cities.forEach((c) => all.push([cl, c])); (cl.states || []).forEach((s) => extra.push([cl, s])); });
    const inRegion = (list) => byName(list, regionHint, ([, c]) => c.s, ([, c]) => c.sa);
    const city = byName(all, cityHint, ([, c]) => c.n);
    if (city.length) { const r = inRegion(city); return R.pick(r.length ? r : city); } // same city name in two states: the hinted one
    const region = inRegion(all);
    if (region.length) return R.pick(region);
    const st = byName(extra, regionHint, ([, s]) => s);
    if (st.length) { const cl = R.pick(st)[0]; return [cl, R.pick(cl.cities)]; }
    const cl = R.pick(C.clusters);
    return [cl, R.pick(cl.cities)];
  }

  // born `age` years + 1..364 days ago, so the exact age today is `age`
  function dobFor(age) {
    const now = new Date();
    const b = new Date(now.getFullYear() - age, now.getMonth(), now.getDate() - R.int(1, 364));
    const dob = { y: b.getFullYear(), m: b.getMonth() + 1, d: b.getDate() };
    dob.iso = `${dob.y}-${R.pad(dob.m, 2)}-${R.pad(dob.d, 2)}`;
    return dob;
  }

  function phoneOf(C, national) {
    const ph = C.phone, subscriber = ph.trunk && national.startsWith(ph.trunk) ? national.slice(ph.trunk.length) : national;
    return { cc: '+' + ph.cc, ccDigits: ph.cc, national, subscriber, display: ph.fmt(national), e164: '+' + ph.cc + subscriber };
  }
  // { std, number, national (std + number, as dialled at home), display, e164 }
  function landOf(C, l) {
    const national = l.std + l.number;
    return { std: l.std, number: l.number, national, display: l.display, e164: '+' + C.phone.cc + national.replace(/^0/, '') };
  }

  /* Two references (never family): from the persona's region, with names, numbers and emails of their own */
  const RELATIONS = ['Former manager', 'Colleague', 'Professor', 'Friend'];
  const LEADS = ['Team Lead', 'Senior Manager', 'Project Manager', 'Delivery Manager', 'Head of Operations', 'Director'];
  const PARTS = new Map(); // name → its folded words; 'Al' of 'Al Ali' is no name of its own
  const parts = (s) => { let w = PARTS.get(s); if (!w) PARTS.set(s, (w = fold(s).split(' ').filter((x) => x.length > 2))); return w; };
  function referees(p, C, cl, phones, names) {
    const taken = names.flatMap(parts), mails = [p.email, p.altEmail], year = new Date().getFullYear();
    // a name sharing no word with the persona's family or the other reference, not even inside a word ('Riya' / 'Priya')
    const rules = [(w) => !taken.some((t) => w.includes(t) || t.includes(w)), (w) => !taken.includes(w), () => true];
    const free = (list) => {
      let pool = [];
      for (const ok of rules) if ((pool = list.filter((x) => parts(x).every(ok))).length) break;
      const n = R.pick(pool);
      taken.push(...parts(n));
      return n;
    };
    const other = () => { let c; do c = `${R.pick(C.co.a)} ${R.pick(C.co.b)} ${R.pick(C.co.c)}`; while (c === p.company); return c; };
    const first = R.pick(['Former manager', 'Former manager', 'Colleague', 'Professor']), rels = [first, R.pick(RELATIONS.filter((r) => r !== first))];
    const exp = Math.max(1, p.experience || 1);
    return rels.map((relation, i) => {
      const firstName = free(cl[R.chance(0.5) ? 'male' : 'female']);
      let lastName = free(cl.last);
      if (C.doubleSurname) lastName += ' ' + free(cl.last);
      const f = ascii(firstName), l = ascii(C.doubleSurname ? lastName.split(' ')[0] : lastName);
      let email; do email = `${f}${R.pick(['.', '', '_'])}${l}${R.int(1, 99)}@${R.pick(C.emails)}`; while (mails.includes(email));
      mails.push(email);
      const [company, jobTitle, yearsKnown] = relation === 'Former manager' ? [other(), R.pick(LEADS), R.int(1, Math.min(6, exp))]
        : relation === 'Colleague' ? [p.company, R.pick(JOBS), R.int(1, Math.min(8, exp))]
          : relation === 'Professor' ? [p.university || other(), R.pick(['Professor', 'Associate Professor', 'Assistant Professor']), Math.max(2, year - (p.gradYear || year - 1) + R.int(2, 4))]
            : [other(), R.pick(JOBS), R.int(3, Math.max(3, Math.min(20, p.age - 12)))];
      return { name: `${firstName} ${lastName}`, firstName, lastName, relation, company, jobTitle, phone: phones[i], email, yearsKnown };
    });
  }

  // District everywhere; tehsil / village / post office where forms ask for them (IN); a neighbourhood where forms ask for one (BR bairro)
  function admin(C, c, a) {
    const out = { district: c.d || c.n };
    if (c.nb) out.neighborhood = R.pick(c.nb);
    if (C.code === 'IN') {
      const loc = a.line2.split(',')[0], place = /^(sector|phase|block)\b/i.test(loc) ? `${c.n} ${loc}` : loc;
      Object.assign(out, { tehsil: c.t || c.n, village: place, postOffice: `${place} S.O` });
    }
    return out;
  }

  function password() {
    const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', l = 'abcdefghijkmnopqrstuvwxyz', d = '23456789', s = '@#$!%&*';
    for (;;) {
      const chars = [R.letters(1, U), R.letters(1, U), R.letters(4, l), R.letters(2, l), R.letters(2, d), R.letters(1, s), R.letters(1, d)].join('').split('');
      for (let i = chars.length - 1; i > 0; i--) { const j = R.int(0, i); [chars[i], chars[j]] = [chars[j], chars[i]]; }
      // first char a letter: some sites dislike leading symbols/digits
      const k = chars.findIndex((c) => /[A-Za-z]/.test(c)); [chars[0], chars[k]] = [chars[k], chars[0]];
      const pw = chars.join('');
      if (!/nan|null|undefined/i.test(pw)) return pw; // never reads as a broken value ("n593xNaN!qfb")
    }
  }

  function generate(code, regionHint, cityHint) {
    const C = L[code] || L.US;
    const [cl, city] = locate(C, regionHint, cityHint);
    const gender = R.chance(0.5) ? 'male' : 'female';
    const firstName = R.pick(cl[gender]);
    let lastName = R.pick(cl.last);
    if (C.doubleSurname) { let l2; do { l2 = R.pick(cl.last); } while (l2 === lastName); lastName += ' ' + l2; }
    const familyName = lastName.split(' ').slice(0, C.doubleSurname ? 1 : 9).join(' ');
    let middleName = '';
    if (C.code === 'US' || C.code === 'GB' || C.code === 'AU' || C.code === 'CA') { do { middleName = R.pick(cl.male.concat(cl.female)); } while (middleName === firstName); }
    const other = gender === 'male' ? 'female' : 'male';
    const firstOf = (sex, not) => { let n; do { n = R.pick(cl[sex]); } while (not.includes(n)); return n; };
    const fatherFirst = firstOf('male', [firstName]), motherFirst = firstOf('female', [firstName]); // never the persona's own first name
    const fatherName = `${fatherFirst} ${familyName}`;
    const motherName = `${motherFirst} ${familyName}`;

    const age = R.int(21, 44);
    const dob = dobFor(age);

    // five different numbers from the same region: own, alternate, emergency contact's, the two references'
    const nums = [];
    while (nums.length < 5) { const n = C.phone.gen(city); if (!nums.includes(n)) nums.push(n); }
    const [phone, altPhone, emPhone, ...refPhones] = nums.map((n) => phoneOf(C, n));
    // a landline in the persona's city (IN: its STD code) that is none of those numbers
    let landline;
    do landline = landOf(C, C.landline(city)); while (nums.some((n) => n.endsWith(landline.national) || landline.national.endsWith(n)));

    // family: married more often the older the persona is; the spouse and siblings share the family name
    const maritalStatus = R.chance(Math.min(0.9, Math.max(0.05, (age - 22) / 16))) ? 'Married' : 'Single', married = maritalStatus === 'Married';
    const spouseFirst = firstOf(other, [firstName]), spouseName = `${spouseFirst} ${familyName}`;
    const named = { Spouse: spouseName, Father: fatherName, Mother: motherName };
    const emRel = R.pick(married ? ['Spouse', 'Spouse', 'Father', 'Mother', 'Brother', 'Sister'] : ['Father', 'Mother', 'Brother', 'Sister']);
    const emergency = { name: named[emRel] || `${firstOf(emRel === 'Brother' ? 'male' : 'female', [firstName, fatherFirst, motherFirst, spouseFirst])} ${familyName}`, relation: emRel, phone: emPhone };
    const nomRel = married ? 'Spouse' : R.pick(['Mother', 'Father']);
    const nomAge = married ? Math.max(19, age + (gender === 'male' ? -R.int(0, 5) : R.int(0, 6))) : age + R.int(24, 32);
    const nominee = { name: named[nomRel], relation: nomRel, dob: dobFor(nomAge), age: nomAge };

    const f = ascii(firstName), l = ascii(familyName);
    const num = R.chance(0.5) ? String(dob.y).slice(2) : String(R.int(1, 999));
    const email = `${f}${R.pick(['.', '', '_', '.'])}${l}${num}@${R.pick(C.emails)}`;
    const username = `${f}${l.slice(0, R.int(1, 3))}${R.int(10, 999)}`;
    const doms = [...new Set(C.emails)], others = doms.filter((d) => d !== email.split('@')[1]);
    let altEmail; do { altEmail = `${f}${R.pick(['.', '_', ''])}${l}${R.int(1, 99)}@${R.pick(others.length ? others : doms)}`; } while (altEmail === email);

    const coCore = `${R.pick(C.co.a)} ${R.pick(C.co.b)}`;
    const company = `${coCore} ${R.pick(C.co.c)}`;
    const website = `https://www.${ascii(coCore)}${C.tld}`;
    const addr = C.address(city, cl);

    const p = {
      id: R.letters(10, 'abcdefghijklmnopqrstuvwxyz0123456789'),
      country: C.code, countryName: C.name, countryAliases: C.aliases, cluster: cl.id,
      gender, title: gender === 'male' ? 'Mr' : married ? R.pick(['Ms', 'Mrs']) : 'Ms',
      firstName, middleName, lastName, fullName: `${firstName} ${lastName}`, fatherName, motherName,
      initials: (firstName[0] + familyName[0]).toUpperCase(),
      email, username, password: password(), phone,
      address1: addr.line1, address2: addr.line2,
      city: city.n, state: city.s, stateAbbr: city.sa || '', zip: C.zip(city),
      company, jobTitle: R.pick(JOBS), website,
      age, dob, dateOrder: C.dateOrder, dateSep: C.dateSep,
      altPhone, altEmail, landline, maritalStatus, spouseName, emergency, nominee, ...admin(C, city, addr),
    };
    p.fullAddress = [p.address1, p.address2, `${p.city}, ${p.state} ${p.zip}`].filter(Boolean).join(', ');
    // One alternative location per state, so the filler can match whatever states a <select> offers
    const byState = {};
    C.clusters.forEach((k) => k.cities.forEach((c) => { (byState[c.s] = byState[c.s] || []).push([k, c]); }));
    p.locations = Object.values(byState).map((arr) => {
      const [k, c] = R.pick(arr); const a = C.address(c, k);
      return { city: c.n, state: c.s, stateAbbr: c.sa || '', zip: C.zip(c), address1: a.line1, address2: a.line2, ...admin(C, c, a) };
    });
    if (G.FG_PROFILE) G.FG_PROFILE(p, C, cl, ascii, familyName);
    p.references = referees(p, C, cl, refPhones, [firstName, middleName, lastName, fatherName, motherName, spouseName, emergency.name]);
    p.createdAt = Date.now();
    p.schema = 2; // 2.0: business / national IDs, real IN post offices and branches; older stored personas are replaced
    return p;
  }

  /* ---------- bulk export: personas → CSV, common fields first, then every ID and other plain field any of them has ---------- */
  const phoneText = (x) => (x && typeof x === 'object' ? x.display || x.national || '' : x == null ? '' : x);
  const COMMON = [
    'id', 'country', 'countryName', 'title', 'gender', 'firstName', 'middleName', 'lastName', 'fullName', ['dob', (p) => p.dob && p.dob.iso], 'age',
    'email', 'altEmail', 'username', 'password', ['phone', (p) => phoneText(p.phone)], ['phoneE164', (p) => p.phone && p.phone.e164],
    ['altPhone', (p) => phoneText(p.altPhone)], ['landline', (p) => phoneText(p.landline)],
    'address1', 'address2', 'city', 'district', 'state', 'stateAbbr', 'zip', 'fullAddress', 'company', 'jobTitle', 'website',
    'maritalStatus', 'fatherName', 'motherName', 'spouseName', 'qualification', 'university', 'experience', 'bloodGroup',
  ].map((c) => (Array.isArray(c) ? c : [c, (p) => p[c]]));
  const NOT_CSV = new Set(['createdAt', 'dateOrder', 'dateSep', 'cluster', 'schema', 'initials', 'bio', 'noticePeriod']);
  const cell = (v) => {
    let s = v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v);
    if (/^[=@\t\r]/.test(s)) s = "'" + s; // never a formula in a spreadsheet
    return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  function csv(list) {
    const rows = (Array.isArray(list) ? list : []).filter((p) => p && typeof p === 'object');
    const cols = COMMON.slice(), names = new Set(cols.map((c) => c[0]));
    const add = (name, get) => { if (!names.has(name)) { names.add(name); cols.push([name, get]); } };
    for (const p of rows) {
      for (const k of Object.keys(p.ids || {})) add(k, (q) => q.ids && q.ids[k]);
      for (const [k, v] of Object.entries(p)) if (!NOT_CSV.has(k) && (typeof v === 'string' || typeof v === 'number')) add(k, (q) => q[k]);
    }
    return [cols.map((c) => cell(c[0])), ...rows.map((p) => cols.map(([, get]) => cell(get(p))))].map((r) => r.join(',')).join('\r\n') + '\r\n';
  }

  /* ---------- safe test data (settings → a copy of the persona; stored personas stay as generated) ---------- */
  const INBOX = /^([a-z0-9._%+-]+)@((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$/i;
  const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
  // Numbers set aside for drama and testing, so a signup never texts a real person: NANP 555-0100…0199, Ofcom 07700 900xxx, ACMA's mobile list
  const AU_FICTION = '0491570006,0491570110,0491570156,0491571266,0491571491,0491571804,0491572549,0491572665,0491572983'.split(',');
  const NANP_TEST = [100, (p, i) => p.phone.national.slice(0, 3) + '55501' + R.pad(i, 2)];
  const TEST_PHONES = { US: NANP_TEST, CA: NANP_TEST, GB: [1000, (p, i) => '07700900' + R.pad(i, 3)], AU: [AU_FICTION.length, (p, i) => AU_FICTION[i]] };

  // the same persona always gets the same test numbers
  function seeded(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    let a = h >>> 0;
    return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  function withPrefs(p, settings) {
    if (!p || typeof p !== 'object') return p;
    const q = { ...p }, s = settings || {};
    const local = String(p.email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 20).replace(/\.{2,}/g, '.').replace(/^\.|\.$/g, '') || 'user';
    const inbox = String(s.emailInbox || '').trim().match(INBOX), dom = String(s.emailDomain || '').trim().replace(/^@/, '').toLowerCase();
    // you+<local><tag>@inbox or <local><tag>@domain; tag '' for the persona, '.alt', '.ref1', '.ref2' for the references
    const mail = inbox ? (t) => `${inbox[1]}+${local}${t}@${inbox[2].toLowerCase()}` : DOMAIN.test(dom) ? (t) => `${local}${t}@${dom}` : null;
    const refs = Array.isArray(p.references) ? p.references.map((r) => (r && typeof r === 'object' ? { ...r } : r)) : null;
    if (mail) {
      q.email = mail(''); q.altEmail = mail('.alt');
      if (refs) refs.forEach((r, i) => { if (r && r.email) r.email = mail(`.ref${i + 1}`); });
    }
    const T = s.testPhones && TEST_PHONES[p.country], C = L[p.country];
    if (T && C && p.phone && /^\d+$/.test(p.phone.national || '')) {
      const rnd = seeded(String(p.id || p.email || p.createdAt || '')), at = [];
      while (at.length < Math.min(T[0], 3 + (refs ? refs.length : 0))) { const i = Math.floor(rnd() * T[0]); if (!at.includes(i)) at.push(i); }
      const [own, alt, em, ...rest] = at.map((i) => phoneOf(C, T[1](p, i)));
      q.phone = own;
      if (p.altPhone) q.altPhone = alt;
      if (p.emergency && p.emergency.phone) q.emergency = { ...p.emergency, phone: em };
      if (refs) refs.forEach((r, i) => { if (r && r.phone && rest[i]) r.phone = rest[i]; });
    }
    if (refs) q.references = refs;
    return q;
  }

  G.FormGhost = {
    generate,
    withPrefs,
    csv,
    testPhoneCountries: Object.keys(TEST_PHONES),
    // where an IP city/region hint lands: { city, state, stateAbbr, cluster }
    locate: (code, regionHint, cityHint) => { const [cl, c] = locate(L[code] || L.US, regionHint, cityHint); return { city: c.n, state: c.s, stateAbbr: c.sa || '', cluster: cl.id }; },
    countries: () => Object.values(L).map((c) => ({ code: c.code, name: c.name })),
    supported: (code) => !!L[code],
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
