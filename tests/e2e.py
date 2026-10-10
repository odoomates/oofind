"""End-to-end test against a real Odoo server (16+).

Opens Odoo in headless Chrome, logs in, injects the bridge into the page world
and the panel into an isolated world exactly like the background's
scripting.executeScript does, then drives the panel and checks that Odoo's own
search bar and results follow.

    python3 tests/e2e.py --url http://127.0.0.1:8020 --db mydb [--login admin --password admin]

Needs the Sales app with demo data.
"""
import argparse
import base64
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE_SCRIPTS = ["src/page/bridge.js"]
SCRIPTS = ["src/shared/domain.js", "src/content/panel-css.js", "src/content/oofind.js"]


class WebSocket:
    """Minimal client WebSocket (text frames only), enough for CDP."""

    def __init__(self, url):
        m = re.match(r"ws://([^:/]+):(\d+)(/.*)?", url)
        host, port, path = m.group(1), int(m.group(2)), m.group(3) or "/"
        self.sock = socket.create_connection((host, port))
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
        response = b""
        while b"\r\n\r\n" not in response:
            response += self.sock.recv(1)
        assert b" 101 " in response.split(b"\r\n")[0], response

    def send(self, text):
        payload = text.encode()
        mask = os.urandom(4)
        n = len(payload)
        if n < 126:
            header = bytes([0x81, 0x80 | n])
        elif n < 65536:
            header = bytes([0x81, 0x80 | 126]) + struct.pack(">H", n)
        else:
            header = bytes([0x81, 0x80 | 127]) + struct.pack(">Q", n)
        self.sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def _exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("browser connection closed")
            buf += chunk
        return buf

    def recv(self):
        message = b""
        while True:
            b1, b2 = self._exact(2)
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._exact(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._exact(8))[0]
            message += self._exact(n)
            if b1 & 0x80:
                return message.decode()


class Chrome:
    def __init__(self, binary, profile, size=None):
        self.proc = subprocess.Popen(
            [binary, "--headless=new", "--remote-debugging-port=0", f"--user-data-dir={profile}", "--no-first-run",
             "--no-default-browser-check", "--disable-gpu", "--window-size=1400,900", "about:blank"],
            stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, text=True)
        for line in self.proc.stderr:
            if m := re.search(r"DevTools listening on (ws://\S+)", line):
                break
        else:
            raise SystemExit("Chrome failed to start")
        self.ws = WebSocket(m.group(1))
        self.next_id = 0
        target = self.send("Target.createTarget", {"url": "about:blank"})["targetId"]
        self.session = self.send("Target.attachToTarget", {"targetId": target, "flatten": True})["sessionId"]
        self.send("Page.enable", session=self.session)
        if size:
            w, h = size
            self.send("Emulation.setDeviceMetricsOverride", {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False}, session=self.session)

    def send(self, method, params=None, session=None):
        self.next_id += 1
        msg = {"id": self.next_id, "method": method, "params": params or {}}
        if session:
            msg["sessionId"] = session
        self.ws.send(json.dumps(msg))
        while True:
            reply = json.loads(self.ws.recv())
            if reply.get("id") == self.next_id:
                if "error" in reply:
                    raise RuntimeError(f"{method}: {reply['error']}")
                return reply["result"]

    def page(self, method, params=None):
        return self.send(method, params, self.session)

    def navigate(self, url):
        self.page("Page.navigate", {"url": url})
        origin = "/".join(url.split("/")[:3])
        self.wait(f"document.readyState === 'complete' && location.origin === {json.dumps(origin)}")

    def evaluate(self, expression, context=None):
        params = {"expression": expression, "awaitPromise": True, "returnByValue": True}
        if context:
            params["contextId"] = context
        res = self.page("Runtime.evaluate", params)
        if "exceptionDetails" in res:
            raise RuntimeError(res["exceptionDetails"].get("exception", {}).get("description") or res["exceptionDetails"])
        return res["result"].get("value")

    def wait(self, expression, context=None, timeout=30):
        deadline = time.time() + timeout
        error = None
        while time.time() < deadline:
            try:
                value = self.evaluate(expression, context)
                if value:
                    return value
            except RuntimeError as e:
                error = e
            time.sleep(0.2)
        raise TimeoutError(f"Timed out waiting for: {expression} ({error})")

    def close(self):
        self.proc.terminate()
        self.proc.wait(10)

    KEYS = {"Enter": ("Enter", 13, "\r"), "Escape": ("Escape", 27, ""), "ArrowDown": ("ArrowDown", 40, ""), "ArrowUp": ("ArrowUp", 38, ""), "Tab": ("Tab", 9, "")}

    def key(self, name):
        code, vk, text = self.KEYS[name]
        params = {"key": name, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk}
        self.page("Input.dispatchKeyEvent", {"type": "keyDown", **params, **({"text": text} if text else {})})
        self.page("Input.dispatchKeyEvent", {"type": "keyUp", **params})

    def isolated_world(self, name):
        frame = self.page("Page.getFrameTree")["frameTree"]["frame"]["id"]
        return self.page("Page.createIsolatedWorld", {"frameId": frame, "worldName": name})["executionContextId"]

    def screenshot(self):
        return base64.b64decode(self.page("Page.captureScreenshot", {"format": "png"})["data"])

    def mouse(self, kind, x, y, pressed=False):
        """kind: move | down | up (left button)."""
        cdp = {"move": "mouseMoved", "down": "mousePressed", "up": "mouseReleased"}[kind]
        self.page("Input.dispatchMouseEvent", {"type": cdp, "x": x, "y": y, "button": "left",
                                               "buttons": 1 if (pressed or kind == "down") and kind != "up" else 0, "clickCount": 1})


