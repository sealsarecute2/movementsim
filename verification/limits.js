// Shared admission and input guards. All run modes use one persistent
// coordinator so global capacity and daily budgets apply across clients.
import {DT} from '../dist/physics.js';
export const VERIFICATION_TICK_RATE=1/DT;
export const VERIFICATION_LIMITS = Object.freeze({
  activeRuns:8, perAccount:1, perNetwork:4,
  startsPerMinute:6, startBurst:3, networkStartsPerMinute:30, networkStartBurst:10,
  globalStartsPerMinute:120, globalStartBurst:16, maxRateKeys:2048,
  maxRunMs:10*60*1000, dailyRunMs:4*60*60*1000, minChargeMs:5000,
  idleMs:5000, packetBytes:4096, packetsPerSecond:40, packetBurst:12,
  framesPerPacket:16, queuedTicks:128, leadTicks:32, catchupTicks:64,
});
export class VerificationLimitError extends Error {
  constructor(code){super(code);this.name='VerificationLimitError';this.code=code;}
}
const refuse=code=>{throw new VerificationLimitError(code);};
class Bucket {
  constructor(capacity,rate,now){Object.assign(this,{capacity,rate,at:now,tokens:capacity});}
  take(now){
    this.tokens=Math.min(this.capacity,this.tokens+Math.max(0,now-this.at)*this.rate);
    this.at=Math.max(this.at,now);
    if(this.tokens<1)return false;this.tokens--;return true;
  }
}

// All admissions must pass through ONE serialized, persistent coordinator in
// production. An in-memory instance per Worker would NOT enforce global caps.
// accountId must come from verified authentication; networkKey from the edge
// address hashed with a server secret, never from a client-supplied field.
export class RunAdmission {
  constructor({now=()=>Date.now(),id=()=>crypto.randomUUID(),limits={},snapshot=null}={}){
    this.limits={...VERIFICATION_LIMITS,...limits};this.now=now;this.id=id;
    this.leases=new Map();this.rates=new Map();this.days=new Map();this.prunedAt=-Infinity;
    this.global=new Bucket(this.limits.globalStartBurst,this.limits.globalStartsPerMinute/60000,now());
    if(snapshot){
      if(snapshot.version!==1||!Array.isArray(snapshot.leases)||snapshot.leases.length>this.limits.activeRuns||!Array.isArray(snapshot.rates)||snapshot.rates.length>this.limits.maxRateKeys||!Array.isArray(snapshot.days)||snapshot.days.length>3||!snapshot.global)throw Error('Invalid admission snapshot');
      this.leases=new Map(snapshot.leases);this.days=new Map(snapshot.days);
      this.rates=new Map(snapshot.rates.map(([key,entry])=>[key,{...entry,bucket:Object.assign(new Bucket(entry.bucket.capacity,entry.bucket.rate,entry.bucket.at),entry.bucket)}]));
      Object.assign(this.global,snapshot.global);this.prunedAt=snapshot.prunedAt;
    }
  }
  snapshot(){return structuredClone({version:1,leases:[...this.leases],rates:[...this.rates],days:[...this.days],global:{...this.global},prunedAt:this.prunedAt});}
  sweep(now=this.now()){
    for(const [id,lease] of this.leases)if(now>=lease.expiresAt)this.release(id,lease.accountId,now);
    if(now-this.prunedAt<10000)return;
    for(const [key,entry] of this.rates)if(now-entry.usedAt>120000)this.rates.delete(key);
    const day=Math.floor(now/86400000);
    for(const key of this.days.keys())if(key<day-1)this.days.delete(key);
    this.prunedAt=now;
  }
  take(key,burst,rate,now){
    let entry=this.rates.get(key);
    if(!entry){
      if(this.rates.size>=this.limits.maxRateKeys)refuse('admission-busy');
      entry={bucket:new Bucket(burst,rate/60000,now),usedAt:now};this.rates.set(key,entry);
    }
    entry.usedAt=now;if(!entry.bucket.take(now))refuse('start-rate');
  }
  acquire({accountId,networkKey}={}){
    if(typeof accountId!=='string'||!accountId||accountId.length>128||typeof networkKey!=='string'||!networkKey||networkKey.length>128)refuse('authentication-required');
    const now=this.now(),l=this.limits;this.sweep(now);
    this.take('account:'+accountId,l.startBurst,l.startsPerMinute,now);
    this.take('network:'+networkKey,l.networkStartBurst,l.networkStartsPerMinute,now);
    const leases=[...this.leases.values()];
    if(leases.filter(r=>r.accountId===accountId).length>=l.perAccount)refuse('account-active');
    if(leases.filter(r=>r.networkKey===networkKey).length>=l.perNetwork)refuse('network-active');
    if(leases.length>=l.activeRuns)refuse('server-full');
    const day=Math.floor(now/86400000),reserved=this.days.get(day)||0;
    if(reserved+l.maxRunMs>l.dailyRunMs)refuse('daily-budget');
    // A rate-limited account must not drain everybody else's start allowance.
    if(!this.global.take(now))refuse('start-rate');
    const lease={id:this.id(),accountId,networkKey,startedAt:now,expiresAt:now+l.maxRunMs,day};
    if(this.leases.has(lease.id))refuse('admission-busy');
    this.days.set(day,reserved+l.maxRunMs);this.leases.set(lease.id,lease);
    return {...lease};
  }
  release(id,accountId,now=this.now()){
    const lease=this.leases.get(id);if(!lease||lease.accountId!==accountId)return false;
    const charged=Math.min(this.limits.maxRunMs,Math.max(this.limits.minChargeMs,now-lease.startedAt));
    this.days.set(lease.day,Math.max(0,(this.days.get(lease.day)||0)-(this.limits.maxRunMs-charged)));
    this.leases.delete(id);return true;
  }
}

