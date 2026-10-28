// Interpret movement entities only; map strings are never executable code.
export function sourceTriggerCrossing(from,to,box,height=72,radius=16) {
  let enter=0,exit=1;
  for(const [axis,key] of ['x','y','z'].entries()) {
    const low=box.min[axis]-(axis===1?height:radius),high=box.max[axis]+(axis===1?0:radius),delta=to[key]-from[key];
    if(Math.abs(delta)<1e-9){if(from[key]<=low||from[key]>=high)return null;}
    else{const a=(low-from[key])/delta,b=(high-from[key])/delta;enter=Math.max(enter,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));if(enter>exit)return null;}
  }
  return {enter,exit};
}

export function createSourceRuntime(map) {
  if(map.greybox)return createParkourRuntime(map);
  const named=new Map();
  for(const e of map.entities)if(e.targetname){if(!named.has(e.targetname))named.set(e.targetname,[]);named.get(e.targetname).push(e);}
  let disabled,time,actorName,pending,inside,cooldown,current,finished;
  const matches=(pattern,value)=>pattern==='*'||pattern===value||pattern.endsWith('*')&&value.startsWith(pattern.slice(0,-1));
  function filter(name,depth=0) {
    if(!name)return true;if(depth>10)return false;
    const e=named.get(name)?.[0];if(!e)return false;
    let pass=false;
    if(e.classname==='filter_activator_name')pass=matches(e.filtername||'',actorName);
    else if(e.classname==='filter_activator_class')pass=matches(e.filterclass||'','player');
    else if(e.classname==='filter_multi'){
      const results=Object.entries(e).filter(([k])=>/^Filter\d+$/i.test(k)).map(([,v])=>filter(v,depth+1));
      pass=e.filtertype==='1'?results.some(Boolean):results.every(Boolean);
    }
    return e.Negated==='1'?!pass:pass;
  }
  function execute(output) {
    const [target,input,parameter]=output.split(/\x1b|,/);
    if(target==='!activator'&&input==='AddOutput'){
      const match=/^targetname\s+(.+)$/i.exec(parameter);if(match)actorName=match[1];
    } else if(input==='Enable'||input==='Disable'){
      for(const e of named.get(target)||[])if(input==='Enable')disabled.delete(e.hammerid);else disabled.add(e.hammerid);
    }
    // Ignore Source console commands, filesystem requests and other inputs.
  }
  function fire(entity,event) {
    for(const output of entity.outputs||[])if(output.event===event) {
      const pieces=output.value.split(/\x1b|,/),delay=Math.max(0,Number(pieces[3])||0);
      if(delay)pending.push({at:time+delay,value:output.value});else execute(output.value);
    }
  }
  function reset(stage=0) {
    disabled=new Set(map.triggers.filter(t=>t.StartDisabled==='1').map(t=>t.hammerid));
    time=0;actorName='';pending=[];inside=new Set();cooldown=0;current=stage;finished=false;
  }
  reset();
  return {reset,get stage(){return current;},get actorName(){return actorName;},
    interact(player) {
      const eye={x:player.x,y:player.y+64,z:player.z},cp=Math.cos(player.pitch);
      const end={x:eye.x+Math.sin(player.yaw)*cp*110,y:eye.y+Math.sin(player.pitch)*110,z:eye.z-Math.cos(player.yaw)*cp*110};
      for(const button of map.buttons)if(sourceTriggerCrossing(eye,end,button,0,0)) {fire(button,'OnDamaged');fire(button,'OnPressed');return true;}
      return false;
    },
    step(player,previous,dt) {
      time+=dt;cooldown=Math.max(0,cooldown-dt);
      const due=pending.filter(p=>p.at<=time);pending=pending.filter(p=>p.at>time);for(const p of due)execute(p.value);
      const touching=new Set(),events=[];
      for(const trigger of map.triggers) {
        if(disabled.has(trigger.hammerid)||!sourceTriggerCrossing(previous,player,trigger,player.ducked?54:72))continue;
        touching.add(trigger.hammerid);
        if(!filter(trigger.filtername))continue;
        if(trigger.classname==='trigger_multiple'){
          if(!inside.has(trigger.hammerid)){fire(trigger,'OnStartTouch');fire(trigger,'OnStartTouchAll');fire(trigger,'OnTrigger');}
        } else if(trigger.classname==='trigger_push'){
          const [pitch,yaw]=(trigger.pushdir||'0 0 0').split(/\s+/).map(v=>Number(v)*Math.PI/180),force=(Number(trigger.speed)||0)*dt;
          player.vx+=Math.cos(pitch)*Math.cos(yaw)*force;player.vy-=Math.sin(pitch)*force;player.vz-=Math.cos(pitch)*Math.sin(yaw)*force;
        } else if(trigger.classname==='trigger_teleport'&&!cooldown){
          const destination=map.destinations.get(trigger.target);
          if(destination){Object.assign(player,destination,{vx:0,vy:0,vz:0,grounded:false,groundBox:null,ladder:null,ducked:false,duckAmount:0});cooldown=.08;actorName='';pending=[];events.push({type:'teleport',target:trigger.target});break;}
        }
      }
      inside=touching;
      for(let i=current+1;i<map.spawns.length;i++){
        const s=map.spawns[i];if(Math.hypot(player.x-s.x,player.z-s.z)<88&&Math.abs(player.y-s.y)<70){current=i;events.push({type:'checkpoint',stage:i});break;}
      }
      if(map.finish&&!finished&&current===map.spawns.length-1&&Math.hypot(player.x-map.finish.x,player.z-map.finish.z)<112&&Math.abs(player.y-map.finish.y)<100){finished=true;events.push({type:'finish'});}
      return events;
    },
  };
}

function createParkourRuntime(map) {
  let current=0,finished=false;
  const activation=(from,to,pad)=>sourceTriggerCrossing(from,to,{min:[pad.min[0],pad.max[1]-.01,pad.min[2]],max:[pad.max[0],pad.max[1]+96,pad.max[2]]},0);
  return {
    get stage(){return current;},
    reset(stage=0){current=Math.max(0,Math.min(map.spawns.length-1,stage));finished=false;},
    interact(){return false;},
    step(player,previous,dt) {
      const events=[];let lastTime=-1;
      while(current+1<map.spawns.length){
        const crossing=activation(previous,player,map.boxes[map.checkpointPads[current+1]]);
        if(!crossing||crossing.enter<lastTime)break;
        lastTime=crossing.enter;events.push({type:'checkpoint',stage:++current});
      }
      if(map.finishPad!==null&&current===map.spawns.length-1&&!finished&&activation(previous,player,map.boxes[map.finishPad])){
        finished=true;events.push({type:'finish'});return events;
      }
      if(player.y<map.sectionFalls[current]){events.push({type:'respawn',stage:current});return events;}
      for(const boost of map.boosts||[])if(sourceTriggerCrossing(previous,player,boost,player.ducked?54:72)){
        const [pitch,yaw]=(boost.pushdir||'0 0 0').split(/\s+/).map(v=>Number(v)*Math.PI/180),force=Number(boost.speed)*dt;
        player.vx+=Math.cos(pitch)*Math.cos(yaw)*force;player.vy-=Math.sin(pitch)*force;player.vz-=Math.cos(pitch)*Math.sin(yaw)*force;
      }
      return events;
    },
  };
}
