const SUPABASE_URL="https://evjoitqnogmpedrulepv.supabase.co";
const SUPABASE_KEY="sb_publishable_wv2cDeErfEorwoGCLl9rMA_yo01I01X";
const PORTAL_API=SUPABASE_URL+"/functions/v1/parcel-snap-portal";

const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
let authMode="signin";
let workspace=null;
let intakePhotoDataUrl=null;
let intakeOcrText="";
let intakeOcrName="";
let intakeOcrAddress="";

const $=id=>document.getElementById(id);
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}

function normText(s=""){return String(s).toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim()}
function editDistance(a,b){a=normText(a);b=normText(b);const m=a.length,n=b.length,dp=Array.from({length:m+1},()=>Array(n+1).fill(0));for(let i=0;i<=m;i++)dp[i][0]=i;for(let j=0;j<=n;j++)dp[0][j]=j;for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return dp[m][n]}
function tokenSimilarity(a,b){a=normText(a);b=normText(b);if(!a||!b)return 0;if(a===b)return 1;if((a.length>=4&&b.includes(a))||(b.length>=4&&a.includes(b)))return .92;return 1-editDistance(a,b)/Math.max(a.length,b.length)}
function extractNameCandidate(text){
  const raw=String(text||"").replace(/\r/g,"");
  const lines=raw.split("\n").map(x=>x.trim()).filter(Boolean);

  const cleanCandidate=value=>{
    let v=String(value||"")
      .replace(/[\\|]+/g," ")
      .replace(/[^A-Za-z.' -]/g," ")
      .replace(/\s+/g," ")
      .trim();
    v=v.replace(/^(customer|recipient|consignee)\s*[:\-]?\s*/i,"");
    if(!v)return "";
    const words=v.split(" ").filter(Boolean);
    if(words.length<1||words.length>5)return "";
    if(/return address|tracking|package|order reference|partner order|in hand date|street|road|avenue|lane|unit|warehouse|hialeah|sweetwater|florida|bahamas/i.test(v))return "";
    return words.map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(" ");
  };

  for(const line of lines){
    const slash=line.match(/(?:electr[o0]nic\s+needs|your\s+electr[o0]nic\s+needs|yen)\s*[\\/|:\-]+\s*(.+)$/i);
    if(slash){
      const candidate=cleanCandidate(slash[1]);
      if(candidate)return candidate;
    }
  }

  for(const line of lines){
    const idx=line.toLowerCase().indexOf("needs");
    if(idx>=0){
      const tail=line.slice(idx+5).replace(/^[\\/|:\-\s]+/,"");
      const candidate=cleanCandidate(tail);
      if(candidate)return candidate;
    }
  }

  for(let i=1;i<lines.length;i++){
    if(/^\s*\d{3,6}\s+/.test(lines[i]) || /\b(?:NW|NE|SW|SE)\b.*\b(?:AVE|AVENUE|ST|STREET|RD|ROAD|BLVD|DR|LANE|LN)\b/i.test(lines[i])){
      const previous=lines[i-1].replace(/^.*?[\\/|]\s*/,"");
      const candidate=cleanCandidate(previous);
      if(candidate)return candidate;
    }
  }

  const bad=/tracking|ship|address|street|road|avenue|lane|unit|miami|nassau|bahamas|florida|warehouse|fedex|ups|usps|amazon|package|weight|return|order|reference|roadie/i;
  for(const line of lines){
    const candidate=cleanCandidate(line);
    if(candidate&&!bad.test(candidate)&&candidate.split(" ").length>=2)return candidate;
  }
  return "";
}

function candidateScore(name,candidate){
  const nameCompact=normText(name).replace(/ /g,"");
  const candidateCompact=normText(candidate).replace(/ /g,"");
  if(!nameCompact||!candidateCompact)return 0;
  if(nameCompact===candidateCompact)return 1;
  if(candidateCompact.length>=6&&(nameCompact.startsWith(candidateCompact)||candidateCompact.startsWith(nameCompact)))return .96;
  if(candidateCompact.length>=6&&nameCompact.includes(candidateCompact))return .94;
  return 1-editDistance(nameCompact,candidateCompact)/Math.max(nameCompact.length,candidateCompact.length);
}

function scoreName(name,text){
  const candidate=extractNameCandidate(text);
  const candidateBased=candidate?candidateScore(name,candidate):0;
  const nts=normText(name).split(" ").filter(x=>x.length>=2);
  const tts=normText(text).split(" ").filter(x=>x.length>=2);
  if(!nts.length||!tts.length)return candidateBased;
  const tokenBased=nts.map(n=>Math.max(...tts.map(t=>tokenSimilarity(n,t)))).reduce((a,b)=>a+b,0)/nts.length;
  return Math.max(candidateBased,tokenBased);
}

function bestCustomerFromText(text){
  if(!workspace?.customers?.length)return null;
  const ranked=workspace.customers
    .map(customer=>({customer,score:scoreName(customer.name,text)}))
    .sort((a,b)=>b.score-a.score);
  const best=ranked[0],second=ranked[1];
  if(!best)return null;
  const clear=best.score>=.78&&(!second||best.score-second.score>=.06);
  return clear?best:null;
}

function guessTracking(text){
  const raw=String(text||"");
  const anchored=raw.match(/PACKAGE\s+TRACKING\s+CODE[\s\S]{0,120}?([A-Z0-9][A-Z0-9-]{7,40})/i);
  if(anchored?.[1])return anchored[1];
  const tokens=raw.match(/[A-Z0-9][A-Z0-9-]{8,35}/gi)||[];
  return tokens.find(t=>!/^(ADDRESS|PACKAGE|CUSTOMER|TRACKING|ELECTRONIC|REFERENCE)$/i.test(t))||"";
}

function guessCarrier(text){
  const t=String(text||"").toUpperCase();
  if(t.includes("ROADIE"))return "Roadie";
  if(t.includes("FEDEX"))return "FedEx";
  if(t.includes("USPS")||t.includes("UNITED STATES POSTAL"))return "USPS";
  if(/\bUPS\b/.test(t))return "UPS";
  if(t.includes("AMAZON"))return "Amazon";
  return "";
}

function guessRecipientAddress(text){
  const lines=String(text||"").replace(/\r/g,"").split("\n").map(x=>x.trim()).filter(Boolean);
  const nameCandidate=extractNameCandidate(text);
  let start=-1;

  if(nameCandidate){
    const target=normText(nameCandidate).replace(/ /g,"");
    for(let i=0;i<lines.length;i++){
      const compact=normText(lines[i]).replace(/ /g,"");
      if(compact.includes(target.slice(0,Math.min(target.length,7)))){start=i+1;break}
    }
  }

  if(start<0){
    for(let i=0;i<lines.length;i++){
      if(/^\d{3,6}\s+/.test(lines[i])&&/\b(?:AVE|AVENUE|ST|STREET|RD|ROAD|BLVD|DR|LANE|LN|HWY)\b/i.test(lines[i])){
        start=i;
        break;
      }
    }
  }

  if(start<0)return "";
  const collected=[];
  for(let i=start;i<Math.min(lines.length,start+3);i++){
    if(/order reference|partner order|in hand date|tracking code/i.test(lines[i]))break;
    collected.push(lines[i]);
  }
  return collected.join(", ");
}

async function loadImage(dataUrl){
  return await new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=reject;
    img.src=dataUrl;
  });
}

