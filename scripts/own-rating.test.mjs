import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('function mrtWatchOwnRatings'), html.indexOf('function TourDetailPage'));
const {watch,has} = new Function(source+';return {watch:mrtWatchOwnRatings,has:mrtHasOwnRating};')();
function setup() {
  let authCallback, unsubscribed=false;const refs=[],states=[];
  const auth={onAuthStateChanged:fn=>{authCallback=fn;return()=>{unsubscribed=true}}};
  const db={ref:path=>{const r={path,on:(event,fn,error)=>{r.fn=fn;r.error=error},off:(event,fn)=>{assert.equal(fn,r.fn);r.offCalled=true}};refs.push(r);return r}};
  const stop=watch(db,auth,'tour1',['home1','home2'],s=>states.push(s));
  return {refs,states,stop,login:u=>authCallback(u),unsubscribed:()=>unsubscribed};
}
test('fresh anonymous attendee sees Rate Home despite existing public scores',()=>{
  const t=setup();t.login({uid:'fresh-incognito'});
  assert.equal(has(t.states.at(-1),'tour1','home1','fresh-incognito'),false);
  assert.deepEqual(t.refs.map(r=>r.path),['mrt_ratings_private/tour1/home1/fresh-incognito/submittedAt','mrt_ratings_private/tour1/home2/fresh-incognito/submittedAt']);
  t.refs[0].fn({exists:()=>false});
  assert.equal(has(t.states.at(-1),'tour1','home1','fresh-incognito'),false);
  assert.match(html,/hasOwnRating \? [^\n]+" Re-Rate"/);
  t.stop();
});
test('own saved rating enables Re-Rate after submission or reload, only for that property',()=>{
  const t=setup();t.login({uid:'returning'});t.refs[0].fn({exists:()=>true});
  assert.equal(has(t.states.at(-1),'tour1','home1','returning'),true);
  assert.equal(has(t.states.at(-1),'tour1','home2','returning'),false);
  assert.equal(has(t.states.at(-1),'another-tour','home1','returning'),false);
  assert.equal(has(t.states.at(-1),'tour1','home1','another-attendee'),false);
  t.refs[0].error();assert.equal(has(t.states.at(-1),'tour1','home1','returning'),false);
  t.stop();
});
test('switching accounts clears status and ignores late callbacks; unmount releases listeners',()=>{
  const t=setup();t.login({uid:'first'});t.refs[0].fn({exists:()=>true});
  t.login({uid:'second'});const count=t.states.length;
  assert.equal(t.refs[0].offCalled,true);t.refs[0].fn({exists:()=>true});assert.equal(t.states.length,count);
  assert.equal(has(t.states.at(-1),'tour1','home1','second'),false);
  t.login(null);assert.equal(has(t.states.at(-1),'tour1','home1',null),false);
  t.stop();const after=t.states.length;t.refs[2].fn({exists:()=>true});assert.equal(t.states.length,after);assert.equal(t.unsubscribed(),true);
});
