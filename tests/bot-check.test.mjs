import test from 'node:test';
import assert from 'node:assert/strict';
import {createBotVerifier,turnstileConfigured} from '../verification/bot-check.js';
const env={TURNSTILE_SITE_KEY:'site-key-production-fixture-123456',TURNSTILE_SECRET_KEY:'secret-key-production-fixture-123456'};
const options={env,origin:'http://localhost:5173',address:'203.0.113.1'};
const now=Date.now();
const valid={success:true,hostname:'localhost',action:'verified-run',challenge_ts:new Date(now).toISOString()};

test('server bot validation uses only Siteverify, a private key, trusted address and bounded manual-redirect request',async()=>{
  const calls=[];const verify=createBotVerifier(async(url,init)=>{calls.push({url,init});return Response.json(valid);},()=>now);
  await verify('browser-token',options);assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');assert.equal(calls[0].init.redirect,'manual');
  const body=JSON.parse(calls[0].init.body);assert.equal(body.secret,env.TURNSTILE_SECRET_KEY);assert.equal(body.response,'browser-token');
  assert.equal(body.remoteip,options.address);assert.match(body.idempotency_key,/^[a-f0-9-]{36}$/);assert.ok(calls[0].init.signal instanceof AbortSignal);
});
test('bot checks reject failed/reused, wrong-host, wrong-action, old and future tokens',async()=>{
  for(const change of [{success:false,'error-codes':['timeout-or-duplicate']},{hostname:'evil.example'},{action:'login'},
    {challenge_ts:new Date(now-300001).toISOString()},{challenge_ts:new Date(now+15001).toISOString()},{challenge_ts:'invalid'}]){
    const verify=createBotVerifier(async()=>Response.json({...valid,...change}),()=>now);
    await assert.rejects(verify('token',options),error=>error.status===403&&error.code==='bot-check-failed');
  }
});
test('missing credentials, production dummy keys, token bounds, provider redirects and oversized responses fail closed',async()=>{
  let calls=0;const verify=createBotVerifier(async()=>{calls++;return Response.json(valid);});
  assert.equal(turnstileConfigured(env),true);
  for(const changed of [{TURNSTILE_SECRET_KEY:''},{TURNSTILE_SITE_KEY:''},{TURNSTILE_SITE_KEY:'1x00000000000000000000AA'},{TURNSTILE_SECRET_KEY:'1x0000000000000000000000000000000AA'}]){
    const settings={...options,env:{...env,...changed}};assert.equal(turnstileConfigured(settings.env),false);
    await assert.rejects(verify('token',settings),error=>error.status===503);
  }
  for(const token of ['',null,'x'.repeat(2049)])await assert.rejects(verify(token,options),error=>error.code==='bot-check-required');
  assert.equal(calls,0);
  for(const response of [new Response(null,{status:302,headers:{location:'https://evil.example'}}),new Response('x'.repeat(16385)),new Response('not-json')])
    await assert.rejects(createBotVerifier(async()=>response)('token',options),error=>error.code==='bot-check-unavailable');
});
