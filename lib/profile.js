/*!
 * FormGhost - https://github.com/mahtoaman/formghost
 * Copyright 2026 Aman Mahto (@mahtoaman)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 */
/* FormGhost: profile extras: education, experience, languages, bank details, ID numbers.
   Everything is derived from the same persona so it stays consistent. IN pincodes, post offices and
   bank branches come from lib/data-in.js (real, curated) when it is loaded; generated values otherwise. */
(function (G) {
  const R = G.FG_R;
  const S = (str) => str.split(',').map((x) => x.trim()).filter(Boolean);
  const real = (k, city) => { const d = G.FG_DATA_IN; return (d && d[k] && d[k][city]) || null; };

  const QUAL_IN = S('B.Tech (Computer Science),B.Sc (Mathematics),B.Com,B.A. (English),M.Sc (Physics),MBA (Finance),M.A. (Economics),B.Ed,MCA,M.Tech (Electronics),B.Sc (Chemistry),M.Com,M.Sc (Mathematics)');
  const QUAL_GEN = S('Bachelor of Science (Mathematics),Bachelor of Arts (English),Bachelor of Commerce,Master of Business Administration,Master of Science (Physics),Bachelor of Engineering (Computer Science),Master of Arts (Economics),Bachelor of Education');

  const UNI_IN = {
    north: S('University of Delhi,Lucknow University,University of Rajasthan,Panjab University,Kurukshetra University,Banaras Hindu University,Devi Ahilya Vishwavidyalaya'),
    west: S('University of Mumbai,Savitribai Phule Pune University,Gujarat University,Maharaja Sayajirao University of Baroda,Goa University,RTM Nagpur University'),
    south: S('Anna University,Osmania University,Bangalore University,University of Kerala,Andhra University,University of Mysore,University of Madras'),
    east: S('University of Calcutta,Jadavpur University,Patna University,Utkal University,Ranchi University,Gauhati University'),
  };
  const UNI = {
    US: S('University of Texas at Austin,Arizona State University,University of Washington,Boston University,Georgia State University,University of Florida,Ohio State University'),
    GB: S("University of Manchester,University of Leeds,King's College London,University of Bristol,University of Glasgow,University of Birmingham"),
    CA: S('University of Toronto,McGill University,University of British Columbia,University of Calgary,University of Ottawa'),
    AU: S('University of Sydney,Monash University,University of Queensland,UNSW Sydney,University of Adelaide'),
    DE: S('Ludwig-Maximilians-Universität München,Humboldt-Universität zu Berlin,Universität Hamburg,Universität zu Köln,Goethe-Universität Frankfurt'),
    FR: S('Sorbonne Université,Université Claude Bernard Lyon 1,Aix-Marseille Université,Université de Bordeaux,Université de Lille'),
    ES: S('Universidad Complutense de Madrid,Universitat de Barcelona,Universidad de Sevilla,Universitat de València'),
    BR: S('Universidade de São Paulo,Universidade Federal do Rio de Janeiro,Universidade Federal de Minas Gerais,Universidade Federal do Paraná'),
    AE: S('United Arab Emirates University,University of Sharjah,Khalifa University,Zayed University'),
    PK: S('University of the Punjab,University of Karachi,Quaid-i-Azam University,NUST,LUMS'),
    BD: S('University of Dhaka,BUET,University of Chittagong,North South University,BRAC University'),
  };

  const LANG_IN = {
    Delhi: 'Hindi', 'Uttar Pradesh': 'Hindi', Haryana: 'Hindi', Rajasthan: 'Hindi', 'Madhya Pradesh': 'Hindi', Uttarakhand: 'Hindi', Chandigarh: 'Punjabi', Punjab: 'Punjabi',
    Bihar: 'Hindi', Jharkhand: 'Hindi', Maharashtra: 'Marathi', Gujarat: 'Gujarati', Goa: 'Konkani', Karnataka: 'Kannada', 'Tamil Nadu': 'Tamil',
    Telangana: 'Telugu', 'Andhra Pradesh': 'Telugu', Kerala: 'Malayalam', 'West Bengal': 'Bengali', Odisha: 'Odia', Assam: 'Assamese',
  };
  const LANG = { US: ['English', 'Spanish'], GB: ['English'], CA: ['English', 'French'], AU: ['English'], DE: ['German', 'English'], FR: ['French', 'English'], ES: ['Spanish', 'English'], BR: ['Portuguese', 'English'], AE: ['Arabic', 'English'], PK: ['Urdu', 'English'], BD: ['Bengali', 'English'] };

  const SUBJECTS = S('Mathematics,Physics,Chemistry,Biology,English,Science,Computer Science,Economics,Social Studies');
  const SKILLS = S('Communication,MS Excel,Teamwork,Problem Solving,Time Management,Leadership,Public Speaking,Data Analysis');
  const NOTICE = S('Immediate,15 days,30 days,60 days,90 days');
  // blood groups, most common first (weights roughly follow India's distribution)
  const BLOOD = [['O+', 35], ['B+', 28], ['A+', 23], ['AB+', 7], ['O-', 3], ['B-', 2], ['A-', 1.5], ['AB-', 0.5]];
  const weighted = (list) => { let r = Math.random() * list.reduce((a, x) => a + x[1], 0); for (const [v, w] of list) if ((r -= w) < 0) return v; return list[0][0]; };

  /* ---------- banks ---------- */
  const BANKS = {
    IN: [ // s: the bank's head-office SWIFT BIC
      { n: 'State Bank of India', c: 'SBIN', len: 11, upi: 'oksbi', s: 'SBININBB' }, { n: 'HDFC Bank', c: 'HDFC', len: 14, upi: 'okhdfcbank', s: 'HDFCINBB' },
      { n: 'ICICI Bank', c: 'ICIC', len: 12, upi: 'okicici', s: 'ICICINBB' }, { n: 'Axis Bank', c: 'UTIB', len: 15, upi: 'okaxis', s: 'AXISINBB' },
      { n: 'Punjab National Bank', c: 'PUNB', len: 16, upi: 'ybl', s: 'PUNBINBB' }, { n: 'Kotak Mahindra Bank', c: 'KKBK', len: 10, upi: 'kotak', s: 'KKBKINBB' },
      { n: 'Bank of Baroda', c: 'BARB', len: 14, upi: 'ybl', s: 'BARBINBB' },
    ],
    US: [{ n: 'JPMorgan Chase Bank', c: 'CHAS' }, { n: 'Bank of America', c: 'BOFA' }, { n: 'Wells Fargo Bank', c: 'WFBI' }, { n: 'Citibank', c: 'CITI' }],
    GB: [{ n: 'Barclays', c: 'BARC' }, { n: 'HSBC UK', c: 'HBUK' }, { n: 'Lloyds Bank', c: 'LOYD' }, { n: 'NatWest', c: 'NWBK' }],
    CA: [{ n: 'RBC Royal Bank', c: 'ROYC' }, { n: 'TD Canada Trust', c: 'TDOM' }, { n: 'Scotiabank', c: 'NOSC' }],
    AU: [{ n: 'Commonwealth Bank', c: 'CTBA' }, { n: 'Westpac', c: 'WPAC' }, { n: 'ANZ', c: 'ANZB' }, { n: 'NAB', c: 'NATA' }],
    DE: [{ n: 'Deutsche Bank', c: 'DEUT' }, { n: 'Commerzbank', c: 'COBA' }, { n: 'Sparkasse', c: 'SPKA' }],
    FR: [{ n: 'BNP Paribas', c: 'BNPA' }, { n: 'Société Générale', c: 'SOGE' }, { n: 'Crédit Agricole', c: 'AGRI' }],
    ES: [{ n: 'Banco Santander', c: 'BSCH' }, { n: 'BBVA', c: 'BBVA' }, { n: 'CaixaBank', c: 'CAIX' }],
    BR: [{ n: 'Banco do Brasil', c: 'BRAS' }, { n: 'Itaú Unibanco', c: 'ITAU' }, { n: 'Bradesco', c: 'BBDE' }],
    AE: [{ n: 'Emirates NBD', c: 'EBIL' }, { n: 'First Abu Dhabi Bank', c: 'NBAD' }, { n: 'ADCB', c: 'ADCB' }],
    PK: [{ n: 'Habib Bank Limited', c: 'HABB' }, { n: 'Meezan Bank', c: 'MEZN' }, { n: 'MCB Bank', c: 'MUCB' }],
    BD: [{ n: 'Dutch-Bangla Bank', c: 'DBBL' }, { n: 'BRAC Bank', c: 'BRAK' }, { n: 'Sonali Bank', c: 'BSONB' }],
  };
  // IBAN BBAN builders (country → function returning BBAN)
  const BBAN = {
    DE: () => R.digits(18), FR: () => R.digits(23), ES: () => R.digits(20), AE: () => R.digits(19),
    PK: (b) => b.c.slice(0, 4) + R.digits(16), GB: (b, sort, acc) => b.c.slice(0, 4) + sort + acc,
  };
  function mod97(str) { let r = 0; for (const ch of str) r = (r * 10 + +ch) % 97; return r; }
  function iban(cc, bban) {
    const conv = (s) => s.toUpperCase().split('').map((ch) => (/[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch)).join('');
    const check = 98 - mod97(conv(bban + cc + '00'));
    return cc + String(check).padStart(2, '0') + bban;
  }
  function abaRouting() {
    const d = [R.pick(['0', '1', '2', '3']), String(R.int(1, 9)), ...R.digits(6).split('')].map(Number);
    if (d[0] === 1 && d[1] > 2) d[1] = 2; if (d[0] === 3) d[1] = R.int(1, 2); if (d[0] === 2) d[1] = R.int(1, 9);
    const s = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5]);
    return d.join('') + ((10 - (s % 10)) % 10);
  }

  function bank(p, C, ascii) {
    // IN: one of the banks with a real branch in the persona's city, and that branch's IFSC / MICR
    const all = BANKS[C.code] || BANKS.US, here = C.code === 'IN' ? real('ifsc', p.city) : null, have = here ? all.filter((x) => here[x.c]) : all;
    const b = R.pick(have.length ? have : all), br = here && here[b.c] ? R.pick(here[b.c]) : null;
    const out = { bankName: b.n, branch: `${p.city} Main Branch`, swift: b.s || `${b.c.slice(0, 4)}${C.code}${R.pick(['BB', 'XX', '2X'])}` };
    if (C.code === 'IN') {
      out.accountNumber = R.int(1, 9) + R.digits(b.len - 1);
      out.ifsc = br ? br[0] : b.c + '0' + R.digits(6);
      out.upi = `${ascii(p.firstName)}${ascii(p.lastName.split(' ')[0]).slice(0, 4)}${R.int(1, 99)}@${b.upi}`;
      out.branch = br ? (br[1].includes(p.city) ? br[1] : `${br[1]}, ${p.city}`) : `${p.address2.split(',')[0]}, ${p.city}`;
      if (br && br[2]) out.micr = br[2];
    } else if (C.code === 'US') {
      out.routing = abaRouting(); out.accountNumber = R.int(1, 9) + R.digits(R.int(9, 11));
    } else if (C.code === 'GB') {
      const sort = R.digits(6), acc = R.digits(8);
      out.sortCode = `${sort.slice(0, 2)}-${sort.slice(2, 4)}-${sort.slice(4)}`; out.accountNumber = acc; out.iban = iban('GB', BBAN.GB(b, sort, acc));
    } else if (C.code === 'AU') {
      out.bsb = `${R.digits(3)}-${R.digits(3)}`; out.accountNumber = R.int(1, 9) + R.digits(8);
    } else if (C.code === 'CA') {
      out.transit = R.digits(5); out.institution = R.pick(['003', '004', '002']); out.accountNumber = R.int(1, 9) + R.digits(6);
    } else if (BBAN[C.code]) {
      out.iban = iban(C.code, BBAN[C.code](b)); out.accountNumber = out.iban.slice(-12);
    } else {
      out.accountNumber = R.int(1, 9) + R.digits(R.int(10, 13));
    }
    return out;
  }

  /* ---------- ID documents ---------- */
  // Verhoeff check digit (Aadhaar's last digit)
  const VD = '0123456789,1234067895,2340178956,3401289567,4012395678,5987604321,6598710432,7659821043,8765932104,9876543210'.split(',');
  const VP = '0123456789,1576283094,5803796142,8916043527,9453126870,4286573901,2793806415,7046913258'.split(',');
  const verhoeff = (num) => { let c = 0; num.split('').reverse().forEach((ch, i) => { c = +VD[c][+VP[(i + 1) % 8][+ch]]; }); return '0432156789'[c]; };

  /* ---------- document dates (ISO, local days) ---------- */
  const at = (t, y = 0, d = 0) => new Date(t.getFullYear() + y, t.getMonth(), t.getDate() + d);
  const iso = (t) => `${t.getFullYear()}-${R.pad(t.getMonth() + 1, 2)}-${R.pad(t.getDate(), 2)}`;
  const min = (...a) => new Date(Math.min(...a)), max = (...a) => new Date(Math.max(...a));
  // a day from a to b, never 29 February, so the same day n years later always exists
  function within(a, b) {
    const t = at(a, 0, R.int(0, Math.max(0, Math.round((b - a) / 864e5))));
    if (t.getMonth() === 1 && t.getDate() === 29) t.setDate(t > a ? 28 : 30);
    return t;
  }
  // years a driving licence card is valid; IN has its own age rule
  const DL_YEARS = { US: 8, CA: 5, GB: 10, AU: 5, DE: 15, FR: 15, ES: 10, BR: 10, AE: 10, PK: 5, BD: 10 };
  function licence(p, C, today, adult) {
    const bday = (n) => new Date(p.dob.y + n, p.dob.m - 1, p.dob.d);
    if (C.code === 'IN') {
      // non-transport: 20 years but only till 40 when issued before 30, 10 years from 30; renewed (same number) once it lapses
      const till = (t) => (t < bday(30) ? min(at(t, 20), bday(40)) : at(t, 10));
      const first = within(adult, min(at(adult, 6), new Date(today.getFullYear() - 1, 11, 31), at(today, 0, -30)));
      let issue = first, expiry = till(first);
      while (expiry <= today) { issue = within(at(expiry, 0, -60), expiry); expiry = till(issue); }
      return { first, issue, expiry };
    }
    const n = DL_YEARS[C.code] || 10, issue = within(max(adult, at(today, 0, 400 - n * 365)), at(today, 0, -30));
    // US and Canadian licences run out on a birthday
    return { first: issue, issue, expiry: C.code === 'US' || C.code === 'CA' ? bday(issue.getFullYear() + n - p.dob.y) : at(issue, n) };
  }
  // passport: an adult one issued 1-9 years ago, valid 10 years; licence: issued after the 18th birthday, still valid
  function docDates(p, C) {
    const today = at(new Date()), adult = new Date(p.dob.y + 18, p.dob.m - 1, p.dob.d + 1);
    const pass = within(max(adult, at(today, 0, -3280)), at(today, 0, -370)), dl = licence(p, C, today, adult);
    return [{ passport: { issue: iso(pass), expiry: iso(at(pass, 10)) }, dl: { issue: iso(dl.issue), expiry: iso(dl.expiry) } }, dl.first.getFullYear()];
  }

  function ids(p, C, familyName, yr) {
    const out = {};
    if (C.code === 'IN') {
      const a = R.int(2, 9) + R.digits(10);
      out.aadhaar = a + verhoeff(a);
      out.pan = R.letters(3) + 'P' + familyName[0].toUpperCase() + R.digits(4) + R.letters(1);
      out.passport = R.letters(1, 'ABCDEFGHJKLMNPRSTUVW') + R.int(1, 9) + R.digits(6);
      out.dl = `${p.stateAbbr || 'DL'}${R.pad(R.int(1, 30), 2)}${yr}${R.digits(7)}`;
      out.voter = R.letters(3) + R.digits(7);
    } else if (C.code === 'PK') {
      out.nationalId = `${R.digits(5)}-${R.digits(7)}-${R.int(1, 9)}`; out.passport = R.letters(2) + R.digits(7); out.dl = R.digits(13);
    } else if (C.code === 'BD') {
      out.nationalId = R.int(1, 9) + R.digits(9); out.passport = R.letters(1) + R.digits(8); out.dl = R.letters(2) + R.digits(7) + R.letters(1) + R.digits(5);
    } else if (C.code === 'AE') {
      out.nationalId = `784-${p.dob.y}-${R.digits(7)}-${R.int(0, 9)}`; out.passport = R.letters(1) + R.digits(7); out.dl = R.digits(7);
    } else if (C.code === 'ES') {
      const n = R.int(10000000, 99999999); out.nationalId = n + 'TRWAGMYFPDXBNJZSQVHLCKE'[n % 23]; out.passport = R.letters(3) + R.digits(6); out.dl = out.nationalId;
    } else if (C.code === 'US') {
      out.passport = R.int(1, 9) + R.digits(8); out.dl = R.letters(1) + R.digits(7);
    } else if (C.code === 'GB') {
      out.passport = R.int(1, 9) + R.digits(8);
      out.dl = (familyName.toUpperCase().replace(/[^A-Z]/g, '') + '99999').slice(0, 5) + R.digits(6) + R.letters(2) + R.int(1, 9) + R.letters(2);
      out.nationalId = R.letters(2, 'ABCEGHJKLMNPRSTWXYZ') + R.digits(6) + R.pick(['A', 'B', 'C', 'D']);
    } else {
      out.passport = R.letters(2) + R.digits(7); out.dl = R.letters(1) + R.digits(8); out.nationalId = R.digits(10);
    }
    return out;
  }

  /* ---------- real places (IN): a pincode of the city, its post office, district and the locality it serves ---------- */
  function place(o) {
    const list = real('pins', o.city);
    if (!list || !list.length) return false;
    const [pin, po, district, loc] = R.pick(list), near = String(o.address2 || '').split(', ').slice(1).join(', ');
    if (/\bsector \d/i.test(loc)) o.address1 = String(o.address1 || '').replace(/\bSector \d+/, `Block ${R.letters(1, 'ABCDEFG')}`); // one sector per address
    Object.assign(o, { zip: pin, postOffice: po, district, village: /^(sector|phase|block)\b/i.test(loc) ? `${o.city} ${loc}` : loc, address2: near ? `${loc}, ${near}` : loc });
    return true;
  }

  /* ---------- business IDs (the persona's company) and other IN / BR numbers ---------- */
  const A36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  // GSTIN check character: base-36 values weighted 1, 2, 1, 2…, each product folded (quotient + remainder by 36)
  const gstCheck = (s) => { let t = 0; for (let i = 0; i < 14; i++) { const v = A36.indexOf(s[i]) * (i % 2 ? 2 : 1); t += Math.floor(v / 36) + (v % 36); } return A36[(36 - (t % 36)) % 36]; };
  const GST = {
    'Jammu and Kashmir': '01', 'Himachal Pradesh': '02', Punjab: '03', Chandigarh: '04', Uttarakhand: '05', Haryana: '06', Delhi: '07', Rajasthan: '08', 'Uttar Pradesh': '09', Bihar: '10',
    Sikkim: '11', 'Arunachal Pradesh': '12', Nagaland: '13', Manipur: '14', Mizoram: '15', Tripura: '16', Meghalaya: '17', Assam: '18', 'West Bengal': '19', Jharkhand: '20', Odisha: '21',
    Chhattisgarh: '22', 'Madhya Pradesh': '23', Gujarat: '24', 'Dadra and Nagar Haveli and Daman and Diu': '26', Maharashtra: '27', Karnataka: '29', Goa: '30', Lakshadweep: '31', Kerala: '32',
    'Tamil Nadu': '33', Puducherry: '34', 'Andaman and Nicobar Islands': '35', Telangana: '36', 'Andhra Pradesh': '37', Ladakh: '38',
  };
  const CIN_ST = { TS: 'TG', OD: 'OR', UK: 'UR' }; // MCA's state codes where they differ from the vehicle ones
  const TAN_CITY = { 'New Delhi': 'DEL', Mumbai: 'MUM', Kolkata: 'CAL', Chennai: 'CHE', Bengaluru: 'BLR', Hyderabad: 'HYD', Pune: 'PNE', Ahmedabad: 'AHM', Jaipur: 'JPR', Lucknow: 'LKN', Kanpur: 'KNP', Bhopal: 'BPL', Nagpur: 'NGP', Patna: 'PTN', Ranchi: 'RCH', Bhubaneswar: 'BBN', Surat: 'SRT', Vadodara: 'BRD', Rajkot: 'RKT' };
  // the city's RTO numbers (vehicle registration)
  const RTO = {
    'New Delhi': '01,02,03,04,05,06,07,08,09,10,11,12,13', Noida: '16', Gurugram: '26', Lucknow: '32', Kanpur: '78', Jaipur: '14', Chandigarh: '01', Ludhiana: '10', Dehradun: '07', Bhopal: '04', Indore: '09',
    Mumbai: '01,02,03,47', Pune: '12,14', Thane: '04', Nagpur: '31,49', Nashik: '15', Ahmedabad: '01,27', Surat: '05', Vadodara: '06', Rajkot: '03', Panaji: '07',
    Bengaluru: '01,02,03,04,05,51,53', Mysuru: '09', Mangaluru: '19', Chennai: '01,02,05,07,09,10', Coimbatore: '37,38', Madurai: '58,59', Hyderabad: '09,10,11,13', Warangal: '03',
    Visakhapatnam: '31', Vijayawada: '16', Kochi: '07', Thiruvananthapuram: '01', Kolkata: '02,06', Howrah: '11,12', Siliguri: '74', Patna: '01', Gaya: '02', Ranchi: '01', Jamshedpur: '05',
    Bhubaneswar: '02', Cuttack: '05', Guwahati: '01',
  };
  const NIC = [[/Infotech|Technolog|Softech|Systems/, '72200,72900'], [/Consult/, '74140,74999'], [/Logistic/, '63090,60231'], [/./, '51909,51101,52190']];
  const SERIES = 'ABCDEFGHJKLMNPRSTUVWXYZ'; // no I / O / Q
  function business(p, C, ascii) {
    const ids = {}, sa = p.stateAbbr || 'DL', co = String(p.company || 'A'), initial = (co.replace(/[^A-Za-z]/g, '')[0] || 'A').toUpperCase(), year = new Date().getFullYear();
    // the company's PAN: 4th letter C for a company, F for an LLP; 5th its name's initial
    p.companyPan = R.letters(3) + (/\bLLP\b/.test(co) ? 'F' : 'C') + initial + R.digits(4) + R.letters(1);
    if (GST[p.state]) { const g = GST[p.state] + p.companyPan + R.pick(['1', '1', '1', '2']) + 'Z'; ids.gstin = g + gstCheck(g); }
    ids.tan = (TAN_CITY[p.city] || ascii(p.city).toUpperCase().padEnd(3, 'X').slice(0, 3)) + initial + R.digits(5) + R.letters(1);
    ids.cin = `U${R.pick(S(NIC.find(([re]) => re.test(co))[1]))}${CIN_ST[sa] || sa}${R.int(1995, year - 1)}PTC${R.digits(6)}`;
    ids.udyam = `UDYAM-${sa}-${R.pad(R.int(1, 40), 2)}-${R.pad(R.int(1000, 2999999), 7)}`;
    ids.uan = R.pick(['10', '11']) + R.digits(10);
    const rto = RTO[p.city] ? S(RTO[p.city]) : [R.pad(R.int(1, 20), 2)];
    ids.vehicle = `${sa} ${R.pick(rto)} ${sa === 'DL' ? R.pick(['C', 'S']) + R.letters(1, SERIES) : R.letters(2, SERIES)} ${R.pad(R.int(1, 9999), 4)}`; // Delhi: category letter + series
    return ids;
  }
  // CPF / CNPJ check digits: weighted sum mod 11, a remainder under 2 gives 0
  const mod11 = (d, w) => { const r = d.reduce((t, x, i) => t + x * w[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  const down = (from, n) => Array.from({ length: n }, (_, i) => from - i); // CPF: 10..2, then 11..2
  const cnpjW = (n) => Array.from({ length: n }, (_, i) => ((n - 1 - i) % 8) + 2); // CNPJ: 5,4,3,2,9..2, then 6,5,4,3,2,9..2
  const digitsOf = (n) => { let d; do d = R.digits(n).split('').map(Number); while (new Set(d).size === 1); return d; };
  function cpf() {
    const d = digitsOf(9);
    d.push(mod11(d, down(10, 9))); d.push(mod11(d, down(11, 10)));
    const s = d.join('');
    return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`;
  }
  function cnpj() {
    const d = digitsOf(8).concat([0, 0, 0, 1]); // head office: branch 0001
    d.push(mod11(d, cnpjW(12))); d.push(mod11(d, cnpjW(13)));
    const s = d.join('');
    return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
  }

  G.FG_PROFILE = function (p, C, cl, ascii, familyName) {
    if (C.code === 'IN') {
      if (place(p)) p.fullAddress = [p.address1, p.address2, `${p.city}, ${p.state} ${p.zip}`].filter(Boolean).join(', ');
      (p.locations || []).forEach(place);
    }
    const maxExp = Math.max(1, Math.min(12, p.age - 22));
    p.experience = R.int(1, maxExp);
    const quals = C.code === 'IN' ? QUAL_IN : QUAL_GEN;
    p.qualification = R.pick(p.age < 25 ? quals.filter((q) => !/^M\.|^M[A-Z]|Master/.test(q)) : quals);
    p.university = R.pick(C.code === 'IN' ? UNI_IN[cl.id] || UNI_IN.north : UNI[C.code] || UNI.US);
    p.gradYear = Math.max(p.dob.y + 18, Math.min(new Date().getFullYear() - 1, p.dob.y + R.int(21, 23)));
    if (C.code === 'IN') {
      const reg = LANG_IN[p.state] || 'Hindi';
      p.languages = [...new Set(['English', 'Hindi', reg])];
      p.motherTongue = reg;
    } else {
      p.languages = LANG[C.code] || ['English'];
      if (C.code === 'CA' && p.state === 'Quebec') p.languages = ['French', 'English'];
      p.motherTongue = p.languages[0];
    }
    const subs = SUBJECTS.slice().sort(() => Math.random() - 0.5);
    p.teachSubjects = (C.code === 'IN' ? subs.concat('Hindi') : subs).slice(0, 2);
    p.skills = SKILLS.slice().sort(() => Math.random() - 0.5).slice(0, 3);
    const qShort = p.qualification.replace(/\s*\(.*\)/, '');
    p.bio = `I work as ${/^[AEIOU]/.test(p.jobTitle) ? 'an' : 'a'} ${p.jobTitle} in ${p.city} with ${p.experience} year${p.experience > 1 ? 's' : ''} of experience. ` +
      `I completed my ${qShort} from ${p.university} and enjoy explaining things simply and patiently.`;
    Object.assign(p, bank(p, C, ascii));
    const [dates, dlYear] = docDates(p, C);
    p.ids = ids(p, C, familyName, dlYear); // an Indian licence number carries the year it was first issued
    if (C.code === 'IN') Object.assign(p.ids, business(p, C, ascii));
    else if (C.code === 'BR') Object.assign(p.ids, { cpf: cpf(), cnpj: cnpj() });
    p.idDates = dates;
    if (p.ids.pan) p.pan = p.ids.pan;
    if (p.ids.aadhaar) p.aadhaar = p.ids.aadhaar;
    for (const k of ['gstin', 'tan', 'cin', 'udyam', 'uan', 'vehicle', 'cpf', 'cnpj']) if (p.ids[k]) p[k] = p.ids[k];
    p.bloodGroup = weighted(BLOOD);
    p.noticePeriod = R.pick(NOTICE);
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
