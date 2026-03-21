#!/usr/bin/env node
/**
 * MarketReady Tours — Build Script
 * 
 * Usage: node build.js
 * 
 * What it does:
 * 1. Extracts the JSX from index.html
 * 2. Compiles it with Babel (optional chaining, nullish coalescing, JSX → React.createElement)
 * 3. Injects compiled JS back into index.html
 * 4. Writes the deployable file to index.html
 * 
 * Run this before every deploy:
 *   node build.js
 *   git add . && git commit -m "your message" && git push
 */

const babel = require('@babel/core');
const fs = require('fs');

console.log('\n🔨 MarketReady Tours — Building...\n');

const htmlPath = './index.html';

if (!fs.existsSync(htmlPath)) {
  console.error('❌ index.html not found');
  process.exit(1);
}

let html = fs.readFileSync(htmlPath, 'utf8');

// Check if it needs compiling (has text/babel) or is already compiled
const needsCompile = html.includes('type="text/babel"');
const alreadyCompiled = html.includes('type="text/javascript"') && !html.includes('type="text/babel"');

if (alreadyCompiled) {
  console.log('✅ Already compiled — no build needed.');
  console.log('   Running validation...\n');
  require('./validate.js');
  process.exit(0);
}

if (!needsCompile) {
  console.error('❌ No script block found in index.html');
  process.exit(1);
}

// Extract JSX
const match = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/);
if (!match) {
  console.error('❌ Could not find text/babel script block');
  process.exit(1);
}

const jsxSource = match[1];
console.log(`📦 Compiling ${Math.round(jsxSource.length/1024)}KB of JSX...`);

try {
  const result = babel.transformSync(jsxSource, {
    filename: 'app.jsx',
    presets: [
      ['@babel/preset-env', {
        targets: {
          browsers: [
            'chrome >= 70',
            'firefox >= 65', 
            'safari >= 12',
            'edge >= 79',
            'samsung >= 10',
            'ios >= 12'
          ]
        },
        modules: false,
        useBuiltIns: false
      }],
      ['@babel/preset-react', { runtime: 'classic' }]
    ],
    compact: false
  });

  // Remove babel standalone CDN
  html = html.replace(
    /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/babel-standalone[^"]*"><\/script>\n?/g, 
    ''
  );

  // Replace text/babel with compiled JS
  html = html.replace(
    /<script type="text\/babel">[\s\S]*?<\/script>/,
    '<script type="text/javascript">\n' + result.code + '\n</script>'
  );

  fs.writeFileSync(htmlPath, html);
  
  const sizeKB = Math.round(html.length / 1024);
  console.log(`✅ Compiled successfully → ${sizeKB}KB\n`);
  console.log('🚀 Ready to deploy!\n');
  console.log('   git add . && git commit -m "your message" && git push\n');

} catch(e) {
  console.error('❌ Babel compile error:\n');
  console.error(e.message);
  process.exit(1);
}
