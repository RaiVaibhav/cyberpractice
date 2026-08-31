import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function Chat({ data, messages, pushMessage, mergeState }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);
  const taRef = useRef(null);
  const session = data.session || 'you';

  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    pushMessage({ role: 'user', who: session, text });
    setBusy(true);
    try {
      const res = await api.post('/api/message', { message: text });
      mergeState(res);
      pushMessage({ role: 'assistant', who: data.app.name, text: res.reply });
    } catch (err) {
      pushMessage({ role: 'assistant', who: 'system', text: '⚠ ' + err.message });
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="chat-col">
      <div className="app-banner">
        <span className="session-tag">
          session: <b>{session}</b>
        </span>
        <div className="name">{data.app.name}</div>
        <div className="tag">{data.app.tagline}</div>
      </div>

      <div className="solved-slot">
        {data.solved && (
          <div className="solved-banner">
            <b>✓ Objective complete.</b> {data.solvedNote || ''}
          </div>
        )}
      </div>

      <div className="messages" ref={boxRef}>
        {messages.length === 0 && (
          <div className="sys-note">
            This is a live target. Try to reach the objective — check the Brief tab on the right.
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'sys' ? (
            <div className="sys-note" key={i}>
              {m.text}
            </div>
          ) : (
            <div className={'msg ' + m.role} key={i}>
              <div className="who">{m.who}</div>
              {m.text}
            </div>
          ),
        )}
      </div>

      <div className="composer">
        <textarea
          ref={taRef}
          value={input}
          rows={1}
          placeholder={`Message ${data.app.name} as "${session}"…`}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          style={{ height: 'auto' }}
          onInput={(e) => {
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
          }}
        />
        <button className="primary" onClick={send} disabled={busy}>
          Send
        </button>
      </div>
    </div>
  );
}
