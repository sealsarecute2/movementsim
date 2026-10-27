import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { GameAudio, CHECKPOINT_CHIMES, MOVEMENT_SAMPLES } from '../dist/game-audio.js';
import { createPlayer } from '../dist/physics.js';

function fixture(options = {}) {
  const sources=[],requests=[];
  const parameter=()=>({values:[],setValueAtTime(value){this.values.push(value);},linearRampToValueAtTime(value){this.values.push(value);},exponentialRampToValueAtTime(value){this.values.push(value);},setTargetAtTime(value){this.values.push(value);},cancelScheduledValues(){}});
  const context={currentTime:10,state:'suspended',destination:{},async resume(){this.state='running';},
    createGain(){return {gain:parameter(),connect(){},disconnect(){}};},
    createBufferSource(){const source={kind:'sample',playbackRate:{value:1},starts:[],stops:[],connect(gain){this.output=gain;},disconnect(){},start(time){this.starts.push(time);},stop(time){this.stops.push(time);}};sources.push(source);return source;},
    createOscillator(){const source=this.createBufferSource();source.kind='chime';source.frequency=parameter();return source;},
    async decodeAudioData(bytes){return {file:new TextDecoder().decode(bytes),duration:.25};},
  };
  const fetcher=async url=>{requests.push(url);return {ok:true,arrayBuffer:async()=>new TextEncoder().encode(url).buffer};};
  const audio=new GameAudio({context,fetcher,random:()=>0,...options});
  return {audio,context,sources,requests};
}
test('CS2 samples preload once, while checkpoint previews work without movement downloads',async()=>{
  const f=fixture();await f.audio.activate();await f.audio.loading;await f.audio.activate();
  assert.equal(f.requests.length,6);assert.equal(f.audio.ready,true);assert.equal(f.context.state,'running');
  const preview=fixture({movementEnabled:false});await preview.audio.activate();preview.audio.checkpoint();
  assert.equal(preview.requests.length,0);assert.equal(preview.sources.length,CHECKPOINT_CHIMES.pulse.notes.length);
});
test('jump and landing sounds follow physics events, including both events in an automatic bhop',async()=>{
  const f=fixture();await f.audio.activate();await f.audio.loading;
  const before=createPlayer(),jumped={...before,grounded:false,totalJumps:1};
  f.audio.movement(before,jumped,{});
  assert.ok(f.sources.at(-1).buffer.file.endsWith('jump_launch_01.wav'));
  const hopped={...jumped,landTime:1,landImpact:500,totalJumps:2};
  f.audio.movement(jumped,hopped,{jumpHeld:true});
  assert.deepEqual(f.sources.slice(-2).map(s=>s.buffer.file.split('/').at(-1)),['land_concrete_01.wav','jump_launch_01.wav']);
  const count=f.sources.length;f.audio.movement(hopped,{...hopped,time:2},{});assert.equal(f.sources.length,count);
});
test('footsteps depend on grounded travel, vary samples, and are quieter when walking',async()=>{
  const f=fixture();await f.audio.activate();await f.audio.loading;
  const before=createPlayer();f.audio.movement(before,{...before,x:100},{});
  const run=f.sources.at(-1);assert.equal(run.kind,'sample');assert.ok(run.output.gain.values.includes(.43));
  f.audio.movement(before,{...before,x:70},{walk:true});
  const walk=f.sources.at(-1);assert.ok(walk.output.gain.values.includes(.2));assert.notEqual(run.buffer.file,walk.buffer.file);
  assert.equal(walk.playbackRate.value,1,'original samples retain their pitch');
  const count=f.sources.length;
  f.audio.movement({...before,grounded:false},{...before,x:300,grounded:false},{});
  f.audio.movement(before,before,{});assert.equal(f.sources.length,count);
  f.audio.setMovementEnabled(false);f.audio.movement(before,{...before,x:100},{});assert.equal(f.sources.length,count);
});
test('each chime has a distinct melody, Off stays silent, and pausing cancels scheduled voices',async()=>{
  const f=fixture({movementEnabled:false});await f.audio.activate();const melodies=[];
  for(const style of Object.keys(CHECKPOINT_CHIMES)) {
    const start=f.sources.length;f.audio.checkpoint(style);
    melodies.push(f.sources.slice(start).map(s=>s.frequency.values[0]).join(','));
  }
  assert.equal(new Set(melodies).size,3);
  const count=f.sources.length;f.audio.checkpoint('off');f.audio.checkpoint('__proto__');assert.equal(f.sources.length,count);
  f.audio.stopAll();assert.equal(f.audio.voices.size,0);assert.equal(f.audio.stepDistance,0);
  assert.ok(f.sources.every(source=>source.stops.length===2));
});
test('sample failures are reported and a later user activation can retry',async()=>{
  let fail=true,errors=0;
  const f=fixture({fetcher:async()=>({ok:!fail,arrayBuffer:async()=>new ArrayBuffer(0)}),onError:()=>errors++});
  await f.audio.activate();await f.audio.loading;assert.equal(errors,1);assert.equal(f.audio.loading,null);
  fail=false;await f.audio.activate();await f.audio.loading;assert.equal(f.audio.ready,true);
});
test('bundled movement files are the unchanged CS2 samples recorded in the source manifest',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../dist/sounds/sources.json',import.meta.url),'utf8'));
  assert.equal(manifest.creator,'Valve Corporation');
  assert.deepEqual(manifest.samples.map(s=>s.file).sort(),Object.values(MOVEMENT_SAMPLES).flat().sort());
  for(const sample of manifest.samples) {
    const bytes=readFileSync(new URL('../dist/sounds/'+sample.file,import.meta.url));
    assert.equal(bytes.subarray(0,4).toString(),'RIFF');assert.equal(bytes.subarray(8,12).toString(),'WAVE');
    assert.equal(createHash('sha256').update(bytes).digest('hex'),sample.sha256);
    assert.deepEqual(bytes,readFileSync(new URL('../sounds/'+sample.file,import.meta.url)));
  }
});
