# Firebase Shared Backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make public contributions (ratings, favorites, sponsor signups) persist to Firebase and be shared across all users, with sponsors shown publicly only once paid — and ship it safely behind a local emulator with the staged security pass deployed first.

**Architecture:** Single-file compiled-React app (`index.html`) on Firebase RTDB project `marketready-tours`. Public users write to new granular, stable-id-keyed paths (`mrt_ratings`, `mrt_favorites`, `mrt_sponsor_signups`) via the anonymous `_fb.ref(path).set()` pattern already used by `mrt_not_interested` (`index.html:5410`). The App's Firebase sync loads those paths and **merges them back into the in-memory `tours` array**, so every existing read site (RankingPage, SummaryDashboard, favCount, isFav) keeps working unchanged. Admin `mrt_tours` writes stop carrying the granular fields. All dev/testing runs against the Firebase Emulator Suite, never prod.

**Tech Stack:** React 18 (UMD, compiled `React.createElement` — no JSX source), Firebase RTDB + Auth + Storage (compat SDK 10.12.2), Firebase Emulator Suite, Vercel static hosting, `www/validate.js` as the lint gate.

## Global Constraints

- **Deploy file is root `index.html`.** `www/index.html` is NOT deployed — do not edit it for the live site. (`vercel.json` `outputDirectory: "."`)
- **No JSX source exists.** Edit the compiled `React.createElement` JS directly in root `index.html`. `build.js` is dead.
- **Anonymous writes use `_fb.ref(path).set(value)`** (works without auth when rules permit; proven at `index.html:5410`). Do not require auth for public contributions.
- **No real emails/SMS during local testing** — `sendCFEmail`/`sendSMS` must short-circuit on `localhost`.
- **Rules changes go into `database.rules.json`** (the hardened staged draft), never the looser live rules. Additive only.
- **Verification = `node www/validate.js` (must pass) + emulator + manual two-browser acceptance.** There is no unit-test framework; do not invent one.
- **Stable keys:** tour key = `tour.id`; listing key = `listing.id`; anon user key = `localStorage["mrt_uid"]`.
- **CSP already allows** `https://*.firebaseio.com` + `wss://*.firebaseio.com` (`vercel.json`). Do not add new external hosts without updating CSP.
- Brand color constant is `B` (e.g. `B.gold`); keep existing styling idioms.

---

## Phase 0 — Local emulator harness (do first; both phases test here)

### Task 0.1: Configure Firebase emulators + npm scripts

**Files:**
- Modify: `firebase.json` (add `emulators` block)
- Create: `package.json` scripts (root) — note: root `package.json` exists with capacitor deps; add scripts there
- Prereq: Java JDK (RTDB emulator needs a JVM) + `firebase-tools` via `npx`

**Interfaces:**
- Produces: `npm run emu` (starts Auth+DB emulators), `npm run serve` (static server on :8080), `npm run dev` (build-check + serve).

- [ ] **Step 1: Confirm prerequisites**

Run: `node -v && java -version && npx firebase-tools --version`
Expected: Node ≥18 prints; Java prints a version (if "command not found", install Temurin JDK: `brew install --cask temurin`); firebase-tools downloads/prints a version.

- [ ] **Step 2: Add emulators block to `firebase.json`**

Replace the file contents with:
```json
{
  "database": { "rules": "database.rules.json" },
  "storage": { "rules": "storage.rules" },
  "emulators": {
    "auth": { "port": 9099 },
    "database": { "port": 9000 },
    "ui": { "enabled": true, "port": 4000 },
    "singleProjectMode": true
  }
}
```

- [ ] **Step 3: Add scripts to root `package.json`**

In `/Users/erikyoungberg-aspelin/Desktop/Market Ready/mrt/marketreadytours/package.json`, set the `"scripts"` block to:
```json
  "scripts": {
    "emu": "npx firebase-tools emulators:start --only auth,database --import=./.emu-seed --export-on-exit=./.emu-seed",
    "serve": "npx http-server -p 8080 -c-1 .",
    "validate": "node www/validate.js"
  },
```

- [ ] **Step 4: Ignore emulator + local artifacts**

