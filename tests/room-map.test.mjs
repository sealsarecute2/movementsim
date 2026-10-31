import test from 'node:test';
import assert from 'node:assert/strict';
import {hydrateParkourMap} from '../dist/parkour-map.js';
import {prepareCustomRoomMap,decodeCustomRoomMap,validateRoomMapDescriptor,ROOM_MAP_MAX_BYTES} from '../dist/room-map.js';
import {defaultKillHeight} from '../dist/map-rules.js';
import {createSourceRuntime} from '../dist/source-runtime.js';
import {createPlayer,step,support} from '../dist/physics.js';
import {boot} from './helpers/boot-app.mjs';
export function customMap(){return hydrateParkourMap({title:'Custom test',boxes:[{min:[-800,-120,-800],max:[800,0,800]}],spawns:[{x:0,y:0,z:0,yaw:0}],stages:[{title:'Custom',tip:'Play together.'}],checkpointPads:[0],finishPad:null,sectionFalls:[-2120],teleports:[{min:[200,0,-40],max:[240,80,40],target:'exit',destination:{x:-300,y:0,z:0,yaw:1,pitch:0}}],killboxes:[{min:[400,0,-40],max:[440,80,40]}]});}
test('custom room packages round-trip geometry, teleports, killboxes and UTF-8 titles with an exact checksum',async()=>{
 const packet=await prepareCustomRoomMap(customMap(),'Seal 🦭 map'),map=await decodeCustomRoomMap(packet.bytes,packet.descriptor);
 assert.equal(map.title,'Seal 🦭 map');assert.equal(map.id,packet.id);assert.equal(map.killHeight,-2120);assert.equal(map.teleports.length,1);assert.equal(map.killboxes.length,1);
 const runtime=createSourceRuntime(map),p=createPlayer({x:220,y:0,z:0,yaw:0});assert.equal(runtime.step(p,{...p},1/256)[0].type,'teleport');assert.equal(p.x,-300);
 runtime.reset();p.x=420;assert.equal(runtime.step(p,{...p},1/256)[0].type,'respawn');
 const tampered=packet.bytes.slice();tampered[0]^=1;await assert.rejects(decodeCustomRoomMap(tampered,packet.descriptor),/did not match/);
 await assert.rejects(decodeCustomRoomMap(packet.bytes.subarray(1),packet.descriptor),/did not match/);
 for(const change of [{bytes:ROOM_MAP_MAX_BYTES+1},{sha256:'bad'},{title:'bad\nname'}])assert.throws(()=>validateRoomMapDescriptor({...packet.descriptor,...change}));
});
test('map hydration rejects malformed teleports and killboxes before a peer can play them',()=>{
 const base=JSON.parse(JSON.stringify({boxes:[{min:[-100,-120,-100],max:[100,0,100]}],spawns:[{x:0,y:0,z:0,yaw:0}],stages:[{}],checkpointPads:[0],finishPad:null,sectionFalls:[-2120]}));
 for(const change of [{killboxes:[{min:[0,0,0],max:[1,0,1]}]},{teleports:[{min:[0,0,0],max:[1,1,1],target:'bad',destination:{x:NaN,y:0,z:0,yaw:0,pitch:0}}]}])assert.throws(()=>hydrateParkourMap({...structuredClone(base),...change}));
});
test('the default kill plane uses the bottom of the lowest object and the client waits until that plane',()=>{
 const boxes=[{min:[-100,-700,-100],max:[100,-500,100]},{min:[200,-120,200],max:[300,0,300]}];assert.equal(defaultKillHeight(boxes),-2700);
 const app=boot();app.read("chooseMap('course');player.y=defaultKillHeight(boxes)+10;tick()");assert.equal(app.read('respawns'),0);
 app.read('player.y=defaultKillHeight(boxes)-1;tick()');assert.equal(app.read('respawns'),1);
});
test('sign boards and posts are walkthrough, cannot support the player and do not block uncrouching',()=>{
 const floor={min:[-500,-120,-500],max:[500,0,500]},sign={min:[-90,30,-4],max:[90,118,0],sign:{title:'TEST',lines:['Walk through']}},post={min:[-3,0,-3],max:[3,32,-1],signPost:true};
 const p=createPlayer({x:0,y:0,z:80,yaw:0}),comparison=createPlayer({x:0,y:0,z:80,yaw:0});
 for(let i=0;i<256;i++){step(p,{forward:1},[floor,sign,post]);step(comparison,{forward:1},[floor]);}
 for(const key of ['x','y','z','vx','vy','vz'])assert.equal(p[key],comparison[key]);
 assert.equal(support(createPlayer({x:0,y:118,z:0,yaw:0}),[sign]),undefined);
 p.x=0;p.y=0;p.z=-2;p.ducked=true;step(p,{},[floor,sign,post]);assert.equal(p.ducked,false);
});

