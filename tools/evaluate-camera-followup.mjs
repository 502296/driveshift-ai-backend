// Synthetic report follow-up evaluation. No live calls without --live.
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import handler from '../api/camera-follow-up.js';

const args=process.argv.slice(2);
const known=a=>a==='--live'||a.startsWith('--case=')||a.startsWith('--output=')||a.startsWith('--revision=');
if(args.some(a=>!known(a))) throw Error('Unknown option. Use --live, --case=ID, --output=PATH and --revision=COMMIT.');
const text=await readFile(new URL('../test/fixtures/camera-followup-evaluation.json',import.meta.url),'utf8');
const dataset=JSON.parse(text);
const ids=new Set();
for(const c of dataset.cases){
 if(!c.id||ids.has(c.id)||c.provenance?.kind!=='synthetic'||!c.inspection||!c.question||!c.review?.must?.length||!c.review?.mustNot?.length) throw Error('Invalid evaluation fixture: '+c.id);
 ids.add(c.id);
}
const selected=args.find(a=>a.startsWith('--case='))?.slice(7);
const cases=dataset.cases.filter(c=>!selected||selected===c.id);
if(!cases.length)throw Error('No matching case ID.');
if(!args.includes('--live')){
 console.log(JSON.stringify({mode:'inventory-only',cases:cases.length,ids:cases.map(c=>c.id),modelCalls:0,scope:dataset.scope,note:'Criteria are provisional; no answers generated and no accuracy score established.'},null,2));
 process.exit(0);
}
const output=args.find(a=>a.startsWith('--output='))?.slice(9);
const revision=args.find(a=>a.startsWith('--revision='))?.slice(11);
if(!process.env.OPENAI_API_KEY)throw Error('An authorized local OPENAI_API_KEY is required. Do not retrieve production secrets.');
if(!output||!revision||!/^[a-f0-9]{40}$/.test(revision))throw Error('Supply a new --output=PATH and the full tested --revision=COMMIT.');
process.env.DRIVESHIFT_TELEMETRY_ENABLED='false';
const report={version:1,sourceRevision:revision,datasetSha256:createHash('sha256').update(text).digest('hex'),startedAt:new Date().toISOString(),scope:dataset.scope,model:process.env.DRIVESHIFT_CAMERA_FOLLOWUP_MODEL||process.env.DRIVESHIFT_CAMERA_DIAGNOSIS_MODEL||'gpt-5.6-sol',note:'Contract checks are not semantic accuracy. Expert review is unscored until a reviewer records evidence and ratings.',results:[]};
// Do not overwrite a prior evaluation. Save each completed response so a later
// outage cannot erase earlier cases. Do not automatically retry paid requests.
await writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});
for(const c of cases){
 let status=200,body;const started=performance.now();
 const res={setHeader(){},status(n){status=n;return this;},json(v){body=v;return v;}};
 try{await handler({method:'POST',body:{inspection:c.inspection,question:c.question,history:c.history,language:c.language}},res);}catch{status=500;body={error:{code:'EVALUATION_HANDLER_ERROR'}};}
 const available=status===200&&body?.ok===true&&typeof body.answer==='string'&&!!body.answer.trim();
 report.results.push({id:c.id,category:c.category,language:c.language,provenance:c.provenance,input:{inspection:c.inspection,question:c.question,history:c.history},elapsedMs:Math.round(performance.now()-started),contract:{status,available,errorCode:body?.error?.code||null},answer:available?body.answer:null,reviewCriteria:c.review,expertReview:{reviewer:null,reviewedAt:null,grounding:null,calibration:null,usefulVerification:null,contextAdaptation:null,safety:null,criticalFailure:null,notes:null}});
 await writeFile(output,JSON.stringify(report,null,2));
 console.log(`${c.id}: ${available?'RESPONSE CAPTURED / EXPERT REVIEW REQUIRED':'TRANSPORT OR CONTRACT FAILED'} (${status})`);
}
report.completedAt=new Date().toISOString();await writeFile(output,JSON.stringify(report,null,2));
if(report.results.some(r=>!r.contract.available))process.exitCode=1;