Append to `.gitignore`:
```
.emu-seed/
firebase-debug.log
database-debug.log
ui-debug.log
```

- [ ] **Step 5: Start emulator to verify it boots**

Run: `npm run emu`
Expected: "All emulators ready", Database on `127.0.0.1:9000`, Auth on `127.0.0.1:9099`, UI on `:4000`. Leave it running in one terminal. (First run creates `.emu-seed` on exit.)

- [ ] **Step 6: Commit**

```bash
git add firebase.json package.json .gitignore
git commit -m "chore: add Firebase emulator config + dev scripts"
```

### Task 0.2: Emulator-connect shim + email/SMS guard in `index.html`

**Files:**
- Modify: `index.html` (after the Firebase init block, ~`index.html:103`)
- Modify: `index.html` (`sendCFEmail` ~`index.html:168`, `sendSMS` ~`index.html:195`)

**Interfaces:**
- Consumes: globals `_fb`, `_fbAuth`, `_fbStorage` from the init block.
- Produces: on `localhost`, all Firebase traffic hits the emulator and no email/SMS network calls fire.

- [ ] **Step 1: Add the emulator shim** immediately after the `try { firebase.initializeApp… } catch` block that ends at `index.html:103`:

```javascript
/* ── LOCAL EMULATOR (localhost only — prod untouched) ── */
window._MRT_LOCAL = ["localhost","127.0.0.1"].includes(location.hostname);
if (window._MRT_LOCAL) {
  try {
    if (_fb)      _fb.useEmulator("127.0.0.1", 9000);
    if (_fbAuth)  _fbAuth.useEmulator("http://127.0.0.1:9099", { disableWarnings: true });
    if (_fbStorage) _fbStorage.useEmulator("127.0.0.1", 9199);
    console.log("MRT: connected to local Firebase emulators");
  } catch (e) { console.warn("MRT: emulator connect failed", e); }
}
```

- [ ] **Step 2: Guard `sendCFEmail`** — at the top of the `sendCFEmail` async function body (right after the `if (!to || !isValidEmail(to))` guard at `index.html:169-172`), add:

```javascript
  if (window._MRT_LOCAL) { console.log("MRT[local]: sendCFEmail suppressed →", to, subject); return true; }
```

- [ ] **Step 3: Guard `sendSMS`** — as the first line inside the `sendSMS` function body (`index.html:195`):

```javascript
  if (window._MRT_LOCAL) { console.log("MRT[local]: sendSMS suppressed →", msg); return; }
```

- [ ] **Step 4: Validate the file still parses**

Note: `validate.js` reads `www/index.html`. For the live-file edits, copy root → www before validating, OR validate root manually. Run:
```bash
node -e "const h=require('fs').readFileSync('index.html','utf8');const m=h.match(/<script type=\"text\/javascript\">([\s\S]*?)<\/script>/);new Function(m[1]);console.log('parse OK')"
```
Expected: `parse OK` (no SyntaxError).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: emulator-connect shim + local email/SMS guard"
```

### Task 0.3: Synthetic seed data (no real PII)

**Files:**
- Create: `scripts/seed-emulator.mjs`

**Interfaces:**
- Produces: writes 2 fake tours (each with 2 listings + 1 paid + 1 unpaid sponsor) and 2 admin records into the running DB emulator via its REST endpoint.

- [ ] **Step 1: Create `scripts/seed-emulator.mjs`**

```javascript
// Seeds the LOCAL emulator only. Run with the emulator running: node scripts/seed-emulator.mjs
const DB = "http://127.0.0.1:9000";
const PROJECT = "marketready-tours";
const put = (path, data) => fetch(`${DB}/${path}.json?ns=${PROJECT}-default-rtdb`, {
  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
}).then(r => r.ok ? null : r.text().then(t => { throw new Error(path + ": " + t); }));

const mkListing = (i, addr) => ({ id: "l-"+i, order: i, address: addr, city: "Phoenix",
  beds: 3, baths: 2, sqft: 1800, dom: 12, price: 450000, agent: "Test Agent",
  agentEmail: "agent@example.com", photos: ["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=400"] });

