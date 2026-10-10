/* OoFind: visual search panel for Odoo 17+.
 *
 * Injected on demand (toolbar button / Alt+Shift+F) into the active tab. Draws
 * a docked panel in a shadow root. Data comes from the page's own Odoo session
 * (`/web/dataset/call_kw`), so everything runs as the logged-in user with their
 * access rights. Filters are applied through the page bridge (src/page/bridge.js)
 * and become native Odoo search facets. Running it again toggles the panel.
 */
(() => {
  "use strict";

  if (globalThis.__oofind) {
    globalThis.__oofind.toggle();
    return;
  }

  const api = globalThis.browser || globalThis.chrome;
  const D = globalThis.OofindDomain;

  const K = { width: "oofind.width", pins: "oofind.pins", history: "oofind.history", tab: "oofind.tab", fab: "oofind.fab", keepOpen: "oofind.keepOpen" };
  const HISTORY_MAX = 50;
  const VALUE_LIMIT = 12;
  const EXPLAIN_MAX_NODES = 80;

  // Firefox content scripts must use content.fetch to send the page's cookies/origin.
  /* global content */
  const pageFetch =
    typeof content !== "undefined" && content && typeof content.fetch === "function"
      ? content.fetch.bind(content)
      : window.fetch.bind(window);

  // ---------------------------------------------------------------------------
  // storage helpers (never let a storage failure break the panel)
  const store = {
    async get(key, fallback) {
      try {
        const out = await api.storage.local.get(key);
        return out[key] === undefined ? fallback : out[key];
      } catch {
        return fallback;
      }
    },
    async set(key, value) {
      try {
        await api.storage.local.set({ [key]: value });
      } catch {
        /* ignore */
      }
    },
  };

  // ---------------------------------------------------------------------------
  // RPC (page session)
  class RpcError extends Error {
    constructor(title, message, extra = {}) {
      super(message || title);
      this.title = title;
      Object.assign(this, extra);
    }
  }

  let rpcSeq = 0;
  async function rpc(route, params) {
    let res;
    try {
      res = await pageFetch(new URL(route, location.origin).href, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "call", id: ++rpcSeq, params }),
      });
    } catch (e) {
      throw new RpcError("Network error", String((e && e.message) || e));
    }
    let data;
    try {
      data = await res.json();
    } catch {
      throw new RpcError(`HTTP ${res.status}`, "The server didn't answer with JSON.");
    }
    if (data.error) {
      const d = data.error.data || {};
      const expired = data.error.code === 100 || /SessionExpired/.test(d.name || "");
      throw new RpcError(expired ? "Session expired" : (d.name || "").split(".").pop() || "Server error",
        expired ? "Log in to Odoo in this tab and try again." : d.message || data.error.message, { expired });
    }
    return data.result;
  }

  function cleanContext(ctx) {
    const out = { ...(ctx || {}) };
    for (const k of Object.keys(out)) if (/^(group_by|orderedBy|search_default_|default_)/.test(k)) delete out[k];
    return out;
  }

  function orm(model, method, args = [], kwargs = {}) {
    const context = { ...cleanContext(state.ctx && state.ctx.context), ...(kwargs.context || {}) };
    return rpc(`/web/dataset/call_kw/${model}/${method}`, { model, method, args, kwargs: { ...kwargs, context } });
  }

  /**
   * Grouped counts and aggregates, in the shape of Odoo 19's formatted_read_group:
   * rows with `group` values ([raw, label] for relations and dates), `__count`, `field:agg`
   * keys and `__extra_domain` (the group's own condition). Odoo 17/18 only have read_group,
   * so its results are translated: aliases for aggregates, __range for date groups.
   */
  async function readGroup(model, domain, { groupby = [], aggregates = ["__count"], order = null, limit = null } = {}) {
    if (state.major === null || state.major >= 19) {
      return orm(model, "formatted_read_group", [domain], { groupby, aggregates, order, limit });
    }
    const alias = {};
    const fields = ["__count"];
    for (const a of aggregates) {
      if (a === "__count") continue;
      const [f, fn] = a.split(":");
      const key = `oo_${f}_${fn}`;
      alias[key] = a;
      fields.push(`${key}:${fn}(${f})`);
    }
    const orderby = order ? order.replace(/(\w+):\w+/g, "$1") : false;
    const rows = await orm(model, "read_group", [domain, fields, groupby], { lazy: false, orderby, limit: limit || null });
    const fieldsOfModel = await fieldsOf(model);
    return rows.map((row) => {
      const out = { __count: row.__count };
      for (const [key, a] of Object.entries(alias)) out[a] = row[key];
      const extra = [];
      for (const gb of groupby) {
        const [fname, granularity] = gb.split(":");
        let value = row[gb];
        if (granularity || (fieldsOfModel[fname] && D.DATES.has(fieldsOfModel[fname].type))) {
          const range = row.__range && row.__range[gb];
          if (range) {
            extra.push([[fname, ">=", range.from], [fname, "<", range.to]]);
            value = [range.from, value];
          } else {
            extra.push([[fname, "=", false]]);
            value = false;
          }
        } else {
          const raw = Array.isArray(value) ? value[0] : value;
          extra.push([[fname, "=", raw === undefined ? false : raw]]);
        }
        out[gb] = value;
      }
      out.__extra_domain = D.andDomains(...extra);
      return out;
    });
  }

  // ---------------------------------------------------------------------------
  // page bridge
  let bridgeSeq = 0;
  const pending = new Map();
  document.addEventListener("oofind:res", (ev) => {
    let r;
    try {
      r = JSON.parse(ev.detail);
    } catch {
      return;
    }
    const p = pending.get(r.id);
    if (!p) return;
    pending.delete(r.id);
    if (r.ok) p.resolve(r.result);
    else p.reject(new Error(r.error));
  });

  function bridge(cmd, args = {}) {
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}-${++bridgeSeq}`;
      pending.set(id, { resolve, reject });
      document.dispatchEvent(new CustomEvent("oofind:req", { detail: JSON.stringify({ id, cmd, args }) }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error("The page didn't answer. Reload the Odoo tab and open OoFind again."));
        }
      }, 8000);
    });
  }

  document.addEventListener("oofind:changed", () => scheduleRefresh());

  // ---------------------------------------------------------------------------
  // state
  const state = {
    mode: "expanded", // "expanded" (panel) | "collapsed" (floating button) | "hidden"
    keepOpen: false, // when false, the panel collapses to the button after a filter is applied
    collapseOnLeave: false,
    tab: "filters",
    ctx: null, // bridge context
    session: null,
    fields: {}, // model -> fields_get
    names: {}, // "model,id" -> display name
    total: null,
    expanded: null, // field name open in the Filters tab
    sel: {}, // "model|field" -> selection
    valueCache: new Map(), // key -> groups
    pins: {}, // model -> [field]
    moreOpen: false,
    builder: null, // {model, root, text, textErr}
    picker: null, // {cond, trail:[{model,label,path}], q}
    explain: { resId: null, label: "", source: "search", result: null, picking: false, running: false },
    history: [],
    favorites: null,
    busy: 0,
    major: null, // Odoo major version (17, 18, 19…)
  };

  // ---------------------------------------------------------------------------
  // DOM helpers
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "style") el.style.cssText = v;
        else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
        else if (k === "value") el.value = v;
        else if (k === "checked") el.checked = !!v;
        else if (k === "dataset") Object.assign(el.dataset, v);
        else el.setAttribute(k, v === true ? "" : v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const fmtNum = (n) => (typeof n === "number" ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "–");

  function debounce(fn, ms) {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }

  // ---------------------------------------------------------------------------
  // skeleton
  const host = document.createElement("oofind-root");
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483646; top: 0; left: 0; width: 0; height: 0;";
  const shadow = host.attachShadow({ mode: "closed" });
  const styleEl = document.createElement("style");
  styleEl.textContent = globalThis.OOFIND_CSS || "";
  shadow.append(styleEl);

  const TABS = [
    ["filters", "Filters"],
    ["builder", "Builder"],
    ["explain", "Explain"],
    ["presets", "Presets"],
    ["saved", "Saved"],
  ];

  const whereEl = h("span", { class: "where" }, "Connecting…");
  const bodyEl = h("div", { class: "body" });
  const statusText = h("span", { class: "grow" }, "");
  const statusEl = h("div", { class: "status", role: "status", "aria-live": "polite" }, statusText);
  const tabsEl = h("nav", { class: "tabs", role: "tablist" },
    TABS.map(([key, label]) => h("button", { type: "button", role: "tab", dataset: { tab: key }, onclick: () => setTab(key) }, label)));
  const grip = h("div", { class: "grip", title: "Drag to resize" });
  const keepBtn = h("button", { type: "button", "data-act": "keep", onclick: () => setKeepOpen(!state.keepOpen) }, "📌");
  // funnel icon, built with DOM calls (no HTML parsing)
  const SVG_NS = "http://www.w3.org/2000/svg";
  const funnel = document.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "22", height: "22", "aria-hidden": "true" })) funnel.setAttribute(k, v);
  const funnelPath = document.createElementNS(SVG_NS, "path");
  funnelPath.setAttribute("fill", "currentColor");
  funnelPath.setAttribute("d", "M3 4.5A1.5 1.5 0 0 1 4.5 3h15a1.5 1.5 0 0 1 1.15 2.46L14.5 12.9V19a1 1 0 0 1-.55.9l-3 1.5A1 1 0 0 1 9.5 20.5v-7.6L3.35 5.46A1.5 1.5 0 0 1 3 4.5Z");
  funnel.append(funnelPath);
  const fabBadge = h("span", { class: "fab-badge", hidden: true });
  const fab = h("button", { type: "button", class: "fab", hidden: true, "aria-label": "Open OoFind" }, funnel, fabBadge);
  const panel = h("div", { class: "panel", role: "complementary", "aria-label": "OoFind" },
    grip,
    h("header", null,
      h("span", { class: "logo" }, "Oo", h("b", null, "Find")),
      whereEl,
      h("button", { type: "button", title: "Refresh", "aria-label": "Refresh", onclick: () => refresh(true) }, "⟳"),
      keepBtn,
      h("button", { type: "button", title: "Collapse to the floating button (Alt+Shift+F)", "aria-label": "Collapse", "data-act": "collapse", onclick: (ev) => collapse(ev.detail === 0) }, "–"),
      h("button", { type: "button", title: "Close OoFind (toolbar button or Alt+Shift+F to reopen)", "aria-label": "Close", "data-act": "close", onclick: () => hide() }, "×")),
    tabsEl,
    bodyEl,
    statusEl);
  shadow.append(panel, fab);
  document.documentElement.append(host);

  function applyTheme() {
    // Follow Odoo's own theme (its dark mode is a separate asset bundle), else the OS.
    const bg = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
    let dark = matchMedia("(prefers-color-scheme: dark)").matches;
    if (bg && bg.length >= 3 && !(bg.length === 4 && Number(bg[3]) === 0)) {
      const [r, g, b] = bg.map(Number);
      dark = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45;
    }
    host.dataset.theme = dark ? "dark" : "light";
  }

  // resize by dragging the left edge
  grip.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    grip.setPointerCapture(ev.pointerId);
    grip.classList.add("on");
    const move = (e) => {
      const w = Math.min(Math.max(window.innerWidth - e.clientX, 320), window.innerWidth * 0.92);
      panel.style.width = `${w}px`;
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.classList.remove("on");
      store.set(K.width, parseInt(panel.style.width, 10));
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up, { once: true });
  });

  let statusTimer;
  function status(text, kind = "") {
    statusText.textContent = text || "";
    statusEl.className = `status ${kind}`;
    clearTimeout(statusTimer);
    if (kind === "ok") statusTimer = setTimeout(() => status(""), 4000);
  }

  function fail(e) {
    status(`${e.title ? e.title + ": " : ""}${e.message || e}`, "err");
  }

  function setTab(key) {
    if (state.tab !== key && statusEl.classList.contains("err")) status("");
    if (state.explain.picking) stopPicking();
    state.tab = key;
    store.set(K.tab, key);
    render();
  }

  // ---------------------------------------------------------------------------
  // panel <-> floating button
  function setMode(mode) {
    const was = state.mode;
    state.mode = mode;
    host.style.display = mode === "hidden" ? "none" : "";
    panel.hidden = mode !== "expanded";
    fab.hidden = mode !== "collapsed";
    state.collapseOnLeave = false;
    if (mode !== "expanded" && state.explain.picking) stopPicking();
    if ((was === "hidden") !== (mode === "hidden")) bridge("watch", { on: mode !== "hidden" }).catch(() => {});
  }

  function expand() {
    setMode("expanded");
    refresh(true);
  }

  function collapse(focusButton = false) {
    setMode("collapsed");
    updateBadge();
    // keyboard users land on the button; mouse users shouldn't get a focus ring
    if (focusButton) fab.focus({ preventScroll: true });
  }

  function hide() {
    setMode("hidden");
  }

  /** Toolbar button / shortcut: hidden or collapsed -> panel, panel -> floating button. */
  function toggle() {
    if (state.mode === "expanded") collapse();
    else expand();
  }

  function setKeepOpen(on) {
    state.keepOpen = on;
    state.collapseOnLeave = false;
    keepBtn.classList.toggle("on", on);
    keepBtn.setAttribute("aria-pressed", on ? "true" : "false");
    keepBtn.title = on ? "Keep open: on. The panel stays open after filtering." : "Keep open: off. The panel collapses after filtering.";
    keepBtn.setAttribute("aria-label", keepBtn.title);
    store.set(K.keepOpen, on);
  }

  /** After a filter is applied: collapse now, or when the pointer leaves the panel (multi-select). */
  function autoCollapse(immediate) {
    if (state.keepOpen || state.mode !== "expanded") return;
    if (immediate) collapse();
    else state.collapseOnLeave = true;
  }

  // a click anywhere on the page (outside OoFind) collapses the panel; the click still reaches Odoo
  window.addEventListener("pointerdown", (ev) => {
    if (state.mode !== "expanded" || state.keepOpen || ev.button !== 0) return;
    if (ev.composedPath().includes(host)) return;
    collapse();
  }, true);

  panel.addEventListener("pointerleave", (ev) => {
    if (!state.collapseOnLeave || ev.buttons) return;
    collapse();
  });

  async function updateBadge() {
    let n = 0;
    try {
      const ctx = state.mode === "expanded" ? state.ctx : await bridge("context");
      if (ctx && ctx.available) n = ctx.facets.filter((f) => f.type !== "groupBy").length;
    } catch {
      /* page not ready */
    }
    fabBadge.hidden = !n;
    fabBadge.textContent = String(n);
    const title = `OoFind: ${n ? `${n} filter${n === 1 ? "" : "s"} active` : "no filters"}. Click to open, drag to move (Alt+Shift+F)`;
    fab.title = title;
    fab.setAttribute("aria-label", title);
  }

  // drag the floating button anywhere; a click (no movement) opens the panel
  function placeFab(pos) {
    const size = 48;
    const right = Math.min(Math.max(pos.right, 4), window.innerWidth - size - 4);
    const bottom = Math.min(Math.max(pos.bottom, 4), window.innerHeight - size - 4);
    fab.style.right = `${right}px`;
    fab.style.bottom = `${bottom}px`;
    return { right, bottom };
  }
  let fabPos = { right: 20, bottom: 96 };
  fab.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    fab.setPointerCapture(ev.pointerId);
    const start = { x: ev.clientX, y: ev.clientY, ...fabPos };
    let dragged = false;
    const move = (e) => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!dragged && Math.hypot(dx, dy) < 5) return;
      dragged = true;
      fab.classList.add("drag");
      fabPos = placeFab({ right: start.right - dx, bottom: start.bottom - dy });
    };
    const up = () => {
      fab.removeEventListener("pointermove", move);
      fab.classList.remove("drag");
      if (dragged) store.set(K.fab, fabPos);
      else expand();
    };
    fab.addEventListener("pointermove", move);
    fab.addEventListener("pointerup", up, { once: true });
  });
  fab.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      expand();
    }
  });
  window.addEventListener("resize", () => { fabPos = placeFab(fabPos); });

  // ---------------------------------------------------------------------------
  // data loading
  async function fieldsOf(model) {
    if (!model) return {};
    if (!state.fields[model]) {
      state.fields[model] = await orm(model, "fields_get", [], {
        attributes: ["string", "type", "relation", "selection", "store", "searchable", "groupable", "help"],
      });
    }
    return state.fields[model];
  }

  async function ensureNames(model, ids) {
    const missing = [...new Set(ids)].filter((id) => typeof id === "number" && !(`${model},${id}` in state.names));
    if (!missing.length) return;
    try {
      const rows = await orm(model, "read", [missing, ["display_name"]], { context: { active_test: false } });
      for (const r of rows) state.names[`${model},${r.id}`] = r.display_name;
    } catch {
      for (const id of missing) state.names[`${model},${id}`] = `#${id}`;
    }
  }

  function versionMajor(v) {
    if (!v || !v.length) return null;
    const n = parseInt(String(v[0]).replace(/\D/g, ""), 10);
    return Number.isNaN(n) ? null : n;
  }

  let refreshing = null;
  let refreshAgain = false;
  const scheduleRefresh = debounce(() => refresh(false), 150);

  async function refresh(force) {
    if (state.mode === "hidden") return;
    if (state.mode === "collapsed") return updateBadge();
    if (refreshing) {
      refreshAgain = true;
      return refreshing;
    }
    refreshing = (async () => {
      try {
        if (!state.session) {
          try {
            state.session = await rpc("/web/session/get_session_info", {});
          } catch (e) {
            state.session = null;
            whereEl.textContent = "Not connected";
            throw e;
          }
        }
        const ctx = await bridge("context");
        state.ctx = ctx;
        const major = versionMajor(ctx.version || (state.session && state.session.server_version_info));
        state.major = major;
        if (major !== null && major < 17) {
          ctx.available = false;
          ctx.reason = `OoFind needs Odoo 17 or later (this is Odoo ${major}).`;
        }
        if (!ctx.available) {
          whereEl.textContent = state.session ? state.session.db || location.host : location.host;
          render();
          return;
        }
        // compare with the last model actually shown: Odoo briefly has no active view while it
        // re-renders, and that gap must not reset the panel
        const prevModel = state.lastModel;
        state.lastModel = ctx.resModel;
        if (prevModel !== ctx.resModel) {
          state.expanded = null;
          state.builder = null;
          state.picker = null;
          state.moreOpen = false;
          state.favorites = null;
          state.explain.result = null;
          state.explain.resId = null;
          state.explain.label = "";
        }
        if (ctx.viewType === "form" && ctx.resId && state.explain.resId !== ctx.resId && !state.explain.result) {
          state.explain.resId = ctx.resId;
          state.explain.label = "";
        }
        await fieldsOf(ctx.resModel);
        syncSelections();
        state.valueCache.clear();
        whereEl.textContent = `${ctx.displayName || ctx.resModel} · ${ctx.resModel} · ${ctx.viewType}`;
        whereEl.title = `${ctx.displayName || ""}\nModel: ${ctx.resModel}\nView: ${ctx.viewType}\nDatabase: ${(state.session && state.session.db) || ""}`;
        render();
        updateTotal();
        updateBadge();
        if (force) status("");
      } catch (e) {
        fail(e);
        render();
      }
    })();
    try {
      await refreshing;
    } finally {
      refreshing = null;
      if (refreshAgain) {
        refreshAgain = false;
        refresh(false);
      }
    }
  }

  async function updateTotal() {
    const ctx = state.ctx;
    if (!ctx || !ctx.available) return;
    try {
      state.total = await orm(ctx.resModel, "search_count", [ctx.domain]);
    } catch {
      state.total = null;
    }
    const el = bodyEl.querySelector("[data-total]");
    if (el) el.textContent = state.total === null ? "" : `${fmtNum(state.total)} record${state.total === 1 ? "" : "s"}`;
  }

  // ---------------------------------------------------------------------------
  // render
  function render() {
    applyTheme();
    for (const b of tabsEl.children) {
      const on = b.dataset.tab === state.tab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    }
    const ctx = state.ctx;
    const scroll = bodyEl.scrollTop;
    bodyEl.replaceChildren();
    if (!ctx) {
      bodyEl.append(h("div", { class: "empty" }, h("span", { class: "spin" })));
      return;
    }
    if (!ctx.available) {
      bodyEl.append(h("div", { class: "empty" }, h("b", null, "Nothing to search here"), ctx.reason || ""));
      return;
    }
    const view = { filters: renderFilters, builder: renderBuilder, explain: renderExplain, presets: renderPresets, saved: renderSaved }[state.tab];
    bodyEl.append(view());
    bodyEl.scrollTop = scroll;
  }

  // ===========================================================================
  // Filters tab: facets + field cards with value bars, presets, histograms
  // ===========================================================================
  function selKey(field) {
    return `${state.ctx.resModel}|${field}`;
  }

  function facetKey(field) {
    return `f:${field}`;
  }

  /** Drop selections whose facet was removed from Odoo's search bar. */
  function syncSelections() {
    const live = new Set(state.ctx.facets.map((f) => f.key).filter(Boolean));
    for (const k of Object.keys(state.sel)) {
      const [model, field] = k.split("|");
      if (model === state.ctx.resModel && !live.has(facetKey(field))) delete state.sel[k];
    }
  }

  function countDomain(field) {
    const ctx = state.ctx;
    return ctx.excl[facetKey(field)] || ctx.domain;
  }

  function renderFacets() {
    const ctx = state.ctx;
    const wrap = h("div", { class: "facets" });
    const facets = ctx.facets;
    if (!facets.length) wrap.append(h("span", { class: "muted small" }, "No filters: showing everything this menu shows."));
    for (const f of facets) {
      const text = (f.title ? `${f.title}: ` : "") + f.values.join(f.type === "groupBy" ? " › " : " or ");
      wrap.append(h("span", { class: `facet${f.key ? " mine" : ""}${f.type === "groupBy" ? " group" : ""}`, title: text },
        h("span", null, f.type === "groupBy" ? `☰ ${text}` : text),
        h("button", { type: "button", "aria-label": `Remove ${text}`, title: "Remove", onclick: () => removeFacet(f.groupId) }, "×")));
    }
    return wrap;
  }

  /** "Clear all" + "Reset to default", shared by the Filters and Presets tabs. */
  function resetButtons(compact) {
    const any = state.ctx.facets.length > 0;
    return h("div", { class: `row${compact ? " tight" : ""}`, style: compact ? "margin-top:8px" : "" },
      h("button", {
        type: "button", class: `btn${compact ? " sm" : ""}`, "data-act": "clear-all", disabled: !any,
        title: "Remove every filter and group-by: show all records", onclick: clearAll,
      }, "✕ Clear all"),
      h("button", {
        type: "button", class: `btn${compact ? " sm" : ""}`, "data-act": "reset",
        title: "Back to what this menu shows when you open it (its default filters, group-bys or default favorite)", onclick: resetDefaults,
      }, "↺ Reset to default"));
  }

  async function clearAll() {
    try {
      await bridge("clearAll");
      for (const k of Object.keys(state.sel)) if (k.startsWith(`${state.ctx.resModel}|`)) delete state.sel[k];
      status("All filters and group-bys removed.", "ok");
      autoCollapse(false);
    } catch (e) {
      fail(e);
    }
  }

  async function resetDefaults() {
    try {
      await bridge("resetDefaults");
      for (const k of Object.keys(state.sel)) if (k.startsWith(`${state.ctx.resModel}|`)) delete state.sel[k];
      status("Back to the menu's default search.", "ok");
      autoCollapse(false);
    } catch (e) {
      fail(e);
    }
  }

  async function removeFacet(groupId) {
    try {
      await bridge("removeFacet", { groupId });
    } catch (e) {
      fail(e);
    }
  }

  function renderFilters() {
    const ctx = state.ctx;
    const fields = state.fields[ctx.resModel] || {};
    const frag = h("div");
    frag.append(h("h3", null, "Active search", h("span", { class: "count", "data-total": "" }, state.total === null ? "" : `${fmtNum(state.total)} records`)));
    frag.append(renderFacets());
    frag.append(resetButtons(true));

    const ranked = D.rankFields(fields, ctx.searchFields);
    const pins = state.pins[ctx.resModel] || [];
    const pinned = pins.filter((n) => fields[n]);
    const auto = ranked.filter((r) => !pinned.includes(r.name)).slice(0, Math.max(0, 9 - pinned.length)).map((r) => r.name);
    const active = Object.keys(state.sel).filter((k) => k.startsWith(`${ctx.resModel}|`)).map((k) => k.split("|")[1]);
    const shown = [...new Set([...pinned, ...active, ...auto])].filter((n) => fields[n]);

    frag.append(h("h3", null, "Filter by"));
    for (const name of shown) frag.append(renderCard(name, fields[name], pinned.includes(name)));

    const rest = ranked.filter((r) => !shown.includes(r.name));
    if (rest.length) {
      if (!state.moreOpen) {
        frag.append(h("button", { type: "button", class: "btn ghost", onclick: () => { state.moreOpen = true; render(); } }, `+ More fields (${rest.length})`));
      } else {
        const list = h("ul");
        const input = h("input", { type: "search", placeholder: "Find a field…", "aria-label": "Find a field" });
        const fill = () => {
          const q = input.value.trim().toLowerCase();
          list.replaceChildren(...rest
            .filter((r) => !q || (r.field.string || "").toLowerCase().includes(q) || r.name.includes(q))
            .slice(0, 60)
            .map((r) => h("li", { onclick: () => pin(r.name, true) },
              h("span", null, r.field.string || r.name), h("span", { class: "tech" }, r.name))));
        };
        input.addEventListener("input", fill);
        fill();
        frag.append(h("div", { class: "picker" }, h("div", { class: "crumbs" }, "Add a field to this list", h("span", { class: "spacer" }),
          h("button", { type: "button", onclick: () => { state.moreOpen = false; render(); } }, "close")), input, list));
        setTimeout(() => input.focus());
      }
    }
    return frag;
  }

  async function pin(name, on) {
    const model = state.ctx.resModel;
    const list = (state.pins[model] || []).filter((n) => n !== name);
    if (on) list.push(name);
    state.pins[model] = list;
    state.moreOpen = false;
    if (on) state.expanded = name;
    await store.set(K.pins, state.pins);
    render();
  }

  const TYPE_BADGE = { many2one: "link", many2many: "tags", one2many: "list", selection: "choice", boolean: "yes/no", date: "date", datetime: "date", monetary: "amount", float: "number", integer: "number", char: "text", text: "text", html: "text" };

  function summary(name, field) {
    const s = state.sel[selKey(name)];
    if (!s) return "";
    return s.label || "";
  }

  function renderCard(name, field, pinned) {
    const open = state.expanded === name;
    const sum = summary(name, field);
    const card = h("div", { class: `card${open ? " open" : ""}${sum ? " on" : ""}` });
    const head = h("div", {
      class: "card-head", tabindex: "0", role: "button", "aria-expanded": open ? "true" : "false",
      onclick: () => { state.expanded = open ? null : name; render(); },
      onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); head.click(); } },
    },
    h("span", { class: "chev" }, "▶"),
    h("span", { class: "card-title", title: `${field.string} (${name})` }, field.string || name),
    h("span", { class: "badge" }, TYPE_BADGE[field.type] || field.type),
    h("span", { class: `card-sum${sum ? "" : " none"}` }, sum || ""),
    h("button", {
      type: "button", class: `pin${pinned ? " on" : ""}`, title: pinned ? "Unpin" : "Pin to the top for this model",
      "aria-label": pinned ? "Unpin" : "Pin", onclick: (ev) => { ev.stopPropagation(); pin(name, !pinned); },
    }, pinned ? "★" : "☆"));
    card.append(head);
    if (open) {
      const bodyDiv = h("div", { class: "card-body" });
      card.append(bodyDiv);
      fillCard(bodyDiv, name, field);
    }
    return card;
  }

  function fillCard(el, name, field) {
    const t = field.type;
    if (["selection", "many2one", "many2many", "boolean"].includes(t) || (t === "char" && field.groupable !== false)) {
      renderValues(el, name, field);
    } else if (D.DATES.has(t)) {
      renderDates(el, name, field);
    } else if (D.NUMERIC.has(t)) {
      renderRange(el, name, field);
    } else {
      renderText(el, name, field);
    }
    if (state.sel[selKey(name)]) {
      el.append(h("div", { class: "row end", style: "margin-top:8px" },
        h("button", { type: "button", class: "btn sm ghost", onclick: () => setSelection(name, null) }, "Clear")));
    }
  }

  async function groups(name, field, groupby, extra = {}) {
    const domain = countDomain(name);
    const key = JSON.stringify([state.ctx.resModel, groupby, domain, extra]);
    if (!state.valueCache.has(key)) {
      state.valueCache.set(key, readGroup(state.ctx.resModel, domain, {
        groupby: [groupby], aggregates: ["__count"], order: extra.order || "__count desc", limit: extra.limit || null,
      }));
    }
    try {
      return await state.valueCache.get(key);
    } catch (e) {
      state.valueCache.delete(key);
      throw e;
    }
  }

  function groupLabel(value, field) {
    if (value === false || value === null) return field.type === "boolean" ? "No" : "Not set";
    if (value === true) return "Yes";
    if (Array.isArray(value)) return value[1];
    if (field.type === "selection" && field.selection) {
      const hit = field.selection.find(([k]) => k === value);
      if (hit) return hit[1];
    }
    return String(value);
  }

  function groupId(value) {
    return JSON.stringify(Array.isArray(value) ? value[0] : value);
  }

  function renderValues(el, name, field) {
    const list = h("div", { class: "vals" }, h("span", { class: "spin" }));
    const relational = D.RELATIONAL.has(field.type);
    let search = null;
    if (relational || field.type === "char") {
      search = h("input", { type: "search", placeholder: `Search ${field.string}…`, "aria-label": `Search ${field.string}`, style: "width:100%;margin-top:6px" });
      el.append(search);
    }
    el.append(list);
    const sel = state.sel[selKey(name)];
    const chosen = new Map(((sel && sel.values) || []).map((v) => [v.id, v]));

    const draw = (rows, note) => {
      const max = Math.max(1, ...rows.map((r) => r.count || 0));
      list.replaceChildren(...rows.map((r) => {
        const on = chosen.has(r.id);
        const pct = r.count ? Math.max(3, Math.round((r.count / max) * 100)) : 0;
        return h("button", {
          type: "button", class: `val${on ? " on" : ""}${r.count === 0 ? " zero" : ""}`, role: "checkbox", "aria-checked": on ? "true" : "false",
          title: r.label, onclick: () => toggleValue(name, field, r),
        }, h("span", { class: "fill", style: `width:${pct}%` }), h("span", { class: "box" }, on ? "✓" : ""), h("span", { class: "lbl" }, r.label),
        h("span", { class: "num" }, r.count === null ? "" : fmtNum(r.count)));
      }), note ? h("span", { class: "muted small", style: "padding:4px 8px" }, note) : "");
      if (!rows.length) list.append(h("span", { class: "muted small", style: "padding:4px 8px" }, "No values in the current results."));
    };

    const base = async () => {
      const limit = relational || field.type === "char" ? VALUE_LIMIT : null;
      const res = await groups(name, field, name, { limit });
      const rows = res.map((g) => ({ id: groupId(g[name]), label: groupLabel(g[name], field), count: g.__count, domain: g.__extra_domain }));
      // keep chosen values visible even when they aren't in the top N
      for (const [id, v] of chosen) if (!rows.some((r) => r.id === id)) rows.push({ ...v, count: 0 });
      // selection fields: show every option, even with zero records
      if (field.type === "selection" && field.selection) {
        for (const [k, label] of field.selection) {
          const id = JSON.stringify(k);
          if (!rows.some((r) => r.id === id)) rows.push({ id, label, count: 0, domain: [[name, "=", k]] });
        }
      }
      draw(rows, limit && res.length >= limit ? "Top values by count: search to find others." : "");
    };

    const find = debounce(async (q) => {
      if (!q) return base().catch(fail);
      try {
        if (relational) {
          const found = await orm(field.relation, "name_search", [], { name: q, limit: 15 });
          const ids = found.map(([id]) => id);
          const counts = ids.length
            ? await readGroup(state.ctx.resModel, D.andDomains(countDomain(name), [[name, "in", ids]]), { groupby: [name] })
            : [];
          const byId = new Map(counts.map((g) => [Array.isArray(g[name]) ? g[name][0] : g[name], g.__count]));
          draw(found.map(([id, label]) => ({ id: JSON.stringify(id), label, count: byId.get(id) || 0, domain: [[name, "=", id]] })));
        } else {
          const res = await readGroup(state.ctx.resModel, D.andDomains(countDomain(name), [[name, "ilike", q]]), {
            groupby: [name], order: "__count desc", limit: 20,
          });
          const rows = res.map((g) => ({ id: groupId(g[name]), label: groupLabel(g[name], field), count: g.__count, domain: g.__extra_domain }));
          // "contains" as a single value
          rows.unshift({ id: `ilike:${q}`, label: `Contains "${q}"`, count: res.reduce((s, g) => s + g.__count, 0), domain: [[name, "ilike", q]] });
          draw(rows);
        }
      } catch (e) {
        fail(e);
      }
    }, 250);
    if (search) search.addEventListener("input", () => find(search.value.trim()));
    base().catch((e) => {
      list.replaceChildren(h("span", { class: "err-text" }, e.message));
    });
  }

  function toggleValue(name, field, row) {
    const prev = state.sel[selKey(name)];
    const values = ((prev && prev.values) || []).filter((v) => v.id !== row.id);
    if (values.length === ((prev && prev.values) || []).length) values.push({ id: row.id, label: row.label, domain: row.domain });
    if (!values.length) return setSelection(name, null);
    const label = `${field.string}: ${values.map((v) => v.label).join(" or ")}`;
    setSelection(name, { kind: "values", values, label: values.map((v) => v.label).join(", "), facet: label, domain: D.orDomains(...values.map((v) => v.domain)) });
  }

  async function setSelection(name, sel) {
    const key = selKey(name);
    const field = state.fields[state.ctx.resModel][name];
    if (sel) state.sel[key] = sel;
    else delete state.sel[key];
    try {
      await bridge("apply", { key: facetKey(name), label: sel ? sel.facet : "", domain: sel ? sel.domain : [] });
      if (sel) pushHistory({ label: sel.facet, domain: sel.domain });
      status(sel ? `Filtered: ${sel.facet}` : `Cleared ${field.string}`, "ok");
      // value bars allow picking several values, so wait until the pointer leaves the panel
      if (sel) autoCollapse(sel.kind !== "values");
    } catch (e) {
      fail(e);
    }
    // the bridge's "changed" event refreshes the panel
  }

  function renderDates(el, name, field) {
    const sel = state.sel[selKey(name)] || {};
    el.append(h("div", { class: "chips" }, D.PRESETS.map(([key, label]) =>
      h("button", { type: "button", class: `chip${sel.preset === key ? " on" : ""}`, onclick: () => {
        if (sel.preset === key) return setSelection(name, null);
        const r = D.datePreset(key);
        setSelection(name, { kind: "date", preset: key, label, facet: `${field.string}: ${label}`, domain: D.dateRangeDomain(name, field.type, r.from, r.to) });
      } }, label))));
    const from = h("input", { type: "date", value: sel.from || "", "aria-label": "From" });
    const to = h("input", { type: "date", value: sel.to || "", "aria-label": "To" });
    const applyRange = () => {
      if (!from.value && !to.value) return setSelection(name, null);
      const label = from.value && to.value ? `${from.value} → ${to.value}` : from.value ? `from ${from.value}` : `until ${to.value}`;
      setSelection(name, { kind: "date", from: from.value, to: to.value, label, facet: `${field.string}: ${label}`, domain: D.dateRangeDomain(name, field.type, from.value || null, to.value || null) });
    };
    el.append(h("div", { class: "row", style: "margin-top:10px" }, from, "→", to, h("button", { type: "button", class: "btn sm", onclick: applyRange }, "Apply")));
    // month histogram
    const hist = h("div", { class: "hist", "aria-label": "Records per month" }, h("span", { class: "spin" }));
    const labels = h("div", { class: "hist-labels" });
    el.append(hist, labels);
    groups(name, field, `${name}:month`, { order: `${name}:month asc` }).then((res) => {
      const rows = res.filter((g) => g[`${name}:month`]).slice(-24);
      if (!rows.length) {
        hist.replaceChildren(h("span", { class: "muted small" }, "No dated records."));
        return;
      }
      const max = Math.max(...rows.map((g) => g.__count));
      hist.replaceChildren(...rows.map((g) => {
        const [, label] = g[`${name}:month`];
        const on = sel.month === label;
        return h("button", {
          type: "button", class: on ? "on" : "", style: `height:${Math.max(4, Math.round((g.__count / max) * 100))}%`,
          title: `${label}: ${fmtNum(g.__count)}`, "aria-label": `${label}: ${g.__count} records`,
          onclick: () => on ? setSelection(name, null) : setSelection(name, { kind: "date", month: label, label, facet: `${field.string}: ${label}`, domain: g.__extra_domain }),
        });
      }));
      labels.replaceChildren(h("span", null, rows[0][`${name}:month`][1]), h("span", null, rows[rows.length - 1][`${name}:month`][1]));
    }).catch((e) => hist.replaceChildren(h("span", { class: "err-text" }, e.message)));
  }

  function renderRange(el, name, field) {
    const sel = state.sel[selKey(name)] || {};
    const info = h("div", { class: "muted small", style: "margin-top:6px" }, h("span", { class: "spin" }));
    const min = h("input", { type: "number", step: "any", placeholder: "min", value: sel.min ?? "", "aria-label": "Minimum" });
    const max = h("input", { type: "number", step: "any", placeholder: "max", value: sel.max ?? "", "aria-label": "Maximum" });
    const apply = () => {
      if (min.value === "" && max.value === "") return setSelection(name, null);
      const label = min.value !== "" && max.value !== "" ? `${min.value} – ${max.value}` : min.value !== "" ? `≥ ${min.value}` : `≤ ${max.value}`;
      setSelection(name, { kind: "range", min: min.value, max: max.value, label, facet: `${field.string} ${label}`,
        domain: D.compileCondition({ path: name, type: field.type, op: "between", value: min.value, value2: max.value }) });
    };
    for (const i of [min, max]) i.addEventListener("keydown", (ev) => ev.key === "Enter" && apply());
    el.append(info, h("div", { class: "row", style: "margin-top:8px" }, min, "–", max, h("button", { type: "button", class: "btn sm", onclick: apply }, "Apply")));
    const chips = h("div", { class: "chips" });
    el.append(chips);
    const domain = countDomain(name);
    readGroup(state.ctx.resModel, domain, { aggregates: [`${name}:min`, `${name}:max`, `${name}:sum`, "__count"] })
      .then(([g]) => {
        if (!g || g[`${name}:min`] === undefined || g[`${name}:min`] === null) {
          info.textContent = "No values in the current results.";
          return;
        }
        const lo = g[`${name}:min`];
        const hi = g[`${name}:max`];
        info.textContent = `Range ${fmtNum(lo)} – ${fmtNum(hi)} · sum ${fmtNum(g[`${name}:sum`])} · ${fmtNum(g.__count)} records`;
        // quick buckets
        if (hi > lo) {
          const step = niceStep((hi - lo) / 4);
          const start = Math.floor(lo / step) * step;
          for (let a = start; a < hi; a += step) {
            const b = a + step;
            chips.append(h("button", { type: "button", class: "chip", onclick: () => { min.value = a; max.value = b; apply(); } }, `${fmtNum(a)} – ${fmtNum(b)}`));
          }
        }
      })
      .catch(() => { info.textContent = "This field can't be summarised (not stored); filtering still works."; });
  }

  function niceStep(raw) {
    const p = 10 ** Math.floor(Math.log10(raw || 1));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
    return 10 * p;
  }

  function renderText(el, name, field) {
    const sel = state.sel[selKey(name)] || {};
    const input = h("input", { type: "search", class: "grow", placeholder: "contains…", value: sel.text || "", "aria-label": `${field.string} contains` });
    const apply = () => {
      const v = input.value.trim();
      if (!v) return setSelection(name, null);
      setSelection(name, { kind: "text", text: v, label: `contains "${v}"`, facet: `${field.string} contains "${v}"`, domain: [[name, "ilike", v]] });
    };
    input.addEventListener("keydown", (ev) => ev.key === "Enter" && apply());
    el.append(h("div", { class: "row", style: "margin-top:6px" }, input, h("button", { type: "button", class: "btn sm", onclick: apply }, "Apply")));
  }

  // ===========================================================================
  // Builder tab: condition tree <-> Python domain, live counts
  // ===========================================================================
  // builder nodes: {kind: "group", op, children} | {kind: "not", child} | {kind: "cond", cond}
  let nodeSeq = 0;
  const newCond = (cond = {}) => ({ kind: "cond", id: ++nodeSeq, cond: { path: "", type: "", op: "", ...cond } });
  const newGroup = (op = "&", children = []) => ({ kind: "group", id: ++nodeSeq, op, children });

  function compileNode(n) {
    if (n.kind === "cond") {
      if (n.cond.raw) return [n.cond.raw.slice()];
      try {
        return D.compileCondition(n.cond);
      } catch {
        return [];
      }
    }
    if (n.kind === "not") {
      const inner = compileNode(n.child);
      return inner.length ? ["!", ...inner] : [];
    }
    const parts = n.children.map(compileNode).filter((d) => d.length);
    return n.op === "&" ? D.andDomains(...parts) : D.orDomains(...parts);
  }

  const EDITABLE_OPS = new Set(["=", "!=", ">", ">=", "<", "<=", "in", "not in", "ilike", "not ilike"]);

  /** Domain -> builder tree, keeping leaves the editor can't represent as raw leaves. */
  function treeFromDomain(domain) {
    const model = state.ctx.resModel;
    const conv = (n) => {
      if (n.type === "group") return newGroup(n.op, n.children.map(conv));
      if (n.type === "not") return { kind: "not", id: ++nodeSeq, child: conv(n.child) };
      const [path, op] = n.leaf;
      const f = typeof path === "string" ? D.fieldAt(path, state.fields, model) : null;
      if (!f) return newCond({ raw: n.leaf });
      const cond = D.leafToCondition(n.leaf, f.type);
      const known = D.operatorsFor(f.type).includes(cond.op) && (EDITABLE_OPS.has(op) || ["set", "not_set", "is_true", "is_false"].includes(cond.op));
      if (!known || cond.raw) return newCond({ path, type: f.type, raw: n.leaf });
      return newCond(cond);
    };
    const root = conv(D.toTree(domain));
    return root.kind === "group" ? root : newGroup("&", [root]);
  }

  function builderDomain() {
    return state.builder ? compileNode(state.builder.root) : [];
  }

  /** The user's part of the current search (without the action's own domain). */
  function searchPart() {
    const ctx = state.ctx;
    const parts = ctx.facets.filter((f) => f.domain && f.domain.length).map((f) => f.domain);
    return D.andDomains(...parts);
  }

  async function startBuilder(fromSearch) {
    const domain = fromSearch ? searchPart() : [];
    await preloadPaths(domain);
    state.builder = { model: state.ctx.resModel, root: domain.length ? treeFromDomain(domain) : newGroup("&", [newCond()]), textErr: "", counts: {} };
    state.picker = null;
  }

  /** fields_get every model a domain's dotted paths go through, and names of ids used with relational fields. */
  async function preloadPaths(domain) {
    const model = state.ctx.resModel;
    const leaves = domain.filter((t) => Array.isArray(t) && typeof t[0] === "string");
    const byModel = {};
    for (const [path, , value] of leaves) {
      let current = model;
      const parts = path.split(".");
      for (let k = 0; k < parts.length; k++) {
        const fields = await fieldsOf(current).catch(() => ({}));
        const f = fields[parts[k]];
        if (!f) break;
        if (k === parts.length - 1 && f.relation) {
          const ids = (Array.isArray(value) ? value : [value]).filter((v) => typeof v === "number");
          (byModel[f.relation] = byModel[f.relation] || []).push(...ids);
        }
        current = f.relation;
        if (!current) break;
      }
    }
    await Promise.all(Object.entries(byModel).map(([m, ids]) => ensureNames(m, ids)));
  }

  function renderBuilder() {
    const ctx = state.ctx;
    const frag = h("div");
    if (!state.builder || state.builder.model !== ctx.resModel) {
      frag.append(h("div", { class: "empty" }, h("b", null, "Build a filter visually"),
        "Start from the current search to edit it, or from scratch.",
        h("div", { class: "row", style: "justify-content:center;margin-top:14px" },
          h("button", { type: "button", class: "btn primary", onclick: async () => { await startBuilder(true); render(); } }, "Edit current search"),
          h("button", { type: "button", class: "btn", onclick: async () => { await startBuilder(false); render(); } }, "Start empty"))));
      return frag;
    }
    const b = state.builder;
    frag.append(h("div", { class: "row" },
      h("span", { class: "bigcount", "data-bcount": "" }, "…"), h("span", { class: "muted" }, "records match"),
      h("span", { class: "spacer" }),
      h("button", { type: "button", class: "btn sm ghost", title: "Load the current search", onclick: async () => { await startBuilder(true); render(); } }, "Load search"),
      h("button", { type: "button", class: "btn sm ghost", onclick: async () => { await startBuilder(false); render(); } }, "Reset")));
    frag.append(renderGroup(b.root, null));
    frag.append(h("div", { class: "summary", "data-bsummary": "" }));
    frag.append(h("h3", null, "Python domain", h("span", { class: "count" }, h("button", { type: "button", class: "btn sm ghost", onclick: () => copy(D.formatDomain(builderDomain()), "Python domain") }, "Copy"),
      h("button", { type: "button", class: "btn sm ghost", onclick: () => copy(JSON.stringify(builderDomain()), "JSON domain") }, "Copy JSON"))));
    const ta = h("textarea", { class: "code", spellcheck: "false", "aria-label": "Domain as Python", "data-btext": "" });
    const err = h("div", { class: "err-text", "data-berr": "" });
    ta.addEventListener("input", debounce(async () => {
      try {
        const domain = D.parseDomain(ta.value, { uid: state.session && state.session.uid });
        await preloadPaths(domain);
        b.root = domain.length ? treeFromDomain(domain) : newGroup("&", []);
        b.textErr = "";
        err.textContent = "";
        ta.classList.remove("bad");
        // re-render the tree only, keep the textarea (and its caret) alive
        const fresh = renderGroup(b.root, null);
        frag.querySelector(".group").replaceWith(fresh);
        builderChanged(false);
      } catch (e) {
        b.textErr = e.message;
        err.textContent = e.message;
        ta.classList.add("bad");
      }
    }, 450));
    frag.append(ta, err);
    frag.append(h("div", { class: "row", style: "margin-top:12px" },
      h("button", { type: "button", class: "btn primary", title: "Add this as one filter next to the current search", onclick: () => applyBuilder(false) }, "Add as filter"),
      h("button", { type: "button", class: "btn", title: "Replace every filter in the search bar with this one (group-bys stay)", onclick: () => applyBuilder(true) }, "Replace search"),
      ctx.shareQuery !== null ? h("button", { type: "button", class: "btn ghost", title: "Link that opens this menu with this filter", onclick: copyLink }, "Copy link") : null));
    setTimeout(() => builderChanged(true));
    return frag;
  }

  const countBuilder = debounce(async () => {
    const ctx = state.ctx;
    const b = state.builder;
    if (!b) return;
    const domain = builderDomain();
    const el = bodyEl.querySelector("[data-bcount]");
    try {
      const n = await orm(ctx.resModel, "search_count", [D.andDomains(ctx.globalDomain, domain)]);
      if (el) el.textContent = fmtNum(n);
    } catch (e) {
      if (el) el.textContent = "?";
      if (state.tab === "builder") status(e.title === "Network error" ? `Couldn't count: ${e.message}` : `Domain error: ${e.message}`, "err");
    }
    // per-condition counts
    const conds = [];
    (function walk(n) {
      if (n.kind === "cond") conds.push(n);
      else if (n.kind === "not") walk(n.child);
      else n.children.forEach(walk);
    })(b.root);
    await Promise.all(conds.map(async (n) => {
      const cel = bodyEl.querySelector(`[data-ccount="${n.id}"]`);
      const d = compileNode(n);
      if (!cel) return;
      if (!d.length) { cel.textContent = ""; return; }
      try {
        const c = await orm(ctx.resModel, "search_count", [D.andDomains(ctx.globalDomain, d)]);
        cel.textContent = fmtNum(c);
        cel.title = `${c} records match this condition on its own`;
      } catch (e) {
        cel.textContent = "error";
        cel.title = e.message;
      }
    }));
  }, 350);

  /** Something changed in the tree: refresh text (unless typing in it), summary and counts. */
  function builderChanged(updateText = true) {
    const domain = builderDomain();
    const ta = bodyEl.querySelector("[data-btext]");
    if (ta && updateText && shadow.activeElement !== ta) {
      ta.value = D.formatDomain(domain);
      ta.classList.remove("bad");
      const err = bodyEl.querySelector("[data-berr]");
      if (err) err.textContent = "";
    }
    const sum = bodyEl.querySelector("[data-bsummary]");
    if (sum) {
      try {
        sum.textContent = D.describeDomain(domain, state.fields, state.ctx.resModel, state.names);
      } catch {
        sum.textContent = "";
      }
    }
    countBuilder();
  }

  function rerenderBuilder() {
    render();
  }

  function renderGroup(g, parent) {
    const box = h("div", { class: `group${g.op === "|" ? " any" : ""}` });
    const opSel = h("select", { "aria-label": "Match" },
      h("option", { value: "&", selected: g.op === "&" ? "" : null }, "ALL"),
      h("option", { value: "|", selected: g.op === "|" ? "" : null }, "ANY"));
    opSel.value = g.op;
    opSel.addEventListener("change", () => { g.op = opSel.value; rerenderBuilder(); });
    box.append(h("div", { class: "group-head" }, "Match", opSel, "of these conditions", h("span", { class: "spacer" }),
      parent ? h("button", { type: "button", class: "x", title: "Remove group", "aria-label": "Remove group", onclick: () => { removeNode(parent, g); } }, "×") : null));
    for (const child of g.children) {
      if (child.kind === "group") box.append(renderGroup(child, g));
      else if (child.kind === "not") box.append(renderNot(child, g));
      else box.append(renderCond(child, g));
    }
    box.append(h("div", { class: "row tight", style: "margin-top:4px" },
      h("button", { type: "button", class: "btn sm ghost", onclick: () => { g.children.push(newCond()); rerenderBuilder(); } }, "+ Condition"),
      h("button", { type: "button", class: "btn sm ghost", onclick: () => { g.children.push(newGroup(g.op === "&" ? "|" : "&", [newCond()])); rerenderBuilder(); } }, "+ Group")));
    return box;
  }

  function renderNot(n, parent) {
    const box = h("div", { class: "group" }, h("div", { class: "group-head" }, "NOT", h("span", { class: "spacer" }),
      h("button", { type: "button", class: "x", title: "Remove", onclick: () => removeNode(parent, n) }, "×")));
    const child = n.child;
    if (child.kind === "group") box.append(renderGroup(child, null));
    else box.append(renderCond(child, null));
    return box;
  }

  function removeNode(parent, node) {
    if (!parent) return;
    parent.children = parent.children.filter((c) => c !== node);
    if (state.picker && state.picker.node === node) state.picker = null;
    rerenderBuilder();
  }

  function renderCond(n, parent) {
    const c = n.cond;
    const model = state.ctx.resModel;
    const row = h("div", { class: `cond${c.raw ? " raw" : ""}` });
    const label = c.path ? D.fieldLabel(c.path, state.fields, model) : "Choose a field…";
    row.append(h("button", { type: "button", class: `path${c.path ? "" : " unset"}`, title: c.path || "", onclick: () => openPicker(n) }, label));
    if (c.raw) {
      // a leaf the visual editor doesn't cover: edit its parts as Python
      const op = h("input", { value: c.raw[1], style: "width:90px", "aria-label": "Operator" });
      const val = h("input", { class: "grow mono", value: D.pyRepr(c.raw[2]), "aria-label": "Value (Python)" });
      const upd = () => {
        try {
          c.raw = [c.raw[0], op.value.trim(), D.parseLiteral(val.value || "False", { uid: state.session && state.session.uid })];
          val.classList.remove("bad");
          builderChanged();
        } catch {
          val.style.borderColor = "var(--bad)";
        }
      };
      op.addEventListener("change", upd);
      val.addEventListener("change", upd);
      row.append(op, val);
    } else if (c.path) {
      const ops = D.operatorsFor(c.type);
      if (!c.op || !ops.includes(c.op)) c.op = ops[0];
      const opSel = h("select", { "aria-label": "Operator" }, ops.map((o) => h("option", { value: o }, D.opLabel(o))));
      opSel.value = c.op;
      opSel.addEventListener("change", () => {
        const before = D.opKind(c.op);
        c.op = opSel.value;
        if (D.opKind(c.op) !== before) { c.value = undefined; c.value2 = undefined; }
        rerenderBuilder();
      });
      row.append(opSel, valueEditor(n));
    }
    row.append(h("span", { class: "cnt", "data-ccount": n.id }));
    if (parent) row.append(h("button", { type: "button", class: "x", title: "Remove condition", "aria-label": "Remove condition", onclick: () => removeNode(parent, n) }, "×"));
    const wrap = h("div", null, row);
    if (state.picker && state.picker.node === n) wrap.append(renderPicker());
    return wrap;
  }

  function valueEditor(n) {
    const c = n.cond;
    const kind = D.opKind(c.op);
    const field = D.fieldAt(c.path, state.fields, state.ctx.resModel) || {};
    const changed = () => builderChanged();
    if (kind === "none") return h("span");
    if (kind === "preset") {
      if (!c.value) c.value = "this_month";
      const s = h("select", { "aria-label": "Period" }, D.PRESETS.map(([k, l]) => h("option", { value: k }, l)));
      s.value = c.value;
      s.addEventListener("change", () => { c.value = s.value; changed(); });
      return s;
    }
    if (kind === "range") {
      const type = D.DATES.has(c.type) ? "date" : "number";
      const a = h("input", { type, step: "any", value: c.value ?? "", "aria-label": "From" });
      const b2 = h("input", { type, step: "any", value: c.value2 ?? "", "aria-label": "To" });
      a.addEventListener("input", () => { c.value = a.value; changed(); });
      b2.addEventListener("input", () => { c.value2 = b2.value; changed(); });
      return h("span", { class: "row tight" }, a, "and", b2);
    }
    if (c.type === "selection" && field.selection) {
      if (kind === "many") {
        const vals = new Set(Array.isArray(c.value) ? c.value : []);
        return h("span", { class: "tags" }, field.selection.map(([k, l]) => h("label", { class: "check" },
          h("input", { type: "checkbox", checked: vals.has(k), onchange: (ev) => { ev.target.checked ? vals.add(k) : vals.delete(k); c.value = [...vals]; changed(); } }), l)));
      }
      const s = h("select", { "aria-label": "Value" }, field.selection.map(([k, l]) => h("option", { value: k }, l)));
      if (c.value === undefined) c.value = field.selection[0] && field.selection[0][0];
      s.value = c.value;
      s.addEventListener("change", () => { c.value = s.value; changed(); });
      return s;
    }
    if (D.RELATIONAL.has(c.type) && kind === "many") return relationTags(c, field);
    if (D.DATES.has(c.type)) {
      const i = h("input", { type: "date", value: c.value || "", "aria-label": "Date" });
      i.addEventListener("input", () => { c.value = i.value; changed(); });
      return i;
    }
    if (D.NUMERIC.has(c.type)) {
      const i = h("input", { type: "number", step: "any", value: c.value ?? "", "aria-label": "Value" });
      i.addEventListener("input", () => { c.value = i.value; changed(); });
      return i;
    }
    if (c.type === "many2one" && kind === "one") return relationTags(c, field);
    const i = h("input", { class: "grow", value: c.value === undefined || c.value === false ? "" : c.value, "aria-label": "Value" });
    i.addEventListener("input", () => { c.value = i.value; changed(); });
    return i;
  }

  /** Chips of chosen records + a name_search autocomplete. */
  function relationTags(c, field) {
    if (!Array.isArray(c.value)) c.value = c.value === undefined || c.value === false ? [] : [c.value];
    const wrap = h("span", { class: "tags" });
    const draw = () => {
      wrap.replaceChildren(...c.value.map((id) => h("span", { class: "tag" }, state.names[`${field.relation},${id}`] || `#${id}`,
        h("button", { type: "button", "aria-label": "Remove", onclick: () => { c.value = c.value.filter((x) => x !== id); draw(); builderChanged(); } }, "×"))), ac);
    };
    const input = h("input", { placeholder: "Search…", "aria-label": `Search ${field.string || "records"}` });
    const list = h("ul", { hidden: true, role: "listbox" });
    const ac = h("span", { class: "ac" }, input, list);
    let items = [];
    let hi = 0;
    const show = () => {
      // late search results must not reopen the list after the input lost focus
      list.hidden = !items.length || shadow.activeElement !== input;
      list.replaceChildren(...items.map(([id, name], k) => h("li", { class: k === hi ? "hi" : "", role: "option", onmousedown: (ev) => { ev.preventDefault(); pick(k); } }, name)));
    };
    const pick = (k) => {
      const [id, name] = items[k];
      state.names[`${field.relation},${id}`] = name;
      if (!c.value.includes(id)) c.value = [...c.value, id];
      items = [];
      input.value = "";
      draw();
      builderChanged();
      input.focus();
    };
    const search = debounce(async () => {
      try {
        items = await orm(field.relation, "name_search", [], { name: input.value.trim(), limit: 8 });
        hi = 0;
        show();
      } catch (e) {
        fail(e);
      }
    }, 200);
    input.addEventListener("input", search);
    input.addEventListener("focus", search);
    input.addEventListener("blur", () => setTimeout(() => { items = []; show(); }, 150));
    input.addEventListener("keydown", (ev) => {
      if (!items.length) return;
      if (ev.key === "ArrowDown") { hi = (hi + 1) % items.length; show(); ev.preventDefault(); }
      else if (ev.key === "ArrowUp") { hi = (hi - 1 + items.length) % items.length; show(); ev.preventDefault(); }
      else if (ev.key === "Enter") { pick(hi); ev.preventDefault(); }
      else if (ev.key === "Escape") { items = []; show(); }
    });
    draw();
    return wrap;
  }

  // field path picker (drills through relations)
  function openPicker(node) {
    if (state.picker && state.picker.node === node) {
      state.picker = null;
    } else {
      state.picker = { node, trail: [{ model: state.ctx.resModel, label: state.ctx.displayName || state.ctx.resModel, path: "" }], q: "" };
    }
    rerenderBuilder();
  }

  function renderPicker() {
    const p = state.picker;
    const here = p.trail[p.trail.length - 1];
    const box = h("div", { class: "picker" });
    const crumbs = h("div", { class: "crumbs" }, p.trail.map((t, k) => [
      k ? h("span", { class: "muted" }, "›") : null,
      k < p.trail.length - 1 ? h("button", { type: "button", onclick: () => { p.trail = p.trail.slice(0, k + 1); rerenderBuilder(); } }, t.label) : h("b", null, t.label),
    ]), h("span", { class: "spacer" }), h("button", { type: "button", onclick: () => { state.picker = null; rerenderBuilder(); } }, "close"));
    const input = h("input", { type: "search", placeholder: "Search fields…", value: p.q, "aria-label": "Search fields" });
    const list = h("ul", { role: "listbox" }, h("li", null, h("span", { class: "spin" })));
    box.append(crumbs, input, list);
    let rows = [];
    let hi = 0;
    const choose = (name, f) => {
      const c = p.node.cond;
      c.path = here.path ? `${here.path}.${name}` : name;
      c.type = f.type;
      c.op = D.operatorsFor(f.type)[0];
      c.value = undefined;
      c.value2 = undefined;
      delete c.raw;
      state.picker = null;
      rerenderBuilder();
    };
    const drill = (name, f) => {
      p.trail.push({ model: f.relation, label: f.string || name, path: here.path ? `${here.path}.${name}` : name });
      p.q = "";
      rerenderBuilder();
    };
    const fill = () => {
      const q = input.value.trim().toLowerCase();
      p.q = input.value;
      list.replaceChildren(...rows
        .filter(([name, f]) => !q || (f.string || "").toLowerCase().includes(q) || name.includes(q))
        .slice(0, 80)
        .map(([name, f], k) => h("li", { class: k === hi ? "hi" : "", role: "option", onclick: () => choose(name, f) },
          h("span", null, f.string || name), h("span", { class: "tech" }, name),
          f.relation && p.trail.length < 4 ? h("button", { type: "button", class: "drill", title: `Fields of ${f.string}`, onclick: (ev) => { ev.stopPropagation(); drill(name, f); } }, "›") : null)));
    };
    fieldsOf(here.model).then((fields) => {
      rows = Object.entries(fields).filter(([, f]) => f.searchable !== false && f.type !== "binary").sort((a, b) => (a[1].string || a[0]).localeCompare(b[1].string || b[0]));
      fill();
    }).catch((e) => list.replaceChildren(h("li", { class: "err-text" }, e.message)));
    input.addEventListener("input", () => { hi = 0; fill(); });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") { state.picker = null; rerenderBuilder(); }
    });
    setTimeout(() => input.focus());
    return box;
  }

  async function applyBuilder(replace) {
    const domain = builderDomain();
    if (state.builder.textErr) return status(`Fix the domain first: ${state.builder.textErr}`, "err");
    let label;
    try {
      label = D.describeDomain(domain, state.fields, state.ctx.resModel, state.names);
    } catch {
      label = D.formatDomain(domain);
    }
    if (label.length > 90) label = label.slice(0, 88) + "…";
    try {
      // the domain check runs server-side first so a bad domain never reaches the view
      await orm(state.ctx.resModel, "search_count", [domain]);
      // facets the builder replaces would double-apply: in replace mode the bridge clears them
      await bridge(replace ? "replaceAll" : "apply", { key: replace ? "b:builder" : `b:${Date.now()}`, label, domain });
      pushHistory({ label, domain });
      status(replace ? "Search replaced." : "Filter added.", "ok");
      autoCollapse(true);
    } catch (e) {
      fail(e);
    }
  }

  function copyLink() {
    const domain = builderDomain();
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    const qs = domain.length ? `?domain=${encodeURIComponent(D.formatDomain(domain).replace(/\n\s*/g, " "))}` : "";
    copy(url.origin + url.pathname + qs, "Link");
  }

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      status(`${what} copied.`, "ok");
    } catch {
      // clipboard API needs focus; fall back to a hidden textarea
      const ta = h("textarea", { style: "position:fixed;opacity:0" }, text);
      shadow.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      status(ok ? `${what} copied.` : "Couldn't copy to the clipboard.", ok ? "ok" : "err");
    }
  }

  // ===========================================================================
  // Explain tab: why does (or doesn't) a record match?
  // ===========================================================================
  function renderExplain() {
    const ctx = state.ctx;
    const ex = state.explain;
    const frag = h("div");
    frag.append(h("p", { class: "muted small", style: "margin-top:0" },
      "Pick a record to see which conditions it passes and which one keeps it out of the results. Every condition is checked by the server, so computed fields, related paths and access rules are taken into account."));

    // record chooser
    const input = h("input", { class: "grow", placeholder: `Search ${ctx.displayName || ctx.resModel}…`, value: ex.label || (ex.resId ? `#${ex.resId}` : ""), "aria-label": "Record" });
    const list = h("ul", { hidden: true, role: "listbox" });
    let items = [];
    const show = () => {
      list.hidden = !items.length || shadow.activeElement !== input;
      list.replaceChildren(...items.map(([id, name]) => h("li", { role: "option", onmousedown: (ev) => { ev.preventDefault(); chooseRecord(id, name); } }, name, h("span", { class: "muted small" }, `  #${id}`))));
    };
    const search = debounce(async () => {
      const q = input.value.trim();
      try {
        if (/^#?\d+$/.test(q)) {
          items = [[Number(q.replace("#", "")), `Record #${q.replace("#", "")}`]];
        } else {
          // search outside the current filters (that's the point) and include archived records
          items = await orm(ctx.resModel, "name_search", [], { name: q, limit: 10, context: { active_test: false } });
        }
        show();
      } catch (e) {
        fail(e);
      }
    }, 220);
    input.addEventListener("input", search);
    input.addEventListener("blur", () => setTimeout(() => { items = []; show(); }, 150));
    frag.append(h("div", { class: "row" }, h("span", { class: "ac" }, input, list)));
    frag.append(h("div", { class: "row", style: "margin-top:6px" },
      ctx.viewType === "form" && ctx.resId ? h("button", { type: "button", class: "btn sm", onclick: () => chooseRecord(ctx.resId, "") }, "Use the open record") : null,
      ctx.viewType === "list" ? h("button", { type: "button", class: `btn sm${ex.picking ? " primary" : ""}`, onclick: startPicking }, ex.picking ? "Click a row in the list…" : "Pick a row from the list") : null));

    // domain to test
    const hasBuilder = !!(state.builder && state.builder.model === ctx.resModel);
    frag.append(h("div", { class: "row", style: "margin-top:10px" }, h("span", { class: "muted small" }, "Check against"),
      h("label", { class: "check" }, h("input", { type: "radio", name: "src", checked: ex.source === "search", onchange: () => { ex.source = "search"; } }), "current search"),
      h("label", { class: "check", title: hasBuilder ? "" : "Open the Builder tab first" }, h("input", { type: "radio", name: "src", disabled: !hasBuilder, checked: ex.source === "builder", onchange: () => { ex.source = "builder"; } }), "builder domain")));
    frag.append(h("div", { class: "row", style: "margin-top:10px" },
      h("button", { type: "button", class: "btn primary", disabled: !ex.resId || ex.running, onclick: runExplain }, ex.running ? "Checking…" : "Explain")));

    if (ex.result) frag.append(renderExplainResult(ex.result));
    return frag;
  }

  function chooseRecord(id, name) {
    state.explain.resId = id;
    state.explain.label = name || `#${id}`;
    state.explain.result = null;
    render();
    runExplain();
  }

  // list row picking: a transparent overlay catches the next click (Odoo never sees it)
  // and the row under the pointer is found with elementsFromPoint.
  let pickOverlay = null;

  function rowAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      const row = el.closest && el.closest("tr.o_data_row[data-id]");
      if (row) return row;
    }
    return null;
  }

  function stopPicking() {
    state.explain.picking = false;
    if (pickOverlay) pickOverlay.remove();
    pickOverlay = null;
  }

  function startPicking() {
    const ex = state.explain;
    if (ex.picking) {
      stopPicking();
      render();
      return;
    }
    ex.picking = true;
    render();
    const hl = h("div", { class: "pick-hl", hidden: true });
    pickOverlay = h("div", { class: "pick-overlay", title: "Click a row to explain it (Esc to cancel)" }, hl);
    pickOverlay.addEventListener("pointermove", (ev) => {
      const row = rowAt(ev.clientX, ev.clientY);
      hl.hidden = !row;
      if (row) {
        const r = row.getBoundingClientRect();
        hl.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
      }
    });
    pickOverlay.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const row = rowAt(ev.clientX, ev.clientY);
      if (!row) return;
      stopPicking();
      try {
        const hit = await bridge("rowResId", { dataId: row.dataset.id });
        if (!hit) throw new Error("Couldn't find that row's record.");
        const name = (row.querySelector("td.o_data_cell") || row).textContent.trim().slice(0, 60);
        chooseRecord(hit.resId, name);
      } catch (e) {
        fail(e);
        render();
      }
    });
    // under the panel (same stacking context), above the page
    shadow.insertBefore(pickOverlay, panel);
  }

  async function mapLimit(items, n, fn) {
    const out = new Array(items.length);
    let k = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (k < items.length) {
        const i = k++;
        out[i] = await fn(items[i], i);
      }
    }));
    return out;
  }

  async function runExplain() {
    const ctx = state.ctx;
    const ex = state.explain;
    if (!ex.resId) return;
    ex.running = true;
    ex.result = null;
    render();
    const model = ctx.resModel;
    const rid = ex.resId;
    try {
      const fields = await fieldsOf(model);
      const userDomain = ex.source === "builder" && state.builder ? builderDomain() : searchPart();
      const actionDomain = ctx.globalDomain || [];
      const raw = { active_test: false };
      // 1. does the record exist / can this user see it at all?
      const visible = await orm(model, "search_count", [[["id", "=", rid]]], { context: raw });
      if (!visible) {
        ex.result = { missing: true, rid };
        return;
      }
      const name = (await orm(model, "read", [[rid], ["display_name"]], { context: raw }))[0].display_name;
      ex.label = name;

      // 2. evaluate every node of both domains for this one record
      const planUser = userDomain.length ? D.explainPlan(userDomain) : null;
      const planAction = actionDomain.length ? D.explainPlan(actionDomain) : null;
      const allNodes = [...(planAction ? planAction.nodes.map((x) => ({ ...x, part: "a" })) : []), ...(planUser ? planUser.nodes.map((x) => ({ ...x, part: "u" })) : [])];
      if (allNodes.length > EXPLAIN_MAX_NODES) throw new Error(`This domain has ${allNodes.length} parts; OoFind explains up to ${EXPLAIN_MAX_NODES}.`);
      const hits = await mapLimit(allNodes, 6, async (node) => {
        try {
          return (await orm(model, "search_count", [D.andDomains([["id", "=", rid]], node.domain)], { context: raw })) > 0;
        } catch {
          return null;
        }
      });
      const resA = {};
      const resU = {};
      allNodes.forEach((node, k) => ((node.part === "a" ? resA : resU)[node.id] = hits[k]));

      // 3. actual values of the fields used (first hop of each path)
      const leafPaths = new Set();
      for (const d of [userDomain, actionDomain]) for (const t of d) if (Array.isArray(t) && typeof t[0] === "string") leafPaths.add(t[0].split(".")[0]);
      const readable = [...leafPaths].filter((f) => fields[f]);
      if ("active" in fields) readable.push("active");
      let rec = {};
      if (readable.length) {
        try {
          rec = (await orm(model, "read", [[rid], [...new Set(readable)]], { context: raw }))[0] || {};
        } catch {
          rec = {};
        }
      }
      // names for x2many ids and relational values in the domain
      const want = {};
      for (const f of readable) {
        const fd = fields[f];
        if (fd && (fd.type === "many2many" || fd.type === "one2many") && Array.isArray(rec[f])) (want[fd.relation] = want[fd.relation] || []).push(...rec[f].slice(0, 8));
      }
      await Promise.all(Object.entries(want).map(([m, ids]) => ensureNames(m, ids)));
      await preloadPaths(D.andDomains(userDomain, actionDomain));

      // 4. the record in the real search (with Odoo's default active_test)
      const inSearch = (await orm(model, "search_count", [D.andDomains([["id", "=", rid]], actionDomain, userDomain)])) > 0;
      const archived = rec.active === false;
      const mentionsActive = [...userDomain, ...actionDomain].some((t) => Array.isArray(t) && t[0] === "active");

      ex.result = { rid, name, inSearch, archived: archived && !mentionsActive, planUser, planAction, resU, resA, rec, model };
    } catch (e) {
      ex.result = { error: e.message || String(e) };
    } finally {
      ex.running = false;
      if (state.tab === "explain") render();
    }
  }

  function actualText(path, rec, fields) {
    const first = path.split(".")[0];
    const f = fields[first];
    if (!f || !(first in rec)) return "";
    const v = rec[first];
    let text;
    if (v === false || v === null) text = f.type === "boolean" ? "No" : "not set";
    else if (v === true) text = "Yes";
    else if (Array.isArray(v) && f.type === "many2one") text = v[1];
    else if (Array.isArray(v)) text = v.length ? v.slice(0, 8).map((id) => state.names[`${f.relation},${id}`] || `#${id}`).join(", ") + (v.length > 8 ? ` +${v.length - 8}` : "") : "none";
    else if (f.type === "selection" && f.selection) text = (f.selection.find(([k]) => k === v) || [v, v])[1];
    else text = typeof v === "number" ? fmtNum(v) : String(v);
    return `${f.string || first}: ${text}${path.includes(".") ? " (first step of the path)" : ""}`;
  }

  function renderExplainResult(r) {
    const box = h("div");
    if (r.error) {
      box.append(h("div", { class: "verdict warn" }, h("span", { class: "ico" }, "!"), r.error));
      return box;
    }
    if (r.missing) {
      box.append(h("div", { class: "verdict bad" }, h("span", { class: "ico" }, "✕"), `Record #${r.rid} doesn't exist or you don't have access to it.`));
      box.append(h("p", { class: "muted small" }, "Record rules and access rights hide it from your user, whatever the filters say."));
      return box;
    }
    const fields = state.fields[r.model] || {};
    const userOk = r.planUser ? r.resU[r.planUser.tree.id] : true;
    const actionOk = r.planAction ? r.resA[r.planAction.tree.id] : true;
    if (r.inSearch) {
      box.append(h("div", { class: "verdict ok" }, h("span", { class: "ico" }, "✓"), `${r.name} is in the results.`));
    } else {
      box.append(h("div", { class: "verdict bad" }, h("span", { class: "ico" }, "✕"), `${r.name} is filtered out.`));
      const reasons = h("ul", { class: "causes" });
      if (r.archived) reasons.append(h("li", null, h("b", null, "It is archived. "), "Odoo hides archived records unless the search mentions the Active field (try the Archived filter)."));
      if (r.planAction && actionOk === false) {
        for (const n of D.explainCauses(r.planAction.tree, r.resA)) reasons.append(h("li", null, h("b", null, "Built into this menu: "), causeText(n, r)));
      }
      if (r.planUser && userOk === false) {
        for (const n of D.explainCauses(r.planUser.tree, r.resU)) reasons.append(h("li", null, causeText(n, r)));
      }
      if (!reasons.children.length) {
        reasons.append(h("li", null, "Every condition passes on its own, but the record still isn't returned. The view may add context-dependent rules (company, multi-company, or a search panel)."));
      }
      box.append(h("h3", null, "Why"), reasons);
    }
    if (r.planUser) {
      box.append(h("h3", null, ex_title(r.planUser, "Your filters")));
      box.append(h("ul", { class: "xtree" }, renderXNode(r.planUser.tree, r.resU, r, fields)));
    } else {
      box.append(h("p", { class: "muted small" }, "No filters are active: only the menu's own rules apply."));
    }
    if (r.planAction) {
      box.append(h("h3", null, "Built into this menu"));
      box.append(h("ul", { class: "xtree" }, renderXNode(r.planAction.tree, r.resA, r, fields)));
    }
    return box;
  }

  function ex_title(plan, text) {
    return text;
  }

  function causeText(n, r) {
    const fields = state.fields[r.model] || {};
    if (n.type === "leaf") {
      const actual = actualText(n.leaf[0], r.rec, fields);
      return h("span", null, h("span", null, D.describeLeaf(n.leaf, state.fields, r.model, state.names)), actual ? h("span", { class: "muted" }, ` (it has ${actual})`) : "");
    }
    if (n.type === "group") return `None of these match: ${D.describeDomain(D.fromTree(n), state.fields, r.model, state.names)}`;
    return `It matches what should be excluded: ${D.describeDomain(D.fromTree(n.child), state.fields, r.model, state.names)}`;
  }

  function renderXNode(n, res, r, fields) {
    const v = res[n.id];
    const cls = v === true ? "yes" : v === false ? "no" : "unk";
    const mark = v === true ? "✓" : v === false ? "✕" : "?";
    if (n.type === "leaf") {
      const actual = typeof n.leaf[0] === "string" ? actualText(n.leaf[0], r.rec, fields) : "";
      return h("li", null, h("div", { class: `xnode ${cls}` }, h("span", { class: "mark" }, mark),
        h("span", { class: "what" }, h("span", { class: "txt" }, D.describeLeaf(n.leaf, state.fields, r.model, state.names)),
          actual ? h("span", { class: "actual" }, actual) : null,
          v === null ? h("span", { class: "actual" }, "Couldn't be checked on its own.") : null)));
    }
    if (n.type === "not") {
      return h("li", null, h("div", { class: `xnode group-node ${cls}` }, h("span", { class: "mark" }, mark), h("span", { class: "what" }, h("span", { class: "txt" }, "NOT"))),
        h("ul", null, renderXNode(n.child, res, r, fields)));
    }
    return h("li", null, h("div", { class: `xnode group-node ${cls}` }, h("span", { class: "mark" }, mark),
      h("span", { class: "what" }, h("span", { class: "txt" }, n.op === "&" ? "All of" : "Any of"))),
    h("ul", null, n.children.map((c) => renderXNode(c, res, r, fields))));
  }

  // ===========================================================================
  // Presets tab: the menu's defaults, its own filters and group-bys, current grouping
  // ===========================================================================
  function renderPresets() {
    const frag = h("div");
    const box = h("div", null, h("span", { class: "spin" }));
    frag.append(box);
    bridge("searchItems").then((data) => {
      if (state.tab !== "presets") return;
      box.replaceChildren(presetsBody(data));
    }).catch((e) => box.replaceChildren(h("span", { class: "err-text" }, e.message)));
    return frag;
  }

  function presetsBody({ items, defaults, groupBy, hasDefaultFavorite }) {
    const ctx = state.ctx;
    const fields = state.fields[ctx.resModel] || {};
    const frag = h("div");

    // defaults
    frag.append(h("h3", null, "When you open this menu"));
    if (!defaults.length) {
      frag.append(h("p", { class: "muted small", style: "margin:0 0 8px" }, "No default filters or group-bys: the menu opens on all its records."));
    } else {
      frag.append(h("div", { class: "facets" }, defaults.map((d) => h("span", { class: `facet${d.kind === "groupBy" ? " group" : ""}`, style: "padding-right:9px" },
        h("span", null, `${d.kind === "favorite" ? "★ " : d.kind === "groupBy" ? "☰ " : ""}${d.label}`)))));
      if (hasDefaultFavorite) frag.append(h("p", { class: "muted small" }, "A favorite is set as default for this menu, so it is used instead of the menu's own default filters."));
    }
    frag.append(h("div", { style: "margin-top:10px" }, resetButtons(false)));

    // current search
    frag.append(h("h3", null, "Current search", h("span", { class: "count", "data-total": "" }, state.total === null ? "" : `${fmtNum(state.total)} records`)));
    frag.append(renderFacets());

    // filters of the menu, grouped like Odoo's Filters menu
    const filters = items.filter((i) => ["filter", "dateFilter", "parentFilter"].includes(i.type) || (i.type === "relativeFilter" && !items.some((d) => d.relativeFilterId === i.id)));
    const relatives = new Map(items.filter((i) => i.type === "relativeFilter").map((i) => [i.id, i]));
    frag.append(h("h3", null, "Filters of this menu"));
    if (!filters.length) frag.append(h("p", { class: "muted small" }, "This menu has no predefined filters."));
    let lastGroup = null;
    const wrap = h("div", { class: "presets" });
    for (const item of filters.sort((a, b) => a.groupNumber - b.groupNumber)) {
      if (lastGroup !== null && item.groupNumber !== lastGroup) wrap.append(h("div", { class: "sep" }));
      lastGroup = item.groupNumber;
      wrap.append(presetItem(item, relatives.get(item.relativeFilterId)));
    }
    frag.append(wrap);

    // group-bys
    frag.append(h("h3", null, "Group by"));
    const gbs = items.filter((i) => i.type === "groupBy" || i.type === "dateGroupBy");
    const gwrap = h("div", { class: "presets" });
    for (const item of gbs) gwrap.append(presetItem(item));
    frag.append(gwrap);
    if (groupBy.length) {
      frag.append(h("p", { class: "small", style: "margin:8px 0 0" }, h("span", { class: "muted" }, "Grouped by "),
        groupBy.map((g, k) => {
          const [name, interval] = g.split(":");
          return [k ? " › " : "", h("b", null, `${(fields[name] && fields[name].string) || name}${interval ? ` (${interval})` : ""}`)];
        })));
    }
    // custom group-by on any groupable field
    const groupable = Object.entries(fields)
      .filter(([, f]) => f.groupable !== false && f.store !== false && !["one2many", "binary", "html", "text", "properties", "json"].includes(f.type))
      .sort((a, b) => (a[1].string || a[0]).localeCompare(b[1].string || b[0]));
    const sel = h("select", { class: "grow", "aria-label": "Add a custom group" },
      h("option", { value: "" }, "Add a custom group…"),
      groupable.map(([name, f]) => h("option", { value: name }, `${f.string || name}`)));
    sel.addEventListener("change", async () => {
      const fieldName = sel.value;
      if (!fieldName) return;
      try {
        await bridge("addGroupBy", { fieldName });
        status(`Grouped by ${fields[fieldName].string}.`, "ok");
        autoCollapse(false);
      } catch (e) {
        fail(e);
      }
    });
    frag.append(h("div", { class: "row", style: "margin-top:8px" }, sel));
    return frag;
  }

  /** One menu item: a toggle chip, or a label with option chips (date periods, intervals). */
  function presetItem(item, relative) {
    const toggle = async (optionId, target = item) => {
      try {
        await bridge("toggleItem", { id: target.id, optionId });
        autoCollapse(false);
      } catch (e) {
        fail(e);
      }
    };
    const options = [...(relative ? relative.options.map((o) => ({ ...o, target: relative })) : []), ...item.options.map((o) => ({ ...o, target: item }))];
    const star = item.isDefault || (relative && relative.isDefault) ? h("span", { class: "dflt", title: "Default for this menu" }, "★") : null;
    if (!options.length) {
      return h("button", {
        type: "button", class: `chip${item.isActive ? " on" : ""}`, role: "switch", "aria-checked": item.isActive ? "true" : "false",
        "data-item": item.description, onclick: () => toggle(undefined),
      }, star, item.type === "groupBy" ? "☰ " : "", item.description);
    }
    const active = item.isActive || (relative && relative.isActive);
    return h("div", { class: `preset-opt${active ? " on" : ""}`, "data-item": item.description },
      h("span", { class: "preset-name" }, star, item.type === "dateGroupBy" ? "☰ " : "", item.description),
      h("span", { class: "chips", style: "margin-top:4px" }, options.map((o) => h("button", {
        type: "button", class: `chip${o.isActive ? " on" : ""}`, role: "switch", "aria-checked": o.isActive ? "true" : "false",
        onclick: () => toggle(o.id, o.target),
      }, o.description))));
  }

  // ===========================================================================
  // Saved tab: native favorites + recent searches
  // ===========================================================================
  async function loadFavorites() {
    const ctx = state.ctx;
    try {
      const userField = "user_ids" in (await fieldsOf("ir.filters")) ? "user_ids" : "user_id";
      const rows = await orm("ir.filters", "search_read", [[["model_id", "=", ctx.resModel]]], {
        fields: ["name", "domain", userField, "is_default", "action_id"], order: "name",
      });
      state.favorites = rows.map((f) => ({ ...f, user_ids: userField === "user_ids" ? f.user_ids : f.user_id ? [f.user_id[0]] : [] }));
    } catch (e) {
      state.favorites = [];
      fail(e);
    }
    if (state.tab === "saved") render();
  }

  function renderSaved() {
    const ctx = state.ctx;
    const frag = h("div");
    // save current
    const name = h("input", { class: "grow", placeholder: "Name this search…", "aria-label": "Favorite name" });
    const shared = h("input", { type: "checkbox" });
    const def = h("input", { type: "checkbox" });
    const save = async () => {
      const n = name.value.trim();
      if (!n) return name.focus();
      try {
        await bridge("saveFavorite", { name: n, isShared: shared.checked, isDefault: def.checked });
        status(`Saved "${n}" in Odoo favorites.`, "ok");
        state.favorites = null;
        render();
      } catch (e) {
        fail(e);
      }
    };
    name.addEventListener("keydown", (ev) => ev.key === "Enter" && save());
    frag.append(h("h3", null, "Save the current search"), h("div", { class: "form" },
      h("div", { class: "row" }, name, h("button", { type: "button", class: "btn primary", onclick: save }, "Save")),
      h("div", { class: "row" }, h("label", { class: "check" }, shared, "Share with all users"), h("label", { class: "check" }, def, "Default for this menu")),
      h("span", { class: "muted small" }, "Saved as a regular Odoo favorite, so it also appears in Odoo's Favorites menu.")));

    // favorites
    frag.append(h("h3", null, "Favorites", h("span", { class: "count" }, state.favorites ? String(state.favorites.length) : "")));
    if (state.favorites === null) {
      frag.append(h("span", { class: "spin" }));
      loadFavorites();
    } else if (!state.favorites.length) {
      frag.append(h("p", { class: "muted small" }, "No favorites for this model yet."));
    } else {
      const uid = state.session && state.session.uid;
      frag.append(h("div", { class: "list" }, state.favorites.map((f) => {
        const who = !f.user_ids.length ? "Shared" : f.user_ids.length === 1 && f.user_ids[0] === uid ? "Private" : "Shared with some users";
        return h("div", { class: "item" },
          h("div", { class: "main", role: "button", tabindex: "0", onclick: () => applyFavorite(f), onkeydown: (ev) => ev.key === "Enter" && applyFavorite(f) },
            h("div", { class: "name" }, f.is_default ? "★ " : "", f.name),
            h("div", { class: "sub mono", title: f.domain }, `${who}${f.action_id ? ` · ${f.action_id[1]}` : ""} · ${f.domain}`)),
          h("button", { type: "button", class: "btn sm ghost", title: "Open in the builder", onclick: () => favoriteToBuilder(f) }, "Edit"));
      })));
    }

    // history
    const mine = state.history.filter((x) => x.model === ctx.resModel);
    frag.append(h("h3", null, "Recent", h("span", { class: "count" }, mine.length ? h("button", { type: "button", class: "btn sm ghost", onclick: clearHistory }, "Clear") : "")));
    if (!mine.length) frag.append(h("p", { class: "muted small" }, "Filters you apply with OoFind show up here."));
    else {
      frag.append(h("div", { class: "list" }, mine.slice(0, 25).map((x) => h("div", { class: "item" },
        h("div", { class: "main", role: "button", tabindex: "0", onclick: () => applyHistory(x), onkeydown: (ev) => ev.key === "Enter" && applyHistory(x) },
          h("div", { class: "name" }, x.label),
          h("div", { class: "sub" }, new Date(x.at).toLocaleString())),
        h("button", { type: "button", class: "btn sm ghost", title: "Copy the Python domain", onclick: () => copy(D.formatDomain(x.domain), "Python domain") }, "Copy")))));
    }
    return frag;
  }

  function favoriteDomain(f) {
    return D.parseDomain(f.domain, { uid: state.session && state.session.uid });
  }

  async function applyFavorite(f) {
    try {
      if (await bridge("applyFavorite", { id: f.id })) {
        status(`Applied "${f.name}".`, "ok");
        autoCollapse(true);
        return;
      }
      // a favorite of another menu: apply its domain as a filter
      const domain = favoriteDomain(f);
      await bridge("replaceAll", { key: `fav:${f.id}`, label: f.name, domain });
      status(`Applied the domain of "${f.name}".`, "ok");
      autoCollapse(true);
    } catch (e) {
      if (e instanceof D.ParseError) status(`"${f.name}" uses expressions (like context_today()) that only Odoo's Favorites menu can evaluate.`, "err");
      else fail(e);
    }
  }

  async function favoriteToBuilder(f) {
    try {
      const domain = favoriteDomain(f);
      await preloadPaths(domain);
      state.builder = { model: state.ctx.resModel, root: domain.length ? treeFromDomain(domain) : newGroup("&", [newCond()]), textErr: "" };
      setTab("builder");
    } catch (e) {
      if (e instanceof D.ParseError) status(`"${f.name}" uses expressions the builder can't edit: ${e.message}`, "err");
      else fail(e);
    }
  }

  async function applyHistory(x) {
    try {
      await bridge("apply", { key: `h:${x.at}`, label: x.label, domain: x.domain });
      status("Filter added.", "ok");
      autoCollapse(true);
    } catch (e) {
      fail(e);
    }
  }

  function pushHistory(entry) {
    if (!entry.domain || !entry.domain.length) return;
    const model = state.ctx.resModel;
    const sig = JSON.stringify(entry.domain);
    state.history = [{ model, label: entry.label, domain: entry.domain, at: Date.now() },
      ...state.history.filter((x) => !(x.model === model && JSON.stringify(x.domain) === sig))].slice(0, HISTORY_MAX);
    store.set(K.history, state.history);
  }

  async function clearHistory() {
    const model = state.ctx.resModel;
    state.history = state.history.filter((x) => x.model !== model);
    await store.set(K.history, state.history);
    render();
  }

  // ---------------------------------------------------------------------------
  // keyboard: Escape closes the field picker, then the panel
  shadow.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (state.explain.picking) {
      stopPicking();
      render();
    } else if (state.picker) {
      state.picker = null;
      render();
    } else if (state.moreOpen) {
      state.moreOpen = false;
      render();
    } else if (state.mode === "expanded") {
      collapse(true);
    }
    ev.stopPropagation();
  });
  // keep Odoo's own hotkeys from firing while typing in the panel
  for (const type of ["keydown", "keyup", "keypress"]) host.addEventListener(type, (ev) => ev.stopPropagation());

  // follow Odoo's theme changes and SPA navigation
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

  // ---------------------------------------------------------------------------
  // boot
  globalThis.__oofind = { toggle: () => toggle() };
  /** Settings were stored under "searcho.*" before the rename to OoFind: copy them over once. */
  async function migrateOldKeys() {
    try {
      const old = Object.fromEntries(Object.entries(K).map(([k, v]) => [k, v.replace(/^oofind\./, "searcho.")]));
      const got = await api.storage.local.get([...Object.values(K), ...Object.values(old)]);
      const copy = {};
      for (const [k, key] of Object.entries(K)) if (got[key] === undefined && got[old[k]] !== undefined) copy[key] = got[old[k]];
      if (Object.keys(copy).length) await api.storage.local.set(copy);
      await api.storage.local.remove(Object.values(old));
    } catch {
      /* storage unavailable: nothing to migrate */
    }
  }

  (async () => {
    await migrateOldKeys();
    const [width, pins, history, tab, pos, keepOpen] = await Promise.all([store.get(K.width, 420), store.get(K.pins, {}), store.get(K.history, []),
      store.get(K.tab, "filters"), store.get(K.fab, null), store.get(K.keepOpen, false)]);
    if (pos && typeof pos.right === "number" && typeof pos.bottom === "number") fabPos = pos;
    fabPos = placeFab(fabPos);
    setKeepOpen(!!keepOpen);
    panel.style.width = `${Math.min(Math.max(width, 320), window.innerWidth * 0.92)}px`;
    state.pins = pins || {};
    state.history = Array.isArray(history) ? history : [];
    state.tab = TABS.some(([k]) => k === tab) ? tab : "filters";
    render();
    bridge("watch", { on: true }).catch(() => {});
    setMode("expanded");
    refresh(true);
  })();
})();
