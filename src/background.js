/* OoFind background: injects (or toggles) the search panel in the active tab
 * when the toolbar button or the keyboard shortcut is used.
 *
 * Two scripts go in: a small bridge into the page's own JS world (it talks to
 * Odoo's live SearchModel), then the panel into the extension's isolated
 * world. Injection relies on the activeTab permission, so OoFind never has
 * standing access to any site.
 */
const api = globalThis.browser || globalThis.chrome;

const PAGE_FILES = ["src/page/bridge.js"];
const FILES = ["src/shared/domain.js", "src/content/panel-css.js", "src/content/oofind.js"];

async function toggle(tab) {
  if (!tab || tab.id === undefined) return;
  try {
    await api.scripting.executeScript({ target: { tabId: tab.id }, files: PAGE_FILES, world: "MAIN" });
    await api.scripting.executeScript({ target: { tabId: tab.id }, files: FILES });
    api.action.setBadgeText({ tabId: tab.id, text: "" });
  } catch (e) {
    // chrome://, about:, the web stores, PDF viewers... can't be scripted.
    api.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#c0392b" });
    api.action.setBadgeText({ tabId: tab.id, text: "!" });
    api.action.setTitle({ tabId: tab.id, title: `OoFind can't run on this page: ${e && e.message ? e.message : e}` });
  }
}

api.action.onClicked.addListener(toggle);
