// Read-only consistency audit of an ignored local production snapshot. Never writes to Firebase.
const fs=require('fs');
const snapshotPath=process.argv[2];
if(!snapshotPath){console.error('Usage: node scripts/audit-production-snapshot.cjs <snapshot.json>');process.exit(2);}
const {publicTourProjection,ratingAggregate,localYmd}=require('../functions/lib/domain');
const {planTourReminders}=require('../functions/lib/reminders');
const data=JSON.parse(fs.readFileSync(snapshotPath,'utf8'));
for(const node of ['mrt_tours_private','mrt_tours_public','mrt_ratings_private','mrt_ratings_public','mrt_reminders']){
 if(!Object.hasOwn(data,node)){console.error('Incomplete snapshot: missing '+node);process.exit(2);}
}
const privateTours=data.mrt_tours_private||{},publicTours=data.mrt_tours_public||{},ratings=data.mrt_ratings_private||{},agg=data.mrt_ratings_public||{},reminders=data.mrt_reminders||{};
const norm=v=>v===null||v===undefined?undefined:Array.isArray(v)?v.length?v.map(norm):undefined:typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,norm(v[k])]).filter(([,v])=>v!==undefined)):v;
const equal=(a,b)=>JSON.stringify(norm(a))===JSON.stringify(norm(b));
const out={at:new Date().toISOString(),privateTours:Object.keys(privateTours).length,publicTours:Object.keys(publicTours).length,tourVersions:[],projectionErrors:[],projectionMismatches:[],missingPrivate:[],ratingListings:0,ratingSubmissions:0,aggregateMismatches:[],orphanRatingTours:[],upcoming:[],reminderStates:{},dueReminders:[],missingFutureReminders:[],terminalInQueue:[],invalidListingIds:[],requests:{},possibleDuplicateProperties:[]};
for(const [id,t] of Object.entries(privateTours)){
 const p=publicTours[id];if(!p||p.version!==t.version)out.tourVersions.push({id,privateVersion:t.version,publicVersion:p?.version});
 try{const expected=publicTourProjection(t);if(!equal(expected,p))out.projectionMismatches.push({id,fields:[...new Set([...Object.keys(expected),...Object.keys(p||{})])].filter(k=>!equal(expected[k],p?.[k]))})}catch(e){out.projectionErrors.push({id,error:e.message})}
 const ids=(t.listings||[]).map(l=>l.id);if(ids.some(x=>!x)||new Set(ids).size!==ids.length)out.invalidListingIds.push(id);
 if(t.date>=localYmd()&&!t.archived)out.upcoming.push({id,name:t.name,date:t.date,listings:ids.length,version:t.version});
 for(const [rid,planned] of planTourReminders({tour:t,now:Date.now()}))if(!reminders[rid])out.missingFutureReminders.push({tourId:id,listingId:planned.listingId,hoursAhead:planned.hoursAhead});
}
for(const [tid,t] of Object.entries(privateTours)){
 if(t.archived || t.date<localYmd())continue;
 const groups=new Map();
 for(const [i,l] of (t.listings||[]).entries()){
  const key=(String(l.address||'')+' '+String(l.city||'')).toLowerCase().replace(/[^a-z0-9]/g,'');
  if(key.trim())groups.set(key,[...(groups.get(key)||[]),{stop:i+1,id:l.id}]);
 }
 for(const rows of groups.values())if(rows.length>1)out.possibleDuplicateProperties.push({tourId:tid,stops:rows.map(r=>r.stop),listingIds:rows.map(r=>r.id)});
}
for(const id of Object.keys(publicTours))if(!privateTours[id])out.missingPrivate.push(id);
for(const [tid,ls] of Object.entries(ratings)){
 if(!privateTours[tid])out.orphanRatingTours.push(tid);
 for(const [lid,rs] of Object.entries(ls)){
  out.ratingListings++;out.ratingSubmissions+=Object.values(rs||{}).filter(Boolean).length;
  const expected=ratingAggregate(rs), actual=agg[tid]?.[lid];
  if(!equal(expected.count,actual?.count)||!equal(expected.averages,actual?.averages))out.aggregateMismatches.push({tid,lid,expectedCount:expected.count,actualCount:actual?.count});
 }
}
for(const [id,r] of Object.entries(reminders)){
 out.reminderStates[r.status]=(out.reminderStates[r.status]||0)+1;
 if(['pending','failed'].includes(r.status)&&r.nextAttemptAt<Date.now()-600000)out.dueReminders.push({id,status:r.status,due:r.nextAttemptAt,tourId:r.tourId});
 if(!['pending','failed','sending'].includes(r.status)&&r.nextAttemptAt<Date.now())out.terminalInQueue.push({id,status:r.status});
}
for(const node of ['mrt_listing_requests','mrt_tour_requests','mrt_contact_requests']){
 const x=Object.values(data[node]||{});out.requests[node]={count:x.length,states:{},oldestPendingAt:null};
 for(const r of x){const state=r.status||'pending';out.requests[node].states[state]=(out.requests[node].states[state]||0)+1;if(state==='pending'&&r.createdAt)out.requests[node].oldestPendingAt=Math.min(out.requests[node].oldestPendingAt||Infinity,r.createdAt)}
}
out.needsReview=['tourVersions','projectionErrors','projectionMismatches','missingPrivate','aggregateMismatches','orphanRatingTours','dueReminders','missingFutureReminders','terminalInQueue','invalidListingIds','possibleDuplicateProperties'].some(key=>out[key].length>0);
console.log(JSON.stringify(out,null,2));
// A review flag is not permission to delete, resend, repair or overwrite production data.
process.exitCode=out.needsReview?1:0;
