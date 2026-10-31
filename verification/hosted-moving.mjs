import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {DT} from '../dist/physics.js';
import {RunSimulation} from './simulation.js';
import {VERIFICATION_LIMITS} from './limits.js';
import {checkReference,compareReferenceState} from './reference-check.mjs';
import {loadLatestReference,connectReference} from './hosted-reference.mjs';
import {loadStagingConfig,createStagingClient} from './staging-client.mjs';

export const MOVING_CLIENTS=8;
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const runIdPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const percentile=values=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*.95))]:null;
function checkStatus(status){
  if(!Number.isSafeInteger(status?.active)||status.active<0||status.active>MOVING_CLIENTS||status.limit!==MOVING_CLIENTS||status.mode!=='private-staging'||status.ranked!==false)throw Error('The staging capacity response is invalid or its limit differs from eight.');
  return status;
}
function checkMetrics(metrics,maxPackets){
  if(!metrics||!Number.isSafeInteger(metrics.packets)||metrics.packets<0||metrics.packets>maxPackets||
    !Number.isSafeInteger(metrics.peakQueue)||metrics.peakQueue<0||metrics.peakQueue>VERIFICATION_LIMITS.queuedTicks||
    !Number.isSafeInteger(metrics.maxCatchup)||metrics.maxCatchup<0||metrics.maxCatchup>VERIFICATION_LIMITS.catchupTicks)throw Error('A moving replay reported missing or out-of-bounds input metrics.');
}
export async function runHostedMoving({raw,file,api,connectClient=connectReference,validate=checkReference,
  wait=pause,now=()=>performance.now(),wallNow=()=>Date.now(),log=console.log,signal,onStart=()=>{},
  save=report=>writeFileSync(new URL('./hosted-moving-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n')}={}){
  const clients=[],ids=new Set();let failure=null,attemptedStarts=false,active=0,peakActive=0,stage='local-reference',cleanup=null;
  const stamp=()=>new Date(wallNow()).toISOString();
  const common={mode:'private-staging',ranked:false,workload:'moving-reference',clients:MOVING_CLIENTS,endpoint:api.base};
  const abort=error=>{
    failure??=error;
    for(const participant of clients)participant.client?.stop();
  };
  const onAbort=()=>abort(Error('The moving test was cancelled or reached its time budget.'));
  const clean=async()=>{
    for(const participant of clients)participant.client?.stop();
    // Wait for our pending WebSocket promises too; rejection handlers were
    // installed immediately when each client was created.
    await Promise.allSettled(clients.map(participant=>participant.done));
    let activeAfter=null;const deadline=now()+20000;
    for(let attempt=0;attempt<41;attempt++){
      const remaining=deadline-now();if(remaining<=0)break;
      const status=checkStatus(await api.json('/v1/status',undefined,{timeoutMs:Math.max(1,Math.ceil(Math.min(5000,remaining)))}));
      activeAfter=status.active;
      if(status.active===0)return {checked:true,activeAfter:0};
      if(attempt<40)await wait(Math.min(500,Math.max(0,deadline-now())));
    }
    return {checked:true,activeAfter};
  };
  try{
    await save({...common,generatedAt:stamp(),status:'running'});
    if(signal?.aborted)throw Error('The moving test was cancelled before starting.');
    signal?.addEventListener('abort',onAbort,{once:true});
    log('Checking the moving reference locally...');
    const {record,map,result:local}=validate(raw),replaySeconds=record.frames.length*DT;
    if(replaySeconds<1||replaySeconds>60)throw Error('This first moving-load test requires a checked recording between one and 60 seconds.');
    const maxPackets=Math.ceil(record.frames.length/16);
    stage='readiness';await api.ready();
    if(failure)throw failure;
    stage='capacity';const before=checkStatus(await api.json('/v1/status'));
    if(failure)throw failure;
    if(before.active!==0)throw Error('Existing staging attempts are active. Finish them before this test.');
    if(!Number.isSafeInteger(before.reservedRunMs)||before.reservedRunMs<0||!Number.isSafeInteger(before.dailyRunMs)||
      before.dailyRunMs-before.reservedRunMs<MOVING_CLIENTS*VERIFICATION_LIMITS.maxRunMs)throw Error('The staging run-time budget cannot reserve eight attempts. No attempts were started.');
    log(`Starting eight private moving replays: ${record.map} / ${record.preset}, ${replaySeconds.toFixed(1)} seconds each. No leaderboard records will be written.`);
    const testStartedAt=stamp();stage='starting';onStart();
    if(failure)throw failure;
    attemptedStarts=true;
    const starts=await Promise.allSettled(Array.from({length:MOVING_CLIENTS},async(_,index)=>{
      try{
        // Never retry allocations, including a request whose response was lost.
        const run=await api.json('/v1/runs',{slot:24+index,map:record.map,preset:record.preset});
        if(failure)throw failure;
        if(!runIdPattern.test(run.runId)||ids.has(run.runId)||run.ranked!==false||run.selection?.map!==record.map||
          run.selection?.revision!==record.revision||run.selection?.preset!==record.preset)throw Error('A moving replay returned a duplicate ID or mismatched map revision/physics selection.');
        ids.add(run.runId);
        const expected=new RunSimulation(map,record.preset);
        const participant={runId:run.runId,slot:24+index,readyAt:null,endedAt:null,stateComparisons:0,previousTick:0,lastStateAt:null,gaps:[]};
        clients.push(participant);
        const compare=state=>{
          if(!Number.isSafeInteger(state.ticks)||state.ticks<participant.previousTick||state.ticks>record.frames.length)throw Error('A moving replay reported invalid tick progress.');
          if(++participant.stateComparisons>3001)throw Error('A moving replay exceeded its state-message budget.');
          checkMetrics(state.metrics,maxPackets);
          while(expected.ticks<state.ticks)expected.step(record.frames[expected.ticks]);
          compareReferenceState(state,expected.state());participant.previousTick=state.ticks;
          if(state.type==='state'){
            const at=now();if(participant.lastStateAt!==null)participant.gaps.push(at-participant.lastStateAt);
            participant.lastStateAt=at;
          }
        };
        participant.client=connectClient(run,{base:api.base,record,now,onState:compare,onReady:()=>{
          participant.readyAt=now();active++;peakActive=Math.max(peakActive,active);
          log(`Moving replay ready (${active}/8).`);
        }});
        participant.done=participant.client.done.then(ended=>{
          participant.endedAt=now();active--;
          if(participant.readyAt===null||ended.reason!=='completed'||ended.completed!==true||ended.invalid!==null||ended.ranked!==false||
            ended.sentTicks!==record.frames.length||ended.packetsSent!==maxPackets||participant.stateComparisons<2)throw Error('A moving replay did not confirm a fully compared, clean private completion.');
          compareReferenceState(ended,record.samples.at(-1));checkMetrics(ended.metrics,maxPackets);
          if(ended.metrics.packets!==maxPackets)throw Error('A moving replay did not acknowledge every input packet.');
          participant.ended=ended;return ended;
        }).catch(error=>{abort(error);throw error;});
        // An early socket failure must be handled while other HTTP allocations
        // are still pending; Promise.allSettled below attaches later.
        participant.done.catch(()=>{});
        return participant;
      }catch(error){abort(error);throw error;}
    }));
    const failedStart=starts.find(result=>result.status==='rejected');
    if(failedStart)throw failure||failedStart.reason;
    stage='replaying';
    const completions=await Promise.allSettled(clients.map(participant=>participant.done));
    if(failure||completions.some(result=>result.status==='rejected'))throw failure||Error('A moving replay failed.');
    const testEndedAt=stamp(),overlapSeconds=Math.max(0,Math.min(...clients.map(p=>p.endedAt))-Math.max(...clients.map(p=>p.readyAt)))/1000;
    if(peakActive!==MOVING_CLIENTS||overlapSeconds<replaySeconds*.75)throw Error('The eight moving replays did not overlap for at least 75% of the recording. No concurrent-load pass was saved.');
    stage='persisted-outcomes';
    const persisted=await Promise.allSettled(clients.map(async participant=>{
      let outcome;const deadline=now()+10000;
      for(let attempt=0;attempt<10;attempt++){
        if(failure)throw failure;
        const remaining=deadline-now();if(remaining<=0)break;
        outcome=await api.json('/v1/runs/'+participant.runId,undefined,{timeoutMs:Math.max(1,Math.ceil(Math.min(5000,remaining)))});
        if(failure)throw failure;
        if(outcome.reason)break;if(attempt<9)await wait(250);
      }
      if(outcome?.reason!=='completed'||outcome.completed!==true||outcome.invalid!==null||outcome.ranked!==false)throw Error('A persisted moving-run outcome did not confirm a clean private completion.');
      compareReferenceState(outcome,record.samples.at(-1));checkMetrics(outcome.metrics,maxPackets);
      if(outcome.metrics.packets!==maxPackets)throw Error('A persisted moving-run packet count differs from the input count.');
      return {runId:participant.runId,slot:participant.slot,reason:outcome.reason,completed:outcome.completed,invalid:outcome.invalid,ranked:false,
        ticks:outcome.ticks,time:outcome.time,checkpoint:outcome.checkpoint,timeDifferenceSeconds:outcome.time-local.time,
        stateComparisons:participant.stateComparisons,packetsSent:participant.ended.packetsSent,metrics:outcome.metrics};
    }));
    const failedOutcome=persisted.find(result=>result.status==='rejected');
    if(failedOutcome)throw failedOutcome.reason;
    const outcomes=persisted.map(result=>result.value);
    stage='cleanup';cleanup=await clean();
    if(failure)throw failure;
    if(cleanup.activeAfter!==0)throw Error('Staging still reports active attempts after the moving test. No unrelated attempts were stopped.');
    const report={...common,generatedAt:stamp(),status:'passed',file,sha256:createHash('sha256').update(raw).digest('hex'),
      map:record.map,revision:record.revision,preset:record.preset,inputTicks:record.frames.length,replaySeconds,
      testStartedAt,testEndedAt,peakActiveClients:peakActive,overlapSeconds,requiredOverlapSeconds:replaySeconds*.75,
      local:{ticks:local.ticks,time:local.time,checkpoint:local.checkpoint,samplesChecked:local.samplesChecked},runs:outcomes,
      stateGapP95Ms:percentile(clients.flatMap(p=>p.gaps)),activeAfter:0,
      note:'Eight copies of one complete human reference; all observed states and persisted finishes matched. Client-observed overlap, one network, one short route/preset. No sustained-load, CPU-unit or public anti-cheat certification.'};
    await save(report);
    log(`PASS: all eight moving replays matched ${local.time.toFixed(9)}s; ${overlapSeconds.toFixed(1)} seconds of eight-client overlap; zero active attempts afterward. Saved hosted-moving-results.json.`);
    return report;
  }catch(error){
    abort(error);
    if(attemptedStarts&&!cleanup){
      try{cleanup=await clean();}catch{cleanup={checked:false,activeAfter:null};}
      log(cleanup.activeAfter===0?'Failure cleanup: zero active attempts.':'Failure cleanup could not confirm zero active attempts; only this test’s sockets were closed.');
    }
    await save({...common,generatedAt:stamp(),status:'failed',stage,reason:'test-failed',cleanup,allocatedRunIds:[...ids]});
    throw error;
  }finally{
    signal?.removeEventListener('abort',onAbort);
    for(const participant of clients)participant.client?.stop();
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await runHostedMoving({...loadLatestReference(),api:createStagingClient(loadStagingConfig())});}
  catch(error){console.error('Moving replay test stopped: '+error.message);process.exitCode=1;}
}
