import { platformAirspace } from './physics.js';

// Each section ends on the same safe deck, so any two section types connect.
// x, z, width, depth, height, walk, crouch. Coordinates are relative to a deck.
const endlessSections = [
  { name: 'Rhythm', tip: 'Hold Space and keep your turns smooth.', nodes: [
    [0,-360,240,240], [45,-600,220,190], [-45,-840,200,180], [60,-1080,220,180],
    [-70,-1320,200,180], [50,-1560,220,180], [0,-1800,200,180] ] },
  { name: 'Zigzags', tip: 'Match A / D to your mouse turn.', nodes: [
    [0,-360,240,240], [-125,-600,180,180], [125,-840,180,180], [-125,-1080,180,180],
    [125,-1320,180,180], [-125,-1560,180,180], [125,-1800,180,180] ] },
  { name: 'Terraces', tip: 'Take off early enough to clear the raised edges.', nodes: [
    [0,-360,240,240], [55,-600,200,180,24], [110,-840,200,180,48], [55,-1080,220,200,72],
    [0,-1320,200,180,48], [-55,-1560,200,180,24], [0,-1800,220,200] ] },
  { name: 'Pillars', tip: 'Use small corrections and aim for the middle.', nodes: [
    [0,-360,240,240], [-50,-600,80,110], [50,-840,80,110], [-50,-1080,80,110],
    [50,-1320,80,110], [-50,-1560,80,110], [50,-1800,80,110] ] },
  { name: 'Beams', tip: 'Release Space. Hold Shift on the thin beams.', nodes: [
    [0,-360,240,240], [0,-690,52,420,0,true], [0,-1020,180,240,0,true],
    [200,-1020,220,52,0,true], [400,-1020,180,180,0,true],
    [400,-1440,48,660,0,true], [400,-1800,180,180,0,true] ] },
  { name: 'Tunnels', tip: 'Release Space and hold Ctrl or C under the roofs.', nodes: [
    [0,-360,240,240], [0,-690,180,420,0,true,true], [0,-1020,240,240,0,true],
    [100,-1260,160,160], [0,-1460,220,240], [0,-1670,160,180,0,true,true],
    [0,-1850,240,180,0,true] ] },
  { name: 'Switchbacks', tip: 'Set your aim for the next straight at each corner.', nodes: [
    [0,-360,240,240], [240,-360,240,240], [480,-360,240,240], [480,-720,240,240],
    [240,-1050,260,240], [0,-1380,260,240], [0,-1710,240,240] ] },
  { name: 'Mixed', tip: 'Jump the terraces, crouch through the tunnel, then land the narrow block.', nodes: [
    [0,-360,240,240], [-100,-610,120,140,24], [0,-860,120,140,48], [100,-1110,240,220,24],
    [100,-1380,160,320,24,true,true], [100,-1630,240,180,24,true], [0,-1840,60,120] ] },
];

