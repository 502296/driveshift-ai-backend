import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../api/audio-diagnose-v3.js';
import {validateRequest,inspectWav} from '../lib/audio-v3/contract.js';
import {normalizeReport} from '../lib/audio-v3/report.js';
import {buildPrompt} from '../lib/audio-v3/prompt.js';
import {requestReview} from '../lib/audio-v3/provider.js';
import {validateFollowUpRequest,buildFollowUpPrompt,requestFollowUp} from '../lib/audio-v3/followup.js';
import {createHandler as createFollowUpHandler} from '../api/audio-diagnose-v3-followup.js';
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
async function call(b,options={}) {const res=response();await createHandler({getApiKey:()=> 'test-key',review:async()=>raw(),logFailure:()=>{},...options})({method:'POST',body:b},res);return res;}

test('descriptive result completes without any component cause',async()=>{
 const r=await call(body());assert.equal(r.statusCode,200);assert.equal(r.body.report.assessment,'no_fault_supported');
 assert.match(r.body.report.interpretation,/does not confirm/);assert.equal(r.body.report.causes,undefined);
});
test('all supplied measurements are finite and signal values match WAV',()=>{
 const b=body();b.audioEvidence.observations[0].values.rms=0.9;assert.throws(()=>validateRequest(b),/match WAV/);
});
for(const origin of ['userReportedSpeakerPlayback','unknown','userReportedOther']) test(`${origin} does not create a source-choice question`,()=>{
 const b=body();b.recordingContext.origin=origin;const r=normalizeReport(raw(),validateRequest(b));assert.equal(r.assessment,'no_fault_supported');assert.doesNotMatch(`${r.interpretation} ${r.nextStep} ${r.limitations.join(' ')}`,/speaker playback|recording origin/i);
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
 assert.equal(r.assessment,'verification_needed');assert.match(r.interpretation,/cause remains unconfirmed/);
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
test('legacy gpt-audio setting is upgraded to the current audio model',async()=>{
 const previous=process.env.OPENAI_AUDIO_MODEL;process.env.OPENAI_AUDIO_MODEL='gpt-audio';let sent;
 try {
  await requestReview(validateRequest(body()),{apiKey:'mock',fetchImpl:async(_url,options)=>{
   sent=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(raw())}}]})};
  }});
  assert.equal(sent.model,'gpt-audio-1.5');
 } finally {if(previous===undefined)delete process.env.OPENAI_AUDIO_MODEL;else process.env.OPENAI_AUDIO_MODEL=previous;}
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
 assert.equal(r.soundObservation,claim);assert.equal(r.assessment,'no_fault_supported');assert.equal(r.limitations.length,1);
 assert.match(buildPrompt(input),/Do not invent synchronized RPM/);
});

