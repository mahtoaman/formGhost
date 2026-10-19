# Contributing to FormGhost

*FormGhost: [github.com/mahtoaman/formghost](https://github.com/mahtoaman/formghost), created and maintained by Aman Mahto ([@mahtoaman](https://github.com/mahtoaman)).*

Thanks for helping. Bug reports, form samples that FormGhost fills badly, and pull requests are all welcome. By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs and ideas

- **Bug:** open an issue with the *Bug report* form. The most useful thing you can give is the page (a public URL, or a minimal HTML snippet of the form) and what was filled compared with what you expected.
- **Feature:** open an issue with the *Feature request* form before writing a large change, so we can agree on the approach first.
- **Security problem:** do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Setup

No build step, no package manager, no dependencies.

1. Fork the repository and clone your fork.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select the repository folder.
3. After each change, press the reload icon on FormGhost's card in `chrome://extensions`, then refresh the page you test on.

You need Node.js 22 or newer (CI uses Node 22) to run the tests, and Google Chrome for the fixture tests. On Node 20 (end of life), `node --test test/` also picks up `test/run.mjs` and `test/index.js` and runs every suite twice.

## Tests

```sh
node --test test/      # data libraries, background messages, attribution checks
node test/run.mjs      # form-filling fixtures in headless Chrome
```

- `node test/run.mjs` uses Chrome at the macOS default path. Elsewhere set `CHROME=/path/to/chrome`. Add `--fails` to print only failures, or a case-id prefix (for example `A11`) to run a subset.
- You can also open `test/fixtures.html` in Chrome; add `?only=<case-id>` to run a subset or `?keep` to keep each case's frame for inspection.
- Both suites must pass before a pull request is merged. CI runs them on every push and pull request.

### Add a test with your change

- **Filling behaviour** (`content/`): add a fixture case to `test/fixtures.html`, a `<script type="text/x-fg-case">` block with the form HTML, its fields marked with `data-cat` / `data-val` / `data-reason`. The grammar is in the comment at the top of that file and in [test/README.md](test/README.md). For a UI library, add or extend a small stand-in in `MIMICS` instead of loading the library.
- **Data, personas, rules, site matching** (`lib/`): add a test to `test/lib.test.mjs`.
- **Background, menus, settings, import / export** (`background.js`): add a test to `test/bg.test.mjs`.
- A bug fix should come with a test that fails without the fix.

## Code style

- **Plain JavaScript** that Chrome loads as-is. No build step, no transpiler, no npm dependencies, no frameworks, no code fetched at runtime.
- **Compact, readable code** in the style of the file you are editing: 2-space indent, single quotes, semicolons, short helpers, a one-line comment where the *why* is not obvious.
- `lib/` stays pure (no `chrome.*` APIs) so it can be tested in Node.
- Content scripts load in this order: `widgets.js`, `qa.js`, `overlay.js`, `filler.js`. Each one must work when the others are missing.
- **Privacy and safety are features.** Don't add network calls, analytics or new permissions (the tests check the permission list). FormGhost never submits a form, never clicks *Create* / *Delete* style options, and never adds anything visible to the pages it fills.
- `.editorconfig` sets the basics (UTF-8, LF, final newline).

## Pull requests

- **One feature or fix per pull request.** Small pull requests are reviewed faster.
- Describe what changed and how you tested it, and fill in the checklist in the pull request template.
- Add a line to the *Unreleased* section of [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.
- Don't bump the version in `manifest.json`; the maintainer does that when releasing.

## Attribution headers and NOTICE

Every `.js`, `.mjs`, `.css` and `.html` file starts with this header (in an `<!-- -->` comment right after `<!doctype html>` for HTML):

```js
/*!
 * FormGhost - https://github.com/mahtoaman/formghost
 * Copyright 2026 Aman Mahto (@mahtoaman)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 */
```

- Add it to every new source file, above any description comment.
- Don't remove or change the header, [LICENSE](LICENSE), [NOTICE](NOTICE), the `homepage_url` in `manifest.json`, the credit in the popup, or the credit line in exported test scripts. `test/attribution.test.mjs` checks all of them, so CI fails a pull request that removes them. Pull requests that remove attribution will not be merged.
- Contributors are credited through the git history and the changelog.

## License of contributions

FormGhost is licensed under the [Apache License, Version 2.0](LICENSE). Under Section 5 of that license, any contribution you intentionally submit for inclusion in FormGhost (for example by opening a pull request) is licensed under the Apache License 2.0, without any additional terms or conditions. Only submit code and data that you have the right to license this way. If you add third-party data, say where it comes from and under which license in the pull request, so it can be recorded in [NOTICE](NOTICE).
