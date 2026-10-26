import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_LIST } from '../dist/course.js';
import { createPlayer, step, support, PRESETS, DT, RULES } from '../dist/physics.js';

test('the course catalog includes nine distinct timed courses and free roam',()=>{
  assert.equal(MAP_LIST.filter(m=>m.timed).length,9);
  assert.equal(new Set(MAP_LIST.map(m=>m.id)).size,MAP_LIST.length);
  assert.equal(MAP_LIST.find(m=>!m.timed).id,'free');
  assert.equal(new Set(MAP_LIST.filter(m=>m.route).map(m=>JSON.stringify(m.route))).size,8);
});
for(const map of MAP_LIST) {
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
  test(`${map.title}: every gap and connected segment is traversable with CS-style physics`,()=>{
    for(let i=1;i<map.route.length;i++) {
      const from=map.route[i-1],to=map.route[i],destination=map.platforms[i];
      const walk=!!to.walk;
      // For gaps, take off near the edge along a line into the next block.
      // For connected sections, walk all the way from one platform center.
      let reached=false;
      // Raised landings need an earlier takeoff to clear the front face;
      // small pillars also need room to avoid overshooting at full speed.
      for(const margin of walk?[0]:[22,46,70,94,118]) {
        const mx=Math.min(margin,from.w/2-4),mz=Math.min(margin,from.d/2-4);
        const x=walk?from.x:Math.max(from.x-from.w/2+mx,Math.min(from.x+from.w/2-mx,to.x));
        const z=walk?from.z:Math.max(from.z-from.d/2+mz,Math.min(from.z+from.d/2-mz,to.z));
        const dx=to.x-x,dz=to.z-z,length=Math.hypot(dx,dz);
        const p=createPlayer({x,y:from.top,z,yaw:Math.atan2(dx,-dz)});
        if(!walk){p.vx=dx/length*250;p.vz=dz/length*250;}
        for(let tick=0;tick<256*12;tick++) {
          step(p,{forward:walk?1:0,walk,duck:walk&&(from.duck||to.duck),jumpPressed:!walk&&tick===0},map.boxes,PRESETS.classic);
          if(p.grounded&&p.groundBox===destination){reached=true;break;}
          if(p.y<Math.min(from.top,to.top)-200||(!walk&&tick>4&&p.grounded))break;
        }
        if(reached)break;
      }
      assert.ok(reached,`segment ${i}: (${from.x}, ${from.z}, ${from.top}) → (${to.x}, ${to.z}, ${to.top})`);
    }
  });
}
