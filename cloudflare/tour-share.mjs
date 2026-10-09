// MarketReady Tours share worker. Deploy as marketreadytourshare (worker.js).
const DB = 'https://marketready-tours-default-rtdb.firebaseio.com';
const SITE = 'https://marketreadytours.com';
const FALLBACK = 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1200&h=630&fit=crop';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const collection = value => Object.values(value || {}).filter(item => item && typeof item === 'object');
const safePhoto = value => {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
};

async function readTour(id) {
  const response = await fetch(`${DB}/mrt_tours_public/${id}.json`, {signal: AbortSignal.timeout(6000)});
  if (!response.ok) throw new Error('Tour unavailable');
  return response.json();
}

export function renderShare(id, tour) {
  const homes = collection(tour?.listings).sort((a,b) => (a.order || 0) - (b.order || 0));
  const first = homes[0];
  const title = tour?.name || 'Your next home tour starts here';
  let date = '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(tour?.date || '')) {
    const parsed = new Date(`${tour.date}T12:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) date = new Intl.DateTimeFormat('en-US', {weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(parsed);
  }
  const count = homes.length;
  const description = tour ? `${count} ${count === 1 ? 'home' : 'homes'}${date ? ' · ' + date : ''}${tour.time ? ' · ' + tour.time : ''}. Explore the route and share your feedback.` : 'Explore the homes, follow the route, and share your perspective with MarketReady Tours.';
  const appUrl = `${SITE}/app/#/tour/${id}`;
  const imageUrl = `${SITE}/img/${id}?v=${encodeURIComponent(tour?.version || '1')}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | MarketReady Tours</title><meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}/t/${id}"><meta name="theme-color" content="#101a36">
<meta property="og:type" content="website"><meta property="og:site_name" content="MarketReady Tours">
<meta property="og:url" content="${SITE}/t/${id}"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}"><meta property="og:image" content="${esc(imageUrl)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${esc(imageUrl)}">
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f4f0;color:#101a36;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}a{color:inherit}header{max-width:1160px;margin:auto;padding:30px 36px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{text-decoration:none;display:flex;gap:12px;align-items:center;font-size:18px;font-weight:650;letter-spacing:-.5px}.mark{width:36px;height:36px;background:#101a36;color:white;border-radius:50%;display:grid;place-items:center;font-family:Georgia,serif;font-size:21px}.brand small{display:block;text-transform:uppercase;font-size:9px;letter-spacing:3px;margin-top:3px;font-weight:500}.browse{text-decoration:none;font-size:13px;color:#586073}.browse:hover{text-decoration:underline}main{max-width:1088px;margin:28px auto 60px;display:grid;grid-template-columns:1.06fr 1fr;background:white;border:1px solid #e5e5df;border-radius:24px;overflow:hidden;box-shadow:0 16px 55px #101a3609}.visual{position:relative;min-height:540px;background:#dce3de}.visual img{width:100%;height:100%;position:absolute;object-fit:cover}.visual:after{content:"";position:absolute;inset:40% 0 0;background:linear-gradient(transparent,#0c1826b8)}.caption{position:absolute;bottom:30px;left:30px;right:30px;color:white;z-index:1}.caption span{display:block;font-size:10px;font-weight:650;letter-spacing:2px;text-transform:uppercase;margin-bottom:9px}.caption strong{font-size:20px;line-height:1.4;font-weight:550}.content{padding:48px 42px;display:flex;flex-direction:column;justify-content:center}.eyebrow{font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:650;color:#52695c;margin:0 0 20px}h1{font-size:clamp(30px,3.6vw,44px);line-height:1.12;letter-spacing:-1.7px;font-weight:600;margin:0 0 20px;overflow-wrap:anywhere}.intro{font-size:15px;line-height:1.7;color:#626b78;margin:0 0 25px}.details{border-top:1px solid #e9eae6;border-bottom:1px solid #e9eae6;padding:18px 0;margin:0 0 28px;display:flex;gap:26px;flex-wrap:wrap}.details div{display:grid;gap:7px}.details dt{font-size:10px;color:#626b78;text-transform:uppercase;letter-spacing:1.4px}.details dd{margin:0;font-size:14px;font-weight:550;line-height:1.5}.cta{background:#101a36;color:#fff;display:flex;justify-content:space-between;align-items:center;padding:18px 22px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;transition:background .15s}.cta:hover{background:#254576}.cta:focus-visible,.brand:focus-visible,.browse:focus-visible{outline:3px solid #567eaa;outline-offset:5px}.hint{font-size:11px;text-align:center;color:#737b86;line-height:1.6;margin:13px 0 0}footer{text-align:center;color:#737b86;font-size:11px;padding:0 24px 30px;letter-spacing:.3px}
@media(max-width:760px){header{padding:22px 22px}.brand{font-size:16px}.browse{font-size:12px}main{margin:8px 18px 28px;grid-template-columns:1fr;border-radius:18px}.visual{min-height:250px}.caption{left:24px;bottom:22px}.caption strong{font-size:18px}.content{padding:29px 25px 30px}h1{font-size:34px;letter-spacing:-1.1px}.eyebrow{margin-bottom:14px}.intro{margin-bottom:20px}.details{gap:20px;margin-bottom:24px}footer{padding-bottom:24px}}
</style></head><body>
<header><a class="brand" href="${SITE}" aria-label="MarketReady Tours home"><span class="mark" aria-hidden="true">M</span><span>MarketReady<small>Tours</small></span></a><a class="browse" href="${SITE}/app/">Browse tours ↗</a></header>
<main><section class="visual" aria-label="Tour property"><img src="${esc(imageUrl)}" alt="${esc(first?.address ? 'Tour home at ' + first.address : 'A home featured by MarketReady Tours')}">${first?.address ? `<div class="caption"><span>First stop</span><strong>${esc(first.address)}</strong></div>` : ''}</section>
<section class="content"><p class="eyebrow">You're invited to explore</p><h1>${esc(title)}</h1><p class="intro">Walk the homes. See the possibilities. Share the feedback that helps every listing move forward.</p>
${tour ? `<dl class="details">${date ? `<div><dt>When</dt><dd>${esc(date)}${tour.time ? '<br>' + esc(tour.time) : ''}</dd></div>` : ''}<div><dt>On the tour</dt><dd>${count} ${count === 1 ? 'home' : 'homes'}</dd></div></dl>` : ''}
<a class="cta" href="${appUrl}">View this tour <span aria-hidden="true">→</span></a><p class="hint">View the homes and route. Use your tour code to leave feedback.</p></section></main>
<footer>Better feedback. More informed decisions.</footer></body></html>`;
}

export default {
  async fetch(request) {
    const {pathname} = new URL(request.url);
    const match = pathname.match(/^\/(t|img)\/([A-Za-z0-9_-]{1,160})\/?$/);
    if (!match) return Response.redirect(`${SITE}/app/`, 302);
    const [,kind,id] = match;
    let tour = null;
    try { tour = await readTour(id); } catch { /* Keep the app link usable during a transient lookup failure. */ }
    if (kind === 'img') {
      const homes = collection(tour?.listings).sort((a,b) => (a.order || 0) - (b.order || 0));
      const photo = homes.flatMap(home => Object.values(home.photos || {})).map(safePhoto).find(Boolean) || FALLBACK;
      try {
        const response = await fetch(photo, {signal: AbortSignal.timeout(8000)});
        const type = response.headers.get('Content-Type') || '';
        if (!response.ok || !/^image\/(jpeg|png|webp|gif|avif)(;|$)/i.test(type)) throw new Error('Image unavailable');
        return new Response(response.body, {headers:{'Content-Type':type,'Cache-Control':'public, max-age=300','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'}});
      } catch { return Response.redirect(FALLBACK, 302); }
    }
    return new Response(renderShare(id,tour), {headers:{'Content-Type':'text/html;charset=UTF-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}});
  }
};
