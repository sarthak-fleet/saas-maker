#!/usr/bin/env node
// Quote YAML frontmatter title/description values that contain an unquoted
// colon (which breaks YAML parsing and aborts Blume builds). Idempotent:
// already-quoted values are left alone. Usage: node fix-frontmatter-colons.mjs <docsDir>
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
if (!root) { console.error('usage: fix-frontmatter-colons.mjs <docsDir>'); process.exit(2); }

const mdFiles = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (/\.mdx?$/.test(e)) mdFiles.push(p);
  }
})(root);

let filesFixed = 0, linesFixed = 0;
const KEYS = /^(title|description|summary):\s*(.+?)\s*$/;
for (const f of mdFiles) {
  const src = readFileSync(f, 'utf8');
  const lines = src.split('\n');
  if (lines[0].trim() !== '---') continue;            // no frontmatter
  let end = -1;
  for (let i = 1; i < lines.length; i++) { if (lines[i].trim() === '---') { end = i; break; } }
  if (end < 0) continue;
  let changed = false;
  for (let i = 1; i < end; i++) {
    const m = lines[i].match(KEYS);
    if (!m) continue;
    const [, key, rawVal] = m;
    const val = rawVal.trim();
    // already quoted (single or double) → skip
    if (/^(".*"|'.*')$/.test(val)) continue;
    // only quote if the value contains a colon (the YAML-breaking case) or a leading special char
    if (!/:/.test(val) && !/^[>|@`*&!%#{}\[\],]/.test(val)) continue;
    const escaped = val.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    lines[i] = `${key}: "${escaped}"`;
    changed = true; linesFixed++;
  }
  if (changed) { writeFileSync(f, lines.join('\n')); filesFixed++; }
}
console.log(`frontmatter fix: ${linesFixed} value(s) quoted across ${filesFixed} file(s) in ${root}`);
