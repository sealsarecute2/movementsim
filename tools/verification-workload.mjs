// Benchmark fixtures, NOT submitted replay validation. Episodes intentionally
// reset players onto different route surfaces to exercise collision/trigger
// costs without spending most of the benchmark falling into empty space.
import {readFileSync} from 'node:fs';
import {MAP_LIST,COMMUNITY_MAPS} from '../dist/course.js';
import {createEndless} from '../dist/endless.js';
import {createPlayer,step,support,platformAirspace,DT,PRESETS} from '../dist/physics.js';
import {hydrateParkourMap} from '../dist/parkour-map.js';
import {createSourceRuntime} from '../dist/source-runtime.js';

export function benchmarkMaps(){
  const maps=MAP_LIST.filter(m=>m.timed||m.endless);
  for(const metadata of COMMUNITY_MAPS){
    const map=hydrateParkourMap(JSON.parse(readFileSync(new URL('../dist/maps/'+metadata.id+'.json',import.meta.url),'utf8')));
    maps.push({...metadata,boxes:map.boxes,spawns:map.spawns,timed:true});
  }
  return maps;
}
export function makeWorkload(map,preset,{feature='route'}={}){
  let endless=map.endless?createEndless(104729):null,boxes=endless?.boxes||map.boxes;
  const source=boxes.sourceMap,runtime=source?createSourceRuntime(source):null;
  const surfaces=boxes.filter(b=>!b.obstacle&&!b.ladder&&!b.roof&&!b.sign&&!b.signPost);
  const checkpoints=boxes.filter(b=>b.checkpoint||b.finish);
  const ladder=boxes.find(b=>b.ladder),portals=source?.portals||[];
  let player,ticks=0,checkpoint=0,active=false,time=0;
  const coverage={steps:0,airborne:0,grounded:0,landings:0,ladder:0,portals:0,triggers:0};
  function reset(){
    const episode=Math.floor(ticks/256),surface=surfaces[(episode*131)%surfaces.length];
    let spawn={x:(surface.min[0]+surface.max[0])/2,y:surface.max[1],z:(surface.min[2]+surface.max[2])/2,yaw:0};
    if(feature==='ladder'&&ladder)spawn={x:(ladder.min[0]+ladder.max[0])/2,y:ladder.min[1]+24,z:ladder.max[2]+16,yaw:0};
    if(feature==='portal'&&portals.length){
      const portal=portals[episode%portals.length];runtime.reset(portal.from);
      spawn={x:(portal.min[0]+portal.max[0])/2,y:portal.min[1],z:(portal.min[2]+portal.max[2])/2,yaw:0};
    }else runtime?.reset(episode%map.spawns.length);
    player=createPlayer(spawn);player.pitch=feature==='ladder'?.4:0;
    player.vx=feature==='fast'?1600:0;player.vz=feature==='fast'?-1600:0;
    checkpoint=0;active=false;time=0;
  }
  reset();
  return {coverage,
    simulate(input){
      if(ticks%256===0)reset();
      const previous={...player};player.yaw=input.yaw;player.pitch=feature==='ladder'?.4:input.pitch;
      step(player,input,boxes,PRESETS[preset]);ticks++;coverage.steps++;
      if(!player.grounded)coverage.airborne++;else coverage.grounded++;
      if(player.landTime!==previous.landTime)coverage.landings++;
      if(player.ladder)coverage.ladder++;
      if(runtime){
        if(!active&&Math.hypot(player.x-map.spawns[0].x,player.z-map.spawns[0].z)>96)active=true;
        if(active)time+=DT;
        const events=runtime.step(player,previous,DT);coverage.triggers+=events.length;
        coverage.portals+=events.filter(e=>e.type==='portal').length;
      }else{
        if(!active){const crossing=platformAirspace(previous,player,endless?endless.platform(0):boxes[0]);if(!crossing||crossing.exit<1)active=true;}
        if(endless){
          endless.update(player,support(player,boxes,1),previous);boxes=endless.boxes;
        }else{
          const hits=checkpoints.flatMap(box=>{const crossing=platformAirspace(previous,player,box);return crossing?[{box,time:crossing.enter}]:[];}).sort((a,b)=>a.time-b.time);
          for(const hit of hits)if(hit.box.checkpoint===checkpoint+1)checkpoint++;
        }
        if(active)time+=DT;
      }
      // Consume the result and check for invalid numerical state.
      if(![player.x,player.y,player.z,time].every(Number.isFinite))throw Error('Invalid benchmark state');
    },
  };
}
export function benchmarkFrame(tick,feature='route'){
  return {forward:feature==='landing'?0:1,side:feature==='ladder'||feature==='landing'?0:Math.floor(tick/32)%2?1:-1,yaw:feature==='ladder'||feature==='portal'?0:Math.sin(tick*.025)*.35,
    pitch:0,walk:feature==='route'&&tick%256>=224,duck:feature==='route'&&tick%256>=192,
    jumpHeld:feature!=='ladder'&&(feature==='landing'||tick%256>=64),jumpPressed:false};
}
