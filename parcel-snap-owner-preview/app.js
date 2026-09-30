const KEY="parcel-snap-owner-prototype-v1";
const seed={companies:[],selected:null};
let state=JSON.parse(localStorage.getItem(KEY)||"null")||seed;

function save(){localStorage.setItem(KEY,JSON.stringify(state));render();}
function makeCompany(){
  const n=state.companies.length+1;
  const id="qa-company-"+Date.now();
  state.companies.push({
    id,
    name:`Alpha Omega Test Company ${n}`,
    plan:"FULL_ACCESS_TEST",
    billing:"EXEMPT",
    customers:[{
      id:`qa-customer-${Date.now()}`,
      name:`Test Customer ${String(n).padStart(3,"0")}`,
      email:`testcustomer${n}@example.invalid`,
      parcels:[{
        ref:`TEST-${String(n).padStart(5,"0")}`,
        status:"Ready for pickup",
        location:"QA Shelf A1"
      }]
    }]
  });
  save();
}

function removeCompany(id){
  state.companies=state.companies.filter(c=>c.id!==id);
  if(state.selected===id) state.selected=null;
  save();
}

function viewCompany(id){
  state.selected=id;
  save();
}

function render(){
  document.getElementById("companyCount").textContent=state.companies.length;
  document.getElementById("viewMode").textContent=state.selected?"Customer":"Owner";

  const companies=document.getElementById("companies");
  companies.innerHTML=state.companies.length?state.companies.map(c=>`
    <div class="company">
      <div>
        <strong>${c.name}</strong><br>
        <small>Plan: ${c.plan} · Billing: ${c.billing}</small>
      </div>
      <div class="companyActions">
        <button class="view" data-view="${c.id}">View as Customer</button>
        <button data-remove="${c.id}">Delete QA company</button>
      </div>
    </div>`).join(""):'<p>No QA companies yet.</p>';

  companies.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>viewCompany(b.dataset.view));
  companies.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>removeCompany(b.dataset.remove));

  const select=document.getElementById("customerSelect");
  select.innerHTML='<option value="">Owner view</option>'+state.companies.map(c=>`<option value="${c.id}" ${state.selected===c.id?"selected":""}>${c.name}</option>`).join("");
  select.onchange=e=>{state.selected=e.target.value||null;save();};

  const panel=document.getElementById("customerPanel");
  const company=state.companies.find(c=>c.id===state.selected);
  if(!company){
    panel.className="customerPanel empty";
    panel.textContent='Create a QA company, then select “View as Customer.”';
    return;
  }

  const customer=company.customers[0];
  panel.className="customerPanel";
  panel.innerHTML=`
    <div class="testBanner">TEST MODE · OWNER VIEWING AS QA CUSTOMER · NO CHARGE</div>
    <h3>${customer.name}</h3>
    <p>This screen represents the paid customer experience while using an owner-created QA account.</p>
    ${customer.parcels.map(p=>`
      <div class="package">
        <strong>${p.ref}</strong>
        <span class="status">${p.status}</span>
        <div>Current location: ${p.location}</div>
      </div>`).join("")}
  `;
}

document.getElementById("createCompany").onclick=makeCompany;
render();