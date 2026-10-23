'use strict';
const TERMINAL=253402300799000;
// Provider deduplication lasts 24h. Stop earlier, including retries after a lost response.
const WINDOW=23*60*60*1000;
async function deliverEmailJob(ref,send,now=Date.now()){
 const fresh=(await ref.get()).val();if(!fresh)return {status:'missing'};
 const claim=await ref.transaction(current=>{
  const value=current===null?fresh:current;
  if(!value||!['pending','failed','processing'].includes(value.status)||Number(value.nextAttemptAt)>now)return;
  if(value.status==='processing'&&Number(value.claimedAt)>now-120000)return;
  return {...value,status:'processing',claimedAt:now,nextAttemptAt:now+120000};
 });
 if(!claim.committed)return {status:'unchanged'};
 const job=claim.snapshot.val();
 if(now>=job.expiresAt){await ref.update({status:'dead',nextAttemptAt:TERMINAL,lastError:'Delivery retry window expired'});return {status:'dead'};}
 try{
  const receipt=await send({...job.message,idempotencyKey:job.idempotencyKey});
  await ref.update({status:'sent',sentAt:Date.now(),providerId:receipt.id||null,nextAttemptAt:TERMINAL});
  return {status:'sent'};
 }catch(error){
  const attempts=Number(job.attempts||0)+1;
  const permanent=error.status>=400&&error.status<500&&![408,429].includes(error.status);
  const dead=permanent||attempts>=5;
  await ref.update({status:dead?'dead':'failed',attempts,lastError:String(error.message||'Delivery failed').slice(0,500),nextAttemptAt:dead?TERMINAL:now+Math.min(60,2**attempts)*60000});
  return {status:dead?'dead':'failed'};
 }
}
function emailJob(id,message,now=Date.now()){
 return {id,message,idempotencyKey:'evaluation/'+id,status:'pending',attempts:0,createdAt:now,expiresAt:now+WINDOW,nextAttemptAt:now};
}
module.exports={deliverEmailJob,emailJob};