function reasoning() {
 return {...raw(),assessment:'verification_needed',soundObservation:'A brief metallic rattle interrupts the steady low tone.',
  audibleConcern:'A brief metallic rattle',interpretation:'A loose resonating part is a possibility; the recording cannot locate it.',
  hypotheses:[{title:'Possible loose exhaust shield',reason:'The brief metallic buzz could be a thin panel resonating; location is unconfirmed.',
   verification:'Ask a technician to check exhaust shields and mounts for looseness and contact marks.',supportingEvidenceIds:[]}],
  nextStep:'Was this sound recorded near the exhaust, and does the same rattle recur?'};
}
function starterMisfireReport() {
 return {assessment:'verification_needed',
  soundObservation:'A sharp isolated burst is followed by a lower, steady and regular rhythmic pattern.',
  audibleConcern:'A sharp isolated burst at the beginning.',
  supportingEvidenceIds:['CH0_SIGNAL'],
  hypotheses:[
   {title:'Starter engagement or misfire event',reason:'The isolated burst could be starter engagement or a combustion event; the source is uncertain.',
    verification:'Inspect the starter and flywheel teeth for damage.',supportingEvidenceIds:[]},
   {title:'Microphone handling or playback artifact',reason:'An isolated burst could come from handling or playback distortion.',
    verification:'Re-record directly at the engine bay and compare.',supportingEvidenceIds:[]},
  ],
  interpretation:'A sharp burst and steady rhythm suggest a starter or misfire event, or a recording artifact.',
  nextStep:'Check the starter and flywheel teeth.'};
}
test('unsupported starter, misfire, and handling guesses are replaced by a useful engine-context check',()=>{
 const b=body();b.recordingContext.origin='userReportedSpeakerPlayback';
 b.recordingContext.rpmBehavior='unknown';b.recordingContext.description='';
 const r=normalizeReport(starterMisfireReport(),validateRequest(b));
 assert.equal(r.assessment,'no_fault_supported');assert.equal(r.hypotheses.length,0);
 assert.match(r.interpretation,/does not support a specific fault hypothesis/);
 assert.match(r.nextStep,/When does the sound occur/);assert.doesNotMatch(`${r.interpretation} ${r.nextStep}`,/inspect.*starter|flywheel.*damage|misfire|handling artifact|recording source/i);
});
test('source metadata does not cause a direct-recording instruction or guessed part',()=>{
 const b=body();b.recordingContext.origin='userReportedSpeakerPlayback';
 const r=normalizeReport(starterMisfireReport(),validateRequest(b));
 assert.equal(r.assessment,'no_fault_supported');assert.equal(r.hypotheses.length,0);
 assert.match(r.nextStep,/When does the sound occur/);
 assert.doesNotMatch(`${r.interpretation} ${r.nextStep}`,/speaker|direct recording|starter|flywheel|misfire|handling artifact/i);
});
test('starter hypothesis remains available when the user reports engine starting',()=>{
 const b=body();b.recordingContext.engineState='starting';
 const x=starterMisfireReport();x.hypotheses=x.hypotheses.slice(0,1);x.hypotheses[0].title='Possible starter engagement';x.hypotheses[0].reason='The burst coincides with reported cranking; the recording cannot confirm a damaged part.';x.interpretation='Starter engagement is a possibility during the reported crank.';x.nextStep='A technician can check starter engagement during cranking.';
 const r=normalizeReport(x,validateRequest(b));
 assert.equal(r.assessment,'verification_needed');assert.equal(r.hypotheses.length,1);assert.match(r.interpretation,/Starter engagement/);
});
test('irregular user-reported operation can retain a misfire hypothesis',()=>{
 const b=body();b.recordingContext.description='User reports rough idle and engine stumble.';
 const x=starterMisfireReport();x.hypotheses=[{title:'Possible misfire',reason:'Irregular firing coincides with the reported uneven idle; cause is not established.',
  verification:'A technician can compare cylinder contribution and stored misfire codes.',supportingEvidenceIds:[]}];x.soundObservation='The engine rhythm sounds uneven and intermittently stumbles.';x.interpretation='The uneven rhythm merits checking against the reported rough idle.';x.nextStep='Check whether the rough idle occurs at the same time.';
 const r=normalizeReport(x,validateRequest(b));assert.equal(r.hypotheses.length,1);assert.equal(r.assessment,'verification_needed');
});
test('a conditional hypothesis and targeted check reach the existing Flutter fields',()=>{
 const r=normalizeReport(reasoning(),validateRequest(body()));
 assert.equal(r.assessment,'verification_needed');assert.match(r.hypotheses[0].title,/exhaust shield/);
 assert.match(r.hypotheses[0].reason,/location is unconfirmed/);assert.match(r.hypotheses[0].verification,/contact marks/);
 assert.ok(r.interpretation.length<=500);assert.ok(r.nextStep.length<=500);
});
test('source metadata does not discard hypotheses or add a playback limitation',()=>{
 const b=body();b.recordingContext.origin='userReportedSpeakerPlayback';
 const r=normalizeReport(reasoning(),validateRequest(b));assert.equal(r.assessment,'verification_needed');
 assert.match(r.hypotheses[0].title,/shield/);assert.match(r.hypotheses[0].verification,/contact marks/);
 assert.doesNotMatch(r.limitations.join(' '),/Speaker playback/);
});
test('unknown hypothesis IDs are safely discarded',()=>{
 const input=validateRequest(body());
 const x=reasoning();
 x.hypotheses[0].supportingEvidenceIds=['CH0_UNKNOWN'];
 const report=normalizeReport(x,input);
 assert.equal(report.assessment,'insufficient_evidence');
 assert.deepEqual(report.hypotheses,[]);
 assert.equal(report.supportingEvidenceIds.includes('CH0_UNKNOWN'),false);
});

