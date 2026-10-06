import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../api/audio-diagnose-v3.js';
import {validateRequest,inspectWav} from '../lib/audio-v3/contract.js';
import {normalizeReport} from '../lib/audio-v3/report.js';
import {buildPrompt} from '../lib/audio-v3/prompt.js';
import {requestReview} from '../lib/audio-v3/provider.js';
function body() {
 const bytes=Buffer.alloc(44+48000*2);
 bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
 bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
 bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(96000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);
 bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
 for(let i=0;i<48000;i++) bytes.writeInt16LE(Math.round(8000*Math.sin(i*2*Math.PI*280/48000)),44+2*i);
 const m=inspectWav(bytes);
 return {mode:'audio_evidence_v3',language:'en',audioFormat:'wav',audio:bytes.toString('base64'),
 recordingContext:{origin:'userReportedDirectVehicleRecording',rpmBehavior:'changes_with_rpm',description:'A loud engine as I increase and release the throttle'},
 vehicleProfile:{engine:'user reported V8',vin:'must not be sent to model'},
 audioEvidence:{contract:'audio_v3_evidence_v1',recording:{channelCount:1,sampleRateHz:48000,durationMilliseconds:1000},
 quality:{status:'passedDigitalChecks',permitsFurtherAcousticAnalysis:true},
 stageSummaries:['transient','short_event','spectral_change','spectral_structure','harmonic_track','spectral_peak','harmonic_group'].map(kind=>({channel:0,kind,status:'analyzed',totalCount:0,includedCount:0,selection:'strongest_12'})),
 observations:[{id:'CH0_SIGNAL',channel:0,kind:'digital_signal',values:{rms:m.rms,peak:m.peak,rmsDbfs:20*Math.log10(m.rms),nearFullScaleFraction:0}}]}};
}
const raw=()=>({assessment:'no_fault_supported',soundObservation:'The engine-like sound grows and settles as the throttle changes.',audibleConcern:'',supportingEvidenceIds:['CH0_SIGNAL']});
const response=()=>({statusCode:null,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(x){this.body=x;return this;}});
async function call(b,options={}) {const res=response();await createHandler({getApiKey:()=> 'test-key',review:async()=>raw(),...options})({method:'POST',body:b},res);return res;}

