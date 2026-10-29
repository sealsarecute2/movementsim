import test from 'node:test';
import assert from 'node:assert/strict';
import {MultiplayerRoom,createRoomSignaling,makeRoomCode,normaliseRoomCode,displayRoomCode,sanitiseRoomState,interpolateRoomPlayer,validateRoomCourse} from '../dist/multiplayer.js';
import {buildRemotePlayerMesh} from '../dist/players.js';
import {projectWorldPoint} from '../dist/renderer.js';

const courses=[{id:'course'},{id:'endless',revision:3},{id:'bhop_kitsune',revision:3}];
const course={id:'course',revision:1,preset:'practice'};
const state=(changes={})=>({x:0,y:0,z:100,yaw:0,pitch:0,duckAmount:0,time:0,checkpoint:0,distance:0,paused:false,completed:false,...changes});
const flush=()=>new Promise(resolve=>setImmediate(resolve));

// A controlled transport exercises actual room negotiation and protocol logic,
// including dropped/misordered updates, without contacting a public service.
function network(guestOffers=false){
 let clock=0,serial=0,delay=0;const connections=new Map(),signals=new Map(),pending=[],rooms=[];
 const later=fn=>{pending.push({at:clock+delay,fn});};
 class Channel {
  constructor(label){this.label=label;this.readyState='connecting';this.bufferedAmount=0;}
  send(raw){if(this.readyState!=='open')throw Error('closed');later(()=>this.other.onmessage?.({data:raw}));}
  close(){if(this.readyState==='closed')return;this.readyState='closed';this.onclose?.();if(this.other&&this.other.readyState!=='closed'){this.other.readyState='closed';this.other.onclose?.();}}
 }
 class Peer {
  constructor(){this.id='pc'+serial++;this.channels=[];connections.set(this.id,this);this.signalingState='stable';}
  createDataChannel(label,options){const c=new Channel(label);c.options=options;this.channels.push(c);return c;}
  async createOffer(){return {type:'offer',sdp:this.id};}
  async createAnswer(){return {type:'answer',sdp:this.id};}
  async setLocalDescription(value){this.localDescription=value;this.signalingState=value.type==='offer'?'have-local-offer':'stable';this.onicecandidate?.({candidate:{candidate:'early candidate'}});}
  async setRemoteDescription(value){
   this.remoteDescription=value;this.remote=connections.get(value.sdp);
   if(value.type==='answer'){
    this.signalingState='stable';
    for(const a of this.channels){const b=new Channel(a.label);a.other=b;b.other=a;this.remote.channels.push(b);this.remote.ondatachannel?.({channel:b});a.readyState='open';b.readyState='open';a.onopen?.();b.onopen?.();}
   }
  }
  async addIceCandidate(candidate){(this.candidates??=[]).push(candidate);}
  close(){this.connectionState='closed';for(const c of this.channels)c.close();connections.delete(this.id);}
 }
 function signalingFactory(options){
  const id=options.host?'host-'+options.code:'guest-'+serial++;const handle={
   ready:Promise.resolve({id,iceServers:[],...(guestOffers&&!options.host?{offerTo:'host-'+options.code}:{})}),
   send(to,data){queueMicrotask(()=>signals.get(to)?.onSignal(id,{...data,code:options.code,protocol:1}));},
   knock(){handle.send('host-'+options.code,{kind:'knock'});},close(){signals.delete(id);},
  };signals.set(id,options);return handle;
 }
 function create(changes={}){
  const local=state(),applied=[];
  const room=new MultiplayerRoom({courses,getState:()=>local,onCourse:async c=>applied.push(c),signalingFactory,peerFactory:()=>new Peer(),now:()=>clock,setIntervalFn:()=>1,clearIntervalFn(){},...changes});
  rooms.push(room);return {room,local,applied};
 }
 function advance(ms=0){
  const end=clock+ms;let count=0;
  while(pending.some(p=>p.at<=end)){
   pending.sort((a,b)=>a.at-b.at);const next=pending.shift();clock=next.at;next.fn();if(++count>1000)throw Error('Loop');
  }clock=end;
 }
 async function join(host,name='Guest'){
  const guest=create(),request=guest.room.start({host:false,code:host.room.code,name});
  for(let i=0;i<8;i++){await flush();advance();}
  await request;return guest;
 }
 function pump(){for(const room of rooms)room.pump();advance();}
 return {create,join,advance,pump,rooms,pending,connections,signals,setDelay:n=>{delay=n;},now:()=>clock,close:()=>rooms.forEach(r=>r.leave())};
}

