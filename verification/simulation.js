import {createPlayer,step,support,platformAirspace,PRESETS,DT} from '../dist/physics.js';
import {createSourceRuntime} from '../dist/source-runtime.js';
import {createEndless} from '../dist/endless.js';

// Headless, input-only staging simulation. Never accepts client state or scores.
// It follows app.js tick progression; parity tests protect against rule drift.
export class RunSimulation {
  constructor(map,preset,seed=0){
    if(!map||(!map.timed&&!map.endless)||!Object.hasOwn(PRESETS,preset))throw Error('unsupported-course');
    this.map=map;this.mode=PRESETS[preset];this.endless=map.endless?createEndless(seed):null;
    this.boxes=this.endless?.boxes||map.boxes;this.source=this.boxes.sourceMap;
    this.runtime=this.source?createSourceRuntime(this.source):null;
    this.player=createPlayer(this.endless?.spawn||map.spawns[0]);
    this.checkpoint=0;this.time=0;this.active=false;this.completed=false;this.invalid=null;this.ticks=0;
  }
  invalidate(code){this.invalid=code;}
  step(input){
    if(this.invalid||this.completed)return;
    const p=this.player;p.yaw=input.yaw;p.pitch=input.pitch;
    // Bound spatial broad-phase work before it constructs a query window.
    if(Math.max(Math.abs(p.vx),Math.abs(p.vy),Math.abs(p.vz))>65536){this.invalidate('physics-budget');return;}
    const previous={...p};step(p,input,this.boxes,this.mode);this.ticks++;
    if(!['x','y','z','vx','vy','vz'].every(k=>Number.isFinite(p[k]))){this.invalidate('invalid-physics');return;}
    if(this.runtime){
      const first=this.map.spawns[0];
      if(!this.active&&Math.hypot(p.x-first.x,p.z-first.z)>96)this.active=true;
      if(this.active)this.time+=DT;
      for(const event of this.runtime.step(p,previous,DT)){
        if(event.type==='respawn'){this.invalidate('respawn');return;}
        if(event.type==='teleport'){
          const destination=event.destination||this.source.destinations.get(event.target);
          const index=this.map.spawns.findIndex(s=>Math.hypot(s.x-destination.x,s.z-destination.z)<1&&Math.abs(s.y-destination.y)<=18);
          if(this.active&&index>=0&&index<=this.checkpoint){this.invalidate('respawn');return;}
        }
        if(event.type==='checkpoint')this.checkpoint=event.stage;
        if(event.type==='finish'){this.completed=true;return;}
      }
      if(p.y<this.source.killHeight)this.invalidate('respawn');
      return;
    }
    let timerStart=this.active?0:1,timerEnd=1,finished=false;
    if(!this.active){
      const crossing=platformAirspace(previous,p,this.endless?this.endless.platform(0):this.boxes[0]);
      if(!crossing||crossing.enter>0||crossing.exit<1){this.active=true;timerStart=crossing?.enter===0?crossing.exit:0;}
    }
    if(this.endless){
      this.endless.update(p,support(p,this.boxes,1),previous);this.boxes=this.endless.boxes;this.checkpoint=this.endless.checkpoint;
    }
    if(this.map.timed){
      const hits=this.boxes.filter(b=>b.checkpoint||b.finish).flatMap(box=>{
        const crossing=platformAirspace(previous,p,box);return crossing?[{box,time:crossing.enter}]:[];
      }).sort((a,b)=>a.time-b.time);
      for(const {box,time} of hits){
        if(box.checkpoint===this.checkpoint+1)this.checkpoint=box.checkpoint;
        if(box.finish&&this.active&&this.checkpoint===this.map.spawns.length-1){timerEnd=time;finished=true;break;}
      }
    }
    if(this.active)this.time+=DT*Math.max(0,timerEnd-timerStart);
    if(finished){this.completed=true;return;}
    if(p.y<Math.min(...this.boxes.map(b=>b.max[1]))-550)this.invalidate('respawn');
  }
  state(){
    const p=this.player;
    return {ticks:this.ticks,time:this.time,checkpoint:this.checkpoint,completed:this.completed,invalid:this.invalid,
      distance:this.endless?.distance||0,x:p.x,y:p.y,z:p.z-(this.endless?.originZ||0),vx:p.vx,vy:p.vy,vz:p.vz};
  }
}
