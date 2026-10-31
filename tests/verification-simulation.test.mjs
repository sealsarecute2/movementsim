import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {boot} from './helpers/boot-app.mjs';
import {MAPS,COMMUNITY_MAPS} from '../dist/course.js';
import {createPlayer,DT} from '../dist/physics.js';
import {trustedCourse,courseSelection} from '../verification/catalog.js';
import {RunSimulation} from '../verification/simulation.js';
import {VerificationSession} from '../verification/session.js';
import {benchmarkFrame} from '../tools/verification-workload.mjs';

const idle={forward:0,side:0,yaw:0,pitch:0,walk:false,duck:false,jumpHeld:false,jumpPressed:false};
async function pair(id,preset='classic'){
 const app=boot({},'',null,{fetch:async()=>({ok:true,json:async()=>JSON.parse(readFileSync(new URL('../dist/maps/'+id+'.json',import.meta.url),'utf8'))})});
 const metadata=COMMUNITY_MAPS.find(m=>m.id===id);
 if(metadata)await app.context.selectCommunityMap(metadata);else app.read(`chooseMap('${id}')`);
 app.read(`choosePreset('${preset}')`);
 if(id==='endless')app.read('endless=createEndless(42);boxes=endless.boxes;player=createPlayer(endless.spawn)');
 return {app,simulation:new RunSimulation(trustedCourse(id),preset,42)};
}
function clientTick(app,input){
 app.context.testInput=input;
 app.read(`keys.clear();
 if(testInput.forward>0)keys.add('KeyW');if(testInput.forward<0)keys.add('KeyS');
 if(testInput.side>0)keys.add('KeyD');if(testInput.side<0)keys.add('KeyA');
 if(testInput.walk)keys.add('ShiftLeft');if(testInput.duck)keys.add('KeyC');if(testInput.jumpHeld)keys.add('Space');
 player.yaw=testInput.yaw;player.pitch=testInput.pitch;pendingJump=testInput.jumpPressed;tick()`);
}
function compare(app,simulation){
 // The client resets a numerical fall immediately; the verifier must fail
 // closed instead of awarding a time or copying the reset player state.
 if(simulation.invalid==='invalid-physics'){assert.ok(app.read('respawns')>0);return;}
 assert.ok(Math.abs(app.read('runTime')-simulation.time)<1e-10,`${simulation.map.id} @ ${simulation.ticks}: client ${app.read('runTime')} server ${simulation.time}; ${app.read('respawns')} respawns; ${simulation.invalid}`);
 assert.equal(app.read('checkpoint'),simulation.checkpoint);
 assert.equal(app.read('completed'),simulation.completed);
 if(app.read('respawns')>0){assert.equal(simulation.invalid,'respawn');return;}
 for(const key of ['x','y','z','vx','vy','vz'])assert.ok(Math.abs(app.read('player.'+key)-simulation.player[key])<1e-8,key);
}
test('server simulation matches real client tick movement, timing and clean-run failures across all maps and presets',async()=>{
 for(const id of ['course','bhop-school','ladder-run','endless','bhop_lego','bhop_kitsune'])for(const preset of ['classic','practice']){
  const {app,simulation}=await pair(id,preset);
  for(let i=0;i<512;i++){
   const input=benchmarkFrame(i);simulation.step(input);clientTick(app,input);compare(app,simulation);
   if(simulation.invalid||simulation.completed)break;
  }
 }
 delete MAPS.bhop_lego;delete MAPS.bhop_kitsune;
});
test('the start-platform exit uses the same fractional physics tick for client and verifier',async()=>{
 const {app,simulation}=await pair('course');
 simulation.player=createPlayer({...trustedCourse('course').spawns[0],z:trustedCourse('course').boxes[0].min[2]-15.5});simulation.player.vz=-250;
 app.context.testPlayer={...simulation.player};app.read('player={...testPlayer}');
 simulation.step(idle);clientTick(app,idle);compare(app,simulation);
 assert.ok(simulation.time>0&&simulation.time<DT);
});
test('finish detection requires ordered checkpoints and freezes on the same exact final time',async()=>{
 for(const checkpoint of [0,2]){
  const {app,simulation}=await pair('course'),finish=simulation.boxes.find(b=>b.finish);
  simulation.player=createPlayer({x:(finish.min[0]+finish.max[0])/2,y:finish.max[1],z:(finish.min[2]+finish.max[2])/2,yaw:0});
  simulation.active=true;simulation.time=5;simulation.checkpoint=checkpoint;
  app.context.testPlayer={...simulation.player};app.read(`player={...testPlayer};runActive=true;runTime=5;checkpoint=${checkpoint}`);
  simulation.step(idle);clientTick(app,idle);compare(app,simulation);assert.equal(simulation.completed,checkpoint===2);
  if(simulation.completed){const time=simulation.time;simulation.step(idle);assert.equal(simulation.time,time);}
 }
});
test('Kitsune portal momentum and checkpoint transitions match the client',async()=>{
 const {app,simulation}=await pair('bhop_kitsune'),portal=simulation.source.portals[0];
 simulation.player=createPlayer({x:(portal.min[0]+portal.max[0])/2,y:portal.min[1],z:(portal.min[2]+portal.max[2])/2,yaw:0});simulation.player.vx=500;
 app.context.testPlayer={...simulation.player};app.read('player={...testPlayer}');
 simulation.step(idle);clientTick(app,idle);compare(app,simulation);assert.equal(simulation.checkpoint,1);
 delete MAPS.bhop_kitsune;
});
test('selection accepts only trusted scored maps, valid controls and bounded staging identities',()=>{
 for(const bad of [{map:'local-map',preset:'classic',slot:0},{map:'free',preset:'classic',slot:0},{map:'course',preset:'fake',slot:0},{map:'course',preset:'classic',slot:32},{map:'course',preset:'classic',slot:0,time:1}])assert.throws(()=>courseSelection(bad));
 assert.equal(courseSelection({map:'bhop_lego',preset:'practice',slot:0}).revision,2);
});
test('session closes on excessive input, timeout and simulation failures, releasing work only once',()=>{
 let now=0;const ended=[],sent=[];
 const session=new VerificationSession({map:trustedCourse('course'),preset:'classic',startedAt:0,now:()=>now,send:x=>sent.push(x),onEnd:x=>ended.push(x)});
 session.receive('x'.repeat(4097));session.advance();session.end();assert.equal(ended.length,1);assert.equal(ended[0].reason,'packet-size');assert.equal(ended[0].ticks,0);assert.equal(ended[0].ranked,false);
 const idleSession=new VerificationSession({map:trustedCourse('course'),preset:'classic',startedAt:0,now:()=>now,onEnd:x=>ended.push(x)});
 now=5001;idleSession.advance();assert.equal(ended.at(-1).reason,'input-timeout');
});

test('each timed map and preset finishes on the same final tick and requires its final ordered checkpoint',async()=>{
 for(const id of ['course','bhop-school','ladder-run','bhop_lego','bhop_kitsune'])for(const preset of ['classic','practice']){
  const {app,simulation}=await pair(id,preset),map=trustedCourse(id),finish=simulation.boxes.find(box=>box.finish),checkpoint=map.spawns.length-1;
  const player=createPlayer({x:(finish.min[0]+finish.max[0])/2,y:finish.max[1],z:(finish.min[2]+finish.max[2])/2,yaw:0});
  simulation.player=player;simulation.active=true;simulation.time=5;simulation.checkpoint=checkpoint;simulation.runtime?.reset(checkpoint);
  app.context.testPlayer={...player};app.read(`player={...testPlayer};runActive=true;runTime=5;checkpoint=${checkpoint};sourceRuntime?.reset(checkpoint)`);
  simulation.step(idle);clientTick(app,idle);compare(app,simulation);assert.equal(simulation.completed,true,id+' '+preset);
 }
 delete MAPS.bhop_lego;delete MAPS.bhop_kitsune;
});
