import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness(outcomes=[]){
 const nodes=new Map(),timers=new Map(),calls=[],shown=[];let reloads=0,nextTimer=0;
 function node(id){if(!nodes.has(id)){let html='';const n={id,disabled:false};Object.defineProperty(n,'innerHTML',{get:()=>html,set:v=>{html=v;if(id==='loadingState'){nodes.delete('retrySignOut');if(v.includes('id="retrySignOut"'))nodes.set('retrySignOut',{id:'retrySignOut',disabled:false});}if(id==='authMessage'&&v.includes('id="retrySignOutAuth"'))nodes.set('retrySignOutAuth',{id:'retrySignOutAuth',disabled:false});}});nodes.set(id,n);}return nodes.get(id);}
 const ctx=vm.createContext({workspaceLoadGeneration:1,workspace:{company:{id:'fictional-company'}},signOutState:'IDLE',authActionInFlight:false,$:id=>id==='retrySignOut'?nodes.get(id):node(id),showOnly:id=>shown.push(id),location:{reload(){reloads++;}},setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),sb:{auth:{signOut:()=>{calls.push('sdk-signout');const outcome=outcomes.shift();return typeof outcome==='function'?outcome():Promise.resolve(outcome);}}}});
 const start=source.indexOf('$("signOut").onclick=');vm.runInContext(source.slice(start,source.indexOf('async function boot()',start)),ctx);
 return {ctx,node,calls,shown,timers,reloads:()=>reloads,fireTimers:()=>{for(const t of [...timers.values()])t.fn();},run:code=>vm.runInContext(code,ctx)};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('successful SDK signout locks workspace, uses original scope call, and reloads once',async()=>{
 const h=harness([{error:null}]);await h.node('signOut').onclick();assert.equal(h.run('workspace'),null);assert.equal(h.run('workspaceLoadGeneration'),2);assert.deepEqual(h.shown,['loadingState']);assert.deepEqual(h.calls,['sdk-signout']);assert.equal(h.reloads(),1);assert.equal(h.timers.size,0);assert.equal(h.node('signOut').disabled,true);
});
test('pending SDK call shows accurate bounded waiting message without treating signout as completed',async()=>{
 const wait=deferred(),h=harness([()=>wait.promise]);const attempt=h.node('signOut').onclick();assert.equal(h.node('signOut').disabled,true);assert.match(h.node('loadingState').innerHTML,/Signing out/);assert.equal(h.timers.size,1);assert.equal([...h.timers.values()][0].ms,10000);h.fireTimers();assert.match(h.node('loadingState').innerHTML,/Sign-out is still pending/);assert.match(h.node('loadingState').innerHTML,/has not completed/);assert.equal(h.reloads(),0);assert.equal(h.calls.length,1);assert.equal(h.run('workspace'),null);wait.resolve({error:null});await attempt;assert.equal(h.reloads(),1);
});
test('repeated header clicks while pending never start concurrent SDK requests',async()=>{
 const wait=deferred(),h=harness([()=>wait.promise]);const first=h.node('signOut').onclick();await h.node('signOut').onclick();h.fireTimers();await h.node('signOut').onclick();assert.equal(h.calls.length,1);wait.resolve({error:null});await first;assert.equal(h.reloads(),1);
});
for(const kind of ['rejection','error-object','unexpected-result'])test(kind+' keeps the workspace locked and offers only explicit signout retry',async()=>{
 const first=kind==='rejection'?()=>Promise.reject(Error('Private detail must not display')):kind==='error-object'?{error:Error('Private detail must not display')}:undefined;
 const h=harness([first,{error:null}]);await h.node('signOut').onclick();assert.equal(h.reloads(),0);assert.equal(h.run('workspace'),null);assert.equal(h.run('signOutState'),'FAILED');assert.equal(h.node('signOut').disabled,false);assert.match(h.node('loadingState').innerHTML,/Sign-out could not finish/);assert.doesNotMatch(h.node('loadingState').innerHTML,/Private detail/);assert.equal(h.timers.size,0);assert.equal(h.calls.length,1);assert(h.node('retrySignOut'));await h.node('retrySignOut').onclick();assert.equal(h.calls.length,2);assert.equal(h.reloads(),1);
});
test('pending-to-rejection recovers without delayed timer replacing the error view',async()=>{
 const wait=deferred(),h=harness([()=>wait.promise]);const attempt=h.node('signOut').onclick();h.fireTimers();wait.reject(Error('Fictional rejection'));await attempt;assert.equal(h.timers.size,0);h.fireTimers();assert.match(h.node('loadingState').innerHTML,/Retry sign out/);assert.equal(h.reloads(),0);
});
test('fresh retries after repeated failures stay explicit and one SDK call each',async()=>{
 const h=harness([{error:Error('first')},{error:Error('second')},{error:null}]);await h.node('signOut').onclick();const first=h.node('retrySignOut');await first.onclick();const second=h.node('retrySignOut');assert.notEqual(second,first);assert.equal(h.calls.length,2);await second.onclick();assert.equal(h.calls.length,3);assert.equal(h.reloads(),1);
});
for(const state of ['PENDING','FAILED'])test('background workspace loader cannot unlock after signout is '+state,async()=>{
 const h=harness();h.run('signOutState='+JSON.stringify(state)+';workspace=null');h.ctx.api=()=>assert.fail('No workspace request allowed');h.ctx.sb.auth.getSession=()=>assert.fail('No session reads needed while signout lock holds');const start=source.indexOf('async function loadWorkspace(){');h.run(source.slice(start,source.indexOf('$("saveOnboarding").onclick=',start)));await h.run('loadWorkspace()');assert.equal(h.run('workspace'),null);assert.equal(h.reloads(),0);
});
test('scope and session storage policies remain unchanged',()=>{
 assert.match(source,/await sb\.auth\.signOut\(\)/);assert.doesNotMatch(source,/signOut\(\{scope:/);assert.doesNotMatch(source,/localStorage\.clear|sessionStorage\.clear|removeAllChannels|refreshSession\(/);
});
