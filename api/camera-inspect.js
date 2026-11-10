import {normalizeVehicleHistory, VEHICLE_HISTORY_INSTRUCTIONS} from '../lib/memory/vehicle-history.js';
import {withTelemetry} from '../lib/admin/telemetry.js';
import {cameraImage, CameraImageError} from '../lib/camera/mechanic.js';
import {normalizeWorkspace, normalizeVehicleContext} from '../lib/camera/workspace.js';
import {normalizeLocalCameraEvidence, extractResponseText} from './camera-visual-evidence.js';
import {INSPECTION_SCHEMA, INSPECTION_PROMPT, validateInspection, InspectionContractError} from '../lib/camera/inspection.js';

export const config = {maxDuration:60};
const fail = (res,status,code,message) => res.status(status).json({ok:false,error:{code,message}});
export async function handler(req,res) {
  res.setHeader?.('Cache-Control','no-store');
  if (req.method !== 'POST') {res.setHeader?.('Allow','POST');return fail(res,405,'METHOD_NOT_ALLOWED','Only POST requests are supported.');}
  const started=performance.now();
  let timer;
  try {
    const body=req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(res,400,'INVALID_REQUEST','An inspection request is required.');
    const image=cameraImage(body.image);
    if (!image) return fail(res,400,'CAMERA_IMAGE_REQUIRED','An inspection image is required.');
    const local=normalizeLocalCameraEvidence(body.cameraEvidence);
    if (!local) return fail(res,400,'CAMERA_EVIDENCE_REQUIRED','Valid image-quality metadata is required.');
    if (local.imageQuality.state === 'unusable') return fail(res,422,'CAMERA_IMAGE_UNUSABLE','Retake the image with better lighting and a steady camera.');
    if (!process.env.OPENAI_API_KEY) return fail(res,503,'CAMERA_NOT_CONFIGURED','Inspection is temporarily unavailable.');
    const vehicleMemory=normalizeVehicleHistory(body.vehicleMemory);
    const controller=new AbortController();
    timer=setTimeout(()=>controller.abort(),40000);
    const model=process.env.DRIVESHIFT_CAMERA_INSPECTION_MODEL || process.env.DRIVESHIFT_CAMERA_DIAGNOSIS_MODEL || 'gpt-5.6-sol';
    const modelStarted=performance.now();
    const response=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',signal:controller.signal,
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},
      body:JSON.stringify({model,store:false,
        input:[{role:'developer',content:[{type:'input_text',text:INSPECTION_PROMPT+(vehicleMemory?VEHICLE_HISTORY_INSTRUCTIONS:'')}]},
          {role:'user',content:[{type:'input_text',text:JSON.stringify({language:body.language==='es'?'Spanish':'English',
            vehicle:normalizeVehicleContext(body.vehicleProfile),vehicleMemory,userFocus:normalizeWorkspace(body.cameraWorkspace),
            imageQuality:local.imageQuality.state})},image]}],
        text:{format:{type:'json_schema',name:'driveshift_camera_inspection_v1',strict:true,schema:INSPECTION_SCHEMA}},max_output_tokens:4000}),
    });
    if (!response.ok) return fail(res,response.status===429?429:502,'CAMERA_UPSTREAM_ERROR',response.status===429?'Inspection service is busy. Try again shortly.':'The inspection service could not complete this request.');
    const data=await response.json();
    if (data.status==='incomplete') return fail(res,502,'CAMERA_INCOMPLETE','Inspection was incomplete. Try another photo.');
    let raw;
    try {raw=JSON.parse(extractResponseText(data));} catch {return fail(res,502,'CAMERA_INVALID_RESPONSE','The inspection response could not be read.');}
    const result=validateInspection(raw);
    const timing={modelMs:Math.round(performance.now()-modelStarted),serverMs:Math.round(performance.now()-started),modelCalls:1};
    res.setHeader?.('Server-Timing',`model;dur=${timing.modelMs},total;dur=${timing.serverMs}`);
    return res.status(200).json({ok:true,...result,timing});
  } catch(error) {
    if (error instanceof CameraImageError) return fail(res,error.code==='CAMERA_IMAGE_TOO_LARGE'?413:400,error.code,error.message);
    if (error instanceof InspectionContractError) return fail(res,502,'CAMERA_CONTRACT_INVALID','Inspection details were inconsistent. Try a clearer photo.');
    if (error?.name==='AbortError') return fail(res,504,'CAMERA_TIMEOUT','Inspection took too long. Please try again.');
    return fail(res,502,'CAMERA_CONNECTION_FAILED','The inspection service could not be reached. Please try again.');
  } finally {clearTimeout(timer);}
}
export default withTelemetry(handler,'camera-inspect');
