# cyberpractice

A local practice range for LLM / AppSec attack scenarios.

Each folder is a **scenario**. Point the platform at one and it boots a small,
deliberately-vulnerable target app in your browser so you can practise the attack
hands-on — with a live data-flow trace, hints, and a win condition.

```bash
npm install                                   # once — installs the React/Vite UI deps
npm run scenario -- <category>/<subtype>
```

e.g.

```bash
npm run scenario -- prompt-injection-llm/direct
npm run scenario -- prompt-injection-llm/indirect
```

That starts a local server, prints the URL, and opens it. `Ctrl+C` to stop.
The **first** run builds the React UI into `platform/web-dist` (cached after that).

## Two backends, one UI

The same React UI runs against either backend — identical REST contract, same
scenarios, same behaviour. Pick whichever ecosystem you prefer:

**Node** (default, above) — `platform/`.

**Python / FastAPI** — `backend/`. Nicer if you want to reach for the Python AI
ecosystem.

```bash
npm install && npm run build:ui       # build the UI once (needs Node)
npm run py:setup                       # create .venv + install FastAPI deps
npm run py -- prompt-injection-llm/direct        # offline simulator
npm run py:free -- prompt-injection-llm/direct   # real model (reads .env)
```

Or drive it directly without npm:

```bash
python -m backend.run prompt-injection-llm/direct      # or no id → random
HOST=0.0.0.0 PORT=8000 python -m backend.run --no-open  # deploy-style
```

Both backends discover scenarios the same way, expose `/api/*` identically, and
serve the built UI from `platform/web-dist`. The FastAPI one honours `HOST`/`PORT`
env (set `HOST=0.0.0.0` to deploy on Render / Fly / Hugging Face Spaces).

## Commands

| Command | What it does |
|---|---|
| `npm run scenario -- <id>` | Boot the practice app for a scenario |
| `npm run list` | List every scenario (● runnable, ○ brief only) |
| `npm run new -- <id>` | Scaffold a new scenario folder + config |

`<id>` is the folder path (`prompt-injection-llm/indirect`). A unique tail also
works — `npm run scenario -- indirect`.

### Flags

- `--free` — run against a **free real model**. By default this is a local
  **Ollama** model (no API key, no cost). See below for hosted free tiers.
- `--real` — run the scenario against a **live Claude model**. Needs
  credentials (`ANTHROPIC_API_KEY` or an `ant auth login` profile).
- `--dev` — run the **Vite dev server** (React hot-reload) for hacking on the
  UI. The API runs on `PORT`; Vite serves the UI and proxies `/api` to it.
- `--no-open` — don't launch a browser.
- `PORT=4200 …` — pick the port. `CYBERPRACTICE_MODEL=claude-sonnet-5 …` — pick the model for `--real`.

Without `--free`/`--real`, everything runs offline and deterministic against the
built-in simulator.

## Running against a free real model

`--free` speaks the OpenAI-compatible chat API, so it works with any free
backend. Uses Node's built-in `fetch` — nothing to `npm install`.

**Local (default, truly free, no key):** [Ollama](https://ollama.com)

```bash
ollama pull llama3.1                              # any tool-capable model
npm run scenario -- prompt-injection-llm/direct --free
```

**Hosted free tiers** — set `CYBERPRACTICE_FREE` and export the free key:

| `CYBERPRACTICE_FREE` | Key env var | Default model |
|---|---|---|
| `ollama` (default) | — (none) | `llama3.1` |
| `groq` | `GROQ_API_KEY` | `openai/gpt-oss-20b` |
| `openrouter` | `OPENROUTER_API_KEY` | `meta-llama/llama-3.3-70b-instruct:free` |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.0-flash` |

```bash
export GROQ_API_KEY=...        # free, no card, from the Groq console
CYBERPRACTICE_FREE=groq npm run scenario -- prompt-injection-llm/indirect --free
```

Or, so you don't export it every shell: **copy `.env.example` to `.env`** and
fill in `CYBERPRACTICE_FREE` + your key. The CLI loads `.env` automatically, so
`npm run free -- <id>` just works. (`.env` is git-ignored.)

Override anything: `CYBERPRACTICE_FREE_MODEL`, or point at any OpenAI-compatible
server (LM Studio, vLLM, llama.cpp) with `CYBERPRACTICE_FREE_BASE_URL` /
`CYBERPRACTICE_FREE_KEY`.

> Injection success depends on the model. Small local models are easy to
> injection — great for seeing the attack land. Bigger instruction-tuned models
> resist more, which is the point: compare how far the same payload gets.

## Switching scenarios & difficulty

Every scenario is loaded at once. In the browser you can **switch** between them
from the dropdown in the header, or hit **🎲 Random** for a surprise — no restart
needed. Each shows a colour-coded **difficulty** badge (Starter → Core →
Advanced → Expert). From the CLI, `npm run scenario` with no id boots a random
one, and `--random` ignores the id you pass.

## The scenarios

**Direct** — the payload goes straight into the chat box:

| id | difficulty | target |
|---|---|---|
| `prompt-injection-llm/direct` | Starter | Nimbus support bot — talk it into `issue_refund` with no manager override. |
| `prompt-injection-llm/prompt-leak` | Starter | Atlas concierge — extract a secret hidden in its system prompt. |
| `prompt-injection-llm/tool-abuse` | Core | DevBot — get its `read_file` tool to read a secrets file outside `./docs`. |

**Indirect** — you never touch the victim's chat; you plant text a tool will
read back to the model:

| id | difficulty | target |
|---|---|---|
| `prompt-injection-llm/indirect` | Core | Gigacorp assistant — a planted **review** deletes the victim's account. |
| `prompt-injection-llm/indirect-email` | Core | Inbox assistant — a planted **email** changes the victim's account email. |
| `prompt-injection-llm/indirect-web` | Advanced | Research assistant (hardened) — a planted **web page** exfiltrates a private doc. |

The right-hand panel shows the live **State**, an **Attack** tab for the
out-of-band steps (planting the review / email / page and simulating the
victim), and a **Trace** that marks exactly where attacker-controlled text
crosses into the instruction stream. `prompt-injection-llm/reference.md` has the
PortSwigger notes these mirror.

## How a scenario is defined

A runnable scenario is a folder with:

- `scenario.md` — the human brief (any `scen*.md` works).
- `scenario.config.js` — `export default` an object with the target's
  `systemPrompt`, its `tools`, `initialState`, `checkSolved`, live `panels`,
  optional out-of-band `actions`, `hints`, and a `solution`.

Run `npm run new -- your-category/your-subtype` to scaffold both from the
template in `templates/`, then fill it in. The platform auto-discovers it — no
registration step.

## Layout

```
platform/       CLI, server, session engine, providers (mock + free + Claude)
    web-dist/   built React UI (generated — git-ignored)
ui/             React + Vite source for the practice UI
vite.config.js  builds ui/ → platform/web-dist, proxies /api in --dev
templates/      scenario.config.template.js
<category>/<subtype>/
    scenario.md
    scenario.config.js
```

The **platform** (CLI, server, engine, providers) is standard-library Node
(≥20) — the only backend dependency is the Anthropic SDK, and that's *optional*,
needed only for `--real`. The **UI** is React built with Vite; `npm install`
pulls those in and the server serves the static build (no Node framework, no
runtime UI dependency).
