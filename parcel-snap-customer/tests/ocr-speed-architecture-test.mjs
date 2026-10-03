import fs from "node:fs";

const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");
const vision=fs.readFileSync(new URL("../vision-client.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");

function expect(label,condition){
  if(!condition)throw new Error(label+" FAILED");
  console.log(label,"PASS");
}

expect("two-slot OCR engine exists",app.includes("parcelSnapOcrSlots"));
expect("worker recognize is reused",app.includes("worker.recognize(image)"));
expect("fast OCR uses PSM 6",app.includes('PARCEL_SNAP_FAST_PSM="6"'));
expect("no direct Tesseract.recognize in live app",!app.includes("Tesseract.recognize("));
expect("old package rotation OCR loop removed",!app.includes("for(const angle of [-5,5,-9,9])"));
expect("old transfer three-pass OCR array removed",!app.includes("passes=[enhanced,await rotateDataUrl(enhanced,-5),await rotateDataUrl(enhanced,5)]"));
expect("label region detector exists",app.includes("detectBrightLabelRegion"));
expect("OCR uses canvas-native crop",app.includes("ocrCanvas"));
expect("vision passes true raw crop to OCR recovery",vision.includes("raw:prepared.rawOcrCanvas"));
expect("matcher decision is authoritative",app.includes("function decideCustomer"));
expect("adaptive binarization exists",app.includes("adaptiveBinarizeCanvas"));
expect("deskew estimator exists",app.includes("estimateSkewDegrees"));
expect("recovery worker can be stopped",app.includes("stopRecoveryOcr"));
expect("fast first-pass OCR preprocessing exists",app.includes("prepareFastOcrCanvas"));
expect("blocking OCR crop is capped near 900px",app.includes("fitForOcr(rawOcrCanvas,0,900)"));
expect("recipient focus runs before full recovery passes",app.includes('...(recipientFocus?[{psm:"7"'));
expect("recipient focus uses destination street anchor",app.includes("recipientFocusRectFromLines"));
expect("fast pass requests OCR layout blocks",app.includes("{text:true,blocks:true}"));
expect("browser OCR upgraded to Tesseract v6",html.includes("tesseract.js@6"));
expect("instant package preview exists",vision.includes("URL.createObjectURL(file)"));
expect("local OCR uses cropped canvas",vision.includes("readPackagePhoto(prepared.ocrCanvas,{raw:prepared.rawOcrCanvas})"));
expect("vision is started before local OCR completes",vision.indexOf("visionPromise=analyzePackageWithVision") < vision.indexOf("const local=await readPackagePhoto"));
expect("remote vision is not awaited before local OCR",!vision.includes("await analyzePackageWithVision(prepared.vision)"));

const mainBlock=app.slice(app.indexOf("async function readPackagePhoto"),app.indexOf("function setMode"));
const mainRecognitions=(mainBlock.match(/fastOcrRecognize\(/g)||[]).length;
expect("package intake has at most two OCR recognition calls in code path",mainRecognitions<=2);

const transferStart=app.indexOf("async function analyzeTransferImage");
const transferEnd=app.indexOf('$("#transferPhoto")',transferStart);
const transferBlock=app.slice(transferStart,transferEnd);
const transferRecognitions=(transferBlock.match(/fastOcrRecognize\(/g)||[]).length;
expect("transfer intake has at most two OCR recognition calls in code path",transferRecognitions<=2);

console.log("OCR speed architecture regression tests passed");
