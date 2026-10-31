import test from 'node:test';
import assert from 'node:assert/strict';
import {VerifiedRunClient,supportsVerifiedRun} from '../dist/verified-runs.js';

const endpoint='https://movement-lab-verifier-staging.test.workers.dev';
const selection={map:'bhop-school',revision:1,preset:'classic'},runId='12345678-1234-4123-8123-123456789012';
const input={forward:1,side:0,yaw:0,pitch:0,walk:false,duck:false,jumpHeld:false,jumpPressed:false};
const next=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({enabled=true,authorization='Bearer test-session',allocate,createError=false}={}){
  let now=1700000000000,clockId=0,challenge;const calls=[],sockets=[],changes=[],timers=new Map(),removed=[];
  const schedule=(fn,ms)=>{timers.set(++clockId,{fn,at:now+ms});return clockId;};
  class Socket{
    constructor(url,protocols){if(createError)throw Error('socket-failed');this.url=url;this.protocols=protocols;this.readyState=1;this.bufferedAmount=0;this.listeners=new Map();this.sent=[];sockets.push(this);}
    addEventListener(type,fn){this.listeners.set(type,fn);}
    message(value){this.listeners.get('message')?.({data:typeof value==='string'?value:JSON.stringify(value)});}
    send(raw){this.sent.push(JSON.parse(raw));}
    close(){this.readyState=3;this.listeners.get('close')?.();}
  }
  const allocation=()=>({runId,ticket:'private.socket.ticket',ranked:true,selection,expiresAt:now+30000,socketPath:`/v1/player/runs/${runId}/socket`});
  const client=new VerifiedRunClient({endpoint,authorization:()=>authorization,now:()=>now,onChange:state=>changes.push(state),schedule,unschedule:id=>timers.delete(id),
    createSocket:(...args)=>new Socket(...args),loadTurnstile:async()=>({render(container,options){challenge=options;return 'widget-id';},remove:id=>removed.push(id)}),
    fetcher:async(url,options)=>{
      const call={url,options,body:options.body?JSON.parse(options.body):undefined};calls.push(call);
      if(url.endsWith('/v1/player/config'))return Response.json({enabled,ranked:enabled,tickRate:256,ruleset:'verified-v1',siteKey:enabled?'production-site-key-fixture-123456':null});
      if(url.endsWith('/v1/player/runs'))return allocate?allocate(call,allocation):Response.json(allocation());
      if(url.endsWith('/cancel'))return Response.json({cancelled:true});
      if(url.includes('/v1/leaderboards/'))return Response.json({...selection,ruleset:'verified-v1',records:[{name:'Player <test>',value:14.711312665,runId}]});
      return Response.json({error:'unavailable'},{status:503});
    }});
  async function prepare(){assert.equal(await client.prepare(selection,{}),true);challenge.callback('browser-proof-token');assert.equal(client.state().prepared,true);}
  async function start(){await prepare();const promise=client.start(selection);await next();const socket=sockets.at(-1);assert.ok(socket);socket.message({type:'ready',runId,tickRate:256,ranked:true});assert.equal(await promise,true);return socket;}
  return {client,calls,sockets,changes,timers,removed,prepare,start,allocation,get challenge(){return challenge;},setAuth:value=>{authorization=value;},
    async advance(ms){now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);await timer.fn();}await next();}};
}
test('verified client allows only current timed maps and stays closed for disabled service or signed-out players',async()=>{
  assert.equal(supportsVerifiedRun(selection),true);assert.equal(supportsVerifiedRun({...selection,map:'endless'}),false);
  assert.equal(supportsVerifiedRun({...selection,revision:99}),false);
  for(const options of [{enabled:false},{authorization:null}]){
    const f=fixture(options);assert.equal(await f.client.prepare(selection,{}),false);assert.equal(f.calls.length,1);assert.equal(f.sockets.length,0);f.client.dispose();
  }
});
test('challenge preparation and allocation send only selection, proof and memory-held session; a single socket streams bounded controls',async()=>{
  const f=fixture(),socket=await f.start();
  const allocation=f.calls.find(c=>c.url.endsWith('/v1/player/runs'));
  assert.deepEqual(allocation.body,{map:'bhop-school',preset:'classic',turnstileToken:'browser-proof-token'});
  assert.equal(allocation.options.headers.authorization,'Bearer test-session');assert.equal(allocation.options.credentials,'omit');
  assert.equal(socket.url,endpoint.replace('https:','wss:')+`/v1/player/runs/${runId}/socket`);assert.deepEqual(socket.protocols,['movementlab-v1','ticket.private.socket.ticket']);
  for(let i=0;i<19;i++)f.client.input({...input,x:999,time:1,dt:1});
  assert.equal(socket.sent.length,1);f.client.finish();assert.equal(socket.sent.length,2);
  assert.deepEqual(socket.sent.map(p=>[p.seq,p.firstTick,p.frames.length]),[[0,0,16],[1,16,3]]);
  assert.deepEqual(Object.keys(socket.sent[0].frames[0]).sort(),Object.keys(input).sort());
  assert.equal(f.client.state().phase,'finishing');assert.equal(f.client.state().result,null);
  socket.message({type:'ended',reason:'completed',completed:true,invalid:null,time:14.711312665,checkpoint:3,ranked:true,scoreStatus:'saved',score:{saved:true,personalBest:true}});
  assert.equal(f.client.state().phase,'saved');assert.equal(f.client.state().result.ranked,true);
  assert.equal(JSON.stringify(f.changes).includes('test-session'),false);assert.equal(JSON.stringify(f.changes).includes('private.socket.ticket'),false);f.client.dispose();
});
test('cancellation settles a connecting start, closes the socket and releases its own allocation once',async()=>{
  const f=fixture();await f.prepare();const start=f.client.start(selection);await next();f.client.cancel('Paused.');
  assert.equal(await start,false);assert.equal(f.sockets[0].readyState,3);await next();
  assert.equal(f.calls.filter(c=>c.url.endsWith('/cancel')).length,1);assert.equal(f.client.state().active,false);assert.equal(f.client.state().result,null);
});
test('a late allocation after a map change is cancelled and never opens a socket',async()=>{
  let resolve;const f=fixture({allocate:(call,allocation)=>new Promise(done=>{resolve=()=>done(Response.json(allocation()));})});
  await f.prepare();const start=f.client.start(selection);await next();f.client.cancel('Map changed.');resolve();assert.equal(await start,false);await next();
  assert.equal(f.sockets.length,0);assert.equal(f.calls.filter(c=>c.url.endsWith('/cancel')).length,1);f.client.dispose();
});
test('expired browser proof, socket exceptions, excessive buffering and malformed server responses cannot report a saved score',async()=>{
  const expired=fixture();await expired.prepare();await expired.advance(270000);assert.equal(await expired.client.start(selection),false);assert.equal(expired.sockets.length,0);expired.client.dispose();
  const broken=fixture({createError:true});await broken.prepare();assert.equal(await broken.client.start(selection),false);await next();assert.equal(broken.calls.filter(c=>c.url.endsWith('/cancel')).length,1);broken.client.dispose();
  const slow=fixture(),socket=await slow.start();socket.bufferedAmount=20000;for(let i=0;i<16;i++)slow.client.input(input);assert.equal(slow.client.state().active,false);assert.equal(socket.sent.length,0);slow.client.dispose();
  const malformed=fixture(),other=await malformed.start();other.message('x'.repeat(65537));assert.equal(malformed.client.state().result,null);malformed.client.dispose();
});
test('API failures keep their clear capacity/cooldown message and never retry allocation',async()=>{
  const f=fixture({allocate:async()=>Response.json({error:'server-full'},{status:429})});await f.prepare();assert.equal(await f.client.start(selection),false);
  assert.match(f.client.state().status,/slots are busy/);assert.equal(f.calls.filter(c=>c.url.endsWith('/v1/player/runs')).length,1);f.client.dispose();
});
test('verified boards validate map revision and rows before passing records to the renderer',async()=>{
  const f=fixture();const rows=await f.client.leaderboard(selection);assert.equal(rows[0].name,'Player <test>');
  await assert.rejects(f.client.leaderboard({...selection,revision:99}),/invalid-board/);assert.equal(f.calls.length,1);f.client.dispose();
});
test('a pending save is never labelled verified and uses only four bounded status reads',async()=>{
  const f=fixture(),socket=await f.start();f.client.finish();
  socket.message({type:'ended',reason:'completed',completed:true,invalid:null,time:14.711312665,checkpoint:3,ranked:false,scoreStatus:'pending'});
  assert.equal(f.client.state().phase,'pending');assert.equal(f.client.state().result.ranked,false);socket.close();
  for(const ms of [2000,5000,15000,30000,60000])await f.advance(ms);
  assert.equal(f.calls.filter(c=>c.url.endsWith('/v1/player/runs/'+runId)).length,4);assert.equal(f.client.state().result.ranked,false);f.client.dispose();
});

