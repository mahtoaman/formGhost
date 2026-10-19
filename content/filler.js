/*!
 * FormGhost - https://github.com/mahtoaman/formghost
 * Copyright 2026 Aman Mahto (@mahtoaman)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 */
/* FormGhost: page filler. Injected on demand after content/widgets.js, qa.js and overlay.js (each optional: used when present);
   exposes window.__formGhost = { v, fill(persona, options), undo(fillId), inspect(root, opts), overlay(on, opts), records(), insertEdge(kindId, options),
   modal(), where() } for the background. fill() returns { count, used: { password?, fieldKey? }, report: { filled, skipped: { reason: n } } },
   or a Promise of it while it waits on the page (a date picker's calendar, a widget's list, an editor's own update); undo() likewise
   returns a count or a Promise of one. Options beyond the settings: rules [{ match, value }], overrides [{ key, type }], forceType,
   edgeMode, sampleFiles, testCards. */
(() => {
  const VERSION = (() => { try { return chrome.runtime.getManifest().version || 'dev'; } catch (e) { return 'dev'; } })();
  if (window.__formGhost && window.__formGhost.v === VERSION) return;

  /* the other content scripts (window.__fgExt.widgets / qa / overlay), when injected */
  const ext = (n) => { const x = window.__fgExt && window.__fgExt[n]; return x && typeof x === 'object' ? x : null; };
  const rint = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const pad = (n) => String(n).padStart(2, '0');
  const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const DAY = 864e5;

  const SENTENCES = [
    'I would like to know more about your services and pricing.',
    'Please get in touch with me at your earliest convenience.',
    'Looking forward to hearing back from your team soon.',
    'I am interested in a quick demo sometime next week.',
    'Kindly share the available options and the next steps.',
    'This is a test submission to check the form flow.',
    'Could you please confirm the timeline for this request?',
    'Thank you for the quick support last time, it really helped.',
  ];
  const SUBJECTS = ['Product enquiry', 'Request for a callback', 'Question about pricing', 'Partnership opportunity', 'Support request', 'Feedback'];
  const WORDS = ['bright', 'summit', 'harbor', 'maple', 'nova', 'river', 'atlas', 'coral', 'echo', 'pixel', 'cedar', 'orbit'];
  const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
  const MONTH_NAMES = 'January February March April May June July August September October November December'.split(' ');
  const monthOf = (s) => { const m = norm(s).match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?$/); return m ? MONTHS.indexOf(m[1]) + 1 : 0; };

  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file', 'search']);

  const AC = {
    'given-name': 'firstName', 'additional-name': 'middleName', 'family-name': 'lastName', name: 'fullName', nickname: 'username',
    email: 'email', username: 'username', 'new-password': 'password', 'current-password': 'password',
    tel: 'phone', 'tel-national': 'phone', 'tel-local': 'phone', 'tel-country-code': 'phoneCode', 'tel-area-code': 'areaCode',
    'street-address': 'address1', 'address-line1': 'address1', 'address-line2': 'address2', 'address-line3': 'address2', 'address-level3': 'address2',
    'address-level2': 'city', 'address-level1': 'state', 'postal-code': 'zip',
    country: 'country', 'country-name': 'country', organization: 'company', 'organization-title': 'jobTitle',
    bday: 'dob', 'bday-day': 'dobDay', 'bday-month': 'dobMonth', 'bday-year': 'dobYear',
    sex: 'gender', url: 'website', 'honorific-prefix': 'title', 'one-time-code': 'otp', language: 'languages', 'transaction-amount': 'amount',
  };
  const AC_IGNORE = /^(section-.*|shipping|billing|home|work|mobile|fax|pager|webauthn)$/;

  const EMAIL = /\be ?mail|(?<!voic)email|courriel|\bcorreo\b|posta elettronica/;
  const PHONE = /phone|mobile|\bmob\b|\btel\b|telephone|\bcell\b|whats ?app|landline|contact ?(no|num)|msisdn|\b(no|nomor|nombor) ?hp\b|telefon|tel[eé]fono|\bhandy\b|\bmobil(nummer|telefon)?\b|celular|cellulare|\bm[oó]vil\b|\bportable\b|telem[oó]vel|rufnummer/;
  const PHONECODE = /country ?code|dial ?code|calling code|\bisd\b|phone ?code/;
  const PREFIX = /(phone|mobile|tel(ephone)?|dial(l?ing)?|calling|country|isd) ?prefix/;
  const OTP = /\botp\b|one ?time ?(pass|code)|verification ?code|verify ?code|digit ?code|enter (the )?code|sms ?code|security ?code|confirmation ?code|auth(entication)? ?code|passcode/;
  const NOT_OTP = /postal|post ?code|zip|pin ?code|country|dial|promo|coupon|discount|voucher|ifsc|sort|swift|referral|invite|area|\bstd\b|branch|bank|captcha|employee|staff|student|member|customer|course|product/;
  const SENT = /\bsent\b|receiv|\bsms\b|\btexted\b/; // a PIN that was sent to you is a one-time code
  /* hard skips: payment cards, SSNs, promo / referral codes */
  const NONPAY = /\b(pan|aadha?ar|id|identity|voter|ration|health|membership|member|library|student|loyalty|employee|staff|business|visiting|sim|access|insurance|abha|election|metro|club|smart|e ?shram|shram|ayushman|bharat|golden|pm ?jay|jay|job|mgnrega|nrega) ?card\b/g;
  const CARD = /card ?(no|num|number)|\bcc ?(num|no|number|exp)\b|cvv|cvc|\bcsc\b|name on (the )?card|card ?holder|\bssn\b|social security/;
  const CARDNUM = /card ?(no|num|number)|\bcc ?(num|no|number)\b/;
  const CARD_EXP = /\bexp(iry|iration|ires) ?(month|year|date|mm|yy|mo|yr)\b|(?<!d ?\/ ?)\bmm ?\/ ?yy\b/;
  const EXP_BARE = /\bexp ?(month|year|date|mm|yy|mo|yr)\b/; // exp_month: card expiry, unless the label says work experience
  /* an expiry is a card's in a card form, when the label says card, or when it is just a month / year / MM/YY with no document named */
  const CARDISH = /\bcards?\b|\bcc\b|\bcc ?exp|credit|debit|payment|billing|valid ?thru|\bcvv|\bcvc/;
  const DOCISH = /passport|\bpp\b|licen[cs]e|\bdl\b|\bvisa\b|permit|\bid\b|identity|document|policy|insurance|membership|warranty|subscription|registration|certificate|product|medicine|batch|\boffer\b|contract|lease|agreement|domain|\bpan\b|aadha?ar|voter|\bkyc\b/;
  const NONCARD_D = /passing|graduat|complet|joining|\bjoin|\bstart|\bfrom\b|\bsince\b|\bissu|birth|\bdob\b|admission|enrol/;
  const CODES = /captcha|coupon|voucher|\bpromo(tional)? ?(code)?\b|gift ?card|\b(referral|referrer|invite|invitation|discount) ?(code|id|no|num|number|key|token)\b/;
  /* card fields served from the payment provider's own iframe (checkout and dashboard pages are left to the per-field rules) */
  const PAY_FRAME = /^(js\.stripe\.com|[\w-]+\.stripe\.network|assets\.braintreegateway\.com|checkoutshopper-[\w-]+\.adyen(payments)?\.com)$/;
  /* hints that beat the input type */
  const KYC = /(name|holder).{0,20}as (per|in|on)|holder'?s? ?name|name of (the )?(account ?)?holder|beneficiary ?name|name on (the )?(pan|aadha?ar|passport|account|bank)|(aadha?ar|\bpan|passport) ?(card )?name\b/;
  const MPIN = /\bm ?pin\b|(transaction|txn|atm|upi|security|login|secret|card) ?pin\b(?! ?code)|(set|create|choose|confirm|re ?enter|new) ?(a |your |new )?pin\b(?! ?code)/;
  const ZIP = /\bzip|post(al)? ?code|\bpin ?code|\bpincode|\bpin\b|\bpostal\b(?! ?addr)|\bplz\b|postleitzahl|\bcep\b|codice postale|c[oó]digo postal/;
  const POSTAL = /pin ?code|\bpincode|post(al)? ?code|\bpostal\b|\bzip|\bplz\b|postleitzahl|\bcep\b/;
  const PWD = /pass ?word|passwd|\bpwd\b|passwort|kennwort|mot de passe|contrase[ñn]a|\bsenha\b/;
  const EXT = /\b(ext|extn|extension)\b(?! ?(comp|gen|el|\d))/; // not ExtJS ids (ext-comp-1003, ext-gen1018)
  const ADDR = /addr|street|city|district|locality|landmark|village|taluk|tehsil|postal|shipping|billing|deliver|adress|stra(ss|ß)e|direcci|endere[cç]o|indirizzo|\bort\b|ville|ciudad|cidade|bairro|\bplz\b|\bcep\b/i;
  const IDLAST = /last ?(\d|three|four|five|six) ?(digits?|characters?|chars?|letters?|numbers?)\b/;
  const ACCT = /account ?(no|num|number)|\ba ?c ?(no|number)\b|acc ?(no|num)\b|bank ?account/;
  const CONTACT_NO = /(phone|mobile|\bmob|whats ?app|\bcell|tel(ephone)?|contact) ?(no|num|number)\b/;
  /* "DOB as per PAN", "State as per Aadhaar", "Aadhaar seeded account": mentions the document, asks for something else */
  const DOC_ATTR = /date|birth|\bdob\b|place|issu|valid|expir|address|gender|\bsex\b|\bstate\b|city|district|pin ?code|photo|copy|upload|scan|type|status|seeded|linked/;
  const notAttr = (re) => new RegExp(`^(?!.*(${DOC_ATTR.source})).*(${re.source})`);
  const REFID = /(order|reference|\bref|transaction|\btxn|invoice|booking|tracking|ticket|receipt|payment|request|complaint|claim|\bcase|application|policy|shipment|awb) ?(id|no|num|number|#)\b|\butr\b/;
  const ORGID = /(employee|\bemp|staff|student|membership|member|customer|client|candidate|applicant|roll|admission|enrol?lment|registration|consumer|patient|vendor|supplier|agent|dealer|partner) ?(id|code|no|num|number)\b/;
  const DOCID = /(licen[cs]e|passport|voter|epic|cnic|\bnid|national ?id|emirates ?id|identity|document|govt ?id|government ?id|\bkyc|\bdni|\bnin|\bid) ?(card ?)?(no|num|number)\b|(passport|licen[cs]e|voter ?id|\bepic|cnic|national ?id|emirates ?id)\b/;
  const AMOUNT = /\bamount\b|\bsalary\b|\bprice\b|\bbudget\b|\bincome\b|\bctc\b|\bfees?\b|\bcost\b|\bturnover\b|\brevenue\b|\bstipend\b|\bdonation\b/;
  const AMT_NOT = /source|currency|mode|method|frequency|proof|slip|type|certificate/;
  const RATE = /per ?hour|hourly|\brate\b|per (class|session|lesson)/;
  const QTY = /quantity|\bqty\b|how many|\b(number|no|num) of (?!years?\b)|\bcount\b/;
  /* someone else's details (emergency contact, nominee, spouse, a reference) and the persona's second phone / email */
  const EMERG = /emergency|next ?of ?kin|\bice\b/, NOMINEE = /nominee|nomination/;
  // a section title says less than a field's own label ("Emergency plumbing request", "Award nominations" hold the persona's own details)
  const EMERG_SEC = /emergency contact|in case of emergency|next ?of ?kin|\bice contact|emergency (person|details|info)/, NOMINEE_SEC = /\bnominee/;
  const PARTNER = /\b(life ?)?partner\W{0,2}s? ?((full|first|last|middle|given|family) ?|sur)?name\b/;
  const OTHER = /\breferee|\breferred by\b|\breferences? ?\d* ?('?s )?(full ?)?(name|phone|mobile|tel|e ?mail|contact|designation|relation|person|occupation|company|organi|years|known)|co ?applicant|\bdoctor|physician|guarantor|\b(secondary|alternate|alternative|other|additional) contact ?(person|name)/;
  // block titles: "References", "Reference 2" / "Reference #2" / "Reference-3", "Professional reference", "Co-applicant details"
  const OTHER_SEC = /\breferences\b|\breferees?\b|\breference ?(no ?)?\d|\b(professional|personal|character|work|employment|employer|academic|business|job|first|second|third|1st|2nd|3rd)( ?\/ ?\w+)? reference\b|^ ?reference( (details?|information|info|contact|person))? ?$|co ?applicant|guarantor|\b(secondary|alternate|alternative|additional) contact person/;
  /* people the persona names as references (P.references): referees, co-applicants, guarantors, an alternate contact person; not doctors or "referred by" */
  const REF_WHO = /\breferee|\breferences?\b|\bref ?\d|co ?applicant|guarantor|\b(secondary|alternate|alternative|other|additional) contact ?(person|name)/;
  const OWN = /\b(your|my|own|self|employee|student|candidate|patient|customer|applicant'?s?)\b/; // names the persona: a section title doesn't make it someone else's
  const PERSONISH = /name|person|contact|phone|mobile|\btel|e ?mail|relation|designation|occupation|profession|position|title|company|organi|employ|income|salary|qualification|education|birth|\bdob\b|\bage\b|\bid\b|number|\bno\b|aadha?ar|\bpan\b|passport|licen[cs]e|voter/;
  const WHO_WORDS = /\b(emergency|nominee|nomination|spouse|husband|wife|partner|next|kin|ice|in|case|of|an?|the|your|s|details?|info(rmation)?|\d+)\b/g;
  const ALT = '(alternate|alternative|alt|secondary|other|additional|another|second|2nd|recovery|backup)';
  const ALT_PHONE = new RegExp(`\\b${ALT}\\b ?(contact ?)?(phone|mobile|\\bmob\\b|\\btel\\b|telephone|\\bcell\\b|whats ?app|(no|num|number)\\b(?! of))|(phone|mobile|\\bcell|\\btel(ephone)?|contact ?(no|num|number))( ?(no|num|number))? ?(alternate|alternative|alt|secondary|second)\\b`);
  const ALT_EMAIL = new RegExp(`\\b${ALT}\\b ?(e ?mail|email)|(e ?mail|email)( ?(id|address))? ?(alternate|alternative|alt|secondary|recovery|backup)\\b`);
  const ALT_CONTACT = new RegExp(`\\b${ALT}\\b ?contact\\b(?! ?(person|name))`); // "Alternate contact" in a tel box
  /* "Phone 2", "Email II": only when the page shows it, never from a name / id alone ("email-2" is often a form builder's copy of the form) */
  const ALT_PHONE_N = /(phone|mobile|\bcell|\btel(ephone)?|contact ?(no|num|number))( ?(no|num|number))? ?(2|ii)\b/, ALT_EMAIL_N = /(e ?mail|email)( ?(id|address))? ?(2|ii)\b/;
  const NOT_ALT = /confirm|re ?enter|re ?type|repeat|verify|again|same as/;
  /* a fixed line: P.landline (STD code + number) */
  const LANDLINE = /land ?line|\b(office|residence|residential|resi|res)\.? ?(phone|tel(ephone)?|no|number|contact ?(no|number))\b/;
  const WITH_STD = /\b(with|incl(uding)?|plus|and|along with) (the )?std\b|\bstd ?(code)? ?(\+|and|&|with|plus) ?(the )?(phone|tel(ephone)?|land ?line|number|no)\b/;
  const MARITAL = /marital|(marriage|civil|relationship) ?status|\bmarried\b|familienstand|estado civil|[ée]tat civil|stato civile|situation (de famille|familiale|matrimoniale)/;
  const HOUSEHOLD = /\b(household|family) ?size\b|\b(number|no|num|count|total) of (people|persons|members) (living )?in (the |your )?(family|household)|\b(number|no|num|count|total) (of )?(family|household) members|members in (the |your )?(family|household)|how many (people|persons|members) (live|stay|are)/;
  const HOUSE_NOT = /name|relation|detail|occupation|\bage\b|income|birth|\bdob\b|education|aadha?ar|\bid\b/;
  const SCHEME = /e ?shram|\buan\b|ayushman|golden ?card|\babha\b|pm ?jay|nrega|job ?card|ration ?card|\bhealth ?id\b/;
  const SCHEME_NOT = /name|holder|type|category|colou?r|status|photo|copy|upload|scan|issu|valid|date|\bhave\b|whether|do you|linked|seeded|mobile|phone|e ?mail|\bstate\b|district/;
  const BLOCK_NOT = /\b(no|num|number|flat|tower|building|house|floor|wing|street|apartment|apt|unit|plot|sector|phase|lot|letters?|capitals?|caps|uppercase|print|road|blk)\b|address|(full|first|last|middle|given|family|your) ?name|surname/;
  const ADDR_NAMED = /address|\baddr\b|street|house|line ?\d|adress|stra(ss|ß)e|direcci|endere[cç]o|indirizzo/; // "Address (Village, Post Office, District)" is the address, not one of its parts
  const LOCATION_NOT = /address|street|\bid\b|code|url|link|\bmap|coordinat|latitude|longitude|\blat\b|\blng\b|accuracy|share|access|service|permission|enable|allow|\btype\b|\bgps\b|remote|onsite|hybrid/;
  const RELATION_NOT = /status|manager|officer|executive|\bid\b|number|\bno\b|since|years?\b|\btype\b|\bbank|company|organi|employ|customer|client|business/;
  const EXPIRY = /expir|valid ?(till|until|upto|up ?to|thru|through)\b/;
  const RULES = [
    ['skip', /captcha/],
    ['email', EMAIL],
    ['password', PWD],
    ['upi', /\bupi\b|\bvpa\b/],
    ['ifsc', /\bifsc\b/],
    ['iban', /\biban\b/],
    ['swift', /swift|\bbic\b/],
    ['sortCode', /sort ?code/],
    ['bsb', /\bbsb\b/],
    ['routing', /routing|\baba\b|transit/],
    ['accountNumber', ACCT],
    ['bankName', /bank ?name|name of (the )?bank|^ ?bank ?$/],
    ['branch', /branch/],
    ['idLast', IDLAST],
    ['pan', notAttr(/\bpan\b/)],
    ['aadhaar', notAttr(/aadha?ar/)],
    ['idType', /which id|id ?type|type of id|document type|id ?proof|identity proof|proof of (identity|id)\b|kyc document|government id/],
    ['username', /user ?name|\blogin\b|user ?id|\bhandle\b|nick ?name|screen ?name|benutzer|utilisateur|usuario|usu[aá]rio|\butente\b|identifiant/],
    ['fatherName', /father|guardian|parent|(name des|nome do|nombre del|nom du) (vaters|pai|padre|p[èe]re)|vater ?name/],
    ['motherName', /mother ?'?s? ?(\/ ?(spouse|husband) ?'?s? ?)?(maiden )?name|maiden ?name|(name der|nome da|nombre de la|nom de la) (mutter|m[ãa]e|madre|m[èe]re)|mutter ?name|geburtsname|nom de jeune fille/],
    // Vorname / Prénom / Nombre / Nome; "Nome" / "Nombre" alone is a first name only next to a surname field (classify)
    ['firstName', /first ?name|\bf ?name\b|given ?name|fore ?name|(?<!zweiter )vorname|(?<!deuxi[èe]me )pr[ée]nom|primeiro nome|primer nombre|(?<!segundo |secondo )\bnombres?\b(?! ?(de|del|y|completo)\b)|(?<!segundo |secondo )\bnome\b(?! ?(da|do|de|della|dello|dell|di|del|e|completo|utente)\b)/],
    ['lastName', /last ?name|\bl ?name\b|sur ?name|family ?name|nachname|familienname|zuname|nom de famille|apellidos?|sobrenome|cognome|apelidos?|(?<![a-zà-ÿ])nom\b(?! ?(de (l|la|le|votre|vos)\b|du |des |d'|complet|et |d utilisateur))/],
    ['middleName', /middle ?name|\bm ?name\b|zweiter vorname|segundo nombre|secondo nome|nome do meio|deuxi[èe]me pr[ée]nom/],
    ['gradYear', /(passing|graduation|completion) ?year|year of (passing|graduation|completion)/],
    ['experience', /experience|\bexp\b(?! ?(month|year|date|mm|yy|mo|yr)\b)|years? (of|in)|how many years|erfahrung|exp[ée]rience|experiencia|experi[êe]ncia|esperienza/],
    ['qualification', /qualification|education|degree|highest|course|(name of (the )?|last |qualifying |previous )exam(ination)?\b|\bexam(ination)? (name|passed)\b|ausbildung|abschluss|escolaridade?|titolo di studio|forma[cç][aã]o/],
    ['university', /university|college|institut|school|alma mater|universit|hochschule|[ée]cole|escuela|escola|scuola|facultad|faculdade/],
    ['languages', /languages?|mother ?tongue|sprache|langue|idioma|lingua/],
    ['teachSubjects', /subjects|subject.*(teach|tutor)|(teach|tutor).*subject|expertise|speciali[sz]/],
    ['skills', /skills?|f[äa]higkeiten|kenntnisse|comp[ée]tences|habilidades|competencias|compet[êe]ncias|competenze/],
    ['website', /web ?site|\burl\b|home ?page|portfolio|linked ?in|webseite|site (web|internet)|sitio web|p[aá]gina web|sito web/],
    ['bio', /about (you|yourself|me)|\bbio\b|introduce|describe yourself|summary|profile|cover letter|why (do )?you/],
    ['company', /^(?!.*(address|adresse|direcci|endere|indirizz)).*(company|organi[sz]ation|business ?name|employer|\bfirm\b|\borg\b|\bfirm(a|en)|unternehmen|arbeitgeber|entreprise|soci[ée]t[ée]|employeur|empresa|empleador|azienda|societ[àa]|datore di lavoro|raison sociale|raz[aã]o social)/],
    ['jobTitle', /job ?title|designation|position|occupation|profession|\brole\b|beruf|\bposte\b|fonction|profesi[oó]n|profiss[aã]o|professione|ocupaci[oó]n|ocupa[cç][aã]o|occupazione|\bpuesto\b|mansione/],
    ['zip', ZIP],
    ['neighborhood', /\bbairro\b|\bbarrio\b|\bcolonia\b|\bquartier\b/],
    ['address2', /address ?(line)? ?(2|3|two|three)\b|\baddr ?2|\bapt\b|apartment|suite|\bunit\b(?! ?(price|cost|rate|of|type|size))|landmark|locality|\barea\b(?! ?(code|of))|adresszusatz|compl[ée]ment|complemento/],
    ['address1', /address|street|\baddr\b|house|\bflat\b|building|line ?1|stra(ss|ß)e|\bstr\b|adresse|direcci[oó]n|endere[cç]o|indirizzo|\bmorada\b|\brua\b|logradouro|\bcalle\b/],
    ['city', /\bcity\b|\btown\b|district|suburb|municipality|place of birth|birth ?place|place of (issue|issuance)|issued at|issuing (office|authority|city|place)|\bort\b|wohnort|\bstadt\b|\bville\b|ciudad|localidad|cidade|citt[aà]|\bcomune\b|munic[ií]pio|localit[aà](?![a-z])|geburtsort|lieu de naissance|lugar de nacimiento|local de nascimento|luogo di nascita/],
    ['country', /country|\bnation(ality)?\b|\bpays\b|\bpa[ií]s\b|\bpaese\b|\bnazione\b|nacionalidad|nacionalidade|nationalit[ée]|staatsangeh[öo]rigkeit|nazionalit[àa]/],
    ['state', /\bstate\b|province|region|county|prefecture|territory|bundesland|r[ée]gion|provincia|\bestado\b|\buf\b|kanton|d[ée]partement/],
    ['dob', /birth|\bdob\b|\bbday\b|geburt|naissance|nacimiento|nascimento|nascita/],
    ['gender', /gender|\bsex\b|geschlecht|\bsexe\b|\bsexo\b|\bsesso\b|\bg[éêe]nero\b/],
    ['title', /salutation|\bprefix\b|honorific|anrede|civilit[ée]|tratamiento|tratamento/],
    ['fullName', /full ?name|your ?name|\bname\b|applicant|contact ?person|holder|vollst[äa]ndiger name|nom complet|nombre completo|nome completo/],
    ['subject', /subject|topic|heading|betreff|\bobjet\b|asunto|assunto|oggetto/],
    ['message', /message|comment|feedback|description|details|query|enquiry|inquiry|\bnotes?\b|remarks|nachricht|mitteilung|kommentar|bemerkung|anmerkung|anliegen|mensaje|mensagem|messaggio|comentario|coment[aá]rio|commento|observaci|observa[cç]|osservazion/],
    ['date', /\bdate\b|working day|\bvalidity\b|valid ?from|issued? on\b|\bdatum\b|\bfecha\b|\bdata (de|di|da|do)\b/],
    ['rate', RATE],
  ];
  /* other languages' "Name and surname", and a house number box of its own (DE / FR / ES / PT / IT) */
  const FULL_INTL = /vollst[äa]ndiger name|vor ?und ?(nach|zu)name|nom complet|nom et pr[ée]nom|pr[ée]nom et nom|nombre completo|nombres? y apellidos?|apellidos? y nombres?|nome completo|nome e cognome|cognome e nome/;
  const SURNAME = /sobrenome|apellido|cognome|nachname|last ?name|surname|family ?name|nom de famille/;
  const HOUSE_NO = /^(?!.*(stra(ss|ß)e|street|adress|address|\brua\b|calle|direcci|endere|indirizz)).*(hausnummer|\bhausnr\b|\bhnr\b|num[ée]ro de (rue|voie)|numero civico|n ?civico|n[uú]mero (exterior|interior|da casa))/;
  const BARE_NO = /^\s*(n[uú]mero|nº|n°|nr|hnr)\s*$/; // "Número *": flat() leaves the star as spaces
  const AGE = /(?<![a-z])(age|âge|alter|edad|idade|età)(?![a-z])/, BIRTH = /birth|\bdob\b|geburt|naissance|nacimiento|nascimento|nascita/;
  const MOTHER_T = /mother|mutter|maternelle|materna|madrelingua/;
  /* national ID numbers named in other languages: the persona's national ID */
  const ID_INTL = /codice fiscale|steuer ?(id|identifikationsnummer|nummer)|personalausweis|ausweisnummer|\bnif\b|\bnie\b|\bdni\b|carte d'identit|documento (de|di) identi|n[uú]mero de (identidad|documento|identifica)|carta d'identit/;
  /* Indian business / ID numbers and Brazil's CPF / CNPJ (the persona's, when it has them) */
  const BIZ = [
    // the identifier only: "Price (incl. GST)", "Total GST", "GST %" are amounts
    ['gstin', /\bgsti?n\b|\bgst ?(no|num|number|registration|reg|regn|id)\b|goods (and|&) services tax ident/],
    ['udyam', /udyam|udyog ?aadha?ar|\bmsme ?(registration|reg|regn|no|num|number|id)\b|\buam ?(no|num|number)\b/],
    ['tan', /\btan ?(no|num|number)?\b(?! ?colou?r)|tax deduction (and collection )?account/],
    ['cin', /\bcin ?(no|num|number)?\b|corporate identi(ty|fication) (no|num|number)|\bllpin\b/],
    ['uan', /\buan\b|universal account (no|num|number)|\b(e?pf|provident fund) ?(account ?)?(no|num|number)\b/],
    ['vehicle', /vehicle ?(registration|reg|regn|rc)? ?(no|num|number|plate)\b|registration (no|num|number) of (the |your )?vehicle|\brc ?(no|num|number)\b|(number|licen[cs]e|registration) ?plate|kennzeichen|immatriculation|\bplaca\b|\btarga\b/],
    ['cpf', /\bcpf\b/], ['cnpj', /\bcnpj\b/],
  ];
  const BIZ_NOT = /\b(type|category|status|whether|do you|are you|have you|upload|copy|scan|photo|date|valid|expir|issu\w*|rate|amount|percent|treatment|applicable|exempt|certificate|holder|linked|seeded|price|total|fees?|cost|payable|mrp)\b|%|₹|e ?shram/;
  function bizCat(h) {
    if (BIZ_NOT.test(h) || PHONE.test(h) || EMAIL.test(h) || /\bname\b/.test(h) || (/aadha?ar|\bpan\b/.test(h) && !/udyog/.test(h))) return null;
    const b = BIZ.find(([, re]) => re.test(h));
    return b ? b[0] : null;
  }
  /* German "Land", Spanish "Cargo", Italian "CAP" are English words too ("Land owned", "Cargo type", "Market cap"): only as the whole label */
  const BARE_INTL = [['country', /^land( ?\/ ?region)?$/], ['jobTitle', /^cargo( (actual|que ocupa|desempe[ñn]ado|ocupado))?$/], ['zip', /^cap$/]];
  const bareIntl = (el, lab) => { const ts = (typeof lab === 'string' ? [flat(lab)] : shownParts(el)).map((t) => t.trim()), b = BARE_INTL.find(([, re]) => ts.some((t) => re.test(t))); return b ? b[0] : null; };
  /* the business's own name ("Legal Name of the Business (as in PAN)", "Trade name"), not a person's or an ID */
  const BIZ_NAME = /\b(trade|business|firm|company|entity|enterprise|establishment) ?name\b|\bname of (the )?(business|firm|company|entity|enterprise|establishment)\b(?! ?(owner|proprietor|partner|director|contact|person|representative|signatory|head|promoter))/;
  /* a PAN that is the business's (P.companyPan, the one inside its GSTIN): said by the field or its block, unless that names a person */
  const BIZ_WHO = /\b(business|company|firm|entity|enterprise|establishment|organi[sz]ation|llp|corporate|vendor|supplier|dealer|merchant|employer)\b/;
  const PERSON_WHO = /\b(promoter|director|partner|proprietor|owner|applicant|authori[sz]ed|signatory|individual|personal|your|my|contact person|karta|trustee|member)\b/;
  function bizPan(el) {
    const h = hintOf(el), sec = ' ' + sectionOf(el) + ' ';
    return !PERSON_WHO.test(h) && (BIZ_WHO.test(h) || (!PERSON_WHO.test(sec) && BIZ_WHO.test(sec)));
  }
  const AGREE = /agree|terms|accept|consent|privacy|policy|i have read|acknowledge|confirm|declare|authori[sz]e/;
  const NEG = /\b(do not|don.?t|not|no)\b.{0,25}(agree|accept|consent|want|wish|subscribe|share)|opt ?out|unsubscribe/;
  const DOWN = /\bothers?\b|prefer not|none of the above|\bn\/?a\b|not applicable|decline|rather not/;
  /* gender options and salutations, also in German / French / Spanish / Portuguese / Italian */
  const MALE = /\bmale\b|\bman\b|^m\b|m[äa]nnlich|\bhomme\b|\bhombre\b|masculin|\bmaschi(o|le)\b|\bherr\b|\buomo\b/;
  const FEMALE = /female|woman|^f\b|weiblich|\bfemme\b|\bmujer\b|f[ée]minin|femenin|femmin|\bmulher\b|\bfrau\b|\bdonna\b/;
  const GENDER_OPT = /\b(male|female|man|woman)\b|^m$|^f$|m[äa]nnlich|weiblich|\bhomme\b|\bfemme\b|\bhombre\b|\bmujer\b|masculin|f[ée]minin|femenin|\bmaschi(o|le)\b|femmin|\bmulher\b/;
  const SALUTE = /^(mr|mrs|ms|miss|herr|frau|monsieur|madame|mme|m|señor|señora|sr|sra|senhor|senhora|signor|signora|sig|sig\.ra)\.?$/i;
  const SAL_M = /^(mr|herr|monsieur|m|señor|sr|senhor|signor|sig)\.?$/, SAL_F = /^(ms|mrs|miss|frau|madame|mme|señora|sra|senhora|signora|sig\.ra)\.?$/;
  const ALIASES = ['telangana|ts|tg', 'odisha|orissa|od|or', 'puducherry|pondicherry|py', 'uttarakhand|uttaranchal|uk|ut',
    'delhi|new delhi|nct of delhi|delhi nct|nct delhi|national capital territory of delhi', 'bengaluru|bangalore', 'gurugram|gurgaon', 'kolkata|calcutta',
    'chennai|madras', 'mumbai|bombay', 'thiruvananthapuram|trivandrum', 'mysuru|mysore', 'mangaluru|mangalore', 'visakhapatnam|vizag|vishakhapatnam'].map((s) => s.split('|'));
  const aka = (x) => { const n = norm(x); return (n && ALIASES.find((a) => a.includes(n))) || [n]; };

  /* ---------- DOM helpers ---------- */
  function deepQuery(root, sel, out) {
    root.querySelectorAll(sel).forEach((e) => out.push(e));
    root.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) deepQuery(e.shadowRoot, sel, out); });
    return out;
  }
  const collect = (root, out) => deepQuery(root, 'input,select,textarea', out);
  const parentOf = (n) => n.parentElement || (n.parentNode && n.parentNode.host) || null; // crosses shadow roots
  const inside = (c, el) => { for (let n = el; n; n = parentOf(n)) if (n === c) return true; return false; };
  const deepActive = () => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; };
  const textOf = (n) => ((n && (n.innerText || n.textContent)) || '').replace(/\s+/g, ' ').trim();
  const cls = (n) => (n && n.getAttribute && n.getAttribute('class')) || '';
  function boxVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }
  function checkVisible(el) {
    if (boxVisible(el)) return true;
    if (el.labels && [...el.labels].some(boxVisible)) return true;
    return getComputedStyle(el).display !== 'none' && boxVisible(el.parentElement);
  }

  const short = (t) => (t && t.length < 80 ? t : '');
  /* the text of the elements an aria-labelledby / -describedby names; the control itself and its own content (MUI Select names itself to read
     out its value) only when nothing else is named */
  function idsText(el, attr) {
    const r = el.getRootNode(), xs = (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean).map((id) => (r.getElementById && r.getElementById(id)) || el.ownerDocument.getElementById(id)).filter(Boolean);
    const out = xs.filter((x) => x !== el && !el.contains(x));
    return (out.length ? out : xs).map(textOf).join(' ');
  }
  /* when nothing labels a control: a label-like element right after it, else its fieldset's legend */
  function looseLabel(el) {
    const n = el.nextElementSibling;
    if (n && (n.tagName === 'LABEL' || /label/i.test(cls(n))) && !n.matches('input,select,textarea,button') && !n.querySelector('input,select,textarea')) { const t = short(textOf(n)); if (t) return t; }
    const f = el.closest && el.closest('fieldset'), lg = f && [...f.children].find((c) => c.tagName === 'LEGEND');
    return lg ? short(textOf(lg)) : '';
  }
  /* a control in a grid (a header row "Name | Phone | Email" over rows of boxes): [its column's header text, header cells], or null */
  function colHead(el) {
    const td = el.closest && el.closest('td,th'), tr = td && td.parentElement, tb = tr && tr.closest('table');
    if (!tb || tr.tagName !== 'TR' || tr.cells.length < 2) return null;
    let c = 0;
    for (const x of tr.cells) { if (x === td) break; c += x.colSpan || 1; }
    const rows = [...tb.rows];
    for (let i = rows.indexOf(tr) - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.querySelector('input,select,textarea')) continue; // another row of the grid
      if (r.cells.length < 2) return null; // a title row across the table
      let k = 0;
      for (const x of r.cells) { k += x.colSpan || 1; if (k > c) return [short(textOf(x)), r.cells.length]; }
      return ['', r.cells.length];
    }
    return null;
  }
  function labelText(el) {
    const parts = [];
    // a <select> wrapped in its <label>: leave its option texts out of the label
    const own = (l) => { if (el.tagName !== 'SELECT' || !l.contains(el)) return textOf(l); const c = l.cloneNode(true); c.querySelectorAll('select').forEach((s) => s.remove()); return textOf(c); };
    if (el.labels) for (const l of el.labels) parts.push(own(l));
    if (el.getAttribute('aria-labelledby')) { const t = idsText(el, 'aria-labelledby'); if (t) parts.push(t); }
    const nx = el.nextElementSibling, pv = el.previousElementSibling; // a label right after it, checkbox style (not the next field's label)
    if (!parts.length && nx && nx.tagName === 'LABEL' && !nx.htmlFor && !(nx.nextElementSibling && nx.nextElementSibling.matches('input,select,textarea')) && !(pv && pv.tagName === 'LABEL')) { const t = short(textOf(nx)); if (t) parts.push(t); }
    if (!parts.length) {
      const [ch, wide] = colHead(el) || [null, 0];
      let node = el;
      for (let i = 0; i < 3 && node; i++) {
        if (node.tagName === 'TR' && ch != null) { if (ch) parts.push(ch); break; } // its column's header, not the whole header row
        let prev = node.previousElementSibling;
        while (prev && !textOf(prev)) prev = prev.previousElementSibling;
        if (prev && !prev.matches('input,select,textarea') && !prev.querySelector('input,select,textarea')) {
          const t = textOf(prev);
          if (t && t.length < 80) { parts.push(t); break; }
        }
        node = node.parentElement;
        if (!node || node.matches('form,body,fieldset')) break;
      }
      if (ch && wide >= 3 && parts.length && !parts.includes(ch)) parts.push(ch); // a row label ("Reference 1") + its column's ("Phone")
    }
    if (!parts.length && !el.getAttribute('placeholder') && !el.getAttribute('aria-label') && !el.title) { const t = looseLabel(el); if (t) parts.push(t); }
    return parts.join(' ').slice(0, 200);
  }

  const flat = (s) => ' ' + String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-\[\].:*()]+/g, ' ').toLowerCase().replace(/\s+/g, ' ') + ' ';
  /* flatpickr altInput: the real input turned type=hidden right before the visible read-only one */
  const flatHidden = (el) => { const p = el.previousElementSibling; return p && p.tagName === 'INPUT' && p.type === 'hidden' && p.classList.contains('flatpickr-input') ? p : null; };
  function hintOf(el) {
    const fh = el.tagName === 'INPUT' && flatHidden(el), fl = fh && fh.id && el.ownerDocument.querySelector(`label[for="${CSS.escape(fh.id)}"]`);
    return flat([el.name, el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('data-testid'),
      el.getAttribute('formcontrolname'), el.getAttribute('ng-model'), el.title, labelText(el), fh && fh.name, fh && fh.id, fl && textOf(fl),
      el.tagName === 'SELECT' && el.options[0] && isPlaceholderOpt(el.options[0]) && el.options[0].text].filter(Boolean).join(' '));
  }
  /* a control's own words: name, id, placeholder, aria-label, test id, title, its <label>s and aria-labelledby (no text found near it) */
  const attrHint = (el) => [el.getAttribute('name'), el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.getAttribute('formcontrolname'),
    el.getAttribute('title'), ...[...(el.labels || [])].map(textOf), idsText(el, 'aria-labelledby')].filter(Boolean).join(' ');
  /* what the page shows for a control (label, placeholder, aria-label), each on its own; name / id left out */
  const shownParts = (el) => [labelText(el), el.getAttribute('placeholder'), el.getAttribute('aria-label')].filter(Boolean).map(flat);

  /* radio / checkbox option text: its label, aria-label or the text right after it, plus a meaningful value */
  function optLabel(r) {
    let t = textOf(r.labels && r.labels[0]) || r.getAttribute('aria-label') || '';
    if (!t) { let s = r.nextSibling; while (s && s.nodeType === 3 && !s.textContent.trim()) s = s.nextSibling; if (s) t = s.nodeType === 3 ? s.textContent : textOf(s); }
    t = norm(t).slice(0, 80);
    const v = norm(r.value);
    return v && v !== 'on' && v !== t ? (t + ' ' + v).trim() : t;
  }

  function isCodeSelect(s) {
    if (!s || s.tagName !== 'SELECT') return false;
    const opts = [...s.options].slice(0, 300);
    const n = opts.filter((o) => /\+\s?\d{1,4}\b/.test(o.text) || /^\+\d{1,4}$/.test(o.value.trim())).length;
    return n >= 3 || (opts.length <= 3 && n >= 1);
  }

  /* a country button of its own next to the number ('+1 ▾', '🇺🇸 +1') */
  const CODE_BTN = /^\s*(?:[\u{1F1E6}-\u{1F1FF}]{2}\s*|[A-Z]{2}\s+)?\+\s?(\d{1,4})\s*[▾▼⌄˅▿⏷∨⌵▽🔽]?\s*$/u;
  /* 'inline': +code goes in the box; 'separate': a code picker / prefix shows the persona's code; 'other': a country button of an unknown
     widget showing another code, which is left alone (the number then goes in whole as +E.164 when the box takes a '+') */
  function codePicker(el, cc) {
    if (el.closest('.react-tel-input')) return 'inline'; // this widget expects +code inside the input
    if (el.closest('.iti,.intl-tel-input,.PhoneInput,.phone-input,.mat-mdc-form-field-prefix')) return 'separate';
    let n = el.parentElement;
    for (let i = 0; i < 3 && n; i++, n = n.parentElement) {
      for (const s of n.querySelectorAll('select')) if (isCodeSelect(s)) return 'separate';
      if (i < 2 && !n.matches('form,body')) for (const b of n.querySelectorAll('button,[role=button],[role=combobox],[aria-haspopup]')) {
        const m = b !== el && !b.contains(el) && (b.textContent || '').match(CODE_BTN);
        if (m) return m[1] === cc ? 'separate' : 'other';
      }
      for (const x of n.querySelectorAll('span,div,button,label,p,b,strong')) {
        if (x.children.length === 0 && /^\s*\+\d{1,4}\s*$/.test(x.textContent)) return 'separate';
      }
      for (const i2 of n.querySelectorAll('input')) {
        if (i2 !== el && /^\+?\d{1,4}$/.test(i2.value.trim()) && ((i2.maxLength > 0 && i2.maxLength <= 5) || /code/i.test(i2.name + i2.id + i2.placeholder))) return 'separate';
      }
    }
    return null;
  }

  /* ---------- opt-out, traps ---------- */
  const OFF = '[data-formghost=off i],[data-formghost=false i],[data-formghost=ignore i]';
  const within = (el, sel) => { for (let n = el; n; n = n.getRootNode().host) if (n.closest(sel)) return true; return false; }; // crosses shadow hosts
  const pageOff = () => [document.documentElement, document.body].some((n) => n && n.matches(OFF))
    || [...document.querySelectorAll('meta[name=formghost i]')].some((m) => /^\s*(off|false|ignore)\s*$/i.test(m.content));
  const HP = /^b_[0-9a-f]{8,}_|honey ?pot/i;
  const HP_SHORT = /\bhp\b|(^|[^a-z])hp_|_hp($|[^a-z])/i; // not when the field says HP out loud ("No. HP" handphone, "Engine HP") or is type=tel
  const HP_TXT = /if you.?(are|re) (a )?(human|real person)|leave (this|the) (field|box|input) (blank|empty)(?! ?(if|unless|to|for|when)\b)|(do not|don.?t) fill (this|me|in|out)\b(?! ?(field |box )?(if|unless)\b)/;
  const DIALOG = 'dialog,[role=dialog i],[role=alertdialog i],[aria-modal=true i],.modal';
  const up = (n) => n.assignedSlot || n.parentElement || (n.parentNode && n.parentNode.host); // flat tree, through slots and shadow hosts
  /* off-screen the honeypot way (left:-9999px, top:-5000px): left of or above the page with every scroller scrolled back to the start.
     Fields further down a scrolling panel or modal can be scrolled to, so only that side counts. */
  function offscreen(el, r) {
    let x = r.left + scrollX, y = r.top + scrollY;
    for (let n = up(el); n && n.nodeType === 1; n = up(n)) if (n !== document.scrollingElement) { x += n.scrollLeft; y += n.scrollTop; }
    return y + r.height <= 0 || (x + r.width <= 0 && getComputedStyle(el).direction !== 'rtl');
  }
  /* aria-hidden wrapper; a shown dialog that kept its copy-pasted aria-hidden="true" is not a trap */
  function ariaHidden(el) {
    for (let n = el; n; n = n.parentElement || (n.parentNode && n.parentNode.host)) if (/^true$/i.test(n.getAttribute('aria-hidden') || '') && !(n.matches(DIALOG) && boxVisible(n))) return true;
    return false;
  }
  function clipped(el) {
    for (let n = el, i = 0; n && i < 4; n = n.parentElement, i++) {
      const s = getComputedStyle(n);
      if (/^rect\(0/.test(s.clip) || /inset\(50%/.test(s.clipPath)) { const b = n.getBoundingClientRect(); if (b.width <= 1 || b.height <= 1) return true; }
    }
    return false;
  }
  /* opacity:0 alone is a trap only while nothing is about to fade it in: a running animation (modals), a declared
     opacity transition (AOS, Bootstrap .fade) or a transform (framer-motion / GSAP reveal start state) */
  function faded(el) {
    let z = null;
    for (let n = el, i = 0; n && i <= 5 && !z; n = n.parentElement, i++) if (getComputedStyle(n).opacity === '0') z = n;
    if (!z) return false;
    const s = getComputedStyle(z);
    if ((/[1-9]/.test(s.transitionDuration) && /opacity|all/.test(s.transitionProperty)) || s.transform !== 'none') return false;
    for (let n = el; n; n = n.parentElement || (n.parentNode && n.parentNode.host)) if (n.getAnimations && n.getAnimations().some((a) => a.playState === 'running')) return false;
    return true;
  }
  const said = (el) => norm([labelText(el), el.getAttribute('placeholder'), el.getAttribute('aria-label')].join(' '));
  const hpName = (el) => [el.name, el.id].some((s) => s && HP.test(s))
    || ([el.name, el.id].some((s) => s && HP_SHORT.test(s)) && el.type !== 'tel' && !/\bhp\b/.test(said(el)));
  const trap = (el, h, r) => el.matches('.MuiSelect-nativeInput') || hpName(el) || HP_TXT.test(h)
    || ariaHidden(el) || offscreen(el, r) || clipped(el) || (faded(el) && !/one-time-code/.test(el.getAttribute('autocomplete') || ''));
  /* checkbox / radio honeypots: a honeypot name, or the box and everything that shows it (labels, wrapper) sit off-screen.
     Opacity / clip are left out: that is how custom and sr-only controls are built. */
  function boxTrap(el) {
    if ([el.name, el.id].some((s) => s && HP.test(s))) return true;
    const shown = [el, ...(el.labels || []), el.parentElement].filter((n) => n && boxVisible(n));
    return shown.length > 0 && shown.every((n) => offscreen(n, n.getBoundingClientRect()));
  }

  /* ---------- widgets ---------- */
  /* controls that belong to a widget's own popup / search box (calendars, select2 / chosen / Tom Select search, phone country lists) */
  const POPS = '.flatpickr-calendar,.react-datepicker,.react-datepicker-popper,.MuiPickersPopper-root,.ant-picker-dropdown,#ui-datepicker-div,.ui-datepicker,.datepicker-dropdown,'
    + '.select2-container,.select2-dropdown,.chosen-container,.bootstrap-select .dropdown-menu,.ts-wrapper,.ts-dropdown,.selectize-control,.selectize-dropdown,.choices,.iti__dropdown-content,.iti__country-list,.iti--container';
  /* a native <select> kept hidden behind a widget: the widget's visible box, 'radix' (Radix / shadcn: skipped until there is a driver), or null */
  function widgetOf(el) {
    const nx = el.nextElementSibling, p = el.parentElement;
    if (el.classList.contains('select2-hidden-accessible')) return nx && nx.matches('.select2,.select2-container') ? nx : p;
    if (nx && nx.matches('.chosen-container')) return nx;
    if (p && p.matches('.bootstrap-select')) return p;
    if (el.matches('.tomselected,.selectized')) return nx && nx.matches('.ts-wrapper,.selectize-control') ? nx : p;
    if (el.matches('[data-choice],.choices__input')) return el.closest('.choices') || p;
    const pv = el.previousElementSibling, combo = '[role=combobox],button[aria-haspopup=listbox]';
    if (/^true$/i.test(el.getAttribute('aria-hidden') || '') && ((pv && pv.matches(combo)) || (p && [...p.children].some((c) => c.matches(combo))))) return 'radix';
    return null;
  }
  /* widgets that keep their own state and don't read the <select> back (Tom Select, Selectize, Choices.js): filled through their own
     dropdown, [control, dropdown, option] */
  const DRIVEN = { tom: ['.ts-control', '.ts-dropdown', '.option[data-value]'], selectize: ['.selectize-input', '.selectize-dropdown', '.option[data-value]'],
    choices: ['.choices__inner', '.choices__list--dropdown,.choices__list[aria-expanded]', '.choices__item--choice[data-value]'] };
  const drivenOf = (el) => (el.matches('.tomselected') ? 'tom' : el.matches('.selectized') ? 'selectize' : el.matches('[data-choice],.choices__input') ? 'choices' : null);
  const noWidget = new WeakSet(); // driven widgets whose dropdown never opened (inspect() says 'widget')
  /* the <select> a widget's own element stands for (the user clicked into select2 / chosen / bootstrap-select / Tom Select / Selectize /
     Choices.js, whose box or search field now has focus) */
  function selectOf(n) {
    const box = n && n.closest && n.closest('.select2-container,.chosen-container,.bootstrap-select,.ts-wrapper,.selectize-control,.choices');
    if (!box) return null;
    const pv = box.previousElementSibling, own = box.querySelector('select');
    if (own && widgetOf(own)) return own;
    if (pv && pv.tagName === 'SELECT' && widgetOf(pv) === box) return pv;
    const m = [n.getAttribute('aria-controls'), n.getAttribute('aria-owns'), ...[...box.querySelectorAll('[aria-labelledby],[aria-controls],[aria-owns]')].map((x) => x.getAttribute('aria-labelledby') + ' ' + x.getAttribute('aria-controls') + ' ' + x.getAttribute('aria-owns'))]
      .join(' ').match(/select2-(.+?)-(container|results)\b/); // select2's dropdown moved to <body>
    const s = m && n.ownerDocument.getElementById(m[1]);
    return s && s.tagName === 'SELECT' ? s : null;
  }
  const chosenOf = (el) => !!(el.nextElementSibling && el.nextElementSibling.matches('.chosen-container'));
  const refresh = (el) => { if (chosenOf(el)) el.dispatchEvent(new Event('chosen:updated')); }; // chosen re-reads the <select> on this event
  /* date picker libraries: their inputs are filled through the calendar they open */
  const PICKERS = [
    ['flatpickr', (el) => el.classList.contains('flatpickr-input') || !!flatHidden(el)],
    ['react', (el) => !!el.closest('.react-datepicker-wrapper,.react-datepicker__input-container')],
    ['mui', (el) => !!el.closest('.MuiPickersTextField-root,.MuiPickersInputBase-root') || !!(el.closest('.MuiInputBase-root') && el.closest('.MuiInputBase-root').querySelector('[data-testid=CalendarIcon],[aria-label*="choose date" i]'))],
    ['ant', (el) => !!el.closest('.ant-picker')],
    ['jqui', (el) => el.classList.contains('hasDatepicker')],
    ['bs', (el) => el.matches('[data-provide=datepicker]') || !!el.closest('[data-provide=datepicker],.input-group.date')],
  ];
  const pickerOf = (el) => { const p = PICKERS.find(([, f]) => f(el)); return p ? p[0] : null; };
  const DATE_CATS = new Set(['dob', 'date', 'nomineeDob']);
  const noPicker = new WeakSet(); // pickers whose calendar never opened (inspect() says 'picker')

  /* ---------- classification ---------- */
  let why = '', cardMemo = new Map(), secMemo = new Map();
  const fresh = () => { cardMemo = new Map(); secMemo = new Map(); }; // page layout may have changed since the last call
  const skip = (r) => { why = r; return 'skip'; };
  const payWrap = (el) => !!(el.closest && el.closest('.StripeElement,[class*="braintree-hosted"],[class*="adyen-checkout"]')) || PAY_FRAME.test(location.hostname);
  function cardForm(el) {
    const s = el.form || (el.ownerDocument || document);
    if (!cardMemo.has(s)) cardMemo.set(s, [...s.querySelectorAll('input')].some((x) => /(^|\s)cc-(number|csc)\b/i.test(x.getAttribute('autocomplete') || '') || CARDNUM.test(hintOf(x).replace(NONPAY, ' '))));
    return cardMemo.get(s);
  }
  function cardExp(el, h) {
    const c = CARDISH.test(h.replace(NONPAY, ' '));
    if ((DOCISH.test(h) || NONCARD_D.test(h)) && !c) return false; // "Passport expiry date" next to a card form is still the passport's
    if (c || cardForm(el)) return true;
    return !/\bdate\b/.test(h) || /\bmm ?\/ ?yy\b/.test(h); // "Expiry month" / "MM/YY" alone: a card's; "Expiry date" alone: not
  }
  /* any other expiry / "valid thru" (Expiry, Expires, Card expiry, name=ccexpiry): a card's when it says card, sits in a card form or a
     payment block, or is an MM/YY-sized box; a document named in it or its block (passport, policy…) makes it that document's */
  function cardExpiry(el, h) {
    if (CARDISH.test(h.replace(NONPAY, ' '))) return true;
    if (DOCISH.test(h) || NONCARD_D.test(h)) return false;
    const sec = ' ' + sectionOf(el) + ' ';
    if (CARDISH.test(sec.replace(NONPAY, ' '))) return true;
    if (DOCISH.test(sec) || idKind(sec)) return false;
    return cardForm(el) || (el.maxLength > 0 && el.maxLength <= 7 && !/\bdate\b/.test(h));
  }
  function addrCtx(el, h) {
    if (ADDR.test(h)) return true;
    const f = el.form || el.closest('fieldset,section');
    if (f && (ADDR.test((f.textContent || '').slice(0, 3000))
      || [...f.querySelectorAll('input,select,textarea')].some((x) => x !== el && ADDR.test([x.name, x.id, x.getAttribute('autocomplete'), x.getAttribute('placeholder')].join(' '))))) return true;
    for (let n = el.parentElement, i = 0; n && i < 3 && !n.matches('form,body'); n = n.parentElement, i++) if (ADDR.test((n.textContent || '').slice(0, 400))) return true;
    return false;
  }
  /* an M-PIN / UPI PIN / login PIN, not the postal PIN code ("6-digit PIN" in an address block is the PIN code) */
  function isPin(el, h, type) {
    if (MPIN.test(h)) return true;
    if (POSTAL.test(h)) return false;
    const n = (h.match(/\b(\d) ?digit ?pin\b/) || [])[1];
    if (n && n !== '6') return true;
    return /\bpin\b/.test(h) && (!!n || type === 'password' || (el.maxLength > 0 && el.maxLength <= 6)) && !addrCtx(el, h);
  }
  const acctNo = (h) => ACCT.test(h) && !/holder|\bname\b|type|ifsc|branch/.test(h);

  /* a hint that clearly names one thing wins over type=tel/password/url; a phone / email named in the hint wins over the rest */
  function strong(el, h, type) {
    if (type === 'email') return null; // an email box only accepts an email ("Email for fee receipts", "Get price drop alerts")
    if (EXT.test(h) && (PHONE.test(h) || type === 'tel' || (el.maxLength > 0 && el.maxLength <= 6))) return skip('ext');
    if (BIZ_NAME.test(h)) return 'company'; // "Legal name of the business (as per PAN)" is the business's name
    if (KYC.test(h)) return /father|guardian/.test(h) ? 'fatherName' : /mother/.test(h) ? 'motherName' : /first ?name|given ?name/.test(h) ? 'firstName'
      : /last ?name|sur ?name/.test(h) ? 'lastName' : /middle ?name/.test(h) ? 'middleName' : 'fullName';
    if (isPin(el, h, type)) return 'mpin';
    if (PWD.test(h)) return null; // "Bank account password", "e-Aadhaar password"
    if (/area ?code/.test(h) && (!PHONE.test(h) || (el.maxLength > 0 && el.maxLength <= 4))) return 'areaCode';
    if (IDLAST.test(h)) return 'idLast';
    const own = !CONTACT_NO.test(h); // names its own number, not a phone number ("Aadhaar number (linked with mobile)")
    if (own && /aadha?ar ?(card ?)?(no|num|number)\b/.test(h)) return 'aadhaar';
    if (own && /\bpan ?(card ?)?(no|num|number)\b/.test(h)) return 'pan';
    if (own && /permanent account (no|num|number)/.test(h) && !/upload|copy|scan|photo/.test(h)) return 'pan'; // not a bank account
    if (own && type !== 'tel' && /account ?(no|num|number)\b/.test(h) && acctNo(h)) return 'accountNumber';
    if (type !== 'tel' && /\bamount\b/.test(h) && !RATE.test(h) && !AMT_NOT.test(h)) return 'amount'; // "Mobile recharge amount"
    // "Mobile number linked with bank account", "Parent's mobile (if age below 18)": the contact is what is asked for
    if (PHONE.test(h) || EMAIL.test(h)) return null;
    if (ZIP.test(h)) return 'zip';
    if (acctNo(h)) return 'accountNumber';
    if (/aadha?ar/.test(h) && !DOC_ATTR.test(h)) return 'aadhaar';
    if (/\bpan\b/.test(h) && !DOC_ATTR.test(h)) return 'pan';
    if (/\bifsc\b/.test(h)) return 'ifsc';
    if (REFID.test(h)) return skip('ref');
    if (ORGID.test(h)) return 'refId';
    if ((DOCID.test(h) || ID_INTL.test(h) || (/\brg\b/.test(h) && shownParts(el).some((t) => /\brg\b/.test(t)))) && !/date|place|issu(e|ing)|valid|expir|photo|copy|upload|scan|country|type/.test(h)) return 'idNumber';
    if (AMOUNT.test(h) && !RATE.test(h) && !AMT_NOT.test(h)) return 'amount';
    if (AGE.test(h) && !BIRTH.test(h)) return 'age';
    if (QTY.test(h) && !/experience|\bexp\b|years?\b/.test(h)) return 'quantity';
    return null;
  }

  /* the title of the block a control sits in: the nearest legend / heading above it whose block holds it, or the label of a group holding it */
  const HEADS = 'h1,h2,h3,h4,h5,h6,[role=heading i],legend';
  const ariaName = (n) => n.getAttribute('aria-label') || (n.getAttribute('aria-labelledby') || '').split(/\s+/).map((id) => { const r = n.getRootNode(); return id && r.getElementById ? textOf(r.getElementById(id)) : ''; }).join(' ');
  function sectionOf(el) {
    if (secMemo.has(el)) return secMemo.get(el);
    const root = el.form || el.closest('form') || el.getRootNode(), hs = root.querySelectorAll ? [...root.querySelectorAll(HEADS)] : [];
    let head = null;
    for (let i = hs.length - 1; i >= 0 && !head; i--) {
      const x = hs[i], p = x.parentElement;
      if (!p || !(x.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      // a legend titles its own fieldset; a heading its parent, or its grandparent when the parent only wraps the heading (card header)
      if (p.contains(el) || (x.tagName !== 'LEGEND' && !p.querySelector('input,select,textarea') && p.parentElement && p.parentElement.contains(el))) head = x;
    }
    const g = el.closest('[role=group i],[role=region i],section[aria-label],section[aria-labelledby]');
    let t = head ? textOf(head) : '';
    if (g && (!head || !g.contains(head))) t = ariaName(g) || t;
    t = norm(t.replace(/[-#_:.()*]+/g, ' ')).slice(0, 60); // "Co-applicant", "Reference #2" read as words
    secMemo.set(el, t);
    return t;
  }
  const spouseIn = (t) => !/father|guardian|parent|mother/.test(t) && (/\b(spouse|husband|wife)\b/.test(t) || (PARTNER.test(t) && !/business|channel|company|organi|\bfirm\b|dealer|reseller|vendor/.test(t)));
  const whoIn = (t, sec) => (sec ? EMERG_SEC : EMERG).test(t) ? 'emergency' : (sec ? NOMINEE_SEC : NOMINEE).test(t) ? 'nominee' : spouseIn(t) ? 'spouse' : (sec ? OTHER_SEC : OTHER).test(t) ? 'other' : '';
  /* whose details a field asks for: its own hint, else the title of its block ("Emergency contact" → Name / Phone / Relationship).
     whoLoose: it came from the title, so a field that isn't about a person is left to the usual rules. */
  let whoLoose = false;
  function who(el, h) {
    const w = whoIn(h, false);
    whoLoose = !w;
    if (w || OWN.test(h)) return w;
    const t = ' ' + sectionOf(el) + ' ';
    return /\b(personal|applicant|self|own)\b/.test(t) && /\band\b|&|\+|\//.test(t) ? '' : whoIn(t, true); // "Personal & nominee details" names both
  }
  /* a reference's field (P.references): name, phone, email, relation, company, years known; anything else of theirs is skipped */
  const REF_KINDS = [['refRelation', /relation/], ['refEmail', EMAIL], ['refPhone', PHONE], ['refYears', /years?|how long|known (for|since)|acquaint|duration/],
    ['refCompany', /company|organi[sz]ation|employer|\bfirm\b|institut|workplace|business ?name/], ['refTitle', /designation|job ?title|position|\brole\b/], ['refName', /\bname\b/]];
  function refCat(el, h, type, loose) {
    if (type === 'email') return 'refEmail'; // the box's type beats words of a table header shared by every cell
    if (type === 'tel') return 'refPhone';
    const kinds = REF_KINDS.filter(([, re]) => re.test(h));
    if (kinds.length > 1) { const own = flat([el.name, el.id].join(' ')), k = REF_KINDS.filter(([, re]) => re.test(own)); if (k.length === 1) return k[0][0]; } // "Name Phone Email" over ref_phone[]
    if (/relation/.test(h)) return 'refRelation';
    if (EMAIL.test(h)) return 'refEmail';
    if (PHONE.test(h) || (!loose && /\b(contact|cell) ?(no|num|number)?\b/.test(h) && /\b(no|num|number)\b/.test(h))) return 'refPhone';
    if (/years?|how long|known (for|since)|acquaint|duration/.test(h)) return 'refYears';
    if (/company|organi[sz]ation|employer|\bfirm\b|institut|workplace|business ?name/.test(h)) return 'refCompany';
    if (/designation|job ?title|position|\brole\b/.test(h)) return 'refTitle';
    if (/address|street|city|town|\bstate\b|district|pin ?code|\bzip|postal|country|birth|\bdob\b|\bage\b|occupation|title|profession|aadha?ar|\bpan\b|\bid\b|income|salary|\bctc\b|amount|\bworth\b|monthly|annual|\bbank\b|account/.test(h) || type === 'number') return skip('other');
    if ((/name|person|contact|referee|reference|guarantor|applicant/.test(h)) || (!loose && !/[a-z0-9]/.test((shownParts(el).join(' ') || h).replace(WHO_WORDS, ' ')))) return 'refName';
    return !loose || PERSONISH.test(h) ? skip('other') : null;
  }
  /* null: an address-like field (or, under a title, one that isn't about the person), left to the usual rules;
     anything the persona has no data for is skipped, never filled with the persona's own */
  function whoCat(el, h, type, w) {
    const E = w === 'emergency', N = w === 'nominee', loose = whoLoose;
    if (w === 'other' && REF_WHO.test(loose ? sectionOf(el) : h)) return refCat(el, h, type, loose);
    if (type === 'email') return skip(w);
    if (type === 'tel' && !EXT.test(h)) return E ? 'emergencyPhone' : skip(w);
    if (/relation/.test(h)) return E || N ? w + 'Relation' : skip(w);
    if (/address|street|city|town|\bstate\b|district|pin ?code|\bzip|postal|country|locality|village|landmark/.test(h)) return null;
    if (/birth|\bdob\b/.test(h)) return N ? 'nomineeDob' : skip(w);
    if (/\bage\b/.test(h)) return N ? 'nomineeAge' : skip(w);
    if (N && /share|percent|%|proportion/.test(h)) return 'nomineeShare';
    if (type === 'email' || EMAIL.test(h) || /guardian|father|mother|minor/.test(h) || (w !== 'spouse' && /spouse|husband|wife/.test(h))) return skip(w);
    if (EXT.test(h)) return null;
    if (type === 'tel' || PHONE.test(h) || (E && !loose && /number|\bno\b|\bnum\b/.test(h))) return E ? 'emergencyPhone' : skip(w);
    const name = E || N ? w + 'Name' : w === 'spouse' ? 'spouseName' : '';
    if ((/name|person|contact/.test(h) && !/company|organi|business|employer|school|college|universit|bank|hospital|clinic/.test(h))
      || (!loose && !/[a-z0-9]/.test((shownParts(el).join(' ') || h).replace(WHO_WORDS, ' ')))) return name || skip(w);
    return !loose || PERSONISH.test(h) ? skip(w) : null;
  }
  const near = (el, re) => re.test(norm(((el.closest('fieldset,section,form') || document.body || {}).textContent || '').slice(0, 5000)));
  /* extra persona fields: second phone / email, family, emergency contact, nominee, scheme IDs, local-government places */
  function extra(el, h, type) {
    const w = who(el, h);
    if (w) { const c = whoCat(el, h, type, w); if (c !== null) return c; }
    if (SCHEME.test(h) && !SCHEME_NOT.test(h)) { if (!/address/.test(h)) return 'schemeId'; if (/abha|health ?id/.test(h)) return 'abhaAddress'; }
    const notMob = !/mobile|\bcell|whats ?app|\bmob\b|\bfax\b/.test(h) && !EXT.test(h) && !PHONECODE.test(h) && type !== 'email';
    // "Landline (with STD code)", "Telephone incl. STD", "STD code + number": the whole landline; a bare "STD code" box is the code
    if (notMob && WITH_STD.test(h) && !(el.maxLength > 0 && el.maxLength <= 5)) return 'landline';
    if (LANDLINE.test(h) && notMob && !(/(office|residence|residential|resi|res)\.? ?(no|number)\b/.test(h) && !/phone|\btel|land ?line|contact|std/.test(h) && /address/.test(sectionOf(el)))) return /\bstd\b|area ?code/.test(h) && !/number|\bno\b/.test(h) ? 'areaCode' : 'landline';
    const alt = !EXT.test(h) && !NOT_ALT.test(h), said = (re) => re.test(h) && shownParts(el).some((t) => re.test(t));
    if (alt && (ALT_EMAIL.test(h) || said(ALT_EMAIL_N)) && (type === 'email' || !PHONE.test(h))) return 'altEmail';
    if (alt && (ALT_PHONE.test(h) || said(ALT_PHONE_N) || (type === 'tel' && ALT_CONTACT.test(h))) && type !== 'email' && !PHONECODE.test(h)) return 'altPhone';
    if (/\bblood\b/.test(h) && !/pressure|sugar|donat|\btest|report|\bbank\b|relation/.test(h)) return 'bloodGroup';
    if (MARITAL.test(h) && !/date|anniversary|certificate|place|year|since|registration|\bno\b|number|\bname\b|maiden/.test(h)) return 'maritalStatus';
    if (/notice ?(period|days|duration)\b|serving notice/.test(h)) return 'noticePeriod';
    if ((HOUSEHOLD.test(h) || (/\b(family|household) members?\b/.test(h) && (type === 'number' || el.tagName === 'SELECT' || (el.maxLength > 0 && el.maxLength <= 2)))) && !HOUSE_NOT.test(h)) return 'household';
    if (/\bstd ?code\b/.test(h)) return !/landline|phone|\btel|number|\bno\b/.test(h) || (el.maxLength > 0 && el.maxLength <= 5) ? 'areaCode' : null;
    if (!/\bcode\b|\bid\b|\bno\b|number/.test(h) && !ADDR_NAMED.test(shownParts(el).join(' ') || h)) {
      if (/tehsil|tahsil|taluk|\bmandal\b|sub ?district/.test(h) || (/\bblock\b/.test(h) && !BLOCK_NOT.test(h))) return 'tehsil';
      if (!/\bcity\b|\btown\b/.test(h)) {
        if (/\bvillage\b/.test(h)) return 'village';
        if (/post ?office/.test(h) && !/\bbox\b|\bpin\b/.test(h)) return 'postOffice';
        if (/\bdistrict\b/.test(h)) return 'district';
      }
    }
    if (/\blocation\b/.test(h) && !LOCATION_NOT.test(h)) return 'location';
    if (/\brelation(ship)?\b/.test(h) && !RELATION_NOT.test(h)) return near(el, NOMINEE) && !near(el, EMERG) ? 'nomineeRelation' : 'emergencyRelation';
    return null;
  }
  const AC_SOFT = new Set(['phone', 'email', 'fullName', 'firstName', 'lastName', 'middleName', 'username', 'city', 'address1', 'address2', 'dob']); // a label naming someone else / a second one beats these

  /* sel: a widget that stands for a select (ARIA combobox, radio group): classified like a <select> (its own label, when it has one) */
  function classify(el, hint, sel) {
    const h = hint, type = sel ? '' : (el.type || '').toLowerCase(), tag = sel ? 'SELECT' : el.tagName, ml = sel ? 0 : el.maxLength;
    why = '';
    const toks = (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).filter((t) => t && !AC_IGNORE.test(t));
    if (toks.some((t) => t.startsWith('cc-')) || CARD.test(h.replace(NONPAY, ' ')) || payWrap(el) || (CARD_EXP.test(h) && cardExp(el, h))) return skip('card');
    if (EXP_BARE.test(h) && !DOCISH.test(h) && (!/experience|\bwork\b|\bjob\b|total/.test(h) || cardForm(el))) return skip('card');
    if (/security ?code/.test(h) && cardForm(el)) return skip('card');
    if (CODES.test(h)) return skip('code');
    if (toks.includes('tel-extension')) return skip('ext');
    let ac = AC[toks.find((t) => Object.hasOwn(AC, t))];
    if (ac === 'password' && type !== 'password' && !PWD.test(h)) ac = null; // autocomplete="new-password" on City / Name keeps Chrome's autofill away
    if (ac === 'username') ac = type === 'email' || EMAIL.test(h) ? 'email' : type === 'tel' || PHONE.test(h) ? 'phone' : ac;
    if (ac && AC_SOFT.has(ac)) { const x = extra(el, h, type); if (x && x !== 'location') return x; }
    if (ac) return ac === 'password' && isPin(el, h, type) ? 'mpin' : ac;
    if (tag !== 'SELECT') {
      if (OTP.test(h) || (/\bpin\b(?! ?code)/.test(h) && SENT.test(h))) return 'otp';
      if (/\bcode\b/.test(h) && !NOT_OTP.test(h) && ml >= 4 && ml <= 8) return 'otp';
    }
    const short = tag === 'SELECT' || (ml > 0 && ml <= 5);
    if (PREFIX.test(h) || (PHONECODE.test(h) && (short || !PHONE.test(h)))) return 'phoneCode';
    const b = bizCat(h) || bareIntl(el, sel);
    if (b) return b;
    const x = extra(el, h, type);
    if (x) return x;
    const s = strong(el, h, type);
    if (s) return s;
    // an expiry / "valid till" (passport, licence, policy…): a date, unless it is a card's
    if (EXPIRY.test(h) && !/^(email|tel|password)$/.test(type) && !EMAIL.test(h) && tag !== 'TEXTAREA') return cardExpiry(el, h) ? skip('card') : type === 'number' ? 'number' : 'date';
    if (type === 'email') return 'email';
    if (type === 'password') return 'password';
    if (type === 'tel') return 'phone';
    if (type === 'url') return 'website';
    if (PHONE.test(h) && !EMAIL.test(h)) return 'phone';
    if (tag === 'SELECT' && [...(el.options || [])].filter((op) => /^(mr|mrs|ms|miss|mx|dr)\.?$/i.test(op.text.trim())).length >= 2) return 'title';
    if (/\bfirst ?(name)? ?(and|&|\+|\/|,)? ?(last|sur) ?(name)?\b/.test(h) || FULL_INTL.test(h)) return 'fullName'; // "First & Last Name", "Name (First Last)", "Nome e cognome"
    if (HOUSE_NO.test(h) || (tag === 'INPUT' && BARE_NO.test(flat(labelText(el))) && addrCtx(el, h))) return 'houseNumber'; // Hausnummer, Número next to Rua
    let hit = null;
    for (const [cat, re] of RULES) if (re.test(h)) { hit = cat; break; }
    if (hit === 'skip') return skip('code');
    // "Nome" / "Nombre" alone: a first name next to a surname field, else the whole name; French "Nom": the surname next to a Prénom
    if (hit === 'firstName' && /\bnombres?\b|\bnome\b/.test(h) && !/first|given|fore|vorname|pr[ée]nom|primeiro|primer/.test(h) && !near(el, SURNAME)) hit = 'fullName';
    if (hit === 'lastName' && /(?<![a-zà-ÿ])nom\b/.test(h) && !/famille|last|sur ?name|family|nachname|apellido|cognome|sobrenome/.test(h) && !near(el, /pr[ée]nom/)) hit = 'fullName';
    if (hit && !/^(dob|date|email|password)$/.test(hit) && tag === 'INPUT' && /^ ?date of\b|\bdate ?$/.test(flat(labelText(el)))) hit = 'date'; // "Date of joining (current employer)"
    if (hit === 'date' && type === 'number') hit = 'number';
    // a bare "first" / "last" is a name only when nothing else is named ("Last employer", "First language", "Last working day")
    const bare = tag === 'TEXTAREA' || /\b(day|date|job|working|reason|time|visit|login|seen|updated|payment|order|year|month)\b/.test(h) ? null
      : /\bfirst\b/.test(h) ? 'firstName' : /\blast\b/.test(h) ? 'lastName' : /\bmiddle\b/.test(h) ? 'middleName' : null;
    if (bare && (!hit || hit === 'fullName')) return bare;
    // one part of a birth date in its own box (Mailchimp BIRTHDAY[month], "Birth year")
    if (hit === 'dob' && tag !== 'SELECT' && ((ml > 0 && ml <= 4) || type === 'number' || /^\s*(d{1,2}|m{1,2}|y{2,4})\s*$/i.test(el.getAttribute('placeholder') || ''))) {
      const parts = [/\b(day|dd|tag|jour|giorno)\b|\bd[ií]a\b/, /\b(month|mm|monat|mois|mes|mese)\b|\bm[êe]s\b/, /\b(year|yyyy|yy|jahr|ano|anno)\b|ann[ée]e|\ba[ñn]o\b/].map((re) => re.test(h));
      if (parts.filter(Boolean).length === 1) return ['dobDay', 'dobMonth', 'dobYear'][parts.indexOf(true)];
    }
    if (hit) return hit;
    if (tag === 'TEXTAREA') return 'message';
    if (type === 'number') return 'number';
    if (tag === 'INPUT' && ([el.getAttribute('data-date-format'), el.getAttribute('data-format')].some(fmtOf) || fmtOf(el.getAttribute('placeholder')) || fmtSample(el.getAttribute('placeholder'), {}))) return 'date'; // shows a date format or sample: "MM/YY", "e.g. 31/12/1990"
    return 'text';
  }

  /* what fill() would do with one control: { el, cat, reason } (+ hint / OTP group / picker / widget box / rich / rule / card part); reads only.
     While a fill (or inspect with options) runs, a site's rules and remembered types and a forced type come first (custom). */
  const assess = (el) => { const a = assess0(el); return X && X.on ? custom(a) : a; };
  function assess0(el) {
    if (!el.matches('input,select,textarea')) return assessRich(el);
    const S = (reason) => ({ el, cat: 'skip', reason });
    const tag = el.tagName, type = (el.type || '').toLowerCase();
    if (within(el, OFF)) return S('off');
    if (tag === 'INPUT' && type === 'file') { // sample files (o.sampleFiles): a visible, enabled upload box
      if (!checkVisible(el)) return S('hidden');
      if (!X || !X.sampleFiles) return S('file');
      if (el.matches(':disabled')) return S('disabled');
      if (hpName(el)) return S('trap');
      return { el, cat: 'file', reason: '', hint: hintOf(el) };
    }
    if (tag === 'INPUT' && SKIP_TYPES.has(type)) return S('type');
    if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') return S('disabled');
    if (tag !== 'SELECT' && el.closest(POPS)) return S('widget');
    if (type === 'radio' || type === 'checkbox') return S(!checkVisible(el) ? 'hidden' : boxTrap(el) ? 'trap' : type);
    const ro = el.readOnly || el.getAttribute('aria-readonly') === 'true', pk = tag === 'INPUT' && pickerOf(el);
    if (ro && (tag !== 'INPUT' || !(pk || /^(text|)$/.test(type)))) return S('readonly');
    let hint, box = null;
    if (tag === 'SELECT') {
      const w = widgetOf(el);
      if (w === 'radix') return S('widget');
      if (!boxVisible(el) && !(w && boxVisible(w))) return S('hidden');
      box = w;
      if (w && drivenOf(el) && noWidget.has(el)) return S('widget');
      hint = hintOf(el);
      if (el.matches('.PhoneInputCountrySelect') || el.closest('.PhoneInputCountry')) return { el, cat: 'phoneCountry', reason: '', hint, box };
    } else {
      const st = getComputedStyle(el), r = el.getBoundingClientRect();
      if (st.display === 'none' || st.visibility === 'hidden' || (!r.width && !r.height)) return S('hidden');
      hint = hintOf(el);
      if (trap(el, hint, r)) return S('trap');
      if (r.width <= 1 || r.height <= 1) return S('hidden');
      if (tag === 'INPUT' && el.maxLength === 1 && !ro) {
        const g = otpGroup(el), h0 = g && hintOf(g[0]);
        // boxes for a PIN: an M-PIN to set, unless it was sent to you (then it is a code, maybe shown on the page)
        if (g) return { el, cat: MPIN.test(h0) || (/\bpin\b(?! ?code)/.test(h0) && !OTP.test(h0) && !SENT.test(h0)) ? 'mpin' : 'otp', reason: '', group: g, hint: h0 };
      }
    }
    let cat = classify(el, hint);
    const help = (cat === 'text' || cat === 'number') && el.getAttribute('aria-describedby') && idsText(el, 'aria-describedby'); // "Number" + "Your 12-digit Aadhaar number"
    if (help) { const h2 = hint + flat(help).slice(1), c2 = classify(el, h2); if (c2 !== 'text' && c2 !== 'number' && c2 !== 'skip') { cat = c2; hint = h2; } }
    // test card numbers (o.testCards): a card field of the page's own, never one inside a payment provider's frame / wrapper; never an SSN
    let part = null;
    if (cat === 'skip' && why === 'card' && X && X.testCards && !payWrap(el)) { part = cardPart(el, hint); if (part) cat = 'card'; }
    // a read-only date box opens a calendar; a picker library's box always goes through its calendar
    if (pk && cat !== 'skip' && !DATE_CATS.has(cat)) cat = 'date';
    if (ro && !DATE_CATS.has(cat)) return S('readonly');
    const out = { el, cat, reason: cat === 'skip' ? why : '', hint };
    if (part) out.part = part;
    if (box) out.box = box;
    if (box && cat !== 'skip' && drivenOf(el)) out.drive = drivenOf(el);
    if (cat !== 'skip' && (pk || ro)) out.picker = pk || 'calendar';
    return out;
  }

  /* ---------- test cards (o.testCards) ---------- */
  /* which part of a card a field asks for: number, exp (MM/YY in one box), expMonth, expYear, cvc, name; null for anything else (an SSN) */
  function cardPart(el, h) {
    const ac = ((el.getAttribute('autocomplete') || '').toLowerCase().match(/\bcc-(number|exp-month|exp-year|exp|csc|name|given-name|family-name)\b/) || [])[1];
    if (ac) return { number: 'number', 'exp-month': 'expMonth', 'exp-year': 'expYear', exp: 'exp', csc: 'cvc' }[ac] || 'name';
    if (/\bssn\b|social security/.test(h)) return null;
    if (/cvv|cvc|\bcsc\b|security ?code|verification (code|value|number)|\bcid\b/.test(h)) return 'cvc';
    if (/name on (the )?card|card ?holder|holder'?s? ?name|\bcc ?name\b/.test(h)) return 'name';
    if (/expir|\bexp\b|valid ?thru|\bmm ?\/ ?yy/.test(h)) {
      const mo = /\b(month|mm|mo)\b/.test(h), yr = /\b(year|yy|yyyy|yr)\b/.test(h);
      if (el.tagName === 'SELECT') { const o = [...el.options].map((x) => x.text.trim()); return o.filter((t) => /^\d{4}$/.test(t)).length >= 3 && !(mo && !yr) ? 'expYear' : 'expMonth'; }
      return /\bmm ?\/ ?yy/.test(h) || (mo && yr) || !(mo || yr) ? 'exp' : mo ? 'expMonth' : 'expYear';
    }
    return /card|\bcc\b/.test(h.replace(NONPAY, ' ')) ? 'number' : null;
  }
  const CARD_BASE = { visa: ['4242424242424242', '123'], amex: ['378282246310005', '1234'] };
  /* values to try for a card field, best first: content/qa.js shapes them to the box; a few built-in Stripe test values otherwise */
  function cardValues(el, part, P, st) {
    if (part === 'name') return [P.fullName];
    if (!st.brand) st.brand = part === 'number' && (maxLen(el) === 15 || maxLen(el) === 17) ? 'amex' : 'visa';
    const qa = ext('qa'), y = new Date().getFullYear() + 3, yy = pad(y % 100), c = CARD_BASE[st.brand] || CARD_BASE.visa, out = [];
    let v = '';
    try { v = qa && typeof qa.card === 'function' ? String(qa.card(part, st.brand, el, P) || '') : ''; } catch (e) { v = ''; }
    if (v) out.push(v);
    if (part === 'number') { const sp = st.brand === 'amex' ? c[0].replace(/^(\d{4})(\d{6})(\d+)$/, '$1 $2 $3') : c[0].replace(/(\d{4})(?=\d)/g, '$1 '); out.push(...(maxLen(el) >= 19 ? [sp, c[0]] : [c[0], sp])); }
    else if (part === 'cvc') out.push(c[1]);
    else if (part === 'expMonth') out.push('12');
    else if (part === 'expYear') out.push(...(maxLen(el) === 2 ? [yy, String(y)] : [String(y), yy]));
    else if (part === 'exp') out.push(`12/${yy}`, `12 / ${yy}`, `12${yy}`, `12/${y}`);
    return [...new Set(out)];
  }
  /* a card expiry <select>: the option qa.card names, else December / the year three on */
  function cardOption(el, part, P, st) {
    const opts = [...el.options].filter((x) => !x.disabled && !isPlaceholderOpt(x)), v = cardValues(el, part, P, st)[0] || '', y = new Date().getFullYear() + 3;
    const want = part === 'expMonth' ? 12 : part === 'expYear' ? y : null, n = (s) => +digits(s);
    return opts.find((x) => x.value === v) || (want && opts.find((x) => n(x.value) === want || n(x.text) === want || (want === y && (n(x.text) === y % 100 || n(x.value) === y % 100)) || (want === 12 && monthOf(x.text) === 12))) || null;
  }

  /* ---------- a site's rules and remembered fields (o.rules, o.overrides, o.forceType) ---------- */
  let X = null; // set while a fill / inspect runs: { on, rules, over, force, targets, testCards, sampleFiles }
  /* ids a framework made up (React :r1:, MUI mui-123, ExtJS ext-gen1018, react-select-2-input, UUIDs…): no use as a key */
  const GEN_ID = /[:«»]|^(mui|ext-gen|ext-comp|ember|yui_?|__bvid__|mat-[a-z-]*?|cdk-[a-z-]*?|downshift|headlessui-[a-z-]*?|radix|react-select|rc_select|rc-[a-z-]*?|input|el-id|pv_id|mantine|chakra|formkit|ng-[a-z-]*?|j_id|vs)[-_]*\d+([-_].*)?$|\d{5,}|[0-9a-f]{8}-[0-9a-f]{4}-|^[0-9a-f]{12,}$/i;
  const lnorm = (s) => norm(String(s || '').replace(/[\u200b-\u200d\ufeff]/g, '')).replace(/[\s*:]+$/, '');
  const labelKey = (el) => String((el.labels && el.labels.length ? textOf(el.labels[0]) : '') || idsText(el, 'aria-labelledby') || labelText(el) || '').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').replace(/[\s*:]+$/, '').trim().slice(0, 80);
  /* a field's key on a site: its name, else an id the page chose, else its aria-label, else its label; with its tag and type */
  function fieldKey(el) {
    if (!el || el.nodeType !== 1) return '';
    const tag = el.tagName.toLowerCase(), type = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : el.getAttribute('role') || '';
    const nm = el.getAttribute('name'), id = el.id, al = (el.getAttribute('aria-label') || '').trim();
    let k = nm ? 'name=' + nm : id && !GEN_ID.test(id) ? 'id=' + id : al ? 'aria=' + al.slice(0, 80) : '';
    if (!k) { const l = labelKey(el); if (l) k = 'label=' + l; }
    return k ? `${tag}${type ? ':' + type : ''} ${k}` : '';
  }
  const rawHint = (el) => [el.getAttribute('name'), el.id, labelKey(el), el.getAttribute('placeholder'), el.getAttribute('aria-label')].filter(Boolean).join(' ');
  /* a rule's match: '/regex/flags' on the hint (or the raw name / label), name= / id= / label= exactly, else a CSS selector */
  function ruleOf(r) {
    const m = String((r && r.match) || '').trim();
    if (!m || m.length > 500) return null;
    let x = m.match(/^\/([\s\S]+)\/([a-z]*)$/), test;
    if (x) {
      let re;
      try { re = new RegExp(x[1], x[2].replace(/[^imsu]/g, '')); } catch (e) { return null; }
      test = (el, h) => re.test(String(h).slice(0, 300)) || re.test(rawHint(el).slice(0, 300)); // short texts: a slow pattern the settings let through stays quick
    } else if ((x = m.match(/^(name|id|label)\s*=\s*([\s\S]+)$/i))) {
      const k = x[1].toLowerCase(), v = x[2].trim().replace(/^(["'])([\s\S]*)\1$/, '$2'), lv = lnorm(v);
      test = k === 'name' ? (el) => el.getAttribute('name') === v : k === 'id' ? (el) => el.id === v
        : (el) => [labelKey(el), el.getAttribute('aria-label'), el.getAttribute('placeholder')].some((t) => t && lnorm(t) === lv);
    } else test = (el) => { try { return el.matches(m); } catch (e) { return false; } };
    return { test: (el, h) => { try { return !!el && el.nodeType === 1 && test(el, h || ''); } catch (e) { return false; } }, value: String(r.value == null ? '' : r.value) };
  }
  const TYPES = { name: 'fullName', fullname: 'fullName', first: 'firstName', last: 'lastName', address: 'address1', street: 'address1', pin: 'zip', pincode: 'zip',
    postal: 'zip', postcode: 'zip', zipcode: 'zip', birthday: 'dob', birthdate: 'dob', dateOfBirth: 'dob', job: 'jobTitle', mobile: 'phone', tel: 'phone', organization: 'company', none: 'skip', ignore: 'skip' };
  function setup(o) {
    const rules = (Array.isArray(o.rules) ? o.rules : []).filter((r) => r && r.on !== false).slice(0, 300).map(ruleOf).filter(Boolean);
    const over = new Map((Array.isArray(o.overrides) ? o.overrides : []).filter((x) => x && typeof x.key === 'string' && typeof x.type === 'string').map((x) => [x.key, x.type]));
    const force = typeof o.forceType === 'string' && o.forceType.trim() ? o.forceType.trim() : null;
    return { on: !!(rules.length || over.size || force), rules, over, force, targets: null, testCards: !!o.testCards, sampleFiles: !!o.sampleFiles };
  }
  /* skipped for good: never filled whatever a rule says (opted out, not a field, disabled, hidden, a trap, read-only, a widget's own popup) */
  const HARD = /^(off|type|disabled|widget|hidden|trap|readonly)$/;
  /* the forced type (the field the menu was opened on), else the first rule that matches, else the type remembered for this field */
  function custom(a, alt) {
    const el = a.el;
    if ((a.cat === 'skip' && HARD.test(a.reason)) || a.group || payWrap(el) || el.type === 'file') return a;
    const box = a.reason === 'radio' || a.reason === 'checkbox', h = a.hint != null ? a.hint : hintOf(el);
    if (X.force && X.targets && X.targets.has(el)) return typed(a, X.force, 'forced', box);
    const r = X.rules.find((x) => x.test(el, h) || (alt && x.test(alt, h)));
    if (r) return box ? { ...a, hint: h, rule: r } : { ...a, cat: 'rule', reason: '', hint: h, rule: r };
    const t = X.over.size ? X.over.get(a.w ? wKey(a.w) : fieldKey(el)) : null;
    return t ? typed(a, t, 'override', box) : a;
  }
  function typed(a, t, why0, box) {
    t = Object.hasOwn(TYPES, t) ? TYPES[t] : t;
    if (t === 'skip') return { ...a, cat: 'skip', reason: why0 };
    if (box || !/^[a-z][a-zA-Z]{1,30}$/.test(t)) return a;
    const out = { ...a, cat: t, reason: '', hint: a.hint != null ? a.hint : hintOf(a.el) };
    if (out.picker && !DATE_CATS.has(t)) delete out.picker;
    delete out.part;
    return out;
  }
  /* rule values: {{persona.path}}, {{firstName}} … {{company}}, {{random:N}}, {{digits:N}}, {{pick:a|b}}, {{date:+7d:YYYY-MM-DD}}, {{uuid}}; anything else '' */
  const SHORT_T = { firstName: 'firstName', lastName: 'lastName', fullName: 'fullName', email: 'email', phone: 'phone', city: 'city', state: 'state', zip: 'zip', company: 'company' };
  const ownPath = (o, path) => path.split('.').reduce((a, k) => (a != null && typeof a === 'object' && Object.hasOwn(a, k) ? a[k] : undefined), o);
  const asText = (v) => (v == null ? '' : Array.isArray(v) ? v.map(asText).join(', ') : typeof v === 'object'
    ? String(v.display || v.e164 || v.national || v.iso || (v.y && v.m && v.d ? `${v.y}-${pad(v.m)}-${pad(v.d)}` : '') || '') : String(v));
  function token(t, P) {
    let m;
    if ((m = t.match(/^persona\.([\w.]{1,100})$/))) return ownPath(P, m[1]);
    if (Object.hasOwn(SHORT_T, t)) return P[SHORT_T[t]];
    if ((m = t.match(/^(random|digits):(\d{1,4})$/))) {
      const set = m[1] === 'digits' ? '0123456789' : 'abcdefghijklmnopqrstuvwxyz0123456789';
      let s = '';
      for (let i = 0; i < Math.min(+m[2], 500); i++) s += set[rint(0, set.length - 1)];
      return s;
    }
    if ((m = t.match(/^pick:([\s\S]*)$/))) return pick(m[1].split('|'));
    if ((m = t.match(/^date(?::([+-]?\d{1,5})([dwmy])?)?(?::([\s\S]+))?$/i))) {
      const n = +(m[1] || 0), u = (m[2] || 'd').toLowerCase(), t0 = new Date(), d = new Date(Date.UTC(t0.getFullYear(), t0.getMonth(), t0.getDate()));
      if (u === 'y') d.setUTCFullYear(d.getUTCFullYear() + n); else if (u === 'm') d.setUTCMonth(d.getUTCMonth() + n); else d.setUTCDate(d.getUTCDate() + n * (u === 'w' ? 7 : 1));
      const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, dd = d.getUTCDate();
      return (m[3] || 'YYYY-MM-DD').replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D/g, (k) => ({ YYYY: String(y), YY: pad(y % 100), MMMM: MONTH_NAMES[mo - 1], MMM: MONTH_NAMES[mo - 1].slice(0, 3), MM: pad(mo), M: String(mo), DD: pad(dd), D: String(dd) })[k]);
    }
    if (t === 'uuid') {
      try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* not a secure context */ }
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = rint(0, 15); return (c === 'x' ? r : (r & 3) | 8).toString(16); });
    }
    return '';
  }
  const fromTemplate = (s, P) => String(s == null ? '' : s).replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (m, t) => { try { return asText(token(t, P)); } catch (e) { return ''; } }).slice(0, 5000);
  const TRUTHY = /^\s*(1|true|yes|y|on|checked|tick|ticked|x|✓)\s*$/i;
  /* the option a rule names: same text / value, else one that contains it; never a random one */
  const ruleOpt = (opts, v) => { const n = norm(v); return !n ? null : opts.find((op) => norm(op.text) === n || norm(op.value) === n) || opts.find((op) => norm(op.text).includes(n)) || null; };

  /* ---------- rich text (contenteditable / role=textbox) ---------- */
  const RICH_CATS = new Set(['message', 'bio', 'subject', 'address1', 'address2']);
  const frameOf = (el) => { const d = el.ownerDocument; if (el !== d.body) return null; try { return d.defaultView.frameElement || null; } catch (e) { return null; } };
  /* editable roots: [contenteditable] / role=textbox not inside another editable, plus same-origin editor frames (TinyMCE, CKEditor 4) with no filler of their own */
  function editors(root) {
    const out = [];
    for (const e of deepQuery(root, '[contenteditable],[role=textbox i]', [])) {
      if (e.matches('input,select,textarea') || !e.isContentEditable || e.closest(POPS)) continue;
      let p = parentOf(e);
      while (p && !p.isContentEditable) p = parentOf(p); // an image caption inside CKEditor is part of that editor
      if (p || !boxVisible(e) || e.querySelector('input,select,textarea')) continue;
      out.push(e);
    }
    if (root === document && document.body && document.body.isContentEditable && !out.includes(document.body)) out.push(document.body); // designMode
    for (const f of deepQuery(root, 'iframe', [])) {
      try {
        const d = f.contentDocument, b = d && d.body;
        if (b && !f.contentWindow.__formGhost && boxVisible(f) && b.isContentEditable && !out.includes(b)) out.push(b);
      } catch (e) { /* another origin */ }
    }
    return out;
  }
  const controls = (root) => collect(root, []).concat(editors(root));
  const richVal = (el) => (el.textContent || '').replace(/[\u200b\ufeff]/g, '').trim();
  function richHint(el) {
    const host = frameOf(el) || el, parts = [];
    for (const n of new Set([el, host])) parts.push(n.getAttribute('aria-label'), idsText(n, 'aria-labelledby'), n.getAttribute('data-placeholder'), n.getAttribute('placeholder'), n.getAttribute('title'), idsText(n, 'aria-describedby'));
    for (let i = 0; i < parts.length; i++) if (parts[i] && /rich ?text|editing area|\beditor\b|wysiwyg|press alt/i.test(parts[i])) parts[i] = ''; // "Rich Text Editor. Editing area: main" names the widget
    const ph = el.querySelector('[data-placeholder]');
    if (ph) parts.push(ph.getAttribute('data-placeholder'));
    // the textarea the editor stands in for (TinyMCE / CKEditor keep it, hidden and labelled)
    for (let n = host, i = 0; n && i < 4 && !n.matches('form,body'); n = n.parentElement, i++) {
      const src = [n.previousElementSibling, n.nextElementSibling].find((x) => x && x.tagName === 'TEXTAREA' && !boxVisible(x));
      if (src) { parts.push(src.name, src.id, ...[...(src.labels || [])].map(textOf)); break; }
    }
    if (!parts.some(Boolean)) parts.push(labelText(host)); // nothing of its own: the label / legend / text before it
    return flat(parts.filter(Boolean).join(' '));
  }
  function assessRich(el) {
    const S = (reason) => ({ el, cat: 'skip', reason, rich: true }), host = frameOf(el) || el;
    if (within(host, OFF)) return S('off');
    if (el.getAttribute('aria-disabled') === 'true') return S('disabled');
    if (el.getAttribute('aria-readonly') === 'true') return S('readonly');
    if (ariaHidden(host) || offscreen(host, host.getBoundingClientRect())) return S('trap');
    const hint = richHint(el);
    let cat = classify(el, hint);
    if (cat === 'skip') return { el, cat, reason: why, hint, rich: true };
    if (!RICH_CATS.has(cat)) cat = 'message';
    return { el, cat, reason: '', hint, rich: true };
  }
  /* editors that keep their own model and rebuild their DOM from it (Draft.js, CKEditor 5, Lexical, Slate) take a paste; changing their
     DOM under them is reverted (CKEditor 5, Lexical) or breaks the page's React tree (Draft.js) */
  const OWNED = '.public-DraftEditor-content,[data-contents],.ck-editor__editable,.ck-content,[data-lexical-editor],[data-slate-editor]';
  const draftish = (el) => el.matches('.public-DraftEditor-content') || !!el.querySelector('[data-contents]');
  /* select everything in the editor (and tell editors that track the selection now, not a task later), then type over it:
     'paste' a synthetic paste / cut carrying the text, 'exec' execCommand as a user's typing would, else beforeinput / input + textContent.
     Returns whether the page handled it (a paste nobody handled does nothing). */
  function richSet(el, text, how) {
    const doc = el.ownerDocument, win = doc.defaultView;
    focusIn(el);
    try { const r = doc.createRange(); r.selectNodeContents(el); const s = win.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) { /* ignore */ }
    doc.dispatchEvent(new Event('selectionchange'));
    let ok = false;
    if (how === 'paste') {
      try {
        const dt = new win.DataTransfer();
        if (text) dt.setData('text/plain', text);
        ok = !el.dispatchEvent(new win.ClipboardEvent(text ? 'paste' : 'cut', { clipboardData: dt, bubbles: true, cancelable: true, composed: true }));
      } catch (e) { ok = false; }
    } else {
      try { ok = text ? doc.execCommand('insertText', false, text) : doc.execCommand('delete', false); } catch (e) { ok = false; }
      if (!ok) {
        const init = { inputType: text ? 'insertText' : 'deleteContentBackward', data: text || null, bubbles: true, composed: true };
        if (el.dispatchEvent(new InputEvent('beforeinput', { ...init, cancelable: true }))) el.textContent = text;
        el.dispatchEvent(new InputEvent('input', init));
        ok = true;
      }
    }
    focusOut(el);
    return ok;
  }
  /* types the text into an editor and reads it back once the editor had its turn; the next way only if it didn't stick
     (never execCommand under a Draft.js editor that handled the paste) */
  const flatText = (s) => String(s || '').replace(/[\s\u200b\ufeff]+/g, '');
  function* richType(el, text) {
    const owned = el.matches(OWNED) || draftish(el), stuck = () => flatText(richVal(el)) === flatText(text);
    let handled = false;
    for (const how of owned ? ['paste', 'exec'] : ['exec', 'paste']) {
      if (how === 'exec' && handled && draftish(el)) break;
      const h = richSet(el, text, how);
      if (how === 'paste') { handled = h; if (!h) continue; } // nobody took the paste: nothing changed
      const t0 = Date.now();
      yield () => Date.now() - t0 >= 10; // the editor's own update / re-render runs first
      if (!el.isConnected) return false;
      const a = el.ownerDocument.activeElement;
      if (a && (a === el || el.contains(a))) focusOut(el); // an editor that took focus back with its update (Lexical, Draft)
      if (stuck()) return true;
    }
    return false;
  }

  /* ---------- value builders ---------- */
  const rx = (src) => { try { return new RegExp('^(?:' + src + ')$', 'v'); } catch (e) { try { return new RegExp('^(?:' + src + ')$'); } catch (e2) { return null; } } };
  const patternOf = (el) => (el.pattern && /^(text|search|url|tel|email|password|)$/.test((el.type || '').toLowerCase()) ? rx(el.pattern) : null); // the types it applies to
  const maxLen = (el) => (el.maxLength > 0 ? el.maxLength : 0), minLen = (el) => (el.minLength > 0 ? el.minLength : 0);
  const takesPlus = (el) => el.type !== 'number' && !/^(numeric|decimal)$/i.test(el.getAttribute('inputmode') || '');
  /* the number in every form, the ones the mode and the box ask for first (the rest for a box that takes none of those) */
  function phoneForms(el, ph, o) {
    const num = el.type === 'number';
    const C = { intl: ph.e164, intlDigits: ph.ccDigits + ph.subscriber, local: ph.national, sub: ph.subscriber };
    const order = phoneOrder(el, ph, o).concat(['sub', 'local', 'intlDigits', 'intl']);
    return [...new Set(order.map((k) => C[k]).filter(Boolean).map((v) => (num ? v.replace(/\D/g, '') : v)))];
  }
  function phoneObj(el, cat, P, st) {
    const x = cat === 'phone' ? P.phone : cat === 'altPhone' ? P.altPhone : cat === 'emergencyPhone' ? (P.emergency || {}).phone : cat === 'refPhone' ? (refOf(el, cat, P, st) || {}).phone : null;
    return x ? (cat === 'phone' ? x : phoneOf(x, P)) : null;
  }
  function phoneOrder(el, ph, o) {
    let order;
    if (o.phoneMode === 'intl') order = ['intl', 'intlDigits', 'local', 'sub'];
    else if (o.phoneMode === 'local') order = ['local', 'sub'];
    else {
      const picker = codePicker(el, ph.ccDigits);
      const ph2 = el.getAttribute('placeholder') || '';
      if (picker === 'inline' || /^\s*\+/.test(ph2) || /^\s*\+\d/.test(el.value)) order = ['intl', 'intlDigits', 'local', 'sub'];
      else if (picker === 'other') order = takesPlus(el) ? ['intl', 'sub', 'local'] : ['sub', 'local'];
      else if (picker === 'separate') order = ['sub', 'local'];
      else order = ['local', 'sub', 'intl'];
    }
    return order;
  }
  function phoneValue(el, ph, o) {
    const list = phoneForms(el, ph, o), ml = maxLen(el), re = el.pattern ? rx(el.pattern) : null;
    const v = list.find((x) => !(ml && x.length > ml) && !(re && !re.test(x)));
    return v || (ml ? list[0].slice(-ml) : list[0]);
  }
  /* another number of the persona's region in the phone object shape ({ cc, ccDigits, national, subscriber, display, e164 }); a bare string is accepted too */
  function phoneOf(x, P) {
    if (x && typeof x === 'object' && x.national && x.subscriber) return { ccDigits: (P.phone && P.phone.ccDigits) || '', cc: (P.phone && P.phone.cc) || '', e164: '', ...x, e164: x.e164 || ((x.cc || (P.phone && P.phone.cc) || '') + x.subscriber) };
    const p = P.phone, d = typeof x === 'string' ? x.replace(/\D/g, '') : '';
    if (!p || d.length < 6) return null;
    const sub = /^\s*\+/.test(x) && d.startsWith(p.ccDigits) ? d.slice(p.ccDigits.length) : p.national !== p.subscriber && d.length > p.subscriber.length ? d.slice(p.national.length - p.subscriber.length) : d;
    return { cc: p.cc, ccDigits: p.ccDigits, national: p.national.slice(0, p.national.length - p.subscriber.length) + sub, subscriber: sub, display: x, e164: p.cc + sub };
  }
  /* P.landline { std, number, display, e164 }: as shown, as digits (number boxes), just the number after an STD-code box, or +E.164 */
  function landlineValue(el, P, o) {
    const L = P.landline;
    if (!L || typeof L !== 'object' || !L.number) return phoneValue(el, P.phone, o);
    const std = String(L.std || ''), num = String(L.number), nat = (std + num).replace(/\D/g, ''), shown = String(L.display || `${std} ${num}`.trim()), e164 = String(L.e164 || '');
    // an STD / area code box right before it (same row): only the number goes here
    const ins = collect(el.form || el.getRootNode(), []).filter((x) => x.tagName === 'INPUT' && !SKIP_TYPES.has(x.type)), pv = ins[ins.indexOf(el) - 1];
    const ph = pv && hintOf(pv), stdBox = !!pv && [el.parentElement, el.parentElement && el.parentElement.parentElement].some((n) => n && n.contains(pv))
      && /\bstd\b|area ?code/.test(ph) && !WITH_STD.test(ph) && !(LANDLINE.test(ph) && !(pv.maxLength > 0 && pv.maxLength <= 5));
    let order = stdBox ? [num.replace(/\D/g, ''), num] : el.type === 'number' || !takesPlus(el) ? [nat, nat.replace(/^0/, '')] : [shown, nat, nat.replace(/^0/, ''), num.replace(/\D/g, '')];
    if (!stdBox && takesPlus(el) && e164 && (o.phoneMode === 'intl' || /^\s*\+/.test(el.getAttribute('placeholder') || ''))) order.unshift(e164);
    order = order.concat([nat, num.replace(/\D/g, ''), e164]).filter(Boolean);
    const ml = maxLen(el), re = patternOf(el);
    return order.find((v) => !(ml && v.length > ml) && !(re && !re.test(v))) || order[0];
  }
  /* { y, m, d, iso } from a date object or an ISO / dd-mm-yyyy string */
  function dateOf(x) {
    let r = x && typeof x === 'object' && x.y ? [0, x.y, x.m, x.d] : null;
    if (!r && typeof x === 'string') { r = x.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); const s = !r && x.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); if (s) r = [0, s[3], s[2], s[1]]; }
    if (!r) return null;
    const [y, m, d] = [+r[1], +r[2], +r[3]];
    return y && m && d ? { y, m, d, iso: `${y}-${pad(m)}-${pad(d)}` } : null;
  }
  const yearsSince = (d) => { const t = new Date(); return t.getFullYear() - d.y - (t.getMonth() + 1 < d.m || (t.getMonth() + 1 === d.m && t.getDate() < d.d) ? 1 : 0); };
  const nomineeAge = (P) => { const n = P.nominee || {}, d = dateOf(n.dob); return n.age != null && n.age !== '' ? +n.age : d ? yearsSince(d) : null; };
  /* "First name" / "Last name" of someone else's full name */
  function namePart(el, name) {
    if (!name) return null;
    const h = hintOf(el), w = String(name).trim().split(/\s+/);
    return /first|given|fore ?name/.test(h) ? w[0] : /last|sur ?name|family/.test(h) && w.length > 1 ? w.slice(1).join(' ') : String(name);
  }
  /* "Immediate" 0, "15 days", "1 month" 30, "0-15 days" 7.5, "3 months +" past 90 */
  function noticeDays(s) {
    const x = norm(s);
    if (/immediate|^none|^nil|no notice|already (serving|relieved)/.test(x)) return 0;
    const n = (x.match(/\d+(\.\d+)?/g) || []).map(Number);
    if (!n.length) return null;
    let v = (n.length >= 2 ? (n[0] + n[1]) / 2 : n[0]) * (/month/.test(x) ? 30 : /week/.test(x) ? 7 : /year/.test(x) ? 365 : 1);
    if (/more|above|over|beyond|greater|\+/.test(x)) v += 15; else if (/less|below|under|within|up ?to|upto/.test(x)) v -= 1;
    return v;
  }
  const bloodKey = (s) => norm(s).replace(/\b(rh|blood|group|type)\b/g, '').replace(/positive|pos\b|\+ ?ve\b|\+/g, '+').replace(/negative|neg\b|- ?ve\b|[−–-]/g, '-').replace(/[^abo+-]/g, '');
  const REL = { father: ['father', 'dad', 'parent'], mother: ['mother', 'mom', 'mum', 'parent'], husband: ['husband', 'spouse', 'partner'], wife: ['wife', 'spouse', 'partner'],
    brother: ['brother', 'sibling'], sister: ['sister', 'sibling'], son: ['son', 'child'], daughter: ['daughter', 'child'] };
  /* the relation word and the option texts that mean it ("Spouse" of a man is a "Wife") */
  const relWords = (rel, P) => { const r = norm(rel); return r === 'spouse' ? ['spouse', P.gender === 'male' ? 'wife' : 'husband', 'partner'] : [r, ...(REL[r] || [])]; };
  /* a reference's relation in the words a select may use */
  const REF_REL = [[/manager|supervisor|boss|superior/, ['manager', 'supervisor', 'reporting', 'boss', 'superior', 'employer', 'professional']], [/colleague|co ?worker|peer/, ['colleague', 'co-worker', 'coworker', 'peer', 'professional']],
    [/professor|teacher|lecturer|faculty|mentor|guide/, ['professor', 'teacher', 'faculty', 'lecturer', 'academic', 'mentor', 'guide', 'professional']], [/friend/, ['friend', 'personal', 'acquaintance']]];
  const household = (P) => 2 + (+digitsFor(P, 'household', 1) % 5);
  /* e-Shram UAN 12 digits, ABHA 14 (XX-XXXX-XXXX-XXXX when the box shows dashes), NREGA job card ST-00-000-000-000/000, ration / PM-JAY 12 */
  function schemeValue(el, P) {
    const h = hintOf(el), d = (salt, n) => (1 + (+digitsFor(P, salt + '0', 1) % 9)) + digitsFor(P, salt, n - 1);
    if (/nrega|job ?card/.test(h)) return `${P.stateAbbr || 'UP'}-${digitsFor(P, 'jc1', 2)}-${digitsFor(P, 'jc2', 3)}-${digitsFor(P, 'jc3', 3)}-${digitsFor(P, 'jc4', 3)}/${d('jc5', 3)}`;
    if (/abha|health ?id/.test(h)) { const v = d('abha', 14); return /-/.test(el.getAttribute('placeholder') || '') ? `${v.slice(0, 2)}-${v.slice(2, 6)}-${v.slice(6, 10)}-${v.slice(10)}` : v; }
    return d(/ration/.test(h) ? 'ration' : /ayushman|jay/.test(h) ? 'pmjay' : 'uan', 12);
  }
  /* GSTIN / TAN / CIN / Udyam / UAN / vehicle number / CPF / CNPJ: the persona's own, wherever lib/profile.js keeps it (P, P.ids, P.business) */
  const BIZ_KEYS = { gstin: ['gstin', 'gst', 'gstNumber'], tan: ['tan'], cin: ['cin'], udyam: ['udyam', 'udyamNumber', 'udyog'], uan: ['uan', 'epfUan', 'pfUan'],
    vehicle: ['vehicle', 'vehicleNumber', 'vehicleNo', 'vehicleReg', 'vehicleRegistration', 'vrn', 'rc'], cpf: ['cpf'], cnpj: ['cnpj'] };
  function bizVal(P, cat) {
    for (const src of [P, P.ids, P.business, P.biz, P.companyIds]) {
      if (!src || typeof src !== 'object') continue;
      for (const k of BIZ_KEYS[cat] || []) {
        const v = Object.hasOwn(src, k) ? src[k] : null, s = v && typeof v === 'object' ? v.display || v.number || v.value || v.formatted : v;
        if ((typeof s === 'string' || typeof s === 'number') && String(s).trim()) return String(s).trim();
      }
    }
    return null;
  }
  /* which reference (P.references[i]) a field is about: "Reference 2" / "Second referee" in its label or block title, else the n-th field of its kind */
  const refNum = (t) => { const m = t.match(/\b(?:referee|references?|ref|guarantor|co ?applicant|contact person)\W{0,3}(?:#|no\.?)? ?([1-9])\b|\b([1-9])(?:st|nd|rd|th)? ?(?:referee|reference)/); return m ? +(m[1] || m[2]) - 1 : /\b(second|2nd)\b/.test(t) ? 1 : /\b(first|1st)\b(?! ?name)/.test(t) ? 0 : null; };
  function refOf(el, cat, P, st) {
    const refs = (Array.isArray(P.references) ? P.references : []).filter((r) => r && typeof r === 'object');
    if (!refs.length) return null;
    if (!st.refAt.has(el)) { // a block (form / fieldset / section, and its title) is one reference; a field kind repeated in it is the next one
      const h = hintOf(el), box = el.closest('fieldset,section,form,[class*=referee i],[class*=reference i]') || el.ownerDocument.body;
      if (!st.refIds.has(box)) st.refIds.set(box, st.refIds.size);
      const blk = st.refIds.get(box) + '|' + sectionOf(el); // "Guarantor" then "Alternate contact person" in one form: two blocks
      if (!st.refBase.has(blk)) st.refBase.set(blk, st.refNext);
      let i = refNum(h) ?? refNum(' ' + sectionOf(el) + ' ');
      if (i == null) {
        const kinds = st.refN.get(blk) || new Map(), key = cat + (/first|given|fore ?name/.test(h) ? 'f' : /last|sur ?name|family/.test(h) ? 'l' : ''), c = kinds.get(key) || 0;
        kinds.set(key, c + 1);
        st.refN.set(blk, kinds);
        i = st.refBase.get(blk) + c;
      }
      st.refNext = Math.max(st.refNext, i + 1);
      st.refAt.set(el, i);
    }
    return refs[st.refAt.get(el) % refs.length]; // a third block (guarantor, alternate contact) reuses one
  }

  /* ---------- dates ---------- */
  const dayIdx = (d) => Date.UTC(d.y, d.m - 1, d.d) / DAY;
  const ofIdx = (i) => { const t = new Date(i * DAY); const d = { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; d.iso = `${d.y}-${pad(d.m)}-${pad(d.d)}`; return d; };
  const todayIdx = () => { const t = new Date(); return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / DAY; };
  function futureDate() { return ofIdx(todayIdx() + rint(3, 30)); }
  /* P.idDates: { passport: { issue, expiry }, dl: {…} } (ISO strings); flat keys like 'passportExpiry' are read too */
  const ISSUED = /^(issue|issued|issueDate|issuedOn|dateOfIssue|from|validFrom)$/i, EXPIRES = /^(expiry|expires|expiryDate|expiresOn|dateOfExpiry|to|validTill|validUntil|validUpto)$/i;
  const docKey = (k) => (/^(dl|driv|licen[cs]e)/i.test(k) ? 'dl' : /^passport/i.test(k) ? 'passport' : k);
  function idDate(P, kind, which) {
    const all = P.idDates, re = which === 'issue' ? ISSUED : EXPIRES;
    if (!all || typeof all !== 'object') return null;
    for (const [k, v] of Object.entries(all)) {
      if (v && typeof v === 'object' && !v.y && !v.iso) { if (docKey(k) === kind) for (const [k2, x] of Object.entries(v)) if (re.test(k2)) return dateOf(x); }
      else { const m = k.match(/^(.+?)(Issue\w*|Expir\w*|Valid\w*)$/); if (m && docKey(m[1]) === kind && re.test(m[2].replace(/^Valid/, 'valid')) && dateOf(v)) return dateOf(v); }
    }
    return null;
  }
  /* which way a date field points: [-1 past | 1 future | 0, kind]. A start / from that looks ahead (earliest start, available from,
     leave / stay / policy start) is a future one; the specific future nouns (delivery, appointment…) beat the generic past ones (order, payment) */
  const AHEAD = /\b(leave|stay|policy|subscription|coverage|insurance|plan|trip|tour|holiday|vacation|rental|lease|booking|tenancy|event)\b/;
  function dateKind(h) {
    if (/expected|tentative|proposed|planned|preferred|upcoming|\bnext\b|earliest|availab|desired|intended|can (you )?(start|join)|(wish|want|like) to (start|join)/.test(h)) return [1, 'soon'];
    if (/expir|valid ?(till|until|upto|up ?to|thru|through|to)\b|validity|\bvalid\b(?! ?from)/.test(h)) return [1, 'exp'];
    if (/renew/.test(h)) return [1, 'renew'];
    if (/\bdue\b|\blast date (to|for)\b|deadline|closing date/.test(h)) return [1, 'due'];
    if (/issu|valid ?from/.test(h)) return [-1, 'issue'];
    if (/\bjoin|\bstart|commenc/.test(h) && AHEAD.test(h)) return [1, 'soon'];
    if (/\bjoin|\bstart|commenc|registr|incorporat|establish|found(ed|ation)|admission|admit|enrol/.test(h)) return [-1, 'join'];
    if (/passing|graduat|complet/.test(h)) return [-1, 'grad'];
    if (/\bvisit|purchas|bought|\blast\b|\bprevious\b|incident|accident|occurr|onset|discharge|diagnos|surgery|death|demise|reliev|resign/.test(h)) return [-1, 'recent'];
    if (/marri|wedding|divorce|separation|anniversary/.test(h)) return [-1, 'life'];
    if (/check ?out|\breturn\b/.test(h)) return [1, 'out'];
    if (/appointment|deliver|travel|journey|depart|arriv|check ?in|schedul|\bevent\b|reservation|booking|interview/.test(h)) return [1, 'soon'];
    if (/transaction|invoice|\bbill|\border|payment|\bpaid\b/.test(h)) return [-1, 'recent'];
    if (/\bfrom\b|\bsince\b/.test(h)) return AHEAD.test(h) ? [1, 'soon'] : [-1, 'from'];
    if (/\bto\b|\btill\b|\buntil\b/.test(h)) return [1, 'to'];
    if (/\bend(ed|ing|s)?\b|\bfinish(ed|ing)?\b/.test(h)) return [0, 'end'];
    return [0, ''];
  }
  /* the date a field asks for: { y, m, d, iso, side, far (years away), exact (the persona's own: DOB, nominee DOB, document dates), trip }.
     A start (check-in, arrival, from, joining…) is remembered per form as st.trip, so the end that follows it (check-out, departure, to, end)
     comes after it; trip: true when this date is that start (set again from the date actually written) */
  function wantDate(el, cat, P, h, st) {
    if (cat === 'nomineeDob') { const d = dateOf(P.nominee && P.nominee.dob); return d && { ...d, side: -1, far: true, exact: true }; }
    if (/^(dob|age|dobDay|dobMonth|dobYear)$/.test(cat)) return { ...dateOf(P.dob), side: -1, far: true, exact: true };
    let [side, kind] = dateKind(h);
    const doc = idKind(h) || idKind(' ' + sectionOf(el) + ' ');
    if (doc && (kind === 'exp' || kind === 'issue')) { const d = idDate(P, doc, kind === 'exp' ? 'expiry' : 'issue'); if (d) return { ...d, side, far: true, exact: true }; }
    const key = el.form || el.getRootNode(), trip = st && st.trip && st.trip.key === key ? st.trip : null, ahead = trip && trip.side > 0;
    if (kind === 'soon' && ahead && /depart/.test(h) && !/arriv|check ?in/.test(h)) kind = 'out'; // departure after the arrival
    const now = todayIdx(), adult = P.dob && P.dob.y ? dayIdx({ y: P.dob.y + 18, m: P.dob.m, d: P.dob.d }) : -Infinity;
    let i;
    if (kind === 'grad' && P.gradYear) i = dayIdx({ y: +P.gradYear, m: rint(4, 7), d: rint(1, 28) });
    else if (kind === 'out') i = (ahead ? trip.i : now + rint(3, 30)) + rint(1, 7);
    else if (kind === 'to' && ahead) i = trip.i + rint(1, 30);
    else if (kind === 'end' && trip) { i = ahead ? trip.i + rint(30, 365) : Math.max(trip.i + 1, Math.min(now - 1, trip.i + rint(180, 3 * 365))); side = i < now ? -1 : 1; }
    else {
      const off = { exp: [365, 5 * 365], renew: [30, 365], due: [7, 60], soon: [3, 30], to: [30, 365], issue: [-5 * 365, -365], join: [-Math.max(1, +P.experience || 3) * 365, -180], from: [-5 * 365, -365], recent: [-90, -3], life: [-12 * 365, -365] }[kind]
        || (side < 0 ? [-720, -30] : [3, 30]);
      i = now + rint(off[0], off[1]);
      if (/^(issue|join|from|life)$/.test(kind)) i = Math.min(now - 1, Math.max(i, adult));
    }
    const out = { ...ofIdx(i), side, far: /^(grad|exp|issue|join|from)$/.test(kind), kind };
    if (st && /^(soon|join|from)$/.test(kind)) { st.trip = { key, i, side }; out.trip = true; }
    return out;
  }
  /* the start date as written (a box's min / max or a calendar's enabled days may have moved it) */
  const tripAt = (st, d, i) => { if (st && d && d.trip && st.trip && i != null && isFinite(i)) st.trip.i = i; };
  /* date formats a box shows, written as tokens d dd m mm mmm mmmm yy yyyy with their separators ("dd/mm/yyyy", "mmm d, yyyy") */
  const PHP = { d: 'dd', j: 'd', m: 'mm', n: 'm', M: 'mmm', F: 'mmmm', Y: 'yyyy', y: 'yy' };
  function fmtOf(s) {
    if (!s) return null;
    const p = String(s).trim().match(/^([djmnMFyY])([^a-zA-Z]{1,2})([djmnMFyY])(?:([^a-zA-Z]{1,2})([djmnMFyY]))?$/); // flatpickr / PHP: d/m/Y, F j, Y
    if (p) return [PHP[p[1]], p[2], PHP[p[3]], p[4] || '', p[5] ? PHP[p[5]] : ''].join('');
    const T = '(d{1,2}|m{1,4}|mon|y{2}|y{4})', SEP = '(\\s?[\\/\\-.]\\s?|, ?| )', x = intlFmt(String(s).toLowerCase());
    const m = x.match(new RegExp(`(?:^|[^a-z])${T}${SEP}${T}(?:${SEP}${T})?(?![a-z])`));
    if (!m) return null;
    if (!m[5] && /^\s?[\/\-.]\s?\p{L}{1,4}(?!\p{L})/u.test(x.slice(m.index + m[0].length))) return null; // a third part it can't read: not "dd/mm"
    const t = [m[1], m[3], m[5]].filter(Boolean).map((x) => (x === 'mon' ? 'mmm' : x)), k = t.map((x) => x[0]);
    if (new Set(k).size !== k.length || !k.includes('m') || (t.length === 2 && k.includes('d') && k.includes('y'))) return null;
    if (!t.some((x) => x.length > 1)) return null;
    return [t[0], m[2], t[1], m[4] || '', t[2] || ''].join('');
  }
  /* other languages' letters: DD/MM/AAAA (es, pt), JJ/MM/AAAA (fr), GG/MM/AAAA (it), TT.MM.JJJJ (de), DD-MM-JJJJ (nl) → d / m / y.
     Only runs of two or more, and only next to a day and a month ("hh:mm aa" / "hh:mm tt" are times) */
  function intlFmt(x) {
    const RUN = /(?<![a-z])([adgjmty])\1{1,3}(?![a-z])/g, runs = [...x.matchAll(RUN)].map((r) => r[1]), has = (c) => runs.includes(c);
    if (!has('m')) return x;
    const a = has('a'), j = has('j'), yr = (n) => (n <= 2 ? 'yy' : 'yyyy'), dy = (n) => (n <= 2 ? 'dd' : null);
    return x.replace(RUN, (r, c) => (c === 'a' && (has('d') || j || has('g')) ? yr(r.length) : c === 'j' && a ? dy(r.length) || r : c === 'j' && (has('t') || has('d')) ? yr(r.length)
      : (c === 't' && j) || (c === 'g' && a) ? dy(r.length) || r : r));
  }
  /* a sample date in the hint ("e.g. 31/12/1990", "12 Jan 1990"); an ambiguous order follows the persona */
  function fmtSample(s, P) {
    if (!s) return null;
    let m = String(s).match(/\b(\d{1,4})([\/\-.])(\d{1,2})\2(\d{2,4})\b/);
    if (m) {
      const [a, b, sep, y] = [m[1], m[3], m[2], m[4].length === 2 ? 'yy' : 'yyyy'];
      if (a.length === 4) return `yyyy${sep}mm${sep}dd`;
      if (+a > 12 || (+b <= 12 && P.dateOrder !== 'MDY')) return `dd${sep}mm${sep}${y}`;
      return `mm${sep}dd${sep}${y}`;
    }
    const M = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)([a-z]*)';
    if ((m = String(s).toLowerCase().match(new RegExp(`\\b\\d{1,2}([ -])${M}\\1(\\d{2,4})\\b`)))) return `dd${m[1]}${m[3].length > 1 ? 'mmmm' : 'mmm'}${m[1]}${m[4].length === 2 ? 'yy' : 'yyyy'}`;
    if ((m = String(s).toLowerCase().match(new RegExp(`\\b${M} \\d{1,2}, \\d{4}\\b`)))) return m[2].length > 1 ? 'mmmm d, yyyy' : 'mmm d, yyyy';
    return null;
  }
  const render = (f, d) => f.replace(/d{1,2}|m{1,4}|y{2,4}/g, (t) => (t[0] === 'd' ? (t.length > 1 ? pad(d.d) : String(d.d))
    : t[0] === 'm' ? (t.length >= 4 ? MONTH_NAMES[d.m - 1] : t.length === 3 ? MONTH_NAMES[d.m - 1].slice(0, 3) : t.length > 1 ? pad(d.m) : String(d.m))
      : t.length === 2 ? pad(d.y % 100) : String(d.y)));
  /* the format a text date box asks for: data-date-format / placeholder / label / help text, its pattern, react-datepicker's MM/dd/yyyy, else the persona's order */
  function dateFmts(el, P) {
    if (learned.has(el)) return [learned.get(el)]; // its picker showed how it writes a date
    for (const s of [el.getAttribute('data-date-format'), el.getAttribute('data-format'), el.getAttribute('data-dateformat'), el.getAttribute('date-format'),
      el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.title, labelText(el), idsText(el, 'aria-describedby')]) {
      const f = fmtOf(s) || fmtSample(s, P);
      if (f) return [f];
    }
    const sep = P.dateSep || '/', ord = P.dateOrder || 'DMY', by = (o, s, y) => o.split('').map((c) => (c === 'D' ? 'dd' : c === 'M' ? 'mm' : y)).join(s);
    const list = el.closest('.react-datepicker-wrapper,.react-datepicker__input-container') ? ['mm/dd/yyyy'] : [];
    list.push(by(ord, sep, 'yyyy'));
    if (el.pattern) { // dotted dates are day first nearly everywhere: MM.DD.YYYY only as a last resort
      for (const o of [ord, 'DMY', 'MDY', 'YMD']) for (const s of [sep, '/', '-', '.', ' ']) for (const y of ['yyyy', 'yy']) if (s !== '.' || o !== 'MDY') list.push(by(o, s, y));
      list.push(by('MDY', '.', 'yyyy'));
      list.push('dd mmm yyyy', 'dd-mmm-yyyy', 'dd-mmm-yy', 'mmm d, yyyy', 'd mmmm yyyy', 'mm/yy', 'mm/yyyy', 'yyyy-mm');
    }
    return [...new Set(list)];
  }
  function dateText(el, d, P) {
    if (!d) return null;
    const re = patternOf(el), fs = dateFmts(el, P);
    return render(fs.find((f) => !re || re.test(render(f, d))) || fs[0], d);
  }
  /* clamp to min / max, then snap to the step counted from the step base */
  function snap(n, lo, hi, step, base) {
    if (lo != null && n < lo) n = lo;
    if (hi != null && n > hi) n = hi;
    if (step > 0) {
      const b = base == null ? 0 : base;
      n = b + Math.round((n - b) / step) * step;
      if (hi != null && n > hi) n -= step;
      if (lo != null && n < lo) n += step;
    }
    return n;
  }
  const secsOf = (s) => { const m = String(s || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/); return m ? +m[1] * 3600 + +m[2] * 60 + +(m[3] || 0) : null; };
  const hms = (n, sec) => { n = ((n % 86400) + 86400) % 86400; const h = Math.floor(n / 3600), mi = Math.floor((n % 3600) / 60), s = n % 60; return `${pad(h)}:${pad(mi)}${sec || s ? ':' + pad(s) : ''}`; };
  const isoWeek = (i) => { const dow = (new Date(i * DAY).getUTCDay() + 6) % 7, thu = i - dow + 3, y = new Date(thu * DAY).getUTCFullYear(); return `${y}-W${pad(1 + Math.floor((thu - Date.UTC(y, 0, 1) / DAY) / 7))}`; };
  const weekMon = (s) => { const m = String(s || '').match(/^(\d{4})-W(\d{2})$/); if (!m) return null; const j4 = Date.UTC(+m[1], 0, 4) / DAY; return j4 - ((new Date(j4 * DAY).getUTCDay() + 6) % 7) + (+m[2] - 1) * 7; };
  const dIdx = (s) => { const d = dateOf(s); return d ? dayIdx(d) : null; };
  const stepOf = (el, dflt) => (el.step === 'any' ? 0 : +el.step > 0 ? +el.step : dflt);
  /* date / time / datetime-local / month / week values inside min / max and on the step */
  function fitTyped(el, type, d) {
    const time = rint(36, 75) * 900; // 09:00–18:45 on the quarter hour
    if (type === 'date') {
      const lo = dIdx(el.min), step = stepOf(el, 1);
      return ofIdx(snap(dayIdx(d), lo, dIdx(el.max), step, lo == null ? 0 : lo)).iso;
    }
    if (type === 'month') {
      const mi = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})$/); return m ? +m[1] * 12 + +m[2] - 1 : null; }, lo = mi(el.min);
      const n = snap(d.y * 12 + d.m - 1, lo, mi(el.max), stepOf(el, 1), lo == null ? 1970 * 12 : lo);
      return `${Math.floor(n / 12)}-${pad((n % 12) + 1)}`;
    }
    if (type === 'week') {
      const lo = weekMon(el.min), mon = dayIdx(d) - ((new Date(dayIdx(d) * DAY).getUTCDay() + 6) % 7);
      return isoWeek(snap(mon, lo, weekMon(el.max), stepOf(el, 1) * 7, lo == null ? -3 : lo));
    }
    if (type === 'time') {
      const lo = secsOf(el.min), hi = secsOf(el.max), step = stepOf(el, 60);
      const n = lo != null && hi != null && lo > hi ? snap(time, lo, null, step, lo) : snap(time, lo, hi, step, lo == null ? 0 : lo);
      return hms(n, step % 60 !== 0);
    }
    if (type === 'datetime-local') {
      const at = (s) => { const m = String(s || '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)/); return m ? dIdx(m[1]) * 86400 + secsOf(m[2]) : null; }, lo = at(el.min), step = stepOf(el, 60);
      const n = snap(dayIdx(d) * 86400 + time, lo, at(el.max), step, lo == null ? 0 : lo);
      return `${ofIdx(Math.floor(n / 86400)).iso}T${hms(n % 86400, step % 60 !== 0)}`;
    }
    return d.iso;
  }

  /* ---------- numbers, text, passwords ---------- */
  const numAttr = (s) => (s !== '' && s != null && isFinite(+s) ? +s : null);
  const decimals = (x) => (String(x).split('.')[1] || '').length;
  function numberValue(el) {
    const min = numAttr(el.min), max = numAttr(el.max);
    const lo = min ?? 1, hi = max ?? Math.max(lo + 9, lo);
    return String(rint(Math.ceil(lo), Math.floor(hi)));
  }
  /* a number inside min / max, snapped to the step counted from min */
  function fitNumber(el, v) {
    const n = parseFloat(v);
    if (!isFinite(n)) return v;
    const min = numAttr(el.min), max = numAttr(el.max), st = stepOf(el, 1), base = min ?? numAttr(el.getAttribute('value')) ?? 0;
    const x = snap(n, min, max, st, base);
    if (x === n && /^-?\d+(\.\d+)?$/.test(String(v).trim())) return String(v).trim(); // already fits: as given (a phone keeps its leading 0)
    return String(+x.toFixed(Math.min(10, st ? Math.max(decimals(el.step), decimals(base)) : decimals(v))));
  }
  /* shorter at a word / sentence boundary, never mid-word when there is a space to cut at */
  function shorten(v, ml) {
    if (v.length <= ml) return v;
    const cut = v.slice(0, ml + 1), dot = cut.lastIndexOf('. '), sp = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf(','));
    if (dot > ml * 0.5) return cut.slice(0, dot + 1);
    return (sp > ml * 0.4 ? cut.slice(0, sp) : v.slice(0, ml)).replace(/[\s,;:-]+$/, '');
  }
  /* longer for a minlength: more sentences after a sentence, more words after words */
  function lengthen(v, mn, ml) {
    const words = !/[.!?]$/.test(v.trim()), list = words ? WORDS : SENTENCES;
    let s = v, k = rint(0, list.length - 1);
    for (let n = 0; s.length < mn && n < 60; n++) s += ' ' + list[(k + n) % list.length];
    return ml && s.length > ml ? shorten(s, ml) : s;
  }
  function seed(str) {
    let h = 2166136261;
    for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return () => { h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  /* a string shaped by a simple pattern ([0-9]{6}, [A-Z]{5}[0-9]{4}[A-Z], \d{3}-\d{4}, (a|b)…), checked against the real one; null if it can't */
  function fromPattern(src, re, rnd) {
    if (!src || !re) return null;
    const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', L = 'abcdefghijkmnopqrstuvwxyz', D = '0123456789', CL = { d: D, w: L + D, s: ' ', D: L, W: '-', S: L };
    const any = (set) => set[Math.floor(rnd() * set.length)], fail = () => { throw new Error('pattern'); };
    let i = 0;
    function klass() {
      i++;
      const neg = src[i] === '^';
      if (neg) i++;
      let set = '';
      while (i < src.length && src[i] !== ']') {
        let c = src[i++];
        if (c === '\\') { const e = src[i++]; if (CL[e]) { set += e === 'w' ? L + U + D + '_' : CL[e]; continue; } c = e === 'n' ? '\n' : e === 't' ? '\t' : e; }
        if (src[i] === '-' && i + 1 < src.length && src[i + 1] !== ']') {
          i++;
          let e = src[i++];
          if (e === '\\') e = src[i++];
          for (let k = c.charCodeAt(0); k <= e.charCodeAt(0) && k - c.charCodeAt(0) < 300; k++) set += String.fromCharCode(k);
        } else set += c;
      }
      if (src[i] !== ']') fail();
      i++;
      if (neg) set = [...(L + U + D + ' -._@')].filter((c) => !set.includes(c)).join('');
      const nice = [...set].filter((c) => /[A-Za-z0-9]/.test(c)).join('');
      if (!set) fail();
      return nice || set;
    }
    function atom() {
      const c = src[i];
      if (c === '(') {
        i++;
        if (src[i] === '?') {
          if (src[i + 1] === ':') i += 2;
          else if (/[=!]/.test(src[i + 1]) || (src[i + 1] === '<' && /[=!]/.test(src[i + 2]))) { // a lookaround: zero width here, the result is checked after
            for (let depth = 1; i < src.length && depth; i++) { if (src[i] === '\\') i++; else if (src[i] === '(') depth++; else if (src[i] === ')') depth--; }
            return () => '';
          } else if (src[i + 1] === '<') { i = src.indexOf('>', i) + 1; if (!i) fail(); } else fail();
        }
        const g = alts();
        if (src[i] !== ')') fail();
        i++;
        return g;
      }
      if (c === '[') { const set = klass(); return () => any(set); }
      if (c === '\\') {
        i++;
        const e = src[i++];
        if (e === undefined || /[1-9kpPuxc]/.test(e)) fail();
        if (e === 'b' || e === 'B') return () => '';
        return CL[e] ? () => any(CL[e]) : () => e;
      }
      if (c === '.') { i++; return () => any(L + D); }
      if (c === '^' || c === '$') { i++; return () => ''; }
      if (c === ')' || c === '|') fail();
      i++;
      return () => c;
    }
    function quant(g) {
      const c = src[i];
      let n = 1;
      if (c === '?' || c === '*') { n = 0; i++; } else if (c === '+') i++;
      else if (c === '{') { const m = src.slice(i).match(/^\{(\d+)(?:,(\d*))?\}/); if (m) { n = +m[1] || (m[2] === undefined ? 0 : 1); i += m[0].length; } }
      if (src[i] === '?' || src[i] === '+') i++;
      return () => { let s = ''; for (let k = 0; k < n; k++) s += g(); return s; };
    }
    function seq() { const parts = []; while (i < src.length && src[i] !== '|' && src[i] !== ')') parts.push(quant(atom())); return () => parts.map((p) => p()).join(''); }
    function alts() { const bs = [seq()]; while (src[i] === '|') { i++; bs.push(seq()); } return () => bs[0](); }
    try {
      const g = alts();
      if (i < src.length) return null;
      for (let k = 0; k < 30; k++) { const s = g(); if (re.test(s)) return s; } // a lookahead (two digits…) is met by some tries
    } catch (e) { /* not a simple pattern */ }
    return null;
  }
  const kindOf = (x) => (/[A-Z]/.test(x) ? 0 : /[a-z]/.test(x) ? 1 : /\d/.test(x) ? 2 : 3);
  /* the persona's password reshaped to a length (min / max) and a symbol (or none), keeping one upper, lower, digit (and symbol);
     the same inputs give the same password, so a confirm box matches */
  function shapePw(base, mn, ml, sym, need) {
    const rnd = seed(`${base}|${mn}|${ml}|${sym}|${need || ''}`), U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', L = 'abcdefghijkmnopqrstuvwxyz', D = '23456789';
    let c = [...base].map((ch) => (/[A-Za-z0-9]/.test(ch) ? ch : sym || L[Math.floor(rnd() * L.length)]));
    let len = c.length;
    if (ml && len > ml) len = ml;
    if (mn && len < mn) len = mn;
    const pool = L + D + U;
    while (c.length < len) c.push(pool[Math.floor(rnd() * pool.length)]);
    c = c.slice(0, len);
    // at least one upper, lower, digit (and symbol), or as many as the pattern's lookaheads ask for: taken from kinds that have some to spare
    const sets = [U, L, D, sym || ''], want = [0, 1, 2, 3].map((k) => (sets[k] ? Math.max(1, (need && need[k]) || 0) : 0));
    for (let k = 0; k < 4; k++) {
      for (let g = 0; g < 24; g++) {
        const n = [0, 0, 0, 0];
        c.forEach((x) => n[kindOf(x)]++);
        if (n[k] >= want[k]) break;
        let j = c.length - 1;
        while (j > 0 && n[kindOf(c[j])] <= want[kindOf(c[j])]) j--;
        const x = sets[k][Math.floor(rnd() * sets[k].length)];
        if (j > 0) c[j] = x; else if (!ml || c.length < ml) c.push(x); else break;
      }
    }
    return c.join('');
  }
  /* how many of each kind (upper, lower, digit, symbol) a pattern's lookaheads ask for: (?=(?:.*[A-Z]){3}), (?=.*\d.*\d) */
  const pwKind = (x) => (/^\\d$|^\[0-9\]$/.test(x) ? 2 : /^\\W$|^\[\^/.test(x) || !/[A-Za-z0-9]/.test(x.replace(/\\./g, '')) ? 3 : /A-Z/.test(x) && !/a-z/.test(x) ? 0 : /a-z/.test(x) && !/A-Z/.test(x) ? 1 : -1);
  function pwNeeds(src) {
    const need = [0, 0, 0, 0], at = (x, n) => { const k = pwKind(x); if (k >= 0) need[k] = Math.max(need[k], n); };
    for (const m of String(src || '').matchAll(/\(\?=\(\?:\.\*(\[[^\]]+\]|\\[dW])\)\{(\d+)/g)) at(m[1], +m[2]);
    for (const m of String(src || '').matchAll(/\(\?=((?:\.\*(?:\[[^\]]+\]|\\[dW]))+)\)/g)) {
      const parts = m[1].split('.*').filter(Boolean), cnt = new Map();
      parts.forEach((x) => cnt.set(x, (cnt.get(x) || 0) + 1));
      cnt.forEach((n, x) => at(x, n));
    }
    return need;
  }
  const SYMS = '@#$!%&*_-.+=?';
  function passwords(el, P, st) {
    const base = String(P.password || ''), out = [], add = (x) => { if (x && !out.includes(x)) out.push(x); };
    const re = patternOf(el), digitsOnly = /^(numeric|decimal|tel)$/i.test(el.getAttribute('inputmode') || '');
    let mn = minLen(el), ml = maxLen(el);
    const q = re && el.pattern.match(/\{(\d+)(?:(,)(\d*))?\}\)?\$?$/); // the length a pattern ends with: .{14,20}, [A-Za-z0-9]{8,}
    if (q) { mn = Math.max(mn, +q[1]); const hi = q[2] ? +q[3] || 0 : +q[1]; if (hi) ml = ml ? Math.min(ml, hi) : hi; }
    const mine = st.pwdOf.get(el.form || el.getRootNode()), need = re ? pwNeeds(el.pattern) : null;
    if (mine) add(mine); // a confirm box repeats the password of its own form
    if (!digitsOnly) {
      add(base);
      const own = (base.match(/[^A-Za-z0-9]/) || ['@'])[0];
      add(shapePw(base, mn, ml, own, need));
      if (re) for (const s of SYMS) add(shapePw(base, mn, ml, s, need));
      add(shapePw(base, mn, ml, null, need));
    }
    const r = seed(`${base}|${mn}|${ml}|${el.pattern}`);
    let d = '';
    while (d.length < (mn || Math.min(ml || 8, 8))) d += 1 + Math.floor(r() * 9);
    add(d.slice(0, ml || d.length));
    if (re) add(fromPattern(el.pattern, re, r));
    return out;
  }
  function emails(el, v) {
    const out = [v], ml = maxLen(el), at = v.lastIndexOf('@'), loc = v.slice(0, at), dom = v.slice(at), re = patternOf(el);
    if (at > 0 && ml && v.length > ml && ml - dom.length >= 1) out.push(loc.slice(0, ml - dom.length).replace(/[._+-]+$/, '') + dom);
    if (re && at > 0 && !re.test(v)) {
      out.push(v.toLowerCase());
      const g = fromPattern(el.pattern, re, seed(v + el.pattern));
      if (g && g.includes('@')) { const y = loc + g.slice(g.lastIndexOf('@')); out.push(re.test(y) ? y : g); } else if (g) out.push(g);
    }
    return out;
  }
  function urls(el, v) {
    const out = [v], noW = v.replace('://www.', '://'), ml = maxLen(el);
    out.push(noW);
    if (el.type !== 'url') out.push(v.replace(/^https?:\/\//, ''), noW.replace(/^https?:\/\//, ''));
    const m = ml && noW.match(/^(https?:\/\/)([^./]+)(\.[^/]+)$/);
    if (m && ml - m[1].length - m[3].length >= 2) out.push(m[1] + m[2].slice(0, ml - m[1].length - m[3].length) + m[3]);
    return out;
  }
  /* what to try in a box, best first: the value, then values reshaped to its length / pattern / range */
  function variants(el, cat, v) {
    const type = (el.type || '').toLowerCase(), out = [], add = (x) => { if (x != null && x !== '' && !out.includes(String(x))) out.push(String(x)); };
    if (type === 'number' || type === 'range') {
      add(fitNumber(el, /[^\d.\-]/.test(v) ? v.replace(/\D/g, '') || numberValue(el) : v));
      add(fitNumber(el, numberValue(el)));
      return out;
    }
    if (type === 'email' || /^(email|altEmail|refEmail)$/.test(cat)) emails(el, v).forEach(add);
    else if (type === 'url' || cat === 'website') urls(el, v).forEach(add);
    else add(v);
    const ml = maxLen(el), mn = minLen(el), re = patternOf(el);
    if (mn && v.length < mn && /^(message|bio|text|subject|address1|address2|skills|teachSubjects|languages|company|jobTitle)$/.test(cat)) add(lengthen(v, mn, ml));
    if (ml && v.length > ml && !/^[\d\s+()-]+$/.test(v) && !/@/.test(v)) add(shorten(v, ml));
    if (re && !out.some((x) => re.test(x))) {
      [v.toUpperCase(), v.toLowerCase(), v.replace(/[\s-]+/g, ''), v.replace(/\D/g, ''), v.replace(/[^A-Za-z0-9 ]/g, ''), v.replace(/[^A-Za-z ]/g, '').trim()].forEach(add);
      add(fromPattern(el.pattern, re, seed(v + '|' + el.pattern)));
    }
    if (ml && v.length > ml) add(v.slice(0, ml));
    return out;
  }
  /* everything worth trying in a box, best first: passwords fitted to its rules; for an email, the one already written in this form
     (a confirm box gets the shortened one too); for a phone, its other forms (a mask with a fixed +91 takes +E.164); a username padded
     with the persona's digits up to minlength */
  function candidates(el, cat, v, P, o, st) {
    if (cat === 'password') return passwords(el, P, st);
    const key = el.form || el.getRootNode(), mine = cat === 'email' && st.emailOf.get(key);
    const out = variants(el, cat, mine || v), add = (x) => { if (x && !out.includes(x)) out.push(x); };
    if (mine) variants(el, cat, v).forEach(add);
    // an ID written with separators (KA 03 MN 4821, 123.456.789-09): without them before any shortened one
    if (Object.hasOwn(BIZ_KEYS, cat)) { const c = String(v).replace(/[\s./-]+/g, ''); if (c && !out.includes(c)) out.splice(1, 0, c); }
    // a date a mask rejected (month 24 in a dd/mm/yyyy inputmask): the other order too
    const dm = DATE_CATS.has(cat) && String(v).match(/^(\d{1,2})([\/.\- ])(\d{1,2})\2(\d{2,4})$/);
    if (dm && dm[1] !== dm[3] && +dm[1] <= 12 !== +dm[3] <= 12) add(dm[3] + dm[2] + dm[1] + dm[2] + dm[4]);
    if (PHONE_CATS.test(cat) && cat !== 'landline') { const p = phoneObj(el, cat, P, st); if (p) phoneForms(el, p, o).forEach(add); }
    const mn = minLen(el), ml = maxLen(el), re = patternOf(el);
    if (cat === 'username' && mn > v.length) {
      const u = v + digitsFor(P, 'user', mn - v.length);
      if (!(ml && u.length > ml) && !(re && !re.test(u))) out.unshift(u); else add(u);
    }
    return out;
  }

  /* a house number box of its own (Hausnummer, Número) in the street's form / block: the street then goes in without the number */
  const HOUSE_NUM = /(?:^|\s)(\d{1,5}[a-z]?)(?=[\s,]|$)/i;
  const streetOf = (a) => String(a || '').replace(HOUSE_NUM, ' ').replace(/\s+,/g, ',').replace(/,\s*,/g, ',').replace(/^[\s,]+|[\s,]+$/g, '').replace(/\s{2,}/g, ' ') || String(a || '');
  function houseBox(el, st) {
    const box = el.form || el.closest('fieldset,section,[role=group],form') || el.getRootNode(), memo = st && (st.house = st.house || new Map());
    if (memo && memo.has(box)) return memo.get(box);
    const has = collect(box, []).some((x) => x !== el && x.tagName === 'INPUT' && !SKIP_TYPES.has(x.type) && (HOUSE_NO.test(hintOf(x)) || (BARE_NO.test(flat(labelText(x))) && addrCtx(x, hintOf(x)))));
    if (memo) memo.set(box, has);
    return has;
  }
  /* digits derived from the persona, so a PIN / reference stays the same across confirm fields and form steps */
  function digitsFor(P, salt, n) {
    let h = 2166136261, s = '';
    for (const c of `${P.id || P.email}|${P.createdAt}|${salt}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    while (s.length < n) { h = (Math.imul(h, 1103515245) + 12345) | 0; s += ((h >>> 16) & 0x7fff) % 10; }
    return s;
  }
  const isSeq = (v) => [1, -1].some((d) => [...v].every((c, i) => !i || c - v[i - 1] === d));
  function pinFor(P, n) {
    for (let i = 0; i < 50; i++) { const v = digitsFor(P, `pin${n}.${i}`, n); if (v[0] !== '0' && new Set(v).size >= Math.min(3, n) && !isSeq(v)) return v; }
    return '3871592064'.slice(0, n);
  }

  function typedValue(el, type, cat, P, st) {
    if (/^(date|datetime-local|month|week|time)$/.test(type)) {
      const d = wantDate(el, cat, P, hintOf(el), st), v = d ? fitTyped(el, type, d) : null;
      if (v && /^(date|datetime-local)$/.test(type)) tripAt(st, d, dIdx(v));
      return v;
    }
    if (type === 'color') return '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
    if (type === 'range') {
      const min = el.min !== '' ? +el.min : 0, max = el.max !== '' ? +el.max : 100, step = +el.step || 1;
      return String(min + Math.round(rint(0, Math.floor((max - min) / step)) * step * 1e6) / 1e6);
    }
    return undefined;
  }

  /* ---------- OTP shown on the page (dev / staging screens) ---------- */
  const NOT_CODE = /pin ?code|pincode|postal|post ?code|\bzip|order|invoice|amount|\btotal\b|price|\bbill\b|receipt|₹|\brs\.?\s|\binr\b|\$|€|£/i;
  function pageCode(len) {
    const txt = (document.body && document.body.innerText) || '';
    const cands = [];
    const res = [/(?:code|otp|pin|passcode)\b[^0-9\n]{0,40}?(\d{4,8})\b/gi, /\b(\d{4,8})\b[^\n]{0,15}?\b(?:is your|is the) (?:code|otp|verification|pin)/gi];
    for (const re of res) {
      let m;
      while ((m = re.exec(txt))) {
        // never a number next to PIN code / zip / order / invoice / amount words
        const at = m.index + (re === res[0] ? m[0].lastIndexOf(m[1]) : 0), end = at + m[1].length;
        const before = txt.slice(Math.max(0, m.index - 12), at), after = txt.slice(end, end + 15);
        if (NOT_CODE.test(before) || NOT_CODE.test(re === res[1] ? m[0] + after.slice(0, 6) : '') || /^\W{0,3}(pin ?code|postal|zip|order|invoice|amount)/i.test(after)) continue;
        cands.push(m[1]);
      }
    }
    if (!cands.length) return null;
    return cands.find((c) => len && c.length === len) || cands.find((c) => c.length === 6) || cands[0];
  }
  function otpLength(el) {
    if (el.maxLength >= 4 && el.maxLength <= 8) return el.maxLength;
    const ph = (el.getAttribute('placeholder') || '').replace(/\s/g, '');
    if (/^[0-9•*_\-x]{4,8}$/i.test(ph)) return ph.length;
    const m = hintOf(el).match(/\b([4-8]) ?digit/);
    return m ? +m[1] : 0;
  }
  function otpGroup(el) {
    let n = el.parentElement;
    for (let i = 0; i < 3 && n; i++, n = n.parentElement) {
      const g = [...n.querySelectorAll('input')].filter((x) => x.maxLength === 1 && !SKIP_TYPES.has(x.type) && x.type !== 'checkbox' && x.type !== 'radio');
      if (g.length >= 4 && g.length <= 8 && g.includes(el)) return g;
    }
    return null;
  }

  /* ---------- ID documents ---------- */
  const idKind = (t) => /aadha?ar/.test(t) ? 'aadhaar' : /\bpan\b/.test(t) ? 'pan' : /passport/.test(t) ? 'passport'
    : /licen[cs]e|\bdl\b|driving/.test(t) ? 'dl' : /voter|epic/.test(t) ? 'voter'
    : /national|\bnid\b|cnic|emirates|\bdni\b|identity card|\bid card|resident/.test(t) ? 'nationalId' : null;
  /* which of the offered ID kinds to use: IN → Aadhaar / PAN first; a driving licence only when asked for one or nothing else fits */
  function bestKind(P, kinds, h) {
    const ok = kinds.filter((k) => P.ids && P.ids[k]);
    if (/licen[cs]e|driving/.test(h || '') && ok.includes('dl')) return 'dl';
    return (P.country === 'IN' ? ['aadhaar', 'pan', 'passport', 'voter', 'nationalId', 'dl'] : ['nationalId', 'passport', 'voter', 'aadhaar', 'pan', 'dl']).find((k) => ok.includes(k)) || null;
  }
  function chosenIdKind(el, P) {
    const h = hintOf(el), own = idKind(h);
    if (own && P.ids[own]) return own;
    const scopes = [...new Set([el.closest('fieldset,section,div[class*="step"]'), el.form, el.getRootNode(), document])].filter((s) => s && s.querySelectorAll);
    for (const scope of scopes) {
      for (const s of scope.querySelectorAll('select')) {
        const op = s.options[s.selectedIndex];
        const k = op && !isPlaceholderOpt(op) && idKind(norm(op.text + ' ' + op.value));
        if (k && P.ids[k]) return k;
      }
      for (const r of scope.querySelectorAll('input[type=radio]:checked')) { const k = idKind(optLabel(r)); if (k && P.ids[k]) return k; }
    }
    return bestKind(P, Object.keys(P.ids), h) || Object.keys(P.ids)[0];
  }
  const idValue = (el, P) => P.ids[chosenIdKind(el, P)] || '';

  function valueFor(el, cat, P, o, st) {
    const type = (el.type || '').toLowerCase();
    const typed = typedValue(el, type, cat, P, st);
    if (typed !== undefined) return typed;
    const ta = el.tagName === 'TEXTAREA' || !!el.isContentEditable;
    const E = P.emergency || {}, N = P.nominee || {};
    const ph = (x) => { const p = phoneOf(x, P); return p ? phoneValue(el, p, o) : null; };
    const ref = () => refOf(el, cat, P, st) || {};
    switch (cat) {
      case 'email': return P.email;
      case 'password': return P.password;
      case 'mpin': return pinFor(P, el.maxLength >= 4 && el.maxLength <= 6 ? el.maxLength : 4);
      case 'phone': return phoneValue(el, P.phone, o);
      case 'landline': return landlineValue(el, P, o);
      case 'altPhone': return ph(P.altPhone);
      case 'altEmail': return P.altEmail || null;
      case 'spouseName': return namePart(el, P.spouseName);
      case 'emergencyName': return namePart(el, E.name);
      case 'emergencyRelation': return E.relation || null;
      case 'emergencyPhone': return ph(E.phone);
      case 'nomineeName': return namePart(el, N.name);
      case 'nomineeRelation': return N.relation || null;
      case 'nomineeDob': return dateText(el, dateOf(N.dob), P);
      case 'nomineeAge': { const a = nomineeAge(P); return a == null ? null : String(a); }
      case 'nomineeShare': return '100';
      case 'refName': return namePart(el, ref().name);
      case 'refPhone': return ref().phone ? ph(ref().phone) : null;
      case 'refEmail': return ref().email || null;
      case 'refRelation': return ref().relation || null;
      case 'refCompany': return ref().company || null;
      case 'refTitle': return ref().jobTitle || null;
      case 'refYears': { const y = ref().yearsKnown; return y == null || y === '' ? null : String(y); }
      case 'bloodGroup': return P.bloodGroup || null;
      case 'maritalStatus': return P.maritalStatus || null;
      case 'noticePeriod': {
        if (!P.noticePeriod) return null;
        const d = noticeDays(P.noticePeriod) || 0, h = hintOf(el);
        return /month/.test(h) ? String(Math.round(d / 30)) : type === 'number' || /\bdays?\b/.test(h) ? String(d) : P.noticePeriod;
      }
      case 'household': return String(household(P));
      case 'location': return P.state ? `${P.city}, ${P.state}` : P.city;
      case 'tehsil': return P.tehsil || null;
      case 'village': return P.village || null;
      case 'postOffice': return P.postOffice || null;
      case 'district': return P.district || P.city;
      case 'schemeId': return schemeValue(el, P);
      case 'gstin': case 'tan': case 'cin': case 'udyam': case 'vehicle': case 'cpf': case 'cnpj': return bizVal(P, cat);
      case 'uan': return bizVal(P, 'uan') || schemeValue(el, P);
      case 'houseNumber': { const m = String(P.address1 || '').match(HOUSE_NUM); return m ? m[1] : String(rint(1, 199)); }
      case 'neighborhood': return P.neighborhood || null;
      case 'card': return null; // through cardValues
      case 'abhaAddress': return `${String(P.username || 'user').toLowerCase().replace(/[^a-z0-9._]/g, '')}@abdm`;
      case 'phoneCode': return el.maxLength > 0 && el.maxLength <= P.phone.ccDigits.length ? P.phone.ccDigits : P.phone.cc;
      case 'areaCode': { // NANP: the phone's area code (a landline's / STD box: the landline's); elsewhere the landline's STD code
        if (P.phone.ccDigits === '1' && !(P.landline && P.landline.std && /\bstd\b|land ?line|office|residen|home ?phone/.test(hintOf(el)))) return P.phone.national.slice(0, 3);
        const std = String((P.landline && P.landline.std) || P.stdCode || P.phone.areaCode || '');
        return !std ? null : /^\D*[1-9]/.test(el.getAttribute('placeholder') || '') || (el.maxLength > 0 && std.length > el.maxLength) ? std.replace(/^0/, '') : std;
      }
      case 'username': return P.username;
      case 'firstName': return P.firstName;
      case 'lastName': return P.lastName;
      case 'middleName': return P.middleName || null;
      case 'fullName': return P.fullName;
      case 'fatherName': return P.fatherName;
      case 'motherName': return P.motherName;
      case 'company': return P.company;
      case 'jobTitle': return P.jobTitle;
      case 'website': return P.website;
      case 'otp': return pageCode(otpLength(el));
      case 'idType': return null;
      case 'idNumber': return idValue(el, P) || null;
      case 'refId': {
        const w = (hintOf(el).match(ORGID) || [])[1] || '';
        const pre = /roll/.test(w) ? '' : (w.replace(/[^a-z]/g, '').slice(0, 3) || 'ref').toUpperCase();
        return pre + digitsFor(P, 'ref' + pre, pre ? 5 : 7);
      }
      case 'idLast': {
        const h = hintOf(el);
        const words = { three: 3, four: 4, five: 5, six: 6 };
        const m = h.match(/last ?(\d|three|four|five|six)/);
        const n = m ? (words[m[1]] || +m[1]) : (el.maxLength > 0 && el.maxLength <= 8 ? el.maxLength : 4);
        const raw = (/account|\ba ?c\b/.test(h) ? P.accountNumber || '' : PHONE.test(h) ? P.phone.national : idValue(el, P)).replace(/[^A-Za-z0-9]/g, '');
        return /digit|number/.test(h) ? raw.replace(/\D/g, '').slice(-n) : raw.slice(-n);
      }
      case 'experience': return String(P.experience);
      case 'qualification': return P.qualification;
      case 'gradYear': return String(P.gradYear);
      case 'university': return P.university;
      case 'languages': return MOTHER_T.test(hintOf(el)) ? P.motherTongue : P.languages.join(', ');
      case 'teachSubjects': return P.teachSubjects.join(', ');
      case 'skills': return P.skills.join(', ');
      case 'bio': return ta ? P.bio : P.bio.split('. ')[0] + '.';
      case 'upi': return P.upi || null;
      case 'ifsc': return P.ifsc || null;
      case 'iban': return P.iban || null;
      case 'swift': return P.swift || null;
      case 'sortCode': return P.sortCode || null;
      case 'bsb': return P.bsb || null;
      case 'routing': return P.routing || P.transit || null;
      case 'accountNumber': return P.accountNumber || null;
      case 'bankName': return P.bankName || null;
      case 'branch': return P.branch || null;
      case 'rate': return P.country === 'IN' ? String(rint(6, 16) * 50) : String(rint(15, 60));
      case 'pan': return (P.companyPan && bizPan(el) ? P.companyPan : P.pan) || null;
      case 'aadhaar': return P.aadhaar || null;
      case 'address1': return ta ? P.fullAddress : houseBox(el, st) ? streetOf(P.address1) : P.address1; // the number has a box of its own
      case 'address2': return P.address2 || null;
      case 'city': return P.city;
      case 'state': return P.state;
      case 'zip': return P.zip;
      case 'country': return P.countryName;
      case 'dob': return dateText(el, P.dob, P);
      case 'dobDay': return pad(P.dob.d);
      case 'dobMonth': return pad(P.dob.m);
      case 'dobYear': return String(P.dob.y);
      case 'date': return dateText(el, wantDate(el, cat, P, hintOf(el), st), P);
      case 'age': return String(P.age);
      case 'gender': return P.gender === 'male' ? 'Male' : 'Female';
      case 'title': return P.title;
      case 'subject': return pick(SUBJECTS);
      case 'message': return ta ? twoSentences() : pick(SENTENCES);
      case 'quantity': return String(rint(1, 5));
      case 'amount': return String(rint(5, 500) * 100);
      case 'number': return numberValue(el);
      default: return ta ? twoSentences() : `${pick(WORDS)} ${pick(WORDS)}`.replace(/^./, (c) => c.toUpperCase());
    }
  }

  /* ---------- setters ---------- */
  const protoOf = (el) => (el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype);
  const setterOf = (el, prop) => Object.getOwnPropertyDescriptor(protoOf(el), prop).set;
  const away = (el) => { try { return !(el.ownerDocument || document).hasFocus(); } catch (e) { return false; } };
  /* focus / blur; while the page itself isn't focused (the popup is open) el.focus() fires nothing, so the events are sent too */
  const fired = (el, type, fn) => { let got = false; const h = () => { got = true; }; el.addEventListener(type, h, true); try { fn(); } catch (e) { /* ignore */ } el.removeEventListener(type, h, true); return got; };
  function focusIn(el) {
    if (!fired(el, 'focus', () => el.focus({ preventScroll: true })) && away(el)) { el.dispatchEvent(new FocusEvent('focus', { composed: true })); el.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true })); }
  }
  function focusOut(el) {
    if (!fired(el, 'blur', () => el.blur()) && away(el)) { el.dispatchEvent(new FocusEvent('blur', { composed: true })); el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true })); }
  }
  /* the page's own setter (React / Vue track it), then input + change; quiet: no focus (hidden widget selects, picker boxes) */
  function write(el, prop, v, quiet) {
    if (!quiet) focusIn(el);
    setterOf(el, prop).call(el, v);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: String(prop === 'value' ? v : el.value) }));
    // the key coming up: date pickers (bootstrap-datepicker, jQuery UI) read a typed date on keyup, or their blur puts the old one back
    if (!quiet && prop === 'value' && el.tagName !== 'SELECT') el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Unidentified', bubbles: true, cancelable: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (!quiet) focusOut(el);
  }
  /* while a fill runs, every change is logged first ({ el, kind, prev }), once per control, so undo() can put it back */
  let log = null, logged = new WeakSet();
  const note = (el, entry) => { if (log && !logged.has(el)) { logged.add(el); log.push(entry); } };
  function setValue(el, v, quiet) {
    note(el, el.tagName === 'SELECT' ? { el, kind: 'select', prev: el.selectedIndex, quiet } : { el, kind: 'value', prev: el.value });
    write(el, 'value', v, quiet);
  }
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const alnum = (s) => String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const PHONE_CATS = /^(phone|altPhone|emergencyPhone|refPhone|landline)$/;
  /* the page kept the value, or masked it with the same digits / letters (a phone mask may add the trunk 0 or the +code; one that shows
     +<code> of its own must hold the whole number after it: "+{91} 00000 00000" swallows the 91 of 9142360110) */
  let curCC = '';
  function same(a, b, cat) {
    if (a === b) return true;
    if (!a) return false;
    const da = digits(a), db = digits(b);
    if (PHONE_CATS.test(cat) && curCC && /^\s*\+/.test(a) && !/^\s*\+/.test(b) && db.length >= 7) return da === curCC + db || da === curCC + db.replace(/^0/, '');
    if (db.length >= 3 && /^[\d\W]*$/.test(b)) return da === db || (PHONE_CATS.test(cat) && db.length >= 7 && (da.endsWith(db) || db.endsWith(da)));
    return !!alnum(b) && alnum(a) === alnum(b);
  }
  const keyInit = (c) => { const k = c.toUpperCase().charCodeAt(0); return { key: c, code: /\d/.test(c) ? 'Digit' + c : /[a-z]/i.test(c) ? 'Key' + c.toUpperCase() : '', keyCode: k, which: k, bubbles: true, cancelable: true, composed: true }; };
  const BKSP = { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true, composed: true };
  /* a mask that rewrote or dropped the value (inputmask, cleave, imask, react-input-mask, JS maxlength): type it again key by key,
     after select all + Backspace (inputmask clears its buffer on the key; an empty value alone reads to it as a partial edit) */
  function retype(el, v) {
    const set = setterOf(el, 'value');
    focusIn(el);
    try { el.setSelectionRange(0, el.value.length); } catch (x) { /* no selection on this type */ }
    if (el.dispatchEvent(new KeyboardEvent('keydown', BKSP))) { set.call(el, ''); el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'deleteContentBackward' })); }
    el.dispatchEvent(new KeyboardEvent('keyup', BKSP));
    for (const c of v) {
      const k = keyInit(c);
      if (el.dispatchEvent(new KeyboardEvent('keydown', k))
        && el.dispatchEvent(new KeyboardEvent('keypress', { ...k, charCode: c.charCodeAt(0), keyCode: c.charCodeAt(0), which: c.charCodeAt(0) }))
        && el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: c, bubbles: true, cancelable: true, composed: true }))) {
        let s = el.value.length, e = s;
        try { if (el.selectionStart != null) { s = el.selectionStart; e = el.selectionEnd; } } catch (x) { /* no selection on this type */ }
        set.call(el, el.value.slice(0, s) + c + el.value.slice(e));
        try { el.setSelectionRange(s + 1, s + 1); } catch (x) { /* ignore */ }
        el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: c, bubbles: true, composed: true }));
      }
      el.dispatchEvent(new KeyboardEvent('keyup', k));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    focusOut(el);
  }
  function put(el, v, cat) {
    setValue(el, v);
    if (same(el.value, v, cat) || !/^(text|tel|email|password|url|search|)$/.test((el.type || '').toLowerCase())) return;
    retype(el, v);
  }
  /* how far a value is from fitting the box, before writing it */
  function pre(el, v) {
    const ml = maxLen(el), mn = minLen(el), re = patternOf(el), type = (el.type || '').toLowerCase();
    let n = (ml && v.length > ml ? 1 : 0) + (mn && v.length < mn ? 1 : 0) + (re && !re.test(v) ? 1 : 0);
    if (type === 'email' && !/^[^\s@]+@[^\s@]+$/.test(v)) n++;
    if (type === 'url' && !/^[a-z][a-z0-9+.-]*:\S+$/i.test(v)) n++;
    if (type === 'number') { const x = +v, lo = numAttr(el.min), hi = numAttr(el.max); if (!isFinite(x) || (lo != null && x < lo) || (hi != null && x > hi)) n++; }
    return n;
  }
  /* after writing: the browser's own validity, the length limits (script-set values skip them) and whether the page kept it */
  function bad(el, v, cat) {
    const s = el.validity, val = el.value, ml = maxLen(el), mn = minLen(el);
    let n = 0;
    if (s) for (const k of ['patternMismatch', 'typeMismatch', 'rangeUnderflow', 'rangeOverflow', 'stepMismatch', 'badInput', 'valueMissing', 'customError']) if (s[k]) n++;
    if (ml && val.length > ml) n++;
    if (mn && val && val.length < mn) n++;
    if (!same(val, v, cat)) n += 4; // the page rewrote / dropped it (other digits in a mask): worse than any value it kept
    return n;
  }
  /* writes the best candidate; while the box says it is invalid, up to 3 others; the most valid one stays (prefer: the one to keep
     when none is valid, a confirm box's password). Returns how far the value left in the box is from valid (0: valid). */
  function fit(el, list, cat, prefer) {
    const order = list.map((v, i) => [v, pre(el, v), i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map((x) => x[0]);
    let best = null, low = Infinity;
    for (const v of order.slice(0, 4)) {
      put(el, v, cat);
      const n = bad(el, v, cat);
      if (n < low) { low = n; best = v; }
      if (!n) return 0;
    }
    if (prefer) best = prefer;
    // letters / digits alone don't tell two passwords (or emails) apart that differ in a symbol: those go back exactly
    if (best != null && (/^(password|email|altEmail|refEmail|username)$/.test(cat) ? el.value !== best : !same(el.value, best, cat))) put(el, best, cat);
    return best === prefer ? bad(el, best, cat) : low;
  }

  let glowIndex = 0;
  function glow(el, on) {
    if (!on || !el.animate) return;
    const target = el.labels && checkVisible(el) && !boxVisible(el) && el.labels[0] ? el.labels[0] : el;
    target.animate([
      { boxShadow: '0 0 0 0 rgba(255,255,255,0), 0 0 0 0 rgba(24,24,27,0)' },
      { boxShadow: '0 0 0 2px rgba(255,255,255,1), 0 0 0 4px rgba(24,24,27,.9)', offset: 0.2 },
      { boxShadow: '0 0 0 2px rgba(255,255,255,0), 0 0 0 4px rgba(24,24,27,0)' },
    ], { duration: 1500, delay: Math.min(glowIndex++ * 30, 900), easing: 'ease-out' });
  }

  /* a placeholder option: "-- Select --", "Choose…", "Please select", "Pick one", an empty first option; not "Pick-up" or a later "None of these" */
  const PH_OPT = /^\s*(-+(\s|$)|-{2,}|—|select\b|choose\b|please\b|pick (a|an|one|your|the|from)\b)/i;
  const isPlaceholderOpt = (op) => PH_OPT.test(op.text) || (op.value === '' && (op.index <= 0 || !op.text.trim()))
    || (op.index === 0 && /^\s*none\s*$/i.test(op.text))
    || (op.index === 0 && /^(0|-1)$/.test(op.value) && /^\s*(day|month|year|dd|mm|yy|yyyy)\s*$/i.test(op.text)); // Facebook-style <option value="0">Day</option>
  /* with Overwrite off a select already on a real option keeps it, even at index 0, except where the first option is only the
     default and no one's choice: a date part (Day 1 / January / the first year) and a country-code list (+1 first) */
  const DEFAULT_SEL = /^(date|dob|dobDay|dobMonth|dobYear|nomineeDob|phoneCode)$/;
  const datePart = (el, hint) => /\b(day|month|year|dd|mm|yyyy)\b/.test(hint) && [...el.options].filter((o) => /^\d{1,4}$/.test(o.text.trim()) || monthOf(o.text)).length >= 0.8 * el.options.length;
  /* random pick that avoids "Other" / "Prefer not to say" / "N/A" unless nothing else is left */
  const pickReal = (list, lab) => { const ok = list.filter((x) => !DOWN.test(lab(x))); return pick(ok.length ? ok : list); };

  /* the option to choose among opts: a select's real options, or a widget's own list ({ text, value, index, node }); null for none.
     want: a rule's value (cat 'rule'), matched as written */
  function pickOption(el, opts, cat, P, hint, st, want) {
    if (cat === 'rule') return ruleOpt(opts, want);
    const t = (op) => norm(op.text), v = (op) => norm(op.value);
    const find = (fn) => opts.find(fn);
    const eq = (list) => find((op) => list.some((x) => x && (t(op) === norm(x) || v(op) === norm(x))));
    const inc = (list) => find((op) => list.some((x) => x && norm(x).length > 2 && t(op).includes(norm(x))));
    const num = (e) => find((op) => {
      const nums = (op.text.match(/\d+/g) || []).map(Number);
      if (nums.length >= 2) return e >= nums[0] && e <= nums[1];
      if (nums.length === 1) return /\+|more|above|over/.test(t(op)) ? e >= nums[0] : /less|below|under|</.test(t(op)) ? e < nums[0] : e === nums[0];
      return false;
    });
    let target = null;

    if (cat === 'phoneCountry') { // react-phone-number-input's country <select>: the persona's country or nothing
      target = find((op) => norm(op.value) === norm(P.country)) || eq(P.countryAliases || []);
      if (!target) return null;
    } else if (cat === 'phoneCode' || isCodeSelect(el)) {
      const re = new RegExp('(^|[^\\d])\\+?' + P.phone.ccDigits + '([^\\d]|$)');
      const hits = opts.filter((op) => re.test(op.text) || re.test(op.value));
      target = hits.find((op) => P.countryAliases.some((a) => a.length > 2 && t(op).includes(norm(a)))) || hits[0] || null;
    } else if (cat === 'country') {
      target = eq(P.countryAliases) || inc([P.countryName]);
    } else if (cat === 'state') {
      target = eq([...aka(P.state), ...aka(P.stateAbbr)]) || inc(aka(P.state));
    } else if (cat === 'city' || cat === 'location' || cat === 'district') {
      const c = cat === 'district' && P.district ? [norm(P.district), ...aka(P.city)] : aka(P.city);
      target = eq(c) || inc(c) || (cat === 'location' ? eq(aka(P.state)) || inc(aka(P.state)) : null);
    } else if (cat === 'tehsil' || cat === 'village' || cat === 'postOffice') {
      const x = P[cat] ? [P[cat], P[cat].replace(/\s*\b(s\.?o|b\.?o|h\.?o)\.?$/i, '')] : [];
      target = eq(x) || inc(x);
    } else if (cat === 'emergencyRelation' || cat === 'nomineeRelation') {
      const r = (cat === 'nomineeRelation' ? P.nominee : P.emergency) || {};
      for (const w of r.relation ? relWords(r.relation, P) : []) {
        const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        target = eq([w]) || find((op) => re.test(t(op)) && !/in ?law|grand|step|god/.test(t(op)));
        if (target) break;
      }
    } else if (cat === 'refRelation') {
      const rel = norm((refOf(el, cat, P, st) || {}).relation), words = (REF_REL.find(([re]) => re.test(rel)) || [0, []])[1];
      target = eq([rel]) || inc([rel]);
      for (const w of words) { if (target) break; target = find((op) => t(op).includes(w)); }
    } else if (cat === 'refYears') {
      const y = (refOf(el, cat, P, st) || {}).yearsKnown;
      if (y != null) target = num(+y);
    } else if (cat === 'bloodGroup' && P.bloodGroup) {
      const want = bloodKey(P.bloodGroup);
      target = find((op) => bloodKey(op.text) === want || bloodKey(op.value) === want) || find((op) => bloodKey(op.text).startsWith(want));
    } else if (cat === 'maritalStatus' && P.maritalStatus) {
      target = /^married/i.test(P.maritalStatus) ? find((op) => /\bmarried\b/.test(t(op)) && !/un ?married|never|\bnot\b/.test(t(op))) || find((op) => /^(m|yes)$/.test(t(op)))
        : find((op) => /\bsingle\b|un ?married|never ?married|bachelor|spinster/.test(t(op))) || find((op) => /^(s|u|no)$/.test(t(op)));
    } else if (cat === 'noticePeriod' && P.noticePeriod) {
      const want = noticeDays(P.noticePeriod) || 0;
      let best = Infinity;
      for (const op of opts) { const d = noticeDays(op.text); if (d != null && Math.abs(d - want) < best) { best = Math.abs(d - want); target = op; } }
    } else if (cat === 'gender' || (cat === 'title' && opts.some((op) => SALUTE.test(op.text.trim())))) {
      if (cat === 'title') target = eq([P.title, P.title + '.']) || find((op) => (P.gender === 'male' ? SAL_M : SAL_F).test(t(op)));
      else target = P.gender === 'male'
        ? find((op) => /^(m|male|man|boy)$/.test(t(op)) || (MALE.test(t(op)) && !FEMALE.test(t(op))))
        : find((op) => /^(f|female|woman|girl)$/.test(t(op)) || FEMALE.test(t(op)));
    }
    if (!target && (cat === 'experience' || cat === 'age' || cat === 'household' || cat === 'nomineeAge')) {
      const e = cat === 'age' ? P.age : cat === 'household' ? household(P) : cat === 'nomineeAge' ? nomineeAge(P) : P.experience;
      if (e != null) target = num(e);
    }
    if (!target && cat === 'qualification') {
      const master = /^M\.|^M[A-Z]|Master/.test(P.qualification);
      target = master ? find((op) => /post ?grad|master|\bm\.|\bmba\b|\bmca\b|\bpg\b/.test(t(op)))
        : find((op) => /bachelor|\bgraduat|\bb\.|\bug\b|degree/.test(t(op)) && !/post|master|under ?grad/.test(t(op)));
      if (!target) target = inc([P.qualification.replace(/\s*\(.*\)/, '')]);
    }
    if (!target) {
      const kinds = opts.map((op) => idKind(t(op) + ' ' + v(op)));
      if (cat === 'idType' || kinds.filter(Boolean).length >= 2) { const k = bestKind(P, kinds.filter(Boolean), hint); if (k) target = opts[kinds.indexOf(k)]; }
    }
    if (!target && (cat === 'languages' || cat === 'teachSubjects' || cat === 'university')) {
      const list = cat === 'languages' ? (MOTHER_T.test(hint) ? [P.motherTongue] : P.languages) : cat === 'teachSubjects' ? P.teachSubjects : [P.university];
      target = eq(list) || inc(list);
    }
    if (!target && /^dob(Day|Month|Year)$/.test(cat)) {
      const d = P.dob;
      target = cat === 'dobYear' ? eq([String(d.y)]) : cat === 'dobDay' ? eq([String(d.d), pad(d.d)])
        : eq([String(d.m), pad(d.m)]) || find((op) => t(op).slice(0, 3) === MONTHS[d.m - 1]);
    }
    const nd = cat === 'nomineeDob' && dateOf(P.nominee && P.nominee.dob);
    if (!target && (/birth|dob|\bday\b|month|year|\bdd\b|\bmm\b|yyyy|\b(tag|monat|jahr|jour|mois|mes|ano|anno|giorno|mese)\b|ann[ée]e|\bd[ií]a\b|\ba[ñn]o\b/.test(hint) || BIRTH.test(hint)) && (cat !== 'nomineeDob' || nd)) {
      const d = nd || (cat === 'dob' || /birth|dob/.test(hint) || BIRTH.test(hint) ? P.dob : wantDate(el, cat, P, hint, st) || futureDate());
      const allNum = opts.every((op) => /^\d+$/.test(op.text.trim()));
      if (allNum && opts.every((op) => /^\d{4}$/.test(op.text.trim()))) target = eq([String(d.y)]);
      else if (opts.length === 12 && /jan|^\W*(ene|gen|jän)/i.test(opts[0].text + opts[0].value)) target = opts[d.m - 1];
      else if (opts.length === 12 && allNum) target = opts[d.m - 1];
      else if (allNum && opts.length >= 28 && opts.length <= 31) target = opts[d.d - 1];
    }
    return target || pickReal(opts, t);
  }
  function fillSelect(el, cat, P, hint, st, quiet, want) {
    const opts = [...el.options].filter((op) => !op.disabled && !isPlaceholderOpt(op)), t = (op) => norm(op.text);
    const target = opts.length && pickOption(el, opts, cat, P, hint, st, want);
    if (!target) return false;
    if (el.multiple) { // 1–2 options (a rule's one)
      const more = opts.filter((op) => op !== target && !DOWN.test(t(op))), on = [target].concat(cat !== 'rule' && more.length && Math.random() < 0.5 ? [pick(more)] : []);
      note(el, { el, kind: 'multi', prev: [...el.options].map((op) => op.selected), quiet });
      if (!quiet) focusIn(el);
      const sel = Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype, 'selected').set;
      [...el.options].forEach((op) => sel.call(op, on.includes(op)));
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (!quiet) focusOut(el);
    } else setValue(el, target.value, quiet);
    refresh(el);
    return true;
  }

  /* If the page has a State dropdown that doesn't list our state (under any of its names), move the persona to one it does list */
  function alignLocation(P, items) {
    if (!P.locations) return P;
    for (const { el, cat } of items) {
      if (el.tagName !== 'SELECT' || cat !== 'state') continue;
      const vals = [];
      for (const op of el.options) { vals.push(norm(op.text)); vals.push(norm(op.value)); }
      const has = (loc) => [...aka(loc.state), ...aka(loc.stateAbbr)].some((x) => x && vals.includes(x)) || (norm(loc.state).length > 4 && vals.some((x) => x.includes(norm(loc.state))));
      if (has(P)) return P;
      const ok = P.locations.filter(has);
      if (!ok.length) return P;
      const Q = { ...P, ...pick(ok) };
      Q.fullAddress = [Q.address1, Q.address2, `${Q.city}, ${Q.state} ${Q.zip}`].filter(Boolean).join(', ');
      return Q;
    }
    return P;
  }

  const twoSentences = () => { const a = pick(SENTENCES); let b; do { b = pick(SENTENCES); } while (b === a); return `${a} ${b}`; };

  /* ---------- phone country widgets ---------- */
  const view = (x) => (x.ownerDocument && x.ownerDocument.defaultView) || window;
  /* a user's click: pointer / mouse down and up, then click (links inside a calendar don't navigate) */
  function clickEl(x) {
    const w = view(x), o = { bubbles: true, cancelable: true, composed: true, view: w, button: 0 }, Ptr = w.PointerEvent || PointerEvent;
    x.dispatchEvent(new Ptr('pointerdown', { ...o, buttons: 1, pointerType: 'mouse', isPrimary: true }));
    x.dispatchEvent(new MouseEvent('mousedown', { ...o, buttons: 1 }));
    x.dispatchEvent(new Ptr('pointerup', { ...o, pointerType: 'mouse', isPrimary: true }));
    x.dispatchEvent(new MouseEvent('mouseup', o));
    const a = x.closest && x.closest('a[href]'), stop = (e) => e.preventDefault();
    if (a) w.addEventListener('click', stop);
    x.dispatchEvent(new MouseEvent('click', { ...o, detail: 1 }));
    if (a) w.removeEventListener('click', stop);
  }
  const escKey = (x) => x && ['keydown', 'keyup'].forEach((t) => x.dispatchEvent(new KeyboardEvent(t, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true, composed: true })));
  /* intl-tel-input: the country its button shows ('' none, null no button) and picking one in its list */
  const itiBtn = (iti) => iti.querySelector('.iti__selected-country,.iti__selected-flag,[role=combobox]');
  function itiCountry(iti) {
    const btn = itiBtn(iti), flag = btn && btn.querySelector('.iti__flag');
    if (!btn) return null;
    const c = flag && [...flag.classList].find((x) => /^iti__[a-z]{2}$/.test(x));
    return c ? c.slice(5) : '';
  }
  function itiPick(iti, cc, dial) {
    const btn = itiBtn(iti), doc = iti.ownerDocument;
    clickEl(btn);
    const id = btn.getAttribute('aria-controls');
    const list = (id && doc.getElementById(id)) || iti.querySelector('.iti__country-list') || doc.querySelector('.iti--container .iti__country-list,.iti__country-list');
    const li = list && (list.querySelector(`[data-country-code="${cc}"]`) || (dial && [...list.querySelectorAll('[role=option],li')].find((x) => x.getAttribute('data-dial-code') === dial)));
    if (li) clickEl(li);
    if (btn.getAttribute('aria-expanded') === 'true') { escKey(list || doc); if (btn.getAttribute('aria-expanded') === 'true') clickEl(btn); }
    return itiCountry(iti) === cc;
  }
  /* intl-tel-input: pick the persona's country in its list; react-phone-number-input: set its country <select> first */
  function telCountry(el, P, st) {
    const cc = norm(P.country), dial = P.phone && P.phone.ccDigits;
    const iti = el.closest('.iti');
    if (iti && cc) {
      const was = itiCountry(iti);
      if (was === null || was === cc) return;
      note(iti, { el: iti, kind: 'iti', prev: was }); // undo picks the country shown before
      itiPick(iti, cc, dial);
      return;
    }
    const pi = el.closest('.PhoneInput'), s = pi && pi.querySelector('select');
    if (s && cc && norm(s.value) !== cc && fillSelect(s, 'phoneCountry', P, '', st, false)) { st.count++; noteRec(st, s, 'phoneCountry'); return true; } // React re-renders it before the number goes in
    return false;
  }

  /* ---------- Tom Select / Selectize / Choices.js: opened, the option clicked in their own list, closed (DOM only) ---------- */
  function widgetParts(el, kind, box) {
    const [cs, ds, os] = DRIVEN[kind], doc = el.ownerDocument, ctl = box.querySelector(cs) || box;
    const drops = () => [...box.querySelectorAll(ds)].concat([...doc.querySelectorAll(ds)].filter((d) => !d.closest('.ts-wrapper,.selectize-control,.choices'))).filter(laidOut); // also one moved to <body>
    const items = () => drops().flatMap((d) => [...d.querySelectorAll(os)]).filter(laidOut);
    const input = () => box.querySelector('input:not([type=hidden])') || ctl;
    // closed by leaving it (blur), never Escape (a dialog around it would close too); a list it opens again a moment later is closed again
    const shut = () => {
      const a = deepActive();
      if (a && (box.contains(a) || drops().some((d) => d.contains(a)))) focusOut(a);
      if (drops().length) { const i = input(); focusIn(i); focusOut(i); }
      if (drops().length) { // still open (Selectize after a key): a press next to it, inside its own block (not "outside" a dialog around it)
        const p = box.parentElement || doc.body, init = { bubbles: true, cancelable: true, composed: true, view: view(p), button: 0 };
        for (const t of ['mousedown', 'mouseup']) p.dispatchEvent(new MouseEvent(t, init));
      }
    };
    function* close() { shut(); const t0 = Date.now(); yield () => Date.now() - t0 >= 30; shut(); }
    return { box, ctl, items, input, close, open: () => drops().length > 0 };
  }
  const chosenVals = (el) => [...el.options].filter((x) => x.selected && x.value !== '').map((x) => x.value);
  /* picks: the options to click, chosen from the widget's own list ({ text, value, index, node }) */
  function* drivePick(el, w, picks) {
    if (!w.open()) clickEl(w.ctl);
    const nodes = yield () => { const x = w.items(); return x.length ? x : null; };
    if (!nodes) { yield* w.close(); return false; }
    const opts = nodes.map((x, i) => ({ text: textOf(x), value: x.getAttribute('data-value'), index: i, node: x }))
      .filter((x) => !x.node.matches('.disabled,.choices__item--disabled,[aria-disabled=true]'));
    const want = picks(opts.filter((x) => !x.node.matches('.choices__placeholder') && !isPlaceholderOpt(x)), opts) || [];
    for (let k = 0; k < want.length; k++) {
      const v = want[k].value;
      let node = want[k].node;
      if (k) { if (!w.open()) clickEl(w.ctl); node = yield () => w.items().find((x) => x.getAttribute('data-value') === v) || null; if (!node) break; }
      clickEl(node);
      yield () => (v ? chosenVals(el).includes(v) : !chosenVals(el).length);
    }
    yield* w.close();
    return want.length > 0 && (want[0].value ? chosenVals(el).includes(want[0].value) : !chosenVals(el).length);
  }
  function widgetFill(a, P, st, o) {
    const el = a.el, entry = { el, kind: 'widget', prev: chosenVals(el), drive: a.drive, box: a.box };
    note(el, entry);
    const picks = (opts) => {
      const t = opts.length && pickOption(el, opts, a.cat, P, a.hint, st, a.ruleVal);
      if (!t || !el.multiple || a.cat === 'rule') return t ? [t] : null;
      const more = opts.filter((x) => x !== t && !DOWN.test(norm(x.text)));
      return [t].concat(more.length && Math.random() < 0.5 ? [pick(more)] : []);
    };
    const done = (ok) => {
      if (ok) { noWidget.delete(el); st.count++; glow(a.box, o.highlight); noteRec(st, el, a.cat, 'choose', textOf(el.selectedOptions && el.selectedOptions[0]), a.box); return; }
      if (st.why) st.why.set(el, 'widget');
      noWidget.add(el); // its list never opened: inspect() says 'widget'; the <select> alone would leave the widget showing something else
      const i = log ? log.indexOf(entry) : -1;
      if (i >= 0 && chosenVals(el).join('\n') === entry.prev.join('\n')) { log.splice(i, 1); logged.delete(el); }
    };
    const r = drive(drivePick(el, widgetParts(el, a.drive, a.box), picks));
    return r && typeof r.then === 'function' ? r.then(done) : done(r);
  }
  /* undo: what the fill added comes off (the item's remove button, else Backspace in the widget's box), what was there is picked again */
  function* widgetBack(el, kind, box, prev) {
    const w = widgetParts(el, kind, box), back = () => chosenVals(el).join('\n') === prev.join('\n');
    for (let k = 0; k < 4 && !back(); k++) {
      const extra = chosenVals(el).filter((v) => !prev.includes(v)), v = extra[extra.length - 1];
      if (!v) break;
      const item = [...box.querySelectorAll('[data-value]')].find((x) => x.getAttribute('data-value') === v && !x.closest(DRIVEN[kind][1]));
      const btn = item && item.querySelector('.remove,.choices__button,[aria-label*=remove i]');
      if (btn) clickEl(btn);
      else { const i = w.input(); focusIn(i); for (const t of ['keydown', 'keyup']) i.dispatchEvent(new KeyboardEvent(t, BKSP)); }
      const t0 = Date.now(); // Selectize focuses itself again a task after the key: left only after that
      if (!(yield () => Date.now() - t0 >= 30 && !chosenVals(el).includes(v))) break;
    }
    const miss = prev.filter((v) => !chosenVals(el).includes(v));
    if (miss.length || (!prev.length && chosenVals(el).length)) yield* drivePick(el, w, (opts, all) => (miss.length ? all.filter((x) => miss.includes(x.value)) : all.filter((x) => x.value === '').slice(0, 1)));
    else yield* w.close();
    return back();
  }

  /* ---------- date pickers: open the calendar the box renders, step to the month, click the day (DOM only) ---------- */
  const PICK_MS = 300, PICK_ALL_MS = 5000; // one calendar's wait; all calendars of one fill (the background stops waiting at 10 s)
  /* on screen by layout (a popup sliding in is scaled to 0 for a moment, so its box says nothing) */
  const laidOut = (x) => { if (!x || !x.isConnected) return false; const st = getComputedStyle(x); return st.display !== 'none' && st.visibility !== 'hidden' && ((x.offsetWidth > 1 && x.offsetHeight > 1) || boxVisible(x)); };
  /* A step is a generator that yields probes: a truthy answer resumes it at once, else the probe is polled until it answers or
     PICK_MS pass (it resumes with null). It stays synchronous while every probe answers right away. */
  function drive(g) { return step(g, g.next()); }
  function step(g, r) {
    while (!r.done) {
      const probe = r.value, v = ask(probe);
      if (!v) return wait(probe).then((x) => step(g, g.next(x)));
      r = g.next(v);
    }
    return r.value;
  }
  const ask = (probe) => { try { return probe(); } catch (e) { return null; } };
  const wait = (probe) => new Promise((res) => { const t0 = Date.now(), tick = () => { const v = ask(probe); if (v || Date.now() - t0 >= PICK_MS) res(v || null); else setTimeout(tick, 15); }; setTimeout(tick, 15); });
  /* runs tasks in turn; synchronous until one returns a promise */
  function series(tasks, done) {
    for (let i = 0; i < tasks.length; i++) {
      let r;
      try { r = tasks[i](); } catch (e) { continue; }
      if (r && typeof r.then === 'function') return r.catch(() => {}).then(() => series(tasks.slice(i + 1), done));
    }
    return done();
  }
  const CAL = '.flatpickr-calendar,.react-datepicker-popper,.react-datepicker,.MuiPickersPopper-root,.MuiDialog-root,.MuiDateCalendar-root,.ant-picker-dropdown,#ui-datepicker-div,.ui-datepicker,'
    + '.datepicker-dropdown,.datepicker,[role=dialog],[role=grid],[role=application],[class*=calendar i],[class*=datepicker i],[class*=date-picker i]';
  const DAYS = '.flatpickr-day,.react-datepicker__day,.MuiPickersDay-root,td.ant-picker-cell,td[data-handler=selectDay],td.day,[role=gridcell],[data-date],[data-day],[data-timestamp]';
  const cellNum = (x) => { const t = (x.textContent || '').trim(); return /^\d{1,2}$/.test(t) && +t >= 1 && +t <= 31 ? +t : 0; };
  function dayCells(c) {
    let list = [...c.querySelectorAll(DAYS)].filter(cellNum);
    if (list.length < 28) list = [...c.querySelectorAll('td,button,a,span,div,li')].filter((x) => cellNum(x) && ![...x.children].some((k) => cellNum(k)));
    return list.filter(laidOut);
  }
  /* where a calendar may be: known / calendar-named popups, plus any block next to the box or on the body */
  const calCands = (el) => [...new Set(deepQuery(document, CAL, []).concat([el.parentElement, el.parentElement && el.parentElement.parentElement, document.body].flatMap((n) => (n ? [...n.children] : []))))];
  /* the ones on screen before opening, with their content */
  const calsNow = (el) => new Map(calCands(el).filter(laidOut).map((c) => [c, c.innerHTML]));
  const calsSet = (el) => new Set(calCands(el).filter(laidOut));
  /* a calendar: a month of day cells, or (a calendar-named popup) a year / month view (bootstrap-datepicker startView: 2, MUI openTo="year") */
  const calLike = (c) => dayCells(c).length >= 28 || (c.matches(CAL) && (yearCells(c).length >= 9 || monthCells(c).length >= 12));
  const isCal = (el, c) => !c.contains(el) && laidOut(c) && calLike(c);
  /* a date box no library marks whose focus opens a calendar: seen open (focused, as the write that follows would), then closed again;
     not one: it stays focused for that write */
  function opensCal(el) {
    const open = () => calCands(el).filter((c) => isCal(el, c));
    if (el === deepActive()) return open().length > 0; // the user's click opened it
    const was = new Set(open());
    focusIn(el);
    if (!open().some((c) => !was.has(c) || (c.id === 'ui-datepicker-div' && el.classList.contains('hasDatepicker')))) return false;
    closeNew(el, was);
    focusOut(el);
    return true;
  }
  /* calendars on screen that weren't there before: closed with Escape (after a typed date, an undo, a give-up), only when one is open */
  function closeNew(el, before, any) { // any: a calendar-named popup without a day grid too (a time-only flatpickr)
    const pops = calCands(el).filter((c) => (!before.has(c) || (c.id === 'ui-datepicker-div' && el.classList.contains('hasDatepicker')))
      && (any ? !c.contains(el) && laidOut(c) && c.matches(CAL) : isCal(el, c))); // jQuery UI's one calendar is everyone's
    if (!pops.length) return false;
    escKey(el);
    pops.forEach((c) => { if (laidOut(c)) escKey(c); });
    return true;
  }
  function findCal(el, before) {
    const has = calCands(el).filter((c) => isCal(el, c));
    const shared = (c) => c.id === 'ui-datepicker-div' && el.classList.contains('hasDatepicker') && before.get(c) !== c.innerHTML; // jQuery UI re-renders its one calendar
    let pool = has.filter((c) => !before.has(c) || shared(c));
    if (!pool.length) pool = has.filter((c) => { for (let n = el.parentElement, i = 0; n && i < 3 && !n.matches('form,body'); n = n.parentElement, i++) if (n.contains(c)) return true; return false; }); // inline, next to the box
    pool = pool.filter((c) => !pool.some((p) => p !== c && p.contains(c)));
    return pool[pool.length - 1] || null;
  }
  function parseAny(s) {
    if (!s) return null;
    s = String(s).trim();
    let m;
    if (/^\d{11,14}$/.test(s)) { const t = new Date(+s), u = !t.getUTCHours() && !t.getUTCMinutes(); return u ? { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() } : { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() }; }
    if ((m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))) return { y: +m[1], m: +m[2], d: +m[3] };
    const M = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
    if ((m = s.match(new RegExp(M + '\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})', 'i')))) return { y: +m[3], m: MONTHS.indexOf(m[1].toLowerCase()) + 1, d: +m[2] };
    if ((m = s.match(new RegExp('(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + M + ',?\\s+(\\d{4})', 'i')))) return { y: +m[3], m: MONTHS.indexOf(m[2].toLowerCase()) + 1, d: +m[1] };
    return null;
  }
  const DATE_ATTRS = ['data-date', 'data-value', 'data-iso', 'data-timestamp', 'datetime', 'title', 'aria-label'];
  function cellDate(x) {
    const td = x.closest('td'), n0 = cellNum(x);
    if (td && td.hasAttribute('data-year') && td.hasAttribute('data-month')) return { y: +td.getAttribute('data-year'), m: +td.getAttribute('data-month') + 1, d: n0 }; // jQuery UI, 0-based month
    for (const n of [x, x.firstElementChild, td]) if (n) for (const a of DATE_ATTRS) { const t = parseAny(n.getAttribute(a)); if (t && t.d === n0) return t; }
    return null;
  }
  const OUT_CLS = /outside|other-?month|prev(ious)?-?month|next-?month|adjacent|\bold\b|\bnew\b|not-?current/i, OFF_CLS = /disabled|unselectable|unavailable|not-?allowed|blocked/i;
  const outside = (x) => OUT_CLS.test(cls(x) + ' ' + cls(x.closest('td'))) || (x.matches('.ant-picker-cell') && !x.classList.contains('ant-picker-cell-in-view'));
  const dayOff = (x) => [x, x.closest('td'), x.querySelector('button,a')].some((n) => n && (OFF_CLS.test(cls(n)) || n.hasAttribute('disabled') || n.getAttribute('aria-disabled') === 'true'));
  /* the month a calendar shows: from its day cells' dates, its month / year selects, or its header text */
  function shownMonth(cal) {
    if (!cal) return null;
    const n = new Map();
    for (const x of dayCells(cal)) { const t = cellDate(x); if (t) { const k = t.y * 12 + t.m - 1; n.set(k, (n.get(k) || 0) + 1); } }
    if (n.size) { const k = [...n.entries()].sort((a, b) => b[1] - a[1])[0][0]; return { y: Math.floor(k / 12), m: (k % 12) + 1 }; }
    const c = ymControls(cal);
    let m = c.month ? monthOf((c.month.options[c.month.selectedIndex] || {}).text) : 0, y = c.year ? +(c.year.value || '') || 0 : 0;
    if (c.year && c.year.tagName === 'SELECT' && !/^\d{4}$/.test(c.year.value)) y = +((c.year.options[c.year.selectedIndex] || {}).text || 0);
    if (!m || !y) {
      for (const x of cal.querySelectorAll('*')) {
        if (x.closest('select') || cellNum(x)) continue;
        const t = (x.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 40) continue;
        const mm = t.match(/(?:^|[^a-z])(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?![a-z])\W*(\d{4})?/i);
        if (mm) { m = m || MONTHS.indexOf(mm[1].toLowerCase()) + 1; if (mm[2]) y = y || +mm[2]; }
        else if (/^\d{4}$/.test(t)) y = y || +t;
        if (m && y) break;
      }
    }
    return m && y ? { y, m } : null;
  }
  function ymControls(cal) {
    const sels = [...cal.querySelectorAll('select')];
    const month = sels.find((s) => [...s.options].filter((o) => monthOf(o.text)).length >= 12);
    const year = sels.find((s) => s !== month && [...s.options].filter((o) => /^\d{4}$/.test(o.text.trim())).length >= 2)
      || [...cal.querySelectorAll('input')].find((i) => /^\d{4}$/.test(i.value.trim()));
    return { month, year };
  }
  function setYear(x, y) {
    if (x.tagName === 'SELECT') {
      const ops = [...x.options].filter((o) => /^\d{4}$/.test(o.text.trim())).sort((a, b) => Math.abs(+a.text - y) - Math.abs(+b.text - y));
      if (!ops.length || ops[0].selected) return false;
      write(x, 'value', ops[0].value, true);
      return true;
    }
    if (+x.value === y) return false;
    write(x, 'value', String(y), true);
    x.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); // flatpickr reads its year box on keyup
    return true;
  }
  function setMonth(x, m) {
    const op = [...x.options].find((o) => monthOf(o.text) === m);
    if (!op || op.selected) return false;
    write(x, 'value', op.value, true);
    return true;
  }
  const NAV = [['.flatpickr-prev-month,.react-datepicker__navigation--previous,.ant-picker-header-prev-btn,.ui-datepicker-prev,.datepicker-days .prev', /\bprev(ious)?\b|prev-?month|\bback\b/i, /^[‹«❮◀←<⟨]$/],
    ['.flatpickr-next-month,.react-datepicker__navigation--next,.ant-picker-header-next-btn,.ui-datepicker-next,.datepicker-days .next', /\bnext\b|next-?month|\bforward\b/i, /^[›»❯▶→>⟩]$/]];
  /* prev / next month (wide: also the year / decade ones, for a year view) */
  function navBtn(cal, dir, wide) {
    if (!cal) return null;
    const [sel, word, sign] = NAV[dir < 0 ? 0 : 1];
    const lab = (x) => [x.getAttribute('aria-label'), x.getAttribute('title'), cls(x)].join(' ');
    const list = [...new Set([...cal.querySelectorAll(sel)].concat([...cal.querySelectorAll('button,a,[role=button],th,span,div,i')]
      .filter((x) => word.test(lab(x)) || (!x.children.length && sign.test((x.textContent || '').trim())))))]
      .filter((x) => !/\d/.test(x.textContent || '') && !(wide ? /today|clear|close|cancel/i : /year|decade|super|today|clear|close|cancel/i).test(lab(x)) && laidOut(x) && !dayOff(x));
    const inner = list.filter((x) => !list.some((y) => y !== x && x.contains(y)));
    return (wide && inner.find((x) => /year|decade|super/i.test(lab(x)))) || inner[0] || null;
  }
  const leaves = (cal, ok) => (cal ? [...cal.querySelectorAll('button,td,span,div,li,a')].filter((x) => ok(x) && ![...x.children].some(ok) && !x.closest('select') && laidOut(x)) : []);
  const yearCells = (cal) => leaves(cal, (x) => /^\d{4}$/.test((x.textContent || '').trim()));
  const monthCells = (cal) => leaves(cal, (x) => !!monthOf(x.textContent));
  const viewSwitch = (cal) => (cal ? [...cal.querySelectorAll('.MuiPickersCalendarHeader-switchViewButton,.MuiPickersCalendarHeader-labelContainer,.ant-picker-year-btn,.datepicker-switch,'
    + '[aria-label*="year view" i],[aria-label*="choose year" i],[aria-label*="select year" i]')].find(laidOut) || null : null);
  /* the day to click: the wanted one, else the nearest enabled day on the wanted side of today */
  function dayCell(cal, d, cur) {
    const now = todayIdx(), want = dayIdx(d);
    const cells = dayCells(cal).map((x) => { const t = cellDate(x) || (!outside(x) && cur ? { y: cur.y, m: cur.m, d: cellNum(x) } : null); return t && { x, i: dayIdx(t), off: dayOff(x) }; }).filter((c) => c && !c.off);
    const hit = cells.find((c) => c.i === want);
    const side = cells.filter((c) => (d.side < 0 ? c.i < now : d.side > 0 ? c.i > now : true));
    const best = hit || (side.length ? side : cells).sort((a, b) => Math.abs(a.i - want) - Math.abs(b.i - want))[0];
    return best ? { x: leafOf(best.x), i: best.i } : null;
  }
  const leafOf = (x) => { const n = cellNum(x); return [...x.querySelectorAll('*')].reverse().find((k) => cellNum(k) === n) || x; };
  /* the format a picker wrote a known date in ("13/05/2026" for 13 May → dd/mm/yyyy, "May 13, 2026" → mmm d, yyyy), or null */
  function learnFmt(v, t) {
    const parts = String(v || '').trim().split(/(\d+|[A-Za-z]+)/);
    let f = '', seen = '';
    for (let i = 0; i < parts.length; i++) {
      const x = parts[i];
      if (i % 2 === 0) { if (/[A-Za-z0-9]/.test(x) || x.length > 3) return null; f += x; continue; }
      const k = /^[a-z]+$/i.test(x) ? (monthOf(x) === t.m ? (x.length > 3 && norm(x) === norm(MONTH_NAMES[t.m - 1]) ? 'mmmm' : 'mmm') : '')
        : x.length === 4 && +x === t.y ? 'yyyy' : x.length === 2 && +x === t.y % 100 && !seen.includes('y') ? 'yy'
          : +x === t.d && !seen.includes('d') ? 'dd' : +x === t.m && !seen.includes('m') ? (x.length === 2 ? 'mm' : 'm') : '';
      if (!k || seen.includes(k[0])) return null;
      seen += k[0]; f += k;
    }
    if (seen.length !== 3) return null;
    // a day of 13+ shows no padding: like the month's ("5/13/2026" → m/d/yyyy), "May 13, 2026" → d, "13 May 2026" → dd
    return /m{3}/.test(f) ? (seen[0] === 'm' ? f.replace('dd', 'd') : f) : /(^|[^m])m([^m]|$)/.test(f) ? f.replace('dd', 'd') : f;
  }
  const learned = new WeakMap(), calBox = new WeakSet(); // box → the format its picker writes; boxes seen opening a calendar
  /* a calendar button next to the box, named so by its aria-label / title / class or its icon's; never a submit button (never auto-submit),
     never past the box's form / dialog */
  const CAL_BTN = /\b(calendar\d*|date ?picker|picker ?(toggle|trigger|button|btn|icon)|(choose|select|pick|open) (a )?(date|calendar)|date ?(toggle|trigger|button|btn|icon)|(toggle|trigger|icon) date)\b/;
  const calNamed = (x) => [x, ...x.querySelectorAll('[class],[aria-label],[data-testid],[data-icon],use')].slice(0, 20)
    .some((k) => CAL_BTN.test(flat([k.getAttribute('aria-label'), k.getAttribute('title'), cls(k), k.getAttribute('data-testid'), k.getAttribute('data-icon'), k.getAttribute('href')].join(' '))));
  const submits = (x) => (x.tagName === 'BUTTON' || x.tagName === 'INPUT') && /^(submit|image|reset)$/.test(x.type) && !!x.form;
  function calButton(el) {
    for (let n = el.parentElement, i = 0; n && i < 3; n = n.parentElement, i++) {
      if (n.matches('form,[role=form i],dialog,[role=dialog i],body')) break;
      const b = [...n.querySelectorAll('button,[role=button]')].find((x) => !x.contains(el) && !submits(x) && laidOut(x) && calNamed(x));
      if (b) return b;
    }
    return null;
  }
  /* range pickers (one box for both ends): flatpickr mode 'range', react-datepicker selectsRange, a range already marked */
  const RANGED = '.rangeMode,.react-datepicker__day--selecting-range-start,.react-datepicker__day--range-start,.flatpickr-day.startRange,[class*=range-start]';
  /* picks d in the calendar the box opens: { y, m, d, side, far, exact } → true (picked; d.picked = its day index), false (no calendar,
     out of reach: a box that takes typing learns the picker's format first by clicking a known day) */
  function* pickDate(el, d) {
    const before = el.value;
    if (el === deepActive()) { // the user's click opened its calendar already: closed first, so the one opening now is told apart
      const open = () => calCands(el).some((c) => isCal(el, c));
      if (open()) { escKey(el); focusOut(el); yield () => !open(); } else focusOut(el);
    }
    const mine = calsNow(el);
    let cal = null;
    const live = () => (cal && cal.isConnected && laidOut(cal) ? cal : (cal = findCal(el, mine)));
    const shut = () => { if (live()) { escKey(el); if (live()) escKey(cal); } else closeNew(el, mine, true); focusOut(el); };
    focusIn(el);
    clickEl(el);
    // a time-only flatpickr (no day grid) is given up at once
    const timeOnly = () => [...el.ownerDocument.querySelectorAll('.flatpickr-calendar.noCalendar')].some((c) => !mine.has(c) && laidOut(c));
    cal = yield () => findCal(el, mine) || (timeOnly() && 'none');
    if (!cal) { const b = calButton(el); if (b) { clickEl(b); cal = yield () => findCal(el, mine); } }
    if (!cal || cal === 'none') { cal = null; shut(); return false; }
    const days = () => dayCells(live() || cal).length >= 28;
    let cur = days() ? shownMonth(cal) : null;
    if (days() && !cur) { shut(); return false; }
    const gap = () => (cur ? (d.y - cur.y) * 12 + d.m - cur.m : Infinity);
    const moved = (was) => () => { const m = shownMonth(live()); return m && (m.y !== was.y || m.m !== was.m) ? m : null; };
    // DOB and far dates: the calendar's year / month dropdowns when it has them
    for (let i = 0; i < 8 && cur && gap() && (d.far || Math.abs(gap()) > 24); i++) {
      const c = ymControls(live() || cal), was = cur;
      if (!((c.year && cur.y !== d.y && setYear(c.year, d.y)) || (c.month && cur.m !== d.m && setMonth(c.month, d.m)))) break;
      const m = yield moved(was);
      if (!m) break;
      cur = m;
    }
    // a calendar that opens on its year view, or no dropdowns: its year view (MUI, Ant, bootstrap-datepicker), a decade page at a time, then its month grid
    if (!cur || (gap() && (d.far || Math.abs(gap()) > 24) && viewSwitch(live()))) {
      for (let k = 0; k < 2 && yearCells(live()).length < 9; k++) { const sw = viewSwitch(live()); if (!sw) break; clickEl(sw); yield () => yearCells(live()).length >= 9; }
      for (let k = 0; k < 12; k++) {
        const ys = yearCells(live()), yr = (x) => +x.textContent.trim(), hit = ys.find((x) => yr(x) === d.y), was = ys.map(yr).join();
        if (hit) { clickEl(hit); break; }
        const b = ys.length && navBtn(live(), d.y < Math.min(...ys.map(yr)) ? -1 : 1, true);
        if (!b) break;
        clickEl(b);
        if (!(yield () => yearCells(live()).map(yr).join() !== was)) break;
      }
      const mc = yield () => (monthCells(live()).length >= 12 ? monthCells(live()) : days() ? 'days' : null);
      if (Array.isArray(mc)) { const x = mc.find((c) => monthOf(c.textContent) === d.m); if (x) clickEl(x); }
      const m = yield () => days() && shownMonth(live());
      if (m) cur = m;
    }
    if (!cur) { shut(); return false; }
    const go = function* (t) { // to t's month with prev / next (≤ 24 steps; further is out of reach, not tried)
      if (Math.abs((t.y - cur.y) * 12 + t.m - cur.m) > 24) return false;
      for (let i = 0, g; i < 24 && (g = (t.y - cur.y) * 12 + t.m - cur.m); i++) {
        const b = navBtn(live(), g), was = cur;
        if (!b) break;
        clickEl(b);
        const m = yield moved(was);
        if (!m) break;
        cur = m;
      }
      return !((t.y - cur.y) * 12 + t.m - cur.m);
    };
    yield* go(d);
    if (gap() && (d.exact || !el.readOnly)) { // out of reach: typed if the box takes it (in the picker's own format), never some other birthday
      if (!el.readOnly && live()) {
        const c = dayCells(cal).map((x) => ({ x, t: cellDate(x) || (!outside(x) ? { y: cur.y, m: cur.m, d: cellNum(x) } : null) }))
          .find((x) => x.t && x.t.d >= 13 && x.t.d !== x.t.y % 100 && !dayOff(x.x) && !outside(x.x));
        if (c) { const was = el.value; clickEl(leafOf(c.x)); if (yield () => el.value !== was) { const f = learnFmt(el.value, c.t); if (f) learned.set(el, f); } }
      }
      shut();
      return false;
    }
    let cell = live() && dayCell(cal, d, cur);
    for (let k = 0; !cell && k < 12 && live(); k++) { // no enabled day this month (a min / max past it): the next month on its side
      const b = navBtn(live(), d.side < 0 ? -1 : 1), was = cur;
      if (!b) break;
      clickEl(b);
      const m = yield moved(was);
      if (!m) break;
      cur = m;
      cell = dayCell(live(), d, cur);
    }
    if (!cell) { shut(); return false; }
    const ranged = !!(cal.matches(RANGED) || cal.querySelector('.rangeMode'));
    clickEl(cell.x);
    yield () => el.value !== before || !live();
    if (live() && (ranged || cal.querySelector(RANGED))) { // a range: the end too, 1–7 days on, or nothing
      const e = { ...ofIdx(cell.i + rint(1, 7)), side: 1 }, mid = el.value;
      const end = (yield* go(e)) && live() && dayCell(cal, e, cur);
      if (end && end.i > cell.i) { clickEl(end.x); yield () => el.value !== mid || !live(); }
      if (!end || end.i <= cell.i || el.value === mid) { shut(); if (el.value !== before) write(el, 'value', before, true); return false; }
    }
    if (live()) {
      const ok = [...cal.querySelectorAll('button')].find((b) => /^(ok|done|apply|set|select|confirm|choose)$/i.test(b.textContent.trim()) && laidOut(b));
      if (ok) { clickEl(ok); yield () => !live(); }
    }
    shut();
    d.picked = cell.i;
    return el.value !== before && !!el.value;
  }

  /* radios / same-name checkboxes: grouped per form (or shadow root) + name; unnamed radios by their radiogroup / fieldset */
  /* unnamed radios (React radio groups such as antd's keep no name): the nearest block holding two or more of them */
  const nameless = (n) => [...n.querySelectorAll('input[type=radio]')].filter((x) => !x.name).length >= 2;
  function radioBox(el) {
    for (let n = el.parentElement, i = 0; n && i < 6 && n !== el.ownerDocument.body; n = n.parentElement, i++) if (nameless(n)) return n;
    return el.parentElement && el.parentElement.parentElement;
  }
  const groupNode = (el) => el.name ? el.form || el.getRootNode() : el.closest('[role=radiogroup],fieldset') || radioBox(el) || el;
  const radioGroup = (r) => collect(document, []).filter((x) => x.type === 'radio' && x.name === r.name && groupNode(x) === groupNode(r));
  function addTo(map, el) {
    const node = groupNode(el);
    const name = el.name || '\0';
    if (!map.has(node)) map.set(node, new Map());
    const m = map.get(node);
    if (!m.has(name)) m.set(name, []);
    m.get(name).push(el);
  }
  const groups = (map) => [...map.values()].flatMap((m) => [...m.values()]);

  function chooseRadio(g, P) {
    const labels = g.map(optLabel), fs = g[0].closest('fieldset');
    const i = radioPick(labels, P, fs ? norm(textOf(fs.querySelector('legend'))) : '');
    return i >= 0 ? i : pickReal(labels.map((_, j) => j), (j) => labels[j]);
  }
  /* the radio (of normalized option labels) the persona's details decide: gender, salutation, marital status, blood group, ID kind; -1 none */
  function radioPick(labels, P, legend) {
    let i = -1;
    if (labels.some((l) => GENDER_OPT.test(l))) {
      i = labels.findIndex((l) => (P.gender === 'female' ? FEMALE.test(l) : MALE.test(l) && !FEMALE.test(l)));
    } else if (labels.some((l) => /^(mr|mrs|ms|miss)\b/.test(l))) {
      i = labels.findIndex((l) => l.startsWith(norm(P.title)));
    } else if (P.maritalStatus && labels.some((l) => /\b(married|single|unmarried)\b/.test(l))) {
      const m = /^married/i.test(P.maritalStatus);
      i = labels.findIndex((l) => (m ? /\bmarried\b/.test(l) && !/un ?married|never|\bnot\b/.test(l) : /\bsingle\b|un ?married|never ?married/.test(l)));
    } else if (P.bloodGroup && labels.filter((l) => /^(a|b|ab|o) ?(\+|-|pos|neg)/.test(l)).length >= 4) {
      const want = bloodKey(P.bloodGroup);
      i = labels.findIndex((l) => bloodKey(l) === want);
      if (i < 0) i = labels.findIndex((l) => bloodKey(l).startsWith(want));
    } else {
      const kinds = labels.map(idKind);
      if (kinds.filter(Boolean).length >= 2) {
        const k = bestKind(P, kinds.filter(Boolean), legend);
        if (k) i = kinds.indexOf(k);
      }
    }
    return i;
  }
  /* a widget's option (its texts) for a category, with the same matching as a native <select>; -1 for none (never 'Create …' / 'Delete …') */
  const NOT_OPT = /^\s*(create|add new|add\b|\+ ?add|delete|remove)\b/i;
  function pickIndex(texts, cat, P, hint, el, st, want) {
    const opts = (Array.isArray(texts) ? texts : []).map((x, i) => ({ text: String(x == null ? '' : x).replace(/\s+/g, ' ').trim(), index: i }))
      .map((op) => ({ ...op, value: op.text })).filter((op) => op.text && !NOT_OPT.test(op.text) && !isPlaceholderOpt(op));
    if (!opts.length) return -1;
    if (!/^(rule|title|gender)$/.test(cat) && opts.filter((op) => /^(mr|mrs|ms|miss|mx|dr)\.?$/i.test(op.text)).length >= 2) cat = 'title'; // as classify() does for a <select> of Mr / Mrs / Ms
    const t = pickOption(el || document.body, opts, cat, P, hint || '', st || { refAt: new Map(), refN: new Map(), refBase: new Map(), refIds: new Map(), refNext: 0 }, want);
    return t ? t.index : -1;
  }

  /* ---------- scope ---------- */
  const fillable = (el) => { const a = assess(el); return a.cat !== 'skip' || a.reason === 'radio' || a.reason === 'checkbox'; };
  const isModal = (d) => { try { return d.matches(':modal'); } catch (e) { return false; } };
  /* the dialog the user is looking at: a showModal() dialog, a visible [aria-modal=true] / Bootstrap .modal.show on top, or an open
     <dialog> on top that covers the page (a chat or newsletter box in a corner doesn't). One holding nothing but checkboxes (a cookie
     banner) doesn't count; with frames, one whose form is in a frame does (for the background, which picks the frames to fill). */
  function topModal(frames) {
    const vw = innerWidth, vh = innerHeight;
    const hitAt = (d, x, y) => { const root = d.getRootNode(); return root.elementFromPoint ? root.elementFromPoint(x, y) : null; };
    const onTop = (d) => {
      const r = d.getBoundingClientRect(), hit = hitAt(d, (Math.max(r.left, 0) + Math.min(r.right, vw)) / 2, (Math.max(r.top, 0) + Math.min(r.bottom, vh)) / 2);
      return !!hit && inside(d, hit);
    };
    // the middle of the screen is the dialog, or a backdrop / wrapper with nothing else to fill
    const blocks = (d) => {
      for (let n = hitAt(d, vw / 2, vh / 2); n && n !== document.body && n !== document.documentElement; n = parentOf(n)) {
        if (inside(d, n)) return true;
        const r = n.getBoundingClientRect();
        if (r.width * r.height >= 0.8 * vw * vh) return collect(n, []).every((x) => inside(d, x));
      }
      return false;
    };
    const live = deepQuery(document, 'dialog[open],[aria-modal=true i],.modal.show', []).filter((d) => {
      if (!boxVisible(d)) return false;
      const r = d.getBoundingClientRect();
      return r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw && (isModal(d) || (onTop(d) && (d.matches('[aria-modal=true i],.modal.show') || blocks(d))))
        && (controls(d).some((x) => assess(x).cat !== 'skip') || (frames && deepQuery(d, 'iframe,frame', []).some(boxVisible)));
    });
    const top = live.filter(onTop), pool = top.length ? top : live.filter(isModal).length ? live.filter(isModal) : live;
    return pool[pool.length - 1] || null; // nested / later ones sit above
  }
  // a frame laid over the whole page (a checkout or sign-in overlay served from another site)
  function overlayFrame() {
    const vw = innerWidth, vh = innerHeight, hit = document.elementFromPoint(vw / 2, vh / 2);
    if (!hit || !/^i?frame$/i.test(hit.tagName)) return null;
    const r = hit.getBoundingClientRect();
    if (r.width * r.height < 0.8 * vw * vh) return null;
    for (let n = hit; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') return hit;
    return null;
  }
  /* for the background before a page fill, in the top frame: the open modal, as { own (fill() fills its controls), frames (window.frames
     indexes of the frames inside it) }, or null. A modal covers the frames behind it, which each frame can't see for itself. */
  function modal() {
    fresh();
    if (pageOff()) return null;
    const own = topModal(false), m = topModal(true) || overlayFrame();
    if (!m) return null;
    const fr = /^i?frame$/i.test(m.tagName) ? [m] : deepQuery(m, 'iframe,frame', []), idx = [];
    for (const f of fr) for (let i = 0; i < window.frames.length; i++) if (window.frames[i] === f.contentWindow) idx.push(i);
    return { own: own === m, frames: idx };
  }
  /* where this frame sits: its index among its parent's frames, outermost first ([] in the top frame); real: it has something to fill
     (asked only of the frames under the indexes in idx) */
  function where(idx) {
    const path = [];
    try { for (let w = window; w !== w.parent && path.length < 20; w = w.parent) { const f = w.parent.frames; let i = 0; while (i < f.length && f[i] !== w) i++; path.unshift(i); } } catch (e) { return { path: null, real: false }; }
    fresh();
    return { path, real: Array.isArray(idx) && idx.includes(path[0]) && !pageOff() && controls(document).some((x) => assess(x).cat !== 'skip') };
  }
  /* the editable root a focused node sits in (contenteditable / an editor frame's body) */
  const richRoot = (n) => { let r = null; for (let x = n; x && x.nodeType === 1; x = parentOf(x)) { if (x.isContentEditable) r = x; else if (r) break; } return r; };
  /* the control the user is on: { el, focus, w (a widget entry: a combobox / toggle / radio group holding the focus) } or null */
  function fieldTarget() {
    const a0 = deepActive(), w0 = a0 && a0.closest && selectOf(a0); // inside select2 / chosen / Tom Select…: the <select> it stands for
    if (!w0 && a0 && a0.nodeType === 1) {
      const ws = WENT.filter((e) => inside(e.el, a0));
      const we = ws.find((e) => !ws.some((x) => x !== e && inside(e.el, x.el)));
      if (we) return { el: we.el, w: we, focus: a0 };
    }
    const t = w0 || (a0 && a0.matches && !a0.matches('input,select,textarea') ? richRoot(a0) || a0 : a0);
    if (!t || !t.matches || !(t.matches('input,select,textarea') || t.isContentEditable)) return null;
    return { el: t, focus: a0 };
  }
  /* which controls a fill may touch: { has(el), target } or null for none.
     'field': the focused control (an OTP box row or a radio group counts as one); 'form': its form (also one it joins from outside with
     form="…") or dialog, else the smallest block holding 3 more fillable controls (else 1 more); 'page': everything, or only the open modal's */
  function scopeOf(o) {
    if (o.scope !== 'form' && o.scope !== 'field') { const m = topModal(false); return { has: m ? (el) => inside(m, el) : () => true }; }
    if (!o.frameTargeted && !document.hasFocus()) return null; // all frames get the message: only the focused one answers
    const ft = fieldTarget();
    if (!ft) return null;
    const t = ft.el, a0 = ft.focus, a = ft.w ? wAssess(ft.w) : assess(t);
    if (a.cat === 'skip' && a.reason !== 'radio' && a.reason !== 'checkbox') return null; // nothing to fill where the user is (card number, read-only…)
    const set = new Set(a.group || (a.reason === 'radio' ? radioGroup(t) : [t]));
    if (o.scope === 'field') return { has: (el) => set.has(el), target: t, focus: a0, field: true };
    let c = t.form && !t.form.contains(t) ? t.form : null;
    for (let n = parentOf(t); n && !c; n = parentOf(n)) if (n.matches('form,[role=form i],dialog,[role=dialog i]')) c = n;
    if (!c) {
      const cnt = new Map();
      for (const x of collect(document, [])) if (x !== t && fillable(x)) for (let n = parentOf(x); n; n = parentOf(n)) cnt.set(n, (cnt.get(n) || 0) + 1);
      for (const k of [3, 1]) for (let n = parentOf(t); n && !c; n = parentOf(n)) if ((cnt.get(n) || 0) >= k) c = n;
    }
    return { has: c ? (el) => inside(c, el) || (c.tagName === 'FORM' && el.form === c) : (el) => set.has(el), target: t, focus: a0 };
  }
  /* focus back where it was; not into a date picker's box, whose focus opens its calendar again */
  const refocus = (el) => {
    if (!el || el === document.body || !el.isConnected || el === deepActive() || (el.tagName === 'INPUT' && (pickerOf(el) || el.readOnly || calBox.has(el))) || selectOf(el)) return; // nor a widget's (its dropdown)
    try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  };

  /* ---------- main ---------- */
  /* opts (all optional): scope, widgets (also list the widgets content/widgets.js finds), rules / overrides / testCards / sampleFiles as in fill() */
  function inspect(root = document, opts) {
    fresh();
    const keepX = X, keepW = WENT;
    try {
      X = opts && typeof opts === 'object' ? setup(opts) : null;
      WENT = wFind(root);
      const cover = wCover(WENT), off = pageOff(), s = opts && opts.scope ? scopeOf({ scope: opts.scope, frameTargeted: true }) : null;
      if (opts && opts.scope && !s) return [];
      const out = controls(root).filter((el) => !s || s.has(el)).map((el) => {
        if (off) return { el, cat: 'skip', reason: 'off' };
        if (cover.has(el)) return { el, cat: 'skip', reason: 'widget' }; // filled through the widget it belongs to
        const a = assess(el);
        return a.picker && noPicker.has(el) ? { ...a, cat: 'skip', reason: 'picker' } : a;
      });
      if (opts && opts.widgets) for (const e of WENT) if (!s || s.has(e.el)) out.push(off ? { el: e.el, w: e, cat: 'skip', reason: 'off' } : wAssess(e));
      return out;
    } finally { X = keepX; WENT = keepW; }
  }

  function fill(P, o) {
    o = { phoneMode: 'smart', overwrite: false, highlight: true, checkboxes: true, requiredOnly: false, ...(o || {}) };
    const none = (key) => ({ count: 0, used: key ? { fieldKey: key } : {}, report: { filled: 0, skipped: {} } });
    if (pageOff()) return none();
    glowIndex = 0;
    fresh();
    curCC = (P && P.phone && P.phone.ccDigits) || '';
    WENT = wFind(document);
    X = setup(o);
    // 'field' scope: the control the user is on; its key goes back (the menu's 'Fill field as' remembers its type), a forced type is its own
    const ft = o.scope === 'field' && (o.frameTargeted || document.hasFocus()) ? fieldTarget() : null;
    const key = ft ? (ft.w ? wKey(ft.w) : fieldKey(ft.el)) : '', a0 = deepActive(), inW = !!a0 && WENT.some((e) => inside(e.el, a0));
    if (ft && X.force) X.targets = new Set([ft.el]); else X.force = null;
    X.on = !!(X.rules.length || X.over.size || X.force);
    const scope = scopeOf(o);
    if (!scope) { X = null; WENT = []; return none(key); }
    if (scope.field) o = { ...o, overwrite: true }; // the user pointed at it
    const rec = [];
    log = rec;
    logged = new WeakSet();
    const end = (r) => {
      if (rec.length) { api.last = rec; api.lastId = o.fillId == null ? null : o.fillId; } // a fill that changed nothing keeps the previous record
      if (log === rec) log = null;
      if (r && typeof r === 'object') {
        if (r.recs) { if (r.count > 0) api.lastRecs = records0(r.recs); delete r.recs; }
        if (key) r.used = { ...r.used, fieldKey: key };
      }
      X = null;
      WENT = [];
      if (!inW) refocus(scope.focus || scope.target); // focus back in a widget would open its list again
      return r;
    };
    let r;
    try { r = run(P, o, scope, rec); } catch (e) { end(); throw e; }
    return r && typeof r.then === 'function' ? r.then(end, (e) => { end(); throw e; }) : end(r);
  }

  /* reasons a control was left as it was, for fill()'s report; those that aren't fields to the user (hidden, buttons, a widget's parts) are left out */
  const QUIET = new Set(['type', 'hidden', 'widget', 'radio', 'checkbox']);
  const reportOf = (st) => { const skipped = {}; for (const r of st.why.values()) skipped[r] = (skipped[r] || 0) + 1; return { filled: st.count, skipped }; };
  function run(P, o, scope, rec) {
    const st = { count: 0, used: {}, refAt: new Map(), refN: new Map(), refBase: new Map(), refIds: new Map(), refNext: 0, pwdOf: new Map(), emailOf: new Map(), trip: null, later: [], seen: new Set(),
      why: new Map(), recs: new Map(), brand: '', edgeN: 0 };
    const seen = st.seen; // controls already handled
    const skipAs = (el, r) => { if (r && !QUIET.has(r) && !st.recs.has(el)) st.why.set(el, r); };
    const mark = (el, cat) => { st.count++; glow(el, o.highlight); noteRec(st, el, cat); };
    const tick = (cb, cat) => { if (!cb.checked) { log.push({ el: cb, kind: 'checked', prev: false }); cb.click(); mark(cb, cat || 'checkbox'); } };
    const required = (x) => !!x && (x.required || /^true$/i.test(x.getAttribute('aria-required') || ''));
    const wanted = (el) => !o.requiredOnly || scope.field || required(el) || (el.tagName === 'INPUT' && required(flatHidden(el)));
    let cover = wCover(WENT); // inputs that belong to a widget (react-select's search box, Radix's hidden select / checkbox): filled through it
    const ruled = (it) => (it && it.rule ? fromTemplate(it.rule.value, P) : null);

    // A choice can reveal more fields ("ID type" → ID number), so each control is re-checked when it is reached,
    // and fields revealed above the control that revealed them get one more pass.
    for (let pass = 0, more = true; pass < 3 && more; pass++) {
      const before = st.count;
      if (pass && ext('widgets')) { WENT = wFind(document); cover = wCover(WENT); } // and widgets it revealed
      const items = controls(document).filter((el) => !seen.has(el) && scope.has(el) && !cover.has(el)).map(assess);
      const byEl = new Map(items.map((it) => [it.el, it]));
      if (!pass) P = alignLocation(P, items);

      // 1. radios first, so an ID-type choice is in place before the ID number is written
      const radios = new Map(), boxes = new Map(), singles = [];
      if (o.checkboxes || scope.field) for (const { el, reason } of items) {
        if (reason === 'radio') addTo(radios, el);
        else if (reason === 'checkbox') { if (el.name) addTo(boxes, el); else singles.push(el); } else continue;
        seen.add(el);
      }
      for (const g of groups(radios)) {
        try {
          const rr = g.map((r) => byEl.get(r)).find((it) => it && it.rule);
          if (!o.overwrite && g.some((r) => r.checked)) { skipAs(g[0], 'prefilled'); continue; }
          if (!rr && o.requiredOnly && !scope.field && !g.some((r) => required(r) || required(r.closest('[role=radiogroup]')))) { skipAs(g[0], 'optional'); continue; }
          let r;
          if (rr) { // a rule: 'true' checks the radio it matched, other text picks the radio of that label / value
            const v = ruled(rr), n = norm(v), labels = g.map(optLabel);
            r = TRUTHY.test(v) ? rr.el : g[labels.indexOf(n)] || g.find((x) => x.value === v) || g[labels.findIndex((l) => n && l.includes(n))];
            if (!r) { skipAs(g[0], 'rule'); continue; }
          } else r = g[chooseRadio(g, P)];
          if (r && !r.checked) { log.push({ el: r, kind: 'checked', prev: g.find((x) => x.checked) || null }); r.click(); mark(r, rr ? 'rule' : 'radio'); }
        } catch (e) { /* ignore */ }
      }

      // 2. checkboxes: never untick; agree / required → tick unless it is an opt-out; same-name groups get at least one; a rule ticks on 'true'
      for (const g of groups(boxes)) {
        if (g.length < 2) { singles.push(...g); continue; }
        try {
          const rs = g.filter((cb) => byEl.get(cb) && byEl.get(cb).rule);
          if (rs.length) { rs.forEach((cb) => { if (TRUTHY.test(ruled(byEl.get(cb)))) tick(cb, 'rule'); }); continue; }
          g.forEach((cb) => { const l = optLabel(cb); if ((required(cb) || AGREE.test(l)) && !NEG.test(l)) tick(cb); });
          if (!g.some((cb) => cb.checked) && (!o.requiredOnly || scope.field || g.some(required))) {
            const ok = g.filter((cb) => !NEG.test(optLabel(cb))), best = ok.filter((cb) => !DOWN.test(optLabel(cb)));
            tick(pick(best.length ? best : ok.length ? ok : g));
          }
        } catch (e) { /* ignore */ }
      }
      for (const cb of singles) {
        try {
          if (cb.checked) continue;
          const it = byEl.get(cb);
          if (it && it.rule) { if (TRUTHY.test(ruled(it))) tick(cb, 'rule'); continue; }
          const h = hintOf(cb);
          if (!NEG.test(h) && (scope.field || required(cb) || AGREE.test(h) || (!o.requiredOnly && Math.random() < 0.5))) tick(cb);
        } catch (e) { /* ignore */ }
      }

      // 3. ID-type selects, then everything else in page order
      const isIdSel = (it) => it.cat === 'idType' && it.el.tagName === 'SELECT';
      for (const it of items.filter(isIdSel).concat(items.filter((x) => !isIdSel(x)))) {
        const el = it.el;
        try {
          if (seen.has(el) || it.reason === 'type') continue;
          const a = assess(el), { cat, group, hint } = a; // now, not before the first write: an earlier choice may have shown or hidden it
          if (cat === 'skip') { skipAs(el, a.reason); continue; }
          seen.add(el);
          if (group) {
            group.forEach((x) => seen.add(x));
            if (o.requiredOnly && !scope.field && !group.some(required)) { skipAs(el, 'optional'); continue; }
            const code = cat === 'mpin' ? (!MPIN.test(hint) && pageCode(group.length)) || pinFor(P, group.length) : pageCode(group.length);
            if (code && (o.overwrite || group.every((x) => !x.value))) {
              group.forEach((x, i) => { setValue(x, code[i] || ''); glow(x, o.highlight); noteRec(st, x, cat); });
              st.count += group.length;
            } else skipAs(el, code ? 'prefilled' : cat);
            continue;
          }
          if (!wanted(el) && cat !== 'rule') { skipAs(el, 'optional'); continue; } // a rule names its field: filled even when optional
          if (cat === 'file') { fileFill(el, a, o, st, skipAs); continue; }
          const rv = cat === 'rule' ? ruled(a) : null;
          if (a.rich) {
            if (!o.overwrite && richVal(el)) { skipAs(el, 'prefilled'); continue; }
            const v = cat === 'rule' ? rv : valueFor(el, cat, P, o, st);
            if (v == null || v === '') { skipAs(el, cat === 'rule' ? 'rule' : 'nodata'); continue; }
            st.later.push({ ...a, text: String(v) }); // typed in after the rest, then read back
            continue;
          }
          if (cat === 'phoneCountry') continue; // set with its phone number
          if (el.tagName === 'SELECT') {
            const cur = el.options[el.selectedIndex];
            if (!o.overwrite && cur && !isPlaceholderOpt(cur) && (el.selectedIndex > 0 || cur.defaultSelected || el.multiple || !(DEFAULT_SEL.test(cat) || isCodeSelect(el) || datePart(el, hint)))) { skipAs(el, 'prefilled'); continue; }
            if (a.drive) { st.later.push(rv != null ? { ...a, ruleVal: rv } : a); continue; } // Tom Select / Selectize / Choices.js: through their own dropdown
            let ok;
            if (cat === 'card') { const op = cardOption(el, a.part, P, st); ok = !!op; if (op) { setValue(el, op.value, !!a.box); refresh(el); } }
            else ok = fillSelect(el, cat, P, hint, st, !!a.box, rv);
            if (ok) { st.count++; glow(a.box || el, o.highlight); noteRec(st, el, cat); } else skipAs(el, cat === 'rule' ? 'rule' : 'nodata');
            continue;
          }
          const curVal = (el.value || '').trim();
          const isCodePrefixOnly = PHONE_CATS.test(cat) && /^\+?\d{1,4}$/.test(curVal);
          if (!o.overwrite && curVal && !isCodePrefixOnly) { skipAs(el, 'prefilled'); continue; }
          if (cat === 'rule') { if (!rv) { skipAs(el, 'rule'); continue; } fit(el, [rv], 'rule'); mark(el, 'rule'); continue; }
          if (cat === 'card') { fit(el, cardValues(el, a.part, P, st), 'card'); mark(el, 'card'); continue; }
          if (a.picker) { a.want = wantDate(el, cat, P, hint, st); st.later.push(a); continue; } // the date now, in page order (check-in before check-out)
          if (o.edgeMode) { const ev = edgeValue(el, cat, st); if (ev != null) { setValue(el, ev); mark(el, cat); continue; } } // validation testing
          if (PHONE_CATS.test(cat) && telCountry(el, P, st)) { st.later.push(a); continue; }
          const v = valueFor(el, cat, P, o, st);
          if (v == null || v === '') { skipAs(el, cat === 'otp' ? 'otp' : 'nodata'); continue; }
          // a date box whose focus opens a calendar (bootstrap-datepicker / jQuery UI set up from script): through it, in its own format
          if (DATE_CATS.has(cat) && el.tagName === 'INPUT' && /^(text|)$/.test(el.type) && opensCal(el)) { st.later.push({ ...a, picker: 'calendar', want: wantDate(el, cat, P, hint, st) }); continue; }
          const key = el.form || el.getRootNode();
          fit(el, candidates(el, cat, String(v), P, o, st), cat, cat === 'password' ? st.pwdOf.get(key) : null);
          if (cat === 'password' && el.value) {
            st.pwdOf.set(key, el.value);
            // reported (and reused on the site) only when the box took it as valid: never a variant the page still rejects
            if (!st.used.password && (el.value === P.password || !bad(el, el.value, cat))) st.used.password = el.value;
          }
          if (cat === 'email' && el.value && !st.emailOf.has(key)) st.emailOf.set(key, el.value);
          mark(el, cat);
        } catch (e) { /* never let one weird field stop the rest */ }
      }
      more = st.count > before && items.some((it) => it.reason === 'hidden');
    }
    // 4. widgets (content/widgets.js): ARIA comboboxes / library selects / radio groups / toggles, one list at a time after the rest
    if (WENT.length) wPlan(P, o, scope, st);
    const done = () => ({ count: st.count, used: st.used, report: reportOf(st), recs: st.recs });
    st.t0 = Date.now();
    return series(st.later.map((a) => () => (a.wa ? wRun(a.wa, P, o, st) : a.text != null ? richFill(a, st, o) : a.drive ? widgetFill(a, P, st, o) : pickerFill(a, P, st, o, rec))), done);
  }

  /* ---------- widgets of content/widgets.js: { el, kind: combobox | toggle | radiogroup | grid, lib } ---------- */
  let WENT = []; // the widgets found for the fill / inspect that is running
  /* widgets this file fills itself (select2, chosen, Tom Select…, phone country pickers, calendars) are left to it */
  const NATIVE_W = '.select2-container,.select2,.chosen-container,.bootstrap-select,.ts-wrapper,.selectize-control,.choices,.iti,.PhoneInput,.react-tel-input,' + POPS;
  const hiddenIn = (x) => /^true$/i.test(x.getAttribute('aria-hidden') || '');
  function wFind(root) {
    const W = ext('widgets');
    if (!W || typeof W.find !== 'function') return [];
    let list;
    try { list = W.find(root || document); } catch (e) { return []; }
    const seen = new Set();
    list = (Array.isArray(list) ? list : []).filter((e) => {
      const el = e && e.el;
      if (!el || el.nodeType !== 1 || !el.isConnected || seen.has(el) || el.matches('select,input[type=checkbox],input[type=radio]') || within(el, NATIVE_W)) return false;
      if (e.kind === 'radiogroup' && [...el.querySelectorAll('input[type=radio]')].some((r) => !hiddenIn(r))) return false; // real radios: filled as radios
      seen.add(el);
      return /^(combobox|toggle|radiogroup|grid)$/.test(e.kind);
    });
    // one entry per question: nothing inside a radio group / grid, nor a combobox inside another
    return list.filter((e) => !list.some((x) => x !== e && x.el !== e.el && inside(x.el, e.el) && (x.kind === 'radiogroup' || x.kind === 'grid' || (x.kind === 'combobox' && e.kind === 'combobox'))));
  }
  /* native controls a widget owns: itself, the inputs inside it, the library's hidden ones (e.hidden, Radix's <select> / checkbox next to its
     button) and the hidden ones in its root; a visible field that only shares the root stays the page's */
  function wCover(list) {
    const cov = new Set(), own = (x) => x && x.nodeType === 1 && x.matches('input,select,textarea') && cov.add(x);
    for (const e of list) {
      const el = e.el;
      own(el);
      if (!el.matches('input,textarea')) el.querySelectorAll('input,textarea,select').forEach((x) => { if (x.tagName !== 'SELECT' || hiddenIn(x) || !boxVisible(x)) own(x); });
      (Array.isArray(e.hidden) ? e.hidden : []).forEach(own);
      if (e.root && e.root.nodeType === 1 && e.root !== el) e.root.querySelectorAll('input,select,textarea').forEach((x) => { if (x.type === 'hidden' || hiddenIn(x) || !boxVisible(x)) own(x); });
      const p = el.parentElement;
      if (p) for (const x of p.children) if (x !== el && x.matches('input,select') && hiddenIn(x)) own(x);
    }
    return cov;
  }
  const wInner = (el) => (el.matches('input,textarea') ? null : el.querySelector('input:not([type=hidden]),[role=combobox]'));
  const wKey = (e) => fieldKey(e.el) || fieldKey(wInner(e.el));
  const toggleLabel = (el) => norm(textOf(el.labels && el.labels[0]) || el.getAttribute('aria-label') || idsText(el, 'aria-labelledby') || short(textOf(el))
    || (el.nextElementSibling && short(textOf(el.nextElementSibling))) || '');
  function wAssess(e) {
    const el = e.el, S = (reason) => ({ el, w: e, cat: 'skip', reason });
    if (!el.isConnected) return S('hidden');
    if (within(el, OFF)) return S('off');
    if (el.matches(':disabled,[aria-disabled=true i],[data-disabled]')) return S('disabled');
    // react-select's dummy input (isSearchable false) is a speck moved off to the left: its control is what shows
    const shown = boxVisible(el) ? el : el.tagName === 'INPUT' && e.root && e.root.nodeType === 1 && e.root !== el && boxVisible(e.root) ? e.root : null;
    if (!shown) return S('hidden');
    if (ariaHidden(el) || offscreen(shown, shown.getBoundingClientRect())) return S('trap');
    const inner = wInner(el), tog = e.kind === 'toggle', own = typeof e.label === 'string' ? e.label.trim() : '', lab = tog ? norm(own) || toggleLabel(el) : '';
    // a widget that names itself: that and its attributes, never the loose text before it (often the previous field's label)
    const hint = flat([lab, !tog ? own : '', own ? attrHint(el) : hintOf(el), inner ? (own ? attrHint(inner) : hintOf(inner)) : ''].join(' '));
    let a;
    if (tog) a = { el, w: e, cat: 'toggle', reason: '', hint, lab };
    else if (e.kind === 'grid') a = { el, w: e, cat: 'grid', reason: '', hint };
    else { const c = classify(el, hint, own || true); a = { el, w: e, cat: c, reason: c === 'skip' ? why : '', hint }; }
    if (X && X.on) { const c = custom(a, inner); a = tog ? (c.cat === 'skip' ? c : { ...a, rule: c.rule }) : c; }
    return a;
  }
  const ON = (x) => /^(true|mixed)$/i.test(x.getAttribute('aria-checked') || '') || /^(checked|on|indeterminate)$/i.test(x.getAttribute('data-state') || '') || x.getAttribute('aria-pressed') === 'true';
  /* the widget shows a choice already (overwrite off keeps it) */
  function wHas(e) {
    const el = e.el;
    if (typeof e.checked === 'boolean') return e.checked;
    if (e.kind === 'toggle') return ON(el);
    if (e.kind === 'radiogroup' || e.kind === 'grid') return [...el.querySelectorAll('[role=radio],[role=checkbox]')].some(ON);
    if (el.hasAttribute('data-placeholder')) return false; // Radix: nothing chosen
    if (typeof e.value === 'string') { const t = e.value.replace(/[​﻿]/g, '').trim(); return !!t && !PH_OPT.test(t) && !/^(none|select|choose|pick)\b/i.test(t); } // a placeholder isn't a choice
    const val = el.querySelector('[class*=singleValue],[class*=single-value],[class*=multiValue],[class*=multi-value],.ng-value,.ant-select-selection-item,.mat-mdc-select-value-text,.mat-select-value-text,.MuiChip-root');
    if (val) return !!textOf(val);
    if ([...el.querySelectorAll('[class*=placeholder i]')].some(boxVisible)) return false;
    const inp = el.matches('input') ? el : el.querySelector('input:not([type=hidden])');
    if (inp && inp.value.trim()) return true;
    const t = textOf(el).replace(/[​﻿▾▼⌄˅▿⏷∨⌵▽]/g, '').trim();
    return !!t && !PH_OPT.test(t) && !/^(none|select|choose|pick)\b/i.test(t);
  }
  function wRequired(e) {
    if (e.required === true) return true;
    const el = e.el, req = (x) => !!x && (x.required || /^true$/i.test(x.getAttribute('aria-required') || ''));
    if (req(el) || [...el.querySelectorAll('input,select,[aria-required]')].some(req) || req(el.closest('[role=radiogroup],[role=group],[role=listbox],[role=list]'))) return true;
    if (el.parentElement && [...el.parentElement.children].some((x) => x !== el && x.matches('select,input') && req(x))) return true;
    return /\*\s*$|required question/i.test(labelText(el));
  }
  /* a page's own controls outside any form or dialog: in its footer / sidebar, or a sort / filter / language / currency / view picker */
  const CHROME_W = /^(sort|sort by|order by|filter|filter by|language|currency|locale|view|show|theme|per page|(items|rows|results) per page|page size)$/;
  const pageChrome = (a) => !a.el.closest('form,[role=form],dialog,[role=dialog],[aria-modal=true]')
    && (!!a.el.closest('footer,[role=contentinfo],aside,[role=complementary]') || CHROME_W.test(norm(String(a.w.label || '')).replace(/[\s:*]+$/, '')) || /\b(sort|order) by\b|\bper page\b/.test(a.hint || ''));
  /* what each widget gets: ARIA toggles as checkboxes (never untick; terms / required ones; a group of them gets at least one),
     comboboxes and radio groups like selects (overwrite, required-only); queued for their turn in st.later; page chrome left alone */
  function wPlan(P, o, scope, st) {
    const list = WENT.filter((e) => scope.has(e.el) && !st.seen.has(e.el)).map(wAssess), toggles = [], add = new Set(), page = !scope.field && o.scope !== 'form';
    for (const a of list) {
      st.seen.add(a.el);
      if (a.cat === 'skip') { if (!QUIET.has(a.reason)) st.why.set(a.el, a.reason); continue; }
      if (page && !a.rule && pageChrome(a)) continue; // sorting / language widgets re-fetch or navigate: not part of a form
      const choice = a.w.kind === 'radiogroup' || a.w.kind === 'grid';
      if ((a.cat === 'toggle' || choice) && !(o.checkboxes || scope.field)) continue;
      if (a.cat === 'toggle') { toggles.push(a); continue; }
      if (!o.overwrite && wHas(a.w)) { st.why.set(a.el, 'prefilled'); continue; }
      if (o.requiredOnly && !scope.field && !a.rule && !wRequired(a.w)) { st.why.set(a.el, 'optional'); continue; }
      st.later.push({ wa: a });
    }
    const grp = new Map();
    for (const a of toggles) {
      const k = (a.w.group && a.w.group.nodeType === 1 && a.w.group) || (a.el.parentElement && a.el.parentElement.closest('[role=group],[role=list],fieldset')) || a.el;
      if (!grp.has(k)) grp.set(k, []);
      grp.get(k).push(a);
    }
    for (const g of grp.values()) {
      const single = g.length < 2;
      for (const a of g) { // in a group, 'required' is the question's (at least one, below), not each box's
        if (wHas(a.w)) continue;
        if (a.rule) { if (TRUTHY.test(fromTemplate(a.rule.value, P))) add.add(a); continue; }
        const l = single ? a.hint : a.lab;
        if (!NEG.test(l) && (scope.field || AGREE.test(l) || (single && (wRequired(a.w) || (!o.requiredOnly && Math.random() < 0.5))))) add.add(a);
      }
      if (!single && !g.some((a) => wHas(a.w) || add.has(a)) && (!o.requiredOnly || scope.field || g.some((a) => wRequired(a.w)))) {
        const ok = g.filter((a) => !a.rule && !NEG.test(a.lab)), best = ok.filter((a) => !DOWN.test(a.lab));
        if (ok.length) add.add(pick(best.length ? best : ok));
      }
    }
    for (const a of toggles) if (add.has(a)) st.later.push({ wa: a });
  }
  /* the text it looks for in a searchable list (content/widgets.js may type it: pick.query) */
  const QUERY_CATS = /^(country|state|city|district|tehsil|village|postOffice|gender|title|languages|qualification|university|company|jobTitle|bloodGroup|maritalStatus|phoneCode)$/;
  function wQuery(a, P, o, st) {
    if (!QUERY_CATS.test(a.cat)) return '';
    try { const v = a.cat === 'languages' ? (MOTHER_T.test(a.hint) ? P.motherTongue : (P.languages || [])[0]) : valueFor(a.el, a.cat, P, o, st); return v == null ? '' : String(v); } catch (e) { return ''; }
  }
  /* a box that keeps typed text (MUI freeSolo, a plain ARIA combobox) gets the persona's own value: an option only when it is that value */
  const FREE_CATS = /^(company|jobTitle|city|state|country|district|tehsil|village|postOffice|university|qualification|fullName|firstName|lastName|middleName|fatherName|motherName|spouseName|email|phone|address1|address2|zip|username|website|bankName|branch|ifsc)$/;
  function freeVal(a, P, o, st) {
    if (!a.w.free || a.w.multi || a.rule || !FREE_CATS.test(a.cat)) return '';
    try { const v = valueFor(wInner(a.el) || a.el, a.cat, P, o, st); return v == null ? '' : String(v); } catch (e) { return ''; }
  }
  /* pick(optionTexts) → index | -1, for widgets.choose(): a rule's text, a free box's own value, a radio group's persona choice, else the select matching */
  function wPicker(a, P, o, st) {
    const want = a.rule ? fromTemplate(a.rule.value, P) : null, choice = a.w.kind === 'radiogroup' || a.w.kind === 'grid', free = choice ? '' : freeVal(a, P, o, st);
    const fn = (texts) => {
      try {
        const list = (Array.isArray(texts) ? texts : []).map((x) => String(x == null ? '' : x));
        if (want != null) return pickIndex(list, 'rule', P, a.hint, a.el, st, want);
        if (free) { const n = norm(free), t = list.map(norm), i = t.indexOf(n); return i >= 0 ? i : t.findIndex((x) => x.includes(n)); } // else typed in (wNative)
        if (choice) { const i = radioPick(list.map(norm), P, a.hint); if (i >= 0 && !NOT_OPT.test(list[i])) return i; }
        return pickIndex(list, a.cat, P, a.hint, a.el, st);
      } catch (e) { return -1; }
    };
    fn.query = want != null ? want : free || wQuery(a, P, o, st);
    return fn;
  }
  const W_MS = 3000, W_ALL_MS = 6000; // one widget's wait; all widgets of one fill (the last may start at 6 s: done by 9 s, the background stops waiting at 10 s)
  const capped = (p, ms) => new Promise((res) => { const t = setTimeout(() => res(null), ms); Promise.resolve(p).then((v) => { clearTimeout(t); res(v); }, () => { clearTimeout(t); res(null); }); });
  function wRun(a, P, o, st) {
    const W = ext('widgets'), el = a.el, tog = a.cat === 'toggle', fn = W && (tog ? W.toggle : W.choose);
    if (typeof fn !== 'function' || !el.isConnected || Date.now() - st.t0 > W_ALL_MS) { st.why.set(el, 'widget'); return null; }
    const p = Promise.resolve().then(() => (tog ? W.toggle(el, true) : W.choose(a.w, wPicker(a, P, o, st))));
    return capped(p, W_MS).then((r) => {
      if (r && r.ok) {
        note(el, { el, kind: 'w', entry: a.w, prev: r.prev });
        st.count++;
        glow(el, o.highlight);
        wRec(a, r, st, tog);
        return;
      }
      if (!tog && wNative(a, P, o, st)) return;
      st.why.set(el, 'widget');
    });
  }
  /* what a test script needs to repeat a widget fill: the option checked (a toggle, a group's radio, each grid row's cell), or the list choice with
     its library, a box to type it in, a multi-select's list left open; labelled by the widget's own label */
  function wRec(a, r, st, tog) {
    const el = a.el, lab = typeof a.w.label === 'string' ? a.w.label.replace(/\s+/g, ' ').replace(/[\s*:]+$/, '').trim().slice(0, 80) : '', said = String(r.label == null ? '' : r.label);
    if (tog) return noteRec(st, el, 'toggle', 'check', true, null, lab ? { lab } : null);
    if (a.w.kind === 'radiogroup' || a.w.kind === 'grid') {
      const rows = a.w.kind === 'grid' && Array.isArray(a.w.rows) ? a.w.rows.filter((x) => x && x.el && x.el.nodeType === 1 && x.el.isConnected) : [{ el, label: said }];
      for (const row of rows) for (const x of row.el.querySelectorAll('[role=radio],[role=checkbox]')) if (ON(x)) noteRec(st, x, a.cat, 'check', true, null, { lab: [lab, row.label].filter(Boolean).join(': ') });
      return;
    }
    const typed = el.matches('input') && !el.readOnly && el.getAttribute('inputmode') !== 'none', root = a.w.root && a.w.root.nodeType === 1 ? a.w.root : null;
    // a speck of an input (react-select's dummy one) can't be clicked: the widget's box is
    noteRec(st, el, a.cat, 'choose', said, !typed && !boxVisible(el) && root && boxVisible(root) ? root : null, { ...(lab ? { lab } : {}), lib: String(a.w.lib || ''), ...(r.prev && r.prev.multi ? { multi: true } : {}), ...(typed ? { search: true } : {}) });
  }
  /* a plain autocomplete box (or a library one that keeps typed text) whose list offered nothing to pick: typed in like a text box */
  function wNative(a, P, o, st) {
    const inp = a.el.matches('input') ? a.el : null;
    if (!inp || inp.readOnly || inp.disabled || !/^(text|search|email|tel|url|)$/.test(inp.type) || (!a.w.free && /react-?select|mui|ant|mat|ng-?select|headless|radix/i.test(String(a.w.lib || '')))) return false;
    const v = a.rule ? fromTemplate(a.rule.value, P) : valueFor(inp, a.cat, P, o, st);
    if (v == null || v === '') return false;
    fit(inp, a.rule ? [String(v)] : candidates(inp, a.cat, String(v), P, o, st), a.cat);
    if (!inp.value) return false;
    st.count++;
    glow(inp, o.highlight);
    noteRec(st, inp, a.cat, 'fill', undefined, null, a.w.label ? { lab: String(a.w.label).trim().slice(0, 80) } : null);
    return true;
  }

  /* ---------- sample files (o.sampleFiles), edge values (o.edgeMode) ---------- */
  function setFiles(el, files) {
    try { const dt = new DataTransfer(); for (const f of files || []) dt.items.add(f); el.files = dt.files; } catch (e) { return false; }
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  /* one small file content/qa.js makes for the box (photo.png, resume.pdf…; its accept; one even when it takes several) */
  function fileFill(el, a, o, st, skipAs) {
    if (!o.overwrite && el.files && el.files.length) { skipAs(el, 'prefilled'); return; }
    const qa = ext('qa');
    let f = null;
    try { f = qa && typeof qa.file === 'function' ? qa.file(a.hint || hintOf(el), el.getAttribute('accept') || '') : null; } catch (e) { f = null; }
    if (!f || typeof f.name !== 'string' || typeof f.size !== 'number') { skipAs(el, 'nodata'); return; }
    note(el, { el, kind: 'files', prev: [...(el.files || [])] });
    if (!setFiles(el, [f]) || !el.files || !el.files.length) { skipAs(el, 'nodata'); return; }
    st.count++;
    glow(el, o.highlight);
    noteRec(st, el, 'file', 'file', f.name);
  }
  /* the edge value a field gets in edge-case mode: an invalid email, below / above its range, a non-ASCII / RTL / apostrophe name, 5× its maxlength */
  const NAME_CATS = /^(first|last|middle|full|father|mother|spouse|emergency|nominee|ref)Name$/;
  function edgeValue(el, cat, st) {
    const qa = ext('qa'), type = (el.type || '').toLowerCase();
    if (!qa || typeof qa.edge !== 'function' || (el.tagName !== 'TEXTAREA' && !/^(text|email|number|search|url|tel|)$/.test(type))) return null;
    let k = null;
    if (type === 'email' || /^(email|altEmail|refEmail)$/.test(cat)) k = 'email';
    else if (type === 'number') k = st.edgeN++ % 2 ? 'above' : 'below';
    else if (NAME_CATS.test(cat)) k = ['unicode', 'rtl', 'apostrophe'][st.edgeN++ % 3];
    else if (maxLen(el) && !PHONE_CATS.test(cat) && !DATE_CATS.has(cat) && !/^(password|otp|mpin|phoneCode|areaCode)$/.test(cat)) k = 'long';
    if (!k || !(Array.isArray(qa.kinds) && qa.kinds.some((x) => x && x.id === k))) return null;
    let v = null;
    try { v = qa.edge(k, el); } catch (e) { v = null; }
    return typeof v === 'string' && v !== '' ? v : null;
  }
  /* 'Insert test value ▸': the focused field gets qa.edge(kindId) as it is (no fitting), undoable like a field fill */
  function insertEdge(kindId, o) {
    o = { highlight: true, ...(o || {}) };
    const qa = ext('qa'), out = (n, key) => ({ count: n, used: key ? { fieldKey: key } : {}, report: { filled: n, skipped: {} } });
    if (!qa || typeof qa.edge !== 'function' || pageOff() || (o.frameTargeted === false && !document.hasFocus())) return out(0);
    fresh();
    WENT = [];
    const ft = fieldTarget();
    if (!ft) return out(0);
    const el = ft.el, a = assess(el), key = fieldKey(el);
    if ((a.cat === 'skip' && HARD.test(a.reason)) || a.group || payWrap(el) || el.tagName === 'SELECT' || /^(checkbox|radio|file|range|color)$/.test(el.type || '')) return out(0, key);
    let v = null;
    try { v = qa.edge(String(kindId || ''), el); } catch (e) { v = null; }
    if (typeof v !== 'string' || v === '') return out(0, key);
    const rec = [], st = { count: 0, why: new Map(), recs: new Map() };
    log = rec;
    logged = new WeakSet();
    const end = (ok) => {
      if (log === rec) log = null;
      if (ok) {
        api.last = rec; api.lastId = o.fillId == null ? null : o.fillId;
        noteRec(st, el, 'edge:' + kindId, 'fill', a.rich ? v : el.value);
        api.lastRecs = records0(st.recs);
        glow(a.rich ? frameOf(el) || el : el, o.highlight);
      }
      refocus(ft.focus);
      return out(ok ? 1 : 0, key);
    };
    try {
      if (a.rich) {
        note(el, { el, kind: 'rich', prev: el.innerText || el.textContent || '' });
        const r = drive(richType(el, v));
        return r && typeof r.then === 'function' ? r.then((x) => end(!!x), () => end(false)) : end(!!r);
      }
      setValue(el, v);
      return end(true);
    } catch (e) { return end(false); }
  }

  /* ---------- records (export as JSON / Playwright / Cypress) and the inspect overlay ---------- */
  /* kind: fill | check | select | choose | file, from the control unless given; value: what it holds now unless given;
     at: the element a test script works (a select2 / chosen / Tom Select box for the hidden <select> behind it: 'choose' there) */
  function noteRec(st, el, cat, kind, value, at, more) {
    let k = kind || (el.tagName === 'SELECT' ? 'select' : /^(checkbox|radio)$/.test(el.type) ? 'check' : el.type === 'file' ? 'file' : 'fill'), v = value;
    if (!at && k === 'select') { const w = widgetOf(el); if (w && w.nodeType === 1) { at = w; k = 'choose'; } }
    if (v === undefined) {
      if (k === 'check') v = true;
      else if (k === 'select' || k === 'choose') { const op = el.options[el.selectedIndex]; v = !op ? '' : k === 'choose' ? op.text.trim() : op.value || op.text.trim(); }
      else v = el.matches('input,textarea') ? el.value : richVal(el);
    }
    st.recs.set(el, { el, at: at || null, kind: k, cat: cat || '', value: v, ...(more ? { more } : {}) });
    st.why.delete(el);
  }
  const labelFor = (el) => labelKey(el) || el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('name') || '';
  /* + for a test script: frame (selectors of the frames it is in, outermost first), lib / multi / search (a widget's list), aria (a role=checkbox /
     radio / switch, not an <input>), label_for (the selector is the label of an <input> with no box of its own), hidden (no such label either:
     check it with force), picker (a read-only / date picker box: set by script) */
  function records0(recs) {
    const fr = framePath();
    return [...recs.values()].filter((r) => r.el && r.el.isConnected).map((r) => {
      const at = r.at && r.at.isConnected ? r.at : r.el, m = r.more || {}, x = { selector: selectorOf(at), label: m.lab || labelFor(r.el), cat: r.cat, value: r.value, kind: r.kind };
      if (fr.length) x.frame = fr;
      for (const k of ['lib', 'multi', 'search']) if (m[k]) x[k] = m[k];
      if (x.kind === 'check' && !at.matches('input')) x.aria = true;
      else if (x.kind === 'check' && !boxVisible(at)) { // a box with no size of its own (antd radio buttons, custom checkboxes): its label is what is clicked
        const lab = [...(at.labels || [])].find(boxVisible);
        if (lab) { x.selector = selectorOf(lab); x.label_for = true; } else x.hidden = true;
      }
      if (x.kind === 'fill' && at.tagName === 'INPUT' && (at.readOnly || pickerOf(at) || calBox.has(at))) x.picker = true;
      return x;
    });
  }
  /* the frames this document sits in, as selectors in their parents (outermost first): the frame element when it can be reached, else its
     name or address */
  function framePath() {
    const out = [], q = (t) => t.replace(/["\\]/g, '\\$&');
    for (let w = window, i = 0; i < 10; i++) {
      let up = null, sel = '';
      try { up = w.parent; } catch (e) { break; }
      if (!up || up === w) break;
      try { const fe = w.frameElement; if (fe) sel = selectorOf(fe); } catch (e) { /* another origin's */ }
      if (!sel) try { sel = w.name ? `iframe[name="${q(w.name)}"]` : `iframe[src*="${q(w.location.pathname.length > 1 ? w.location.pathname : w.location.host)}"]`; } catch (e) { /* unknown */ }
      out.unshift(sel || 'iframe');
      w = up;
    }
    return out;
  }
  /* a CSS selector that finds the control again: #id (one the page chose, unique), else [name=…] (+ value for a radio / checkbox) in the page
     or within its form, else a :nth-of-type path from the nearest unique id; inside a shadow root, after its host's (Playwright pierces it) */
  function selectorOf(el) {
    if (!el || el.nodeType !== 1) return '';
    const root = el.getRootNode(), host = root && root.host, pre = host ? selectorOf(host) + ' ' : '';
    const count = (scope, s) => { try { return scope.querySelectorAll(s).length; } catch (e) { return 0; } };
    const uid = (n) => !!n.id && !GEN_ID.test(n.id) && count(root, '#' + CSS.escape(n.id)) === 1;
    if (uid(el)) return pre + '#' + CSS.escape(el.id);
    const nm = el.getAttribute('name'), tag = el.tagName.toLowerCase();
    if (nm) {
      const val = /^(radio|checkbox)$/.test(el.type) && el.hasAttribute('value') ? `[value="${CSS.escape(el.getAttribute('value'))}"]` : '';
      const s = `${tag}[name="${CSS.escape(nm)}"]${val}`;
      if (count(root, s) === 1) return pre + s;
      const f = el.closest('form');
      if (f && count(f, s) === 1) return pre + selectorOf(f).slice(pre.length) + ' ' + s;
    }
    const out = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n !== el && uid(n)) { out.unshift('#' + CSS.escape(n.id)); break; }
      const p = n.parentElement, t = n.tagName.toLowerCase();
      if (!p) { out.unshift(t); break; }
      const same = [...p.children].filter((c) => c.tagName === n.tagName);
      out.unshift(same.length > 1 ? `${t}:nth-of-type(${same.indexOf(n) + 1})` : t);
    }
    return pre + out.join(' > ');
  }
  /* inspect overlay (content/overlay.js): a tag on each field with what it would get, or 'skip · why' */
  function overlay(on, opts) {
    const ov = ext('overlay');
    if (!ov || typeof ov.show !== 'function') return 0;
    try {
      if (!on) { ov.hide(); return 0; }
      const items = inspect(document, { ...(opts && typeof opts === 'object' ? opts : {}), widgets: true }).filter((a) => a && a.el && !/^(type|hidden|widget)$/.test(a.reason)).map((a) => {
        const box = a.reason === 'radio' || a.reason === 'checkbox', el = a.el;
        const at = a.rich ? frameOf(el) || el : a.box && a.box.nodeType === 1 ? a.box : !boxVisible(el) && el.labels && el.labels[0] ? el.labels[0] : el;
        return { el: at, label: box ? (a.rule ? 'rule' : a.reason) : a.cat === 'skip' ? 'skip · ' + a.reason : a.cat };
      }).filter((x) => boxVisible(x.el));
      ov.show(items);
      return items.length;
    } catch (e) { return 0; }
  }

  /* a phone box after its country <select> changed: the page re-renders first */
  function* settle(el, cat, P, o, st) {
    const t0 = Date.now();
    yield () => Date.now() - t0 >= 30;
    const v = valueFor(el, cat, P, o, st);
    if (v) { fit(el, candidates(el, cat, String(v), P, o, st), cat); noteRec(st, el, cat); }
    return !!v;
  }
  /* one rich text editor: counted only when its text reads back; logged for undo unless nothing changed */
  function richFill(a, st, o) {
    const el = a.el, prev = el.innerText || el.textContent || '', entry = { el, kind: 'rich', prev };
    note(el, entry);
    const done = (ok) => {
      if (ok) { st.count++; glow(el, o.highlight); noteRec(st, el, a.cat, 'fill', a.text); return; }
      st.why.set(el, 'editor');
      const i = log ? log.indexOf(entry) : -1;
      if (i >= 0 && flatText(richVal(el)) === flatText(prev)) { log.splice(i, 1); logged.delete(el); }
    };
    const r = drive(richType(el, a.text));
    return r && typeof r.then === 'function' ? r.then(done) : done(r);
  }
  /* one date picker: through its calendar; undo puts the shown value (and flatpickr's hidden one) back. An end date (check-out, to, end)
     is worked out when its turn comes, after the start's calendar picked the start. */
  function pickerFill(a, P, st, o, rec) {
    if (!a.picker) { const r = drive(settle(a.el, a.cat, P, o, st)), ok = (x) => { if (x) { st.count++; glow(a.el, o.highlight); } else st.why.set(a.el, 'nodata'); }; return r && typeof r.then === 'function' ? r.then(ok) : ok(r); }
    const el = a.el;
    calBox.add(el);
    if (!a.want || /^(out|to|end)$/.test(a.want.kind || '')) a.want = wantDate(el, a.cat, P, a.hint, st);
    const d = a.want;
    if (!d || !d.y) return null;
    const before = el.value, hid = flatHidden(el), hb = hid && hid.value;
    const after = (ok) => {
      if (ok) {
        noPicker.delete(el);
        tripAt(st, d, d.picked);
        if (!logged.has(el)) { logged.add(el); rec.push({ el, kind: 'quiet', prev: before, also: hid ? [[hid, hb]] : null }); }
        st.count++;
        glow(el, o.highlight);
        noteRec(st, el, a.cat);
        return drive(waitThen(30, () => leave(el))); // react-datepicker focuses its box again after the pick
      }
      if (el.readOnly || el.getAttribute('aria-readonly') === 'true') { // no calendar: left empty, and what opening it wrote (a time-only flatpickr's 12:00) put back, again once it closed
        const back = () => { if (el.value !== before) write(el, 'value', before, true); if (hid && hid.value !== hb) write(hid, 'value', hb, true); };
        back();
        noPicker.add(el);
        st.why.set(el, 'picker');
        return drive(waitThen(30, back));
      }
      return drive(typeDate(a, P, st, o, before)); // it takes typing: in the format its picker writes when that was learned
    };
    if (Date.now() - st.t0 > PICK_ALL_MS) return after(false); // out of time: typed if the box takes it, else left empty
    const r = drive(pickDate(el, d));
    return r && typeof r.then === 'function' ? r.then(after) : after(r);
  }
  function* waitThen(ms, fn) { const t0 = Date.now(); yield () => Date.now() - t0 >= ms; return fn(); }
  const leave = (el) => { if (deepActive() === el) focusOut(el); };
  /* a date typed into a picker's box; the calendar its focus opened is closed again (once the page had its turn) */
  function* typeDate(a, P, st, o, before) {
    const el = a.el, was = calsSet(el);
    note(el, { el, kind: 'value', prev: before, picker: true });
    const v = valueFor(el, a.cat, P, o, st);
    if (v) fit(el, candidates(el, a.cat, String(v), P, o, st), a.cat);
    if (el.value !== before) { st.count++; glow(el, o.highlight); noteRec(st, el, a.cat); } else st.why.set(el, 'picker');
    closeNew(el, was);
    const t0 = Date.now();
    yield () => Date.now() - t0 >= 30;
    closeNew(el, was);
    leave(el);
    return true;
  }

  /* puts the last fill back, newest change first, with the same events; controls that left the page are skipped.
     id: the background's id of the tab's last fill; a frame whose record is from an older fill only drops it (it took no part). */
  function undo(id) {
    const rec = Array.isArray(api.last) && (id == null || api.lastId === id) ? api.last : [], focus = deepActive();
    api.last = null; api.lastId = null;
    let n = 0;
    const later = []; // steps that wait for the page (editors, widget lists, calendars): each true when it put the value back
    for (let i = rec.length - 1; i >= 0; i--) {
      const { el, kind, prev, quiet, also, picker } = rec[i] || {};
      if (!el || !el.isConnected) continue;
      try {
        if (kind === 'checked' && el.type === 'radio') {
          if (prev && prev.isConnected) { if (!prev.checked) prev.click(); } else if (el.checked) {
            // nothing was chosen before and no user action unchecks a radio: a plain 'click' (no toggle) tells the page; a framework
            // that keeps its own value (React) checks it again, and then it isn't counted as restored
            write(el, 'checked', false);
            el.dispatchEvent(new Event('click', { bubbles: true, composed: true }));
            if (el.checked) continue;
          }
        } else if (kind === 'checked') { if (el.checked !== !!prev) el.click(); }
        else if (kind === 'select') { if (el.selectedIndex !== prev) write(el, 'selectedIndex', prev, quiet); refresh(el); }
        else if (kind === 'multi') {
          const sel = Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype, 'selected').set;
          [...el.options].forEach((op, j) => sel.call(op, !!prev[j]));
          el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          refresh(el);
        } else if (kind === 'rich') {
          const text = String(prev).replace(/\n+$/, '');
          if (flatText(richVal(el)) !== flatText(text)) { later.push(() => drive(richType(el, text))); continue; }
        } else if (kind === 'widget') {
          const { drive: w, box } = rec[i];
          if (chosenVals(el).join('\n') !== prev.join('\n')) { later.push(() => drive(widgetBack(el, w, box, prev))); continue; }
        } else if (kind === 'files') setFiles(el, prev);
        else if (kind === 'w') { // a widget of content/widgets.js: its own restore
          const W = ext('widgets'), entry = rec[i].entry;
          if (W && typeof W.restore === 'function') later.push(() => capped(Promise.resolve().then(() => W.restore(entry, prev)), W_MS).then((ok) => !!ok));
          continue;
        } else if (kind === 'iti') { // the country intl-tel-input showed before (not counted: the number is)
          if (prev && itiCountry(el) !== prev) itiPick(el, prev, '');
          continue;
        } else if (kind === 'quiet' || picker) { // a date picker's box: put back without focusing it (that opens its calendar), and closed
          const was = calsSet(el), clear = !prev && el.closest('.ant-picker') && el.closest('.ant-picker').querySelector('.ant-picker-clear');
          if (clear && el.value) clickEl(clear); // Ant keeps the date in its own state: its clear button empties both
          if (el.value !== prev) write(el, 'value', prev, true);
          el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Unidentified', bubbles: true, cancelable: true, composed: true })); // bootstrap-datepicker / jQuery UI re-read it
          for (const [x, v] of also || []) if (x.isConnected && x.value !== v) write(x, 'value', v, true);
          closeNew(el, was);
          later.push(() => drive(waitThen(30, () => { closeNew(el, was); leave(el); return false; })));
        } else if (el.value !== prev) {
          write(el, 'value', prev);
          if (el.value !== prev && /^(text|tel|email|password|url|search|)$/.test((el.type || '').toLowerCase())) retype(el, prev); // a mask rewrote it
        }
        n++;
      } catch (e) { /* ignore */ }
    }
    const tasks = later.map((f) => () => { const r = f(), c = (ok) => { if (ok) n++; }; return r && typeof r.then === 'function' ? r.then(c) : c(r); });
    return series(tasks, () => { refocus(focus); return n; });
  }

  const old = window.__formGhost;
  const kept = old && Array.isArray(old.last); // an update keeps the undo record (and the export of that fill)
  const records = () => (Array.isArray(api.lastRecs) ? api.lastRecs.map((r) => ({ ...r })) : []);
  const api = { v: VERSION, fill, inspect, undo, modal, where, overlay, records, insertEdge, last: kept ? old.last : null, lastId: kept && old.lastId != null ? old.lastId : null,
    lastRecs: old && Array.isArray(old.lastRecs) ? old.lastRecs : null };
  window.__formGhost = api;
})();
