/* OoFind panel styles, injected into the panel's shadow root so the host page can't touch them. */
globalThis.OOFIND_CSS = `
:host {
  all: initial;
  --accent: #714b67;
  --accent-2: #8f6a86;
  --accent-soft: #f3edf2;
  --accent-fg: #fff;
  --teal: #017e84;
  --teal-soft: #e3f3f3;
  --bg: #ffffff;
  --bg-2: #f7f6f9;
  --bg-3: #eceaf0;
  --fg: #1f1d24;
  --fg-2: #5d5a66;
  --fg-3: #8b8894;
  --border: #dedbe4;
  --bar: #c9b5c4;
  --bar-on: #714b67;
  --ok: #1a7f37;
  --ok-bg: #e6f4ea;
  --bad: #c0392b;
  --bad-bg: #fdecea;
  --warn: #9a6700;
  --warn-bg: #fff4d6;
  --shadow: -8px 0 32px rgba(20, 10, 30, .16), -1px 0 4px rgba(20, 10, 30, .08);
  --mono: ui-monospace, "SFMono-Regular", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif;
}
:host([data-theme="dark"]) {
  --accent: #b88aac;
  --accent-2: #c9a3bf;
  --accent-soft: #3a2c37;
  --accent-fg: #1b1420;
  --teal: #4fc3c8;
  --teal-soft: #173638;
  --bg: #1c1b21;
  --bg-2: #24232a;
  --bg-3: #2f2e36;
  --fg: #ebe9f0;
  --fg-2: #b4b1bd;
  --fg-3: #85828e;
  --border: #3a3842;
  --bar: #5a4655;
  --bar-on: #c9a3bf;
  --ok: #56d364;
  --ok-bg: #16301d;
  --bad: #ff7b72;
  --bad-bg: #3a1d1d;
  --warn: #e3b341;
  --warn-bg: #3a2f12;
  --shadow: -8px 0 32px rgba(0, 0, 0, .5), -1px 0 4px rgba(0, 0, 0, .4);
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 2147483646;
  width: 420px;
  min-width: 320px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--fg);
  font: 13px/1.45 var(--sans);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow);
}
.panel { animation: slide-in .16s ease-out; }
@keyframes slide-in { from { transform: translateX(24px); opacity: 0; } }
@keyframes pop-in { from { transform: scale(.6); opacity: 0; } }
.fab {
  all: unset;
  position: fixed;
  z-index: 2147483646;
  right: 20px;
  bottom: 96px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--accent);
  color: var(--accent-fg);
  box-shadow: 0 6px 18px rgba(20, 10, 30, .28), 0 1px 4px rgba(20, 10, 30, .18);
  cursor: pointer;
  touch-action: none;
  animation: pop-in .16s ease-out;
  transition: transform .12s, background .12s;
}
.fab:hover { background: var(--accent-2); transform: scale(1.06); }
.fab:focus-visible { outline: 3px solid var(--teal); outline-offset: 2px; }
.fab.drag { cursor: grabbing; transform: scale(1.1); transition: none; }
.fab-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 10px;
  background: var(--teal);
  color: #fff;
  border: 2px solid var(--bg);
  font: 700 11px/16px var(--sans);
  text-align: center;
}
header button.on { background: rgba(255, 255, 255, .26); }
header button[data-act="keep"] { font-size: 13px; opacity: .55; }
header button[data-act="keep"].on { opacity: 1; }
.grip {
  position: absolute;
  left: -4px;
  top: 0;
  bottom: 0;
  width: 8px;
  cursor: ew-resize;
}
.grip:hover, .grip.on { background: linear-gradient(90deg, transparent 3px, var(--accent) 3px, var(--accent) 5px, transparent 5px); }
header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 8px 14px;
  background: var(--accent);
  color: var(--accent-fg);
  flex: none;
}
.logo { font-weight: 700; font-size: 14px; letter-spacing: .2px; }
.logo b { font-weight: 800; opacity: .75; }
.where { flex: 1; min-width: 0; font-size: 11.5px; opacity: .92; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
header button {
  all: unset;
  cursor: pointer;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  font-size: 15px;
  line-height: 1;
}
header button:hover { background: rgba(255, 255, 255, .18); }
header button:focus-visible { outline: 2px solid currentColor; }
nav.tabs { display: flex; gap: 2px; padding: 6px 8px 0; border-bottom: 1px solid var(--border); background: var(--bg-2); flex: none; }
nav.tabs button {
  all: unset;
  cursor: pointer;
  padding: 7px 12px 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--fg-2);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
nav.tabs button:hover { color: var(--fg); }
nav.tabs button.active { color: var(--accent); border-bottom-color: var(--accent); }
nav.tabs button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.body { flex: 1; min-height: 0; overflow: auto; padding: 12px 14px 24px; }
.status {
  flex: none;
  padding: 6px 14px;
  font-size: 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-2);
  color: var(--fg-2);
  min-height: 30px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.status.err { color: var(--bad); background: var(--bad-bg); }
.status.ok { color: var(--ok); }
.status .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { padding: 32px 12px; text-align: center; color: var(--fg-2); }
.empty b { display: block; color: var(--fg); font-size: 14px; margin-bottom: 6px; }
h3 { margin: 14px 0 8px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--fg-3); display: flex; align-items: center; gap: 8px; }
h3:first-child { margin-top: 0; }
h3 .count { margin-left: auto; letter-spacing: 0; text-transform: none; font-weight: 600; font-size: 12px; color: var(--fg-2); }
.muted { color: var(--fg-3); }
.small { font-size: 11.5px; }
code, .mono { font-family: var(--mono); font-size: 12px; }

/* buttons & inputs */
.btn {
  all: unset;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--fg);
  font: 600 12px/1.3 var(--sans);
  white-space: nowrap;
}
.btn:hover { background: var(--bg-3); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.btn.primary:hover { background: var(--accent-2); }
.btn.ghost { border-color: transparent; background: transparent; color: var(--fg-2); }
.btn.ghost:hover { background: var(--bg-3); color: var(--fg); }
.btn.sm { padding: 3px 7px; font-size: 11.5px; }
.btn[disabled] { opacity: .45; pointer-events: none; }
.row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.row.end { justify-content: flex-end; }
.row.tight { gap: 4px; }
.spacer { flex: 1; }
input, select, textarea {
  font: 12.5px/1.4 var(--sans);
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 8px;
  min-width: 0;
  outline: none;
}
input:focus, select:focus, textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
input[type="checkbox"] { accent-color: var(--accent); padding: 0; }
input.grow, select.grow { flex: 1; }
input[type="number"] { width: 110px; }
input[type="date"] { width: 140px; }
textarea.code {
  display: block;
  width: 100%;
  min-height: 90px;
  font: 12px/1.5 var(--mono);
  resize: vertical;
  white-space: pre;
}
textarea.code.bad { border-color: var(--bad); }
.err-text { color: var(--bad); font-size: 12px; margin-top: 4px; }

/* facets */
.facets { display: flex; flex-wrap: wrap; gap: 6px; }
.facet {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 3px 4px 3px 9px;
  border-radius: 14px;
  background: var(--bg-3);
  font-size: 12px;
}
.facet.mine { background: var(--accent-soft); color: var(--accent); }
.facet.group { background: var(--teal-soft); color: var(--teal); }
.facet span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.facet button { all: unset; cursor: pointer; width: 18px; height: 18px; display: grid; place-items: center; border-radius: 50%; font-size: 13px; opacity: .7; }
.facet button:hover { opacity: 1; background: rgba(0, 0, 0, .08); }

/* field cards */
.card { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; background: var(--bg); }
.card.on { border-color: var(--accent); }
.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  user-select: none;
  border-radius: 8px;
}
.card-head:hover { background: var(--bg-2); }
.card-head:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.card-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card-sum { flex: 1; min-width: 0; color: var(--accent); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right; }
.card-sum.none { color: var(--fg-3); }
.badge { font-size: 10px; font-weight: 700; letter-spacing: .03em; color: var(--fg-3); background: var(--bg-3); border-radius: 4px; padding: 1px 5px; text-transform: uppercase; flex: none; }
.chev { color: var(--fg-3); font-size: 11px; transition: transform .15s; flex: none; }
.card.open .chev { transform: rotate(90deg); }
.card-body { padding: 4px 10px 10px; border-top: 1px solid var(--border); }
.pin { all: unset; cursor: pointer; color: var(--fg-3); font-size: 13px; flex: none; }
.pin.on { color: var(--warn); }
.pin:hover { color: var(--fg); }

/* value bars */
.vals { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
.val {
  all: unset;
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 5px;
  cursor: pointer;
  overflow: hidden;
  font-size: 12.5px;
}
.val .fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--bar); opacity: .28; border-radius: 5px; pointer-events: none; }
.val.on .fill { background: var(--bar-on); opacity: .22; }
.val:hover { background: var(--bg-2); }
.val:focus-visible { outline: 2px solid var(--accent); }
.val .box { position: relative; width: 14px; height: 14px; border: 1.5px solid var(--fg-3); border-radius: 3px; flex: none; display: grid; place-items: center; font-size: 10px; color: var(--accent-fg); }
.val.on .box { background: var(--accent); border-color: var(--accent); }
.val .lbl { position: relative; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.val .num { position: relative; font-variant-numeric: tabular-nums; color: var(--fg-2); font-size: 12px; }
.val.zero .lbl, .val.zero .num { color: var(--fg-3); }

/* presets */
.chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.chip {
  all: unset;
  cursor: pointer;
  padding: 3px 9px;
  border-radius: 12px;
  border: 1px solid var(--border);
  font-size: 12px;
  color: var(--fg-2);
}
.chip:hover { border-color: var(--accent); color: var(--fg); }
.chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

/* histogram */
.hist { display: flex; align-items: flex-end; gap: 3px; height: 64px; margin-top: 10px; padding-bottom: 2px; border-bottom: 1px solid var(--border); }
.hist button { all: unset; cursor: pointer; flex: 1; min-width: 6px; background: var(--bar); border-radius: 3px 3px 0 0; position: relative; }
.hist button:hover { background: var(--accent-2); }
.hist button.on { background: var(--bar-on); }
.hist button:focus-visible { outline: 2px solid var(--accent); }
.hist-labels { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--fg-3); margin-top: 3px; }

/* builder */
.group { border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 6px; padding: 6px 8px 8px; margin: 6px 0; background: var(--bg); }
.group.any { border-left-color: var(--teal); }
.group .group { background: var(--bg-2); }
.group-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size: 12px; color: var(--fg-2); }
.group-head select { padding: 2px 6px; font-weight: 600; }
.cond { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; padding: 5px 0; border-bottom: 1px dashed var(--border); }
.cond:last-of-type { border-bottom: 0; }
.cond.raw .path { color: var(--warn); }
.path {
  all: unset;
  cursor: pointer;
  max-width: 100%;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  font-weight: 600;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.path:hover { border-color: var(--accent); }
.path.unset { color: var(--fg-3); font-weight: 500; }
.cnt { margin-left: auto; font-size: 11px; color: var(--fg-3); font-variant-numeric: tabular-nums; }
.x { all: unset; cursor: pointer; color: var(--fg-3); width: 20px; height: 20px; display: grid; place-items: center; border-radius: 4px; }
.x:hover { color: var(--bad); background: var(--bad-bg); }
.tags { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; flex: 1; min-width: 140px; }
.tag { display: inline-flex; align-items: center; gap: 2px; background: var(--accent-soft); color: var(--accent); padding: 1px 3px 1px 7px; border-radius: 10px; font-size: 12px; }
.tag button { all: unset; cursor: pointer; padding: 0 3px; }
.ac { position: relative; flex: 1; min-width: 120px; }
.ac input { width: 100%; }
.ac ul {
  position: absolute;
  z-index: 5;
  left: 0;
  right: 0;
  top: calc(100% + 2px);
  margin: 0;
  padding: 3px;
  list-style: none;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, .14);
  max-height: 220px;
  overflow: auto;
}
.ac li { padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12.5px; }
.ac li:hover, .ac li.hi { background: var(--accent-soft); }
.picker { width: 100%; border: 1px solid var(--accent); border-radius: 6px; margin: 4px 0; background: var(--bg); }
.picker .crumbs { display: flex; flex-wrap: wrap; gap: 2px; align-items: center; padding: 6px 8px; font-size: 12px; border-bottom: 1px solid var(--border); }
.picker .crumbs button { all: unset; cursor: pointer; color: var(--accent); }
.picker .crumbs button:hover { text-decoration: underline; }
.picker input { margin: 6px 8px; width: calc(100% - 16px); }
.picker ul { list-style: none; margin: 0; padding: 0 4px 4px; max-height: 240px; overflow: auto; }
.picker li { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 4px; cursor: pointer; }
.picker li:hover, .picker li.hi { background: var(--accent-soft); }
.picker li .tech { color: var(--fg-3); font-family: var(--mono); font-size: 11px; margin-left: auto; }
.picker li .drill { all: unset; cursor: pointer; padding: 0 6px; color: var(--fg-3); font-weight: 700; }
.picker li .drill:hover { color: var(--accent); }
.summary { margin: 8px 0; padding: 8px 10px; border-radius: 6px; background: var(--bg-2); color: var(--fg-2); font-size: 12.5px; }
.bigcount { font-size: 20px; font-weight: 700; color: var(--fg); font-variant-numeric: tabular-nums; }

/* explain */
.verdict { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; margin: 10px 0; font-weight: 600; }
.verdict.ok { background: var(--ok-bg); color: var(--ok); }
.verdict.bad { background: var(--bad-bg); color: var(--bad); }
.verdict.warn { background: var(--warn-bg); color: var(--warn); }
.verdict .ico { font-size: 18px; }
.xtree { margin: 0; padding: 0; list-style: none; }
.xtree ul { list-style: none; margin: 0 0 0 10px; padding-left: 10px; border-left: 1px solid var(--border); }
.xnode { display: flex; gap: 8px; align-items: flex-start; padding: 4px 0; }
.xnode .mark { width: 18px; height: 18px; flex: none; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; margin-top: 1px; }
.xnode.yes .mark { background: var(--ok-bg); color: var(--ok); }
.xnode.no .mark { background: var(--bad-bg); color: var(--bad); }
.xnode.unk .mark { background: var(--bg-3); color: var(--fg-3); }
.xnode .what { flex: 1; min-width: 0; }
.xnode .actual { display: block; font-size: 11.5px; color: var(--fg-2); }
.xnode.no > .what > .txt { color: var(--bad); font-weight: 600; }
.xnode.group-node .txt { font-weight: 700; font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--fg-3); }
.causes { margin: 6px 0 0; padding-left: 18px; }
.causes li { margin: 3px 0; }
.note { padding: 8px 10px; border-radius: 6px; background: var(--warn-bg); color: var(--warn); font-size: 12px; margin: 8px 0; }

.pick-overlay { position: fixed; inset: 0; z-index: 2147483645; cursor: crosshair; background: rgba(113, 75, 103, .04); }
.pick-hl { position: fixed; pointer-events: none; outline: 2px solid var(--accent); background: rgba(113, 75, 103, .10); border-radius: 3px; }

/* presets */
.presets { display: flex; flex-wrap: wrap; gap: 6px; align-items: flex-start; }
.presets .sep { flex-basis: 100%; height: 0; border-top: 1px dashed var(--border); margin: 2px 0; }
.preset-opt { flex-basis: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; }
.preset-opt.on { border-color: var(--accent); }
.preset-name { font-weight: 600; font-size: 12.5px; }
.dflt { color: var(--warn); margin-right: 4px; }
.chip .dflt { margin-right: 3px; }
.chip.on .dflt { color: inherit; }

/* saved */
.list { display: flex; flex-direction: column; gap: 4px; }
.item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border); }
.item:hover { border-color: var(--accent); }
.item .main { flex: 1; min-width: 0; cursor: pointer; }
.item .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item .sub { font-size: 11.5px; color: var(--fg-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.form { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 8px; background: var(--bg-2); }
label.check { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; cursor: pointer; }
.spin { display: inline-block; width: 12px; height: 12px; border: 2px solid var(--fg-3); border-right-color: transparent; border-radius: 50%; animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation-duration: 2s; } .chev, .fab { transition: none; } .panel, .fab { animation: none; } }
`;
