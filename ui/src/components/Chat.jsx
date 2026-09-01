import React, { useEffect, useRef, useState } from "react";
import { Send, CheckCircle2 } from "lucide-react";
import { api } from "../api.js";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export default function Chat({ data, messages, pushMessage, mergeState }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);
  const taRef = useRef(null);
  const session = data.session || "you";

  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    pushMessage({ role: "user", who: session, text });
    setBusy(true);
    try {
      const res = await api.post("/api/message", { message: text });
      mergeState(res);
      pushMessage({ role: "assistant", who: data.app.name, text: res.reply });
    } catch (err) {
      pushMessage({ role: "assistant", who: "system", text: "⚠ " + err.message });
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex min-h-0 flex-col border-r">
      <div className="flex items-center justify-between border-b bg-card/40 px-4 py-3">
        <div>
          <div className="font-semibold">{data.app.name}</div>
          <div className="text-sm text-muted-foreground">{data.app.tagline}</div>
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          session: <span className="text-sky-400">{session}</span>
        </div>
      </div>

      {data.solved && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-emerald-600/40 bg-emerald-950/40 px-3 py-2.5 text-sm text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span><span className="font-semibold">Objective complete.</span> {data.solvedNote}</span>
        </div>
      )}

      <div ref={boxRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="mx-auto max-w-[90%] text-center text-sm italic text-muted-foreground">
            This is a live target. Try to reach the objective — check the Brief tab on the right.
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "sys" ? (
            <div key={i} className="mx-auto max-w-[90%] text-center text-xs italic text-muted-foreground">
              {m.text}
            </div>
          ) : (
            <div
              key={i}
              className={cn(
                "max-w-[85%] whitespace-pre-wrap break-words rounded-xl border px-3 py-2 text-sm",
                m.role === "user" && "self-end rounded-br-sm border-sky-800/60 bg-sky-950/50",
                m.role === "assistant" && "self-start rounded-bl-sm border-border bg-card",
                m.role === "victim" && "self-end rounded-br-sm border-pink-900/60 bg-pink-950/40",
              )}
            >
              <div className={cn("mb-1 text-[10px] uppercase tracking-wide text-muted-foreground", m.role === "victim" && "text-pink-400")}>
                {m.who}
              </div>
              {m.text}
            </div>
          ),
        )}
      </div>

      <div className="flex items-end gap-2 border-t bg-card/40 p-3">
        <Textarea
          ref={taRef}
          value={input}
          rows={1}
          placeholder={`Message ${data.app.name} as "${session}"…`}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          className="max-h-36 min-h-[40px] flex-1 resize-none"
        />
        <Button onClick={send} disabled={busy}>
          <Send className="h-4 w-4" />
          Send
        </Button>
      </div>
    </div>
  );
}
