import './isolated-network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const root=process.env.PARCEL_SOURCE_ROOT||fileURLToPath(new URL('../',import.meta.url));
const app=readFileSync(resolve(root,'app.js'),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const active={state:'ACTIVE',company:{id:'fictional-company',role:'OWNER'},customers:[],packages:[]};
function harness(){
 const nodes=new Map(),requests=[],responses=[],sessions=[];let reloads=0,signouts=0,signins=0,sessionReads=0,rendered=0;
 let session={access_token:'fictional.owner.session',user:{id:'fictional-owner'}};
 function createNode(id){
  const classes=new Set();let html='';const node={id,textContent:'',disabled:false,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)}};
  Object.defineProperty(node,'innerHTML',{get:()=>html,set:value=>{html=value;if(id==='loadingState'){nodes.delete('retryWorkspace');if(value.includes('id="retryWorkspace"'))nodes.set('retryWorkspace',createNode('retryWorkspace'));}}});return node;
 }
 const node=id=>{if(!nodes.has(id))nodes.set(id,createNode(id));return nodes.get(id);};
 const auth={getSession:async()=>{sessionReads++;return {data:{session:sessions.length?sessions.shift():session}};},signInWithPassword:async()=>{signins++;},signOut:async()=>{signouts++;session=null;return {error:null};}};
 const ctx=vm.createContext({console,setTimeout,clearTimeout,performance,crypto:{randomUUID:()=> 'fictional-id'},window:{},location:{origin:"https://preview.example.invalid",reload(){reloads++;}},document:{getElementById:id=>id==='retryWorkspace'?(nodes.get(id)||null):node(id)},supabase:{createClient:()=>({auth})},ParcelSnapAcceptance:{createClient:()=>({auth})},async fetch(url,init){
  requests.push({url,body:JSON.parse(init.body),authorization:init.headers.Authorization});const response=responses.shift();if(typeof response==='function')return response();if(!response)throw Error('No mock response');return response;
 }});
 vm.runInContext(app.slice(0,app.indexOf('function setMode(')),ctx);
 const apiStart=app.indexOf('async function api(body,');vm.runInContext(app.slice(apiStart,app.indexOf('$("authButton").onclick=',apiStart)),ctx);
 const loaderStart=app.indexOf('function showOnly(id){');vm.runInContext(app.slice(loaderStart,app.indexOf('$("saveOnboarding").onclick=',loaderStart)),ctx);
 const signoutStart=app.indexOf('$("signOut").onclick=');vm.runInContext(app.slice(signoutStart,app.indexOf('async function boot()',signoutStart)),ctx);
 ctx.renderWorkspace=()=>{rendered++;};ctx.clearArrivalEmailRecovery=()=>{};
 return {ctx,node,requests,responses,sessions,run:code=>vm.runInContext(code,ctx),retry:()=>nodes.get('retryWorkspace'),setSession:value=>{session=value;},stats:()=>({reloads,signouts,signins,sessionReads,rendered})};
}
const rejected=message=>({ok:false,json:async()=>({error:message})});
const accepted=data=>({ok:true,json:async()=>data});

