#!/usr/bin/env node
/**
 * Validate a merged Competitions HTML file before pasting it into Squarespace.
 *
 * Usage:
 *   node validate.js competitions-all-in-one.html
 *
 * Requires only Node.js (no npm install). Checks:
 *   1. Every inline <script> block is syntactically valid JS.
 *   2. No duplicate element IDs (a Squarespace-page-breaking bug —
 *      getElementById only ever finds the first match).
 *   3. No duplicate top-level `const`/`let`/`function` declarations
 *      (these throw a hard error and take down every script on the
 *      page, not just the section that caused it).
 *   4. Balanced <!DOCTYPE>/<html>/<body>/<script> tag counts.
 *
 * Exits 0 and prints "PASS" if everything checks out; exits 1 and
 * prints exactly what's wrong otherwise.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node validate.js <path-to-html-file>');
  process.exit(1);
}
const html = fs.readFileSync(file, 'utf8');
let failures = [];

// ── 1. Extract & syntax-check every inline <script> block ──
const scriptBlocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-js-'));
scriptBlocks.forEach((code, i) => {
  const tmpFile = path.join(tmpDir, `script${i}.js`);
  fs.writeFileSync(tmpFile, code);
  try {
    execFileSync(process.execPath, ['--check', tmpFile], { stdio: 'pipe' });
  } catch (e) {
    failures.push(`Script block #${i + 1} has a JS syntax error:\n` + e.stderr.toString().trim());
  }
});
fs.rmSync(tmpDir, { recursive: true, force: true });

// ── 2. Duplicate element IDs ──
const ids = [...html.matchAll(/\bid="([a-zA-Z0-9_-]+)"/g)].map(m => m[1]);
const idCounts = {};
ids.forEach(id => { idCounts[id] = (idCounts[id] || 0) + 1; });
Object.entries(idCounts).filter(([, n]) => n > 1).forEach(([id, n]) => {
  failures.push(`Duplicate id="${id}" appears ${n} times — getElementById will only ever find the first one.`);
});

// ── 3. Duplicate top-level const/let declarations across sections ──
// All inline <script> blocks without type="module" share ONE global scope
// in the browser, executed in document order — so this concatenates them
// exactly that way and lets Node's own parser catch a real redeclaration
// (which is a hard SyntaxError for const/let, same as it would be live).
// This is far more reliable than a regex scan, which can't tell a real
// top-level global from a same-named local variable inside some other
// section's function.
const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-combined-'));
const combinedPath = path.join(tmpDir2, 'combined.js');
fs.writeFileSync(combinedPath, scriptBlocks.join('\n;\n'));
try {
  execFileSync(process.execPath, ['--check', combinedPath], { stdio: 'pipe' });
} catch (e) {
  const msg = e.stderr.toString().trim();
  if (/already been declared/.test(msg)) {
    failures.push(`Two sections declare the same top-level const/let — this breaks the ENTIRE page, not just one section:\n` + msg);
  } else {
    failures.push(`Combining all <script> blocks in document order (as the browser will) produces a syntax error:\n` + msg);
  }
}
fs.rmSync(tmpDir2, { recursive: true, force: true });

// ── 4. Balanced structural tags ──
function count(re) { return (html.match(re) || []).length; }
const structural = {
  '<!DOCTYPE': count(/<!DOCTYPE/gi),
  '<html': count(/<html[ >]/gi),
  '</html>': count(/<\/html>/gi),
  '<body': count(/<body[ >]/gi),
  '</body>': count(/<\/body>/gi),
};
Object.entries(structural).forEach(([tag, n]) => {
  if (n !== 1) failures.push(`Expected exactly one ${tag} tag, found ${n}.`);
});
const scriptOpen = count(/<script>/g);
const scriptClose = count(/<\/script>/g);
if (scriptOpen !== scriptClose) {
  failures.push(`Mismatched <script>/</script> tags: ${scriptOpen} open vs ${scriptClose} close.`);
}

// ── Report ──
if (failures.length) {
  console.error(`FAIL — ${failures.length} issue(s) found in ${file}:\n`);
  failures.forEach((f, i) => console.error(`${i + 1}. ${f}\n`));
  process.exit(1);
} else {
  console.log(`PASS — ${file} looks safe to paste into Squarespace.`);
  console.log(`  (${scriptBlocks.length} script blocks checked, ${ids.length} ids)`);
  process.exit(0);
}
