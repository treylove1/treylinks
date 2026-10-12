import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../../',import.meta.url),app=fs.readFileSync(new URL('app.js',root),'utf8');
const policy=fs.readFileSync(new URL('intake-review.js',root),'utf8'),matcher=fs.readFileSync(new URL('known-customer-matcher.js',root),'utf8');
const id=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const cust={id:id(2),company_id:id(1),name:'Jordan Sample',email:'jordan@example.invalid',contact_email_visible:true,contact_version:'reviewed-contact-version',status:'ACTIVE',aliases:[{alias:'Label Trading / Jordan Sample',alias_type:'LABEL'}]};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function observation(){const binding={id:'photo-1:paddle:1',photoId:'photo-1',photoSha256:'a'.repeat(64),rawResultSha256:'b'.repeat(64)};return {...binding,raw:{text:'SHIP TO\nJordan S\n123 Example Way\nMiami FL 33101'},proposals:{schema:'parcel-snap-label-proposals-v1',reviewOnly:true,observation:binding,blocks:[{id:'block-1',role:'DESTINATION',roleKind:'SHIP_TO',name:{value:'Jordan S',sources:[{rowId:'row-1',text:'Jordan S'}]},address:{value:'123 Example Way\nMiami FL 33101'},reasons:[],warnings:[]},{id:'return-1',role:'RETURN',name:{value:'Sender Company'},address:{value:'1 Sender Way'}}]},fields:{tracking:{value:null}}};}
function harness(){
 const nodes=new Map(),requests=[],alerts=[],revoked=[];let sequence=100,authCallback=null;
 const node=id=>{if(!nodes.has(id)){const classes=new Set();nodes.set(id,{id,value:'',textContent:'',innerHTML:'',checked:false,disabled:false,hidden:false,dataset:{},files:[],options:[],src:'',removeAttribute(key){delete this[key];},setAttribute(key,value){this[key]=value;},classList:{add(...xs){xs.forEach(x=>classes.add(x));},remove(...xs){xs.forEach(x=>classes.delete(x));},toggle(x,force){const on=force??!classes.has(x);if(on)classes.add(x);else classes.delete(x);return on;},contains:x=>classes.has(x)},querySelectorAll(){return [];},click(){this.onclick?.();}});}return nodes.get(id);};
 const ctx=vm.createContext({console,performance,setTimeout,clearTimeout,structuredClone,TextEncoder,Blob,ArrayBuffer,Uint8Array,URL:{createObjectURL:()=>`blob:fake-${sequence++}`,revokeObjectURL:url=>revoked.push(url)},crypto:{randomUUID:()=>id(sequence++)},document:{getElementById:node,querySelector:()=>({click(){}}),querySelectorAll:()=>[]},supabase:{createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:cb=>{authCallback=cb;}}})},alert:value=>alerts.push(value),confirm:()=>true,fetch(...args){requests.push(args);throw Error('Live network forbidden');},localStorage:{getItem:()=>null,removeItem(){}},location:{reload(){}},addEventListener(){}});ctx.window=ctx;
 vm.runInContext(policy,ctx);vm.runInContext(matcher,ctx);vm.runInContext(app,ctx);
 ctx.fixtureCustomer=structuredClone(cust);ctx.fixtureObservation=observation();
 // The injected workspace is newer than the anonymous boot still settling.
 vm.runInContext(`workspaceLoadGeneration++;workspace={state:'ACTIVE',company:{id:'${id(1)}',role:'OWNER'},customers:[fixtureCustomer],packages:[],facilities:[],attention:[],subscription:{status:'ACTIVE'}};workspaceActorId='${id(6)}';compressImage=async file=>'data:image/jpeg;base64,'+file.name;`,ctx);
 const reader={busy:false,opens:[],reads:0,clears:0,cancels:0,clear(){this.clears++;},cancel(){this.cancels++;},async open(file){this.opens.push(file);return {id:file.name};},async read(){this.reads++;return {observation:observation(),frameBlob:new Blob(['fictional-frame'])};}};
 ctx.fakeReader=reader;vm.runInContext('localIntakeReader=fakeReader;localIntakeReaderPromise=Promise.resolve(fakeReader)',ctx);
 const run=code=>vm.runInContext(code,ctx),select=async(name='first.jpg',gallery=false)=>{const target=node(gallery?'packagePhotoGallery':'packagePhoto');target.files=[{name,size:100,type:'image/jpeg'}];await target.onchange({target});};
 return {ctx,run,node,reader,requests,alerts,revoked,select,authCallback:()=>authCallback};
}

