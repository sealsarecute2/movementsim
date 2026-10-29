import { DT, PRESETS, createPlayer, step, speed, support, platformAirspace } from './physics.js';
import { MAPS, MAP_LIST, COMMUNITY_MAPS } from './course.js';
import { createEndless } from './endless.js';
import { createRenderer, projectWorldPoint } from './renderer.js';
import { normaliseSkybox } from './skybox.js';
import { CHECKPOINT_CHIMES, createGameAudio } from './game-audio.js';
import { loadLeaderboard, leaderboardRows, hasLeaderboard } from './leaderboard.js';
import { mapPreviewSVG, createGalleryEntries, createMenuSlideshow, captureMapScreenshot } from './menu.js';
import { MenuMusic } from './menu-music.js';
import { loadSourceMap } from './source-map.js';
import { createSourceRuntime } from './source-runtime.js';
import { hydrateParkourMap } from './parkour-map.js';
import { MULTIPLAYER_CONFIG } from './multiplayer-config.js';
import { MultiplayerRoom, ROOM_LIMIT, displayRoomCode, roomPlayerName, roomPlayerSpawn } from './multiplayer.js';

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
let sourceRuntime=null,sourceLoadGeneration=0,sourceLoadController=null;
let menuMode='main', mainView='home', slideshow=null, capturedMaps=0, screenshotCanvas=null;
let playing = false, started = false, completed = false, lockPending = false, checkpoint = 0, runTime = 0;
let runActive = false, respawns = 0, pendingJump = false, sensitivity = 1, fov = 100;
let previous = performance.now(), accumulator = 0, toastUntil = 0, previousDraw = {...player};
let bests = {}, settings = {};
let knife = null, knifeLoad = null, knifeEnabled = true, knifeSounds = true;
let gameAudio = null, movementSounds = true, checkpointSound = 'pulse', audioVolume = .65;
let windowFocused=document.hasFocus?.()??true,musicEnabled=false,musicVolume=.35;
let fpsWindowStart = null, fpsFrames = 0, leaderboardRequest = 0, leaderboardMap = null;
let room=null,roomStarting=false,roomApplyingCourse=false,roomUiAt=-Infinity;
let pendingRunRestore=null;
try{pendingRunRestore=JSON.parse(sessionStorage.getItem('movement-lab-run-v1')||'null');}catch{}
try { bests=JSON.parse(localStorage.getItem('movement-lab-bests-v1')||'{}'); } catch {}
try { settings=JSON.parse(localStorage.getItem('movement-lab-settings-v1')||'{}'); } catch {}
if(!bests||typeof bests!=='object') bests={};
if(!settings||typeof settings!=='object') settings={};
let crosshair = normaliseCrosshair(settings.crosshair);
let skybox = normaliseSkybox(settings.skybox);
let shadersEnabled = settings.shadersEnabled===true;
knifeEnabled=settings.knifeEnabled!==false;knifeSounds=settings.knifeSounds!==false;
movementSounds=settings.movementSounds!==false;
if(settings.checkpointSound==='off'||Object.hasOwn(CHECKPOINT_CHIMES,settings.checkpointSound))checkpointSound=settings.checkpointSound;
if(Number.isFinite(settings.audioVolume))audioVolume=Math.max(0,Math.min(1,settings.audioVolume));
musicEnabled=settings.musicEnabled===true;
if(Number.isFinite(settings.musicVolume))musicVolume=Math.max(0,Math.min(1,settings.musicVolume));
const menuMusic=new MenuMusic({enabled:musicEnabled,volume:musicVolume,onStatus:message=>{$('menu-music-status').textContent=message;}});
function updateMenuMusic() {
  menuMusic.setActive(!playing&&!completed&&!overlay.classList.contains('hidden'),windowFocused&&!document.hidden);
}
function silenceBackgroundAudio() {
  gameAudio?.stopAll();knife?.audio?.stopAll?.();knife?.audio?.setMuted(true);
  for(const context of [gameAudio?.context,knife?.audio?.context])try{void context?.suspend?.()?.catch?.(()=>{});}catch{}
}
// Preserve records from the original single-course version.
for(const mode of Object.keys(PRESETS)) {
  if(Number.isFinite(bests[mode])&&!Number.isFinite(bests[`course:${mode}`])) bests[`course:${mode}`]=bests[mode];
}
const recordKey = () => `${map}${MAPS[map].revision>1?':v'+MAPS[map].revision:''}:${preset}`;
const format = seconds => {
  const ms=Math.floor(Math.max(0,seconds)*1000);
  return `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
};
function saveSettings() {
  try { localStorage.setItem('movement-lab-settings-v1',JSON.stringify({preset,map,sensitivity,sensitivityVersion:2,fov,knifeEnabled,knifeSounds,movementSounds,checkpointSound,audioVolume,crosshair,skybox,shadersEnabled,musicEnabled,musicVolume})); } catch {}
}
function clearSavedRun() {
  try{const saved=JSON.parse(sessionStorage.getItem('movement-lab-run-v1')||'null');if(saved?.map===map)sessionStorage.removeItem('movement-lab-run-v1');}catch{}
}
function saveRunCheckpoint() {
  const selected=MAPS[map];if(!started||completed||selected.endless||!selected.timed&&!selected.community)return;
  const snapshot={map,preset,revision:selected.revision||1,checkpoint,runTime,respawns,runActive,started:true};
  if(map==='local-map')snapshot.geometry=boxes.sourceMap;
  try{sessionStorage.setItem('movement-lab-run-v1',JSON.stringify(snapshot,(key,value)=>key==='sourceMap'?undefined:value));}catch{}
}
function restoreSavedRun(snapshot) {
  if(!snapshot||snapshot.map!==map||snapshot.preset!==preset||snapshot.revision!==(MAPS[map].revision||1)||!Number.isSafeInteger(snapshot.checkpoint)||snapshot.checkpoint<0||snapshot.checkpoint>=MAPS[map].spawns.length||!Number.isFinite(snapshot.runTime)||snapshot.runTime<0||snapshot.runTime>86400||!Number.isSafeInteger(snapshot.respawns)||snapshot.respawns<0)return false;
  checkpoint=snapshot.checkpoint;runTime=snapshot.runTime;respawns=snapshot.respawns+(snapshot.runActive?1:0);runActive=snapshot.runActive===true;
  reset(false);started=true;playing=false;lockPending=false;clearInput();captureButtons();showPause();saveRunCheckpoint();
  $('pause-input-note').textContent='Run restored at your saved checkpoint. Continue captures the mouse.';
  return true;
}
function normaliseCrosshair(value) {
  const raw=value&&typeof value==='object'?value:{};
  const bounded=(n,min,max,fallback)=>Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;
  return {style:['default','dot','cross'].includes(raw.style)?raw.style:'default',
    red:Math.round(bounded(raw.red,0,255,221)),green:Math.round(bounded(raw.green,0,255,221)),
    blue:Math.round(bounded(raw.blue,0,255,221)),scale:bounded(raw.scale,.5,3,1)};
}
function updateCrosshair() {
  const colour=`rgb(${crosshair.red}, ${crosshair.green}, ${crosshair.blue})`;
  for(const id of ['crosshair','crosshair-preview']) {
    $(id).className=`reticle reticle--${crosshair.style}`;
    $(id).style.color=colour;$(id).style.setProperty('--reticle-scale',String(crosshair.scale));
  }
  $('crosshair-style').value=crosshair.style;
  for(const channel of ['red','green','blue']) {
    $('crosshair-'+channel).value=crosshair[channel];$('crosshair-'+channel+'-value').textContent=crosshair[channel];
  }
  $('crosshair-colour-value').textContent='#'+['red','green','blue'].map(c=>crosshair[c].toString(16).padStart(2,'0')).join('').toUpperCase();
  $('crosshair-scale').value=crosshair.scale;$('crosshair-scale-value').textContent=crosshair.scale.toFixed(2)+'×';
}
async function activateGameAudio() {
  if(!windowFocused||document.hidden)return null;
  if(!gameAudio) gameAudio=createGameAudio({movementEnabled:movementSounds,checkpointSound,volume:audioVolume,
    onReady:()=>{$('audio-status').textContent='CS2 movement sounds ready';},
    onError:()=>{$('audio-status').textContent='Movement sounds unavailable. Preview retries loading.';},
  });
  if(!gameAudio) {$('audio-status').textContent='Audio is unavailable in this browser.';return null;}
  try {await gameAudio.activate();if(!windowFocused||document.hidden){silenceBackgroundAudio();return null;}return gameAudio;}
  catch {$('audio-status').textContent='Sound was blocked. Press Preview to retry.';return null;}
}
async function refreshLeaderboard() {
  const request=++leaderboardRequest, selected=MAPS[leaderboardMap||map], mode=preset;
  $('leaderboard-title').textContent=selected.title;
  $('leaderboard-mode').textContent=PRESETS[mode].title;
  $('leaderboard-score').textContent=selected.endless?'DISTANCE':'TIME';
  $('leaderboard-rows').innerHTML='';$('leaderboard-status').textContent='Loading records…';
  try {
    const records=await loadLeaderboard(selected.id,mode,{revision:selected.revision||1});
    if(request!==leaderboardRequest)return;
    $('leaderboard-rows').innerHTML=leaderboardRows(records,!!selected.endless);
    $('leaderboard-status').textContent=records.length?`${records.length} published record${records.length===1?'':'s'}`:'No records yet. The owner can add the first one.';
  } catch {if(request===leaderboardRequest)$('leaderboard-status').textContent='Could not load records. Try Refresh.';}
}
function openLeaderboard(value=map) {
  const selected=typeof value==='string'&&Object.hasOwn(MAPS,value)?value:map;
  if(!hasLeaderboard(selected,MAPS[selected].revision||1))return;
  leaderboardMap=selected;
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
    knife=viewmodel;knife.audio?.setMuted(!knifeSounds||!windowFocused||!!document.hidden);
    if(!windowFocused||document.hidden)silenceBackgroundAudio();
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
function spawnForPlayer(spawn){return room?.busy?roomPlayerSpawn(spawn,room.slot,boxes):spawn;}
function reset(full=true) {
  gameAudio?.stopAll();
  if(sourceRuntime)clearInput();
  if(full)clearSavedRun();
  if(full)saveEndlessBest();
  if(full) { checkpoint=0; runTime=0; runActive=false; respawns=0; }
  if(MAPS[map].endless&&(full||!endless)) {
    endless=createEndless(room?.busy?room.course?.seed:undefined);boxes=endless.boxes;renderer.setBoxes(boxes);
  }
  const previousPeak=player.peakSpeed;
  player=createPlayer(spawnForPlayer(endless?endless.spawn:MAPS[map].spawns[checkpoint]||MAPS[map].spawns[0]));
  sourceRuntime?.reset(checkpoint);
  if(endless) {
    endless.update(player);boxes=endless.boxes;renderer.setBoxes(boxes);
  }
  if(!full) player.peakSpeed=previousPeak;
  previousDraw={...player}; accumulator=0; pendingJump=false;
  completed=false; $('finish').classList.add('hidden');
  knife?.equip();
  updateHud();
}
function captureButtons(pending=false) {
  for(const id of ['play','continue','play-endless','play-sandbox']) $(id).disabled=!rendererReady||pending;
  $('play').innerHTML=pending?'CAPTURING MOUSE…':'START COURSE <span>↗</span>';
  $('continue').innerHTML=pending?'CAPTURING MOUSE…':'CONTINUE <span>↗</span>';
}
function showMain(view='home',focus=true) {
  if(lockPending){lockPending=false;captureButtons();}
  menuMode='main';mainView=view;
  overlay.dataset.menu='main';overlay.classList.remove('hidden');
  $('main-menu').classList.remove('hidden');$('pause-menu').classList.add('hidden');
  document.body.classList.add('main-menu-open');
  for(const name of ['home','maps','rooms','settings']) $(name+'-view').classList.toggle('hidden',name!==view);
  overlay.scrollTop=0;
  updateMenuMusic();
  if(focus) $(view==='home'?'open-map-select':view==='maps'?'maps-back':view==='rooms'?'rooms-back':'settings-back').focus();
}
function showPause() {
  menuMode='pause';overlay.dataset.menu='pause';overlay.classList.remove('hidden');
  $('main-menu').classList.add('hidden');$('pause-menu').classList.remove('hidden');
  document.body.classList.remove('main-menu-open');updateMenuMusic();$('continue').focus();
}
function returnToMain(view='home') {
  saveEndlessBest();playing=false;lockPending=false;started=false;clearInput();
  document.body.classList.remove('playing');gameAudio?.stopAll();knife?.draw(0);
  if(document.pointerLockElement===canvas)document.exitPointerLock();
  reset();captureButtons();showMain(view);
}
function pause() {
  if(completed) return;
  saveEndlessBest();saveRunCheckpoint();playing=false;lockPending=false;clearInput();
  document.body.classList.remove('playing');gameAudio?.stopAll();knife?.draw(0);captureButtons();
  if(started)showPause();else showMain(mainView);
  if(document.pointerLockElement===canvas)document.exitPointerLock();
}
function beginSession() {
  // Start only after the browser confirms pointer lock: the cursor stays hidden
  // and movementX/movementY keep working beyond the edges of the screen.
  if(document.pointerLockElement!==canvas) return;
  if(!started) knife?.equip();
  lockPending=false;captureButtons();
  playing=true; started=true; clearInput(); previous=performance.now(); accumulator=0;
  $('input-note').textContent='Mouse captured. Press Esc to release it and pause.';
  overlay.classList.add('hidden');document.body.classList.remove('main-menu-open');document.body.classList.add('playing');updateMenuMusic();
  saveRunCheckpoint();
}
function mouseCaptureFailed() {
  if(!lockPending) return;
  lockPending=false;playing=false;clearInput();captureButtons();
  overlay.classList.remove('hidden'); document.body.classList.remove('playing');
  if(started)showPause();else showMain(mainView);
  $('pause-input-note').textContent='Mouse capture was blocked. Click Continue to retry.';
  $('menu-description').textContent='Mouse capture was blocked. Click a start button to retry.';
  $('input-note').textContent='Mouse capture was blocked. Open this page directly in a desktop browser, then click Start Course again.';
  toast('Mouse capture was blocked. Check that your browser allows pointer lock.');
}
function play() {
  if(!rendererReady||lockPending||!windowFocused||document.hidden)return;
  void activateGameAudio();
  void loadKnife();void knife?.audio?.activate();
  if(completed) reset();
  if(document.pointerLockElement===canvas) {beginSession();return;}
  lockPending=true;captureButtons(true);
  $('pause-input-note').textContent='Allow mouse capture if your browser asks.';
  if(rendererReady)$('menu-description').textContent='';
  $('input-note').textContent='Allow mouse capture if your browser asks. Esc releases the mouse.';
  if(!canvas.requestPointerLock) {mouseCaptureFailed();return;}
  try {
    // Keep this call in the click handler so it retains browser user activation.
    const request=canvas.requestPointerLock();
    request?.catch(mouseCaptureFailed);
  } catch { mouseCaptureFailed(); }
}
function choosePreset(value,resetRun=true) {
  if(room?.busy&&!roomApplyingCourse){toast('LEAVE THE ROOM TO CHANGE PHYSICS');return;}
  if(!PRESETS[value]) return;
  if(resetRun)try{sessionStorage.removeItem('movement-lab-run-v1');pendingRunRestore=null;}catch{}
  saveEndlessBest();
  // The new preset starts a fresh endless record and route.
  if(endless)endless=null;
  preset=value;
  document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('selected',b.dataset.preset===value));
  $('preset-badge').textContent=PRESETS[preset].title.toUpperCase();
  $('pause-map').textContent=MAPS[map].title+' / '+PRESETS[preset].title;
  $('preset-description').textContent=preset==='classic'?'Capped speed · standard air control':'Uncapped speed · strong air control';
  if(resetRun) reset();
  saveSettings(); updateHud();
}
function chooseMap(value,resetRun=true,preserveSavedRun=false) {
  if(room?.busy&&!roomApplyingCourse){toast('LEAVE THE ROOM TO CHANGE MAPS');return;}
  if(!Object.hasOwn(MAPS,value)) return;
  if(!preserveSavedRun){try{sessionStorage.removeItem('movement-lab-run-v1');}catch{}pendingRunRestore=null;}
  sourceLoadGeneration++;sourceLoadController?.abort();
  $('source-map-status').textContent='Lightweight parkour geometry. Local imports stay in this tab.';
  saveEndlessBest();endless=null;
  map=value; boxes=MAPS[map].boxes; renderer.setBoxes(boxes);
  sourceRuntime=boxes.sourceMap?createSourceRuntime(boxes.sourceMap):null;
  const selected=MAPS[map], count=selected.spawns.length-1;
  $('selected-map-title').textContent=selected.title;
  $('pause-map').textContent=selected.title+' / '+PRESETS[preset].title;
  document.querySelectorAll('[data-map]').forEach(card=>{
    card.classList.toggle('selected',card.dataset.map===map);
    card.setAttribute('aria-pressed',String(card.dataset.map===map));
  });
  $('map-badge').textContent=selected.title.toUpperCase();
  $('course-title').textContent=selected.title.toUpperCase();
  $('map-description').textContent=selected.description;
  $('map-meta').textContent=selected.community?`Community map · ${selected.stages.length} sections`:selected.endless?'Infinite · 12 section types':selected.timed?`${selected.stages.length} sections · ${count} checkpoints${selected.features?.length?' · '+selected.features.join(' / '):''}`:'Sandbox · free movement';
  $('map-credit').textContent=selected.community?(boxes.sourceMap?.importedGeometry?'Local import · original brush shapes · untextured geometry.':`Map: ${selected.author||'local import'}. Parkour platforms only · plain blocks · ordered checkpoints.`):'';
  $('map-source-link').classList.toggle('hidden',!selected.source);
  if(selected.source)$('map-source-link').href=selected.source;
  $('leaderboard-button').disabled=!hasLeaderboard(selected.id,selected.revision||1);
  $('stage-markers').innerHTML=selected.stages.map(()=>'<i></i>').join('');
  clearInput();
  if(resetRun) reset();
  saveSettings(); updateHud();
}
async function selectCommunityMap(metadata,file=null,restore=false) {
  if(room?.busy&&!roomApplyingCourse){toast('LEAVE THE ROOM TO CHANGE MAPS');return;}
  if(playing||lockPending)pause();
  if(MAPS[metadata.id]&&!file){chooseMap(metadata.id,true,restore);if(restore){restoreSavedRun(pendingRunRestore);pendingRunRestore=null;}return;}
  sourceLoadController?.abort();const generation=++sourceLoadGeneration;
  const controller=new AbortController();sourceLoadController=controller;
  const status=$('source-map-status');status.textContent=`Loading ${metadata.title}…`;
  $('import-source-map').disabled=true;
  try {
    let input;
    if(file){if(file.size>180*1024*1024)throw Error('Map files must be smaller than 180 MB.');input=await file.arrayBuffer();}
    else{
      const response=await fetch(metadata.geometry?metadata.geometry+'?v='+(metadata.revision||1):metadata.archive,{signal:controller.signal});
      if(!response.ok)throw Error('The map download failed. Select the map to retry.');
      if(metadata.geometry)input=await response.json();
      else{
      const total=Number(response.headers.get('content-length'))||0;
      if(total>180*1024*1024)throw Error('This map archive is too large.');
      if(response.body?.getReader){
        const reader=response.body.getReader(),chunks=[];let received=0;
        while(true){const {done,value}=await reader.read();if(done)break;received+=value.length;if(received>180*1024*1024){await reader.cancel();throw Error('This map archive is too large.');}chunks.push(value);status.textContent=`Loading ${metadata.title} · ${(received/1048576).toFixed(1)}${total?' / '+(total/1048576).toFixed(1):''} MB`;}
        input=new Uint8Array(received);let offset=0;for(const chunk of chunks){input.set(chunk,offset);offset+=chunk.length;}
      } else input=await response.arrayBuffer();
      }
    }
    if(generation!==sourceLoadGeneration)return;
    status.textContent=`Preparing ${metadata.title}…`;
    const imported=metadata.geometry&&!file?hydrateParkourMap(input):await loadSourceMap(input,metadata);
    if(generation!==sourceLoadGeneration)return;
    MAPS[metadata.id]={id:metadata.id,title:metadata.title,revision:imported.revision||metadata.revision||1,timed:imported.greybox?imported.finishPad!==null:!!imported.finish,community:true,author:metadata.author,source:metadata.source,
      description:metadata.author?'Parkour route from the community map by '+metadata.author+'.':'An imported map with its original solid brush shapes.',boxes:imported.boxes,spawns:imported.spawns,stages:imported.stages};
    chooseMap(metadata.id,true,restore);
    if(restore)restoreSavedRun(pendingRunRestore);pendingRunRestore=null;
    status.textContent=`${metadata.title} ready.${imported.importedGeometry?' Original brush shapes preserved.':''} Choose Bhop practice for uncapped movement.`;
  } catch(error){if(generation===sourceLoadGeneration&&error.name!=='AbortError')status.textContent=error.message||'Could not load this map. Choose another file or select the map to retry.';}
  finally{if(generation===sourceLoadGeneration||!sourceLoadController||sourceLoadController===controller)$('import-source-map').disabled=false;}
}
function finishRun() {
  if(completed)return;
  clearSavedRun();
  gameAudio?.stopAll();
  completed=true; playing=false; clearInput(); document.body.classList.remove('playing');updateMenuMusic();
  knife?.draw(0);
  if(document.pointerLockElement===canvas) document.exitPointerLock();
  const key=recordKey(), old=bests[key], clean=respawns===0;
  const isPB=clean&&(!Number.isFinite(old)||runTime<old);
  if(isPB) { bests[key]=runTime; try {localStorage.setItem('movement-lab-bests-v1',JSON.stringify(bests));} catch {} }
  $('finish-course').textContent=MAPS[map].title.toUpperCase()+' COMPLETE';
  $('finish-time').textContent=format(runTime);
  $('finish-note').textContent=`${isPB?'New personal best. ':''}${Math.round(player.peakSpeed)} u/s peak · ${respawns} respawn${respawns===1?'':'s'}. ${clean?'Clean runs count toward your best.':'Checkpoint-assisted run. Finish without respawning to set a best.'}`;
  $('finish-leaderboard').classList.toggle('hidden',!hasLeaderboard(map,MAPS[map].revision||1));
  gameAudio?.finish();
  $('finish').classList.remove('hidden'); $('again').focus(); updateHud();
}
function updateHud() {
  const s=player.ladder?Math.hypot(player.vx,player.vy,player.vz):speed(player);
  ui.timer.textContent=format(runTime);
  $('best-label').textContent=MAPS[map].endless?'BEST DISTANCE':'BEST';
  ui.best.textContent=MAPS[map].endless?`${Math.floor(Math.max(bests[recordKey()]||0,endless?.distance||0))} u`:MAPS[map].timed&&Number.isFinite(bests[recordKey()])?format(bests[recordKey()]):'—';
  ui.speed.textContent=Math.round(s);ui['speed-fill'].style.width=`${Math.min(100,s/5)}%`;
  ui['motion-state'].textContent=player.ladder?'ON LADDER':player.ducked?'CROUCHING':!player.grounded?'IN AIR':keys.has('ShiftLeft')||keys.has('ShiftRight')?'WALKING':'ON GROUND';
  const gain=Math.round(s-player.lastJumpSpeed);
  ui.gain.textContent=player.ladder?(player.vy>1?'CLIMBING':player.vy< -1?'DESCENDING':'HOLDING'):!player.grounded&&player.lastJumpSpeed>0?`${gain>=0?'+':''}${gain} SINCE TAKEOFF`:'250 MAX RUN';
  ui.hops.textContent=String(player.hops).padStart(2,'0');
  ui.peak.textContent=String(Math.round(player.peakSpeed)).padStart(3,'0');
  ui['jump-speed'].textContent=String(Math.round(player.lastJumpSpeed)).padStart(3,'0');
  const selected=MAPS[map], currentStage=selected.stages[selected.endless?0:checkpoint];
  ui['progress-count'].textContent=selected.endless?`BLOCK ${endless?.furthestBlock||0}`:selected.timed?`${String(checkpoint+1).padStart(2,'0')} / ${String(selected.stages.length).padStart(2,'0')}`:selected.community?'IMPORTED MAP':'SANDBOX';
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
  if(sourceRuntime){
    const first=MAPS[map].spawns[0];
    if(!runActive&&Math.hypot(player.x-first.x,player.z-first.z)>96)runActive=true;
    if(runActive)runTime+=DT;
    for(const event of sourceRuntime.step(player,previousDraw,DT)){
      if(event.type==='portal'){Object.assign(player,spawnForPlayer(player));previousDraw={...player};}
      if(event.type==='respawn'){respawns++;reset(false);saveRunCheckpoint();toast('BACK AT CHECKPOINT — TIMER CONTINUES');return;}
      if(event.type==='teleport'){
        previousDraw={...player};
        const destination=event.destination||boxes.sourceMap.destinations.get(event.target),index=MAPS[map].spawns.findIndex(s=>Math.hypot(s.x-destination.x,s.z-destination.z)<1&&Math.abs(s.y-destination.y)<=18);
        if(runActive&&index>=0&&index<=checkpoint)respawns++;
      }
      if(event.type==='checkpoint'){checkpoint=event.stage;saveRunCheckpoint();gameAudio?.checkpoint();toast(`${MAPS[map].stages[checkpoint].title.toUpperCase()} SAVED — E TO RETURN`,true);}
      if(event.type==='finish'){finishRun();return;}
    }
    if(player.y<boxes.sourceMap.killHeight){respawns++;reset(false);toast('BACK AT CHECKPOINT — TIMER CONTINUES');}
    return;
  }
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
        checkpoint=box.checkpoint;saveRunCheckpoint();toast(`CHECKPOINT ${String(checkpoint).padStart(2,'0')} SAVED — E TO RETURN`,true);
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
  const sourcePortal=boxes.sourceMap?.portals?.find(p=>p.from===checkpoint);
  const target=completed?null:endless?endless.platform((checkpoint+1)*8):
    MAPS[map].timed?(sourcePortal?boxes[sourcePortal.exitPad]:boxes.find(b=>b.checkpoint===checkpoint+1)||boxes.sourceMap?.finishArea||boxes.find(b=>b.finish)):null;
  const galleryVisible=menuMode==='main'&&!overlay.classList.contains('hidden')&&!document.hidden;
  if(rendererReady&&galleryVisible&&capturedMaps<galleryMaps.length&&screenshotCanvas) {
    const i=capturedMaps++, image=slides[i];
    try {
      const entry=galleryMaps[i];
      const shot=entry.thumbnail||captureMapScreenshot({renderer,canvas,map:entry.map,view:entry.view,restoreBoxes:boxes,restoreSkybox:skybox,
        aspect:$('gallery-slides').clientWidth/$('gallery-slides').clientHeight||1,skybox,snapshot:screenshotCanvas});
      if(shot){image.src=shot;image.classList.add('is-ready');}
    } catch { /* Gameplay and settings remain usable if screenshots are blocked. */ }
    if(capturedMaps===galleryMaps.length)renderer.releaseCaptures?.();
  }
  const remotePlayers=room?.active?room.remotePlayers(endless?.originZ||0):[];
  renderer.draw(camera,fov,target,started?camera:null,remotePlayers);knife?.draw(elapsed,fov);updateHud();
  drawRoomLabels(camera,remotePlayers);
  if(room?.busy&&now-roomUiAt>=250){roomUiAt=now;updateRoomUi();}
  slideshow?.step(now,galleryVisible);
  if(now>toastUntil) $('toast').classList.remove('show');
  requestAnimationFrame(frame);
}
$('play').addEventListener('click',play);
$('continue').addEventListener('click',play);
$('open-map-select').addEventListener('click',()=>{
  if(room?.busy){showMain('rooms');return;}
  if(!MAPS[map].timed)chooseMap('course');showMain('maps');
});
$('open-settings').addEventListener('click',()=>showMain('settings'));
$('open-rooms').addEventListener('click',()=>{if(!room?.busy){$('room-map').value=map==='local-map'?'course':map;$('room-preset').value=preset;}showMain('rooms');updateRoomUi();});
$('rooms-back').addEventListener('click',()=>showMain());
$('maps-back').addEventListener('click',()=>showMain());
$('settings-back').addEventListener('click',()=>showMain());
$('back-to-main').addEventListener('click',()=>returnToMain());
$('play-sandbox').addEventListener('click',()=>{if(lockPending)return;if(room?.busy){showMain('rooms');return;}chooseMap('free');play();});
const timedMaps=MAP_LIST.filter(m=>m.timed),galleryMaps=createGalleryEntries(MAP_LIST,COMMUNITY_MAPS);
$('map-grid').classList.toggle('single-map',timedMaps.length===1);
$('map-grid').innerHTML=timedMaps.map((m,i)=>`<button type="button" class="map-card" data-map="${m.id}" aria-pressed="false"><span class="map-preview">${mapPreviewSVG(m)}</span><span class="map-card-title">${m.title}</span><span class="map-card-meta"><span>${String(i+1).padStart(2,'0')}</span>${m.stages.length} sections</span></button>`).join('');
$('map-grid').addEventListener('click',event=>{
  const card=event.target.closest('[data-map]');if(card)chooseMap(card.dataset.map);
});
$('community-map-grid').innerHTML=COMMUNITY_MAPS.map(m=>`<button type="button" class="map-card" data-map="${m.id}" aria-pressed="false"><span class="map-preview"><img src="${m.thumbnail}" alt="${m.title}" loading="lazy"></span><span class="map-card-title">${m.title}</span><span class="map-card-meta"><span>COMMUNITY</span>${m.author}</span></button>`).join('');
$('community-map-grid').addEventListener('click',event=>{
  const card=event.target.closest('[data-map]'),metadata=COMMUNITY_MAPS.find(m=>m.id===card?.dataset.map);if(metadata)void selectCommunityMap(metadata);
});
$('import-source-map').addEventListener('click',()=>$('source-map-file').click());
$('source-map-file').addEventListener('change',()=>{
  const file=$('source-map-file').files?.[0];if(file)void selectCommunityMap({id:'local-map',title:file.name.replace(/\.(bsp|zip)$/i,'').slice(0,80)},file);
  $('source-map-file').value='';
});
document.addEventListener('pointerdown',event=>{if(playing&&(event.button===0||event.button===2))sourceRuntime?.interact(player);});
$('gallery-slides').innerHTML=galleryMaps.map((m,i)=>`<img class="gallery-slide${m.thumbnail?' gallery-route':''}${i===0?' is-active':''}" alt="${m.title}" decoding="async">`).join('');
const slides=Array.from(document.querySelectorAll('.gallery-slide'));
if(slides.length&&rendererReady)screenshotCanvas=document.createElement('canvas');
if(slides.length)slideshow=createMenuSlideshow({slides,maps:galleryMaps,title:$('gallery-title'),count:$('gallery-count'),reducedMotion:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches});
$('gallery-next').addEventListener('click',()=>slideshow?.next());
$('gallery-previous').addEventListener('click',()=>slideshow?.previous());
$('leaderboard-button').addEventListener('click',openLeaderboard);
$('endless-leaderboard').addEventListener('click',()=>openLeaderboard('endless'));
$('finish-leaderboard').addEventListener('click',openLeaderboard);
$('leaderboard-close').addEventListener('click',()=>$('leaderboard').close());
$('leaderboard-refresh').addEventListener('click',()=>void refreshLeaderboard());
$('leaderboard').addEventListener('close',()=>{leaderboardRequest++;});
$('skybox-select').value=skybox;renderer.setSkybox?.(skybox);
$('skybox-select').addEventListener('change',()=>{
  skybox=normaliseSkybox($('skybox-select').value);renderer.setSkybox?.(skybox);
  $('skybox-select').value=skybox;saveSettings();
});
$('shaders-enabled').checked=shadersEnabled;renderer.setShaders?.(shadersEnabled);
$('shaders-enabled').addEventListener('change',()=>{
  shadersEnabled=$('shaders-enabled').checked===true;renderer.setShaders?.(shadersEnabled);saveSettings();
});
for(const name of ['style','red','green','blue','scale']) $('crosshair-'+name).addEventListener(name==='style'?'change':'input',()=>{
  crosshair=normaliseCrosshair({...crosshair,[name]:name==='style'?$('crosshair-style').value:Number($('crosshair-'+name).value)});
  updateCrosshair();saveSettings();
});
updateCrosshair();
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
$('play-endless').addEventListener('click',()=>{if(lockPending)return;if(room?.busy){showMain('rooms');return;}chooseMap('endless');play();});
$('menu-button').addEventListener('click',()=>{if(playing)pause();else if(started)showPause();else showMain();});
$('again').addEventListener('click',()=>{reset();play();});
$('finish-settings').addEventListener('click',()=>returnToMain('settings'));
document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>choosePreset(b.dataset.preset)));
$('knife-enabled').checked=knifeEnabled;$('knife-sounds').checked=knifeSounds;
$('knife-enabled').addEventListener('change',()=>{
  knifeEnabled=$('knife-enabled').checked;saveSettings();
  if(knifeEnabled) { if(knife) {knife.equip();$('knife-status').textContent='Butterfly ready';} else void loadKnife(); }
  else {$('knife-status').textContent='Knife hidden';knife?.draw(0);}
});
$('knife-sounds').addEventListener('change',()=>{
  knifeSounds=$('knife-sounds').checked;knife?.audio?.setMuted(!knifeSounds||!windowFocused||!!document.hidden);saveSettings();
});
function syncLookSettings() {
  for(const prefix of ['', 'pause-']) {
    $(prefix+'sensitivity').value=sensitivity;$(prefix+'sensitivity-value').textContent=sensitivity.toFixed(2)+'×';
    $(prefix+'fov').value=fov;$(prefix+'fov-value').textContent=fov;
  }
}
for(const prefix of ['', 'pause-'])for(const name of ['sensitivity','fov']) $(prefix+name).addEventListener('input',()=>{
  if(name==='sensitivity')sensitivity=Math.min(5,Math.max(.1,Number($(prefix+name).value)));
  else fov=Math.min(120,Math.max(80,Number($(prefix+name).value)));
  syncLookSettings();saveSettings();
});
document.addEventListener('keydown',e=>{
  if(windowFocused&&!document.hidden)menuMusic.retry();
  if(e.code==='Escape') {
    if($('leaderboard').open)return;
    if(playing||lockPending)pause();else if(menuMode==='main'&&mainView!=='home')showMain();
    return;
  }
  if(!playing) return;
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab','KeyW','KeyA','KeyS','KeyD','ControlLeft','ControlRight'].includes(e.code)) e.preventDefault();
  if(e.code==='KeyQ'&&!e.repeat) {reset();saveRunCheckpoint();toast('NEW RUN');return;}
  if(e.code==='KeyE'&&!e.repeat) {respawns++;reset(false);saveRunCheckpoint();toast('CHECKPOINT RESTORED — TIMER CONTINUES');return;}
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
window.addEventListener('blur',()=>{
  windowFocused=false;updateMenuMusic();if(playing||lockPending)pause();silenceBackgroundAudio();
});
window.addEventListener('focus',()=>{
  windowFocused=true;knife?.audio?.setMuted(!knifeSounds||!!document.hidden);updateMenuMusic();
});
window.addEventListener('pagehide',()=>{leaveRoom('Room closed when this page was left.');saveEndlessBest();saveRunCheckpoint();windowFocused=false;updateMenuMusic();if(playing||lockPending)pause();silenceBackgroundAudio();});
window.addEventListener('pageshow',()=>{windowFocused=document.hasFocus?.()??true;knife?.audio?.setMuted(!knifeSounds||!windowFocused||!!document.hidden);updateMenuMusic();});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){updateMenuMusic();if(playing||lockPending)pause();silenceBackgroundAudio();}
  else {knife?.audio?.setMuted(!knifeSounds||!windowFocused);updateMenuMusic();}
});
$('menu-music-enabled').checked=musicEnabled;
$('menu-music-enabled').addEventListener('change',()=>{
  musicEnabled=$('menu-music-enabled').checked;menuMusic.setEnabled(musicEnabled);updateMenuMusic();saveSettings();
});
$('menu-music-volume').value=Math.round(musicVolume*100);$('menu-music-volume-value').textContent=Math.round(musicVolume*100)+'%';
$('menu-music-volume').addEventListener('input',()=>{
  musicVolume=Math.max(0,Math.min(1,Number($('menu-music-volume').value)/100));
  menuMusic.setVolume(musicVolume);$('menu-music-volume-value').textContent=Math.round(musicVolume*100)+'%';saveSettings();
});
document.addEventListener('pointerdown',()=>{if(windowFocused&&!document.hidden)menuMusic.retry();});
const roomCourses=[...MAP_LIST,...COMMUNITY_MAPS];
$('room-map').innerHTML=roomCourses.map(course=>`<option value="${course.id}">${course.title}</option>`).join('');
$('room-map').value='course';$('room-preset').value=preset;
try{$('room-name').value=roomPlayerName(localStorage.getItem('movement-lab-player-name')||'Player');}catch{$('room-name').value='Player';}
function escapeRoomText(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function roomLocalState(){
  return {x:player.x,y:player.y,z:player.z-(endless?.originZ||0),yaw:player.yaw,pitch:player.pitch,duckAmount:player.duckAmount,
    time:runTime,checkpoint,distance:endless?.distance||0,paused:!playing,completed};
}
async function applyRoomCourse(course){
  roomApplyingCourse=true;
  try{
    if(playing||lockPending)pause();
    choosePreset(course.preset);
    const community=COMMUNITY_MAPS.find(c=>c.id===course.id);
    if(community)await selectCommunityMap(community);else chooseMap(course.id);
    if(map!==course.id)throw Error('The room map could not load. Try joining again.');
    started=false;reset();
  }finally{roomApplyingCourse=false;}
}
function updateRoomUi(){
  const busy=room?.busy===true,active=room?.active===true;
  $('room-setup').classList.toggle('hidden',busy);$('room-session').classList.toggle('hidden',!active);$('room-leave').classList.toggle('hidden',!busy);
  $('room-leave').textContent=active?'LEAVE ROOM':'CANCEL CONNECTION';
  $('room-status').textContent=room?.status||'Host a private room or join a friend.';
  $('room-host').disabled=busy||!rendererReady;$('room-join').disabled=busy||!rendererReady;
  $('network-hud').classList.toggle('hidden',!active);
  $('room-leaderboard').classList.toggle('hidden',!active);
  $('import-source-map').disabled=busy;
  if(!active){$('room-players').innerHTML='';$('room-leaderboard-players').innerHTML='';$('player-labels').innerHTML='';return;}
  const roster=room.roster(),code=displayRoomCode(room.code);
  $('room-code').textContent=code;$('network-room').textContent=`${roster.length}/${ROOM_LIMIT} · ${code}`;
  $('network-ping').textContent=room.host?'HOST':room.ping===null?'PING —':`${Math.round(room.ping)} ms`;
  const course=roomCourses.find(c=>c.id===room.course.id);
  $('room-course').textContent=`${course.title} / ${PRESETS[room.course.preset].title} · Leave the room to change maps.`;
  $('room-players').innerHTML=roster.map(member=>{
    const state=member.self?roomLocalState():member.state;
    const progress=!state?'Joining…':state.completed?'Finished · '+format(state.time):room.course.id==='endless'?`${Math.floor(state.distance)} u`:format(state.time)+(state.paused?' · paused':'');
    const ping=member.host?'HOST':member.ping===null?'—':Math.round(member.ping)+' ms';
    return `<tr><td><i class="room-swatch" data-slot="${member.slot}"></i>${escapeRoomText(member.name)}${member.self?' · you':''}</td><td>${progress}</td><td>${ping}</td></tr>`;
  }).join('');
  const selected=MAPS[room.course.id],total=selected?.endless?null:Math.max(0,(selected?.spawns.length||1)-1);
  const standings=roster.map(member=>({...member,state:member.self?roomLocalState():member.state}));
  standings.sort((a,b)=>Number(b.state?.completed===true)-Number(a.state?.completed===true)||
    Number(!!b.state)-Number(!!a.state)||(b.state?.checkpoint||0)-(a.state?.checkpoint||0)||
    (a.state?.time??Infinity)-(b.state?.time??Infinity)||a.slot-b.slot);
  $('room-leaderboard-players').innerHTML=standings.map((member,index)=>{
    const state=member.state,checkpoint=Number.isInteger(state?.checkpoint)?Math.max(0,state.checkpoint):null;
    const progress=checkpoint===null||total===0?'—':total===null?String(checkpoint):`${Math.min(checkpoint,total)}/${total}`;
    const name=escapeRoomText(member.name)+(member.self?' · you':'');
    return `<tr data-self="${member.self===true}"><td><span class="room-player-cell"><span class="room-rank">${index+1}</span><i class="room-swatch" data-slot="${member.slot}"></i><span class="room-player-name">${name}</span></span></td><td>${progress}${state?.completed?' <span class="room-finished" aria-label="Finished">✓</span>':''}</td><td>${state?format(state.time):'—'}</td></tr>`;
  }).join('');
}
function drawRoomLabels(camera,players){
  const width=canvas.clientWidth,height=canvas.clientHeight;
  if(!started||!width||!height){$('player-labels').innerHTML='';return;}
  $('player-labels').innerHTML=players.flatMap(p=>{
    const point=projectWorldPoint(camera,{x:p.x+Math.sin(p.yaw)*p.duckAmount*4,y:p.y+83-p.duckAmount*18,z:p.z-Math.cos(p.yaw)*p.duckAmount*4},width,height,fov);
    return point?[`<span class="remote-player-label" data-slot="${p.slot}" style="left:${point.x.toFixed(1)}px;top:${point.y.toFixed(1)}px">${escapeRoomText(p.name)}</span>`]:[];
  }).join('');
}
async function startRoom(host){
  if(roomStarting||room?.busy||!rendererReady)return;
  if(typeof globalThis.RTCPeerConnection!=='function'){$('room-status').textContent='This browser does not support multiplayer connections. Use a current desktop browser.';return;}
  const name=roomPlayerName($('room-name').value);try{localStorage.setItem('movement-lab-player-name',name);}catch{}
  roomStarting=true;$('room-host').disabled=true;$('room-join').disabled=true;
  $('room-copy').textContent='COPY';
  try{
    const selected=roomCourses.find(c=>c.id===$('room-map').value)||roomCourses[0];
    const course={id:selected.id,revision:selected.revision||1,preset:$('room-preset').value==='practice'?'practice':'classic',
      ...(selected.id==='endless'?{seed:globalThis.crypto.getRandomValues(new Uint32Array(1))[0]}:{})};
    if(host)await applyRoomCourse(course);
    room=new MultiplayerRoom({config:MULTIPLAYER_CONFIG,courses:roomCourses,getState:roomLocalState,onCourse:applyRoomCourse,onChange:updateRoomUi});
    await room.start({host,code:$('room-code-input').value,name,course});
    if(host){started=false;reset();}
    updateRoomUi();
  }catch(error){if(room?.busy)room.leave(error.message);$('room-status').textContent=error.message||'Could not connect. Try again.';$('room-host').disabled=!rendererReady;$('room-join').disabled=!rendererReady;}
  finally{roomStarting=false;}
}
$('room-host').addEventListener('click',()=>void startRoom(true));
$('room-join').addEventListener('click',()=>void startRoom(false));
$('room-play').addEventListener('click',()=>{if(room?.active)play();});
function leaveRoom(message){
  if(roomApplyingCourse){sourceLoadGeneration++;sourceLoadController?.abort();}
  room?.leave(message);updateRoomUi();
}
$('room-leave').addEventListener('click',()=>leaveRoom());
$('room-copy').addEventListener('click',async()=>{
  try{await globalThis.navigator.clipboard.writeText(displayRoomCode(room.code));$('room-copy').textContent='COPIED';}
  catch{$('room-status').textContent='Select and copy the invite code above.';}
});
$('room-code-input').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void startRoom(false);}});

if(Number.isFinite(settings.sensitivity)) {
  const multiplier=settings.sensitivityVersion===2?settings.sensitivity:settings.sensitivity/2;
  sensitivity=Math.min(5,Math.max(0.1,multiplier));
}
if(Number.isFinite(settings.fov))fov=Math.min(120,Math.max(80,settings.fov));
if(PRESETS[settings.preset]) choosePreset(settings.preset,false);
const requestedMap=new URLSearchParams(window.location?.search||'').get('course');
const initialMap=requestedMap||pendingRunRestore?.map||settings.map;
if(initialMap==='local-map'&&pendingRunRestore?.geometry)try{
  const imported=hydrateParkourMap(pendingRunRestore.geometry);
  MAPS['local-map']={id:'local-map',title:imported.title,revision:imported.revision||1,timed:imported.finishPad!==null,community:true,description:'A locally imported parkour map.',boxes:imported.boxes,spawns:imported.spawns,stages:imported.stages};
}catch{}
chooseMap(Object.hasOwn(MAPS,initialMap)?initialMap:'course',false,true);
syncLookSettings();captureButtons();showMain('home',false);
reset();requestAnimationFrame(frame);
const requestedCommunity=COMMUNITY_MAPS.find(m=>m.id===initialMap);
if(requestedCommunity)void selectCommunityMap(requestedCommunity,null,true);
else{restoreSavedRun(pendingRunRestore);pendingRunRestore=null;}
if(knifeEnabled&&rendererReady) void loadKnife();else $('knife-status').textContent=rendererReady?'Knife hidden':'Knife unavailable without WebGL';
