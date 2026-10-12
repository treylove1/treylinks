/** Pure review-only projection of one native Paddle observation. Never a matcher. */
export const LABEL_BLOCK_POLICY = Object.freeze({
  id: 'paddle-local-label-blocks-v4', maxAngleDegrees: 15,
  maxGapHeights: 2.5, maxLeftDriftHeights: 2, minHorizontalOverlap: 0.25,
  maxHeightRatio: 2.5, maxNameLines: 3, maxUnitLines: 2,
  roleInference: false, textRepair: false, automaticSelection: false,
  supportedPostalSyntax: ['US state + ZIP', 'Canadian province + postal code', 'UK postal code'],
});
const clone = value => value === undefined ? undefined : structuredClone(value);
const COS = Math.cos(LABEL_BLOCK_POLICY.maxAngleDegrees * Math.PI / 180);
const ROLE = new Map([
  ['TO', ['DESTINATION', 'TO']], ['SHIP TO', ['DESTINATION', 'SHIP_TO']],
  ['DELIVER TO', ['DESTINATION', 'DELIVER_TO']], ['RECIPIENT', ['DESTINATION', 'RECIPIENT']],
  ['RETURN', ['RETURN', 'RETURN']], ['RETURN ADDRESS', ['RETURN', 'RETURN_ADDRESS']],
  ['FROM', ['RETURN', 'FROM']], ['SHIP FROM', ['RETURN', 'SHIP_FROM']],
  ['BILL TO', ['OTHER', 'BILL_TO']], ['REMIT TO', ['OTHER', 'REMIT_TO']],
  ['SOLD TO', ['OTHER', 'SOLD_TO']],
]);
const META = /^(?:(?:PACKAGE|PKG|PARCEL|PALLET|CARTON)(?:\s|#|:|$)|\d+\s+OF\s+\d+$|(?:ORDER|REFERENCE|REF|PARTNER ORDER|TRACKING|TRACK|TRK|CODE|BARCODE|IN HAND DATE|DATE|WEIGHT|WT|QTY|QUANTITY|TOTAL|SERVICE|ROUTE|INVOICE|BATCH|LOT|SKU|PRODUCT|DESCRIPTION|CONTENTS|COD|P\/?O(?:\s+NO)?)(?:\s|#|:|$)|(?:UPS|FEDEX|USPS|DHL|ROADIE)$)/i;
const SHIPPING_VALUE = /^(?:\d+\s*OF\s*\d+|\d+(?:[.,]\d+)?\s*(?:LBS?|OZ|KGS?|GRAMS?|POUNDS?|OUNCES?)(?:\b|$)|\d+\s*(?:DAYS?|HRS?|HOURS?)(?:\b|$)|\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+\d{2,4}$)/i;
const COUNTRY = /^(?:US|USA|U\.S\.A\.|UNITED STATES(?: OF AMERICA)?|CANADA|UK|UNITED KINGDOM|GREAT BRITAIN)$/i;
const UNIT = /^(?:APT\.?|APARTMENT|UNIT|SUITE|STE\.?|FLOOR|FL\.?|BUILDING|BLDG\.?)\s*[-#\p{L}\p{N}].*$|^#\s*[\p{L}\p{N}][\p{L}\p{N}\s-]*$/iu;
function heading(text) { return ROLE.get(text.trim().replace(/\s*[:#]\s*$/, '').replace(/\s+/g, ' ').toUpperCase()) ?? null; }
function postal(text) {
  if (META.test(text) || SHIPPING_VALUE.test(text)) return null;
  // Syntax is evidence of a postal-shaped line, not validation or normalization.
  if (/^[\p{L}][\p{L}\p{M}\s.,'-]*\s+(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|AS|GU|MP|PR|VI|AA|AE|AP)\s*\d{5}(?:-\d{4})?\s*$/iu.test(text)) return 'US_LOCALITY_POSTAL';
  if (/^[\p{L}][\p{L}\p{M}\s.,'-]*\s+(?:AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d$/iu.test(text)) return 'CA_LOCALITY_POSTAL';
  if (/^(?:[\p{L}][\p{L}\p{M}\s.,'-]+\s)?(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/iu.test(text)) return 'UK_LOCALITY_POSTAL';
  return null;
}
function street(text) {
  if (/^(?:P\.?\s*O\.?\s*BOX|POST OFFICE BOX)\s+\d[\p{L}\p{N}-]*$/iu.test(text)) return true;
  if (META.test(text) || SHIPPING_VALUE.test(text) || heading(text) || postal(text) || UNIT.test(text)) return false;
  return /\s/u.test(text) && /^\d{1,7}[\p{L}]?(?:[-/]\d{1,7})?[\s\p{L}][\p{L}\p{N}\p{M}\s.,'’/#-]*\p{L}[\p{L}\p{N}\p{M}\s.,'’/#-]*$/iu.test(text);
}
function nameLike(text) {
  return !!text && /\p{L}/u.test(text) && !META.test(text) && !SHIPPING_VALUE.test(text) && !heading(text) && !postal(text)
    && !street(text) && !UNIT.test(text) && !COUNTRY.test(text)
    && !/^\d{2}[./-]\d{2}[./-]\d{2,4}$/.test(text)
    && !/^(?:https?:\/\/|www\.)/i.test(text) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}
function project(poly, axis) { const p = poly.map(([x,y]) => x*axis[0]+y*axis[1]); return [Math.min(...p), Math.max(...p)]; }
function finitePoly(poly) { return Array.isArray(poly) && poly.length === 4 && poly.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)); }
function geometry(row) {
  if (!finitePoly(row.poly) || typeof row.frameId !== 'string' || !row.frameId) return null;
  const e = row.poly.map((p,i) => [row.poly[(i+1)%4][0]-p[0],row.poly[(i+1)%4][1]-p[1]]);
  if (e.some((p,i) => p[0]*e[(i+1)%4][1]-p[1]*e[(i+1)%4][0] <= 0)) return null;
  const length = Math.hypot(...e[0]), opposite = Math.hypot(...e[2]);
  if (!length || !opposite || -(e[0][0]*e[2][0]+e[0][1]*e[2][1])/(length*opposite) < COS) return null;
  const u = e[0].map(x=>x/length), v = [-u[1],u[0]];
  const x = project(row.poly,u), y = project(row.poly,v), height = y[1]-y[0];
  if (height <= 0 || length < height) return null;
  return {u,v,x,y,height,center:row.poly.reduce((s,p)=>[s[0]+p[0]/4,s[1]+p[1]/4],[0,0])};
}
function pair(a,b) {
  if (!a.g || !b.g || a.row.frameId !== b.row.frameId || a.g.u[0]*b.g.u[0]+a.g.u[1]*b.g.u[1] < COS) return null;
  const ax=project(a.row.poly,a.g.u), bx=project(b.row.poly,a.g.u), ay=project(a.row.poly,a.g.v), by=project(b.row.poly,a.g.v);
  const h=Math.max(a.g.height,b.g.height), overlap=Math.min(ax[1],bx[1])-Math.max(ax[0],bx[0]);
  if (h/Math.min(a.g.height,b.g.height)>LABEL_BLOCK_POLICY.maxHeightRatio || by[0]<ay[1]-h*.2 || by[1]<=ay[1]
      || by[0]-ay[1]>h*LABEL_BLOCK_POLICY.maxGapHeights || Math.abs(ax[0]-bx[0])>h*LABEL_BLOCK_POLICY.maxLeftDriftHeights
      || overlap<Math.min(ax[1]-ax[0],bx[1]-bx[0])*LABEL_BLOCK_POLICY.minHorizontalOverlap) return null;
  return {ax,bx,ay,by,h};
}
function obstructed(a,b,all) {
  const p=pair(a,b); if (!p) return true;
  const left=Math.max(p.ax[0],p.bx[0]),right=Math.min(p.ax[1],p.bx[1]);
  // The inner boundary joins the rows. Keep its overlap band when endpoints
  // overlap, and its shared boundary when they touch. Outer-envelope fringes
  // are exempt only with the same ordered-neighbor proof used for association;
  // contained, competing or malformed endpoint occupants must still obstruct.
  const top=Math.min(p.ay[1],p.by[0]),bottom=Math.max(p.ay[1],p.by[0]);
  return all.some(c => {
    if (c.index===a.index || c.index===b.index || c.row.frameId!==a.row.frameId) return false;
    // Unknown coordinates cannot prove a safe association in this frame.
    if (!finitePoly(c.row.poly)) return true;
    const x=project(c.row.poly,a.g.u),y=project(c.row.poly,a.g.v);
    // Degenerate finite polygons cannot establish ordered neighbors either.
    // Include zero-area contacts in the conservative envelope check.
    if(!c.g) return Math.min(right,x[1])>=Math.max(left,x[0])
      && Math.min(p.by[1],y[1])>=Math.max(p.ay[0],y[0]);
    if(Math.min(right,x[1])<=Math.max(left,x[0])) return false;
    if(Math.min(bottom,y[1])>=Math.max(top,y[0])) return true;
    if(Math.min(p.by[1],y[1])<=Math.max(p.ay[0],y[0])) return false;
    return !((y[1]<top && pair(c,a)) || (y[0]>bottom && pair(b,c)));
  });
}
function predecessors(b, all, predicate) { return all.filter(a=>a.index!==b.index && predicate(a) && pair(a,b) && !obstructed(a,b,all)); }
function successors(a, all, predicate) { return all.filter(b=>b.index!==a.index && predicate(b) && pair(a,b) && !obstructed(a,b,all)); }
function blockedPredecessorAlternatives(b,all,predicate) {
  const candidates=all.filter(a=>a.index!==b.index && predicate(a) && pair(a,b));
  // Mutually obstructing, unordered endpoints are alternatives, not absence of
  // evidence. Preserve that uncertainty instead of producing a clean UNASSIGNED
  // block that a review UI could mistake for an uncontested literal suggestion.
  return candidates.filter(a=>candidates.some(c=>c.index!==a.index && !pair(a,c) && !pair(c,a)
    && obstructed(a,b,[a,b,c]) && obstructed(c,b,[a,b,c])));
}
function span(entry) {
  const {row,index,start,end}=entry;
  const out={rowId:row.id,rowIndex:index,nativeSourceIndex:row.nativeSourceIndex,frameId:row.frameId,
    start,end,text:row.text.slice(start,end),offsetEncoding:'UTF-16',poly:clone(row.poly)};
  for(const key of ['bbox','bboxDerivedFrom','confidence','nativeScore','nativeScoreScale']) if (Object.hasOwn(row,key)) out[key]=clone(row[key]);
  return out;
}
function field(entries) { const sources=entries.map(span), literalLines=sources.map(s=>s.text); return {value:literalLines.join('\n'),literalLines,sources}; }
function blockId(observationId, entries) { return `${LABEL_BLOCK_POLICY.id}:${encodeURIComponent(observationId)}:${entries.map(e=>`${encodeURIComponent(e.row.id)}@${e.start}-${e.end}`).join('|')}`; }
function requireInput(input) {
  if (!input || typeof input.observationId!=='string' || !input.observationId) throw new TypeError('A source observationId is required.');
  if (!Array.isArray(input.rows) || input.rows.length>500) throw new TypeError('Expected at most 500 native Paddle rows.');
  for(const key of ['photoSha256','rawResultSha256']) if(input[key]!=null && (typeof input[key]!=='string' || !/^[a-f0-9]{64}$/i.test(input[key]))) throw new TypeError('Supplied hashes must be literal SHA-256 hex strings.');
  if(input.photoId!=null && (typeof input.photoId!=='string' || !input.photoId)) throw new TypeError('photoId must be a nonempty source ID when supplied.');
  const ids=new Set();
  for(const r of input.rows) {
    if (!r || r.source!=='paddleocr-native-line' || typeof r.id!=='string' || !r.id || ids.has(r.id) || typeof r.text!=='string' || r.text.length>4096
        || !Number.isInteger(r.nativeSourceIndex) || r.nativeSourceIndex<0 || typeof r.frameId!=='string' || !r.frameId)
      throw new TypeError('Rows require unique IDs, literal text, native indices, frame IDs and native Paddle source type.');
    ids.add(r.id);
  }
}
export function projectPaddleLabelBlocks(input) {
  requireInput(input);
  const observation={id:input.observationId,photoId:input.photoId??null,photoSha256:input.photoSha256??null,rawResultSha256:input.rawResultSha256??null};
  const issues=[], all=input.rows.map((row,index)=>{
    const start=row.text.search(/\S/u), end=row.text.trimEnd().length;
    const text=start<0?'':row.text.slice(start,end), g=geometry(row);
    if (!g) issues.push({code:'INVALID_OR_MISSING_GEOMETRY',rowIds:[row.id]});
    return {row,index,start:start<0?0:start,end:start<0?0:end,text,g,postal:postal(text),street:street(text),unit:UNIT.test(text),heading:heading(text),name:nameLike(text),country:COUNTRY.test(text)};
  });
  for(const key of ['photoId','photoSha256','rawResultSha256']) if (!observation[key]) issues.push({code:'MISSING_OBSERVATION_BINDING',field:key});
  const blocks=[];
  for(const anchor of all.filter(a=>a.postal)) {
    const paths=[],blockedAddressAlternatives=[];
    const walk=(tail,units=[])=>{
      const predicate=a=>a.street || a.unit,near=predecessors(tail,all,predicate);
      const alternatives=blockedPredecessorAlternatives(tail,all,predicate);
      if(alternatives.length) blockedAddressAlternatives.push(...alternatives,tail);
      for(const prev of near) {
        if(prev.street) paths.push([prev,...units,anchor]);
        else if(units.length<LABEL_BLOCK_POLICY.maxUnitLines) walk(prev,[prev,...units]);
      }
    };
    if(anchor.g) walk(anchor);
    const warnings=[], uniquePaths=[...new Map(paths.map(p=>[p.map(e=>e.row.id).join('\0'),p])).values()];
    const unambiguousAddress=uniquePaths.length===1 && !blockedAddressAlternatives.length;
    let addressEntries;
    if(unambiguousAddress) addressEntries=uniquePaths[0];
    else {
      addressEntries=[anchor];
      const competing=uniquePaths.length || blockedAddressAlternatives.length;
      warnings.push(competing?'COMPETING_ADDRESS_PREDECESSORS':'MISSING_BOUNDED_STREET');
      if(competing) issues.push({code:'COMPETING_ADDRESS_PREDECESSORS',rowIds:[...new Set([...uniquePaths.flat(),...blockedAddressAlternatives].map(e=>e.row.id))]});
    }
    let names=[], headings=[], role='UNASSIGNED', roleKind=null;
    if(unambiguousAddress) {
      let top=addressEntries[0];
      while(names.length<LABEL_BLOCK_POLICY.maxNameLines) {
        const predicate=a=>a.name || !!a.heading;
        const bounded=predecessors(top,all,predicate);
        const near=[...new Map([...bounded,...blockedPredecessorAlternatives(top,all,predicate)].map(e=>[e.index,e])).values()];
        if(near.length>1) {
          warnings.push('COMPETING_NAME_OR_ROLE_ROWS');
          issues.push({code:'COMPETING_NAME_OR_ROLE_ROWS',rowIds:near.map(e=>e.row.id)});
          const roleRows=near.filter(a=>a.heading);
          if(roleRows.length>1) { headings=roleRows; role='CONFLICT'; }
          break;
        }
        if(!near.length) break;
        if(near[0].heading) { headings=near; [role,roleKind]=near[0].heading; break; }
        names.unshift(near[0]); top=near[0];
      }
      if(names.length===LABEL_BLOCK_POLICY.maxNameLines && !headings.length) {
        const predicate=a=>a.name || !!a.heading;
        const bounded=predecessors(names[0],all,predicate);
        const near=[...new Map([...bounded,...blockedPredecessorAlternatives(names[0],all,predicate)].map(e=>[e.index,e])).values()];
        if(near.length===1 && near[0].heading) { headings=near; [role,roleKind]=near[0].heading; }
        else if(near.length) {
          warnings.push('NAME_PREFIX_BOUND_REACHED');
          if(near.length>1) {
            warnings.push('COMPETING_NAME_OR_ROLE_ROWS');
            issues.push({code:'COMPETING_NAME_OR_ROLE_ROWS',rowIds:near.map(e=>e.row.id)});
            const roleRows=near.filter(a=>a.heading);
            if(roleRows.length>1) { headings=roleRows; role='CONFLICT'; }
          }
        }
      }
      const countries=successors(anchor,all,a=>a.country);
      if(countries.length===1) addressEntries.push(countries[0]);
      else if(countries.length>1) warnings.push('COMPETING_COUNTRY_ROWS');
    }
    const name=field(names); name.completeness='UNKNOWN';
    if(!names.length) warnings.push('NO_BOUNDED_LITERAL_NAME');
    const address=field(addressEntries);
    address.parts=addressEntries.map(e=>({kind:e===anchor?'LOCALITY_POSTAL':e.country?'COUNTRY':e.unit?'UNIT':'STREET_OR_PO_BOX',value:e.text,sources:[span(e)]}));
    address.completeness=unambiguousAddress?'UNKNOWN':'PARTIAL';
    const entries=[...names,...addressEntries], id=blockId(input.observationId,entries);
    blocks.push({id,role,roleKind,roleEvidence:headings.map(span),name,address,
      reasons:['LITERAL_SOURCE_SPANS_ONLY','NATIVE_POLYGON_LOCAL_ASSOCIATION','POSTAL_ANCHOR_ENDS_ROLE_SCOPE'],warnings,
      reviewStatus:'REVIEW_REQUIRED',postalSyntax:anchor.postal});
  }
  // A heading associated with more than one postal block cannot assign either.
  const headingUse=new Map();
  for(const block of blocks) for(const source of block.roleEvidence) {const n=headingUse.get(source.rowId)||[];n.push(block);headingUse.set(source.rowId,n);}
  for(const [rowId, affected] of headingUse) if(affected.length>1) {
    for(const block of affected) {block.role='CONFLICT';block.roleKind=null;block.warnings.push('HEADING_COMPETES_ACROSS_BLOCKS');}
    issues.push({code:'HEADING_COMPETES_ACROSS_BLOCKS',rowIds:[rowId],blockIds:affected.map(b=>b.id)});
  }
  const used=new Set(blocks.flatMap(b=>[...b.name.sources,...b.address.sources,...b.roleEvidence]).map(s=>s.rowId));
  return {schema:'parcel-snap-label-proposals-v1',policyVersion:LABEL_BLOCK_POLICY.id,policy:clone(LABEL_BLOCK_POLICY),
    reviewOnly:true,opticalAccuracy:'NOT_ASSESSED',observation,blocks,
    unassignedRowIds:all.filter(a=>!used.has(a.row.id)).map(a=>a.row.id),issues};
}
