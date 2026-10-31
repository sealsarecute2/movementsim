export const DEFAULT_KILL_DROP=2000;
export const isMapSolid=box=>box.solid!==false&&!box.sign&&!box.signPost&&!box.killbox&&!box.teleporter;
const mapFloorCache=new WeakMap();
export function defaultKillHeight(boxes){
  if(!mapFloorCache.has(boxes)){
    let lowest=Infinity;
    for(const box of boxes)if(Number.isFinite(box.min?.[1]))lowest=Math.min(lowest,box.min[1]);
    mapFloorCache.set(boxes,(Number.isFinite(lowest)?lowest:0)-DEFAULT_KILL_DROP);
  }
  return mapFloorCache.get(boxes);
}