const tours = [
  { id: "tour-demo-1", name: "Demo North Tour", emoji: "🏡", color: "#0D0D0D", code: "1234",
    date: "2026-07-15", time: "10:00 AM", maxListings: 8,
    listings: [mkListing(0,"100 Demo St"), mkListing(1,"200 Demo Ave")],
    sponsors: [
      { id:"sp-paid", name:"Paid Lender Co", email:"paid@example.com", paid:true,  paymentPlan:"full", tourLead:true },
      { id:"sp-unpd", name:"Unpaid Title Co", email:"unpaid@example.com", paid:false, paymentPlan:"half", tourLead:false }
    ] },
  { id: "tour-demo-2", name: "Demo South Tour", emoji: "🌵", color: "#2D6A4F", code: "5678",
    date: "2026-07-20", time: "1:00 PM", maxListings: 8,
    listings: [mkListing(0,"300 South Rd")], sponsors: [] }
];

await put("mrt_tours", tours);
await put("admins", {
  "super_at_example,com": { name: "Super Admin", role: "super" },
  "sub_at_example,com":   { name: "Sub Admin",   role: "sub" }
});
console.log("Seeded emulator with", tours.length, "tours.");
```

- [ ] **Step 2: Run the seed (emulator must be running)**

Run: `node scripts/seed-emulator.mjs`
Expected: `Seeded emulator with 2 tours.` Open `http://127.0.0.1:4000` (Emulator UI) → Database → confirm `mrt_tours` + `admins` exist.

- [ ] **Step 3: Create a test admin in the Auth emulator**

In Emulator UI (`:4000`) → Authentication → "Add user": email `super@example.com`, password `test1234`. (Matches the seeded `admins` key `super_at_example,com` → role `super`.)

- [ ] **Step 4: Load the app against the emulator**

In a second terminal: `npm run serve`. Open `http://localhost:8080/` in Safari. Open DevTools console; expect `MRT: connected to local Firebase emulators`. The two demo tours should load.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-emulator.mjs
git commit -m "chore: synthetic emulator seed data"
```

**Phase 0 checkpoint:** app runs at `localhost:8080` against the emulator, shows demo tours, logs the emulator-connect line, and fires no real emails. STOP and confirm before Phase A.

---

## Phase A — Ship the staged security pass (deploy FIRST, separately)

### Task A.1: Review + emulator-test the staged hardened rules

**Files:**
- Read: `database.rules.json`, `storage.rules`, `vercel.json`, `SECURITY_NOTES.md`
- Read: `git diff index.html` (XSS + SRI changes)

- [ ] **Step 1: Read the staged diff end-to-end**

Run: `git diff index.html | head -200` and read `SECURITY_NOTES.md` fully. Confirm the only `index.html` changes are `esc()`/`jsId()` (calendar XSS) + `integrity`/`crossorigin` SRI attributes. No behavioral logic changed.

- [ ] **Step 2: Point the emulator at the hardened rules**

`firebase.json` already references `database.rules.json`. Restart the emulator (`Ctrl-C`, `npm run emu`) so it loads the hardened rules. Re-seed: `node scripts/seed-emulator.mjs`.

- [ ] **Step 3: Verify the guest flow still works under hardened rules**

At `localhost:8080` (NOT logged in): open a demo tour, open a listing, submit a **listing request** (List Home form). In Emulator UI → Database, confirm a node appeared under `mrt_listing_requests`. Expected: write succeeds (create-only anon rule), and reading others' requests is denied.

- [ ] **Step 4: Verify admin write still works**

Log in as `super@example.com`. Create a tour. Confirm `mrt_tours` updates in the Emulator UI. Expected: success.

- [ ] **Step 5: Note the result** — record pass/fail of guest+admin flows in `SECURITY_NOTES.md` under a new "Phase A emulator verification" line. Commit that note.

```bash
git add SECURITY_NOTES.md
git commit -m "docs: record Phase A emulator verification"
```

### Task A.2: Commit the staged security pass

- [ ] **Step 1: Stage all security artifacts**

```bash
git add database.rules.json storage.rules firebase.json .firebaserc vercel.json index.html www/index.html SECURITY_NOTES.md
git status   # confirm nothing unexpected
```

- [ ] **Step 2: Commit**

```bash
git commit -m "security: deploy Phase 0 hardening — RTDB/Storage rules, CSP+headers, XSS escaping, SRI"
```

### Task A.3: Deploy rules + code to production

**Manual / Firebase-console steps (Erik). This IS a production change — backup first.**

- [ ] **Step 1: Backup prod RTDB** — Firebase Console → Realtime Database → Data → ⋮ → Export JSON. Save locally.

- [ ] **Step 2: Publish RTDB rules** — open `database.rules.json`, copy its contents, paste into Console → Realtime Database → **Rules** → **Publish**. (Comments are allowed.)

- [ ] **Step 3: Publish Storage rules** — copy `storage.rules` into Console → Storage → **Rules** → **Publish**.

- [ ] **Step 4: Deploy code to Vercel** — push the branch and promote, or `npx vercel --prod` from the repo. This ships `vercel.json` (CSP+headers) and the XSS/SRI `index.html`.

- [ ] **Step 5: Verify live** — open `https://www.marketreadytours.com/`:
  - DevTools → Network → main doc → Response Headers show `content-security-policy` + `x-frame-options`.
  - Console shows **no CSP violations**. Click through: open a tour, submit a listing request, log in as a real admin. If a CSP error appears, add the blocked host to `connect-src`/`script-src` in `vercel.json`, redeploy.

