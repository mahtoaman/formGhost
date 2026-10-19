# Security Policy

*FormGhost: [github.com/mahtoaman/formghost](https://github.com/mahtoaman/formghost), created and maintained by Aman Mahto ([@mahtoaman](https://github.com/mahtoaman)).*

## Supported versions

Only the latest release gets security fixes.

| Version | Supported |
| --- | --- |
| 2.0.x | Yes |
| < 2.0 | No |

## Reporting a vulnerability

**Please do not report security problems in public issues, pull requests or discussions.**

Report them privately through GitHub:

1. Open the repository's **Security** tab: <https://github.com/mahtoaman/formghost/security>
2. Click **Report a vulnerability** (direct link: <https://github.com/mahtoaman/formghost/security/advisories/new>).
3. Describe the problem, the FormGhost and Chrome versions, and the steps or a minimal page that shows it.

The report is visible only to you and the maintainer. This is a volunteer project; expect a first reply within about a week. Once a fix is released, the advisory can be published with credit to you, if you want it.

If the **Report a vulnerability** button is missing, private reporting has not been turned on yet. In that case, open a public issue that only asks for a private contact, without any details of the problem.

> **Maintainer note:** private vulnerability reporting is off by default on GitHub. Turn it on in the repository's **Settings**, under **Advanced Security** (named *Code security* on some accounts): **Private vulnerability reporting → Enable**.

## What counts as a vulnerability

For example:

- A web page reading or changing FormGhost's settings, rules, identities or fill history, or sending messages the service worker acts on.
- FormGhost running script from a page, or putting page-controlled content somewhere it gets executed (the popup, exported test scripts, the Inspect overlay).
- Data about the pages you fill leaving the browser.
- An imported settings file, a rule or a regex that can harm the browser or a page (code execution, prototype pollution, a page freeze).
- FormGhost submitting a form or clicking a destructive option on its own.

Not in scope: generated test data that happens to match a real person or real ID number (it is random, but formats are valid by design), and problems that need a modified copy of FormGhost or a compromised browser.
