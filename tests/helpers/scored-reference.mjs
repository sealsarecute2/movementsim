import {readFileSync} from 'node:fs';
import {RunSimulation} from '../../verification/simulation.js';
import {trustedCourse} from '../../verification/catalog.js';
export const scoredReference=JSON.parse(readFileSync(new URL('../fixtures/bhop-school-classic.json',import.meta.url),'utf8'));
export const referenceFrames=scoredReference.groups.flatMap(([ticks,forward,side,yaw,pitch,flags])=>Array.from({length:ticks},()=>({
  forward,side,yaw,pitch,walk:!!(flags&1),duck:!!(flags&2),jumpHeld:!!(flags&4),jumpPressed:!!(flags&8),
})));
export function completedReference(){
  const simulation=new RunSimulation(trustedCourse(scoredReference.map),scoredReference.preset);
  for(const frame of referenceFrames)simulation.step(frame);
  return simulation.state();
}
