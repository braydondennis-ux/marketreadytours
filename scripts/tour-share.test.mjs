import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {renderShare} from '../cloudflare/tour-share.mjs';

test('share page uses current public details, escapes content and links directly to the app', () => {
  const html = renderShare('tour-example', {name:'<script>alert(1)</script>',date:'2026-10-09',time:'9:00 AM',version:18,code:'SECRET-CODE',agentEmail:'private@example.com',listings:{b:{order:2,address:'Second'},a:{order:1,address:'First & Main'}}});
  assert.ok(html.includes('Friday, October 9, 2026'));
  assert.ok(html.includes('2 homes'));
  assert.ok(html.includes('First &amp; Main'));
  assert.ok(html.includes('/app/#/tour/tour-example'));
  assert.ok(html.includes('/img/tour-example?v=18'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>') && !html.includes('SECRET-CODE') && !html.includes('private@example.com'));
});

test('worker reads only the public projection, preserves image proxy and survives upstream failures', async t => {
  const calls = [];
  let fail = false;
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(String(url));
    if (fail) throw new Error('offline');
    if (String(url).endsWith('.json')) return Response.json({name:'Current tour',listings:[{photos:['https://example.com/home.jpg']}]});
    return new Response('image', {headers:{'Content-Type':'image/jpeg'}});
  });
  const page = await worker.fetch(new Request('https://marketreadytours.com/t/tour-example'));
  assert.equal(page.status,200);
  assert.match(await page.text(), /Current tour/);
  assert.deepEqual(calls, ['https://marketready-tours-default-rtdb.firebaseio.com/mrt_tours_public/tour-example.json']);
  const image = await worker.fetch(new Request('https://marketreadytours.com/img/tour-example'));
  assert.equal(image.headers.get('content-type'),'image/jpeg');
  assert.equal(await image.text(),'image');
  fail = true;
  const fallback = await worker.fetch(new Request('https://marketreadytours.com/t/tour-example'));
  assert.match(await fallback.text(), /\/app\/#\/tour\/tour-example/);
  const invalid = await worker.fetch(new Request('https://marketreadytours.com/t/bad%22id'));
  assert.equal(invalid.status,302);
  assert.equal(invalid.headers.get('location'),'https://marketreadytours.com/app/');
});