test('descriptive result completes without any component cause',async()=>{
 const r=await call(body());assert.equal(r.statusCode,200);assert.equal(r.body.report.assessment,'no_fault_supported');
 assert.match(r.body.report.interpretation,/does not confirm/);assert.equal(r.body.report.causes,undefined);
});
test('all supplied measurements are finite and signal values match WAV',()=>{
 const b=body();b.audioEvidence.observations[0].values.rms=0.9;assert.throws(()=>validateRequest(b),/match WAV/);
});
for(const origin of ['userReportedSpeakerPlayback','unknown','userReportedOther']) test(`${origin} preserves useful sound assessment with source limitation`,()=>{
 const b=body();b.recordingContext.origin=origin;const r=normalizeReport(raw(),validateRequest(b));assert.equal(r.assessment,'no_fault_supported');assert.match(r.limitations[0],/origin|Speaker/);
});
test('candidate lists are bounded and provenance remains user report',()=>{
 const input=validateRequest(body());assert.equal(input.context.supportsMeasuredRpmCorrelation,false);
 assert.equal(input.context.contextClass,'user_reported');assert.equal(input.vehicleProfile.vin,undefined);
});
test('unknown evidence ID rejects provider result',async()=>{
 const r=await call(body(),{review:async()=>({...raw(),supportingEvidenceIds:['KNOCK_CONFIRMED']})});assert.equal(r.statusCode,502);
});
test('audible concern is not vetoed because local detector found only signal metrics',()=>{
 assert.equal(normalizeReport({...raw(),assessment:'verification_needed',audibleConcern:'A possible metallic rattle'},validateRequest(body())).assessment,'verification_needed');
});
test('verification accepts acoustic linkage but never confirms failed part',()=>{
 const b=body();b.audioEvidence.observations.push({id:'CH0_TRANSIENT_0',kind:'transient',channel:0,values:{centerSeconds:0.8,energyRiseDb:6.9,rms:0.2}});
 const s=b.audioEvidence.stageSummaries.find(x=>x.kind==='transient');s.totalCount=s.includedCount=1;
 const r=normalizeReport({...raw(),assessment:'verification_needed',audibleConcern:'A possible metallic rattle',supportingEvidenceIds:['CH0_TRANSIENT_0']},validateRequest(b));
 assert.equal(r.assessment,'verification_needed');assert.match(r.interpretation,/no failed part is confirmed/);
});
for(const claim of ['The engine is healthy.','It is safe to drive.','There is a confirmed knock.','Measured RPM is 2300.']) test(`reject categorical claim: ${claim}`,async()=>{
 assert.equal((await call(body(),{review:async()=>({...raw(),soundObservation:claim})})).statusCode,502);
});
test('metadata mismatch rejected before paid call',async()=>{
 let calls=0;const b=body();b.audioEvidence.recording.durationMilliseconds=4000;
 const r=await call(b,{review:async()=>{calls++;return raw();}});assert.equal(r.statusCode,400);assert.equal(calls,0);
});
test('digital silence rejected before paid call',async()=>{
 const b=body(),wav=Buffer.from(b.audio,'base64');wav.fill(0,44);b.audio=wav.toString('base64');assert.equal((await call(b)).statusCode,400);
});
for(const mutate of [b=>b.audio='not base64',b=>b.audioEvidence.contract='v2',b=>b.audioEvidence.observations[0].values.rms=NaN,
 b=>b.audioEvidence.observations.push(b.audioEvidence.observations[0]),b=>b.audioEvidence.quality.permitsFurtherAcousticAnalysis=false,
 b=>b.audioEvidence.stageSummaries[0].includedCount=1]) test(`invalid input ${mutate.toString()} is rejected`,async()=>{
 const b=body();mutate(b);assert.equal((await call(b)).statusCode,400);
});
test('missing provider key is operational error, not diagnostic insufficiency',async()=>assert.equal((await call(body(),{getApiKey:()=>''})).statusCode,503));
test('provider failure is operational error, not a fabricated report',async()=>assert.equal((await call(body(),{review:async()=>{throw new Error('failure');}})).statusCode,502));
test('GET rejected without calling provider',async()=>{
 const r=response();await createHandler()({method:'GET'},r);assert.equal(r.statusCode,405);assert.equal(r.headers.Allow,'POST');
});
test('Spanish controlled text remains Spanish',()=>{
 const b=body();b.language='es';const r=normalizeReport(raw(),validateRequest(b));assert.match(r.title,/hipótesis/);
});
test('provider payload carries actual WAV, measured data, separate context and text output',async()=>{
 const input=validateRequest(body());let sent;
 const result=await requestReview(input,{apiKey:'mock-key',model:'gpt-audio',fetchImpl:async(url,options)=>{
  sent=JSON.parse(options.body);assert.equal(url,'https://api.openai.com/v1/chat/completions');
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(raw())}}]})};
 }});
 assert.equal(result.assessment,'no_fault_supported');assert.deepEqual(sent.modalities,['text']);assert.equal(sent.store,false);
 assert.equal(sent.messages[1].content[1].input_audio.data,input.audioBase64);
 assert.match(sent.messages[1].content[0].text,/not measured RPM/);
 assert.match(buildPrompt(input),/do not label/i);
});
test('provider malformed JSON fails closed',async()=>{
 await assert.rejects(requestReview(validateRequest(body()),{apiKey:'mock',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:'not json'}}]})})}));
});
test('observed phone report retains audible description and omits unsupported RPM sentence',async()=>{
 const claim='Engine sound with smooth revving, audible throttle changes, and no distinct irregularities or sharp knocks. Harmonic patterns shift with RPM.';
 const r=await call(body(),{review:async()=>({...raw(),soundObservation:claim})});
 assert.equal(r.statusCode,200);
 assert.equal(r.body.report.soundObservation,'Engine sound with smooth revving, audible throttle changes, and no distinct irregularities or sharp knocks.');
 assert.equal(r.body.report.assessment,'no_fault_supported');
 assert.match(r.body.report.limitations.at(-1),/omitted/);
});
test('RPM-only description gets an explicit limitation without invented acoustic wording',()=>{
 const r=normalizeReport({...raw(),soundObservation:'Harmonic patterns shift with engine speed.'},validateRequest(body()));
 assert.equal(r.assessment,'insufficient_evidence');assert.match(r.soundObservation,/could not be retained/);
 assert.doesNotMatch(r.soundObservation,/pitch|smooth/i);
});
test('unsupported speed in a concern cannot produce verification-needed result',()=>{
 const b=body();b.audioEvidence.observations.push({id:'CH0_TRANSIENT_0',kind:'transient',channel:0,values:{centerSeconds:0.8,energyRiseDb:6.9,rms:0.2}});
 const s=b.audioEvidence.stageSummaries.find(x=>x.kind==='transient');s.totalCount=s.includedCount=1;
 const r=normalizeReport({...raw(),assessment:'verification_needed',audibleConcern:'Rattle tracks shaft speed.',supportingEvidenceIds:['CH0_TRANSIENT_0']},validateRequest(b));
 assert.equal(r.assessment,'insufficient_evidence');assert.doesNotMatch(r.soundObservation,/shaft speed/);
});
test('Spanish speed statement is omitted with a localized explanation',()=>{
 const b=body();b.language='es';
 const r=normalizeReport({...raw(),soundObservation:'El sonido sube y baja de tono. Los armónicos cambian con las revoluciones.'},validateRequest(b));
 assert.equal(r.soundObservation,'El sonido sube y baja de tono.');assert.match(r.limitations.at(-1),/Se omitieron/);
});
test('acoustic pitch description remains intact while prompt separates user reports from speed',()=>{
 const input=validateRequest(body()),claim='The tone rises and falls, with a steady low rumble.';
 const r=normalizeReport({...raw(),soundObservation:claim},input);
 assert.equal(r.soundObservation,claim);assert.equal(r.assessment,'no_fault_supported');assert.equal(r.limitations.length,3);
 assert.match(buildPrompt(input),/Do not invent synchronized RPM/);
});

