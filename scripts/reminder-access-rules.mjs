import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {ref,get,set} from 'firebase/database';
// Documentation-only // keys are stripped exactly as in the existing tour preflight.
const stripComments=value=>Array.isArray(value)?value.map(stripComments):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='//').map(([key,item])=>[key,stripComments(item)])):value;
const rules=JSON.stringify(stripComments(JSON.parse(readFileSync('database.rules.transition.json','utf8'))));
const env=await initializeTestEnvironment({projectId:'mrt-transition-audit',database:{host:'127.0.0.1',port:9000,rules}});
try{
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'mrt_reminders/job'),{status:'pending',agentEmail:'fixture@example.com'}));
 for(const context of [env.unauthenticatedContext(),env.authenticatedContext('attendee')]){
  await assertFails(get(ref(context.database(),'mrt_reminders/job')));
  await assertFails(set(ref(context.database(),'mrt_reminders/job/agentEmail'),'different@example.com'));
 }
 const admin=env.authenticatedContext('organizer',{mrtRole:'admin'}).database();
 const job=await assertSucceeds(get(ref(admin,'mrt_reminders/job')));assert.equal(job.val().agentEmail,'fixture@example.com');
 await assertFails(set(ref(admin,'mrt_reminders/job/status'),'sent'));
 console.log('PASS production transition rules: reminder data is admin-readable and server-write-only');
}finally{await env.cleanup();}
