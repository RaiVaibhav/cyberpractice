/**
 * Free / self-hosted model backend.
 *
 * Speaks the OpenAI-compatible /chat/completions API with tool calling, which
 * means one implementation runs against every common free option:
 *   - Ollama      (local, no key, genuinely free)     <- the default
 *   - Groq        (free tier, instant free key, fast)
 *   - OpenRouter  (has :free models)
 *   - Gemini      (free tier, OpenAI-compat endpoint)
 * ...or anything else that exposes the same endpoint (LM Studio, llama.cpp, vLLM).
 *
 * Uses Node's built-in fetch — no npm install required.
 */

const PRESETS = {
  ollama: {
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    keyEnv: null,
    defaultModel: 'llama3.1',
    needsKey: false,
  },
  groq: {
    label: 'Groq (free tier)',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    // Groq's catalog changes; this is a current tool-calling model. Override with
    // CYBERPRACTICE_FREE_MODEL (e.g. openai/gpt-oss-120b for a stronger model,
    // or qwen/qwen3.8-27b). See `curl .../v1/models` for what your key can use.
    defaultModel: 'openai/gpt-oss-20b',
    needsKey: true,
  },
  openrouter: {
    label: 'OpenRouter (free models)',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    needsKey: true,
  },
  gemini: {
    label: 'Gemini (free tier)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.0-flash',
    needsKey: true,
  },
};

const MAX_TURNS = 8;

export async function createFreeProvider(scenario) {
  const presetName = (process.env.CYBERPRACTICE_FREE || 'ollama').toLowerCase();
  const preset = PRESETS[presetName];
  if (!preset) {
    throw new Error(
      `Unknown free provider "${presetName}". Set CYBERPRACTICE_FREE to one of: ${Object.keys(PRESETS).join(', ')}.`
    );
  }

  const baseUrl = (process.env.CYBERPRACTICE_FREE_BASE_URL || preset.baseUrl).replace(/\/+$/, '');
  const model = process.env.CYBERPRACTICE_FREE_MODEL || preset.defaultModel;
  const apiKey =
    process.env.CYBERPRACTICE_FREE_KEY || (preset.keyEnv ? process.env[preset.keyEnv] : '') || 'not-needed';

  if (preset.needsKey && (!apiKey || apiKey === 'not-needed')) {
    throw new Error(
      `${preset.label} needs a free API key.\n` +
        `  Get one, then export it:  export ${preset.keyEnv}=<your-key>\n` +
        `  (It's free — no card. Or use the local option: unset CYBERPRACTICE_FREE to use Ollama.)`
    );
  }

  // Fail fast with a friendly message if a local server isn't up.
  if (!preset.needsKey) {
    await ensureReachable(baseUrl, preset, model);
  }

  const tools = scenario.tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: { type: 'object', properties: t.params || {}, required: t.required || [] },
    },
  }));

  return {
    name: 'free:' + presetName,
    label: `${preset.label} · ${model}`,

    async run({ userMessage, state, history }) {
      const trace = [{ kind: 'user', from: 'user', to: 'LLM', text: userMessage }];
      const calledTools = [];
      const said = [];

      const messages = [
        { role: 'system', content: scenario.systemPrompt },
        ...history.flatMap((h) => (h.role === 'user' ? [{ role: 'user', content: h.content }] : [{ role: 'assistant', content: h.content }])),
        { role: 'user', content: userMessage },
      ];

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const choice = await chat(baseUrl, apiKey, { model, messages, tools });
        const msg = choice.message || {};

        if (msg.content && msg.content.trim()) said.push(msg.content.trim());

        const toolCalls = msg.tool_calls || [];
        if (!toolCalls.length) {
          messages.push({ role: 'assistant', content: msg.content || '' });
          break;
        }

        messages.push({ role: 'assistant', content: msg.content || '', tool_calls: toolCalls });

        for (const tc of toolCalls) {
          const tool = scenario.tools.find((t) => t.name === tc.function?.name);
          let args = {};
          try {
            args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
          } catch {
            /* some models emit slightly-off JSON; fall back to empty args */
          }
          trace.push({ kind: 'call', from: 'LLM', to: 'API', text: `${tc.function?.name}(${fmtArgs(args)})` });

          let result;
          try {
            result = tool ? (await tool.run(args, state)) || {} : { raw: `Unknown tool ${tc.function?.name}` };
          } catch (err) {
            result = { raw: `Error: ${err.message}` };
          }
          calledTools.push({ name: tc.function?.name, args, result });
          const text = result.raw ?? result.say ?? '(no output)';
          trace.push({ kind: 'result', from: 'API', to: 'LLM', text, tainted: Boolean(result.tainted) });

          messages.push({ role: 'tool', tool_call_id: tc.id, content: String(text) });
        }
      }

      const reply = said.join('\n\n') || '(no reply)';
      trace.push({ kind: 'reply', from: 'LLM', to: 'user', text: reply });
      return { reply, trace, calledTools };
    },
  };
}

async function chat(baseUrl, apiKey, body) {
  let res;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ ...body, tool_choice: 'auto', temperature: 0.7 }),
    });
  } catch (err) {
    throw new Error(`Could not reach the model server at ${baseUrl}: ${err.message}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Model server returned ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  if (!data.choices?.length) throw new Error('Model server returned no choices.');
  return data.choices[0];
}

async function ensureReachable(baseUrl, preset, model) {
  try {
    const res = await fetch(`${baseUrl}/models`, { headers: { Authorization: 'Bearer not-needed' } });
    if (!res.ok) return; // some servers gate /models; let the real call surface errors
    const data = await res.json().catch(() => ({}));
    const ids = (data.data || []).map((m) => m.id);
    if (ids.length && !ids.includes(model) && !ids.some((id) => id.startsWith(model))) {
      throw new Error(
        `${preset.label} is running but the model "${model}" isn't installed.\n` +
          `  Pull it with:  ollama pull ${model}\n` +
          `  Installed models: ${ids.join(', ') || '(none)'}\n` +
          `  Or pick another with:  CYBERPRACTICE_FREE_MODEL=<name>`
      );
    }
  } catch (err) {
    if (err.message.includes("isn't installed")) throw err;
    throw new Error(
      `${preset.label} doesn't seem to be running at ${baseUrl}.\n` +
        `  Start it:   install from https://ollama.com  then  ollama pull ${model}\n` +
        `  Or use a hosted free tier instead, e.g.:  CYBERPRACTICE_FREE=groq  (needs a free GROQ_API_KEY)`
    );
  }
}

function fmtArgs(args) {
  return Object.entries(args || {})
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ');
}