for(const action of ['create_customer','create_facility','create_location','add_customer_alias','create_staff_invite','save_business_profile','save_prepaid_business_profile','onboard','claim_staff_invite','unexpected_action'])test('INDEPENDENT: private API refuses '+action+' before auth/network',async()=>{
 const h=harness();h.run('sb.auth.getSession=()=>{throw Error("AUTH MUST NOT BE TOUCHED")};');await assert.rejects(h.run(`api({action:${JSON.stringify(action)}})`),/disabled/);assert.equal(h.requests.length,0);
});
test('INDEPENDENT: normal Add Customer UI handler cannot write',async()=>{
 const h=harness();h.run('sb.auth.getSession=()=>{throw Error("AUTH MUST NOT BE TOUCHED")};');h.node('newCustomerName').value='Fictional Review Customer';h.node('newCustomerEmail').value='fixture@example.invalid';await h.node('addCustomerButton').onclick();assert.equal(h.requests.length,0);assert.match(h.alerts.at(-1),/disabled/);
});
test('INDEPENDENT: replacement OCR cannot capture or keep a confirmation',async()=>{
 const h=harness();await h.select();await h.run('readLocalLabel()');h.run('chooseLocalBlock("block-1")');h.run(`chooseLocalDirectoryCustomer('${cust.id}')`);
 const wait=deferred();h.reader.read=()=>wait.promise;const pending=h.run('readLocalLabel()');await Promise.resolve();h.node('receiveLabelConfirmed').checked=true;h.node('receiveLabelConfirmed').onchange();assert.equal(h.node('receiveLabelConfirmed').checked,false);assert.equal(h.run('confirmedArrivalReviews.receive'),null);
 const next=observation();next.id='photo-1:paddle:2';next.proposals.observation={...next.proposals.observation,id:next.id};next.raw.text='SHIP TO\nDifferent Person';next.proposals.blocks[0].name.value='Different Person';wait.resolve({observation:next,frameBlob:new Blob(['new-frame'])});await pending;
 assert.equal(h.node('receiveLabelConfirmed').checked,false);assert.equal(h.run('reviewedArrivalConfirmation("receive")'),null);assert.equal(h.run('localBlockId'),null);
});
test('INDEPENDENT: saved review cannot substitute a photo underneath local source',async()=>{
 const h=harness();await h.select('local-before.jpg');await h.run('readLocalLabel()');h.run('chooseLocalBlock("block-1")');h.run(`chooseLocalDirectoryCustomer('${cust.id}')`);const photo=h.run('intakePhotoDataUrl'),source=h.run('localObservation');
 h.ctx.savedPackage={id:id(9),origin_review_pending:true,origin_facility_id:id(8)};h.run('workspace.packages=[savedPackage];api=async()=>{throw Error("SAVED REVIEW API MUST NOT RUN")};');await h.run(`resumeSavedIntake('${id(9)}')`);assert.equal(h.run('intakePhotoDataUrl'),photo);assert.equal(h.run('localObservation'),source);assert.equal(h.reader.opens.length,1);assert.match(h.node('receiveResult').textContent,/unavailable in this read-only installation/);
});
for(const gallery of [false,true])test('INDEPENDENT: transfer '+(gallery?'gallery':'camera')+' starts no decoding or legacy OCR',async()=>{
 const h=harness();let opens=0,ocr=0;h.ctx.spyOpen=()=>opens++;h.ctx.spyOcr=()=>ocr++;h.run('readFileDataUrl=spyOpen;analyzeTransferImage=spyOcr');const target=h.node(gallery?'transferPhotoGallery':'transferPhoto');target.files=[{name:'fixture.jpg',type:'image/jpeg',size:1}];await target.onchange({target});assert.equal(opens,0);assert.equal(ocr,0);assert.equal(h.requests.length,0);
});
test('INDEPENDENT: malformed cross-tenant customer never reaches local candidate or selection UI',async()=>{
 const h=harness();h.run('workspace.customers[0].company_id="other-tenant"');await h.select();await h.run('readLocalLabel()');h.run('chooseLocalBlock("block-1")');h.run(`chooseLocalDirectoryCustomer('${cust.id}')`);assert.equal(h.node('receiveCustomer').value,'');assert(!h.node('localDirectoryCandidates').innerHTML.includes(cust.email));assert(!h.node('localDirectoryCandidates').innerHTML.includes('data-directory-customer'));
});
test('INDEPENDENT: owner-to-staff role refresh removes suggestion email without replacing literal source',async()=>{
 const h=harness();await h.select();await h.run('readLocalLabel()');h.run('chooseLocalBlock("block-1")');h.run(`chooseLocalDirectoryCustomer('${cust.id}')`);h.run('workspace.company.role="STAFF";renderWorkspace()');assert(!h.node('localDirectoryCandidates').innerHTML.includes(cust.email));assert(!h.node('labelFields').textContent.includes(cust.email));assert.equal(h.run('intakeOcrName'),'Jordan S');
});
for(const action of ['workspace','review_saved_arrival','preview_business_profile'])test('INDEPENDENT: bounded read-only transport rejects '+action+' despite complete capability',async()=>{
 const h=harness();h.ctx.fixtureCap={...h.ctx.ParcelSnapIntakeReview.CONTRACT,mode:'ENABLED',schema_ready:true,company_id:id(1),actor_id:id(6),deployment_id:'parcel-snap-arrival-review-20261012-v1'};h.run('arrivalCapability=fixtureCap;sb.auth.getSession=()=>{throw Error("AUTH MUST NOT BE TOUCHED")};');await assert.rejects(h.run(`api({action:${JSON.stringify(action)}})`),/disabled/);assert.equal(h.requests.length,0);assert(Object.isFrozen(h.ctx.ParcelSnapIntakeReview.BUILD));assert.equal(h.ctx.ParcelSnapIntakeReview.BUILD.portalTransportEnabled,true);
});