def remote_value(v):
    """WebDriver BiDi RemoteValue -> Python."""
    t = v.get("type")
    if t in ("undefined", "null"):
        return None
    if t in ("string", "boolean"):
        return v["value"]
    if t == "number":
        val = v["value"]
        return None if isinstance(val, str) else val  # NaN, Infinity, -0
    if t == "array":
        return [remote_value(x) for x in v.get("value", [])]
    if t == "object":
        return {k if isinstance(k, str) else remote_value(k): remote_value(x) for k, x in v.get("value", [])}
    return v.get("value")


class Firefox:
    """The same driver interface as Chrome, over WebDriver BiDi.

    The panel runs in a BiDi sandbox: like a content script, it sees the page
    through Xray wrappers, so Firefox-specific cross-world behaviour is exercised.
    The real dist/firefox package is installed too, so Firefox validates it.
    """

    def __init__(self, binary, profile, extension=None):
        (Path(profile) / "user.js").write_text(
            'user_pref("browser.shell.checkDefaultBrowser", false);\n'
            'user_pref("datareporting.policy.dataSubmissionEnabled", false);\n'
            'user_pref("browser.startup.homepage_override.mstone", "ignore");\n')
        self.proc = subprocess.Popen(
            [binary, "--headless", "--remote-debugging-port=0", "--profile", profile, "--no-remote", "about:blank"],
            stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, text=True)
        for line in self.proc.stderr:
            if m := re.search(r"WebDriver BiDi listening on (ws://\S+)", line):
                break
        else:
            raise SystemExit("Firefox failed to start")
        self.ws = WebSocket(m.group(1).rstrip("/") + "/session")
        self.next_id = 0
        self.send("session.new", {"capabilities": {}})
        self.context = self.send("browsingContext.getTree", {})["contexts"][0]["context"]
        self.send("browsingContext.setViewport", {"context": self.context, "viewport": {"width": 1400, "height": 900}})
        self.pressed = False
        if extension:
            self.extension = self.send("webExtension.install", {"extensionData": {"type": "path", "path": str(extension)}})["extension"]

    def send(self, method, params=None):
        self.next_id += 1
        self.ws.send(json.dumps({"id": self.next_id, "method": method, "params": params or {}}))
        while True:
            reply = json.loads(self.ws.recv())
            if reply.get("id") == self.next_id:
                if reply.get("type") == "error":
                    raise RuntimeError(f"{method}: {reply.get('error')}: {reply.get('message')}")
                return reply["result"]

    def navigate(self, url):
        self.send("browsingContext.navigate", {"context": self.context, "url": url, "wait": "complete"})

    def evaluate(self, expression, context=None):
        target = {"context": self.context}
        if context:
            target["sandbox"] = context
        res = self.send("script.evaluate", {"expression": expression, "target": target, "awaitPromise": True,
                                            "resultOwnership": "none", "serializationOptions": {"maxObjectDepth": 6}})
        if res["type"] == "exception":
            raise RuntimeError(res["exceptionDetails"].get("text") or res["exceptionDetails"])
        return remote_value(res["result"])

    wait = Chrome.wait

    def isolated_world(self, name):
        return name

    BIDI_KEYS = {"Enter": "\ue007", "Escape": "\ue00c", "ArrowDown": "\ue015", "ArrowUp": "\ue013", "Tab": "\ue004"}

    def key(self, name):
        k = self.BIDI_KEYS[name]
        self.send("input.performActions", {"context": self.context, "actions": [
            {"type": "key", "id": "kbd", "actions": [{"type": "keyDown", "value": k}, {"type": "keyUp", "value": k}]}]})

    def screenshot(self):
        return base64.b64decode(self.send("browsingContext.captureScreenshot", {"context": self.context})["data"])

    def mouse(self, kind, x, y, pressed=False):
        actions = [{"type": "pointerMove", "x": round(x), "y": round(y)}]
        if kind == "down":
            actions.append({"type": "pointerDown", "button": 0})
        elif kind == "up":
            actions.append({"type": "pointerUp", "button": 0})
        self.send("input.performActions", {"context": self.context, "actions": [
            {"type": "pointer", "id": "mouse", "parameters": {"pointerType": "mouse"}, "actions": actions}]})

    def close(self):
        try:
            self.send("session.end", {})
        except Exception:  # noqa: BLE001
            pass
        self.proc.terminate()
        self.proc.wait(10)


