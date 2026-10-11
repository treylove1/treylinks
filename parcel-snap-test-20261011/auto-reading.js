// Frozen recipe measured with six private photos using Tesseract.js6.0.1 Node/WASM.
// Engine confidence chooses a whole reading only. It cannot establish correctness.
export const BUILD_ID='ps-20261011-reader-05';
export const AUTO_RECIPE=Object.freeze({id:'sparse-four-orientation-deskew-v1',rotations:Object.freeze([0,90,180,270]),psm:11,rotateAuto:true,perReadTimeoutMs:90_000,batchTimeoutMs:360_000,maxRunsPerPhoto:6,summaryReserveBytes:65_536,score:'sum Unicode letters/digits per word × max(0, finite native confidence − 50); missing/nonfinite confidence contributes0; ties keep earliest0/90/180/270',opticalAccuracy:'NOT_ASSESSED'});
export function wholePassScore(data){
 let score=0;
 for(const block of data?.blocks||[])for(const para of block.paragraphs||[])for(const line of para.lines||[])for(const word of line.words||[]){
  const count=(String(word.text??'').match(/[\p{L}\p{N}]/gu)||[]).length;
  score+=count*Math.max(0,(Number.isFinite(word.confidence)?word.confidence:0)-50);
 }
 return score;
}
export function selectWholePass(attempts){
 let best=null;
 for(const rotation of AUTO_RECIPE.rotations){
  const pass=attempts.find(p=>p.rotation===rotation&&p.status==='COMPLETE'&&Number.isFinite(p.selectionScore));
  if(pass&&(!best||pass.selectionScore>best.selectionScore))best=pass;
 }
 return best;
}
export function rotationLabel(rotation){return rotation===0?'Original orientation':rotation===90?'90° clockwise':rotation===180?'180° turned':'270° clockwise';}
