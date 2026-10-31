import {RunAdmission,VerificationLimitError} from './limits.js';
import {configuredSecret,ownerAuthorized,networkKey,signTicket,verifyTicket} from './auth.js';
import {trustedCourse,courseSelection} from './catalog.js';
import {VerificationSession} from './session.js';
import {handlePlayerAuth} from './player-auth.js';
import {handlePlayerRuns,rankedEnabled} from './player-runs.js';
import {scoreFromOutcome} from './score-store.js';
import {privateTestingEnabled} from './private-access.js';
export {PlayerSessions} from './player-auth.js';
export {VerifiedScores} from './score-store.js';

const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const coordinator=env=>env.ADMISSION.get(env.ADMISSION.idFromName('global-v1'));
const runObject=(env,id)=>env.RUNS.get(env.RUNS.idFromName(id));
const internal=(path,body)=>new Request('https://internal/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const validId=id=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);

export default {
  async fetch(request,env){
    const url=new URL(request.url),path=url.pathname;
    if(path.startsWith('/v1/auth/'))return handlePlayerAuth(request,env);
    if(path==='/v1/player/config'||path==='/v1/player/test/enroll'||path==='/v1/player/runs'||path.startsWith('/v1/player/runs/')||path.startsWith('/v1/leaderboards/'))return handlePlayerRuns(request,env);
    if(path==='/health'&&request.method==='GET')return json({service:'movement-lab-verifier',mode:env.PLAYER_RUNS_ENABLED==='true'?'player-verification':'private-staging',ranked:rankedEnabled(env)});
    if(env.STAGING_ENABLED!=='true'||!configuredSecret(env.STAGING_KEY))return json({error:'staging-disabled'},503);
    const origin=request.headers.get('origin');
    const origins=(env.ALLOWED_ORIGINS||'').split(',').filter(Boolean);
    if(origin&&!origins.includes(origin))return json({error:'origin-not-allowed'},403);
    const socket=/^\/v1\/runs\/([^/]+)\/socket$/.exec(path);
    if(socket){
      if(request.method!=='GET'||request.headers.get('upgrade')?.toLowerCase()!=='websocket'||!validId(socket[1]))return json({error:'invalid-upgrade'},400);
      const protocols=request.headers.get('sec-websocket-protocol')||'';
      if(protocols.length>2200)return json({error:'invalid-ticket'},401);
      const address=request.headers.get('cf-connecting-ip');
      if(!address)return json({error:'missing-network'},400);
      const net=await networkKey(address,env.STAGING_KEY);
      if(!env.START_RATE||!(await env.START_RATE.limit({key:'socket:'+net})).success)return json({error:'upgrade-rate'},429);
      const offered=protocols.split(',').map(s=>s.trim());
      if(!offered.includes('movementlab-v1'))return json({error:'invalid-protocol'},400);
      let claims;
      try{claims=await verifyTicket(offered.find(p=>p.startsWith('ticket.'))?.slice(7),env.STAGING_KEY,socket[1]);}
      catch{return json({error:'invalid-ticket'},401);}
      // Build a fresh internal request so caller-supplied internal headers cannot survive.
      return runObject(env,socket[1]).fetch(new Request('https://internal/socket',{headers:{upgrade:'websocket','sec-websocket-protocol':'movementlab-v1','x-run-claims':JSON.stringify(claims)}}));
    }
    if(!ownerAuthorized(request,env.STAGING_KEY))return json({error:'owner-auth-required'},401);
    try{
      if(path==='/v1/status'&&request.method==='GET')return coordinator(env).fetch(internal('status',{}));
      if(path==='/v1/private-test/status'&&request.method==='GET'){
        const summary=await coordinator(env).fetch(internal('private-summary',{}));
        if(!summary.ok)return json({error:'private-status-unavailable'},503);
        const access=await summary.json();
        const boardResponse=await env.SCORES.get(env.SCORES.idFromName('private-test-v1')).fetch(internal('board',{map:'bhop-school',revision:1,preset:'classic'}));
        if(!boardResponse.ok)return json({error:'private-status-unavailable'},503);
        const board=await boardResponse.json(),record=board.records[0];let best=null;
        if(record){
          const outcome=await (await runObject(env,record.runId).fetch('https://internal/status')).json();
          best={time:record.value,timeNs:record.timeNs,runId:record.runId,achievedAt:record.achievedAt,scoreSaved:true,
            proof:outcome.reason?{reason:outcome.reason,completed:outcome.completed,invalid:outcome.invalid,checkpoints:outcome.checkpoint,
              ticks:outcome.ticks,scoreStatus:outcome.scoreStatus,privateTest:outcome.privateTest,timeMatches:Math.round(outcome.time*1e9)===record.timeNs}:null};
        }
        return json({...access,map:'bhop-school',preset:'classic',best,privateTestingEnabled:privateTestingEnabled(env),publicRanked:rankedEnabled(env)});
      }
      if(path==='/v1/stop-all'&&request.method==='POST'){
        const leases=await (await coordinator(env).fetch(internal('leases',{}))).json();
        const stopped=await Promise.allSettled(leases.map(lease=>runObject(env,lease.id).fetch(internal('stop',{}))));
        return json({requested:leases.length,errors:stopped.filter(r=>r.status==='rejected'||!r.value.ok).length});
      }
      const status=/^\/v1\/runs\/([^/]+)$/.exec(path);
      if(status&&request.method==='GET'&&validId(status[1]))return runObject(env,status[1]).fetch('https://internal/status');
      if(path!=='/v1/runs'||request.method!=='POST')return json({error:'not-found'},404);
      const length=request.headers.get('content-length');
      if(!/^\d+$/.test(length||'')||Number(length)>1024||Number(length)<1)return json({error:'body-size'},413);
      if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return json({error:'content-type'},415);
      const address=request.headers.get('cf-connecting-ip');
      if(!address)return json({error:'missing-network'},400);
      const net=await networkKey(address,env.STAGING_KEY);
      if(!env.START_RATE||!(await env.START_RATE.limit({key:net})).success)return json({error:'start-rate'},429);
      // The declared length is not trusted as the only body limit.
      const reader=request.body?.getReader();if(!reader)return json({error:'body-size'},413);
      let bytes=0;const chunks=[];
      while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1024){await reader.cancel();return json({error:'body-size'},413);}chunks.push(value);}
      const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
      let selection;try{selection=courseSelection(JSON.parse(new TextDecoder().decode(body)));}catch{return json({error:'invalid-selection'},400);}
      const accountId='staging-slot-'+selection.slot;
      // Slots are operator-controlled fixtures, NOT public player identities.
      const response=await coordinator(env).fetch(internal('acquire',{accountId,networkKey:net}));
      if(!response.ok)return response;
      const lease=await response.json(),seed=crypto.getRandomValues(new Uint32Array(1))[0];
      try{
        const result=await runObject(env,lease.id).fetch(internal('init',{lease,selection,seed}));
        if(!result.ok)throw Error('allocation-failed');
        const exp=Math.min(Date.now()+30000,lease.expiresAt);
        const ticket=await signTicket({v:1,runId:lease.id,accountId,exp},env.STAGING_KEY);
        return json({runId:lease.id,ticket,expiresAt:exp,selection,seed,ranked:false},201);
      }catch{
        // Allocation failure cannot strand a reserved slot until its full TTL.
        await coordinator(env).fetch(internal('release',{id:lease.id,accountId}));
        return json({error:'allocation-failed'},503);
      }
    }catch{return json({error:'staging-unavailable'},503);}
  },
};

