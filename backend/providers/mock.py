"""The simulated target LLM — deliberately vulnerable in the same way real
tool-using models are: it flattens the user message AND tool output into one
instruction stream, and only ever screens the *user* channel. Content arriving
via a tool result is never re-screened but is still obeyed → indirect injection.
"""
import json

MAX_STEPS = 6


class MockProvider:
    name = "mock"
    label = "Simulated LLM (offline, deterministic)"

    def __init__(self, scenario):
        self.scenario = scenario

    def run(self, user_message, state, history):
        scenario = self.scenario
        trace = []
        said = []
        called_tools = []

        # Each source is a chunk of text in the context window.
        #   channel 'user' -> arrived over the (screened) chat channel
        #   channel 'tool' -> arrived inside a tool result (attacker-controllable)
        sources = [{"text": user_message, "channel": "user", "origin": "user message"}]
        trace.append({"kind": "user", "from": "user", "to": "LLM", "text": user_message})

        step = 0
        refused = False
        fired = set()  # a tool can't be re-triggered by its own output

        while sources and step < MAX_STEPS:
            src = sources.pop(0)
            step += 1

            if src["channel"] == "user":
                verdict = _screen(scenario.get("guardrails", []), src["text"])
                if verdict and verdict.get("blocked"):
                    trace.append(
                        {
                            "kind": "guardrail",
                            "status": "blocked",
                            "guardrail": verdict["id"],
                            "text": f"Guardrail \"{verdict['id']}\" refused this request.",
                        }
                    )
                    said.append(verdict["refusal"])
                    refused = True
                    break
                if verdict and verdict.get("bypassed"):
                    trace.append(
                        {
                            "kind": "guardrail",
                            "status": "bypassed",
                            "guardrail": verdict["id"],
                            "technique": verdict["technique"],
                            "text": f"Guardrail \"{verdict['id']}\" was bypassed via {verdict['technique']}.",
                        }
                    )
            else:
                trace.append(
                    {
                        "kind": "trust",
                        "text": (
                            f"Content from {src['origin']} is being read as instructions. "
                            "It was never screened by the guardrails — only the user channel is."
                        ),
                    }
                )

            matches = [m for m in _match_intents(scenario["tools"], src["text"]) if m["tool"]["name"] not in fired]
            for match in matches:
                tool = match["tool"]
                args = match["args"]
                fired.add(tool["name"])
                trace.append(
                    {
                        "kind": "call",
                        "from": "LLM",
                        "to": "API",
                        "text": f"{tool['name']}({_fmt_args(args)})",
                        "injected": src["channel"] == "tool",
                    }
                )
                try:
                    result = tool["run"](args, state) or {}
                except Exception as err:  # noqa: BLE001
                    result = {"say": f"The {tool['name']} call failed: {err}"}

                called_tools.append({"name": tool["name"], "args": args, "result": result})
                trace.append(
                    {
                        "kind": "result",
                        "from": "API",
                        "to": "LLM",
                        "text": result.get("raw", result.get("say", "(no output)")),
                        "tainted": bool(result.get("tainted")),
                    }
                )
                if result.get("say"):
                    said.append(result["say"])
                if result.get("raw"):
                    sources.append({"text": result["raw"], "channel": "tool", "origin": f"the {tool['name']} tool result"})

        if not refused and not said:
            said.append(_answer_from_knowledge(scenario, user_message, history))

        reply = "\n\n".join([s for s in said if s])
        trace.append({"kind": "reply", "from": "LLM", "to": "user", "text": reply})
        return {"reply": reply, "trace": trace, "calledTools": called_tools}


def _screen(guardrails, text):
    for g in guardrails:
        blocks = g["blocks"] if isinstance(g["blocks"], list) else [g["blocks"]]
        if not any(re.search(text) for re in blocks):
            continue
        for b in g.get("bypasses", []):
            if b["re"].search(text):
                return {"id": g["id"], "bypassed": True, "technique": b["name"]}
        return {"id": g["id"], "blocked": True, "refusal": g["refusal"]}
    return None


def _match_intents(tools, text):
    out = []
    for tool in tools:
        for intent in tool.get("intents", []):
            m = intent["re"].search(text)
            if not m:
                continue
            args = intent["args"](m, text) if intent.get("args") else {}
            out.append({"tool": tool, "args": args, "index": m.start()})
            break  # one call per tool per source
    out.sort(key=lambda x: x["index"])
    return out


def _answer_from_knowledge(scenario, user_message, history):
    for k in scenario.get("knowledge", []):
        if k["re"].search(user_message):
            say = k["say"]
            return say(history) if callable(say) else say
    return scenario.get("fallbackReply", "I'm not sure I can help with that.")


def _fmt_args(args):
    return ", ".join(f"{k}={json.dumps(v)}" for k, v in (args or {}).items())
