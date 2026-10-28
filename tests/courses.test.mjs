import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MAP_LIST,COURSE,SPAWNS} from '../dist/course.js';
import {createPlayer,step,support,RULES} from '../dist/physics.js';

test('only Starter, Endless and Sandbox remain and the catalog has no difficulty or skip metadata',()=>{
 assert.deepEqual(MAP_LIST.map(m=>m.id),['course','endless','free']);
 assert.deepEqual(MAP_LIST.filter(m=>m.timed).map(m=>m.id),['course']);
 for(const map of MAP_LIST){assert.equal(map.difficulty,undefined);assert.equal(map.skips,undefined);assert.ok(!map.boxes.some(b=>b.skipLaunch||b.shortcut));}
});
test('Starter geometry and spawns retain the original layout exactly',()=>{
 assert.equal(createHash('sha256').update(JSON.stringify({COURSE,SPAWNS})).digest('hex'),'b9ddcba81a281ca4b397640b78a4f78200a51207f5108a329e8b712a7c719f1b');
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
