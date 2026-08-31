/**
 * The simulated target LLM.
 *
 * It is deliberately vulnerable in exactly the way real tool-using LLMs are:
 * it flattens every piece of text it sees -- the user's message AND the output
 * of the tools it calls -- into one undifferentiated instruction stream.
 * Guardrails are only ever applied to the *user* channel, which is precisely
 * why indirect injection works: content arriving via a tool result is never
 * re-screened, but is still obeyed.
 */

const MAX_STEPS = 6;

export function createMockProvider(scenario) {
  return {
    name: 'mock',
    label: 'Simulated LLM (offline, deterministic)',

    async run({ userMessage, state, history }) {
      const trace = [];
      const said = [];
      const calledTools = [];

      // Each "source" is a chunk of text the model has in its context window.
      // channel: 'user'   -> arrived over the trusted-looking chat channel
      // channel: 'tool'   -> arrived inside a tool result (attacker-controllable)
      const sources = [{ text: userMessage, channel: 'user', origin: 'user message' }];
      trace.push({ kind: 'user', from: 'user', to: 'LLM', text: userMessage });

      let step = 0;
      let refused = false;
      const fired = new Set(); // a tool can't be re-triggered by its own output

      while (sources.length && step < MAX_STEPS) {
        const src = sources.shift();
        step++;

        // --- Guardrails: applied to the user channel ONLY. This is the bug. ---
        if (src.channel === 'user') {
          const verdict = screen(scenario.guardrails || [], src.text);
          if (verdict?.blocked) {
            trace.push({
              kind: 'guardrail',
              status: 'blocked',
              guardrail: verdict.id,
              text: `Guardrail "${verdict.id}" refused this request.`,
            });
            said.push(verdict.refusal);
            refused = true;
            break;
          }
          if (verdict?.bypassed) {
            trace.push({
              kind: 'guardrail',
              status: 'bypassed',
              guardrail: verdict.id,
              technique: verdict.technique,
              text: `Guardrail "${verdict.id}" was bypassed via ${verdict.technique}.`,
            });
          }
        } else {
          trace.push({
            kind: 'trust',
            text: `Content from ${src.origin} is being read as instructions. It was never screened by the guardrails — only the user channel is.`,
          });
        }

        // --- Intent matching: which tools does this text ask for? ---
        const matches = matchIntents(scenario.tools, src.text).filter((m) => !fired.has(m.tool.name));
        for (const { tool, args } of matches) {
          fired.add(tool.name);
          trace.push({
            kind: 'call',
            from: 'LLM',
            to: 'API',
            text: `${tool.name}(${fmtArgs(args)})`,
            injected: src.channel === 'tool',
          });

          let result;
          try {
            result = await tool.run(args, state) || {};
          } catch (err) {
            result = { say: `The ${tool.name} call failed: ${err.message}` };
          }

          calledTools.push({ name: tool.name, args, result });
          trace.push({
            kind: 'result',
            from: 'API',
            to: 'LLM',
            text: result.raw ?? result.say ?? '(no output)',
            tainted: Boolean(result.tainted),
          });

          if (result.say) said.push(result.say);

          // The returned text goes straight back into the context window and is
          // scanned for further instructions -- the indirect injection path.
          if (result.raw) {
            sources.push({
              text: result.raw,
              channel: 'tool',
              origin: `the ${tool.name} tool result`,
            });
          }
        }
      }

      if (!refused && !said.length) {
        said.push(answerFromKnowledge(scenario, userMessage, history));
      }

      const reply = said.filter(Boolean).join('\n\n');
      trace.push({ kind: 'reply', from: 'LLM', to: 'user', text: reply });
      return { reply, trace, calledTools };
    },
  };
}

/* ------------------------------------------------------------------ */

function screen(guardrails, text) {
  for (const g of guardrails) {
    const blocks = toArray(g.blocks);
    if (!blocks.some((re) => re.test(text))) continue;

    for (const b of g.bypasses || []) {
      if (b.re.test(text)) return { id: g.id, bypassed: true, technique: b.name };
    }
    return { id: g.id, blocked: true, refusal: g.refusal };
  }
  return null;
}


function matchIntents(tools, text) {
  const out = [];
  for (const tool of tools) {
    for (const intent of tool.intents || []) {
      const m = intent.re.exec(text);
      if (!m) continue;
      const args = intent.args ? intent.args(m, text) : {};
      out.push({ tool, args, index: m.index });
      break; // one call per tool per source
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

function answerFromKnowledge(scenario, userMessage, history) {
  for (const k of scenario.knowledge || []) {
    if (k.re.test(userMessage)) return typeof k.say === 'function' ? k.say(history) : k.say;
  }
  return scenario.fallbackReply || "I'm not sure I can help with that. Try asking about a product or an order.";
}

function fmtArgs(args) {
  return Object.entries(args || {})
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ');
}

function toArray(v) {
  return Array.isArray(v) ? v : [v];
}
