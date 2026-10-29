// Browser-hosted rooms. Signaling exchanges connection details only; gameplay
// and ping packets use WebRTC data channels. No microphone/camera permissions.
export const ROOM_PROTOCOL = 1;
export const ROOM_LIMIT = 4;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeRoomCode(random = globalThis.crypto) {
  return [...random.getRandomValues(new Uint8Array(12))].map(n=>ROOM_ALPHABET[n%32]).join('');
}
export function normaliseRoomCode(value) {
  const code=String(value||'').toUpperCase().replace(/[\s-]/g,'');
  return /^[A-HJ-NP-Z2-9]{12}$/.test(code)?code:null;
}
export function displayRoomCode(code) {return code.match(/.{1,4}/g)?.join('-')||'';}
export function roomPlayerName(value) {
  return [...String(value||'').replace(/[\u0000-\u001f\u007f]/g,'').trim()].slice(0,24).join('')||'Player';
}
export function roomPlayerSpawn(spawn,slot,boxes) {
  if(!Number.isInteger(slot)||slot<0||slot>=ROOM_LIMIT)return {...spawn};
  const layouts=[
    [[-32,0],[32,0],[-32,64],[32,64]],
    [[-32,-32],[32,-32],[-32,32],[32,32]],
    [[-72,0],[-24,0],[24,0],[72,0]],
    [[0,-72],[0,-24],[0,24],[0,72]],
  ];
  const cy=Math.cos(spawn.yaw),sy=Math.sin(spawn.yaw);
  const position=([side,back])=>({...spawn,x:spawn.x+side*cy-back*sy,z:spawn.z+side*sy+back*cy});
  const safe=p=>{
    const nearby=boxes.nearby?boxes.nearby(p):boxes;
    return nearby.some(b=>!b.ladder&&Math.abs(b.max[1]-p.y)<.01&&p.x-16>=b.min[0]&&p.x+16<=b.max[0]&&p.z-16>=b.min[2]&&p.z+16<=b.max[2])&&
      !nearby.some(b=>!b.ladder&&p.x+16>b.min[0]+.001&&p.x-16<b.max[0]-.001&&p.z+16>b.min[2]+.001&&p.z-16<b.max[2]-.001&&p.y+72>b.min[1]+.001&&p.y<b.max[1]-.001);
  };
  for(const layout of layouts){const seats=layout.map(position);if(seats.every(safe))return seats[slot];}
  // A narrow checkpoint may have fewer than four safe places. Preserve the
  // original spawn rather than placing a player in a wall or over an edge.
  const seats=[];
  for(const offset of [...layouts.flat(),[0,0]]){
    const p=position(offset);
    if(safe(p)&&seats.every(s=>Math.hypot(p.x-s.x,p.z-s.z)>=47.99))seats.push(p);
    if(seats.length===ROOM_LIMIT)break;
  }
  return seats[slot]||{...spawn};
}
export function validateRoomCourse(course,courses) {
  const known=courses.find(c=>c.id===course?.id&&(c.revision||1)===course.revision);
  if(!known||!['classic','practice'].includes(course.preset))throw Error('This room uses a different map version. Refresh the game and retry.');
  if(course.id==='endless'&&(!Number.isInteger(course.seed)||course.seed<0||course.seed>0xffffffff))throw Error('Invalid Endless room.');
  return {id:course.id,revision:course.revision,preset:course.preset,...(course.id==='endless'?{seed:course.seed}:{})};
}
export function sanitiseRoomState(value) {
  if(!value||!['x','y','z','yaw','pitch','duckAmount','time','checkpoint','distance'].every(k=>Number.isFinite(value[k])))return null;
  if(['x','y','z'].some(k=>Math.abs(value[k])>1e9)||Math.abs(value.yaw)>1e9||Math.abs(value.pitch)>1.6||value.time<0||value.time>86400*7||!Number.isInteger(value.checkpoint)||value.checkpoint<0||value.checkpoint>1e7||value.distance<0||value.distance>1e9)return null;
  return {x:value.x,y:value.y,z:value.z,yaw:value.yaw,pitch:value.pitch,duckAmount:Math.max(0,Math.min(1,value.duckAmount)),time:value.time,checkpoint:value.checkpoint,distance:value.distance,paused:value.paused===true,completed:value.completed===true};
}
export function interpolateRoomPlayer(samples,now) {
  if(!samples?.length||now-samples.at(-1).at>3000)return null;
  const newest=samples.at(-1),target=now-100;
  let a=samples[0],b=newest;
  for(let i=1;i<samples.length;i++)if(samples[i].at>=target){a=samples[i-1];b=samples[i];break;}
  if(target>=newest.at)return {...newest.state};
  if(Math.hypot(b.state.x-a.state.x,b.state.y-a.state.y,b.state.z-a.state.z)>256)return {...b.state};
  const f=Math.max(0,Math.min(1,(target-a.at)/Math.max(1,b.at-a.at))),result={...b.state};
  for(const k of ['x','y','z','pitch','duckAmount'])result[k]=a.state[k]+(b.state[k]-a.state[k])*f;
  const angle=Math.atan2(Math.sin(b.state.yaw-a.state.yaw),Math.cos(b.state.yaw-a.state.yaw));
  result.yaw=a.state.yaw+angle*f;return result;
}

