const DB_NAME="parcel-snap-owner-test";
const DB_VERSION=1;
const STORE_PACKAGES="packages";
let db;
let stagedMiamiPhotos=[];
let stagedNassauPhotos=[];

function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const d=req.result;
      if(!d.objectStoreNames.contains(STORE_PACKAGES)){
        const s=d.createObjectStore(STORE_PACKAGES,{keyPath:"id"});
        s.createIndex("tracking","tracking");
        s.createIndex("customer","customer");
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}

function txStore(mode="readonly"){return db.transaction(STORE_PACKAGES,mode).objectStore(STORE_PACKAGES)}
function putPackage(pkg){return new Promise((res,rej)=>{const r=txStore("readwrite").put(pkg);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function getPackage(id){return new Promise((res,rej)=>{const r=txStore().get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function allPackages(){return new Promise((res,rej)=>{const r=txStore().getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
function clearPackages(){return new Promise((res,rej)=>{const r=txStore("readwrite").clear();r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}

function uid(){return "PS-"+Date.now()+"-"+Math.random().toString(36).slice(2,7).toUpperCase()}
function now(){return new Date().toISOString()}
function esc(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}
function statusLabel(s){return ({MIAMI_RECEIVED:"Miami received",IN_TRANSIT:"In transit",NASSAU_RECEIVED:"Nassau received",WAREHOUSED:"Warehoused",READY_FOR_PICKUP:"Ready for pickup",OUT_FOR_DELIVERY:"Out for delivery",PICKED_UP:"Picked up",DELIVERED:"Delivered"})[s]||s}

async function filesToData(files){
  const out=[];
  for(const file of files){
    out.push(await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve({name:file.name,type:file.type,data:reader.result,at:now()});
      reader.onerror=()=>reject(reader.error);
      reader.readAsDataURL(file);
    }));
  }
  return out;
}

function previewPhotos(target,photos){
  target.innerHTML=photos.map(p=>`<img src="${p.data}" alt="Package photo">`).join("");
}

document.getElementById("loginBtn").onclick=async()=>{
  const email=document.getElementById("loginEmail").value.trim().toLowerCase();
  const pin=document.getElementById("loginPin").value.trim();
  if(email!=="owner@yourelectronicneeds.org"||pin!=="2468"){
    alert("Use the owner test login shown on this page.");
    return;
  }
  sessionStorage.setItem("parcelSnapOwnerLoggedIn","1");
  showApp();
};

document.getElementById("logoutBtn").onclick=()=>{
  sessionStorage.removeItem("parcelSnapOwnerLoggedIn");
  location.reload();
};

function showApp(){
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  renderAll();
}

document.querySelectorAll(".tab").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b===btn));
  document.querySelectorAll(".tabPanel").forEach(p=>p.classList.add("hidden"));
  document.getElementById("tab-"+btn.dataset.tab).classList.remove("hidden");
  if(btn.dataset.tab==="warehouse") renderWarehouse();
  if(btn.dataset.tab==="search") renderSearch();
});

document.getElementById("miamiPhotos").onchange=async e=>{
  stagedMiamiPhotos=await filesToData([...e.target.files]);
  previewPhotos(document.getElementById("miamiPreview"),stagedMiamiPhotos);
};

document.getElementById("nassauPhotos").onchange=async e=>{
  stagedNassauPhotos=await filesToData([...e.target.files]);
  previewPhotos(document.getElementById("nassauPreview"),stagedNassauPhotos);
};

document.getElementById("saveMiami").onclick=async()=>{
  const customer=document.getElementById("customerName").value.trim();
  const tracking=document.getElementById("trackingRef").value.trim();
  if(!customer||!tracking){alert("Enter customer name and tracking/reference.");return}
  if(!stagedMiamiPhotos.length){alert("Take at least one Miami arrival photo.");return}
  const pkg={
    id:uid(),customer,tracking,
    carrier:document.getElementById("carrier").value.trim(),
    status:"MIAMI_RECEIVED",
    miami:{location:document.getElementById("miamiLocation").value.trim(),photos:stagedMiamiPhotos,at:now()},
    nassau:null,
    warehouse:null,
    events:[{type:"MIAMI_RECEIVED",at:now(),note:"Package received in Miami"}],
    createdAt:now(),updatedAt:now()
  };
  await putPackage(pkg);
  stagedMiamiPhotos=[];
  document.getElementById("miamiPhotos").value="";
  document.getElementById("miamiPreview").innerHTML="";
  document.getElementById("customerName").value="";
  document.getElementById("trackingRef").value="";
  document.getElementById("carrier").value="";
  alert("Miami intake saved.");
  await renderAll();
};

document.getElementById("saveNassau").onclick=async()=>{
  const id=document.getElementById("nassauPackage").value;
  if(!id){alert("Select a package.");return}
  if(!stagedNassauPhotos.length){alert("Take at least one Nassau arrival photo.");return}
  const pkg=await getPackage(id);
  pkg.nassau={
    location:document.getElementById("nassauLocation").value.trim(),
    note:document.getElementById("nassauNote").value.trim(),
    photos:stagedNassauPhotos,
    at:now()
  };
  pkg.status="NASSAU_RECEIVED";
  pkg.events.push({type:"NASSAU_RECEIVED",at:now(),note:pkg.nassau.note||"Package arrived in Nassau"});
  pkg.updatedAt=now();
  await putPackage(pkg);
  stagedNassauPhotos=[];
  document.getElementById("nassauPhotos").value="";
  document.getElementById("nassauPreview").innerHTML="";
  document.getElementById("nassauNote").value="";
  alert("Nassau arrival saved.");
  await renderAll();
};

document.getElementById("saveWarehouse").onclick=async()=>{
  const id=document.getElementById("warehousePackage").value;
  if(!id){alert("Select a package.");return}
  const pkg=await getPackage(id);
  const status=document.getElementById("warehouseStatus").value;
  pkg.warehouse={
    shelf:document.getElementById("shelf").value.trim(),
    bin:document.getElementById("bin").value.trim(),
    area:document.getElementById("area").value.trim(),
    note:document.getElementById("warehouseNote").value.trim(),
    at:now()
  };
  pkg.status=status;
  pkg.events.push({type:status,at:now(),note:`Warehouse: ${pkg.warehouse.area||"-"} / Shelf ${pkg.warehouse.shelf||"-"} / Bin ${pkg.warehouse.bin||"-"}`});
  pkg.updatedAt=now();
  await putPackage(pkg);
  alert("Warehouse location/status saved.");
  await renderAll();
};

document.getElementById("searchBox").oninput=renderSearch;

function packageCard(p){
  const wh=p.warehouse||{};
  return `<article class="packageCard">
    <div class="packageTop">
      <div><strong>${esc(p.tracking)}</strong><br><small>${esc(p.customer)}</small></div>
      <span class="status">${esc(statusLabel(p.status))}</span>
    </div>
    <div class="meta">
      <div><small>Carrier</small><strong>${esc(p.carrier||"-")}</strong></div>
      <div><small>Area</small><strong>${esc(wh.area||p.nassau?.location||p.miami?.location||"-")}</strong></div>
      <div><small>Shelf / Bin</small><strong>${esc((wh.shelf||"-")+" / "+(wh.bin||"-"))}</strong></div>
    </div>
    <div class="packageActions">
      <button data-open="${p.id}">Open package</button>
    </div>
  </article>`;
}

async function bindOpenButtons(root){
  root.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>openPackage(b.dataset.open));
}

async function renderAll(){
  const pkgs=await allPackages();
  document.getElementById("totalPackages").textContent=pkgs.length;
  document.getElementById("miamiCount").textContent=pkgs.filter(p=>p.miami).length;
  document.getElementById("nassauCount").textContent=pkgs.filter(p=>p.nassau).length;
  document.getElementById("readyCount").textContent=pkgs.filter(p=>["WAREHOUSED","READY_FOR_PICKUP","PICKED_UP","DELIVERED"].includes(p.status)).length;
  populateSelects(pkgs);
  await renderWarehouse();
  await renderSearch();
}

function populateSelects(pkgs){
  const opts='<option value="">Select package</option>'+pkgs.map(p=>`<option value="${p.id}">${esc(p.tracking)} — ${esc(p.customer)}</option>`).join("");
  document.getElementById("nassauPackage").innerHTML=opts;
  document.getElementById("warehousePackage").innerHTML=opts;
}

async function renderWarehouse(){
  const pkgs=(await allPackages()).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const root=document.getElementById("warehouseList");
  root.innerHTML=pkgs.length?pkgs.map(packageCard).join(""):'<article class="card"><p>No packages yet.</p></article>';
  await bindOpenButtons(root);
}

async function renderSearch(){
  const q=document.getElementById("searchBox").value.trim().toLowerCase();
  let pkgs=await allPackages();
  if(q){
    pkgs=pkgs.filter(p=>{
      const wh=p.warehouse||{};
      return [p.customer,p.tracking,p.carrier,p.status,statusLabel(p.status),wh.shelf,wh.bin,wh.area,p.miami?.location,p.nassau?.location]
        .filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }
  pkgs.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const root=document.getElementById("searchResults");
  root.innerHTML=pkgs.length?pkgs.map(packageCard).join(""):'<article class="card"><p>No matching packages.</p></article>';
  await bindOpenButtons(root);
}

async function openPackage(id){
  const p=await getPackage(id);
  const wh=p.warehouse||{};
  const photos=[...(p.miami?.photos||[]),...(p.nassau?.photos||[])];
  document.getElementById("dialogContent").innerHTML=`
    <span class="eyebrow">PACKAGE RECORD</span>
    <h2>${esc(p.tracking)}</h2>
    <p><strong>${esc(p.customer)}</strong> · ${esc(statusLabel(p.status))}</p>
    <div class="meta">
      <div><small>Miami</small><strong>${esc(p.miami?.location||"-")}</strong></div>
      <div><small>Nassau</small><strong>${esc(p.nassau?.location||"-")}</strong></div>
      <div><small>Warehouse</small><strong>${esc((wh.area||"-")+" · "+(wh.shelf||"-")+"/"+(wh.bin||"-"))}</strong></div>
    </div>
    <h3>Photos</h3>
    <div class="packagePhotos">${photos.map(ph=>`<img src="${ph.data}" alt="Package photo">`).join("")||"<p>No photos.</p>"}</div>
    <h3>History</h3>
    <div class="timeline">${p.events.map(e=>`<div class="timelineItem"><strong>${esc(statusLabel(e.type))}</strong><br><small>${new Date(e.at).toLocaleString()}</small><div>${esc(e.note||"")}</div></div>`).join("")}</div>
  `;
  document.getElementById("packageDialog").showModal();
}

document.getElementById("closeDialog").onclick=()=>document.getElementById("packageDialog").close();
document.getElementById("resetData").onclick=async()=>{
  if(confirm("Delete all Parcel Snap test records saved in this browser/device?")){
    await clearPackages();
    await renderAll();
  }
};

(async()=>{
  db=await openDb();
  if(sessionStorage.getItem("parcelSnapOwnerLoggedIn")==="1") showApp();
})();