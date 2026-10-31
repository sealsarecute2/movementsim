import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivatePlayServer} from '../verification/private-play-server.mjs';
import {request as httpRequest} from 'node:http';
const secret='server-only-owner-test-key-1234567890123456789',base='https://movement-lab-verifier-staging.test.workers.dev';
async function fixture(){
  const calls=[];const server=createPrivatePlayServer({base,secret,fetcher:async(url,options)=>{
    calls.push({url,options});return Response.json({enrolled:true,ignoredSecret:secret});
  }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://localhost:'+server.address().port;
  return {calls,server,origin,close:()=>new Promise(resolve=>server.close(resolve)),call:(path,options={})=>fetch(origin+path,{...options,headers:{origin,...options.headers}})};
}
test('local enrollment forwards only the signed session to the fixed Worker with an owner proof kept out of the browser',async()=>{
  const f=await fixture();
  try{
    const response=await f.call('/__verification/private-tester',{method:'POST',headers:{authorization:'Bearer player-session'}});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{enrolled:true});assert.equal(f.calls.length,1);
    const {url,options}=f.calls[0];assert.equal(url,base+'/v1/player/test/enroll');assert.equal(options.headers['x-staging-key'],secret);
    assert.equal(options.headers.authorization,'Bearer player-session');assert.equal(options.headers.origin,f.origin);assert.equal(options.redirect,'manual');
    assert.equal(options.body,undefined);assert.equal(response.headers.get('access-control-allow-origin'),null);
  }finally{await f.close();}
});
test('local helper rejects other origins/hosts, missing sessions, request bodies, and paths outside game assets',async()=>{
  const f=await fixture();
  try{
    const path='/__verification/private-tester';
    assert.equal((await f.call(path,{method:'POST',headers:{authorization:'Bearer player',origin:'https://evil.example'}})).status,403);
    const hostileHost=await new Promise((resolve,reject)=>{
      const request=httpRequest(f.origin+path,{method:'POST',headers:{origin:f.origin,host:'evil.example',authorization:'Bearer player'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end();
    });assert.equal(hostileHost,403);
    assert.equal((await f.call(path,{method:'POST'})).status,401);
    assert.equal((await f.call(path,{method:'GET'})).status,405);
    assert.equal((await f.call(path,{method:'POST',headers:{authorization:'Bearer player'},body:'{"accountId":"spoof"}'})).status,413);
    assert.equal((await f.call('/%2e%2e%2fverification%2f.staging-secrets.json')).status,404);
    assert.equal(f.calls.length,0);
    const js=await (await f.call('/verified-runs.js')).text();assert.ok(js.includes('VerifiedRunClient'));assert.equal(js.includes(secret),false);
    assert.deepEqual(await (await f.call('/__verification/private-test')).json(),{privateTestHelper:true});
  }finally{await f.close();}
});
test('enrollment churn is limited before forwarding and the helper refuses arbitrary upstream hosts',async()=>{
  assert.throws(()=>createPrivatePlayServer({base:'https://evil.example',secret}),/invalid-private-setup/);
  const f=await fixture();
  try{
    for(let i=0;i<6;i++)assert.equal((await f.call('/__verification/private-tester',{method:'POST',headers:{authorization:'Bearer player'}})).status,200);
    assert.equal((await f.call('/__verification/private-tester',{method:'POST',headers:{authorization:'Bearer player'}})).status,429);assert.equal(f.calls.length,6);
  }finally{await f.close();}
});
