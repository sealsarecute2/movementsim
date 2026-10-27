import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { GameAudio, CHECKPOINT_CHIMES, FINISH_CHIME, MOVEMENT_SAMPLES } from '../dist/game-audio.js';
import { createPlayer, step, DT, PRESETS, RULES } from '../dist/physics.js';

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
  const hopped={...jumped,vx:200,time:1,landTime:1,landImpact:300,totalJumps:2,jumpFeedback:'CLEAN HOP'};
  f.audio.movement(jumped,hopped,{jumpHeld:true});
  assert.deepEqual(f.sources.slice(-2).map(s=>s.buffer.file.split('/').at(-1)),['land_concrete_01.wav','jump_launch_01.wav']);
  assert.ok(Math.max(...f.sources.at(-2).output.gain.values)>.3,'bhop landings must remain clearly audible');
  assert.equal(Math.max(...f.sources.at(-1).output.gain.values),.32);
  const count=f.sources.length;f.audio.movement(hopped,{...hopped,time:2},{});assert.equal(f.sources.length,count);
});
test('normal WASD footsteps vary samples, while Shift walking and crouching produce no footsteps',async()=>{
  const f=fixture();await f.audio.activate();await f.audio.loading;
  const before=createPlayer();f.audio.movement(before,{...before,x:100},{});
  const run=f.sources.at(-1);assert.equal(run.kind,'sample');assert.ok(run.output.gain.values.includes(.43));
  f.audio.movement(before,{...before,x:70},{walk:true});
  f.audio.movement(before,{...before,x:300,ducked:true},{});
  f.audio.movement(before,{...before,x:300},{duck:true});
  assert.equal(f.sources.length,1,'neither slow movement mode may play a footstep');
  f.audio.movement(before,{...before,x:100},{});
  assert.notEqual(run.buffer.file,f.sources.at(-1).buffer.file);
  assert.equal(f.sources.at(-1).playbackRate.value,1,'original samples retain their pitch');
  const count=f.sources.length;
  f.audio.movement({...before,grounded:false},{...before,x:300,grounded:false},{});
  f.audio.movement(before,before,{});assert.equal(f.sources.length,count);
  f.audio.setMovementEnabled(false);f.audio.movement(before,{...before,x:100},{});assert.equal(f.sources.length,count);
});
test('silent walking clears accumulated stride distance so releasing Shift does not emit a delayed footstep',async()=>{
  const f=fixture();await f.audio.activate();await f.audio.loading;const p=createPlayer();
  f.audio.movement(p,{...p,x:90},{});assert.equal(f.sources.length,0);
  f.audio.movement(p,{...p,x:100},{walk:true});
  f.audio.movement(p,{...p,x:10},{});assert.equal(f.sources.length,0);
  f.audio.movement(p,{...p,x:85},{});assert.equal(f.sources.length,1);
});
test('a clean hop just after landing softens the pending landing before its full-volume sound starts',async()=>{
  const f=fixture();await f.audio.activate();await f.audio.loading;
  const air={...createPlayer(),vx:200,grounded:false,time:.9,totalJumps:1};
  const landed={...air,grounded:true,time:1,landTime:1,landImpact:300};
  f.audio.movement(air,landed,{});assert.equal(f.sources.length,0);
  const hopped={...landed,grounded:false,time:1+DT,totalJumps:2,jumpFeedback:'CLEAN HOP'};
  f.audio.movement(landed,hopped,{jumpPressed:true});
  assert.equal(f.sources.length,2);assert.ok(f.sources.every(source=>Math.max(...source.output.gain.values)>=.3));
  assert.ok(Math.max(...f.sources[0].output.gain.values)<.2+300/1100,'moving rebounds are softer than ordinary landings');
  f.audio.movement(hopped,{...hopped,time:1.1},{});assert.equal(f.sources.length,2);
});
test('ordinary landings remain audible after the hop window and hard falls are not quieted by rebounding',async()=>{
  const f=fixture();await f.audio.activate();await f.audio.loading;
  const air={...createPlayer(),grounded:false,time:.9},landed={...air,grounded:true,time:1,landTime:1,landImpact:300};
  f.audio.movement(air,landed,{});f.audio.movement(landed,{...landed,time:1+RULES.bhopHalfWindow+DT},{});
  assert.equal(f.sources.length,1);assert.ok(Math.max(...f.sources[0].output.gain.values)>.4);
  f.audio.movement(air,{...landed,grounded:false,landImpact:900,totalJumps:1,jumpFeedback:'CLEAN HOP'},{jumpHeld:true});
  assert.equal(Math.max(...f.sources.at(-2).output.gain.values),.7);
});
test('pausing or disabling movement audio discards a pending landing rather than playing it later',async()=>{
  for(const stop of [audio=>audio.stopAll(),audio=>{audio.setMovementEnabled(false);audio.setMovementEnabled(true);}]) {
    const f=fixture();await f.audio.activate();await f.audio.loading;
    const air={...createPlayer(),grounded:false,time:.9},landed={...air,grounded:true,time:1,landTime:1,landImpact:300};
    f.audio.movement(air,landed,{});stop(f.audio);
    f.audio.movement(landed,{...landed,time:1.1},{});assert.equal(f.sources.length,0);
  }
});
test('real held-Space physics keeps repeated jumps in place and their landings at normal volume',async()=>{
  const f=fixture();await f.audio.activate();await f.audio.loading;
  const player=createPlayer(),floor={min:[-1000,-120,-1000],max:[1000,0,1000]},input={jumpHeld:true};
  for(let i=0;i<256*3;i++) {
    const before={...player};step(player,input,[floor],PRESETS.classic);f.audio.movement(before,player,input);
  }
  const jumps=f.sources.filter(s=>s.buffer.file.endsWith('jump_launch_01.wav'));
  const lands=f.sources.filter(s=>s.buffer.file.endsWith('land_concrete_01.wav'));
  assert.ok(jumps.length>=3);assert.ok(jumps.every(s=>Math.max(...s.output.gain.values)===.5));
  assert.ok(lands.length>=2);assert.ok(lands.every(s=>Math.max(...s.output.gain.values)>.45));
});
test('real moving bhops stay audible with only a modest reduction after the first jump',async()=>{
  const f=fixture();await f.audio.activate();await f.audio.loading;
  const player=createPlayer(),floor={min:[-1000,-120,-3000],max:[1000,0,3000]},input={forward:1,jumpHeld:true};
  player.vz=-240;
  for(let i=0;i<256*3;i++) {
    const before={...player};step(player,input,[floor],PRESETS.classic);f.audio.movement(before,player,input);
  }
  const jumps=f.sources.filter(s=>s.buffer.file.endsWith('jump_launch_01.wav'));
  const lands=f.sources.filter(s=>s.buffer.file.endsWith('land_concrete_01.wav'));
  assert.ok(jumps.length>=3);assert.equal(Math.max(...jumps[0].output.gain.values),.5);
  assert.ok(jumps.slice(1).every(s=>Math.max(...s.output.gain.values)===.32));
  assert.ok(lands.length>=2);assert.ok(lands.every(s=>Math.max(...s.output.gain.values)>=.3&&Math.max(...s.output.gain.values)<.4));
});
test('real normal movement has footsteps, and silent movement modifiers do not mute jumps or landings',async()=>{
  const floor={min:[-1000,-120,-3000],max:[1000,0,3000]};
  for(const modifier of [{},{walk:true},{duck:true}]) {
    const f=fixture();await f.audio.activate();await f.audio.loading;const player=createPlayer();
    for(let i=0;i<256*2;i++) {
      const before={...player};step(player,{forward:1,...modifier},[floor],PRESETS.classic);
      f.audio.movement(before,player,{forward:1,...modifier});
    }
    const steps=f.sources.filter(s=>s.buffer.file.includes('concrete_ct_'));
    assert.equal(steps.length>0,!modifier.walk&&!modifier.duck);
    const standing=createPlayer();
    for(let i=0;i<256;i++) {
      const before={...standing},input={...modifier,jumpPressed:i===0};
      step(standing,input,[floor],PRESETS.classic);f.audio.movement(before,standing,input);
    }
    const jump=f.sources.find(s=>s.buffer.file.endsWith('jump_launch_01.wav'));
    const land=f.sources.find(s=>s.buffer.file.endsWith('land_concrete_01.wav'));
    assert.ok(jump);assert.equal(Math.max(...jump.output.gain.values),.5);
    assert.ok(land);assert.ok(Math.max(...land.output.gain.values)>.45);
  }
});
test('the finish chime is distinct, lasts longer than a checkpoint, and respects the shared volume',async()=>{
  const f=fixture({movementEnabled:false,checkpointSound:'off',volume:.3});await f.audio.activate();
  f.audio.finish();assert.equal(f.sources.length,FINISH_CHIME.notes.length);
  assert.ok(f.sources.at(-1).stops[0]-f.context.currentTime>.7);
  const melody=f.sources.map(source=>source.frequency.values[0]).join(',');
  assert.ok(Object.values(CHECKPOINT_CHIMES).every(chime=>chime.notes.map(note=>note[0]).join(',')!==melody));
  assert.equal(f.audio.master.gain.values.at(-1),.3);f.audio.setVolume(0);assert.equal(f.audio.master.gain.values.at(-1),0);
  f.audio.stopAll();assert.equal(f.audio.voices.size,0);
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
