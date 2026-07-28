// Rich demo seeder for the DEV project (marketready-tours-dev) — the isolated preview backend.
// This NEVER touches production (marketready-tours). The DB URL below is the dev one, hardcoded.
//
// Seeds a full-functionality demo: 2 upcoming tours + 1 past (archived, fully rated) tour,
// multi-rater ratings, favorites, pending tour requests, pending listing requests, and a
// pending sponsor signup — so Dashboard, Tour Detail, Rating, Rankings, Summary, Team,
// Requests and the sponsor approve flow all have real content.
//
// Run: node scripts/seed-demo.mjs
const API_KEY = "AIzaSyB0Kn647lbPnO7NoH69A53KEw2BXaZ4muM";
const DB = "https://marketready-tours-dev-default-rtdb.firebaseio.com";
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

const PHOTO = [
  "https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=800&auto=format&fit=crop"
];

let _p = 0;
const mkListing = (i, o) => ({
  id: o.id, order: i + 1, address: o.address, city: o.city || "Scottsdale",
  beds: o.beds, baths: o.baths, sqft: o.sqft, dom: o.dom, price: o.price,
  agent: o.agent, agentEmail: o.agentEmail, agentPhone: o.agentPhone || "(480) 555-0142",
  photos: [PHOTO[_p++ % PHOTO.length]]
});

const tours = [
  {
    id: "tour-demo-1", name: "Scottsdale Luxury Tour", emoji: "🏡", color: "#1B2A4A", code: "4821",
    date: "2026-08-04", time: "10:00 AM", maxListings: 8, createdBy: SUPER.email,
    listings: [
      mkListing(0, { id: "l1-a", address: "7412 E Camelback Rd", city: "Scottsdale", beds: 4, baths: 3, sqft: 3200, dom: 8,  price: 1250000, agent: "Dana Whitfield", agentEmail: "dana@example.com" }),
      mkListing(1, { id: "l1-b", address: "6085 N Hayden Rd",   city: "Scottsdale", beds: 3, baths: 2, sqft: 2450, dom: 21, price: 895000,  agent: "Marcus Reed",    agentEmail: "marcus@example.com" }),
      mkListing(2, { id: "l1-c", address: "9930 E Doubletree Ranch Rd", city: "Scottsdale", beds: 5, baths: 4, sqft: 4100, dom: 3, price: 1875000, agent: "Priya Raman", agentEmail: "priya@example.com" }),
      mkListing(3, { id: "l1-d", address: "4220 N Scottsdale Rd", city: "Scottsdale", beds: 3, baths: 3, sqft: 2780, dom: 14, price: 1050000, agent: "Tom Alvarez", agentEmail: "tom@example.com" })
    ],
    sponsors: [
      { id: "sp-lead", name: "Summit Mortgage",  email: "lead@example.com",  phone: "(480) 555-0110", paid: true,  paymentPlan: "full", tourLead: true },
      { id: "sp-paid", name: "Desert Title Co",  email: "title@example.com", phone: "(480) 555-0121", paid: true,  paymentPlan: "half", tourLead: false },
      { id: "sp-unpd", name: "Canyon Home Warranty", email: "warranty@example.com", phone: "(480) 555-0133", paid: false, paymentPlan: "full", tourLead: false }
    ]
  },
  {
    id: "tour-demo-2", name: "Arcadia Morning Tour", emoji: "🌵", color: "#2D6A4F", code: "7390",
    date: "2026-08-11", time: "9:00 AM", maxListings: 6, createdBy: SUPER.email,
    listings: [
      mkListing(0, { id: "l2-a", address: "4501 E Camelback Rd", city: "Phoenix", beds: 4, baths: 3, sqft: 2950, dom: 11, price: 1150000, agent: "Dana Whitfield", agentEmail: "dana@example.com" }),
      mkListing(1, { id: "l2-b", address: "3820 N 56th St",      city: "Phoenix", beds: 3, baths: 2, sqft: 2100, dom: 34, price: 749000,  agent: "Marcus Reed",    agentEmail: "marcus@example.com" }),
      mkListing(2, { id: "l2-c", address: "5104 E Exeter Blvd",  city: "Phoenix", beds: 5, baths: 4, sqft: 3600, dom: 6,  price: 1495000, agent: "Priya Raman",    agentEmail: "priya@example.com" })
    ],
    sponsors: [
      { id: "sp2-lead", name: "Valley First Lending", email: "valley@example.com", phone: "(602) 555-0155", paid: true, paymentPlan: "full", tourLead: true }
    ]
  },
  {
    id: "tour-demo-3", name: "North Phoenix Tour", emoji: "🌄", color: "#8A5A2B", code: "2255",
    date: "2026-07-21", time: "1:00 PM", maxListings: 6, archived: true, createdBy: SUPER.email,
    listings: [
      mkListing(0, { id: "l3-a", address: "2740 W Union Hills Dr", city: "Phoenix", beds: 4, baths: 3, sqft: 2600, dom: 18, price: 685000, agent: "Tom Alvarez",  agentEmail: "tom@example.com" }),
      mkListing(1, { id: "l3-b", address: "1815 E Bell Rd",        city: "Phoenix", beds: 3, baths: 2, sqft: 1950, dom: 42, price: 525000, agent: "Dana Whitfield", agentEmail: "dana@example.com" }),
      mkListing(2, { id: "l3-c", address: "3302 W Deer Valley Rd", city: "Phoenix", beds: 5, baths: 3, sqft: 3150, dom: 9,  price: 810000, agent: "Marcus Reed",  agentEmail: "marcus@example.com" })
    ],
    sponsors: [
      { id: "sp3-lead", name: "Northgate Insurance", email: "northgate@example.com", phone: "(623) 555-0166", paid: true, paymentPlan: "full", tourLead: true }
    ]
  }
];

