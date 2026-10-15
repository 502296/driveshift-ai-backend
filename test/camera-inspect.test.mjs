import test from 'node:test';
import assert from 'node:assert/strict';
import {handler} from '../api/camera-inspect.js';
import {validateInspection,INSPECTION_SCHEMA} from '../lib/camera/inspection.js';
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGN0AAAAASUVORK5CYII=';
const local={capture:{format:'png',inspectionTarget:'warningLight',widthPixels:1024,heightPixels:768,fileSizeBytes:2048},imageQuality:{state:'usable',metrics:[],limitations:[]},ocr:{state:'no_text',blocks:[],limitations:[]}};
const region={present:true,left:0.1,top:0.2,right:0.4,bottom:0.5};
const raw={visualEvidence:{state:'available',observations:[{id:'VIS_OBS_001',kind:'visibleSymbol',description:'A red oil-can symbol is illuminated.',region,supportingEvidenceIds:[]}],interpretations:[],limitations:[],components:[{id:'PART_001',name:'Oil-pressure warning symbol',system:'Dashboard',function:'Warns of low oil pressure.',confidence:'high',reasoning:'The red oil-can outline is visible.',alternatives:[],supportingObservationIds:['VIS_OBS_001'],region}],nextPhoto:''},diagnosis:{state:'analysis_available',assessmentClass:'uncertain',summary:'The red oil-can icon is an oil-pressure warning.',hypotheses:[{id:'CAM_HYP_001',title:'Oil-pressure warning indication',reasoning:'The visible oil-can icon identifies the warning.',confidence:'high',supportingEvidenceIds:['VIS_OBS_001'],limitations:[]}],verificationSteps:[],safetyGuidance:{present:true,urgency:'inspection_recommended',summary:'If lit with the engine running, stop safely and switch off.',rationale:'The running state is unknown.'},limitations:[],nextQuestion:'Was the engine running?'},display:{title:'Oil-pressure warning',nextStep:'Check whether the light remains on with the engine running.',drivingAdvice:'If lit while running, stop safely and switch off.',urgencyLabel:'Stop if lit while running',imageType:'dashboard'}};
const clone=()=>structuredClone(raw);
const res=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.payload=v;return v;}});
async function call(body={image,cameraEvidence:local},options={}) {
  const previous=globalThis.fetch,key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-only';let calls=0,payload;
  globalThis.fetch=async(_,request)=>{calls++;payload=JSON.parse(request.body);if(options.network)throw new Error('private service error');return Response.json(options.response??{output_text:JSON.stringify(options.raw??raw)},{status:options.status??200});};
  const output=res();try{await handler({method:options.method??'POST',body},output);}finally{globalThis.fetch=previous;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;}
  return {output,calls,payload};
}
test('one request sends original pixels once and returns consistent parts and diagnosis plus timings',async()=>{
 const {output,calls,payload}=await call();assert.equal(calls,1);assert.equal(output.statusCode,200);assert.equal(output.payload.visualEvidence.components[0].id,'PART_001');assert.equal(output.payload.diagnosis.hypotheses.length,1);assert.equal(output.payload.timing.modelCalls,1);assert.ok(output.payload.timing.serverMs>=0);assert.match(output.headers['Server-Timing'],/model;dur=/);assert.equal(payload.input.flatMap(x=>x.content).filter(x=>x.type==='input_image').length,1);assert.equal(payload.store,false);
});
test('missing image, remote URLs and malformed evidence stop before paid call',async()=>{
 for(const body of [{cameraEvidence:local},{image:'https://example.com/a',cameraEvidence:local},{image,cameraEvidence:{}}]){const x=await call(body);assert.equal(x.calls,0);assert.equal(x.output.statusCode,400);}
});
test('rejected local image quality stops before paid call',async()=>{const x=await call({image,cameraEvidence:{...local,imageQuality:{state:'unusable'}}});assert.equal(x.calls,0);assert.equal(x.output.statusCode,422);});
test('GET is rejected without model access',async()=>{const x=await call({}, {method:'GET'});assert.equal(x.calls,0);assert.equal(x.output.statusCode,405);});
test('partial model output never becomes a report',async()=>{const x=await call(undefined,{response:{status:'incomplete',output_text:JSON.stringify(raw)}});assert.equal(x.output.statusCode,502);assert.equal(x.output.payload.error.code,'CAMERA_INCOMPLETE');});
test('invented diagnosis support invalidates headline rather than silently dropping hypothesis',async()=>{const r=clone();r.diagnosis.hypotheses[0].supportingEvidenceIds=['VIS_OBS_999'];const x=await call(undefined,{raw:r});assert.equal(x.output.statusCode,502);assert.equal(x.output.payload.error.code,'CAMERA_CONTRACT_INVALID');});
test('invalid part IDs cannot silently erase all recognized parts',()=>{const r=clone();r.visualEvidence.components[0].id='component1';assert.throws(()=>validateInspection(r));});
test('unsupported component reference invalidates output',()=>{const r=clone();r.visualEvidence.components[0].supportingObservationIds=['VIS_OBS_999'];assert.throws(()=>validateInspection(r));});
test('unknown image can return retake guidance without forced fault',()=>{const r=clone();r.visualEvidence={...r.visualEvidence,state:'insufficient_image_quality',observations:[],components:[]};r.diagnosis={...r.diagnosis,state:'insufficient_evidence',hypotheses:[]};r.display.title='Image too blurred';r.display.nextStep='Retake closer with steady lighting.';const x=validateInspection(r);assert.equal(x.diagnosis.hypotheses.length,0);assert.equal(x.display.drivingAdvice,'');});
test('rate limit, malformed output and network errors stay stable and redact private upstream messages',async()=>{for(const options of [{status:429},{response:{output_text:'invalid'}},{network:true}]){const x=await call(undefined,options);assert.ok([429,502].includes(x.output.statusCode));assert.ok(!JSON.stringify(x.output.payload).includes('private service'));}});
test('schema defines exact parts support and structured report fields',()=>{assert.ok(INSPECTION_SCHEMA.properties.visualEvidence.properties.components.items.required.includes('supportingObservationIds'));assert.ok(INSPECTION_SCHEMA.properties.display.required.includes('drivingAdvice'));});