const frameKeys=new Set(['forward','side','yaw','pitch','walk','duck','jumpHeld','jumpPressed']);
const packetKeys=new Set(['seq','firstTick','frames']);
export function validVerificationFrame(frame){
  return frame&&typeof frame==='object'&&!Array.isArray(frame)&&Object.keys(frame).length===8&&Object.keys(frame).every(k=>frameKeys.has(k))&&
    [-1,0,1].includes(frame.forward)&&[-1,0,1].includes(frame.side)&&
    Number.isFinite(frame.yaw)&&Math.abs(frame.yaw)<=Math.PI&&Number.isFinite(frame.pitch)&&Math.abs(frame.pitch)<=1.5&&
    ['walk','duck','jumpHeld','jumpPressed'].every(k=>typeof frame[k]==='boolean');
}
export class RunInputGate {
  constructor({now=()=>performance.now(),limits={}}={}){
    this.now=now;this.limits={...VERIFICATION_LIMITS,...limits};this.startedAt=now();this.lastInputAt=this.startedAt;
    this.bucket=new Bucket(this.limits.packetBurst,this.limits.packetsPerSecond/1000,this.startedAt);
    this.sequence=0;this.receivedTicks=0;this.simulatedTicks=0;this.queue=[];this.closed=false;
  }
  fail(code){this.closed=true;this.queue=[];refuse(code);}
  check(now){
    if(this.closed)refuse('run-closed');
    if(now-this.startedAt>=this.limits.maxRunMs)this.fail('run-expired');
    if(now-this.lastInputAt>this.limits.idleMs)this.fail('input-timeout');
  }
  receive(raw){
    const now=this.now();this.check(now);
    if(!this.bucket.take(now))this.fail('input-rate');
    // Check size before parsing JSON. Reject binary data and unknown fields;
    // maps, positions, velocities, time, checkpoint and dt are never accepted.
    if(typeof raw!=='string'||raw.length>this.limits.packetBytes||new TextEncoder().encode(raw).length>this.limits.packetBytes)this.fail('packet-size');
    let packet;try{packet=JSON.parse(raw);}catch{this.fail('invalid-packet');}
    if(!packet||typeof packet!=='object'||Array.isArray(packet)||Object.keys(packet).length!==3||!Object.keys(packet).every(k=>packetKeys.has(k))||
      packet.seq!==this.sequence||packet.firstTick!==this.receivedTicks||!Array.isArray(packet.frames)||!packet.frames.length||
      packet.frames.length>this.limits.framesPerPacket||!packet.frames.every(validVerificationFrame))this.fail('invalid-packet');
    const received=this.receivedTicks+packet.frames.length;
    const wallTick=Math.floor(Math.max(0,now-this.startedAt)*VERIFICATION_TICK_RATE/1000);
    if(received>wallTick+this.limits.leadTicks)this.fail('input-ahead');
    if(this.queue.length+packet.frames.length>this.limits.queuedTicks)this.fail('input-backlog');
    this.queue.push(...packet.frames);this.sequence++;this.receivedTicks=received;this.lastInputAt=now;
  }
  advance(simulate){
    const now=this.now();this.check(now);
    const due=Math.floor(Math.max(0,now-this.startedAt)*VERIFICATION_TICK_RATE/1000);
    if(due-this.simulatedTicks>this.limits.queuedTicks)this.fail('simulation-lag');
    const count=Math.min(this.queue.length,Math.max(0,due-this.simulatedTicks),this.limits.catchupTicks);
    const frames=this.queue.splice(0,count);
    for(const frame of frames){
      try{simulate(frame);}catch(error){this.closed=true;this.queue=[];throw error;}
      this.simulatedTicks++;
    }
    return count;
  }
}