test('no-fault report cannot contain a contradictory component hypothesis',()=>{
 assert.throws(()=>normalizeReport({...reasoning(),assessment:'no_fault_supported'},validateRequest(body())),/conflict/);
});
test('a recognizable squeal still asks for context when assessment says no fault is supported',()=>{
 const b=body();b.recordingContext.engineState='unknown';b.recordingContext.rpmBehavior='unknown';b.recordingContext.description='';
 const x={...raw(),assessment:'no_fault_supported',sessionStatus:'complete',
  soundObservation:'A brief high-pitched squeal is heard shortly after the recording starts, then stops.',
  audibleConcern:'A brief high-pitched squeal'};
 const r=normalizeReport(x,validateRequest(b));
 assert.equal(r.assessment,'no_fault_supported');assert.equal(r.sessionStatus,'follow_up');
 assert.match(r.followUpQuestion.question,/only as the engine starts/);
 assert.deepEqual(r.followUpQuestion.options,['Only during startup','While running','Both','Not sure']);
});
test('empty audible concern cannot produce an accepted fault hypothesis',()=>{
 assert.throws(()=>normalizeReport({...reasoning(),audibleConcern:''},validateRequest(body())),/conflict/);
});
test('new fields cannot smuggle categorical claims',()=>{
 for(const field of ['interpretation','nextStep']) {
  assert.throws(()=>normalizeReport({...reasoning(),[field]:'The engine is healthy.'},validateRequest(body())),/Unsupported/);
 }
});
test('unsupported handling hypothesis is omitted while a supported mechanical check is retained',()=>{
 const x=reasoning();x.hypotheses.push({title:'Possible recording artifact',reason:'An isolated burst could come from handling or playback distortion.',
 verification:'Compare the original recording with speaker playback to check whether the burst is introduced by playback.',supportingEvidenceIds:['CH0_SIGNAL']});
 const b=body();b.recordingContext.origin='userReportedSpeakerPlayback';
 const r=normalizeReport(x,validateRequest(b));assert.doesNotMatch(r.nextStep,/introduced by playback/);
 assert.equal(r.hypotheses.length,1);assert.ok(r.nextStep.length<=500);
});
test('prompt requests differential reasoning and does not force playback refusal',()=>{
 const prompt=buildPrompt(validateRequest(body()));assert.match(prompt,/single best-supported possible explanation/);assert.match(prompt,/ADAPTIVE INTERVIEW/);
 assert.match(prompt,/Do not ask the user to classify a clip as speaker playback/);assert.match(prompt,/Do not force a diagnosis/);
});

test('verbose reasoning is repaired once without truncating uncertainty',async()=>{
 const input=validateRequest(body());const verbose=reasoning();
 verbose.hypotheses[0].reason='The short metallic texture could be a loose vibrating part; its location remains uncertain. '.repeat(3);
 let calls=0;
 const repaired=await requestReview(input,{apiKey:'mock',validateOutput:value=>normalizeReport(value,input),
  fetchImpl:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(++calls===1?verbose:reasoning())}}]})})});
 const report=normalizeReport(repaired,input);
 assert.equal(calls,2);assert.match(report.hypotheses[0].reason,/location is unconfirmed/);
 assert.doesNotMatch(report.interpretation,/…/);
});
test('optional empty narrative fields use meaningful fallback',()=>{
 const r=normalizeReport({...raw(),interpretation:'',nextStep:''},validateRequest(body()));
 assert.match(r.nextStep,/Describe when/);
});
test('failure diagnostics distinguish validation from provider failures without exposing data',async()=>{
 let detail;
 const r=await call(body(),{review:async()=>({...raw(),supportingEvidenceIds:['bad']}),logFailure:x=>detail=x});
 assert.equal(r.body.phase,'report_validation');assert.equal(r.body.reason,'INVALID_REPORT_CONTRACT');
 assert.deepEqual(detail,{phase:'report_validation',reason:'INVALID_REPORT_CONTRACT'});
 const upstream=await call(body(),{review:async()=>{throw new Error('private-secret-audio');},logFailure:x=>detail=x});
 assert.equal(upstream.body.phase,'provider');assert.equal(upstream.body.reason,'REVIEW_ERROR');
 assert.doesNotMatch(JSON.stringify(detail)+JSON.stringify(upstream.body),/private-secret/);
});

test('report retains decimal timestamps while removing a separate unsupported speed statement',()=>{
 const x=reasoning();x.soundObservation='Sharp bursts around 0.7s and 10.2s. Engine speed rises to 2400 RPM.';
 const r=normalizeReport(x,validateRequest(body()));
 assert.equal(r.soundObservation,'Sharp bursts around 0.7s and 10.2s.');
 assert.doesNotMatch(r.soundObservation,/0\. 7|RPM/);
});
test('hypothesis rationale and inspection appear once without repeated summary prose',()=>{
 const x=reasoning();x.interpretation='Possible loose exhaust shield.';
 x.nextStep=x.hypotheses[0].verification;
 const r=normalizeReport(x,validateRequest(body()));
 assert.match(r.interpretation,/cause remains unconfirmed/);
 assert.equal(r.nextStep,x.nextStep);
 assert.equal(r.soundObservation,x.soundObservation);
});
test('context question remains the next step while the inspection stays with its hypothesis',()=>{
 const x=reasoning();
 const r=normalizeReport(x,validateRequest(body()));
 assert.equal(r.nextStep,x.nextStep);
 assert.match(r.hypotheses[0].verification,/contact marks/);
});
test('short nonempty audible concern does not automatically become insufficient evidence',()=>{
 const r=normalizeReport({...reasoning(),audibleConcern:'Ticking'},validateRequest(body()));
 assert.equal(r.assessment,'verification_needed');
});
test('hypothesis evidence IDs are included in the report evidence set',()=>{
 const x=reasoning();x.supportingEvidenceIds=[];x.hypotheses[0].supportingEvidenceIds=['CH0_SIGNAL'];
 const r=normalizeReport(x,validateRequest(body()));
 assert.deepEqual(r.supportingEvidenceIds,['CH0_SIGNAL']);
});