async function readFileDataUrl(file){
  return await new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(String(r.result));
    r.onerror=()=>reject(r.error);
    r.readAsDataURL(file);
  });
}

async function resizeDataUrl(original,maxDimension,quality){
  const img=await loadImage(original);
  const scale=Math.min(1,maxDimension/Math.max(img.width,img.height));
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(img.width*scale));
  canvas.height=Math.max(1,Math.round(img.height*scale));
  const ctx=canvas.getContext("2d");
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  return canvas.toDataURL("image/jpeg",quality);
}

async function compressImage(file){
  const original=await readFileDataUrl(file);
  return await resizeDataUrl(original,1600,.82);
}

async function prepareOcrImage(file){
  const original=await readFileDataUrl(file);
  return await resizeDataUrl(original,2800,.96);
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
  const scale=Math.min(2,Math.max(1,2200/Math.max(img.width,img.height)));
  const canvas=document.createElement("canvas");
  canvas.width=Math.round(img.width*scale);
  canvas.height=Math.round(img.height*scale);
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const im=ctx.getImageData(0,0,canvas.width,canvas.height),d=im.data;
  for(let i=0;i<d.length;i+=4){
    const g=.299*d[i]+.587*d[i+1]+.114*d[i+2];
    const v=Math.max(0,Math.min(255,(g-128)*1.7+150));
    d[i]=d[i+1]=d[i+2]=v;
  }
  ctx.putImageData(im,0,0);
  return canvas.toDataURL("image/jpeg",.95);
}

