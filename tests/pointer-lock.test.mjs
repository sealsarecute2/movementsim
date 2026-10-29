import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as physics from '../dist/physics.js';
import * as course from '../dist/course.js';
import * as endlessModule from '../dist/endless.js';
import { verticalFov, projectWorldPoint } from '../dist/renderer.js';
import * as audioModule from '../dist/game-audio.js';
import * as leaderboardModule from '../dist/leaderboard.js';
import * as skyboxModule from '../dist/skybox.js';
import * as menuModule from '../dist/menu.js';
import * as musicModule from '../dist/menu-music.js';
import * as sourceRuntimeModule from '../dist/source-runtime.js';
import * as parkourModule from '../dist/parkour-map.js';
import * as multiplayerModule from '../dist/multiplayer.js';
import { MULTIPLAYER_CONFIG } from '../dist/multiplayer-config.js';
const markup=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
const elementIds=new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));

// Exercise the real app event handlers with a browser API test double. Rendering
// is stubbed here; these checks verify input, run progression and pause behavior.
function boot(stored = {}, search = '', renderError = null, sourceOptions = {}) {
  function element() {
    const listeners=new Map(),classes=new Set();
    return {dataset:{},setAttribute(name,value){this[name]=value;},textContent:'',innerHTML:'',style:{setProperty(name,value){this[name]=value;}},disabled:false,
      classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),
        contains:k=>classes.has(k),toggle:(k,on)=>on?classes.add(k):classes.delete(k)},
      addEventListener:(name,fn)=>listeners.set(name,fn),
      fire:(name,event={})=>listeners.get(name)?.(event),focus(){},
      showModal(){this.open=true;},close(){this.open=false;this.fire('close');}};
  }
  const elements=new Map(),document=element(),window=element();
  window.location={search};
  document.getElementById=id=>{
    if(!elementIds.has(id)&&![...elements.values()].some(e=>e.innerHTML.includes(`id="${id}"`)))return null;
    if(!elements.has(id))elements.set(id,element());
    return elements.get(id);
  };
  document.querySelectorAll=()=>[];document.body=element();document.pointerLockElement=null;document.hidden=false;document.hasFocus=()=>true;
  const canvas=document.getElementById('world');let requests=0,lastCamera,lastTarget,lastFov,lastSkybox,lastShaders,lastShadowCaster,lastRemotePlayers;
  canvas.requestPointerLock=()=>{requests++;};
  document.exitPointerLock=()=>{document.pointerLockElement=null;document.fire('pointerlockchange');};
  const storage=new Map(Object.entries(stored));
  const musicAudio={paused:true,ended:false,currentTime:0,plays:0,loads:0,pauses:0,
    addEventListener(){},load(){this.loads++;this.paused=true;this.currentTime=0;this.ended=false;},
    play(){this.plays++;this.paused=false;return Promise.resolve();},pause(){this.pauses++;this.paused=true;}};
  class TestMenuMusic extends musicModule.MenuMusic {constructor(options){super({...options,createAudio:()=>musicAudio});}}
  const session=sourceOptions.session||new Map();
  const context=vm.createContext({...physics,...course,...endlessModule,...audioModule,...leaderboardModule,...skyboxModule,...menuModule,...musicModule,...sourceRuntimeModule,...parkourModule,...multiplayerModule,MULTIPLAYER_CONFIG,projectWorldPoint,MenuMusic:TestMenuMusic,document,window,
    AbortController,fetch:sourceOptions.fetch,loadSourceMap:sourceOptions.load,crypto:globalThis.crypto,
    RTCPeerConnection:sourceOptions.RTCPeerConnection,MultiplayerRoom:sourceOptions.RoomClass||multiplayerModule.MultiplayerRoom,
    sessionStorage:{getItem:key=>session.get(key)||null,setItem:(key,value)=>session.set(key,value),removeItem:key=>session.delete(key)},
    performance:{now:()=>0},URLSearchParams,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    requestAnimationFrame(){},createRenderer:()=>{if(renderError)throw new Error(renderError);return {setBoxes(){},setSkybox(value){lastSkybox=value;},setShaders(value){lastShaders=value;},draw(p,fov,target,caster,remotes){lastCamera=p;lastFov=fov;lastTarget=target;lastShadowCaster=caster;lastRemotePlayers=remotes;}};}});
  const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
  vm.runInContext(source,context);
  return {context,document,window,canvas,musicAudio,element:id=>document.getElementById(id),
    requests:()=>requests,camera:()=>lastCamera,target:()=>lastTarget,fov:()=>lastFov,skybox:()=>lastSkybox,shaders:()=>lastShaders,shadowCaster:()=>lastShadowCaster,remotePlayers:()=>lastRemotePlayers,read:source=>vm.runInContext(source,context),storage,session,
    lock(){document.pointerLockElement=canvas;document.fire('pointerlockchange');}};
}
class AppRoom {
 constructor(options){this.options=options;this.active=false;this.busy=false;this.status='';this.code='ABCDEFGHJKLM';this.ping=42.4;}
 async start({host,name,course:selection}){
  this.host=host;this.slot=host?0:1;this.course=host?selection:{id:'bhop_kitsune',revision:3,preset:'practice'};this.name=name;
  this.busy=true;if(!host)await this.options.onCourse(this.course);
  this.active=true;this.status='Connected';this.options.onChange();
 }
 leave(){this.active=false;this.busy=false;this.status='Left room';this.options.onChange();}
 roster(){return [{id:'self',name:this.name,slot:this.host?0:1,host:this.host,self:true,ping:this.host?null:this.ping},
  {id:'other',name:'<Seal>',slot:this.host?1:0,host:!this.host,self:false,ping:33,state:{time:12,paused:false}}];}
 remotePlayers(){return [{x:0,y:0,z:-100,yaw:0,pitch:0,duckAmount:0,name:'<Seal>',slot:1}];}
}
const roomAppOptions={RoomClass:AppRoom,RTCPeerConnection:function(){}};
test('the multiplayer menu opens without starting a connection and leaves solo play available',()=>{
 const app=boot();app.element('open-rooms').fire('click');
 assert.equal(app.read('mainView'),'rooms');assert.equal(app.read('room'),null);
 assert.equal(app.element('rooms-view').classList.contains('hidden'),false);assert.equal(app.element('home-view').classList.contains('hidden'),true);
 assert.match(app.element('room-map').innerHTML,/bhop_kitsune/);assert.ok(!app.element('room-map').innerHTML.includes('local-map'));
 app.element('rooms-back').fire('click');app.element('play').fire('click');assert.equal(app.requests(),1);
});
test('a hosted Endless room shares its seed, locks map changes, and renders visual players with ping in the roster',async()=>{
 const app=boot({},'',null,roomAppOptions);app.element('room-map').value='endless';app.element('room-preset').value='practice';app.element('room-name').value='Host';
 await app.context.startRoom(true);
 assert.equal(app.read('map'),'endless');assert.equal(app.read('preset'),'practice');assert.equal(app.read('endless.seed'),app.read('room.course.seed'));
 assert.equal(app.element('network-ping').textContent,'HOST');assert.match(app.element('room-players').innerHTML,/33 ms/);assert.match(app.element('room-players').innerHTML,/&lt;Seal&gt;/);
 assert.equal(app.element('room-session').classList.contains('hidden'),false);assert.equal(app.element('import-source-map').disabled,true);
 const seed=app.read('endless.seed');app.read("chooseMap('course');choosePreset('classic');reset()");assert.equal(app.read('map'),'endless');assert.equal(app.read('preset'),'practice');assert.equal(app.read('endless.seed'),seed);
 app.element('room-play').fire('click');app.lock();const length=app.read('boxes.length');app.context.frame(0);
 assert.equal(app.remotePlayers().length,1);assert.equal(app.read('boxes.length'),length);
 app.window.fire('pagehide');assert.equal(app.read('room.active'),false);assert.equal(app.element('network-hud').classList.contains('hidden'),true);
});
test('joining applies the host community map and mode before allowing play, and shows measured ping',async()=>{
 const geometry=JSON.parse(readFileSync(new URL('../dist/maps/bhop_kitsune.json',import.meta.url),'utf8'));
 const app=boot({},'',null,{...roomAppOptions,fetch:async()=>({ok:true,json:async()=>geometry})});
 try{
  app.element('room-name').value='Guest';app.element('room-code-input').value='ABCD-EFGH-JKLM';await app.context.startRoom(false);
  assert.equal(app.read('map'),'bhop_kitsune');assert.equal(app.read('preset'),'practice');assert.equal(app.read('checkpoint'),0);
  const spawn=multiplayerModule.roomPlayerSpawn(geometry.spawns[0],1,geometry.boxes);
  assert.equal(app.read('player.x'),spawn.x);assert.equal(app.read('player.z'),spawn.z);
  assert.equal(app.element('network-ping').textContent,'42 ms');assert.equal(app.element('room-code').textContent,'ABCD-EFGH-JKLM');
  app.element('room-play').fire('click');assert.equal(app.requests(),1);
  app.element('room-leave').fire('click');app.read("chooseMap('course')");assert.equal(app.read('map'),'course');assert.equal(app.element('import-source-map').disabled,false);
 }finally{delete course.MAPS.bhop_kitsune;}
});
test('multiplayer restarts and checkpoint returns use each assigned spot, and leaving restores solo spawns',async()=>{
 const app=boot({},'',null,roomAppOptions);await app.context.startRoom(true);
 for(let slot=0;slot<4;slot++){
  app.read(`room.slot=${slot};reset()`);
  let spawn=multiplayerModule.roomPlayerSpawn(course.MAPS.course.spawns[0],slot,course.MAPS.course.boxes);
  assert.equal(app.read('player.x'),spawn.x);assert.equal(app.read('player.z'),spawn.z);
  app.read('checkpoint=1;reset(false)');spawn=multiplayerModule.roomPlayerSpawn(course.MAPS.course.spawns[1],slot,course.MAPS.course.boxes);
  assert.equal(app.read('checkpoint'),1);assert.equal(app.read('player.x'),spawn.x);assert.equal(app.read('player.z'),spawn.z);
 }
 app.element('room-leave').fire('click');app.read('reset()');
 assert.equal(app.read('player.x'),course.MAPS.course.spawns[0].x);assert.equal(app.read('player.z'),course.MAPS.course.spawns[0].z);
});
test('an invalid invite gives a useful error and does not disable solo play or retry',async()=>{
 const app=boot({},'',null,{RTCPeerConnection:function(){}});app.element('room-code-input').value='short';await app.context.startRoom(false);
 assert.match(app.element('room-status').textContent,/12-character/);assert.equal(app.element('room-join').disabled,false);assert.equal(app.read('room.busy'),false);
 app.element('play').fire('click');assert.equal(app.requests(),1);
});
test('cancelling a room while its community map downloads prevents a late map switch',async()=>{
 let resolve;const geometry=JSON.parse(readFileSync(new URL('../dist/maps/bhop_kitsune.json',import.meta.url),'utf8'));
 const app=boot({},'',null,{...roomAppOptions,fetch:()=>new Promise(r=>{resolve=r;})});
 const request=app.context.startRoom(false);await new Promise(r=>setImmediate(r));
 assert.equal(app.read('roomApplyingCourse'),true);app.element('room-leave').fire('click');app.read("chooseMap('free')");
 resolve({ok:true,json:async()=>geometry});await request;
 assert.equal(app.read('map'),'free');assert.equal(app.read('room.active'),false);assert.equal(app.read('roomApplyingCourse'),false);
});
test('Enter waits for capture, then mouse movement looks without dragging',()=>{
  const app=boot();app.element('play').fire('click');
  assert.equal(app.requests(),1);
  assert.equal(app.document.body.classList.contains('playing'),false);
  assert.equal(app.element('play').disabled,true);
  app.lock();
  assert.equal(app.document.body.classList.contains('playing'),true);
  assert.equal(app.element('overlay').classList.contains('hidden'),true);
  app.document.fire('mousemove',{movementX:100,movementY:0});
  app.context.frame(16);
  assert.ok(app.camera().yaw>0.07,'captured mouse movement must turn the camera without a pressed button');
});
test('Esc releases capture and pauses; resume captures again',()=>{
  const app=boot();app.element('play').fire('click');app.lock();
  app.document.fire('keydown',{code:'Escape'});
  assert.equal(app.document.pointerLockElement,null);
  assert.equal(app.document.body.classList.contains('playing'),false);
  assert.equal(app.element('overlay').classList.contains('hidden'),false);
  app.element('play').fire('click');app.lock();
  assert.equal(app.requests(),2);assert.equal(app.document.body.classList.contains('playing'),true);
});
test('capture rejection keeps the menu usable and permits retry',async()=>{
  const app=boot();app.canvas.requestPointerLock=()=>Promise.reject(new Error('blocked'));
  app.element('play').fire('click');await Promise.resolve();
  assert.equal(app.element('play').disabled,false);
  assert.equal(app.document.body.classList.contains('playing'),false);
  assert.equal(app.element('overlay').classList.contains('hidden'),false);
  assert.match(app.element('input-note').textContent,/blocked/);
  app.canvas.requestPointerLock=()=>{};app.element('play').fire('click');app.lock();
  assert.equal(app.document.body.classList.contains('playing'),true);
});
test('losing focus cancels a pending capture and a late grant cannot start play',()=>{
  const app=boot();app.element('play').fire('click');app.window.fire('blur');app.lock();
  assert.equal(app.document.pointerLockElement,null);
  assert.equal(app.document.body.classList.contains('playing'),false);
  assert.equal(app.element('play').disabled,false);
});
test('selecting Starter resets the run and renders its sections and spawn',()=>{
 const app=boot();assert.match(app.element('map-grid').innerHTML,/Starter course/);
 assert.ok(!/Deadpoint|Overdrive|Vertigo/.test(app.element('map-grid').innerHTML));
 app.read("runTime=30;checkpoint=2;keys.add('Space')");
 app.element('map-grid').fire('click',{target:{closest:()=>({dataset:{map:'course'}})}});
 assert.equal(app.read('map'),'course');assert.equal(app.read('runTime'),0);assert.equal(app.read('checkpoint'),0);
 assert.equal(app.read('keys.size'),0);assert.equal(app.element('progress-count').textContent,'01 / 03');
 assert.equal(app.read('player.z'),course.MAPS.course.spawns[0].z);
});

