import { createMockProvider } from './providers/mock.js';
import { createAnthropicProvider } from './providers/anthropic.js';
import { createFreeProvider } from './providers/openai-compat.js';
import { discover, load } from './registry.js';

export async function createProvider(scenario, { real, free }) {
  if (real) return await createAnthropicProvider(scenario);
  if (free) return await createFreeProvider(scenario);
  return createMockProvider(scenario);
}

/**
 * A hub over every runnable scenario in the repo. It loads them all up front
 * (so it can list them with metadata) and lazily builds a live session the
 * first time each one is opened — this is what lets the UI switch scenarios
 * (and pick a random one) without restarting the CLI.
 */
export async function createHub(root, providerOpts) {
  const entries = discover(root).filter((e) => e.runnable);
  if (!entries.length) throw new Error('No runnable scenarios found (need a scenario.config.js).');
  const scenarios = await Promise.all(entries.map((e) => load(e)));
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const sessions = new Map(); // id -> session, built on first open
  let currentId = null;

  return {
    list() {
      return scenarios.map((s) => ({
        id: s.id,
        title: s.title,
        category: s.category,
        subtype: s.subtype,
        difficulty: s.difficulty,
        objective: s.objective,
      }));
    },
    ids: () => scenarios.map((s) => s.id),
    currentId: () => currentId,
    current: () => sessions.get(currentId),
    async select(id) {
      if (!byId.has(id)) throw new Error(`Unknown scenario "${id}"`);
      if (!sessions.has(id)) {
        const scenario = byId.get(id);
        const provider = await createProvider(scenario, providerOpts);
        sessions.set(id, createSession(scenario, provider));
      }
      currentId = id;
      return sessions.get(id);
    },
  };
}

export function createSession(scenario, provider) {
  let state = scenario.initialState();
  let history = [];
  let trace = [];
  let solved = false;
  let solvedNote = '';
  let hintsUsed = 0;
  let turns = 0;
  const startedAt = Date.now();

  function snapshot() {
    const panels = (scenario.panels || []).map((p) => ({
      id: p.id,
      title: p.title,
      hint: p.hint || '',
      rows: p.rows(state),
    }));
    return { panels, solved, solvedNote, turns, hintsUsed, elapsedMs: Date.now() - startedAt };
  }

  return {
    get scenario() {
      return scenario;
    },
    provider,

    info() {
      return {
        id: scenario.id,
        title: scenario.title,
        category: scenario.category,
        subtype: scenario.subtype,
        difficulty: scenario.difficulty,
        objective: scenario.objective,
        brief: scenario.brief,
        background: scenario.background || '',
        app: scenario.app || { name: 'Target app', tagline: '' },
        systemPrompt: scenario.systemPrompt,
        tools: scenario.tools.map((t) => ({
          name: t.name,
          description: t.description,
          privileged: Boolean(t.privileged),
        })),
        hintCount: (scenario.hints || []).length,
        provider: { name: provider.name, label: provider.label },
        actions: (scenario.actions || []).map((a) => ({
          id: a.id,
          label: a.label,
          description: a.description,
          fields: a.fields || [],
        })),
      };
    },

    state: snapshot,
    history: () => history,
    trace: () => trace,

    async send(message) {
      turns++;
      const out = await provider.run({ userMessage: message, state, history });
      // Expose the assistant's own words to checkSolved so "leak"-style
      // scenarios (win = the model said the secret) can detect success.
      state.lastReply = out.reply;
      history.push({ role: 'user', content: message });
      history.push({ role: 'assistant', content: out.reply });
      trace = trace.concat(out.trace);
      checkSolved();
      return { reply: out.reply, turn: out.trace, trace, ...snapshot() };
    },

    /** Out-of-band actions: posting a review, sending an email, or another user
     *  opening the chat -- everything the attacker does outside their own chat
     *  channel. This is the "plant" half of an indirect injection. */
    async act(actionId, fields) {
      const action = (scenario.actions || []).find((a) => a.id === actionId);
      if (!action) throw new Error(`Unknown action "${actionId}"`);

      const ctx = {
        /** Run a chat turn as somebody else -- the victim walking into the trap. */
        async chatAs(username, message) {
          const previous = state.session;
          state.session = username;
          trace.push({ kind: 'actor', actor: username, text: `${username} opens the live chat.` });
          let out;
          try {
            out = await provider.run({ userMessage: message, state, history: [] });
            state.lastReply = out.reply;
          } finally {
            state.session = previous;
          }
          trace = trace.concat(out.trace.map((t) => ({ ...t, actor: username })));
          return out;
        },
      };

      const result = (await action.run(fields || {}, state, ctx)) || {};
      trace.push({ kind: 'action', text: result.note || `${action.label} completed.` });
      checkSolved();
      return { note: result.note || `${action.label} completed.`, transcript: result.transcript || null, trace, ...snapshot() };
    },

    hint() {
      const hints = scenario.hints || [];
      if (hintsUsed >= hints.length) return { hint: null, exhausted: true, hintsUsed };
      const hint = hints[hintsUsed++];
      return { hint, index: hintsUsed, total: hints.length, exhausted: hintsUsed >= hints.length };
    },

    solution() {
      return scenario.solution || 'No walkthrough was written for this scenario.';
    },

    reset() {
      state = scenario.initialState();
      history = [];
      trace = [];
      solved = false;
      solvedNote = '';
      hintsUsed = 0;
      turns = 0;
      return snapshot();
    },
  };

  function checkSolved() {
    if (solved) return;
    const verdict = scenario.checkSolved(state) || {};
    if (verdict.solved) {
      solved = true;
      solvedNote = verdict.message || 'Objective complete.';
      trace.push({ kind: 'solved', text: solvedNote });
    }
  }
}