const aKey = SUPER.email.replace(/\./g, ",");
const sKey = SUB.email.replace(/\./g, ",");
await put("admins/" + aKey, { name: "MarketReady (demo super)", role: "super" });
await put("admins/" + sKey, { name: "Sub Admin (demo)", role: "sub" });
await put("mrt_tours", tours);
console.log("→ tours + admins written");

// ---- Multi-rater ratings on the PAST tour, so Rankings + Summary + seller report all populate.
const CATS = ["curbAppeal", "landscape", "cleanliness", "flooring", "paint", "showability", "price", "kitchen", "bedrooms", "windows"];
const mkRating = (base, raterName, opts = {}) => {
  const r = {};
  CATS.forEach((k, i) => { r[k] = Math.max(1, Math.min(5, base + ((i % 3) - 1))); });
  return {
    ...r,
    suggestions: opts.suggestions || "",
    sugPrice: opts.pricedRight ? "Priced Correctly" : (opts.sugPrice || ""),
    pricedRight: !!opts.pricedRight,
    raterName,
    photoCount: 0,
    submittedAt: opts.at || "2026-07-21T15:30:00.000Z"
  };
};

const ratings = {
  "l3-a": {
    "r-a1": mkRating(5, "Dana Whitfield", { pricedRight: true,  suggestions: "Best curb appeal of the day. Kitchen remodel is done right.", at: "2026-07-21T14:05:00.000Z" }),
    "r-a2": mkRating(4, "Marcus Reed",    { pricedRight: true,  suggestions: "Great flow. Would move fast at this price.", at: "2026-07-21T14:12:00.000Z" }),
    "r-a3": mkRating(5, "Priya Raman",    { pricedRight: true,  suggestions: "Backyard is the selling point — stage it.", at: "2026-07-21T14:20:00.000Z" }),
    "r-a4": mkRating(4, "Tom Alvarez",    { sugPrice: "$695,000", suggestions: "Could push list price slightly.", at: "2026-07-21T14:31:00.000Z" })
  },
  "l3-b": {
    "r-b1": mkRating(3, "Dana Whitfield", { sugPrice: "$495,000", suggestions: "Carpet and paint are dating it. 42 DOM tells the story.", at: "2026-07-21T15:02:00.000Z" }),
    "r-b2": mkRating(2, "Marcus Reed",    { sugPrice: "$479,000", suggestions: "Needs a price correction before it goes stale.", at: "2026-07-21T15:09:00.000Z" }),
    "r-b3": mkRating(3, "Priya Raman",    { sugPrice: "$500,000", suggestions: "Bones are good, presentation is not.", at: "2026-07-21T15:17:00.000Z" })
  },
  "l3-c": {
    "r-c1": mkRating(4, "Dana Whitfield", { pricedRight: true, suggestions: "Strong value per sqft for Deer Valley.", at: "2026-07-21T16:04:00.000Z" }),
    "r-c2": mkRating(5, "Tom Alvarez",    { pricedRight: true, suggestions: "Primary suite is a standout. Priced to move.", at: "2026-07-21T16:11:00.000Z" }),
    "r-c3": mkRating(4, "Marcus Reed",    { sugPrice: "$825,000", suggestions: "Windows need attention but otherwise sharp.", at: "2026-07-21T16:19:00.000Z" })
  }
};
// The hardened rules only grant .write at the individual $subId leaf — a bulk PUT on the
// tour or listing node is denied. Write one submission at a time.
const putRatings = async (tourId, byListing) => {
  for (const [listingId, subs] of Object.entries(byListing))
    for (const [subId, sub] of Object.entries(subs))
      await put(`mrt_ratings/${tourId}/${listingId}/${subId}`, sub);
};
await putRatings("tour-demo-3", ratings);

