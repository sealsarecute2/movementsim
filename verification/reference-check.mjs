import {DT} from '../dist/physics.js';
import {REFERENCE_VERSION,REFERENCE_MAX_TICKS,REFERENCE_MAX_BYTES,REFERENCE_MAPS} from '../dist/reference-run.js';
import {validVerificationFrame} from './limits.js';
import {trustedCourse} from './catalog.js';
import {RunSimulation} from './simulation.js';

const hasKeys=(object,keys)=>object&&typeof object==='object'&&!Array.isArray(object)&&
  Object.keys(object).length===keys.length&&keys.every(key=>Object.hasOwn(object,key));
const sampleKeys=['ticks','time','checkpoint','completed','x','y','z','vx','vy','vz'];
const numericKeys=['time','x','y','z','vx','vy','vz'];
export function parseReference(raw,{resolveCourse=trustedCourse}={}){
  if(typeof raw!=='string'||Buffer.byteLength(raw)>REFERENCE_MAX_BYTES)throw Error('The reference file exceeds the 48 MiB limit.');
  let record;try{record=JSON.parse(raw);}catch{throw Error('The reference file is not valid JSON.');}
  if(!hasKeys(record,['version','map','revision','preset','tickRate','frames','samples'])||record.version!==REFERENCE_VERSION||
    !REFERENCE_MAPS.includes(record.map)||!['classic','practice'].includes(record.preset)||record.tickRate!==1/DT)throw Error('Unsupported reference format, map or physics mode.');
  const map=resolveCourse(record.map);
  if(record.revision!==(map.revision||1))throw Error('The reference uses an older map revision. Record a new run.');
  if(!Array.isArray(record.frames)||record.frames.length<1||record.frames.length>REFERENCE_MAX_TICKS||!record.frames.every(validVerificationFrame))throw Error('The reference contains invalid inputs or exceeds nine minutes.');
  if(!Array.isArray(record.samples)||!record.samples.length||record.samples.length>Math.ceil(record.frames.length/256)+map.spawns.length)throw Error('The reference needs bounded comparison samples and a clean finish.');
  let previousTick=0,previousCheckpoint=0;
  for(const [index,sample] of record.samples.entries()){
    if(!hasKeys(sample,sampleKeys)||!Number.isSafeInteger(sample.ticks)||sample.ticks<=previousTick||sample.ticks>record.frames.length||
      !Number.isInteger(sample.checkpoint)||sample.checkpoint<previousCheckpoint||sample.checkpoint>=map.spawns.length||
      typeof sample.completed!=='boolean'||sample.completed!==(index===record.samples.length-1)||
      !numericKeys.every(key=>Number.isFinite(sample[key]))||sample.time<0||sample.time>record.frames.length*DT)throw Error('Invalid reference comparison samples.');
    previousTick=sample.ticks;previousCheckpoint=sample.checkpoint;
  }
  const final=record.samples.at(-1);
  if(final.ticks!==record.frames.length||final.checkpoint!==map.spawns.length-1)throw Error('The reference must end at the finish after all checkpoints.');
  return {record,map};
}
export function compareReferenceState(actual,expected){
  for(const key of ['ticks','checkpoint','completed'])if(actual[key]!==expected[key])throw Error(`Reference mismatch at tick ${expected.ticks}: ${key} was ${actual[key]}, expected ${expected[key]}.`);
  for(const key of numericKeys){
    const tolerance=key==='time'?1e-9:1e-7;
    if(!Number.isFinite(actual[key])||Math.abs(actual[key]-expected[key])>tolerance)throw Error(`Reference mismatch at tick ${expected.ticks}: ${key} differs by ${Math.abs(actual[key]-expected[key])}.`);
  }
}
export function checkReference(raw,options={}){
  const {record,map}=parseReference(raw,options),simulation=new RunSimulation(map,record.preset);
  let nextSample=0;
  for(const [index,input] of record.frames.entries()){
    simulation.step(input);
    if(simulation.invalid)throw Error(`The verifier rejected the reference at tick ${index+1}: ${simulation.invalid}.`);
    if(simulation.completed&&index!==record.frames.length-1)throw Error(`The verifier finished early at tick ${index+1}.`);
    const sample=record.samples[nextSample];
    if(sample?.ticks===index+1){compareReferenceState(simulation.state(),sample);nextSample++;}
  }
  if(!simulation.completed||nextSample!==record.samples.length)throw Error('The verifier did not complete this reference run.');
  return {record,map,result:{map:record.map,revision:record.revision,preset:record.preset,...simulation.state(),samplesChecked:nextSample,ranked:false}};
}
