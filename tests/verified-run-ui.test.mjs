import test from 'node:test';
import assert from 'node:assert/strict';
import {boot} from './helpers/boot-app.mjs';
const next=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  let client,resolveStart;
  class Login{
    state(){return {signedIn:true,status:'Signed in.',prepared:false,busy:false};}
    authorization(){return 'Bearer test-player';}dispose(){}prepare(){}signOut(){}
  }
  class Runs{
    constructor(options){client=this;this.options=options;this.phase='idle';this.config={enabled:true};this.selection=null;this.inputs=[];this.result=null;this.epoch=0;this.cancels=[];}
    state(){return {phase:this.phase,enabled:true,busy:['connecting','finishing'].includes(this.phase),prepared:this.phase==='prepared',active:this.phase==='active',status:this.status||'Ready.',selection:this.selection,result:this.result};}
    emit(){this.options.onChange(this.state());}
    async loadConfig(){return this.config;}
    async prepare(selection){this.selection={...selection};this.phase='prepared';this.emit();return true;}
    start(){this.phase='connecting';this.emit();const epoch=this.epoch;return new Promise(resolve=>{resolveStart=()=>{if(epoch!==this.epoch){resolve(false);return;}this.phase='active';this.status='Verified run · server connected';this.emit();resolve(true);};});}
    input(frame){if(this.phase==='active')this.inputs.push(frame);}
    finish(){if(this.phase==='active'){this.phase='finishing';this.status='Checking the finish with the server…';this.emit();}}
    cancel(message){this.epoch++;this.cancels.push(message);this.phase='idle';this.result=null;this.status=message;this.emit();}
    dispose(){this.cancel('Page left.');}
    complete(time){this.phase='saved';this.status='Verified · new global personal best saved.';this.result={ranked:true,time,completed:true};this.emit();}
    async leaderboard(){return [{name:'Player <safe>',value:6.5}];}
  }
  const app=boot({},'',null,{PlayerLoginClass:Login,VerifiedRunClass:Runs,fetch:async()=>({ok:true,text:async()=>'Published owner | 20'})});
  app.context.loadLeaderboard=async()=>[{name:'Published owner',value:20}];
  async function connect(){
    await app.element('verified-prepare').fire('click');await next();
    app.element('verified-prepare').fire('click');assert.equal(app.requests(),1);app.lock();assert.equal(app.read('playing'),false);resolveStart();await next();assert.equal(app.read('playing'),true);
  }
  return {app,get client(){return client;},connect,ready:()=>resolveStart()};
}
test('Verified Run captures the mouse from the click, resets to spawn, waits for the server, then streams the real tick controls',async()=>{
  const f=fixture();f.app.read('player.x=500; player.z=-2000; checkpoint=1; runTime=5');await f.connect();
  assert.equal(f.app.read('checkpoint'),0);assert.equal(f.app.read('runTime'),0);assert.equal(f.app.read('player.x'),0);
  f.app.read('player.yaw=10; keys.add("KeyW"); tick()');assert.equal(f.client.inputs.length,1);
  assert.ok(Math.abs(f.client.inputs[0].yaw)<=Math.PI);assert.equal(f.client.inputs[0].forward,1);
  assert.deepEqual(Object.keys(f.client.inputs[0]).sort(),['duck','forward','jumpHeld','jumpPressed','pitch','side','walk','yaw']);
  f.app.read('pause()');assert.equal(f.client.phase,'idle');assert.match(f.client.status,/Pausing/);assert.equal(f.app.read('playing'),false);
});
test('leaving during connection and changing maps cannot start a late verified session',async()=>{
  const f=fixture();await f.app.element('verified-prepare').fire('click');f.app.element('verified-prepare').fire('click');f.app.lock();
  f.app.read('pause()');f.ready();await next();assert.equal(f.app.read('playing'),false);assert.equal(f.app.document.pointerLockElement,null);
  await f.app.element('verified-prepare').fire('click');assert.equal(f.client.phase,'prepared');f.app.read('chooseMap("bhop-school")');assert.equal(f.client.phase,'idle');
});
test('the finish screen waits for a server acknowledgement and displays its authoritative time',async()=>{
  const f=fixture();await f.connect();f.app.read('runTime=7; finishRun()');
  assert.equal(f.client.phase,'finishing');assert.match(f.app.element('finish-verified').textContent,/Checking/);
  assert.equal(f.app.element('finish-time').textContent,'00:07.000');f.client.complete(6.5);
  assert.equal(f.app.element('finish-time').textContent,'00:06.500');assert.match(f.app.element('finish-verified').textContent,/Verified/);
  f.client.complete(6.500624962);assert.equal(f.app.element('finish-time').textContent,'00:06.501','An accepted finish uses the same rounding as its leaderboard record.');
  assert.equal(f.app.element('finish-verify-again').classList.contains('hidden'),false);
  f.app.element('again').fire('click');assert.equal(f.app.read('verifiedHadRun'),false);assert.equal(f.client.phase,'idle');
});
test('verified and owner-published records remain selectable and escape player labels',async()=>{
  const f=fixture();f.app.element('leaderboard-button').fire('click');await next();
  assert.match(f.app.element('leaderboard-rows').innerHTML,/Player &lt;safe&gt;/);
  assert.match(f.app.element('leaderboard-status').textContent,/verified record/);
  f.app.element('leaderboard-published').fire('click');await next();
  assert.match(f.app.element('leaderboard-rows').innerHTML,/Published owner/);
  assert.equal(f.app.element('leaderboard-footer').textContent,'Records are added by the owner.');
});
