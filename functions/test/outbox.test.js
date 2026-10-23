'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {emailJob,deliverEmailJob}=require('../lib/outbox');
function memory(initial){let value=structuredClone(initial);return {get:async()=>({val:()=>structuredClone(value)}),transaction:async fn=>{const next=fn(structuredClone(value));if(next===undefined)return{committed:false};value=next;return{committed:true,snapshot:{val:()=>structuredClone(value)}}},update:async patch=>{value={...value,...patch}},value:()=>value};}
test('evaluation retries retain the exact payload and idempotency key after uncertain delivery',async()=>{
 const ref=memory(emailJob('id',{to:'fixture@example.com',subject:'Saved feedback',html:'<p>Frozen</p>'},1000)),calls=[];
 const failed=await deliverEmailJob(ref,async message=>{calls.push(message);throw Error('Connection lost after acceptance')},1000);
 assert.equal(failed.status,'failed');assert.equal(ref.value().attempts,1);
 const result=await deliverEmailJob(ref,async message=>{calls.push(message);return{id:'provider-id'}},ref.value().nextAttemptAt);
 assert.equal(result.status,'sent');assert.deepEqual(calls[0],calls[1]);assert.equal(ref.value().providerId,'provider-id');
 await deliverEmailJob(ref,async()=>assert.fail('must not resend a sent job'),Date.now());
});
test('concurrent workers claim once and a crashed claim can recover within the provider window',async()=>{
 const ref=memory(emailJob('id',{subject:'Same bytes'},1000));let resolve;
 const first=deliverEmailJob(ref,()=>new Promise(r=>resolve=r),1000);await new Promise(r=>setImmediate(r));
 assert.equal((await deliverEmailJob(ref,async()=>assert.fail('concurrent send'),1001)).status,'unchanged');resolve({id:'done'});await first;
 const crashed=memory({...emailJob('crash',{subject:'Stable'},1000),status:'processing',claimedAt:1000,nextAttemptAt:121000});
 assert.equal((await deliverEmailJob(crashed,async()=>({id:'recovered'}),122000)).status,'sent');
});
test('expired and permanent failures stop without replaying after the provider deduplication window',async()=>{
 const expired=memory(emailJob('id',{},1000));assert.equal((await deliverEmailJob(expired,()=>assert.fail('expired send'),1000+24*3600000)).status,'dead');
 const permanent=memory(emailJob('bad',{},1000));assert.equal((await deliverEmailJob(permanent,async()=>{throw Object.assign(Error('Invalid recipient'),{status:422})},1000)).status,'dead');
});
