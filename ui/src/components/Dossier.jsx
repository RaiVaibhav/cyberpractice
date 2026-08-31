import React, { useState } from 'react';
import { api } from '../api.js';

export default function Dossier({ data, activeTab, setActiveTab, pushMessage, mergeState }) {
  const tabs = [
    ['brief', 'Brief'],
    ['state', 'State'],
    data.actions.length ? ['attack', 'Attack'] : null,
    ['trace', 'Trace'],
    ['help', 'Hints'],
  ].filter(Boolean);

  return (
    <div className="side">
      <div className="tabs">
        {tabs.map(([id, label]) => (
          <div
            key={id}
            className={'tab' + (id === activeTab ? ' active' : '')}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </div>
        ))}
      </div>

      {activeTab === 'brief' && <BriefPane data={data} />}
      {activeTab === 'state' && <StatePane data={data} />}
      {activeTab === 'attack' && data.actions.length > 0 && (
        <AttackPane
          data={data}
          pushMessage={pushMessage}
          mergeState={mergeState}
          onDone={() => setActiveTab('trace')}
        />
      )}
      {activeTab === 'trace' && <TracePane trace={data.trace} />}
      {activeTab === 'help' && <HelpPane data={data} />}
    </div>
  );
}

/* ---------------- Brief ---------------- */
function BriefPane({ data }) {
  return (
    <div className="pane">
      <div className="section-title">Your mission</div>
      <div className="card">
        <p className="obj">
          <b>Objective:</b> {data.objective}
        </p>
      </div>

      {data.background && (
        <div className="card">
          <p>{data.background}</p>
        </div>
      )}

      {data.brief && (
        <>
          <div className="section-title">Scenario brief</div>
          <div className="card">
            <pre className="sys">{data.brief.trim()}</pre>
          </div>
        </>
      )}

      <div className="section-title">Target's system prompt</div>
      <div className="card">
        <pre className="sys">{data.systemPrompt}</pre>
      </div>

      <div className="section-title">Tools the model can call</div>
      <div className="tools">
        {data.tools.map((t) => (
          <div className="tool" key={t.name}>
            <div className="n">
              {t.name}
              {t.privileged && <span className="lock">🔒 privileged</span>}
            </div>
            <div className="d">{t.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- State ---------------- */
function StatePane({ data }) {
  const panels = data.panels || [];
  return (
    <div className="pane">
      {panels.length === 0 && <p className="trace-empty">This scenario exposes no live state.</p>}
      {panels.map((panel) => (
        <React.Fragment key={panel.id}>
          <div className="section-title">{panel.title}</div>
          {panel.hint && <div className="panel-hint">{panel.hint}</div>}
          <div className="card">
            <div className="kv">
              {panel.rows.map((row, i) => (
                <React.Fragment key={i}>
                  <div className="k">{row.label}</div>
                  <div className={'v' + (row.flag ? ' flag' : '')}>{row.value}</div>
                </React.Fragment>
              ))}
            </div>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

/* ---------------- Attack (out-of-band actions) ---------------- */
function AttackPane({ data, pushMessage, mergeState, onDone }) {
  return (
    <div className="pane">
      <div className="section-title">Out-of-band actions</div>
      <div className="card">
        <p>
          These happen outside your chat — planting data or simulating another user. This is how you
          stage an indirect attack.
        </p>
      </div>
      {data.actions.map((action) => (
        <ActionForm
          key={action.id}
          action={action}
          appName={data.app.name}
          pushMessage={pushMessage}
          mergeState={mergeState}
          onDone={onDone}
        />
      ))}
    </div>
  );
}

function ActionForm({ action, appName, pushMessage, mergeState, onDone }) {
  const [values, setValues] = useState(() => {
    const init = {};
    for (const f of action.fields || []) init[f.name] = f.default || '';
    return init;
  });
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await api.post('/api/action', { action: action.id, fields: values });
      mergeState(res);
      if (res.transcript) {
        pushMessage({ role: 'victim', who: values.username || 'victim', text: res.transcript.user });
        pushMessage({ role: 'assistant', who: appName, text: res.transcript.reply });
      }
      pushMessage({ role: 'sys', text: '· ' + res.note + ' ·' });
      onDone();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="action-form">
      <h4>{action.label}</h4>
      <div className="d">{action.description}</div>
      {(action.fields || []).map((f) => (
        <React.Fragment key={f.name}>
          <label>{f.label || f.name}</label>
          {f.type === 'textarea' ? (
            <textarea
              rows={f.rows || 3}
              placeholder={f.placeholder || ''}
              value={values[f.name]}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            />
          ) : (
            <input
              placeholder={f.placeholder || ''}
              value={values[f.name]}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            />
          )}
        </React.Fragment>
      ))}
      <button className="attack" style={{ marginTop: 10 }} onClick={run} disabled={busy}>
        ▶ {action.label}
      </button>
    </div>
  );
}

/* ---------------- Trace ---------------- */
const KIND_LABEL = {
  trust: 'trust ⚠',
  guardrail: 'guardrail',
  solved: '✓ solved',
  action: 'action',
  reply: 'reply',
};

function TracePane({ trace }) {
  return (
    <div className="pane">
      <div className="section-title">Data-flow trace</div>
      <div className="panel-hint">
        Every hop between you, the model, and its tools. Pink = attacker-controlled text being read as
        instructions.
      </div>
      {!trace || trace.length === 0 ? (
        <div className="trace-empty">No activity yet. Send a message.</div>
      ) : (
        <div className="trace">
          {trace.map((t, i) => {
            const hop = t.from && t.to ? `${t.from} → ${t.to}` : t.actor ? `[${t.actor}]` : KIND_LABEL[t.kind] || t.kind;
            return (
              <div className={'row t-' + t.kind + (t.status ? ' ' + t.status : '')} key={i}>
                <div className="hop">{hop}</div>
                <div className="body">
                  {t.text}
                  {t.injected && <span className="badge inj">injected</span>}
                  {t.tainted && <span className="badge taint">tainted data</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------- Hints + solution ---------------- */
function HelpPane({ data }) {
  const [hints, setHints] = useState([]);
  const [exhausted, setExhausted] = useState(false);
  const [solution, setSolution] = useState(null);

  async function reveal() {
    const res = await api.post('/api/hint');
    if (res.hint) setHints((h) => [...h, res.hint]);
    if (res.exhausted) setExhausted(true);
  }

  async function onToggleSolution(e) {
    if (e.target.open && solution === null) {
      const r = await api.post('/api/solution');
      setSolution(r.solution);
    }
  }

  return (
    <div className="pane">
      <div className="section-title">Hints ({data.hintCount} available)</div>
      <div className="row-btns">
        <button onClick={reveal} disabled={exhausted}>
          💡 Reveal a hint
        </button>
      </div>
      <div className="hint-out">
        {hints.map((h, i) => (
          <div className="hint-item" key={i}>
            {h}
          </div>
        ))}
      </div>

      <div className="section-title" style={{ marginTop: 16 }}>
        Walkthrough
      </div>
      <details className="sol" onToggle={onToggleSolution}>
        <summary>Show the full solution (spoiler)</summary>
        <pre>{solution === null ? 'Loading…' : solution}</pre>
      </details>
    </div>
  );
}
