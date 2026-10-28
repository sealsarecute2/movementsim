import { BLACK_HOLE_DIRECTION } from './skybox.js';

const unitLight=vector=>{const length=Math.hypot(...vector);return vector.map(n=>n/length);};
const FIXED_LIGHT=unitLight([-.45,.85,.27]);
export function sampleSceneLight(skybox,sky) {
  if(skybox==='blackhole')return {direction:BLACK_HOLE_DIRECTION,colour:[1,.86,.68],ambient:[.31,.32,.39],power:1.05};
  if(skybox!=='cycle')return {direction:FIXED_LIGHT,colour:[1,.97,.91],ambient:[.32,.34,.38],power:.85};
  const daylight=sky.sunDirection[1]>=0,direction=daylight?sky.sunDirection:sky.moonDirection;
  const t=Math.max(0,Math.min(1,direction[1]/.18)),rise=t*t*(3-2*t);
  const mix=Math.max(0,Math.min(1,(sky.sunDirection[1]+.3)/.6)),day=mix*mix*(3-2*mix);
  return {direction,colour:daylight?sky.sun:[.62,.75,1],
    ambient:[.25+.07*day,.28+.06*day,.36+.03*day],power:(daylight?1:.32)*rise};
}

// A small soft circle on the first platform reached by the light ray. Keeping
// the receiver height prevents it appearing through roofs or on lower floors.
export function projectPlayerShadow(player,boxes,light) {
  if(!player||light.power<=.005||light.direction[1]<.04||!['x','y','z'].every(k=>Number.isFinite(player[k])))return null;
  const duck=Math.max(0,Math.min(1,player.duckAmount||0)),sourceY=player.y+28-duck*9;
  let hit=null,nearest=Infinity;
  for(const box of boxes) {
    if(box.ladder||box.max[1]>player.y+.1)continue;
    const gap=Math.max(0,player.y-box.max[1]);
    if(gap>900)continue;
    const distance=(sourceY-box.max[1])/light.direction[1];
    if(distance>=nearest)continue;
    const x=player.x-light.direction[0]*distance,z=player.z-light.direction[2]*distance;
    const radius=19-duck*2+Math.min(24,gap*.065);
    const dx=x-Math.max(box.min[0],Math.min(box.max[0],x)),dz=z-Math.max(box.min[2],Math.min(box.max[2],z));
    if(dx*dx+dz*dz>=radius*radius)continue;
    nearest=distance;
    hit={x,y:box.max[1],z,radius,opacity:.48*Math.min(1,light.power)*Math.exp(-gap/280)};
  }
  return hit;
}