test('workspace failure renders a visible ordinary retry control without making a second request',async()=>{
 const h=harness();h.responses.push(rejected('Acceptance test is paused or expired.'));await h.run('loadWorkspace()');
 assert(h.retry(),'Retry workspace control must exist');assert.match(h.node('loadingState').innerHTML,/>Retry workspace<\/button>/);assert.equal(typeof h.retry().onclick,'function');assert.equal(h.requests.length,1);assert.equal(h.node('loadingState').classList.contains('hidden'),false);assert.equal(h.node('activeWorkspace').classList.contains('hidden'),true);
});
test('retry reuses the existing authenticated session and sends only workspace without reload/signin/signout',async()=>{
 const h=harness();h.responses.push(rejected('Paused'),accepted(active));await h.run('loadWorkspace()');assert(h.retry());await h.retry().onclick();
 assert.equal(h.requests.length,2);assert.deepEqual(h.requests.map(r=>r.body),[{action:'workspace'},{action:'workspace'}]);assert.equal(h.requests[1].authorization,h.requests[0].authorization);assert.deepEqual(h.stats(),{reloads:0,signouts:0,signins:0,sessionReads:5,rendered:1});assert.equal(h.node('activeWorkspace').classList.contains('hidden'),false);
});
test('overlapping clicks on the same retry control issue one request and remain pending',async()=>{
 const h=harness(),pending=deferred();h.responses.push(rejected('Paused'),()=>pending.promise);await h.run('loadWorkspace()');const button=h.retry();assert(button);
 const first=button.onclick();await button.onclick();await settle();assert.equal(h.requests.length,2);assert.equal(button.disabled,true);assert.equal(h.node('activeWorkspace').classList.contains('hidden'),true);
 pending.resolve(accepted(active));await first;assert.equal(h.stats().rendered,1);
});
test('repeated backend failure creates a fresh usable retry control and never grants access',async()=>{
 const h=harness();h.responses.push(rejected('Paused'),rejected('Still paused'),accepted(active));await h.run('loadWorkspace()');const first=h.retry();assert(first);await first.onclick();const second=h.retry();assert(second);assert.notEqual(second,first);assert.equal(second.disabled,false);assert.equal(h.stats().rendered,0);assert.match(h.node('loadingState').innerHTML,/Still paused/);await second.onclick();assert.equal(h.stats().rendered,1);
});
test('lost session during retry cannot make a backend request or unlock stale workspace',async()=>{
 const h=harness();h.responses.push(rejected('Paused'));await h.run('loadWorkspace()');assert(h.retry());h.setSession(null);await h.retry().onclick();assert.equal(h.requests.length,1);assert.match(h.node('loadingState').innerHTML,/Please sign in again/);assert.equal(h.stats().rendered,0);assert.equal(h.node('activeWorkspace').classList.contains('hidden'),true);assert(h.retry());
});
test('network failure is recoverable by explicit retry only',async()=>{
 const h=harness();h.responses.push(()=>{throw Error('Fictional network failure');},accepted(active));await h.run('loadWorkspace()');assert(h.retry());assert.match(h.node('loadingState').innerHTML,/Fictional network failure/);assert.equal(h.requests.length,1);await h.retry().onclick();assert.equal(h.requests.length,2);assert.equal(h.stats().rendered,1);
});
test('backend error content stays escaped next to the recovery button',async()=>{
 const h=harness();h.responses.push(rejected('<img src=x onerror="bad()">'));await h.run('loadWorkspace()');assert(h.retry());assert.doesNotMatch(h.node('loadingState').innerHTML,/<img/);assert.match(h.node('loadingState').innerHTML,/&lt;img/);
});
test('unknown workspace verdict keeps the active view locked and permits another explicit access check',async()=>{
 const h=harness();h.responses.push(accepted({state:'UNEXPECTED'}));await h.run('loadWorkspace()');assert(h.retry());assert.equal(h.stats().rendered,0);assert.equal(h.node('activeWorkspace').classList.contains('hidden'),true);assert.match(h.node('loadingState').innerHTML,/Unknown workspace state/);
});