test('the multiplayer upload button prepares a map, selects it and passes its package to hosting',async()=>{
 let request;
 class Room{
  constructor(options){this.options=options;this.busy=false;this.active=false;}
  async start(value){request=value;this.course=value.course;this.host=true;this.busy=true;this.active=true;this.code='ABCDEFGHJKLM';this.options.onChange();}
  leave(){this.busy=false;this.active=false;}
  roster(){return [];}
 }
 const app=boot({},'',null,{RoomClass:Room,RTCPeerConnection:function(){}}),data={title:'Uploaded',boxes:[{min:[-200,-120,-200],max:[200,0,200]}],spawns:[{x:0,y:0,z:0,yaw:0}],stages:[{}],checkpointPads:[0],finishPad:null,sectionFalls:[-2120]};
 const file={name:'Private <seal>.json',size:1000,text:async()=>JSON.stringify(data)};app.context.uploadFile=file;
 assert.equal(await app.read('uploadRoomMap(uploadFile)'),true);assert.match(app.element('room-map').value,/^custom-/);assert.match(app.element('room-map').innerHTML,/Private &lt;seal&gt;/);
 app.element('room-preset').value='classic';await app.read('startRoom(true)');assert.ok(request.mapData.bytes.length>0);assert.equal(request.course.custom.title,'Private <seal>');assert.equal(app.read('map'),request.course.id);assert.equal(app.read('sourceRuntime!==null'),true);
 assert.equal(app.element('room-upload').disabled,true);assert.equal(app.element('leaderboard-button').disabled,true);
});

test('compiled map triggers retain disabled-state inputs and landmark offsets without executing other commands',async()=>{
 const base=customMap();base.teleports=[];base.killboxes=[];
 base.movementEntities={entities:[],buttons:[],destinations:[['landmark',{x:0,y:0,z:0,yaw:0,pitch:0}],['exit',{x:500,y:0,z:0,yaw:2,pitch:0}]],triggers:[
  {classname:'trigger_hurt',hammerid:'hurt',targetname:'danger',StartDisabled:'1',damage:'1000',min:[-20,0,-20],max:[20,80,20]},
  {classname:'trigger_multiple',hammerid:'enable',min:[-20,0,-20],max:[20,80,20],outputs:[{event:'OnStartTouch',value:'danger,Enable,,0,-1'},{event:'OnStartTouch',value:'server,Command,quit,0,-1'}]},
  {classname:'trigger_teleport',hammerid:'teleport',target:'exit',landmark:'landmark',min:[100,0,-20],max:[140,80,20]},
 ]};
 const packet=await prepareCustomRoomMap(base),map=await decodeCustomRoomMap(packet.bytes,packet.descriptor),runtime=createSourceRuntime(map),p=createPlayer({x:0,y:0,z:0,yaw:1});
 assert.deepEqual(runtime.step(p,{...p},1/256),[]);assert.equal(runtime.step(p,{...p},1/256)[0].type,'respawn');
 runtime.reset();p.x=120;p.vx=500;const event=runtime.step(p,{...p},1/256)[0];assert.equal(event.type,'teleport');assert.equal(p.x,620);assert.equal(p.yaw,1);assert.equal(p.vx,500);
});
