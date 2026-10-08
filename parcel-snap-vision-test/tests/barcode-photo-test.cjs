const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createCanvas,loadImage}=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
const jsQR=require('../vendor/jsQR-1.4.0.js');
const context={window:{jsQR},document:{createElement:()=>createCanvas(1,1)},createImageBitmap:async f=>loadImage(f),setTimeout};vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../barcode-reader.js'),'utf8'),context);
(async()=>{
 const qr=await loadImage('/tmp/parcel-qr-test.png');const photo=createCanvas(2400,3200);const c=photo.getContext('2d');c.fillStyle='#af925e';c.fillRect(0,0,2400,3200);c.drawImage(qr,900,2200,290,290);
 const decoded=await context.window.ParcelBarcode.decodePhoto(photo.toBuffer('image/png'));assert.equal(decoded.raw,'1r1f231d46301835');
 const cancelled=await context.window.ParcelBarcode.decodePhoto(photo.toBuffer('image/png'),()=>false);assert.equal(cancelled.status,'superseded');
 // The same real decoder scans without any vision or OCR function in the context.
 const direct=await context.window.ParcelBarcode.decodePhoto('/tmp/parcel-qr-test.png');assert.equal(direct.raw,'1r1f231d46301835');
 const blank=createCanvas(400,400);blank.getContext('2d').fillRect(0,0,400,400);assert.equal((await context.window.ParcelBarcode.decodePhoto(blank.toBuffer('image/png'))).raw,null);
 console.log('PASS real QR: full label, small code on large photo, no vision/OCR present, stale selection and blank photo');
 // Evidence only: screenshot might lack sufficient QR pixels.
 const screenshot='/workspace/scratch/4455d1171953/upload/01-Screenshot_20261008_080619_Chrome.jpg';if(fs.existsSync(screenshot))console.log('Actual screenshot:',await context.window.ParcelBarcode.decodePhoto(screenshot));
})().catch(e=>{console.error(e);process.exitCode=1});
