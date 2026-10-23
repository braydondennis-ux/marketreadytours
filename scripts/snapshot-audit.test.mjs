import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {publicTourProjection,localYmd,ratingAggregate,RATING_KEYS}=require('../functions/lib/domain');
const {planTourReminders}=require('../functions/lib/reminders');
function fixture(){
 const tour={id:'audit-tour',name:'Audit fixture',date:localYmd(new Date(Date.now()+7*86400000)),time:'9:00 AM',version:3,updatedAt:1,
  listings:[{id:'a',order:1,address:'123 Main Street',city:'Phoenix AZ',agentEmail:'fixture@example.com',photos:[]}],sponsors:[]};
 const rating=Object.fromEntries(RATING_KEYS.map(key=>[key,4]));
 return {mrt_tours_private:{[tour.id]:tour},mrt_tours_public:{[tour.id]:publicTourProjection(tour)},
  mrt_ratings_private:{[tour.id]:{a:{attendee:rating}}},mrt_ratings_public:{[tour.id]:{a:ratingAggregate({attendee:rating})}},
  mrt_reminders:Object.fromEntries([...planTourReminders({tour,now:Date.now()})].map(([id,row])=>[id,{...row,status:'pending'}]))};
}
async function run(snapshot){
 const dir=await mkdtemp(path.join(tmpdir(),'mrt-snapshot-audit-'));
 try{
  const file=path.join(dir,'snapshot.json');await writeFile(file,JSON.stringify(snapshot));
  const result=spawnSync(process.execPath,['scripts/audit-production-snapshot.cjs',file],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
  assert.equal(result.signal,null);return {status:result.status,report:result.stdout?JSON.parse(result.stdout):null,stderr:result.stderr};
 }finally{await rm(dir,{recursive:true,force:true});}
}
test('snapshot audit accepts matching projections, evaluation totals and scheduled reminders',async()=>{
 const {status,report}=await run(fixture());assert.equal(status,0);assert.equal(report.needsReview,false);assert.equal(report.ratingSubmissions,1);
});
test('snapshot audit flags repeated property addresses even when listing IDs differ',async()=>{
 const x=fixture(),tour=x.mrt_tours_private['audit-tour'];
 tour.listings.push({...tour.listings[0],id:'b',order:2,address:'123 Main Street'});x.mrt_tours_public[tour.id]=publicTourProjection(tour);
 const {status,report}=await run(x);assert.equal(status,1);assert.deepEqual(report.possibleDuplicateProperties[0].stops,[1,2]);
 assert.equal(report.missingFutureReminders.length,2);
});
test('snapshot audit detects stale public saves, incorrect rating totals and stuck reminder work',async()=>{
 const x=fixture();x.mrt_tours_public['audit-tour'].version=2;x.mrt_ratings_public['audit-tour'].a.count=0;
 const reminder=Object.values(x.mrt_reminders)[0];reminder.nextAttemptAt=1;
 const {status,report}=await run(x);assert.equal(status,1);assert.equal(report.tourVersions.length,1);
 assert.equal(report.aggregateMismatches.length,1);assert.equal(report.dueReminders.length,1);
});

test('snapshot audit rejects incomplete exports instead of reporting empty data as healthy',async()=>{
 const {status,report,stderr}=await run({});assert.equal(status,2);assert.equal(report,null);assert.match(stderr,/Incomplete snapshot/);
});
