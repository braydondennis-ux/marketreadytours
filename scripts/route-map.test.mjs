import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const source = html.slice(html.indexOf("function RouteMapView("), html.indexOf("function TourDetailPage("));

// Exercise the shipped component's effects and rendered states with deterministic Maps replies.
function harness(statuses, {defer = false, routeStatus = "OK"} = {}) {
  const states = [], refs = [], effects = [], timers = new Set(), callbacks = [];
  const calls = {bounds: [], markers: [], routes: [], directions: []};
  let stateIndex = 0, refIndex = 0;
  const maps = {
    Map: class {
      fitBounds(bounds) { calls.bounds.push([...bounds.points]); }
      setCenter(pos) { calls.center = pos; }
      setZoom(zoom) { calls.zoom = zoom; }
    },
    LatLngBounds: class { points = []; extend(pos) { this.points.push(pos); } },
    Geocoder: class {
      geocode(request, cb) {
        const index = callbacks.length;
        const reply = () => cb(statuses[index] === "OK" ? [{geometry: {location: {lat: 33 + index, lng: -112}}}] : null, statuses[index]);
        callbacks.push(reply);
        if (!defer) reply();
      }
    },
    Marker: class {
      constructor(options) { calls.markers.push(options); }
      addListener() {}
      setMap() {}
    },
    InfoWindow: class {},
    DirectionsService: class { route(request, cb) { calls.routes.push(request); cb({routes: []}, routeStatus); } },
    DirectionsRenderer: class { setDirections(result) { calls.directions.push(result); } setMap() {} },
    SymbolPath: {CIRCLE: "circle"}, TravelMode: {DRIVING: "driving"},
  };
  const React = {createElement(type, props, ...children) {
    if (props?.ref) props.ref.current = {};
    return {type, props, children};
  }};
  const Component = new Function("React", "useState", "useRef", "useEffect", "window", "B", "LI", "setTimeout", "clearTimeout",
    source + "\nreturn RouteMapView;")(
    React,
    initial => { const i = stateIndex++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; },
    initial => { const i = refIndex++; return refs[i] ||= {current: initial}; },
    effect => effects.push(effect),
    {google: {maps}, loadGoogleMaps: cb => cb(), onMapsError() {}},
    {}, () => null,
    cb => { timers.add(cb); return cb; }, cb => timers.delete(cb),
  );
  const tour = {listings: statuses.map((_, i) => ({id: String(i), order: i + 1, address: `${i + 1} Test Street`, city: "Phoenix, AZ", price: 1}))};
  const render = () => { stateIndex = refIndex = 0; effects.length = 0; return Component({tour}); };
  const initial = render();
  const cleanup = effects.map(effect => effect());
  return {calls, initial, render, callbacks,
    expire: () => [...timers].forEach(cb => cb()),
    cleanup: () => cleanup.forEach(fn => fn?.()),
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const text = tree => JSON.stringify(tree);

test("denied geocoding shows the fallback instead of fitting empty ocean bounds", async () => {
  const h = harness(["REQUEST_DENIED", "REQUEST_DENIED"]);
  assert.match(text(h.initial), /Loading map/);
  await flush();
  assert.deepEqual(h.calls.bounds, []);
  assert.equal(h.calls.markers.length, 0);
  assert.match(text(h.render()), /Map preview unavailable/);
  assert.match(text(h.render()), /Open Full Route in Google Maps/);
  h.cleanup();
});

test("one located property is centered at a usable street zoom", async () => {
  const h = harness(["OK"]);
  await flush();
  assert.deepEqual(h.calls.center, {lat: 33, lng: -112});
  assert.equal(h.calls.zoom, 15);
  assert.equal(h.calls.bounds.length, 0);
  assert.doesNotMatch(text(h.render()), /Loading map|Map preview unavailable/);
  h.cleanup();
});

test("all properties produce numbered pins and a route in tour order", async () => {
  const h = harness(["OK", "OK", "OK", "OK"]);
  await flush();
  assert.equal(h.calls.bounds[0].length, 4);
  assert.deepEqual(h.calls.markers.map(m => m.label.text), ["1", "2", "3", "4"]);
  assert.equal(h.calls.routes[0].waypoints.length, 2);
  assert.equal(h.calls.routes[0].optimizeWaypoints, false);
  assert.equal(h.calls.directions.length, 1);
  h.cleanup();
});

test("partial lookup never silently routes past the missing property", async () => {
  const h = harness(["OK", "ZERO_RESULTS", "OK"]);
  await flush();
  assert.deepEqual(h.calls.markers.map(m => m.label.text), ["1", "3"]);
  assert.equal(h.calls.routes.length, 0);
  assert.match(text(h.render()), /Some stops could not be located/);
  h.cleanup();
});

test("directions failure preserves the pins and explains the missing route", async () => {
  const h = harness(["OK", "OK"], {routeStatus: "REQUEST_DENIED"});
  await flush();
  assert.equal(h.calls.markers.length, 2);
  assert.match(text(h.render()), /driving route could not load/);
  h.cleanup();
});

test("a stalled geocoder times out and ignores late replies", async () => {
  const h = harness(["OK"], {defer: true});
  h.expire();
  assert.match(text(h.render()), /Map preview unavailable/);
  h.callbacks.forEach(cb => cb());
  await flush();
  assert.equal(h.calls.markers.length, 0);
  h.cleanup();
});

test("leaving the route view ignores pending geocoder replies", async () => {
  const h = harness(["OK"], {defer: true});
  h.cleanup();
  h.callbacks.forEach(cb => cb());
  await flush();
  assert.equal(h.calls.markers.length, 0);
  assert.equal(h.calls.bounds.length, 0);
});
