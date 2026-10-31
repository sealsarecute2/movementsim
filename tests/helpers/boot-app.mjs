import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as physics from '../../dist/physics.js';
import * as course from '../../dist/course.js';
import * as endlessModule from '../../dist/endless.js';
import { verticalFov, projectWorldPoint } from '../../dist/renderer.js';
import * as audioModule from '../../dist/game-audio.js';
import * as leaderboardModule from '../../dist/leaderboard.js';
import * as skyboxModule from '../../dist/skybox.js';
import * as menuModule from '../../dist/menu.js';
import * as musicModule from '../../dist/menu-music.js';
import * as sourceRuntimeModule from '../../dist/source-runtime.js';
import * as parkourModule from '../../dist/parkour-map.js';
import * as multiplayerModule from '../../dist/multiplayer.js';
import * as referenceModule from '../../dist/reference-run.js';
import { MULTIPLAYER_CONFIG } from '../../dist/multiplayer-config.js';
import { PLAYER_AUTH_CONFIG } from '../../dist/player-auth-config.js';
import * as playerAuthModule from '../../dist/player-auth.js';
import * as verifiedRunModule from '../../dist/verified-runs.js';
import * as rankedModule from '../../dist/ranked-courses.js';
const markup=readFileSync(new URL('../../dist/index.html',import.meta.url),'utf8');
const elementIds=new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));

// Exercise the real app event handlers with a browser API test double. Rendering
// is stubbed here; these checks verify input, run progression and pause behavior.
export function boot(stored = {}, search = '', renderError = null, sourceOptions = {}) {
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
  const context=vm.createContext({...physics,...course,...endlessModule,...audioModule,...leaderboardModule,...skyboxModule,...menuModule,...musicModule,...sourceRuntimeModule,...parkourModule,...multiplayerModule,...referenceModule,...playerAuthModule,...verifiedRunModule,...rankedModule,MULTIPLAYER_CONFIG,PLAYER_AUTH_CONFIG:sourceOptions.playerAuthConfig||PLAYER_AUTH_CONFIG,GooglePlayerLogin:sourceOptions.PlayerLoginClass||playerAuthModule.GooglePlayerLogin,VerifiedRunClient:sourceOptions.VerifiedRunClass||verifiedRunModule.VerifiedRunClient,projectWorldPoint,MenuMusic:TestMenuMusic,document,window,
    AbortController,fetch:sourceOptions.fetch,loadSourceMap:sourceOptions.load,crypto:globalThis.crypto,
    RTCPeerConnection:sourceOptions.RTCPeerConnection,MultiplayerRoom:sourceOptions.RoomClass||multiplayerModule.MultiplayerRoom,
    sessionStorage:{getItem:key=>session.get(key)||null,setItem:(key,value)=>session.set(key,value),removeItem:key=>session.delete(key)},
    performance:{now:()=>0},URLSearchParams,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    requestAnimationFrame(){},createRenderer:()=>{if(renderError)throw new Error(renderError);return {setBoxes(){},setSkybox(value){lastSkybox=value;},setShaders(value){lastShaders=value;},draw(p,fov,target,caster,remotes){lastCamera=p;lastFov=fov;lastTarget=target;lastShadowCaster=caster;lastRemotePlayers=remotes;}};}});
  const source=readFileSync(new URL('../../dist/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
  vm.runInContext(source,context);
  return {context,document,window,canvas,musicAudio,element:id=>document.getElementById(id),
    requests:()=>requests,camera:()=>lastCamera,target:()=>lastTarget,fov:()=>lastFov,skybox:()=>lastSkybox,shaders:()=>lastShaders,shadowCaster:()=>lastShadowCaster,remotePlayers:()=>lastRemotePlayers,read:source=>vm.runInContext(source,context),storage,session,
    lock(){document.pointerLockElement=canvas;document.fire('pointerlockchange');}};
}
