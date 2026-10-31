import {DT} from './physics.js';

// Opt-in local test fixtures. These files are diagnostic input recordings,
// never proof of a score and never uploaded by normal gameplay.
export const REFERENCE_VERSION=1;
export const REFERENCE_MAX_TICKS=9*60/DT;
export const REFERENCE_MAX_BYTES=48*1024*1024;
export const REFERENCE_MAPS=['course','bhop-school','ladder-run','bhop_lego','bhop_kitsune'];
export function referenceState(player,{time,checkpoint,completed},ticks){
  return {ticks,time,checkpoint,completed,x:player.x,y:player.y,z:player.z,vx:player.vx,vy:player.vy,vz:player.vz};
}
export class ReferenceRunRecorder {
  constructor(map,preset){
    this.map=map.id;this.revision=map.revision||1;this.preset=preset;
    this.frames=[];this.samples=[];this.reason=null;this.complete=false;
  }
  abort(reason){if(!this.reason){this.reason=reason;this.frames=[];this.samples=[];this.complete=false;}}
  input(input){
    if(this.reason||this.complete)return;
    if(this.frames.length>=REFERENCE_MAX_TICKS){this.abort('The recording exceeded nine minutes.');return;}
    this.frames.push({...input});
  }
  observe(player,state){
    if(this.reason||this.complete||!this.frames.length)return;
    if(state.respawns){this.abort('The run used a checkpoint reset.');return;}
    const sample=referenceState(player,state,this.frames.length);
    if(![sample.time,sample.x,sample.y,sample.z,sample.vx,sample.vy,sample.vz].every(Number.isFinite)){
      this.abort('The movement state became invalid.');return;
    }
    if(sample.ticks%256===0||sample.checkpoint!==(this.samples.at(-1)?.checkpoint||0)||sample.completed)this.samples.push(sample);
    this.complete=sample.completed;
  }
  export(){
    if(!this.complete||this.reason)throw Error('Finish a clean run before checking the recording.');
    return {version:REFERENCE_VERSION,map:this.map,revision:this.revision,preset:this.preset,tickRate:1/DT,
      frames:this.frames,samples:this.samples};
  }
}
