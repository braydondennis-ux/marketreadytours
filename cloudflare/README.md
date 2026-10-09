# Tour share worker

`tour-share.mjs` is the source for Cloudflare worker **marketreadytourshare**. It is deployed
separately from GitHub Pages. The existing routes serve `/t/:tourId` and `/img/:tourId` on
marketreadytours.com. Do not replace this with a site-wide redirect or remove the image proxy.

Account: `6ae81f370bfe172b8528ac7541745b74`.
Dashboard: https://dash.cloudflare.com/6ae81f370bfe172b8528ac7541745b74/workers/services/view/marketreadytourshare/production

The worker reads only `mrt_tours_public`, with no secrets/bindings or writes. Private ratings,
tour access codes and private agent contact data are not rendered. Image URLs retain the
existing proxy contract. HTML is uncached; images cache for five minutes and include the
tour version in page metadata to avoid stale photos after edits.

Run `node --test scripts/tour-share.test.mjs` and `npm run check`. In Cloudflare Edit code,
replace **worker.js** with the complete `tour-share.mjs` source. Preview a real `/t/:id` path,
then Deploy. Confirm the active version and compare live HTML with `renderShare(id, publicTour)`;
also inspect the image endpoint, actual desktop/mobile page and View this tour link.
Never submit production test evaluations or send test emails to listing agents.

October 9 deployment: **3875a9ad**, replacing **33b67d2a**. The previous exact source is
`tour-share-v7-backup.mjs`. Roll back through Cloudflare deployment history to 33b67d2a if needed,
or deploy that backup as worker.js. The old version uses obsolete `mrt_tour_previews` and generic
fallback branding. No route, account, permission or Firebase setting changed in this deployment.
