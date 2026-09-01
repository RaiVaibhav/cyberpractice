"""Free / self-hosted model backend.

Speaks the OpenAI-compatible /chat/completions API with tool calling, so one
implementation runs against Ollama (local, no key), Groq, OpenRouter, Gemini,
or any other server exposing the same endpoint. Uses httpx.
"""
import json
import os

import httpx

PRESETS = {
    "ollama": {
        "label": "Ollama (local)",
        "base_url": "http://localhost:11434/v1",
        "key_env": None,
        "default_model": "llama3.1",
        "needs_key": False,
    },
    "groq": {
        "label": "Groq (free tier)",
        "base_url": "https://api.groq.com/openai/v1",
        "key_env": "GROQ_API_KEY",
        # Groq's catalog changes; override with CYBERPRACTICE_FREE_MODEL.
        "default_model": "openai/gpt-oss-20b",
        "needs_key": True,
    },
    "openrouter": {
        "label": "OpenRouter (free models)",
        "base_url": "https://openrouter.ai/api/v1",
        "key_env": "OPENROUTER_API_KEY",
        "default_model": "meta-llama/llama-3.3-70b-instruct:free",
        "needs_key": True,
    },
    "gemini": {
        "label": "Gemini (free tier)",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "key_env": "GEMINI_API_KEY",
        "default_model": "gemini-2.0-flash",
        "needs_key": True,
    },
}

MAX_TURNS = 8


class FreeProvider:
    def __init__(self, scenario):
        self.scenario = scenario
        preset_name = os.environ.get("CYBERPRACTICE_FREE", "ollama").lower()
        preset = PRESETS.get(preset_name)
        if not preset:
            raise ValueError(
                f'Unknown free provider "{preset_name}". Set CYBERPRACTICE_FREE to one of: '
                + ", ".join(PRESETS)
            )
        self.preset = preset
        self.base_url = (os.environ.get("CYBERPRACTICE_FREE_BASE_URL") or preset["base_url"]).rstrip("/")
        self.model = os.environ.get("CYBERPRACTICE_FREE_MODEL") or preset["default_model"]
        self.api_key = (
            os.environ.get("CYBERPRACTICE_FREE_KEY")
            or (os.environ.get(preset["key_env"]) if preset["key_env"] else "")
            or "not-needed"
        )
        if preset["needs_key"] and (not self.api_key or self.api_key == "not-needed"):
            raise ValueError(
                f"{preset['label']} needs a free API key.\n"
                f"  Get one, then export it:  export {preset['key_env']}=<your-key>\n"
                "  (It's free — no card. Or unset CYBERPRACTICE_FREE to use local Ollama.)"
            )
        self.name = "free:" + preset_name
        self.label = f"{preset['label']} · {self.model}"
        self.tools = [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": {
                        "type": "object",
                        "properties": t.get("params", {}),
                        "required": t.get("required", []),
                    },
                },
            }
            for t in scenario["tools"]
        ]

    def run(self, user_message, state, history):
        scenario = self.scenario
        trace = [{"kind": "user", "from": "user", "to": "LLM", "text": user_message}]
        called_tools = []
        said = []

        messages = [{"role": "system", "content": scenario["systemPrompt"]}]
        for h in history:
            messages.append({"role": h["role"], "content": h["content"]})
        messages.append({"role": "user", "content": user_message})

        for _ in range(MAX_TURNS):
            choice = self._chat(messages)
            msg = choice.get("message", {})
            if msg.get("content") and msg["content"].strip():
                said.append(msg["content"].strip())

            tool_calls = msg.get("tool_calls") or []
            if not tool_calls:
                messages.append({"role": "assistant", "content": msg.get("content") or ""})
                break

            messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": tool_calls})
            for tc in tool_calls:
                fn = tc.get("function", {})
                tool = next((t for t in scenario["tools"] if t["name"] == fn.get("name")), None)
                try:
                    args = json.loads(fn["arguments"]) if fn.get("arguments") else {}
                except (ValueError, TypeError):
                    args = {}
                trace.append({"kind": "call", "from": "LLM", "to": "API", "text": f"{fn.get('name')}({_fmt_args(args)})"})
                try:
                    result = (tool["run"](args, state) or {}) if tool else {"raw": f"Unknown tool {fn.get('name')}"}
                except Exception as err:  # noqa: BLE001
                    result = {"raw": f"Error: {err}"}
                called_tools.append({"name": fn.get("name"), "args": args, "result": result})
                text = result.get("raw", result.get("say", "(no output)"))
                trace.append({"kind": "result", "from": "API", "to": "LLM", "text": text, "tainted": bool(result.get("tainted"))})
                messages.append({"role": "tool", "tool_call_id": tc.get("id"), "content": str(text)})

        reply = "\n\n".join(said) or "(no reply)"
        trace.append({"kind": "reply", "from": "LLM", "to": "user", "text": reply})
        return {"reply": reply, "trace": trace, "calledTools": called_tools}

    def _chat(self, messages):
        body = {"model": self.model, "messages": messages, "tools": self.tools, "tool_choice": "auto", "temperature": 0.7}
        try:
            res = httpx.post(
                f"{self.base_url}/chat/completions",
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"},
                json=body,
                timeout=60,
            )
        except httpx.HTTPError as err:
            raise RuntimeError(f"Could not reach the model server at {self.base_url}: {err}") from err
        if res.status_code >= 400:
            raise RuntimeError(f"Model server returned {res.status_code}: {res.text[:300]}")
        data = res.json()
        if not data.get("choices"):
            raise RuntimeError("Model server returned no choices.")
        return data["choices"][0]


def _fmt_args(args):
    return ", ".join(f"{k}={json.dumps(v)}" for k, v in (args or {}).items())