// A couple of early ratings on the first upcoming tour, so it isn't a blank slate either.
await putRatings("tour-demo-1", {
  "l1-a": {
    "r-p1": mkRating(5, "Priya Raman", { pricedRight: true, suggestions: "Camelback frontage is a real premium.", at: "2026-07-27T17:00:00.000Z" }),
    "r-p2": mkRating(4, "Tom Alvarez", { sugPrice: "$1,195,000", suggestions: "Slightly ambitious on price.", at: "2026-07-27T17:14:00.000Z" })
  }
});
console.log("→ ratings written (12 submissions across 4 listings)");

// ---- Favorites are deliberately NOT seeded.
// mergeSharedIntoTours() collapses a listing's favorites with
//   fav[listingId] = Object.values(favorites[tourId][listingId]).some(Boolean)
// so the heart renders filled if ANY user favorited it, while clicking only removes YOUR
// own key. Seeding a favorite under a fake user key therefore makes that listing appear
// liked and IMPOSSIBLE for the demo user to un-like. Leave hearts empty so they toggle
// cleanly during a demo.

// ---- Pending tour requests (admin Requests → Attendance)
await put("mrt_tour_requests", {
  "tr-demo-1": { id: "tr-demo-1", status: "pending", submittedAt: "2026-07-26T18:20:00.000Z", name: "Alicia Moore",  email: "alicia@example.com",  phone: "(480) 555-0177", brokerage: "Keller Williams Arizona", address: "7412 E Camelback Rd", city: "Scottsdale", preferredDate: "2026-08-04", notes: "Bringing two buyer clients." },
  "tr-demo-2": { id: "tr-demo-2", status: "pending", submittedAt: "2026-07-27T09:41:00.000Z", name: "Grant Sullivan", email: "grant@example.com", phone: "(602) 555-0188", brokerage: "West USA Realty", address: "4501 E Camelback Rd", city: "Phoenix", preferredDate: "2026-08-11", notes: "" },
  "tr-demo-3": { id: "tr-demo-3", status: "approved", submittedAt: "2026-07-24T12:05:00.000Z", name: "Renee Baptiste", email: "renee@example.com", phone: "(480) 555-0199", brokerage: "Realty ONE Group", address: "6085 N Hayden Rd", city: "Scottsdale", preferredDate: "2026-08-04", notes: "Confirmed attending." }
});

// ---- Pending listing requests (admin Requests → Listings)
await put("mrt_listing_requests", {
  "req-demo-1": { id: "req-demo-1", status: "pending", submittedAt: "2026-07-26T20:10:00.000Z", agentName: "Alicia Moore", agentEmail: "alicia@example.com", agentPhone: "(480) 555-0177", tourId: "tour-demo-1", tourName: "🏡 Scottsdale Luxury Tour", address: "8801 E Cactus Rd", city: "Scottsdale", beds: 4, baths: 3, sqft: 2890, dom: 5, price: 985000, agent: "Alicia Moore", notes: "Just listed, would love peer feedback.", photos: [PHOTO[2]], order: 0, type: "listing-request", createdBy: SUPER.email },
  "req-demo-2": { id: "req-demo-2", status: "pending", submittedAt: "2026-07-27T14:55:00.000Z", agentName: "Grant Sullivan", agentEmail: "grant@example.com", agentPhone: "(602) 555-0188", tourId: "tour-demo-2", tourName: "🌵 Arcadia Morning Tour", address: "4712 N 44th St", city: "Phoenix", beds: 3, baths: 2, sqft: 2240, dom: 27, price: 799000, agent: "Grant Sullivan", notes: "Price reduction coming, want agent input first.", photos: [PHOTO[4]], order: 0, type: "listing-request", createdBy: SUPER.email }
});

// ---- Pending sponsor signup (approve → mark paid → shows publicly)
await put("mrt_sponsor_signups/tour-demo-1/su-demo",
  { id: "su-demo", name: "Pinnacle Home Inspections", email: "pinnacle@example.com", phone: "(480) 555-0144", paymentPlan: "full", paid: false, createdAt: "2026-07-25T00:00:00Z" });

console.log("\n✅ DEV demo seeded (marketready-tours-dev — production untouched)");
console.log("   3 tours (2 upcoming, 1 past/archived + fully rated)");
console.log("   12 rating submissions · 3 favorites · 3 tour requests · 2 listing requests · 1 pending sponsor");
console.log("   Super-admin login:", SUPER.email, "/", SUPER.password);
console.log("   Tour access codes: 4821 (Scottsdale) · 7390 (Arcadia) · 2255 (North Phoenix)");
