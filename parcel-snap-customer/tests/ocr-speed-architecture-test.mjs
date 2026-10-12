/**
 * Offline architecture regression for the reviewed Paddle full-photo reader.
 * Run: node --test tests/ocr-speed-architecture-test.mjs
 * No SDK/worker is executed, no image is optically read, and no request is made.
 * Source checks, synthetic geometry and byte integrity do not establish optical
 * accuracy, phone compatibility, latency, or a successful browser network trace.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {PADDLE_SETTINGS, PADDLE_PARAMS, paddlePreparation, drawPaddleFrame} from '../local-reader/paddle-source.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtimeDir = 'local-reader/paddle-runtime/';
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const app = read('app.js'), html = read('index.html');
const intake = read('free-intake-reader.mjs'), engine = read('local-reader/paddle-reader.js');
const source = read('local-reader/paddle-source.js'), runtime = read(runtimeDir + 'paddle-runtime.mjs');
const worker = read(runtimeDir + 'paddle-worker.mjs');
const manifest = JSON.parse(read(runtimeDir + 'asset-manifest.json'));
const sourceBlock = (start, end) => {
  const from = app.indexOf(start), to = app.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Missing architecture boundary: ${start} / ${end}`);
  return app.slice(from, to);
};
const photo = sourceBlock('$("packagePhoto").onchange=', 'bindPhotoSources("packagePhoto"');
const explicitRead = sourceBlock('async function readLocalLabel()', 'function cancelLocalLabel()');
const cancel = sourceBlock('function cancelLocalLabel()', 'function resetLabelConfirmation()');
const clear = sourceBlock('function clearLocalIntakeScope()', 'async function getLocalIntakeReader()');
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(m => m[1]);
const externalScripts = scripts.filter(ref => /^(?:https?:)?\/\//i.test(ref));
const localScripts = scripts.filter(ref => !externalScripts.includes(ref));
const clean = ref => ref.split(/[?#]/, 1)[0];
const relativeFile = (parent, ref) => path.posix.normalize(path.posix.join(path.posix.dirname(parent), clean(ref)));
const absent = files => files.filter(name => !fs.existsSync(path.join(root, name)));

test('live HTML loads review policy before app and never loads legacy vision or Tesseract', () => {
  assert(localScripts.some(ref => clean(ref) === 'app.js'));
  assert(scripts.findIndex(ref => clean(ref) === 'intake-review.js') >= 0);
  assert(scripts.findIndex(ref => clean(ref) === 'intake-review.js') < scripts.findIndex(ref => clean(ref) === 'app.js'));
  assert(!scripts.some(ref => /vision-(?:client|result)|tesseract/i.test(ref)));
  assert.deepEqual(absent(localScripts.map(clean)), []);
});
test('external page bootstrap dependency is explicit and bounded', () => {
  // Supabase is a page/auth dependency, not a local OCR asset. An offline
  // reader closure must not be mislabeled as an entirely offline application.
  assert.deepEqual(externalScripts.filter(ref => ref !== 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'), []);
});
test('photo selection only prepares a local photo and reserves identity before async work', () => {
  assert.match(photo, /await reader\.open\(file/);
  assert(photo.indexOf('clearLocalIntakeScope()') < photo.indexOf('await getLocalIntakeReader()'));
  assert.match(photo, /if\(token!==intakeReadToken\)return/);
  assert(!/reader\.read\(|readPackagePhoto\(|fastOcrRecognize\(|analyzePackageWithVision|detectBarcode\(|\bfetch\(|\bapi\(/.test(photo));
});
test('reading and canceling require their explicit UI actions', () => {
  for (const id of ['readLocalLabel', 'cancelLocalLabel', 'localPhotoStatus', 'localReaderFrame']) assert(html.includes(`id="${id}"`));
  assert.match(app, /\$\("readLocalLabel"\)\.onclick=readLocalLabel/);
  assert.match(app, /\$\("cancelLocalLabel"\)\.onclick=cancelLocalLabel/);
  assert.match(explicitRead, /if\(!localPhotoReady\|\|intakePhotoPending\|\|localReadBusy\)return/);
  assert.equal((explicitRead.match(/await reader\.read\(/g) || []).length, 1);
  assert(!/(?:setTimeout|requestIdleCallback)\(warmParcelSnapOcr/.test(app));
});
test('current read cannot fall back to legacy OCR, hosted vision, uploads, or automatic customer assignment', () => {
  assert(!/Tesseract|fastOcrRecognize|readPackagePhoto\(|analyzePackageWithVision|\bfetch\(|\bapi\(|\.upload\(|\.value\s*=/.test(explicitRead));
  assert.match(app, /import\('\.\/free-intake-reader\.mjs'\)/);
  assert.match(intake, /loadRuntime=\(\)=>import\('\.\/local-reader\/paddle-runtime\/paddle-runtime\.mjs'\)/);
});
test('photo, actor, tenant and edit generations guard local results', () => {
  assert.equal((explicitRead.match(/token!==intakeReadToken\|\|companyId!==workspace\?\.company\?\.id\|\|actorId!==workspaceActorId/g) || []).length, 2);
  assert.match(explicitRead, /edits!==intakeFieldEditGeneration/);
  assert.match(explicitRead, /validateProposalBinding\(result\.observation\?\.proposals,result\.observation\)/);
  assert.match(clear, /intakeReadToken\+\+;localIntakeReader\?\.clear\(\)/);
  assert.match(cancel, /intakeReadToken\+\+;localIntakeReader\?\.cancel\(\)/);
});
test('review uses local object URLs with explicit cleanup', () => {
  assert.match(explicitRead, /URL\.createObjectURL\(result\.frameBlob\)/);
  assert.match(app, /URL\.revokeObjectURL\(localFrameUrl\)/);
  assert.match(app, /addEventListener\('pagehide',\(\)=>\{clearLocalIntakeScope\(\)/);
  assert(!/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|\.upload\(|https?:\/\//.test(intake));
});
test('input, evidence, row and wall-clock limits are explicit', () => {
  assert.equal(PADDLE_SETTINGS.maxFileBytes, 20 * 1024 * 1024);
  assert.equal(PADDLE_SETTINGS.maxSourcePixels, 40_000_000);
  assert.equal(PADDLE_SETTINGS.maxInputPixels, 10_000_000);
  assert.equal(PADDLE_SETTINGS.maxResultBytes, 2 * 1024 * 1024);
  assert.equal(PADDLE_SETTINGS.maxRows, 500);
  assert.equal(PADDLE_SETTINGS.maxRowChars, 4096);
  assert.equal(PADDLE_SETTINGS.timeoutMs, 180_000);
  assert.match(intake, /this\.passCount>=6\|\|this\.storedBytes>=16\*1024\*1024/);
  assert.match(intake, /MAX_PREVIEW=16\*1024\*1024,MAX_EVIDENCE=6\*1024\*1024/);
  assert.match(engine, /setTimeout\(\(\)=>this\.cancel\(/);
});
test('synthetic frame preparation never crops or rotates and stays inside the pixel bound', () => {
  for (const [width, height] of [[1, 1], [4000, 2500], [4000, 3000], [8000, 5000]]) {
    const plan = paddlePreparation(width, height);
    assert.equal(plan.crop, null); assert.equal(plan.rotation, 0);
    assert(plan.width * plan.height <= 10_000_000);
    assert.equal(plan.resized, width * height > 10_000_000);
    const calls = [], bitmap = {width, height}, context = {drawImage: (...args) => calls.push(args)};
    drawPaddleFrame(context, bitmap, plan);
    assert.deepEqual(calls, [plan.resized ? [bitmap, 0, 0, plan.width, plan.height] : [bitmap, 0, 0]]);
  }
  for (const [width, height] of [[0, 2], [1.5, 2], [8000, 5001], [Infinity, 1]]) assert.throws(() => paddlePreparation(width, height));
});
test('one full-frame prediction is bounded on main thread and in worker', () => {
  assert.equal((intake.match(/this\.engine\.read\(/g) || []).length, 1);
  assert.equal((engine.match(/api\.predict\(/g) || []).length, 1);
  assert.match(runtime, /if \(predicted\).*exactly one prediction/);
  assert.match(worker, /Exactly one full-frame prediction is permitted/);
  assert.match(worker, /width × height × 4 RGBA bytes/);
  assert.match(worker, /at most 10 megapixels/);
  assert.match(worker, /OCR output exceeds the 2 MiB result limit/);
  assert.equal(PADDLE_PARAMS.textDetMaxSideLimit, 1280);
});
test('dedicated worker cancellation, failed-cleanup lock and late-import fence remain intact', () => {
  assert.match(runtime, /new Worker\(new URL\('paddle-worker\.mjs', runtimeBase\(baseURL\)\), \{ type: 'module'/);
  assert.match(engine, /if\(this\.busy\)throw/);
  assert.match(engine, /if\(!this\.runtimePromise\)this\.runtimePromise=/);
  const importEnd = engine.indexOf('const runtime=await this.runtimePromise');
  const workerStart = engine.indexOf('api=runtime.createRuntime', importEnd);
  assert.match(engine.slice(importEnd, workerStart), /if\(op\.canceled\)throw new PaddleCanceled/);
  assert.match(engine, /this\.terminate\(op\)/);
  assert.match(engine, /blockedReason='Paddle worker cleanup failed/);
  assert.match(runtime, /for \(const entry of pending\.values\(\)\) entry\.reject\(error\)/);
  assert.match(runtime, /nativeTerminate\(\)/);
});
test('source frame and raw native return binding are checked before accepting proposals', () => {
  for (const snippet of ['output.input?.pixelSha256!==pixelSha256', 'output.input?.sourceSha256!==photo.sha256', 'native.image.width!==plan.width', 'native.image.height!==plan.height']) assert(intake.includes(snippet));
  assert.match(worker, /Transferred pixel hash mismatch/);
  assert.match(source, /Paddle final results do not match their native source returns/);
  assert.match(intake, /rawResultSha256=await this\.hash\(new TextEncoder\(\)\.encode\(JSON\.stringify\(raw\)\)\)/);
  assert.match(intake, /observation:freeze\(observation\)/);
});
test('review-only evidence makes no optical accuracy or phone-speed claim', () => {
  assert.equal(PADDLE_SETTINGS.phoneAccuracy, 'NOT_VALIDATED');
  assert.match(intake, /reviewOnly:true,roleVerified:false/);
  assert.match(read('paddle-label-blocks.js'), /opticalAccuracy:'NOT_ASSESSED'/);
  assert.match(source, /not calibrated field confidence/);
  assert.match(html, /Phone speed and camera behavior need separate testing/);
});
test('runtime permits only same-origin pinned GET assets, without request body, headers or credentials', () => {
  assert.match(runtime, /base\.origin !== globalThis\.location\.origin/);
  for (const text of ['Blocked unexpected OCR asset request.', 'OCR asset requests must use GET.', 'OCR asset requests cannot have a body.', 'OCR asset requests cannot have headers.', 'OCR asset integrity mismatch.', 'XMLHttpRequest is disabled in the local OCR worker']) assert(worker.includes(text));
  assert.match(worker, /method:"GET",credentials:"omit",redirect:"error"/);
  assert.match(worker, /self\.fetch=\w+/);
  assert.match(worker, /worker:!1,initialize:!1,fetch:/);
  assert.match(worker, /backend:"wasm",numThreads:1,proxy:!1,wasmPaths:new URL\("vendor\/ort\/"/);
  for (const model of ['det', 'rec']) assert(worker.includes(`new URL("models/PP-OCRv6_small_${model}.tar",`));
});

// Literal module references are inventoried recursively. Variable asset imports
// inside pinned upstream bundles are covered by the runtime manifest and the
// frozen configuration checks above, not represented as an executed trace.
const readerEntries = ['free-intake-reader.mjs', runtimeDir + 'paddle-runtime.mjs', runtimeDir + 'paddle-worker.mjs', runtimeDir + 'vendor/ort/ort-wasm-simd-threaded.mjs'];
const seen = new Set(), literalExternals = new Set(), missing = new Set();
const nodeOnlyImports = new Set(['module', 'worker_threads']);
function visit(file) {
  if (seen.has(file)) return;
  seen.add(file);
  if (!fs.existsSync(path.join(root, file))) {missing.add(file); return;}
  const text = read(file);
  const expressions = [/(?:import|export)\s+(?:[^;\n]*?\sfrom\s*)?["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g];
  for (const expression of expressions) for (const [, ref] of text.matchAll(expression)) {
    if (nodeOnlyImports.has(ref) && file === runtimeDir + 'vendor/ort/ort-wasm-simd-threaded.mjs') continue;
    if (!ref.startsWith('./') && !ref.startsWith('../')) {literalExternals.add(`${file} -> ${ref}`); continue;}
    visit(relativeFile(file, ref));
  }
}
readerEntries.forEach(visit);
const localPageAssets = [...localScripts.map(clean), ...[...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["']/gi)].map(m => m[1]).filter(ref => !/^(?:https?:)?\/\//.test(ref)).map(clean)];
for (const file of absent(localPageAssets)) missing.add(file);
test('local page assets and literal local-reader module closure contain no missing files or external imports', () => {
  assert.deepEqual([...missing], []);
  assert.deepEqual([...literalExternals], []);
  for (const name of ['local-reader/paddle-reader.js', 'local-reader/paddle-source.js', 'local-reader/paddle-fields.js', 'local-reader/reader-fields.js', 'paddle-label-blocks.js', runtimeDir + 'chunks/ort.wasm.min-CLmHixNU.mjs']) assert(seen.has(name), `Not inventoried: ${name}`);
});
for (const [name, pin] of Object.entries(manifest.files)) test(`Paddle asset byte count and SHA-256: ${name}`, () => {
  assert(!path.isAbsolute(name) && !name.split('/').includes('..'));
  const bytes = fs.readFileSync(path.join(root, runtimeDir, name));
  assert.equal(bytes.length, pin.bytes); assert.equal(sha256(bytes), pin.sha256);
});
test('recognition shards form the complete pinned virtual archive, with no missing logical dependency', () => {
  const shard = manifest.recognitionShards, hash = createHash('sha256');
  let offset = 0;
  shard.parts.forEach((part, index) => {
    assert.equal(part.index, index); assert.equal(part.offset, offset);
    const bytes = fs.readFileSync(path.join(root, runtimeDir, part.path));
    assert.equal(bytes.length, part.bytes); assert.equal(sha256(bytes), part.sha256);
    offset += bytes.length; hash.update(bytes);
  });
  assert.equal(offset, shard.bytes); assert.equal(hash.digest('hex'), shard.sha256);
  assert(manifest.virtualAssets.includes(shard.virtualPath));
  assert.equal(manifest.runtimeAssets[shard.virtualPath].sha256, shard.sha256);
  assert.equal(manifest.runtimeAssets[shard.virtualPath].bytes, shard.bytes);
  for (const name of Object.keys(manifest.runtimeAssets)) assert(manifest.files[name] || manifest.virtualAssets.includes(name), `Uncovered runtime asset: ${name}`);
  assert.equal(Object.entries(manifest.files).filter(([name]) => !name.startsWith('licenses/')).reduce((total, [, pin]) => total + pin.bytes, 0), manifest.runtimePayloadBytes);
});
test('unused upstream nested worker is documented and only omitted under fixed worker:false', () => {
  assert.equal(manifest.omittedAssets.length, 1);
  const omitted = manifest.omittedAssets[0];
  assert.equal(omitted.path, 'vendor/worker-entry-C9UNuyOJ-EhIzhVdm.js');
  assert(worker.includes(omitted.path)); assert.match(worker, /worker:!1,initialize:!1,fetch:/);
  assert.match(omitted.reason, /Unused official nested-worker asset/);
});
test('legacy barcode dependency, though not called by explicit Paddle read, remains pinned and local', () => {
  const barcodeWorker = read('barcode-worker.js'), provenance = JSON.parse(read('vendor/zxing-wasm-3.1.5/PROVENANCE.json'));
  assert.match(read('barcode-reader.js'), /new URL\('barcode-worker\.js\?[^']+',scriptUrl\|\|document\.baseURI\)/);
  assert.match(barcodeWorker, /importScripts\('\.\/vendor\/zxing-wasm-3\.1\.5\/reader\.js'\)/);
  assert.match(barcodeWorker, /if\(path!=='zxing_reader\.wasm'\)throw/);
  assert.match(barcodeWorker, /new URL\('\.\/vendor\/zxing-wasm-3\.1\.5\/zxing_reader\.wasm',self\.location\.href\)/);
  for (const [name, hash] of Object.entries(provenance.sha256)) assert.equal(sha256(fs.readFileSync(path.join(root, 'vendor/zxing-wasm-3.1.5', name))), hash, name);
});
test('dependency inventory is reported without an optical or fully offline page claim', () => {
  console.log('DEPENDENCY_CLOSURE ' + JSON.stringify({
    scope: 'Offline source/manifest inspection; no browser requests, OCR, phone or timing validation',
    missingRequiredFiles: [...missing], externalReaderModuleImports: [...literalExternals],
    externalLiveHtmlScripts: externalScripts, localReaderModuleFiles: [...seen].sort(),
    paddleManifestFilesVerified: Object.keys(manifest.files).length,
    virtualRecognitionArchive: manifest.recognitionShards.virtualPath,
    virtualRecognitionArchiveParts: manifest.recognitionShards.parts.map(part => part.path),
    inactiveOmittedUpstreamAssets: manifest.omittedAssets.map(asset => asset.path),
    inactiveUpstreamFallbacks: ['Paddle SDK CDN/model URLs overridden by pinned same-origin assets and guarded fetch', 'ZXing CDN fallback overridden by exact same-origin locateFile', 'ORT Node-only module/worker_threads imports are not browser dependencies'],
    runtimePayloadBytes: manifest.runtimePayloadBytes,
  }));
});
