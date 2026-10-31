import test from 'node:test';
import assert from 'node:assert/strict';
import {RunAdmission,RunInputGate,VERIFICATION_LIMITS} from '../verification/limits.js';

const identity=(n=0,networkKey='network-'+n)=>({accountId:'account-'+n,networkKey});
const frame=()=>({forward:1,side:0,yaw:0,pitch:0,walk:false,duck:false,jumpHeld:true,jumpPressed:false});
const packet=(gate,frames=Array.from({length:16},frame))=>JSON.stringify({seq:gate.sequence,firstTick:gate.receivedTicks,frames});
const rejects=(fn,code)=>assert.throws(fn,error=>error.code===code);
function admission(limits={}){
 let now=0,serial=0;
 const gate=new RunAdmission({now:()=>now,id:()=>String(serial++),limits});
 return {gate,advance:ms=>{now+=ms;},setNow:value=>{now=value;}};
}
test('admission requires trusted identity, separates accounts and enforces the shared active cap',()=>{
 const {gate}=admission();rejects(()=>gate.acquire(),'authentication-required');
 const leases=Array.from({length:8},(_,i)=>gate.acquire(identity(i)));
 assert.equal(gate.leases.size,8);rejects(()=>gate.acquire(identity(8)),'server-full');
 rejects(()=>gate.acquire(identity(0)),'account-active');
 assert.equal(gate.release(leases[0].id,'wrong-account'),false);assert.equal(gate.leases.size,8);
 assert.equal(gate.release(leases[0].id,leases[0].accountId),true);
 assert.ok(gate.acquire(identity(8)));assert.equal(gate.leases.size,8);
});
test('shared-network cap allows several friends but cannot fill every server slot',()=>{
 const {gate}=admission();for(let i=0;i<4;i++)gate.acquire(identity(i,'school'));
 rejects(()=>gate.acquire(identity(4,'school')),'network-active');
 assert.ok(gate.acquire(identity(5,'different-network')));
});
test('rapid starts, fresh-account floods and limiter memory are bounded',()=>{
 const {gate,advance}=admission();
 for(let i=0;i<3;i++){const lease=gate.acquire(identity());gate.release(lease.id,lease.accountId);}
 rejects(()=>gate.acquire(identity()),'start-rate');advance(10000);assert.ok(gate.acquire(identity()));
 const limited=admission({maxRateKeys:4}).gate;
 for(let i=0;i<2;i++){const lease=limited.acquire(identity(i));limited.release(lease.id,lease.accountId);}
 rejects(()=>limited.acquire(identity(2)),'admission-busy');assert.equal(limited.rates.size,4);
 const global=admission({globalStartBurst:2}).gate;
 for(let i=0;i<2;i++){const lease=global.acquire(identity(i));global.release(lease.id,lease.accountId);}
 rejects(()=>global.acquire(identity(3)),'start-rate');
});
test('run-time reservations fail closed and rapid cancels still consume a daily budget',()=>{
 const {gate}=admission({maxRunMs:10000,dailyRunMs:20000,minChargeMs:5000});
 const first=gate.acquire(identity(0)),second=gate.acquire(identity(1));
 rejects(()=>gate.acquire(identity(2)),'daily-budget');
 gate.release(first.id,first.accountId);assert.equal(gate.days.get(0),15000);
 rejects(()=>gate.acquire(identity(2)),'daily-budget');
 gate.release(second.id,second.accountId);assert.equal(gate.days.get(0),10000);
 assert.ok(gate.acquire(identity(2)));
});
test('one throttled account cannot drain the remaining global start allowance',()=>{
 const {gate}=admission({globalStartBurst:4});
 for(let i=0;i<3;i++){const lease=gate.acquire(identity());gate.release(lease.id,lease.accountId);}
 for(let i=0;i<100;i++)rejects(()=>gate.acquire(identity()),'start-rate');
 assert.ok(gate.acquire(identity(1)));
});
test('expired leases release slots and UTC rollover keeps old active leases accounted for',()=>{
 const clock=admission({activeRuns:1,maxRunMs:10000,dailyRunMs:30000});
 clock.setNow(86400000-1000);const lease=clock.gate.acquire(identity());clock.advance(2000);
 rejects(()=>clock.gate.acquire(identity(1)),'server-full');
 clock.gate.release(lease.id,lease.accountId);assert.equal(clock.gate.days.get(0),5000);
 const next=clock.gate.acquire(identity(1));assert.equal(next.day,1);
 clock.advance(10000);clock.gate.sweep();assert.equal(clock.gate.leases.size,0);assert.equal(clock.gate.days.get(1),10000);
 assert.ok(clock.gate.acquire(identity(2)));
});
test('input advances only on server wall time and uses the fixed physics tick rate',()=>{
 let now=0,count=0;const gate=new RunInputGate({now:()=>now});
 gate.receive(packet(gate));assert.equal(gate.advance(()=>count++),0);assert.equal(count,0);
 now=62.5;assert.equal(gate.advance(()=>count++),16);assert.equal(count,16);
 assert.equal(gate.advance(()=>count++),0);assert.equal(count,16);
 gate.receive(packet(gate));now=125;assert.equal(gate.advance(()=>count++),16);assert.equal(count,32);
});
test('oversized and malformed packets close the attempt before any simulation',()=>{
 for(const raw of ['x'.repeat(VERIFICATION_LIMITS.packetBytes+1),'[',null,new ArrayBuffer(16),JSON.stringify({seq:0,firstTick:0,frames:Array.from({length:10000},frame)})]){
  const gate=new RunInputGate({now:()=>0});let calls=0;
  assert.throws(()=>gate.receive(raw));assert.equal(gate.closed,true);
  rejects(()=>gate.advance(()=>calls++),'run-closed');assert.equal(calls,0);assert.equal(gate.queue.length,0);
 }
 const unicode=new RunInputGate({now:()=>0});rejects(()=>unicode.receive('🦭'.repeat(1500)),'packet-size');
});
test('forged state, nonfinite numbers, extra fields, invalid controls and huge frame batches are rejected',()=>{
 for(const extra of [{time:1},{x:100},{checkpoint:5},{dt:100},{forward:100},{yaw:1e100},{pitch:2},{duck:'true'}, {jumpPressed:undefined}]){
  const gate=new RunInputGate({now:()=>0});rejects(()=>gate.receive(packet(gate,[{...frame(),...extra}])),'invalid-packet');
 }
 const gate=new RunInputGate({now:()=>0});rejects(()=>gate.receive(JSON.stringify({seq:0,firstTick:0,frames:[frame()],time:1})),'invalid-packet');
 const big=new RunInputGate({now:()=>0});rejects(()=>big.receive(packet(big,Array.from({length:17},frame))),'invalid-packet');
});
test('duplicate packets and fabricated tick indices cannot run twice or skip work',()=>{
 const gate=new RunInputGate({now:()=>0}),raw=packet(gate);gate.receive(raw);
 rejects(()=>gate.receive(raw),'invalid-packet');
 const forged=new RunInputGate({now:()=>0});rejects(()=>forged.receive(JSON.stringify({seq:0,firstTick:10000,frames:[frame()]})),'invalid-packet');
});
test('packet flooding and accelerated input stop with bounded queues',()=>{
 const gate=new RunInputGate({now:()=>0});
 for(let i=0;i<VERIFICATION_LIMITS.packetBurst;i++)gate.receive(packet(gate,[frame()]));
 rejects(()=>gate.receive(packet(gate,[frame()])),'input-rate');assert.equal(gate.queue.length,0);
 const ahead=new RunInputGate({now:()=>0});ahead.receive(packet(ahead));ahead.receive(packet(ahead));
 rejects(()=>ahead.receive(packet(ahead)),'input-ahead');assert.equal(ahead.queue.length,0);
});
test('queued work, catch-up, silence, duration and simulation failures have hard stops',()=>{
 let now=0;const gate=new RunInputGate({now:()=>now,limits:{queuedTicks:16}});
 gate.receive(packet(gate));now=62.5;rejects(()=>gate.receive(packet(gate,[frame()])),'input-backlog');
 const catchup=new RunInputGate({now:()=>now,limits:{catchupTicks:4}});catchup.receive(packet(catchup));now+=62.5;
 assert.equal(catchup.advance(()=>{}),4);assert.equal(catchup.simulatedTicks,4);
 const lag=new RunInputGate({now:()=>now});now+=600;rejects(()=>lag.advance(()=>{}),'simulation-lag');
 const idle=new RunInputGate({now:()=>now});now+=5001;rejects(()=>idle.receive(packet(idle)),'input-timeout');
 const expiry=new RunInputGate({now:()=>now,limits:{maxRunMs:1000}});now+=1000;rejects(()=>expiry.advance(()=>{}),'run-expired');
 const failed=new RunInputGate({now:()=>now});failed.receive(packet(failed));now+=62.5;
 assert.throws(()=>failed.advance(()=>{throw Error('physics failed');}),/physics failed/);assert.equal(failed.closed,true);assert.equal(failed.queue.length,0);
});
