import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const IGNORE = new Set(['node_modules', '.git', 'platform', 'templates', '.claude', 'dist', '.vscode']);

/** Recursively collect every directory that contains a scenario.md or scenario.config.js. */
export function discover(root) {
  const found = [];

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const names = new Set(entries.map((e) => e.name));
    const configFile = ['scenario.config.js', 'scenario.config.mjs'].find((f) => names.has(f));
    // Any markdown file whose name starts with "scen" counts as a brief (tolerates typos like scenraio.md)
    const briefFile = entries
      .filter((e) => e.isFile() && /^scen.*\.md$/i.test(e.name))
      .map((e) => e.name)[0];

    if (configFile || briefFile) {
      const id = relative(root, dir).split(sep).join('/');
      if (id) found.push({ id, dir, configFile, briefFile, runnable: Boolean(configFile) });
    }

    for (const e of entries) {
      if (e.isDirectory() && !IGNORE.has(e.name) && !e.name.startsWith('.')) walk(join(dir, e.name));
    }
  }

  walk(root);
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

/** Resolve a user-supplied string to exactly one scenario, or throw with a helpful message. */
export function resolve(root, query) {
  const all = discover(root);
  const q = String(query).replace(/^[./]+|\/+$/g, '').toLowerCase();

  const exact = all.find((s) => s.id.toLowerCase() === q);
  if (exact) return requireRunnable(exact);

  const tail = all.filter((s) => s.id.toLowerCase().endsWith('/' + q) || s.id.toLowerCase() === q);
  if (tail.length === 1) return requireRunnable(tail[0]);

  const partial = all.filter((s) => s.id.toLowerCase().includes(q));
  if (partial.length === 1) return requireRunnable(partial[0]);

  if (partial.length > 1) {
    const runnable = partial.filter((s) => s.runnable);
    if (runnable.length === 1) return requireRunnable(runnable[0]);
    throw new Error(
      `"${query}" matches ${partial.length} scenarios:\n` +
        partial.map((s) => `    ${s.id}${s.runnable ? '' : '  (no scenario.config.js yet)'}`).join('\n') +
        `\n\n  Be more specific.`
    );
  }

  throw new Error(
    `No scenario matches "${query}".\n\n  Available:\n` +
      all.map((s) => `    ${s.id}${s.runnable ? '' : '  (no scenario.config.js yet)'}`).join('\n')
  );
}

function requireRunnable(s) {
  if (!s.runnable) {
    throw new Error(
      `Scenario "${s.id}" has a brief but no scenario.config.js, so there is no app to practise against.\n` +
        `  Scaffold one with:  npm run new -- ${s.id}`
    );
  }
  return s;
}

/** Load and lightly validate a scenario config module. */
export async function load(entry) {
  const mod = await import(pathToFileURL(join(entry.dir, entry.configFile)).href);
  const cfg = mod.default;
  if (!cfg || typeof cfg !== 'object') throw new Error(`${entry.id}: scenario.config.js must export default an object`);
  for (const key of ['title', 'systemPrompt', 'tools', 'initialState', 'checkSolved']) {
    if (cfg[key] == null) throw new Error(`${entry.id}: scenario config is missing required key "${key}"`);
  }
  const brief = entry.briefFile ? readFileSync(join(entry.dir, entry.briefFile), 'utf8') : '';
  return { ...cfg, id: entry.id, dir: entry.dir, brief: cfg.brief || brief };
}

export function readBrief(entry) {
  const p = entry.briefFile && join(entry.dir, entry.briefFile);
  return p && existsSync(p) ? readFileSync(p, 'utf8') : '';
}

export function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