**Phase A checkpoint:** rules live, site loads with no CSP breakage, guest + admin flows work in prod. STOP and confirm before Phase B.

---

## Phase B — Shared backend feature

### Task B.1: Add the 3 contribution rule paths

**Files:**
- Modify: `database.rules.json` (add three top-level path blocks)

- [ ] **Step 1: Add the blocks** inside `"rules": { … }` in `database.rules.json` (after `mrt_not_interested`):

```json
    "mrt_ratings": {
      ".read": true,
      "$tourId": { "$listingId": { "$subId": {
        ".write": "auth != null || (!data.exists() && newData.exists())",
        ".validate": "newData.hasChild('submittedAt')"
      } } }
    },
    "mrt_favorites": {
      ".read": true,
      "$tourId": { "$listingId": { "$userKey": {
        ".write": true,
        ".validate": "newData.isBoolean() || !newData.exists()"
      } } }
    },
    "mrt_sponsor_signups": {
      ".read": "auth != null",
      "$tourId": { "$signupId": {
        ".write": "auth != null || (!data.exists() && newData.exists())",
        ".validate": "newData.hasChild('name') && newData.hasChild('email')"
      } } }
    },
```

- [ ] **Step 2: Reload emulator with new rules**

Run: `Ctrl-C` then `npm run emu`, then `node scripts/seed-emulator.mjs`. Expected: starts cleanly (no rules parse error).

- [ ] **Step 3: Smoke-test the rule from the emulator REST API** (anonymous create allowed, overwrite denied):

```bash
curl -s -X PUT "http://127.0.0.1:9000/mrt_ratings/tour-demo-1/l-0/s1.json?ns=marketready-tours-default-rtdb" -d '{"submittedAt":"2026-06-24T00:00:00Z","ratings":{"kitchen":5}}' ; echo
curl -s "http://127.0.0.1:9000/mrt_ratings/tour-demo-1/l-0/s1.json?ns=marketready-tours-default-rtdb" ; echo
```
Expected: first returns the written object; second reads it back. (Anon read allowed because `.read:true`.)

- [ ] **Step 4: Commit**

```bash
git add database.rules.json
git commit -m "feat: RTDB rules for guest ratings, favorites, sponsor signups"
```

### Task B.2: Anonymous user-key helper

**Files:**
- Modify: `index.html` (near `uid()` at `index.html:251`)

**Interfaces:**
- Produces: `mrtUserKey()` → stable per-browser string, used by favorites.

- [ ] **Step 1: Add the helper** after the `uid` function (`index.html:254`):

