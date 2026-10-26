import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayer,step,speed,accelerate,DT,PRESETS,RULES} from '../dist/physics.js';
import {COURSE} from '../dist/course.js';
const floor={min:[-10000,-120,-10000],max:[10000,0,10000]};
const neutral={forward:0,side:0};
function simulate(p,input,seconds,boxes=[floor],mode=PRESETS.classic) {
  for(let i=0;i<Math.round(seconds/DT);i++) step(p,typeof input==='function'?input(i,p):input,boxes,mode);
  return p;
}
function close(actual,expected,tolerance=0.001) {assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);}
test('run, walk, crouch and normalized diagonal inputs reach their intended speeds',()=>{
  for(const [input,expected] of [[{forward:1},250],[{forward:1,walk:true},130],[{forward:1,duck:true},85],[{forward:1,side:1},250]]) {
    const p=simulate(createPlayer(),input,2);close(speed(p),expected);close(p.y,0);
  }
});
test('air cap limits velocity along wish direction without capping total speed',()=>{
  const p=createPlayer();p.vz=-250;
  for(let i=0;i<60;i++)accelerate(p,1,0,250,12,DT,30);
  close(p.vx,30);close(p.vz,-250);assert.ok(speed(p)>250);
});
test('direction with already-satisfied projected air speed adds no acceleration',()=>{
  const p=createPlayer();p.vz=-250;accelerate(p,0,-1,250,12,DT,30);close(p.vz,-250);
});
test('ground friction stops an idle player; opposite input stops faster',()=>{
  const idle=createPlayer(),counter=createPlayer();idle.vz=counter.vz=-250;
  simulate(idle,neutral,0.1);simulate(counter,{forward:-1},0.1);
  assert.ok(speed(counter)<speed(idle));simulate(idle,neutral,0.5);close(speed(idle),0);
});
test('jump apex and airtime follow the gravity and jump impulse',()=>{
  const p=createPlayer();let apex=0,land=-1;
  for(let i=0;i<240;i++) {
    step(p,{jumpPressed:i===0},[floor]);apex=Math.max(apex,p.y);
    if(i>2&&p.grounded){land=p.time;break;}
  }
  close(apex,RULES.jump**2/(2*RULES.gravity),0.02);close(land,2*RULES.jump/RULES.gravity,DT*2);
});
test('holding Space repeatedly jumps on landing in both presets',()=>{
  for(const mode of Object.values(PRESETS)) {
    const p=simulate(createPlayer(),{jumpHeld:true},2,[floor],mode);
    assert.ok(p.totalJumps>=3,`${mode.title} must jump without repeated key presses`);
    assert.ok(p.hops>=2,`${mode.title} must chain hops on landing`);
  }
});
test('releasing Space stops autojump after the current jump',()=>{
  const p=simulate(createPlayer(),{jumpHeld:true},0.2);
  assert.equal(p.totalJumps,1);
  simulate(p,neutral,2);
  assert.equal(p.totalJumps,1);assert.equal(p.grounded,true);
});
test('a single jump press without holding still jumps only once',()=>{
  const p=simulate(createPlayer(),i=>({jumpPressed:i===0}),2);
  assert.equal(p.totalJumps,1);assert.equal(p.grounded,true);
});
test('jump pressed just before landing produces a clean hop',()=>{
  const p=createPlayer();p.y=2;p.vy=-290;p.grounded=false;p.vz=-250;
  simulate(p,i=>({jumpPressed:i===0}),DT*4);
  assert.equal(p.hops,1);assert.equal(p.totalJumps,1);assert.ok(p.vy>0);close(speed(p),250);
});
test('jump pressed just after landing produces a hop inside the window',()=>{
  const p=createPlayer();p.y=0.5;p.vy=-290;p.grounded=false;
  step(p,neutral,[floor]);assert.equal(p.grounded,true);
  step(p,{jumpPressed:true},[floor]);assert.equal(p.hops,1);assert.ok(p.vy>0);
});
test('missing the landing window applies friction and landing recovery',()=>{
  const p=createPlayer();p.y=1;p.vy=-300;p.vz=-250;p.grounded=false;
  simulate(p,neutral,0.05);assert.ok(speed(p)<250);assert.equal(p.hops,0);
});
test('ordinary bhops limit excess speed while practice preserves it',()=>{
  const a=createPlayer(),b=createPlayer();a.vx=b.vx=500;
  step(a,{jumpPressed:true},[floor],PRESETS.classic);
  step(b,{jumpPressed:true},[floor],PRESETS.practice);
  close(speed(a),275);close(speed(b),500);
});
test('swept hull cannot tunnel through a thin wall at high speed',()=>{
  const wall={min:[-200,0,-100],max:[200,200,-98]};
  const p=createPlayer();p.z=0;p.vz=-5000;p.grounded=false;p.y=30;
  simulate(p,neutral,0.1,[floor,wall],PRESETS.practice);
  assert.ok(p.z>=-82.001);close(p.vz,0);
});
test('wall collision preserves tangential velocity and slides',()=>{
  const wall={min:[100,-100,-1000],max:[110,200,1000]};
  const p=createPlayer();p.x=80;p.y=20;p.vx=300;p.vz=-180;p.grounded=false;
  simulate(p,neutral,0.05,[floor,wall]);close(p.x,84);close(p.vx,0);close(p.vz,-180);assert.ok(p.z<100);
});
test('standing hull hits the underside of a ceiling',()=>{
  const roof={min:[-200,100,-200],max:[200,130,300]};
  const p=createPlayer();let max=0;
  for(let i=0;i<100;i++){step(p,{jumpPressed:i===0},[floor,roof]);max=Math.max(max,p.y);}
  assert.ok(max<=28.001);
});
test('crouch fits a 58-unit tunnel and cannot stand up inside it',()=>{
  const roof={min:[-200,58,-500],max:[200,90,-100]};
  const p=createPlayer();p.z=0;
  simulate(p,{forward:1,duck:true},3,[floor,roof]);assert.ok(p.z<-116);assert.equal(p.ducked,true);
  step(p,neutral,[floor,roof]);assert.equal(p.ducked,true);
  p.z=0;step(p,neutral,[floor,roof]);assert.equal(p.ducked,false);
});
test('step climbing handles 16-unit stairs and blocks 32-unit walls',()=>{
  for(const [height,canPass] of [[16,true],[32,false]]) {
    const stair={min:[-100,-100,-300],max:[100,height,-100]};
    const p=createPlayer();p.z=0;
    simulate(p,{forward:1},0.9,[floor,stair]);
    if(canPass){assert.ok(p.z<-116);close(p.y,16);}else assert.ok(p.z>=-84.001);
  }
});
test('leaving an unsupported platform starts falling',()=>{
  const p=createPlayer();p.z=-390;p.vz=-250;
  simulate(p,{forward:1},0.2,[COURSE[0]]);assert.ok(p.y<0);assert.equal(p.grounded,false);
});
test('a running jump clears the first actual course gap',()=>{
  const p=createPlayer();p.z=-370;p.vz=-250;
  simulate(p,i=>({forward:1,jumpPressed:i===0}),0.78,COURSE);
  close(p.y,0);assert.ok(p.z<-490&&p.z>-660);assert.equal(p.grounded,true);
});
test('timing is independent of how rendering groups fixed steps',()=>{
  const a=createPlayer(),b=createPlayer();const input={forward:1,side:1};
  for(let i=0;i<256;i++)step(a,input,[floor]);
  for(let frame=0;frame<64;frame++)for(let i=0;i<4;i++)step(b,input,[floor]);
  assert.deepEqual(a,b);
});
test('course checkpoint spawns are supported and standing clear',()=>{
  const cps=COURSE.filter(b=>b.checkpoint);
  assert.equal(cps.length,2);assert.equal(COURSE.filter(b=>b.finish).length,1);
  const roof=COURSE.find(b=>b.roof),under=COURSE.find(b=>b.max[1]===48&&b.min[2]<roof.min[2]&&b.max[2]>roof.max[2]);
  assert.ok(roof.min[1]-under.max[1]>=RULES.duckHeight);
  assert.ok(roof.min[1]-under.max[1]<RULES.standHeight);
});
test('every course hop can be cleared with ordinary 250 u/s running jumps',()=>{
  // Launch each jump along a feasible line near the departing platform edge.
  // This checks the actual map geometry against the controller's jump envelope.
  for(let index=0;index<7;index++) {
    const from=COURSE[index],to=COURSE[index+1];
    const destinationX=(to.min[0]+to.max[0])/2;
    const startX=Math.max(from.min[0]+22,Math.min(from.max[0]-22,destinationX));
    const p=createPlayer({x:startX,y:from.max[1],z:from.min[2]+22,yaw:0});
    const targetZ=to.max[2]-50;
    const dx=destinationX-p.x,dz=targetZ-p.z,distance=Math.hypot(dx,dz);
    p.vx=dx/distance*250;p.vz=dz/distance*250;
    p.yaw=Math.atan2(p.vx,-p.vz);
    let landed=false;
    for(let i=0;i<240;i++) {
      step(p,{jumpPressed:i===0},COURSE);
      if(i>10&&p.grounded) {landed=p.groundBox===to;break;}
    }
    assert.ok(landed,`course gap ${index+1} must be clearable`);
  }
});
test('the control section stairs, crouch tunnel, and beam have a connected route',()=>{
  const p=createPlayer({x:300,y:0,z:-2240,yaw:0});
  let reachedTunnel=false,reachedBeam=false;
  for(let i=0;i<2200;i++) {
    const duck=p.z<-2480&&p.z>-2770;
    step(p,{forward:1,duck,walk:p.z<-2770},COURSE);
    if(p.z<-2630&&p.ducked)reachedTunnel=true;
    if(p.z<-2910&&p.grounded&&p.y===48){reachedBeam=true;break;}
    assert.ok(p.y>=-0.01,'control section must not drop the player');
  }
  assert.ok(reachedTunnel);assert.ok(reachedBeam);
});
