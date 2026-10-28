// Read original Source 1 maps without rewriting or executing their contents.
// Binary structures: ValveSoftware/source-sdk-2013/src/public/bspfile.h.
import { makeParkourMap } from './parkour-map.js';
const sourceText = new TextDecoder('windows-1252');
const sourcePoint = v => [v[0], v[2], -v[1]];
const sourceVector = s => (s || '0 0 0').trim().split(/\s+/).map(Number);
export function sourceSpawn(entity) {
  const [x,y,z] = sourcePoint(sourceVector(entity.origin));
  const angles = sourceVector(entity.angles);
  return {x,y,z,yaw:(90-angles[1])*Math.PI/180,pitch:-angles[0]*Math.PI/180};
}

export function parseSourceEntities(text) {
  const entities=[];
  for(const block of text.matchAll(/\{([^{}]*)\}/g)) {
    const entity={outputs:[]};
    for(const pair of block[1].matchAll(/"([^"\r\n]+)"\s*"([^"\r\n]*)"/g)) {
      const [,key,value]=pair;
      if(key.startsWith('On'))entity.outputs.push({event:key,value});
      else entity[key]=value;
    }
    entities.push(entity);
  }
  return entities;
}

// ZIP contents stay in memory. Never extract paths or run embedded scripts.
export async function unpackSourceArchive(input) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.length>180*1024*1024)throw Error('Map files must be smaller than 180 MB.');
  if(sourceText.decode(bytes.subarray(0,4))==='VBSP')return bytes;
  const {unzipSync}=await import('./vendor/fflate.module.js');
  let selected=false;
  const files=unzipSync(bytes,{filter:file=>{
    if(!selected&&/\.bsp$/i.test(file.name)) {
      if(file.originalSize>180*1024*1024)throw Error('The map inside this archive is too large.');
      selected=true;return true;
    }
    return false;
  }});
  const map=Object.values(files)[0];
  if(!map)throw Error('Choose a Source .bsp map or a .zip containing one.');
  return map;
}

export async function loadSourceMap(input,options={}) {
  const bytes=await unpackSourceArchive(input);
  const map=parseSourceBsp(bytes,{...options,geometryOnly:true});
  return makeParkourMap(map);
}

