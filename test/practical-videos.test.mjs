import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/practical-videos.js';
import { createPracticalVideoService, videoContext, youtubeId } from '../lib/ask/practical-videos.js';
const context = {year:'2012',make:'Toyota',model:'Camry',engine:'2.5',system:'Cooling',finding:'Hot at idle, normal moving',task:'Check commanded and actual cooling fan operation'};
const id = 'abcdefghijk';
function searchResult(candidates, sources = [id]) {
  return new Response(JSON.stringify({ output:[
    {type:'web_search_call',action:{sources:sources.map(v=>({url:`https://www.youtube.com/watch?v=${v}`}))}},
    {type:'message',content:[{type:'output_text',text:JSON.stringify({videos:candidates})}]}] }));
}
const candidate = {url:`https://www.youtube.com/watch?v=${id}`,kind:'diagnosis',scope:'General fan electrical diagnostic procedure; verify your vehicle wiring.'};
const metadata = () => new Response(JSON.stringify({provider_name:'YouTube',type:'video',title:'Cooling fan circuit diagnosis',author_name:'Repair channel'}));
test('context drops VIN, chat and unknown fields, bounds text, rejects missing tasks',()=>{
  const clean=videoContext({...context,vin:'PRIVATE',conversation:['private'],finding:'x'.repeat(900)});
  assert.equal(clean.finding.length,500); assert.equal(clean.vin,undefined); assert.equal(clean.conversation,undefined);
  assert.equal(videoContext({...context,task:''}),null);
  assert.equal(videoContext({...context,task:{url:'localhost'}}),null);
});
test('search works across vehicle types and tasks without a topic catalog',async()=>{
  for (const c of [context,{...context,make:'Tesla',model:'Model 3',engine:'Electric',system:'Cabin heat',task:'Diagnose insufficient cabin heat'},
    {...context,make:'Ford',model:'F-150',system:'Transmission',task:'Diagnose delayed engagement'},
    {...context,make:'BMW',model:'320d',engine:'Diesel',task:'Diagnose boost hose leak'}]) {
    const get=createPracticalVideoService({apiKey:()=> 'test-only',fetchImpl:async(url,options)=>{
      if(String(url).includes('api.openai.com')) {
        const request=JSON.parse(options.body);
        assert.deepEqual(JSON.parse(request.input).vehicleAndTask,videoContext(c));
        assert.equal(request.tools[0].type,'web_search'); assert.equal(request.store,false);
        return searchResult([candidate]);
      }
      assert.equal(new URL(url).hostname,'www.youtube.com'); return metadata();
    }});
    assert.equal((await get(c,'en')).length,1);
  }
});
test('rejects invented URLs, unknown procedure types, duplicates and unavailable clips',async()=>{
  let checks=0;
  const get=createPracticalVideoService({apiKey:()=> 'test-only',fetchImpl:async(url)=>{
    if(String(url).includes('api.openai.com')) return searchResult([
      {...candidate,url:'https://www.youtube.com/watch?v=zzzzzzzzzzz'},
      {...candidate,kind:'theory'},candidate,candidate]);
    checks++; return metadata();
  }});
  const videos=await get(context,'en'); assert.equal(videos.length,1); assert.equal(checks,1);
  assert.equal(videos[0].title,'Cooling fan circuit diagnosis');
  const offline=createPracticalVideoService({apiKey:()=> 'test-only',fetchImpl:async()=> {throw new Error('offline');}});
  assert.deepEqual(await offline(context,'en'),[]);
});
test('coalesces requests and caches only by vehicle/task/language',async()=>{
  let calls=0;
  const get=createPracticalVideoService({apiKey:()=> 'test-only',fetchImpl:async(url)=>{
    calls++; return String(url).includes('api.openai.com')?searchResult([candidate]):metadata();
  }});
  await Promise.all([get(context,'en'),get(context,'en')]); assert.equal(calls,2);
  await get(context,'en'); assert.equal(calls,2);
  await get({...context,model:'Corolla'},'en'); assert.equal(calls,4);
});
test('only grounded YouTube IDs become fixed-host availability requests',()=>{
  for(const url of ['http://www.youtube.com/watch?v=abcdefghijk','https://www.youtube.com.evil.test/watch?v=abcdefghijk','https://user@www.youtube.com/watch?v=abcdefghijk','https://localhost/watch?v=abcdefghijk'])assert.equal(youtubeId(url),null);
});
test('endpoint rejects invalid and oversized requests before model access',async()=>{
  const res=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this},json(x){this.body=x;return x}});
  const a=res(); await handler({method:'GET'},a);assert.equal(a.statusCode,405);
  const b=res(); await handler({method:'POST',body:{context,language:'fr'}},b);assert.equal(b.statusCode,400);
  const c=res(); await handler({method:'POST',body:'x'.repeat(7000)},c);assert.equal(c.statusCode,400);
});
