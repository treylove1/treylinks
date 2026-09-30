import fs from "node:fs";

function norm(s=""){
  return String(s).toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
}
function editDistance(a,b){
  a=norm(a); b=norm(b);
  const m=a.length,n=b.length,dp=Array.from({length:m+1},()=>Array(n+1).fill(0));
  for(let i=0;i<=m;i++) dp[i][0]=i;
  for(let j=0;j<=n;j++) dp[0][j]=j;
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++) {
    dp[i][j]=Math.min(
      dp[i-1][j]+1,
      dp[i][j-1]+1,
      dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1)
    );
  }
  return dp[m][n];
}
function tokenSimilarity(a,b){
  a=norm(a); b=norm(b);
  if(!a||!b) return 0;
  if(a===b) return 1;
  if((a.length>=4&&b.includes(a))||(b.length>=4&&a.includes(b))) return .92;
  return 1-editDistance(a,b)/Math.max(a.length,b.length);
}
function scoreNameAgainstText(name,text){
  const nameTokens=norm(name).split(" ").filter(t=>t.length>=2);
  const textTokens=norm(text).split(" ").filter(t=>t.length>=2);
  if(!nameTokens.length||!textTokens.length) return 0;
  const scores=nameTokens.map(nt=>Math.max(...textTokens.map(tt=>tokenSimilarity(nt,tt))));
  return scores.reduce((a,b)=>a+b,0)/scores.length;
}
function bestCustomerMatch(customers,text){
  const ranked=customers.map(customer=>({customer,score:scoreNameAgainstText(customer.name,text)}))
    .sort((a,b)=>b.score-a.score);
  if(!ranked.length) return null;
  const best=ranked[0], second=ranked[1];
  const clear=best.score>=.78 && (!second || best.score-second.score>=.08);
  return clear?best:null;
}
function digitsOnly(s=""){ return String(s).replace(/\D/g,""); }
function trackingCandidates(text){
  const lines=String(text||"").split(/\r?\n/);
  const out=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    const context=[lines[i-1]||"",line,lines[i+1]||""].join(" ");
    const compact=digitsOnly(context);
    if(/track|tracking|trk/i.test(context) && compact.length>=10){
      for(const len of [22,20,18,16,15,14,13,12,11,10]){
        if(compact.length>=len) out.push(compact.slice(-len));
      }
    }
    const tokens=context.match(/(?:\d[\s-]?){10,26}/g)||[];
    for(const t of tokens){
      const d=digitsOnly(t);
      if(d.length>=10&&d.length<=26) out.push(d);
    }
  }
  return [...new Set(out)];
}
function similarityDigits(a,b){
  a=digitsOnly(a); b=digitsOnly(b);
  if(!a||!b) return 0;
  if(a===b) return 1;
  if(a.includes(b)||b.includes(a)) return Math.min(a.length,b.length)/Math.max(a.length,b.length);
  const d=editDistance(a,b);
  return 1-d/Math.max(a.length,b.length);
}
function bestTracking(expected,text){
  const candidates=trackingCandidates(text);
  let best={candidate:"",score:0};
  for(const c of candidates){
    const score=similarityDigits(expected,c);
    if(score>best.score) best={candidate:c,score};
  }
  return {...best,candidates};
}

const [ocrPath, expectedName, expectedTracking, labelName] = process.argv.slice(2);
const text=fs.readFileSync(ocrPath,"utf8");
const decoys=[
  {name:"Jane Doe",email:"jane@example.test"},
  {name:"John Smith",email:"john@example.test"},
  {name:"Trevon Humes",email:"trevon@example.test"},
  {name:expectedName,email:"expected@example.test"}
].filter((item,index,arr)=>arr.findIndex(x=>norm(x.name)===norm(item.name))===index);
const match=bestCustomerMatch(decoys,text);
const tracking=expectedTracking?bestTracking(expectedTracking,text):{candidate:"",score:1,candidates:[]};

const namePass=Boolean(match && norm(match.customer.name)===norm(expectedName) && match.score>=.72);
const trackingPass=!expectedTracking || tracking.score>=.82;

const result={
  label:labelName,
  expected:{name:expectedName,tracking:digitsOnly(expectedTracking)},
  extracted:{
    matchedCustomer:match?.customer?.name||null,
    customerScore:match?.score||0,
    tracking:tracking.candidate||null,
    trackingScore:tracking.score,
    trackingCandidates:tracking.candidates.slice(0,12)
  },
  pass:{name:namePass,tracking:trackingPass,overall:namePass&&trackingPass},
  ocrPreview:text.slice(0,2500)
};
console.log(JSON.stringify(result,null,2));
if(!(namePass&&trackingPass)) process.exitCode=1;
