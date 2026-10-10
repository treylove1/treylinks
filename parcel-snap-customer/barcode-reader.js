/* Local-only barcode fallback. Pixels stay in a short-lived same-origin worker. */
(() => {
  'use strict';
  const scriptUrl=document.currentScript?.src;
  const workerUrl=new URL('barcode-worker.js?v=20261010-datamatrix',scriptUrl||document.baseURI);
  const MAX_SIDE=3200,MAX_PIXELS=6000000,TIMEOUT_MS=8000;
  async function decode(source){
    if(typeof Worker!=='function')return [];
    const width=source.naturalWidth||source.videoWidth||source.width;
    const height=source.naturalHeight||source.videoHeight||source.height;
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return [];
    const scale=Math.min(1,MAX_SIDE/Math.max(width,height),Math.sqrt(MAX_PIXELS/(width*height)));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.floor(width*scale));canvas.height=Math.max(1,Math.floor(height*scale));
    const context=canvas.getContext('2d',{willReadFrequently:true});
    let pixels;
    try{context.drawImage(source,0,0,canvas.width,canvas.height);pixels=context.getImageData(0,0,canvas.width,canvas.height);}catch{return [];}
    return new Promise(resolve=>{
      let worker,timer,finished=false;
      const finish=results=>{
        if(finished)return;finished=true;clearTimeout(timer);worker?.terminate();
        resolve(Array.isArray(results)?results:[]);
      };
      try{
        worker=new Worker(workerUrl);
        timer=setTimeout(()=>finish([]),TIMEOUT_MS);
        worker.onmessage=event=>finish(event.data);
        worker.onerror=()=>finish([]);
        worker.onmessageerror=()=>finish([]);
        worker.postMessage({data:pixels.data,width:pixels.width,height:pixels.height},[pixels.data.buffer]);
      }catch{finish([]);}
    });
  }
  window.ParcelSnapBarcode={decode};
})();
