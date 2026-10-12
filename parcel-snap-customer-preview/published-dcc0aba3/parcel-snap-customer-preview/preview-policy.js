/* Shared closed fixture protocol. This contains fictional data only. */
(() => {
  const customers = [
    {id:'fixture-customer-jordan',name:'Jordan Sample',email:'jordan@example.invalid',phone:'',customer_type:'PERSON',aliases:[{alias:'SAMPLE-JORDAN',alias_type:'CUSTOMER_CODE'}]},
    {id:'fixture-customer-alex',name:'Alex Example',email:'alex@example.invalid',phone:'',customer_type:'PERSON',aliases:[{alias:'SAMPLE-ALEX',alias_type:'CUSTOMER_CODE'}]}
  ];
  const facilities = [
    {id:'fixture-origin',name:'FICTIONAL Origin Warehouse',facility_type:'ORIGIN',city:'Example City',active:true},
    {id:'fixture-destination',name:'FICTIONAL Destination Warehouse',facility_type:'DESTINATION',city:'Sample City',active:true}
  ];
  const parcel = customer => ({id:'fixture-package-'+customer.id.split('-').pop(),customer_id:customer.id,customer_name:customer.name,
    tracking_number:customer.id===customers[0].id?'001234567890':'009876543210',stage:'ORIGIN_RECEIVED',payment_status:'UNPAID',
    current_facility_id:facilities[0].id,location_code:'FICTIONAL-A1',updated_at:'2026-10-09T00:00:00.000Z'});
  const clone = value => JSON.parse(JSON.stringify(value));
  const exact = (value,keys) => value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
  function valid(body) {
    if(!body || typeof body!=='object' || Array.isArray(body))return false;
    if(body.action==='workspace')return exact(body,['action']);
    if(body.action==='create_customer')return exact(body,['action','fixture_customer']) && customers.some(c=>c.id===body.fixture_customer);
    if(body.action==='receive_package')return exact(body,['action','fixture_customer','fixture_facility','confirmed']) && customers.some(c=>c.id===body.fixture_customer) && body.fixture_facility==='fixture-origin' && typeof body.confirmed==='boolean';
    if(body.action==='destination_arrival')return exact(body,['action','fixture_package','fixture_facility','confirmed']) && customers.some(c=>parcel(c).id===body.fixture_package) && body.fixture_facility==='fixture-destination' && typeof body.confirmed==='boolean';
    return false;
  }
  function workspace(role) {
    if(!['OWNER','MANAGER','STAFF','WAREHOUSE'].includes(role))throw Error('PREVIEW_AUTH_REQUIRED');
    return {state:'ACTIVE',preview:{fictional:true,notifications:'DISABLED',inference:'TEST_NOT_APPROVED',storage:'NONE'},
      company:{id:'fixture-company',name:'FICTIONAL Parcel Snap Preview',role},
      subscription:{status:'SIMULATED ACTIVE',current_period_end:null},
      profile:{needs_worker_sublogins:false},customers:clone([customers[0]]),facilities:clone(facilities),route_destinations:clone(facilities),
      packages:[parcel(customers[0])],attention:[],staff:[],pending_invites:[],settings:{default_origin_facility_id:'fixture-origin'}};
  }
  function result(body,role) {
    if(!valid(body))throw Error('PREVIEW_ACTION_NOT_ALLOWED');
    if(body.action==='workspace')return workspace(role);
    const common={simulated:true,fictional:true,persisted:false,notifications_sent:0};
    if(body.action==='create_customer')return {...common,customer:clone(customers.find(c=>c.id===body.fixture_customer))};
    const customer=customers.find(c=>body.fixture_customer===c.id || body.fixture_package===parcel(c).id);
    const p=parcel(customer);
    if(body.action==='destination_arrival'){p.stage='DESTINATION_RECEIVED';p.current_facility_id='fixture-destination';}
    return {...common,package:p,package_id:p.id,photo_saved:false,assigned_location_id:null,
      email:{status:'SIMULATED_DISABLED',error:'PREVIEW ONLY: no photo saved, no customer notification sent.'}};
  }
  const api={customers,facilities,parcel,clone,valid,workspace,result};
  function freeze(value){Object.freeze(value);Object.values(value).forEach(v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v))freeze(v);});return value;}
  Object.defineProperty(globalThis,'ParcelSnapPreviewPolicy',{value:freeze(api),writable:false,configurable:false});
})();