# Runs in the isolated world before the panel: a storage stub standing in for
# browser.storage, and a hook that keeps a handle on the (closed) shadow root.
PRELUDE = """
(() => {
  // settings saved under the extension's former name, to check they are migrated
  const data = { "searcho.width": 500, "searcho.pins": { "sale.order": ["team_id"] } };
  const pick = (k) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => x in data).map((x) => [x, JSON.parse(JSON.stringify(data[x]))]));
  globalThis.browser = { storage: { local: {
    async get(k) { return pick(k); },
    async set(o) { Object.assign(data, JSON.parse(JSON.stringify(o))); },
    async remove(k) { for (const x of Array.isArray(k) ? k : [k]) delete data[x]; },
  } } };
  globalThis.__store = data;
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (o) { return (globalThis.__root = attach.call(this, o)); };
})();
"""

HELPERS = """
globalThis.T = {
  q: (s) => __root.querySelector(s),
  qa: (s) => [...__root.querySelectorAll(s)],
  tab: (k) => __root.querySelector(`nav.tabs [data-tab=${k}]`).click(),
  card: (label) => T.qa('.card').find(c => c.querySelector('.card-title').textContent === label),
  facets: () => [...document.querySelectorAll('.o_searchview_facet')].map(f => f.textContent.replace(/\\s+/g, ' ').trim()),
  status: () => T.q('.status').textContent,
  rows: () => document.querySelectorAll('.o_data_row').length,
};
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8069")
    ap.add_argument("--db", required=True)
    ap.add_argument("--login", default="admin")
    ap.add_argument("--password", default="admin")
    ap.add_argument("--browser", choices=["chrome", "firefox"], default="chrome")
    ap.add_argument("--binary", default=shutil.which("google-chrome") or shutil.which("chromium"))
    ap.add_argument("--firefox", default=shutil.which("firefox"))
    ap.add_argument("--screenshot", help="save PNGs of the panel with this prefix")
    ap.add_argument("--size", default="1400x900", help="viewport WIDTHxHEIGHT (store screenshots: 1280x800)")
    ap.add_argument("--dark", action="store_true", help="darken the Odoo page first: the panel must follow its colours")
    ap.add_argument("--panel-width", type=int, help="start the panel at this width (layout checks)")
    opts = ap.parse_args()

    # snap-packaged Firefox can only use profiles inside its own snap directory
    snap_dir = Path.home() / "snap" / "firefox" / "common"
    profile_root = str(snap_dir) if opts.browser == "firefox" and snap_dir.is_dir() else None
    profile = tempfile.mkdtemp(prefix="oofind-e2e-", dir=profile_root)
    if opts.browser == "firefox":
        chrome = Firefox(opts.firefox, profile, ROOT / "dist" / "firefox")
    else:
        chrome = Chrome(opts.binary, profile, tuple(map(int, opts.size.split("x"))))
    results = []

    def check(name, fn):
        try:
            fn()
            results.append((name, None))
        except Exception as e:  # noqa: BLE001 - report every failure
            results.append((name, f"{type(e).__name__}: {e}"))

    def shot(name):
        if opts.screenshot:
            Path(f"{opts.screenshot}-{name}.png").write_bytes(chrome.screenshot())

    try:
        chrome.navigate(f"{opts.url}/web/login?db={opts.db}")
        auth = chrome.evaluate(f"""fetch('/web/session/authenticate', {{method: 'POST',
            headers: {{'Content-Type': 'application/json'}},
            body: JSON.stringify({{jsonrpc: '2.0', method: 'call', params: {json.dumps(
                {"db": opts.db, "login": opts.login, "password": opts.password})}}})}})
            .then(r => r.json()).then(r => r.result ? r.result.uid : JSON.stringify(r.error))""")
        assert isinstance(auth, int), f"login failed: {auth}"
        chrome.navigate(f"{opts.url}/web#action=sale.action_orders")  # classic URL: Odoo 17 needs it, 18+ redirect it
        chrome.wait("document.querySelectorAll('.o_data_row').length > 0", timeout=60)
        initial_facets = chrome.evaluate("[...document.querySelectorAll('.o_searchview_facet')].map(f => f.textContent.replace(/\\s+/g, ' ').trim())")
        # start from a clean search bar
        chrome.evaluate("document.querySelectorAll('.o_searchview_facet .o_facet_remove').forEach(b => b.click()); true")
        chrome.wait("document.querySelectorAll('.o_searchview_facet').length === 0")

        ctx = chrome.isolated_world("oofind-e2e")

        def inject():
            for path in PAGE_SCRIPTS:
                chrome.evaluate((ROOT / path).read_text())
            for path in SCRIPTS:
                chrome.evaluate((ROOT / path).read_text(), ctx)

        if opts.dark:
            # a dark Odoo look-alike: dark page and cards, light text (the panel reads these)
            chrome.evaluate("""(() => { const s = document.createElement('style'); s.textContent =
              'body, .o_action_manager, .o_content, .o_list_renderer, .o_control_panel, .card, .o_list_table, .o_list_table th, .o_list_table td, .o_data_row, .modal-content { background-color: #1c1d22 !important; color: #e3e3e8 !important; }';
              document.head.append(s); })(); true""")
        chrome.evaluate(PRELUDE, ctx)
        if opts.panel_width:
            chrome.evaluate(f"__store['oofind.width'] = {opts.panel_width}; true", ctx)
        inject()
        chrome.evaluate(HELPERS, ctx)
        ev = lambda js: chrome.evaluate(js, ctx)  # noqa: E731
        wait = lambda js, timeout=30: chrome.wait(js, ctx, timeout)  # noqa: E731
        page = chrome.evaluate

        def opens():
            wait("T.q('.where') && T.q('.where').title.includes('Model: sale.order') && T.q('.where').textContent === 'Sales Orders'")
            wait("T.qa('.card').length >= 3")
            assert ev("T.q('nav.tabs .active').dataset.tab") == "filters"
        check("panel opens on the sales orders action", opens)

        def pushes():
            # push mode (default): Odoo's page narrows to the panel's left edge, nothing hidden underneath
            wait("document.documentElement.classList.contains('oofind-push')")
            right = page("document.querySelector('.o_action_manager').getBoundingClientRect().right")
            left = ev("T.q('.panel').getBoundingClientRect().left")
            assert abs(right - left) <= 2, (right, left)
        check("push mode: Odoo's page ends where the panel starts", pushes)

        def migrated():
            if not opts.panel_width:
                assert ev("T.q('.panel').style.width") == "500px", ev("T.q('.panel').style.width")
                assert ev("__store['oofind.width']") == 500
            assert ev("'searcho.width' in __store") is False
            assert ev("T.qa('.pin.on').length") == 1, "pinned field carried over"
            ev("T.qa('.pin.on')[0].click(); true")  # unpin: keep the rest of the run unchanged
            wait("T.qa('.pin.on').length === 0")
        check("settings saved under the old name are migrated", migrated)

        def total():
            wait("/\\d+ records/.test(T.q('[data-total]').textContent)")
        check("shows the record count", total)

        def status_filter():
            ev("T.card('Status').querySelector('.card-head').click(); true")
            wait("T.card('Status').querySelectorAll('.val').length >= 3")
            labels = ev("[...T.card('Status').querySelectorAll('.val .lbl')].map(x => x.textContent)")
            assert "Quotation" in labels and "Sales Order" in labels, labels
            n_quot = ev("+[...T.card('Status').querySelectorAll('.val')].find(v => v.querySelector('.lbl').textContent === 'Quotation').querySelector('.num').textContent")
            ev("[...T.card('Status').querySelectorAll('.val')].find(v => v.querySelector('.lbl').textContent === 'Quotation').click(); true")
            wait("T.facets().some(f => f.includes('Status') && f.includes('Quotation'))")
            chrome.wait(f"document.querySelectorAll('.o_data_row').length === {n_quot}", timeout=20)
            wait("T.card('Status').classList.contains('on') && T.card('Status').querySelector('.card-sum').textContent === 'Quotation'")
        check("value bar click adds a native facet and filters the list", status_filter)

        def faceted_counts():
            # counts for Status ignore the Status filter itself, so other values keep their counts
            wait("[...T.card('Status').querySelectorAll('.val')].find(v => v.querySelector('.lbl').textContent === 'Sales Order').querySelector('.num').textContent !== '0'")
            ev("[...T.card('Status').querySelectorAll('.val')].find(v => v.querySelector('.lbl').textContent === 'Sales Order').click(); true")
            wait("T.facets().some(f => f.includes('Quotation') && f.includes('Sales Order'))")
            assert page("document.querySelectorAll('.o_searchview_facet').length") == 1, "same facet replaced, not stacked"
        check("multi-select ORs values in one facet; counts are faceted", faceted_counts)

        def removing_in_odoo_clears():
            page("document.querySelector('.o_searchview_facet .o_facet_remove').click(); true")
            wait("T.facets().length === 0 && !T.card('Status').classList.contains('on')")
        check("removing the facet in Odoo clears the panel selection", removing_in_odoo_clears)

        def mouse(x, y, kinds=("mouseMoved", "mousePressed", "mouseReleased")):
            for kind in kinds:
                chrome.mouse({"mouseMoved": "move", "mousePressed": "down", "mouseReleased": "up"}[kind], x, y)

        def fab_center():
            return ev("(() => { const r = T.q('.fab').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()")

        def auto_collapse():
            assert ev("T.q('[data-act=keep]').getAttribute('aria-pressed')") == "false", "auto-collapse is the default"
            wait("[...T.card('Status').querySelectorAll('.val .lbl')].some(l => l.textContent === 'Quotation')")
            ev("[...T.card('Status').querySelectorAll('.val')].find(v => v.querySelector('.lbl').textContent === 'Quotation').click(); true")
            wait("T.facets().some(f => f.includes('Quotation'))")
            time.sleep(0.4)
            assert ev("!T.q('.panel').hidden"), "value bars keep the panel open for multi-select"
            ev("T.q('.panel').dispatchEvent(new PointerEvent('pointerleave')); true")
            wait("T.q('.panel').hidden && !T.q('.fab').hidden")
            wait("T.q('.fab-badge').textContent === '1' && !T.q('.fab-badge').hidden")
            x, y = fab_center()
            mouse(x, y)
            wait("!T.q('.panel').hidden && T.q('.fab').hidden")
            # a click on the page outside the panel collapses it
            mouse(300, 760)
            wait("T.q('.panel').hidden && !T.q('.fab').hidden")
            x, y = fab_center()
            mouse(x, y)
            wait("!T.q('.panel').hidden")
            lx, ly = ev("(() => { const r = T.q('.logo').getBoundingClientRect(); return [r.left + 5, r.top + 5]; })()")
            mouse(lx, ly)  # clicks inside the panel don't
            time.sleep(0.3)
            assert ev("!T.q('.panel').hidden"), "clicking inside the panel must not collapse it"
            ev("T.q('[data-act=keep]').click(); true")
            assert ev("T.q('[data-act=keep]').getAttribute('aria-pressed')") == "true"
            mouse(300, 760)
            time.sleep(0.3)
            assert ev("!T.q('.panel').hidden"), "keep open: outside clicks don't collapse"
            assert ev("__store['oofind.keepOpen']") is True
            page("document.querySelector('.o_searchview_facet .o_facet_remove').click(); true")
            wait("T.facets().length === 0 && !T.card('Status').classList.contains('on')")
            assert ev("!T.q('.panel').hidden"), "keep open: removing filters doesn't collapse"
        check("auto-collapse to the floating button; badge; reopen; keep open", auto_collapse)

        def date_preset():
            ev("T.qa('.card').find(c => /Order Date|Creation Date/.test(c.querySelector('.card-title').textContent)).querySelector('.card-head').click(); true")
            try:
                wait("!!T.q('.card.open .hist button') || !!T.q('.card.open .hist .muted')")
            except TimeoutError:
                raise AssertionError("date card: " + str(ev("(T.q('.card.open') || {}).textContent || 'no open card: ' + T.qa('.card-title').map(t => t.textContent).join('|')"))
                                     + " | status: " + ev("T.status()") + " | panel hidden: " + str(ev("T.q('.panel').hidden"))) from None
            ev("[...T.qa('.card.open .chip')].find(c => c.textContent === 'This year').click(); true")
            wait("T.facets().some(f => f.includes('This year'))")
            wait("!!T.q('.card.open [data-act=clear-field]')")
            ev("T.q('.card.open [data-act=clear-field]').click(); true")
            wait("T.facets().length === 0")
        check("date preset + histogram; removing from the panel", date_preset)

        def more_fields():
            ev("[...T.qa('.btn')].find(b => b.textContent.startsWith('+ More fields')).click(); true")
            wait("T.qa('.picker li').length > 0")
            ev("var i = T.q('.picker input'); i.value = 'salesperson'; i.dispatchEvent(new Event('input')); true")
            # Salesperson may already be shown; pick whatever matches first
            wait("T.qa('.picker li').length >= 0")
            ev("T.q('.picker .crumbs button').click(); true")
            wait("!T.q('.picker')")
        check("more-fields picker opens and closes", more_fields)

        def builder():
            ev("T.tab('builder'); true")
            wait("[...T.qa('.btn')].some(b => b.textContent === 'Start empty')")
            ev("[...T.qa('.btn')].find(b => b.textContent === 'Start empty').click(); true")
            wait("!!T.q('[data-btext]')")
            ev("""var ta = T.q('[data-btext]'); ta.focus(); ta.value = "[('state', 'in', ['sale']), ('amount_total', '>', 1000)]"; ta.dispatchEvent(new Event('input')); true""")
            try:
                wait("T.qa('.cond').length === 2 && T.q('[data-bsummary]').textContent.includes('Sales Order')")
            except TimeoutError:
                raise AssertionError(f"conds={ev('T.qa(`.cond .path`).map(x => x.textContent)')} summary={ev('T.q(`[data-bsummary]`).textContent')!r} "
                                     f"text={ev('T.q(`[data-btext]`).value')!r} err={ev('T.q(`[data-berr]`).textContent')!r} status={ev('T.status()')!r}") from None
            expected = page("""fetch('/web/dataset/call_kw', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', method: 'call',
                params: {model: 'sale.order', method: 'search_count', args: [[['state', 'in', ['sale']], ['amount_total', '>', 1000]]], kwargs: {}}})}).then(r => r.json()).then(r => r.result)""")
            wait(f"T.q('[data-bcount]').textContent === '{expected}'")
            wait("T.qa('[data-ccount]').every(c => /^\\d+$/.test(c.textContent))")
            ev("[...T.qa('.btn')].find(b => b.textContent === 'Add as filter').click(); true")
            chrome.wait(f"document.querySelectorAll('.o_data_row').length === {expected}", timeout=20)
            assert len(page("[...document.querySelectorAll('.o_searchview_facet')].map(f => f.textContent)")) == 1
        check("builder: python text -> tree, live counts, add as filter", builder)

        def builder_errors():
            ev("""var ta = T.q('[data-btext]'); ta.focus(); ta.value = "[('state', '=', ]"; ta.dispatchEvent(new Event('input')); true""")
            wait("T.q('[data-berr]').textContent.length > 0 && T.q('[data-btext]').classList.contains('bad')")
        check("builder: syntax errors are shown", builder_errors)

        def builder_visual():
            ev("[...T.qa('.btn')].find(b => b.textContent === 'Reset').click(); true")
            wait("T.qa('.cond').length === 1")
            ev("T.q('.cond .path').click(); true")
            wait("T.qa('.picker li').length > 5")
            # drill into Customer > Country
            ev("[...T.qa('.picker li')].find(li => li.querySelector('.tech').textContent === 'partner_id').querySelector('.drill').click(); true")
            wait("T.q('.picker .crumbs').textContent.includes('Customer') && T.qa('.picker li').length > 5")
            ev("[...T.qa('.picker li')].find(li => li.querySelector('.tech').textContent === 'country_id').click(); true")
            wait("T.q('.cond .path').textContent === 'Customer › Country'")
            ev("var i = T.q('.cond .ac input'); i.focus(); i.value = 'United States'; i.dispatchEvent(new Event('input')); true")
            wait("T.qa('.cond .ac li').length > 0")
            ev("T.q('.cond .ac li').dispatchEvent(new MouseEvent('mousedown', {bubbles: true})); true")
            wait("T.q('[data-btext]').value.includes(`'partner_id.country_id', 'in'`)")
        check("builder: field path drill-down and record picker", builder_visual)
        if opts.screenshot:
            ev("T.q('.cond .ac input').blur(); true")
            time.sleep(0.4)
            try:  # cosmetic: let the count settle before the screenshot
                wait("T.q('[data-bcount]').textContent !== '…'", timeout=10)
            except TimeoutError:
                pass
            time.sleep(0.6)
        shot("builder")

        def explain():
            # explain a quotation against the "sale & > 1000" filter added above
            rid = page("""fetch('/web/dataset/call_kw', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', method: 'call',
                params: {model: 'sale.order', method: 'search', args: [[['state', '=', 'draft']]], kwargs: {limit: 1}}})}).then(r => r.json()).then(r => r.result[0])""")
            ev("T.tab('explain'); true")
            wait("!!T.q('.ac input')")
            ev(f"var i = T.q('.ac input'); i.value = '#{rid}'; i.dispatchEvent(new Event('input')); true")
            wait("T.qa('.ac li').length === 1")
            ev("T.q('.ac li').dispatchEvent(new MouseEvent('mousedown', {bubbles: true})); true")
            wait("!!T.q('.verdict')", timeout=40)
            verdict = ev("T.q('.verdict').textContent")
            assert "filtered out" in verdict, verdict
            causes = ev("T.qa('.causes li').map(li => li.textContent)")
            assert any("Status" in c and "Quotation" in c for c in causes), causes
            assert ev("T.qa('.xnode.no').length >= 1 && T.qa('.xnode.yes').length >= 0")
        check("explain: a quotation is filtered out by the status condition", explain)

        def explain_match():
            rid = page("""fetch('/web/dataset/call_kw', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', method: 'call',
                params: {model: 'sale.order', method: 'search', args: [[['state', '=', 'sale'], ['amount_total', '>', 1000]]], kwargs: {limit: 1}}})}).then(r => r.json()).then(r => r.result[0])""")
            ev(f"var i = T.q('.ac input'); i.value = '#{rid}'; i.dispatchEvent(new Event('input')); true")
            wait("T.qa('.ac li').length === 1")
            ev("T.q('.ac li').dispatchEvent(new MouseEvent('mousedown', {bubbles: true})); true")
            wait("!!T.q('.verdict.ok')", timeout=40)
        check("explain: a matching record is reported as in the results", explain_match)

        def explain_pick_row():
            ev("[...T.qa('.btn')].find(b => b.textContent.startsWith('Pick a row')).click(); true")
            wait("!!document.querySelector('oofind-root') && T.q('.btn.primary') && T.q('.btn.primary').textContent.startsWith('Click a row')")
            ev("T.q('.verdict').remove(); true")
            box = page("(() => { const r = document.querySelectorAll('.o_data_row')[1].getBoundingClientRect(); return [r.left + 40, r.top + r.height / 2]; })()")
            for kind in ("mouseMoved", "mousePressed", "mouseReleased"):
                chrome.mouse({"mouseMoved": "move", "mousePressed": "down", "mouseReleased": "up"}[kind], box[0], box[1])
            wait("!!T.q('.verdict.ok')", timeout=40)
            assert not page("!!document.querySelector('.o_form_view')"), "row click must not open the form: " + page("location.pathname")
        check("explain: pick a row from the list", explain_pick_row)
        shot("explain")

        fav_name = f"OoFind e2e {int(time.time())}"

        def saved():
            ev("T.tab('saved'); true")
            wait("!!T.q('.form input')")
            ev(f"var i = T.q('.form input'); i.value = {json.dumps(fav_name)}; true")
            ev("[...T.qa('.btn')].find(b => b.textContent === 'Save').click(); true")
            wait(f"T.qa('.item .name').some(n => n.textContent.includes({json.dumps(fav_name)}))", timeout=30)
            assert ev("T.qa('.item').length") >= 2, "recent searches listed too"
            page("document.querySelectorAll('.o_searchview_facet .o_facet_remove').forEach(b => b.click()); true")
            wait("T.facets().length === 0")
            ev(f"T.qa('.item .main').find(m => m.textContent.includes({json.dumps(fav_name)})).click(); true")
            wait(f"T.facets().some(f => f.includes({json.dumps(fav_name)}))")
        check("saved: save as native favorite and re-apply it", saved)
        shot("saved")

        # clean up the favorite
        page(f"""fetch('/web/dataset/call_kw', {{method: 'POST', headers: {{'Content-Type': 'application/json'}}, body: JSON.stringify({{jsonrpc: '2.0', method: 'call',
            params: {{model: 'ir.filters', method: 'search', args: [[['name', '=', {json.dumps(fav_name)}]]], kwargs: {{}}}}}})}})
            .then(r => r.json()).then(r => fetch('/web/dataset/call_kw', {{method: 'POST', headers: {{'Content-Type': 'application/json'}}, body: JSON.stringify({{jsonrpc: '2.0', method: 'call',
            params: {{model: 'ir.filters', method: 'unlink', args: [r.result], kwargs: {{}}}}}})}})).then(() => true)""")

        def form_view():
            page("document.querySelectorAll('.o_searchview_facet .o_facet_remove').forEach(b => b.click()); true")
            chrome.wait("document.querySelectorAll('.o_searchview_facet').length === 0")
            page("document.querySelector('.o_data_row td.o_data_cell').click(); true")
            chrome.wait("!!document.querySelector('.o_form_view')", timeout=20)
            ev("T.tab('explain'); true")
            wait("[...T.qa('.btn')].some(b => b.textContent === 'Use the open record')", timeout=20)
        check("form view: explain offers the open record", form_view)

        def filters_screenshot():
            page("history.back(); true")
            chrome.wait("document.querySelectorAll('.o_data_row').length > 0", timeout=20)
            ev("T.tab('filters'); true")
            wait("T.qa('.card').length >= 3")
            ev("if (!T.card('Status').classList.contains('open')) T.card('Status').querySelector('.card-head').click(); true")
            wait("T.card('Status').querySelectorAll('.val').length >= 3")
            ev("[...T.card('Status').querySelectorAll('.val')].find(v => v.querySelector('.lbl').textContent === 'Sales Order').click(); true")
            wait("T.facets().length === 1")
            wait("T.card('Status').querySelectorAll('.val').length >= 3")
            time.sleep(0.6)
        check("back to the list keeps working", filters_screenshot)
        shot("filters")

        def presets():
            ev("T.tab('presets'); true")
            wait("T.q('.body h3') && T.q('.body h3').textContent === 'When you open this menu' && T.qa('.presets .chip').length > 2")
            listed = ev("T.qa('.presets .chip, .preset-name').map(c => c.textContent)")
            assert not any("Quotation or Sales Order" in t or "Total > 1000" in t for t in listed), f"OoFind's own filters must not be listed: {listed}"
            # toggle a predefined filter of the menu
            first = ev("T.q('.presets .chip:not(.on)').textContent")
            before = page("document.querySelectorAll('.o_searchview_facet').length")
            ev("T.q('.presets .chip:not(.on)').click(); true")
            chrome.wait(f"document.querySelectorAll('.o_searchview_facet').length > {before}", timeout=20)
            wait(f"T.qa('.presets .chip.on').some(c => c.textContent === {json.dumps(first)})")
            # a predefined group-by
            ev("T.q('.presets .chip[data-kind=groupBy]').click(); true")
            wait("!!T.q('.presets .chip.on[data-kind=groupBy]') && !!T.q('.gb')")
            # custom group on any field
            ev("const s = [...T.qa('select')].find(x => x.getAttribute('aria-label') === 'Add a custom group'); s.value = 'partner_id'; s.dispatchEvent(new Event('change')); true")
            wait("T.q('.body').textContent.includes('Grouped by') && T.q('.body').textContent.includes('Customer')")
            # two levels now: move the first one later and check the order flips
            wait("T.qa('.gb').length === 2")
            before = ev("T.qa('.gb').map(g => g.dataset.gb)")
            ev("T.qa('.gb')[0].querySelector('[aria-label^=\"Move\"][aria-label$=\"later\"]').click(); true")
            wait(f"JSON.stringify(T.qa('.gb').map(g => g.dataset.gb)) === {json.dumps(json.dumps(before[::-1], separators=(",", ":")))}")
            # clear all
            ev("T.q('[data-act=clear-all]').click(); true")
            try:
                chrome.wait("document.querySelectorAll('.o_searchview_facet').length === 0", timeout=20)
            except TimeoutError:
                raise AssertionError(f"left after clear all: {page('[...document.querySelectorAll(`.o_searchview_facet`)].map(f => f.textContent)')} status={ev('T.status()')}") from None
            wait("T.q('[data-act=clear-all]').hasAttribute('disabled')")
            # reset to the menu's defaults == what the menu showed when it was opened
            ev("T.q('[data-act=reset]').click(); true")
            chrome.wait(f"document.querySelectorAll('.o_searchview_facet').length === {len(initial_facets)}", timeout=20)
            after = page("[...document.querySelectorAll('.o_searchview_facet')].map(f => f.textContent.replace(/\\s+/g, ' ').trim())")
            assert after == initial_facets, (after, initial_facets)
            defaults = ev("T.qa('.facets')[0].textContent")
            assert len(initial_facets) == 0 or defaults, "defaults are listed"
            # a date filter period, for the screenshot
            ev("const b = T.qa('.preset-opt .chip').find(c => /^(This Year|2026)$/.test(c.textContent)) || T.q('.preset-opt .chip'); if (b) b.click(); true")
            time.sleep(1.2)
            shot("presets")
            # clear / reset are on the Filters tab too
            ev("T.tab('filters'); true")
            wait("!!T.q('[data-act=clear-all]') && !!T.q('[data-act=reset]')")
            if initial_facets:
                wait("!T.q('[data-act=clear-all]').hasAttribute('disabled')")
                ev("T.q('[data-act=clear-all]').click(); true")
                chrome.wait("document.querySelectorAll('.o_searchview_facet').length === 0", timeout=20)
        check("presets: menu filters, group-bys, clear all, reset to default", presets)

        def keyboard():
            ev("T.tab('filters'); true")
            wait("!!T.q('[data-omni]')")
            ev("var o = T.q('[data-omni]'); o.focus(); o.value = 'gemini'; o.dispatchEvent(new Event('input')); true")
            wait("T.qa('.hit').some(h => h.textContent.includes('Gemini'))", timeout=20)
            chrome.key("ArrowDown")
            wait("__root.activeElement && __root.activeElement.classList.contains('hit')")
            # walk to the value hit and pick it with Enter
            for _ in range(6):
                if ev("__root.activeElement.textContent.includes('Gemini')"):
                    break
                chrome.key("ArrowDown")
            focused = ev("__root.activeElement && __root.activeElement.outerHTML.slice(0, 160)")
            chrome.key("Enter")
            try:
                wait("T.facets().some(f => f.includes('Gemini'))", timeout=20)
            except TimeoutError:
                raise AssertionError(f"focused before Enter: {focused} | after: {ev('__root.activeElement && __root.activeElement.outerHTML.slice(0, 120)')} | status: {ev('T.status()')}") from None
            page("document.querySelectorAll('.o_searchview_facet .o_facet_remove').forEach(b => b.click()); true")
            wait("T.facets().length === 0")
            # Esc collapses the panel to the button (focused), Enter opens it again
            ev("T.q('[data-omni]').value = ''; T.q('[data-omni]').focus(); true")
            chrome.key("Escape")
            wait("T.q('.panel').hidden && __root.activeElement === T.q('.fab')")
            assert not page("document.documentElement.classList.contains('oofind-push')"), "collapsed: page back to full width"
            chrome.key("Enter")
            wait("!T.q('.panel').hidden")
            # the settings menu: opens, Esc closes it and returns focus to its button
            ev("T.q('[data-act=menu]').click(); true")
            try:
                wait("!T.q('.menu').hidden && !!(__root.activeElement && __root.activeElement.closest('.menu'))", timeout=8)
            except TimeoutError:
                raise AssertionError(ev("JSON.stringify({hidden: T.q('.menu').hidden, kids: T.q('.menu').children.length, active: __root.activeElement && __root.activeElement.outerHTML.slice(0, 120), status: T.status()})")) from None
            chrome.key("Escape")
            wait("T.q('.menu').hidden && __root.activeElement === T.q('[data-act=menu]')")
        check("keyboard: search, arrows + Enter, Esc collapses, menu", keyboard)

        def builder_collapses():
            ev("T.q('[data-act=keep]').click(); true")
            assert ev("T.q('[data-act=keep]').getAttribute('aria-pressed')") == "false"
            ev("T.tab('builder'); true")
            wait("[...T.qa('.btn')].some(b => b.textContent === 'Add as filter')")
            ev("[...T.qa('.btn')].find(b => b.textContent === 'Add as filter').click(); true")
            wait("T.q('.panel').hidden && !T.q('.fab').hidden")
            wait("+T.q('.fab-badge').textContent >= 1")
        check("builder apply collapses at once", builder_collapses)

        def drag_fab():
            x, y = fab_center()
            mouse(x, y, ("mouseMoved", "mousePressed"))
            for k in range(1, 6):
                chrome.mouse("move", x - 30 * k, y - 20 * k, pressed=True)
            mouse(x - 150, y - 100, ("mouseReleased",))
            time.sleep(0.3)
            assert ev("T.q('.panel').hidden"), "dragging must not open the panel"
            nx, ny = fab_center()
            assert abs(nx - (x - 150)) < 3 and abs(ny - (y - 100)) < 3, (x, y, nx, ny)
            assert ev("!!__store['oofind.fab']")
        check("floating button can be dragged", drag_fab)
        shot("collapsed")

        def toggle():
            inject()
            wait("!T.q('.panel').hidden && T.q('.fab').hidden")
            inject()
            wait("T.q('.panel').hidden && !T.q('.fab').hidden")
            inject()
            wait("!T.q('.panel').hidden")
            ev("T.q('[data-act=close]').click(); true")
            assert page("document.querySelector('oofind-root').style.display") == "none"
            inject()
            assert page("document.querySelector('oofind-root').style.display") != "none"
            wait("!T.q('.panel').hidden")
            assert page("document.querySelectorAll('oofind-root').length") == 1
        check("shortcut cycles panel <-> button; close hides everything", toggle)

        errors = page("(window.__oofindErrors || []).length")
        assert not errors
    finally:
        chrome.close()
        shutil.rmtree(profile, ignore_errors=True)

    for name, error in results:
        print(("PASS " if not error else "FAIL ") + name + (f"\n     {error}" if error else ""))
    failed = sum(1 for _, e in results if e)
    print(f"\n{len(results) - failed}/{len(results)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
