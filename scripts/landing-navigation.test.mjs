import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../landing.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

async function loadTourFeed(data, fail = false) {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, {classList: {add() {}}, href: "app/#/"});
    return nodes.get(id);
  };
  const script = scripts.at(-1);
  const feed = script.slice(script.indexOf("  // Live tours"), script.indexOf("  // ── Hero photo wall"));
  vm.runInNewContext(feed, {
    APP: "app/", window: {},
    document: {getElementById: get, querySelector: get},
    fetch: async () => {
      if (fail) throw new Error("offline");
      return {ok: true, json: async () => data};
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  return get;
}

test("next tour navigates directly to the earliest upcoming non-archived tour", async () => {
  const get = await loadTourFeed({
    past: {id: "past", name: "Past", date: "2000-01-01"},
    later: {id: "later", name: "Later", date: "2099-10-30"},
    archived: {id: "archived", name: "Hidden", date: "2099-01-01", archived: true},
    next: {id: "tour/a b", name: "Next", date: "2099-10-29"},
  });
  assert.equal(get("next").href, "app/#/tour/tour%2Fa%20b");
  assert.match(get("next-copy").innerHTML, /Next.*Open tour/);
});

test("empty or unavailable feed still gives visitors a working app link", async () => {
  for (const fail of [false, true]) {
    const get = await loadTourFeed({}, fail);
    assert.equal(get("next").href, "app/#/");
    assert.equal(get("tours").hidden, true);
    assert.match(get("next-copy").textContent, /Open the app/);
  }
});

test("app buttons work before JavaScript and landing cannot capture scrolling", () => {
  const appButtons = [...html.matchAll(/<a\b[^>]*href="__MRT_APP_BASE__#\/"[^>]*>Go to app/g)];
  assert.equal(appButtons.length, 2, "header and hero must both offer app entry");
  assert.match(html, /id="next" href="__MRT_APP_BASE__#\/"/);
  assert.doesNotMatch(html, /scroll-snap|scrollIntoView|scroll-behavior:\s*smooth/);
});

test("legacy emailed hash routes preserve their query when forwarded to the app", () => {
  const redirects = [];
  vm.runInNewContext(scripts[0].replaceAll("__MRT_APP_BASE__", "app/"), {
    window: {}, location: {hash: "#/tour/real-tour", search: "?spt=token", replace: url => redirects.push(url)},
    matchMedia: () => ({matches: true}),
  });
  assert.deepEqual(redirects, ["app/?spt=token#/tour/real-tour"]);
});
