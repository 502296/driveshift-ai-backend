import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/diagnose.js';
import {caseConfiguration, DEFAULT_CASE_MODEL} from '../lib/cases/report-conversation.js';
const vehicleProfile={year:'2012',make:'Toyota',model:'Camry'};
const previous={primaryFinding:'Possible wheel imbalance.'};
const body=(answer='What does runout mean?')=>({issue:'Vibration at 55–60 mph',vehicleProfile,
 answers:[{question:'Where?',answer:'Windshield and dashboard'},{question:'Case update or question',answer}],
 continuation:{sessionId:'case-1',reports:[previous],messages:[]}});
const response=()=>({code:200,setHeader(){},status(c){this.code=c;return this;},json(v){this.body=v;return v;}});
async function withReplies(replies,run){
 const saved=globalThis.fetch,key=process.env.OPENAI_API_KEY,override=process.env.DRIVESHIFT_CASE_MODEL;
 process.env.OPENAI_API_KEY='test';delete process.env.DRIVESHIFT_CASE_MODEL;
 const payloads=[];
 globalThis.fetch=async(_,options)=>{payloads.push(JSON.parse(options.body));const reply=replies.shift();if(reply instanceof Error)throw reply;return Response.json(reply);};
 try{await run(payloads);}finally{globalThis.fetch=saved;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;if(override===undefined)delete process.env.DRIVESHIFT_CASE_MODEL;else process.env.DRIVESHIFT_CASE_MODEL=override;}
}
const completed=value=>({status:'completed',output_text:JSON.stringify(value)});
test('case model selection is scoped and uses supported reasoning efforts',()=>{
 assert.equal(DEFAULT_CASE_MODEL,'gpt-6.1-sol');
 assert.deepEqual(caseConfiguration({}),{model:'gpt-6.1-sol',reasoning:'low'});
 assert.deepEqual(caseConfiguration({DRIVESHIFT_CASE_MODEL:'custom',DRIVESHIFT_CASE_REASONING:'none'}),{model:'custom',reasoning:'low'});
});
test('plain explanation has one call and does not regenerate a report',async()=>withReplies([
 completed({status:'explanation',message:'Runout means the assembly does not rotate evenly around its axis.',question:''})
],async payloads=>{
 const res=response();await handler({method:'POST',body:body()},res);
 assert.equal(res.code,200);assert.equal(res.body.status,'explanation');assert.equal(payloads.length,1);
 assert.equal(payloads[0].model,'gpt-6.1-sol');assert.equal(payloads[0].reasoning.effort,'low');
 assert.match(payloads[0].instructions,/history recall/);assert.match(payloads[0].instructions,/not a script to repeat/);
 assert.ok(!('report' in res.body));
}));
test('repair/collision update remains distinct, acknowledges update and asks one question',async()=>withReplies([
 completed({status:'follow_up',message:'You reported a collision and mount replacement with persistent vibration.',question:'Did the vibration begin after the collision or after the repair?'})
],async payloads=>{
 const res=response();const request=body('The car had a collision and its engine mounts were replaced, but the vibration remains.');
 // More than three existing answers must not force a new report.
 request.answers.splice(1,0,{question:'When?',answer:'Only moving'},{question:'Speed?',answer:'55–60 mph'},{question:'Change?',answer:'No improvement'});
 await handler({method:'POST',body:request},res);
 assert.equal(res.body.status,'follow_up');assert.match(res.body.message,/mount replacement/);
 assert.match(res.body.question,/after the collision/);assert.equal(payloads.length,1);
 const sent=JSON.parse(payloads[0].input);assert.match(sent.answersChronological.at(-1).answer,/engine mounts/);
 assert.equal(sent.previousConclusions[0].primaryFinding,previous.primaryFinding);
 assert.match(payloads[0].instructions,/Reassess rather than anchor/);
}));
test('an incomplete case response produces a retryable error rather than a false report',async()=>withReplies([
 {status:'incomplete',output_text:JSON.stringify({status:'explanation',message:'partial',question:''})}
],async()=>{const res=response();await handler({method:'POST',body:body()},res);assert.equal(res.code,503);assert.equal(res.body.code,'CASE_REPLY_UNAVAILABLE');}));
test('updated report request uses the scoped model and reassessment instructions',async()=>withReplies([
 completed({status:'ready',message:'Consider the newly clarified repair timeline.',question:''}),
 completed({schemaVersion:'1.0',primaryFinding:'Persistent vibration after reported mount repair requires reassessment.',
 systemFocus:{id:'steering_suspension',label:'Wheels and suspension',affectedNodes:[]},
 confidence:'MODERATE',evidence:[{id:'E01',source:'user_observation',status:'OBSERVED',observation:'User reports persistent vibration after a mount repair.',diagnosticMeaning:'The reported repair did not resolve the symptom.'}],hypotheses:[{id:'H01',title:'Possible wheel imbalance',likelihood:'MODERATE',supportingEvidenceIds:['E01'],contradictingEvidenceIds:[],confirmationTest:'Measure balance and runout.'}],verificationPath:[{step:1,action:'Inspect wheel balance and reported repair.',purpose:'Separate sources.',expectedResult:'A measurable source.',stopCondition:'Unsafe damage found.'}],doNotReplaceYet:[],safety:{},finalGuidance:'Arrange inspection.'})
],async payloads=>{
 const res=response();await handler({method:'POST',body:body('Update the report with the new repair history.')},res);
 assert.equal(payloads.length,2);assert.equal(payloads[1].model,'gpt-6.1-sol');
 assert.match(payloads[1].instructions,/REASSESSMENT/);assert.match(payloads[1].input,/new repair history/);
 // A new revision passes the existing integrity gate while the previous report remains intact.
 assert.equal(previous.primaryFinding,'Possible wheel imbalance.');
 assert.equal(res.body.status,'analysis');
 assert.match(res.body.report.primaryFinding,/mount repair/);
}));
test('explanation knows the displayed revision without promoting later reports into facts',async()=>withReplies([
 completed({status:'explanation',message:'This is the original assessment; the later update is a separate revision.',question:''})
],async payloads=>{
 const request=body();request.continuation.reports.push({primaryFinding:'A later reassessment'});request.continuation.viewedReportIndex=0;
 const res=response();await handler({method:'POST',body:request},res);
 assert.equal(JSON.parse(payloads[0].input).displayedReportIndex,0);
 assert.equal(res.body.status,'explanation');assert.equal(payloads.length,1);
}));
test('invalid displayed revision stops before an upstream request',async()=>withReplies([],async payloads=>{
 const request=body();request.continuation.viewedReportIndex=50;
 const res=response();await handler({method:'POST',body:request},res);
 assert.equal(res.code,400);assert.equal(payloads.length,0);
}));
