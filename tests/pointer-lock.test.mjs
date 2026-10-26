import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as physics from '../dist/physics.js';
import * as course from '../dist/course.js';
import * as endlessModule from '../dist/endless.js';
const markup=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
const elementIds=new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));

// Exercise the real app event handlers with a browser API test double. Rendering
// is stubbed here; these checks verify capture, pause and error behavior only.
function boot(stored = {}, search = '') {
  function element() {
    const listeners=new Map(),classes=new Set();
    return {textContent:'',innerHTML:'',style:{},disabled:false,
      classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),
        contains:k=>classes.has(k),toggle:(k,on)=>on?classes.add(k):classes.delete(k)},
      addEventListener:(name,fn)=>listeners.set(name,fn),
      fire:(name,event={})=>listeners.get(name)?.(event),focus(){}};
  }
  const elements=new Map(),document=element(),window=element();
  window.location={search};
  document.getElementById=id=>{
    if(!elementIds.has(id))return null;
    if(!elements.has(id))elements.set(id,element());
    return elements.get(id);
  };
  document.querySelectorAll=()=>[];document.body=element();document.pointerLockElement=null;
  const canvas=document.getElementById('world');let requests=0,lastCamera;
  canvas.requestPointerLock=()=>{requests++;};
  document.exitPointerLock=()=>{document.pointerLockElement=null;document.fire('pointerlockchange');};
  const storage=new Map(Object.entries(stored));
  const context=vm.createContext({...physics,...course,...endlessModule,document,window,
    performance:{now:()=>0},URLSearchParams,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    requestAnimationFrame(){},createRenderer:()=>({setBoxes(){},draw:p=>lastCamera=p})});
  const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
  vm.runInContext(source,context);
  return {context,document,window,canvas,element:id=>document.getElementById(id),
    requests:()=>requests,camera:()=>lastCamera,read:source=>vm.runInContext(source,context),storage,
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
    assert.ok(app.read('runTime')>0,map.title);
    assert.ok(app.read('speed(player)')>0,map.title);
  }
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
