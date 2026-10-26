import { DT, PRESETS, createPlayer, step, speed, support } from './physics.js';
import { MAPS, MAP_LIST } from './course.js';
import { createEndless } from './endless.js';
import { createRenderer } from './renderer.js';

const $ = id => document.getElementById(id);
const canvas = $('world'), overlay = $('overlay'), keys = new Set();
const ui = Object.fromEntries(['timer','best','speed','speed-fill','motion-state','gain','hops','peak','jump-speed','progress-count','stage-name','stage-tip'].map(id=>[id,$(id)]));
let renderer;
try { renderer = createRenderer(canvas, MAPS.course.boxes); }
catch (error) { $('menu-description').textContent=error.message; $('play').disabled=true; throw error; }
let preset = 'classic', map = 'course', boxes = MAPS.course.boxes, player = createPlayer(MAPS.course.spawns[0]);
let endless = null;
let playing = false, started = false, completed = false, lockPending = false, checkpoint = 0, runTime = 0;
let runActive = false, respawns = 0, pendingJump = false, sensitivity = 2, fov = 100;
let previous = performance.now(), accumulator = 0, toastUntil = 0, previousDraw = {...player};
let bests = {}, settings = {};
try { bests=JSON.parse(localStorage.getItem('movement-lab-bests-v1')||'{}'); } catch {}
try { settings=JSON.parse(localStorage.getItem('movement-lab-settings-v1')||'{}'); } catch {}
if(!bests||typeof bests!=='object') bests={};
if(!settings||typeof settings!=='object') settings={};
// Preserve records from the original single-course version.
for(const mode of Object.keys(PRESETS)) {
  if(Number.isFinite(bests[mode])&&!Number.isFinite(bests[`course:${mode}`])) bests[`course:${mode}`]=bests[mode];
}
const recordKey = () => `${map}:${preset}`;
const format = seconds => {
  const ms=Math.floor(Math.max(0,seconds)*1000);
  return `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
};
function saveSettings() {
  try { localStorage.setItem('movement-lab-settings-v1',JSON.stringify({preset,map,sensitivity,fov})); } catch {}
}
function toast(message,checkpointNotice=false) {
  $('toast').textContent=message; $('toast').classList.toggle('checkpoint-notice',checkpointNotice);
  $('toast').classList.add('show'); toastUntil=performance.now()+2300;
}
function saveEndlessBest() {
  if(!endless||!MAPS[map].endless||endless.distance<=(bests[recordKey()]||0)) return;
  bests[recordKey()]=Math.floor(endless.distance);
  try {localStorage.setItem('movement-lab-bests-v1',JSON.stringify(bests));} catch {}
}
function clearInput() { keys.clear(); pendingJump=false; }
function reset(full=true) {
  if(full)saveEndlessBest();
  if(full) { checkpoint=0; runTime=0; runActive=false; respawns=0; }
  if(MAPS[map].endless&&(full||!endless)) {
    endless=createEndless();boxes=endless.boxes;renderer.setBoxes(boxes);
  }
  const previousPeak=player.peakSpeed;
  player=createPlayer(endless?endless.spawn:MAPS[map].spawns[checkpoint]||MAPS[map].spawns[0]);
  if(endless) {
    endless.update(player);boxes=endless.boxes;renderer.setBoxes(boxes);
  }
  if(!full) player.peakSpeed=previousPeak;
  previousDraw={...player}; accumulator=0; pendingJump=false;
  completed=false; $('finish').classList.add('hidden');
  updateHud();
}
function pause() {
  if(completed) return;
  saveEndlessBest();
  playing=false; lockPending=false; clearInput(); document.body.classList.remove('playing');
  $('play').disabled=false;
  overlay.classList.remove('hidden');
  if(document.pointerLockElement===canvas) document.exitPointerLock();
  if(started) {
    $('play').innerHTML='RESUME <span>↗</span>';
  }
}
function beginSession() {
  // Start only after the browser confirms pointer lock: the cursor stays hidden
  // and movementX/movementY keep working beyond the edges of the screen.
  if(document.pointerLockElement!==canvas) return;
  lockPending=false; $('play').disabled=false;
  playing=true; started=true; clearInput(); previous=performance.now(); accumulator=0;
  $('input-note').textContent='Mouse captured. Press Esc to release it and pause.';
  overlay.classList.add('hidden'); document.body.classList.add('playing');
}
function mouseCaptureFailed() {
  if(!lockPending) return;
  lockPending=false; playing=false; clearInput(); $('play').disabled=false;
  overlay.classList.remove('hidden'); document.body.classList.remove('playing');
  $('play').innerHTML=(started?'RESUME':'PLAY')+' <span>↗</span>';
  $('input-note').textContent='Mouse capture was blocked. Open this page directly in a desktop browser, then click Enter again.';
  toast('Click Enter to capture the mouse. Check that your browser allows pointer lock.');
}
function play() {
  if(lockPending) return;
  if(completed) reset();
  if(document.pointerLockElement===canvas) {beginSession();return;}
  lockPending=true; $('play').disabled=true;
  $('play').textContent='CAPTURING MOUSE…';
  $('input-note').textContent='Allow mouse capture if your browser asks. Esc releases the mouse.';
  if(!canvas.requestPointerLock) {mouseCaptureFailed();return;}
  try {
    // Keep this call in the click handler so it retains browser user activation.
    const request=canvas.requestPointerLock();
    request?.catch(mouseCaptureFailed);
  } catch { mouseCaptureFailed(); }
}
function choosePreset(value,resetRun=true) {
  if(!PRESETS[value]) return;
  saveEndlessBest();
  // The new preset starts a fresh endless record and route.
  if(endless)endless=null;
  preset=value;
  document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('selected',b.dataset.preset===value));
  $('preset-badge').textContent=PRESETS[preset].title.toUpperCase();
  $('preset-description').textContent=preset==='classic'?'Capped speed · standard air control':'Uncapped speed · strong air control';
  if(resetRun) reset();
  saveSettings(); updateHud();
}
function chooseMap(value,resetRun=true) {
  if(!Object.hasOwn(MAPS,value)) return;
  saveEndlessBest();endless=null;
  map=value; boxes=MAPS[map].boxes; renderer.setBoxes(boxes);
  const selected=MAPS[map], count=selected.spawns.length-1;
  $('map-select').value=map;
  $('map-badge').textContent=selected.title.toUpperCase();
  $('course-title').textContent=selected.title.toUpperCase();
  $('map-description').textContent=selected.description;
  $('map-meta').textContent=selected.endless?'Infinite · checkpoint every 8 blocks':selected.timed?`${selected.difficulty} · ${selected.stages.length} sections · ${count} checkpoints`:selected.difficulty;
  $('stage-markers').innerHTML=selected.stages.map(()=>'<i></i>').join('');
  clearInput();
  if(resetRun) reset();
  saveSettings(); updateHud();
}
function finishRun() {
  completed=true; playing=false; clearInput(); document.body.classList.remove('playing');
  if(document.pointerLockElement===canvas) document.exitPointerLock();
  const key=recordKey(), old=bests[key], clean=respawns===0;
  const isPB=clean&&(!Number.isFinite(old)||runTime<old);
  if(isPB) { bests[key]=runTime; try {localStorage.setItem('movement-lab-bests-v1',JSON.stringify(bests));} catch {} }
  $('finish-course').textContent=MAPS[map].title.toUpperCase()+' COMPLETE';
  $('finish-time').textContent=format(runTime);
  $('finish-note').textContent=`${isPB?'New personal best. ':''}${Math.round(player.peakSpeed)} u/s peak · ${respawns} respawn${respawns===1?'':'s'}. ${clean?'Clean runs count toward your best.':'Checkpoint-assisted run. Finish without respawning to set a best.'}`;
  $('finish').classList.remove('hidden'); $('again').focus(); updateHud();
}
function updateHud() {
  const s=speed(player);
  ui.timer.textContent=format(runTime);
  $('best-label').textContent=MAPS[map].endless?'BEST DISTANCE':'BEST';
  ui.best.textContent=MAPS[map].endless?`${Math.floor(Math.max(bests[recordKey()]||0,endless?.distance||0))} u`:MAPS[map].timed&&Number.isFinite(bests[recordKey()])?format(bests[recordKey()]):'—';
  ui.speed.textContent=Math.round(s);ui['speed-fill'].style.width=`${Math.min(100,s/5)}%`;
  ui['motion-state'].textContent=player.ducked?'CROUCHING':!player.grounded?'IN AIR':keys.has('ShiftLeft')||keys.has('ShiftRight')?'WALKING':'ON GROUND';
  const gain=Math.round(s-player.lastJumpSpeed);
  ui.gain.textContent=!player.grounded&&player.lastJumpSpeed>0?`${gain>=0?'+':''}${gain} SINCE TAKEOFF`:'250 MAX RUN';
  ui.hops.textContent=String(player.hops).padStart(2,'0');
  ui.peak.textContent=String(Math.round(player.peakSpeed)).padStart(3,'0');
  ui['jump-speed'].textContent=String(Math.round(player.lastJumpSpeed)).padStart(3,'0');
  const selected=MAPS[map], currentStage=selected.stages[selected.endless?0:checkpoint];
  ui['progress-count'].textContent=selected.endless?`BLOCK ${endless?.furthestBlock||0}`:selected.timed?`${String(checkpoint+1).padStart(2,'0')} / ${String(selected.stages.length).padStart(2,'0')}`:'SANDBOX';
  ui['stage-name'].textContent=selected.endless?`${endless?.sectionTitle||'Endless'} · ${Math.floor(endless?.distance||0)} u`:currentStage.title;
  ui['stage-tip'].textContent=selected.endless?endless?.tip||currentStage.tip:currentStage.tip;
  document.querySelectorAll('.stages i').forEach((el,i)=>el.classList.toggle('active',i<=checkpoint));
  document.querySelectorAll('[data-key]').forEach(el=>{
    const k=el.dataset.key;
    el.classList.toggle('pressed',keys.has(k)||(k==='ShiftLeft'&&keys.has('ShiftRight'))||(k==='ControlLeft'&&(keys.has('ControlRight')||keys.has('KeyC'))));
  });
}
function tick() {
  if(keys.has('ArrowLeft')) player.yaw-=1.8*DT;
  if(keys.has('ArrowRight')) player.yaw+=1.8*DT;
  const input={
    forward:Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown')),
    side:Number(keys.has('KeyD'))-Number(keys.has('KeyA')),
    walk:keys.has('ShiftLeft')||keys.has('ShiftRight'),
    duck:keys.has('ControlLeft')||keys.has('ControlRight')||keys.has('KeyC'),
    jumpHeld:keys.has('Space'),jumpPressed:pendingJump,
  };
  if(!runActive&&(input.forward||input.side||input.jumpPressed)) runActive=true;
  if(runActive) runTime+=DT;
  previousDraw={...player};
  step(player,input,boxes,PRESETS[preset]); pendingJump=false;
  if(endless) {
    const result=endless.update(player,support(player,boxes,1));
    if(result.shift)previousDraw.z-=result.shift;
    if(result.changed) {boxes=endless.boxes;renderer.setBoxes(boxes);}
    if(result.checkpointSaved) {
      checkpoint=endless.checkpoint;saveEndlessBest();
      toast(`CHECKPOINT ${String(checkpoint).padStart(2,'0')} SAVED — E TO RETURN`,true);
    }
  }
  if(MAPS[map].timed) {
    const ground=support(player,boxes,1);
    if(ground?.checkpoint===checkpoint+1) {
      checkpoint=ground.checkpoint; toast(`CHECKPOINT ${String(checkpoint).padStart(2,'0')} SAVED — E TO RETURN`,true);
    }
    if(ground?.finish&&checkpoint===MAPS[map].spawns.length-1) finishRun();
  }
  if(player.y<Math.min(...boxes.map(b=>b.max[1]))-550) {
    respawns++;reset(false);
    toast(MAPS[map].timed||endless?'BACK AT CHECKPOINT — TIMER CONTINUES':'BACK ON THE PRACTICE FLOOR');
  }
}
function frame(now) {
  const elapsed=Math.min((now-previous)/1000,0.08);previous=now;
  if(playing) {
    accumulator+=elapsed;
    while(accumulator>=DT&&playing) {tick();accumulator-=DT;}
  }
  const alpha=playing?Math.max(0,accumulator/DT):1;
  const camera={...player,x:previousDraw.x+(player.x-previousDraw.x)*alpha,
    y:previousDraw.y+(player.y-previousDraw.y)*alpha,z:previousDraw.z+(player.z-previousDraw.z)*alpha};
  if(!started) {
    const spawn=endless?endless.spawn:MAPS[map].spawns[0];
    Object.assign(camera,{...spawn,y:spawn.y+35,pitch:-0.18});
  }
  renderer.draw(camera,fov);updateHud();
  if(now>toastUntil) $('toast').classList.remove('show');
  requestAnimationFrame(frame);
}
$('play').addEventListener('click',play);
$('play-endless').addEventListener('click',()=>{if(map!=='endless')chooseMap('endless');play();});
$('menu-button').addEventListener('click',()=>playing?pause():$('play').focus());
$('again').addEventListener('click',()=>{reset();play();});
$('finish-settings').addEventListener('click',()=>{reset();pause();});
$('next-course').addEventListener('click',()=>{
  const courses=MAP_LIST.filter(m=>m.timed), index=courses.findIndex(m=>m.id===map);
  chooseMap(courses[(index+1)%courses.length].id);play();
});
document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>choosePreset(b.dataset.preset)));
$('map-select').innerHTML=MAP_LIST.map(m=>`<option value="${m.id}">${m.title} · ${m.difficulty}</option>`).join('');
$('map-select').addEventListener('change',()=>chooseMap($('map-select').value));
for(const name of ['sensitivity','fov']) $(name).addEventListener('input',()=>{
  if(name==='sensitivity') {sensitivity=Number($(name).value);$('sensitivity-value').textContent=sensitivity.toFixed(2);}
  else {fov=Number($(name).value);$('fov-value').textContent=fov;}
  saveSettings();
});
document.addEventListener('keydown',e=>{
  if(e.code==='Escape') {if(playing)pause();return;}
  if(!playing) return;
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab','KeyW','KeyA','KeyS','KeyD','ControlLeft','ControlRight'].includes(e.code)) e.preventDefault();
  if(e.code==='KeyR'&&!e.repeat) {reset();toast('NEW RUN');return;}
  if(e.code==='KeyE'&&!e.repeat) {respawns++;reset(false);toast('CHECKPOINT RESTORED — TIMER CONTINUES');return;}
  if(e.code==='Space'&&!e.repeat) pendingJump=true;
  keys.add(e.code);
});
document.addEventListener('keyup',e=>keys.delete(e.code));
document.addEventListener('pointerlockchange',()=>{
  if(document.pointerLockElement===canvas) {
    if(lockPending) beginSession();
    else if(!playing) document.exitPointerLock();
  } else if(playing) pause();
  else if(lockPending) mouseCaptureFailed();
});
document.addEventListener('pointerlockerror',mouseCaptureFailed);
function look(dx,dy) {
  const scale=sensitivity*0.022*Math.PI/180;
  player.yaw+=dx*scale;player.pitch=Math.max(-1.5,Math.min(1.5,player.pitch-dy*scale));
}
document.addEventListener('mousemove',e=>{
  if(playing&&document.pointerLockElement===canvas)look(e.movementX,e.movementY);
});
document.addEventListener('wheel',e=>{if(playing){e.preventDefault();pendingJump=true;}},{passive:false});
window.addEventListener('blur',()=>{if(playing||lockPending)pause();});
window.addEventListener('pagehide',saveEndlessBest);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(playing||lockPending))pause();});
if(PRESETS[settings.preset]) choosePreset(settings.preset,false);
const requestedMap=new URLSearchParams(window.location?.search||'').get('course');
chooseMap(Object.hasOwn(MAPS,requestedMap)?requestedMap:Object.hasOwn(MAPS,settings.map)?settings.map:'course',false);
if(Number.isFinite(settings.sensitivity))sensitivity=Math.min(5,Math.max(0.2,settings.sensitivity));
if(Number.isFinite(settings.fov))fov=Math.min(120,Math.max(80,settings.fov));
$('sensitivity').value=sensitivity;$('sensitivity-value').textContent=sensitivity.toFixed(2);
$('fov').value=fov;$('fov-value').textContent=fov;
reset();requestAnimationFrame(frame);