```javascript
/* ── STABLE ANON USER KEY (favorites) ── */
const mrtUserKey = () => {
  let k = lsGet("mrt_uid", null);
  if (!k) { k = uid("u"); lsSet("mrt_uid", k); }
  return k;
};
```

- [ ] **Step 2: Parse-check** (Step 4 of Task 0.2 command). Expected `parse OK`.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: stable anonymous user key helper"
```

### Task B.3: Ratings persist to `mrt_ratings` for everyone

**Files:**
- Modify: `index.html` `handleRatingSubmit` (`index.html:5963-5983`)

**Interfaces:**
- Consumes: `_fb`, `uid`. Writes `mrt_ratings/<tour.id>/<listingId>/<subId>`.

- [ ] **Step 1: Replace `handleRatingSubmit`** (`index.html:5963-5983`) with a version that writes the granular path for ALL users before the local `onUpdateTour`:

```javascript
  const handleRatingSubmit = (listingId, ratings, extra) => {
    const newSub = { ...ratings, ...(extra || {}), submittedAt: new Date().toISOString() };
    // Persist to the shared path so guests' ratings count too (anon-create allowed by rules)
    if (_fb) {
      try { _fb.ref("mrt_ratings/" + tour.id + "/" + listingId + "/" + uid("r")).set(newSub).catch(() => {}); }
      catch (e) {}
    }
    // Keep local/admin state responsive (merge-on-read will reconcile from mrt_ratings)
    const prevSubs = Array.isArray((tour.ratingSubmissions || {})[listingId]) ? (tour.ratingSubmissions || {})[listingId] : [];
    onUpdateTour({
      ...tour,
      ratings: { ...tour.ratings, [listingId]: ratings },
      ratingSubmissions: { ...(tour.ratingSubmissions || {}), [listingId]: [...prevSubs, newSub] }
    });
  };
```

- [ ] **Step 2: Parse-check.** Expected `parse OK`.

- [ ] **Step 3: Manual test** — at `localhost:8080`, open a tour as a guest (not logged in), rate a listing. In Emulator UI → Database, confirm a node under `mrt_ratings/<tourId>/<listingId>/`. Expected: it appears (this is the bug being fixed — guest ratings now reach Firebase).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: guest ratings persist to shared mrt_ratings path"
```

### Task B.4: Favorites persist to `mrt_favorites` for everyone

**Files:**
- Modify: `index.html` `toggleFavorite` (`index.html:5953-5962`)

**Interfaces:**
- Consumes: `_fb`, `mrtUserKey`. Writes `mrt_favorites/<tour.id>/<listingId>/<userKey>`.

- [ ] **Step 1: Replace `toggleFavorite`** (`index.html:5953-5962`):

```javascript
  const toggleFavorite = listingId => {
    const cur = !!(tour.favorites || {})[listingId];
    const next = !cur;
    if (_fb) {
      try {
        const ref = _fb.ref("mrt_favorites/" + tour.id + "/" + listingId + "/" + mrtUserKey());
        (next ? ref.set(true) : ref.remove()).catch(() => {});
      } catch (e) {}
    }
    onUpdateTour({ ...tour, favorites: { ...(tour.favorites || {}), [listingId]: next } });
  };
```

- [ ] **Step 2: Parse-check.** Expected `parse OK`.