test('follow-up question is structured, bounded, and asks for known context only',()=>{
 const input=validateRequest(body());
 const report=normalizeReport({...raw(),sessionStatus:'follow_up',followUpQuestion:{
  question:'When does this sound occur?',options:['During starting','At idle','Not sure'],
 }},input);
 assert.equal(report.sessionStatus,'follow_up');
 assert.deepEqual(report.followUpQuestion.options,['During starting','At idle','Not sure']);
 assert.throws(()=>normalizeReport({...raw(),sessionStatus:'follow_up',followUpQuestion:{question:'When?',options:['Yes','No']}},input),/follow-up question/);
});

function followupBody(){
 return {mode:'audio_followup_v1',language:'en',session:{contract:'audio_v3_report_v1',sessionStatus:'follow_up',
  assessment:'verification_needed',soundObservation:'A brief metallic rattle interrupts a steady low hum.',
  audibleConcern:'A brief metallic rattle',supportingEvidenceIds:['CH0_SIGNAL'],
  hypotheses:[{title:'Possible loose panel',reason:'A brief metallic rattle can come from a resonating panel; location is uncertain.',
   verification:'Have a technician check nearby panels and mounts for contact marks.',supportingEvidenceIds:[]}],
  interpretation:'A loose panel is one possibility; its source is not established.',nextStep:'',limitations:[]},
  answers:[{question:'When does it happen?',answer:'At idle'}],vehicleProfile:{year:'2018',make:'Toyota',model:'Camry'},
  audioEvidence:[{id:'CH0_SIGNAL',kind:'digital_signal',channel:0,values:{rms:0.01,rmsDbfs:-40,peak:0.02,nearFullScaleFraction:0}}],allowedEvidenceIds:['CH0_SIGNAL']};
}
test('follow-up contract bounds history and never requests the WAV again',()=>{
 const input=validateFollowUpRequest(followupBody()),prompt=buildFollowUpPrompt(input);
 assert.equal(input.answers.length,1);assert.match(prompt,/At idle/);assert.match(prompt,/confirmed mechanical diagnoses/i);
 assert.doesNotMatch(JSON.stringify(input),/audioBase64|base64/);
 assert.throws(()=>validateFollowUpRequest({...followupBody(),answers:[]}),/history/);
 assert.throws(()=>validateFollowUpRequest({...followupBody(),allowedEvidenceIds:['UNKNOWN']}),/session/);
});
test('follow-up provider sends text only and keeps the existing acoustic session',async()=>{
 let sent;
 const result=await requestFollowUp(validateFollowUpRequest(followupBody()),{apiKey:'mock',fetchImpl:async(_url,init)=>{
  sent=JSON.parse(init.body);return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({decision:'complete',question:null,report:raw()})}}]})};
 }});
 assert.equal(result.decision,'complete');assert.deepEqual(sent.modalities,['text']);
 assert.doesNotMatch(JSON.stringify(sent),/input_audio|audioBase64/);
});
test('text follow-up uses a separate cost-efficient model by default',async()=>{
 const priorAudio=process.env.OPENAI_AUDIO_MODEL,priorFollow=process.env.OPENAI_AUDIO_FOLLOWUP_MODEL,priorText=process.env.OPENAI_AUDIO_TEXT_MODEL;
 delete process.env.OPENAI_AUDIO_MODEL;delete process.env.OPENAI_AUDIO_FOLLOWUP_MODEL;delete process.env.OPENAI_AUDIO_TEXT_MODEL;let sent;
 try {
  await requestFollowUp(validateFollowUpRequest(followupBody()),{apiKey:'mock',fetchImpl:async(_url,init)=>{
   sent=JSON.parse(init.body);return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({decision:'complete',question:null,report:raw()})}}]})};
  }});
  assert.equal(sent.model,'gpt-4o-mini');
 } finally {
  if(priorAudio===undefined)delete process.env.OPENAI_AUDIO_MODEL;else process.env.OPENAI_AUDIO_MODEL=priorAudio;
  if(priorFollow===undefined)delete process.env.OPENAI_AUDIO_FOLLOWUP_MODEL;else process.env.OPENAI_AUDIO_FOLLOWUP_MODEL=priorFollow;
  if(priorText===undefined)delete process.env.OPENAI_AUDIO_TEXT_MODEL;else process.env.OPENAI_AUDIO_TEXT_MODEL=priorText;
 }
});
test('follow-up endpoint returns a next question and enforces the three-question ceiling',async()=>{
 const next={decision:'ask_question',question:{question:'Did a warning light appear?',options:['Yes','No','Not sure']},report:raw()};
 const handler=createFollowUpHandler({getApiKey:()=> 'test',review:async()=>next});
 const res=response();await handler({method:'POST',body:followupBody()},res);
 assert.equal(res.statusCode,200);assert.equal(res.body.decision,'ask_question');
 assert.equal(res.body.report.sessionStatus,'follow_up');assert.match(res.body.question.question,/warning light/);
 const finalBody=followupBody();finalBody.answers=[...finalBody.answers,{question:'Q2?',answer:'No'},{question:'Q3?',answer:'No'}];
 const finalRes=response();await handler({method:'POST',body:finalBody},finalRes);
 assert.equal(finalRes.statusCode,200);assert.equal(finalRes.body.decision,'complete');
});
test('a user-reported cranking answer permits a conditional starter possibility',async()=>{
 const b=followupBody();b.answers[0]={question:'When does it occur?',answer:'While the engine is cranking'};
 const report={...raw(),assessment:'verification_needed',audibleConcern:'A brief metallic burst during startup',
  hypotheses:[{title:'Possible starter engagement',reason:'The reported cranking timing fits a starter event; the sound alone cannot confirm wear.',
   verification:'A technician can inspect starter engagement and the ring gear for abnormal contact marks.',supportingEvidenceIds:[]}],
  interpretation:'A starter event is one possibility because the user reports cranking.',nextStep:'Have a technician compare the sound with starter engagement.'};
 const handler=createFollowUpHandler({getApiKey:()=> 'test',review:async()=>({decision:'complete',question:null,report})});
 const res=response();await handler({method:'POST',body:b},res);
 assert.equal(res.statusCode,200);assert.equal(res.body.report.hypotheses.length,1);
 assert.match(res.body.report.hypotheses[0].title,/starter/i);
});

