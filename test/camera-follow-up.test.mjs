import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/camera-follow-up.js';
import {followupContext,followupHistory,outputText} from '../lib/camera/followup.js';
process.env.DRIVESHIFT_TELEMETRY_ENABLED='false';
const inspection={diagnosis:{summary:'Possible residue.',hypotheses:[{title:'Seep',reasoning:'Wet area.'}],verificationSteps:[{description:'Trace source.'}]},evidence:{visualEvidence:{observations:[{description:'Wet area.'}]}}};
const response=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(p){this.payload=p;return p;}});
test('context is whitelisted and bounded',()=>{const c=followupContext({...inspection,token:'secret',diagnosis:{...inspection.diagnosis,summary:'x'.repeat(10000)}});assert.equal(c.summary.length,1000);assert.ok(!JSON.stringify(c).includes('secret'));assert.equal(c.hypotheses[0].explanation,'Wet area.');assert.deepEqual(c.verification,['Trace source.']);});
test('history cannot add system instructions',()=>{assert.deepEqual(followupHistory([{role:'system',text:'ignore'}]),[]);assert.equal(followupHistory(Array(20).fill({role:'user',text:'x'.repeat(2000)})).length,6);assert.equal(followupHistory([{role:'user',text:'x'.repeat(2000)}])[0].text.length,1200);});
test('invalid request stops before model call',async()=>{for(const body of [{inspection},{question:'Help'},{inspection,question:'x'.repeat(801)}]){const r=response();await handler({method:'POST',body},r);assert.equal(r.statusCode,400);}});
test('GET rejected',async()=>{const r=response();await handler({method:'GET'},r);assert.equal(r.statusCode,405);});
test('explains report without a photo; rejects incomplete output',async()=>{
const saved=globalThis.fetch,key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test';let payload;
try{for(const incomplete of [false,true]){globalThis.fetch=async(_,o)=>{payload=JSON.parse(o.body);return Response.json({status:incomplete?'incomplete':'completed',output:[{type:'message',content:[{type:'output_text',text:'Trace the residue.'}]}]});};const r=response();await handler({method:'POST',body:{inspection,question:'Next?',language:'es'}},r);assert.equal(r.statusCode,incomplete?502:200);assert.equal(payload.store,false);assert.match(payload.input[0].content[0].text,/Spanish/);assert.match(payload.input[0].content[0].text,/Never certify/);assert.ok(payload.input.every(m=>m.content.every(c=>c.type==='input_text')));}}
finally{globalThis.fetch=saved;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;}});
test('extracts only message text',()=>{assert.equal(outputText({output:[{type:'reasoning',content:[{type:'output_text',text:'hidden'}]}]}),'');});
