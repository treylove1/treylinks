await import("../known-customer-matcher.js");
const M=globalThis.ParcelSnapKnownMatcher;
if(!M)throw new Error("Matcher failed to load");

const customers=[
  {
    id:"trevon",
    name:"Trevon Humes",
    customer_type:"PERSON",
    aliases:[
      {alias:"Your Electronic Needs",alias_type:"BUSINESS_NAME"},
      {alias:"Your Electronic Needs / Trevon Humes",alias_type:"LABEL"}
    ]
  },
  {id:"jane",name:"Jane Doe",customer_type:"PERSON",aliases:[]},
  {id:"mark-daniels",name:"Mark Daniels",customer_type:"PERSON",aliases:[]},
  {id:"mark-daniel",name:"Mark Daniel",customer_type:"PERSON",aliases:[]},
  {id:"brenda-forbes",name:"Brenda Forbes",customer_type:"PERSON",aliases:[]},
  {id:"brenda-ford",name:"Brenda Ford",customer_type:"PERSON",aliases:[]},
  {
    id:"abc",
    name:"ABC Hardware",
    customer_type:"BUSINESS",
    aliases:[{alias:"ABC Hardware Ltd",alias_type:"BUSINESS_NAME"}]
  },
  {
    id:"abc-east",
    name:"ABC Hardware East",
    customer_type:"BUSINESS",
    aliases:[{alias:"ABC Hardware East Ltd",alias_type:"BUSINESS_NAME"}]
  },
  {id:"island-courier",name:"Island Courier",customer_type:"BUSINESS",aliases:[]},
  {id:"island-couriers",name:"Island Couriers",customer_type:"BUSINESS",aliases:[]}
];

function expect(label,condition,detail){
  if(!condition)throw new Error(label+" FAILED: "+JSON.stringify(detail));
  console.log(label,"PASS",detail||"");
}

const roadie=[
  "ROADIE",
  "Return Address",
  "BBY-1502",
  "10000 NW 10th St",
  "Sweetwater FL 33172",
  "Your electronic needs/TrevonHu",
  "20000 NW 20TH AVE UNIT 1",
  "HIALEAH FL 33014-6110",
  "PACKAGE TRACKING CODE"
].join("\n");

let r=M.matchDirectory(customers,roadie);
expect("partial known recipient",r.status==="MATCHED"&&r.customer?.id==="trevon",r);

r=M.matchDirectory(customers,"ROADIE\nReturn Address\nTrevon Humes\n10000 NW 10th St\nSweetwater FL 33172\nPACKAGE TRACKING CODE");
expect("return address does not identify recipient",r.status!=="MATCHED",r);

r=M.matchDirectory(customers,"ROADIE\nYour Electronic Needs\n20000 NW 20TH AVE UNIT 1\nHIALEAH FL 33014-6110");
expect("business prefix alone does not become person",r.status!=="MATCHED",r);

r=M.matchDirectory(customers,"ROADIE\nA Aaa Freded Was\nPACKAGE TRACKING CODE\n998877665544");
expect("OCR garbage rejected",r.status==="NO_MATCH",r);

r=M.matchDirectory(customers,"ABC Hardware Ltd\n55 MARKET STREET\nNASSAU BAHAMAS");
expect("business customer recognized",r.status==="MATCHED"&&r.customer?.id==="abc",r);

const realRoadieOcr=[
  "Sweetwater FL 33172",
  "Your electconic needs Trevor",
  "20000 Ni 20TH AVE UNIT 1",
  "HIALEAH FL 33014-6110"
].join("\n");

r=M.matchDirectory(customers,realRoadieOcr);
expect("real Roadie image OCR",r.status==="MATCHED"&&r.customer?.id==="trevon",r);

r=M.matchDirectory(customers,"Mark Daniels\n300 TEST STREET\nMIAMI FL 33101");
expect("ten-customer exact collision",r.status==="MATCHED"&&r.customer?.id==="mark-daniels",r);

r=M.matchDirectory(customers,"Brenda Forb\n400 TEST AVE\nMIAMI FL 33101");
expect("similar surname partial requires caution",r.status!=="MATCHED",r);

r=M.matchDirectory(customers,"ABC Hardware East Ltd\n55 MARKET STREET\nNASSAU BAHAMAS");
expect("similar business names stay distinct",r.status==="MATCHED"&&r.customer?.id==="abc-east",r);

const sharedBusiness=[
  {
    id:"trevon-a",
    name:"Trevon Humes",
    customer_type:"PERSON",
    aliases:[{alias:"Your Electronic Needs",alias_type:"BUSINESS_NAME"}]
  },
  {
    id:"trevon-b",
    name:"Trevon Holmes",
    customer_type:"PERSON",
    aliases:[{alias:"Your Electronic Needs",alias_type:"BUSINESS_NAME"}]
  }
];

r=M.matchDirectory(sharedBusiness,"Your Electronic Needs Trevor\n500 TEST ROAD\nHIALEAH FL 33014");
expect("shared business plus ambiguous first name does not auto-match",r.status!=="MATCHED",r);

console.log("known customer matcher regression tests passed");