test('all course checkpoints work in order and respawn on the active course',()=>{
  for(const map of course.MAP_LIST.filter(m=>m.timed)) {
    const app=boot();app.read(`chooseMap('${map.id}')`);
    for(let cp=1;cp<map.spawns.length;cp++) {
      app.read(`player=createPlayer(MAPS[map].spawns[${cp}]);tick()`);
      assert.equal(app.read('checkpoint'),cp,`${map.title} checkpoint ${cp}`);
      app.read('player.y=-2000;tick()');
      assert.equal(app.read('player.y'),map.spawns[cp].y);
      assert.equal(app.read('player.x'),map.spawns[cp].x);
    }
    const end=map.boxes.find(b=>b.finish);
    app.read(`player=createPlayer({x:${(end.min[0]+end.max[0])/2},y:${end.max[1]},z:${(end.min[2]+end.max[2])/2},yaw:0});tick()`);
    assert.equal(app.read('completed'),true,`${map.title} must finish after its last checkpoint`);
  }
});
test('skipping Starter checkpoints cannot complete the course',()=>{
 const app=boot();app.read('player=createPlayer(MAPS.course.spawns[2]);tick()');
 assert.equal(app.read('checkpoint'),0);
 app.read('var end=boxes.find(b=>b.finish);player=createPlayer({x:(end.min[0]+end.max[0])/2,y:end.max[1],z:(end.min[2]+end.max[2])/2,yaw:0});tick()');
 assert.equal(app.read('completed'),false);
});

test('Starter bests are separate per preset and retain original single-course records',()=>{
 const app=boot({'movement-lab-bests-v1':JSON.stringify({classic:20})});
 assert.equal(app.element('best').textContent,'00:20.000');app.read('runTime=12;finishRun()');
 app.read("choosePreset('practice');runTime=9;finishRun()");
 const bests=JSON.parse(app.storage.get('movement-lab-bests-v1'));
 assert.equal(bests['course:classic'],12);assert.equal(bests['course:practice'],9);
 app.read("choosePreset('classic')");assert.equal(app.element('best').textContent,'00:12.000');
 app.read("chooseMap('free')");assert.equal(app.element('best').textContent,'—');
});

