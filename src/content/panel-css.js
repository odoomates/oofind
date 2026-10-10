/* OoFind panel styles, injected into the panel's shadow root so the host page can't touch them.
 * Colours and font are read from the Odoo page at runtime (readTheme in oofind.js) and set as
 * custom properties on the host; the values below are fallbacks. */
globalThis.OOFIND_CSS = `
:host {
  all: initial;
  --accent: #714b67;
  --accent-fg: #fff;
  --accent-soft: #f1ecf0;
  --accent-line: #c9b5c4;
  --link: #017e84;
  --bg: #ffffff;
  --bg-2: #f8f9fa;
  --bg-3: #eef0f2;
  --fg: #212529;
  --fg-2: #5b6168;
  --fg-3: #8a9097;
  --border: #dee2e6;
  --meter: #d6dadf;
  --ok: #1a7f37;
  --ok-bg: #e6f4ea;
  --bad: #c0392b;
  --bad-bg: #fdecea;
  --warn: #9a6700;
  --warn-bg: #fff4d6;
  --shadow: -4px 0 18px rgba(20, 20, 30, .10);
  --font: system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, "Noto Sans", sans-serif;
  --font-size: 13px;
  --mono: ui-monospace, "SFMono-Regular", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --radius: 6px;
}
:host([data-theme="dark"]) {
  --accent: #b88aac;
  --accent-fg: #1b1420;
  --accent-soft: #3a2c37;
  --accent-line: #6a5064;
  --link: #4fc3c8;
  --bg: #1f2024;
  --bg-2: #26272c;
  --bg-3: #303137;
  --fg: #e6e6ea;
  --fg-2: #b2b3bb;
  --fg-3: #85868f;
  --border: #3b3c43;
  --meter: #474852;
  --ok: #56d364;
  --ok-bg: #16301d;
  --bad: #ff7b72;
  --bad-bg: #3a1d1d;
  --warn: #e3b341;
  --warn-bg: #3a2f12;
  --shadow: -4px 0 18px rgba(0, 0, 0, .45);
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
svg.i { width: 16px; height: 16px; flex: none; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; vertical-align: -3px; }
svg.i.fill { fill: currentColor; }
svg.i.sm { width: 14px; height: 14px; }

/* ---------- panel shell ---------- */
.panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 2147483646;
  width: 360px;
  min-width: 300px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--fg);
  font: var(--font-size)/1.45 var(--font);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow);
  container-type: inline-size;
  animation: slide-in .16s ease-out;
}
.panel.push { box-shadow: none; }
@keyframes slide-in { from { transform: translateX(16px); opacity: 0; } }
@keyframes pop-in { from { transform: scale(.6); opacity: 0; } }
.grip { position: absolute; left: -4px; top: 0; bottom: 0; width: 8px; cursor: ew-resize; z-index: 2; }
.grip:hover, .grip.on { background: linear-gradient(90deg, transparent 3px, var(--accent) 3px, var(--accent) 5px, transparent 5px); }

header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 6px 8px 14px;
  border-bottom: 1px solid var(--border);
  flex: none;
  min-height: 46px;
}
.logo { font-weight: 800; font-size: 15px; letter-spacing: .1px; color: var(--accent); margin-right: 6px; }
.logo b { font-weight: 800; color: var(--fg); }
.where { flex: 1; min-width: 0; font-weight: 600; color: var(--fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hbtn {
  all: unset;
  cursor: pointer;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: var(--radius);
  color: var(--fg-2);
}
.hbtn:hover { background: var(--bg-3); color: var(--fg); }
.hbtn:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.hbtn.on { color: var(--accent); background: var(--accent-soft); }

/* settings menu */
.menu { position: absolute; top: 44px; right: 8px; z-index: 6; min-width: 230px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, .14); padding: 6px; }
.menu .mh { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--fg-3); padding: 6px 8px 4px; }
.menu button { all: unset; cursor: pointer; display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border-radius: 5px; box-sizing: border-box; }
.menu button:hover, .menu button:focus-visible { background: var(--bg-3); }
.menu button .tick { width: 16px; color: var(--accent); }
.menu .about { padding: 6px 8px; font-size: 11.5px; color: var(--fg-3); border-top: 1px solid var(--border); margin-top: 4px; }

/* tabs */
nav.tabs { display: flex; gap: 0; padding: 0 6px; border-bottom: 1px solid var(--border); flex: none; overflow-x: auto; scrollbar-width: none; }
nav.tabs button {
  all: unset;
  cursor: pointer;
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 9px 8px 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--fg-2);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  white-space: nowrap;
}
nav.tabs button:hover { color: var(--fg); }
nav.tabs button.active { color: var(--accent); border-bottom-color: var(--accent); }
nav.tabs button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
nav.tabs .tbadge { min-width: 17px; height: 17px; padding: 0 5px; border-radius: 9px; background: var(--accent); color: var(--accent-fg); font-size: 10.5px; line-height: 17px; text-align: center; }
@container (max-width: 380px) {
  nav.tabs button { padding: 9px 6px 8px; }
  nav.tabs button .tl { display: none; }
  nav.tabs button.active .tl { display: inline; }
}

.body { flex: 1; min-height: 0; overflow: auto; padding: 12px 14px 56px; }

/* toast (status) */
.status {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 5;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12.5px;
  background: var(--fg);
  color: var(--bg);
  box-shadow: 0 6px 18px rgba(0, 0, 0, .18);
  animation: pop-up .14s ease-out;
}
@keyframes pop-up { from { transform: translateY(6px); opacity: 0; } }
.status.empty-toast { display: none; }
.status.err { background: var(--bad-bg); color: var(--bad); border: 1px solid var(--bad); }
.status .grow { flex: 1; min-width: 0; }
.status button { all: unset; cursor: pointer; opacity: .7; }
.status button:hover { opacity: 1; }

.empty { padding: 28px 12px; text-align: center; color: var(--fg-2); }
.empty b { display: block; color: var(--fg); font-size: 14px; margin-bottom: 6px; }
h3 { margin: 16px 0 8px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--fg-3); display: flex; align-items: center; gap: 8px; }
h3:first-child { margin-top: 0; }
h3 .count { margin-left: auto; letter-spacing: 0; text-transform: none; font-weight: 600; font-size: 12px; color: var(--fg-2); }
.muted { color: var(--fg-3); }
.small { font-size: 11.5px; }
code, .mono { font-family: var(--mono); font-size: 12px; }

/* ---------- controls ---------- */
.btn {
  all: unset;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--fg);
  font: 600 12.5px/1.3 var(--font);
  white-space: nowrap;
}
.btn:hover { background: var(--bg-3); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.btn.primary:hover { filter: brightness(1.08); }
.btn.ghost { border-color: transparent; background: transparent; color: var(--fg-2); }
.btn.ghost:hover { background: var(--bg-3); color: var(--fg); }
.btn.link { border-color: transparent; background: transparent; color: var(--link); padding: 3px 4px; }
.btn.link:hover { text-decoration: underline; background: transparent; }
.btn.sm { padding: 3px 8px; font-size: 12px; }
.btn[disabled] { opacity: .45; pointer-events: none; }
.row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.row.end { justify-content: flex-end; }
.row.tight { gap: 4px; }
.spacer { flex: 1; }
input, select, textarea {
  font: 12.5px/1.4 var(--font);
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 5px 8px;
  min-width: 0;
  outline: none;
}
input:focus, select:focus, textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
input[type="checkbox"], input[type="radio"] { accent-color: var(--accent); padding: 0; }
input.grow, select.grow { flex: 1; }
input[type="number"] { width: 100px; }
input[type="date"] { width: 140px; }
textarea.code { display: block; width: 100%; min-height: 84px; font: 12px/1.5 var(--mono); resize: vertical; white-space: pre; }
textarea.code.bad { border-color: var(--bad); }
.err-text { color: var(--bad); font-size: 12px; margin-top: 4px; }
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.seg button { all: unset; cursor: pointer; padding: 4px 10px; font-size: 12px; color: var(--fg-2); }
.seg button + button { border-left: 1px solid var(--border); }
.seg button.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.seg button[disabled] { opacity: .45; cursor: default; }
.seg button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

/* loading placeholders */
.skel { display: flex; flex-direction: column; gap: 7px; padding: 6px 0; }
.skel i { display: block; height: 10px; border-radius: 5px; background: linear-gradient(90deg, var(--bg-3), var(--bg-2), var(--bg-3)); background-size: 200% 100%; animation: shimmer 1.1s linear infinite; }
.skel i:nth-child(2) { width: 78%; }
.skel i:nth-child(3) { width: 56%; }
@keyframes shimmer { to { background-position: -200% 0; } }
.spin { display: inline-block; width: 12px; height: 12px; border: 2px solid var(--fg-3); border-right-color: transparent; border-radius: 50%; animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ---------- facets (Presets: current search) ---------- */
.facets { display: flex; flex-wrap: wrap; gap: 6px; }
.facet { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 3px 4px 3px 9px; border-radius: 14px; background: var(--bg-3); font-size: 12px; }
.facet.mine { background: var(--accent-soft); color: var(--accent); }
.facet.group { color: var(--link); }
.facet span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.facet button { all: unset; cursor: pointer; width: 18px; height: 18px; display: grid; place-items: center; border-radius: 50%; opacity: .7; }
.facet button:hover { opacity: 1; background: rgba(0, 0, 0, .08); }

/* ---------- Filters tab ---------- */
.sumbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.sumbar .st { font-size: 12.5px; color: var(--fg-2); margin-right: auto; }
.sumbar .st b { color: var(--fg); }
.omni { position: relative; margin-bottom: 12px; }
.omni input { width: 100%; padding: 7px 10px 7px 32px; font-size: 13px; }
.omni .i { position: absolute; left: 10px; top: 9px; color: var(--fg-3); }
.hits { margin-bottom: 8px; }
.hit { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border-radius: var(--radius); }
.hit:hover, .hit:focus-visible { background: var(--bg-3); }
.hit .hf { color: var(--fg-3); font-size: 12px; white-space: nowrap; }
.hit .hv { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hit.on .hv { font-weight: 700; color: var(--accent); }
.hit .num { color: var(--fg-2); font-variant-numeric: tabular-nums; font-size: 12px; }

.card { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 6px; background: var(--bg); }
.card.on { border-color: var(--accent-line); }
.card-head { display: flex; align-items: center; gap: 8px; padding: 7px 8px 7px 10px; cursor: pointer; user-select: none; border-radius: 8px; }
.card-head:hover { background: var(--bg-2); }
.card-head:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.card-head .ti { color: var(--fg-3); }
.card.on .card-head .ti { color: var(--accent); }
.card-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card-sum { flex: 1; min-width: 0; color: var(--accent); font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right; }
.card-sum.none { color: var(--fg-3); font-weight: 400; }
.chev { color: var(--fg-3); transition: transform .15s; flex: none; display: grid; }
.card.open .chev { transform: rotate(90deg); }
.card-body { padding: 2px 10px 10px; }
.preview { display: flex; flex-wrap: wrap; gap: 5px; padding: 0 10px 9px 34px; }
.preview .chip { font-size: 11.5px; padding: 2px 8px; }
.preview .chip .n { color: var(--fg-3); margin-left: 4px; font-variant-numeric: tabular-nums; }
.preview .chip.on .n { color: inherit; opacity: .8; }
.pin { all: unset; cursor: pointer; color: var(--fg-3); display: grid; padding: 2px; border-radius: 4px; flex: none; opacity: 0; }
.card-head:hover .pin, .pin.on, .pin:focus-visible { opacity: 1; }
.pin.on { color: var(--warn); }
.pin:hover { color: var(--fg); background: var(--bg-3); }

/* value rows: checkbox, label, count, thin neutral meter (never looks selected) */
.vals { display: flex; flex-direction: column; gap: 1px; margin-top: 4px; }
.val { all: unset; position: relative; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 5px 6px 8px; border-radius: 5px; cursor: pointer; font-size: 12.5px; }
.val:hover { background: var(--bg-2); }
.val:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.val .fill { position: absolute; left: 29px; bottom: 3px; height: 3px; border-radius: 2px; background: var(--meter); pointer-events: none; max-width: calc(100% - 40px); }
.val.on .fill { background: var(--accent-line); }
.val .box { width: 15px; height: 15px; border: 1.5px solid var(--fg-3); border-radius: 4px; flex: none; display: grid; place-items: center; color: var(--accent-fg); }
.val.on .box { background: var(--accent); border-color: var(--accent); }
.val .box svg.i { width: 11px; height: 11px; stroke-width: 3; }
.val .lbl { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.val.on .lbl { font-weight: 700; }
.val .num { font-variant-numeric: tabular-nums; color: var(--fg-2); font-size: 12px; }
.val.zero .lbl, .val.zero .num { color: var(--fg-3); }

.chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.chip { all: unset; cursor: pointer; padding: 3px 9px; border-radius: 12px; border: 1px solid var(--border); font-size: 12px; color: var(--fg-2); background: var(--bg); }
.chip:hover { border-color: var(--accent); color: var(--fg); }
.chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.chip.more { border-style: dashed; }
.chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.hist { display: flex; align-items: flex-end; gap: 3px; height: 56px; margin-top: 10px; padding-bottom: 2px; border-bottom: 1px solid var(--border); }
.hist button { all: unset; cursor: pointer; flex: 1; min-width: 6px; background: var(--meter); border-radius: 3px 3px 0 0; }
.hist button:hover { background: var(--accent-line); }
.hist button.on { background: var(--accent); }
.hist button:focus-visible { outline: 2px solid var(--accent); }
.hist-labels { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--fg-3); margin-top: 3px; }

/* ---------- Builder ---------- */
.bhead { display: flex; align-items: baseline; gap: 6px; margin-bottom: 6px; }
.bigcount { font-size: 22px; font-weight: 700; color: var(--fg); font-variant-numeric: tabular-nums; }
.group { border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: var(--radius); padding: 6px 8px 6px; margin: 6px 0; background: var(--bg); }
.group.any { border-left-color: var(--link); }
.group .group { background: var(--bg-2); }
.group-head { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; font-size: 12px; color: var(--fg-2); }
.group-head select { padding: 2px 6px; font-weight: 600; }
.cond { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 6px; padding: 6px 0; border-bottom: 1px dashed var(--border); }
.cond-main { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; min-width: 0; }
.cond-side { display: flex; align-items: center; gap: 2px; padding-top: 4px; }
.cond.raw .path { color: var(--warn); }
.path { all: unset; cursor: pointer; max-width: 100%; padding: 4px 8px; border-radius: var(--radius); border: 1px solid var(--border); font-weight: 600; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-sizing: border-box; }
.path:hover { border-color: var(--accent); }
.path.unset { color: var(--fg-3); font-weight: 500; border-style: dashed; }
.cond select { max-width: 130px; }
.cnt { min-width: 22px; text-align: right; font-size: 11px; color: var(--fg-3); font-variant-numeric: tabular-nums; }
.x { all: unset; cursor: pointer; color: var(--fg-3); width: 22px; height: 22px; display: grid; place-items: center; border-radius: 4px; }
.x:hover { color: var(--bad); background: var(--bad-bg); }
.x:focus-visible { outline: 2px solid var(--accent); }
.tags { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; flex: 1; min-width: 120px; }
.tag { display: inline-flex; align-items: center; gap: 2px; background: var(--accent-soft); color: var(--accent); padding: 1px 3px 1px 7px; border-radius: 10px; font-size: 12px; }
.tag button { all: unset; cursor: pointer; padding: 0 3px; }
.ac { position: relative; flex: 1; min-width: 110px; }
.ac input { width: 100%; }
.ac ul { position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 2px); margin: 0; padding: 3px; list-style: none; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: 0 6px 18px rgba(0, 0, 0, .14); max-height: 220px; overflow: auto; }
.ac li { padding: 5px 8px; border-radius: 4px; cursor: pointer; font-size: 12.5px; }
.ac li:hover, .ac li.hi { background: var(--accent-soft); }
.picker { width: 100%; border: 1px solid var(--accent); border-radius: var(--radius); margin: 4px 0 6px; background: var(--bg); }
.picker .crumbs { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding: 6px 8px; font-size: 12px; border-bottom: 1px solid var(--border); }
.picker .crumbs button { all: unset; cursor: pointer; color: var(--link); }
.picker .crumbs button:hover { text-decoration: underline; }
.picker input { margin: 6px 8px; width: calc(100% - 16px); }
.picker ul { list-style: none; margin: 0; padding: 0 4px 4px; max-height: 240px; overflow: auto; }
.picker li { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 4px; cursor: pointer; }
.picker li:hover, .picker li.hi { background: var(--accent-soft); }
.picker li .tech { color: var(--fg-3); font-family: var(--mono); font-size: 11px; margin-left: auto; }
.picker li .drill { all: unset; cursor: pointer; padding: 0 4px; color: var(--fg-3); display: grid; }
.picker li .drill:hover { color: var(--accent); }
.summary { margin: 8px 0; padding: 8px 10px; border-radius: var(--radius); background: var(--bg-2); color: var(--fg-2); font-size: 12.5px; }
details.domain-box { margin-top: 10px; border: 1px solid var(--border); border-radius: var(--radius); }
details.domain-box > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 6px; padding: 6px 8px; font-size: 12px; font-weight: 600; color: var(--fg-2); }
details.domain-box > summary::-webkit-details-marker { display: none; }
details.domain-box > summary .chev { transition: transform .15s; }
details.domain-box[open] > summary .chev { transform: rotate(90deg); }
details.domain-box > .inner { padding: 0 8px 8px; }
.actions { position: sticky; bottom: -56px; display: flex; gap: 6px; flex-wrap: wrap; padding: 10px 0 4px; background: var(--bg); }

/* ---------- Explain ---------- */
.hint { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: var(--radius); background: var(--bg-2); color: var(--fg-2); font-size: 12px; margin-bottom: 10px; }
.hint .grow { flex: 1; }
.verdict { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; margin: 12px 0 6px; font-weight: 600; }
.verdict.ok { background: var(--ok-bg); color: var(--ok); }
.verdict.bad { background: var(--bad-bg); color: var(--bad); }
.verdict.warn { background: var(--warn-bg); color: var(--warn); }
.verdict .ico { display: grid; }
.xtree { margin: 0; padding: 0; list-style: none; }
.xtree ul { list-style: none; margin: 0 0 0 9px; padding-left: 10px; border-left: 1px solid var(--border); }
.xnode { display: flex; gap: 8px; align-items: flex-start; padding: 4px 6px; border-radius: 5px; }
.xnode.no:not(.group-node) { background: var(--bad-bg); box-shadow: inset 3px 0 0 var(--bad); }
.xnode .mark { width: 18px; height: 18px; flex: none; border-radius: 50%; display: grid; place-items: center; margin-top: 1px; }
.xnode .mark svg.i { width: 11px; height: 11px; stroke-width: 3; }
.xnode.yes .mark { background: var(--ok-bg); color: var(--ok); }
.xnode.no .mark { background: var(--bad); color: #fff; }
.xnode.unk .mark { background: var(--bg-3); color: var(--fg-3); }
.xnode .what { flex: 1; min-width: 0; }
.xnode .actual { display: block; font-size: 11.5px; color: var(--fg-2); }
.xnode.no > .what > .txt { color: var(--bad); font-weight: 600; }
.xnode.group-node .txt { font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--fg-3); }
.causes { margin: 6px 0 0; padding-left: 18px; }
.causes li { margin: 4px 0; }
.note { padding: 8px 10px; border-radius: var(--radius); background: var(--warn-bg); color: var(--warn); font-size: 12px; margin: 8px 0; }

/* ---------- Presets ---------- */
.presets { display: flex; flex-wrap: wrap; gap: 6px; align-items: flex-start; }
.presets .sep { flex-basis: 100%; height: 0; border-top: 1px dashed var(--border); margin: 2px 0; }
.preset-opt { flex-basis: 100%; padding: 7px 9px; border: 1px solid var(--border); border-radius: 8px; }
.preset-opt.on { border-color: var(--accent-line); }
.preset-name { font-weight: 600; font-size: 12.5px; }
.dflt { color: var(--warn); margin-right: 4px; }
.chip.on .dflt { color: inherit; }
.gbrow { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.gb { display: inline-flex; align-items: center; gap: 2px; padding: 2px 3px 2px 9px; border-radius: 14px; background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 600; }
.gb button { all: unset; cursor: pointer; display: grid; padding: 2px; border-radius: 50%; opacity: .75; }
.gb button:hover { opacity: 1; background: rgba(0, 0, 0, .08); }
.gb button[disabled] { opacity: .25; pointer-events: none; }
.gbsep { color: var(--fg-3); }

/* ---------- Saved ---------- */
.list { display: flex; flex-direction: column; gap: 4px; }
.item { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-radius: var(--radius); border: 1px solid var(--border); }
.item:hover { border-color: var(--accent-line); }
.item .main { flex: 1; min-width: 0; cursor: pointer; }
.item .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item .sub { font-size: 11.5px; color: var(--fg-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.form { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 8px; background: var(--bg-2); }
label.check { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; cursor: pointer; }

/* ---------- floating button, row picking ---------- */
.fab {
  all: unset;
  position: fixed;
  z-index: 2147483646;
  right: 20px;
  bottom: 96px;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--accent);
  color: var(--accent-fg);
  box-shadow: 0 6px 18px rgba(20, 10, 30, .28), 0 1px 4px rgba(20, 10, 30, .18);
  cursor: pointer;
  touch-action: none;
  animation: pop-in .16s ease-out;
  transition: transform .12s;
}
.fab:hover { transform: scale(1.06); }
.fab:focus-visible { outline: 3px solid var(--link); outline-offset: 2px; }
.fab.drag { cursor: grabbing; transform: scale(1.1); transition: none; }
.fab svg.i { width: 21px; height: 21px; }
.fab-badge { position: absolute; top: -3px; right: -3px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px; background: var(--link); color: #fff; border: 2px solid var(--bg); font: 700 11px/16px var(--font); text-align: center; }
.pick-overlay { position: fixed; inset: 0; z-index: 2147483645; cursor: crosshair; background: rgba(0, 0, 0, .03); }
.pick-hl { position: fixed; pointer-events: none; outline: 2px solid var(--accent); background: var(--accent-soft); opacity: .55; border-radius: 3px; }

@media (prefers-reduced-motion: reduce) {
  .panel, .fab, .status { animation: none; }
  .chev, .fab, details.domain-box > summary .chev { transition: none; }
  .skel i, .spin { animation-duration: 3s; }
}
`;
