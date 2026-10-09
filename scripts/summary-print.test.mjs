import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('function SummaryDashboard('),html.indexOf('/* ── AGENT BRANDING MODAL'));
test('printing includes collapsed property scores and notes, then restores the summary', () => {
  const states=[],effects=[],listeners=new Map(); let cursor=0;
  const React={createElement:(type,props,...children)=>({type,props,children})};
  const Component=new Function('React','ReactDOM','useState','useEffect','window','B','LI','TourDot','tourHue','avgRating','RATING_CATS',source+';return SummaryDashboard;')(
    React,{flushSync:fn=>fn()},initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],v=>{states[i]=v}];},fn=>effects.push(fn),
    {addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k)}, {},()=>null,()=>null,()=> '#123',r=>Number(r.price||0),[{key:'price',label:'Price'}]);
  const tour={name:'Test tour',listings:[{id:'a',address:'First house'},{id:'b',address:'Second house'}],ratings:{a:{price:4},b:{price:3}},ratingSubmissions:{a:[{price:4,suggestions:'First comment'}],b:[{price:3,suggestions:'Second comment'}]}};
  const text=node=>Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.children):typeof node==='string'?node:'';
  const render=()=>{cursor=0;return text(Component({tour}));};
  assert.doesNotMatch(render(),/Second comment/);
  const cleanup=effects[0]();
  listeners.get('beforeprint')();
  assert.match(render(),/Second comment/);
  assert.match(render(),/3\/5/);
  listeners.get('afterprint')();
  assert.doesNotMatch(render(),/Second comment/);
  cleanup();assert.equal(listeners.size,0);
});
