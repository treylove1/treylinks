(function(g){
"use strict";
const N=s=>String(s||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
const C=s=>N(s).replace(/ /g,"");

function lev(a,b){
  a=String(a||"");b=String(b||"");
  const d=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));
  for(let i=0;i<=a.length;i++)d[i][0]=i;
  for(let j=0;j<=b.length;j++)d[0][j]=j;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)
    d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return d[a.length][b.length];
}
function sim(a,b){
  a=C(a);b=C(b);
  return !a||!b?0:1-lev(a,b)/Math.max(a.length,b.length);
}
function prefixScore(alias,text){
  alias=C(alias);text=C(text);
  let best=0;
  for(let i=0;i<text.length;i++){
    let k=0;
    while(k<alias.length&&i+k<text.length&&alias[k]===text[i+k])k++;
    best=Math.max(best,k);
  }
  if(best<7||best/alias.length<.58)return 0;
  return Math.min(.96,.72+(best/alias.length)*.25);
}
function aliases(customer){
  const primaryType=(customer.customer_type||"PERSON")==="BUSINESS"?"BUSINESS_NAME":"PERSON_NAME";
  const out=[{alias:customer.name,alias_type:primaryType}];
  for(const x of (customer.aliases||[])){
    if(x?.alias&&!out.some(y=>N(y.alias)===N(x.alias)))out.push(x);
  }
  return out;
}
function typeWeight(customer,type){
  type=String(type||"LABEL");
  const ct=customer.customer_type||"PERSON";
  if(type==="CUSTOMER_CODE"||type==="LABEL")return 1.05;
  if(type==="PERSON_NAME")return ct==="PERSON"?1.03:.85;
  if(type==="BUSINESS_NAME")return ct==="BUSINESS"?1.03:.68;
  return 1;
}
function lineContext(lines,index){
  const senderStart=lines.findIndex(x=>/return\s+address/i.test(x));
  if(senderStart>=0&&index>=senderStart&&index<=senderStart+4)return .45;
  const line=lines[index]||"";
  if(/electr.*needs|\byen\b/i.test(line)&&/[\/|:-]/.test(line))return 1.08;
  const next=lines[index+1]||"";
  if(/^\d{3,6}\s+/.test(next)&&/\b(ave|avenue|st|street|rd|road|blvd|dr|lane|ln)\b/i.test(next))return 1.08;
  return 1;
}
function scoreAlias(customer,a,lines){
  const ac=C(a.alias);
  if(!ac)return null;
  let best={score:0,evidence:"",reason:""};
  for(let i=0;i<lines.length;i++){
    const windows=[lines[i],lines[i]+" "+(lines[i+1]||"")];
    for(const w of windows){
      const wc=C(w);
      let s=0,reason="";
      if(N(w)===N(a.alias)){s=1;reason="exact-line";}
      else if(N(w).includes(N(a.alias))){s=.995;reason="exact-phrase";}
      else if(wc.includes(ac)){s=.98;reason="compact-exact";}
      else{
        s=prefixScore(a.alias,w);
        reason=s?"known-target-partial":"";
        if(!s&&Math.abs(wc.length-ac.length)<=8){
          const f=sim(a.alias,w);
          if(f>=.82){s=Math.min(.94,f);reason="fuzzy-window";}
        }
      }
      if(!s)continue;
      s=Math.min(1,s*typeWeight(customer,a.alias_type)*lineContext(lines,i));
      if(s>best.score)best={score:s,evidence:w.trim(),reason};
    }
  }
  return best.score?{...best,alias:a.alias,alias_type:a.alias_type}:null;
}
function matchDirectory(customers,rawText){
  const lines=String(rawText||"").replace(/\r/g,"").split("\n").map(x=>x.trim()).filter(Boolean);
  const ranked=[];
  for(const customer of (customers||[])){
    const hits=aliases(customer).map(a=>scoreAlias(customer,a,lines)).filter(Boolean).sort((a,b)=>b.score-a.score);
    if(!hits.length)continue;
    const strong=hits.find(h=>h.alias_type!=="BUSINESS_NAME"||(customer.customer_type||"PERSON")==="BUSINESS");
    const score=strong?Math.max(hits[0].score,strong.score):Math.min(hits[0].score,.69);
    ranked.push({customer,score,evidence:hits[0],hits:hits.slice(0,3)});
  }
  ranked.sort((a,b)=>b.score-a.score);
  const best=ranked[0],second=ranked[1];
  if(!best)return {status:"NO_MATCH",customer:null,score:0,ranked:[]};
  const margin=best.score-(second?.score||0);
  let status="NO_MATCH";
  if(best.score>=.90&&margin>=.08)status="MATCHED";
  else if(best.score>=.72)status=margin<.08?"AMBIGUOUS":"REVIEW";
  return {
    status,
    customer:status==="MATCHED"?best.customer:null,
    candidate:best.customer,
    score:best.score,
    margin,
    evidence:best.evidence,
    ranked:ranked.slice(0,5)
  };
}
g.ParcelSnapKnownMatcher={matchDirectory,normalize:N,compact:C};
})(typeof window!=="undefined"?window:globalThis);
