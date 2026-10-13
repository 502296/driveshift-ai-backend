import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from '../lib/admin/supabase.js';
import { withTelemetry } from '../lib/admin/telemetry.js';
import { summarize } from '../api/admin/overview.js';
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY='public-fixture';
process.env.SUPABASE_SECRET_KEY='secret-fixture';
const uuid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
test('authorization rejects missing or malformed bearer token without network',async()=>{let calls=0;globalThis.fetch=async()=>{calls++;};assert.equal(await authorize({headers:{}}),null);assert.equal(await authorize({headers:{authorization:'Bearer x y'}}),null);assert.equal(calls,0);});
test('invalid auth token cannot access membership table',async()=>{let calls=0;globalThis.fetch=async()=>{calls++;return new Response('',{status:401});};assert.equal(await authorize({headers:{authorization:'Bearer invalid'}}),null);assert.equal(calls,1);});
test('authenticated user without membership is denied',async()=>{globalThis.fetch=async url=>Response.json(url.includes('/auth/')?{id:uuid}:[]);assert.equal(await authorize({headers:{authorization:'Bearer user-jwt'}}),null);});
test('only active authorized membership permits access and secret stays off auth request',async()=>{globalThis.fetch=async(url,opts)=>{if(url.includes('/auth/')){assert.equal(opts.headers.apikey,'public-fixture');assert.equal(opts.headers.Authorization,'Bearer user-jwt');return Response.json({id:uuid,email:'owner@example.com'});}assert.ok(url.includes('active=eq.true'));assert.equal(opts.headers.apikey,'secret-fixture');assert.equal(opts.headers.Authorization,undefined);return Response.json([{role:'owner'}]);};assert.equal((await authorize({headers:{authorization:'Bearer user-jwt'}})).role,'owner');});
test('database outage fails closed',async()=>{globalThis.fetch=async url=>url.includes('/auth/')?Response.json({id:uuid}):new Response('',{status:503});await assert.rejects(authorize({headers:{authorization:'Bearer user-jwt'}}));});
test('statistics count errors and follow-ups as requests',()=>{const s=summarize([{endpoint:'diagnose',http_status:200,duration_ms:100,outcome:'follow_up'},{endpoint:'diagnose',http_status:200,duration_ms:300,outcome:'error'}]);assert.equal(s.requests,2);assert.equal(s.errors,1);assert.equal(s.averageMs,200);assert.equal(summarize([]).averageMs,0);});
test('telemetry disabled preserves handler return and response',async()=>{process.env.DRIVESHIFT_TELEMETRY_ENABLED='false';let calls=0;globalThis.fetch=async()=>{calls++;};const res={statusCode:200,json:x=>x};const body={status:'analysis',report:'private'};assert.equal(await withTelemetry((req,res)=>res.json(body),'diagnose')({method:'POST'},res),body);assert.equal(calls,0);});
test('telemetry outage preserves response and records no private content',async()=>{process.env.DRIVESHIFT_TELEMETRY_ENABLED='true';let recorded;globalThis.fetch=async(url,opts)=>{recorded=JSON.parse(opts.body);throw new Error('offline');};const original=x=>x;const res={statusCode:200,json:original};const payload={status:'analysis',report:'private report'};assert.equal(await withTelemetry((req,res)=>res.json(payload),'diagnose')({method:'POST',body:{image:'private',email:'private'}},res),payload);assert.equal(res.json,original);assert.deepEqual(Object.keys(recorded).sort(),['duration_ms','endpoint','http_status','outcome']);});
test('public config exposes only URL and publishable key',async()=>{const {default:handler}=await import('../api/admin/config.js');let payload;const res={setHeader(){},status(){return this;},json(x){payload=x;}};handler({method:'GET'},res);assert.deepEqual(Object.keys(payload).sort(),['publishableKey','url']);assert.ok(!JSON.stringify(payload).includes('secret-fixture'));});

test('config rejects URLs with extra paths or credentials', async () => {
  const {config} = await import('../lib/admin/supabase.js');
  const previous = process.env.SUPABASE_URL;
  try {
    for (const url of [
      'https://example.supabase.co/rest/v1',
      'https://example.supabase.co/?x=1',
      'https://example.supabase.co/#x',
      'https://user:pass@example.supabase.co',
      'http://example.supabase.co'
    ]) {
      process.env.SUPABASE_URL = url;
      assert.throws(() => config());
    }
    process.env.SUPABASE_URL = ' https://example.supabase.co/ ';
    assert.equal(config().url, 'https://example.supabase.co');
  } finally {
    process.env.SUPABASE_URL = previous;
  }
});

test('overview labels a capped 1000-row response as potentially limited', async () => {
  const {default:handler} = await import('../api/admin/overview.js');
  const savedFetch = globalThis.fetch;
  try {
    globalThis.fetch = async url => Response.json(
      url.includes('/auth/') ? {id:uuid} :
      url.includes('driveshift_admin_members') ? [{role:'owner'}] :
      Array.from({length:1000}, () => ({
        endpoint:'diagnose',
        http_status:200,
        duration_ms:100,
        outcome:'analysis'
      }))
    );
    let payload;
    const res = {
      setHeader(){},
      status(code){assert.equal(code,200); return this;},
      json(data){payload=data;}
    };
    await handler({
      method:'GET',
      headers:{authorization:'Bearer user-jwt'}
    }, res);
    assert.equal(payload.requests,1000);
    assert.equal(payload.sampled,true);
  } finally {
    globalThis.fetch = savedFetch;
  }
});
