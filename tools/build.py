"""Build Chrome and Firefox packages into dist/.

    python3 tools/build.py

Produces dist/chrome/, dist/firefox/ (load unpacked) and
dist/oofind-<version>-{chrome,firefox}.zip (store uploads).
The root manifest.json works in both browsers for development; the build
removes the keys each browser doesn't use so the stores show no warnings.
"""
import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
INCLUDE = ["src", "LICENSE", "README.md"]
# Injected at runtime by src/background.js (scripting.executeScript).
INJECTED = ["src/page/bridge.js", "src/shared/domain.js", "src/content/panel-css.js", "src/content/oofind.js"]


def manifest_for(browser):
    manifest = json.loads((ROOT / "manifest.json").read_text())
    if browser == "chrome":
        manifest["background"] = {"service_worker": manifest["background"]["service_worker"]}
        manifest.pop("browser_specific_settings", None)
    else:
        manifest["background"] = {"scripts": manifest["background"]["scripts"]}
    return manifest


def check_files(manifest, out):
    """Fail the build if the manifest or the background points at a file that isn't packaged."""
    paths = list(manifest["icons"].values()) + list(manifest["action"]["default_icon"].values())
    paths += manifest["background"].get("scripts", []) + [manifest["background"].get("service_worker")]
    paths += INJECTED
    missing = [p for p in paths if p and not (out / p).is_file()]
    if missing:
        raise SystemExit(f"Missing files referenced by manifest: {missing}")
    background = (ROOT / "src/background.js").read_text()
    if any(f'"{p}"' not in background for p in INJECTED):
        raise SystemExit("tools/build.py INJECTED is out of sync with src/background.js FILES")


def build(browser, version):
    out = DIST / browser
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    for name in INCLUDE:
        src = ROOT / name
        if src.is_dir():
            shutil.copytree(src, out / name)
        elif src.exists():
            shutil.copy2(src, out / name)
    manifest = manifest_for(browser)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    check_files(manifest, out)

    archive = DIST / f"oofind-{version}-{browser}.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(out.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(out).as_posix())
    print(f"{browser:8} {out.relative_to(ROOT)}/  {archive.relative_to(ROOT)}")


def main():
    version = json.loads((ROOT / "manifest.json").read_text())["version"]
    DIST.mkdir(exist_ok=True)
    for browser in ("chrome", "firefox"):
        build(browser, version)


if __name__ == "__main__":
    main()
