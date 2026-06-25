// Seeds the marketready-tours-dev project (the isolated preview backend).
// PREREQUISITE: database.rules.json must already be published to the dev project's
// Realtime Database rules. This script creates a super-admin Auth user, then writes
// demo data authenticated as that user (the hardened rules allow it).
// Run: node scripts/seed-dev.mjs
const API_KEY = "AIzaSyB0Kn647lbPnO7NoH69A53KEw2BXaZ4muM";
const DB = "https://marketready-tours-dev-default-rtdb.firebaseio.com";
// The hardened admins/subadmins rules are locked to this exact email, so the demo
// super-admin uses it (separate project — the password below is dev-only).
const SUPER = { email: "marketreadytours@gmail.com", password: "demo1234" };
const SUB = { email: "sub@example.com", password: "demo1234" };

const idt = (method, body) => fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${API_KEY}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
}).then(r => r.json());

async function ensureUser(u) {
  let res = await idt("signUp", { ...u, returnSecureToken: true });
  if (res.error && res.error.message === "EMAIL_EXISTS") res = await idt("signInWithPassword", { ...u, returnSecureToken: true });
  if (!res.idToken) throw new Error("auth failed for " + u.email + ": " + JSON.stringify(res.error || res));
  return res.idToken;
}

const TOKEN = await ensureUser(SUPER);
await ensureUser(SUB);
console.log("auth users ready:", SUPER.email, "+", SUB.email);

const put = (path, data) => fetch(`${DB}/${path}.json?auth=${TOKEN}`, {
  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
}).then(async r => { if (!r.ok) throw new Error(path + ": " + await r.text()); });

const mkListing = (i, addr) => ({ id: "l-" + i, order: i, address: addr, city: "Phoenix",
  beds: 3, baths: 2, sqft: 1800, dom: 12, price: 450000, agent: "Test Agent",
  agentEmail: "agent@example.com", photos: ["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=400"] });

const tours = [
  { id: "tour-demo-1", name: "Demo North Tour", emoji: "🏡", color: "#0D0D0D", code: "1234",
    date: "2026-07-15", time: "10:00 AM", maxListings: 8,
    listings: [mkListing(0, "100 Demo St"), mkListing(1, "200 Demo Ave")],
    sponsors: [
      { id: "sp-paid", name: "Paid Lender Co", email: "paid@example.com", paid: true,  paymentPlan: "full", tourLead: true },
      { id: "sp-unpd", name: "Unpaid Title Co", email: "unpaid@example.com", paid: false, paymentPlan: "half", tourLead: false }
    ] },
  { id: "tour-demo-2", name: "Demo South Tour", emoji: "🌵", color: "#2D6A4F", code: "5678",
    date: "2026-07-20", time: "1:00 PM", maxListings: 8,
    listings: [mkListing(0, "300 South Rd")], sponsors: [] }
];

const aKey = SUPER.email.replace(/\./g, ",");
const sKey = SUB.email.replace(/\./g, ",");
await put("admins/" + aKey, { name: "MarketReady (demo super)", role: "super" });
await put("admins/" + sKey, { name: "Sub Admin (demo)", role: "sub" });
await put("mrt_tours", tours);
// A pending sponsor signup so the approve→paid→public flow is demoable out of the box.
await put("mrt_sponsor_signups/tour-demo-1/su-demo", {
  id: "su-demo", name: "Pending Mortgage Co", email: "pend@example.com",
  paymentPlan: "full", paid: false, createdAt: "2026-06-25T00:00:00Z"
});

console.log("✅ Seeded dev project:", tours.length, "tours + 2 admins + 1 pending sponsor signup.");
console.log("   Demo super-admin login:", SUPER.email, "/", SUPER.password);