test('negative qualification is retained but a separate safety clearance is rejected',()=>{
 const input=validateRequest(body());
 const r=normalizeReport({...raw(),soundObservation:'This recording does not prove the engine is healthy.'},input);
 assert.match(r.soundObservation,/does not prove/);
 assert.throws(()=>normalizeReport({...raw(),soundObservation:'The engine is not healthy, but it is safe to drive.'},input),/Unsupported/);
});
test('missing RPM and explicitly attributed user reports survive without claiming measurement',()=>{
 const input=validateRequest(body());
 for(const soundObservation of ['A steady tone is audible. No synchronized RPM is available.', 'The user reports engine speed changes; an audible pitch rise is present.']) {
  assert.equal(normalizeReport({...raw(),soundObservation},input).soundObservation,soundObservation);
 }
});
test('distinct practical meaning and non-question action are preserved',()=>{
 const x=reasoning();x.interpretation='Locate the source before selecting a component.';
 x.nextStep='Ask a technician to localize the sound before checking individual parts.';
 const r=normalizeReport(x,validateRequest(body()));
 assert.ok(r.interpretation.startsWith(x.interpretation));assert.ok(r.nextStep.startsWith(x.nextStep));
 assert.ok(r.nextStep.length<=500);assert.ok(r.interpretation.length<=500);
});
test('maximum bounded prose retains every complete field in existing Flutter limits',()=>{
 const x=reasoning();x.interpretation='a'.repeat(100);x.nextStep='b'.repeat(160);
 x.hypotheses=[0,1].map(i=>({title:String(i)+'c'.repeat(49),reason:'d'.repeat(140),verification:String(i)+'e'.repeat(144),supportingEvidenceIds:[]}));
 const r=normalizeReport(x,validateRequest(body()));
 assert.ok(r.interpretation.length<=500);assert.ok(r.nextStep.length<=500);
 assert.equal(r.hypotheses.length,2);
 for(let i=0;i<r.hypotheses.length;i++) {assert.ok(r.hypotheses[i].reason.length<=140);assert.ok(r.hypotheses[i].verification.length<=145);}
});
test('provider repairs incomplete completion once and preserves the same audio',async()=>{
 let calls=0;const payloads=[];const input=validateRequest(body());
 await requestReview(input,{apiKey:'mock',fetchImpl:async(url,options)=>{
  payloads.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{finish_reason:++calls===1?'length':'stop',message:{content:JSON.stringify(raw())}}]})};
 }});
 assert.equal(calls,2);assert.equal(payloads[0].messages[1].content[1].input_audio.data,payloads[1].messages[1].content[1].input_audio.data);
});
test('invalid completions are bounded to two calls and HTTP failures are not retried',async()=>{
 for(const http of [false,true]) {
  let calls=0;
  await assert.rejects(requestReview(validateRequest(body()),{apiKey:'mock',fetchImpl:async()=>{
   calls++;return http?{ok:false,status:401}:{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{broken'}}]})};
  }}));
  assert.equal(calls,http?1:2);
 }
});
test('endpoint passes its API key and report validator to provider',async()=>{
 let options;
 const r=await call(body(),{review:async(input,args)=>{options=args;return raw();},getApiKey:()=> 'test-secret'});
 assert.equal(r.statusCode,200);assert.equal(options.apiKey,'test-secret');assert.equal(typeof options.validateOutput,'function');
});
test('endpoint labels an incomplete completion without exposing content',async()=>{
 const r=await call(body(),{review:async()=>{throw new Error('Incomplete provider response');}});
 assert.equal(r.body.reason,'INCOMPLETE_PROVIDER_RESPONSE');
});
test('provider aborts within its shared timeout budget',async()=>{
 let calls=0;
 await assert.rejects(requestReview(validateRequest(body()),{apiKey:'mock',timeoutMs:20,
  fetchImpl:async(url,{signal})=>{calls++;return new Promise((resolve,reject)=>{
   signal.addEventListener('abort',()=>{const error=new Error('aborted');error.name='AbortError';reject(error);},{once:true});
  });},
 }),error=>error.name==='AbortError');
 assert.equal(calls,1);
});
test('a negated acoustic finding does not excuse an unsupported RPM claim',()=>{
 const r=normalizeReport({...raw(),soundObservation:'No distinct knocks at 2400 RPM. A steady hum is audible.'},validateRequest(body()));
 assert.equal(r.soundObservation,'A steady hum is audible.');
});

test('follow-up completion cannot reopen the occurrence interview',async()=>{
 const b=followupBody();b.answers=[{question:'When?',answer:'Not sure'},{question:'Q2?',answer:'Not sure'},{question:'Q3?',answer:'Not sure'}];
 const handler=createFollowUpHandler({getApiKey:()=> 'test',review:async()=>({decision:'ask_question',question:{question:'When?',options:['Startup','Running','Not sure']},report:{...raw(),soundObservation:'A brief metallic rattle is audible.',audibleConcern:'Brief metallic rattle'}})});
 const res=response();await handler({method:'POST',body:b},res);
 assert.equal(res.statusCode,200);assert.equal(res.body.decision,'complete');assert.equal(res.body.report.sessionStatus,'complete');assert.equal(res.body.report.followUpQuestion,null);
});
test('follow-up preserves measured evidence and rejects mismatched citations',()=>{
 const b=followupBody();const input=validateFollowUpRequest(b);
 assert.match(buildFollowUpPrompt(input),/"rmsDbfs":-40/);
 b.audioEvidence[0].id='CH0_OTHER';assert.throws(()=>validateFollowUpRequest(b),/evidence/i);
});


test('a complete interpretation over 100 characters is retained within the client limit',async()=>{
 const x=reasoning();x.interpretation='The audible rattle warrants locating its source before choosing a component. This recording supports a targeted inspection, but the exact cause remains unconfirmed.';
 assert.ok(x.interpretation.length>100);
 const r=await call(body(),{review:async()=>x});
 assert.equal(r.statusCode,200);
 assert.equal(r.body.report.interpretation,x.interpretation);
});
test('interpretation still rejects oversized, non-text and unsupported output',()=>{
 const input=validateRequest(body());
 for(const interpretation of ['a'.repeat(501),{},null]) {
  assert.throws(()=>normalizeReport({...reasoning(),interpretation},input),error=>error.message==='Invalid reasoning field' && error.field==='interpretation');
 }
 assert.throws(()=>normalizeReport({...reasoning(),interpretation:'The engine is healthy.'},input),/Unsupported/);
});

test('required interview asks before showing a final report even with operating context',async()=>{
 const b=body();b.interviewRequired=true;
 const r=await call(b,{review:async()=>raw()});
 assert.equal(r.statusCode,200);assert.equal(r.body.report.sessionStatus,'follow_up');
 assert.ok(r.body.report.followUpQuestion.options.includes('Not sure'));
 assert.match(r.body.report.followUpQuestion.question,/Besides this sound/);
});
test('required interview retains the model-generated sound-specific question',async()=>{
 const b=body();b.interviewRequired=true;
 const q={question:'Does this whine occur with the A/C off as well?',options:['Yes','No','Not sure']};
 const r=await call(b,{review:async()=>({...raw(),sessionStatus:'follow_up',followUpQuestion:q})});
 assert.deepEqual(r.body.report.followUpQuestion,q);
});
test('required interview has a localized fallback when timing is not known',async()=>{
 const b=body();b.interviewRequired=true;b.language='es';b.recordingContext={};
 const r=await call(b,{review:async()=>raw()});
 assert.equal(r.body.report.sessionStatus,'follow_up');assert.ok(r.body.report.followUpQuestion.options.includes('No estoy seguro'));
});
test('strict report cannot silently turn a missing concern into recording insufficiency',()=>{
 assert.throws(()=>normalizeReport({...reasoning(),audibleConcern:''},validateRequest(body()),{requireConsistentAssessment:true}),/consistency/);
 assert.throws(()=>normalizeReport({...raw(),assessment:'insufficient_evidence'},validateRequest(body()),{requireConsistentAssessment:true}),/consistency/);
 const report=normalizeReport({...raw(),assessment:'insufficient_evidence',recordingLimitation:'Wind masks the target sound.'},validateRequest(body()),{requireConsistentAssessment:true});
 assert.ok(report.limitations.includes('Wind masks the target sound.'));
});
test('strict report requests repair instead of downgrading an invalid citation',()=>{
 const x=reasoning();x.hypotheses[0].supportingEvidenceIds=['CH0_INVENTED'];
 assert.throws(()=>normalizeReport(x,validateRequest(body()),{requireConsistentAssessment:true}),/hypothesis evidence/);
});
test('follow-up keeps initial listening and original context while returning a targeted next question',async()=>{
 const b=followupBody();b.interviewRequired=true;b.recordingContext={engineState:'running',description:'Only with the A/C on',rpmBehavior:'idle_only'};
 const r=response();const handler=createFollowUpHandler({getApiKey:()=> 'mock',review:async(input)=>{
  assert.equal(input.context.engineState,'running');assert.equal(input.context.rpmBehavior,'idle_only');
  assert.equal(input.context.description,'Only with the A/C on');
  assert.match(buildFollowUpPrompt(input),/ORIGINAL RECORDING CONTEXT/);
  return {decision:'ask_question',question:{question:'Was a warning light already on?',options:['Yes','No','Not sure']},report:{...reasoning(),soundObservation:'A newly invented sound.'}};
 }});
 await handler({method:'POST',body:b},r);assert.equal(r.statusCode,200);
 assert.equal(r.body.report.soundObservation,b.session.soundObservation);
 assert.equal(r.body.decision,'ask_question');
});
test('a negative answer to a startup question is not evidence for a starter diagnosis',async()=>{
 const b=followupBody();b.interviewRequired=true;b.recordingContext={engineState:'running'};
 b.answers=[{question:'Does it happen during startup or cranking?',answer:'No, only while running'}];
 const x=reasoning();x.hypotheses[0].title='Possible starter drive';
 const r=response();await createFollowUpHandler({getApiKey:()=> 'mock',review:async()=>({decision:'complete',question:null,report:x})})({method:'POST',body:b},r);
 assert.equal(r.statusCode,502);
});
test('an answered question cannot be repeated in a required interview',async()=>{
 const b=followupBody();b.interviewRequired=true;
 const r=response();await createFollowUpHandler({getApiKey:()=> 'mock',review:async()=>({decision:'ask_question',question:{question:b.answers[0].question,options:['Yes','No','Not sure']},report:raw()})})({method:'POST',body:b},r);
 assert.equal(r.statusCode,502);
});
test('Not sure ends usefully without erasing a clear sound or inventing a diagnosis',async()=>{
 const b=followupBody();b.interviewRequired=true;b.answers=[{question:'When?',answer:'Not sure'},{question:'Any other symptom?',answer:'Not sure'},{question:'Recurring?',answer:'Not sure'}];
 const r=response();await createFollowUpHandler({getApiKey:()=> 'mock',review:async()=>({decision:'ask_question',question:{question:'Fourth?',options:['Yes','No','Not sure']},report:{...raw(),interpretation:'The rattle is audible but its source remains unresolved.',nextStep:'Have a technician localize the rattle before selecting any part.'}})})({method:'POST',body:b},r);
 assert.equal(r.statusCode,200);assert.equal(r.body.decision,'complete');
 assert.equal(r.body.report.soundObservation,b.session.soundObservation);
 assert.equal(r.body.report.assessment,'no_fault_supported');assert.deepEqual(r.body.report.hypotheses,[]);
});
test('text follow-up repairs a malformed report once within the same history',async()=>{
 const input=validateFollowUpRequest(followupBody());let calls=0;const sent=[];
 await requestFollowUp(input,{apiKey:'mock',validateOutput:value=>{if(!value.report) throw new Error('Invalid report contract');},fetchImpl:async(_url,options)=>{
  sent.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(++calls===1?{}:{decision:'complete',report:raw()})}}]})};
 }});
 assert.equal(calls,2);assert.equal(sent[0].messages[1].content,sent[1].messages[1].content);
});

