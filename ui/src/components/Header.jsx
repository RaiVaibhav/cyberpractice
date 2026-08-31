import React from 'react';

const Chip = ({ children, kind }) => <span className={'chip' + (kind ? ' ' + kind : '')}>{children}</span>;

// Difficulty → a colour class, easy → hard.
const DIFF_CLASS = {
  Starter: 'd-starter',
  Core: 'd-core',
  Advanced: 'd-advanced',
  Expert: 'd-expert',
};

export default function Header({ data, scenarios, currentId, onSelect, onReset }) {
  const diffClass = DIFF_CLASS[data.difficulty] || 'd-core';

  function random() {
    const others = scenarios.filter((s) => s.id !== currentId);
    const pool = others.length ? others : scenarios;
    if (!pool.length) return;
    onSelect(pool[Math.floor(Math.random() * pool.length)].id);
  }

  // Group scenarios by category for the dropdown.
  const groups = {};
  for (const s of scenarios) (groups[s.category] ||= []).push(s);

  return (
    <header className="top">
      <div className="brand">
        <span className="logo">🛡️</span>
        <span>cyberpractice</span>
        <span className="sub">· attack lab</span>
      </div>

      <div className="switcher">
        <select
          className="scenario-select"
          value={currentId || ''}
          onChange={(e) => onSelect(e.target.value)}
          title="Switch scenario"
        >
          {Object.entries(groups).map(([category, items]) => (
            <optgroup key={category} label={category}>
              {items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.subtype} — {s.title} · {s.difficulty}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button className="ghost dice" onClick={random} title="Random scenario">
          🎲 Random
        </button>
      </div>

      <div className="crumbs">
        <Chip>{data.subtype}</Chip>
        <Chip kind={diffClass}>{data.difficulty}</Chip>
        <Chip kind="model">{data.provider.label}</Chip>
      </div>

      <div className="spacer" />
      <button className="ghost" onClick={onReset}>
        ↻ Reset
      </button>
    </header>
  );
}
