import {proposeFields,qualifyFields} from './reader-fields.js?v=ps-20261011-reader-07';
// Paddle-only structural policy. Tesseract continues using its unchanged parser.
export const PADDLE_FIELD_POLICY=Object.freeze({id:'paddle-literal-heading-v2',maxAngleDegrees:15,maxBandHeight:1,maxGapHeights:6,maxCaptionGapHeights:6,captionRows:1,maxFragmentOverlapHeights:0.5,bareNumberSelection:false,roleInference:false});
const FULL=/^(?:(?:PACKAGE|UPS|FEDEX|USPS|DHL|AMAZON|ROADIE|CANADA POST|ROYAL MAIL)\s+)?(?:TRACKING(?:\s+(?:CODE|NUMBER|ID|NO\.?|#))?|TRK)\s*[:#]?$/i;
const INLINE=/^\s*(?:(?:(?:PACKAGE|UPS|FEDEX|USPS|DHL|AMAZON|ROADIE|CANADA POST|ROYAL MAIL)\s+)?(?:TRACKING(?:\s+(?:CODE|NUMBER|ID|NO\.?|#))?|TRK)\s*[:#]\s*|(?:(?:PACKAGE|UPS|FEDEX|USPS|DHL|AMAZON|ROADIE|CANADA POST|ROYAL MAIL)\s+)?TRACKING\s+(?:CODE|NUMBER|ID|NO\.?)\s+)(\S(?:.*\S)?)\s*$/i;
function geom(row){
 if(!row||typeof row.frameId!=='string'||!Array.isArray(row.poly)||row.poly.length!==4||row.poly.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n))))return null;
 const [a,b,c,d]=row.poly;
 const edges=row.poly.map((p,i)=>[row.poly[(i+1)%4][0]-p[0],row.poly[(i+1)%4][1]-p[1]]);
 const crosses=edges.map((e,i)=>e[0]*edges[(i+1)%4][1]-e[1]*edges[(i+1)%4][0]);
 if(crosses.some(x=>!Number.isFinite(x)||x<=0))return null;
 const opposite=[d[0]-c[0],d[1]-c[1]],oppLength=Math.hypot(...opposite);
 if(!oppLength)return null;
 const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<=0)return null;
 if(-(dx*opposite[0]+dy*opposite[1])/(length*oppLength)<Math.cos(15*Math.PI/180))return null;
 const u=[dx/length,dy/length],v=[-u[1],u[0]],project=(p,axis)=>p[0]*axis[0]+p[1]*axis[1];
 const ys=row.poly.map(p=>project(p,v));const height=Math.max(...ys)-Math.min(...ys);if(height<=0||length<height)return null;
 return {u,v,height,center:row.poly.reduce((acc,p)=>[acc[0]+p[0]/4,acc[1]+p[1]/4],[0,0]),poly:row.poly};
}
function project(poly,axis){const values=poly.map(p=>p[0]*axis[0]+p[1]*axis[1]);return [Math.min(...values),Math.max(...values)];}
function aligned(a,b){return a&&b&&a.u[0]*b.u[0]+a.u[1]*b.u[1]>=Math.cos(PADDLE_FIELD_POLICY.maxAngleDegrees*Math.PI/180);}
function band(packageRow,trackingRow){
 const a=geom(packageRow),b=geom(trackingRow);if(packageRow.frameId!==trackingRow.frameId||Math.abs(packageRow.nativeSourceIndex-trackingRow.nativeSourceIndex)!==1||!aligned(a,b))return null;
 const h=Math.max(a.height,b.height),x=project(a.poly,a.u),y=project(b.poly,a.u);
 const perp=Math.abs((b.center[0]-a.center[0])*a.v[0]+(b.center[1]-a.center[1])*a.v[1]);
 if(perp>h*PADDLE_FIELD_POLICY.maxBandHeight||y[0]<x[0]||x[1]-y[0]>h*PADDLE_FIELD_POLICY.maxFragmentOverlapHeights||y[0]-x[1]>h*PADDLE_FIELD_POLICY.maxGapHeights)return null;
 return {...a,height:h,poly:[...a.poly,...b.poly]};
}
function captionSameBand(heading,row,frame){
 const c=geom(row);if(!c||row.frameId!==frame||!aligned(heading,c))return false;
 const h=Math.max(heading.height,c.height),hx=project(heading.poly,heading.u),cx=project(c.poly,heading.u);
 const perp=Math.abs((c.center[0]-heading.center[0])*heading.v[0]+(c.center[1]-heading.center[1])*heading.v[1]);
 return cx[0]>hx[0]&&cx[1]>hx[1]&&perp<=h*PADDLE_FIELD_POLICY.maxBandHeight&&hx[1]-cx[0]<=h*PADDLE_FIELD_POLICY.maxFragmentOverlapHeights&&cx[0]-hx[1]<=h*PADDLE_FIELD_POLICY.maxCaptionGapHeights;
}
function associationObstructed(heading,caption,rows,excluded,frame){
 const hx=project(heading.poly,heading.u),cx=project(caption.poly,heading.u),hy=project(heading.poly,heading.v),cy=project(caption.poly,heading.v);
 const left=hx[1],right=cx[1],top=Math.min(hy[0],cy[0]),bottom=Math.max(hy[1],cy[1]);
 // Original detector rows, including unreadable empty returns, can obstruct a
 // same-band association even when the detector lists them after its caption.
 return rows.some((r,j)=>!excluded.includes(j)&&r.frameId===frame&&Array.isArray(r.poly)&&r.poly.length===4&&r.poly.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))&&(()=>{const x=project(r.poly,heading.u),y=project(r.poly,heading.v);return Math.min(right,x[1])>Math.max(left,x[0])&&Math.min(bottom,y[1])>Math.max(top,y[0]);})());
}
function captionNear(heading,row,frame){
 const c=geom(row);if(!c||row.frameId!==frame||!aligned(heading,c))return false;
 const h=Math.max(heading.height,c.height),hx=project(heading.poly,heading.u),cx=project(c.poly,heading.u),hy=project(heading.poly,heading.v),cy=project(c.poly,heading.v);
 const overlap=Math.min(hx[1],cx[1])-Math.max(hx[0],cx[0]);
 return captionSameBand(heading,row,frame)||(cy[0]>=hy[0]&&cy[1]>hy[1]&&cy[0]-hy[1]<=h*PADDLE_FIELD_POLICY.maxCaptionGapHeights&&overlap>=Math.min(hx[1]-hx[0],cx[1]-cx[0])*.2);
}
function literalCode(text){return typeof text==='string'&&text.length>=6&&text.length<=64&&/\d/.test(text)&&(/^[A-Z0-9][A-Z0-9._\/-]{5,63}$/i.test(text)||/^\d{2,8}(?: +\d{2,8}){1,10}$/.test(text));}
function source(row,index,start=0,end=row.text.length){return{kind:'row',rowId:row.id,rowIndex:index,frameId:row.frameId,text:row.text.slice(start,end),start,end,confidence:null,bbox:structuredClone(row.bbox),poly:structuredClone(row.poly),bboxDerivedFrom:row.bboxDerivedFrom};}
function trimSpan(row){const start=row.text.search(/\S/);return start<0?null:{start,end:row.text.trimEnd().length,text:row.text.trim()};}
export function proposePaddleFields(rows,{barcodes=[]}={}){
 const original=proposeFields(rows,{barcodes});
 if(rows.some(r=>r?.source!=='paddleocr-native-line'))throw new Error('Paddle field policy requires native Paddle source rows.');
 const bound=[],unresolvedHeadings=[];
 const add=(index,start,end,headings)=>{const row=rows[index],value=row.text.slice(start,end);if(!literalCode(value))return;bound.push({value,rowIds:[row.id],sources:[source(row,index,start,end)],headingSources:headings.map(i=>source(rows[i],i)),reasons:['exact-print-tracking-heading-with-bounded-source-association']});};
 for(let i=0;i<rows.length;i++){
  const row=rows[i];if(typeof row.text!=='string')continue;
  const before=bound.length;const inline=row.text.match(INLINE);if(inline){const start=row.text.lastIndexOf(inline[1]);add(i,start,start+inline[1].length,[i]);if(bound.length===before)unresolvedHeadings.push({sources:[source(row,i)],reason:'Exact inline tracking heading has no supported single literal caption.'});continue;}
  let heading=null,headingIndices=[i],captionIndex=i+1;
  if(i+1<rows.length){
   const next=rows[i+1],a=row.text.trim().toUpperCase(),b=next.text.trim().toUpperCase();
   if(a==='PACKAGE'&&b==='TRACKING CODE')heading=band(row,next);
   else if(a==='TRACKING CODE'&&b==='PACKAGE')heading=band(next,row);
   if(heading){headingIndices=[i,i+1];captionIndex=i+2;}
  }
  if(!heading&&FULL.test(row.text.trim()))heading=geom(row);
  const recognizedHeading=FULL.test(row.text.trim())||headingIndices.length===2;
  const caption=rows[captionIndex];if(heading&&caption&&Number.isInteger(caption.nativeSourceIndex)&&caption.nativeSourceIndex===rows[captionIndex-1].nativeSourceIndex+1&&captionNear(heading,caption,row.frameId)){const span=trimSpan(caption);const competing=span&&captionSameBand(heading,caption,row.frameId)&&(associationObstructed(heading,caption,rows,[captionIndex,...headingIndices],row.frameId)||rows.some((other,j)=>j!==captionIndex&&!headingIndices.includes(j)&&typeof other.text==='string'&&literalCode(other.text.trim())&&other.text.trim()!==span.text&&captionSameBand(heading,other,row.frameId)));if(span&&!competing)add(captionIndex,span.start,span.end,headingIndices);}
  if(recognizedHeading&&bound.length===before)unresolvedHeadings.push({sources:headingIndices.map(j=>source(rows[j],j)),reason:'Explicit tracking heading has no immediately associated supported caption.'});
 }
 const candidates=[];
 for(const item of bound){const prior=candidates.find(x=>x.value===item.value);if(prior){for(const s of item.sources)if(!prior.sources.some(p=>p.rowId===s.rowId&&p.start===s.start&&p.end===s.end))prior.sources.push(s);prior.rowIds=[...new Set(prior.sources.map(s=>s.rowId))];}else candidates.push(item);}
 const typed=original.tracking.alternatives.filter(a=>a.sources?.some(s=>s.kind==='barcode'));
 const disagreement=typed.some(a=>!candidates.some(c=>c.value===a.value));
 const unassigned=original.tracking.alternatives.filter(a=>!candidates.some(c=>c.value===a.value));
 const tracking={status:candidates.length>1||disagreement||unresolvedHeadings.length?'CONFLICT':candidates.length===1?'REVIEW_REQUIRED':unassigned.length?'UNASSIGNED':'MISSING',value:candidates.length===1&&!disagreement&&!unresolvedHeadings.length?candidates[0].value:'',alternatives:candidates,unassigned,unresolvedHeadings,typedBarcodeEvidence:typed,boundHeadingEvidence:bound,reasons:[...(unassigned.length?['Other number/code-format matches remain unassigned evidence.']:[]),...(disagreement?['Printed label-bound code and typed barcode evidence disagree.']:[]),...(unresolvedHeadings.length?['Another explicit tracking heading is unresolved; no single tracking value is selected.']:[])]};
 const proposals={...original,tracking,paddlePolicy:PADDLE_FIELD_POLICY,unresolvedLiteralBlocks:{notice:'Complete literal rows and original blocks are retained for human review. Sender/destination roles are not inferred or extended to later blocks.',rows:structuredClone(rows),blocks:structuredClone(original.blocks)}};
 const fields=qualifyFields(proposals);
 return {originalFields:original,proposals,fields};
}