async function detectBarcode(dataUrl){
  if(!("BarcodeDetector" in window))return "";
  try{
    const img=await loadImage(dataUrl);
    const detector=new BarcodeDetector({formats:["qr_code","code_128","code_39","ean_13","ean_8","upc_a","upc_e","itf","codabar"]});
    const codes=await detector.detect(img);
    return (codes||[]).map(x=>String(x.rawValue||"").trim()).find(v=>v.length>=6&&v.length<=80)||"";
  }catch{return ""}
}

function showInlineCustomer(candidate=""){
  $("receiveNewCustomer").classList.remove("hidden");
  if(candidate&&!$("receiveNewCustomerName").value)$("receiveNewCustomerName").value=candidate;
}

function hideInlineCustomer(){
  $("receiveNewCustomer").classList.add("hidden");
}

async function readPackagePhoto(dataUrl){
  const processing=$("processingBox");
  $("processingText").textContent="Processing package…";
  $("processingDetail").textContent="";
  processing.classList.remove("hidden");

  let merged="",match=null,tracking=await detectBarcode(dataUrl);
  const enhanced=await enhanceForReading(dataUrl);
  const passes=[enhanced];

  for(const angle of [-5,5,-9,9]){
    passes.push(await rotateDataUrl(enhanced,angle));
  }

  for(const source of passes){
    const result=await Tesseract.recognize(source,"eng");
    merged+="\n"+(result.data.text||"");
    match=bestCustomerFromText(merged);
    const candidate=extractNameCandidate(merged);
    if(match||candidate)break;
  }

  if(!match){
    const originalResult=await Tesseract.recognize(dataUrl,"eng");
    merged+="\n"+(originalResult.data.text||"");
    match=bestCustomerFromText(merged);
  }

  intakeOcrText=merged;
  const candidate=extractNameCandidate(merged);
  intakeOcrName=match?.customer?.name||candidate||"";

  if(!tracking)tracking=guessTracking(merged);
  $("receiveTracking").value=tracking||"";

  const carrier=guessCarrier(merged);
  if(carrier&&!$("receiveCarrier").value)$("receiveCarrier").value=carrier;

  if(match){
    $("receiveCustomer").value=match.customer.id;
    hideInlineCustomer();
    $("processingText").textContent=match.customer.name;
    $("processingDetail").textContent=tracking?"Customer matched · tracking captured":"Customer matched";
  }else{
    $("receiveCustomer").value="";
    showInlineCustomer(intakeOcrName);
    $("processingText").textContent=intakeOcrName||"New / unmatched customer";
    $("processingDetail").textContent=tracking
      ?"Enter email once · tracking captured"
      :"Enter customer email once";
  }

  return {
    match,
    tracking,
    candidate:intakeOcrName,
    carrier,
    address:guessRecipientAddress(merged)
  };
}

function setMode(mode){
  authMode=mode;
  $("signInMode").classList.toggle("active",mode==="signin");
  $("signUpMode").classList.toggle("active",mode==="signup");
  $("joinStaffMode").classList.toggle("active",mode==="join");
  $("signupCompanyWrap").classList.toggle("hidden",mode!=="signup");
  $("staffInviteWrap").classList.toggle("hidden",mode!=="join");
  $("authButton").textContent=mode==="signin"?"Sign in":mode==="signup"?"Create company account":"Create staff account";
  $("password").autocomplete=mode==="signin"?"current-password":"new-password";
  $("authMessage").textContent="";
}
$("signInMode").onclick=()=>setMode("signin");
$("signUpMode").onclick=()=>setMode("signup");
$("joinStaffMode").onclick=()=>setMode("join");

async function api(body){
  const {data:{session}}=await sb.auth.getSession();
  if(!session)throw new Error("Please sign in again.");
  const r=await fetch(PORTAL_API,{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization":"Bearer "+session.access_token,
      "apikey":SUPABASE_KEY
    },
    body:JSON.stringify(body)
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||"Portal request failed.");
  return data;
}

