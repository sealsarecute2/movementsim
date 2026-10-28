// Keep the playable route and use the same simple blocks as the native maps.
// Original teleport-pad footprints identify jumping surfaces, not decorations.
export function makeParkourMap(source) {
  const resetTarget=stage=>stage.resetTarget||stage.target;
  const targets=new Set(source.stages.map(resetTarget)),anchors=[];
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
    const maximum=source.exitTargets?1024:512;
    if(!((width<=maximum&&depth<=maximum)||(Math.min(width,depth)<=96&&Math.max(width,depth)<=2048))||!original.planes.some(p=>p.normal[1]>.999))continue;
    if(source.exitTargets&&source.stages.some((stage,i)=>{
      const spawn=source.spawns[i],exit=source.destinations.get(source.exitTargets[i]);if(!exit)return false;
      const floors=basins.filter(t=>t.target===resetTarget(stage));
      const low=Math.min(...floors.map(t=>t.max[1]),spawn.y-128,exit.y-128);
      return x>=Math.min(spawn.x,exit.x)-240&&x<=Math.max(spawn.x,exit.x)+240&&Math.abs(z-spawn.z)<=600&&original.max[1]>low+.01&&original.max[1]<=spawn.y+64;
    })){addOriginal(original);continue;}
    if(source.exitTargets)continue;
    if(basins.some(t=>{
      const i=source.stages.findIndex(s=>resetTarget(s)===t.target),upper=Math.max(source.spawns[i].y,(source.spawns[i+1]||source.finish||source.spawns[i]).y,...anchors.filter(a=>a.target===t.target).map(a=>a.y))+64;
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
  const portals=(source.exitTargets||[]).slice(0,-1).map((name,from)=>{
    const trigger=source.triggers.find(t=>t.classname==='trigger_teleport'&&t.target===source.stages[from+1].target);
    if(!trigger)throw Error('A stage connection is missing.');
    const pad=blockAt(source.destinations.get(name));pad.label='NEXT STAGE';
    return {from,to:from+1,min:trigger.min,max:trigger.max,pad};
  });
  // Put the starting pad first, matching native timer and preview conventions.
  blocks.splice(blocks.indexOf(checkpointPads[0]),1);blocks.unshift(checkpointPads[0]);
  const sectionFalls=spawns.map((spawn,i)=>Math.min(spawn.y,(portals.length?source.destinations.get(source.exitTargets[i]):spawns[i+1]||source.finish||spawn).y,...anchors.filter(a=>a.target===resetTarget(source.stages[i])).map(a=>a.y))-256);
  const nearEntry=t=>source.exitTargets?source.spawns.findIndex(s=>s.x>=t.min[0]&&s.x<=t.max[0]&&s.z>=t.min[2]&&s.z<=t.max[2]&&Math.abs(s.y-t.min[1])<96):-1;
  const boosts=source.triggers.filter(t=>t.classname==='trigger_push'&&t.StartDisabled!=='1'&&(nearEntry(t)>=0||basins.some(b=>{
    const x=(t.min[0]+t.max[0])/2,z=(t.min[2]+t.max[2])/2;return x>=b.min[0]&&x<=b.max[0]&&z>=b.min[2]&&z<=b.max[2]&&t.min[1]>=b.min[1]&&t.min[1]-b.max[1]<128;
  })))
    .map(t=>{
      const x=(t.min[0]+t.max[0])/2,z=(t.min[2]+t.max[2])/2;
      const basin=basins.find(b=>x>=b.min[0]&&x<=b.max[0]&&z>=b.min[2]&&z<=b.max[2]&&t.min[1]>=b.min[1]&&t.min[1]-b.max[1]<128);
      const entry=nearEntry(t),stage=basin?source.stages.findIndex(s=>resetTarget(s)===basin.target):entry;sectionFalls[stage]=Math.min(sectionFalls[stage],t.min[1]-256);
      return {min:t.min,max:t.max,pushdir:t.pushdir,speed:t.speed,...(entry>=0?{entry:true}:{})};
    });
  for(const boost of boosts)if(!boost.entry){const pad={min:[boost.min[0],boost.min[1]-24,boost.min[2]],max:[boost.max[0],boost.min[1],boost.max[2]],label:'BOOST',boost:true};blocks.push(pad);}
  return hydrateParkourMap({id:source.id,title:source.title,greybox:true,revision:2,boxes:blocks,spawns,stages:source.stages.map(s=>({...s,tip:'Follow the blue checkpoint. E returns to your saved pad. Q restarts the route.'})),
    checkpointPads:checkpointPads.map(b=>blocks.indexOf(b)),finishPad:finishPad?blocks.indexOf(finishPad):null,sectionFalls,boosts,
    ...(portals.length?{portals:portals.map(({pad,...portal})=>({...portal,exitPad:blocks.indexOf(pad)}))}:{})});
}

export function hydrateParkourMap(data) {
  if(!data||!Array.isArray(data.boxes)||!data.boxes.length||!Array.isArray(data.spawns)||data.spawns.length!==data.stages?.length||data.boxes.length>20000)throw Error('Invalid parkour map.');
  for(const box of data.boxes)if(!Array.isArray(box.min)||!Array.isArray(box.max)||box.min.length!==3||box.max.length!==3||!box.min.every((n,i)=>Number.isFinite(n)&&Number.isFinite(box.max[i])&&n<box.max[i]))throw Error('Invalid parkour block.');
  for(const spawn of data.spawns)if(!['x','y','z','yaw'].every(k=>Number.isFinite(spawn[k])))throw Error('Invalid checkpoint spawn.');
  if(!Array.isArray(data.checkpointPads)||data.checkpointPads.length!==data.spawns.length||data.checkpointPads.some(i=>!Number.isInteger(i)||!data.boxes[i])||data.finishPad!==null&&(!Number.isInteger(data.finishPad)||!data.boxes[data.finishPad]))throw Error('Invalid checkpoint platform.');
  if(data.portals&&(!Array.isArray(data.portals)||data.portals.some(p=>!Number.isInteger(p.from)||p.from<0||p.to!==p.from+1||p.to>=data.spawns.length||!Number.isInteger(p.exitPad)||!data.boxes[p.exitPad]||![p.min,p.max].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))||p.min.some((n,i)=>n>=p.max[i]))))throw Error('Invalid stage connection.');
  const map={...data,greybox:true};
  map.boxes.sourceMap=map;
  if(!Array.isArray(map.sectionFalls)||map.sectionFalls.length!==map.spawns.length||!map.sectionFalls.every(Number.isFinite))throw Error('Invalid section reset heights.');
  map.killHeight=Math.min(...map.sectionFalls);
  if(map.boxes.length>800){
    const cells=new Map(),size=512,large=[];
    for(const box of map.boxes){
      const x0=Math.floor(box.min[0]/size),x1=Math.floor(box.max[0]/size),z0=Math.floor(box.min[2]/size),z1=Math.floor(box.max[2]/size);
      if((x1-x0+1)*(z1-z0+1)>256){large.push(box);continue;}
      for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){
        const key=x+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(box);
      }
    }
    map.boxes.nearby=(player,dt=.004)=>{
      const pad=80+Math.max(Math.abs(player.vx||0),Math.abs(player.vz||0))*dt*2,found=new Set(large);
      for(let x=Math.floor((player.x-pad)/size);x<=Math.floor((player.x+pad)/size);x++)for(let z=Math.floor((player.z-pad)/size);z<=Math.floor((player.z+pad)/size);z++)for(const box of cells.get(x+','+z)||[]){
        if(player.y+80>=box.min[1]&&player.y+Math.min(0,(player.vy||0)*dt)-24<=box.max[1])found.add(box);
      }
      return [...found];
    };
  }
  return map;
}
