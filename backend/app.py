"""FastAPI app: same REST contract as the Node server, serving the React build.

Endpoints:
  GET  /api/scenario    current scenario + full snapshot + catalog
  GET  /api/scenarios   catalog only
  POST /api/select      {id}  -> switch scenario
  POST /api/message     {message}
  POST /api/action      {action, fields}
  POST /api/hint | /api/solution | /api/reset
Everything else is served from the built UI (SPA fallback to index.html).
"""
import time
import traceback
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse

WEB_DIR = Path(__file__).resolve().parent.parent / "platform" / "web-dist"

RESET = "\x1b[0m"


def _c(code, s):
    return f"\x1b[{code}m{s}{RESET}"


def _snapshot(hub):
    session = hub.current()
    return {
        **session.info(),
        **session.snapshot(),
        "history": session.history,
        "trace": session.trace,
        "currentId": hub.current_id(),
        "scenarios": hub.list(),
    }


def create_app(hub) -> FastAPI:
    app = FastAPI(title="cyberpractice")

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        started = time.time()
        try:
            response = await call_next(request)
        except Exception as err:  # noqa: BLE001 — surface backend crashes in the terminal
            ms = int((time.time() - started) * 1000)
            print(_c(31, f"  ✗ 500  {request.method} {request.url.path}") + _c(2, f"  {ms}ms"), flush=True)
            traceback.print_exc()
            return JSONResponse({"error": str(err)}, status_code=500)
        ms = int((time.time() - started) * 1000)
        s = response.status_code
        code = 31 if s >= 500 else 33 if s >= 400 else 36 if s >= 300 else 32
        print(f"  {_c(code, s)}  {_c(2, request.method.ljust(4))} {request.url.path}  {_c(2, str(ms) + 'ms')}", flush=True)
        return response

    # --- API ---------------------------------------------------------------
    @app.get("/api/scenario")
    async def get_scenario():
        return _snapshot(hub)

    @app.get("/api/scenarios")
    async def get_scenarios():
        return {"scenarios": hub.list(), "currentId": hub.current_id()}

    @app.post("/api/select")
    async def select(request: Request):
        body = await request.json()
        scenario_id = body.get("id")
        if not scenario_id:
            return JSONResponse({"error": "Missing scenario id"}, status_code=400)
        hub.select(str(scenario_id))
        return _snapshot(hub)

    @app.post("/api/message")
    async def message(request: Request):
        body = await request.json()
        text = body.get("message")
        if not text or not str(text).strip():
            return JSONResponse({"error": "Empty message"}, status_code=400)
        return hub.current().send(str(text))

    @app.post("/api/action")
    async def action(request: Request):
        body = await request.json()
        return hub.current().act(body.get("action"), body.get("fields"))

    @app.post("/api/hint")
    async def hint():
        return hub.current().hint()

    @app.post("/api/solution")
    async def solution():
        return {"solution": hub.current().solution()}

    @app.post("/api/reset")
    async def reset():
        return hub.current().reset()

    # --- static UI (SPA) ---------------------------------------------------
    @app.get("/{full_path:path}")
    async def static_files(full_path: str):
        rel = full_path or "index.html"
        target = (WEB_DIR / rel).resolve()
        if WEB_DIR in target.parents or target == WEB_DIR:
            if target.is_file():
                return FileResponse(target)
        # SPA fallback for non-asset routes.
        index = WEB_DIR / "index.html"
        if index.is_file():
            return FileResponse(index)
        return JSONResponse({"error": "UI not built. Run `npm run build:ui`."}, status_code=404)

    return app