const settle=()=>new Promise(resolve=>setImmediate(resolve));
for(const oldOutcome of ['failure','success'])test('older '+oldOutcome+' cannot replace a newer workspace result',async()=>{
 const h=harness(),old=deferred();h.responses.push(()=>old.promise,accepted({...active,company:{id:'new-company',role:'OWNER'}}));
 const first=h.run('loadWorkspace()');await settle();await h.run('loadWorkspace()');assert.equal(h.run('workspace.company.id'),'new-company');
 old.resolve(oldOutcome==='failure'?rejected('Old failure'):accepted({...active,company:{id:'old-company',role:'OWNER'}}));await first;
 assert.equal(h.run('workspace.company.id'),'new-company');assert.equal(h.node('activeWorkspace').classList.contains('hidden'),false);assert.equal(h.stats().rendered,1);assert.equal(h.retry(),undefined);
});
for(const changed of [null,{access_token:'fictional.other.session',user:{id:'other-owner'}}])test('session loss or account change during a pending retry refuses the response',async()=>{
 const h=harness(),pending=deferred();h.responses.push(rejected('Paused'),()=>pending.promise);await h.run('loadWorkspace()');const retry=h.retry();assert(retry);const attempt=retry.onclick();await settle();h.setSession(changed);pending.resolve(accepted(active));await attempt;
 assert.equal(h.run('workspace'),null);assert.equal(h.stats().rendered,0);assert.equal(h.node('activeWorkspace').classList.contains('hidden'),true);assert.match(h.node('loadingState').innerHTML,/Please sign in again/);
});
test('ordinary sign out invalidates a pending retry before its response can expose a workspace',async()=>{
 const h=harness(),pending=deferred();h.responses.push(rejected('Paused'),()=>pending.promise);await h.run('loadWorkspace()');const retry=h.retry();assert(retry);const attempt=retry.onclick();await settle();await h.node('signOut').onclick();pending.resolve(accepted(active));await attempt;
 assert.equal(h.run('workspace'),null);assert.equal(h.stats().rendered,0);assert.equal(h.stats().signouts,1);assert.equal(h.stats().reloads,1);assert.equal(h.node('activeWorkspace').classList.contains('hidden'),true);
});
test('retry restores loading text and leaves photo/review form state untouched',async()=>{
 const h=harness(),pending=deferred();h.responses.push(rejected('Paused'),()=>pending.promise);await h.run('loadWorkspace()');assert(h.retry());h.run('intakePhotoDataUrl="data:image/jpeg;base64,FICTIONAL"');h.node('receiveTracking').value='1ZTEST000000000001';h.node('receiveLabelConfirmed').checked=true;
 const attempt=h.retry().onclick();await settle();assert.match(h.node('loadingState').innerHTML,/Loading workspace/);assert.doesNotMatch(h.node('loadingState').innerHTML,/Paused/);assert.equal(h.run('intakePhotoDataUrl'),'data:image/jpeg;base64,FICTIONAL');assert.equal(h.node('receiveTracking').value,'1ZTEST000000000001');assert.equal(h.node('receiveLabelConfirmed').checked,true);
 pending.resolve(rejected('Still paused'));await attempt;assert.equal(h.run('intakePhotoDataUrl'),'data:image/jpeg;base64,FICTIONAL');assert.equal(h.node('receiveTracking').value,'1ZTEST000000000001');
});


test('A-to-B-to-A session identity cannot send a different users token or render their tenant',async()=>{
 const h=harness(),a={access_token:'fictional.a',user:{id:'owner-a'}},b={access_token:'fictional.b',user:{id:'owner-b'}};h.sessions.push(a,b,a);h.responses.push(accepted({...active,company:{id:'company-b',role:'OWNER'}}));
 await h.run('loadWorkspace()');assert.equal(h.requests.length,0);assert.equal(h.stats().rendered,0);assert.equal(h.run('workspace'),null);assert.match(h.node('loadingState').innerHTML,/Please sign in again/);
});
test('token refresh for the same user remains a valid workspace read',async()=>{
 const h=harness(),before={access_token:'fictional.old',user:{id:'owner-a'}},after={access_token:'fictional.refreshed',user:{id:'owner-a'}};h.sessions.push(before,after,after);h.responses.push(accepted(active));
 await h.run('loadWorkspace()');assert.equal(h.requests.length,1);assert.equal(h.requests[0].authorization,'Bearer fictional.refreshed');assert.equal(h.stats().rendered,1);assert.equal(h.node('activeWorkspace').classList.contains('hidden'),false);
});
