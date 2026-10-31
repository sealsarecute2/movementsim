import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{VerifiedRun} from '../verification/worker.js';
import {scoreFromOutcome} from '../verification/score-store.js';
import {completedReference,scoredReference} from './helpers/scored-reference.mjs';

const accountId='a'.repeat(43),startedAt=Date.now()-20000;
const init={kind:'player',scoreEligible:true,botVerified:true,selection:{map:'bhop-school',revision:1,preset:'classic'},
  lease:{id:crypto.randomUUID(),accountId,startedAt,expiresAt:startedAt+600000}};
const completed={reason:'completed',...completedReference(),endedAt:startedAt+18000,ranked:false};
const internal=(path,body)=>new Request('https://internal/'+path,{method:'POST',body:JSON.stringify(body)});
function context(){
  const data=new Map();let alarm=null;
  return {data,storage:{async get(k){return structuredClone(data.get(k));},async put(k,v){data.set(k,structuredClone(v));},
    async delete(k){data.delete(k);},async setAlarm(at){alarm=at;},async getAlarm(){return alarm;},async deleteAll(){data.clear();alarm=null;}},
    blockConcurrencyWhile:fn=>fn(),waitUntil:()=>{}};
}
function fixture({failure=false}={}){
  const ctx=context(),writes=[],released=[];
  const env={PLAYER_RUNS_ENABLED:'true',RANKED_SUBMISSIONS_ENABLED:'true',
    ADMISSION:{idFromName:id=>id,get:()=>({fetch:async request=>{released.push(await request.json());return Response.json({released:true});}})},
    SCORES:{idFromName:id=>id,get:()=>({fetch:async request=>{
      writes.push(await request.json());if(failure)throw Error('temporary outage');
      return Response.json({saved:true,personalBest:true,best:{value:scoredReference.time}});
    }})}};
  return {ctx,env,writes,released,run:new VerifiedRun(ctx,env),recover(){failure=false;}};
}

