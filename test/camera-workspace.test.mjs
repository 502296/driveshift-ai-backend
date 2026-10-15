import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWorkspace,normalizeRecognition,workspaceSchema,normalizeVehicleContext} from '../lib/camera/workspace.js';
import visualHandler from '../api/camera-visual-evidence.js';
import diagnosisHandler from '../api/camera-diagnose-v2.js';

process.env.DRIVESHIFT_TELEMETRY_ENABLED='false';
const observation={id:'VIS_OBS_001',kind:'unknown',description:'A ribbed flexible boot surrounds a shaft.',region:{present:true,left:.1,top:.2,right:.6,bottom:.8},supportingEvidenceIds:[]};
const component={id:'PART_001',name:'CV joint boot',system:'Drivetrain',function:'Retains joint grease.',confidence:'medium',reasoning:'Ribbed boot around a shaft; attachment is partly obscured.',alternatives:['Steering rack boot'],supportingObservationIds:['VIS_OBS_001'],region:observation.region};
const fixture={state:'available',observations:[observation],interpretations:[],limitations:[],components:[component],nextPhoto:'Photograph the visible clamp from outside the vehicle.'};
const evidence={capture:{format:'jpeg',inspectionTarget:'leak',widthPixels:2048,heightPixels:1536,fileSizeBytes:2048},imageQuality:{state:'usable',metrics:[],limitations:[]},ocr:{state:'no_text',blocks:[],limitations:[]}};
const workspace={version:1,question:'What is this?',annotations:[{kind:'circle',points:[{x:.1,y:.2},{x:.6,y:.8}]}]};

test('marks are bounded and invalid coordinates are rejected rather than moved',()=>{
  const result=normalizeWorkspace({...workspace,annotations:[...workspace.annotations,{kind:'pen',points:[{x:-.1,y:0},{x:1,y:1}]}]});
  assert.equal(result.annotations.length,1);
  assert.equal(result.annotations[0].points[0].x,.1);
  assert.equal(normalizeWorkspace({version:2}),null);
  assert.equal(normalizeWorkspace({...workspace,question:'x'.repeat(900)}).question.length,800);
});
test('invalid marks and text overflow do not enter the contract',()=>{
  assert.equal(normalizeWorkspace({version:1,annotations:[null,{kind:'text',points:[{x:0,y:0}],text:''},{kind:'rectangle',points:[{x:0,y:0}]}]}).annotations.length,0);
  assert.equal(normalizeWorkspace({version:1,annotations:Array(30).fill(workspace.annotations[0])}).annotations.length,12);
});
test('component identity requires a surviving observation and valid confidence',()=>{
  assert.equal(normalizeRecognition(fixture,[]).components.length,0);
  assert.equal(normalizeRecognition({...fixture,components:[{...component,confidence:'certain'}]},[observation]).components.length,0);
  const parsed=normalizeRecognition(fixture,[observation]).components[0];
  assert.equal(parsed.confidence,'medium');assert.deepEqual(parsed.alternatives,['Steering rack boot']);
});
test('bad region removes the box without discarding an otherwise supported identity',()=>{
  for(const region of [{left:NaN,top:0,right:1,bottom:1},{left:.8,top:0,right:.2,bottom:1},{left:-1,top:0,right:1,bottom:1}]) {
    assert.equal(normalizeRecognition({...fixture,components:[{...component,region}]},[observation]).components[0].region,null);
  }
});
test('duplicate identities and dangling support are removed',()=>{
  const result=normalizeRecognition({...fixture,components:[component,component,{...component,id:'PART_002',supportingObservationIds:['VIS_OBS_999']}]},[observation]);
  assert.equal(result.components.length,1);
});
test('schema extension is opt-in and does not mutate legacy schema',()=>{
  const base={type:'object',properties:{state:{type:'string'}},required:['state']};
  const schema=workspaceSchema(base);assert.ok(schema.required.includes('components'));assert.equal(base.properties.components,undefined);
});
test('vehicle context includes configuration only, never tokens or account fields',()=>{
  assert.deepEqual(normalizeVehicleContext({make:'Ford',year:2020,accessToken:'private',email:'private'}),{make:'Ford',year:'2020'});
});
function response(){return {statusCode:200,payload:null,setHeader(){},status(s){this.statusCode=s;return this;},json(p){this.payload=p;return p;}};}
async function invoke(handler,body,aiResult){
  const saved=globalThis.fetch;let request;
  globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');request=JSON.parse(options.body);return Response.json({output_text:JSON.stringify(aiResult)});};
  const res=response();try{await handler({method:'POST',body},res);}finally{globalThis.fetch=saved;}
  return {res,request};
}
test('workspace route keeps original image, high detail, and separate user focus',async()=>{
  const image=Buffer.alloc(1024,3).toString('base64');
  const {res,request}=await invoke(visualHandler,{image,cameraEvidence:evidence,cameraWorkspace:workspace,vehicleProfile:{make:'Ford'}},fixture);
  assert.equal(res.statusCode,200);assert.equal(res.payload.visualEvidence.workspaceVersion,1);
  assert.equal(res.payload.visualEvidence.components[0].name,'CV joint boot');
  assert.equal(request.input[0].content[1].detail,'high');
  assert.equal(request.input[0].content[1].image_url,`data:image/jpeg;base64,${image}`);
  assert.match(request.input[0].content[0].text,/USER_FOCUS_JSON/);
  assert.match(request.input[0].content[0].text,/Ford/);
  assert.ok(request.text.format.schema.required.includes('components'));
});
test('legacy visual caller keeps its old schema and response shape',async()=>{
  const {res,request}=await invoke(visualHandler,{image:Buffer.alloc(1024,3).toString('base64'),cameraEvidence:evidence},fixture);
  assert.equal(res.statusCode,200);assert.equal(res.payload.visualEvidence.components,undefined);
  assert.equal(request.text.format.schema.properties.components,undefined);
});
test('bad quality stops the model call',async()=>{
  const {res,request}=await invoke(visualHandler,{image:'YWJj',cameraEvidence:{...evidence,imageQuality:{state:'unusable'}}},fixture);
  assert.equal(request,undefined);assert.equal(res.payload.visualEvidence.state,'insufficient_image_quality');
});
test('recognition survives the diagnostic handoff without becoming a fault evidence ID',async()=>{
  const {res,request}=await invoke(diagnosisHandler,{cameraEvidence:{...evidence,visualEvidence:{...fixture,components:normalizeRecognition(fixture,[observation]).components}}},
    {state:'insufficient_evidence',assessmentClass:'uncertain',summary:'More context required.',hypotheses:[],verificationSteps:[],safetyGuidance:{present:false,urgency:'monitor',summary:'',rationale:''},limitations:[]});
  assert.equal(res.statusCode,200);const prompt=request.input[1].content[0].text;
  assert.match(prompt,/CV joint boot/);assert.match(prompt,/Steering rack boot/);
  assert.match(prompt,/COMPONENT IDENTITY HANDOFF/);
  assert.ok(!request.input[1].content.some(c=>c.type==='input_image'));
});
