// Keep the playable route and use the same simple blocks as the native maps.
// Original teleport-pad footprints identify jumping surfaces, not decorations.
export function makeParkourMap(source) {
  const targets=new Set(source.stages.map(s=>s.target)),anchors=[];
  for(const trigger of source.triggers) {
    const width=trigger.max[0]-trigger.min[0],depth=trigger.max[2]-trigger.min[2];
    if(trigger.classname==='trigger_teleport'&&targets.has(trigger.target)&&trigger.filtername&&trigger.max[1]-trigger.min[1]<=8&&width<=256&&depth<=256)
      anchors.push({x:(trigger.min[0]+trigger.max[0])/2,y:trigger.min[1],z:(trigger.min[2]+trigger.max[2])/2,target:trigger.target,bounds:trigger});
  }
  const originalToBlock=new Map(),blocks=[];
  const addOriginal=original=>{
    if(originalToBlock.has(original))return originalToBlock.get(original);
    const block={min:[original.min[0],Math.max(original.min[1],original.max[1]-120),original.min[2]],max:[...original.max]};
    blocks.push(block);originalToBlock.set(original,block);return block;
  };
  // Keep stairs, beams and ordinary final-stage platforms too. Their tops sit
  // above the route's failure basins; the basin floor and room shell do not.
  const basins=source.triggers.filter(t=>t.classname==='trigger_teleport'&&!t.filtername&&targets.has(t.target));
  for(const original of source.boxes) {
    const x=(original.min[0]+original.max[0])/2,z=(original.min[2]+original.max[2])/2;
    const width=original.max[0]-original.min[0],depth=original.max[2]-original.min[2];
    if(!((width<=512&&depth<=512)||(Math.min(width,depth)<=96&&Math.max(width,depth)<=2048))||!original.planes.some(p=>p.normal[1]>.999))continue;
    if(basins.some(t=>{
      const i=source.stages.findIndex(s=>s.target===t.target),upper=Math.max(source.spawns[i].y,(source.spawns[i+1]||source.finish||source.spawns[i]).y,...anchors.filter(a=>a.target===t.target).map(a=>a.y))+64;
      return x>=t.min[0]&&x<=t.max[0]&&z>=t.min[2]&&z<=t.max[2]&&original.max[1]>t.max[1]+.01&&original.max[1]<=upper;
    }))addOriginal(original);
  }
  if(!anchors.length&&!basins.length)for(const b of source.boxes)if(b.max[0]-b.min[0]<=1024&&b.max[2]-b.min[2]<=1024&&b.max[1]-b.min[1]<=512&&b.planes.some(p=>p.normal[1]>.999))addOriginal(b);
  function blockAt(point,fallback=null) {
    const candidates=source.boxes.filter(b=>point.x>=b.min[0]-.01&&point.x<=b.max[0]+.01&&point.z>=b.min[2]-.01&&point.z<=b.max[2]+.01&&point.y>=b.max[1]-.1&&point.y-b.max[1]<=32)
      .sort((a,b)=>b.max[1]-a.max[1]||(a.max[0]-a.min[0])*(a.max[2]-a.min[2])-(b.max[0]-b.min[0])*(b.max[2]-b.min[2]));
    const original=candidates[0];
    if(originalToBlock.has(original)&&original)return originalToBlock.get(original);
    let block;
    if(original)return addOriginal(original);
    else if(fallback)block={min:[fallback.min[0],point.y-96,fallback.min[2]],max:[fallback.max[0],point.y,fallback.max[2]]};
    else throw Error('No safe parkour platform was found for a checkpoint.');
    blocks.push(block);return block;
  }
  for(const anchor of anchors)blockAt(anchor,anchor.bounds);
  const checkpointPads=source.spawns.map(spawn=>blockAt(spawn));
  const spawns=source.spawns.map((spawn,i)=>{
    const pad=checkpointPads[i],clamp=(n,a,b)=>Math.max(a+17,Math.min(b-17,n));
    return {...spawn,x:clamp(spawn.x,pad.min[0],pad.max[0]),y:pad.max[1],z:clamp(spawn.z,pad.min[2],pad.max[2]),pitch:0};
  });
  for(const [i,pad] of checkpointPads.entries()){
    if(i)pad.checkpoint=i;
    pad.label=i?'SECTION '+source.stages[i].target.toUpperCase():'START';
  }
  let finishPad=null;
  if(source.finish){finishPad=blockAt(source.finish);finishPad.finish=true;finishPad.label='FINISH';}
  // Put the starting pad first, matching native timer and preview conventions.
  blocks.splice(blocks.indexOf(checkpointPads[0]),1);blocks.unshift(checkpointPads[0]);
  const sectionFalls=spawns.map((spawn,i)=>Math.min(spawn.y,(spawns[i+1]||source.finish||spawn).y,...anchors.filter(a=>a.target===source.stages[i].target).map(a=>a.y))-256);
  const boosts=source.triggers.filter(t=>t.classname==='trigger_push'&&t.StartDisabled!=='1'&&basins.some(b=>{
    const x=(t.min[0]+t.max[0])/2,z=(t.min[2]+t.max[2])/2;return x>=b.min[0]&&x<=b.max[0]&&z>=b.min[2]&&z<=b.max[2]&&t.min[1]>=b.min[1]&&t.min[1]-b.max[1]<128;
  }))
    .map(t=>{
      const x=(t.min[0]+t.max[0])/2,z=(t.min[2]+t.max[2])/2;
      const basin=basins.find(b=>x>=b.min[0]&&x<=b.max[0]&&z>=b.min[2]&&z<=b.max[2]&&t.min[1]>=b.min[1]&&t.min[1]-b.max[1]<128);
      const stage=source.stages.findIndex(s=>s.target===basin.target);sectionFalls[stage]=Math.min(sectionFalls[stage],t.min[1]-256);
      return {min:t.min,max:t.max,pushdir:t.pushdir,speed:t.speed};
    });
  for(const boost of boosts){const pad={min:[boost.min[0],boost.min[1]-24,boost.min[2]],max:[boost.max[0],boost.min[1],boost.max[2]],label:'BOOST',boost:true};blocks.push(pad);}
  return hydrateParkourMap({id:source.id,title:source.title,greybox:true,revision:2,boxes:blocks,spawns,stages:source.stages.map(s=>({...s,tip:'Follow the blue checkpoint. E returns to your saved pad. Q restarts the route.'})),
    checkpointPads:checkpointPads.map(b=>blocks.indexOf(b)),finishPad:finishPad?blocks.indexOf(finishPad):null,sectionFalls,boosts});
}

