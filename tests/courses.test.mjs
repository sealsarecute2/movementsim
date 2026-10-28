import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_LIST, COURSE, SPAWNS } from '../dist/course.js';
import { createHash } from 'node:crypto';
import { reachSegment } from './route-driver.mjs';
import { createPlayer, step, support, PRESETS, DT, RULES } from '../dist/physics.js';

test('the course catalog includes nine distinct timed courses and free roam',()=>{
  assert.equal(MAP_LIST.filter(m=>m.timed).length,9);
  assert.equal(new Set(MAP_LIST.map(m=>m.id)).size,MAP_LIST.length);
  assert.equal(MAP_LIST.find(m=>m.id==='free').timed,false);
  assert.equal(MAP_LIST.find(m=>m.id==='endless').endless,true);
  assert.equal(new Set(MAP_LIST.filter(m=>m.route).map(m=>JSON.stringify(m.route))).size,8);
});
for(const map of MAP_LIST.filter(m=>!m.endless)) {
  test(`${map.title}: checkpoints spawn with room to stand and face the route`,()=>{
    assert.equal(map.spawns.length,map.stages.length);
    assert.equal(map.boxes.filter(b=>b.finish).length,map.timed?1:0);
    assert.deepEqual(map.boxes.filter(b=>b.checkpoint).map(b=>b.checkpoint),
      Array.from({length:map.spawns.length-1},(_,i)=>i+1));
    for(const [i,spawn] of map.spawns.entries()) {
      const player=createPlayer(spawn),floor=support(player,map.boxes);
      assert.ok(floor,`spawn ${i} must be supported`);
      if(i)assert.equal(floor.checkpoint,i);
      for(const b of map.boxes) {
        const intersects=spawn.x+16>b.min[0]&&spawn.x-16<b.max[0]&&
          spawn.z+16>b.min[2]&&spawn.z-16<b.max[2]&&
          spawn.y+RULES.standHeight>b.min[1]&&spawn.y<b.max[1];
        assert.equal(intersects,false,`spawn ${i} must have standing clearance`);
      }
      step(player,{},map.boxes);
      assert.equal(player.grounded,true);assert.equal(player.y,spawn.y);
    }
  });
  if(!map.route) continue;
  test(`${map.title}: every route segment is traversable with both movement presets`,()=>{
    for(const mode of Object.values(PRESETS))for(let i=1;i<map.route.length;i++) {
      assert.ok(reachSegment({from:map.route[i-1],to:map.route[i],boxes:map.boxes,destination:map.platforms[i],mode}),`${mode.title} segment ${i}`);
    }
  });
  test(`${map.title}: optional skips are possible and never bypass a checkpoint`,()=>{
    assert.ok(map.skips.length>0);
    for(const skip of map.skips) {
      assert.equal(map.route.slice(skip.from+1,skip.to).some(n=>n.checkpoint),false);
      const nodes=[map.route[skip.from],...(skip.via?[skip.via]:[]),map.route[skip.to]];
      const platforms=[map.platforms[skip.from],...(skip.via?[map.boxes.find(b=>b.shortcut&&b.min[0]===skip.via.x-skip.via.w/2)]:[]),map.platforms[skip.to]];
      for(let i=1;i<nodes.length;i++)assert.ok(reachSegment({from:nodes[i-1],to:nodes[i],boxes:map.boxes,destination:platforms[i],forceJump:true}),`skip ${skip.from} → ${skip.to}, leg ${i}`);
    }
  });
}

test('Starter geometry and spawns retain the original layout exactly',()=>{
 assert.equal(createHash('sha256').update(JSON.stringify({COURSE,SPAWNS})).digest('hex'),'b9ddcba81a281ca4b397640b78a4f78200a51207f5108a329e8b712a7c719f1b');
});
test('rebuilt maps have harder difficulty, distinct movement mixes, and walls that require wrapping',()=>{
 for(const map of MAP_LIST.filter(m=>m.route)) {
  assert.ok(['Hard','Expert','Extreme'].includes(map.difficulty));assert.equal(map.revision,2);
  for(let i=1;i<map.route.length;i++)if(map.route[i].via) {
   assert.equal(reachSegment({from:map.route[i-1],to:{...map.route[i],via:null},boxes:map.boxes,destination:map.platforms[i]}),null,'a straight jump must not pass through a wrap wall');
  }
 }
 assert.ok(MAP_LIST.filter(m=>m.boxes.some(b=>b.ladder)).length>=5);
});
