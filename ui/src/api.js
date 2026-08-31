// Thin wrapper over the platform REST API (served by platform/server.js).
export const api = {
  async get() {
    const r = await fetch('/api/scenario');
    if (!r.ok) throw new Error('Could not load the scenario.');
    return r.json();
  },
  async post(path, payload) {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.json();
  },
};
