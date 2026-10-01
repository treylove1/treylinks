const DB_NAME="parcel-snap-owner-test";
const DB_VERSION=2;
const STORE_PACKAGES="packages";
const STORE_CUSTOMERS="customers";
let db, stagedMiamiPhotos=[], stagedNassauPhotos=[], ocrRawText="", currentDetectedName="";
const FACILITY_KEY="parcel-snap-facilities-v1";
const ACTIVE_ORIGIN_KEY="parcel-snap-active-origin";
const ACTIVE_DESTINATION_KEY="parcel-snap-active-destination";

function defaultFacilities(){
  return [
    {id:"FAC-MIA",name:"Miami Warehouse",type:"ORIGIN",city:"Miami",address:"",region:"FL",country:"USA",active:true},
    {id:"FAC-FLL",name:"Fort Lauderdale Warehouse",type:"ORIGIN",city:"Fort Lauderdale",address:"",region:"FL",country:"USA",active:true},
    {id:"FAC-ORL",name:"Orlando Warehouse",type:"ORIGIN",city:"Orlando",address:"",region:"FL",country:"USA",active:true},
    {id:"FAC-NAS",name:"Nassau Warehouse",type:"DESTINATION",city:"Nassau",address:"",region:"New Providence",country:"Bahamas",active:true}
  ];
}
function getFacilities(){
  try{
    const saved=JSON.parse(localStorage.getItem(FACILITY_KEY)||"null");
    if(Array.isArray(saved)&&saved.length)return saved;
  }catch{}
  const seed=defaultFacilities();
  localStorage.setItem(FACILITY_KEY,JSON.stringify(seed));
  return seed;
}
function saveFacilities(items){localStorage.setItem(FACILITY_KEY,JSON.stringify(items))}
function facilityById(id){return getFacilities().find(f=>f.id===id)||null}
function facilityLabel(f){return f?.city||f?.name||"Warehouse"}
function facilityAddressText(f){return f?[f.address,f.city,f.region,f.country].filter(Boolean).join(", "):""}
function getActiveOrigin(){
  const items=getFacilities().filter(f=>f.type==="ORIGIN"&&f.active!==false);
  let id=localStorage.getItem(ACTIVE_ORIGIN_KEY);
  if(!items.some(f=>f.id===id))id=items[0]?.id||"";
  if(id)localStorage.setItem(ACTIVE_ORIGIN_KEY,id);
  return facilityById(id);
}
function getActiveDestination(){
  const items=getFacilities().filter(f=>f.type==="DESTINATION"&&f.active!==false);
  let id=localStorage.getItem(ACTIVE_DESTINATION_KEY);
  if(!items.some(f=>f.id===id))id=items[0]?.id||"";
  if(id)localStorage.setItem(ACTIVE_DESTINATION_KEY,id);
  return facilityById(id);
}

