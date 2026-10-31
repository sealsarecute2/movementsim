import {hydrateParkourMap} from './parkour-map.js';

export const ROOM_MAP_MAX_BYTES=16*1024*1024;
export const ROOM_MAP_CHUNK_BYTES=8192;
const roomMapHash=/^[a-f0-9]{64}$/;
export function validateRoomMapDescriptor(value){
  if(!value||!roomMapHash.test(value.sha256)||!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>ROOM_MAP_MAX_BYTES||
    typeof value.title!=='string'||!value.title.trim()||value.title.length>80||/[\u0000-\u001f\u007f]/.test(value.title))throw Error('Invalid custom room map.');
  return {sha256:value.sha256,bytes:value.bytes,title:value.title};
}
function roomMapData(map,title){
  let signCount=0,signCharacters=0;
  const box=value=>{
    const result={min:[...value.min],max:[...value.max]};
    if(value.planes)result.planes=value.planes.map(p=>({normal:[...p.normal],distance:p.distance}));
    for(const key of ['checkpoint','finish','obstacle','roof','ladder','signPost','solid','boost'])if(value[key]!==undefined)result[key]=value[key];
    if(value.normal)result.normal=[...value.normal];
    if(value.sign){
      if(typeof value.sign.title!=='string'||value.sign.title.length>120||!Array.isArray(value.sign.lines)||value.sign.lines.length>12||value.sign.lines.some(s=>typeof s!=='string'||s.length>120))throw Error('Invalid custom map sign.');
      signCharacters+=value.sign.title.length+value.sign.lines.reduce((sum,line)=>sum+line.length,0);
      if(++signCount>128||signCharacters>8192)throw Error('Custom map signs contain too much text.');
      result.sign={title:value.sign.title,lines:[...value.sign.lines]};
    }
    return result;
  };
  const result={id:'local-map',title,revision:1,importedGeometry:!!map.importedGeometry,boxes:map.boxes.map(box),spawns:map.spawns.map(p=>Object.fromEntries(['x','y','z','yaw','pitch'].map(k=>[k,p[k]??0]))),
    stages:map.stages.map(stage=>Object.fromEntries(['title','tip','target','resetTarget'].filter(k=>typeof stage[k]==='string').map(k=>[k,stage[k].slice(0,k==='tip'?512:120)]))),
    checkpointPads:[...map.checkpointPads],finishPad:map.finishPad,sectionFalls:[...map.sectionFalls]};
  if(map.finishArea)result.finishArea=box(map.finishArea);
  for(const key of ['portals','boosts','teleports','killboxes','movementEntities'])if(map[key]!==undefined)result[key]=map[key];
  return result;
}
export async function roomMapDigest(bytes,cryptoApi=globalThis.crypto){
  const hash=new Uint8Array(await cryptoApi.subtle.digest('SHA-256',bytes));return [...hash].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function prepareCustomRoomMap(map,title=map.title||'Custom map'){
  title=String(title).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,80)||'Custom map';
  const checked=hydrateParkourMap(structuredClone(roomMapData(map,title))),payload=roomMapData(checked,title),bytes=new TextEncoder().encode(JSON.stringify(payload));
  if(bytes.length>ROOM_MAP_MAX_BYTES)throw Error('The playable room map must be smaller than 16 MB.');
  const descriptor=validateRoomMapDescriptor({title,bytes:bytes.length,sha256:await roomMapDigest(bytes)});
  return {id:'custom-'+descriptor.sha256,revision:1,descriptor,bytes};
}
export async function decodeCustomRoomMap(bytes,descriptor){
  descriptor=validateRoomMapDescriptor(descriptor);
  if(!(bytes instanceof Uint8Array)||bytes.length!==descriptor.bytes||await roomMapDigest(bytes)!==descriptor.sha256)throw Error('The custom map download did not match the host.');
  const decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  const map=hydrateParkourMap(roomMapData(hydrateParkourMap(decoded),descriptor.title));
  map.id='custom-'+descriptor.sha256;map.title=descriptor.title;map.revision=1;return map;
}
export function encodeRoomMapChunk(bytes){return btoa(String.fromCharCode(...bytes));}
export function decodeRoomMapChunk(value){
  if(typeof value!=='string'||value.length>Math.ceil(ROOM_MAP_CHUNK_BYTES/3)*4||!/^[-A-Za-z0-9+/]+={0,2}$/.test(value))throw Error('Invalid map packet.');
  return Uint8Array.from(atob(value),character=>character.charCodeAt(0));
}
