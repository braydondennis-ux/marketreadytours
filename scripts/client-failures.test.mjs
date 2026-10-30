import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('function mrtReportClientFailure'), html.indexOf('window.addEventListener("unhandledrejection"'));
function helpers(navigator={}) {
  const diagnostics=[],toasts=[];
  const api=new Function('navigator','mrtQueueDiagnostic','mrtFlushDiagnostics','showToast',source+'return {share:mrtShareTour,report:mrtReportClientFailure};')(navigator,(...v)=>diagnostics.push(v),async()=>{},(...v)=>toasts.push(v));
  return {...api,diagnostics,toasts};
}
test('canceling native sharing resolves quietly; denied sharing is handled',async()=>{
  let error=Object.assign(new Error('private text'),{name:'AbortError'});
  const h=helpers({share:async()=>{throw error;}});
  await h.share({id:'test',name:'Test'});
  assert.equal(h.diagnostics.length,0);assert.equal(h.toasts.length,0);
  error=Object.assign(new Error('private text'),{name:'NotAllowedError'});
  await h.share({id:'test',name:'Test'});
  assert.deepEqual(h.diagnostics,[['shareTourPermission','internal']]);
  assert.equal(h.toasts[0][1],'error');
});
test('clipboard success is confirmed only after writing; unavailable clipboard is handled',async()=>{
  const copied=[];const h=helpers({clipboard:{writeText:async value=>copied.push(value)}});
  await h.share({id:'abc',name:'Test'});
  assert.deepEqual(copied,['https://marketreadytours.com/t/abc']);assert.equal(h.toasts[0][1],'success');
  const blocked=helpers();await blocked.share({id:'abc'});assert.equal(blocked.toasts[0][1],'error');
});
test('diagnostics retain fixed categories, never raw exception content',()=>{
  const h=helpers();h.report('unhandledPromise',{code:'auth/private-token',message:'secret',stack:'private'});
  h.report('unhandledPromise',{code:'secret',name:'private'});
  assert.deepEqual(h.diagnostics,[['unhandledPromiseAuth','internal'],['unhandledPromiseUnknown','internal']]);
});
test('failed favorite writes do not change the UI and rejected update callbacks are handled',async()=>{
  const start=html.indexOf('  const toggleFavorite = async listingId => {');
  const source=html.slice(start,html.indexOf('  const handleRatingSubmit',start));
  const events=[];let failWrite=true;
  const toggle=new Function('tour','_fb','MRT_SECURE_BACKEND','mrtEnsureAuth','onUpdateTour','mrtReportClientFailure','showToast',source+'return toggleFavorite;')(
    {id:'tour',favorites:{}},{ref:()=>({set:async()=>{if(failWrite)throw Error('offline');}})},true,async()=>({uid:'test'}),async()=>{events.push('update');throw Error('callback');},()=>events.push('diagnostic'),()=>events.push('toast'));
  await toggle('listing');assert.deepEqual(events,['diagnostic','toast']);
  events.length=0;failWrite=false;await toggle('listing');assert.deepEqual(events,['update','diagnostic','toast']);
});
