"""Live Claude backend (--real). Uses the Anthropic Messages API with tool use.

Only imported when --real is requested, so httpx is the only dependency here.
Needs ANTHROPIC_API_KEY in the environment.
"""
import os

import httpx

API_URL = "https://api.anthropic.com/v1/messages"
MAX_TURNS = 8


class AnthropicProvider:
    def __init__(self, scenario):
        self.scenario = scenario
        self.api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not self.api_key:
            raise ValueError(
                "--real needs ANTHROPIC_API_KEY in the environment (or your .env). "
                "Get one from the Anthropic console."
            )
        self.model = os.environ.get("CYBERPRACTICE_MODEL", "claude-opus-5")
        self.name = "anthropic"
        self.label = f"Claude · {self.model}"
        self.tools = [
            {
                "name": t["name"],
                "description": t.get("description", ""),
                "input_schema": {
                    "type": "object",
                    "properties": t.get("params", {}),
                    "required": t.get("required", []),
                },
            }
            for t in scenario["tools"]
        ]

    def run(self, user_message, state, history):
        scenario = self.scenario
        trace = [{"kind": "user", "from": "user", "to": "LLM", "text": user_message}]
        called_tools = []
        said = []

        messages = []
        for h in history:
            messages.append({"role": h["role"], "content": h["content"]})
        messages.append({"role": "user", "content": user_message})

        for _ in range(MAX_TURNS):
            data = self._message(scenario["systemPrompt"], messages)
            if data.get("stop_reason") == "refusal":
                said.append("[The model declined to respond to this request.]")
                break

            content = data.get("content", [])
            tool_uses = [b for b in content if b.get("type") == "tool_use"]
            for b in content:
                if b.get("type") == "text" and b.get("text", "").strip():
                    said.append(b["text"].strip())

            if not tool_uses:
                break

            messages.append({"role": "assistant", "content": content})
            tool_results = []
            for tu in tool_uses:
                tool = next((t for t in scenario["tools"] if t["name"] == tu["name"]), None)
                args = tu.get("input", {}) or {}
                trace.append({"kind": "call", "from": "LLM", "to": "API", "text": f"{tu['name']}({_fmt_args(args)})"})
                try:
                    result = (tool["run"](args, state) or {}) if tool else {"raw": f"Unknown tool {tu['name']}"}
                except Exception as err:  # noqa: BLE001
                    result = {"raw": f"Error: {err}"}
                called_tools.append({"name": tu["name"], "args": args, "result": result})
                text = result.get("raw", result.get("say", "(no output)"))
                trace.append({"kind": "result", "from": "API", "to": "LLM", "text": text, "tainted": bool(result.get("tainted"))})
                tool_results.append({"type": "tool_result", "tool_use_id": tu["id"], "content": str(text)})
            messages.append({"role": "user", "content": tool_results})

        reply = "\n\n".join(said) or "(no reply)"
        trace.append({"kind": "reply", "from": "LLM", "to": "user", "text": reply})
        return {"reply": reply, "trace": trace, "calledTools": called_tools}

    def _message(self, system, messages):
        body = {"model": self.model, "max_tokens": 1024, "system": system, "messages": messages, "tools": self.tools}
        try:
            res = httpx.post(
                API_URL,
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json=body,
                timeout=60,
            )
        except httpx.HTTPError as err:
            raise RuntimeError(f"Could not reach the Anthropic API: {err}") from err
        if res.status_code >= 400:
            raise RuntimeError(f"Anthropic API returned {res.status_code}: {res.text[:300]}")
        return res.json()


def _fmt_args(args):
    import json

    return ", ".join(f"{k}={json.dumps(v)}" for k, v in (args or {}).items())
