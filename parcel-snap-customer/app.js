const SUPABASE_URL="https://evjoitqnogmpedrulepv.supabase.co";
const SUPABASE_KEY="sb_publishable_wv2cDeErfEorwoGCLl9rMA_yo01I01X";
const PORTAL_API=SUPABASE_URL+"/functions/v1/parcel-snap-portal";

const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
let authMode="signin";
let workspace=null;

const $=id=>document.getElementById(id);
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}

function setMode(mode){
  authMode=mode;
  $("signInMode").classList.toggle("active",mode==="signin");
  $("signUpMode").classList.toggle("active",mode==="signup");
  $("signupCompanyWrap").classList.toggle("hidden",mode!=="signup");
  $("authButton").textContent=mode==="signin"?"Sign in":"Create account";
  $("password").autocomplete=mode==="signin"?"current-password":"new-password";
  $("authMessage").textContent="";
}
$("signInMode").onclick=()=>setMode("signin");
$("signUpMode").onclick=()=>setMode("signup");

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
    }else{
      const company_name=$("signupCompany").value.trim();
      if(!company_name)throw new Error("Enter your company name.");
      const {data,error}=await sb.auth.signUp({email,password});
      if(error)throw error;
      if(!data.session){
        $("authMessage").textContent="Account created. Check your email to confirm it, then sign in.";
        return;
      }
      await api({action:"onboard",company_name});
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

document.querySelectorAll(".tab").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===btn));
  document.querySelectorAll(".panel").forEach(x=>x.classList.add("hidden"));
  $("tab-"+btn.dataset.tab).classList.remove("hidden");
});

sb.auth.onAuthStateChange((_event,session)=>{if(!session){$("authView").classList.remove("hidden");$("appView").classList.add("hidden")}});
boot();
