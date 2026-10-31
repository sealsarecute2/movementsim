import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{AdmissionCoordinator,VerifiedRun} from '../verification/worker.js';
import {ownerAuthorized,signTicket,verifyTicket,networkKey} from '../verification/auth.js';
import {RunAdmission} from '../verification/limits.js';

const secret='private-staging-test-key-1234567890123456789';
const clone=value=>value===undefined?undefined:structuredClone(value);
function context(){
 const data=new Map();let alarm=null,tail=Promise.resolve();const pending=[];
 return {data,pending,
  storage:{async get(k){return clone(data.get(k));},async put(k,v){data.set(k,clone(v));},async delete(k){return data.delete(k);},async setAlarm(v){alarm=v;},async getAlarm(){return alarm;},async deleteAlarm(){alarm=null;},async deleteAll(){data.clear();alarm=null;}},
  blockConcurrencyWhile(fn){const result=tail.then(fn);tail=result.catch(()=>{});return result;},waitUntil(promise){pending.push(promise);},
 };
}
function environment(){
 const ctx=context(),runs=new Map();let failAllocation=false;
 const env={STAGING_ENABLED:'true',STAGING_KEY:secret,ALLOWED_ORIGINS:'https://sealsarecute2.github.io',START_RATE:{async limit(){return {success:true};}}};
 const coordinator=new AdmissionCoordinator(ctx,env);
 env.ADMISSION={idFromName:id=>id,get:()=>coordinator};
 env.RUNS={idFromName:id=>id,get:id=>{
  if(!runs.has(id)){const runCtx=context();runs.set(id,{ctx:runCtx,object:new VerifiedRun(runCtx,env)});}
  return {fetch:request=>failAllocation?Promise.resolve(Response.json({error:'failed'},{status:503})):runs.get(id).object.fetch(request)};
 }};
 return {env,ctx,runs,setFailure:value=>{failAllocation=value;}};
}
function request(path,{body,auth=true,headers={},method}={}){
 const raw=body===undefined?undefined:JSON.stringify(body);
 return new Request('https://test.example'+path,{method:method||(body===undefined?'GET':'POST'),headers:{
  ...(auth?{authorization:'Bearer '+secret}:{}),...(raw?{'content-type':'application/json','content-length':String(new TextEncoder().encode(raw).length),'cf-connecting-ip':'203.0.113.1'}:{}),...headers},body:raw});
}
test('private bearer authentication and HMAC tickets reject missing, forged, expired and cross-run credentials',async()=>{
 assert.equal(ownerAuthorized(request('/'),secret),true);assert.equal(ownerAuthorized(request('/',{auth:false}),secret),false);
 assert.equal(ownerAuthorized(request('/'),''),false);
 const id=crypto.randomUUID(),now=Date.now(),claims={v:1,runId:id,accountId:'staging-slot-0',exp:now+30000};
 const token=await signTicket(claims,secret);
 assert.deepEqual(await verifyTicket(token,secret,id,now),claims);
 await assert.rejects(verifyTicket(token,secret,crypto.randomUUID(),now),/invalid-ticket/);
 await assert.rejects(verifyTicket(token,secret,id,now+30001),/invalid-ticket/);
 await assert.rejects(verifyTicket(token,'different-secret-1234567890123456789',id,now),/invalid-ticket/);
 const pieces=token.split('.');pieces[0]=pieces[0].slice(0,-2)+'ab';await assert.rejects(verifyTicket(pieces.join('.'),secret,id,now),/invalid-ticket/);
 assert.equal(await networkKey('203.0.113.1',secret,now),await networkKey('203.0.113.1',secret,now));
 assert.notEqual(await networkKey('203.0.113.1',secret,now),await networkKey('203.0.113.1',secret,now+86400000));
});
test('admission snapshots preserve active leases, account throttles and budget across reconstruction',()=>{
 let now=0;const first=new RunAdmission({now:()=>now});const lease=first.acquire({accountId:'a',networkKey:'n'});
 const second=new RunAdmission({now:()=>now,snapshot:first.snapshot()});
 assert.equal(second.leases.size,1);assert.equal(second.days.get(0),600000);
 assert.throws(()=>second.acquire({accountId:'a',networkKey:'n'}),error=>error.code==='account-active');
 second.release(lease.id,'a');now=1;
 const third=new RunAdmission({now:()=>now,snapshot:second.snapshot()});
 assert.equal(third.leases.size,0);assert.equal(third.days.get(0),5000);
 assert.throws(()=>new RunAdmission({snapshot:{version:42}}),/Invalid admission snapshot/);
});
test('concurrent private starts enforce eight shared slots, persist across coordinator restart and clean up via stop-all',async()=>{
 const {env,ctx,runs}=environment();
 const starts=await Promise.all(Array.from({length:8},(_,slot)=>worker.fetch(request('/v1/runs',{body:{map:'course',preset:'classic',slot}}),env)));
 assert.ok(starts.every(r=>r.status===201));assert.equal(runs.size,8);
 const restarted=new AdmissionCoordinator(ctx,env);env.ADMISSION.get=()=>restarted;
 let state=await (await worker.fetch(request('/v1/status'),env)).json();assert.equal(state.active,8);
 const ninth=await worker.fetch(request('/v1/runs',{body:{map:'course',preset:'classic',slot:8}}),env);assert.equal(ninth.status,429);
 const duplicate=await worker.fetch(request('/v1/runs',{body:{map:'course',preset:'classic',slot:0}}),env);assert.equal(duplicate.status,429);
 const stop=await worker.fetch(request('/v1/stop-all',{method:'POST'}),env);assert.deepEqual(await stop.json(),{requested:8,errors:0});
 state=await (await worker.fetch(request('/v1/status'),env)).json();assert.equal(state.active,0);
 for(const {ctx:runCtx} of runs.values()){assert.equal(await runCtx.storage.get('init'),undefined);assert.equal((await runCtx.storage.get('outcome')).ranked,false);}
});
test('disabled service, absent authentication, wrong origin and invalid selections cannot allocate objects',async()=>{
 const {env,runs}=environment();
 assert.equal((await worker.fetch(request('/health',{auth:false}),{})).status,200);
 assert.equal((await worker.fetch(request('/v1/status'),{...env,STAGING_ENABLED:'false'})).status,503);
 assert.equal((await worker.fetch(request('/v1/status',{auth:false}),env)).status,401);
 assert.equal((await worker.fetch(request('/v1/status',{headers:{origin:'https://evil.example'}}),env)).status,403);
 for(const body of [{map:'local-map',preset:'classic',slot:0},{map:'course',preset:'classic',slot:0,score:1}])assert.equal((await worker.fetch(request('/v1/runs',{body}),env)).status,400);
 assert.equal(runs.size,0);
});
test('oversized HTTP bodies and failed allocation do not strand leases',async()=>{
 const fixture=environment(),body={map:'course',preset:'classic',slot:0};
 assert.equal((await worker.fetch(request('/v1/runs',{body:{...body,padding:'x'.repeat(2000)}}),fixture.env)).status,413);
 assert.equal((await worker.fetch(request('/v1/runs',{body:{...body,padding:'x'.repeat(2000)},headers:{'content-length':'16'}}),fixture.env)).status,413);
 fixture.setFailure(true);
 assert.equal((await worker.fetch(request('/v1/runs',{body}),fixture.env)).status,503);
 assert.equal((await (await worker.fetch(request('/v1/status'),fixture.env)).json()).active,0);
});
test('unopened runs expire, interrupted runs fail closed, diagnostics expire, and consumed tickets cannot reconnect',async()=>{
 const {env,runs}=environment();const response=await worker.fetch(request('/v1/runs',{body:{map:'course',preset:'classic',slot:0}}),env),run=await response.json();
 const fixture=runs.get(run.runId);await fixture.object.alarm();
 assert.equal((await fixture.ctx.storage.get('outcome')).reason,'unopened-or-interrupted');
 assert.equal((await (await worker.fetch(request('/v1/status'),env)).json()).active,0);
 const outcome=await fixture.ctx.storage.get('outcome');outcome.diagnosticsExpireAt=Date.now()-1;await fixture.ctx.storage.put('outcome',outcome);await fixture.object.alarm();assert.equal(fixture.ctx.data.size,0);
 const next=await (await worker.fetch(request('/v1/runs',{body:{map:'course',preset:'classic',slot:1}}),env)).json(),used=runs.get(next.runId);
 await used.ctx.storage.put('consumed',true);
 const rejected=await used.object.fetch(new Request('https://internal/socket',{headers:{'x-run-claims':JSON.stringify({runId:next.runId,accountId:'staging-slot-1',exp:Date.now()+1000})}}));
 assert.equal(rejected.status,409);
 await used.object.alarm();assert.equal((await (await worker.fetch(request('/v1/status'),env)).json()).active,0);
});
test('upgrade route rejects invalid tickets before allocating a run and applies a handshake rate limit',async()=>{
 const {env,runs}=environment();const id=crypto.randomUUID();
 const headers={upgrade:'websocket','cf-connecting-ip':'203.0.113.1','sec-websocket-protocol':'movementlab-v1,ticket.invalid.signature'};
 assert.equal((await worker.fetch(request('/v1/runs/'+id+'/socket',{auth:false,headers}),env)).status,401);
 assert.equal(runs.size,0);
 env.START_RATE.limit=async()=>({success:false});
 assert.equal((await worker.fetch(request('/v1/runs/'+id+'/socket',{auth:false,headers}),env)).status,429);assert.equal(runs.size,0);
});
test('socket wiring accepts a single signed connection, rejects oversized input and frees capacity',async()=>{
 const OriginalResponse=globalThis.Response,OriginalPair=globalThis.WebSocketPair;
 class Socket {
  constructor(){this.listeners=new Map();this.incoming=[];this.closed=false;}
  accept(){}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}
  fire(type,event){for(const fn of this.listeners.get(type)||[])fn(event);}
  send(data){let parsed;try{parsed=JSON.parse(data);}catch{parsed=data;}this.other.incoming.push(parsed);this.other.fire('message',{data});}
  close(){if(this.closed)return;this.closed=true;this.fire('close',{});if(!this.other.closed){this.other.closed=true;this.other.fire('close',{});}}
 }
 class Pair {constructor(){this[0]=new Socket();this[1]=new Socket();this[0].other=this[1];this[1].other=this[0];}}
 class UpgradeResponse extends OriginalResponse {
  constructor(body,options){if(options?.status===101){super(null,{status:200,headers:options.headers});Object.defineProperty(this,'status',{value:101});this.webSocket=options.webSocket;}else super(body,options);}
 }
 const {env,runs}=environment();let socket;
 try{
  globalThis.Response=UpgradeResponse;globalThis.WebSocketPair=Pair;
  const run=await (await worker.fetch(request('/v1/runs',{body:{map:'course',preset:'classic',slot:0}}),env)).json();
  const fixture=runs.get(run.runId);
  const upgrade=request('/v1/runs/'+run.runId+'/socket',{auth:false,headers:{upgrade:'websocket','cf-connecting-ip':'203.0.113.1',
    'sec-websocket-protocol':'movementlab-v1,ticket.'+run.ticket,'x-run-claims':'forged'}});
  const response=await worker.fetch(upgrade,env);assert.equal(response.status,101);socket=response.webSocket;
  assert.equal(socket.incoming[0].type,'ready');assert.equal(socket.incoming[0].ranked,false);
  socket.send('x'.repeat(4097));await Promise.all(fixture.ctx.pending);
  assert.equal(socket.incoming.at(-1).reason,'packet-size');
  assert.equal((await fixture.ctx.storage.get('outcome')).ticks,0);
  assert.equal((await (await worker.fetch(request('/v1/status'),env)).json()).active,0);
  assert.equal((await worker.fetch(upgrade,env)).status,409);
 }finally{
  socket?.close();globalThis.Response=OriginalResponse;
  if(OriginalPair===undefined)delete globalThis.WebSocketPair;else globalThis.WebSocketPair=OriginalPair;
 }
});
