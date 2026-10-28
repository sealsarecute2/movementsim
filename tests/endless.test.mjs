import test from 'node:test';
import assert from 'node:assert/strict';
import {reachSegment,routeNode} from './route-driver.mjs';
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
      assert.ok(reachSegment({from:routeNode(source[0]),to:routeNode(destination[0]),boxes:[...source,...destination],destination:destination[0]}),`seed ${seed}, segment ${index}`);
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
test('flying through checkpoint airspace saves a safe respawn, including across coordinate rebases',()=>{
  const route=createEndless(17);
  for(let index=8;index<=80;index+=8) {
    const deck=route.platform(index),x=(deck.min[0]+deck.max[0])/2;
    const previous={x,y:deck.max[1]+80,z:deck.max[2]+40};
    const player=createPlayer({x,y:deck.max[1]+80,z:deck.min[2]-40,yaw:0});
    route.update(player,null,previous);
    assert.equal(route.checkpoint,index/8);
    assert.ok(route.furthestBlock>=index);
    assert.equal(support(createPlayer(route.spawn),route.boxes).endlessIndex,index);
    assert.equal(support(player,route.boxes),undefined,'checkpoint contact is not required');
  }
  const deck=route.platform(88),player=createPlayer({x:(deck.min[0]+deck.max[0])/2,y:deck.max[1]-80,z:(deck.min[2]+deck.max[2])/2,yaw:0});
  route.update(player);
  assert.equal(route.checkpoint,10,'passing below the next checkpoint cannot save it');
});
test('endless keeps twelve varied sections with open stepping stones instead of wall wraps',()=>{
  const route=createEndless(3),names=new Set();let roof=false,beam=false,raised=false,turn=false,ladder=false;
  for(let i=0;i<96;i++) {
    const p=route.platform(i),next=route.platform(i+1);
    const player=createPlayer({x:(p.min[0]+p.max[0])/2,y:p.max[1],z:(p.min[2]+p.max[2])/2,yaw:0});
    route.update(player,p);names.add(route.sectionTitle);
    roof ||= route.geometry(i).some(b=>b.roof);ladder ||= route.geometry(i).some(b=>b.ladder);
    assert.ok(!route.geometry(i).some(b=>b.wrapWall||b.feature==='wrap'));
    beam ||= p.walk&&p.max[0]-p.min[0]<=60;
    raised ||= p.max[1]>0;
    turn ||= p.min[2]+p.max[2]===next.min[2]+next.max[2]&&p.min[0]!==next.min[0];
  }
  assert.equal(names.size,12);assert.ok(names.has('Stepping stones'));assert.equal(names.has('Wall wraps'),false);assert.ok(roof&&beam&&raised&&turn&&ladder);
});

test('standing on decorative roofs cannot corrupt block progress',()=>{
 const route=createEndless(5),wall=route.geometry(2).find(b=>b.roof);
 assert.ok(wall);
 const p=createPlayer({x:(wall.min[0]+wall.max[0])/2,y:wall.max[1],z:(wall.min[2]+wall.max[2])/2,yaw:0});
 route.update(p,wall);assert.ok(Number.isFinite(route.furthestBlock));assert.ok(Number.isFinite(route.checkpoint));
 assert.ok(Number.isFinite(route.distance));assert.ok(route.boxes.length<=60);
});
