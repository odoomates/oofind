# Store listings

Copy-paste material for the Chrome Web Store and Firefox Add-ons (AMO).
Upload packages are built with `python3 tools/build.py`:
`dist/oofind-<version>-chrome.zip` and `dist/oofind-<version>-firefox.zip`
(also attached to each GitHub release).

---

## Shared text

**Name:** OoFind - Visual Search for Odoo

**Short description** (Chrome summary, max 132 chars; AMO summary, max 250):

> Visual filters with live counts, a domain workbench and 'why isn't this record here?' explanations for Odoo 17+.

**Full description:**

```
OoFind adds a visual search panel to Odoo 17, 18, 19 and later. Press Alt+Shift+F (or click the toolbar button) on any list, kanban, pivot, graph or form view.

FILTERS: ONE CLICK, NO TYPING
• Value bars with record counts for status, selection, customer, salesperson, tags and yes/no fields
• Counts update as you filter: each field's counts ignore its own filter, so you see what another value would give
• Date presets (today, this week, last month, this quarter…), custom ranges and a clickable month histogram
• Number ranges with quick buckets
• The most useful fields are picked for you; pin any other field

BUILDER: COMPLEX FILTERS WITHOUT DOMAIN SYNTAX
• Visual AND / OR condition tree, kept in sync with the Python domain
• Fields through relations (Customer › Country), record pickers, operators that match the field type
• Live total count, plus a count for every condition on its own
• Copy the domain as Python or JSON for your custom modules

EXPLAIN: WHY ISN'T THIS RECORD IN MY RESULTS?
• Pick a record by name, from a list row, or use the open form
• Every condition is checked on the server for that record, so computed fields, related fields and access rules are handled correctly
• See which condition excludes it, with the record's actual values, and whether it is archived

PRESETS
• See the filters and group-bys a menu opens with
• Clear all, or reset to the menu's defaults in one click
• The menu's own filters and group-bys as toggles, plus a custom group-by on any field

SAVED
• Save the current search as a regular Odoo favorite (private, shared or default)
• Recent searches

Everything OoFind applies becomes a normal Odoo search facet: you can remove it from the search bar, save it as a favorite, and it survives breadcrumbs. The panel collapses to a small floating button (with an active-filter count) after you filter or when you click outside it.

PRIVACY
OoFind runs only when you open it, only on that tab, and talks only to the Odoo server you are on, with your own session and access rights. No data is collected, no analytics, no third-party services.

OoFind is an independent open-source project (MIT), not affiliated with Odoo S.A. "Odoo" is a trademark of Odoo S.A.
Source: https://github.com/odoomates/oofind
```

**Homepage:** https://github.com/odoomates/oofind
**Support:** https://github.com/odoomates/oofind/issues
**Privacy policy:** https://github.com/odoomates/oofind/blob/main/PRIVACY.md
**License:** MIT

---

## Chrome Web Store (https://chrome.google.com/webstore/devconsole)

One-time: register a developer account (US$5 fee) with the Google account that should own the listing.

**Package:** `dist/oofind-<version>-chrome.zip`

**Store listing tab**
- Category: *Productivity → Workflow & Planning* (or *Tools*)
- Language: English
- Icon: taken from the package (128×128)
- Screenshots (1280×800): `store/screenshots/1-filters.png` … `5-collapsed.png`
- Small promo tile (440×280): `store/promo-small-440x280.png`
- Marquee promo tile (1400×560, optional): `store/promo-marquee-1400x560.png`
- Official URL: none · Homepage: GitHub URL above · Support: issues URL above

**Privacy practices tab**

*Single purpose:*
> OoFind helps users search and filter records in the Odoo web application: it adds a panel with visual filters, a filter builder and explanations of why a record does or does not match the current search.

*Permission justifications:*
- **activeTab**: The panel is injected only into the tab where the user clicks the toolbar button or presses the shortcut, so the extension needs no standing access to any website.
- **scripting**: Used to inject the panel (and a small script that talks to Odoo's search on the page) into the active tab when the user asks for it.
- **storage**: Stores the user's panel preferences locally (panel width, pinned fields, floating button position, recent searches). Nothing is sent anywhere.

*Host permissions:* none requested.

*Remote code:* **No, I am not using remote code.** All JavaScript is packaged in the extension.

*Data usage:* collects none of the listed data types. Tick the three certifications (not sold, not used for unrelated purposes, not used for creditworthiness).

*Privacy policy URL:* see above.

**Distribution:** Public, all regions (or Unlisted to share by link only).

---

## Firefox Add-ons (https://addons.mozilla.org/developers/)

One-time: sign in with a Firefox account (free).

**Submit a New Add-on → On this site** (listed) → upload `dist/oofind-<version>-firefox.zip`.

- Compatibility: Firefox (desktop), minimum 128 (from the manifest)
- Source code: **not needed**. Nothing is minified, transpiled or bundled; the package is the source.
- Summary / description / homepage / support / license (MIT) / privacy policy: as above
- Categories: *Search Tools*, *Other*
- Tags: odoo, erp, search, filter, productivity
- Screenshots: the same PNGs (any size accepted)

**Notes to reviewer:**
```
OoFind only works on an Odoo 17+ web client (https://www.odoo.com/trial gives a free instance, or runbot.odoo.com).
To test: log in to Odoo, open Sales > Orders (or Contacts), click the OoFind toolbar button (or Alt+Shift+F).

- The panel is injected on demand with scripting.executeScript (activeTab only).
- src/page/bridge.js runs in the page's MAIN world: it is the only way to reach the Odoo web client's
  search model (odoo.__WOWL_DEBUG__.root) so that filters become native Odoo facets. It communicates
  with the content script through DOM CustomEvents carrying JSON strings, and exposes only
  read-search/apply-filter commands.
- All network requests go to the Odoo origin of the current tab (/web/dataset/call_kw), with the
  user's own session. No remote code, no analytics, no third-party services.
- The source is not minified; tests are in tests/ of https://github.com/odoomates/oofind.
```
