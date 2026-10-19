# FormGhost tests

*FormGhost - [github.com/mahtoaman/formghost](https://github.com/mahtoaman/formghost), created and maintained by Aman Mahto ([@mahtoaman](https://github.com/mahtoaman)). Apache-2.0.*

## Running the suites

- **Library tests**: `node --test test/` (`test/index.js` loads `lib.test.mjs`, `bg.test.mjs` and `attribution.test.mjs`, since Node 22+ runs a directory argument as a module; Node 20 is not supported), or `node --test test/*.test.mjs`. These cover persona generation (age, Aadhaar, PAN, altPhone/emergency/nominee, idDates/landline/references), `FormGhost.withPrefs`, `lib/site.js` keys and blocklist matching, and `background.js` messages, menus and hotkeys against a stubbed `chrome.*`.
- **Fill fixtures in headless Chrome**: `node test/run.mjs` (prints PASS/FAIL per check and the page time against the 29.7 s virtual-time budget, exits 1 on any failure). Add `--fails` to print only failures, or a case-id prefix such as `traps` to run just that group (see the group list below). Set `CHROME=/path/to/chrome` if Chrome isn't at the macOS default path. With `CI` set (GitHub Actions sets it), Chrome also runs with `--no-sandbox`.
- **In a browser**: open `test/fixtures.html` directly; the page title becomes `FG-RESULT pass/total`. Add `?keep` to keep each case's iframe for inspection, or `?only=traps` to run a subset.
- **CI** (`.github/workflows/ci.yml`) runs `node --test test/` and `node test/run.mjs` on Ubuntu with Node 22 and Chrome stable on every push and pull request.

## What the fixture groups cover

Each case in `test/fixtures.html` has a `data-id` like `group.case-name`; `run.mjs` and the in-page summary group results by the part before the dot.

| group | covers |
|---|---|
| `version` | the extension version guard and re-injection |
| `skip-fields` | card/SSN/security-code fields skipped before anything else |
| `field-types` | label vs. `type=` when choosing a field's category |
| `autocomplete` | `autocomplete` token parsing |
| `id-holder` | "account holder name" style fields stay names, not IDs |
| `word-labels` | word-boundary label matching (country, names, misc) |
| `traps` | honeypots, hidden/off-screen fields, scroll shells, modals |
| `radios` | radio grouping and ID-type radios/selects |
| `checkboxes` | required/agree boxes and checkbox groups |
| `opt-out` | `data-formghost` opt-out on elements, body, html and meta |
| `in-regions` | Indian state/city name aliases |
| `inspect` | `inspect()` listing controls without changing them |
| `core-fills` | phone modes, OTP, DOB, overwrite, highlight, checkbox toggle |
| `us-form` | a US-shaped address form |
| `scope` | `field` / `form` / modal auto-scope fills |
| `undo` | `undo()` and `undo(id)` |
| `persona-fields` | altPhone/altEmail, spouse, emergency contact, nominee, blood group, notice period, scheme IDs, household size |
| `scheme-ids` | e-Shram/Ayushman/ABHA/ration/NREGA style IDs |
| `prefs` | `FormGhost.withPrefs` reaching the page (test phones, plus-addressed email) |
| `scope-overwrite` | scope fills combined with Overwrite off |
| `constraints` | values fitted to maxlength/minlength/pattern/min/max/step |
| `dates` | date meaning (past/future), ranges, text formats |
| `pickers` | flatpickr / react-datepicker / bootstrap-datepicker mimics |
| `select-widgets` | select2 / chosen / bootstrap-select / Tom Select / Selectize / Choices.js / Radix |
| `editors` | rich-text and contenteditable editors |
| `phone-widgets` | intl-tel-input / react-phone-number-input / custom country pickers |
| `masks` | focus event order and input masks |
| `used-report` | `fill()`'s `{ count, used }` shape |
| `label-edge-cases` | labels from surrounding text, select edge cases, OTP words, landline, references, "Required fields only" |
| `persona-fields-id` | idDates/landline/references reaching the page through withPrefs |
| `contract` | content-script injection order and re-injection guards |
| `widgets` | react-select, MUI, Ant Design, Radix, Headless UI, ARIA patterns, downshift, Google-Forms-style pages |
| `rules` | custom `rules`, overrides, `forceType`, templates |
| `report` | the fill report (`{ filled, skipped }`) |
| `records` | `records()` selectors |
| `edge-mode` | edge-case values, sample files, test card numbers |
| `intl-labels` | German/French/Spanish/Brazilian Portuguese/Italian labels, Indian business IDs, CPF/CNPJ |
| `qa-edge` | `qa.kinds` / `qa.edge` |
| `qa-file` | `qa.file` |
| `qa-card` | `qa.card` |
| `qa-format` | `qa.format` (Playwright/Cypress/JSON export) |
| `overlay` | the Inspect overlay |
| `regressions` | fixes to earlier cases, grouped by the bug rather than split across the groups above |

`H` in the summary is the harness itself (scripts loading, no exception during the run), not a fixture group.

## Fixture grammar

The comment at the top of `test/fixtures.html` is the full reference for case and field attributes (`data-id`, `data-cat`, `data-val`, `data-check`, `data-focus`, `data-mimic`, macros, and so on). The short version:

- A case is a `<script type="text/x-fg-case" data-id="..." data-title="...">...</script>` block holding a form fragment.
- Mark fields with `data-cat` (expected category), `data-val` (expected value after `fill()`), `data-reason` (expected skip reason) and `data-group` (checked radio/checkbox inside a container).
- Scoped fills use `data-focus` (+ `data-hasfocus`); safe test data uses `data-prefs`; undo cases use `data-check="undo..."`.
- Widget stand-ins (select2, flatpickr, react-select, MUI, and so on) are small functions in `MIMICS`, injected after the case HTML. They imitate just enough of each library's markup and events to exercise the filler; no library code or network access is involved.
- `fill()` may return a number or `{ count, used }`, or a promise of either (pickers wait for a calendar open/close). The harness waits up to the case's `data-timeout` (default 1.5 s) and then one more task, so every case reports a result and none hang. Every filled case also checks that `readonly` / `disabled` / `maxlength` / `minlength` / `pattern` / `min` / `max` / `step` / `type` are left alone.

## Adding a case

1. Pick the group your case belongs to (or add a new one) and give it a `data-id` of `group.short-name`.
2. Write the form fragment, marking the fields you care about with `data-cat` / `data-val` / `data-reason` as above.
3. If the case needs a widget stand-in, add `data-mimic="..."` and check whether `MIMICS` already covers that library; extend it if not.
4. Run `node test/run.mjs <group>` (or open `fixtures.html?only=<group>` in a browser) to check just your new case while iterating, then run the full suites before committing.

## Attribution

`attribution.test.mjs` fails when a `.js` / `.mjs` / `.css` / `.html` file in the repository (outside `.git`, `node_modules`, `dist` and local dot-folders) doesn't start with the FormGhost copyright header, `LICENSE` differs from the Apache License 2.0 text, `NOTICE` loses its attribution to Aman Mahto (@mahtoaman), or the credit leaves `manifest.json` (`homepage_url`), the popup, the Playwright/Cypress exports of `content/qa.js`, `.github/CODEOWNERS` or the project docs. Apache-2.0 §4(c) and §4(d) require copies to keep these.
