# Changelog

*FormGhost: [github.com/mahtoaman/formghost](https://github.com/mahtoaman/formghost), created and maintained by Aman Mahto ([@mahtoaman](https://github.com/mahtoaman)).*

Notable changes, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). Versions 1.1.0 to 1.4.0 were private builds.

## [Unreleased]

## [2.0.0] - 2026-10-19

First open-source release.

### Open source
- Licensed under the Apache License 2.0, with a NOTICE file and a copyright header in every source file.
- Popup credit and an About section with links to the source, issues and license; `homepage_url` in the manifest; exported Playwright / Cypress scripts start with a FormGhost credit comment.
- Contributing guide, code of conduct, security policy, issue and pull request templates, CI for both test suites, and `scripts/pack.mjs` to build the Chrome Web Store zip.

### Custom widgets
- react-select, MUI Select / Autocomplete, Ant Design, Angular Material, ng-select, Headless UI, Radix / shadcn, downshift and any ARIA combobox, checkbox, switch or radio group, driven as a user would. Options such as *Create …*, *Add new* or *Delete* are never clicked.
- Google Forms questions: multiple choice, checkboxes, dropdowns, linear scales and grids.

### Control over what is filled
- **Fill field as ▸**, **Skip this field** and **Forget this field** (right-click), remembered per field and site.
- **Rules**: fixed values per site or for every site, matched by selector, regex, `name=`, `id=` or `label=`, with tokens such as `{{email}}`, `{{digits:6}}` and `{{date:+7d:YYYY-MM-DD}}`.
- Fill report in the popup (**12 filled · 3 skipped**, with the reasons).

### QA tools
- **Copy as ▸ JSON / Playwright / Cypress** after a fill.
- **Inspect** overlay that tags each field with what it will get or why it is skipped.
- **Insert test value ▸** and *Edge-case mode*; *Sample files for uploads*; *Test card numbers* (Stripe test cards, never in hosted payment frames). All off by default.
- **Backup** export / import (merge or replace, checked before writing) and **Bulk export** of up to 500 identities as CSV or JSON.

### Data
- Real Indian pincodes (242, with post office and district) and IFSC codes (820, with bank and branch), from India Post and Razorpay's IFSC dataset.
- GSTIN, TAN, CIN, Udyam, UAN and vehicle registration numbers; Brazilian CPF and CNPJ with valid check digits.
- German, French, Spanish, Portuguese and Italian form labels and date formats.

## [1.4.0]

### Added
- Values fitted to `maxlength`, `minlength`, `pattern`, `min` / `max` / `step` and password rules; the password a site accepted is reused on that site.
- Past and future dates by meaning (issue vs expiry, check-in vs check-out), and date formats read from the field.
- Date pickers (flatpickr, react-datepicker, MUI X, Ant Design, jQuery UI, bootstrap-datepicker) filled through their own calendar.
- select2, chosen, bootstrap-select, Tom Select, Selectize and Choices.js; rich text editors (Quill, TipTap, TinyMCE, Draft.js, CKEditor 5, Lexical, Slate); intl-tel-input, react-phone-number-input and input masks.
- *Required fields only*; landline and STD codes; references; passport / licence issue and expiry dates.

### Changed
- *Fill this field* fills the field you pointed at even when it has a value; undo restores editor text too.

## [1.3.0]

### Added
- Right-click **FormGhost** menu: *Fill this form*, *Fill this field* and *Undo last fill*, with optional keyboard shortcuts.
- **Undo** the last fill. When a modal dialog is open, only that dialog is filled.
- **Blocked sites** list; *Turn off here* covers the exact host.
- **Safe test data**: email domain, send to my inbox, reserved test phone numbers.
- **Details** and **Recent identities** in the popup.
- A whole person: alternate phone and email, spouse, emergency contact, nominee, blood group, notice period; Indian scheme IDs (e-Shram, Ayushman / PM-JAY, ABHA, MGNREGA job card, ration card).

## [1.2.0]

### Added
- **Turn off here** in the popup, and `data-formghost="off"` / `<meta name="formghost" content="off">` for site developers.
- Aadhaar numbers with a valid check digit; MPIN / UPI PIN fields; old and short Indian state and city names.
- Library and fixture tests.

### Changed
- *Overwrite filled fields* is off by default: existing values are kept.
- Each site keeps its own identity until it is idle for 30 minutes.
- More fields are skipped: SSN, coupon / referral / gift-card codes, disabled fields and honeypots. With a country picked by hand, no IP lookup is made.

## [1.1.0]

Initial version.

- One-click fill from the popup, **Alt + Shift + F** or the right-click menu.
- Region detected from your IP, or picked by hand, for 12 countries; name, city, state, pincode and phone always agree.
- Phone modes *Smart*, *Local only* and *With +code*.
- The same identity across multi-step forms; dev OTPs typed in; profile, KYC and bank fields.
- Works with React / Vue / Angular forms, iframes and shadow DOM.

[Unreleased]: https://github.com/mahtoaman/formghost/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/mahtoaman/formghost/releases/tag/v2.0.0
[1.4.0]: https://github.com/mahtoaman/formghost/blob/main/CHANGELOG.md#140
[1.3.0]: https://github.com/mahtoaman/formghost/blob/main/CHANGELOG.md#130
[1.2.0]: https://github.com/mahtoaman/formghost/blob/main/CHANGELOG.md#120
[1.1.0]: https://github.com/mahtoaman/formghost/blob/main/CHANGELOG.md#110
