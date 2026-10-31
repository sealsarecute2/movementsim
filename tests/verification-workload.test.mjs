import test from 'node:test';
import assert from 'node:assert/strict';
import {benchmarkMaps,makeWorkload,benchmarkFrame} from '../tools/verification-workload.mjs';
import {RunInputGate} from '../verification/limits.js';

const maps=benchmarkMaps();
function exercise(map,feature='route',preset='practice'){
 let now=0;const gate=new RunInputGate({now:()=>now}),workload=makeWorkload(map,preset,{feature});
 for(let batch=0;batch<32;batch++){
  const frames=Array.from({length:16},(_,i)=>benchmarkFrame(gate.receivedTicks+i,feature));
  gate.receive(JSON.stringify({seq:gate.sequence,firstTick:gate.receivedTicks,frames}));now+=62.5;
  assert.equal(gate.advance(workload.simulate),16);
 }
 return workload.coverage;
}
test('benchmark uses all six scored maps and excludes Sandbox and arbitrary uploads',()=>{
 assert.deepEqual(maps.map(m=>m.id),['course','bhop-school','ladder-run','endless','bhop_lego','bhop_kitsune']);
 assert.equal(maps.find(m=>m.id==='bhop_lego').boxes.length,428);
 assert.equal(maps.find(m=>m.id==='bhop_kitsune').boxes.length,956);
});
test('bounded input drives grounded and airborne movement on every scored map in both physics modes',()=>{
 for(const map of maps)for(const preset of ['classic','practice']){
  const coverage=exercise(map,'route',preset);
  assert.equal(coverage.steps,512);assert.ok(coverage.grounded>0,map.id);assert.ok(coverage.airborne>0,map.id);
 }
});
test('special fixtures exercise actual ladder contact, stage portals and repeated landings',()=>{
 const ladder=exercise(maps.find(m=>m.id==='ladder-run'),'ladder');assert.ok(ladder.ladder>256);
 const portals=exercise(maps.find(m=>m.id==='bhop_kitsune'),'portal');assert.ok(portals.portals>=2);
 const landings=exercise(maps.find(m=>m.id==='bhop_lego'),'landing');assert.ok(landings.landings>=2);
});
