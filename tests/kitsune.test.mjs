import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {hydrateParkourMap} from '../dist/parkour-map.js';
import {createSourceRuntime} from '../dist/source-runtime.js';
import {createPlayer,step,support,PRESETS} from '../dist/physics.js';

const load=()=>hydrateParkourMap(JSON.parse(readFileSync(new URL('../dist/maps/bhop_kitsune.json',import.meta.url),'utf8')));
test('Kitsune includes six main stages, five portals and an ending while the original archive stays intact',()=>{
 const map=load();assert.equal(map.spawns.length,6);assert.equal(map.portals.length,5);assert.equal(map.boosts.length,6);assert.notEqual(map.finishPad,null);
 assert.equal(map.revision,3);assert.ok(map.boxes.length>500&&map.boxes.length<1500);assert.ok(map.boxes.every(b=>b.max[1]-b.min[1]<=120));
 const archive=readFileSync(new URL('../dist/maps/bhop_kitsune.zip',import.meta.url));assert.equal(createHash('md5').update(archive).digest('hex'),'36f2da19ae5918b8b95d6d74a08fb405');
 for(const file of ['bhop_kitsune.zip','bhop_kitsune.json','bhop_kitsune.svg'])assert.deepEqual(readFileSync(new URL('../maps/'+file,import.meta.url)),readFileSync(new URL('../dist/maps/'+file,import.meta.url)));
});
test('Kitsune has no support on the former side ledges, entry rails or roof shortcuts',()=>{
 const map=load();
 for(const spawn of map.spawns.slice(0,5)){
  const offset=spawn.x+2096;
  for(const point of [
   {x:-1000+offset,y:spawn.y+60,z:spawn.z},
   {x:-1000+offset,y:spawn.y+28,z:spawn.z-544},
   {x:-1000+offset,y:spawn.y+28,z:spawn.z+544},
   {x:-500+offset,y:spawn.y+60,z:spawn.z-504},
   {x:-500+offset,y:spawn.y+60,z:spawn.z+504},
   {x:spawn.x,y:spawn.y+46,z:spawn.z-65},
   {x:2024+offset,y:spawn.y+12,z:spawn.z},
  ])assert.equal(support(createPlayer(point),map.boxes),undefined,JSON.stringify(point));
 }
 for(const point of [
  {x:280,y:8744,z:-10144},{x:-400,y:8896,z:-10648},
  {x:-400,y:8896,z:-9640},{x:0,y:8192,z:-10688},
 ])assert.equal(support(createPlayer(point),map.boxes),undefined,JSON.stringify(point));
});
test('Kitsune keeps the approach floors and all three levels of the final jumping pads',()=>{
 const map=load();
 for(const spawn of map.spawns.slice(0,5))assert.ok(support(createPlayer({x:-1500+spawn.x+2096,y:spawn.y-164,z:spawn.z}),map.boxes));
 for(const point of [{x:440,y:7958,z:-10232},{x:616,y:7550,z:-10232},{x:440,y:7102,z:-10232}])assert.ok(support(createPlayer(point),map.boxes),JSON.stringify(point));
});
test('every Kitsune checkpoint has grounded support, standing clearance and a local collision window',()=>{
 const map=load();
 for(const spawn of map.spawns){
  const player=createPlayer(spawn);step(player,{},map.boxes);assert.ok(player.grounded);assert.equal(player.y,spawn.y);assert.ok(support(player,map.boxes));
  assert.ok(map.boxes.nearby(player).length<map.boxes.length/3);
  assert.ok(!map.boxes.some(b=>player.x+16>b.min[0]&&player.x-16<b.max[0]&&player.z+16>b.min[2]&&player.z-16<b.max[2]&&player.y+72>b.min[1]&&player.y<b.max[1]-.0001));
 }
});
test('Kitsune portals advance only in order, preserve horizontal speed and finish after the White stage',()=>{
 const map=load(),runtime=createSourceRuntime(map),last=map.portals.at(-1);
 const atPortal=p=>createPlayer({x:(p.min[0]+p.max[0])/2,y:p.min[1],z:(p.min[2]+p.max[2])/2,yaw:0});
 let player=atPortal(last);assert.deepEqual(runtime.step(player,{...player},1/256),[]);assert.equal(runtime.stage,0);
 for(const portal of map.portals){
  player=atPortal(portal);player.vx=500;player.vz=15;
  const events=runtime.step(player,{...player},1/256);assert.deepEqual(events.map(e=>e.type),['checkpoint','portal']);assert.equal(runtime.stage,portal.to);
  const spawn=map.spawns[portal.to];assert.equal(player.x,spawn.x);assert.equal(player.y,spawn.y);assert.equal(player.z,spawn.z);assert.equal(player.vx,500);assert.equal(player.vz,15);assert.ok(player.grounded);
 }
 const finish=map.boxes[map.finishPad];player=createPlayer({x:(finish.min[0]+finish.max[0])/2,y:finish.max[1],z:(finish.min[2]+finish.max[2])/2,yaw:0});
 assert.ok(runtime.step(player,{...player},1/256).some(e=>e.type==='finish'));assert.ok(!runtime.step(player,{...player},1/256).some(e=>e.type==='finish'));
 runtime.reset(0);assert.ok(!runtime.step(player,{...player},1/256).some(e=>e.type==='finish'));
});
test('Kitsune falls return to the active stage and allow the long final descent',()=>{
 const map=load(),runtime=createSourceRuntime(map);
 for(let stage=0;stage<6;stage++){
  runtime.reset(stage);const player=createPlayer({...map.spawns[stage],y:map.sectionFalls[stage]-1});
  assert.deepEqual(runtime.step(player,{...player},1/256),[{type:'respawn',stage}]);
 }
 assert.ok(map.sectionFalls[5]<map.boxes[map.finishPad].max[1]);
});
test('the indexed Kitsune collision window matches full-map movement in both physics modes',()=>{
 const map=load(),full=map.boxes.slice();
 for(const mode of Object.values(PRESETS))for(const spawn of map.spawns){
  const indexed=createPlayer(spawn),reference=createPlayer(spawn);
  for(let tick=0;tick<128;tick++){
   const input={forward:1,jumpHeld:true};step(indexed,input,map.boxes,mode);step(reference,input,full,mode);
   for(const key of ['x','y','z','vx','vy','vz'])assert.ok(Math.abs(indexed[key]-reference[key])<1e-8,key);
  }
 }
});
