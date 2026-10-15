#!/usr/bin/env node
// Explicit live evaluation. One paid model request per run; no automatic retries.
import {readFile,writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {cameraImage} from '../lib/camera/mechanic.js';
const {values:o}=parseArgs({options:{'base-url':{type:'string'},image:{type:'string'},width:{type:'string'},height:{type:'string'},expected:{type:'string'},out:{type:'string'},'dry-run':{type:'boolean',default:false}}});
try {
 if (!o['base-url']||!o.image) throw new Error('Required: --base-url HTTPS_PREVIEW_URL --image FILE --width PIXELS --height PIXELS. Optional: --expected "transmission" --out result.json --dry-run. A live run sends the image to your backend and uses one model request.');
 const base=new URL(o['base-url']);
 if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw new Error('Use a clean HTTPS deployment URL.');
 const width=Number(o.width),height=Number(o.height);
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>20000||height>20000)throw new Error('Provide the actual image width and height in pixels.');
 const bytes=await readFile(o.image),image=bytes.toString('base64');
 const imagePart=cameraImage(image);const mime=/data:image\/([^;]+)/.exec(imagePart.image_url)[1];
 const evidence={capture:{format:mime,inspectionTarget:'unknown',widthPixels:width,heightPixels:height,fileSizeBytes:bytes.length},imageQuality:{state:'usable',metrics:[],limitations:['Evaluation input: image quality has not been measured by the Flutter pipeline.']},ocr:{state:'no_text',blocks:[],limitations:['Evaluation input: local OCR has not run.']}};
 const workspace={version:1,question:'',annotations:[]};
 if(o['dry-run']){console.log(JSON.stringify({dryRun:true,width,height,bytes:bytes.length,mime,requests:1,baseUrl:base.origin}));process.exit(0);}
 async function post(route,body){const start=performance.now();const response=await fetch(new URL(route,base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(55000),redirect:'error'});const raw=await response.text();let data;try{data=JSON.parse(raw)}catch{throw new Error(`${route}: non-JSON HTTP ${response.status}`)}if(!response.ok||data.ok!==true){const failure={ok:false,httpStatus:response.status,elapsedMs:Math.round(performance.now()-start),error:data.error};if(o.out)await writeFile(o.out,JSON.stringify(failure,null,2)+'\n',{flag:'wx'});throw new Error(`${route}: HTTP ${response.status}; ${data.error?.code||'invalid response'}`);}return {ms:Math.round(performance.now()-start),data};}
 const total=performance.now();
 const inspection=await post('/api/camera-inspect',{image,cameraEvidence:evidence,cameraWorkspace:workspace,language:'en'});
 const names=(inspection.data.visualEvidence.components||[]).map(c=>c.name);
 const result={timestamp:new Date().toISOString(),baseUrl:base.origin,timingMs:{request:inspection.ms,total:Math.round(performance.now()-total)},serverTiming:inspection.data.timing,expectedComponent:o.expected||null,expectedNameMentioned:o.expected?names.some(n=>n.toLowerCase().includes(o.expected.toLowerCase())):null,requiresHumanAccuracyReview:true,visualEvidence:inspection.data.visualEvidence,diagnosis:inspection.data.diagnosis,display:inspection.data.display};
 const json=JSON.stringify(result,null,2);if(o.out)await writeFile(o.out,json+'\n',{flag:'wx'});console.log(json);
} catch(e){console.error(e.name==='TimeoutError'?'Evaluation timed out; no automatic retry was made.':e.message);process.exitCode=1;}
