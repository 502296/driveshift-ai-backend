import {FollowUpInputError,validateFollowUpRequest,requestFollowUp} from '../lib/audio-v3/followup.js';
import {normalizeReport} from '../lib/audio-v3/report.js';

export function createHandler({review=requestFollowUp,getApiKey=()=>process.env.OPENAI_API_KEY,logFailure=detail=>console.warn('AudioV3 follow-up failed',detail)}={}) {
 return async function handler(req,res) {
  res.setHeader?.('Cache-Control','no-store');
  if(req.method!=='POST') {res.setHeader?.('Allow','POST');return res.status(405).json({code:'METHOD_NOT_ALLOWED'});}
  let input;
  try {input=validateFollowUpRequest(req.body);} catch(error) {
   return res.status(400).json({code:'INVALID_AUDIO_FOLLOWUP_REQUEST',error:error instanceof FollowUpInputError?error.message:'Invalid request'});
  }
  if(!getApiKey()) return res.status(503).json({code:'AUDIO_SERVICE_UNAVAILABLE'});
  try {
   const prepare=raw=>{
    if(!raw||typeof raw!=='object'||!['ask_question','complete'].includes(raw.decision)) throw new Error('Invalid follow-up decision');
    const ask=raw.decision==='ask_question'&&input.answers.length<3;
    if(ask && input.interviewRequired) {
     const key=s=>String(s||'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
     if(input.answers.some(row=>key(row.question)===key(raw.question?.question))) throw new Error('Repeated follow-up question');
    }
    // Infer timing from affirmative answers only, never from the question text.
    const positiveAnswers=input.answers.map(row=>row.answer).filter(answer=>!/^\s*(?:no\b|not sure\b|unsure\b|no estoy seguro\b|no s[eé]\b)/i.test(answer));
    const reportedStarting=positiveAnswers.some(answer=>/\b(?:cranking|cranks|starting|start-up|startup)\b|\b(?:al|durante)\s+(?:arrancar|arranque|encender)/i.test(answer));
    const context={...input.context,engineState:reportedStarting?'starting':input.context.engineState,
     description:`${input.context.description} | User reports ${positiveAnswers.join(' | ')}`.slice(0,1500)};
    const reportInput={language:input.language,ids:input.ids,context,vehicleProfile:input.vehicleProfile};
    const report={...raw.report,sessionStatus:ask?'follow_up':'complete',followUpQuestion:ask?raw.question:null};
    // The text-only follow-up cannot rewrite what the initial audio pass heard.
    if(input.interviewRequired) report.soundObservation=input.session.soundObservation;
    const normalized=normalizeReport(report,reportInput,{allowOccurrenceFollowUp:false,requireConsistentAssessment:input.interviewRequired});
    return {decision:ask?'ask_question':'complete',question:ask?normalized.followUpQuestion:null,report:normalized};
   };
   const raw=await review(input,{apiKey:getApiKey(),validateOutput:prepare});
   return res.status(200).json(prepare(raw));
  } catch(error) {
   const message=String(error?.message||'');
   const reason=message==='Invalid follow-up decision'?'INVALID_FOLLOWUP_DECISION':message==='Invalid follow-up question'?'INVALID_FOLLOWUP_QUESTION':
    /^Audio follow-up provider HTTP \d{3}$/.test(message)?'PROVIDER_HTTP_ERROR':error?.name==='AbortError'?'PROVIDER_TIMEOUT':'FOLLOWUP_FAILED';
   try {logFailure({phase:'followup',reason,...(error?.field?{field:error.field}:{})});} catch {}
   return res.status(502).json({code:'AUDIO_FOLLOWUP_FAILED',reason});
  }
 };
}
export default createHandler();
