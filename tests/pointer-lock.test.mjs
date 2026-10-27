import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as physics from '../dist/physics.js';
import * as course from '../dist/course.js';
import * as endlessModule from '../dist/endless.js';
import { verticalFov } from '../dist/renderer.js';
import * as audioModule from '../dist/game-audio.js';
import * as leaderboardModule from '../dist/leaderboard.js';
const markup=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
const elementIds=new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));

// Exercise the real app event handlers with a browser API test double. Rendering
// is stubbed here; these checks verify input, run progression and pause behavior.
function boot(stored = {}, search = '', renderError = null) {
  function element() {
    const listeners=new Map(),classes=new Set();
    return {textContent:'',innerHTML:'',style:{setProperty(name,value){this[name]=value;}},disabled:false,
      classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),
        contains:k=>classes.has(k),toggle:(k,on)=>on?classes.add(k):classes.delete(k)},
      addEventListener:(name,fn)=>listeners.set(name,fn),
      fire:(name,event={})=>listeners.get(name)?.(event),focus(){},
      showModal(){this.open=true;},close(){this.open=false;this.fire('close');}};
  }
  const elements=new Map(),document=element(),window=element();
  window.location={search};
  document.getElementById=id=>{
    if(!elementIds.has(id))return null;
    if(!elements.has(id))elements.set(id,element());
    return elements.get(id);
  };
  document.querySelectorAll=()=>[];document.body=element();document.pointerLockElement=null;
  const canvas=document.getElementById('world');let requests=0,lastCamera,lastTarget,lastFov;
  canvas.requestPointerLock=()=>{requests++;};
  document.exitPointerLock=()=>{document.pointerLockElement=null;document.fire('pointerlockchange');};
  const storage=new Map(Object.entries(stored));
  const context=vm.createContext({...physics,...course,...endlessModule,...audioModule,...leaderboardModule,document,window,
    performance:{now:()=>0},URLSearchParams,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    requestAnimationFrame(){},createRenderer:()=>{if(renderError)throw new Error(renderError);return {setBoxes(){},draw(p,fov,target){lastCamera=p;lastFov=fov;lastTarget=target;}};}});
  const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
  vm.runInContext(source,context);
  return {context,document,window,canvas,element:id=>document.getElementById(id),
    requests:()=>requests,camera:()=>lastCamera,target:()=>lastTarget,fov:()=>lastFov,read:source=>vm.runInContext(source,context),storage,
    lock(){document.pointerLockElement=canvas;document.fire('pointerlockchange');}};
}
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
test('course select resets the run and renders the selected course and section count',()=>{
  const app=boot();
  assert.match(app.element('map-select').innerHTML,/Needleworks/);
  app.read("runTime=30;checkpoint=2;keys.add('Space')");
  app.element('map-select').value='circuit';app.element('map-select').fire('change');
  assert.equal(app.read('map'),'circuit');assert.equal(app.read('runTime'),0);
  assert.equal(app.read('checkpoint'),0);assert.equal(app.read('keys.size'),0);
  assert.equal(app.element('progress-count').textContent,'01 / 04');
  assert.equal(app.element('course-title').textContent,'BROKEN CIRCUIT');
  assert.equal(app.read('player.x'),course.MAPS.circuit.spawns[0].x);
  assert.equal(JSON.parse(app.storage.get('movement-lab-settings-v1')).map,'circuit');
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
test('skipping checkpoints cannot complete a course',()=>{
  const app=boot();app.read("chooseMap('gauntlet');player=createPlayer(MAPS.gauntlet.spawns[3]);tick()");
  assert.equal(app.read('checkpoint'),0);
  app.read('player=createPlayer({x:400,y:144,z:-3890,yaw:0});tick()');
  assert.equal(app.read('completed'),false);
});
test('personal bests are separate per map and preset and retain old starter records',()=>{
  const app=boot({'movement-lab-bests-v1':JSON.stringify({classic:20})});
  assert.equal(app.element('best').textContent,'00:20.000');
  app.read("chooseMap('zigzag');runTime=12;finishRun()");
  app.read("chooseMap('skyline');runTime=17;finishRun()");
  app.read("chooseMap('zigzag');choosePreset('practice');runTime=9;finishRun()");
  const bests=JSON.parse(app.storage.get('movement-lab-bests-v1'));
  assert.equal(bests['course:classic'],20);assert.equal(bests['zigzag:classic'],12);
  assert.equal(bests['skyline:classic'],17);assert.equal(bests['zigzag:practice'],9);
  app.read("choosePreset('classic');chooseMap('zigzag')");
  assert.equal(app.element('best').textContent,'00:12.000');
  app.read("chooseMap('free')");assert.equal(app.element('best').textContent,'—');
});
test('saved course restores its spawn and next-course button advances and captures the mouse',()=>{
  const app=boot({'movement-lab-settings-v1':JSON.stringify({map:'skyline'})});
  assert.equal(app.read('map'),'skyline');assert.equal(app.read('player.y'),course.MAPS.skyline.spawns[0].y);
  app.element('next-course').fire('click');
  assert.equal(app.read('map'),'circuit');assert.equal(app.requests(),1);
  app.lock();assert.equal(app.document.body.classList.contains('playing'),true);
});
test('every course is selectable and starts without requiring a previous completion',()=>{
  for(const map of course.MAP_LIST) {
    const app=boot();
    assert.ok(app.element('map-select').innerHTML.includes(`value="${map.id}"`));
    assert.ok(!app.element('map-select').innerHTML.includes('disabled'));
    app.element('map-select').value=map.id;app.element('map-select').fire('change');
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
  assert.ok(JSON.parse(app.storage.get('movement-lab-bests-v1'))['endless:classic']>9000);
  app.read('reset()');
  assert.equal(app.read('checkpoint'),0);assert.equal(app.read('endless.distance'),0);
  assert.equal(app.read('runTime'),0);
});
test('the dedicated Endless button starts play directly and the Endless link overrides the saved course',()=>{
  const app=boot();app.element('play-endless').fire('click');
  assert.equal(app.read('map'),'endless');assert.equal(app.requests(),1);
  app.lock();assert.equal(app.read('playing'),true);
  app.read('runTime=12;pause()');app.element('play-endless').fire('click');app.lock();
  assert.equal(app.read('runTime'),12,'the button resumes an existing endless run');
  const linked=boot({'movement-lab-settings-v1':JSON.stringify({map:'skyline'})},'?course=endless');
  assert.equal(linked.read('map'),'endless');
  const invalid=boot({},'?course=invalid');assert.equal(invalid.read('map'),'course');
});
test('the published entry page contains the complete build and visible Endless button',()=>{
  const entry=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const standalone=readFileSync(new URL('../movement-lab.html',import.meta.url),'utf8');
  assert.equal(entry,standalone);
  assert.match(entry,/<button id="play-endless"[^>]*>PLAY ENDLESS/);
  assert.match(entry,/<option value="endless">Endless<\/option>/);
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
