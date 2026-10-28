import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hydrateParkourMap} from '../dist/parkour-map.js';
import {createSourceRuntime} from '../dist/source-runtime.js';
import {createPlayer,step,support} from '../dist/physics.js';
const map=hydrateParkourMap(JSON.parse(readFileSync(new URL('../dist/maps/bhop_lego.json',import.meta.url),'utf8')));
const at=index=>({...map.spawns[index],vx:0,vy:0,vz:0,ducked:false});
test('a later pad cannot save out of order or from far overhead',()=>{
  const runtime=createSourceRuntime(map),later=at(3);
  assert.ok(!runtime.step(later,{...later},1/256).some(e=>e.type==='checkpoint'));assert.equal(runtime.stage,0);
  const high={...at(1),y:at(1).y+250};assert.ok(!runtime.step(high,{...high},1/256).some(e=>e.type==='checkpoint'));
  const next=at(1);assert.equal(runtime.step(next,{...next},1/256).find(e=>e.type==='checkpoint').stage,1);
  assert.ok(!runtime.step(later,{...later},1/256).some(e=>e.type==='checkpoint'));
  for(const i of [2,3]){const p=at(i);assert.equal(runtime.step(p,{...p},1/256).find(e=>e.type==='checkpoint').stage,i);}
});
test('checkpoint crossings are swept at high speed and only fire once',()=>{
  const runtime=createSourceRuntime(map),pad=map.boxes[map.checkpointPads[1]],y=pad.max[1]+20,z=(pad.min[2]+pad.max[2])/2;
  const before={...at(0),x:pad.min[0]-100,y,z},after={...before,x:pad.max[0]+100};
  assert.equal(runtime.step(after,before,1/256).find(e=>e.type==='checkpoint').stage,1);
  const p=at(1);assert.ok(!runtime.step(p,{...p},1/256).some(e=>e.type==='checkpoint'));
});
test('falling uses the current section, while legitimate deep drops and boost basins remain open',()=>{
  const runtime=createSourceRuntime(map),p={...at(0),y:map.sectionFalls[0]-1};
  assert.equal(runtime.step(p,{...p},1/256).find(e=>e.type==='respawn').stage,0);
  const dropIndex=map.stages.findIndex(s=>s.target==='6d');runtime.reset(dropIndex);
  const fall={...at(dropIndex),y:-1500};assert.ok(!runtime.step(fall,{...fall},1/256).some(e=>e.type==='respawn'));
  const boostIndex=map.stages.findIndex(s=>s.target==='6b');assert.ok(map.sectionFalls[boostIndex]<48);
  runtime.reset(2);p.y=map.sectionFalls[2]-1;assert.equal(runtime.step(p,{...p},1/256).find(e=>e.type==='respawn').stage,2);
});
test('saved respawn positions are immediately grounded without drifting or bouncing',()=>{
  for(const spawn of map.spawns){const p=createPlayer(spawn);assert.ok(support(p,map.boxes));for(let i=0;i<64;i++)step(p,{},map.boxes);assert.deepEqual([p.x,p.y,p.z],[spawn.x,spawn.y,spawn.z]);assert.ok(p.grounded);}
});
test('the finish requires every checkpoint, and resetting clears completion',()=>{
  const runtime=createSourceRuntime(map),pad=map.boxes[map.finishPad],p={...at(0),x:(pad.min[0]+pad.max[0])/2,y:pad.max[1],z:(pad.min[2]+pad.max[2])/2};
  assert.ok(!runtime.step(p,{...p},1/256).some(e=>e.type==='finish'));
  runtime.reset(map.spawns.length-1);assert.ok(runtime.step(p,{...p},1/256).some(e=>e.type==='finish'));
  assert.ok(!runtime.step(p,{...p},1/256).some(e=>e.type==='finish'));
  runtime.reset(0);assert.ok(!runtime.step(p,{...p},1/256).some(e=>e.type==='finish'));
});
test('the published cache matches local preview and needs no textures or original archive download',()=>{
  const source=readFileSync(new URL('../dist/maps/bhop_lego.json',import.meta.url));assert.ok(source.length<40000);
  assert.deepEqual(source,readFileSync(new URL('../maps/bhop_lego.json',import.meta.url)));
  assert.equal(map.materials,undefined);assert.equal(map.mesh,undefined);assert.ok(map.boxes.length<500);
});
