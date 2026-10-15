import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVehicleHistory} from '../lib/memory/vehicle-history.js';
import diagnose from '../api/diagnose.js';
const now=Date.parse('2026-10-15T12:00:00Z');
const event={id:'b'.repeat(32),type:'obd',source:'obd_snapshot',at:'2026-10-01T12:00:00Z',title:'OBD scan',summary:'P0302 was recorded.',historical:false,ageDays:0,secret:'private'};
const history=(events=[event])=>({version:1,vehicleId:'a'.repeat(32),events,token:'private',image:'private'});
test('history is whitelisted, dated by the server, and always historical',()=>{
 const value=normalizeVehicleHistory(history(),now);assert.equal(value.events[0].historical,true);assert.equal(value.events[0].ageDays,14);assert.ok(!JSON.stringify(value).includes('private'));
});
test('invalid types, future dates, references and forged source labels are removed',()=>{
 for(const patch of [{type:'roadside'},{at:'2030-01-01'},{referenceOnly:true},{source:'verified_current'},{id:'../../x'}])assert.equal(normalizeVehicleHistory(history([{...event,...patch}]),now),null);
});
test('duplicate history events cannot multiply evidence',()=>assert.equal(normalizeVehicleHistory(history([event,event]),now).events.length,1));
test('history has event and UTF-8 budgets, and missing history remains optional',()=>{
 const value=normalizeVehicleHistory(history(Array.from({length:20},(_,i)=>({...event,id:i.toString(16).padStart(32,'0'),summary:'😀'.repeat(900)}))),now);
 assert.ok(value.events.length<=8);assert.ok(Buffer.byteLength(JSON.stringify(value.events))<=9000);assert.equal(normalizeVehicleHistory(undefined,now),null);
});
test('Ask interview receives sanitized history separately from current evidence',async()=>{
 const fetchSaved=globalThis.fetch,key=process.env.OPENAI_API_KEY;
 process.env.OPENAI_API_KEY='test';let payload;
 globalThis.fetch=async(_,options)=>{payload=JSON.parse(options.body);return Response.json({status:'completed',output_text:JSON.stringify({status:'follow_up',question:'When did the rough idle begin?'})});};
 const res={code:200,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return body;}};
 try {
  await diagnose({method:'POST',body:{issue:'The engine idles roughly when cold.',answers:[],vehicleProfile:{year:'2020',make:'Toyota',model:'Camry'},vehicleMemory:history()}},res);
  assert.ok(payload);assert.match(payload.instructions,/historical OBD/i);assert.match(JSON.stringify(payload.input),/P0302 was recorded/);assert.ok(!JSON.stringify(payload).includes('"secret"'));
 }finally{globalThis.fetch=fetchSaved;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;}
});
test('camera follow-up uses bounded historical text without resending photos',async()=>{
 const {default:followup}=await import('../api/camera-follow-up.js');
 const saved=globalThis.fetch,key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test';let payload,calls=0;
 globalThis.fetch=async(_,options)=>{calls++;payload=JSON.parse(options.body);return Response.json({status:'completed',output_text:'That earlier scan may guide verification.'});};
 const res={code:200,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return body;}};
 try {
  await followup({method:'POST',body:{question:'Does my previous scan matter?',inspection:{diagnosis:{summary:'Oil pressure warning visible.'}},vehicleMemory:history()}},res);
  assert.equal(res.code,200);assert.equal(calls,1);
  assert.ok(payload.input.every(message=>message.content.every(block=>block.type==='input_text')));
  assert.match(payload.input[0].content[0].text,/historical OBD/);
  assert.match(payload.input[1].content[0].text,/P0302 was recorded/);
  assert.ok(!JSON.stringify(payload).includes('private'));
 }finally{globalThis.fetch=saved;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;}
});
