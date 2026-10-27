import { DT, PRESETS, createPlayer, step, speed, support, platformAirspace } from './physics.js';
import { MAPS, MAP_LIST } from './course.js';
import { createEndless } from './endless.js';
import { createRenderer } from './renderer.js';
import { CHECKPOINT_CHIMES, createGameAudio } from './game-audio.js';
import { loadLeaderboard, leaderboardRows } from './leaderboard.js';

const $ = id => document.getElementById(id);
const canvas = $('world'), overlay = $('overlay'), keys = new Set();
const ui = Object.fromEntries(['timer','best','speed','speed-fill','motion-state','gain','hops','peak','jump-speed','progress-count','stage-name','stage-tip'].map(id=>[id,$(id)]));
let renderer, rendererReady = true;
try { renderer = createRenderer(canvas, MAPS.course.boxes); }
catch (error) {
  rendererReady=false;renderer={draw(){},setBoxes(){}};
  $('menu-description').textContent=error.message+' Sound previews and leaderboards are still available.';
  $('play').disabled=true;$('play-endless').disabled=true;
}
let preset = 'classic', map = 'course', boxes = MAPS.course.boxes, player = createPlayer(MAPS.course.spawns[0]);
let endless = null;
let playing = false, started = false, completed = false, lockPending = false, checkpoint = 0, runTime = 0;
let runActive = false, respawns = 0, pendingJump = false, sensitivity = 1, fov = 100;
let previous = performance.now(), accumulator = 0, toastUntil = 0, previousDraw = {...player};
let bests = {}, settings = {};
let knife = null, knifeLoad = null, knifeEnabled = true, knifeSounds = true;
let gameAudio = null, movementSounds = true, checkpointSound = 'pulse', audioVolume = .65;
let fpsWindowStart = null, fpsFrames = 0, leaderboardRequest = 0;
try { bests=JSON.parse(localStorage.getItem('movement-lab-bests-v1')||'{}'); } catch {}
try { settings=JSON.parse(localStorage.getItem('movement-lab-settings-v1')||'{}'); } catch {}
if(!bests||typeof bests!=='object') bests={};
if(!settings||typeof settings!=='object') settings={};
knifeEnabled=settings.knifeEnabled!==false;knifeSounds=settings.knifeSounds!==false;
movementSounds=settings.movementSounds!==false;
if(settings.checkpointSound==='off'||Object.hasOwn(CHECKPOINT_CHIMES,settings.checkpointSound))checkpointSound=settings.checkpointSound;
if(Number.isFinite(settings.audioVolume))audioVolume=Math.max(0,Math.min(1,settings.audioVolume));
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
  try { localStorage.setItem('movement-lab-settings-v1',JSON.stringify({preset,map,sensitivity,sensitivityVersion:2,fov,knifeEnabled,knifeSounds,movementSounds,checkpointSound,audioVolume})); } catch {}
}
async function activateGameAudio() {
  if(!gameAudio) gameAudio=createGameAudio({movementEnabled:movementSounds,checkpointSound,volume:audioVolume,
    onReady:()=>{$('audio-status').textContent='CS2 movement sounds ready';},
    onError:()=>{$('audio-status').textContent='Movement sounds unavailable. Preview retries loading.';},
  });
  if(!gameAudio) {$('audio-status').textContent='Audio is unavailable in this browser.';return null;}
  try {await gameAudio.activate();return gameAudio;}
  catch {$('audio-status').textContent='Sound was blocked. Press Preview to retry.';return null;}
}
async function refreshLeaderboard() {
  const request=++leaderboardRequest, selected=MAPS[map], mode=preset;
  $('leaderboard-title').textContent=selected.title;
  $('leaderboard-mode').textContent=PRESETS[mode].title;
  $('leaderboard-score').textContent=selected.endless?'DISTANCE':'TIME';
  $('leaderboard-rows').innerHTML='';$('leaderboard-status').textContent='Loading records…';
  try {
    const records=await loadLeaderboard(selected.id,mode);
    if(request!==leaderboardRequest)return;
    $('leaderboard-rows').innerHTML=leaderboardRows(records,!!selected.endless);
    $('leaderboard-status').textContent=records.length?`${records.length} published record${records.length===1?'':'s'}`:'No records yet. The owner can add the first one.';
  } catch {if(request===leaderboardRequest)$('leaderboard-status').textContent='Could not load records. Try Refresh.';}
}
function openLeaderboard() {
  if(!MAPS[map].timed&&!MAPS[map].endless)return;
  if(playing)pause();
  $('leaderboard').showModal();void refreshLeaderboard();
}
function loadKnife() {
  if(!rendererReady||!knifeEnabled||knife) return Promise.resolve(knife);
  if(knifeLoad) return knifeLoad;
  $('knife-status').textContent='Loading Butterfly…';
  knifeLoad=import('./butterfly/butterfly-viewmodel.js').then(({createButterflyViewmodel})=>createButterflyViewmodel({
    worldCanvas:canvas,isActive:()=>knifeEnabled&&playing&&document.pointerLockElement===canvas,rareChance:0.15,
  })).then(viewmodel=>{
    knife=viewmodel;knife.audio?.setMuted(!knifeSounds);
    $('knife-status').textContent=knifeEnabled?'Butterfly ready':'Knife hidden';
    return knife;
  }).catch(error=>{
    console.warn('Butterfly could not load',error);knifeLoad=null;
    $('knife-status').textContent=knifeEnabled?'Knife unavailable. Toggle it to retry.':'Knife hidden';
    return null;
  });
  return knifeLoad;
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
  gameAudio?.stopAll();
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
  knife?.equip();
  updateHud();
}
function pause() {
  if(completed) return;
  saveEndlessBest();
  playing=false; lockPending=false; clearInput(); document.body.classList.remove('playing');
  gameAudio?.stopAll();
  knife?.draw(0);
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
  if(!started) knife?.equip();
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
  if(!rendererReady||lockPending) return;
  void activateGameAudio();
  void loadKnife();void knife?.audio?.activate();
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
  $('leaderboard-button').disabled=!selected.timed&&!selected.endless;
  $('stage-markers').innerHTML=selected.stages.map(()=>'<i></i>').join('');
  clearInput();
  if(resetRun) reset();
  saveSettings(); updateHud();
}
function finishRun() {
  gameAudio?.stopAll();
  completed=true; playing=false; clearInput(); document.body.classList.remove('playing');
  knife?.draw(0);
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
  previousDraw={...player};
  step(player,input,boxes,PRESETS[preset]); pendingJump=false;
  gameAudio?.movement(previousDraw,player,input);
  let timerStart=runActive?0:1, timerEnd=1, finished=false;
  if(!runActive) {
    const start=endless?endless.platform(0):boxes[0];
    const crossing=platformAirspace(previousDraw,player,start);
    if(!crossing||crossing.enter>0||crossing.exit<1) {
      runActive=true;
      timerStart=crossing?.enter===0?crossing.exit:0;
    }
  }
  if(endless) {
    const result=endless.update(player,support(player,boxes,1),previousDraw);
    if(result.shift)previousDraw.z-=result.shift;
    if(result.changed) {boxes=endless.boxes;renderer.setBoxes(boxes);}
    if(result.checkpointSaved) {
      gameAudio?.checkpoint();
      checkpoint=endless.checkpoint;saveEndlessBest();
      toast(`CHECKPOINT ${String(checkpoint).padStart(2,'0')} SAVED — E TO RETURN`,true);
    }
  }
  if(MAPS[map].timed) {
    const hits=boxes.filter(b=>b.checkpoint||b.finish).flatMap(box=>{
      const crossing=platformAirspace(previousDraw,player,box);
      return crossing?[{box,time:crossing.enter}]:[];
    }).sort((a,b)=>a.time-b.time);
    for(const {box,time} of hits) {
      if(box.checkpoint===checkpoint+1) {
        gameAudio?.checkpoint();
        checkpoint=box.checkpoint; toast(`CHECKPOINT ${String(checkpoint).padStart(2,'0')} SAVED — E TO RETURN`,true);
      }
      if(box.finish&&runActive&&checkpoint===MAPS[map].spawns.length-1) {
        timerEnd=time;finished=true;break;
      }
    }
  }
  if(runActive) runTime+=DT*Math.max(0,timerEnd-timerStart);
  if(finished) {finishRun();return;}
  if(player.y<Math.min(...boxes.map(b=>b.max[1]))-550) {
    respawns++;reset(false);
    toast(MAPS[map].timed||endless?'BACK AT CHECKPOINT — TIMER CONTINUES':'BACK ON THE PRACTICE FLOOR');
  }
}
function frame(now) {
  if(document.hidden||fpsWindowStart===null||now-fpsWindowStart>2000||now<fpsWindowStart) {
    fpsWindowStart=now;fpsFrames=0;if(document.hidden)$('fps').textContent='—';
  } else if(++fpsFrames&&now-fpsWindowStart>=500) {
    $('fps').textContent=Math.round(fpsFrames*1000/(now-fpsWindowStart));fpsWindowStart=now;fpsFrames=0;
  }
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
  const target=completed?null:endless?endless.platform((checkpoint+1)*8):
    MAPS[map].timed?boxes.find(b=>b.checkpoint===checkpoint+1)||boxes.find(b=>b.finish):null;
  renderer.draw(camera,fov,target);knife?.draw(elapsed,fov);updateHud();
  if(now>toastUntil) $('toast').classList.remove('show');
  requestAnimationFrame(frame);
}
$('play').addEventListener('click',play);
$('leaderboard-button').addEventListener('click',openLeaderboard);
$('finish-leaderboard').addEventListener('click',openLeaderboard);
$('leaderboard-close').addEventListener('click',()=>$('leaderboard').close());
$('leaderboard-refresh').addEventListener('click',()=>void refreshLeaderboard());
$('leaderboard').addEventListener('close',()=>{leaderboardRequest++;});
$('movement-sounds').checked=movementSounds;
$('movement-sounds').addEventListener('change',()=>{
  movementSounds=$('movement-sounds').checked;gameAudio?.setMovementEnabled(movementSounds);
  if(movementSounds)void activateGameAudio();saveSettings();
});
$('checkpoint-sound').value=checkpointSound;$('checkpoint-preview').disabled=checkpointSound==='off';
$('checkpoint-sound').addEventListener('change',async()=>{
  checkpointSound=$('checkpoint-sound').value;saveSettings();$('checkpoint-preview').disabled=checkpointSound==='off';
  const audio=await activateGameAudio();if(audio){audio.checkpointSound=checkpointSound;audio.checkpoint();}
});
$('checkpoint-preview').addEventListener('click',async()=>{const audio=await activateGameAudio();audio?.checkpoint(checkpointSound);});
$('audio-volume').value=Math.round(audioVolume*100);$('audio-volume-value').textContent=`${Math.round(audioVolume*100)}%`;
$('audio-volume').addEventListener('input',()=>{
  audioVolume=Number($('audio-volume').value)/100;gameAudio?.setVolume(audioVolume);
  $('audio-volume-value').textContent=`${Math.round(audioVolume*100)}%`;saveSettings();
});
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
$('knife-enabled').checked=knifeEnabled;$('knife-sounds').checked=knifeSounds;
$('knife-enabled').addEventListener('change',()=>{
  knifeEnabled=$('knife-enabled').checked;saveSettings();
  if(knifeEnabled) { if(knife) {knife.equip();$('knife-status').textContent='Butterfly ready';} else void loadKnife(); }
  else {$('knife-status').textContent='Knife hidden';knife?.draw(0);}
});
$('knife-sounds').addEventListener('change',()=>{
  knifeSounds=$('knife-sounds').checked;knife?.audio?.setMuted(!knifeSounds);saveSettings();
});
for(const name of ['sensitivity','fov']) $(name).addEventListener('input',()=>{
  if(name==='sensitivity') {sensitivity=Number($(name).value);$('sensitivity-value').textContent=sensitivity.toFixed(2)+'×';}
  else {fov=Number($(name).value);$('fov-value').textContent=fov;}
  saveSettings();
});
document.addEventListener('keydown',e=>{
  if(e.code==='Escape') {if(playing)pause();return;}
  if(!playing) return;
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab','KeyW','KeyA','KeyS','KeyD','ControlLeft','ControlRight'].includes(e.code)) e.preventDefault();
  if(e.code==='KeyQ'&&!e.repeat) {reset();toast('NEW RUN');return;}
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
  const scale=sensitivity*0.066*Math.PI/180;
  player.yaw+=dx*scale;player.pitch=Math.max(-1.5,Math.min(1.5,player.pitch-dy*scale));
}
document.addEventListener('mousemove',e=>{
  if(playing&&document.pointerLockElement===canvas)look(e.movementX,e.movementY);
});
document.addEventListener('wheel',e=>{if(playing){e.preventDefault();pendingJump=true;}},{passive:false});
window.addEventListener('blur',()=>{if(playing||lockPending)pause();});
window.addEventListener('pagehide',saveEndlessBest);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(playing||lockPending))pause();});
if(Number.isFinite(settings.sensitivity)) {
  const multiplier=settings.sensitivityVersion===2?settings.sensitivity:settings.sensitivity/2;
  sensitivity=Math.min(5,Math.max(0.1,multiplier));
}
if(Number.isFinite(settings.fov))fov=Math.min(120,Math.max(80,settings.fov));
if(PRESETS[settings.preset]) choosePreset(settings.preset,false);
const requestedMap=new URLSearchParams(window.location?.search||'').get('course');
chooseMap(Object.hasOwn(MAPS,requestedMap)?requestedMap:Object.hasOwn(MAPS,settings.map)?settings.map:'course',false);
$('sensitivity').value=sensitivity;$('sensitivity-value').textContent=sensitivity.toFixed(2)+'×';
$('fov').value=fov;$('fov-value').textContent=fov;
reset();requestAnimationFrame(frame);
if(knifeEnabled&&rendererReady) void loadKnife();else $('knife-status').textContent=rendererReady?'Knife hidden':'Knife unavailable without WebGL';
