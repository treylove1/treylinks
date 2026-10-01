import fs from "node:fs";

const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");
const vision=fs.readFileSync(new URL("../vision-client.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");

function expect(label,condition){
  if(!condition)throw new Error(label+" FAILED");
  console.log(label,"PASS");
}

expect("persistent OCR worker exists",app.includes("getParcelSnapOcrWorker"));
expect("worker recognize is reused",app.includes("worker.recognize(image)"));
expect("Tesseract worker is tuned for sparse label text",app.includes('tessedit_pageseg_mode:"11"'));
expect("no direct Tesseract.recognize in live app",!app.includes("Tesseract.recognize("));
expect("old package rotation OCR loop removed",!app.includes("for(const angle of [-5,5,-9,9])"));
expect("old transfer three-pass OCR array removed",!app.includes("passes=[enhanced,await rotateDataUrl(enhanced,-5),await rotateDataUrl(enhanced,5)]"));
expect("label region detector exists",app.includes("detectBrightLabelRegion"));
expect("OCR uses canvas-native crop",app.includes("ocrCanvas"));
expect("browser OCR upgraded to Tesseract v6",html.includes("tesseract.js@6"));
expect("instant package preview exists",vision.includes("URL.createObjectURL(file)"));
expect("local OCR uses cropped canvas",vision.includes("readPackagePhoto(prepared.ocrCanvas)"));
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