// Both services stamp the sender's ID server-side. Peers cannot choose the
// `from` field on an incoming signal. Private codes are never listed publicly.
export function createRoomSignaling({host,code,config={},WebSocketClass=globalThis.WebSocket,onSignal,onClose,onError,setIntervalFn=globalThis.setInterval.bind(globalThis),clearIntervalFn=globalThis.clearInterval.bind(globalThis)}) {
  const metered=!!config.meteredPublishableKey;
  if(metered&&!/^pk_live_[A-Za-z0-9_-]+$/.test(config.meteredPublishableKey))throw Error('The room service needs a publishable browser key.');
  const ownId=host?'movement-lab-rooms1-'+code:'movement-lab-guest-'+makeRoomCode();
  const channel=(config.meteredChannelPrefix||'movement-lab')+'/'+code;
  const url=metered?'wss://rms.metered.ca/v1?key='+encodeURIComponent(config.meteredPublishableKey):
    'wss://0.peerjs.com/peerjs?key=peerjs&id='+ownId+'&token='+makeRoomCode();
  const ws=new WebSocketClass(url);let id=ownId,closed=false,heartbeat=null,opened=false,resolveReady,rejectReady;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const send=message=>{if(ws.readyState===1)ws.send(JSON.stringify(message));};
  const fail=message=>{const error=new Error(message);if(!opened)rejectReady(error);else onError?.(error);};
  ws.onmessage=event=>{
    if(closed||typeof event.data!=='string'||event.data.length>65536)return;
    let message;try{message=JSON.parse(event.data);}catch{return;}
    if(!message||typeof message!=='object')return;
    if(metered){
      if(message.type==='welcome'){
        if(typeof message.peerId!=='string')return;
        id=message.peerId;opened=true;
        send({type:'subscribe',channel,requestId:'room-subscribe'});
        resolveReady({id,iceServers:message.metadata?.iceServers||[{urls:'stun:stun.cloudflare.com:3478'}]});
      }else if(message.type==='ack'&&message.requestId==='room-subscribe'&&!host){send({type:'publish',channel,data:{kind:'knock',code,protocol:ROOM_PROTOCOL}});}
      else if(message.type==='message'&&message.channel===channel&&typeof message.from==='string')onSignal?.(message.from,message.data);
      else if(message.type==='direct'&&typeof message.from==='string')onSignal?.(message.from,message.data);
      else if(message.type==='error')fail('Room service rejected the connection. Check the service configuration and free quota.');
    }else{
      if(message.type==='OPEN'){
        opened=true;heartbeat=setIntervalFn(()=>send({type:'HEARTBEAT'}),20000);heartbeat?.unref?.();
        resolveReady({id,iceServers:[{urls:'stun:stun.cloudflare.com:3478'}],offerTo:host?null:'movement-lab-rooms1-'+code});
      }else if(['OFFER','ANSWER','CANDIDATE','LEAVE'].includes(message.type)&&typeof message.src==='string')onSignal?.(message.src,message.payload?.metadata?.movementLabSignal||message.payload?.signal);
      else if(message.type==='ID-TAKEN')fail('That room code is already in use. Try hosting again.');
      else if(message.type==='EXPIRE')fail('Room not found. Check the code and that the host is online.');
      else if(message.type==='ERROR')fail('The room service is unavailable. Try again shortly.');
    }
  };
  ws.onerror=()=>{if(!closed)fail('Could not reach the room service. Check your connection and retry.');};
  ws.onclose=()=>{if(!closed){fail('The room connection closed.');onClose?.();}};
  return {ready,get id(){return id;},get provider(){return metered?'metered':'peerjs';},
    knock(){if(!metered)this.send('movement-lab-rooms1-'+code,{kind:'knock',code,protocol:ROOM_PROTOCOL});},
    send(to,body){
      if(closed)return;
      const data={...body,code,protocol:ROOM_PROTOCOL};
      if(metered)send({type:'send',to,data});
      // End-of-candidates can carry a room rejection without allocating another
      // peer connection. PeerServer's LEAVE command is handled separately.
      else send({type:body.kind==='answer'?'ANSWER':['candidate','reject'].includes(body.kind)?'CANDIDATE':'OFFER',dst:to,
        payload:{type:'data',connectionId:'mlab-'+code,label:'movement-room',serialization:'json',reliable:true,
          ...(body.sdp?{sdp:body.sdp}:{}),...(body.candidate?{candidate:body.candidate}:body.kind==='reject'?{candidate:{candidate:'',sdpMid:'0',sdpMLineIndex:0}}:{}),metadata:{movementLabSignal:data}}});
    },
    close(){closed=true;if(heartbeat!==null)clearIntervalFn(heartbeat);rejectReady(Error('Connection cancelled.'));ws.close();},
  };
}

