import './isolated-network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const helpers=app.slice(app.indexOf('const READONLY_WAIT_MS='),app.indexOf('let intakePhotoDataUrl='));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const settle=()=>new Promise(r=>setImmediate(r));
function harness(){
 let now=0,next=0,reads=0;const timers=new Map(),sessions=[];
 const ctx=vm.createContext({performance:{now:()=>now},Promise,Error,AbortController,
  setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
  sb:{auth:{getSession(){reads++;return sessions.length?sessions.shift():{data:{session:null}};}}}});
 vm.runInContext(helpers,ctx);
 return {ctx,timers,sessions,reads:()=>reads,run:s=>vm.runInContext(s,ctx),clock:n=>{now=n;},fire(){const entries=[...timers.entries()];timers.clear();for(const [,t] of entries)t.fn();}};
}
test('session deadline ends the waiter and retry shares the unresolved SDK call',async()=>{
 const h=harness(),pending=deferred();h.sessions.push(pending.promise);
 const first=h.run('readSessionForWorkspace()');const rejection=assert.rejects(first,/existing sign-in took too long/);await settle();assert.equal(h.reads(),1);h.fire();await rejection;
 const retry=h.run('readSessionForWorkspace()');await settle();assert.equal(h.reads(),1);pending.resolve({data:{session:null}});assert.equal((await retry).data.session,null);assert.equal(h.timers.size,0);
});
test('expired overall budget does not start a new SDK lookup',()=>{const h=harness();h.clock(20);assert.throws(()=>h.run('readSessionForWorkspace(10)'),/took too long/);assert.equal(h.reads(),0);});
test('a settled failed session request permits a subsequent explicit read',async()=>{
 const h=harness();h.sessions.push(Promise.reject(Error('fictional SDK failure')));await assert.rejects(h.run('readSessionForWorkspace()'),/fictional SDK failure/);await settle();await h.run('readSessionForWorkspace()');assert.equal(h.reads(),2);
});
test('timeout invokes abort once and a late success cannot resolve the timed-out waiter',async()=>{
 const h=harness(),pending=deferred();let aborts=0;h.ctx.pending=pending.promise;h.ctx.abort=()=>aborts++;
 const wait=h.run('boundedReadOnly(pending,15,"fictional timeout",abort)');const rejected=assert.rejects(wait,/fictional timeout/);h.fire();await rejected;pending.resolve('late');await settle();assert.equal(aborts,1);assert.equal(h.timers.size,0);
});
test('successful bounded response clears its deadline without aborting',async()=>{
 const h=harness();let aborts=0;h.ctx.abort=()=>aborts++;assert.equal(await h.run('boundedReadOnly(Promise.resolve("ok"),15,"timeout",abort)'),'ok');assert.equal(h.timers.size,0);assert.equal(aborts,0);
});
test('both response fetch and body decoding stay inside the deadline and carry AbortSignal',()=>{
 const s=app.slice(app.indexOf('async function api('),app.indexOf('$("authButton").onclick='));
 assert(s.indexOf('return await boundedReadOnly((async()=>{')<s.indexOf('await fetch('));assert(s.indexOf('await r.json()')<s.indexOf('})(),timeoutMs'));
 assert.match(s,/signal:controller.signal/);assert.match(s,/controller.abort\(\)/);
});
test('workspace stays behind capability verification, shares one budget, and emits sanitized stages',()=>{
 const s=app.slice(app.indexOf('async function loadWorkspace(){'),app.indexOf('$("saveOnboarding").onclick='));
 assert(s.indexOf('readCapabilityStatus(candidateCapability')<s.indexOf('action:"workspace_readonly"'));
 assert.match(s,/deadline:timing.started\+READONLY_WAIT_MS/);assert.equal((s.match(/startedSession.user.id,readOptions/g)||[]).length,2);
 assert.match(s,/finishWorkspaceTiming\(timing,"ready"\)/);assert.match(s,/finishWorkspaceTiming\(timing,"unavailable"\)/);
 const t=helpers.slice(helpers.indexOf('function finishWorkspaceTiming'));
 for(const secret of ['access_token','email','company_id','customer'])assert(!t.includes(secret));
});
test('startup catches session timeout with explicit retry and no signin/reload',()=>{
 const s=app.slice(app.indexOf('async function boot(){'),app.indexOf('function showOnly(id){'));
 assert.match(s,/Retry existing session/);assert.match(s,/await boot\(\)/);assert(!s.includes('signInWithPassword'));assert(!s.includes('location.reload'));
});
test('pre-SDK watchdog only shows a manual recovery control and never auto reloads',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const start=html.indexOf('globalThis.parcelStartupWatchdog=setTimeout');const finish=html.indexOf('</script>',start);const script=html.slice(start,finish);
 assert(start>0);assert(finish<html.indexOf('src="https://cdn.jsdelivr.net/npm/@supabase'));
 assert.equal((script.match(/location.reload/g)||[]).length,1);assert.match(script,/retry.onclick=\(\)=>location.reload\(\)/);
 assert(!script.includes('fetch('));assert(!script.includes('localStorage'));assert(!script.includes('password'));
});
function addApi(h,fetch){
 Object.assign(h.ctx,{fetch,PORTAL_API:'https://fictional.example.invalid/portal',SUPABASE_KEY:'fictional-public',workspaceLoadGeneration:0,signOutState:'IDLE',workspaceActorId:null,
 requireArrivalCapability:()=>{},intakeReview:{assertPrivateAction:()=>{},assertPortalTransport:()=>{},BUILD:{arrivalDeploymentId:'fixture-deploy'},CONTRACT:{contract:'fixture-contract'}}});
 vm.runInContext(app.slice(app.indexOf('async function api('),app.indexOf('$("authButton").onclick=')),h.ctx);
 h.sessions.push({data:{session:{user:{id:'fixture-actor'},access_token:'fictional-token'}}});
}
test('real api aborts a hung fetch and never automatically retries it',async()=>{
 const h=harness(),pending=deferred();let calls=0,signal;addApi(h,async(_url,init)=>{calls++;signal=init.signal;return pending.promise;});
 const request=h.run('api({action:"arrival_capabilities"},"fixture-actor")');const rejection=assert.rejects(request,/read-only server check timed out/);await settle();assert.equal(calls,1);assert.equal(signal.aborted,false);h.fire();await rejection;assert.equal(signal.aborted,true);assert.equal(calls,1);
 pending.resolve({ok:true,json:async()=>({state:'ACTIVE'})});await settle();assert.equal(calls,1);
});
test('real api bounds a hung body decoder as well as initial fetch',async()=>{
 const h=harness(),body=deferred();let signal;addApi(h,async(_url,init)=>{signal=init.signal;return {ok:true,json:()=>body.promise};});
 const request=h.run('api({action:"arrival_capabilities"},"fixture-actor")');const rejection=assert.rejects(request,/timed out/);await settle();h.fire();await rejection;assert.equal(signal.aborted,true);body.resolve({state:'ACTIVE'});await settle();assert.equal(h.timers.size,0);
});
test('real api shares remaining absolute budget after session resolves',async()=>{
 const h=harness();addApi(h,async()=>({ok:true,json:async()=>({ok:true})}));h.clock(95);await h.run('api({action:"arrival_capabilities"},"fixture-actor",{deadline:100})');assert.equal(h.timers.size,0);
});
