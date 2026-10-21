import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const html=await readFile(process.env.MRT_TEST_HTML || new URL('../index.html',import.meta.url),'utf8');
const between=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const routeSource=between('function mrtReadRoute(', 'function RequestListingPage(');
const route=new Function(routeSource+'return mrtReadRoute;')();
const children=n=>(n?.children||[]).flat(Infinity).filter(x=>x!==null&&x!==false&&x!==undefined);
const nodes=n=>!n||typeof n!=='object'?[]:[n,...children(n).flatMap(nodes)];
const text=n=>typeof n==='string'?n:children(n).map(text).join('');
function harness(source,name,props,extra={}) {
 const slots=[];let cursor=0,effects=[],id=0;
 const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];};
 const useRef=initial=>{const i=cursor++;return slots[i]||(slots[i]={current:initial});};
 const scope={React:{createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'fragment'},useState,useRef,useEffect:fn=>effects.push(fn),uid:()=>`test-${++id}`,window:{location:{search:'',hash:''}},URLSearchParams,TODAY:'2026-10-21',isValidEmail:s=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s),LI:()=>null,B:{},PublicMasthead:'masthead',MrtIconField:'field',TourDot:'dot',_fbStorage:null,MRT_SECURE_BACKEND:true,sanitize:s=>s,mrtRequestId:()=>`request-${++id}`,mrtReadRoute:route,showToast:()=>{},...extra};
 const component=new Function('scope','with(scope){'+source+';return '+name+';}')(scope);
 return {scope,render:()=>{cursor=0;effects=[];return component(props);},effects:()=>{for(const f of effects)f();},props};
}
const addSource=between('function AddListingForm(', '/* ── TOUR DETAIL PAGE');
const requestSource=between('function RequestListingPage(', '/* ── LISTING REQUESTS ADMIN PAGE');
const getButton=(tree,label)=>nodes(tree).find(n=>n.type==='button'&&text(n)===label);
const getField=(tree,name)=>nodes(tree).find(n=>n.props.placeholder===name);
test('existing hash-query invitations preserve exact tour ID and decode values once',()=>{
 const result=route({hash:'#/request/tour-123?cb=organizer%40example.com&address=123%20Main%20St%20%231',search:'?email=agent%2Btest%40example.com'});
 assert.equal(result.path,'request/tour-123');assert.equal(result.params.get('cb'),'organizer@example.com');assert.equal(result.params.get('address'),'123 Main St #1');assert.equal(result.params.get('email'),'agent+test@example.com');
});
test('manually typed address enables Add Listing without Google; failed save retains form and retry ID',async()=>{
 const calls=[];let fail=true;
 const h=harness(addSource,'AddListingForm',{onCancel:()=>{},onAdd:async p=>{calls.push(p);if(fail)throw Error('Connection lost');}});
 let tree=h.render();getField(tree,'Start typing an address...').props.onChange({target:{value:'123 Main Street'}});
 tree=h.render();assert.equal(getButton(tree,'Add Listing').props.disabled,false);
 await getButton(tree,'Add Listing').props.onClick();tree=h.render();assert.match(text(tree),/Connection lost/);assert.equal(getField(tree,'Start typing an address...').props.value,'123 Main Street');
 fail=false;await getButton(tree,'Add Listing').props.onClick();assert.equal(calls[0].id,calls[1].id);
});
test('repeated Add Listing clicks issue only one pending save',async()=>{
 let calls=0,resolve;const h=harness(addSource,'AddListingForm',{initialFields:{address:'123 Main Street'},onAdd:()=>{calls++;return new Promise(r=>resolve=r)}});
 const submit=getButton(h.render(),'Add Listing').props.onClick;const pending=submit();await submit();assert.equal(calls,1);assert.ok(getButton(h.render(),'Saving...').props.disabled);resolve();await pending;
});
test('editor does not close or announce success until the server saves the listing',async()=>{
 const src=between('  const addListing =', '  const deleteStop =');const events=[];let resolve,reject;
 const scope={adminListings:[],tour:{id:'tour',maxListings:8},uid:()=> 'id',onUpdateTour:()=>new Promise((r,j)=>{resolve=r;reject=j}),setAdminListings:v=>events.push(['listings',v]),setShowAddForm:v=>events.push(['form',v]),showToast:v=>events.push(['toast',v])};
 const add=new Function('scope','with(scope){'+src+'return addListing;}')(scope);
 const failed=add({id:'home',address:'123 Main Street'});assert.equal(events.length,0);reject(Error('Version changed'));await assert.rejects(failed,/Version changed/);assert.equal(events.length,0);
 const success=add({id:'home',address:'123 Main Street'});resolve({listings:[{id:'home'}]});await success;assert.deepEqual(events[0],['listings',[{id:'home'}]]);assert.deepEqual(events[1],['form',false]);
});
function publicForm(tourSignUp=true) {
 const calls=[];const props={tourSignUp,tours:[{id:'one',name:'One',date:'2026-10-29'},{id:'two',name:'Two',date:'2026-11-05'}],onSubmit:p=>calls.push(['saved',p])};
 const h=harness(requestSource,'RequestListingPage',props,{mrtCall:async(name,p)=>{calls.push([name,p]);return{id:'saved-id'}}});
 const fill=(placeholder,value)=>getField(h.render(),placeholder).props.onChange({target:{value}});
 fill('Full Name *','Test Agent');fill('Email Address *','agent@example.com');return{h,calls,fill};
}
test('generic signup requires an explicit listing or attendance choice and names missing fields',async()=>{
 const {h,calls}=publicForm();await getButton(h.render(),'Submit Listing Request').props.onClick();assert.match(text(h.render()),/Choose Include my listing/);assert.equal(calls.length,0);
 getButton(h.render(),'Include my listing').props.onClick();await getButton(h.render(),'Submit Listing Request').props.onClick();assert.match(text(h.render()),/Please complete: Select a Tour, Property Address/);
});
test('listing intent from Tour Sign Up submits a listing request, while attendance stays attendance',async()=>{
 for(const [choice,type] of [['Include my listing','listing'],['Attend without a listing','tour']]){
  const {h,calls,fill}=publicForm();getButton(h.render(),choice).props.onClick();const tour=nodes(h.render()).find(n=>n.type==='button'&&text(n).startsWith('One'));tour.props.onClick();
  if(type==='listing')fill('Property Address *','123 Main Street');
  await getButton(h.render(),type==='listing'?'Submit Listing Request':'Sign Up for Tour').props.onClick();assert.equal(calls[0][1].type,type);assert.equal(calls[0][1].payload.tourId,'one');
  assert.equal(calls[1][1].type,type==='listing'?'listing-request':'tour-signup');
 }
});
test('invite preselection recovers when tours arrive after the initial render',()=>{
 const {h}=publicForm(false);h.props.tours=[];h.props.preselectedTourId='two';h.render();h.effects();h.props.tours=[{id:'two',name:'Two',date:'2026-11-05'}];h.render();h.effects();assert.equal(nodes(h.render()).find(n=>n.type==='button'&&text(n).startsWith('Two')).props['aria-pressed'],true);
});
test('attendance recovery prefills contact details, waits for save, and prevents readding the same request',async()=>{
 const calls=[];let resolve;const request={id:'request-1',name:'Agent',email:'agent@example.com',phone:'123',tourId:'one'};const tour={id:'one',name:'One',date:'2026-10-29',listings:[],version:4};
 const h=harness(between('function AttendanceListingForm(', 'function ListingRequestsAdmin('),'AttendanceListingForm',{request,tours:[tour],onSaveTour:p=>{calls.push(p);return new Promise(r=>resolve=r)},onDone:()=>calls.push('done')},{AddListingForm:'add'});
 const form=nodes(h.render()).find(n=>n.type==='add');assert.equal(form.props.initialFields.agentEmail,request.email);const pending=form.props.onAdd({address:'123 Main Street'});assert.equal(calls.length,1);assert.equal(calls[0].version,4);resolve();await pending;assert.equal(calls[1],'done');
 tour.listings=calls[0].listings;assert.match(text(h.render()),/already been added/);assert.equal(nodes(h.render()).some(n=>n.type==='add'),false);
});
