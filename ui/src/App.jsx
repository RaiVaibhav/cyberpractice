import React, { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import Header from "./components/Header.jsx";
import Chat from "./components/Chat.jsx";
import Dossier from "./components/Dossier.jsx";

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [messages, setMessages] = useState([]);
  const [activeTab, setActiveTab] = useState("brief");

  const apply = useCallback((s) => {
    setData(s);
    setMessages(
      (s.history || []).map((h) => ({
        role: h.role,
        who: h.role === "user" ? s.session || "you" : s.app.name,
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

  const selectScenario = useCallback(
    async (id) => {
      try {
        const s = await api.post("/api/select", { id });
        setActiveTab("brief");
        apply(s);
      } catch (err) {
        setError(err.message);
      }
    },
    [apply],
  );

  const mergeState = useCallback((res) => {
    setData((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      for (const k of ["panels", "solved", "solvedNote", "trace", "session"]) {
        if (res[k] !== undefined) next[k] = res[k];
      }
      if (res.trace === undefined && res.turn) next.trace = (prev.trace || []).concat(res.turn);
      return next;
    });
  }, []);

  const pushMessage = useCallback((msg) => setMessages((m) => [...m, msg]), []);

  const reset = useCallback(async () => {
    const s = await api.post("/api/reset");
    setActiveTab("brief");
    setData((prev) => ({ ...prev, ...s, trace: [] }));
    setMessages([]);
  }, []);

  if (error) {
    return <div className="grid h-screen place-items-center px-6 text-center text-destructive">⚠ {error}</div>;
  }
  if (!data) {
    return <div className="grid h-screen place-items-center text-muted-foreground">Booting scenario…</div>;
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Header
        data={data}
        scenarios={data.scenarios || []}
        currentId={data.currentId}
        onSelect={selectScenario}
        onReset={reset}
      />
      <main className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(340px,1.1fr)_minmax(380px,1fr)]">
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
