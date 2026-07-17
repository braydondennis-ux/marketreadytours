// Seeds the LOCAL emulator only. Run with the emulator running: node scripts/seed-emulator.mjs
// access_token=owner = the RTDB emulator's admin bypass, so the seed can write under the
// hardened rules (mrt_tours requires auth). Has no meaning against a real database.
const DB = "http://127.0.0.1:9000";
const PROJECT = "marketready-tours";
const put = (path, data) => fetch(`${DB}/${path}.json?ns=${PROJECT}-default-rtdb&access_token=owner`, {
  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
}).then(r => r.ok ? null : r.text().then(t => { throw new Error(path + ": " + t); }));

const mkListing = (i, addr) => ({ id: "l-"+i, order: i + 1, address: addr, city: "Phoenix",
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

// admins keyed exactly as the app computes them: email.replace(/\./g, ",") — '@' stays, dots → commas.
await put("mrt_tours", tours);
await put("admins", {
  "super@example,com": { name: "Super Admin", role: "super" },
  "sub@example,com":   { name: "Sub Admin",   role: "sub" }
});

// Create matching Auth users so login works immediately (Auth emulator REST; key is ignored locally).
const AUTH = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key";
const mkUser = (email, password) => fetch(AUTH, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, returnSecureToken: true })
}).then(async r => {
  if (r.ok) return console.log("  auth user created:", email);
  const t = await r.text();
  if (t.includes("EMAIL_EXISTS")) return console.log("  auth user exists:", email);
  throw new Error("auth " + email + ": " + t);
});
await mkUser("super@example.com", "test1234");
await mkUser("sub@example.com", "test1234");

console.log("Seeded emulator with", tours.length, "tours + 2 admins (super@example.com / sub@example.com, pw test1234).");