function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains(STORE_PACKAGES)){const s=d.createObjectStore(STORE_PACKAGES,{keyPath:"id"});s.createIndex("tracking","tracking");s.createIndex("customer","customer")}if(!d.objectStoreNames.contains(STORE_CUSTOMERS)){const s=d.createObjectStore(STORE_CUSTOMERS,{keyPath:"id"});s.createIndex("name","name");s.createIndex("email","email",{unique:false})}};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
function store(name,mode="readonly"){return db.transaction(name,mode).objectStore(name)}
function put(name,value){return new Promise((res,rej)=>{const r=store(name,"readwrite").put(value);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function get(name,id){return new Promise((res,rej)=>{const r=store(name).get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function all(name){return new Promise((res,rej)=>{const r=store(name).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
function clear(name){return new Promise((res,rej)=>{const r=store(name,"readwrite").clear();r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function del(name,id){return new Promise((res,rej)=>{const r=store(name,"readwrite").delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function uid(prefix){return prefix+"-"+Date.now()+"-"+Math.random().toString(36).slice(2,7).toUpperCase()}
function now(){return new Date().toISOString()}
function esc(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}
function norm(s=""){return s.toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim()}
function statusLabel(s){return ({MIAMI_RECEIVED:"Miami received",NASSAU_RECEIVED:"Nassau received",WAREHOUSED:"Warehoused",READY_FOR_PICKUP:"Ready for pickup",OUT_FOR_DELIVERY:"Out for delivery",PICKED_UP:"Picked up",DELIVERED:"Delivered"})[s]||s}
async function filesToData(files){const out=[];for(const file of files){out.push(await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:file.name,type:file.type,data:reader.result,at:now()});reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)}))}return out}
function previewPhotos(target,photos){target.innerHTML=photos.map(p=>`<img src="${p.data}" alt="Package photo">`).join("")}

async function addCustomer(name,email){const cleanName=name.trim(),cleanEmail=email.trim().toLowerCase();if(!cleanName||!cleanEmail)throw new Error("Name and email required");const customers=await all(STORE_CUSTOMERS);const existing=customers.find(c=>norm(c.name)===norm(cleanName));const customer=existing?{...existing,name:cleanName,email:cleanEmail,updatedAt:now()}:{id:uid("CUST"),name:cleanName,email:cleanEmail,createdAt:now(),updatedAt:now()};await put(STORE_CUSTOMERS,customer);return customer}
function editDistance(a,b){
  a=norm(a);b=norm(b);
  const m=a.length,n=b.length,dp=Array.from({length:m+1},()=>Array(n+1).fill(0));
  for(let i=0;i<=m;i++)dp[i][0]=i;
  for(let j=0;j<=n;j++)dp[0][j]=j;
  for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return dp[m][n];
}
function tokenSimilarity(a,b){
  a=norm(a);b=norm(b);
  if(!a||!b)return 0;
  if(a===b)return 1;
  if(a.length>=4&&b.includes(a)||b.length>=4&&a.includes(b))return .92;
  const d=editDistance(a,b);
  return 1-d/Math.max(a.length,b.length);
}
function scoreNameAgainstText(name,text){
  const nameTokens=norm(name).split(" ").filter(t=>t.length>=2);
  const textTokens=norm(text).split(" ").filter(t=>t.length>=2);
  if(!nameTokens.length||!textTokens.length)return 0;
  const scores=nameTokens.map(nt=>Math.max(...textTokens.map(tt=>tokenSimilarity(nt,tt))));
  return scores.reduce((a,b)=>a+b,0)/scores.length;
}
async function bestCustomerMatch(text){
  const customers=await all(STORE_CUSTOMERS);
  const ranked=customers.map(customer=>({customer,score:scoreNameAgainstText(customer.name,text)})).sort((a,b)=>b.score-a.score);
  if(!ranked.length)return null;
  const best=ranked[0], second=ranked[1];
  const clear=best.score>=.78 && (!second || best.score-second.score>=.08);
  return clear?best:null;
}
function cleanNameCandidate(value){
  let v=String(value||"").replace(/[^A-Za-z.' -]/g," ").replace(/\s+/g," ").trim();
  const words=v.split(" ").filter(Boolean);
  if(words.length<2||words.length>5)return "";
  if(words.some(w=>w.length<2))return "";
  const bad=/electronic|needs|package|tracking|address|street|road|avenue|lane|unit|miami|nassau|bahamas|florida|warehouse|ship|shipping|code|fedex|ups|usps|amazon/i;
  if(bad.test(v))return "";
  return words.map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(" ");
}
function guessName(text){
  const raw=String(text||"").split(/\r?\n/).flatMap(line=>line.split(/[\/|]/)).map(s=>s.trim()).filter(Boolean);
  for(const part of raw){
    const c=cleanNameCandidate(part);
    if(c)return c;
  }
  return "";
}
function guessTracking(text){
  const tokens=String(text||"").match(/[A-Z0-9][A-Z0-9-]{8,35}/gi)||[];
  return tokens.find(t=>!/^(ADDRESS|PACKAGE|CUSTOMER|TRACKING|ELECTRONIC)$/i.test(t))||"";
}
async function loadImage(dataUrl){
  return await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=dataUrl});
}
async function rotateDataUrl(dataUrl,degrees){
  const img=await loadImage(dataUrl);
  const rad=degrees*Math.PI/180;
  const sin=Math.abs(Math.sin(rad)),cos=Math.abs(Math.cos(rad));
  const canvas=document.createElement("canvas");
  canvas.width=Math.ceil(img.width*cos+img.height*sin);
  canvas.height=Math.ceil(img.width*sin+img.height*cos);
  const ctx=canvas.getContext("2d");
  ctx.translate(canvas.width/2,canvas.height/2);
  ctx.rotate(rad);
  ctx.drawImage(img,-img.width/2,-img.height/2);
  return canvas.toDataURL("image/jpeg",.94);
}
async function enhanceForReading(dataUrl){
  const img=await loadImage(dataUrl);
  const scale=Math.min(3,Math.max(1.5,1800/Math.max(img.width,img.height)));
  const canvas=document.createElement("canvas");
  canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const im=ctx.getImageData(0,0,canvas.width,canvas.height),d=im.data;
  for(let i=0;i<d.length;i+=4){
    const g=.299*d[i]+.587*d[i+1]+.114*d[i+2];
    const v=Math.max(0,Math.min(255,(g-128)*1.65+145));
    d[i]=d[i+1]=d[i+2]=v;
  }
  ctx.putImageData(im,0,0);
  return canvas.toDataURL("image/jpeg",.94);
}
async function detectPackageCode(dataUrl){
  if(!("BarcodeDetector" in window))return "";
  try{
    const img=await loadImage(dataUrl);
    const detector=new BarcodeDetector({formats:["qr_code","code_128","code_39","ean_13","ean_8","upc_a","upc_e","itf","codabar"]});
    const codes=await detector.detect(img);
    const raw=(codes||[]).map(c=>String(c.rawValue||"").trim()).find(v=>v.length>=6&&v.length<=80);
    return raw||"";
  }catch{return ""}
}
async function runLabelReader(){
  const panel=document.getElementById("processingPanel");
  const title=document.getElementById("processingTitle");
  const detail=document.getElementById("processingDetail");
  panel.classList.remove("hidden");
  title.textContent="Processing package…";
  detail.textContent="";
  document.getElementById("matchPanel").classList.add("hidden");
  document.getElementById("emailResult").classList.add("hidden");
  if(!stagedMiamiPhotos.length)return;

  try{
    const original=stagedMiamiPhotos[0].data;
    let tracking=await detectPackageCode(original);
    const enhanced=await enhanceForReading(original);

    let mergedText="";
    let match=null;

    const readPass=async(source,label)=>{
      title.textContent=label;
      const result=await Tesseract.recognize(source,"eng");
      const text=result.data.text||"";
      mergedText+="\n"+text;
      const found=await bestCustomerMatch(mergedText);
      return found;
    };

    match=await readPass(enhanced,"Processing package…");

    if(!match){
      for(const angle of [-6,6,-10,10]){
        const rotated=await rotateDataUrl(enhanced,angle);
        match=await readPass(rotated,"Processing package…");
        if(!tracking) tracking=await detectPackageCode(rotated);
        if(match) break;
      }
    }

    if(!match && norm(mergedText).length<20){
      match=await readPass(original,"Processing package…");
    }

    ocrRawText=mergedText;
    currentDetectedName=match?match.customer.name:guessName(mergedText);
    if(!tracking) tracking=guessTracking(mergedText);
    document.getElementById("trackingRef").value=tracking||"";

    await populateCustomerMatch(match?.customer?.id||"",currentDetectedName);

    if(match){
      title.textContent=match.customer.name;
      detail.textContent=tracking?"Package received · tracking captured":"Package received";
    }else if(currentDetectedName){
      title.textContent=currentDetectedName;
      detail.textContent="New customer — add email once";
    }else{
      title.textContent="Select customer";
      detail.textContent="Package photo saved";
    }

    document.getElementById("matchPanel").classList.remove("hidden");
  }catch(err){
    currentDetectedName="";
    await populateCustomerMatch("","");
    title.textContent="Select customer";
    detail.textContent="Package photo saved";
    document.getElementById("matchPanel").classList.remove("hidden");
  }
}
async function populateCustomerMatch(selectedId="",suggestedName=""){const customers=await all(STORE_CUSTOMERS),sel=document.getElementById("matchedCustomer");sel.innerHTML='<option value="">New / unknown customer</option>'+customers.map(c=>`<option value="${c.id}" ${selectedId===c.id?"selected":""}>${esc(c.name)} — ${esc(c.email)}</option>`).join("");document.getElementById("newCustomerName").value=suggestedName||"";toggleNewCustomerFields()}
function toggleNewCustomerFields(){document.getElementById("newCustomerFields").classList.toggle("hidden",!!document.getElementById("matchedCustomer").value)}
document.getElementById("matchedCustomer").onchange=toggleNewCustomerFields;
document.getElementById("saveNewCustomer").onclick=async()=>{try{const c=await addCustomer(document.getElementById("newCustomerName").value,document.getElementById("newCustomerEmail").value);await populateCustomerMatch(c.id,c.name);await renderAll();alert("Customer saved. Parcel Snap can match this name next time.")}catch(e){alert(e.message)}};

async function buildNotification(customer,pkg){return{to:customer.email,subject:"Parcel Snap: Your package arrived in Miami",body:`Hello ${customer.name},\n\nYour package has arrived at our Miami location and has been logged in Parcel Snap.\n\nReference: ${pkg.tracking||"No tracking number required"}\n\nWe will update the package record as it moves to Nassau.\n\nYour Electronic Needs / Alpha Omega Shipping`}}
async function showPreparedEmail(customer,pkg){const n=await buildNotification(customer,pkg),result=document.getElementById("emailResult");result.classList.remove("hidden");result.innerHTML=`<strong>Notification prepared for ${esc(n.to)}</strong><p>${esc(n.subject)}</p><p>Automatic server-side email is not connected in this static test build yet. Tap below to open the prepared message in your mail app.</p><a class="mailButton" href="mailto:${encodeURIComponent(n.to)}?subject=${encodeURIComponent(n.subject)}&body=${encodeURIComponent(n.body)}">Open prepared email</a>`;return n}

document.getElementById("loginBtn").onclick=async()=>{const email=document.getElementById("loginEmail").value.trim().toLowerCase(),pin=document.getElementById("loginPin").value.trim();if(email!=="owner@yourelectronicneeds.org"||pin!=="2468"){alert("Use the owner test login shown on this page.");return}sessionStorage.setItem("parcelSnapOwnerLoggedIn","1");showApp()};
document.getElementById("logoutBtn").onclick=()=>{sessionStorage.removeItem("parcelSnapOwnerLoggedIn");location.reload()};
function showApp(){document.getElementById("loginScreen").classList.add("hidden");document.getElementById("app").classList.remove("hidden");renderAll()}
document.querySelectorAll(".tab").forEach(btn=>btn.onclick=()=>{document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b===btn));document.querySelectorAll(".tabPanel").forEach(p=>p.classList.add("hidden"));document.getElementById("tab-"+btn.dataset.tab).classList.remove("hidden");if(btn.dataset.tab==="warehouse")renderWarehouse();if(btn.dataset.tab==="customers")renderCustomers();if(btn.dataset.tab==="search")renderSearch()});
document.getElementById("miamiPhotos").onchange=async e=>{stagedMiamiPhotos=await filesToData([...e.target.files]);previewPhotos(document.getElementById("miamiPreview"),stagedMiamiPhotos);if(stagedMiamiPhotos.length)await runLabelReader()};
document.getElementById("nassauPhotos").onchange=async e=>{stagedNassauPhotos=await filesToData([...e.target.files]);previewPhotos(document.getElementById("nassauPreview"),stagedNassauPhotos)};

document.getElementById("saveMiami").onclick=async()=>{if(!stagedMiamiPhotos.length){alert("Take at least one Miami package photo.");return}let customerId=document.getElementById("matchedCustomer").value,customer;if(!customerId){const name=document.getElementById("newCustomerName").value.trim(),email=document.getElementById("newCustomerEmail").value.trim();if(!name||!email){alert("Confirm the customer name and enter the email once.");return}customer=await addCustomer(name,email);customerId=customer.id}else customer=await get(STORE_CUSTOMERS,customerId);const pkg={id:uid("PS"),customerId:customer.id,customer:customer.name,customerEmail:customer.email,tracking:document.getElementById("trackingRef").value.trim(),carrier:document.getElementById("carrier").value.trim(),status:"MIAMI_RECEIVED",miami:{location:"Miami Receiving",photos:stagedMiamiPhotos,ocrText:ocrRawText,at:now()},nassau:null,warehouse:null,notifications:[],events:[{type:"MIAMI_RECEIVED",at:now(),note:"Package photographed and received in Miami"}],createdAt:now(),updatedAt:now()};const notice=await buildNotification(customer,pkg);pkg.notifications.push({...notice,status:"PREPARED",at:now()});await put(STORE_PACKAGES,pkg);await showPreparedEmail(customer,pkg);stagedMiamiPhotos=[];ocrRawText="";currentDetectedName="";document.getElementById("miamiPhotos").value="";document.getElementById("miamiPreview").innerHTML="";document.getElementById("processingPanel").classList.add("hidden");document.getElementById("matchPanel").classList.add("hidden");document.getElementById("trackingRef").value="";document.getElementById("carrier").value="";await renderAll()};

document.getElementById("saveNassau").onclick=async()=>{const id=document.getElementById("nassauPackage").value;if(!id){alert("Select a package.");return}if(!stagedNassauPhotos.length){alert("Take at least one Nassau arrival photo.");return}const pkg=await get(STORE_PACKAGES,id);pkg.nassau={location:document.getElementById("nassauLocation").value.trim(),note:document.getElementById("nassauNote").value.trim(),photos:stagedNassauPhotos,at:now()};pkg.status="NASSAU_RECEIVED";pkg.events.push({type:"NASSAU_RECEIVED",at:now(),note:pkg.nassau.note||"Package arrived in Nassau"});pkg.updatedAt=now();await put(STORE_PACKAGES,pkg);stagedNassauPhotos=[];document.getElementById("nassauPhotos").value="";document.getElementById("nassauPreview").innerHTML="";document.getElementById("nassauNote").value="";alert("Nassau arrival saved.");await renderAll()};
document.getElementById("saveWarehouse").onclick=async()=>{const id=document.getElementById("warehousePackage").value;if(!id){alert("Select a package.");return}const pkg=await get(STORE_PACKAGES,id),status=document.getElementById("warehouseStatus").value;pkg.warehouse={shelf:document.getElementById("shelf").value.trim(),bin:document.getElementById("bin").value.trim(),area:document.getElementById("area").value.trim(),note:document.getElementById("warehouseNote").value.trim(),at:now()};pkg.status=status;pkg.events.push({type:status,at:now(),note:`Warehouse: ${pkg.warehouse.area||"-"} / Shelf ${pkg.warehouse.shelf||"-"} / Bin ${pkg.warehouse.bin||"-"}`});pkg.updatedAt=now();await put(STORE_PACKAGES,pkg);alert("Warehouse location/status saved.");await renderAll()};
document.getElementById("addDirectoryCustomer").onclick=async()=>{try{await addCustomer(document.getElementById("directoryName").value,document.getElementById("directoryEmail").value);document.getElementById("directoryName").value="";document.getElementById("directoryEmail").value="";await renderAll()}catch(e){alert(e.message)}};
document.getElementById("searchBox").oninput=renderSearch;

function packageCard(p){const wh=p.warehouse||{};return `<article class="packageCard"><div class="packageTop"><div><strong>${esc(p.customer)}</strong><br><small>${esc(p.tracking||"No tracking number")}</small></div><span class="status">${esc(statusLabel(p.status))}</span></div><div class="meta"><div><small>Email</small><strong>${esc(p.customerEmail||"-")}</strong></div><div><small>Area</small><strong>${esc(wh.area||p.nassau?.location||p.miami?.location||"-")}</strong></div><div><small>Shelf / Bin</small><strong>${esc((wh.shelf||"-")+" / "+(wh.bin||"-"))}</strong></div></div><div class="packageActions"><button data-open="${p.id}">Open package</button></div></article>`}
async function bindOpenButtons(root){root.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>openPackage(b.dataset.open))}
async function renderAll(){const [pkgs,customers]=await Promise.all([all(STORE_PACKAGES),all(STORE_CUSTOMERS)]);document.getElementById("customerCount").textContent=customers.length;document.getElementById("totalPackages").textContent=pkgs.length;document.getElementById("miamiCount").textContent=pkgs.filter(p=>p.miami).length;document.getElementById("nassauCount").textContent=pkgs.filter(p=>p.nassau).length;populatePackageSelects(pkgs);await populateCustomerMatch(document.getElementById("matchedCustomer")?.value||"",currentDetectedName);await renderWarehouse();await renderCustomers();await renderSearch()}
function populatePackageSelects(pkgs){const opts='<option value="">Select package</option>'+pkgs.map(p=>`<option value="${p.id}">${esc(p.customer)} — ${esc(p.tracking||"No tracking")}</option>`).join("");document.getElementById("nassauPackage").innerHTML=opts;document.getElementById("warehousePackage").innerHTML=opts}
async function renderWarehouse(){const pkgs=(await all(STORE_PACKAGES)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),root=document.getElementById("warehouseList");root.innerHTML=pkgs.length?pkgs.map(packageCard).join(""):'<article class="card"><p>No packages yet.</p></article>';await bindOpenButtons(root)}
async function renderCustomers(){const customers=(await all(STORE_CUSTOMERS)).sort((a,b)=>a.name.localeCompare(b.name)),root=document.getElementById("customerList");root.innerHTML=customers.length?customers.map(c=>`<article class="packageCard"><div class="packageTop"><div><strong>${esc(c.name)}</strong><br><small>${esc(c.email)}</small></div><button class="danger" data-delcustomer="${c.id}">Delete</button></div></article>`).join(""):'<article class="card"><p>No customers yet. Add Trevon Humes or another test customer once, then photograph a label with that name.</p></article>';root.querySelectorAll("[data-delcustomer]").forEach(b=>b.onclick=async()=>{if(confirm("Delete this test customer?")){await del(STORE_CUSTOMERS,b.dataset.delcustomer);await renderAll()}})}
async function renderSearch(){const q=document.getElementById("searchBox").value.trim().toLowerCase();let pkgs=await all(STORE_PACKAGES);if(q)pkgs=pkgs.filter(p=>{const wh=p.warehouse||{};return[p.customer,p.customerEmail,p.tracking,p.carrier,p.status,statusLabel(p.status),wh.shelf,wh.bin,wh.area,p.miami?.location,p.nassau?.location].filter(Boolean).join(" ").toLowerCase().includes(q)});pkgs.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));const root=document.getElementById("searchResults");root.innerHTML=pkgs.length?pkgs.map(packageCard).join(""):'<article class="card"><p>No matching packages.</p></article>';await bindOpenButtons(root)}
async function openPackage(id){const p=await get(STORE_PACKAGES,id),wh=p.warehouse||{},photos=[...(p.miami?.photos||[]),...(p.nassau?.photos||[])],notifications=p.notifications||[];document.getElementById("dialogContent").innerHTML=`<span class="eyebrow">PACKAGE RECORD</span><h2>${esc(p.customer)}</h2><p>${esc(p.tracking||"No tracking number required")} · ${esc(statusLabel(p.status))}</p><div class="meta"><div><small>Email</small><strong>${esc(p.customerEmail||"-")}</strong></div><div><small>Nassau</small><strong>${esc(p.nassau?.location||"-")}</strong></div><div><small>Warehouse</small><strong>${esc((wh.area||"-")+" · "+(wh.shelf||"-")+"/"+(wh.bin||"-"))}</strong></div></div><h3>Photos</h3><div class="packagePhotos">${photos.map(ph=>`<img src="${ph.data}" alt="Package photo">`).join("")||"<p>No photos.</p>"}</div><h3>Notifications</h3><div class="timeline">${notifications.map(n=>`<div class="timelineItem"><strong>${esc(n.status)}</strong><br><small>${new Date(n.at).toLocaleString()}</small><div>${esc(n.to)} — ${esc(n.subject)}</div></div>`).join("")||"<p>No notifications.</p>"}</div><h3>History</h3><div class="timeline">${p.events.map(e=>`<div class="timelineItem"><strong>${esc(statusLabel(e.type))}</strong><br><small>${new Date(e.at).toLocaleString()}</small><div>${esc(e.note||"")}</div></div>`).join("")}</div>`;document.getElementById("packageDialog").showModal()}
document.getElementById("closeDialog").onclick=()=>document.getElementById("packageDialog").close();
document.getElementById("resetData").onclick=async()=>{if(confirm("Delete all Parcel Snap test customers and package records saved in this browser/device?")){await clear(STORE_PACKAGES);await clear(STORE_CUSTOMERS);await renderAll()}};
(async()=>{db=await openDb();if(sessionStorage.getItem("parcelSnapOwnerLoggedIn")==="1")showApp()})();