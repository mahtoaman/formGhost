# FormGhost: Smart Form Filler

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![CI](https://github.com/mahtoaman/formghost/actions/workflows/ci.yml/badge.svg)](https://github.com/mahtoaman/formghost/actions/workflows/ci.yml)

**Fill any web form in one click with realistic, region-aware test data.** A Chrome (Manifest V3) extension for developers and testers.

Created and maintained by **Aman Mahto ([@mahtoaman](https://github.com/mahtoaman))**, source: [github.com/mahtoaman/formghost](https://github.com/mahtoaman/formghost).

---

## Features

- **One consistent person per site.** Name, city, state, pincode / ZIP and phone all come from one region, and every step of a multi-step form (signup → profile → KYC → bank) gets the same identity.
- **Region from your IP**, or picked by hand. India (North / West / South / East), United States, United Kingdom, Canada, Australia, Germany, France, Spain, Brazil, UAE, Pakistan and Bangladesh. Other countries use US data.
- **A whole person:** alternate phone and email, spouse, emergency contact, nominee, two references, education, work, bank details, ID numbers with issue and expiry dates, landline with STD code.
- **Valid IDs:** Aadhaar check digit, PAN, GSTIN, TAN, CIN, Udyam, UAN, vehicle numbers, US routing numbers, UK / EU IBANs, Brazilian CPF / CNPJ.
- **Real Indian data:** 242 real pincodes with their post office and district (India Post), and 820 real IFSC codes with their bank and branch (Razorpay's open IFSC dataset). See [NOTICE](NOTICE).
- **Fills the hard fields:** date pickers, react-select, MUI, Ant Design, Radix / shadcn, Headless UI, select2, Tom Select and other dropdown widgets, rich text editors, phone country pickers, input masks, split OTP boxes, iframes, shadow DOM, Google Forms.
- **Values that fit the field:** `maxlength`, `pattern`, `min` / `max` / `step`, password rules, date formats, past vs future dates.
- **QA tools:** Inspect overlay, edge-case values, sample upload files, Stripe test cards, **Copy as JSON / Playwright / Cypress**, bulk export of up to 500 identities.
- **Undo** the last fill, **rules** for fixed values, **remembered field types**, a **blocklist** to keep it off real sites.
- Labels in English, German, French, Spanish, Portuguese and Italian.

## Install

**Chrome Web Store:** coming soon.

**From source** (takes two minutes):

1. Clone the repository, or download it as a ZIP from GitHub and unzip it:
   ```sh
   git clone https://github.com/mahtoaman/formghost.git
   ```
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `formghost` folder (the one with `manifest.json`).
5. Pin the ghost icon from the puzzle-piece menu.

After pulling new code, press the reload icon on FormGhost's card in `chrome://extensions` and refresh the page you are testing.

## Usage

### Popup
Click the ghost:
- **Fill this page** fills every form on the page. When a modal dialog is open, only the topmost dialog is filled.
- After a fill the popup shows what happened (**12 filled · 3 skipped**, hover for the reasons), **Undo** for 5 seconds, and **Copy as ▸ JSON / Playwright / Cypress**: the fill as data or as a ready-to-paste test script.
- The region card shows the detected country; change it with the region picker, or press **Re-detect**.
- **↻** makes a new identity. **Details** lists everything about the current identity (click a row to copy it) and **Recent identities**, the last 15 that filled a site; **Use here** gives one back to the current site.
- **Inspect** (the eye) tags each field on the page with what it will get, or why it is skipped. Esc, the close chip or the eye again removes the tags.
- Phone format: **Smart** (a local number; adds the country code, such as `+91`, only when the field wants it), **Local only**, or **With +code**.
- **Turn off here** (footer) turns FormGhost off on that host.

### Keyboard shortcuts
| Command | Default key |
| --- | --- |
| Fill this page | **Alt + Shift + F** |
| Fill this form (around the focused field) | none |
| Fill this field (the focused field) | none |
| Undo last fill | none |

Set the others at `chrome://extensions/shortcuts`, or in Settings → **Shortcuts** → **Change**.

### Right-click menu
Right-click → **FormGhost**:
- **Fill this page**, **Fill this form**, **Fill this field**, **Undo last fill**. *Form* and *field* appear when you right-click a text field.
- **Fill field as ▸** fills the field as a given type (full name, email, phone, PIN / ZIP, date of birth…) and remembers that for this field on this site. **Skip this field** leaves it empty from then on; **Forget this field** drops what was remembered.
- **Insert test value ▸** puts an edge-case value in the field: very long text, Unicode + emoji, right-to-left text, *O'Brien-Smith*, padded spaces, HTML-like text, an invalid email, out-of-range or odd numbers, far-past / far-future dates. The values are harmless (no scripts, no SQL).

### Settings (gear icon)
- **Filling:** *Overwrite filled fields* (off by default: fields that already have a value are kept), *Required fields only*, *Auto-tick checkboxes*, *Highlight filled fields*.
- **Safe test data:** an **Email domain** for every email (e.g. `example.com`), **Send to my inbox** (`you@gmail.com` becomes `you+name@gmail.com`), and **Test phone numbers** from ranges reserved for testing (US/CA `555-01xx`, UK `07700 900xxx`, Australia `0491 570` to `572`). These change only what is filled; the stored identity stays as generated.
- **Testing:** *Edge-case mode*, *Sample files for uploads* (a small valid PNG / PDF / text file matching the input's `accept`), *Test card numbers* (Stripe's test card `4242 4242 4242 4242`; never inside hosted payment frames such as Stripe, Braintree or Adyen). All three are off by default.
- **Rules:** give matching fields a fixed value, on one site or every site. Match by CSS selector (`#email`), `/regex/flags` on the label and name, or `name=`, `id=`, `label=`. Values can use tokens such as `{{email}}`, `{{firstName}}`, `{{digits:6}}`, `{{pick:a|b|c}}`, `{{date:+7d:YYYY-MM-DD}}` and `{{uuid}}`. A rule beats a remembered type, which beats detection.
- **Remembered fields:** what *Fill field as* saved, by site.
- **Blocked sites:** `host`, `host:port`, `host/path` or `*.host` (the host and every subdomain).
- **Backup:** export settings, rules and remembered fields (optionally recent identities) to `formghost-settings.json`, and import them back (**Merge** or **Replace**). Imports are checked before anything is written.
- **Bulk export:** up to 500 identities of a region as CSV or JSON.

### Keep FormGhost off a page (for site developers)
Add `data-formghost="off"` to a form, or to any element around fields, and FormGhost won't touch those fields. On `<html>` or `<body>`, or as `<meta name="formghost" content="off">`, it turns off the whole page.

### What it skips
Payment card number, CVV, card expiry and name on card (unless *Test card numbers* is on), SSN, coupon / referral / gift-card codes, captcha, search, disabled and hidden fields, and hidden spam-trap (honeypot) fields. It never clicks submit buttons, and never picks dropdown options such as *Create …*, *Add new* or *Delete*.

## Privacy

- The only network call is one IP-location lookup (ipwho.is, then geojs.io, ipapi.co and country.is one at a time as fallbacks), cached for 6 hours. If you pick a country by hand, no lookup is made unless you press **Re-detect**.
- No data about the pages you fill ever leaves your browser. FormGhost has no analytics and no server.
- Settings, the blocklist, rules and remembered fields are saved in Chrome's sync storage, like any extension's settings; rules or remembered fields too large for it stay on this device. Recent identities stay on this device.
- Sample files and test values are made inside the extension; nothing is downloaded.
- Permissions: `activeTab`, `scripting`, `storage`, `contextMenus`, and the four IP-lookup hosts. FormGhost's scripts are injected into a page only when you use it there (a fill, Inspect or a menu item); there are no always-on content scripts.

## Development

There is no build step and there are no dependencies: plain JavaScript, loaded as-is by Chrome.

```
manifest.json      extension manifest (Manifest V3)
background.js      service worker: region lookup, identities per site, menus, shortcuts, settings
content/           injected on demand: widgets.js, qa.js, overlay.js, filler.js (in that order)
lib/               locales, persona, profile, site, rules and Indian reference data (data-in.js)
popup/             the popup UI
test/              Node tests, browser fixtures and the headless Chrome runner
scripts/pack.mjs   builds the Chrome Web Store zip
```

**Tests** (Node 22 or newer, as in CI):

```sh
node --test test/      # data libraries, background messages, attribution checks
node test/run.mjs      # form-filling fixtures in headless Chrome
```

`node test/run.mjs` looks for Chrome at the macOS default path; set `CHROME=/path/to/chrome` elsewhere. Add `--fails` to print only failures, or a case-id prefix such as `A11` to run a subset. You can also open `test/fixtures.html` in Chrome. See [test/README.md](test/README.md) for the fixture format.

**Package** for the Chrome Web Store:

```sh
node scripts/pack.mjs  # writes dist/formghost-v<version>.zip (needs the `zip` command)
```

CI runs both test suites on every push and pull request.

## Contributing

Bug reports, ideas and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first, and follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in [SECURITY.md](SECURITY.md). Release notes are in [CHANGELOG.md](CHANGELOG.md).

## License

FormGhost is licensed under the [Apache License, Version 2.0](LICENSE).
Copyright 2026 Aman Mahto ([@mahtoaman](https://github.com/mahtoaman)).

You may use, modify and redistribute it, including commercially. Under Section 4 of the license, a fork, copy or redistribution (source or packaged extension) **must**:

- include a copy of the [LICENSE](LICENSE) file;
- keep the [NOTICE](NOTICE) file and its attribution to Aman Mahto (@mahtoaman) (§4(d));
- keep the copyright, attribution and license headers at the top of every source file (§4(c));
- state clearly in any file you changed that you changed it (§4(b)).

The license grants no rights to the name "FormGhost" (Section 6), so please give a modified version its own name.

`lib/data-in.js` contains data from India Post's All India Pincode Directory (Government Open Data License – India) and Razorpay's IFSC dataset (public domain). The details and attribution are in [NOTICE](NOTICE).
