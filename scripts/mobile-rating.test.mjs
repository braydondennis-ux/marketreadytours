import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('function mrtReadRatingDraft'), html.indexOf('function RatingPage'));
function helpers(storage) {
  let id=0;
  return new Function('sessionStorage','mrtRequestId',source+';return {read:mrtReadRatingDraft,write:mrtWriteRatingDraft,attempt:mrtRatingAttempt};')(storage,()=>`attempt-${++id}`);
}
test('phone drafts survive reload, remain separated, and expire after a day',()=>{
  const items=new Map(); const storage={getItem:k=>items.get(k),setItem:(k,v)=>items.set(k,v)};
  const first=helpers(storage); first.write('tour/house/user1',{ratings:{price:4},suggestions:'Keep this note',hadPhotos:true});
  const afterReload=helpers(storage);
  assert.equal(afterReload.read('tour/house/user1').suggestions,'Keep this note');
  assert.equal(afterReload.read('tour/house/user1').ratings.price,4);
  assert.deepEqual(afterReload.read('tour/other/user1'),{});
  assert.deepEqual(afterReload.read('tour/house/user2'),{});
  items.set('old',JSON.stringify({savedAt:Date.now()-86400001,ratings:{price:2}}));
  items.set('corrupt','{bad');
  assert.deepEqual(afterReload.read('old'),{}); assert.deepEqual(afterReload.read('corrupt'),{});
});
test('unavailable browser storage does not prevent rating',()=>{
  const h=helpers({getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('quota')}});
  assert.deepEqual(h.read('x'),{});assert.doesNotThrow(()=>h.write('x',{suggestions:'test'}));
});
test('ambiguous network failure retries the same submission; edited feedback gets a new request',()=>{
  const h=helpers({});const payload={ratings:{price:4},suggestions:'Note',tempPhotoIds:['photo-1']};
  const first=h.attempt(null,payload);
  assert.deepEqual(h.attempt(first,structuredClone(payload)),first);
  const changed=h.attempt(first,{...payload,suggestions:'Updated note'});
  assert.notEqual(changed.requestId,first.requestId);
  assert.notEqual(h.attempt(first,{...payload,tempPhotoIds:[]}).requestId,first.requestId);
});
test('photo decoding blocks submit and unsupported images expose a removable failure',()=>{
  const start=html.indexOf('  const handlePhotoUpload =',html.indexOf('function RatingPage'));
  const source=html.slice(start,html.indexOf('  const starLabel',start));
  let photos=[],error='';const images=[];const revoked=[];
  const Image=class{constructor(){images.push(this);}};
  const upload=new Function('Image','URL','setPhotos','setSubmitError',source+'return handlePhotoUpload;')(
    Image,{createObjectURL:()=> 'blob:local-test',revokeObjectURL:v=>revoked.push(v)},fn=>photos=fn(photos),v=>error=v);
  const target={files:[{name:'bad.heic'}],value:'bad.heic'};upload({target});
  assert.equal(photos[0].uploading,true); assert.equal(target.value,'');
  images[0].onerror();
  assert.equal(photos[0].uploading,false);assert.equal(photos[0].uploadError,true);
  assert.match(error,/JPEG or PNG/);assert.deepEqual(revoked,['blob:local-test']);
});
test('failed sends retain feedback, renew expired access, and clear drafts only after a saved rating',async()=>{
  const start=html.indexOf('  const handleSubmit =',html.indexOf('function RatingPage'));
  const handler=html.slice(start,html.indexOf('  if (done)',start));
  const calls=[],events=[];let failure=new Error('Connection lost');
  const canSend=()=>true;canSend.clear=()=>{};
  const scope={
    submittingRef:{current:false},photos:[],RATING_CATS:[{key:'price',label:'Price'}],ratings:{price:4},
    setSubmitError:v=>events.push(['error',v]),canSend,listing:{id:'house',address:'Local house',price:400000},
    tour:{id:'tour',name:'Local tour'},sanitize:v=>v,getTourStopNumber:()=>1,
    suggestions:'Keep the feedback',sugPrice:'',pricedRight:false,raterName:'',
    setSubmitting:v=>events.push(['submitting',v]),starLabel:()=> '4/5',
    attemptRef:{current:null},mrtRatingAttempt:helpers({}).attempt,MRT_SECURE_BACKEND:true,
    sessionStorage:{getItem:()=> 'grant',removeItem:k=>events.push(['remove',k])},sessionKey:'grant-key',draftKey:'draft-key',
    onRatingSubmit:async(...args)=>{calls.push(args);if(failure)throw failure;return{ok:true}},
    setDone:v=>events.push(['done',v]),setTimeout:()=>{},onBack:()=>{},
    setCodeUnlocked:v=>events.push(['unlocked',v]),setCodeInput:()=>{},setCodeError:v=>events.push(['code-error',v])
  };
  const submit=new Function('scope','with(scope){'+handler+'return handleSubmit;}')(scope);
  await submit();
  assert.equal(calls[0][2].suggestions,'Keep the feedback');
  assert.equal(events.some(e=>e[0]==='remove'),false);
  assert.equal(scope.submittingRef.current,false);
  failure=Object.assign(new Error('Tour access expired'),{code:'permission-denied'});
  await submit();
  assert.deepEqual(events.find(e=>e[0]==='unlocked'),['unlocked',false]);
  assert.equal(events.some(e=>e[0]==='remove'&&e[1]==='draft-key'),false);
  failure=null;await submit();
  assert.equal(calls[0][2].requestId,calls[2][2].requestId);
  assert.deepEqual(events.find(e=>e[0]==='done'),['done',true]);
  assert.ok(events.some(e=>e[0]==='remove'&&e[1]==='draft-key'));
});
test('offline notice does not promise automatic submission or cover navigation',()=>{
  const banner=html.slice(html.indexOf('function OfflineBanner'),html.indexOf('/* ── RATE LIMITER'));
  assert.match(banner,/Reconnect before submitting changes/);
  assert.match(banner,/position: "relative"/);
  assert.doesNotMatch(banner,/changes will sync|syncing changes/);
});
