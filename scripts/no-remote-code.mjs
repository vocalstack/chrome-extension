// Fails when a build would load a script from another server: Manifest V3
// forbids remote code, and the stores refuse a package that asks for it.
// Run by scripts/package.sh on every build:
//
//   node scripts/no-remote-code.mjs output/chrome output/edge
//
// It looks in every bundled .js and .html file for the address of a .js
// file on another server, and in .html for a <script src> that is not the
// extension's own. wxt.config.ts (noRemoteScripts) takes the ones a
// dependency brings out of the build; a new one shows here.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const REMOTE_JS = /https?:\/\/[^"'`\s)]+?\.js(?=["'`?#])/g;
const REMOTE_TAG = /<script[^>]+src=["'](?:https?:)?\/\/[^"']+/gi;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(js|mjs|html)$/.test(name) ? [p] : [];
  });
}

const dirs = process.argv.slice(2);
if (!dirs.length) { console.error('usage: no-remote-code.mjs <build dir>…'); process.exit(2); }
let bad = 0;
let seen = 0;
for (const dir of dirs) {
  for (const file of files(dir)) {
    seen++;
    const text = readFileSync(file, 'utf8');
    for (const m of [...(text.match(REMOTE_JS) ?? []), ...(file.endsWith('.html') ? text.match(REMOTE_TAG) ?? [] : [])]) {
      console.error(`[no-remote-code] ${file}: ${m}`);
      bad++;
    }
  }
}
if (!seen) { console.error(`[no-remote-code] no files in ${dirs.join(', ')}`); process.exit(2); }
if (bad) { console.error(`[no-remote-code] ${bad} remote script address(es): an extension may not load code from another server.`); process.exit(1); }
console.log(`[no-remote-code] ${seen} files, none loads a script from another server`);