test('removed saved maps and course URLs fall back to Starter without breaking play',()=>{
 const app=boot({'movement-lab-settings-v1':JSON.stringify({map:'skyline'})},'?course=circuit');
 assert.equal(app.read('map'),'course');assert.equal(app.read('player.y'),course.MAPS.course.spawns[0].y);
 assert.equal(app.element('next-course'),null);app.element('play').fire('click');app.lock();
 assert.equal(app.read('playing'),true);
});

test('every course is selectable and starts without requiring a previous completion',()=>{
  for(const map of course.MAP_LIST.filter(m=>m.timed)) {
    const app=boot();
    assert.ok(app.element('map-grid').innerHTML.includes(`data-map="${map.id}"`));
    assert.ok(!app.element('map-grid').innerHTML.includes('disabled'));
    app.element('map-grid').fire('click',{target:{closest:()=>({dataset:{map:map.id}})}});
    app.element('play').fire('click');app.lock();
    assert.equal(app.read('playing'),true,map.title);
    app.read("keys.add('KeyW');for(let i=0;i<64;i++)tick()");
    assert.equal(app.read('runTime'),0,`${map.title}: moving on the start platform must not start the timer`);
    assert.ok(app.read('speed(player)')>0,map.title);
  }
});
test('jumping above the starting platform is untimed; leaving its airspace starts timing at the edge',()=>{
  for(const map of course.MAP_LIST.filter(m=>m.timed||m.endless)) {
    const app=boot();app.read(`chooseMap('${map.id}');pendingJump=true;for(let i=0;i<30;i++)tick()`);
    assert.equal(app.read('runTime'),0,map.title);
    assert.equal(app.read('runActive'),false,map.title);
    assert.equal(app.read('player.grounded'),false,map.title);
    app.read('var startBox=endless?endless.platform(0):boxes[0];player=createPlayer({x:startBox.max[0]+RULES.radius-0.5,y:startBox.max[1]+80,z:(startBox.min[2]+startBox.max[2])/2,yaw:0});player.grounded=false;player.vx=256;tick()');
    assert.equal(app.read('runActive'),true,map.title);
    assert.ok(Math.abs(app.read('runTime')-physics.DT/2)<1e-9,map.title);
    app.read('player.x=(startBox.min[0]+startBox.max[0])/2;player.vx=0;tick()');
    assert.ok(Math.abs(app.read('runTime')-physics.DT*1.5)<1e-9,'returning to the start cannot reset a running timer');
    app.read('reset()');assert.equal(app.read('runTime'),0);assert.equal(app.read('runActive'),false);
  }
});
test('every timed course saves checkpoints and finishes while the player is airborne above the platforms',()=>{
  for(const map of course.MAP_LIST.filter(m=>m.timed)) {
    const app=boot();app.read(`chooseMap('${map.id}')`);
    for(let cp=1;cp<map.spawns.length;cp++) {
      const spawn=map.spawns[cp];
      app.read(`player=createPlayer({x:${spawn.x},y:${spawn.y+80},z:${spawn.z},yaw:0});tick()`);
      assert.equal(app.read('player.grounded'),false,map.title);
      assert.equal(app.read('checkpoint'),cp,`${map.title}: airborne checkpoint ${cp}`);
      app.read('reset(false)');
      assert.equal(app.read('player.y'),spawn.y,'the saved respawn is still on the platform');
    }
    const end=map.boxes.find(b=>b.finish);
    app.read(`player=createPlayer({x:${(end.min[0]+end.max[0])/2},y:${end.max[1]+80},z:${(end.min[2]+end.max[2])/2},yaw:0});tick()`);
    assert.equal(app.read('completed'),true,map.title);
    assert.equal(app.read('player.grounded'),false,map.title);
    const time=app.read('runTime');app.context.frame(2000);
    assert.equal(app.read('runTime'),time,'the finish freezes the timer');
  }
});
test('flying below a checkpoint or skipping airborne checkpoints does not advance the course',()=>{
  const app=boot();
  app.read('var first=boxes.find(b=>b.checkpoint===1);player=createPlayer({x:(first.min[0]+first.max[0])/2,y:first.max[1]-80,z:(first.min[2]+first.max[2])/2,yaw:0});tick()');
  assert.equal(app.read('checkpoint'),0);
  app.read('var last=boxes.find(b=>b.checkpoint===2);player=createPlayer({x:(last.min[0]+last.max[0])/2,y:last.max[1]+80,z:(last.min[2]+last.max[2])/2,yaw:0});tick()');
  assert.equal(app.read('checkpoint'),0);
  app.read('var end=boxes.find(b=>b.finish);player=createPlayer({x:(end.min[0]+end.max[0])/2,y:end.max[1]+80,z:(end.min[2]+end.max[2])/2,yaw:0});tick()');
  assert.equal(app.read('completed'),false);
});
test('a fast airborne pass triggers checkpoints in path order and stops timing at the finish entry',()=>{
  const app=boot();
  app.read(`boxes=[boxes[0],{min:[-10,-120,-10],max:[10,0,10],checkpoint:1},{min:[80,-120,-10],max:[100,0,10],checkpoint:2},{min:[180,-120,-10],max:[200,0,10],finish:true}];runActive=true;runTime=10;player=createPlayer({x:-100,y:80,z:0,yaw:0});player.grounded=false;player.vx=102400;tick()`);
  assert.equal(app.read('checkpoint'),2);
  assert.equal(app.read('completed'),true);
  assert.equal(app.read('player.x'),300);
  assert.ok(Math.abs(app.read('runTime')-(10+physics.DT*(180-physics.RULES.radius+100)/400))<1e-9);
});
test('endless checkpoints save in the bottom right, respawn safely, and retain distance records',()=>{
  const app=boot();app.read("chooseMap('endless')");
  for(const index of [8,16,24,32,40]) {
    app.read(`{const b=endless.platform(${index});player=createPlayer({x:(b.min[0]+b.max[0])/2,y:b.max[1],z:(b.min[2]+b.max[2])/2,yaw:0});tick()}`);
    assert.equal(app.read('checkpoint'),index/8);
    assert.equal(app.element('toast').classList.contains('checkpoint-notice'),true);
    assert.match(app.element('toast').textContent,/SAVED/);
    app.read('player.y=-2000;tick()');
    assert.equal(app.read('player.y'),app.read('endless.spawn.y'));
    assert.equal(app.read('player.z'),app.read('endless.spawn.z'));
    assert.equal(app.read('completed'),false);
  }
  assert.equal(app.element('best-label').textContent,'BEST DISTANCE');
  assert.ok(JSON.parse(app.storage.get('movement-lab-bests-v1'))['endless:v3:classic']>9000);
  app.read('reset()');
  assert.equal(app.read('checkpoint'),0);assert.equal(app.read('endless.distance'),0);
  assert.equal(app.read('runTime'),0);
});
test('the dedicated Endless button starts play directly and the Endless link overrides the saved course',()=>{
  const app=boot();app.element('play-endless').fire('click');
  assert.equal(app.read('map'),'endless');assert.equal(app.requests(),1);
  app.lock();assert.equal(app.read('playing'),true);
  app.read('runTime=12;pause()');app.element('continue').fire('click');app.lock();
  assert.equal(app.read('runTime'),12,'Continue resumes the paused endless run');
  const linked=boot({'movement-lab-settings-v1':JSON.stringify({map:'skyline'})},'?course=endless');
  assert.equal(linked.read('map'),'endless');
  const invalid=boot({},'?course=invalid');assert.equal(invalid.read('map'),'course');
});
test('the published entry page contains the complete build and visible Endless button',()=>{
  const entry=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const standalone=readFileSync(new URL('../movement-lab.html',import.meta.url),'utf8');
  assert.equal(entry,standalone);
  assert.match(entry,/<button id="play-endless"[^>]*>[\s\S]*?<strong>ENDLESS<\/strong>/);
  assert.match(entry,/<div id="map-grid"/);
  assert.ok(!/<script[^>]+src=/.test(entry),'the entry point must not combine separately cached app modules');
  const script=entry.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  new vm.Script(script);
});