test('required interviews use the full text model unless explicitly configured',async()=>{
 const input=validateFollowUpRequest({...followupBody(),interviewRequired:true});
 const keys=['OPENAI_AUDIO_FOLLOWUP_MODEL','OPENAI_AUDIO_TEXT_MODEL'];const previous=keys.map(k=>process.env[k]);let sent;
 try {
  keys.forEach(k=>delete process.env[k]);
  await requestFollowUp(input,{apiKey:'mock',fetchImpl:async(_url,options)=>{
   sent=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({decision:'complete',report:raw()})}}]})};
  }});
  assert.equal(sent.model,'gpt-4.1');assert.match(sent.messages[1].content,/do not claim to hear it again/i);
 } finally {keys.forEach((k,i)=>previous[i]===undefined?delete process.env[k]:process.env[k]=previous[i]);}
});
test('required reports accept complete bounded rationale without truncating it',()=>{
 const x=reasoning();x.hypotheses[0].reason='The brief metallic resonance could come from a panel vibrating against a nearby mount. The recording supports a localization check, but cannot establish which panel or bracket is responsible.';
 x.hypotheses[0].verification='A technician can check nearby panels for contact marks and loose mountings; matching the rattle to movement at a contact point would support this explanation.';
 const r=normalizeReport(x,validateRequest(body()),{requireConsistentAssessment:true});
 assert.equal(r.hypotheses[0].reason,x.hypotheses[0].reason);assert.equal(r.hypotheses[0].verification,x.hypotheses[0].verification);
});