$("authButton").onclick=async()=>{
  const email=$("email").value.trim();
  const password=$("password").value;
  $("authMessage").textContent="";
  try{
    if(authMode==="signin"){
      const {error}=await sb.auth.signInWithPassword({email,password});
      if(error)throw error;
    }else if(authMode==="signup"){
      const company_name=$("signupCompany").value.trim();
      if(!company_name)throw new Error("Enter your company name.");
      const {data,error}=await sb.auth.signUp({email,password});
      if(error)throw error;
      if(!data.session){
        $("authMessage").textContent="Account created. Check your email to confirm it, then sign in.";
        return;
      }
      await api({action:"onboard",company_name});
    }else{
      const inviteCode=$("staffInviteCode").value.trim().toUpperCase();
      if(!inviteCode)throw new Error("Enter the staff invite code.");
      localStorage.setItem("parcel-snap-pending-invite",inviteCode);
      const {data,error}=await sb.auth.signUp({email,password});
      if(error)throw error;
      if(!data.session){
        $("authMessage").textContent="Account created. Confirm your email, then sign in. Your staff code is saved on this device.";
        return;
      }
      await api({action:"claim_staff_invite",code:inviteCode});
      localStorage.removeItem("parcel-snap-pending-invite");
    }
    await boot();
  }catch(e){
    $("authMessage").textContent=e.message||String(e);
  }
};

$("signOut").onclick=async()=>{await sb.auth.signOut();location.reload()};

async function boot(){
  const {data:{session}}=await sb.auth.getSession();
  if(!session){
    $("authView").classList.remove("hidden");
    $("appView").classList.add("hidden");
    return;
  }
  $("authView").classList.add("hidden");
  $("appView").classList.remove("hidden");

  const pendingInvite=localStorage.getItem("parcel-snap-pending-invite");
  if(pendingInvite){
    try{
      await api({action:"claim_staff_invite",code:pendingInvite});
      localStorage.removeItem("parcel-snap-pending-invite");
    }catch(e){
      console.warn("Pending staff invite could not be claimed:",e);
    }
  }

  await loadWorkspace();
}

function showOnly(id){
  ["loadingState","onboardingState","billingState","activeWorkspace"].forEach(x=>$(x).classList.add("hidden"));
  $(id).classList.remove("hidden");
}

async function loadWorkspace(){
  showOnly("loadingState");
  try{
    workspace=await api({action:"workspace"});
    if(workspace.state==="NO_COMPANY"){
      showOnly("onboardingState");
      if(workspace.onboarding?.company_name)$("onboardingCompany").value=workspace.onboarding.company_name;
      return;
    }
    if(workspace.state==="PAYMENT_REQUIRED"){
      showOnly("billingState");
      $("companyTitle").textContent=workspace.company?.name||"Parcel Snap";
      $("companyMeta").textContent=workspace.company?.role?"Role: "+workspace.company.role:"";
      $("billingStatus").textContent="Status: "+(workspace.subscription?.status||"Payment required");
      $("payLink").href=workspace.payment_link;
      return;
    }
    if(workspace.state==="ACTIVE"){
      renderWorkspace();
      showOnly("activeWorkspace");
      return;
    }
    throw new Error("Unknown workspace state.");
  }catch(e){
    $("loadingState").innerHTML="<h2>Workspace unavailable</h2><p>"+esc(e.message||String(e))+"</p>";
  }
}

$("saveOnboarding").onclick=async()=>{
  const company_name=$("onboardingCompany").value.trim();
  if(!company_name)return;
  try{
    const r=await api({action:"onboard",company_name});
    workspace=r;
    showOnly("billingState");
    $("companyTitle").textContent=r.company_name||company_name;
    $("billingStatus").textContent="Payment required";
    $("payLink").href=r.payment_link;
  }catch(e){alert(e.message)}
};
$("recheckAccess").onclick=loadWorkspace;

function renderWorkspace(){
  $("companyTitle").textContent=workspace.company.name;
  $("companyMeta").textContent=workspace.company.role+" · "+workspace.subscription.status;
  $("packageCount").textContent=workspace.packages.length;
  $("customerCount").textContent=workspace.customers.length;
  $("facilityCount").textContent=workspace.facilities.length;
  $("attentionCount").textContent=workspace.attention.length;
  renderAttention();
  renderPackages("");
  renderCustomers();
  renderFacilities();
  renderReceiveControls();
  renderStaffControls();
  $("subscriptionCard").innerHTML="<div class='billingBox'><strong>ParcelSnap Business Subscription</strong><span>"+esc(workspace.subscription.status)+"</span><small>"+(workspace.subscription.current_period_end?"Current period ends "+new Date(workspace.subscription.current_period_end).toLocaleDateString():"Active access")+"</small></div>";
}