test('room codes are random, readable and accept a pasted formatted invite',()=>{
 const codes=Array.from({length:100},()=>makeRoomCode());assert.equal(new Set(codes).size,100);
 for(const code of codes){assert.equal(code.length,12);assert.equal(normaliseRoomCode(displayRoomCode(code).toLowerCase()),code);}
 for(const bad of ['','abc','AAAAAAAAAAAAA','IIII-IIII-IIII','<script>'])assert.equal(normaliseRoomCode(bad),null);
});
test('room map versions and movement packets reject unsupported or nonfinite data',()=>{
 assert.deepEqual(validateRoomCourse(course,courses),course);
 for(const bad of [{...course,id:'local-map'},{...course,revision:2},{...course,preset:'fake'},{id:'endless',revision:3,preset:'practice',seed:-1}])assert.throws(()=>validateRoomCourse(bad,courses));
 for(const bad of [null,{},state({x:NaN}),state({z:Infinity}),state({x:1e12}),state({checkpoint:.5}),state({time:-1}),state({pitch:3})])assert.equal(sanitiseRoomState(bad),null);
 assert.equal(sanitiseRoomState(state({duckAmount:4})).duckAmount,1);
});
test('four players share the host map and receive each other through the host; a fifth cannot join',async()=>{
 const net=network();try{
  const host=net.create();await host.room.start({host:true,name:'Host',course});
  const guests=[];for(let i=0;i<3;i++)guests.push(await net.join(host,'Guest '+i));
  guests[0].local.x=345;guests[1].local.time=17;host.local.completed=true;
  net.pump();net.pump();
  assert.equal(host.room.roster().length,4);
  for(const guest of guests){assert.deepEqual(guest.applied,[course]);assert.equal(guest.room.roster().length,4);assert.equal(guest.room.remotePlayers().length,3);}
  assert.equal(host.room.roster().find(m=>m.id===guests[0].room.id).state.x,345);
  assert.equal(guests[2].room.roster().find(m=>m.id===guests[0].room.id).state.x,345);
  assert.ok(guests[0].room.roster().find(m=>m.host).state.completed);
  const fifth=net.create(),request=fifth.room.start({host:false,code:host.room.code,name:'Extra'});const rejected=assert.rejects(request,/full/);
  await flush();net.advance();await rejected;assert.equal(host.room.roster().length,4);
 }finally{net.close();}
});
test('ping is a measured round trip and becomes unavailable when replies stop',async()=>{
 const net=network();try{
  const host=net.create();await host.room.start({host:true,name:'Host',course});const guest=await net.join(host);
  assert.equal(guest.room.ping,null);net.setDelay(17);host.room.pump();guest.room.pump();net.advance(34);
  assert.equal(guest.room.ping,34);assert.equal(host.room.roster().find(m=>!m.host).ping,34);
  net.pending.length=0;net.advance(6000);guest.room.pump();assert.equal(guest.room.ping,null);
 }finally{net.close();}
});
test('guest-initiated offers join only after the host confirms the loaded player',async()=>{
 const net=network(true);try{
  const host=net.create();await host.room.start({host:true,name:'Host',course});const guest=await net.join(host);
  assert.ok(guest.room.active);assert.equal(host.room.roster().length,2);net.pump();net.pump();
  assert.equal(guest.room.remotePlayers().length,1);assert.equal(host.room.links.get(guest.room.id).accepted,true);
 }finally{net.close();}
});
test('guest-initiated rooms reject a fifth peer while keeping the existing four connected',async()=>{
 const net=network(true);try{
  const host=net.create();await host.room.start({host:true,name:'Host',course});
  for(let i=0;i<3;i++)await net.join(host,'Guest '+i);
  const extra=net.create(),request=extra.room.start({host:false,code:host.room.code,name:'Extra'}),rejected=assert.rejects(request,/full/);
  for(let i=0;i<8;i++){await flush();net.advance();}await rejected;
  assert.equal(host.room.roster().length,4);assert.ok(net.rooms.slice(0,4).every(r=>r.active));
 }finally{net.close();}
});
test('out-of-order, malformed and forged identity updates cannot replace a player',async()=>{
 const net=network();try{
  const host=net.create();await host.room.start({host:true,name:'Host',course});const guest=await net.join(host),link=host.room.links.get(guest.room.id);
  await host.room.receive(link,JSON.stringify({type:'state',session:host.room.session,seq:100,state:state({x:400}),id:host.room.id}),'movement');
  await host.room.receive(link,JSON.stringify({type:'state',session:host.room.session,seq:99,state:state({x:900})}),'movement');
  await host.room.receive(link,'{"type":"state","state":{"x":null}}','movement');
  await host.room.receive(link,JSON.stringify({type:'state',session:'another room',seq:101,state:state({x:800})}),'movement');
  assert.equal(host.room.members.get(guest.room.id).state.x,400);assert.equal(host.room.members.get(host.room.id).state,undefined);
  assert.ok(link.pc.candidates.length>0,'ICE sent before the offer was queued and applied');
 }finally{net.close();}
});
test('leaving frees a slot and closing the host cleans up every guest connection',async()=>{
 const net=network();try{
  const host=net.create();await host.room.start({host:true,name:'Host',course});const a=await net.join(host,'A'),b=await net.join(host,'B');
  a.room.leave();assert.equal(host.room.roster().length,2);host.room.leave();
  assert.equal(b.room.active,false);assert.match(b.room.status,/host left/i);assert.equal(net.connections.size,0);assert.equal(net.signals.size,0);
 }finally{net.close();}
});
test('a missing host times out and a cancelled connection cannot later enter a room',async()=>{
 const net=network();try{
  const guest=net.create(),request=guest.room.start({host:false,code:makeRoomCode(),name:'Guest'});const rejected=assert.rejects(request,/Could not join/);
  await flush();net.advance(30001);guest.room.pump();await rejected;assert.equal(guest.room.busy,false);
  const next=guest.room.start({host:false,code:makeRoomCode(),name:'Guest'});const cancelled=assert.rejects(next,/cancelled/);
  await flush();guest.room.leave('Connection cancelled.');await cancelled;assert.equal(guest.room.links.size,0);
 }finally{net.close();}
});
test('Endless rooms preserve the shared seed and remote coordinates after rebasing',async()=>{
 const net=network();try{
  const host=net.create(),shared={id:'endless',revision:3,preset:'practice',seed:98765};await host.room.start({host:true,name:'Host',course:shared});const guest=await net.join(host);
  assert.deepEqual(guest.applied,[shared]);guest.local.z=-9200;net.pump();
  assert.equal(host.room.remotePlayers(8192)[0].z,-1008);
 }finally{net.close();}
});
test('interpolation smooths ordinary movement, snaps portals and hides stale players',()=>{
 const samples=[{at:0,state:state({x:0,yaw:Math.PI-.1})},{at:100,state:state({x:100,yaw:-Math.PI+.1})}];
 const middle=interpolateRoomPlayer(samples,150);assert.equal(middle.x,50);assert.ok(Math.abs(middle.yaw-Math.PI)<1e-8);
 samples.push({at:200,state:state({x:2000,y:1000})});assert.equal(interpolateRoomPlayer(samples,250).x,2000);
 assert.equal(interpolateRoomPlayer(samples,4000),null);
});
test('avatars have finite coloured geometry and label projection follows the camera',()=>{
 const mesh=buildRemotePlayerMesh([{...state(),slot:1}]);assert.equal(mesh.length/11,7*36);assert.ok([...mesh].every(Number.isFinite));
 assert.equal(buildRemotePlayerMesh([{...state({x:NaN}),slot:1}]).length,0);
 const camera=state({z:0});assert.deepEqual(projectWorldPoint(camera,{x:0,y:64,z:-100},1280,720),{x:640,y:360});
 assert.equal(projectWorldPoint(camera,{x:0,y:64,z:100},1280,720),null);
 const ducked=buildRemotePlayerMesh([{...state({duckAmount:1}),slot:2}]);assert.equal(Math.max(...[...ducked].filter((_,i)=>i%11===1)),54);
});