test('the knife draws during play, hides on pause, and equips again on restart',()=>{
  const app=boot();
  app.read('var knifeCalls=[];knife={equip(){knifeCalls.push("equip")},draw(dt){knifeCalls.push(dt)},audio:{activate(){},setMuted(){}}}');
  app.element('play').fire('click');app.lock();app.context.frame(16);
  assert.equal(app.read('knifeCalls.filter(x=>x==="equip").length'),1);
  assert.ok(app.read('knifeCalls.some(x=>typeof x==="number"&&x>0)'));
  app.read('reset()');
  assert.equal(app.read('knifeCalls.filter(x=>x==="equip").length'),2);
  app.read('pause()');assert.equal(app.read('knifeCalls.at(-1)'),0);
  app.element('play').fire('click');app.lock();
  assert.equal(app.read('knifeCalls.filter(x=>x==="equip").length'),2,'resuming preserves the paused animation');
});

test('knife visibility and sounds save without changing course or movement settings',()=>{
  const app=boot({'movement-lab-settings-v1':JSON.stringify({map:'endless',knifeEnabled:false,knifeSounds:false})});
  assert.equal(app.element('knife-enabled').checked,false);
  assert.equal(app.element('knife-sounds').checked,false);
  assert.equal(app.element('knife-status').textContent,'Knife hidden');
  app.read('var muted=[];knife={equip(){},draw(){},audio:{setMuted(value){muted.push(value)},activate(){}}}');
  app.element('knife-enabled').checked=true;app.element('knife-enabled').fire('change');
  app.element('knife-sounds').checked=true;app.element('knife-sounds').fire('change');
  assert.equal(app.read('muted.at(-1)'),false);
  const stored=JSON.parse(app.storage.get('movement-lab-settings-v1'));
  assert.equal(stored.map,'endless');assert.equal(stored.knifeEnabled,true);assert.equal(stored.knifeSounds,true);
  app.element('knife-enabled').checked=false;app.element('knife-enabled').fire('change');
  assert.equal(app.element('knife-status').textContent,'Knife hidden');
});
test("the new 1x default turns 50% faster, and sensitivity multipliers persist without repeated migration",()=>{
  const app=boot();app.element('play').fire('click');app.lock();
  assert.equal(app.element('sensitivity-value').textContent,'1.00×');
  const initial=app.read('player.yaw');
  app.document.fire('mousemove',{movementX:100,movementY:0});
  const delta=app.read('player.yaw')-initial;
  assert.ok(Math.abs(delta/(100*2*.022*Math.PI/180)-1.5)<1e-9);
  app.element('sensitivity').value='2';app.element('sensitivity').fire('input');
  app.document.fire('mousemove',{movementX:100,movementY:0});
  assert.ok(Math.abs((app.read('player.yaw')-initial)-3*delta)<1e-9);
  const restored=boot(Object.fromEntries(app.storage));
  assert.equal(restored.read('sensitivity'),2);assert.equal(restored.element('sensitivity-value').textContent,'2.00×');
  const legacy=boot({'movement-lab-settings-v1':JSON.stringify({sensitivity:2,fov:110})});
  assert.equal(legacy.read('sensitivity'),1);assert.equal(legacy.read('fov'),110);
  const migrated=boot(Object.fromEntries(legacy.storage));
  assert.equal(migrated.read('sensitivity'),1);assert.equal(migrated.read('fov'),110);
  assert.equal(JSON.parse(migrated.storage.get('movement-lab-settings-v1')).sensitivityVersion,2);
});
test("world and hands receive the selected FOV, with the shared lens shrinking projection as FOV increases",()=>{
  const app=boot();
  app.read('var handFovs=[];knife={draw(dt,fov){handFovs.push(fov)},equip(){},audio:{activate(){}}}');
  for(const fov of [80,100,120]) {
    app.element('fov').value=String(fov);app.element('fov').fire('input');app.context.frame(0);
    assert.equal(app.fov(),fov);assert.equal(app.read('handFovs.at(-1)'),fov);
    const projectedScale=1/Math.tan(verticalFov(fov)*Math.PI/360);
    assert.ok(Math.abs(projectedScale-1/(Math.tan(fov*Math.PI/360)*.75))<1e-12);
  }
  assert.ok(verticalFov(80)<verticalFov(100));assert.ok(verticalFov(100)<verticalFov(120));
});
test("the blue target advances through each course checkpoint to the finish and resets for a new run",()=>{
  const app=boot();
  for(const map of course.MAP_LIST.filter(m=>m.timed)) {
    app.read(`chooseMap('${map.id}')`);app.context.frame(0);
    assert.equal(app.target().checkpoint,1,map.title);
    for(let cp=1;cp<map.spawns.length;cp++) {
      const spawn=map.spawns[cp];
      app.read(`player=createPlayer({x:${spawn.x},y:${spawn.y+80},z:${spawn.z},yaw:0});tick()`);app.context.frame(0);
      if(cp<map.spawns.length-1)assert.equal(app.target().checkpoint,cp+1,map.title);
      else assert.equal(app.target().finish,true,map.title);
    }
    app.read('finishRun()');app.context.frame(0);assert.equal(app.target(),null);
    app.read('reset()');app.context.frame(0);assert.equal(app.target().checkpoint,1);
  }
  app.read("chooseMap('free')");app.context.frame(0);assert.equal(app.target(),null);
});
test("endless highlights the next checkpoint deck even after the world rebases",()=>{
  const app=boot();app.read("chooseMap('endless')");app.context.frame(0);
  assert.equal(app.target().endlessIndex,8);
  for(const index of [8,16,24,32,40]) {
    app.read(`{const deck=endless.platform(${index});player=createPlayer({x:(deck.min[0]+deck.max[0])/2,y:deck.max[1]+80,z:(deck.min[2]+deck.max[2])/2,yaw:0});tick()}`);
    app.context.frame(0);
    assert.equal(app.target().endlessIndex,index+8);
    assert.equal(app.target().min[2],app.read(`endless.platform(${index+8}).min[2]`));
  }
});