function renderAttention(){
  const root=$("attentionList");
  if(!workspace.attention.length){root.innerHTML="<div class='empty'>Nothing needs attention right now.</div>";return}
  root.innerHTML=workspace.attention.map(x=>"<div class='item'><div class='itemTop'><div><strong>"+esc(x.customer_name||x.tracking_number||"Package")+"</strong><br><small>"+esc(x.tracking_number||"No tracking")+"</small></div><span class='status warn'>"+esc(x.action_needed)+"</span></div><div class='meta'><div><small>Status</small><strong>"+esc(x.stage)+"</strong></div><div><small>Suggested location</small><strong>"+esc(x.suggested_location_code||"-")+"</strong></div><div><small>Storage fee</small><strong>$"+Number(x.storage_fee||0).toFixed(2)+"</strong></div></div></div>").join("");
}

function renderPackages(q){
  q=String(q||"").toLowerCase();
  const rows=workspace.packages.filter(p=>[p.customer_name,p.tracking_number,p.location_code,p.stage].filter(Boolean).join(" ").toLowerCase().includes(q));
  $("packageList").innerHTML=rows.length?rows.map(p=>"<div class='item'><div class='itemTop'><div><strong>"+esc(p.customer_name||"Unmatched customer")+"</strong><br><small>"+esc(p.tracking_number||"No tracking number")+"</small></div><span class='status'>"+esc(p.stage)+"</span></div><div class='meta'><div><small>Payment</small><strong>"+esc(p.payment_status)+"</strong></div><div><small>Location</small><strong>"+esc(p.location_code||"-")+"</strong></div><div><small>Updated</small><strong>"+new Date(p.updated_at).toLocaleDateString()+"</strong></div></div></div>").join(""):"<div class='empty'>No packages found.</div>";
}
$("packageSearch").oninput=e=>renderPackages(e.target.value);

function renderCustomers(){
  $("customerList").innerHTML=workspace.customers.length?workspace.customers.map(c=>"<div class='item'><strong>"+esc(c.name)+"</strong><br><small>"+esc(c.email||"No email")+" · "+esc(c.phone||"No phone")+"</small></div>").join(""):"<div class='empty'>No customers yet.</div>";
}
function renderFacilities(){
  $("facilityList").innerHTML=workspace.facilities.length?workspace.facilities.map(f=>"<div class='item'><div class='itemTop'><div><strong>"+esc(f.name)+"</strong><br><small>"+esc([f.address_line1,f.city,f.region,f.country].filter(Boolean).join(", ")||"Address not set")+"</small></div><span class='status'>"+esc(f.facility_type)+"</span></div></div>").join(""):"<div class='empty'>No warehouse profiles yet.</div>";
}

function renderStaffControls(){
  const role=workspace?.company?.role||"";
  const canManageStaff=["OWNER","MANAGER"].includes(role);

  $("staffTabButton").classList.toggle("hidden",!canManageStaff);
  $("billingTabButton").classList.toggle("hidden",role!=="OWNER");

  if(!canManageStaff)return;

  $("staffFacilityChoices").innerHTML=(workspace.facilities||[]).map(f=>
    '<label class="facilityChoice"><input type="checkbox" value="'+f.id+'"><span>'+esc(f.name)+'</span></label>'
  ).join("")||"<div class='empty'>Add a warehouse before creating warehouse-worker access.</div>";

  $("staffList").innerHTML=(workspace.staff||[]).length
    ? workspace.staff.map(s=>"<div class='item'><div class='itemTop'><div><strong>"+esc(s.email||"Staff account")+"</strong><br><small>"+esc(s.role)+"</small></div><span class='status'>"+(s.active?"ACTIVE":"INACTIVE")+"</span></div></div>").join("")
    : "<div class='empty'>No staff accounts yet.</div>";

  $("pendingInviteList").innerHTML=(workspace.pending_invites||[]).length
    ? workspace.pending_invites.map(i=>"<div class='item'><strong>"+esc(i.email||"Unassigned email")+"</strong><br><small>"+esc(i.role)+" · expires "+new Date(i.expires_at).toLocaleDateString()+"</small></div>").join("")
    : "<div class='empty'>No pending invite codes.</div>";
}

