import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MenuMusic,MENU_TRACKS} from '../dist/menu-music.js';
function fixture(options={}) {
 const listeners=new Map(),statuses=[];
 let created=0;
 const audio={paused:true,ended:false,currentTime:0,plays:0,pauses:0,loads:0,
  addEventListener:(name,fn)=>listeners.set(name,fn),
  load(){this.loads++;this.paused=true;this.ended=false;this.currentTime=0;},
  play(){this.plays++;this.paused=false;return this.request?this.request():Promise.resolve();},
  pause(){this.pauses++;this.paused=true;},fire(name){if(name==='ended'){this.ended=true;this.paused=true;}listeners.get(name)?.();},
 };
 const music=new MenuMusic({createAudio:()=>{created++;return audio;},random:()=>0,onStatus:s=>statuses.push(s),...options});
 return {audio,music,statuses,created:()=>created};
}
const settle=async()=>{await Promise.resolve();await Promise.resolve();};
test('music defaults off and creates no media element or downloads in either menu',()=>{
 const f=fixture();f.music.setActive(true,true);f.music.setActive(false,true);f.music.setActive(true,true);
 assert.equal(f.created(),0);assert.equal(f.audio.plays,0);assert.equal(f.audio.loads,0);
});
test('first song is chosen randomly and both songs cycle without immediate repeats',async()=>{
 for(const [random,first] of [[0,0],[.99999,1]]) {
  const f=fixture({random:()=>random});f.music.setActive(true,true);f.music.setEnabled(true);await settle();
  assert.equal(f.music.index,first);assert.equal(f.audio.src,MENU_TRACKS[first].src);
  for(let i=0;i<4;i++){const old=f.music.index;f.audio.fire('ended');await settle();assert.notEqual(f.music.index,old);}
  assert.equal(f.created(),1);assert.equal(f.audio.loop,false);
 }
});
test('runs and focus loss pause rather than mute, and returning to a menu resumes the same song position',async()=>{
 const f=fixture({enabled:true});f.music.setActive(true,true);await settle();f.audio.currentTime=42;
 f.music.setActive(false,true);assert.equal(f.audio.paused,true);assert.equal(f.audio.currentTime,42);
 f.music.setActive(true,true);await settle();assert.equal(f.audio.paused,false);assert.equal(f.audio.currentTime,42);
 f.music.setActive(true,false);assert.equal(f.audio.paused,true);assert.equal(f.audio.currentTime,42);
 const plays=f.audio.plays,loads=f.audio.loads;f.audio.fire('ended');await settle();
 assert.equal(f.audio.plays,plays);assert.equal(f.audio.loads,loads);assert.equal(f.music.index,0);
});
test('enabling music while unfocused creates no player until the window is active',async()=>{
 const f=fixture();f.music.setActive(true,false);f.music.setEnabled(true);assert.equal(f.created(),0);
 f.music.setActive(true,true);await settle();assert.equal(f.audio.plays,1);
});
test('a pending play resolution cannot restart music after blur or disabling',async()=>{
 for(const stop of [m=>m.setActive(true,false),m=>m.setEnabled(false),m=>m.setActive(false,true)]) {
  const f=fixture({enabled:true});let resolve;f.audio.request=()=>new Promise(r=>{resolve=r;});
  f.music.setActive(true,true);assert.equal(f.music.pending,true);stop(f.music);resolve();await settle();
  assert.equal(f.audio.paused,true);assert.equal(f.audio.plays,1);
 }
});
test('stale play failures cannot cancel a newer request when focus returns',async()=>{
 const f=fixture({enabled:true}),rejects=[];f.audio.request=()=>new Promise((resolve,reject)=>rejects.push({resolve,reject}));
 f.music.setActive(true,true);f.music.setActive(true,false);f.music.setActive(true,true);
 rejects[0].reject(Error('aborted'));await settle();assert.equal(f.music.blocked,false);assert.equal(f.music.pending,true);
 rejects[1].resolve();await settle();assert.equal(f.audio.paused,false);assert.equal(f.music.pending,false);
});
test('autoplay rejection waits for a user gesture and can be retried without a duplicate player',async()=>{
 const f=fixture({enabled:true});f.audio.request=()=>Promise.reject(Error('NotAllowedError'));
 f.music.setActive(true,true);await settle();assert.equal(f.music.blocked,true);assert.equal(f.audio.paused,true);
 f.music.setActive(true,true);assert.equal(f.audio.plays,1);
 f.audio.request=()=>Promise.resolve();f.music.retry();await settle();
 assert.equal(f.audio.plays,2);assert.equal(f.created(),1);assert.equal(f.music.blocked,false);
});
test('music volume is independent, bounded, and muting stops progression',async()=>{
 const f=fixture({enabled:true});f.music.setActive(true,true);await settle();
 assert.equal(f.audio.volume,.35);f.audio.currentTime=20;
 f.music.setVolume(.8);assert.equal(f.audio.volume,.8);assert.equal(f.audio.currentTime,20);
 f.music.setVolume(0);assert.equal(f.audio.paused,true);assert.equal(f.audio.currentTime,20);
 f.music.setVolume(3);await settle();assert.equal(f.audio.volume,1);assert.equal(f.audio.paused,false);
 f.music.setVolume(-3);assert.equal(f.audio.volume,0);
});
test('a broken track is skipped without an error retry loop, and background errors never advance the playlist',async()=>{
 const f=fixture({enabled:true});f.music.setActive(true,true);await settle();
 f.audio.fire('error');await settle();assert.equal(f.music.index,1);assert.equal(f.audio.plays,2);
 f.audio.fire('error');await settle();assert.equal(f.audio.plays,2);assert.equal(f.audio.paused,true);
 const background=fixture({enabled:true});background.music.setActive(true,true);await settle();
 background.music.setActive(true,false);background.audio.fire('error');await settle();
 assert.equal(background.music.index,0);assert.equal(background.audio.plays,1);
 background.music.setActive(true,true);await settle();assert.equal(background.music.index,1);
});

test('the two supplied songs are shipped as valid fast-start audio and match their source manifest',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../dist/music/sources.json',import.meta.url)));
 assert.equal(manifest.tracks.length,2);assert.deepEqual(manifest.tracks.map(t=>'music/'+t.file),MENU_TRACKS.map(t=>t.src));
 for(const track of manifest.tracks) {
  const file=readFileSync(new URL('../dist/music/'+track.file,import.meta.url));
  assert.equal(file.subarray(4,8).toString(),'ftyp');assert.ok(file.indexOf('moov')<file.indexOf('mdat'));
  assert.equal(createHash('sha256').update(file).digest('hex'),track.sha256);
  assert.deepEqual(file,readFileSync(new URL('../music/'+track.file,import.meta.url)));
 }
});
