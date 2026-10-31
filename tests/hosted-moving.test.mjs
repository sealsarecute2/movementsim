import test from 'node:test';
import assert from 'node:assert/strict';
import {runHostedMoving} from '../verification/hosted-moving.mjs';
import {metricWindow} from '../verification/hosted-metrics.mjs';
import {harness,input,fixtureTicks} from './helpers/hosted-moving-harness.mjs';

test('eight simultaneous moving sessions compare input-only states, finish, packets, overlap and cleanup',async()=>{
  const h=harness(),report=await h.settle(runHostedMoving(h.options));
  assert.equal(report.status,'passed');assert.equal(h.saved.at(-1),report);assert.equal(h.saved[0].status,'running');
  assert.equal(report.clients,8);assert.equal(report.peakActiveClients,8);assert.equal(report.runs.length,8);
  assert.deepEqual(metricWindow(report,Date.parse(report.generatedAt)),{from:'2026-10-30T02:59:00.000Z',to:'2026-10-30T03:02:00.000Z'});
  assert.ok(report.overlapSeconds>=report.requiredOverlapSeconds);assert.equal(report.activeAfter,0);assert.equal(h.leases.size,0);
  assert.ok(report.stateGapP95Ms>=200&&report.stateGapP95Ms<=216);
  for(const run of report.runs){
    assert.equal(run.timeDifferenceSeconds,0);assert.equal(run.time,report.local.time);assert.equal(run.checkpoint,1);
    assert.ok(run.stateComparisons>2);assert.equal(run.metrics.packets,Math.ceil(report.inputTicks/16));
    const packets=h.packets.filter(packet=>packet.slot===run.slot).map(value=>value.packet);
    assert.equal(packets.flatMap(packet=>packet.frames).length,report.inputTicks);
    packets.forEach((packet,index)=>{
      assert.deepEqual(Object.keys(packet),['seq','firstTick','frames']);assert.equal(packet.seq,index);assert.equal(packet.firstTick,index*16);
      assert.ok(packet.frames.length>=1&&packet.frames.length<=16);assert.deepEqual(Object.keys(packet.frames[0]).sort(),Object.keys(input).sort());
    });
  }
  assert.equal(h.calls.filter(call=>call.path==='/v1/runs').length,8);assert.ok(!h.calls.some(call=>call.path.includes('stop-all')));
  assert.ok(h.sockets.every(socket=>socket.readyState===3));assert.ok(!JSON.stringify(h.saved).includes('private.ticket'));
});
test('invalid references, occupied capacity, budget shortage and a changed cap prevent every allocation',async()=>{
  for(const before of [{active:1},{dailyRunMs:4799999},{reservedRunMs:-1},{limit:9},{ranked:true}]){
    const h=harness({before});await assert.rejects(h.settle(runHostedMoving(h.options)));
    assert.ok(!h.calls.some(call=>call.path==='/v1/runs'));assert.equal(h.sockets.length,0);assert.equal(h.saved.at(-1).status,'failed');
  }
  const h=harness();await assert.rejects(h.settle(runHostedMoving({...h.options,raw:'{}'})));
  assert.equal(h.calls.length,0);assert.equal(h.saved.at(-1).status,'failed');
});
test('moving-state, persisted-result and queue-bound failures never save a pass and close only owned clients',async()=>{
  for(const change of [
    {stateChange:(state,slot)=>slot===24&&state.type==='state'&&state.ticks>0?{...state,x:state.x+1}:state},
    {outcomeChange:(state,slot)=>slot===25?{...state,time:state.time+.01}:state},
    {stateChange:(state,slot)=>slot===26&&state.metrics?{...state,metrics:{...state.metrics,peakQueue:129}}:state},
    {outcomeChange:(state,slot)=>slot===27?{...state,ranked:true}:state},
  ]){
    const h=harness(change);await assert.rejects(h.settle(runHostedMoving(h.options)));
    assert.equal(h.saved.at(-1).status,'failed');assert.ok(!h.saved.some(report=>report.status==='passed'));
    assert.equal(h.leases.size,0);assert.ok(h.sockets.every(socket=>socket.readyState===3));
    assert.ok(!h.calls.some(call=>call.path.includes('stop-all')));
  }
});
test('sequential-looking successes cannot pass as eight concurrent moving replays',async()=>{
  const h=harness({readyDelay:slot=>slot===31?fixtureTicks/256*500:10});
  await assert.rejects(h.settle(runHostedMoving(h.options)),/overlap/);
  assert.equal(h.saved.at(-1).status,'failed');assert.equal(h.leases.size,0);
});
test('lost allocations, duplicate IDs and mismatched revisions are not retried; unopened alarms reclaim reservations',async()=>{
  for(const change of [
    {lostSlot:27,allocationDelay:slot=>slot===27?50:0},
    {duplicateSlot:26},
    {selectionChange:selection=>selection.slot===25?{...selection,revision:2}:selection},
  ]){
    const h=harness(change);await assert.rejects(h.settle(runHostedMoving(h.options)));
    assert.equal(h.calls.filter(call=>call.path==='/v1/runs').length,8);assert.equal(h.leases.size,0);
    assert.equal(h.saved.at(-1).cleanup.activeAfter,0);assert.ok(!h.saved.some(report=>report.status==='passed'));
    assert.ok(!h.calls.some(call=>call.path.includes('stop-all')));
  }
});
test('an early socket failure cancels late arrivals without opening more replay sockets',async()=>{
  const h=harness({allocationDelay:slot=>slot===31?200:0,
    stateChange:(state,slot)=>slot===24&&state.type==='state'&&state.ticks>0?{...state,z:state.z+1}:state});
  await assert.rejects(h.settle(runHostedMoving(h.options)));
  assert.ok(!h.sockets.some(socket=>socket.run.selection.slot===31));assert.equal(h.leases.size,0);
  assert.equal(h.saved.at(-1).cleanup.activeAfter,0);
});
test('missing readiness and unreleased capacity have bounded failure paths without a global stop',async()=>{
  for(const change of [{readiness:false},{leftover:true}]){
    const h=harness(change);await assert.rejects(h.settle(runHostedMoving(h.options)));
    assert.equal(h.saved.at(-1).status,'failed');assert.ok(h.timer.now()<40000);
    assert.ok(h.sockets.every(socket=>socket.readyState===3));assert.ok(!h.calls.some(call=>call.path.includes('stop-all')));
    if(change.leftover)assert.equal(h.saved.at(-1).cleanup.activeAfter,1);
  }
});
test('fractional clock readings still give status requests valid integer timeout budgets',async()=>{
  const h=harness({leftover:true}),read=h.options.api.json;
  h.options.api.json=async(path,body,options)=>{
    if(path==='/v1/status'&&h.sockets.length===8&&h.sockets.every(socket=>socket.readyState===3))await h.timer.wait(.5);
    return read(path,body,options);
  };
  await assert.rejects(h.settle(runHostedMoving(h.options)),/active attempts/);
  const budgets=h.calls.filter(call=>call.options?.timeoutMs!==undefined).map(call=>call.options.timeoutMs);
  assert.ok(budgets.some(value=>value<5000));
  assert.ok(budgets.every(value=>Number.isInteger(value)&&value>0&&value<=5000));
  assert.ok(h.timer.now()<25000);
});
