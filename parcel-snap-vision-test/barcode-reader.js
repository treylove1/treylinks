/* QR decoding is local and independent of the vision proxy and OCR. */
(() => {
 async function decodePhoto(file,stillCurrent=()=>true){
  let image;
  try{image=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{image=await loadImage(await readFileDataUrl(file));}
  try{
   const scale=Math.min(1,3200/Math.max(image.width,image.height));
   const full=document.createElement('canvas');full.width=Math.round(image.width*scale);full.height=Math.round(image.height*scale);
   full.getContext('2d',{willReadFrequently:true}).drawImage(image,0,0,full.width,full.height);
   const canvases=[full];
   // Overlapping windows enlarge small codes without using the broken label crop.
   for(const y of [0,.25,.5])for(const x of [0,.25,.5]){
    const c=document.createElement('canvas');c.width=Math.ceil(full.width*.5);c.height=Math.ceil(full.height*.5);
    c.getContext('2d',{willReadFrequently:true}).drawImage(full,Math.floor(full.width*x),Math.floor(full.height*y),c.width,c.height,0,0,c.width,c.height);canvases.push(c);
   }
   if(typeof BarcodeDetector!=='undefined'){
    try{const formats=await BarcodeDetector.getSupportedFormats();const detector=new BarcodeDetector({formats:formats.filter(f=>['qr_code','code_128','code_39','ean_13','data_matrix','pdf417'].includes(f))});
     const results=await detector.detect(full);if(results.length===1&&results[0].rawValue)return {raw:results[0].rawValue,status:'decoded'};
     if(results.length>1)return {raw:null,status:'Multiple codes detected — verify tracking manually'};
    }catch{}
   }
   if(typeof window.jsQR!=='function')return {raw:null,status:'QR decoder failed to load — refresh online'};
   for(const canvas of canvases){
    if(!stillCurrent())return {raw:null,status:'superseded'};
    await new Promise(resolve=>setTimeout(resolve,0));
    const pixels=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height);
    const result=window.jsQR(pixels.data,canvas.width,canvas.height,{inversionAttempts:'attemptBoth'});
    if(result?.data)return {raw:result.data,status:'decoded'};
   }
   // ZXing provides a second local pass for non-QR barcodes when available.
   if(typeof ZXingBrowser!=='undefined'){
    const reader=new ZXingBrowser.BrowserMultiFormatReader();
    for(const canvas of canvases.slice(0,2)){try{const result=reader.decodeFromCanvas(canvas);if(result?.getText())return {raw:result.getText(),status:'decoded'};}catch{}}
   }
   return {raw:null,status:'Code not decoded — take a closer, sharp photo'};
  }finally{image.close?.();}
 }
 window.ParcelBarcode={decodePhoto};
})();
