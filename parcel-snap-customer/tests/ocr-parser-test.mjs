function normText(s=""){return String(s).toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim()}
function editDistance(a,b){a=normText(a);b=normText(b);const m=a.length,n=b.length,dp=Array.from({length:m+1},()=>Array(n+1).fill(0));for(let i=0;i<=m;i++)dp[i][0]=i;for(let j=0;j<=n;j++)dp[0][j]=j;for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return dp[m][n]}
function tokenSimilarity(a,b){a=normText(a);b=normText(b);if(!a||!b)return 0;if(a===b)return 1;if((a.length>=4&&b.includes(a))||(b.length>=4&&a.includes(b)))return .92;return 1-editDistance(a,b)/Math.max(a.length,b.length)}
function extractNameCandidate(text){
  const raw=String(text||"").replace(/\r/g,"");
  const lines=raw.split("\n").map(x=>x.trim()).filter(Boolean);
  const cleanCandidate=value=>{
    let v=String(value||"").replace(/[\\|]+/g," ").replace(/[^A-Za-z.' -]/g," ").replace(/\s+/g," ").trim();
    v=v.replace(/^(customer|recipient|consignee)\s*[:\-]?\s*/i,"");
    if(!v)return "";
    const words=v.split(" ").filter(Boolean);
    if(words.length<1||words.length>5)return "";
    if(/return address|tracking|package|order reference|partner order|in hand date|street|road|avenue|lane|unit|warehouse|hialeah|sweetwater|florida|bahamas/i.test(v))return "";
    return words.map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(" ");
  };
  for(const line of lines){
    const slash=line.match(/(?:electr[o0]nic\s+needs|your\s+electr[o0]nic\s+needs|yen)\s*[\\/|:\-]+\s*(.+)$/i);
    if(slash){const candidate=cleanCandidate(slash[1]);if(candidate)return candidate}
  }
  for(const line of lines){
    const idx=line.toLowerCase().indexOf("needs");
    if(idx>=0){const tail=line.slice(idx+5).replace(/^[\\/|:\-\s]+/,"");const candidate=cleanCandidate(tail);if(candidate)return candidate}
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
function best(customers,text){
  const ranked=customers.map(customer=>({customer,score:scoreName(customer.name,text)})).sort((a,b)=>b.score-a.score);
  const b=ranked[0],s=ranked[1];
  return b&&b.score>=.78&&(!s||b.score-s.score>=.06)?b:null;
}
const customers=[{name:"Trevon Humes"},{name:"Jane Doe"}];
const samples=[
  "Your electronic needs/Trevon Humes\n16600 NW 54TH AVE UNIT 9\nHIALEAH FL 33014-6110",
  "Your electr-onic needs/TrevonHu\n16600 NW 54TH AVE UNIT 9\nHIALEAH FL 33014-6110",
  "YOUR ELECTRONIC NEEDS / TREVON HUMES\n16600 NW 54TH AVE UNIT 9"
];
for(const sample of samples){
  const candidate=extractNameCandidate(sample);
  const match=best(customers,sample);
  if(!candidate)throw new Error("No name candidate: "+sample);
  if(match?.customer?.name!=="Trevon Humes")throw new Error("Wrong match for "+sample+" -> "+JSON.stringify(match));
  console.log({candidate,match:match.customer.name,score:match.score});
}
console.log("customer OCR parser tests passed");
