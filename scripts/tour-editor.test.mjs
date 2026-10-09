import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
test('admin notes save once, and failed saves leave the editor open',async()=>{
 const source=html.slice(html.indexOf('  const saveAdmin ='),html.indexOf('  const sendPostTourFollowUp'));
 const events=[];let reject;
 const save=new Function('savingAdmin','setSavingAdmin','onUpdateTour','tour','adminListings','adminNotes','setShowAdmin','showToast',source+'return saveAdmin;')(
 false,v=>events.push(['saving',v]),t=>{assert.equal(t.notes.a,'full note');return new Promise((_,r)=>reject=r);},{id:'test',version:2},[],{a:'full note'},v=>events.push(['open',v]),(...x)=>events.push(['toast',...x]));
 const promise=save(); assert.deepEqual(events,[['saving',true]]);reject(new Error('Version changed'));await promise;
 assert.ok(!events.some(e=>e[0]==='open'));
 assert.equal(events.find(e=>e[0]==='toast')[1],'Version changed');
 assert.deepEqual(events.at(-1),['saving',false]);
 const noteSource=html.slice(html.indexOf('  const saveNote ='),html.indexOf('  const moveStop ='));
 let draft;
 const note=new Function('adminNotes','setAdminNotes',noteSource+'return saveNote;')({},n=>draft=n);
 note('a','full note');assert.deepEqual(draft,{a:'full note'});
});
test('route organizer resolves account IDs instead of treating them as email addresses',async()=>{
 const source=html.slice(html.indexOf('async function tourOrganizerEmail'),html.indexOf('function TourDetailPage'));
 const reads=[];
 const resolve=new Function('isValidEmail','_fb','mrtWithTimeout','SUPER_ADMIN_EMAIL',source+'return tourOrganizerEmail;')(
 v=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v||''),{ref:p=>{reads.push(p);return{once:async()=>({val:()=>({email:'owner@example.com',active:true})})}}},p=>p,'fallback@example.com');
 assert.equal(await resolve({createdBy:'owner-uid'},null),'owner@example.com');assert.deepEqual(reads,['admins/owner-uid']);
 assert.equal(await resolve({createdBy:'legacy@example.com'},null),'legacy@example.com');
 assert.equal(await resolve({createdBy:'current-id'},{uid:'current-id',email:'current@example.com'}),'current@example.com');
});
