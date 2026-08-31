/**
 * Optional real-model backend: runs the scenario against an actual Claude model
 * so you are practising against genuine model behaviour rather than a simulator.
 *
 * Enabled with --real (needs credentials + `npm install`). The scenario's
 * systemPrompt becomes the only guardrail, exactly as in a real deployment.
 */

const MODEL = process.env.CYBERPRACTICE_MODEL || 'claude-opus-5';
const MAX_TURNS = 8;

export async function createAnthropicProvider(scenario) {
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    throw new Error(
      'Real-model mode needs the Anthropic SDK.\n' +
        '  Install it with:  npm install\n' +
        '  Then re-run with --real (drop --real to use the offline simulator).'
    );
  }

  const client = new Anthropic(); // resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / `ant auth login` profile

  const toolDefs = scenario.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object',
      properties: t.params || {},
      required: t.required || [],
    },
  }));

  return {
    name: 'anthropic',
    label: `Live model (${MODEL})`,

    async run({ userMessage, state, history }) {
      const trace = [{ kind: 'user', from: 'user', to: 'LLM', text: userMessage }];
      const calledTools = [];
      const said = [];

      const messages = [
        ...history.flatMap((h) => (h.apiBlocks ? h.apiBlocks : [{ role: h.role, content: h.content }])),
        { role: 'user', content: userMessage },
      ];

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 8192,
          system: scenario.systemPrompt,
          tools: toolDefs,
          messages,
        });

        // A safety refusal is a real and interesting outcome in this lab, so it is
        // surfaced rather than silently routed to a fallback model.
        if (response.stop_reason === 'refusal') {
          const category = response.stop_details?.category ?? 'unspecified';
          trace.push({ kind: 'guardrail', status: 'blocked', guardrail: 'model safety classifier', text: `The model refused this request (category: ${category}).` });
          said.push('[The model declined to respond to that.]');
          break;
        }

        for (const block of response.content) {
          if (block.type === 'text' && block.text.trim()) said.push(block.text.trim());
        }

        const toolUses = response.content.filter((b) => b.type === 'tool_use');
        if (response.stop_reason !== 'tool_use' || !toolUses.length) {
          messages.push({ role: 'assistant', content: response.content });
          break;
        }

        messages.push({ role: 'assistant', content: response.content });

        const results = [];
        for (const use of toolUses) {
          const tool = scenario.tools.find((t) => t.name === use.name);
          trace.push({ kind: 'call', from: 'LLM', to: 'API', text: `${use.name}(${fmtArgs(use.input)})` });

          let result;
          try {
            result = tool ? (await tool.run(use.input || {}, state)) || {} : { raw: `Unknown tool ${use.name}` };
          } catch (err) {
            result = { raw: `Error: ${err.message}` };
          }

          calledTools.push({ name: use.name, args: use.input, result });
          const text = result.raw ?? result.say ?? '(no output)';
          trace.push({ kind: 'result', from: 'API', to: 'LLM', text, tainted: Boolean(result.tainted) });
          results.push({ type: 'tool_result', tool_use_id: use.id, content: String(text) });
        }

        messages.push({ role: 'user', content: results });
      }

      const reply = said.join('\n\n') || '(no reply)';
      trace.push({ kind: 'reply', from: 'LLM', to: 'user', text: reply });
      return { reply, trace, calledTools, apiMessages: messages };
    },
  };
}

function fmtArgs(args) {
  return Object.entries(args || {})
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ');
}
