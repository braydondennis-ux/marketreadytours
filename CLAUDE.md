# MarketReady Tours — working rules

## RULE 1 (non-negotiable): NEVER touch production without Braydon's explicit OK

"Production" means all of:
- the live domain **marketreadytours.com**
- the prod Firebase project **`marketready-tours`** — its Realtime Database, Auth, Storage,
  **rules**, and **data**
- any **`vercel --prod`** / production deploy

Until Braydon explicitly approves a specific action, ALL work stays on:
- the **local Firebase emulator** (`npm run emu`) + a local static server, or
- an **isolated dev/preview** — Vercel preview URLs (`*.vercel.app`) auto-use the separate
  **`marketready-tours-dev`** Firebase project.

Do NOT: run `vercel --prod`, publish rules to the prod Firebase console, point code/tests at
the prod domain, or migrate/alter prod data. If a task appears to require production, **stop
and ask for Braydon's go-ahead first.** The prod go-live runbook (HANDOFF.md §5) is gated on
that approval.

## Where things live
- Canonical project state + architecture: **HANDOFF.md** (read it first).
- The whole app is one file: **`index.html`** (compiled `React.createElement`, no JSX source).
  Keep **`www/index.html`** byte-identical (`cp index.html www/index.html`) before committing.
- CI gate: `www/validate.js` runs an authoritative `new Function` parse check on push.
- After editing the script region, always run the parse check:
  `node -e "const h=require('fs').readFileSync('index.html','utf8');const m=h.match(/<script type=\"text\/javascript\">([\s\S]*?)<\/script>/);new Function(m[1]);console.log('parse OK')"`
