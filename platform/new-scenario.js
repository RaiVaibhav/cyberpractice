#!/usr/bin/env node
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const id = process.argv.slice(2).find((a) => !a.startsWith('-'));
if (!id) {
  console.error('\n  Usage: npm run new -- <category>/<subtype>\n  e.g.   npm run new -- broken-access-control/idor\n');
  process.exit(1);
}

const dir = join(process.cwd(), id);
mkdirSync(dir, { recursive: true });
const name = basename(id);
const cap = name.replace(/(^|[-_/])(\w)/g, (_, s, c) => (s === '-' || s === '_' ? ' ' : '') + c.toUpperCase());

const briefPath = join(dir, 'scenario.md');
if (!existsSync(briefPath)) {
  writeFileSync(briefPath, `# ${cap}\n\nDescribe the scenario here: what the target does, what the attacker's goal is,\nand any real-world background.\n`);
}

const cfgPath = join(dir, 'scenario.config.js');
if (existsSync(cfgPath)) {
  console.log(`\n  ${cfgPath} already exists — leaving it untouched.\n`);
  process.exit(0);
}

const tmpl = readFileSync(join(process.cwd(), 'templates', 'scenario.config.template.js'), 'utf8')
  .replaceAll('__TITLE__', `${cap} — Practice Scenario`)
  .replaceAll('__SUBTYPE__', cap);

writeFileSync(cfgPath, tmpl);

console.log(`
  Created:
    ${id}/scenario.md              (edit the brief)
    ${id}/scenario.config.js       (define tools, guardrails, win condition)

  Then run:
    npm run scenario -- ${id}
`);