test('report contract preserves concise actions for diverse supported scenes without changing model access',async()=>{
 const scenes=[
  {kind:'bulgeOrDeformation',name:'Tire sidewall',title:'Sidewall bulge',summary:'A localized outward bulge is visible on the tire sidewall.',next:'Arrange tire replacement and inspection.',driving:'Do not drive on the bulged tire.',type:'mechanical',assessment:'abnormal_condition'},
  {kind:'wetOrReflectiveArea',name:'Differential cover',title:'Likely cover-seal leak',summary:'Wet residue follows the lower cover joint.',next:'Verify lubricant level and clean the joint to trace fresh residue.',driving:'Avoid driving if the level is low or leakage is rapid.',type:'mechanical',assessment:'uncertain'},
  {kind:'unknown',name:'Hose connection',title:'No visible damage at this connection',summary:'The visible hose and clamp appear seated without visible residue.',next:'If a symptom persists, describe when it occurs.',driving:'',type:'mechanical',assessment:'normal_condition'},
  {kind:'visibleSymbol',name:'Oil-pressure warning',title:'Oil-pressure warning',summary:'The red oil-can symbol warns about engine lubrication pressure.',next:'Check oil level; if normal, arrange pressure testing.',driving:'If it stays on with the engine running, stop safely and switch off.',type:'dashboard',assessment:'uncertain'},
 ];
 for(const scene of scenes){
  const r=clone();r.visualEvidence.observations[0].kind=scene.kind;r.visualEvidence.observations[0].description=scene.summary;r.visualEvidence.components[0].name=scene.name;
  r.diagnosis.summary=scene.summary;r.diagnosis.assessmentClass=scene.assessment;r.diagnosis.hypotheses[0].title=scene.title;r.diagnosis.hypotheses[0].reasoning=scene.summary;r.diagnosis.nextQuestion='';
  r.display={title:scene.title,nextStep:scene.next,drivingAdvice:scene.driving,urgencyLabel:scene.driving?'Inspection guidance':'',imageType:scene.type};
  const x=await call(undefined,{raw:r});assert.equal(x.output.statusCode,200,scene.name);assert.equal(x.calls,1);assert.equal(x.output.payload.display.drivingAdvice,scene.driving);assert.equal(x.output.payload.diagnosis.summary,scene.summary);assert.equal(x.output.payload.visualEvidence.components[0].name,scene.name);
 }
});
test('non-automotive image returns its explanation without forcing driving advice or invented parts',()=>{
 const r=clone();r.visualEvidence={...r.visualEvidence,state:'no_relevant_visual_evidence',observations:[],interpretations:[],components:[],nextPhoto:''};r.diagnosis={...r.diagnosis,state:'insufficient_evidence',summary:'No automotive part or warning is visible.',hypotheses:[],verificationSteps:[],nextQuestion:''};r.display={title:'No vehicle detail visible',nextStep:'Photograph the relevant part or dashboard symbol.',drivingAdvice:'',urgencyLabel:'',imageType:'other'};
 const x=validateInspection(r);assert.equal(x.display.drivingAdvice,'');assert.equal(x.visualEvidence.components.length,0);assert.equal(x.diagnosis.hypotheses.length,0);
});