// Only nearby geometry is retained. Rebasing keeps long runs precise in WebGL.
export function createEndless(seed = Math.floor(Math.random() * 0x100000000)) {
  seed >>>= 0;
  let originZ = 0, checkpointIndex = 0, furthestBlock = 0, furthestDistance = 0;
  let windowIndex = -1, boxes = [], spawn = { x: 0, y: 0, z: 80, yaw: 0 };
  function random(index, salt) {
    let h = (seed ^ Math.imul(index, 0x45d9f3b) ^ salt) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
  }
  function section(chunk) { return endlessSections[(chunk * 5 + seed % 8) % 8]; }
  function layout(index) {
    if(!index) return { x:0,y:0,z:originZ,width:480,depth:480,walk:false,duck:false };
    const chunk=Math.floor((index-1)/8),local=(index-1)%8;
    const n=local===7?[0,-2040,400,280]:section(chunk).nodes[local];
    const mirror=random(chunk,17)<0.5?-1:1;
    return {x:n[0]*mirror,y:n[4]||0,z:n[1]-chunk*2040+originZ,
      width:n[2],depth:n[3],walk:!!n[5],duck:!!n[6]};
  }
  function platform(index) {
    const p = layout(index), saved = index % 8 === 0;
    return { min: [p.x - p.width / 2, p.y - 120, p.z - p.depth / 2],
      max: [p.x + p.width / 2, p.y, p.z + p.depth / 2], endlessIndex: index,walk:p.walk,duck:p.duck,
      ...(saved ? { checkpoint: index / 8, label: index ? 'CHECKPOINT' : 'ENDLESS / START' } : {}) };
  }
  function geometry(index) {
    const p=platform(index);
    if(!p.duck) return [p];
    return [p,{min:[p.min[0],p.max[1]+58,p.min[2]+40],max:[p.max[0],p.max[1]+84,p.max[2]-40],roof:true}];
  }
  function rebuild(index) {
    const wanted = new Set();
    for (let i = Math.max(0, index - 6); i <= index + 30; i++) wanted.add(i);
    // Keep the saved deck and a small runway ahead even after a missed checkpoint.
    for (let i = Math.max(0, checkpointIndex - 2); i <= checkpointIndex + 6; i++) wanted.add(i);
    boxes = [...wanted].sort((a, b) => a - b).flatMap(geometry);
    windowIndex = index;
  }
  function update(player, ground = null, previous = player) {
    furthestDistance = Math.max(furthestDistance, originZ - player.z);
    let checkpointSaved = false, shift = 0;
    const platforms=boxes.filter(b=>!b.roof&&b.endlessIndex!==ground?.endlessIndex);
    if(ground) platforms.push(ground);
    const hits=platforms.flatMap(box=>{
      const crossing=platformAirspace(previous,player,box);
      return crossing?[{box,time:crossing.enter}]:[];
    }).sort((a,b)=>a.time-b.time);
    for (const {box} of hits) {
      furthestBlock = Math.max(furthestBlock, box.endlessIndex);
      if (box.endlessIndex > checkpointIndex && box.endlessIndex % 8 === 0) {
        checkpointIndex = box.endlessIndex;
        const p = layout(checkpointIndex), next = layout(checkpointIndex + 1);
        const yaw = Math.atan2(next.x - p.x, p.z - next.z);
        spawn = { x: p.x - Math.sin(yaw) * 65, y: p.y, z: p.z + Math.cos(yaw) * 65, yaw };
        checkpointSaved = true;
      }
    }
    if (Math.abs(player.z) > 8192) {
      shift = Math.trunc(player.z / 4096) * 4096;
      player.z -= shift; originZ -= shift; spawn.z -= shift;
    }
    // A spatial estimate based only on z skips the horizontal legs of turns.
    // Use the supported block, or the nearest visible deck while airborne.
    const nearest=ground&&Number.isInteger(ground.endlessIndex)?ground:
      boxes.filter(b=>!b.roof).reduce((best,b)=>{
        const distance=q=>(player.x-(q.min[0]+q.max[0])/2)**2+(player.z-(q.min[2]+q.max[2])/2+shift)**2;
        return !best||distance(b)<distance(best)?b:best;
      },null);
    const index=nearest?.endlessIndex||0;
    const changed = index !== windowIndex || checkpointSaved || shift !== 0;
    if (changed) rebuild(index);
    return { changed, checkpointSaved, shift };
  }
  rebuild(0);
  return { seed, update, platform, geometry,
    get boxes() { return boxes; }, get spawn() { return { ...spawn }; },
    get checkpoint() { return checkpointIndex / 8; },
    get furthestBlock() { return furthestBlock; }, get distance() { return Math.max(0, furthestDistance); },
    get originZ() { return originZ; },
    get sectionTitle() { return section(Math.floor(furthestBlock/8)).name; },
    get tip() { return section(Math.floor(furthestBlock/8)).tip; } };
}
