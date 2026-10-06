// Local-only replay. Output contains user context and model text: keep it private.
import {readFile,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateRequest} from '../lib/audio-v3/contract.js';
import {buildPrompt} from '../lib/audio-v3/prompt.js';
import {requestReview} from '../lib/audio-v3/provider.js';
import {normalizeReport} from '../lib/audio-v3/report.js';

const args=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const requestPath=option('--request'), outputPath=option('--out');
const dryRun=args.includes('--dry-run');
const runs=Number(option('--runs')||3);
if(!requestPath || !outputPath || !Number.isInteger(runs) || runs<1 || runs>5) {
 throw new Error('Usage: node tools/replay-audio-v3.mjs --request REQUEST.json --out PRIVATE_RESULT.json [--runs 1..5] [--dry-run]');
}
if(!dryRun && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for live replay; --dry-run makes no API calls.');
const input=validateRequest(JSON.parse(await readFile(requestPath,'utf8')));
const snapshot={
 mode:dryRun?'dry_run':'live',
 model:process.env.OPENAI_AUDIO_MODEL||'gpt-audio',
 audioSha256:createHash('sha256').update(Buffer.from(input.audioBase64,'base64')).digest('hex'),
 context:input.context,vehicleProfile:input.vehicleProfile,evidence:input.evidence,
 prompt:buildPrompt(input),runs:[],
};
// Create new private output only; do not overwrite another result.
const handle=await open(outputPath,'wx',0o600);
const checkpoint=async()=>{
 const bytes=Buffer.from(JSON.stringify(snapshot,null,2)+'\n');
 await handle.truncate(0);
 await handle.write(bytes,0,bytes.length,0);
};
try {
 await checkpoint();
 if(!dryRun) for(let i=0;i<runs;i++) {
  try {
   const raw=await requestReview(input,{validateOutput:value=>normalizeReport(value,input)});
   snapshot.runs.push({index:i+1,raw,report:normalizeReport(raw,input)});
  } catch(error) {
   const allowed=['Invalid report contract','Unsupported report claim','Invalid reasoning field','Invalid hypotheses',
    'Invalid hypothesis evidence','Hypotheses conflict with assessment','Invalid provider response','Incomplete provider response'];
   const reason=error?.name==='AbortError'?'PROVIDER_TIMEOUT':error instanceof SyntaxError?'INVALID_JSON':
    /^Audio provider HTTP \d{3}$/.test(error?.message||'')?error.message:
     allowed.includes(error?.message)?error.message:'REVIEW_ERROR';
   snapshot.runs.push({index:i+1,error:reason});
  }
  await checkpoint();
 }
} finally {await handle.close();}
console.log(JSON.stringify({mode:snapshot.mode,audioSha256:snapshot.audioSha256,runs:snapshot.runs.length,output:outputPath}));
