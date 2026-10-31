import {MAP_LIST,COMMUNITY_MAPS} from '../dist/course.js';
import {hydrateParkourMap} from '../dist/parkour-map.js';
import lego from '../dist/maps/bhop_lego.json' with {type:'json'};
import kitsune from '../dist/maps/bhop_kitsune.json' with {type:'json'};

const cache=new Map(MAP_LIST.filter(m=>m.timed||m.endless).map(m=>[m.id,m]));
const bundled={bhop_lego:lego,bhop_kitsune:kitsune};
export const VERIFIED_BETA_COURSES=Object.freeze([Object.freeze({map:'bhop-school',revision:1,preset:'classic'})]);
export const betaCourseAllowed=selection=>VERIFIED_BETA_COURSES.some(course=>['map','revision','preset'].every(key=>course[key]===selection[key]));
export function trustedCourse(id){
  if(!cache.has(id)){
    const metadata=COMMUNITY_MAPS.find(m=>m.id===id);
    if(!metadata||!Object.hasOwn(bundled,id))throw Error('unsupported-course');
    const map=hydrateParkourMap(structuredClone(bundled[id]));cache.set(id,{...metadata,boxes:map.boxes,spawns:map.spawns,timed:true});
  }
  return cache.get(id);
}
export function courseSelection(value){
  if(!value||Object.keys(value).some(k=>!['map','preset','slot'].includes(k))||typeof value.map!=='string'||!['classic','practice'].includes(value.preset)||!Number.isInteger(value.slot)||value.slot<0||value.slot>31)throw Error('invalid-selection');
  const map=trustedCourse(value.map);
  return {map:map.id,revision:map.revision||1,preset:value.preset,slot:value.slot};
}