export class AdmissionCoordinator {
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  async update(operation){
    return this.ctx.blockConcurrencyWhile(async()=>{
      const guard=new RunAdmission({snapshot:await this.ctx.storage.get('admission'),limits:{perNetwork:8}});
      guard.sweep();let result;
      try{result=operation(guard);}catch(error){
        if(!(error instanceof VerificationLimitError))throw error;
        result=json({error:error.code},429);
      }
      await this.ctx.storage.put('admission',guard.snapshot());
      if(guard.leases.size)await this.ctx.storage.setAlarm(Math.min(...[...guard.leases.values()].map(l=>l.expiresAt)));
      else await this.ctx.storage.deleteAlarm();
      return result;
    });
  }
  async fetch(request){
    const path=new URL(request.url).pathname;
    const body=await request.json();
    if(path==='/private-summary')return this.ctx.blockConcurrencyWhile(async()=>{
      const tester=await this.ctx.storage.get('private-tester'),snapshot=await this.ctx.storage.get('admission');
      const active=(snapshot?.leases||[]).filter(([,lease])=>lease.accountId===tester?.accountId&&lease.expiresAt>Date.now());
      return json({testerEnrolled:!!tester,enrolledAt:tester?.enrolledAt||null,activeAttempts:active.length});
    });
    if(path==='/private-enroll'||path==='/private-check')return this.ctx.blockConcurrencyWhile(async()=>{
      if(!/^[A-Za-z0-9_-]{43}$/.test(body.accountId))return json({error:'invalid-account'},400);
      const tester=await this.ctx.storage.get('private-tester');
      if(path==='/private-check')return json({allowed:tester?.accountId===body.accountId});
      if(tester&&tester.accountId!==body.accountId)return json({error:'private-test-account-mismatch'},409);
      if(!tester)await this.ctx.storage.put('private-tester',{accountId:body.accountId,enrolledAt:Date.now()});
      return json({enrolled:true});
    });
    return this.update(guard=>{
      if(path==='/acquire'){
        // Operator batches keep their tested eight-client allowance. Player
        // starts share the same global budget with a four-per-network cap.
        guard.limits.perNetwork=body.kind==='player'?4:8;
        return json(guard.acquire(body),201);
      }
      if(path==='/release')return json({released:guard.release(body.id,body.accountId)});
      if(path==='/leases')return json([...guard.leases.values()].map(l=>({id:l.id})));
      if(path==='/status')return json({active:guard.leases.size,limit:guard.limits.activeRuns,reservedRunMs:guard.days.get(Math.floor(Date.now()/86400000))||0,dailyRunMs:guard.limits.dailyRunMs,mode:'private-staging',ranked:false});
      return json({error:'not-found'},404);
    });
  }
  async alarm(){await this.update(()=>null);}
}

