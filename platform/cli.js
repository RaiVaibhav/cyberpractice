#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { discover, resolve as resolveScenario } from './registry.js';
import { createHub } from './engine.js';
import { startServer } from './server.js';

const ROOT = process.cwd();
const VITE_BIN = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const DIST = join(ROOT, 'platform', 'web-dist', 'index.html');

// Load a local .env (KEY=value lines) if present, so `npm run free` picks up
// GROQ_API_KEY / CYBERPRACTICE_FREE without you exporting them every shell.
try {
  process.loadEnvFile(join(ROOT, '.env'));
} catch {
  /* no .env, or unreadable — that's fine, env vars still work */
}
const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('-')));
// Accept `--scenario x`, `--scenario=x`, or a bare positional argument.
const positional = argv.filter((a) => !a.startsWith('-'));
const eqArg = argv.find((a) => a.startsWith('--scenario='))?.split('=').slice(1).join('=');
const flagIdx = argv.indexOf('--scenario');
const flagArg = flagIdx >= 0 ? argv[flagIdx + 1] : undefined;
const target = eqArg || (flagArg && !flagArg.startsWith('-') ? flagArg : undefined) || positional.find((p) => p !== flagArg);

if (flags.has('--help') || flags.has('-h')) {
  usage();
  process.exit(0);
}

if (flags.has('--list') || flags.has('-l')) {
  list();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n' + C.red('  ✗ ') + err.message + '\n');
  process.exit(1);
});

async function main() {
  const real = flags.has('--real');
  const free = flags.has('--free');
  const dev = flags.has('--dev');
  if (real && free) throw new Error('Pick one of --real (Claude) or --free (Ollama/Groq/…), not both.');

  // The hub holds every scenario; the browser can switch between them live.
  const hub = await createHub(ROOT, { real, free });

  // Land on the requested scenario, or a random one if none was named.
  let startId;
  if (target && !flags.has('--random')) startId = resolveScenario(ROOT, target).id;
  else startId = hub.ids()[Math.floor(Math.random() * hub.ids().length)];
  await hub.select(startId);
  const scenario = hub.current().scenario;

  if (!dev) ensureUiBuilt();

  const port = Number(process.env.PORT || 4173);
  const { url } = await startServer(hub, { port });

  // In --dev the React app is served by the Vite dev server (HMR), which
  // proxies /api back to the Node API server we just started.
  const uiPort = Number(process.env.UI_PORT || 5173);
  const viteChild = dev ? startViteDev(port, uiPort) : null;
  const openUrl = dev ? `http://localhost:${uiPort}` : url;

  console.log('');
  console.log('  ' + C.bold(scenario.title));
  console.log('  ' + C.dim(`${scenario.category} › ${scenario.subtype}  ·  ${scenario.difficulty}`));
  console.log('');
  console.log('  ' + C.dim('Objective  ') + scenario.objective);
  console.log('  ' + C.dim('Target     ') + (scenario.app?.name || 'app'));
  console.log('  ' + C.dim('Model      ') + hub.current().provider.label);
  console.log('  ' + C.dim('Scenarios  ') + `${hub.ids().length} available — switch or 🎲 in the browser`);
  if (dev) console.log('  ' + C.dim('Mode       ') + C.yellow('dev (Vite HMR)') + C.dim('  api → ' + url));
  console.log('');
  console.log('  ' + C.green('▸') + '  ' + C.cyan(openUrl));
  console.log('  ' + C.dim('Ctrl+C to stop.'));
  console.log('');

  if (viteChild) {
    const bye = () => {
      try { viteChild.kill(); } catch {}
      process.exit(0);
    };
    process.on('SIGINT', bye);
    process.on('SIGTERM', bye);
  }

  if (!flags.has('--no-open')) open(openUrl);
}

/** Build the React UI into platform/web-dist if it isn't there yet.
 *  First run only — the output is cached until you change the UI. */
