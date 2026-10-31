import assert from 'node:assert/strict';
import {ReferenceRunRecorder} from '../../dist/reference-run.js';
import {RunSimulation} from '../../verification/simulation.js';
import {VerificationSession} from '../../verification/session.js';
import {checkReference} from '../../verification/reference-check.mjs';
import {connectReference} from '../../verification/hosted-reference.mjs';

const base='https://movement-lab-verifier-staging.example.workers.dev';
const map={id:'course',timed:true,spawns:[{x:0,y:0,z:100,yaw:0},{x:0,y:0,z:-200,yaw:0}],boxes:[
  {min:[-100,-120,-100],max:[100,0,200]},
  {min:[-100,-120,-300],max:[100,0,-100],checkpoint:1},
  {min:[-100,-120,-500],max:[100,0,-300],finish:true}]};
export const input={forward:1,side:0,yaw:0,pitch:0,walk:false,duck:false,jumpHeld:false,jumpPressed:false};
const sim=new RunSimulation(map,'classic'),recorder=new ReferenceRunRecorder(map,'classic');
while(!sim.completed&&!sim.invalid&&sim.ticks<2000){
  recorder.input(input);sim.step(input);recorder.observe(sim.player,{time:sim.time,checkpoint:sim.checkpoint,completed:sim.completed,respawns:0});
}
const raw=JSON.stringify(recorder.export()),validate=value=>checkReference(value,{resolveCourse:()=>map});
function clock(){
  let time=0,id=0;const tasks=new Map();
  return {now:()=>time,schedule(fn,ms){tasks.set(++id,{fn,at:time+ms});return id;},cancel(key){tasks.delete(key);},
    async wait(ms){return new Promise(done=>this.schedule(done,ms));},
    next(){const next=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];if(!next)return false;
      tasks.delete(next[0]);time=Math.max(time,next[1].at);next[1].fn();return true;}};
}
export function harness({before={},stateChange,outcomeChange,selectionChange,readyDelay=()=>10,allocationDelay=()=>0,
  lostSlot,duplicateSlot,readiness=true,leftover=false}={}){
  const timer=clock(),calls=[],packets=[],sockets=[],leases=new Map(),outcomes=new Map(),saved=[];
  const idFor=index=>'12345678-1234-4123-8123-'+String(index).padStart(12,'0');
  let started=false,allocations=0;const batchFirstIds=new Map();
  class Socket extends EventTarget {
    constructor(run){
      super();this.run=run;this.readyState=0;this.bufferedAmount=0;sockets.push(this);
      this.readyTimer=timer.schedule(()=>{
        if(this.readyState===3||!readiness)return;
        this.readyState=1;
        this.session=new VerificationSession({map,preset:'classic',startedAt:timer.now(),now:timer.now,
          send:value=>this.message(stateChange?stateChange({...value},run.selection.slot,run.batch):value),
          onEnd:outcome=>{outcomes.set(run.runId,outcomeChange?outcomeChange(outcome,run.selection.slot,run.batch):outcome);leases.delete(run.runId);}});
        this.message({type:'ready',runId:run.runId,tickRate:256,ranked:false});
        const advance=()=>{if(this.readyState===3)return;this.session.advance();if(!this.session.ended)this.advanceTimer=timer.schedule(advance,16);};
        this.advanceTimer=timer.schedule(advance,16);
      },readyDelay(run.selection.slot));
    }
    message(value){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));}
    send(value){packets.push({slot:this.run.selection.slot,packet:JSON.parse(value)});this.session.receive(value);}
    close(){
      if(this.readyState===3)return;this.readyState=3;timer.cancel(this.readyTimer);timer.cancel(this.advanceTimer);
      this.session?.end('client-left');this.dispatchEvent(new Event('close'));
    }
  }
  const api={base,async ready(){calls.push({path:'health'});},async json(path,body,options){
    calls.push({path,body,options,at:timer.now()});
    if(path==='/v1/status')return {active:leases.size+(started&&leftover&&!leases.size?1:0),limit:8,
      reservedRunMs:0,dailyRunMs:14400000,mode:'private-staging',ranked:false,...(!started?before:{})};
    if(path==='/v1/runs'){
      started=true;
      const batch=Math.floor(allocations/8),run={runId:idFor(++allocations),ticket:'private.ticket',selection:{...body,revision:1},ranked:false,batch};
      if(body.slot===24)batchFirstIds.set(batch,run.runId);
      leases.set(run.runId,run);
      // Model the deployed unopened reservation alarm; it only reclaims a
      // lease whose WebSocket session never started.
      timer.schedule(()=>{if(!sockets.some(socket=>socket.run.runId===run.runId&&socket.session))leases.delete(run.runId);},15000);
      const delay=allocationDelay(body.slot);if(delay)await timer.wait(delay);
      if(body.slot===lostSlot)throw Error('Allocation response lost');
      return {...run,runId:body.slot===duplicateSlot?batchFirstIds.get(batch):run.runId,selection:selectionChange?selectionChange(run.selection,batch):run.selection};
    }
    if(path.startsWith('/v1/runs/'))return outcomes.get(path.slice('/v1/runs/'.length))||{status:'active-or-not-started',ranked:false};
    assert.fail('Unexpected request '+path);
  }};
  const options={api,raw,file:'fixture.json',validate,now:timer.now,wallNow:()=>Date.parse('2026-10-30T03:00:00Z')+timer.now(),
    connectClient:(run,options)=>connectReference(run,{...options,createSocket:()=>new Socket(run),schedule:timer.schedule,cancel:timer.cancel}),
    wait:ms=>timer.wait(ms),log(){},save:report=>{saved.push(report);}};
  async function settle(promise){
    let done=false,value,error;promise.then(result=>{done=true;value=result;},reason=>{done=true;error=reason;});
    for(let i=0;i<50000&&!done;i++){
      // Flush ordinary promise continuations before advancing virtual time.
      for(let microtask=0;microtask<16&&!done;microtask++)await Promise.resolve();
      if(!done)timer.next();
    }
    assert.equal(done,true,'The eight-client test must settle within a bounded virtual schedule');
    if(error)throw error;return value;
  }
  return {options,settle,calls,packets,sockets,saved,leases,timer};
}
export const fixtureTicks=sim.ticks;