test('sign-in enables private access through the local helper without exposing owner credentials or allowing untested courses',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'location');Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'http://localhost:5173'}});
  let authorization='Bearer signed-in-test-player',enrolled=false;const calls=[];
  const client=new VerifiedRunClient({endpoint,authorization:()=>authorization,fetcher:async(url,options)=>{
    calls.push({url,options});
    if(url==='/__verification/private-tester'){enrolled=true;return Response.json({enrolled:true});}
    const enabled=enrolled&&!!options.headers.authorization;
    return Response.json({enabled,ranked:enabled,tickRate:256,ruleset:'verified-v1',siteKey:enabled?'production-shaped-widget-site-key':null,
      privateTest:true,requiresEnrollment:!!options.headers.authorization&&!enrolled,courses:[selection]});
  }});
  try{
    assert.equal((await client.loadConfig()).enabled,false);
    assert.equal(await client.refreshAccess({enroll:true}),true);assert.equal(client.state().privateTest,true);
    const local=calls.find(call=>call.url==='/__verification/private-tester');assert.equal(local.options.method,'POST');
    assert.deepEqual(local.options.headers,{authorization});assert.equal(local.options.credentials,'omit');assert.equal(local.options.body,undefined);
    assert.equal(client.supportsSelection(selection),true);assert.equal(client.supportsSelection({...selection,map:'course'}),false);
    assert.equal(client.supportsSelection({...selection,preset:'practice'}),false);
    assert.equal(await client.prepare({...selection,map:'course'},{}),false);assert.match(client.state().status,/Bhop School/);
    authorization=null;assert.equal(await client.refreshAccess(),false);assert.equal(client.config.enabled,false);
    assert.equal(calls.filter(call=>call.url==='/__verification/private-tester').length,1);
  }finally{client.dispose();if(previous)Object.defineProperty(globalThis,'location',previous);else delete globalThis.location;}
});

test('public beta course configuration restricts the button and rejects preparing another map or preset',async()=>{
  const f=fixture(),original=f.client.fetcher;
  f.client.fetcher=async(url,options)=>url.endsWith('/v1/player/config')?Response.json({enabled:true,ranked:true,beta:true,tickRate:256,ruleset:'verified-v1',siteKey:'production-site-key-fixture-123456',courses:[selection]}):original(url,options);
  await f.client.loadConfig();assert.equal(f.client.supportsSelection(selection),true);
  for(const choice of [{...selection,map:'course'},{...selection,preset:'practice'}]){
    assert.equal(f.client.supportsSelection(choice),false);assert.equal(await f.client.prepare(choice,{}),false);assert.match(f.client.state().status,/Bhop School/);
  }
  assert.equal(f.sockets.length,0);f.client.dispose();
});
