import { DT, PRESETS, createPlayer, step, speed, support } from './physics.js';
import { COURSE, PRACTICE, SPAWNS } from './course.js';
import { createRenderer } from './renderer.js';

const $ = id => document.getElementById(id);
const canvas = $('world'), overlay = $('overlay'), keys = new Set();
const ui = Object.fromEntries(['timer','best','speed','speed-fill','motion-state','gain','hops','peak','jump-speed','progress-count','stage-name','stage-tip'].map(id=>[id,$(id)]));
let renderer;
try { renderer = createRenderer(canvas, COURSE); }
catch (error) { $('menu-description').textContent=error.message; $('play').disabled=true; throw error; }
let preset = 'classic', map = 'course', boxes = COURSE, player = createPlayer(SPAWNS[0]);
let playing = false, started = false, completed = false, lockPending = false, checkpoint = 0, runTime = 0;
let runActive = false, respawns = 0, pendingJump = false, sensitivity = 2, fov = 100;
let previous = performance.now(), accumulator = 0, toastUntil = 0, previousDraw = {...player};
let bests = {}, settings = {};
try { bests=JSON.parse(localStorage.getItem('movement-lab-bests-v1')||'{}'); } catch {}
try { settings=JSON.parse(localStorage.getItem('movement-lab-settings-v1')||'{}'); } catch {}
if(!bests||typeof bests!=='object') bests={};
if(!settings||typeof settings!=='object') settings={};
const format = seconds => {
  const ms=Math.floor(Math.max(0,seconds)*1000);
  return `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
};
function saveSettings() {
  try { localStorage.setItem('movement-lab-settings-v1',JSON.stringify({preset,map,sensitivity,fov})); } catch {}
}
function toast(message) { $('toast').textContent=message; $('toast').classList.add('show'); toastUntil=performance.now()+2300; }
function clearInput() { keys.clear(); pendingJump=false; }
function reset(full=true) {
  if(full) { checkpoint=0; runTime=0; runActive=false; respawns=0; }
  const previousPeak=player.peakSpeed;
  player=createPlayer(SPAWNS[map==='course'?checkpoint:0]);
  if(!full) player.peakSpeed=previousPeak;
  previousDraw={...player}; accumulator=0; pendingJump=false;
  completed=false; $('finish').classList.add('hidden');
  updateHud();
}
function pause() {
  if(completed) return;
  playing=false; lockPending=false; clearInput(); document.body.classList.remove('playing');
  $('play').disabled=false;
  overlay.classList.remove('hidden');
  if(document.pointerLockElement===canvas) document.exitPointerLock();
  if(started) {
    $('menu-eyebrow').textContent='TAKE A BREATH. FIND YOUR LINE.';
    $('menu-title').innerHTML='STAY IN<br>MOTION<span>.</span>';
    $('play').innerHTML='RESUME SESSION <span>↗</span>';
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
  $('play').innerHTML=(started?'RESUME SESSION':'ENTER THE COURSE')+' <span>↗</span>';
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
  preset=value;
  document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('selected',b.dataset.preset===value));
  $('preset-badge').textContent=PRESETS[preset].title.toUpperCase();
  $('preset-description').textContent=preset==='classic'?'Hold Space to hop · capped bhops · landing slowdown':'Hold Space to hop · stronger air control · uncapped speed';
  if(resetRun) reset();
  saveSettings(); updateHud();
}
function chooseMap(value,resetRun=true) {
  if(!['course','free'].includes(value)) return;
  map=value; boxes=map==='course'?COURSE:PRACTICE; renderer.setBoxes(boxes);
  document.querySelectorAll('[data-map]').forEach(b=>b.classList.toggle('selected',b.dataset.map===value));
  $('map-badge').textContent=map==='course'?'COURSE 01':'FREE ROAM';
  if(resetRun) reset();
  saveSettings(); updateHud();
}
function finishRun() {
  completed=true; playing=false; clearInput(); document.body.classList.remove('playing');
  if(document.pointerLockElement===canvas) document.exitPointerLock();
  const old=bests[preset], clean=respawns===0;
  const isPB=clean&&(!Number.isFinite(old)||runTime<old);
  if(isPB) { bests[preset]=runTime; try {localStorage.setItem('movement-lab-bests-v1',JSON.stringify(bests));} catch {} }
  $('finish-time').textContent=format(runTime);
  $('finish-note').textContent=`${isPB?'New personal best. ':''}${Math.round(player.peakSpeed)} u/s peak · ${respawns} respawn${respawns===1?'':'s'}. ${clean?'Clean runs count toward your best.':'Checkpoint-assisted run. Finish without respawning to set a best.'}`;
  $('finish').classList.remove('hidden'); $('again').focus(); updateHud();
}
function updateHud() {
  const s=speed(player);
  ui.timer.textContent=format(runTime);
  ui.best.textContent=map==='course'&&Number.isFinite(bests[preset])?format(bests[preset]):'—';
  ui.speed.textContent=Math.round(s);ui['speed-fill'].style.width=`${Math.min(100,s/5)}%`;
  ui['motion-state'].textContent=player.ducked?'CROUCHING':!player.grounded?'IN AIR':keys.has('ShiftLeft')||keys.has('ShiftRight')?'WALKING':'ON GROUND';
  const gain=Math.round(s-player.lastJumpSpeed);
  ui.gain.textContent=!player.grounded&&player.lastJumpSpeed>0?`${gain>=0?'+':''}${gain} SINCE TAKEOFF`:'250 MAX RUN';
  ui.hops.textContent=String(player.hops).padStart(2,'0');
  ui.peak.textContent=String(Math.round(player.peakSpeed)).padStart(3,'0');
  ui['jump-speed'].textContent=String(Math.round(player.lastJumpSpeed)).padStart(3,'0');
  ui['progress-count'].textContent=map==='course'?`0${checkpoint+1} / 03`:'SANDBOX';
  ui['stage-name'].textContent=map==='free'?'Make your own line.':['Find your momentum.','Carry it through the turn.','Slow down. Stay in control.'][checkpoint];
  ui['stage-tip'].textContent=map==='free'?'A wide floor for strafing, hops, and stopping practice.':['Build speed on the runway. Jump at the edge.','Release W. Match A / D with a smooth mouse turn.','Walk the beam. Crouch under the low ceiling.'][checkpoint];
  document.querySelectorAll('.stages i').forEach((el,i)=>el.classList.toggle('active',map==='free'||i<=checkpoint));
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
  if(map==='course') {
    const ground=support(player,boxes,1);
    if(ground?.checkpoint>checkpoint) {
      checkpoint=ground.checkpoint; toast(`CHECKPOINT 0${checkpoint} SAVED — E TO RETURN`);
    }
    if(ground?.finish&&checkpoint===2) finishRun();
  }
  if(player.y<-550) {
    respawns++;reset(false);
    toast(map==='course'?'BACK AT CHECKPOINT — TIMER CONTINUES':'BACK ON THE PRACTICE FLOOR');
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
  if(!started) Object.assign(camera,{x:210,y:80,z:-80,yaw:-0.08,pitch:-0.25});
  renderer.draw(camera,fov);updateHud();
  if(now>toastUntil) $('toast').classList.remove('show');
  requestAnimationFrame(frame);
}
$('play').addEventListener('click',play);
$('menu-button').addEventListener('click',()=>playing?pause():$('play').focus());
$('again').addEventListener('click',()=>{reset();play();});
$('finish-settings').addEventListener('click',()=>{reset();pause();});
document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>choosePreset(b.dataset.preset)));
document.querySelectorAll('[data-map]').forEach(b=>b.addEventListener('click',()=>chooseMap(b.dataset.map)));
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
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(playing||lockPending))pause();});
if(PRESETS[settings.preset]) choosePreset(settings.preset,false);
if(['course','free'].includes(settings.map))chooseMap(settings.map,false);
if(Number.isFinite(settings.sensitivity))sensitivity=Math.min(5,Math.max(0.2,settings.sensitivity));
if(Number.isFinite(settings.fov))fov=Math.min(120,Math.max(80,settings.fov));
$('sensitivity').value=sensitivity;$('sensitivity-value').textContent=sensitivity.toFixed(2);
$('fov').value=fov;$('fov-value').textContent=fov;
reset();requestAnimationFrame(frame);
