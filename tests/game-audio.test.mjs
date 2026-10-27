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
  assert.equal(f.requests.length,7);assert.equal(f.audio.ready,true);assert.equal(f.context.state,'running');
  const preview=fixture({movementEnabled:false});await preview.audio.activate();preview.audio.checkpoint();
  assert.equal(preview.requests.length,0);assert.equal(preview.sources.length,CHECKPOINT_CHIMES.pulse.notes.length);
});
test('a same-tick engine-detected bhop plays only jump, including hard falls and jumps in place',async()=>{
  const f=fixture();await f.audio.activate();await f.audio.loading;
  const before=createPlayer(),jumped={...before,grounded:false,totalJumps:1};
  f.audio.movement(before,jumped,{});
  assert.ok(f.sources.at(-1).buffer.file.endsWith('jump_launch_01.wav'));
  for(const vx of [0,200]) for(const landImpact of [300,900]) {
    const hopped={...jumped,vx,time:1,landTime:1,landImpact,totalJumps:2,jumpFeedback:'CLEAN HOP'};
    const count=f.sources.length;f.audio.movement(jumped,hopped,{jumpHeld:true});
    assert.equal(f.sources.length,count+1);
    assert.ok(f.sources.at(-1).buffer.file.endsWith('jump_launch_01.wav'));
    assert.equal(Math.max(...f.sources.at(-1).output.gain.values),vx===0?.5:.32);
    f.audio.movement(hopped,{...hopped,time:2},{});assert.equal(f.sources.length,count+1,'no delayed landing after a bhop');
  }
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
test('a bhop just after landing cancels the pending landing, including the last tick of the bhop window',async()=>{
  for(const vx of [0,200]) for(const landImpact of [300,900]) for(const delay of [DT,RULES.bhopHalfWindow]) {
    const f=fixture();await f.audio.activate();await f.audio.loading;
    const air={...createPlayer(),vx,grounded:false,time:.9,totalJumps:1};
    const landed={...air,grounded:true,time:1,landTime:1,landImpact};
    f.audio.movement(air,landed,{});assert.equal(f.sources.length,0);
    const hopped={...landed,grounded:false,time:1+delay,totalJumps:2,jumpFeedback:'CLEAN HOP'};
    f.audio.movement(landed,hopped,{jumpPressed:true});
    assert.equal(f.sources.length,1);assert.ok(f.sources[0].buffer.file.endsWith('jump_launch_01.wav'));
    f.audio.movement(hopped,{...hopped,time:1.1},{});assert.equal(f.sources.length,1);
  }
});
test('ordinary landings and hard falls remain audible when the engine does not detect a bhop',async()=>{
  const f=fixture();await f.audio.activate();await f.audio.loading;
  const air={...createPlayer(),grounded:false,time:.9},landed={...air,grounded:true,time:1,landTime:1,landImpact:300};
  f.audio.movement(air,landed,{});f.audio.movement(landed,{...landed,time:1+RULES.bhopHalfWindow+DT},{});
  assert.equal(f.sources.length,1);assert.ok(Math.max(...f.sources[0].output.gain.values)>.4);
  const hardFall={...landed,time:2,landTime:2,landImpact:900};
  f.audio.movement(air,hardFall,{});f.audio.movement(hardFall,{...hardFall,time:2+RULES.bhopHalfWindow+DT},{});
  assert.equal(f.sources.length,2);assert.equal(Math.max(...f.sources.at(-1).output.gain.values),.7);
});
test('pausing or disabling movement audio discards a pending landing rather than playing it later',async()=>{
  for(const stop of [audio=>audio.stopAll(),audio=>{audio.setMovementEnabled(false);audio.setMovementEnabled(true);}]) {
    const f=fixture();await f.audio.activate();await f.audio.loading;
    const air={...createPlayer(),grounded:false,time:.9},landed={...air,grounded:true,time:1,landTime:1,landImpact:300};
    f.audio.movement(air,landed,{});stop(f.audio);
    f.audio.movement(landed,{...landed,time:1.1},{});assert.equal(f.sources.length,0);
  }
});
test('real held-Space physics plays only full-volume takeoffs for clean rebounds in place',async()=>{
  const f=fixture();await f.audio.activate();await f.audio.loading;
  const player=createPlayer(),floor={min:[-1000,-120,-1000],max:[1000,0,1000]},input={jumpHeld:true};
  for(let i=0;i<256*3;i++) {
    const before={...player};step(player,input,[floor],PRESETS.classic);f.audio.movement(before,player,input);
  }
  const jumps=f.sources.filter(s=>s.buffer.file.endsWith('jump_launch_01.wav'));
  const lands=f.sources.filter(s=>s.buffer.file.endsWith('land_concrete_01.wav'));
  assert.ok(jumps.length>=3);assert.ok(jumps.every(s=>Math.max(...s.output.gain.values)===.5));
  assert.equal(lands.length,0);
});
test('real moving bhops play only takeoffs and restore landing sounds when the chain stops',async()=>{
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
  assert.equal(lands.length,0);
  for(let i=0;i<256;i++) {
    const before={...player},released={forward:1};
    step(player,released,[floor],PRESETS.classic);f.audio.movement(before,player,released);
  }
  const finalLands=f.sources.filter(s=>s.buffer.file.endsWith('land_concrete_01.wav'));
  assert.equal(finalLands.length,1);assert.ok(Math.max(...finalLands[0].output.gain.values)>.45);
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
test('fall wind loops once on longer downward falls and grows with falling speed',async()=>{
  const f=fixture();await f.audio.activate();await f.audio.loading;
  const air={...createPlayer(),grounded:false,vy:-400};
  f.audio.movement(air,air,{walk:true,duck:true});
  const wind=f.sources[0];assert.ok(wind.buffer.file.endsWith('fall_wind.wav'));
  assert.equal(wind.loop,true);assert.equal(wind.playbackRate.value,1);assert.equal(wind.stops.length,0);
  const initial=wind.output.gain.values.at(-1);
  for(let i=0;i<100;i++)f.audio.movement(air,{...air,vy:-900},{});
  assert.equal(f.sources.length,1,'a sustained fall must not stack copies of the loop');
  assert.ok(wind.output.gain.values.at(-1)>initial);assert.ok(wind.output.gain.values.at(-1)<=.5);
  assert.equal(f.audio.voices.size,1);
});
test('fall wind stays silent while grounded, rising, near the apex, or making an ordinary jump',async()=>{
  const f=fixture();await f.audio.activate();await f.audio.loading;const p=createPlayer();
  for(const state of [{grounded:true,vy:-900},{grounded:false,vy:300},{grounded:false,vy:0},{grounded:false,vy:-RULES.jump}]) {
    f.audio.movement(p,{...p,...state,vx:2000},{});
  }
  assert.equal(f.sources.length,0);
});
test('landing, rebounding, muting movement and resetting all stop the wind and allow a clean restart',async()=>{
  for(const stop of [
    (f,p)=>f.audio.movement(p,{...p,grounded:true,vy:0},{}),
    (f,p)=>f.audio.movement(p,{...p,vy:RULES.jump,totalJumps:1,jumpFeedback:'CLEAN HOP'},{}),
    f=>f.audio.setMovementEnabled(false),
    f=>f.audio.stopAll(),
  ]) {
    const f=fixture();await f.audio.activate();await f.audio.loading;
    const p={...createPlayer(),grounded:false,vy:-600};f.audio.movement(p,p,{});
    const old=f.audio.fallVoice;stop(f,p);
    assert.equal(f.audio.fallVoice,null);assert.equal(old.source.stops.length,1);
    f.audio.setMovementEnabled(true);f.audio.movement(p,p,{});
    const next=f.audio.fallVoice;assert.ok(next);assert.notEqual(next,old);
    old.source.onended();assert.equal(f.audio.fallVoice,next,'the previous fade-out cannot clear a newer loop');
    f.audio.stopAll();assert.equal(f.audio.voices.size,0);
  }
});
test('real physics starts one wind loop during a long fall and stops it on the landing tick',async()=>{
  const f=fixture();await f.audio.activate();await f.audio.loading;
  const player=createPlayer({x:0,y:1000,z:0,yaw:0}),floor={min:[-1000,-120,-1000],max:[1000,0,1000]};
  player.grounded=false;let landed=false;
  for(let i=0;i<256*3;i++) {
    const before={...player};step(player,{},[floor],PRESETS.classic);f.audio.movement(before,player,{});
    if(player.grounded){landed=true;assert.equal(f.audio.fallVoice,null);break;}
  }
  assert.equal(landed,true);
  const winds=f.sources.filter(s=>s.buffer.file.endsWith('fall_wind.wav'));
  assert.equal(winds.length,1);assert.equal(winds[0].stops.length,1);
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
test('bundled movement WAVs match the CS2 sources and processing hashes recorded in the manifest',()=>{
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