test('a complete human input replay produces the score candidate from trusted timing and checkpoints',()=>{
  assert.equal(completed.completed,true);assert.equal(completed.invalid,null);assert.equal(completed.ticks,scoredReference.ticks);
  assert.ok(Math.abs(completed.time-scoredReference.time)<1e-9);
  const candidate=scoreFromOutcome(init,completed);
  assert.equal(candidate.accountId,accountId);assert.equal(candidate.timeNs,14711312665);assert.equal(candidate.runId,init.lease.id);
  for(const change of [{reason:'client-left'},{completed:false},{invalid:'respawn'},{checkpoint:2},{time:0},{time:NaN},{time:600},{ticks:0},{endedAt:init.lease.expiresAt+1}])
    assert.equal(scoreFromOutcome(init,{...completed,...change}),null,JSON.stringify(change));
  assert.equal(scoreFromOutcome({...init,kind:'staging'},completed),null);
  assert.equal(scoreFromOutcome({...init,scoreEligible:false},completed),null);
  assert.equal(scoreFromOutcome({...init,botVerified:false},completed),null);
  assert.equal(scoreFromOutcome({...init,selection:{...init.selection,revision:99}},completed),null);
  assert.equal(scoreFromOutcome({...init,selection:{map:'course',revision:1,preset:'classic'}},completed),null);
  assert.equal(scoreFromOutcome({...init,selection:{...init.selection,preset:'practice'}},completed),null);
});
test('server completion saves under the authenticated account, acknowledges only after storage, and is idempotent',async()=>{
  const f=fixture();await f.ctx.storage.put('init',init);
  const result=await f.run.cleanup(init,completed);
  assert.equal(result.ranked,true);assert.equal(result.scoreStatus,'saved');assert.equal(f.writes.length,1);
  assert.deepEqual(f.writes[0],scoreFromOutcome(init,completed));assert.equal(f.released.length,1);
  assert.equal(await f.ctx.storage.get('init'),undefined);
  await f.run.cleanup(init,completed);assert.equal(f.writes.length,1);
  const response=await f.run.fetch(internal('player-status',{accountId})),visible=await response.json();
  assert.equal(visible.scoreStatus,'saved');
  for(const key of ['accountId','scoreCandidate','scoreAttempts','diagnosticsExpireAt'])assert.equal(Object.hasOwn(visible,key),false);
  assert.equal((await f.run.fetch(internal('player-status',{accountId:'b'.repeat(43)}))).status,404);
});
test('failed score storage releases capacity, survives object reconstruction and retries the same immutable candidate',async()=>{
  const f=fixture({failure:true});await f.ctx.storage.put('init',init);
  let result=await f.run.cleanup(init,completed);
  assert.equal(result.scoreStatus,'pending');assert.equal(result.ranked,false);assert.equal(f.released.length,1);
  assert.equal(await f.ctx.storage.get('init'),undefined);assert.ok(await f.ctx.storage.getAlarm()>Date.now());
  f.recover();await new VerifiedRun(f.ctx,f.env).alarm();
  result=await f.ctx.storage.get('outcome');assert.equal(result.scoreStatus,'saved');assert.equal(result.ranked,true);
  assert.equal(f.writes.length,2);assert.deepEqual(f.writes[0],f.writes[1]);
});
test('private, invalid, cancelled, interrupted and disabled attempts never write scores; retries are bounded',async()=>{
  for(const [initial,result] of [[{...init,kind:'staging'},completed],[init,{...completed,reason:'player-cancelled'}],
    [init,{...completed,reason:'completed',invalid:'respawn'}],[init,{reason:'unopened-or-interrupted',ranked:false}]]){
    const f=fixture();await f.run.cleanup(initial,result);assert.equal(f.writes.length,0);assert.equal(f.released.length,1);
  }
  const disabled=fixture();disabled.env.RANKED_SUBMISSIONS_ENABLED='false';
  assert.equal((await disabled.run.cleanup(init,completed)).scoreStatus,'disabled');assert.equal(disabled.writes.length,0);
  const pending=fixture({failure:true});await pending.run.cleanup(init,completed);
  pending.env.RANKED_SUBMISSIONS_ENABLED='false';await pending.run.alarm();assert.equal(pending.writes.length,1);
  assert.equal((await pending.ctx.storage.get('outcome')).scoreStatus,'disabled');
  const failing=fixture({failure:true});await failing.run.cleanup(init,completed);
  for(let i=0;i<20;i++)await failing.run.alarm();
  const final=await failing.ctx.storage.get('outcome');assert.equal(failing.writes.length,12);assert.equal(final.scoreStatus,'failed');assert.equal(final.scoreCandidate,null);
  final.diagnosticsExpireAt=Date.now()-1;await failing.ctx.storage.put('outcome',final);await failing.run.alarm();assert.equal(failing.ctx.data.size,0);
});
test('public run and score routes are disabled by default, including direct score posts',async()=>{
  for(const path of ['/v1/player/runs','/v1/leaderboards/bhop-school/classic','/v1/leaderboards/bhop-school/classic/submit']){
    const response=await worker.fetch(new Request('https://test'+path,{method:'POST',headers:{origin:'http://localhost:5173'},body:'{"time":1}'}),{ALLOWED_ORIGINS:'http://localhost:5173'});
    assert.equal(response.status,503);
  }
});

test('private completions use the isolated score namespace even while public writes are disabled',async()=>{
  const f=fixture();f.env.PLAYER_RUNS_ENABLED='false';f.env.RANKED_SUBMISSIONS_ENABLED='false';f.env.STAGING_ENABLED='true';f.env.PRIVATE_PLAYER_TESTING_ENABLED='true';
  const namespaces=[];f.env.SCORES.idFromName=id=>{namespaces.push(id);return id;};
  const result=await f.run.cleanup({...init,privateTest:true},completed);
  assert.equal(result.scoreStatus,'saved');assert.equal(result.privateTest,true);assert.deepEqual(namespaces,['private-test-v1']);
  assert.equal(f.writes.length,1);assert.equal(f.released.length,1);
  const disabled=fixture();disabled.env.PLAYER_RUNS_ENABLED='false';disabled.env.RANKED_SUBMISSIONS_ENABLED='false';
  const stopped=await disabled.run.cleanup({...init,privateTest:true},completed);assert.equal(stopped.scoreStatus,'disabled');assert.equal(disabled.writes.length,0);
});
