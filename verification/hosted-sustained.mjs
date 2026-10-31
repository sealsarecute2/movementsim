import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {checkReference} from './reference-check.mjs';
import {loadLatestReference} from './hosted-reference.mjs';
import {runHostedMoving} from './hosted-moving.mjs';
import {metricWindow} from './hosted-metrics.mjs';
import {VERIFICATION_LIMITS} from './limits.js';
import {loadStagingConfig,createStagingClient} from './staging-client.mjs';

export const SUSTAINED_ROUNDS=10;
export const SUSTAINED_MAX_MS=12*60000;
const pause=ms=>new Promise(done=>setTimeout(done,ms));
export async function runHostedSustained({raw,file,api,validate=checkReference,runRound=runHostedMoving,
  wait=pause,now=()=>performance.now(),wallNow=()=>Date.now(),schedule=setTimeout,cancel=clearTimeout,
  log=console.log,signal,save=report=>writeFileSync(new URL('./hosted-sustained-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n')}={}){
  const rounds=[],roundStartOffsetsMs=[],controller=new AbortController();let timer=null,stage='local-reference',firstStart=null,lastStart=null,currentRound=null;
  const stamp=()=>new Date(wallNow()).toISOString();
  const common={mode:'private-staging',ranked:false,workload:'sustained-moving-reference',clients:8,roundCount:SUSTAINED_ROUNDS,
    plannedRuns:SUSTAINED_ROUNDS*8,endpoint:api.base,maxWorkloadMs:SUSTAINED_MAX_MS};
  const stop=()=>controller.abort();
  const check=()=>{if(controller.signal.aborted)throw Error('The sustained test was cancelled or reached its 12-minute workload limit.');};
  const progress=status=>({...common,generatedAt:stamp(),status,stage,completedRounds:rounds.length,rounds,currentRound});
  try{
    await save(progress('running'));
    if(signal?.aborted)stop();signal?.addEventListener('abort',stop,{once:true});check();
    const checked=validate(raw),{record}=checked,replaySeconds=record.frames.length/256;
    if(replaySeconds<1||replaySeconds>60)throw Error('The sustained test requires a checked recording between one and 60 seconds.');
    const roundIntervalMs=Math.max(30000,Math.ceil(replaySeconds*1000+5000));
    const sha256=createHash('sha256').update(raw).digest('hex');
    const estimatedSeconds=((SUSTAINED_ROUNDS-1)*roundIntervalMs)/1000+replaySeconds;
    log(`Preparing ten rounds of eight ${record.map} / ${record.preset} replays: about ${Math.ceil(estimatedSeconds/60)} minutes, 80 attempts total. Starts are at least ${roundIntervalMs/1000} seconds apart.`);
    stage='readiness';await api.ready();check();
    timer=schedule(stop,SUSTAINED_MAX_MS);
    stage='capacity';const before=await api.json('/v1/status');check();
    if(before?.mode!=='private-staging'||before.ranked!==false||before.limit!==8||before.active!==0)throw Error('Sustained testing requires empty private staging with the unchanged eight-run cap.');
    // Leave headroom for later batches as well as the next full reservation.
    // Each round separately rechecks the real persistent budget before starts.
    const requiredBudgetMs=8*VERIFICATION_LIMITS.maxRunMs+(SUSTAINED_ROUNDS-1)*8*(replaySeconds*1000+15000);
    if(!Number.isSafeInteger(before.reservedRunMs)||before.reservedRunMs<0||!Number.isSafeInteger(before.dailyRunMs)||before.dailyRunMs-before.reservedRunMs<requiredBudgetMs)throw Error('The remaining staging run-time budget is insufficient for this bounded ten-round test. No attempts were started.');
    for(let index=0;index<SUSTAINED_ROUNDS;index++){
      check();stage='pacing';
      if(lastStart!==null&&now()<lastStart+roundIntervalMs)log(`Pacing the next batch: ${Math.ceil((lastStart+roundIntervalMs-now())/1000)} seconds...`);
      while(lastStart!==null&&now()<lastStart+roundIntervalMs){
        check();await wait(Math.min(1000,lastStart+roundIntervalMs-now()));
      }
      check();stage='round-'+(index+1);currentRound=null;
      log(`Round ${index+1}/10: starting eight moving replays...`);
      const report=await runRound({raw,file,api:{...api,ready:async()=>{}},validate:()=>checked,wait,now,wallNow,signal:controller.signal,
        onStart:()=>{
          check();const at=now();if(lastStart!==null&&at-lastStart<roundIntervalMs)throw Error('A sustained batch would exceed its start-rate pacing.');
          if(firstStart===null)firstStart=at;lastStart=at;roundStartOffsetsMs.push(at-firstStart);
        },log:line=>{if(line.startsWith('Failure cleanup:'))log(line);},
        save:async value=>{currentRound=value;await save(progress('running'));}});
      check();metricWindow(report,wallNow());
      if(report.status!=='passed'||report.workload!=='moving-reference'||report.file!==file||report.sha256!==sha256||
        report.map!==record.map||report.revision!==record.revision||report.preset!==record.preset||report.inputTicks!==record.frames.length||
        report.local?.time!==checked.result.time||report.local?.ticks!==checked.result.ticks||report.local?.checkpoint!==checked.result.checkpoint||
        roundStartOffsetsMs.length!==index+1||report.activeAfter!==0)throw Error('A sustained round did not confirm the same checked recording, pacing and cleanup.');
      const knownIds=new Set(rounds.flatMap(round=>round.runs.map(run=>run.runId)));
      if(report.runs.some(run=>knownIds.has(run.runId)))throw Error('A sustained round reused a prior attempt ID.');
      rounds.push(report);currentRound=null;await save(progress('running'));
      log(`Round ${index+1}/10 passed: all eight scores matched; ${report.overlapSeconds.toFixed(1)} seconds of overlap; zero active attempts.`);
    }
    check();stage='final-capacity';const after=await api.json('/v1/status');check();
    if(after?.active!==0||after.limit!==8||after.mode!=='private-staging'||after.ranked!==false)throw Error('The sustained test could not confirm final empty staging at the eight-run cap.');
    const report={...common,generatedAt:stamp(),status:'passed',completedRounds:rounds.length,file,sha256,
      map:record.map,revision:record.revision,preset:record.preset,inputTicks:record.frames.length,replaySeconds,
      local:{ticks:checked.result.ticks,time:checked.result.time,checkpoint:checked.result.checkpoint,samplesChecked:checked.result.samplesChecked},
      testStartedAt:rounds[0].testStartedAt,testEndedAt:rounds.at(-1).testEndedAt,roundIntervalMs,roundStartOffsetsMs,
      elapsedSeconds:(now()-firstStart)/1000,totalRuns:rounds.length*8,
      totalStateComparisons:rounds.reduce((sum,round)=>sum+round.runs.reduce((value,run)=>value+run.stateComparisons,0),0),
      totalEightClientOverlapSeconds:rounds.reduce((sum,round)=>sum+round.overlapSeconds,0),
      plannedInputPlayerSeconds:SUSTAINED_ROUNDS*8*replaySeconds,activeAfter:0,rounds,
      note:'Ten paced batches of eight complete short replays; includes cooldown gaps and repeated allocation/cleanup. Not ten-minute individual sessions, worst-map coverage, independent-network admission or public anti-cheat certification.'};
    metricWindow(report,wallNow());await save(report);
    log(`PASS: all 80 moving replays matched; ten rounds passed, ${report.totalStateComparisons} state comparisons, zero active attempts after every round. Saved hosted-sustained-results.json.`);
    return report;
  }catch(error){
    stop();await save({...progress('failed'),reason:'test-failed'});throw error;
  }finally{
    if(timer!==null)cancel(timer);signal?.removeEventListener('abort',stop);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await runHostedSustained({...loadLatestReference(),api:createStagingClient(loadStagingConfig())});}
  catch(error){console.error('Sustained test stopped: '+error.message);process.exitCode=1;}
}
