// MarketReady Tours — Tour Share Worker v7
// Proxies the image directly — no URL-in-URL encoding issues

const FIREBASE_URL = "https://marketready-tours-default-rtdb.firebaseio.com";
const SITE_URL     = "https://www.marketreadytours.com";
const FALLBACK_IMG = "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1200&h=630&fit=crop";

export default {
  async fetch(request) {
    const url   = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    // Image proxy: /img/[tourId] — fetches the photo for that tour and streams it
    if (parts[0] === "img" && parts[1]) {
      const tourKey = parts[1];
      try {
        const previewRes  = await fetch(`${FIREBASE_URL}/mrt_tour_previews/${tourKey}.json`);
        const preview     = await previewRes.json();
        const photoUrl    = preview?.photo || FALLBACK_IMG;
        const imgRes      = await fetch(photoUrl);
        const blob        = await imgRes.arrayBuffer();
        return new Response(blob, {
          headers: {
            "Content-Type": imgRes.headers.get("Content-Type") || "image/jpeg",
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } catch(e) {
        return Response.redirect(FALLBACK_IMG, 302);
      }
    }

    const tourId = parts[1];
    if (!tourId) return Response.redirect(SITE_URL, 302);

    const tourAppUrl = `${SITE_URL}/#/tour/${tourId}`;
    const tourKey    = tourId.replace(/[.#$[\]]/g, "_");

    try {
      const res     = await fetch(`${FIREBASE_URL}/mrt_tour_previews/${tourKey}.json`);
      const preview = await res.json();

      const title   = preview?.name ? `${preview.emoji || "🏡"} ${preview.name}` : "MarketReady Tours";
      const count   = preview?.listingCount || 0;
      const date    = preview?.date || "";
      const desc    = preview?.name
        ? `${count} home${count !== 1 ? "s" : ""}${date ? " · " + date : ""} · Tour, rate and get expert feedback in real time.`
        : "Tour. Rate. Decide. Browse curated home tours and submit real-time feedback.";

      // Use proxied image URL so Facebook can always load it
      const imageProxy = `https://marketreadytours.com/img/${tourKey}`;

      const esc = s => String(s)
        .replace(/&/g,"&amp;").replace(/"/g,"&quot;")
        .replace(/</g,"&lt;").replace(/>/g,"&gt;");

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(title)}</title>
  <meta property="og:type"         content="website"/>
  <meta property="og:title"        content="${esc(title)}"/>
  <meta property="og:description"  content="${esc(desc)}"/>
  <meta property="og:image"        content="${imageProxy}"/>
  <meta property="og:image:width"  content="1200"/>
  <meta property="og:image:height" content="630"/>
  <meta property="og:site_name"    content="MarketReady Tours"/>
  <meta name="twitter:card"        content="summary_large_image"/>
  <meta name="twitter:title"       content="${esc(title)}"/>
  <meta name="twitter:description" content="${esc(desc)}"/>
  <meta name="twitter:image"       content="${imageProxy}"/>
</head>
<body style="margin:0;font-family:-apple-system,sans-serif;background:#F0EDE8;min-height:100vh;display:flex;align-items:center;justify-content:center">
  <div style="max-width:480px;width:100%;margin:24px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.12)">
    <img src="${imageProxy}" style="width:100%;height:220px;object-fit:cover"/>
    <div style="background:#0D0D0D;padding:14px 20px">
      <div style="font-family:Georgia,serif;font-size:20px;font-weight:900;color:#fff">Market<span style="color:#C9A55A">Ready</span> <span style="font-weight:300;font-size:16px;letter-spacing:2px">Tours</span></div>
    </div>
    <div style="padding:24px 20px">
      <h1 style="margin:0 0 8px;font-size:22px;color:#0D0D0D">${esc(title)}</h1>
      <p style="margin:0 0 20px;color:#6B7280;font-size:14px">${esc(desc)}</p>
      <a href="${esc(tourAppUrl)}" style="display:block;background:#C9A55A;color:#fff;text-decoration:none;padding:14px;border-radius:10px;font-weight:700;font-size:16px;text-align:center">🏡 View This Tour</a>
    </div>
  </div>
</body>
</html>`;

      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "no-store" }
      });

    } catch (e) {
      return Response.redirect(tourAppUrl, 302);
    }
  }
};