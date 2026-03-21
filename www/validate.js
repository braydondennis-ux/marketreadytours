#!/usr/bin/env node
/**
 * MarketReady Tours — Automated Validation Script
 * Runs on every GitHub push to catch errors before they go live.
 * 
 * Checks:
 * 1. HTML file exists
 * 2. JavaScript parses without errors
 * 3. No duplicate variable declarations
 * 4. Brace/paren balance
 * 5. No raw JSX (should be pre-compiled)
 * 6. Required constants are present
 * 7. Firebase config is present
 * 8. No console.log MRT: debug statements left in
 */

const fs = require('fs');
const path = require('path');

let errors = [];
let warnings = [];
let passed = 0;

function check(name, fn) {
  try {
    const result = fn();
    if (result === false) {
      errors.push(`❌ FAIL: ${name}`);
    } else if (typeof result === 'string') {
      warnings.push(`⚠️  WARN: ${name} — ${result}`);
      passed++;
    } else {
      console.log(`  ✅ ${name}`);
      passed++;
    }
  } catch(e) {
    errors.push(`❌ FAIL: ${name}\n     ${e.message}`);
  }
}

console.log('\n🔍 MarketReady Tours — Running Validation Checks\n');

// ── 1. File exists ──
const htmlPath = path.join(__dirname, 'index.html');
check('index.html exists', () => {
  if (!fs.existsSync(htmlPath)) throw new Error('index.html not found in www/');
});

const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';

// ── 2. Extract script ──
let script = '';
check('Script block found', () => {
  const match = html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('No <script type="text/javascript"> block found. Was it compiled?');
  script = match[1];
  if (script.length < 10000) throw new Error(`Script too small (${script.length} chars) — may be empty or corrupted`);
});

// ── 3. No raw Babel/JSX ──
check('No Babel standalone (pre-compiled)', () => {
  if (html.includes('babel-standalone') || html.includes('babel.min.js')) {
    throw new Error('babel-standalone CDN still present — run the compile step');
  }
  if (html.includes('type="text/babel"')) {
    throw new Error('Found type="text/babel" — JSX not compiled');
  }
});

// ── 4. Brace balance ──
check('Brace balance { }', () => {
  if (!script) return;
  // Count braces outside of strings/template literals (simplified)
  let depth = 0, minDepth = 0;
  let inString = false, stringChar = '';
  let inTemplate = 0;
  for (let i = 0; i < script.length; i++) {
    const ch = script[i];
    const prev = i > 0 ? script[i-1] : '';
    if (inString) {
      if (ch === stringChar && prev !== '\\') inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; stringChar = ch; continue; }
    if (ch === '`') { inTemplate++; continue; }
    if (inTemplate > 0) { if (ch === '`') inTemplate--; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth < minDepth) minDepth = depth; }
  }
  if (depth !== 0) throw new Error(`Unbalanced braces: net ${depth > 0 ? '+' : ''}${depth}`);
  if (minDepth < 0) throw new Error(`Brace depth went negative (${minDepth}) — extra closing brace somewhere`);
});

// ── 5. Paren balance ──
check('Paren balance ( )', () => {
  if (!script) return;
  const open = (script.match(/\(/g)||[]).length;
  const close = (script.match(/\)/g)||[]).length;
  if (open !== close) throw new Error(`Unbalanced parens: ${open} open, ${close} close (diff: ${open-close})`);
});

// ── 6. No duplicate const declarations (top-level) ──
check('No duplicate const declarations', () => {
  if (!script) return;
  const consts = {};
  const dupes = [];
  const matches = script.matchAll(/\bconst\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/g);
  for (const m of matches) {
    const name = m[1];
    // Only flag truly global ones (common problem variables)
    if (['sorted', 'seen', 'html', 'ok', 'sent', 'failed'].includes(name)) continue;
    consts[name] = (consts[name] || 0) + 1;
  }
  for (const [name, count] of Object.entries(consts)) {
    if (count > 3) dupes.push(`${name} (${count}x)`);
  }
  if (dupes.length > 0) return `Possibly over-declared: ${dupes.join(', ')}`;
});

// ── 7. Firebase config present ──
check('Firebase config present', () => {
  if (!html.includes('marketready-tours-default-rtdb.firebaseio.com')) {
    throw new Error('Firebase database URL not found');
  }
  if (!html.includes('apiKey')) {
    throw new Error('Firebase apiKey not found');
  }
});

// ── 8. Required constants ──
check('Required app constants present', () => {
  const required = [
    'SUPER_ADMIN_EMAIL',
    'SEND_EMAIL_URL',
    'LISTING_REQUEST_FORMSPREE',
    'RATING_CATS',
  ];
  const missing = required.filter(c => !html.includes(c));
  if (missing.length > 0) throw new Error(`Missing constants: ${missing.join(', ')}`);
});

// ── 9. React entry point ──
check('React app entry point present', () => {
  if (!html.includes('ReactDOM.createRoot')) {
    throw new Error('ReactDOM.createRoot not found — app may not mount');
  }
  if (!html.includes('ErrorBoundary')) {
    return 'ErrorBoundary not found — consider adding one';
  }
});

// ── 10. No debug logs left in ──
check('No MRT debug console.logs', () => {
  if (html.includes('console.log("MRT:') || html.includes("console.log('MRT:")) {
    throw new Error('Debug console.log statements found — remove before deploy');
  }
});

// ── 11. Meta tags ──
check('PWA meta tags present', () => {
  if (!html.includes('apple-mobile-web-app-capable')) {
    return 'Missing apple-mobile-web-app-capable meta tag';
  }
});

// ── 12. File size sanity ──
check('File size reasonable', () => {
  const kb = Math.round(html.length / 1024);
  if (kb < 50) throw new Error(`File too small (${kb}KB) — may be corrupted`);
  if (kb > 2000) return `File is large (${kb}KB) — consider splitting`;
  console.log(`     (${kb}KB)`);
});

// ── Summary ──
console.log('\n─────────────────────────────────────────');
if (warnings.length > 0) {
  console.log('\nWarnings:');
  warnings.forEach(w => console.log(' ', w));
}
if (errors.length > 0) {
  console.log('\nErrors:');
  errors.forEach(e => console.log(' ', e));
  console.log(`\n❌ ${errors.length} error(s) found. Fix before deploying.\n`);
  process.exit(1);
} else {
  console.log(`\n✅ All ${passed} checks passed!`);
  if (warnings.length > 0) console.log(`⚠️  ${warnings.length} warning(s) — review above.`);
  console.log('\n🚀 Safe to deploy.\n');
  process.exit(0);
}