export class MultiplayerRoom {
  constructor({config={},courses=[],getState=()=>null,onChange=()=>{},onCourse=async()=>{},now=()=>performance.now(),
    signalingFactory=createRoomSignaling,peerFactory=options=>new RTCPeerConnection(options),
    setIntervalFn=globalThis.setInterval.bind(globalThis),clearIntervalFn=globalThis.clearInterval.bind(globalThis)}={}) {
    Object.assign(this,{config,courses,getState,onChange,onCourse,now,signalingFactory,peerFactory,setIntervalFn,clearIntervalFn});
    this.phase='idle';this.status='Host a private room or join a friend.';this.links=new Map();this.members=new Map();this.sequence=0;this.generation=0;
  }
  get active(){return this.phase==='hosting'||this.phase==='connected';}
  get busy(){return this.active||this.phase==='connecting';}
  notify(){this.onChange(this);}
  async start({host,code,name,course}) {
    this.leave('',false);const generation=++this.generation;
    this.host=host;this.slot=host?0:null;this.code=host?makeRoomCode():normaliseRoomCode(code);this.name=roomPlayerName(name);
    if(!this.code)throw Error('Enter the full 12-character room code.');
    if(host)this.course=validateRoomCourse(course,this.courses);
    this.phase='connecting';this.status=host?'Opening your room…':'Finding the host…';this.notify();
    const joined=new Promise((resolve,reject)=>{this.resolveStart=resolve;this.rejectStart=reject;});joined.catch(()=>{});
    this.startedAt=this.now();this.timer=this.setIntervalFn(()=>this.pump(),50);this.timer?.unref?.();
    try{
      this.signaling=this.signalingFactory({host,code:this.code,config:this.config,
        onSignal:(id,data)=>{if(generation===this.generation)void this.signal(id,data).catch(()=>{if(generation===this.generation)this.fail('Could not establish the player connection.');});},
        onClose:()=>{if(generation===this.generation)this.fail('Connection service disconnected. Rejoin to open the room again.');},
        onError:error=>{if(generation===this.generation)this.fail(error.message);}});
      const result=await this.signaling.ready;if(generation!==this.generation)throw Error('Connection cancelled.');
      this.id=result.id;this.iceServers=result.iceServers;
      if(host){
        this.session=makeRoomCode();this.phase='hosting';this.status='Room open. Share the code with friends.';
        this.members.set(this.id,{id:this.id,name:this.name,slot:0,host:true,ping:null,samples:[],lastSeen:this.now()});this.resolveStart(this);this.notify();
      }else if(result.offerTo){
        this.hostId=result.offerTo;const link=this.makeLink(this.hostId,true);
        const offer=await link.pc.createOffer();await link.pc.setLocalDescription(offer);
        if(!link.closed)this.signaling.send(this.hostId,{kind:'offer',sdp:link.pc.localDescription});
      }else this.signaling.knock();
      return await joined;
    }catch(error){if(generation===this.generation)this.fail(error.message);throw error;}
  }
  fail(message){this.leave(message);}
  leave(message='Left the room.',notify=true){
    this.generation++;this.phase='idle';this.status=message;this.rejectStart?.(Error(message||'Connection cancelled.'));this.rejectStart=null;this.resolveStart=null;
    if(this.timer!==undefined)this.clearIntervalFn(this.timer);this.timer=undefined;
    this.signaling?.close();this.signaling=null;
    for(const link of this.links.values()){link.closed=true;link.pc.close();}
    this.links.clear();this.members.clear();this.id=null;this.hostId=null;this.slot=null;this.session=null;this.course=null;this.earlyCandidates=new Map();
    if(notify)this.notify();
  }
  async signal(id,data) {
    if(!this.busy||!data||data.code!==this.code||data.protocol!==ROOM_PROTOCOL||id===this.id||id.length>128)return;
    if(this.host&&data.kind==='knock'){
      if(this.links.has(id))return;
      if(this.links.size>=ROOM_LIMIT-1){this.signaling.send(id,{kind:'reject',message:'This room is full (4 players).'});return;}
      const link=this.makeLink(id);const offer=await link.pc.createOffer();await link.pc.setLocalDescription(offer);
      if(!link.closed)this.signaling?.send(id,{kind:'offer',sdp:link.pc.localDescription});return;
    }
    if(this.host&&data.kind==='offer'&&!this.links.has(id)){
      if(this.links.size>=ROOM_LIMIT-1){this.signaling.send(id,{kind:'reject',message:'This room is full (4 players).'});return;}
      const link=this.makeLink(id,false);await link.pc.setRemoteDescription(data.sdp);await this.flushCandidates(link);
      const answer=await link.pc.createAnswer();await link.pc.setLocalDescription(answer);
      if(!link.closed)this.signaling?.send(id,{kind:'answer',sdp:link.pc.localDescription});return;
    }
    if(!this.host&&data.kind==='reject'&&(!this.hostId||this.hostId===id)){this.fail(data.message==='This room is full (4 players).'?data.message:'The host declined the connection.');return;}
    if(!this.host&&data.kind==='offer'&&!this.hostId){
      this.hostId=id;const link=this.makeLink(id);
      await link.pc.setRemoteDescription(data.sdp);await this.flushCandidates(link);
      const answer=await link.pc.createAnswer();await link.pc.setLocalDescription(answer);
      if(!link.closed)this.signaling?.send(id,{kind:'answer',sdp:link.pc.localDescription});return;
    }
    const link=this.links.get(id);
    if(!link&&data.kind==='candidate'&&data.candidate&&this.earlyCandidates.size<4){
      if(!this.earlyCandidates.has(id))this.earlyCandidates.set(id,[]);
      const queued=this.earlyCandidates.get(id);if(queued.length<100)queued.push(data.candidate);return;
    }
    if(!link||link.closed)return;
    if(data.kind==='answer'&&link.pc.signalingState==='have-local-offer'){
      await link.pc.setRemoteDescription(data.sdp);await this.flushCandidates(link);
    }else if(data.kind==='candidate'&&data.candidate){
      if(link.pc.remoteDescription)await link.pc.addIceCandidate(data.candidate);else if(link.candidates.length<100)link.candidates.push(data.candidate);
    }
  }
  async flushCandidates(link){for(const candidate of link.candidates.splice(0))await link.pc.addIceCandidate(candidate);}
  makeLink(id,initiator=this.host) {
    const pc=this.peerFactory({iceServers:this.iceServers}),used=new Set([...this.links.values()].map(l=>l.slot));
    const slot=[1,2,3].find(n=>!used.has(n));
    const link={id,pc,slot,candidates:this.earlyCandidates?.get(id)||[],lastSeen:this.now(),lastPing:-Infinity,pings:new Map(),ping:null,accepted:false,closed:false,seq:-1};
    this.earlyCandidates?.delete(id);
    this.links.set(id,link);
    pc.onicecandidate=event=>{if(event.candidate&&!link.closed)this.signaling?.send(id,{kind:'candidate',candidate:event.candidate.toJSON?.()||event.candidate});};
    pc.onconnectionstatechange=()=>{if(pc.connectionState==='failed')this.drop(id,'Player connection failed. Try rejoining.');};
    const bind=channel=>{
      if(!['control','movement'].includes(channel.label)||link[channel.label]){channel.close();return;}
      link[channel.label]=channel;
      channel.onopen=()=>{
        if(channel.label!=='control')return;
        if(this.host)this.send(link,{type:'welcome',protocol:ROOM_PROTOCOL,session:this.session,course:this.course,id,name:this.name,hostId:this.id,slot});
        else if(link.prepared)this.send(link,{type:'ready',session:this.session,name:this.name});
      };
      channel.onmessage=event=>{void this.receive(link,event.data,channel.label).catch(()=>this.drop(id,'Could not load the room map.'));};
      channel.onclose=()=>{if(!link.closed)this.drop(id,this.host?'A player left the room.':'The host left. You can keep playing solo.');};
      channel.onerror=()=>{if(!link.closed)this.drop(id,'Player connection interrupted.');};
    };
    if(initiator){bind(pc.createDataChannel('control',{ordered:true}));bind(pc.createDataChannel('movement',{ordered:false,maxRetransmits:0}));}
    else pc.ondatachannel=event=>bind(event.channel);
    return link;
  }
  send(link,message,kind='control') {
    const channel=link[kind];if(link.closed||channel?.readyState!=='open'||channel.bufferedAmount>65536)return false;
    try{channel.send(JSON.stringify(message));return true;}catch{return false;}
  }
  async receive(link,raw,kind) {
    if(link.closed||typeof raw!=='string'||raw.length>16384)return;
    let data;try{data=JSON.parse(raw);}catch{return;}
    if(!data||typeof data!=='object')return;
    const now=this.now();link.lastSeen=now;
    if(kind==='control'&&data.type==='welcome'&&!this.host&&!this.active&&!link.loading){
      if(data.protocol!==ROOM_PROTOCOL||typeof data.session!=='string'||data.hostId!==link.id||![1,2,3].includes(data.slot)||data.id!==this.id){this.fail('This room uses a different multiplayer version. Refresh and retry.');return;}
      link.loading=true;this.status='Loading the host’s map…';this.notify();
      const generation=this.generation;this.course=validateRoomCourse(data.course,this.courses);this.session=data.session;this.slot=data.slot;
      await this.onCourse(this.course);if(generation!==this.generation||link.closed)return;
      link.prepared=true;link.lastReady=now;this.status='Joining the room…';
      this.members.set(this.id,{id:this.id,name:this.name,slot:this.slot,host:false,ping:null,samples:[],lastSeen:now});
      this.members.set(link.id,{id:link.id,name:roomPlayerName(data.name),slot:0,host:true,ping:null,samples:[],lastSeen:now});
      this.send(link,{type:'ready',session:this.session,name:this.name});this.notify();return;
    }
    if(data.session!==this.session||!this.session)return;
    if(kind==='control'&&data.type==='ready'&&this.host){
      if(!link.accepted){link.accepted=true;this.members.set(link.id,{id:link.id,name:roomPlayerName(data.name),slot:link.slot,host:false,ping:null,samples:[],lastSeen:now});this.notify();}
      this.send(link,{type:'joined',session:this.session});return;
    }
    if(kind==='control'&&data.type==='joined'&&!this.host&&link.prepared&&!link.accepted){
      link.accepted=true;this.phase='connected';this.status='Connected. Enter the map when ready.';this.resolveStart?.(this);this.notify();return;
    }
    if(!link.accepted)return;
    if(kind==='control'&&data.type==='ping'&&Number.isSafeInteger(data.id))this.send(link,{type:'pong',id:data.id,session:this.session});
    else if(kind==='control'&&data.type==='pong'&&link.pings.has(data.id)){
      const elapsed=now-link.pings.get(data.id);link.pings.delete(data.id);
      if(elapsed>=0&&elapsed<15000){link.ping=link.ping===null?elapsed:link.ping*.7+elapsed*.3;link.lastPong=now;this.notify();}
    }else if(kind==='movement'&&data.type==='state'&&this.host&&Number.isSafeInteger(data.seq)&&data.seq>link.seq){
      const state=sanitiseRoomState(data.state);if(!state)return;link.seq=data.seq;this.sample(this.members.get(link.id),state,now);
    }else if(kind==='movement'&&data.type==='world'&&!this.host&&Number.isSafeInteger(data.seq)&&data.seq>link.seq){
      if(!Array.isArray(data.players)||data.players.length>ROOM_LIMIT)return;link.seq=data.seq;
      const keep=new Set([this.id]),slots=new Set();
      for(const entry of data.players){
        if(typeof entry.id!=='string'||entry.id.length>128||!Number.isInteger(entry.slot)||entry.slot<0||entry.slot>=ROOM_LIMIT||slots.has(entry.slot))continue;
        slots.add(entry.slot);keep.add(entry.id);let member=this.members.get(entry.id);
        if(!member){member={id:entry.id,samples:[]};this.members.set(entry.id,member);}
        Object.assign(member,{name:roomPlayerName(entry.name),slot:entry.slot,host:entry.id===this.hostId,ping:Number.isFinite(entry.ping)&&entry.ping>=0&&entry.ping<15000?entry.ping:null,lastSeen:now});
        const state=sanitiseRoomState(entry.state);if(state)this.sample(member,state,now);
      }
      for(const id of this.members.keys())if(!keep.has(id))this.members.delete(id);
    }else if(kind==='control'&&data.type==='closed'&&!this.host)this.fail('The host left. You can keep playing solo.');
  }
  sample(member,state,at){if(!member)return;member.state=state;member.lastSeen=at;member.samples.push({state,at});if(member.samples.length>10)member.samples.shift();}
  pump() {
    if(!this.busy)return;const now=this.now();
    if(this.phase==='connecting'&&now-this.startedAt>30000){this.fail('Could not join. Check the code or try a different network.');return;}
    const own=this.members.get(this.id),state=sanitiseRoomState(this.getState());if(own&&state)this.sample(own,state,now);
    for(const link of [...this.links.values()]){
      if(now-link.lastSeen>20000){this.drop(link.id,this.host?'A player disconnected.':'The host disconnected. You can keep playing solo.');continue;}
      if(!this.host&&link.prepared&&!link.accepted&&now-link.lastReady>500){link.lastReady=now;this.send(link,{type:'ready',session:this.session,name:this.name});}
      if(link.accepted&&now-link.lastPing>=1000){
        link.lastPing=now;const id=++this.sequence;link.pings.set(id,now);
        for(const [key,sent] of link.pings)if(now-sent>5000)link.pings.delete(key);
        this.send(link,{type:'ping',id,session:this.session});
      }
      if(link.accepted&&now-(link.lastPong??-Infinity)>5000)link.ping=null;
    }
    if(!this.active)return;
    if(this.host){
      const players=[...this.members.values()].map(member=>({id:member.id,name:member.name,slot:member.slot,ping:this.links.get(member.id)?.ping??null,state:member.state||null}));
      const message={type:'world',session:this.session,seq:++this.sequence,players};
      for(const link of this.links.values())if(link.accepted)this.send(link,message,'movement');
    }else{
      const link=this.links.get(this.hostId);if(link&&state)this.send(link,{type:'state',session:this.session,seq:++this.sequence,state},'movement');
    }
  }
  drop(id,message) {
    const link=this.links.get(id);if(!link||link.closed)return;
    link.closed=true;this.links.delete(id);this.members.delete(id);link.pc.close();
    if(!this.host)this.fail(message);else{this.status=message;this.notify();}
  }
  get ping(){return this.host?null:this.links.get(this.hostId)?.ping??null;}
  roster(){return [...this.members.values()].sort((a,b)=>a.slot-b.slot).map(member=>({...member,self:member.id===this.id,ping:member.id===this.id?this.ping:this.host?this.links.get(member.id)?.ping??null:member.ping}));}
  remotePlayers(originZ=0){
    const now=this.now();return this.roster().filter(member=>!member.self).flatMap(member=>{
      const state=interpolateRoomPlayer(member.samples,now);return state?[{...state,z:state.z+originZ,id:member.id,name:member.name,slot:member.slot}]:[];
    });
  }
}
