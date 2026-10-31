import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ReferenceRunRecorder} from '../dist/reference-run.js';
import {RunSimulation} from '../verification/simulation.js';
import {VerificationSession} from '../verification/session.js';
import {checkReference} from '../verification/reference-check.mjs';
import {connectReference,runHostedReference,loadLatestReference} from '../verification/hosted-reference.mjs';

const base='https://movement-lab-verifier-staging.example.workers.dev';
const runId='12345678-1234-4123-8123-123456789012';
const map={id:'course',timed:true,spawns:[{x:0,y:0,z:100,yaw:0},{x:0,y:0,z:-200,yaw:0}],boxes:[
  {min:[-100,-120,-100],max:[100,0,200]},
  {min:[-100,-120,-300],max:[100,0,-100],checkpoint:1},
  {min:[-100,-120,-500],max:[100,0,-300],finish:true}]};
const input={forward:1,side:0,yaw:0,pitch:0,walk:false,duck:false,jumpHeld:false,jumpPressed:false};
function fixture(){
  const sim=new RunSimulation(map,'classic'),recorder=new ReferenceRunRecorder(map,'classic');
  for(let i=0;i<2000&&!sim.completed&&!sim.invalid;i++){
    recorder.input(input);sim.step(input);recorder.observe(sim.player,{time:sim.time,checkpoint:sim.checkpoint,completed:sim.completed,respawns:0});
  }
  return JSON.stringify(recorder.export());
}
const validate=raw=>checkReference(raw,{resolveCourse:()=>map});
function clock(){
  let time=0,id=0;const tasks=new Map();
  return {now:()=>time,schedule(fn,ms){tasks.set(++id,{fn,at:time+ms});return id;},cancel(key){tasks.delete(key);},
    jump(ms){time+=ms;},next(){
      const next=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];if(!next)return false;
      tasks.delete(next[0]);time=Math.max(time,next[1].at);next[1].fn();return true;
    }};
}
function harness({changeState,changeOutcome,ready=true,selection={map:'course',revision:1,preset:'classic'}}={}){
  const timer=clock(),calls=[],packets=[],sockets=[];let active=0,outcome;
  class Socket extends EventTarget {
    constructor(){
      super();this.readyState=0;this.bufferedAmount=0;sockets.push(this);
      this.session=new VerificationSession({map,preset:'classic',startedAt:timer.now(),now:timer.now,
        send:message=>this.message(changeState?changeState({...message}):message),onEnd:result=>{outcome=changeOutcome?changeOutcome(result):result;active=0;}});
      if(ready)timer.schedule(()=>{this.readyState=1;this.message({type:'ready',runId,tickRate:256,ranked:false});},10);
      const advance=()=>{if(this.readyState===3)return;this.session.advance();if(!this.session.ended)timer.schedule(advance,16);};
      timer.schedule(advance,16);
    }
    message(value){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));}
    send(raw){packets.push(JSON.parse(raw));this.session.receive(raw);}
    close(){if(this.readyState===3)return;this.readyState=3;this.session.end('client-left');this.dispatchEvent(new Event('close'));}
  }
  const api={base,async ready(){calls.push('ready');},async json(path,body){
    calls.push({path,body});
    if(path==='/v1/status')return {active};
    if(path==='/v1/runs'){active=1;return {runId,ticket:'private.ticket',selection,ranked:false};}
    if(path==='/v1/runs/'+runId)return outcome||{status:'active-or-not-started',ranked:false};
    throw Error('Unexpected request '+path);
  }};
  const connectClient=(run,options)=>connectReference(run,{...options,createSocket:()=>new Socket(),now:timer.now,schedule:timer.schedule,cancel:timer.cancel});
  async function settle(promise){
    let complete=false,result,error;promise.then(value=>{result=value;complete=true;},reason=>{error=reason;complete=true;});
    for(let i=0;i<10000&&!complete;i++){await Promise.resolve();if(!complete)timer.next();}
    assert.equal(complete,true,'The bounded replay should settle');if(error)throw error;return result;
  }
  return {api,timer,calls,packets,sockets,connectClient,settle};
}
test('input-only timed replay matches real session states, finish, persisted result and capacity cleanup',async()=>{
  const h=harness();let saved;
  const report=await h.settle(runHostedReference({raw:fixture(),file:'test.json',api:h.api,connectClient:h.connectClient,validate,wait:async()=>{},log(){},save:value=>{saved=value;}}));
  assert.equal(saved,report);assert.equal(report.timeDifferenceSeconds,0);assert.equal(report.activeAfter,0);
  assert.ok(report.stateComparisons>2);assert.equal(report.hosted.reason,'completed');assert.equal(report.ranked,false);
  assert.equal(report.inputTicks,h.packets.flatMap(packet=>packet.frames).length);
  h.packets.forEach((packet,index)=>{
    assert.deepEqual(Object.keys(packet),['seq','firstTick','frames']);assert.equal(packet.seq,index);assert.equal(packet.firstTick,index*16);
    assert.ok(packet.frames.length>=1&&packet.frames.length<=16);assert.deepEqual(Object.keys(packet.frames[0]).sort(),Object.keys(input).sort());
  });
  assert.equal(h.sockets[0].readyState,3);assert.ok(!h.calls.some(call=>call.path?.includes('stop-all')));
});
test('invalid fixtures, unavailable HTTPS and existing runs never allocate or stop attempts',async()=>{
  for(const failure of ['fixture','https','active']){
    const calls=[];const api={base,async ready(){calls.push('ready');if(failure==='https')throw Error('unavailable');},async json(path){calls.push(path);return {active:1};}};
    await assert.rejects(runHostedReference({raw:failure==='fixture'?'{}':fixture(),api,validate,log(){}}));
    assert.ok(!calls.includes('/v1/runs'));assert.ok(!calls.some(value=>value.includes('stop-all')));
    if(failure==='fixture')assert.deepEqual(calls,[]);
  }
});
test('ambiguous allocation failure is not retried and does not stop unrelated sessions',async()=>{
  let allocations=0;const api={base,async ready(){},async json(path){
    if(path==='/v1/status')return {active:0};assert.equal(path,'/v1/runs');allocations++;throw Error('connection lost');
  }};
  await assert.rejects(runHostedReference({raw:fixture(),api,validate,log(){}}),/connection lost/);assert.equal(allocations,1);
});
test('a mismatched hosted revision is refused before sending any replay input',async()=>{
  const h=harness({selection:{map:'course',revision:2,preset:'classic'}});
  await assert.rejects(runHostedReference({raw:fixture(),api:h.api,validate,connectClient:h.connectClient,log(){}}),/revision/);
  assert.equal(h.sockets.length,0);assert.equal(h.packets.length,0);
});
test('a moving-state mismatch closes only this socket and never writes a passed report',async()=>{
  const h=harness({changeState:state=>state.type==='state'&&state.ticks>0?{...state,x:state.x+1}:state});
  await assert.rejects(h.settle(runHostedReference({raw:fixture(),api:h.api,validate,connectClient:h.connectClient,log(){},save(){assert.fail('must not save');}})),/Reference mismatch/);
  assert.equal(h.sockets[0].readyState,3);assert.ok(!h.calls.some(call=>call.path?.includes('stop-all')));
});
test('a different persisted time fails even if the live completion matched',async()=>{
  const h=harness({changeOutcome:result=>({...result,time:result.time+.001})});
  await assert.rejects(h.settle(runHostedReference({raw:fixture(),api:h.api,validate,connectClient:h.connectClient,log(){},save(){assert.fail('must not save');}})),/Reference mismatch/);
});
test('a missing readiness message is bounded and the socket is closed',async()=>{
  const h=harness({ready:false}),record=validate(fixture()).record;
  // No physics input arrives, so the real session may reject lag before the
  // client deadline. Both paths must reject and close without sending input.
  const client=h.connectClient({runId,ticket:'private.ticket'},{base,record});
  await assert.rejects(h.settle(client.done));assert.equal(h.sockets[0].readyState,3);assert.equal(h.packets.length,0);
});
test('a delayed client input pump ends instead of sending a catch-up flood',async()=>{
  const h=harness(),record=validate(fixture()).record;
  const client=h.connectClient({runId,ticket:'private.ticket'},{base,record});
  h.timer.next();assert.equal(h.packets.length,1);h.timer.jump(300);
  await assert.rejects(h.settle(client.done),/timer was delayed/);assert.equal(h.packets.length,1);assert.equal(h.sockets[0].readyState,3);
});
test('latest fixture loading confines the file to the reference folder',()=>{
  const folder=mkdtempSync(join(tmpdir(),'movementlab-hosted-reference-')),directory=pathToFileURL(folder+'/');
  try{
    const file='course-v1-classic-1793319717304.json';writeFileSync(join(folder,file),fixture());
    writeFileSync(join(folder,'latest-result.json'),JSON.stringify({file}));assert.equal(loadLatestReference(directory).file,file);
    writeFileSync(join(folder,'latest-result.json'),JSON.stringify({file:'../.staging-secrets.json'}));assert.throws(()=>loadLatestReference(directory),/filename/);
  }finally{rmSync(folder,{recursive:true,force:true});}
});
