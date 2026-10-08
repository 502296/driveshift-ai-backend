import {FollowUpInputError,validateFollowUpRequest,requestFollowUp} from '../lib/audio-v3/followup.js';
import {normalizeReport} from '../lib/audio-v3/report.js';

export function createHandler({review=requestFollowUp,getApiKey=()=>process.env.OPENAI_API_KEY,logFailure=()=>{}}={}) {
 return async function handler(req,res) {
  res.setHeader?.('Cache-Control','no-store');
  if(req.method!=='POST') {res.setHeader?.('Allow','POST');return res.status(405).json({code:'METHOD_NOT_ALLOWED'});}
  let input;
  try {input=validateFollowUpRequest(req.body);} catch(error) {
   return res.status(400).json({code:'INVALID_AUDIO_FOLLOWUP_REQUEST',error:error instanceof FollowUpInputError?error.message:'Invalid request'});
  }
  if(!getApiKey()) return res.status(503).json({code:'AUDIO_SERVICE_UNAVAILABLE'});
  try {
   const raw=await review(input,{apiKey:getApiKey()});
   if(!raw||typeof raw!=='object'||!['ask_question','complete'].includes(raw.decision)) throw new Error('Invalid follow-up decision');
   const ask=raw.decision==='ask_question'&&input.answers.length<3;
   const reportedContext=input.answers.map(row=>`${row.question}: ${row.answer}`).join(' | ');
   const reportedStarting=/(?:while|during|when|at)\s+(?:the\s+)?(?:engine\s+)?(?:cranking|starting|start-up)|\b(?:cranking|cranks|at startup|during startup)\b|(?:mientras|durante|al)\s+(?:arranca|arrancar|encender)/i.test(reportedContext);
   const reportInput={language:input.language,ids:input.ids,context:{origin:'unknown',rpmBehavior:'unknown',engineState:reportedStarting?'starting':'unknown',description:`User reports ${reportedContext}`},vehicleProfile:input.vehicleProfile};
   const normalized=normalizeReport({...raw.report,sessionStatus:ask?'follow_up':'complete',followUpQuestion:ask?raw.question:null},reportInput,{allowOccurrenceFollowUp:false});
   if(ask&&!normalized.followUpQuestion) throw new Error('Invalid follow-up question');
   return res.status(200).json({decision:ask?'ask_question':'complete',question:ask?normalized.followUpQuestion:null,report:normalized});
  } catch(error) {
   const message=String(error?.message||'');
   const reason=message==='Invalid follow-up decision'?'INVALID_FOLLOWUP_DECISION':message==='Invalid follow-up question'?'INVALID_FOLLOWUP_QUESTION':
    /^Audio follow-up provider HTTP \d{3}$/.test(message)?'PROVIDER_HTTP_ERROR':error?.name==='AbortError'?'PROVIDER_TIMEOUT':'FOLLOWUP_FAILED';
   try {logFailure({phase:'followup',reason});} catch {}
   return res.status(502).json({code:'AUDIO_FOLLOWUP_FAILED',reason});
  }
 };
}

export default createHandler();
