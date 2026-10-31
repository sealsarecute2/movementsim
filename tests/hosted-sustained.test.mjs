import test from 'node:test';
import assert from 'node:assert/strict';
import {runHostedSustained} from '../verification/hosted-sustained.mjs';
import {runHostedMoving} from '../verification/hosted-moving.mjs';
import {metricWindow} from '../verification/hosted-metrics.mjs';
import {harness} from './helpers/hosted-moving-harness.mjs';

function setup(changes={}){
  const h=harness(changes),saved=[];
  const options={...h.options,schedule:h.timer.schedule,cancel:h.timer.cancel,
    runRound:options=>runHostedMoving({...options,connectClient:h.options.connectClient}),
    save:report=>{saved.push(structuredClone(report));}};
  return {...h,options,saved};
}
test('ten rounds exercise 80 real moving sessions with paced starts, matching results and cleanup',async()=>{
  const h=setup(),report=await h.settle(runHostedSustained(h.options));
  assert.equal(report.status,'passed');assert.equal(report.completedRounds,10);assert.equal(report.totalRuns,80);
  assert.equal(h.saved.at(-1).status,'passed');assert.equal(report.activeAfter,0);assert.equal(h.leases.size,0);
  assert.equal(new Set(report.rounds.flatMap(round=>round.runs.map(run=>run.runId))).size,80);
  assert.equal(report.totalStateComparisons,report.rounds.reduce((sum,round)=>sum+round.runs.reduce((n,run)=>n+run.stateComparisons,0),0));
  assert.equal(h.calls.filter(call=>call.path==='health').length,1);
  const starts=h.calls.filter(call=>call.path==='/v1/runs');assert.equal(starts.length,80);
  for(let index=0;index<10;index++){
    assert.equal(report.rounds[index].status,'passed');assert.equal(report.rounds[index].activeAfter,0);
    assert.ok(report.rounds[index].runs.every(run=>run.timeDifferenceSeconds===0&&run.stateComparisons>2));
    if(index)assert.ok(starts[index*8].at-starts[(index-1)*8].at>=30000);
  }
  for(const start of starts)assert.ok(starts.filter(other=>other.at>=start.at&&other.at<start.at+60000).length<=24);
  assert.ok(report.elapsedSeconds>270&&report.elapsedSeconds<300);
  assert.deepEqual(metricWindow(report,Date.parse(report.generatedAt)),{from:'2026-10-30T02:59:00.000Z',to:'2026-10-30T03:06:00.000Z'});
  assert.ok(!h.calls.some(call=>call.path.includes('stop-all')));assert.ok(!JSON.stringify(h.saved).includes('private.ticket'));
});
test('a later moving mismatch ends the whole test with failed progress and no subsequent allocations',async()=>{
  const h=setup({stateChange:(state,slot,batch)=>batch===1&&slot===24&&state.type==='state'&&state.ticks>0?{...state,x:state.x+1}:state});
  await assert.rejects(h.settle(runHostedSustained(h.options)),/Reference mismatch/);
  const report=h.saved.at(-1);assert.equal(report.status,'failed');assert.equal(report.completedRounds,1);
  assert.equal(report.currentRound.status,'failed');assert.equal(report.currentRound.cleanup.activeAfter,0);
  assert.equal(h.calls.filter(call=>call.path==='/v1/runs').length,16);assert.equal(h.leases.size,0);
  assert.ok(!h.saved.some(report=>report.status==='passed'));assert.ok(!h.calls.some(call=>call.path.includes('stop-all')));
});
test('budget, occupied capacity, local reference and HTTPS failures allocate no sustained attempts',async()=>{
  for(const before of [{active:1},{dailyRunMs:5000000},{limit:9}]){
    const h=setup({before});await assert.rejects(h.settle(runHostedSustained(h.options)));
    assert.equal(h.calls.filter(call=>call.path==='/v1/runs').length,0);assert.equal(h.saved.at(-1).status,'failed');
  }
  const local=setup();await assert.rejects(local.settle(runHostedSustained({...local.options,raw:'{}'})));
  assert.equal(local.calls.length,0);
  const https=setup();https.options.api.ready=async()=>{throw Error('HTTPS unavailable');};
  await assert.rejects(https.settle(runHostedSustained(https.options)),/HTTPS unavailable/);
  assert.ok(!https.calls.some(call=>call.path==='/v1/runs'));
});
test('cancellation during a moving round closes its clients and does not proceed to another round',async()=>{
  const h=setup(),controller=new AbortController();h.timer.schedule(()=>controller.abort(),100);
  await assert.rejects(h.settle(runHostedSustained({...h.options,signal:controller.signal})),/cancelled|stopped/);
  assert.equal(h.saved.at(-1).status,'failed');assert.equal(h.calls.filter(call=>call.path==='/v1/runs').length,8);
  assert.equal(h.leases.size,0);assert.ok(h.sockets.every(socket=>socket.readyState===3));
});
test('cancellation in a pacing gap prevents the next batch; an already-cancelled test allocates nothing',async()=>{
  const h=setup(),controller=new AbortController(),save=h.options.save;
  h.options.save=report=>{save(report);if(report.completedRounds===1)controller.abort();};
  await assert.rejects(h.settle(runHostedSustained({...h.options,signal:controller.signal})),/cancelled/);
  assert.equal(h.calls.filter(call=>call.path==='/v1/runs').length,8);assert.equal(h.leases.size,0);
  const early=setup();await assert.rejects(early.settle(runHostedSustained({...early.options,signal:controller.signal})),/cancelled/);
  assert.equal(early.calls.length,0);
});
test('the workload deadline reaches the active round through its cancellation signal',async()=>{
  const h=setup();let rounds=0;
  const runRound=options=>new Promise((_resolve,reject)=>{
    rounds++;options.onStart();options.signal.addEventListener('abort',()=>reject(Error('workload time budget reached')),{once:true});
  });
  await assert.rejects(h.settle(runHostedSustained({...h.options,runRound})),/time budget/);
  assert.equal(rounds,1);assert.equal(h.timer.now(),720000);assert.equal(h.saved.at(-1).status,'failed');
});
test('reused attempt IDs and changed fixtures cannot become a sustained pass',async()=>{
  for(const change of ['duplicate','fixture']){
    const h=setup();let first,round=0;
    const runRound=async options=>{
      const report=await h.options.runRound(options);round++;
      if(round===1)first=report;
      else if(change==='duplicate')report.runs=first.runs;
      else report.sha256='0'.repeat(64);
      return report;
    };
    await assert.rejects(h.settle(runHostedSustained({...h.options,runRound})),/reused|same checked/);
    assert.equal(round,2);assert.equal(h.saved.at(-1).status,'failed');assert.equal(h.leases.size,0);
  }
});
