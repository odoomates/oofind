# OoFind: visual search for Odoo

A browser extension (Chrome, Edge, Firefox) that adds a search panel to Odoo 17, 18, 19 and later (tested on 17.0, 18.0, 19.0 and 19.5).
Click the toolbar button or press **Alt+Shift+F** on any Odoo list, kanban, pivot, graph or form view.

## Panel and floating button

- **Alt+Shift+F** (or the toolbar button) opens the panel; pressing it again collapses it to a
  round floating button. The button shows how many filters are active, opens the panel when
  clicked, and can be dragged anywhere (its position is remembered).
- After you apply a filter the panel collapses to the button so the results are visible:
  at once for Builder, Saved, date and range filters, and when the pointer leaves the panel
  for value bars (so you can pick several values first).
- Clicking anywhere on the page outside the panel also collapses it (the click still reaches Odoo).
- 📌 in the header keeps the panel open instead (no auto-collapse, no collapse on outside clicks); **–** collapses it; **Esc** collapses it from
  the keyboard; **×** removes OoFind from the page until you open it again.

## Features

**Filters**: one click per value, no typing.
- Value bars with record counts for status, selection, relational, tag and boolean fields.
  Counts are faceted: each field's counts ignore that field's own filter, so you can see what
  picking another value would give.
- Date fields: presets (today, this week, last month, this quarter, …), custom ranges, and a
  month histogram where clicking a bar filters that month.
- Numbers: min/max with the current range and quick buckets.
- The most useful fields are picked automatically; pin any other field with ☆.

**Builder**: visual AND/OR condition tree, kept in sync with an editable Python domain.
- Field paths through relations (Customer › Country), record pickers, type-aware operators.
- Live total count, plus a count for each condition on its own.
- *Add as filter* or *Replace search*; copy as Python, JSON, or (19.5+) a shareable link.

**Explain**: why is this record (not) in my results?
- Pick a record by name, by id, from a list row, or use the open form record.
- Every condition (and the menu's built-in domain) is checked **by the server** for that
  record, so computed fields, related paths and access rules are handled correctly.
- Shows ✓/✕ per condition with the record's actual values, the conditions that exclude it,
  archived records and records you can't access.

**Presets**: the menu's own search options on one page.
- *When you open this menu*: the default filters, group-bys or default favorite.
- **✕ Clear all** removes every filter and group-by; **↺ Reset to default** goes back to the
  menu's default search. Both buttons are also under *Active search* on the Filters tab.
- The menu's predefined filters (with date periods: Today, This week, October, Q3, 2026…) and
  group-bys (with intervals for dates) as one-click toggles, the current grouping, and
  *Add a custom group* on any groupable field.

**Saved**: save the current search as a regular Odoo favorite (private, shared or default),
re-apply or edit favorites, and keep a history of recent OoFind filters.

Everything OoFind applies becomes a native Odoo facet in the search bar. You can remove it there,
save it in favorites, and keep it through breadcrumbs.

## How it works

- `src/background.js` injects two scripts on demand (`activeTab`: no standing access to any site).
- `src/page/bridge.js` runs in the page's own JS world and talks to the web client's live
  `SearchModel` (`createNewFilters`, `deactivateGroup`, `createNewFavorite`). It finds the model by
  walking the Owl component tree from `odoo.__WOWL_DEBUG__.root`, which works with Owl 2
  (Odoo 17.0–19.0) and Owl 3 (19.5+/20). On Odoo 17/18, grouped counts use `read_group`
  (translated to the `formatted_read_group` shape that 19+ provides).
- `src/content/oofind.js` is the panel (shadow DOM, isolated world). Data comes from
  `/web/dataset/call_kw` with the page's session: `fields_get`, `formatted_read_group`,
  `search_count`, `name_search`, `read`. It never writes business data; the only write is
  creating an `ir.filters` favorite when you ask for it.
- `src/shared/domain.js` holds the pure domain logic: parsing and printing Python domains,
  tree conversion, operators, date presets, field ranking and explanation.

## Development

```sh
python3 tools/run_tests.py                       # unit tests (headless Chrome)
python3 tests/e2e.py --url http://127.0.0.1:8069 --db <db with Sales + demo data>
python3 tests/e2e.py --browser firefox --url … --db …   # same suite in headless Firefox (WebDriver BiDi)
python3 tools/build.py                           # dist/chrome, dist/firefox + store zips
python3 tools/make_icons.py                      # regenerate icons (Pillow)
python3 tools/make_store_images.py               # store promo tiles (Pillow)
python3 tests/e2e.py … --size 1280x800 --screenshot store/screenshots/s   # store screenshots
```

Load `dist/chrome` with *chrome://extensions → Load unpacked*, or `dist/firefox` with
*about:debugging → Load Temporary Add-on*. The root folder also loads unpacked as-is.

Requires Chrome 95+ or Firefox 128+ (`scripting.executeScript` with `world: "MAIN"`).

## Publishing

Listing texts, permission justifications, reviewer notes, screenshots and promo tiles for the
Chrome Web Store and Firefox Add-ons are in [`store/`](store/LISTING.md).

## License

MIT, see [LICENSE](LICENSE). OoFind is an independent project, not affiliated with Odoo S.A. "Odoo" is a trademark of Odoo S.A.