test('FPS uses render frames rather than physics ticks and resets while the page is hidden',()=>{
  const app=boot();app.context.frame(0);
  for(let i=1;i<=60;i++)app.context.frame(i*1000/60);
  assert.equal(Number(app.element('fps').textContent),60);
  app.document.hidden=true;app.context.frame(2000);assert.equal(app.element('fps').textContent,'—');
  app.document.hidden=false;
  for(let i=1;i<=30;i++)app.context.frame(2000+i*1000/60);
  assert.equal(Number(app.element('fps').textContent),60);
});
test('checkpoint sounds fire once on entry, including Endless, and pause/respawn stop active sounds',()=>{
  const app=boot();
  app.read('var soundCalls=[];gameAudio={movement(){},checkpoint(){soundCalls.push("checkpoint")},stopAll(){soundCalls.push("stop")}}');
  app.read('player=createPlayer({...MAPS.course.spawns[1],y:80});tick();tick()');
  assert.equal(app.read('soundCalls.filter(c=>c==="checkpoint").length'),1);
  app.read('pause();reset(false)');assert.ok(app.read('soundCalls.filter(c=>c==="stop").length')>=2);
  app.read("chooseMap('endless');soundCalls=[];{const deck=endless.platform(8);player=createPlayer({x:0,y:80,z:(deck.min[2]+deck.max[2])/2,yaw:0});tick();tick()}");
  assert.equal(app.read('soundCalls.filter(c=>c==="checkpoint").length'),1);
});
test('the chosen checkpoint sound, movement toggle and volume persist independently of knife settings',async()=>{
  const app=boot();
  app.element('checkpoint-sound').value='arcade';await app.element('checkpoint-sound').fire('change');
  app.element('movement-sounds').checked=false;app.element('movement-sounds').fire('change');
  app.element('audio-volume').value='40';app.element('audio-volume').fire('input');
  const settings=JSON.parse(app.storage.get('movement-lab-settings-v1'));
  assert.equal(settings.checkpointSound,'arcade');assert.equal(settings.movementSounds,false);assert.equal(settings.audioVolume,.4);
  const restored=boot(Object.fromEntries(app.storage));
  assert.equal(restored.element('checkpoint-sound').value,'arcade');assert.equal(restored.element('movement-sounds').checked,false);
  assert.equal(restored.element('audio-volume').value,40);assert.equal(restored.element('knife-sounds').checked,true);
});
test('leaderboard opens for the selected course, safely renders cloud records, and remains separate from local personal bests',async()=>{
  const app=boot();app.read('loadLeaderboard=async()=>[{name:"<Seal>",value:12.345}]');
  app.element('leaderboard-button').fire('click');await app.read('refreshLeaderboard()');
  assert.equal(app.element('leaderboard').open,true);assert.equal(app.element('leaderboard-title').textContent,'Starter course');
  assert.match(app.element('leaderboard-rows').innerHTML,/&lt;Seal&gt;/);assert.match(app.element('leaderboard-rows').innerHTML,/00:12.345/);
  assert.equal(app.read('bests[recordKey()]'),undefined);
  app.element('leaderboard-close').fire('click');assert.equal(app.element('leaderboard').open,false);
  app.read("chooseMap('free')");assert.equal(app.element('leaderboard-button').disabled,true);
});
test('audio choices and cloud leaderboards remain usable without WebGL while play stays disabled',async()=>{
  const app=boot({},'','WebGL is unavailable.');
  assert.equal(app.element('play').disabled,true);assert.equal(app.element('play-endless').disabled,true);
  assert.match(app.element('menu-description').textContent,/still available/);
  app.element('checkpoint-sound').value='glass';await app.element('checkpoint-sound').fire('change');
  assert.equal(app.read('checkpointSound'),'glass');
  app.read('loadLeaderboard=async()=>[]');app.element('leaderboard-button').fire('click');await app.read('refreshLeaderboard()');
  assert.equal(app.element('leaderboard').open,true);assert.match(app.element('leaderboard-status').textContent,/No records yet/);
  app.element('play').fire('click');assert.equal(app.requests(),0);assert.equal(app.read('playing'),false);
});
test('entering the finish plays one victory cue after stopping movement sounds, and reset cancels it',()=>{
  const app=boot();
  app.read('var finishSounds=[];gameAudio={movement(){},checkpoint(){},stopAll(){finishSounds.push("stop")},finish(){finishSounds.push("finish")}};checkpoint=MAPS.course.spawns.length-1;runActive=true;{const end=boxes.find(b=>b.finish);player=createPlayer({x:(end.min[0]+end.max[0])/2,y:end.max[1]+80,z:(end.min[2]+end.max[2])/2,yaw:0});tick()}');
  assert.equal(app.read('completed'),true);assert.equal(app.read('finishSounds.join(",")'),'stop,finish');
  app.read('finishRun()');assert.equal(app.read('finishSounds.join(",")'),'stop,finish');
  app.read('reset()');assert.equal(app.read('finishSounds.at(-1)'),'stop');
});
test('crosshair starts with the original default style and a matching live preview',()=>{
  const app=boot();
  for(const id of ['crosshair','crosshair-preview']) {
    assert.equal(app.element(id).className,'reticle reticle--default');
    assert.equal(app.element(id).style.color,'rgb(221, 221, 221)');
    assert.equal(app.element(id).style['--reticle-scale'],'1');
  }
  assert.equal(app.element('crosshair-colour-value').textContent,'#DDDDDD');
  assert.equal(app.element('crosshair-scale-value').textContent,'1.00×');
});
test('all three crosshair styles, RGB sliders and scale update both reticles and persist across reloads',()=>{
  const app=boot();
  for(const style of ['dot','cross','default']) {
    app.element('crosshair-style').value=style;app.element('crosshair-style').fire('change');
    assert.equal(app.element('crosshair').className,'reticle reticle--'+style);
    assert.equal(app.element('crosshair-preview').className,'reticle reticle--'+style);
  }
  for(const [name,value] of [['red',12],['green',255],['blue',80],['scale',2.25]]) {
    app.element('crosshair-'+name).value=String(value);app.element('crosshair-'+name).fire('input');
  }
  assert.equal(app.element('crosshair').style.color,'rgb(12, 255, 80)');
  assert.equal(app.element('crosshair-preview').style['--reticle-scale'],'2.25');
  assert.equal(app.element('crosshair-colour-value').textContent,'#0CFF50');
  const saved=app.storage.get('movement-lab-settings-v1'),again=boot({'movement-lab-settings-v1':saved});
  assert.equal(again.element('crosshair').style.color,'rgb(12, 255, 80)');
  assert.equal(again.element('crosshair').style['--reticle-scale'],'2.25');
  assert.equal(again.element('crosshair-scale-value').textContent,'2.25×');
  assert.equal(again.read('fov'),100);assert.equal(again.read('sensitivity'),1);
});
test('invalid stored crosshair settings fall back safely and numeric values stay within slider limits',()=>{
  const app=boot({'movement-lab-settings-v1':JSON.stringify({crosshair:{style:'invalid',red:-20,green:999,blue:'80',scale:9}})});
  assert.equal(app.element('crosshair').className,'reticle reticle--default');
  assert.equal(app.element('crosshair').style.color,'rgb(0, 255, 221)');
  assert.equal(app.element('crosshair').style['--reticle-scale'],'3');
  const old=boot({'movement-lab-settings-v1':JSON.stringify({crosshair:null})});
  assert.equal(old.element('crosshair').style.color,'rgb(221, 221, 221)');
});
test('background defaults to black and all three choices persist across courses and reloads',()=>{
  const app=boot();assert.equal(app.skybox(),'black');assert.equal(app.element('skybox-select').value,'black');
  for(const name of ['cycle','blackhole','black']) {
    app.element('skybox-select').value=name;app.element('skybox-select').fire('change');
    assert.equal(app.skybox(),name);app.read("chooseMap('free');reset()");assert.equal(app.skybox(),name);
    const saved=app.storage.get('movement-lab-settings-v1'),restored=boot({'movement-lab-settings-v1':saved});
    assert.equal(restored.skybox(),name);assert.equal(restored.element('skybox-select').value,name);
  }
});
test('the shaders toggle starts off, persists across maps and reloads, and works without graphics',()=>{
  const app=boot();assert.equal(app.shaders(),false);assert.equal(app.element('shaders-enabled').checked,false);
  app.element('shaders-enabled').checked=true;app.element('shaders-enabled').fire('change');
  assert.equal(app.shaders(),true);app.read("chooseMap('free')");assert.equal(app.shaders(),true);
  const restored=boot(Object.fromEntries(app.storage));assert.equal(restored.shaders(),true);assert.equal(restored.element('shaders-enabled').checked,true);
  restored.element('shaders-enabled').checked=false;restored.element('shaders-enabled').fire('change');
  assert.equal(restored.shaders(),false);assert.equal(JSON.parse(restored.storage.get('movement-lab-settings-v1')).shadersEnabled,false);
  assert.equal(boot({'movement-lab-settings-v1':JSON.stringify({shadersEnabled:'true'})}).shaders(),false);
  const fallback=boot({},'',new Error('No graphics'));fallback.element('shaders-enabled').checked=true;fallback.element('shaders-enabled').fire('change');
  assert.equal(JSON.parse(fallback.storage.get('movement-lab-settings-v1')).shadersEnabled,true);
});
test('only an actual run supplies a player shadow caster; menu cameras stay shadow-free',()=>{
  const app=boot();app.context.frame(16);assert.equal(app.shadowCaster(),null);
  app.element('play').fire('click');app.lock();app.context.frame(32);
  assert.equal(app.shadowCaster(),app.camera());
  app.read('pause()');app.context.frame(48);assert.equal(app.shadowCaster(),app.camera());
  app.read('returnToMain()');app.context.frame(64);assert.equal(app.shadowCaster(),null);
});
test('unknown saved skies fall back to black and settings remain usable without WebGL',()=>{
  for(const skybox of ['__proto__','dawn','midday','dusk','midnight','galaxies']){
    const app=boot({'movement-lab-settings-v1':JSON.stringify({skybox})});assert.equal(app.skybox(),'black');
  }
  const fallback=boot({},'',new Error('No graphics'));
  fallback.element('skybox-select').value='cycle';fallback.element('skybox-select').fire('change');
  assert.equal(JSON.parse(fallback.storage.get('movement-lab-settings-v1')).skybox,'cycle');
});