export function parseSourceBsp(input,{id='local-map',title='Imported map',entryTarget=null,stageTargets=null,resetTargets=null,exitTargets=null,stageTitles=null,finishTarget='end',geometryOnly=false}={}) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.length<1036||sourceText.decode(bytes.subarray(0,4))!=='VBSP')throw Error('This is not a Source 1 BSP map.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const i32=o=>view.getInt32(o,true),u16=o=>view.getUint16(o,true),i16=o=>view.getInt16(o,true),f32=o=>view.getFloat32(o,true);
  const version=i32(4);
  if(![19,20].includes(version))throw Error('This importer supports Counter-Strike: Source BSP versions 19 and 20.');
  const lumps=Array.from({length:64},(_,i)=>{
    const o=8+i*16,offset=i32(o),length=i32(o+4),version=i32(o+8);
    if(offset<0||length<0||offset+length>bytes.length)throw Error('The BSP contains an invalid section.');
    if(length&&sourceText.decode(bytes.subarray(offset,offset+4))==='LZMA')throw Error('This BSP has compressed sections. Use an uncompressed CS:S release.');
    return {offset,length,version};
  });
  const records=(index,size,read)=>{
    const {offset,length}=lumps[index];
    if(length%size||length/size>1000000)throw Error('The BSP has an unsupported section layout.');
    return Array.from({length:length/size},(_,i)=>read(offset+i*size,i));
  };
  const vec=o=>[f32(o),f32(o+4),f32(o+8)];
  const entities=parseSourceEntities(sourceText.decode(bytes.subarray(lumps[0].offset,lumps[0].offset+lumps[0].length)));
  const planes=records(1,20,o=>({normal:sourcePoint(vec(o)),distance:f32(o+12)}));
  const vertices=records(3,12,o=>vec(o));
  const texinfo=records(6,72,o=>({u:[...vec(o),f32(o+12)],v:[...vec(o+16),f32(o+28)],flags:i32(o+64),material:i32(o+68)}));
  const stringData=bytes.subarray(lumps[43].offset,lumps[43].offset+lumps[43].length);
  const strings=records(44,4,o=>{const start=i32(o);let end=start;while(end<stringData.length&&stringData[end])end++;return sourceText.decode(stringData.subarray(start,end));});
  const materials=records(2,32,o=>({name:strings[i32(o+12)]||'unknown',colour:vec(o).map(v=>Math.max(.12,Math.min(1,Math.sqrt(Math.max(0,v))))),width:i32(o+16)||1,height:i32(o+20)||1}));
  const faces=records(7,56,o=>({plane:u16(o),side:bytes[o+2],first:i32(o+4),count:i16(o+8),texture:i16(o+10)}));
  const edges=records(12,4,o=>[u16(o),u16(o+2)]),surfedges=records(13,4,o=>i32(o));
  const models=records(14,48,o=>({min:sourcePoint(vec(o)),max:sourcePoint(vec(o+12)),head:i32(o+36),first:i32(o+40),count:i32(o+44)}));
  const nodes=records(5,32,o=>[i32(o+4),i32(o+8)]);
  const leaves=records(10,lumps[10].version===0?56:32,o=>({first:u16(o+24),count:u16(o+26)}));
  const leafbrushes=records(17,2,o=>u16(o));
  const sides=records(19,8,o=>u16(o));
  const brushes=records(18,12,o=>({first:i32(o),count:i32(o+4),contents:i32(o+8)}));
  for(const model of models)for(let axis=0;axis<3;axis++)[model.min[axis],model.max[axis]]=[Math.min(model.min[axis],model.max[axis]),Math.max(model.min[axis],model.max[axis])];
  function modelBrushes(index) {
    const found=new Set(),visited=new Set(),pending=[models[index]?.head];
    while(pending.length) {
      const n=pending.pop();if(n===undefined||visited.has(n))continue;visited.add(n);
      if(n<0){const leaf=leaves[-n-1];if(leaf)for(let i=0;i<leaf.count;i++)found.add(leafbrushes[leaf.first+i]);}
      else if(nodes[n])pending.push(...nodes[n]);
    }
    return found;
  }
  function collisionBrush(index,offset=[0,0,0]) {
    const brush=brushes[index];if(!brush||(brush.contents&0x1000b)===0)return null;
    const boundary=sides.slice(brush.first,brush.first+brush.count).map(p=>planes[p]).map(p=>p&&({normal:p.normal,distance:p.distance+p.normal.reduce((sum,n,i)=>sum+n*offset[i],0)}));
    if(boundary.some(p=>!p||!Number.isFinite(p.distance)))throw Error('Invalid collision planes.');
    const min=[-Infinity,-Infinity,-Infinity],max=[Infinity,Infinity,Infinity];
    for(const p of boundary)for(let a=0;a<3;a++)if(Math.abs(Math.abs(p.normal[a])-1)<1e-5&&p.normal.every((n,i)=>i===a||Math.abs(n)<1e-5)) {
      if(p.normal[a]>0)max[a]=Math.min(max[a],p.distance);else min[a]=Math.max(min[a],-p.distance);
    }
    if([...min,...max].some(n=>!Number.isFinite(n))||min.some((n,i)=>n>=max[i]))return null;
    return {min,max,planes:boundary};
  }
  const modelEntities=new Map(entities.filter(e=>/^\*\d+$/.test(e.model||'')).map(e=>[Number(e.model.slice(1)),e]));
  const modelOffset=index=>index?sourcePoint(sourceVector(modelEntities.get(index)?.origin)):[0,0,0];
  const entityBounds=e=>{
    const index=Number(e.model.slice(1)),model=models[index];if(!model)return null;
    const offset=modelOffset(index);return {min:model.min.map((n,i)=>n+offset[i]),max:model.max.map((n,i)=>n+offset[i])};
  };
  const solidModels=new Set([0]);
  for(const [index,e] of modelEntities)if(['func_brush','func_wall','func_button','func_door','func_breakable','func_detail'].includes(e.classname)&&e.StartDisabled!=='1'&&e.Solidity!=='1')solidModels.add(index);
  const boxes=[];for(const index of solidModels)for(const b of modelBrushes(index)){const brush=collisionBrush(b,modelOffset(index));if(brush)boxes.push(brush);}
  if(!boxes.length)throw Error('No supported solid geometry was found in this map.');
  const batches=new Map();
  // Trigger volumes are invisible. Their model geometry must not become walls.
  for(let index=0;!geometryOnly&&index<models.length;index++) {
    const model=models[index],e=modelEntities.get(index),offset=modelOffset(index);
    if(index&&(!e||e.classname.startsWith('trigger_')||e.StartDisabled==='1'))continue;
    if(index&&!solidModels.has(index)&&!['func_illusionary','func_rotating'].includes(e.classname))continue;
    for(let f=model.first;f<model.first+model.count;f++) {
      const face=faces[f],tex=texinfo[face?.texture];
      if(!tex||face.count<3||(tex.flags&(0x80|0x4|0x2))||!materials[tex.material]||/^tools\//i.test(materials[tex.material].name))continue;
      const normal=planes[face.plane]?.normal||[0,1,0];
      const shade=.7+.3*Math.max(0,normal[1]*(face.side?-1:1));
      let batch=batches.get(tex.material);if(!batch)batches.set(tex.material,batch=[]);
      const polygon=[];
      for(let j=0;j<face.count;j++) {
        const edge=surfedges[face.first+j],v=vertices[edges[Math.abs(edge)]?.[edge>=0?0:1]];
        if(!v)throw Error('Invalid map face.');
        polygon.push([...sourcePoint(v).map((n,i)=>n+offset[i]),(v[0]*tex.u[0]+v[1]*tex.u[1]+v[2]*tex.u[2]+tex.u[3])/materials[tex.material].width,(v[0]*tex.v[0]+v[1]*tex.v[1]+v[2]*tex.v[2]+tex.v[3])/materials[tex.material].height,shade]);
      }
      for(let j=1;j<polygon.length-1;j++)batch.push(...polygon[0],...polygon[j],...polygon[j+1]);
    }
  }
  const mesh=[...batches].map(([material,data])=>({material,data:new Float32Array(data)}));
  const destinations=new Map(entities.filter(e=>e.classname==='info_teleport_destination').map(e=>[e.targetname,sourceSpawn(e)]));
  const initial=destinations.get(entryTarget)||sourceSpawn(entities.find(e=>e.classname==='info_player_terrorist'||e.classname==='info_player_start')||{origin:'0 0 0'});
  const targets=stageTargets?.filter(name=>destinations.has(name))||[entryTarget||'start'];
  const spawns=targets.map(name=>({...destinations.get(name)||initial}));
  const stages=targets.map((name,i)=>({title:stageTitles?.[i]||(stageTargets?'Section '+name.toUpperCase():title),tip:'Keep hopping. E returns to your checkpoint. Click nearby boost buttons with the knife.',target:name,...(resetTargets?{resetTarget:resetTargets[i]}:{})}));
  const triggers=entities.filter(e=>e.model&&e.classname.startsWith('trigger_')).flatMap(e=>{
    const bounds=entityBounds(e);return bounds?[{...e,...bounds}]:[];
  });
  const buttons=entities.filter(e=>e.classname==='func_button').flatMap(e=>{const bounds=entityBounds(e);return bounds?[{...e,...bounds}]:[];});
  const pak=bytes.subarray(lumps[40].offset,lumps[40].offset+lumps[40].length);
  const sourceMap={id,title,version,entities,materials,mesh,boxes,spawns,stages,destinations,triggers,buttons,pak,entryTarget,exitTargets,finish:destinations.get(finishTarget),killHeight:Math.min(...boxes.map(b=>b.min[1]))-512};
  boxes.sourceMap=sourceMap;
  // Keep the broadphase near the player; full maps contain thousands of brushes.
  const cells=new Map(),cellSize=512,large=[];
  for(const b of boxes) {
    const x0=Math.floor(b.min[0]/cellSize),x1=Math.floor(b.max[0]/cellSize),z0=Math.floor(b.min[2]/cellSize),z1=Math.floor(b.max[2]/cellSize);
    if((x1-x0+1)*(z1-z0+1)>256){large.push(b);continue;}
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){const key=x+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(b);}
  }
  boxes.nearby=(p,dt=.004)=>{
    const pad=80+Math.max(Math.abs(p.vx),Math.abs(p.vz))*dt*2,found=new Set(large);
    for(let x=Math.floor((p.x-pad)/cellSize);x<=Math.floor((p.x+pad)/cellSize);x++)for(let z=Math.floor((p.z-pad)/cellSize);z<=Math.floor((p.z+pad)/cellSize);z++)for(const b of cells.get(x+','+z)||[])if(p.y+80>=b.min[1]&&p.y+Math.min(0,p.vy*dt)-24<=b.max[1])found.add(b);
    return [...found];
  };
  return sourceMap;
}
