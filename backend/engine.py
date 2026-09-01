"""Session + multi-scenario Hub. Mirrors the Node engine, including the JSON
key names (systemPrompt, hintCount, solvedNote, currentId, …) so the existing
React UI works against this backend unchanged."""
import time

from .providers.mock import MockProvider
from .providers.openai_compat import FreeProvider
from .registry import load_all


def create_provider(scenario, opts):
    if opts.get("real"):
        from .providers.anthropic import AnthropicProvider  # lazy: optional dep

        return AnthropicProvider(scenario)
    if opts.get("free"):
        return FreeProvider(scenario)
    return MockProvider(scenario)


class Session:
    def __init__(self, scenario, provider):
        self.scenario = scenario
        self.provider = provider
        self._reset_state()

    def _reset_state(self):
        self.state = self.scenario["initialState"]()
        self.history = []
        self.trace = []
        self.solved = False
        self.solved_note = ""
        self.hints_used = 0
        self.turns = 0
        self.started_at = time.time()

    # --- snapshots -----------------------------------------------------
    def snapshot(self):
        panels = [
            {"id": p["id"], "title": p["title"], "hint": p.get("hint", ""), "rows": p["rows"](self.state)}
            for p in self.scenario.get("panels", [])
        ]
        return {
            "panels": panels,
            "solved": self.solved,
            "solvedNote": self.solved_note,
            "turns": self.turns,
            "hintsUsed": self.hints_used,
            "elapsedMs": int((time.time() - self.started_at) * 1000),
        }

    def info(self):
        s = self.scenario
        return {
            "id": s["id"],
            "title": s["title"],
            "category": s.get("category", ""),
            "subtype": s.get("subtype", ""),
            "difficulty": s.get("difficulty", ""),
            "objective": s.get("objective", ""),
            "brief": s.get("brief", ""),
            "background": s.get("background", ""),
            "app": s.get("app", {"name": "Target app", "tagline": ""}),
            "systemPrompt": s["systemPrompt"],
            "tools": [
                {"name": t["name"], "description": t.get("description", ""), "privileged": bool(t.get("privileged"))}
                for t in s["tools"]
            ],
            "hintCount": len(s.get("hints", [])),
            "provider": {"name": self.provider.name, "label": self.provider.label},
            "actions": [
                {"id": a["id"], "label": a["label"], "description": a.get("description", ""), "fields": a.get("fields", [])}
                for a in s.get("actions", [])
            ],
        }

    # --- interaction ---------------------------------------------------
    def send(self, message):
        self.turns += 1
        out = self.provider.run(user_message=message, state=self.state, history=self.history)
        # Expose the assistant's words to checkSolved (leak-style wins).
        self.state["lastReply"] = out["reply"]
        self.history.append({"role": "user", "content": message})
        self.history.append({"role": "assistant", "content": out["reply"]})
        self.trace = self.trace + out["trace"]
        self._check_solved()
        return {"reply": out["reply"], "turn": out["trace"], "trace": self.trace, **self.snapshot()}

    def act(self, action_id, fields):
        action = next((a for a in self.scenario.get("actions", []) if a["id"] == action_id), None)
        if not action:
            raise ValueError(f'Unknown action "{action_id}"')

        session = self

        class Ctx:
            def chat_as(self, username, message):
                previous = session.state.get("session")
                session.state["session"] = username
                session.trace.append({"kind": "actor", "actor": username, "text": f"{username} opens the live chat."})
                try:
                    out = session.provider.run(user_message=message, state=session.state, history=[])
                    session.state["lastReply"] = out["reply"]
                finally:
                    session.state["session"] = previous
                session.trace = session.trace + [{**t, "actor": username} for t in out["trace"]]
                return out

        result = action["run"](fields or {}, self.state, Ctx()) or {}
        note = result.get("note") or f'{action["label"]} completed.'
        self.trace.append({"kind": "action", "text": note})
        self._check_solved()
        return {"note": note, "transcript": result.get("transcript"), "trace": self.trace, **self.snapshot()}

    def hint(self):
        hints = self.scenario.get("hints", [])
        if self.hints_used >= len(hints):
            return {"hint": None, "exhausted": True, "hintsUsed": self.hints_used}
        hint = hints[self.hints_used]
        self.hints_used += 1
        return {"hint": hint, "index": self.hints_used, "total": len(hints), "exhausted": self.hints_used >= len(hints)}

    def solution(self):
        return self.scenario.get("solution", "No walkthrough was written for this scenario.")

    def reset(self):
        self._reset_state()
        return self.snapshot()

    def _check_solved(self):
        if self.solved:
            return
        verdict = self.scenario["checkSolved"](self.state) or {}
        if verdict.get("solved"):
            self.solved = True
            self.solved_note = verdict.get("message", "Objective complete.")
            self.trace.append({"kind": "solved", "text": self.solved_note})


class Hub:
    """Holds every scenario; builds a live Session the first time each is opened,
    so the UI can switch (and randomise) without a restart."""

    def __init__(self, opts):
        self.opts = opts
        self.scenarios = load_all()
        if not self.scenarios:
            raise ValueError("No scenarios found under backend/scenarios.")
        self._by_id = {s["id"]: s for s in self.scenarios}
        self._sessions = {}
        self._current_id = None

    def list(self):
        return [
            {
                "id": s["id"],
                "title": s["title"],
                "category": s.get("category", ""),
                "subtype": s.get("subtype", ""),
                "difficulty": s.get("difficulty", ""),
                "objective": s.get("objective", ""),
            }
            for s in self.scenarios
        ]

    def ids(self):
        return [s["id"] for s in self.scenarios]

    def current_id(self):
        return self._current_id

    def current(self):
        return self._sessions.get(self._current_id)

    def select(self, scenario_id):
        if scenario_id not in self._by_id:
            raise ValueError(f'Unknown scenario "{scenario_id}"')
        if scenario_id not in self._sessions:
            scenario = self._by_id[scenario_id]
            provider = create_provider(scenario, self.opts)
            self._sessions[scenario_id] = Session(scenario, provider)
        self._current_id = scenario_id
        return self._sessions[scenario_id]
