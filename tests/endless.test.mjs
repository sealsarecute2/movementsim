import test from 'node:test';
import assert from 'node:assert/strict';
import { createEndless } from '../dist/endless.js';
import { createPlayer, step, DT, PRESETS, support } from '../dist/physics.js';

test('endless routes are repeatable for a seed and differ across seeds',()=>{
  const a=createEndless(1),b=createEndless(1),c=createEndless(2);
  assert.deepEqual(a.boxes,b.boxes);assert.notDeepEqual(a.boxes,c.boxes);
  assert.equal(a.boxes.some(b=>b.finish),false);
});
test('generated gaps are reachable with normal CS-style running jumps',()=>{
  for(const seed of [0,1,12345,0xffffffff]) {
    const route=createEndless(seed);
    for(let index=1;index<=96;index++) {
      const from=route.platform(index-1),to=route.platform(index);
      const tx=(to.min[0]+to.max[0])/2,tz=(to.min[2]+to.max[2])/2;
      let reached=false;
      for(const margin of [22,46,70,94,118]) {
        const mx=Math.min(margin,(from.max[0]-from.min[0])/2-4);
        const mz=Math.min(margin,(from.max[2]-from.min[2])/2-4);
        const x=Math.max(from.min[0]+mx,Math.min(from.max[0]-mx,tx));
        const z=Math.max(from.min[2]+mz,Math.min(from.max[2]-mz,tz));
        const dx=tx-x,dz=tz-z,len=Math.hypot(dx,dz);
        const p=createPlayer({x,y:from.max[1],z,yaw:Math.atan2(dx,-dz)});
        p.vx=dx/len*250;p.vz=dz/len*250;
        for(let i=0;i<256;i++) {
          step(p,{jumpPressed:i===0},[from,to],PRESETS.classic,DT);
          if(p.grounded&&p.groundBox===to){reached=true;break;}
          if(i>4&&p.grounded)break;
        }
        if(reached)break;
      }
      assert.ok(reached,`seed ${seed}, gap ${index}`);
    }
  }
});
test('endless generation continues over a million units with bounded geometry and precise coordinates',()=>{
  const route=createEndless(17);
  for(let i=1;i<=4096;i++) {
    const ground=route.platform(i);
    const p=createPlayer({x:(ground.min[0]+ground.max[0])/2,y:ground.max[1],z:(ground.min[2]+ground.max[2])/2,yaw:0});
    route.update(p,ground);
    assert.ok(route.boxes.length<=46);
    assert.ok(Math.abs(p.z)<=8192);
    assert.ok(support(p,route.boxes));
    assert.equal(route.boxes.some(b=>b.finish),false);
  }
  assert.equal(route.checkpoint,512);assert.equal(route.furthestBlock,4096);
  assert.equal(route.distance,380+4095*250);
  assert.ok(route.originZ>1000000);
  const saved=createPlayer(route.spawn);
  assert.equal(support(saved,route.boxes).endlessIndex,4096);
});
test('missed checkpoint decks do not grow memory and the last save can still be restored',()=>{
  const route=createEndless(99),p=createPlayer({x:0,y:0,z:-2500000,yaw:0});
  route.update(p);
  assert.ok(route.boxes.length<=46);assert.equal(route.checkpoint,0);
  const saved=createPlayer(route.spawn);route.update(saved);
  assert.ok(support(saved,route.boxes));assert.ok(route.boxes.length<=46);
  assert.ok(route.distance>=2500000);
});