function reasoning() {
 return {...raw(),assessment:'verification_needed',soundObservation:'A brief metallic rattle interrupts the steady low tone.',
  audibleConcern:'A brief metallic rattle',interpretation:'A loose resonating part is a possibility; the recording cannot locate it.',
  hypotheses:[{title:'Possible loose exhaust shield',reason:'The brief metallic buzz could be a thin panel resonating; location is unconfirmed.',
   verification:'Ask a technician to check exhaust shields and mounts for looseness and contact marks.',supportingEvidenceIds:[]}],
  nextStep:'Was this sound recorded near the exhaust, and does the same rattle recur?'};
}
test('a conditional hypothesis and targeted check reach the existing Flutter fields',()=>{
 const r=normalizeReport(reasoning(),validateRequest(body()));
 assert.equal(r.assessment,'verification_needed');assert.match(r.interpretation,/exhaust shield/);
 assert.match(r.interpretation,/location is unconfirmed/);assert.match(r.nextStep,/contact marks/);
 assert.ok(r.interpretation.length<=500);assert.ok(r.nextStep.length<=500);
});
test('speaker playback does not discard the hypothesis or the verification plan',()=>{
 const b=body();b.recordingContext.origin='userReportedSpeakerPlayback';
 const r=normalizeReport(reasoning(),validateRequest(b));assert.equal(r.assessment,'verification_needed');
 assert.match(r.interpretation,/shield/);assert.match(r.limitations[0],/Speaker playback/);
});
test('unknown hypothesis IDs reject the result',()=>{
 const x=reasoning();x.hypotheses[0].supportingEvidenceIds=['invented'];
 assert.throws(()=>normalizeReport(x,validateRequest(body())),/evidence/);
});
test('no-fault report cannot contain a contradictory component hypothesis',()=>{
 assert.throws(()=>normalizeReport({...reasoning(),assessment:'no_fault_supported'},validateRequest(body())),/conflict/);
});
test('empty audible concern cannot produce an accepted fault hypothesis',()=>{
 assert.throws(()=>normalizeReport({...reasoning(),audibleConcern:''},validateRequest(body())),/conflict/);
});
test('new fields cannot smuggle categorical claims',()=>{
 for(const field of ['interpretation','nextStep']) {
  assert.throws(()=>normalizeReport({...reasoning(),[field]:'The engine is healthy.'},validateRequest(body())),/Unsupported/);
 }
});
test('two bounded possibilities preserve their complete checks within Flutter limits',()=>{
 const x=reasoning();x.hypotheses.push({title:'Possible recording artifact',reason:'An isolated burst could come from handling or playback distortion.',
 verification:'Compare the original recording with speaker playback to check whether the burst is introduced by playback.',supportingEvidenceIds:['CH0_SIGNAL']});
 const r=normalizeReport(x,validateRequest(body()));assert.match(r.nextStep,/introduced by playback/);
 assert.equal(r.hypotheses.length,2);assert.ok(r.nextStep.length<=500);
});
test('prompt requests differential reasoning and does not force playback refusal',()=>{
 const prompt=buildPrompt(validateRequest(body()));assert.match(prompt,/TWO ranked/);assert.match(prompt,/Speaker playback can still support/);
 assert.match(prompt,/Do not force a diagnosis/);
});
