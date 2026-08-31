import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import Header from './components/Header.jsx';
import Chat from './components/Chat.jsx';
import Dossier from './components/Dossier.jsx';

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [messages, setMessages] = useState([]);
  const [activeTab, setActiveTab] = useState('brief');

  // Turn a full scenario snapshot into UI state (used on load, select, reset).
  const apply = useCallback((s) => {
    setData(s);
    setMessages(
      (s.history || []).map((h) => ({
        role: h.role,
        who: h.role === 'user' ? s.session || 'you' : s.app.name,
        text: h.content,
      })),
    );
    setError(null);
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await api.get());
    } catch (err) {
      setError(err.message);
    }
  }, [apply]);

  useEffect(() => {
    load();
  }, [load]);

  // Switch to another scenario (from the dropdown or the 🎲 button).
  const selectScenario = useCallback(
    async (id) => {
      try {
        const s = await api.post('/api/select', { id });
        setActiveTab('brief');
        apply(s);
      } catch (err) {
        setError(err.message);
      }
    },
    [apply],
  );

  // Fold mutating-response fields (panels/solved/trace/session) back into state.
  const mergeState = useCallback((res) => {
    setData((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      for (const k of ['panels', 'solved', 'solvedNote', 'trace', 'session']) {
        if (res[k] !== undefined) next[k] = res[k];
      }
      if (res.trace === undefined && res.turn) next.trace = (prev.trace || []).concat(res.turn);
      return next;
    });
  }, []);

  const pushMessage = useCallback((msg) => setMessages((m) => [...m, msg]), []);

  const reset = useCallback(async () => {
    const s = await api.post('/api/reset');
    setActiveTab('brief');
    setData((prev) => ({ ...prev, ...s, trace: [] }));
    setMessages([]);
  }, []);

  if (error) {
    return <div className="loading error">⚠ {error}</div>;
  }
  if (!data) {
    return <div className="loading">Booting scenario…</div>;
  }

  return (
    <div className="wrap">
      <Header
        data={data}
        scenarios={data.scenarios || []}
        currentId={data.currentId}
        onSelect={selectScenario}
        onReset={reset}
      />
      <main>
        <Chat data={data} messages={messages} pushMessage={pushMessage} mergeState={mergeState} />
        <Dossier
          data={data}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          pushMessage={pushMessage}
          mergeState={mergeState}
        />
      </main>
    </div>
  );
}
