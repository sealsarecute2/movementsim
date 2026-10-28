import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MAP_LIST,COURSE,SPAWNS} from '../dist/course.js';
import {createPlayer,step,support,RULES,PRESETS} from '../dist/physics.js';
import {routeNode,reachSegment} from './route-driver.mjs';
import {buildSignMesh} from '../dist/signs.js';

test('the catalog includes two new courses and has no difficulty or skip metadata',()=>{
 assert.deepEqual(MAP_LIST.map(m=>m.id),['course','bhop-school','ladder-run','endless','free']);
 assert.deepEqual(MAP_LIST.filter(m=>m.timed).map(m=>m.id),['course','bhop-school','ladder-run']);
 for(const map of MAP_LIST){assert.equal(map.difficulty,undefined);assert.equal(map.skips,undefined);assert.ok(!map.boxes.some(b=>b.skipLaunch||b.shortcut));}
});
for(const map of MAP_LIST.filter(m=>['bhop-school','ladder-run'].includes(m.id))) {
 for(const [name,mode] of Object.entries(PRESETS))test(`${map.title}: every route segment is reachable in ${name}`,()=>{
  const route=map.boxes.filter(b=>!b.ladder&&!b.obstacle&&!b.roof);
  for(let i=1;i<route.length;i++)assert.ok(reachSegment({from:routeNode(route[i-1]),to:routeNode(route[i]),boxes:map.boxes,destination:route[i],mode}),`segment ${i} must connect`);
 });
 test(`${map.title}: lesson signs have finite, readable geometry within their boards`,()=>{
  const signs=map.boxes.filter(b=>b.sign);assert.equal(signs.length,map.spawns.length);
  for(const board of signs){
   assert.ok(board.sign.title&&board.sign.lines.length>=3);
   const mesh=buildSignMesh(board);assert.ok(mesh.length>100);assert.equal(mesh.length%66,0);assert.ok(mesh.every(Number.isFinite));
   for(let i=0;i<mesh.length;i+=11){
    assert.ok(mesh[i]>board.min[0]&&mesh[i]<board.max[0]);assert.ok(mesh[i+1]>board.min[1]&&mesh[i+1]<board.max[1]);
    assert.ok(mesh[i+2]>board.max[2]);assert.equal(mesh[i+10],-1,'sign letters stay readable with shaders enabled');
   }
  }
 });
}
test('Bhop School signs explain the actual controls and Ladder Run requires two climbs',()=>{
 const school=MAP_LIST.find(m=>m.id==='bhop-school'),ladder=MAP_LIST.find(m=>m.id==='ladder-run');
 const text=school.boxes.filter(b=>b.sign).flatMap(b=>[b.sign.title,...b.sign.lines]).join('\n');
 for(const instruction of ['HOLD SPACE','RELEASE W','A + MOUSE LEFT','D + MOUSE RIGHT','E =','Q ='])assert.ok(text.includes(instruction));
 assert.equal(ladder.boxes.filter(b=>b.ladder).length,2);
 for(const top of ladder.boxes.filter(b=>b.feature==='ladder')){
  const face=ladder.boxes.find(b=>b.ladder&&b.max[1]===top.max[1]+2);assert.ok(face);
  assert.ok(top.max[1]-face.min[1]>RULES.jump**2/(2*RULES.gravity),'a standing jump cannot replace the climb');
 }
});
test('Starter geometry and spawns retain the original layout exactly',()=>{
 const original=COURSE.filter(b=>!b.sign&&!b.signPost);
 assert.equal(createHash('sha256').update(JSON.stringify({COURSE:original,SPAWNS})).digest('hex'),'b9ddcba81a281ca4b397640b78a4f78200a51207f5108a329e8b712a7c719f1b');
});
test('Starter has a compact teaching sign for each section, matching the smaller course-wide boards',()=>{
 const signs=COURSE.filter(b=>b.sign);assert.equal(signs.length,SPAWNS.length);
 const text=signs.flatMap(b=>b.sign.lines).join('\n');
 for(const instruction of ['SPACE = KEEP HOPPING','RELEASE W','A + MOUSE LEFT','D + MOUSE RIGHT','CTRL / C'])assert.ok(text.includes(instruction));
 for(const map of MAP_LIST)for(const board of map.boxes.filter(b=>b.sign)){
  assert.equal(board.max[0]-board.min[0],180);assert.equal(board.max[1]-board.min[1],86);
  const mesh=buildSignMesh(board);assert.ok(mesh.length>100);assert.ok(mesh.every(Number.isFinite));
 }
});
for(const map of MAP_LIST.filter(m=>!m.endless))test(`${map.title}: saved spawns have standing clearance and solid support`,()=>{
 assert.equal(map.spawns.length,map.stages.length);
 assert.equal(map.boxes.filter(b=>b.finish).length,map.timed?1:0);
 for(const [i,spawn] of map.spawns.entries()) {
  const player=createPlayer(spawn),floor=support(player,map.boxes);assert.ok(floor);if(i)assert.equal(floor.checkpoint,i);
  for(const b of map.boxes)if(!b.ladder)assert.equal(spawn.x+16>b.min[0]&&spawn.x-16<b.max[0]&&spawn.z+16>b.min[2]&&spawn.z-16<b.max[2]&&spawn.y+RULES.standHeight>b.min[1]&&spawn.y<b.max[1],false);
  step(player,{},map.boxes);assert.equal(player.grounded,true);assert.equal(player.y,spawn.y);
 }
});
test('Sandbox retains its climbable tower, wrap wall, crouch roof, narrow rail and precision pins',()=>{
 const scene=MAP_LIST.find(m=>m.id==='free').boxes;
 assert.ok(scene.some(b=>b.ladder));assert.ok(scene.some(b=>b.wrapWall));assert.ok(scene.some(b=>b.roof));
 assert.ok(scene.some(b=>b.max[0]-b.min[0]===22));assert.ok(scene.some(b=>b.max[0]-b.min[0]===28));
});
