import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
 const nodes=new Map(),signouts=[],signins=[],signups=[],requests=[],timers=new Map();let callback,session={user:{id:'fictional-owner'},access_token:'fixture-session'},reloads=0,renders=0,timerId=0;
 const outQueue=[],inQueue=[];
 function node(id){if(!nodes.has(id)){let html='';const classes=new Set();const n={id,value:'',textContent:'',disabled:false,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)}};Object.defineProperty(n,'innerHTML',{get:()=>html,set:v=>{html=v;for(const key of ['retrySignOut','retrySignOutAuth'])if(v.includes('id="'+key+'"'))nodes.set(key,{id:key,disabled:false});}});nodes.set(id,n);}return nodes.get(id);}
 const auth={getSession:async()=>({data:{session}}),onAuthStateChange:fn=>{callback=fn;},signOut:()=>{signouts.push('signout');const next=outQueue.shift();return typeof next==='function'?next():Promise.resolve(next??{error:null});},signInWithPassword:async()=>{signins.push('signin');const next=inQueue.shift();const result=typeof next==='function'?await next():next??{error:null};if(!result.error){session={user:{id:'fictional-new-owner'},access_token:'fixture-new-session'};callback('SIGNED_IN',session);}return result;},signUp:()=>{signups.push('signup');throw Error('No account creation permitted in these tests');}};
 const ctx=vm.createContext({console,performance,window:{},document:{getElementById:node},supabase:{createClient:()=>({auth})},location:{reload:()=>reloads++},localStorage:{getItem:()=>null},setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),crypto:{randomUUID:()=> 'fictional-id'}});
 vm.runInContext(source.slice(0,source.indexOf('function setMode(')),ctx);
 const authStart=source.indexOf('$("authButton").onclick=');vm.runInContext(source.slice(authStart,source.indexOf('function showOnly(',authStart)),ctx);
 const loadStart=source.indexOf('function showOnly(');vm.runInContext(source.slice(loadStart,source.indexOf('$("saveOnboarding").onclick=',loadStart)),ctx);
 const callbackStart=source.indexOf('sb.auth.onAuthStateChange(');vm.runInContext(source.slice(callbackStart,source.indexOf('\nboot();',callbackStart)),ctx);
 ctx.api=async body=>{requests.push(body);return {state:'ACTIVE',company:{id:'fictional-company',role:'OWNER'}};};ctx.renderWorkspace=()=>renders++;ctx.clearArrivalEmailRecovery=()=>{};
 node('email').value='test@example.invalid';node('password').value='fictional-only';node('authView').classList.add('hidden');
 return {node,ctx,outQueue,inQueue,signouts,signins,signups,requests,timers,run:s=>vm.runInContext(s,ctx),emit:(event,next)=>{session=next;callback(event,next);},reloads:()=>reloads,renders:()=>renders};
}
async function failAfterCallback(h){const pending=deferred();h.outQueue.push(()=>pending.promise);const signing=h.node('signOut').onclick();h.emit('SIGNED_OUT',null);pending.reject(Error('Fictional SDK rejection'));await signing;}

test('session-cleared callback keeps pending signout explained on the visible login view',async()=>{
 const h=harness(),pending=deferred();h.outQueue.push(()=>pending.promise);const signing=h.node('signOut').onclick();h.emit('SIGNED_OUT',null);
 assert.equal(h.node('authView').classList.contains('hidden'),false);assert.equal(h.node('appView').classList.contains('hidden'),true);assert.equal(h.node('authButton').disabled,true);assert.match(h.node('authMessage').textContent,/Sign-out is still pending/);
 await h.node('authButton').onclick();assert.equal(h.signins.length,0);assert.equal(h.signups.length,0);
 for(const t of h.timers.values())t.fn();assert.match(h.node('authMessage').textContent,/has not completed/);
 pending.reject(Error('Fictional failure'));await signing;assert.equal(h.run('signOutState'),'FAILED');assert.match(h.node('authMessage').innerHTML,/Retry sign out/);assert(h.node('retrySignOutAuth').onclick);assert.equal(h.node('authButton').disabled,false);assert.equal(h.requests.length,0);
});
test('visible login-side retry calls the original signout action once after the old attempt settled',async()=>{
 const h=harness();await failAfterCallback(h);await h.node('retrySignOutAuth').onclick();assert.equal(h.signouts.length,2);assert.equal(h.reloads(),1);assert.equal(h.signins.length,0);assert.equal(h.requests.length,0);
});
test('only explicit successful signin after failed signout clears lock and loads authenticated workspace',async()=>{
 const h=harness();await failAfterCallback(h);await h.node('authButton').onclick();assert.equal(h.signins.length,1);assert.equal(h.run('signOutState'),'IDLE');assert.equal(h.requests.length,1);assert.equal(h.requests[0].action,'workspace');assert.equal(h.renders(),1);assert.equal(h.reloads(),0);
});
test('failed explicit signin leaves signout lock and never loads a workspace',async()=>{
 const h=harness();await failAfterCallback(h);h.inQueue.push({error:Error('Fictional login rejected')});await h.node('authButton').onclick();assert.equal(h.run('signOutState'),'FAILED');assert.equal(h.requests.length,0);assert.equal(h.renders(),0);assert.equal(h.node('authButton').disabled,false);assert.match(h.node('authMessage').textContent,/Fictional login rejected/);
});
test('a generic signed-in callback never unlocks a failed signout by itself',async()=>{
 const h=harness();await failAfterCallback(h);h.emit('SIGNED_IN',{user:{id:'other-owner'},access_token:'fixture-other'});await h.run('loadWorkspace()');assert.equal(h.run('signOutState'),'FAILED');assert.equal(h.requests.length,0);assert.equal(h.renders(),0);
});
for(const mode of ['signup','join'])test(mode+' during failed signout is explained and blocked before account or business writes',async()=>{
 const h=harness();await failAfterCallback(h);h.run('authMode='+JSON.stringify(mode));await h.node('authButton').onclick();assert.equal(h.signups.length,0);assert.equal(h.signins.length,0);assert.equal(h.requests.length,0);assert.match(h.node('authMessage').textContent,/choose Sign in/);assert.equal(h.run('signOutState'),'FAILED');
});
for(const mode of ['signin','signup','join'])test(mode+' submission cannot start while signout remains unresolved',async()=>{
 const h=harness(),pending=deferred();h.outQueue.push(()=>pending.promise);const signing=h.node('signOut').onclick();h.emit('SIGNED_OUT',null);h.run('authMode='+JSON.stringify(mode));await h.node('authButton').onclick();assert.equal(h.signups.length,0);assert.equal(h.signins.length,0);assert.equal(h.requests.length,0);assert.match(h.node('authMessage').textContent,/still pending/);pending.resolve({error:null});await signing;
});
test('outstanding explicit signin is single-flight and cannot overlap an SDK signout',async()=>{
 const h=harness(),pending=deferred();await failAfterCallback(h);h.inQueue.push(()=>pending.promise);const signing=h.node('authButton').onclick();await settle();await h.node('authButton').onclick();await h.node('signOut').onclick();assert.equal(h.signins.length,1);assert.equal(h.signouts.length,1);assert.equal(h.requests.length,0);assert.match(h.node('authMessage').textContent,/Authentication is still pending/);pending.resolve({error:null});await signing;assert.equal(h.requests.length,1);assert.equal(h.renders(),1);
});
