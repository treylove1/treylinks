function normText(s=""){return String(s).toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim()}
function editDistance(a,b){a=normText(a);b=normText(b);const m=a.length,n=b.length,dp=Array.from({length:m+1},()=>Array(n+1).fill(0));for(let i=0;i<=m;i++)dp[i][0]=i;for(let j=0;j<=n;j++)dp[0][j]=j;for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return dp[m][n]}
function tokenSimilarity(a,b){a=normText(a);b=normText(b);if(!a||!b)return 0;if(a===b)return 1;if((a.length>=4&&b.includes(a))||(b.length>=4&&a.includes(b)))return .92;return 1-editDistance(a,b)/Math.max(a.length,b.length)}

function cleanRecipientCandidate(value){
  let v=String(value||"").replace(/[\\|]+/g," ").replace(/[^A-Za-z.' -]/g," ").replace(/\s+/g," ").trim();
  v=v.replace(/^(customer|recipient|consignee)\s*[:\-]?\s*/i,"");
  if(!v)return "";
  const words=v.split(" ").filter(Boolean);
  if(words.length>5)return "";
  if(words.some(w=>w.length===1))return "";
  if(/return address|tracking|package|order reference|partner order|in hand date|street|road|avenue|lane|unit|warehouse|hialeah|sweetwater|florida|bahamas|roadie|fedex|usps|amazon/i.test(v))return "";
  if(words.length===1&&words[0].length<6)return "";
  if(words.length>=2&&!words.some(w=>w.length>=4))return "";
  return words.map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(" ");
}

function recipientAnalysis(text){
  const lines=String(text||"").replace(/\r/g,"").split("\n").map(x=>x.trim()).filter(Boolean);
  const streetRegex=/^\s*\d{3,6}\s+.*\b(?:NW|NE|SW|SE)?\s*(?:AVE|AVENUE|ST|STREET|RD|ROAD|BLVD|DR|DRIVE|LANE|LN|HWY|HIGHWAY)\b/i;
  const cityZipRegex=/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i;

  for(const line of lines){
    const explicit=line.match(/(?:your\s+)?electr[\W_]*[o0]nic\s+needs\s*[\\/|:\-]+\s*(.+)$/i)
      || line.match(/\byen\s*[\\/|:\-]+\s*(.+)$/i);
    if(explicit){
      const name=cleanRecipientCandidate(explicit[1]);
      if(name)return {name,confidence:.97,reason:"business-slash-recipient"};
    }
  }

  for(let i=0;i<lines.length;i++){
    if(streetRegex.test(lines[i])){
      const previous=lines[i-1]||"";
      const previous2=lines[i-2]||"";
      const slashSource=[previous,previous2].find(x=>/[\\/|]/.test(x)&&/needs|yen|electr/i.test(x));
      if(slashSource){
        const tail=slashSource.replace(/^.*?[\\/|]\s*/,"");
        const name=cleanRecipientCandidate(tail);
        if(name)return {name,confidence:.95,reason:"recipient-line-before-destination-address"};
      }
      const name=cleanRecipientCandidate(previous);
      const hasCityAfter=Boolean(lines[i+1]&&cityZipRegex.test(lines[i+1]));
      if(name&&hasCityAfter)return {name,confidence:.82,reason:"name-directly-above-destination-address"};
    }
  }
  return {name:"",confidence:0,reason:"unresolved"};
}
function extractNameCandidate(text){const r=recipientAnalysis(text);return r.confidence>=.82?r.name:""}
function candidateScore(name,candidate){const n=normText(name).replace(/ /g,""),c=normText(candidate).replace(/ /g,"");if(!n||!c)return 0;if(n===c)return 1;if(c.length>=6&&(n.startsWith(c)||c.startsWith(n)))return .96;if(c.length>=6&&n.includes(c))return .94;return 1-editDistance(n,c)/Math.max(n.length,c.length)}
function scoreName(name,text){const candidate=extractNameCandidate(text),candidateBased=candidate?candidateScore(name,candidate):0;const nts=normText(name).split(" ").filter(x=>x.length>=2),tts=normText(text).split(" ").filter(x=>x.length>=2);if(!nts.length||!tts.length)return candidateBased;const tokenBased=nts.map(n=>Math.max(...tts.map(t=>tokenSimilarity(n,t)))).reduce((a,b)=>a+b,0)/nts.length;return Math.max(candidateBased,tokenBased)}
function best(customers,text){const ranked=customers.map(customer=>({customer,score:scoreName(customer.name,text)})).sort((a,b)=>b.score-a.score);const b=ranked[0],s=ranked[1];return b&&b.score>=.78&&(!s||b.score-s.score>=.06)?b:null}

const customers=[{name:"Trevon Humes"},{name:"Jane Doe"}];
const good=[
  "Your electronic needs/Trevon Humes\n16600 NW 54TH AVE UNIT 9\nHIALEAH FL 33014-6110",
  "Your electr-onic needs/TrevonHu\n16600 NW 54TH AVE UNIT 9\nHIALEAH FL 33014-6110",
  "YOUR ELECTRONIC NEEDS / TREVON HUMES\n16600 NW 54TH AVE UNIT 9\nHIALEAH FL 33014-6110"
];

for(const sample of good){
  const candidate=extractNameCandidate(sample);
  const match=best(customers,sample);
  if(!candidate)throw new Error("No anchored recipient candidate: "+sample);
  if(match?.customer?.name!=="Trevon Humes")throw new Error("Wrong match: "+JSON.stringify(match));
  console.log({candidate,match:match.customer.name,score:match.score});
}

const nonsense="ROADIE\nReturn Address\nBBY-1502\n10760 NW 17th St\nSweetwater FL 33172\nA Aaa Freded Was\nPACKAGE TRACKING CODE\n1234567890";
if(extractNameCandidate(nonsense)!=="")throw new Error("Weak OCR noise was incorrectly accepted as a recipient name");

const unresolved="ROADIE\nReturn Address\nBBY-1502\n10760 NW 17th St\nSweetwater FL 33172\n16600 NW 54TH AVE UNIT 9\nHIALEAH FL 33014-6110\nPACKAGE TRACKING CODE";
if(extractNameCandidate(unresolved)!=="")throw new Error("Missing recipient should stay unresolved rather than being invented");

console.log("customer OCR semantic recipient tests passed");
