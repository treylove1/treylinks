import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

// Fictional text and constructed polygons only. The override proves the new
// geometry regressions fail against a separately retained, unmodified parser.
const source=process.env.PARCEL_SNAP_GEOMETRY_TEST_ROOT
  ? pathToFileURL(process.env.PARCEL_SNAP_GEOMETRY_TEST_ROOT.replace(/\/$/,'')+'/paddle-label-blocks.js')
  : new URL('../../paddle-label-blocks.js',import.meta.url);
const {projectPaddleLabelBlocks,LABEL_BLOCK_POLICY}=await import(source);
function polygon(x,y,w,h,angle=0) {
  const r=angle*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
  return [[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([u,v])=>[700+u*c-v*s,700+u*s+v*c]);
}
function rows(entries,angle=0) {
  return entries.map(({text,x=10,y=0,w=280,h=40,frameId='fictional-frame',poly,turn=angle},index)=>({
    id:`fictional-row-${index}`,source:'paddleocr-native-line',nativeSourceIndex:index,
    frameId,text,poly:poly===undefined?polygon(x,y,w,h,turn):poly,
  }));
}
function project(entries,angle=0) {
  const input={observationId:'fictional-observation',photoId:'fictional-photo',photoSha256:'a'.repeat(64),rawResultSha256:'b'.repeat(64),rows:rows(entries,angle)};
  const before=JSON.stringify(input),result=projectPaddleLabelBlocks(input);
  assert.equal(JSON.stringify(input),before,'Literal input and native polygons remain untouched');
  assert.equal(result.reviewOnly,true);assert.equal(result.opticalAccuracy,'NOT_ASSESSED');
  for(const block of result.blocks)for(const field of [block.name,block.address]) {
    assert.equal(field.value,field.sources.map(s=>s.text).join('\n'));
    for(const span of field.sources)assert.equal(span.text,input.rows[span.rowIndex].text.slice(span.start,span.end));
  }
  return result;
}
const tight=[
  {text:'RETURN ADDRESS',y:0},
  {text:'Fictional Supply Co',y:38},
  {text:'18 Imaginary Way',y:76},
  {text:'Example CA 90210',y:114},
];
const address=(gap=10)=>[
  {text:'18 Imaginary Way',y:0,h:20},
  {text:'Example CA 90210',y:20+gap,h:20},
];
function assertPartial(result) {
  assert.equal(result.blocks.length,1);
  assert.equal(result.blocks[0].address.completeness,'PARTIAL');
  assert.deepEqual(result.blocks[0].address.literalLines,['Example CA 90210']);
  assert.equal(result.blocks[0].name.value,'');assert.equal(result.blocks[0].role,'UNASSIGNED');
}

for(const angle of [-145,-90,-22,0,31,90,145])test(`tight neighboring detector boxes join at ${angle} degrees without outer-envelope blockers`,()=>{
  const result=project(tight,angle),[block]=result.blocks;
  assert.equal(result.blocks.length,1);assert.equal(block.role,'RETURN');assert.equal(block.roleKind,'RETURN_ADDRESS');
  assert.equal(block.name.value,'Fictional Supply Co');assert.equal(block.address.value,'18 Imaginary Way\nExample CA 90210');
  assert.equal(block.name.completeness,'UNKNOWN');assert.equal(block.address.completeness,'UNKNOWN');
  assert.deepEqual(block.warnings,[]);assert.equal(block.roleEvidence[0].text,'RETURN ADDRESS');
});
for(const angle of [-37,0,57])test(`an actual intervening line blocks the inner gap at ${angle} degrees`,()=>{
  assertPartial(project([...address(20),{text:'PACKAGE NOTE',y:25,h:10}],angle));
});
for(const angle of [-37,0,57])test(`a third polygon crossing an overlapping boundary blocks at ${angle} degrees`,()=>{
  assertPartial(project([...address(-2),{text:'PACKAGE NOTE',y:17,h:5}],angle));
});
for(const angle of [-37,0,57])test(`zero-gap contact still blocks a third polygon at ${angle} degrees`,()=>{
  assertPartial(project([...address(0),{text:'PACKAGE NOTE',y:19,h:2}],angle));
});
test('a third polygon only touching the inner boundary is conservatively obstructing',()=>{
  assertPartial(project([...address(0),{text:'PACKAGE NOTE',y:10,h:10}]));
});
test('empty recognized text remains a geometric obstruction',()=>{
  assertPartial(project([...address(20),{text:'',y:25,h:10}]));
});
test('oversized background polygons spanning the shared boundary remain obstructing',()=>{
  assertPartial(project([...address(),{text:'PACKAGE BACKGROUND',x:-100,y:-100,w:900,h:250}]));
});
test('a competing polygon contained inside an endpoint cannot disappear outside the inner band',()=>{
  assertPartial(project([...address(),{text:'27 Fiction Lane',y:2,h:10}]));
});
test('a contained heading cannot lend authority to an ambiguous endpoint',()=>{
  const [block]=project([{text:'Fictional Supply Co',y:0,h:20},{text:'SHIP TO',y:2,h:10},...address().map(r=>({...r,y:r.y+30}))]).blocks;
  assert.equal(block.name.value,'');assert.equal(block.role,'UNASSIGNED');
});
test('an oversized exterior fringe without ordered-neighbor proof still blocks',()=>{
  assertPartial(project([...address(),{text:'PACKAGE BACKGROUND',y:-100,h:102,w:400}]));
});
test('a malformed exterior fringe without ordered-neighbor proof still blocks',()=>{
  const result=project([...address(),{text:'PACKAGE NOTE',poly:[[710,690],[990,701],[710,701],[990,690]]}]);
  assertPartial(result);assert(result.issues.some(x=>x.code==='INVALID_OR_MISSING_GEOMETRY'));
});
test('an exterior fringe with incompatible orientation still blocks',()=>{
  assertPartial(project([...address(),{text:'PACKAGE NOTE',poly:[[710,690],[710,701],[990,701],[990,690]]}]));
});
test('a perpendicular background polygon cannot be ignored because of its orientation',()=>{
  assertPartial(project([...address(),{text:'PACKAGE BACKGROUND',poly:[[710,710],[710,750],[730,750],[730,710]]}]));
});
test('invalid finite geometry crossing the boundary stays fail-closed',()=>{
  const result=project([...address(),{text:'PACKAGE NOTE',poly:[[710,720],[990,730],[710,730],[990,720]]}]);
  assertPartial(result);assert(result.issues.some(x=>x.code==='INVALID_OR_MISSING_GEOMETRY'));
});
for(const [kind,poly] of [
  ['zero height',[[710,705],[990,705],[990,705],[710,705]]],
  ['zero width',[[720,704],[720,704],[720,708],[720,708]]],
  ['single point',[[720,705],[720,705],[720,705],[720,705]]],
])test(`invalid ${kind} geometry inside an endpoint stays fail-closed`,()=>{
  const result=project([...address(),{text:'PACKAGE NOTE',poly}]);
  assertPartial(result);assert(result.issues.some(x=>x.code==='INVALID_OR_MISSING_GEOMETRY'));
});
test('finite invalid geometry proved outside the pair envelope does not contaminate it',()=>{
  const [block]=project([...address(),{text:'PACKAGE NOTE',poly:[[1720,705],[1720,705],[1720,705],[1720,705]]}]).blocks;
  assert.equal(block.address.completeness,'UNKNOWN');
});
for(const poly of [null,[[NaN,0],[1,0],[1,1],[0,1]],[[0,0],[1,1]]])test('unknown coordinates in the frame cannot establish a safe association: '+JSON.stringify(poly),()=>{
  assertPartial(project([...address(),{text:'PACKAGE NOTE',poly}]));
});
test('rows outside the common horizontal corridor do not obstruct',()=>{
  const [block]=project([...address(),{text:'PACKAGE ADJACENT',x:500,y:21,h:8}]).blocks;
  assert.equal(block.address.value,'18 Imaginary Way\nExample CA 90210');
});
test('another observation frame neither obstructs nor contributes names or headings',()=>{
  const [block]=project([...address(),{text:'SHIP TO',y:-30,h:20,frameId:'another-frame'},{text:'PACKAGE NOTE',y:21,h:8,poly:null,frameId:'another-frame'}]).blocks;
  assert.equal(block.address.completeness,'UNKNOWN');assert.equal(block.role,'UNASSIGNED');assert.equal(block.name.value,'');
});
test('competing street paths stay partial rather than choosing a nearby pallet',()=>{
  const result=project([
    {text:'18 Imaginary Way',x:0,y:0,w:80,h:50},
    {text:'27 Fiction Lane',x:100,y:0,w:80,h:50},
    {text:'Example CA 90210',x:0,y:80,w:180,h:50},
  ]);
  assertPartial(result);assert(result.blocks[0].warnings.includes('COMPETING_ADDRESS_PREDECESSORS'));
});
test('competing literal name paths never pick a name or infer a role',()=>{
  const [block]=project([
    {text:'Fictional Pallet A',x:0,y:0,w:80,h:50},
    {text:'Fictional Pallet B',x:100,y:0,w:80,h:50},
    {text:'18 Imaginary Way',x:0,y:80,w:180,h:50},
    {text:'Example CA 90210',x:0,y:140,w:180,h:50},
  ]).blocks;
  assert.equal(block.name.value,'');assert.equal(block.role,'UNASSIGNED');assert(block.warnings.includes('COMPETING_NAME_OR_ROLE_ROWS'));
});
for(const delta of [-1,0,1]) {
  const line=(text,y)=>({text,y,w:100,h:10});
  test(`overlapping contradictory headings cannot pick the lower role (${delta})`,()=>{
    const [block]=project([line('RETURN',0),line('SHIP TO',delta),line('Fictional Name',20),line('18 Imaginary Way',40),line('Example CA 90210',60)]).blocks;
    assert.equal(block.role,'CONFLICT');assert.deepEqual(block.roleEvidence.map(s=>s.text),['RETURN','SHIP TO']);
    assert(block.warnings.includes('COMPETING_NAME_OR_ROLE_ROWS'));
  });
  test(`overlapping competing names cannot pick the lower name (${delta})`,()=>{
    const [block]=project([line('Fictional Alpha',0),line('Fictional Beta',delta),line('18 Imaginary Way',20),line('Example CA 90210',40)]).blocks;
    assert.equal(block.name.value,'');assert.equal(block.role,'UNASSIGNED');
    assert(block.warnings.includes('COMPETING_NAME_OR_ROLE_ROWS'));
  });
  test(`overlapping competing streets cannot pick the lower street (${delta})`,()=>{
    const result=project([line('18 Imaginary Way',0),line('27 Fiction Lane',delta),line('Example CA 90210',20)]);
    assertPartial(result);assert(result.blocks[0].warnings.includes('COMPETING_ADDRESS_PREDECESSORS'));
  });
}
test('a repaired literal name preserves punctuation, Unicode and exact UTF-16 spans',()=>{
  const entries=tight.map(r=>({...r}));entries[1].text='  J. E\u0301xample / Fictional Co.  ';
  const [block]=project(entries,-21).blocks,s=block.name.sources[0];
  assert.equal(block.name.value,'J. E\u0301xample / Fictional Co.');assert.equal(s.start,2);
  assert.equal(s.text,entries[1].text.slice(s.start,s.end));assert.equal(s.offsetEncoding,'UTF-16');
});
test('mutually blocked headings remain conflicting after the maximum literal name lines',()=>{
  const line=(text,y)=>({text,y,w:100,h:10});
  const [block]=project([line('RETURN',0),line('SHIP TO',1),line('Fictional Company',20),line('Fictional Division',40),line('J Sample',60),line('18 Imaginary Way',80),line('Example CA 90210',100)]).blocks;
  assert.equal(block.name.literalLines.length,3);assert.equal(block.role,'CONFLICT');
  assert(block.warnings.includes('COMPETING_NAME_OR_ROLE_ROWS'));assert(block.warnings.includes('NAME_PREFIX_BOUND_REACHED'));
});
for(const [kind,texts,warning] of [
  ['headings',['RETURN','SHIP TO','Fictional Gamma'],'COMPETING_NAME_OR_ROLE_ROWS'],
  ['names',['Fictional Alpha','Fictional Beta','Fictional Gamma'],'COMPETING_NAME_OR_ROLE_ROWS'],
  ['streets',['18 Imaginary Way','27 Fiction Lane','39 Example Road'],'COMPETING_ADDRESS_PREDECESSORS'],
])test(`an unblocked third candidate cannot hide mutually blocked ${kind}`,()=>{
  const entries=[{text:texts[0],x:0,y:0,w:30,h:20},{text:texts[1],x:0,y:1,w:30,h:20},{text:texts[2],x:35,y:0,w:30,h:20}];
  if(kind!=='streets')entries.push({text:'18 Imaginary Way',x:0,y:40,w:65,h:20});
  entries.push({text:'Example CA 90210',x:0,y:kind==='streets'?40:70,w:65,h:20});
  const result=project(entries),[block]=result.blocks;
  assert(block.warnings.includes(warning));assert.equal(block.name.value,'');
  if(kind==='headings')assert.equal(block.role,'CONFLICT');
  if(kind==='streets')assertPartial(result);
});
test('nearby side-by-side labels preserve separate literal names, addresses and roles',()=>{
  const lower=[{text:'Fictional Pallet',y:0},{text:'27 Fiction Lane',y:38},{text:'Example NY 10001',y:76}].map(r=>({...r,x:500}));
  const blocks=project([...tight,...lower],23).blocks;
  assert.deepEqual(blocks.map(b=>b.role),['RETURN','UNASSIGNED']);
  assert.deepEqual(blocks.map(b=>b.name.value),['Fictional Supply Co','Fictional Pallet']);
});
test('postal anchor still ends role scope before a lower unassigned label',()=>{
  const lower=[{text:'Fictional Pallet',y:200},{text:'27 Fiction Lane',y:238},{text:'Example NY 10001',y:276}];
  const blocks=project([...tight,...lower],-19).blocks;
  assert.deepEqual(blocks.map(b=>b.role),['RETURN','UNASSIGNED']);
  assert.deepEqual(blocks.map(b=>b.name.value),['Fictional Supply Co','Fictional Pallet']);
});
for(const [reason,replace] of [
  ['excess gap',{y:90}],['excess left drift',{x:60}],['insufficient horizontal overlap',{x:45,w:30}],
  ['excess height ratio',{h:60}],['reversed order',{y:-30}],['excess endpoint overlap',{y:10}],
  ['different orientation',{turn:25}],['different frame',{frameId:'other-frame'}],
  ['nonconvex endpoint',{poly:[[710,730],[990,750],[710,750],[990,730]]}],
])test('unchanged endpoint limit rejects '+reason,()=>{
  const entries=address();entries[1]={...entries[1],...replace};
  if(reason==='insufficient horizontal overlap')entries[0].w=40;
  assertPartial(project(entries));
});
test('no numerical association threshold or authority flag is relaxed',()=>{
  assert.equal(LABEL_BLOCK_POLICY.maxAngleDegrees,15);assert.equal(LABEL_BLOCK_POLICY.maxGapHeights,2.5);
  assert.equal(LABEL_BLOCK_POLICY.maxLeftDriftHeights,2);assert.equal(LABEL_BLOCK_POLICY.minHorizontalOverlap,.25);
  assert.equal(LABEL_BLOCK_POLICY.maxHeightRatio,2.5);assert.equal(LABEL_BLOCK_POLICY.maxNameLines,3);assert.equal(LABEL_BLOCK_POLICY.maxUnitLines,2);
  assert.equal(LABEL_BLOCK_POLICY.roleInference,false);assert.equal(LABEL_BLOCK_POLICY.textRepair,false);assert.equal(LABEL_BLOCK_POLICY.automaticSelection,false);
});
