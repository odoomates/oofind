"""Run the OoFind unit tests in headless Chrome.

    python3 tools/run_tests.py
"""
import functools
import html
import http.server
import json
import re
import shutil
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def find_chrome():
    for name in ("google-chrome", "chromium", "chromium-browser", "chrome"):
        if path := shutil.which(name):
            return path
    raise SystemExit("Chrome/Chromium not found")


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}/tests/index.html"
    try:
        dom = subprocess.run(
            [find_chrome(), "--headless=new", "--disable-gpu", "--no-first-run", "--virtual-time-budget=5000",
             "--dump-dom", url],
            capture_output=True, text=True, timeout=60,
        ).stdout
    finally:
        server.shutdown()
    match = re.search(r'<pre id="results">(.*?)</pre>', dom, re.S)
    if not match:
        print("No test results; page output:\n", dom[:2000])
        return 1
    results = json.loads(html.unescape(match.group(1)))
    failed = [r for r in results if not r["ok"]]
    for r in results:
        print(("PASS " if r["ok"] else "FAIL ") + r["name"] + ("" if r["ok"] else f"\n     {r['error']}"))
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
