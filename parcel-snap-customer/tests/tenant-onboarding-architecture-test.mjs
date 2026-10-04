import fs from "node:fs";

const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");

function expect(label,condition){
  if(!condition)throw new Error(label+" FAILED");
  console.log(label,"PASS");
}

expect("business questionnaire can run before payment",app.includes('workspace.state==="BUSINESS_SETUP_PREPAY"'));
expect("prepayment questionnaire is saved",app.includes('action:"save_prepaid_business_profile"'));
expect("payment follows saved assessment",app.includes("Business setup saved · payment required to activate"));
expect("facility sorting is tenant-generic",app.includes("typeOrder={ORIGIN:1,TRANSIT:2,DESTINATION:3}"));
expect("no fixed MIA FLL ORL NAS routing codes",!/\b(MIA|FLL|ORL|NAS)\b/.test(app));
expect("no Nassau transfer default",!app.includes('f.code==="NAS"'));
expect("business assessment explicitly avoids location assumptions",html.includes("does not assume any warehouse, city, country, route, or storage location"));
expect("no owner-specific customer alias example",!html.includes("Example: Your Electronic Needs"));
expect("no Fort Lauderdale default location example",!html.includes("Fort Lauderdale Warehouse"));

console.log("tenant onboarding architecture regression tests passed");
