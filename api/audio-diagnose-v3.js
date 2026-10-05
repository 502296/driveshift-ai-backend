import {InputError,validateRequest} from '../lib/audio-v3/contract.js';
import {requestReview} from '../lib/audio-v3/provider.js';
import {normalizeReport} from '../lib/audio-v3/report.js';
// Independent endpoint: existing Audio V2 and all other routes remain intact.
export function createHandler({review=requestReview, getApiKey=()=>process.env.OPENAI_API_KEY}={}) {
 return async function handler(req,res) {
  res.setHeader?.('Cache-Control','no-store');
  if(req.method!=='POST') {res.setHeader?.('Allow','POST');return res.status(405).json({code:'METHOD_NOT_ALLOWED'});}
  let input;
  try {input=validateRequest(req.body);} catch(error) {
   return res.status(400).json({code:'INVALID_AUDIO_V3_REQUEST',error:error instanceof InputError?error.message:'Invalid request'});
  }
  if(!getApiKey()) return res.status(503).json({code:'AUDIO_SERVICE_UNAVAILABLE'});
  try {
   return res.status(200).json({report:normalizeReport(await review(input),input)});
  } catch {
   // Do not log audio, context, keys or provider response content.
   return res.status(502).json({code:'AUDIO_V3_REVIEW_FAILED'});
  }
 };
}
export default createHandler();
