import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayer,step,PRESETS,DT,RULES,support} from '../dist/physics.js';
import {MAPS} from '../dist/course.js';
const floor={min:[-300,-120,-300],max:[300,0,300]};
const ladder={min:[-40,0,0],max:[40,400,2],ladder:true,normal:[0,0,1]};
const wall={min:[-48,-120,-96],max:[48,400,0]};
const boxes=[floor,ladder,wall];
function climber(y=100){const p=createPlayer({x:0,y,z:18,yaw:0});p.grounded=false;return p;}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} ≠ ${b}`);
test('a player must move into the front face within the Source two-unit reach to attach',()=>{
 const p=climber();step(p,{},boxes);assert.equal(p.ladder,null);
 step(p,{forward:1},boxes);assert.equal(p.ladder,ladder);near(p.vy,200);
 const distant=climber();distant.z=20.01;step(distant,{forward:1},boxes);assert.equal(distant.ladder,null);
 const away=climber();step(away,{forward:-1},boxes);assert.equal(away.ladder,null);
});
test('a solid obstruction in front of a ladder prevents attachment through it',()=>{
 const p=climber();p.z=20;
 const blocker={min:[-80,0,3],max:[80,400,4]};
 step(p,{forward:1},[floor,ladder,wall,blocker]);assert.equal(p.ladder,null);
});
test('ladder movement projects view-relative input into the face without gravity or inertia',()=>{
 const p=climber();p.vy=-800;p.vx=400;step(p,{forward:1},boxes);
 near(p.vx,0);near(p.vy,200);near(p.vz,0);assert.equal(p.grounded,false);assert.equal(p.landTime,-10);
 const y=p.y;for(let i=0;i<100;i++)step(p,{},boxes);
 near(p.y,y);near(p.vy,0);assert.equal(p.ladder,ladder);
 step(p,{forward:-1},boxes);near(p.vy,-200);
});
test('view pitch contributes to fast climbing and can reverse W into a downward climb',()=>{
 const up=climber();up.pitch=Math.PI/4;step(up,{forward:1},boxes);near(up.vy,Math.SQRT2*200);
 const down=climber();down.pitch=-Math.PI/3;step(down,{forward:1},boxes);near(down.vy,200*(.5-Math.sqrt(3)/2));
 assert.ok(down.vy<0);
});
test('Counter-Strike ladder-plane movement damps lateral drift when pressing into the face',()=>{
 const p=climber();step(p,{forward:1,side:1},boxes);near(p.vx,40);near(p.vy,200);
 const side=climber();step(side,{forward:1},boxes);step(side,{side:1},boxes);near(side.vx,200);near(side.vy,0);
});
test('walk and crouch apply their movement scales on a ladder',()=>{
 for(const [input,expected] of [[{forward:1,walk:true},104],[{forward:1,duck:true},68]]) {
  const p=climber();step(p,input,boxes);near(p.vy,expected);
 }
});
test('Space pushes outward rather than adding a normal jump impulse and prevents immediate regrab',()=>{
 const p=climber();step(p,{forward:1},boxes);
 step(p,{forward:1,jumpPressed:true},boxes);
 assert.equal(p.ladder,null);assert.ok(p.vz>250);assert.ok(p.vy<0);assert.equal(p.totalJumps,1);
 for(let i=0;i<40;i++){p.z=18;step(p,{forward:1},boxes);assert.equal(p.ladder,null);}
 p.time=p.ladderDetachTime;p.z=18;step(p,{forward:1},boxes);assert.equal(p.ladder,ladder);
});
test('holding Space before a ladder catch does not repeatedly kick the player off',()=>{
 const p=climber();p.jumpHeldLast=true;step(p,{forward:1,jumpHeld:true},boxes);
 assert.equal(p.ladder,ladder);assert.equal(p.totalJumps,0);
 for(let i=0;i<50;i++)step(p,{forward:1,jumpHeld:true},boxes);
 assert.equal(p.ladder,ladder);
});
test('moving beyond a ladder edge releases the player into gravity without a snap',()=>{
 const p=climber();step(p,{forward:1},boxes);
 for(let i=0;i<110;i++)step(p,{side:1},boxes);
 assert.equal(p.ladder,null);assert.ok(p.x>56);assert.ok(p.vy<0);
});
test('ladder trigger volumes never act as floors or solid walls',()=>{
 const p=createPlayer({x:0,y:402,z:1,yaw:0});assert.equal(support(p,[ladder]),undefined);
 p.grounded=false;for(let i=0;i<80;i++)step(p,{},[ladder]);assert.ok(p.y<400);assert.equal(p.ladder,null);
});
test('climbing is stable across 64 and 256 simulation ticks per second',()=>{
 for(const dt of [1/64,DT]) {
  const p=climber(20);for(let i=0;i<1/dt;i++)step(p,{forward:1},boxes,PRESETS.classic,dt);
  near(p.y,220);near(p.vy,200);
 }
});
test('all four axis-aligned ladder orientations use the correct outward normal',()=>{
 for(const angle of [0,Math.PI/2,Math.PI,-Math.PI/2]) {
  const c=Math.round(Math.cos(angle)),s=Math.round(Math.sin(angle));
  const transform=v=>[v[0]*c+v[2]*s,v[1],-v[0]*s+v[2]*c];
  const rotate=b=>{
   const a=transform(b.min),d=transform(b.max);
   return {...b,min:a.map((v,i)=>Math.min(v,d[i])),max:a.map((v,i)=>Math.max(v,d[i])),...(b.ladder?{normal:[s,0,c]}:{})};
  };
  const scene=boxes.map(rotate),p=createPlayer({x:18*s,y:100,z:18*c,yaw:-angle});p.grounded=false;
  step(p,{forward:1},scene);assert.equal(p.ladder,scene[1]);near(p.vy,200);
 }
});
test('Vertigo ladder tops are climbed and exited using continuous collision movement',()=>{
 const map=MAPS.skyline;
 for(let i=1;i<map.route.length;i++)if(map.route[i].ladder) {
  const from=map.route[i-1],to=map.route[i],p=createPlayer({x:from.x,y:from.top,z:from.z,yaw:0});
  let arrived=false;
  for(let tick=0;tick<256*10;tick++) {
   const old={...p};p.pitch=p.y<to.top?.5:-.3;step(p,{forward:1},map.boxes);
   assert.ok(Math.abs(p.y-old.y)<4,'ladder exits must not teleport');
   if(p.grounded&&p.groundBox===map.platforms[i]){arrived=true;break;}
  }
  assert.ok(arrived,`tower ending at node ${i}`);assert.equal(p.ladder,null);
 }
});