- [ ] **Step 3: Manual test** — guest favorites a listing → Emulator UI shows `mrt_favorites/<tourId>/<listingId>/<userKey>: true`. Un-favorite → node removed.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: guest favorites persist to shared mrt_favorites path"
```

### Task B.5: Merge-on-read — fold shared paths into `tours`; stop writing granular fields to `mrt_tours`

**Files:**
- Modify: `index.html` App Firebase sync — the `paths` map + `loadAll` (`index.html:13641-13689`)
- Modify: `index.html` admin `mrt_tours` write effect (`index.html:13708-13729`)

**Interfaces:**
- Consumes: `mrt_ratings`, `mrt_favorites`, `setTours`. Produces: every tour in state carries `ratingSubmissions[listingId]` (array) + `favorites[listingId]` (bool) derived from the shared paths, so RankingPage/SummaryDashboard/favCount work for all users.

- [ ] **Step 1: Add a merge helper** just above the `function App()` line (`index.html:13445`):

```javascript
/* Merge shared mrt_ratings + mrt_favorites into the tours array (so all readers see shared data) */
function mergeSharedIntoTours(tours, ratings, favorites) {
  if (!Array.isArray(tours)) return tours;
  return tours.map(t => {
    if (!t || !t.id) return t;
    const r = (ratings && ratings[t.id]) || null;
    const f = (favorites && favorites[t.id]) || null;
    if (!r && !f) return t;
    const rs = { ...(t.ratingSubmissions || {}) };
    if (r) for (const lid of Object.keys(r)) rs[lid] = Object.values(r[lid] || {});
    const fav = { ...(t.favorites || {}) };
    if (f) for (const lid of Object.keys(f)) fav[lid] = Object.values(f[lid] || {}).some(Boolean);
    return { ...t, ratingSubmissions: rs, favorites: fav };
  });
}
```

- [ ] **Step 2: Add two state holders** in `App`, next to the existing `tours` state (`index.html:13526`):

```javascript
  const [sharedRatings, setSharedRatings] = useState({});
  const [sharedFavorites, setSharedFavorites] = useState({});
```

- [ ] **Step 3: Extend the sync `paths` map** (`index.html:13641-13646`) — add two entries so the existing loadAll/listener/poll machinery handles them:

```javascript
      "mrt_ratings": val => setSharedRatings(val || {}),
      "mrt_favorites": val => setSharedFavorites(val || {}),
```
(Insert these inside the `const paths = { … }` object alongside `mrt_tours` etc.)

- [ ] **Step 4: Derive merged tours for rendering.** Replace each pass of `tours={tours}` into page components with a memoized merge. Add above the `if (authLoading)` early-return (`index.html:13743`):

```javascript
  const mergedTours = React.useMemo(
    () => mergeSharedIntoTours(tours, sharedRatings, sharedFavorites),
    [tours, sharedRatings, sharedFavorites]
  );
```
Then change the `tours: tours` prop on `ToursDashboard` (`index.html:13849`), `NotInterestedPage` (`index.html:13872`), `RequestListingPage` ×2 (`index.html:13892, 13899`), `SponsorSignupPage` (`index.html:13907`), and `ListingRequestsAdmin` (`index.html:13928`) to `tours: mergedTours`. Leave `setTours` as-is (still mutates the base `tours`).

- [ ] **Step 5: Stop persisting granular fields into `mrt_tours`.** In the admin tours-write effect (`index.html:13708-13710`), change the write to strip the now-shared fields:

```javascript
    if (!fbLoaded || tours.length === 0 || !isAnyAdmin) return;
    const cleanTours = tours.map(t => { const { ratingSubmissions, favorites, ratings, ...rest } = (t || {}); return rest; });
    fbWrite("mrt_tours", cleanTours);
```
(Leave the `mrt_tour_previews` block below it unchanged.)

- [ ] **Step 6: Parse-check.** Expected `parse OK`.

- [ ] **Step 7: Two-browser test** — Browser A (guest, incognito) rates listing `l-0` on `tour-demo-1`. Browser B (admin tab) within ~1s (admin real-time listener) or 60s (guest poll) shows the rating count increment on the Rankings/Summary view. Confirm `favCount`/`ratedCount` badges reflect the shared data.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat: merge shared ratings/favorites into tours; keep mrt_tours clean"
```

### Task B.6: Public sponsor signups persist to `mrt_sponsor_signups`

**Files:**
- Modify: `index.html` App `SponsorSignupPage` onSubmit handler (`index.html:13906-13922`)

**Interfaces:**
- Consumes: `_fb`, `uid`. Writes `mrt_sponsor_signups/<tourId>/<signupId>` instead of pushing into `tour.sponsors`.

- [ ] **Step 1: Replace the `onSubmit` body** (`index.html:13912-13922`) so public signups land in the pending path, not the live tour:

```javascript
    onSubmit: sp => {
      const tourId = sp.tourId;
      const signupId = uid("spreq");
      const record = { ...sp, tourId: undefined, id: signupId, paid: false, createdAt: new Date().toISOString() };
      if (_fb) { try { _fb.ref("mrt_sponsor_signups/" + tourId + "/" + signupId).set(record).catch(() => {}); } catch (e) {} }
      setPage("dashboard");
    }
```

