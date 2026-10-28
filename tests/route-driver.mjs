import {createPlayer,step,support,PRESETS,DT,RULES} from '../dist/physics.js';
export const routeNode=b=>({x:(b.min[0]+b.max[0])/2,z:(b.min[2]+b.max[2])/2,top:b.max[1],w:b.max[0]-b.min[0],d:b.max[2]-b.min[2],walk:b.walk,duck:b.duck,ladder:b.feature==='ladder',via:b.feature==='wrap'?[{x:0,z:(b.min[2]+b.max[2])/2+105}]:null});
function clear(p,boxes) {
 const height=p.ducked?RULES.duckHeight:RULES.standHeight;
 return !!support(p,boxes)&&!boxes.some(b=>!b.ladder&&p.x+16>b.min[0]+1e-6&&p.x-16<b.max[0]-1e-6&&p.z+16>b.min[2]+1e-6&&p.z-16<b.max[2]-1e-6&&p.y+height>b.min[1]+1e-6&&p.y<b.max[1]-1e-6);
}
export function reachSegment({from,to,boxes,destination,mode=PRESETS.classic,forceJump=false}) {
 if(to.ladder&&!forceJump) {
  const p=createPlayer({x:from.x,y:from.top,z:from.z,yaw:0});
  for(let tick=0;tick<256*10;tick++) {
   p.pitch=p.y<to.top?.5:-.3;step(p,{forward:1},boxes,mode);
   if(p.grounded&&p.groundBox===destination)return {player:p,tick,kind:'ladder'};
  }
  return null;
 }
 if(to.via&&!forceJump) {
  const sign=Math.sign(to.x-from.x),center=(from.x+to.x)/2;
  for(const zoff of [40,50,58,30])for(const xoff of [20,30,10])for(const initial of [275,250,200]) {
   const p=createPlayer({x:from.x+sign*xoff,y:from.top,z:from.z+zoff,yaw:0});
   if(!clear(p,boxes))continue;
   const waypoints=[{x:center-sign*40,z:to.via[0].z},{x:center+sign*40,z:to.via[0].z},{x:to.x,z:to.z+20}];
   const angle=Math.atan2(waypoints[0].x-p.x,waypoints[0].z-p.z)+sign*20*Math.PI/180;
   p.vx=Math.sin(angle)*initial;p.vz=Math.cos(angle)*initial;let target=0;
   for(let tick=0;tick<350;tick++) {
    const goal=waypoints[target];if(target<2&&Math.hypot(goal.x-p.x,goal.z-p.z)<(mode.airAccelerate>12?16:36))target++;
    const next=waypoints[target],dx=next.x-p.x,dz=next.z-p.z,len=Math.hypot(dx,dz)||1;
    const desired=target===2?Math.min(250,len*8):275;
    p.yaw=Math.atan2(dx/len*desired-p.vx,-(dz/len*desired-p.vz));
    step(p,{forward:1,jumpPressed:tick===0},boxes,mode,DT);
    if(tick>5&&p.grounded) {
     if(p.groundBox===destination)return {player:p,tick,kind:'wrap'};
     break;
    }
    if(p.y<Math.min(from.top,to.top)-200)break;
   }
  }
  return null;
 }
 const walk=!!to.walk&&!forceJump;
 for(const margin of walk?[0]:[4,10,16,22,34,46,70,94,118,-8,-14])for(const velocity of walk?[0]:[250,275,230,210,190,170,150,130]) {
  const mx=Math.min(margin,from.w/2-4),mz=Math.min(margin,from.d/2-4);
  const x=walk?from.x:Math.max(from.x-from.w/2+mx,Math.min(from.x+from.w/2-mx,to.x));
  const z=walk?from.z:Math.max(from.z-from.d/2+mz,Math.min(from.z+from.d/2-mz,to.z));
  const dx=to.x-x,dz=to.z-z,len=Math.hypot(dx,dz)||1,p=createPlayer({x,y:from.top,z,yaw:Math.atan2(dx,-dz)});
  p.ducked=!!(from.duck||to.duck);
  if(!clear(p,boxes))continue;
  if(!walk){p.vx=dx/len*velocity;p.vz=dz/len*velocity;}
  for(let tick=0;tick<256*12;tick++) {
   step(p,{forward:walk?1:0,walk,duck:!!(from.duck||to.duck),jumpPressed:!walk&&tick===0},boxes,mode);
   if(p.grounded&&p.groundBox===destination)return {player:p,tick,kind:walk?'walk':'jump',margin,velocity};
   if(p.y<Math.min(from.top,to.top)-300||(!walk&&tick>4&&p.grounded))break;
  }
 }
 return null;
}
