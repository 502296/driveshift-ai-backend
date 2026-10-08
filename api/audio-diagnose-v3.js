import {assertNextQuestion} from '../lib/audio-v3/diagnostic-state.js';
import {startInterview} from '../lib/audio-v3/interview.js';
import {InputError,validateRequest} from '../lib/audio-v3/contract.js';
import {requestReview} from '../lib/audio-v3/provider.js';
import {normalizeReport} from '../lib/audio-v3/report.js';
// Independent endpoint: existing Audio V2 and all other routes remain intact.
export function createHandler({review=requestReview, getApiKey=()=>process.env.OPENAI_API_KEY, logFailure=(detail)=>console.warn("AudioV3 review failed",detail)}={}) {
 return async function handler(req,res) {
  res.setHeader?.('Cache-Control','no-store');
  if(req.method!=='POST') {res.setHeader?.('Allow','POST');return res.status(405).json({code:'METHOD_NOT_ALLOWED'});}
  let input;
  try {input=validateRequest(req.body);} catch(error) {
   return res.status(400).json({code:'INVALID_AUDIO_V3_REQUEST',error:error instanceof InputError?error.message:'Invalid request'});
  }
  if(!getApiKey()) return res.status(503).json({code:'AUDIO_SERVICE_UNAVAILABLE'});
  let phase='provider';
  try {
   const prepare=value=>{
    const started=startInterview(value,input);
    if(input.interviewRequired && started.sessionStatus==='follow_up') assertNextQuestion(started.followUpQuestion,input);
    return normalizeReport(started,input,{requireConsistentAssessment:input.interviewRequired});
   };
   const raw=await review(input,{apiKey:getApiKey(),onStage:stage=>{phase=stage;},validateOutput:prepare});
   phase='report_validation';
   return res.status(200).json({report:prepare(raw)});
  } catch(error) {
   // Only controlled diagnostic codes; never input or provider response text.
   const known={
    'Invalid report contract':'INVALID_REPORT_CONTRACT',
    'Invalid report consistency':'INVALID_REPORT_CONSISTENCY',
    'Unsupported report claim':'UNSUPPORTED_CLAIM',
    'Invalid reasoning field':'INVALID_REASONING_FIELD',
    'Invalid hypotheses':'INVALID_HYPOTHESES',
    'Redundant follow-up question':'REDUNDANT_QUESTION',
    'Invalid hypothesis evidence':'INVALID_HYPOTHESIS_EVIDENCE',
    'Hypotheses conflict with assessment':'CONFLICTING_ASSESSMENT',
    'Invalid provider response':'INVALID_PROVIDER_RESPONSE',
    'Incomplete provider response':'INCOMPLETE_PROVIDER_RESPONSE',
   };
   const message=String(error?.message||'');
   const reason=known[message] || (error?.name==='AbortError'?'PROVIDER_TIMEOUT':
    /^Audio provider HTTP \d{3}$/.test(message)?'PROVIDER_HTTP_ERROR':
     error instanceof SyntaxError?'INVALID_PROVIDER_JSON':'REVIEW_ERROR');
   try { logFailure({phase,reason,...(error?.field ? {field:error.field} : {})}); } catch { /* logging must not break the response */ }
   return res.status(502).json({code:'AUDIO_V3_REVIEW_FAILED',phase,reason});
  }
 };
}
export default createHandler();