class Socket {
 static all=[];
 constructor(url){this.url=url;this.readyState=1;this.sent=[];Socket.all.push(this);}
 send(raw){this.sent.push(JSON.parse(raw));}
 message(value){this.onmessage({data:JSON.stringify(value)});}
 close(){this.readyState=3;this.onclose?.();}
}
test('public signaling forwards only handshake packets and removes the heartbeat on close',async()=>{
 let interval,cleared=false;const received=[];
 const signaling=createRoomSignaling({host:true,code:'ABCDEFGHJKLM',WebSocketClass:Socket,onSignal:(...args)=>received.push(args),setIntervalFn:fn=>{interval=fn;return 1;},clearIntervalFn:()=>{cleared=true;}});
 const socket=Socket.all.at(-1);assert.match(socket.url,/wss:\/\/0\.peerjs\.com\/peerjs\?/);socket.message({type:'OPEN'});await signaling.ready;
 signaling.send('friend',{kind:'offer',sdp:{type:'offer',sdp:'...'}});assert.equal(socket.sent[0].type,'OFFER');assert.equal(socket.sent[0].payload.metadata.movementLabSignal.code,'ABCDEFGHJKLM');assert.equal(socket.sent[0].payload.sdp.type,'offer');
 socket.message({type:'CANDIDATE',src:'friend',payload:{signal:{kind:'candidate'}}});assert.equal(received[0][0],'friend');
 interval();assert.deepEqual(socket.sent.at(-1),{type:'HEARTBEAT'});signaling.close();assert.ok(cleared);
});
test('Metered publishes discovery, uses server-provided TURN credentials and sends SDP directly',async()=>{
 const received=[],config={meteredPublishableKey:'pk_live_example',meteredChannelPrefix:'app_test/rooms'};
 const signaling=createRoomSignaling({host:false,code:'ABCDEFGHJKLM',config,WebSocketClass:Socket,onSignal:(...args)=>received.push(args)});
 const socket=Socket.all.at(-1),iceServers=[{urls:'turn:relay.example',username:'short-lived',credential:'temporary'}];
 socket.message({type:'welcome',peerId:'guest',metadata:{iceServers}});assert.deepEqual((await signaling.ready).iceServers,iceServers);
 assert.equal(socket.sent[0].channel,'app_test/rooms/ABCDEFGHJKLM');socket.message({type:'ack',requestId:'room-subscribe'});assert.equal(socket.sent.at(-1).type,'publish');
 signaling.send('host',{kind:'answer',sdp:{}});assert.equal(socket.sent.at(-1).type,'send');assert.equal(socket.sent.at(-1).to,'host');
 socket.message({type:'direct',from:'host',data:{kind:'offer'}});assert.equal(received[0][0],'host');signaling.close();
 assert.throws(()=>createRoomSignaling({host:true,code:'ABCDEFGHJKLM',config:{meteredPublishableKey:'sk_secret'},WebSocketClass:Socket}),/publishable/);
});