test('main navigation opens map selection and full settings, while Escape returns home',()=>{
  const app=boot();
  assert.equal(app.read('menuMode'),'main');assert.equal(app.read('mainView'),'home');
  assert.equal(app.element('pause-menu').classList.contains('hidden'),true);
  app.element('open-map-select').fire('click');
  assert.equal(app.read('mainView'),'maps');assert.equal(app.requests(),0);
  assert.equal(app.element('maps-view').classList.contains('hidden'),false);
  assert.equal(app.element('home-view').classList.contains('hidden'),true);
  app.element('maps-back').fire('click');app.element('open-settings').fire('click');
  assert.equal(app.read('mainView'),'settings');
  app.document.fire('keydown',{code:'Escape'});assert.equal(app.read('mainView'),'home');
});
test('Continue preserves a paused run and Back to Main clears the run and input',()=>{
  const app=boot();app.element('play').fire('click');app.lock();
  app.read("runTime=19;checkpoint=1;runActive=true;respawns=2;keys.add('KeyW')");
  app.document.fire('keydown',{code:'Escape'});
  assert.equal(app.read('menuMode'),'pause');assert.equal(app.read('runTime'),19);
  assert.equal(app.element('main-menu').classList.contains('hidden'),true);
  assert.equal(app.element('pause-menu').classList.contains('hidden'),false);
  app.element('continue').fire('click');app.lock();
  assert.equal(app.read('checkpoint'),1);assert.equal(app.read('runTime'),19);
  app.document.fire('keydown',{code:'Escape'});app.element('back-to-main').fire('click');
  assert.equal(app.read('menuMode'),'main');assert.equal(app.read('mainView'),'home');
  for(const expr of ['runTime','checkpoint','respawns','keys.size'])assert.equal(app.read(expr),0,expr);
  for(const expr of ['started','runActive','playing','lockPending','completed'])assert.equal(app.read(expr),false,expr);
  assert.equal(app.document.pointerLockElement,null);
  assert.equal(app.read('player.z'),course.MAPS.course.spawns[0].z);
  app.element('open-map-select').fire('click');app.element('play').fire('click');app.lock();
  assert.equal(app.read('runTime'),0);assert.equal(app.read('checkpoint'),0);
});
test('Sandbox launches directly, and Play returns to scored map selection',()=>{
  const app=boot();app.element('play-sandbox').fire('click');
  assert.equal(app.requests(),1);assert.equal(app.read('map'),'free');
  app.lock();assert.equal(app.read('playing'),true);
  app.document.fire('keydown',{code:'Escape'});app.element('back-to-main').fire('click');
  app.element('open-map-select').fire('click');
  assert.equal(app.read('map'),'course');assert.equal(app.read('mainView'),'maps');
});
test('main and pause look settings stay synchronized and persist',()=>{
  const app=boot();
  app.element('pause-sensitivity').value='1.75';app.element('pause-sensitivity').fire('input');
  app.element('pause-fov').value='112';app.element('pause-fov').fire('input');
  assert.equal(app.element('sensitivity').value,1.75);assert.equal(app.element('fov').value,112);
  app.element('sensitivity').value='2.5';app.element('sensitivity').fire('input');
  assert.equal(app.element('pause-sensitivity').value,2.5);
  assert.equal(app.element('pause-sensitivity-value').textContent,'2.50×');
  const restored=boot({'movement-lab-settings-v1':app.storage.get('movement-lab-settings-v1')});
  assert.equal(restored.element('pause-fov').value,112);assert.equal(restored.read('sensitivity'),2.5);
});
test('settings from a completed course return to main without leaving a resumable run',()=>{
  const app=boot();app.read('runTime=12;finishRun()');app.element('finish-settings').fire('click');
  assert.equal(app.read('mainView'),'settings');assert.equal(app.read('started'),false);
  assert.equal(app.read('completed'),false);assert.equal(app.read('runTime'),0);
  assert.equal(app.element('finish').classList.contains('hidden'),true);
});
test('returning from Endless saves distance and clears the route for the next run',()=>{
  const app=boot();app.element('play-endless').fire('click');app.lock();
  app.read('player.z=-3210;endless.update(player,null);runTime=15;checkpoint=2;pause()');
  app.element('back-to-main').fire('click');
  assert.equal(app.read('endless.distance'),0);assert.equal(app.read('runTime'),0);
  assert.equal(JSON.parse(app.storage.get('movement-lab-bests-v1'))['endless:v3:classic'],3210);
});
test('all scored native maps have boards and Endless opens a distance board without changing the course',async()=>{
 const app=boot();app.element('open-map-select').fire('click');
 app.read('loadLeaderboard=async()=>[{name:"Seal",value:12345}]');
 for(const id of ['course','bhop-school','ladder-run']){app.read(`chooseMap('${id}');openLeaderboard()`);assert.equal(app.element('leaderboard-button').disabled,false);assert.equal(app.element('leaderboard').open,true);app.element('leaderboard-close').fire('click');}
 app.element('endless-leaderboard').fire('click');await app.read('refreshLeaderboard()');
 assert.equal(app.read('map'),'ladder-run');assert.equal(app.element('leaderboard-title').textContent,'Endless');assert.equal(app.element('leaderboard-score').textContent,'DISTANCE');assert.match(app.element('leaderboard-rows').innerHTML,/12,345 u/);
 app.document.fire('keydown',{code:'Escape'});assert.equal(app.read('mainView'),'maps');
});

test('retired map records are ignored while Starter records remain intact',()=>{
 const original={'momentum:classic':8.123,'endless:practice':9000,'course:classic':20};
 const app=boot({'movement-lab-bests-v1':JSON.stringify(original),'movement-lab-settings-v1':JSON.stringify({map:'momentum'})});
 assert.equal(app.read('map'),'course');assert.equal(app.element('best').textContent,'00:20.000');
 app.read('runTime=25;finishRun()');const saved=JSON.parse(app.storage.get('movement-lab-bests-v1'));
 assert.equal(saved['course:classic'],20);assert.equal(saved['momentum:classic'],8.123);
});

test('ladder movement reaches the HUD and reset clears attachment state',()=>{
 const app=boot();app.read("chooseMap('free');player=createPlayer({x:0,y:20,z:-1304,yaw:0});keys.add('KeyW');tick();updateHud()");
 assert.equal(app.element('motion-state').textContent,'ON LADDER');
 assert.equal(app.element('speed').textContent,200);assert.equal(app.element('gain').textContent,'CLIMBING');
 assert.equal(app.read('!!player.ladder'),true);
 app.read('reset()');assert.equal(app.read('player.ladder'),null);
});

test('menu music defaults off, plays in both menus, and pauses during a captured run',async()=>{
 const app=boot();assert.equal(app.element('menu-music-enabled').checked,false);assert.equal(app.musicAudio.plays,0);
 app.element('menu-music-enabled').checked=true;app.element('menu-music-enabled').fire('change');await Promise.resolve();
 assert.equal(app.musicAudio.paused,false);app.musicAudio.currentTime=42;
 app.element('play').fire('click');app.lock();assert.equal(app.musicAudio.paused,true);
 app.document.fire('keydown',{code:'Escape'});await Promise.resolve();
 assert.equal(app.read('menuMode'),'pause');assert.equal(app.musicAudio.paused,false);assert.equal(app.musicAudio.currentTime,42);
 app.window.fire('blur');assert.equal(app.musicAudio.paused,true);assert.equal(app.read('windowFocused'),false);
 app.window.fire('focus');await Promise.resolve();assert.equal(app.musicAudio.paused,false);
 app.document.hidden=true;app.document.fire('visibilitychange');assert.equal(app.musicAudio.paused,true);
 app.document.hidden=false;app.document.fire('visibilitychange');await Promise.resolve();assert.equal(app.musicAudio.paused,false);
 app.window.fire('pagehide');assert.equal(app.musicAudio.paused,true);
});
test('music volume persists independently from movement audio and the choice restores on reload',()=>{
 const app=boot();app.element('menu-music-enabled').checked=true;app.element('menu-music-enabled').fire('change');
 app.element('menu-music-volume').value='70';app.element('menu-music-volume').fire('input');
 assert.equal(app.musicAudio.volume,.7);assert.equal(app.read('audioVolume'),.65);
 const saved=app.storage.get('movement-lab-settings-v1'),next=boot({'movement-lab-settings-v1':saved});
 assert.equal(next.element('menu-music-enabled').checked,true);assert.equal(next.element('menu-music-volume').value,70);
 assert.equal(next.element('menu-music-volume-value').textContent,'70%');
});
test('losing focus stops previews and knife voices even when the game was already paused',()=>{
 const app=boot();app.read('var stopped=0,muted=false;gameAudio={stopAll(){stopped++}};knife={audio:{stopAll(){stopped++},setMuted(value){muted=value}}}');
 app.window.fire('blur');assert.equal(app.read('stopped'),2);assert.equal(app.read('muted'),true);
 app.read('activateGameAudio()');assert.equal(app.read('stopped'),2,'background preview activation is rejected before audio starts');
});
test('map selection shows section counts and has no difficulty or shortcut labels',()=>{
 const app=boot();assert.ok(!/Easy|Hard|Expert|Extreme|skip|shortcut/.test(app.element('map-grid').innerHTML));
 assert.match(app.element('map-grid').innerHTML,/sections/);app.read("chooseMap('course')");
 assert.ok(!/Hard|Expert|Extreme|skip|shortcut/.test(app.element('map-meta').textContent));
});

