import test from 'node:test';
import assert from 'node:assert/strict';
import {createStagingClient,connectionError} from '../verification/staging-client.mjs';
import {runHostedBenchmark} from '../verification/hosted-benchmark.mjs';

const base='https://movement-lab-verifier-staging.example.workers.dev',secret='not-a-real-private-key-1234567890123456789';
const healthy=()=>Response.json({service:'movement-lab-verifier',mode:'private-staging',ranked:false});
const networkError=(code='ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE')=>Object.assign(new TypeError('fetch failed '+secret),{cause:Object.assign(Error('private details '+secret),{code})});
test('startup waits for transient TLS errors without sending credentials or disabling certificate verification',async()=>{
 let attempts=0,now=0;const requests=[],delays=[],messages=[];
 const api=createStagingClient({base,secret,now:()=>now,log:x=>messages.push(x),sleep:async ms=>{delays.push(ms);now+=ms;},
  fetchFn:async(url,options)=>{requests.push({url,options});if(++attempts<3)throw networkError();return healthy();}});
 assert.equal((await api.ready({attempts:3})).ranked,false);assert.equal(attempts,3);assert.deepEqual(delays,[5000,5000]);
 for(const {url,options} of requests){assert.equal(url,base+'/health');assert.equal(options.method,'GET');assert.equal(options.headers.authorization,undefined);assert.equal(options.redirect,'error');assert.equal(options.dispatcher,undefined);assert.equal(options.rejectUnauthorized,undefined);}
 assert.ok(messages.some(m=>m.includes('HTTPS is ready')));assert.ok(!messages.join(' ').includes(secret));
});
test('startup timeout gives a bounded, non-secret retry instruction and does not run tests',async()=>{
 let attempts=0;const api=createStagingClient({base,secret,log(){},sleep:async()=>{},fetchFn:async()=>{attempts++;throw networkError();}});
 await assert.rejects(api.ready({attempts:2}),error=>error.message.includes('test-staging.command')&&!error.message.includes(secret));
 assert.equal(attempts,2);
});
test('certificate validation errors are not retried or bypassed',async()=>{
 let attempts=0;const api=createStagingClient({base,secret,log(){},sleep:async()=>{throw Error('must not retry');},fetchFn:async()=>{attempts++;throw networkError('ERR_TLS_CERT_ALTNAME_INVALID');}});
 await assert.rejects(api.ready(),error=>error.code==='ERR_TLS_CERT_ALTNAME_INVALID');assert.equal(attempts,1);
});
test('timeout DOMExceptions and nested network errors are normalized without raw stack details',()=>{
 const timeout=connectionError(new DOMException('timeout '+secret,'TimeoutError'),'Health');assert.equal(timeout.code,'TIMEOUT');assert.doesNotMatch(timeout.message,/not-a-real/);
 assert.equal(connectionError(networkError('ENOTFOUND'),'Health').code,'ENOTFOUND');
 assert.equal(connectionError({code:23},'Health').code,'NETWORK_ERROR');
});
test('temporary HTTP routing failures retry, while authorization and unexpected services fail immediately',async()=>{
 let attempts=0;const api=createStagingClient({base,secret,log(){},sleep:async()=>{},fetchFn:async()=>++attempts===1?new Response('not ready',{status:523}):healthy()});
 await api.ready({attempts:2});assert.equal(attempts,2);
 for(const response of [new Response('Unauthorized',{status:401}),Response.json({service:'different-service',mode:'private-staging',ranked:false}),new Response('<html>Sign in</html>')]){
  let calls=0;const rejected=createStagingClient({base,secret,log(){},fetchFn:async()=>{calls++;return response;}});
  await assert.rejects(rejected.ready());assert.equal(calls,1);
 }
});
test('authenticated mutations are never automatically retried after a connection error',async()=>{
 let calls=0;const api=createStagingClient({base,secret,log(){},fetchFn:async(_url,options)=>{calls++;assert.equal(options.headers.authorization,'Bearer '+secret);throw networkError();}});
 await assert.rejects(api.json('/v1/runs',{slot:0}),error=>error.message.includes('POST')&&!error.message.includes(secret));assert.equal(calls,1);
});
test('status JSON failures and authentication errors explain the response instead of exposing the key',async()=>{
 const api=createStagingClient({base,secret,log(){},fetchFn:async()=>Response.json({error:'owner-auth-required'},{status:401})});
 await assert.rejects(api.json('/v1/status'),/HTTP 401 \(owner-auth-required\)/);
 const html=createStagingClient({base,secret,log(){},fetchFn:async()=>new Response('error',{status:503})});
 await assert.rejects(html.json('/v1/status'),/HTTP 503 returned an unexpected response/);
});
test('a failed preflight or existing run never sends the stop-all mutation',async()=>{
 for(const earlyFailure of ['preflight','already-active']){
  const calls=[];const api={base,async ready(){if(earlyFailure==='preflight')throw Error('HTTPS unavailable');},async json(path){calls.push(path);return {active:1};},async call(path){calls.push('POST '+path);}};
  await assert.rejects(runHostedBenchmark({api,log(){}}));
  assert.ok(!calls.some(path=>path.includes('stop-all')));assert.ok(!calls.includes('/v1/runs'));
 }
});
test('a partially started benchmark closes its clients and cleans up once',async()=>{
 let cleanup=0,closed=0;
 const api={base,async ready(){},async json(path,body){return path==='/v1/status'?{active:0}:{runId:String(body.slot)};},async call(path){assert.equal(path,'/v1/stop-all');cleanup++;}};
 const connectClient=async run=>{if(run.runId==='3')throw Error('handshake failed');return {stop(){closed++;}};};
 await assert.rejects(runHostedBenchmark({api,connectClient,log(){}}),/handshake failed/);assert.equal(cleanup,1);assert.equal(closed,7);
});
