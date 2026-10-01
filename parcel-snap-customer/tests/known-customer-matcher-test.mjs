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
  {
    id:"jane",
    name:"Jane Doe",
    customer_type:"PERSON",
    aliases:[]
  },
  {
    id:"abc",
    name:"ABC Hardware",
    customer_type:"BUSINESS",
    aliases:[{alias:"ABC Hardware Ltd",alias_type:"BUSINESS_NAME"}]
  }
];

function expect(label,condition,detail){
  if(!condition)throw new Error(label+" FAILED: "+JSON.stringify(detail));
  console.log(label,"PASS",detail||"");
}

const roadie=[
  "ROADIE",
  "Return Address",
  "BBY-1502",
  "10760 NW 17th St",
  "Sweetwater FL 33172",
  "Your electronic needs/TrevonHu",
  "16600 NW 54TH AVE UNIT 9",
  "HIALEAH FL 33014-6110",
  "PACKAGE TRACKING CODE"
].join("\n");

let r=M.matchDirectory(customers,roadie);
expect("partial known recipient",r.status==="MATCHED"&&r.customer?.id==="trevon",r);

r=M.matchDirectory(customers,"ROADIE\nReturn Address\nTrevon Humes\n10760 NW 17th St\nSweetwater FL 33172\nPACKAGE TRACKING CODE");
expect("return address does not identify recipient",r.status!=="MATCHED",r);

r=M.matchDirectory(customers,"ROADIE\nYour Electronic Needs\n16600 NW 54TH AVE UNIT 9\nHIALEAH FL 33014-6110");
expect("business prefix alone does not become person",r.status!=="MATCHED",r);

r=M.matchDirectory(customers,"ROADIE\nA Aaa Freded Was\nPACKAGE TRACKING CODE\n998877665544");
expect("OCR garbage rejected",r.status==="NO_MATCH",r);

r=M.matchDirectory(customers,"ABC Hardware Ltd\n55 MARKET STREET\nNASSAU BAHAMAS");
expect("business customer recognized",r.status==="MATCHED"&&r.customer?.id==="abc",r);

console.log("known customer matcher regression tests passed");
