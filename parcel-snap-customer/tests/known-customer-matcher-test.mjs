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
    id:"yen-business",
    name:"Your Electronic Needs",
    customer_type:"BUSINESS",
    aliases:[
      {alias:"Your Electronic Needs",alias_type:"BUSINESS_NAME"},
      {alias:"YEN",alias_type:"CUSTOMER_CODE"}
    ]
  },
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
expect("business prefix alone becomes business account",r.status==="MATCHED"&&r.customer?.id==="yen-business",r);

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


const actualLocalRoadieOcr=[
  "Vrs Wi LPth 31",
  "Sweetwater F\\ si 22",
  "Nour electoonic needs Trevor",
  "16600 NH S4TH AVE UNIT 9",
  "HIALEAH FL Sone 6118",
  "PACKAGE TRACKING CODE"
].join("\n");

r=M.matchDirectory(customers,actualLocalRoadieOcr);
expect("actual local Roadie OCR",r.status==="MATCHED"&&r.customer?.id==="trevon",r);

const scaleCustomers=[
  {id:"trevon",name:"Trevon Humes",customer_type:"PERSON",aliases:[
    {alias:"Your Electronic Needs",alias_type:"BUSINESS_NAME"},
    {alias:"Your Electronic Needs / Trevon Humes",alias_type:"LABEL"}
  ]},
  {id:"mark-roberts",name:"Mark Roberts",customer_type:"PERSON",aliases:[]},
  {id:"felida-hughes",name:"Felida Hughes",customer_type:"PERSON",aliases:[]},
  {id:"jalida-hughes",name:"Jalida Hughes",customer_type:"PERSON",aliases:[]},
  {id:"john-bull",name:"John Bull",customer_type:"BUSINESS",aliases:[
    {alias:"John Bull Business Centre",alias_type:"BUSINESS_NAME"}
  ]},
  ...Array.from({length:245},(_,i)=>({
    id:"synthetic-"+i,
    name:"Warehouse Customer "+String(i+1).padStart(3,"0"),
    customer_type:i%5===0?"BUSINESS":"PERSON",
    aliases:i%5===0?[{alias:"Business Account "+String(i+1).padStart(3,"0"),alias_type:"BUSINESS_NAME"}]:[]
  }))
];

r=M.matchDirectory(scaleCustomers,"Mark Roberts\n400 TEST STREET\nMIAMI FL 33101");
expect("250-customer Mark Roberts",r.status==="MATCHED"&&r.customer?.id==="mark-roberts",r);

r=M.matchDirectory(scaleCustomers,"Felida Hughes\n401 TEST STREET\nMIAMI FL 33101");
expect("250-customer Felida Hughes",r.status==="MATCHED"&&r.customer?.id==="felida-hughes",r);

r=M.matchDirectory(scaleCustomers,"Jalida Hughes\n402 TEST STREET\nMIAMI FL 33101");
expect("250-customer Jalida Hughes",r.status==="MATCHED"&&r.customer?.id==="jalida-hughes",r);

r=M.matchDirectory(scaleCustomers,"John Bull Business Centre\n403 TEST STREET\nNASSAU BAHAMAS");
expect("250-customer business identity",r.status==="MATCHED"&&r.customer?.id==="john-bull",r);

r=M.matchDirectory(scaleCustomers,"Unknown Walk-In Customer\n404 TEST STREET\nMIAMI FL 33101");
expect("250-customer unknown stays unmatched",r.status!=="MATCHED",r);

console.log("250-customer directory regression tests passed");


r=M.matchDirectory(customers,
  "ROADIE\nReturn Address\nBBY-1502\n10760 NW 17th St\nSweetwater FL 33172\nYour Electronic Needs\n16600 NW 54TH AVE UNIT 9\nHIALEAH FL 33014-6110\nPACKAGE TRACKING CODE"
);
expect(
  "business fallback when person unreadable",
  r.status==="MATCHED"&&r.customer?.id==="yen-business",
  r
);

r=M.matchDirectory(customers,
  "ROADIE\nYour Electronic Needs/TrevonHu\n16600 NW 54TH AVE UNIT 9\nHIALEAH FL 33014-6110"
);
expect(
  "business plus known partial person prefers person",
  r.status==="MATCHED"&&r.customer?.id==="trevon",
  r
);

r=M.matchDirectory(customers,
  "ROADIE\nYour Electronic Needs / A Aaa Freded Was\n16600 NW 54TH AVE UNIT 9\nHIALEAH FL 33014-6110"
);
expect(
  "clear business survives garbage person text",
  r.status==="MATCHED"&&r.customer?.id==="yen-business",
  r
);


r=M.matchDirectory(customers,
  "ROADIE\nNour electoonic needs\n16600 NW 54TH AVE UNIT 9\nHIALEAH FL 33014-6110"
);
expect(
  "OCR-damaged business name matches generically",
  r.status==="MATCHED"&&r.customer?.id==="yen-business",
  r
);

r=M.matchDirectory(customers,
  "SHIP FROM\nYour Electronic Needs\n10760 NW 17TH ST\nSWEETWATER FL 33172\nUNKNOWN RECIPIENT\n16600 NW 54TH AVE UNIT 9\nHIALEAH FL 33014"
);
expect(
  "sender business is not mistaken for recipient",
  !(r.status==="MATCHED"&&r.customer?.id==="yen-business"),
  r
);


const aliasMappedPerson=[{
  id:"trevon-alias-map",
  name:"Trevon Humes",
  customer_type:"PERSON",
  email:"humestrevon@gmail.com",
  aliases:[
    {alias:"Trevon Humes",alias_type:"PERSON_NAME"},
    {alias:"Your Electronic Needs",alias_type:"LABEL"}
  ]
}];

r=M.matchDirectory(aliasMappedPerson,
  "ROADIE\nYour Electronic Needs\n16600 NW 54TH AVE UNIT 9\nHIALEAH FL 33014"
);
expect(
  "business label alias routes to person customer",
  r.status==="MATCHED"&&r.customer?.id==="trevon-alias-map",
  r
);
