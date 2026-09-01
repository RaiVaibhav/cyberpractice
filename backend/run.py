"""CLI entry for the FastAPI backend.

  python -m backend.run [<scenario-id>] [--free|--real] [--random] [--no-open]

Loads .env, builds the React UI on first run, then serves the hub. Honours
HOST/PORT env (deploy platforms set these; use HOST=0.0.0.0 to expose).
"""
import os
import random
import subprocess
import sys
import webbrowser
from pathlib import Path

import uvicorn
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
WEB_INDEX = ROOT / "platform" / "web-dist" / "index.html"

load_dotenv(ROOT / ".env")

# Import after load_dotenv so providers see the env.
from .app import create_app  # noqa: E402
from .engine import Hub  # noqa: E402


def _c(code, s):
    return f"\x1b[{code}m{s}\x1b[0m"


def ensure_ui_built():
    if WEB_INDEX.is_file():
        return
    if not (ROOT / "node_modules" / "vite").exists():
        sys.exit(_c(31, "  ✗ ") + "UI deps not installed. Run `npm install` first, then re-run.")
    print(_c(2, "  Building UI (first run — cached afterwards)…"))
    r = subprocess.run(["npm", "run", "build:ui"], cwd=ROOT)
    if r.returncode != 0:
        sys.exit(_c(31, "  ✗ ") + "UI build failed. Try `npm install` then `npm run build:ui`.")


def main():
    try:
        sys.stdout.reconfigure(line_buffering=True)  # live logs even when redirected
    except Exception:  # noqa: BLE001
        pass
    argv = sys.argv[1:]
    flags = {a for a in argv if a.startswith("-")}
    positional = [a for a in argv if not a.startswith("-")]
    target = positional[0] if positional else None

    opts = {"real": "--real" in flags, "free": "--free" in flags}
    if opts["real"] and opts["free"]:
        sys.exit(_c(31, "  ✗ ") + "Pick one of --real or --free, not both.")

    hub = Hub(opts)

    if "--list" in flags or "-l" in flags:
        print("\n  " + _c(1, "Scenarios") + "\n")
        for s in hub.list():
            print(f"    {_c(32, '●')} {s['id']}  {_c(2, '· ' + s['difficulty'])}")
        print()
        return

    ensure_ui_built()

    # Resolve the starting scenario: exact id, unique tail match, or random.
    ids = hub.ids()
    start_id = None
    if target and "--random" not in flags:
        start_id = next((i for i in ids if i == target or i.endswith("/" + target)), None)
        if not start_id:
            matches = [i for i in ids if target.lower() in i.lower()]
            if len(matches) == 1:
                start_id = matches[0]
            else:
                sys.exit(_c(31, "  ✗ ") + f'No unique scenario matches "{target}". Try one of:\n    ' + "\n    ".join(ids))
    else:
        start_id = random.choice(ids)
    session = hub.select(start_id)
    scenario = session.scenario

    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "4173"))
    url = f"http://{'localhost' if host in ('127.0.0.1', '0.0.0.0') else host}:{port}"

    print("")
    print("  " + _c(1, scenario["title"]))
    print("  " + _c(2, f"{scenario.get('category', '')} › {scenario.get('subtype', '')}  ·  {scenario.get('difficulty', '')}"))
    print("")
    print("  " + _c(2, "Objective  ") + scenario.get("objective", ""))
    print("  " + _c(2, "Model      ") + session.provider.label)
    print("  " + _c(2, "Backend    ") + "FastAPI (Python)")
    print("  " + _c(2, "Scenarios  ") + f"{len(ids)} available — switch or 🎲 in the browser")
    print("")
    print("  " + _c(32, "▸") + "  " + _c(36, url))
    print("  " + _c(2, "Ctrl+C to stop."))
    print("")

    if "--no-open" not in flags and host in ("127.0.0.1", "localhost"):
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001
            pass

    app = create_app(hub)
    uvicorn.run(app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
