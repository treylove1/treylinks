/* Pinned upstream decoder: same-origin code/WASM only; no image upload. */
'use strict';
importScripts('./vendor/zxing-wasm-3.1.5/reader.js');
ZXingWASM.prepareZXingModule({overrides:{locateFile:path=>{
  if(path!=='zxing_reader.wasm')throw new Error('Unexpected decoder asset');
  return new URL('./vendor/zxing-wasm-3.1.5/zxing_reader.wasm',self.location.href).href;
}}});
self.onmessage=async event=>{
  try{
    const {data,width,height}=event.data||{};
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||
      width>3200||height>3200||width*height>6000000||
      !(data instanceof Uint8ClampedArray)||data.length!==width*height*4)throw new Error('Invalid image');
    const results=await ZXingWASM.readBarcodes({data,width,height},{
      formats:['DataMatrix','QRCode','Code128','Code39','EAN13','EAN8','UPCA','UPCE','ITF','Codabar'],
      tryHarder:true,tryRotate:true,tryInvert:true,tryDownscale:true,
      maxNumberOfSymbols:32,returnErrors:false,textMode:'Plain'
    });
    self.postMessage(results.filter(result=>result.isValid===true&&!result.error)
      .map(result=>({rawValue:result.text,format:result.format,decoded:true}))
      .filter(result=>typeof result.rawValue==='string'&&result.rawValue.trim().length>=6&&result.rawValue.length<=200));
  }catch{self.postMessage([]);}
};