test('page navigation pauses a captured run and restoring the page leaves it paused',()=>{
 const app=boot();app.element('play').fire('click');app.lock();app.window.fire('pagehide');
 assert.equal(app.read('playing'),false);assert.equal(app.read('menuMode'),'pause');assert.equal(app.document.pointerLockElement,null);
 app.window.fire('pageshow');assert.equal(app.read('playing'),false);
});

function sourceFixture(id) {
 const boxes=[{min:[-200,-100,-200],max:[200,0,200]}];
 const source={id,title:id,boxes,entities:[],triggers:[],buttons:[],destinations:new Map(),killHeight:-600,
  spawns:[{x:0,y:0,z:0,yaw:0},{x:100,y:0,z:0,yaw:0}],stages:[{title:'Section 1',tip:'Hop.',target:'1a'},{title:'Section 2',tip:'Hop.',target:'1b'}]};
 boxes.sourceMap=source;
 return source;
}
const localSourceFile={size:8,arrayBuffer:async()=>new ArrayBuffer(8)};
test('local map imports select the decoded world and checkpoint respawns reset its trigger state',async()=>{
 const source=sourceFixture('source-integration');
 const app=boot({},'',null,{load:async()=>source});
 try {
  await app.context.selectCommunityMap({id:source.id,title:source.title},localSourceFile);
  assert.equal(app.read('map'),source.id);assert.equal(app.read('boxes'),source.boxes);
  assert.equal(app.element('leaderboard-button').disabled,true);assert.match(app.element('source-map-status').textContent,/ready/);
  app.element('play').fire('click');app.lock();assert.equal(app.read('playing'),true);
  app.read('checkpoint=1;reset(false)');assert.equal(app.read('player.x'),100);assert.equal(app.read('sourceRuntime.stage'),1);
  app.read("chooseMap('course')");assert.equal(app.read('sourceRuntime'),null);assert.equal(app.element('leaderboard-button').disabled,false);
 } finally {delete course.MAPS[source.id];}
});
test('a failed download leaves native maps playable and a subsequent local import can succeed',async()=>{
 const source=sourceFixture('source-retry');const app=boot({},'',null,{fetch:async()=>({ok:false}),load:async()=>source});
 try {
  await app.context.selectCommunityMap({id:source.id,title:source.title,archive:'missing.zip'});
  assert.equal(app.read('map'),'course');assert.match(app.element('source-map-status').textContent,/download failed/);assert.equal(app.element('import-source-map').disabled,false);
  await app.context.selectCommunityMap({id:source.id,title:source.title},localSourceFile);assert.equal(app.read('map'),source.id);
 } finally {delete course.MAPS[source.id];}
});
test('selecting a native map while decoding prevents a stale import from replacing the selection',async()=>{
 let resolve,signalStarted;const started=new Promise(r=>{signalStarted=r;}),source=sourceFixture('source-cancel');
 const app=boot({},'',null,{load:()=>{signalStarted();return new Promise(r=>{resolve=r;});}});
 const request=app.context.selectCommunityMap({id:source.id,title:source.title},localSourceFile);
 await started;
 app.read("chooseMap('free')");resolve(source);await request;
 assert.equal(app.read('map'),'free');assert.equal(course.MAPS[source.id],undefined);assert.equal(app.element('import-source-map').disabled,false);
});

const greyGeometry=()=>JSON.parse(readFileSync(new URL('../dist/maps/bhop_lego.json',import.meta.url),'utf8'));
const greyFetch=async()=>({ok:true,json:async()=>greyGeometry()});
const finishMicrotasks=()=>new Promise(resolve=>setImmediate(resolve));
test('Kitsune portals save the next checkpoint without a respawn penalty or a camera interpolation jump',async()=>{
 const metadata=course.COMMUNITY_MAPS.find(m=>m.id==='bhop_kitsune');
 const geometry=JSON.parse(readFileSync(new URL('../dist/maps/bhop_kitsune.json',import.meta.url),'utf8'));
 const app=boot({},'',null,{fetch:async()=>({ok:true,json:async()=>geometry})});
 try {
  await app.context.selectCommunityMap(metadata);app.context.frame(0);assert.equal(app.target(),app.read('boxes[boxes.sourceMap.portals[0].exitPad]'));
  assert.equal(app.element('leaderboard-button').disabled,false);app.element('play').fire('click');app.lock();
  app.read('runActive=true;runTime=15;var portal=boxes.sourceMap.portals[0];player=createPlayer({x:(portal.min[0]+portal.max[0])/2,y:portal.min[1],z:(portal.min[2]+portal.max[2])/2,yaw:0});player.vx=500;tick()');
  assert.equal(app.read('checkpoint'),1);assert.equal(app.read('sourceRuntime.stage'),1);assert.equal(app.read('respawns'),0);assert.ok(app.read('runTime')>15);assert.equal(app.read('player.vx'),500*(1-physics.RULES.friction*physics.DT));
  assert.equal(app.read('player.x'),geometry.spawns[1].x);assert.equal(app.read('previousDraw.x'),app.read('player.x'));assert.equal(app.read('previousDraw.y'),app.read('player.y'));
  app.context.frame(0);assert.equal(app.target(),app.read('boxes[boxes.sourceMap.portals[1].exitPad]'));
  app.document.fire('keydown',{code:'KeyE'});assert.equal(app.read('player.x'),geometry.spawns[1].x);assert.equal(app.read('respawns'),1);
 } finally {delete course.MAPS.bhop_kitsune;}
});
test('the menu contains 15 slideshow entries with later sections and both community previews',()=>{
 const app=boot();assert.equal(app.read('galleryMaps.length'),15);
 assert.equal((app.element('gallery-slides').innerHTML.match(/<img /g)||[]).length,15);
 assert.match(app.element('gallery-slides').innerHTML,/Final section/);assert.match(app.element('gallery-slides').innerHTML,/bhop_kitsune/);
});
test('bhop_lego exposes its leaderboard from map selection and the finish screen in both modes',async()=>{
 const app=boot({},'',null,{fetch:greyFetch});app.context.leaderboardCalls=[];
 app.read('loadLeaderboard=async(id,mode,options)=>{leaderboardCalls.push({id,mode,revision:options.revision});return [{name:"<Seal>",value:154.567}];}');
 try {
  await app.context.selectCommunityMap(course.COMMUNITY_MAPS[0]);
  assert.equal(app.element('leaderboard-button').disabled,false);
  app.element('leaderboard-button').fire('click');await app.read('refreshLeaderboard()');
  assert.equal(app.element('leaderboard').open,true);assert.equal(app.element('leaderboard-title').textContent,'bhop_lego');
  assert.match(app.element('leaderboard-rows').innerHTML,/&lt;Seal&gt;/);assert.match(app.element('leaderboard-rows').innerHTML,/02:34.567/);
  assert.equal(app.context.leaderboardCalls.at(-1).id,'bhop_lego');assert.equal(app.context.leaderboardCalls.at(-1).revision,2);
  app.element('leaderboard-close').fire('click');app.read("choosePreset('practice');runTime=154.567;finishRun()");
  assert.equal(app.element('finish-leaderboard').classList.contains('hidden'),false);
  app.element('finish-leaderboard').fire('click');await app.read('refreshLeaderboard()');
  assert.equal(app.context.leaderboardCalls.at(-1).mode,'practice');assert.equal(app.element('leaderboard-mode').textContent,'Bhop practice');
  app.element('leaderboard-close').fire('click');app.read("chooseMap('free');openLeaderboard()");
  assert.equal(app.element('leaderboard').open,false);assert.equal(app.element('leaderboard-button').disabled,true);
 } finally {delete course.MAPS.bhop_lego;}
});
test('refresh restores the selected map and safe checkpoint with the timer paused',async()=>{
 const session=new Map(),app=boot({},'',null,{session,fetch:greyFetch});
 try {
  await app.context.selectCommunityMap(course.COMMUNITY_MAPS[0]);app.element('play').fire('click');app.lock();
  app.read('checkpoint=2;runTime=18.25;runActive=true;reset(false);saveRunCheckpoint()');
  const saved=Object.fromEntries(app.storage);delete course.MAPS.bhop_lego;
  const refreshed=boot(saved,'',null,{session,fetch:greyFetch});await finishMicrotasks();
  assert.equal(refreshed.read('map'),'bhop_lego');assert.equal(refreshed.read('checkpoint'),2);assert.equal(refreshed.read('sourceRuntime.stage'),2);
  assert.equal(refreshed.read('runTime'),18.25);assert.equal(refreshed.read('playing'),false);assert.equal(refreshed.read('menuMode'),'pause');
  assert.equal(refreshed.read('player.y'),course.MAPS.bhop_lego.spawns[2].y);assert.ok(refreshed.read('player.grounded'));
  assert.match(refreshed.element('pause-input-note').textContent,/restored/);
 } finally {delete course.MAPS.bhop_lego;}
});
test('E returns to the latest pad and Q clears progress, including the next refresh',async()=>{
 const session=new Map(),app=boot({},'',null,{session,fetch:greyFetch});
 try {
  await app.context.selectCommunityMap(course.COMMUNITY_MAPS[0]);app.element('play').fire('click');app.lock();
  app.read('checkpoint=3;runTime=22;runActive=true;player.x=99999;keys.add("Space")');
  app.document.fire('keydown',{code:'KeyE'});
  assert.equal(app.read('player.x'),course.MAPS.bhop_lego.spawns[3].x);assert.equal(app.read('keys.size'),0);assert.equal(app.read('sourceRuntime.stage'),3);assert.equal(app.read('runTime'),22);
  app.document.fire('keydown',{code:'KeyQ'});assert.equal(app.read('checkpoint'),0);assert.equal(app.read('runTime'),0);assert.equal(app.read('respawns'),0);
  const saved=Object.fromEntries(app.storage);delete course.MAPS.bhop_lego;
  const refreshed=boot(saved,'',null,{session,fetch:greyFetch});await finishMicrotasks();assert.equal(refreshed.read('checkpoint'),0);assert.equal(refreshed.read('runTime'),0);
 } finally {delete course.MAPS.bhop_lego;}
});
test('switching maps discards the old run instead of restoring the wrong map on refresh',async()=>{
 const session=new Map(),app=boot({},'',null,{session,fetch:greyFetch});
 try {
  await app.context.selectCommunityMap(course.COMMUNITY_MAPS[0]);app.element('play').fire('click');app.lock();app.read('checkpoint=1;saveRunCheckpoint();chooseMap("free")');
  assert.equal(session.has('movement-lab-run-v1'),false);
  const refreshed=boot(Object.fromEntries(app.storage),'',null,{session,fetch:greyFetch});assert.equal(refreshed.read('map'),'free');assert.equal(refreshed.read('checkpoint'),0);
 } finally {delete course.MAPS.bhop_lego;}
});
test('locally imported block geometry survives refresh within the same tab',async()=>{
 const session=new Map(),geometry=greyGeometry();geometry.id='local-map';geometry.title='Local test map';
 const app=boot({},'',null,{session,load:async()=>parkourModule.hydrateParkourMap(geometry)});
 try {
  await app.context.selectCommunityMap({id:'local-map',title:'Local test map'},localSourceFile);app.element('play').fire('click');app.lock();app.read('checkpoint=1;runTime=3;runActive=true;reset(false);saveRunCheckpoint()');
  const saved=Object.fromEntries(app.storage);delete course.MAPS['local-map'];
  const refreshed=boot(saved,'',null,{session});assert.equal(refreshed.read('map'),'local-map');assert.equal(refreshed.read('checkpoint'),1);assert.equal(refreshed.read('menuMode'),'pause');
 } finally {delete course.MAPS['local-map'];}
});