export class VerifiedRun {
  constructor(ctx,env){this.ctx=ctx;this.env=env;this.session=null;this.timer=null;this.socket=null;this.finalizing=null;}
  async release(init){
    const response=await coordinator(this.env).fetch(internal('release',{id:init.lease.id,accountId:init.lease.accountId}));
    if(!response.ok)throw Error('release-failed');
  }
  async cleanup(init,result){
    if(this.finalizing)return this.finalizing;
    this.finalizing=(async()=>{
      // Persist the authoritative result before any external write or release.
      // A failed score write must never retain a gameplay capacity reservation.
      let outcome=await this.ctx.storage.get('outcome');
      if(!outcome){
        const scoreCandidate=scoreFromOutcome(init,result);
        outcome={...result,accountId:init.lease.accountId,privateTest:init.privateTest===true,ranked:false,scoreStatus:scoreCandidate?'pending':'not-eligible',
          scoreCandidate,scoreAttempts:0,diagnosticsExpireAt:Date.now()+86400000};
        await this.ctx.storage.put('outcome',outcome);
      }
      await this.ctx.storage.setAlarm(Date.now()+5000);
      await this.release(init);
      await this.ctx.storage.delete('init');
      return this.flushScore(outcome);
    })();
    try{return await this.finalizing;}finally{this.finalizing=null;}
  }
  async flushScore(outcome){
    if(outcome.scoreStatus==='pending'){
      if(!(outcome.privateTest?privateTestingEnabled(this.env):rankedEnabled(this.env)))outcome={...outcome,scoreStatus:'disabled',scoreCandidate:null};
      else{
        try{
          const response=await this.env.SCORES.get(this.env.SCORES.idFromName(outcome.privateTest?'private-test-v1':'global-v1')).fetch(internal('record',outcome.scoreCandidate));
          if(!response.ok)throw Error('score-unavailable');
          const receipt=await response.json();if(receipt.saved!==true)throw Error('score-unavailable');
          outcome={...outcome,ranked:true,scoreStatus:'saved',scoreCandidate:null,score:receipt};
        }catch{
          const scoreAttempts=outcome.scoreAttempts+1;
          outcome={...outcome,scoreAttempts,scoreStatus:scoreAttempts>=12?'failed':'pending'};
          if(outcome.scoreStatus==='failed')outcome.scoreCandidate=null;
        }
      }
      await this.ctx.storage.put('outcome',outcome);
    }
    await this.ctx.storage.setAlarm(outcome.scoreStatus==='pending'?
      Math.min(outcome.diagnosticsExpireAt,Date.now()+Math.min(900000,5000*2**outcome.scoreAttempts)):outcome.diagnosticsExpireAt);
    return outcome;
  }
  async fetch(request){
    if(typeof request==='string')request=new Request(request);
    const path=new URL(request.url).pathname;
    if(path==='/status')return json(await this.ctx.storage.get('outcome')||{status:'active-or-not-started',ranked:false});
    if(path==='/player-status'||path==='/player-cancel'){
      const {accountId,privateTest}=await request.json(),init=await this.ctx.storage.get('init'),outcome=await this.ctx.storage.get('outcome');
      if((init?.kind!=='player'||init.lease.accountId!==accountId)&&outcome?.accountId!==accountId)return json({error:'run-not-found'},404);
      if(!!(init?.privateTest||outcome?.privateTest)!==!!privateTest)return json({error:'run-not-found'},404);
      if(path==='/player-status')return json(outcome?this.publicOutcome(outcome):{status:'active',ranked:false});
      if(init){if(this.session)this.session.end('player-cancelled');else await this.cleanup(init,{reason:'player-cancelled',ranked:false});}
      return json({cancelled:true});
    }
    if(path==='/stop'){
      if(this.session)this.session.end('operator-stopped');
      else{const init=await this.ctx.storage.get('init');if(init)await this.cleanup(init,{reason:'operator-stopped',ranked:false});}
      return json({stopped:true});
    }
    if(path==='/init'){
      return this.ctx.blockConcurrencyWhile(async()=>{
        if(await this.ctx.storage.get('init'))return json({error:'already-initialized'},409);
        const init=await request.json();await this.ctx.storage.put('init',init);await this.ctx.storage.setAlarm(Math.min(Date.now()+15000,init.lease.expiresAt));
        return json({ready:true});
      });
    }
    if(path!=='/socket')return json({error:'not-found'},404);
    return this.ctx.blockConcurrencyWhile(async()=>{
      const init=await this.ctx.storage.get('init');
      if(!init||await this.ctx.storage.get('consumed')||Date.now()>=init.lease.expiresAt)return json({error:'run-unavailable'},409);
      let claims;try{claims=JSON.parse(request.headers.get('x-run-claims'));}catch{return json({error:'invalid-ticket'},401);}
      if(claims.runId!==init.lease.id||claims.accountId!==init.lease.accountId||claims.exp<=Date.now()||
        (claims.kind||'staging')!==(init.kind||'staging')||!!claims.privateTest!==!!init.privateTest||(init.kind==='player'&&claims.origin!==init.origin))return json({error:'invalid-ticket'},401);
      const pair=new WebSocketPair(),client=pair[0],socket=pair[1];
      await this.ctx.storage.put('consumed',true);await this.ctx.storage.setAlarm(Date.now()+6000);
      const playerRun=init.kind==='player';
      const send=message=>{if(!playerRun||message.type!=='ended')socket.send(JSON.stringify(message));};this.socket=socket;socket.accept();
      this.session=new VerificationSession({map:trustedCourse(init.selection.map),preset:init.selection.preset,seed:init.seed,startedAt:Date.now(),expiresAt:init.lease.expiresAt,send,
        onEnd:result=>{
          if(this.timer!==null)clearInterval(this.timer);this.timer=null;
          if(!playerRun){try{socket.close(1000,'attempt-ended');}catch{}this.ctx.waitUntil(this.cleanup(init,result));}
          else this.ctx.waitUntil((async()=>{
            try{const outcome=await this.cleanup(init,result);socket.send(JSON.stringify({type:'ended',...this.publicOutcome(outcome)}));}
            catch{try{socket.send(JSON.stringify({type:'ended',...result,ranked:false,scoreStatus:'unavailable'}));}catch{}}
            finally{try{socket.close(1000,'attempt-ended');}catch{}}
          })());
        }});
      socket.addEventListener('message',event=>this.session.receive(event.data));
      socket.addEventListener('close',()=>this.session.end('client-left'));
      socket.addEventListener('error',()=>this.session.end('connection-error'));
      this.timer=setInterval(()=>this.session.advance(),16);
      send({type:'ready',runId:init.lease.id,tickRate:256,privateTest:init.privateTest===true,ranked:playerRun&&init.scoreEligible&&(init.privateTest?privateTestingEnabled(this.env):rankedEnabled(this.env))});
      return new Response(null,{status:101,webSocket:client,headers:{'sec-websocket-protocol':'movementlab-v1'}});
    });
  }
  publicOutcome(outcome){
    const {accountId,scoreCandidate,scoreAttempts,diagnosticsExpireAt,...visible}=outcome;
    return visible;
  }
  async alarm(){
    const init=await this.ctx.storage.get('init');
    if(!init){
      const outcome=await this.ctx.storage.get('outcome');
      if(outcome?.diagnosticsExpireAt<=Date.now())await this.ctx.storage.deleteAll();
      else if(outcome)await this.flushScore(outcome);
      return;
    }
    if(this.session&&!this.session.ended){
      this.session.advance();if(!this.session.ended)await this.ctx.storage.setAlarm(Math.min(Date.now()+6000,init.lease.expiresAt));
      return;
    }
    // A run never resumes after an object restart: fail closed and free its slot.
    await this.cleanup(init,await this.ctx.storage.get('outcome')||{reason:'unopened-or-interrupted',ranked:false});
  }
}
