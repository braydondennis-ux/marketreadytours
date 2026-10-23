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
test('edit acknowledgment waits for the server; failures preserve the editor and suppress success',async()=>{
 const src=html.slice(html.indexOf('async function mrtCommitEdit('),html.indexOf('function mrtSponsorWebsite('));
 const events=[];const commit=new Function('showToast',src+'return mrtCommitEdit;')((...args)=>events.push(['toast',...args]));
 let reject;const pending=commit(()=>new Promise((_,r)=>reject=r),{id:'test'},()=>events.push(['closed']),'Saved');
 assert.deepEqual(events,[]);reject(Error('Service unavailable'));assert.equal(await pending,false);
 assert.ok(!events.some(e=>e[0]==='closed'||e[1]==='Saved'));
 let resolve;const success=commit(()=>new Promise(r=>resolve=r),{id:'test'},()=>events.push(['closed']),'Saved');
 resolve({id:'test',version:4});assert.equal(await success,true);assert.deepEqual(events.at(-2),['closed']);assert.equal(events.at(-1)[1],'Saved');
});
test('reordering retains original listing objects until acknowledged, and failure retains saved order',async()=>{
 const source=html.slice(html.indexOf('  const commitListings ='),html.indexOf('  const addListing ='));
 const original=[{id:'a',order:1},{id:'b',order:2}],events=[];let reject;
 const move=new Function('scope','with(scope){'+source+'return moveStop;}')({adminListings:original,tour:{id:'tour'},onUpdateTour:()=>new Promise((_,r)=>reject=r),setAdminListings:v=>events.push(v),mrtCommitEdit:async(save,updated,onSaved)=>{try{const saved=await save(updated);onSaved(saved||updated);return true}catch{return false}}});
 const pending=move(0,1);assert.deepEqual(original.map(l=>l.order),[1,2]);assert.deepEqual(events,[]);reject(Error('Failed'));assert.equal(await pending,false);assert.deepEqual(events,[]);
});
test('sponsor links support legacy/canonical fields and reject executable schemes',()=>{
 const src=html.slice(html.indexOf('function mrtSponsorWebsite('),html.indexOf('function AgentBrandingModal('));const url=new Function(src+'return mrtSponsorWebsite;')();
 assert.equal(url({url:'www.azgat.com'}),'https://www.azgat.com/');assert.equal(url({website:'https://example.com/x'}),'https://example.com/x');assert.equal(url({url:'javascript:alert(1)'}),'');assert.equal(url({url:'https://user:pass@example.com'}),'');
});
