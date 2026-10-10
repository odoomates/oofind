/* OoFind page bridge.
 *
 * Runs in the page's own JS world (injected with world: "MAIN") so it can
 * reach the Odoo web client's live SearchModel. The panel lives in the
 * extension's isolated world and talks to this bridge with DOM events whose
 * payload is a JSON string (strings cross JS worlds in every browser):
 *
 *   panel  -> "oofind:req"     {id, cmd, args}
 *   bridge -> "oofind:res"     {id, ok, result | error}
 *   bridge -> "oofind:changed" {}            (search or view changed)
 *
 * Filters are applied through public SearchModel methods (createNewFilters,
 * deactivateGroup, createNewFavorite), so they become ordinary Odoo facets:
 * removable from the search bar, saved in favorites, kept in breadcrumbs.
 * Works with the Owl 2 (19.0) and Owl 3 (master/20) component trees.
 */
(() => {
  "use strict";

  if (window.__oofindBridge) return;
  window.__oofindBridge = true;

  // OoFind-made facets: SearchModel -> Map(key -> groupId)
  const owned = new WeakMap();
  // the action's default group-by, captured before anyone removes it: SearchModel -> string[] | null
  const initialGroupBy = new WeakMap();
  let watched = null;
  let lastSignature = "";

  function owlRoot() {
    const dbg = window.odoo && window.odoo.__WOWL_DEBUG__;
    return dbg && dbg.root && dbg.root.__owl__;
  }

  function childNodes(node) {
    const ch = node && node.children;
    if (!ch) return [];
    return ch instanceof Map ? [...ch.values()] : Object.values(ch);
  }

  /** Every mounted component node, breadth first. */
  function* walk() {
    const root = owlRoot();
    if (!root) return;
    const queue = [root];
    const seen = new Set();
    while (queue.length) {
      const node = queue.shift();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      yield node;
      queue.push(...childNodes(node));
    }
  }

  /** The SearchModel of the main action (dialogs are ignored). */
  function activeView() {
    for (const node of walk()) {
      const c = node.component;
      const env = c && c.env;
      if (env && env.searchModel && env.config && !env.inDialog && env.searchModel.resModel) {
        const sm = env.searchModel;
        if (!initialGroupBy.has(sm)) initialGroupBy.set(sm, sm.defaultGroupBy ? [...sm.defaultGroupBy] : null);
        return { node, env, sm };
      }
    }
    return null;
  }

  /** Odoo's JS module registry: odoo.loader.modules (17+) or odoo.__DEBUG__.services (16). */
  function modules() {
    const o = window.odoo || {};
    if (o.loader && o.loader.modules) return o.loader.modules;
    const services = o.__DEBUG__ && o.__DEBUG__.services;
    if (services) return { get: (name) => services[name] };
    return new Map();
  }

  function DomainClass() {
    const mod = modules().get("@web/core/domain");
    return mod && mod.Domain;
  }

  function evalCtx(sm) {
    try {
      // 16 has no domainEvalContext: it evaluates with the global and user contexts
      if ("domainEvalContext" in sm) return sm.domainEvalContext;
      return Object.assign({}, sm.globalContext, sm.userService && sm.userService.context);
    } catch {
      return {};
    }
  }

  function toList(domain, sm) {
    const Domain = DomainClass();
    if (!domain) return [];
    if (Array.isArray(domain)) return domain;
    if (!Domain) return [];
    return new Domain(domain).toList(evalCtx(sm));
  }

  /** Domain of one facet group (16's facets don't carry it). */
  function groupDomain(sm, groupId) {
    const Domain = DomainClass();
    try {
      const group = sm._getGroups().find((g) => g.id === groupId);
      if (!group) return null;
      const ds = group.activeItems.map((a) => sm._getSearchItemDomain(a)).filter(Boolean);
      return ds.length ? Domain.or(ds).toList(evalCtx(sm)) : null;
    } catch {
      return null;
    }
  }

  /** Search domain without the given group (for faceted counts). Falls back to the full domain. */
  function domainWithout(sm, groupId) {
    const Domain = DomainClass();
    try {
      const parts = [sm.globalDomain];
      for (const group of sm._getGroups()) {
        if (group.id === groupId) continue;
        const ds = group.activeItems.map((a) => sm._getSearchItemDomain(a)).filter(Boolean);
        if (ds.length) parts.push(Domain.or(ds));
      }
      if (sm.display && sm.display.searchPanel) parts.push(sm._getSearchPanelDomain());
      return Domain.and(parts).toList(evalCtx(sm));
    } catch {
      return sm.domain;
    }
  }

  function ownedMap(sm) {
    let map = owned.get(sm);
    if (!map) owned.set(sm, (map = new Map()));
    return map;
  }

  function activeGroupIds(sm) {
    return new Set(sm.facets.map((f) => f.groupId));
  }

  /** Forget keys whose facet was removed from the search bar. */
  function pruneOwned(sm) {
    const map = ownedMap(sm);
    const live = activeGroupIds(sm);
    for (const [key, groupId] of map) if (!live.has(groupId)) map.delete(key);
    return map;
  }

  function formResId(view) {
    if (view.env.config.viewType !== "form") return null;
    for (const node of walk()) {
      const c = node.component;
      const root = c && c.model && c.model.root;
      if (c && c.env && c.env.searchModel === view.sm && root && typeof root.resId === "number") return root.resId;
    }
    return null;
  }

  function serverVersion() {
    const mod = modules().get("@web/session");
    const info = mod && mod.session && mod.session.server_version_info;
    return info || null;
  }

  function context() {
    const view = activeView();
    if (!view) {
      return {
        available: false,
        reason: owlRoot() ? "Open a list, kanban, pivot, graph or form view." : "This page doesn't look like the Odoo web client.",
        version: serverVersion(),
      };
    }
    const { sm, env } = view;
    const map = pruneOwned(sm);
    const byGroup = new Map([...map].map(([k, g]) => [g, k]));
    const facets = sm.facets.map((f) => ({
      groupId: f.groupId,
      type: f.type,
      title: f.title || "",
      values: (f.values || []).map(String),
      key: byGroup.get(f.groupId) || null,
      domain: f.type === "groupBy" ? null : f.domain ? toList(f.domain, sm) : groupDomain(sm, f.groupId),
    }));
    const excl = {};
    for (const f of facets) if (f.key) excl[f.key] = domainWithout(sm, f.groupId);
    const searchFields = new Set();
    for (const item of Object.values(sm.searchItems || {})) {
      if (item.fieldName && ["field", "groupBy", "dateFilter", "dateGroupBy"].includes(item.type)) searchFields.add(item.fieldName);
    }
    for (const section of (sm.sections && sm.sections.values()) || []) if (section.fieldName) searchFields.add(section.fieldName);
    let displayName = "";
    try {
      displayName = env.config.getDisplayName ? env.config.getDisplayName() : "";
    } catch {
      /* ignore */
    }
    return {
      available: true,
      version: serverVersion(),
      resModel: sm.resModel,
      viewType: env.config.viewType,
      displayName,
      resId: formResId(view),
      domain: sm.domain,
      globalDomain: toList(sm.globalDomain, sm),
      context: sm.context,
      groupBy: sm.groupBy,
      facets,
      excl,
      searchFields: [...searchFields],
      shareQuery: typeof sm.generateQueryString === "function" ? sm.generateQueryString() : null,
    };
  }

  function requireView() {
    const view = activeView();
    if (!view) throw new Error("No Odoo search view is active on this page.");
    return view;
  }

  /** Replace (or create) the facet owned by `key`. An empty domain just removes it. */
  function apply({ key, label, domain }) {
    const { sm } = requireView();
    const map = pruneOwned(sm);
    const Domain = DomainClass();
    const old = map.get(key);
    const hasDomain = Array.isArray(domain) && domain.length;
    sm.blockNotification = true;
    try {
      if (old !== undefined) sm.deactivateGroup(old);
      map.delete(key);
      if (hasDomain) {
        const groupId = sm.nextGroupId;
        // tagged so the Presets list can leave OoFind's own (possibly removed) filters out
        sm.createNewFilters([{ description: label, domain: new Domain(domain).toString(), oofind: true }]);
        map.set(key, groupId);
      }
    } finally {
      sm.blockNotification = false;
    }
    sm._notify();
    return true;
  }

  /** Remove every filter facet (groupBys stay), then add `domain` as one facet. */
  function replaceAll({ key, label, domain }) {
    const { sm } = requireView();
    sm.blockNotification = true;
    try {
      for (const facet of sm.facets) if (facet.type !== "groupBy") sm.deactivateGroup(facet.groupId);
      ownedMap(sm).clear();
    } finally {
      sm.blockNotification = false;
    }
    return apply({ key, label, domain });
  }

  function removeFacet({ groupId }) {
    const { sm } = requireView();
    sm.deactivateGroup(groupId);
    return true;
  }

  async function saveFavorite({ name, isShared, isDefault }) {
    const { sm } = requireView();
    const params = { description: name, isDefault: !!isDefault, isShared: !!isShared };
    return await sm.createNewFavorite(params);
  }

  /** Activate an ir.filters favorite that belongs to this action; false if it isn't one of them. */
  function applyFavorite({ id }) {
    const { sm } = requireView();
    const item = Object.values(sm.searchItems).find((i) => i.type === "favorite" && i.serverSideId === id);
    if (!item) return false;
    sm.blockNotification = true;
    try {
      for (const facet of sm.facets) if (facet.type !== "groupBy") sm.deactivateGroup(facet.groupId);
    } finally {
      sm.blockNotification = false;
    }
    sm.toggleSearchItem(item.id);
    return true;
  }

  function findDatapoint(list, dataId) {
    if (!list) return null;
    for (const rec of list.records || []) if (rec.id === dataId) return rec;
    for (const group of list.groups || []) {
      const hit = findDatapoint(group.list, dataId);
      if (hit) return hit;
    }
    return null;
  }

  /** Map a list row's data-id (a datapoint id) to the record id. */
  function rowResId({ dataId }) {
    for (const node of walk()) {
      const c = node.component;
      const root = c && c.model && c.model.root;
      if (!root) continue;
      const rec = findDatapoint(root, dataId);
      if (rec && typeof rec.resId === "number") return { resId: rec.resId, resModel: rec.resModel };
    }
    return null;
  }

  // Poll only while the panel is open.
  let timer = null;
  function watch({ on }) {
    clearInterval(timer);
    timer = null;
    if (on) {
      timer = setInterval(poll, 700);
      poll();
    } else if (watched) {
      watched.removeEventListener("update", onUpdate);
      watched = null;
    }
    return true;
  }

  /** Run several SearchModel mutations with a single reload at the end. */
  function batch(sm, fn) {
    sm.blockNotification = true;
    try {
      fn();
    } finally {
      sm.blockNotification = false;
    }
    sm._notify();
  }

  /** Remove every facet: filters, favorites and group-bys (the default group-by too). */
  function clearAll() {
    const { sm } = requireView();
    batch(sm, () => {
      for (const facet of sm.facets) sm.deactivateGroup(facet.groupId);
      ownedMap(sm).clear();
    });
    return true;
  }

  /** Back to what the menu shows when it is opened: default favorite, or default filters and group-bys. */
  function resetDefaults() {
    const { sm } = requireView();
    batch(sm, () => {
      sm.query = [];
      sm.orderByCount = false;
      ownedMap(sm).clear();
      const gb = initialGroupBy.get(sm);
      if (gb) sm.defaultGroupBy = [...gb];
      const fav = Object.values(sm.searchItems).find((i) => i.type === "favorite" && i.isDefault);
      sm._activateDefaultSearchItems(fav ? fav.id : null);
    });
    return true;
  }

  const ITEM_TYPES = new Set(["filter", "dateFilter", "relativeFilter", "parentFilter", "groupBy", "dateGroupBy"]);

  function itemLabel(sm, item) {
    if (item.type === "field") {
      const v = item.defaultAutocompleteValue;
      return `${item.description}: ${(v && (v.label || v.value)) || ""}`;
    }
    return item.description || item.fieldName || "";
  }

  /** The menu's own filters and group-bys (as in Odoo's search menus) and its defaults. */
  function searchItems() {
    const { sm } = requireView();
    const items = sm.getSearchItems((i) => ITEM_TYPES.has(i.type) && !i.oofind).map((i) => ({
      id: i.id,
      type: i.type,
      description: i.description || i.fieldName || "",
      groupNumber: i.groupNumber || 0,
      isActive: !!i.isActive,
      isDefault: !!i.isDefault,
      custom: !!i.custom,
      fieldName: i.fieldName || null,
      relativeFilterId: i.relativeFilterId || null,
      dateFilterId: i.dateFilterId || null,
      options: (i.options || []).map((o) => ({ id: o.id, description: String(o.description), isActive: !!o.isActive, groupNumber: o.groupNumber || 0 })),
    }));
    const defaults = [];
    const fav = Object.values(sm.searchItems).find((i) => i.type === "favorite" && i.isDefault);
    if (fav) {
      defaults.push({ kind: "favorite", label: fav.description });
    } else {
      for (const i of Object.values(sm.searchItems)) {
        if (!i.isDefault || i.type === "favorite") continue;
        let label = itemLabel(sm, i);
        if (i.type === "relativeFilter" && i.defaultOptionId) {
          const opt = (i.options || []).find((o) => o.id === i.defaultOptionId);
          if (opt) label += `: ${opt.description}`;
        }
        defaults.push({ kind: /groupBy/i.test(i.type) ? "groupBy" : "filter", label, rank: i.defaultRank || 100 });
      }
      defaults.sort((a, b) => a.rank - b.rank);
    }
    const gb = initialGroupBy.get(sm);
    if (gb) {
      for (const g of gb) {
        const [name, interval] = g.split(":");
        const f = sm.searchViewFields[name];
        defaults.push({ kind: "groupBy", label: `${(f && f.string) || name}${interval ? `: ${interval}` : ""}` });
      }
    }
    return { items, defaults, groupBy: sm.groupBy, hasDefaultFavorite: !!fav };
  }

  /** Toggle one of the menu's items (with an option for date filters / date group-bys). */
  function toggleItem({ id, optionId }) {
    const { sm } = requireView();
    const item = sm.searchItems[id];
    if (!item) throw new Error("This filter no longer exists. Refresh the panel.");
    switch (item.type) {
      case "dateFilter":
        if (typeof sm.toggleDateFilter === "function") sm.toggleDateFilter(id, optionId);
        else sm.toggleParentFilter(id, optionId);
        break;
      case "relativeFilter":
        sm.toggleRelativeFilter(id, optionId);
        break;
      case "parentFilter":
        sm.toggleParentFilter(id, optionId);
        break;
      case "dateGroupBy":
        sm.toggleDateGroupBy(id, optionId);
        break;
      default:
        sm.toggleSearchItem(id);
    }
    return true;
  }

  function addGroupBy({ fieldName, interval }) {
    const { sm } = requireView();
    if (!sm.searchViewFields[fieldName]) throw new Error(`"${fieldName}" can't be used to group this view.`);
    // reuse the menu's own group-by for that field when there is one
    const existing = sm.getSearchItems((i) => (i.type === "groupBy" || i.type === "dateGroupBy") && i.fieldName === fieldName)[0];
    if (existing) {
      if (existing.type === "dateGroupBy") {
        const opt = interval || sm.searchItems[existing.id].defaultIntervalId;
        if (!existing.options.some((o) => o.id === opt && o.isActive)) sm.toggleDateGroupBy(existing.id, opt);
      } else if (!existing.isActive) {
        sm.toggleSearchItem(existing.id);
      }
      return true;
    }
    sm.createNewGroupBy(fieldName, interval ? { interval } : {});
    return true;
  }

  /** Replace the grouping with `specs` ("field" or "field:interval"), in that order. */
  function setGroupBy({ specs }) {
    const { sm } = requireView();
    batch(sm, () => {
      for (const facet of sm.facets) if (facet.type === "groupBy") sm.deactivateGroup(facet.groupId);
      for (const spec of specs) {
        const [fieldName, interval] = spec.split(":");
        const existing = Object.values(sm.searchItems).find((i) => (i.type === "groupBy" || i.type === "dateGroupBy") && i.fieldName === fieldName);
        if (existing && existing.type === "dateGroupBy") sm.toggleDateGroupBy(existing.id, interval || existing.defaultIntervalId);
        else if (existing) sm.toggleSearchItem(existing.id);
        else if (sm.searchViewFields[fieldName]) sm.createNewGroupBy(fieldName, interval ? { interval } : {});
      }
    });
    return true;
  }

  const COMMANDS = {
    context, apply, replaceAll, removeFacet, saveFavorite, applyFavorite, rowResId, watch,
    clearAll, resetDefaults, searchItems, toggleItem, addGroupBy, setGroupBy,
  };

  document.addEventListener("oofind:req", async (ev) => {
    let req;
    try {
      req = JSON.parse(ev.detail);
    } catch {
      return;
    }
    let reply;
    try {
      const fn = COMMANDS[req.cmd];
      if (!fn) throw new Error(`Unknown command ${req.cmd}`);
      reply = { id: req.id, ok: true, result: await fn(req.args || {}) };
    } catch (e) {
      reply = { id: req.id, ok: false, error: String((e && e.message) || e) };
    }
    document.dispatchEvent(new CustomEvent("oofind:res", { detail: JSON.stringify(reply) }));
  });

  function notify() {
    document.dispatchEvent(new CustomEvent("oofind:changed", { detail: "{}" }));
  }

  function onUpdate() {
    notify();
  }

  // Follow the active SearchModel: actions switch it, its "update" event fires on every search change.
  function poll() {
    const view = activeView();
    const sm = view ? view.sm : null;
    if (sm !== watched) {
      if (watched) watched.removeEventListener("update", onUpdate);
      watched = sm;
      if (sm) sm.addEventListener("update", onUpdate);
      notify();
      return;
    }
    const sig = view ? `${view.env.config.viewType}:${formResId(view)}` : "";
    if (sig !== lastSignature) {
      lastSignature = sig;
      notify();
    }
  }
})();