test('startup alone cannot become a warm-up finding in a strict report',()=>{
 const input=validateRequest({...body(),recordingContext:{engineState:'starting',description:'Only at startup'}});
 for(const [field,value] of [['interpretation','The pulley settles as the engine warms.'],['soundObservation','A rattle fades as the engine warms.']]) {
  assert.throws(()=>normalizeReport({...reasoning(),[field]:value},input,{requireConsistentAssessment:true}),error=>error.message==='Unsupported report claim' && error.field===field);
 }
 const x=reasoning();x.hypotheses[0].reason='The tensioner settles as the engine warms.';
 assert.throws(()=>normalizeReport(x,input,{requireConsistentAssessment:true}),/Unsupported report claim/);
});
test('explicit thermal context permits a hypothesis while an unknown answer does not',()=>{
 const x=reasoning();x.interpretation='The user reports this rattle only on cold starts; its source remains unresolved.';
 const known=validateRequest({...body(),recordingContext:{engineState:'starting',description:'Only on cold starts'}});
 assert.equal(normalizeReport(x,known,{requireConsistentAssessment:true}).interpretation,x.interpretation);
 const unknown=validateRequest({...body(),recordingContext:{engineState:'starting',description:'Not sure whether cold or warm'}});
 assert.throws(()=>normalizeReport(x,unknown,{requireConsistentAssessment:true}),/Unsupported report claim/);
});
test('a proposed thermal comparison remains a check rather than a claimed observation',()=>{
 const x=reasoning();x.hypotheses[0].verification='A technician can compare cold and warm starts to determine whether temperature affects the event.';
 assert.equal(normalizeReport(x,validateRequest(body()),{requireConsistentAssessment:true}).hypotheses[0].verification,x.hypotheses[0].verification);
});
test('diagnostic prompts distinguish clip timing, temperature and the three belt systems',()=>{
 const initial=buildPrompt(validateRequest({...body(),interviewRequired:true}));
 const next=buildFollowUpPrompt(validateFollowUpRequest({...followupBody(),interviewRequired:true}));
 for(const prompt of [initial,next]) {
  assert.match(prompt,/timing belt/);assert.match(prompt,/timing chain/);
  assert.match(prompt,/Only at startup/);assert.match(prompt,/CLIP|clip timeline/);
  assert.match(prompt,/discriminating/);
 }
});

