import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {COMMUNITY_MAPS} from '../dist/course.js';
import {loadSourceMap,parseSourceBsp,parseSourceEntities,sourceSpawn} from '../dist/source-map.js';
import {createSourceRuntime,sourceTriggerCrossing} from '../dist/source-runtime.js';
import {createPlayer,step,support,PRESETS} from '../dist/physics.js';
const archive=readFileSync(new URL('../dist/maps/bhop_lego.zip',import.meta.url));
const imported=await loadSourceMap(archive,COMMUNITY_MAPS[0]);

test('the shipped map archive is byte-for-byte the original author release',()=>{
  assert.equal(createHash('md5').update(archive).digest('hex'),'c916f2a56ef10e3a0a025c2c07d12e00');
  assert.deepEqual(archive,readFileSync(new URL('../maps/bhop_lego.zip',import.meta.url)));
});
test('the real BSP has textured geometry, separate invisible triggers and all main-route destinations',()=>{
  assert.ok(imported.boxes.length>1500);assert.ok(imported.mesh.reduce((n,b)=>n+b.data.length/18,0)>15000);
  assert.ok(imported.materials.filter(m=>m.image).length>50);assert.equal(imported.spawns.length,25);
  assert.equal(imported.triggers.filter(t=>t.classname==='trigger_teleport').length,356);
  for(const b of imported.boxes)assert.ok(b.planes.length>=6);
  for(const batch of imported.mesh)assert.ok(batch.data.every(Number.isFinite));
  assert.ok(imported.finish);assert.equal(imported.boxes.sourceMap,imported);
});
test('every imported checkpoint settles safely on its original pad, including the deep final stages',()=>{
  for(const [i,spawn] of imported.spawns.entries()){
    const p=createPlayer(spawn);
    for(let tick=0;tick<256;tick++)step(p,{},imported.boxes);
    assert.ok(p.grounded,imported.stages[i].target);assert.ok(support(p,imported.boxes));
    assert.ok(Math.abs(p.y-spawn.y)<=24);assert.equal(p.x,spawn.x);assert.equal(p.z,spawn.z);
  }
});
test('the broadphase preserves exact collision when compared with the complete imported scene',()=>{
  const full=[...imported.boxes],near=createPlayer(imported.spawns[0]),all=createPlayer(imported.spawns[0]);
  for(let tick=0;tick<400;tick++){
    const input={forward:1,jumpHeld:true,side:tick>200?.25:0};
    step(near,input,imported.boxes,PRESETS.practice);step(all,input,full,PRESETS.practice);
    for(const k of ['x','y','z','vx','vy','vz'])assert.ok(Math.abs(near[k]-all[k])<1e-6,k);
  }
});
test('the actual first LEGO pad resets a stalled player and allows an immediate jump',()=>{
  const stalled=createPlayer({x:-104,y:128,z:120,yaw:Math.PI}),runtime=createSourceRuntime(imported);let reset=false;
  for(let i=0;i<80;i++){const before={...stalled};step(stalled,{},imported.boxes);if(runtime.step(stalled,before,1/256).some(e=>e.type==='teleport')){reset=true;break;}}
  assert.equal(reset,true);assert.equal(stalled.x,imported.spawns[0].x);assert.equal(stalled.z,imported.spawns[0].z);
  const hopping=createPlayer({x:-104,y:128,z:120,yaw:Math.PI}),clean=createSourceRuntime(imported);
  for(let i=0;i<64;i++){const before={...hopping};step(hopping,{jumpHeld:true},imported.boxes,PRESETS.practice);assert.ok(!clean.step(hopping,before,1/256).some(e=>e.type==='teleport'));}
  assert.ok(hopping.y>170);
});
test('Source coordinates and duplicate output keys are preserved without executing console commands',()=>{
  assert.deepEqual(sourceSpawn({origin:'10 20 30',angles:'0 90 0'}),{x:10,y:30,z:-20,yaw:0,pitch:-0});
  const [entity]=parseSourceEntities('{"classname" "trigger_multiple" "OnStartTouch" "a,Enable,,0,-1" "OnStartTouch" "server,Command,quit,0,-1"}');
  assert.equal(entity.outputs.length,2);
  assert.throws(()=>parseSourceBsp(new Uint8Array(12)),/not a Source/);
  const malformed=new Uint8Array(1036);malformed.set([86,66,83,80]);new DataView(malformed.buffer).setInt32(4,20,true);new DataView(malformed.buffer).setInt32(8,2000,true);
  assert.throws(()=>parseSourceBsp(malformed),/invalid section/);
});
function fixture(){
  const bounds={min:[-20,0,-20],max:[20,8,20]},destination={x:200,y:16,z:0,yaw:0,pitch:0};
  const filter={classname:'filter_activator_name',targetname:'landed',filtername:'landed',Negated:'0'};
  const touch={...bounds,classname:'trigger_multiple',hammerid:'touch',outputs:[{event:'OnStartTouch',value:'!activator,AddOutput,targetname landed,0.1,-1'}]};
  const teleport={...bounds,classname:'trigger_teleport',hammerid:'teleport',filtername:'landed',target:'reset'};
  const map={entities:[filter],triggers:[teleport,touch],destinations:new Map([['reset',destination]]),spawns:[{x:0,y:0,z:0}],buttons:[]};
  return {map,runtime:createSourceRuntime(map),player:createPlayer({x:0,y:4,z:0,yaw:0})};
}
test('a clean hop passes the original delayed reset filter, while lingering on the pad teleports',()=>{
  const f=fixture();assert.deepEqual(f.runtime.step(f.player,{...f.player},.01),[]);assert.equal(f.player.x,0);
  f.runtime.step(f.player,{...f.player},.05);assert.equal(f.player.x,0);
  assert.equal(f.runtime.step(f.player,{...f.player},.06)[0].type,'teleport');assert.equal(f.player.x,200);
  const hop=fixture();hop.runtime.step(hop.player,{...hop.player},.01);const old={...hop.player};hop.player.y=100;
  hop.runtime.step(hop.player,old,.01);hop.runtime.step(hop.player,{...hop.player},.1);assert.equal(hop.player.x,0);
});
test('fast teleport crossings are swept and reset clears delayed events and progress',()=>{
  assert.ok(sourceTriggerCrossing({x:-200,y:0,z:0},{x:200,y:0,z:0},{min:[-5,0,-5],max:[5,10,5]}));
  const f=fixture();f.runtime.step(f.player,{...f.player},.01);f.runtime.reset(0);f.player.x=100;
  f.runtime.step(f.player,{...f.player},1);assert.equal(f.runtime.actorName,'');assert.equal(f.player.x,100);
});
test('push triggers use Source angles and completion requires the last main-route section',()=>{
  const f=fixture();f.map.triggers=[{min:[-20,0,-20],max:[20,8,20],classname:'trigger_push',hammerid:'push',pushdir:'-90 0 0',speed:'1000'}];
  f.map.spawns.push({x:100,y:0,z:0});f.map.finish={x:400,y:0,z:0};const runtime=createSourceRuntime(f.map);
  runtime.step(f.player,{...f.player},.1);assert.ok(f.player.vy>99);
  f.player.x=400;assert.ok(!runtime.step(f.player,{...f.player},.01).some(e=>e.type==='finish'));
  f.player.x=100;assert.ok(runtime.step(f.player,{...f.player},.01).some(e=>e.type==='checkpoint'));
  f.player.x=400;assert.ok(runtime.step(f.player,{...f.player},.01).some(e=>e.type==='finish'));
});
test('convex slopes support landings at the contact height instead of the brush bounding-box height',()=>{
  const brush={min:[-200,-100,-200],max:[200,100,200],planes:[
    {normal:[1,0,0],distance:200},{normal:[-1,0,0],distance:200},{normal:[0,-1,0],distance:100},
    {normal:[0,0,1],distance:200},{normal:[0,0,-1],distance:200},
    {normal:[-.2/Math.sqrt(1.04),1/Math.sqrt(1.04),0],distance:0},
  ]};
  const p=createPlayer({x:0,y:100,z:0,yaw:0});p.grounded=false;
  for(let i=0;i<256;i++)step(p,{},[brush]);
  assert.ok(p.grounded);assert.ok(Math.abs(p.y-.2*(p.x+16))<.001);assert.ok(p.y<10);assert.ok(support(p,[brush]));
});
