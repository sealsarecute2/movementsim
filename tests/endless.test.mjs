import test from 'node:test';
import assert from 'node:assert/strict';
import { createEndless } from '../dist/endless.js';
import { createPlayer, step, DT, PRESETS, support } from '../dist/physics.js';

test('endless routes are repeatable for a seed and differ across seeds',()=>{
  const a=createEndless(1),b=createEndless(1),c=createEndless(2);
  assert.deepEqual(a.boxes,b.boxes);assert.notDeepEqual(a.boxes,c.boxes);
  assert.equal(a.boxes.some(b=>b.finish),false);
});
test('every themed section and its joins are traversable with CS-style physics',()=>{
  for(const seed of [0,1,12345,0xffffffff]) {
    const route=createEndless(seed);
    for(let index=1;index<=96;index++) {
      const source=route.geometry(index-1),destination=route.geometry(index);
      const from=source[0],to=destination[0],walk=to.walk;
      const boxes=[...source,...destination];
      const tx=(to.min[0]+to.max[0])/2,tz=(to.min[2]+to.max[2])/2;
      let reached=false;
      for(const margin of walk?[0]:[22,46,70,94,118]) {
        const mx=Math.min(margin,(from.max[0]-from.min[0])/2-4);
        const mz=Math.min(margin,(from.max[2]-from.min[2])/2-4);
        const x=walk?(from.min[0]+from.max[0])/2:Math.max(from.min[0]+mx,Math.min(from.max[0]-mx,tx));
        const z=walk?(from.min[2]+from.max[2])/2:Math.max(from.min[2]+mz,Math.min(from.max[2]-mz,tz));
        const dx=tx-x,dz=tz-z,len=Math.hypot(dx,dz);
        const p=createPlayer({x,y:from.max[1],z,yaw:Math.atan2(dx,-dz)});
        if(!walk){p.vx=dx/len*250;p.vz=dz/len*250;}
        for(let i=0;i<(walk?256*12:256);i++) {
          step(p,{forward:walk?1:0,walk,duck:walk&&(from.duck||to.duck),jumpPressed:!walk&&i===0},boxes,PRESETS.classic,DT);
          if(p.grounded&&p.groundBox===to){reached=true;break;}
          if(!walk&&i>4&&p.grounded)break;
        }
        if(reached)break;
      }
      assert.ok(reached,`seed ${seed}, segment ${index}`);
    }
  }
});
test('endless generation continues over a million units with bounded geometry and precise coordinates',()=>{
  const route=createEndless(17);
  for(let i=1;i<=4096;i++) {
    const ground=route.platform(i);
    const p=createPlayer({x:(ground.min[0]+ground.max[0])/2,y:ground.max[1],z:(ground.min[2]+ground.max[2])/2,yaw:0});
    route.update(p,ground);
    assert.ok(route.boxes.length<=60);
    assert.ok(Math.abs(p.z)<=8192);
    assert.ok(support(p,route.boxes));
    assert.equal(route.boxes.some(b=>b.finish),false);
  }
  assert.equal(route.checkpoint,512);assert.equal(route.furthestBlock,4096);
  assert.equal(route.distance,512*2040);
  assert.ok(route.originZ>1000000);
  const saved=createPlayer(route.spawn);
  assert.equal(support(saved,route.boxes).endlessIndex,4096);
});
test('missed checkpoint decks do not grow memory and the last save can still be restored',()=>{
  const route=createEndless(99),p=createPlayer({x:0,y:0,z:-2500000,yaw:0});
  route.update(p);
  assert.ok(route.boxes.length<=60);assert.equal(route.checkpoint,0);
  const saved=createPlayer(route.spawn);route.update(saved);
  assert.ok(support(saved,route.boxes));assert.ok(route.boxes.length<=60);
  assert.ok(route.distance>=2500000);
});
test('endless includes all eight section types, real roofs, beams, elevation, and right-angle turns',()=>{
  const route=createEndless(3),names=new Set();let roof=false,beam=false,raised=false,turn=false;
  for(let i=0;i<64;i++) {
    const p=route.platform(i),next=route.platform(i+1);
    const player=createPlayer({x:(p.min[0]+p.max[0])/2,y:p.max[1],z:(p.min[2]+p.max[2])/2,yaw:0});
    route.update(player,p);names.add(route.sectionTitle);
    roof ||= route.geometry(i).some(b=>b.roof);
    beam ||= p.walk&&p.max[0]-p.min[0]<=60;
    raised ||= p.max[1]>0;
    turn ||= p.min[2]+p.max[2]===next.min[2]+next.max[2]&&p.min[0]!==next.min[0];
  }
  assert.equal(names.size,8);assert.ok(roof&&beam&&raised&&turn);
});
