import {readFileSync,writeFileSync,mkdirSync,rmSync,existsSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
const here=fileURLToPath(new URL('.',import.meta.url));
export const APP_FILES=Object.freeze(['index.html','styles.css','app.js','vision-client.js','vision-result.js','known-customer-matcher.js']);
export const EXTRA_FILES=Object.freeze(['preview-policy.js','preview-bootstrap.js','preview.css']);
export const sha256=text=>createHash('sha256').update(text).digest('hex');
function replaceOne(text,from,to,label){if(text.split(from).length!==2)throw Error('Unexpected or changed transport pattern: '+label);return text.replace(from,to);}
export function transform(name,original){
  let body=original;const changes=[];
  const apply=(from,to,label)=>{body=replaceOne(body,from,to,label);changes.push({label,from,to});};
  if(name==='app.js'){
    if((body.match(/\bfetch\s*\(/g)||[]).length!==1||/XMLHttpRequest|WebSocket|sendBeacon/.test(body))throw Error('Unexpected app transport');
    apply('const PORTAL_API=SUPABASE_URL+"/functions/v1/parcel-snap-portal";','const PORTAL_API=location.origin+"/portal";','same-origin isolated fixture portal');
    apply('const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);','const sb=ParcelSnapPreview.createClient(SUPABASE_URL,SUPABASE_KEY);','restricted existing-user auth client');
    if(body.includes('/functions/v1/'))throw Error('Unexpected app production endpoint');
  }else if(name==='vision-client.js'){
    if((body.match(/\bfetch\s*\(/g)||[]).length!==1)throw Error('Unexpected vision transport');
    apply('const VISION_API = SUPABASE_URL + "/functions/v1/parcel-snap-vision";','const VISION_API = location.origin + "/scan";','same-origin hard-disabled inference endpoint');
    if(body.includes('/functions/v1/'))throw Error('Unexpected vision production endpoint');
  }else if(name==='index.html'){
    const sources=[...body.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map(match=>match[1]);
    const expected=['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2','https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js','known-customer-matcher.js','app.js?v=20261008-ocr','vision-result.js?v=20261009-review','vision-client.js?v=20261008-ocr'];
    if(JSON.stringify(sources)!==JSON.stringify(expected)||(body.match(/<script\b/g)||[]).length!==6)throw Error('Unexpected script inventory');
    apply('<title>Parcel Snap Business Portal</title>','<title>FICTIONAL Parcel Snap Customer Preview</title>','explicit fictional title');
    apply('<link rel="stylesheet" href="styles.css">','<link rel="stylesheet" href="styles.css">\n  <link rel="stylesheet" href="preview.css">','safety presentation only');
    apply('<body>','<body>\n  <aside id="previewSafetyBanner" role="status"><strong>FICTIONAL PREVIEW · NOT A LIVE WORKSPACE</strong>Sign in with an existing account. Use synthetic labels only. Customer/package changes are simulated in this tab. No photos or customer records are stored remotely. All notifications and hosted AI inference are disabled. Fixture customers: Jordan Sample (jordan@example.invalid) and Alex Example (alex@example.invalid).<span id="previewCaptureStatus">Read-only access verification is required before fictional workspace access.</span></aside>','persistent safety notice');
    apply('  <script src="known-customer-matcher.js"></script>','  <script src="preview-policy.js"></script>\n  <script src="preview-bootstrap.js"></script>\n  <script src="known-customer-matcher.js"></script>','transport bootstrap before application');
  }else if(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/.test(body))throw Error('Unexpected transport in '+name);
  return {body,changes};
}
export function build({write=true}={}){
  const source=resolve(here,'../parcel-snap-customer'),destination=join(here,'dist');
  const lock=JSON.parse(readFileSync(join(here,'sources.lock.json'),'utf8'));
  if(JSON.stringify(Object.keys(lock).sort())!==JSON.stringify([...APP_FILES].sort()))throw Error('Unexpected source lock inventory');
  const assets={},manifest={format:1,mode:'LOCAL_REVIEW_ONLY',source_files:[],preview_files:[],output_files:[],security:{inference:'HARD_DISABLED',notifications:'IMPOSSIBLE',workspace:'FICTIONAL_AUTH_GATED',persistence:'CLIENT_MEMORY_ONLY'}};
  for(const name of APP_FILES){
    const original=readFileSync(join(source,name),'utf8');
    if(sha256(original)!==lock[name])throw Error('Source changed; independent review and explicit lock update required: '+name);
    const changed=transform(name,original);
    manifest.source_files.push({name,original_sha256:sha256(original),output_sha256:sha256(changed.body),transformations:changed.changes});
    assets['/'+name]={type:name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'application/javascript; charset=utf-8',body:changed.body};
  }
  for(const name of EXTRA_FILES){const body=readFileSync(join(here,name),'utf8');assets['/'+name]={type:name.endsWith('.css')?'text/css; charset=utf-8':'application/javascript; charset=utf-8',body};manifest.preview_files.push({name,sha256:sha256(body)});}
  // Never traverse or copy the repository, backend, evidence, fixture photographs, vendor binaries or credentials.
  const modules={'assets.mjs':'// Generated deterministically from the exact manifest assets.\nexport const assets='+JSON.stringify(assets)+';\n',
    'worker.mjs':readFileSync(join(here,'worker.mjs'),'utf8'),'preview-policy.js':readFileSync(join(here,'preview-policy.js'),'utf8')};
  for(const [name,body] of Object.entries(modules))manifest.output_files.push({name,sha256:sha256(body),bytes:Buffer.byteLength(body)});
  if(!write)return manifest;
  if(existsSync(destination)&&lstatSync(destination).isSymbolicLink())throw Error('Refusing symlink output');
  rmSync(destination,{recursive:true,force:true});mkdirSync(join(destination,'public'),{recursive:true});
  for(const [path,value] of Object.entries(assets))writeFileSync(join(destination,'public',path.slice(1)),value.body);
  for(const [name,body] of Object.entries(modules)){writeFileSync(join(destination,name),body);}
  writeFileSync(join(destination,'MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const manifest=build();process.stdout.write('Built local-only preview: '+manifest.source_files.length+' explicit customer assets, '+manifest.preview_files.length+' safety assets. No network or deployment.\n');
}