export function hydrateParkourMap(data) {
  if(!data||!Array.isArray(data.boxes)||!data.boxes.length||!Array.isArray(data.spawns)||data.spawns.length!==data.stages?.length||data.boxes.length>20000)throw Error('Invalid parkour map.');
  for(const box of data.boxes)if(!Array.isArray(box.min)||!Array.isArray(box.max)||box.min.length!==3||box.max.length!==3||!box.min.every((n,i)=>Number.isFinite(n)&&Number.isFinite(box.max[i])&&n<box.max[i]))throw Error('Invalid parkour block.');
  for(const spawn of data.spawns)if(!['x','y','z','yaw'].every(k=>Number.isFinite(spawn[k])))throw Error('Invalid checkpoint spawn.');
  if(!Array.isArray(data.checkpointPads)||data.checkpointPads.length!==data.spawns.length||data.checkpointPads.some(i=>!Number.isInteger(i)||!data.boxes[i])||data.finishPad!==null&&(!Number.isInteger(data.finishPad)||!data.boxes[data.finishPad]))throw Error('Invalid checkpoint platform.');
  const map={...data,greybox:true};
  map.boxes.sourceMap=map;
  if(!Array.isArray(map.sectionFalls)||map.sectionFalls.length!==map.spawns.length||!map.sectionFalls.every(Number.isFinite))throw Error('Invalid section reset heights.');
  map.killHeight=Math.min(...map.sectionFalls);
  return map;
}