for (const shape of ['missing_ids','too_many']) test(`initial hypothesis repair names the schema: ${shape}`,async()=>{
 const b=body();b.interviewRequired=true;const input=validateRequest(b);
 const hypothesis={title:'Possible mechanical resonance',reason:'The audible rattle warrants localization; its source is unconfirmed.',verification:'A technician should localize the rattle.',supportingEvidenceIds:[]};
 const valid={...raw(),assessment:'verification_needed',audibleConcern:'A metallic rattle',hypotheses:[hypothesis]};
 const malformed=shape==='too_many'?{...valid,hypotheses:[hypothesis,hypothesis,hypothesis]}:{...valid,hypotheses:[{...hypothesis,supportingEvidenceIds:undefined}]};
 let calls=0;const requests=[];
 const result=await requestReview(input,{apiKey:'mock',validateOutput:value=>normalizeReport(value,input,{requireConsistentAssessment:true}),fetchImpl:async(_url,options)=>{
  requests.push(JSON.parse(options.body));calls++;
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(calls===1?malformed:valid)}}]})};
 }});
 assert.equal(calls,2);assert.equal(result.hypotheses.length,1);
 assert.match(requests[1].messages.at(-1).content,/Every object MUST contain/);
 assert.match(requests[1].messages.at(-1).content,/supportingEvidenceIds/);
 assert.equal(requests[1].messages[1].content[1].input_audio.data,input.audioBase64);
});
test('hypothesis shape failure identifies the missing field without logging audio',async()=>{
 const b=body();b.interviewRequired=true;let logged;
 const r=await call(b,{review:async()=>({...raw(),hypotheses:[{title:'Resonance'}]}),logFailure:detail=>{logged=detail;}});
 assert.equal(r.statusCode,502);assert.equal(logged.reason,'INVALID_HYPOTHESES');
 assert.equal(logged.field,'hypotheses[0].supportingEvidenceIds');assert.equal(logged.audio,undefined);
});
