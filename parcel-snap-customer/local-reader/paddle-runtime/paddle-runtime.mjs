/** Tiny main-thread client. No OCR SDK, OpenCV, or model imports on this thread. */
export const RUNTIME_VERSION = Object.freeze({ sdk: '0.4.2', ort: '1.22.0', opencv: '4.10.0-release.1', model: 'PP-OCRv6_small', backend: 'wasm', numThreads: 1 });
export const MODEL_ARCHIVE_BYTES = 31211520;
const REQUEST_KIND = 'parcel-ocr-request';
const RESPONSE_KIND = 'parcel-ocr-response';
function runtimeBase(baseURL) {
  const base = new URL(baseURL || './', import.meta.url);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('OCR runtime requires HTTP(S).');
  if (base.origin !== globalThis.location.origin) throw new Error('OCR runtime assets must be same-origin.');
  if (!base.pathname.endsWith('/')) throw new Error('OCR runtime baseURL must end with a slash.');
  return base;
}
/** Feature presence is preflight, not proof of browser or phone OCR compatibility. */
export function getBrowserCapabilities() {
  const checks = { secureContext: globalThis.isSecureContext === true, worker: typeof Worker === 'function', webAssembly: typeof WebAssembly === 'object', sha256: typeof globalThis.crypto?.subtle?.digest === 'function' };
  return { supported: Object.values(checks).every(Boolean), checks };
}
export function createPaddleWorker({ baseURL } = {}) {
  return new Worker(new URL('paddle-worker.mjs', runtimeBase(baseURL)), { type: 'module', name: 'parcel-paddleocr' });
}
export function createRuntime({ baseURL, onWorker, createWorker } = {}) {
  if (!getBrowserCapabilities().supported) throw new Error('Local OCR requires secure-context module workers, WebAssembly, and SHA-256.');
  const worker = createWorker ? createWorker() : createPaddleWorker({ baseURL });
  let terminated = false, nextRequestId = 1, summary = null, initPromise = null, predictionInFlight = false;
  const pending = new Map();
  const nativeTerminate = worker.terminate.bind(worker);
  const observe = (promise) => { promise.catch(() => {}); return promise; };
  function terminate(reason = new Error('Local OCR worker terminated.')) {
    if (terminated) return;
    terminated = true;
    predictionInFlight = false;
    const error = reason instanceof Error ? reason : new Error(String(reason));
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    nativeTerminate();
  }
  worker.terminate = () => terminate();
  worker.addEventListener('message', ({data}) => {
    if (data?.kind !== RESPONSE_KIND) return;
    const entry = pending.get(data.requestId);
    if (!entry) return;
    pending.delete(data.requestId);
    if (data.ok) entry.resolve(data.result);
    else { const error = new Error(data.error?.message || 'Local OCR failed.'); error.name = data.error?.name || 'Error'; entry.reject(error); terminate(error); }
  });
  worker.addEventListener('error', (event) => { event.preventDefault(); terminate(new Error(event.message || 'Local OCR worker failed to load.')); });
  worker.addEventListener('messageerror', () => terminate(new Error('Local OCR worker message could not be decoded.')));
  function request(type, payload = {}, transfer = []) {
    if (terminated) return observe(Promise.reject(new Error('Local OCR worker has terminated.')));
    const requestId = nextRequestId++;
    return observe(new Promise((resolve, reject) => {
      pending.set(requestId, {resolve, reject});
      try { worker.postMessage({kind: REQUEST_KIND, requestId, type, payload}, transfer); }
      catch (error) { pending.delete(requestId); reject(error); terminate(error); }
    }));
  }
  function initialize() {
    if (!initPromise) initPromise = observe(request('initialize').then((result) => {summary = result; return summary;}));
    return initPromise;
  }
  function predict(input, params = {}) {
    if (predictionInFlight) return observe(Promise.reject(new Error('A local OCR prediction is already running.')));
    predictionInFlight = true;
    return observe(
      initialize()
        .then(() => request('predict', {input, params}, [input.buffer]))
        .finally(() => { predictionInFlight = false; })
    );
  }
  function predictRgba({rgba, ...rest}, params = {}) { return predict({...rest, buffer: rgba}, params); }
  function dispose() { return terminated ? Promise.resolve() : observe(request('dispose').finally(() => terminate())); }
  const runtime = {worker, initialize, predict, predictRgba, dispose, getInitializationSummary: () => summary, terminate, get terminated(){ return terminated; }};
  try { onWorker?.(worker); } catch (error) { terminate(error); throw error; }
  return runtime;
}