$("createStaffInviteButton").onclick=async()=>{
  const role=$("staffRole").value;
  const facility_ids=[...$("staffFacilityChoices").querySelectorAll('input[type="checkbox"]:checked')].map(x=>x.value);
  const email=$("staffEmail").value.trim();

  $("staffInviteResult").classList.add("hidden");
  try{
    const r=await api({action:"create_staff_invite",email,role,facility_ids});
    $("staffInviteResult").innerHTML="<strong>One-time staff code</strong><span class='inviteCode'>"+esc(r.invite.code)+"</span><small>"+esc(r.invite.role)+" · expires "+new Date(r.invite.expires_at).toLocaleString()+"</small>";
    $("staffInviteResult").classList.remove("hidden");
    $("staffEmail").value="";
    await loadWorkspace();
    document.querySelector('[data-tab="staff"]').click();
  }catch(e){
    alert(e.message||String(e));
  }
};

function facilitySort(items){
  const order={MIA:1,FLL:2,ORL:3,NAS:4};
  return [...items].sort((a,b)=>(order[a.code]||50)-(order[b.code]||50)||String(a.name).localeCompare(String(b.name)));
}

function renderReceiveControls(){
  const customers=workspace?.customers||[];
  const facilities=facilitySort((workspace?.facilities||[]).filter(f=>f.active!==false));

  const currentCustomer=$("receiveCustomer").value;
  const currentOrigin=$("receiveOrigin").value;
  const currentDestination=$("receiveDestination").value;

  $("receiveCustomer").innerHTML='<option value="">New / unmatched customer</option>'+
    customers.map(c=>'<option value="'+c.id+'">'+esc(c.name)+(c.email?" — "+esc(c.email):"")+'</option>').join("");
  if(customers.some(c=>c.id===currentCustomer))$("receiveCustomer").value=currentCustomer;

  const allFacilityOptions=facilities.map(f=>'<option value="'+f.id+'">'+esc(f.name)+'</option>').join("");
  $("receiveOrigin").innerHTML=allFacilityOptions||'<option value="">No warehouse configured</option>';
  $("receiveDestination").innerHTML='<option value="">No next warehouse selected</option>'+allFacilityOptions;

  if(facilities.length){
    const miami=facilities.find(f=>f.code==="MIA");
    const nassau=facilities.find(f=>f.code==="NAS");
    if(facilities.some(f=>f.id===currentOrigin))$("receiveOrigin").value=currentOrigin;
    else if(miami)$("receiveOrigin").value=miami.id;

    if(facilities.some(f=>f.id===currentDestination))$("receiveDestination").value=currentDestination;
    else if(nassau)$("receiveDestination").value=nassau.id;
  }

  if(!$("receiveCustomer").value)showInlineCustomer(intakeOcrName);
  else hideInlineCustomer();
}

$("receiveCustomer").onchange=()=>{
  if($("receiveCustomer").value)hideInlineCustomer();
  else showInlineCustomer(intakeOcrName);
};

$("packagePhoto").onchange=async e=>{
  const file=e.target.files?.[0];
  if(!file)return;
  $("receiveResult").textContent="";
  $("receiveNewCustomerEmail").value="";
  $("receiveNewCustomerPhone").value="";
  try{
    const [uploadImage,ocrImage]=await Promise.all([
      compressImage(file),
      prepareOcrImage(file)
    ]);
    intakePhotoDataUrl=uploadImage;
    $("packagePhotoPreview").innerHTML='<img src="'+intakePhotoDataUrl+'" alt="Package photo">';
    const result=await readPackagePhoto(ocrImage);
    intakeOcrAddress=result.address||"";
  }catch(err){
    console.error(err);
    $("processingBox").classList.remove("hidden");
    $("processingText").textContent="New / unmatched customer";
    $("processingDetail").textContent="Enter customer name and email";
    showInlineCustomer(intakeOcrName);
  }
};

async function createReceiveCustomer(){
  const name=$("receiveNewCustomerName").value.trim();
  const email=$("receiveNewCustomerEmail").value.trim();
  const phone=$("receiveNewCustomerPhone").value.trim();
  if(!name)throw new Error("Enter the customer name.");
  if(!email)throw new Error("Enter the customer email so Parcel Snap can send the arrival notice.");

  const result=await api({action:"create_customer",name,email,phone});
  const customer=result.customer;
  workspace.customers=workspace.customers||[];
  workspace.customers.push(customer);
  renderReceiveControls();
  $("receiveCustomer").value=customer.id;
  hideInlineCustomer();
  return customer.id;
}

