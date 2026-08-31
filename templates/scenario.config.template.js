/**
 * Scenario definition. Everything the platform needs to boot a practice app.
 * Delete the comments as you fill it in. See prompt-injection-llm/* for worked examples.
 */
export default {
  title: '__TITLE__',
  category: 'Uncategorised',
  subtype: '__SUBTYPE__',
  difficulty: 'Core', // Starter | Core | Hard
  objective: 'One sentence: what does the attacker have to achieve?',

  app: { name: 'Target App', tagline: 'What this app is for.' },
  background: 'Context the practitioner needs before they start.',

  // The instructions the target model runs under. For --real mode this is the ONLY guardrail.
  systemPrompt: 'You are a helpful assistant. (Add the rules the attacker must defeat.)',

  // Simulator-only pattern matching. Screens the USER channel; tool output is
  // deliberately never screened — that is what makes indirect injection possible.
  guardrails: [
    // { id: 'no-secrets', blocks: [/password/i], refusal: "I can't share that.",
    //   bypasses: [{ name: 'ignore-instructions', re: /ignore .*instructions/i }] },
  ],

  // Tools the model can call. `intents` are the simulator's trigger patterns;
  // `params`/`description` are what the --real model sees.
  tools: [
    {
      name: 'example_tool',
      description: 'What this tool does.',
      privileged: false,
      params: { arg: { type: 'string' } },
      required: [],
      intents: [{ re: /do the thing/i, args: (m, text) => ({ arg: 'value' }) }],
      run(args, state) {
        // return { say, raw, tainted }
        //   say    -> shown to the user as the assistant's words
        //   raw    -> tool output fed back into the model (attacker-controllable data goes here)
        //   tainted-> mark true if this output carries a planted payload (for the trace UI)
        return { say: 'Did the thing.' };
      },
    },
  ],

  // Optional canned answers when no tool fires.
  knowledge: [{ re: /price/i, say: 'It costs $10.' }],
  fallbackReply: 'How can I help?',

  // Optional out-of-band steps (plant a review, send an email, have a victim chat).
  // run(fields, state, ctx) — ctx.chatAs(username, message) runs a turn as someone else.
  actions: [],

  initialState: () => ({ session: 'attacker' }),

  checkSolved(state) {
    // return { solved: true, message: '...' } when the objective is met
    return { solved: false };
  },

  // Live state panels shown beside the chat.
  panels: [
    // { id: 'x', title: 'State', hint: '...', rows: (state) => [{ label, value, flag }] },
  ],

  hints: ['Nudge 1', 'Nudge 2'],
  solution: 'Full walkthrough of the intended attack.',
};