test('the in-game room leaderboard ranks progress and times, escapes names, and clears on leaving',async()=>{
 const app=boot({},'',null,roomAppOptions);app.element('room-name').value='Host';await app.context.startRoom(true);
 assert.equal(app.element('room-leaderboard').classList.contains('hidden'),false);
 app.read("checkpoint=1;runTime=20.25;room.rows=[{id:'self',name:'Host',slot:0,self:true,host:true},{id:'ahead',name:'Ahead',slot:1,state:{checkpoint:2,time:35.5}},{id:'finished',name:'Finished',slot:2,state:{checkpoint:2,time:40.125,completed:true}},{id:'quick',name:'<Seal>',slot:3,state:{checkpoint:1,time:18.5}}];room.roster=()=>room.rows;updateRoomUi()");
 let rows=app.element('room-leaderboard-players').innerHTML;
 assert.deepEqual([...rows.matchAll(/class="room-player-name">([^<]*)</g)].map(m=>m[1]),['Finished','Ahead','&lt;Seal&gt;','Host · you']);
 assert.match(rows,/aria-label="Finished"/);assert.match(rows,/2\/2/);assert.match(rows,/00:40\.125/);assert.match(rows,/00:20\.250/);assert.match(rows,/data-self="true"/);assert.doesNotMatch(rows,/<Seal>/);
 app.read("checkpoint=2;runTime=10;updateRoomUi()");
 rows=app.element('room-leaderboard-players').innerHTML;
 assert.ok(rows.indexOf('Host · you')<rows.indexOf('Ahead'));assert.match(rows,/00:10\.000/);assert.doesNotMatch(rows,/00:20\.250/);
 app.read("room.rows=room.rows.filter(p=>p.id!=='ahead');updateRoomUi()");
 assert.doesNotMatch(app.element('room-leaderboard-players').innerHTML,/Ahead/);
 app.element('room-leave').fire('click');
 assert.equal(app.element('room-leaderboard').classList.contains('hidden'),true);assert.equal(app.element('room-leaderboard-players').innerHTML,'');
});
test('the room leaderboard supports Endless checkpoints and players still joining without invented times',async()=>{
 const app=boot({},'',null,roomAppOptions);assert.equal(app.element('room-leaderboard-players').innerHTML,'');
 app.element('room-map').value='endless';await app.context.startRoom(true);
 app.read("checkpoint=8;runTime=65.5;room.rows=[{id:'self',name:'Host',slot:0,self:true,host:true},{id:'joining',name:'Joining',slot:1}];room.roster=()=>room.rows;updateRoomUi()");
 const rows=app.element('room-leaderboard-players').innerHTML;
 assert.match(rows,/<td>8<\/td>/);assert.match(rows,/01:05\.500/);assert.match(rows,/<td>—<\/td><td id="room-time-1">—<\/td>/);assert.doesNotMatch(rows,/NaN|8\//);
 app.read("reset();updateRoomUi()");
 assert.match(app.element('room-leaderboard-players').innerHTML,/<td>0<\/td>/);assert.match(app.element('room-leaderboard-players').innerHTML,/00:00\.000/);
});
test('leaderboard time cells update every frame between roster refreshes',async()=>{
 const app=boot({},'',null,roomAppOptions);await app.context.startRoom(true);
 const member={id:'remote',name:'Guest',slot:1,samples:[]};
 new multiplayerModule.MultiplayerRoom().sample(member,multiplayerModule.sanitiseRoomState({x:0,y:0,z:0,yaw:0,pitch:0,duckAmount:0,time:12,checkpoint:0,distance:0,running:true}),0);
 app.context.remoteTimerMember=member;
 app.read("room.rows=[{id:'self',name:'Host',slot:0,self:true,host:true},remoteTimerMember];room.roster=()=>room.rows;roomUiAt=0;runTime=5;updateRoomUi()");
 const originalRows=app.element('room-leaderboard-players').innerHTML;
 app.context.frame(16);
 assert.equal(app.element('room-time-0').textContent,'00:05.000');
 assert.equal(app.element('room-time-1').textContent,'00:12.016');
 app.read('runTime=5.025');app.context.frame(32);
 assert.equal(app.element('room-time-0').textContent,'00:05.025');
 assert.equal(app.element('room-time-1').textContent,'00:12.032');
 assert.equal(app.element('room-leaderboard-players').innerHTML,originalRows,'animation only updates time cells');
 assert.equal(app.read('room.rows[1].state.time'),12);
 app.read('completed=true');assert.equal(app.read('roomLocalState().running'),false);
 app.element('room-leave').fire('click');app.context.frame(48);
 assert.equal(app.element('room-time-1'),null,'leaving removes the animated timer cells');
});