function ensureUiBuilt() {
  if (existsSync(DIST)) return;
  if (!existsSync(VITE_BIN)) {
    throw new Error('UI dependencies not installed. Run `npm install` first, then re-run this command.');
  }
  console.log('\n  ' + C.dim('Building UI (first run — cached afterwards)…'));
  const r = spawnSync(process.execPath, [VITE_BIN, 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('UI build failed. Try `npm install` then `npm run build:ui`.');
}

/** Start the Vite dev server (HMR) for --dev, proxying /api to the API port. */
function startViteDev(apiPort, uiPort) {
  if (!existsSync(VITE_BIN)) throw new Error('UI dependencies not installed. Run `npm install` first.');
  return spawn(process.execPath, [VITE_BIN], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, API_PORT: String(apiPort), UI_PORT: String(uiPort) },
  });
}

function list() {
  const all = discover(ROOT);
  console.log('\n  ' + C.bold('Scenarios') + '\n');
  if (!all.length) return console.log('  ' + C.dim('None found. Create a folder with a scenario.md.') + '\n');

  const groups = new Map();
  for (const s of all) {
    const [top] = s.id.split('/');
    if (!groups.has(top)) groups.set(top, []);
    if (s.id !== top) groups.get(top).push(s);
    else groups.set(top, groups.get(top));
  }

  for (const [top, kids] of groups) {
    console.log('  ' + C.bold(top));
    if (!kids.length) console.log('    ' + C.dim('(no sub-scenarios yet)'));
    for (const k of kids) {
      const flag = k.runnable ? C.green('●') : C.yellow('○');
      const note = k.runnable ? '' : C.dim('  needs scenario.config.js — npm run new -- ' + k.id);
      console.log(`    ${flag} ${k.id}${note}`);
    }
    console.log('');
  }
  console.log('  ' + C.dim('Run:') + '  npm run scenario -- <id>\n');
}

function usage() {
  console.log(`
  ${C.bold('cyberpractice')} — local practice range for LLM attack scenarios

  ${C.bold('Usage')}
    npm run scenario -- <category>/<subtype>     boot the practice app
    npm run scenario                             boot a RANDOM scenario
    npm run scenario -- --scenario <id>          same thing, explicit flag
    npm run list                                 show every scenario
    npm run new -- <category>/<subtype>          scaffold a new scenario

  Every scenario is loaded, so you can switch between them (and hit 🎲 for a
  random one) right in the browser — no need to restart.

  ${C.bold('Flags')}
    --random      ignore the id and start on a random scenario
    --free        run against a FREE real model (default: local Ollama, no key)
                  presets via CYBERPRACTICE_FREE: ollama | groq | openrouter | gemini
    --real        run against a live Claude model instead of the simulator
                  (needs \`npm install\` + ANTHROPIC_API_KEY or \`ant auth login\`)
    --dev         run the Vite dev server (React HMR) for UI hacking; the API
                  runs on PORT and Vite proxies /api to it
    --no-open     don't launch a browser
    --list, -l    list scenarios
    --help, -h    this text

  ${C.bold('UI')}
    React + Vite. \`npm install\` once; the first \`npm run scenario\` builds it
    into platform/web-dist (cached afterwards). \`npm run build:ui\` rebuilds.

  ${C.bold('Free model (--free)')}
    Default is Ollama running locally — install from https://ollama.com, then
    \`ollama pull llama3.1\`. No API key, no cost. Or use a hosted free tier:
      CYBERPRACTICE_FREE=groq   npm run scenario -- <id> --free   (free GROQ_API_KEY)

  ${C.bold('Env')}
    PORT                    server port (default 4173)
    CYBERPRACTICE_MODEL     model id for --real (default claude-opus-5)
    CYBERPRACTICE_FREE      free preset: ollama | groq | openrouter | gemini
    CYBERPRACTICE_FREE_MODEL   override the free model name
    CYBERPRACTICE_FREE_BASE_URL / _KEY   point --free at any OpenAI-compatible server
`);
}

function open(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  } catch {
    /* the URL is printed above either way */
  }
}
