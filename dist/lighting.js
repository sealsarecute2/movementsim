import { BLACK_HOLE_DIRECTION } from './skybox.js';
import { brushSurface } from './geometry.js';

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

// Keep the soft circle directly under the player on the nearest platform.
// The receiver height prevents it appearing through roofs or on lower floors.
export function projectPlayerShadow(player,boxes,light) {
  if(!player||light.power<=.005||!['x','y','z'].every(k=>Number.isFinite(player[k])))return null;
  const duck=Math.max(0,Math.min(1,player.duckAmount||0)),x=player.x,z=player.z;
  let hit=null,nearest=Infinity;
  for(const box of boxes) {
    if(box.ladder)continue;
    const surface=box.planes?brushSurface(box,x,z,0,0):{height:box.max[1],normal:[0,1,0]};
    if(!surface||surface.height>player.y+.1)continue;
    const gap=Math.max(0,player.y-surface.height);
    if(gap>900||gap>=nearest)continue;
    const radius=19-duck*2+Math.min(24,gap*.065);
    const dx=x-Math.max(box.min[0],Math.min(box.max[0],x)),dz=z-Math.max(box.min[2],Math.min(box.max[2],z));
    if(dx*dx+dz*dz>=radius*radius)continue;
    nearest=gap;
    hit={x,y:surface.height,z,normal:surface.normal,radius,opacity:.48*Math.min(1,light.power)*Math.exp(-gap/280)};
  }
  return hit;
}