- [ ] **Step 2: Parse-check.** Expected `parse OK`.

- [ ] **Step 3: Manual test** — as a guest, use the Sponsor signup form for `tour-demo-1`. Emulator UI shows a node under `mrt_sponsor_signups/tour-demo-1/`. Confirm the tour's public sponsor strip does **not** show it.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: public sponsor signups persist to pending mrt_sponsor_signups"
```

### Task B.7: Admin sees pending signups + promotes on paid

**Files:**
- Modify: `index.html` `TourSponsorsModal` (`index.html:2608`+): load pending signups; add a "Pending signups" section; "Approve & mark paid" promotes into `tour.sponsors`.

**Interfaces:**
- Consumes: `_fb`, `tour.id`, existing `updateAndSave(newList)` (`index.html:2730`). Produces: promoted sponsor object with `paid:true` appended to `tour.sponsors`; pending node removed.

- [ ] **Step 1: Load pending signups** — inside `TourSponsorsModal`, after the existing `useState` declarations (~`index.html:2620`), add:

```javascript
  const [pendingSignups, setPendingSignups] = useState([]);
  useEffect(() => {
    if (!_fb || !tour.id) return;
    const ref = _fb.ref("mrt_sponsor_signups/" + tour.id);
    const cb = ref.on("value", snap => {
      const v = snap.val() || {};
      setPendingSignups(Object.keys(v).map(k => ({ ...v[k], id: v[k].id || k })));
    });
    return () => ref.off("value", cb);
  }, [tour.id]);
  const approveSignup = (su) => {
    const promoted = { ...su, paid: true, tourLead: false };
    updateAndSave([...(sponsors || []), promoted]);
    if (_fb) { try { _fb.ref("mrt_sponsor_signups/" + tour.id + "/" + su.id).remove().catch(() => {}); } catch (e) {} }
  };
```

- [ ] **Step 2: Render a pending section** — at the top of the modal's sponsor list (just before `sponsors.map(...)` at `index.html:3318`), insert:

```javascript
  pendingSignups.length > 0 && /*#__PURE__*/React.createElement("div", { style: { marginBottom: 14 } },
    /*#__PURE__*/React.createElement("div", { style: { fontSize: 12, fontWeight: 700, color: B.gray, marginBottom: 8 } }, "⏳ Pending signups"),
    pendingSignups.map(su => /*#__PURE__*/React.createElement("div", {
      key: su.id, style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: B.lightGray, borderRadius: 10, padding: "10px 12px", marginBottom: 6 }
    },
      /*#__PURE__*/React.createElement("div", null,
        /*#__PURE__*/React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } }, su.name),
        /*#__PURE__*/React.createElement("div", { style: { fontSize: 11, color: B.gray } }, su.email + " · " + (su.paymentPlan || "—"))),
      /*#__PURE__*/React.createElement("button", {
        onClick: () => approveSignup(su),
        style: { background: B.green, color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }
      }, "Approve & mark paid"))),
  ),
```

- [ ] **Step 3: Parse-check.** Expected `parse OK`.

- [ ] **Step 4: Manual test** — admin opens the Sponsors manager for `tour-demo-1`: the guest signup from B.6 shows under "Pending signups". Click "Approve & mark paid" → it moves into the sponsor list with `paid:true`, and the pending node disappears in Emulator UI.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: admin reviews + promotes pending sponsor signups on paid"
```

### Task B.8: Public tour page shows only paid sponsors

**Files:**
- Modify: `index.html` two public sponsor render filters (`index.html:7919, 7925, 8117, 8127`)

- [ ] **Step 1: Gate the lead-sponsor block** — change the guard at `index.html:7919` from `(tour.sponsors || []).length > 0` to `(tour.sponsors || []).filter(sp => sp.paid).length > 0`, and the `.filter(sp => sp.tourLead)` at `index.html:7925` to `.filter(sp => sp.paid && sp.tourLead)`.