$("saveReceiveCustomer").onclick=async()=>{
  try{
    const customerId=await createReceiveCustomer();
    $("receiveCustomer").value=customerId;
    $("processingText").textContent=$("receiveNewCustomerName").value.trim()||"Customer saved";
    $("processingDetail").textContent="Email saved for future package notices";
  }catch(e){
    alert(e.message||String(e));
  }
};

$("addCustomerButton").onclick=async()=>{
  const name=$("newCustomerName").value.trim(),email=$("newCustomerEmail").value.trim(),phone=$("newCustomerPhone").value.trim();
  if(!name){alert("Enter the customer name.");return}
  try{
    await api({action:"create_customer",name,email,phone});
    ["newCustomerName","newCustomerEmail","newCustomerPhone"].forEach(id=>$(id).value="");
    await loadWorkspace();
    document.querySelector('[data-tab="customers"]').click();
  }catch(e){alert(e.message)}
};

$("addFacilityButton").onclick=async()=>{
  const body={
    action:"create_facility",
    name:$("newFacilityName").value.trim(),
    facility_type:$("newFacilityType").value,
    city:$("newFacilityCity").value.trim(),
    address_line1:$("newFacilityAddress").value.trim()||null,
    region:$("newFacilityRegion").value.trim()||null,
    postal_code:$("newFacilityPostal").value.trim()||null,
    country:$("newFacilityCountry").value.trim()||null
  };
  if(!body.name||!body.city){alert("Enter the warehouse name and city.");return}
  try{
    await api(body);
    ["newFacilityName","newFacilityCity","newFacilityAddress","newFacilityRegion","newFacilityPostal","newFacilityCountry"].forEach(id=>$(id).value="");
    await loadWorkspace();
    document.querySelector('[data-tab="warehouses"]').click();
  }catch(e){alert(e.message)}
};

$("receivePackageButton").onclick=async()=>{
  let customer_id=$("receiveCustomer").value;
  const origin_facility_id=$("receiveOrigin").value;

  if(!intakePhotoDataUrl){alert("Take a package photo first.");return}
  if(!origin_facility_id){alert("Choose the receiving warehouse.");return}

  $("receivePackageButton").disabled=true;
  $("receiveResult").textContent="Saving package…";

  try{
    if(!customer_id){
      customer_id=await createReceiveCustomer();
    }

    const r=await api({
      action:"receive_package",
      customer_id,
      origin_facility_id,
      destination_facility_id:$("receiveDestination").value||null,
      tracking_number:$("receiveTracking").value||null,
      carrier:$("receiveCarrier").value.trim()||null,
      size_class:$("receiveSize").value,
      weight_lb:$("receiveWeight").value||null,
      payment_status:$("receivePayment").value,
      ocr_name:intakeOcrName||null,
      ocr_tracking:$("receiveTracking").value||null,
      ocr_raw_text:intakeOcrText||null,
      ocr_recipient_address:intakeOcrAddress||null,
      photo_data_url:intakePhotoDataUrl
    });

    const emailStatus=r.email?.status||"SKIPPED";
    $("receiveResult").textContent=
      "Package received · photo saved · email "+emailStatus+
      (r.assigned_location_id?" · location assigned":"");

    intakePhotoDataUrl=null;
    intakeOcrText="";
    intakeOcrName="";
    intakeOcrAddress="";
    $("packagePhoto").value="";
    $("packagePhotoPreview").innerHTML="";
    $("processingBox").classList.add("hidden");
    $("receiveTracking").value="";
    $("receiveCarrier").value="";
    $("receiveWeight").value="";
    $("receiveNewCustomerName").value="";
    $("receiveNewCustomerEmail").value="";
    $("receiveNewCustomerPhone").value="";
    hideInlineCustomer();

    await loadWorkspace();
    document.querySelector('[data-tab="receive"]').click();
  }catch(e){
    $("receiveResult").textContent=e.message||String(e);
  }finally{
    $("receivePackageButton").disabled=false;
  }
};

document.querySelectorAll(".tab").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===btn));
  document.querySelectorAll(".panel").forEach(x=>x.classList.add("hidden"));
  $("tab-"+btn.dataset.tab).classList.remove("hidden");
});

sb.auth.onAuthStateChange((_event,session)=>{if(!session){$("authView").classList.remove("hidden");$("appView").classList.add("hidden")}});
boot();