- [ ] **Step 2: Gate the regular-sponsor block** — change the `.filter(sp => !sp.tourLead)` guard at `index.html:8117` and the map at `index.html:8127` to `.filter(sp => sp.paid && !sp.tourLead)`.

- [ ] **Step 3: Parse-check.** Expected `parse OK`.

- [ ] **Step 4: Manual test** — on `tour-demo-1` (seed has 1 paid + 1 unpaid sponsor): the public tour page shows only "Paid Lender Co", never "Unpaid Title Co". After approving the B.7 signup, that newly-paid sponsor appears too.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: only paid sponsors visible on public tour page"
```

### Task B.9: Full acceptance pass on the emulator

- [ ] **Step 1: Reset state** — `Ctrl-C` emulator, `npm run emu`, `node scripts/seed-emulator.mjs`, ensure `npm run serve` is up.

- [ ] **Step 2: Run the 5-point acceptance flow** (spec §Acceptance test) with Browser A = guest (incognito), Browser B = admin (`super@example.com`):
  1. A rates a listing → B's review count increments.
  2. A favorites a listing → count shared in both.
  3. A submits a sponsor signup → NOT on public page → B sees it pending → B "Approve & mark paid" → it appears on the public tour page.
  4. Reload both → all persist (from emulator DB).
  5. Network tab: confirm **no** POST to `sendemail-…run.app` fired.

- [ ] **Step 3: Lint gate** — copy root to www so the committed validator passes, then run it:

```bash
cp index.html www/index.html && node www/validate.js
```
Expected: "All checks passed". (This also keeps the two files in sync.)

- [ ] **Step 4: Commit the synced www file**

```bash
git add www/index.html
git commit -m "chore: sync www/index.html with root for validator"
```

### Task B.10: Deploy Phase B to production

- [ ] **Step 1: Publish rules** — paste `database.rules.json` into Console → RTDB → Rules → Publish (now includes the 3 new paths).

- [ ] **Step 2: (Optional) migrate existing inline data** — for the 4–5 prod tours with inline `ratingSubmissions`/`favorites`, run a one-off script that copies them into `mrt_ratings`/`mrt_favorites` (keyed by tour.id/listing.id). If skipped, historical counts restart from zero. **Decision per spec: migrate.**

- [ ] **Step 2 detail: migration script** — `scripts/migrate-inline-to-shared.mjs` reads prod `mrt_tours`, and for each tour with inline data PUTs to `mrt_ratings/<id>/<lid>/<n>` and `mrt_favorites/<id>/<lid>/<n>`. Run against prod ONCE with an admin ID token (or temporarily via console import). Verify counts match, then proceed.

- [ ] **Step 3: Deploy code** — `npx vercel --prod` (or push + promote). Ships the merged root `index.html` (note: the `_MRT_LOCAL` guard makes all emulator/email-guard code inert in prod).

- [ ] **Step 4: Prod smoke test** — create a throwaway tour, rate a listing as a guest in incognito, confirm the count shows for an admin; submit a sponsor signup, approve it, confirm it appears. Delete the throwaway tour.

- [ ] **Step 5: Final commit / tag**

```bash
git commit --allow-empty -m "release: shared Firebase backend live"
```

---

## Self-Review notes

- **Spec coverage:** shared ratings (B.3/B.5), shared favorites (B.4/B.5), paid-only sponsors (B.6/B.7/B.8), safe localhost (Phase 0), security-first sequencing (Phase A before B), additive rules in `database.rules.json` (B.1), migration decision = migrate (B.10). Covered.
- **Type consistency:** `mergeSharedIntoTours(tours, ratings, favorites)` defined once (B.5 Step 1) and called once (B.5 Step 4); `mrtUserKey()` defined B.2, used B.4; `approveSignup`/`pendingSignups` defined and used within B.7.
- **Known caveat carried from spec:** anon favorite keys aren't ownership-verified (accepted v1); `mrt_ratings` public read exposes voluntary rater names (low sensitivity).
- **Watch:** the `www/validate.js` brace/paren counter is heuristic — if it flags a false positive after edits, verify with the `new Function(...)` parse-check, which is authoritative.
