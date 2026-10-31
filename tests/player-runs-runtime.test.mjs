import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';
import {referenceFrames,scoredReference} from './helpers/scored-reference.mjs';
import {VerifiedRunClient} from '../dist/verified-runs.js';

const require=createRequire(new URL('../verification/package.json',import.meta.url));
const {Miniflare,convertV4MiniflareOptions,Response:RuntimeResponse,Log,LogLevel}=await import(require.resolve('miniflare'));
const {build}=await import(require.resolve('esbuild'));
const {SignJWT}=await import(require.resolve('jose'));
const origin='http://localhost:5173',secret='local-runtime-player-test-key-1234567890123456789',ownerKey='local-runtime-owner-test-key-1234567890123456789';
const bundle=await build({
  stdin:{sourcefile:'runtime-scores-test.js',resolveDir:fileURLToPath(new URL('../verification/',import.meta.url)),contents:`
    import app from './worker.js';
    export {AdmissionCoordinator,VerifiedRun,PlayerSessions,VerifiedScores} from './worker.js';
    export default {fetch(request,env,ctx){
      // Test-only internal access; this wrapper is never a production entrypoint.
      const path=new URL(request.url).pathname;
      if(path.startsWith('/__test/score/'))return env.SCORES.get(env.SCORES.idFromName('global-v1')).fetch(
        new Request('https://internal/'+path.split('/').at(-1),request));
      if(path==='/__test/session')return request.json().then(body=>env.PLAYER_SESSIONS.get(env.PLAYER_SESSIONS.idFromName(body.accountId)).fetch(
        new Request('https://internal/open',{method:'POST',body:JSON.stringify(body)})));
      const headers=new Headers(request.headers);headers.set('cf-connecting-ip',headers.get('x-test-network')||'203.0.113.1');
      return app.fetch(new Request(request,{headers}),{...env,AUTH_RATE:{limit:async()=>({success:true})},START_RATE:{limit:async()=>({success:!headers.has('x-test-deny-rate')})}},ctx);
    }};
  `},bundle:true,format:'esm',platform:'browser',target:'es2022',external:['node:*'],write:false,
});
function runtime({persist,vars={},botSuccess=true,botHostname='localhost'}={}){
  const mf=new Miniflare(convertV4MiniflareOptions({
    name:'score-runtime-test',modules:true,script:bundle.outputFiles[0].text,cf:false,log:new Log(LogLevel.ERROR),
    compatibilityDate:'2026-10-29',compatibilityFlags:['nodejs_compat'],
    bindings:{GOOGLE_LOGIN_ENABLED:'true',GOOGLE_CLIENT_ID:'123-runtime.apps.googleusercontent.com',PLAYER_RUNS_ENABLED:'true',RANKED_SUBMISSIONS_ENABLED:'true',PLAYER_AUTH_KEY:secret,
      TURNSTILE_SITE_KEY:'runtime-site-key-fixture-123456789',TURNSTILE_SECRET_KEY:'runtime-secret-key-fixture-123456789',
      STAGING_ENABLED:'true',STAGING_KEY:ownerKey,ALLOWED_ORIGINS:origin,...vars},
    durableObjects:Object.fromEntries(['AdmissionCoordinator','VerifiedRun','PlayerSessions','VerifiedScores'].map((className,i)=>[
      ['ADMISSION','RUNS','PLAYER_SESSIONS','SCORES'][i],{className,useSQLite:true}])),
    ...(persist?{resourcePersistencePath:persist}:{}),
    outboundService:async request=>{
      assert.equal(request.url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      const body=await request.json();assert.equal(body.secret,'runtime-secret-key-fixture-123456789');
      return new RuntimeResponse(JSON.stringify({success:botSuccess&&body.response==='valid-test-bot-token',hostname:botHostname,action:'verified-run',challenge_ts:new Date().toISOString()}));
    },
  }));
  const call=(path,{body,token,method,headers={}}={})=>mf.dispatchFetch('http://localhost'+path,{
    method:method||(body===undefined?'GET':'POST'),headers:{origin,...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{}),...headers},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  async function session(sessionOrigin=origin){
    const accountId=randomBytes(32).toString('base64url'),sessionId=randomUUID(),at=Math.floor(Date.now()/1000),expiresAt=(at+900)*1000;
    assert.equal((await call('/__test/session',{body:{accountId,sessionId,expiresAt,nonce:randomUUID(),nonceExpiresAt:(at+300)*1000}})).status,200);
    const token=await new SignJWT({sub:accountId,sid:sessionId,origin:sessionOrigin}).setProtectedHeader({alg:'HS256',typ:'ml-session+jwt'})
      .setIssuer('movement-lab').setAudience('movement-lab-player').setIssuedAt(at).setExpirationTime(at+900).sign(new TextEncoder().encode(secret));
    return {accountId,token};
  }
  return {mf,call,session};
}
const selection={map:'bhop-school',preset:'classic',turnstileToken:'valid-test-bot-token'};
const record=(accountId,timeNs=14711312665,changes={})=>({map:'bhop-school',revision:1,preset:'classic',ruleset:'verified-v1',accountId,runId:randomUUID(),timeNs,achievedAt:Date.now(),...changes});
const boardPath='/v1/leaderboards/bhop-school/classic?revision=1';

test('real SQLite keeps the fastest personal best, separates boards, bounds reads and survives runtime restart',{timeout:30000},async()=>{
  const persist=await mkdtemp(join(tmpdir(),'movementsim-score-store-'));let f=runtime({persist});
  try{
    const account=randomBytes(32).toString('base64url'),first=record(account),faster=record(account,14000000000);
    for(const value of [first,first,record(account,20000000000),faster,record(account,14000000000)]){
      const response=await f.call('/__test/score/record',{body:value});assert.equal(response.status,200);assert.equal((await response.json()).saved,true);
    }
    assert.equal((await f.call('/__test/score/record',{body:{...faster,timeNs:100}})).status,400,'A saved run cannot change its score.');
    for(const changes of [{timeNs:NaN},{timeNs:-1},{revision:99},{accountId:'spoof'},{score:1},{map:'endless'}])
      assert.equal((await f.call('/__test/score/record',{body:record(account,10000000000,changes)})).status,400);
    assert.equal((await f.call('/__test/score/record',{body:record(account,12000000000,{preset:'practice'})})).status,200);
    const rows=(await (await f.call(boardPath)).json()).records;
    assert.equal(rows.length,1);assert.equal(rows[0].runId,faster.runId);assert.equal(rows[0].timeNs,14000000000);
    const practice=await (await f.call('/__test/score/board',{body:{map:'bhop-school',preset:'practice',revision:1}})).json();assert.equal(practice.records[0].timeNs,12000000000);
    assert.equal((await f.call('/v1/leaderboards/bhop-school/practice?revision=1')).status,400);
    assert.equal((await f.call('/v1/leaderboards/bhop-school/classic?revision=99')).status,409);
    await f.mf.dispose();f=runtime({persist});
    assert.equal((await (await f.call(boardPath)).json()).records[0].runId,faster.runId);
    for(let i=0;i<105;i++)await f.call('/__test/score/record',{body:record(randomBytes(32).toString('base64url'),15000000000+i)});
    const top=await (await f.call(boardPath)).json();assert.equal(top.records.length,100);assert.equal(top.records[0].runId,faster.runId);
    assert.ok(top.records.every((r,i)=>!i||r.timeNs>=top.records[i-1].timeNs));
  }finally{await f.mf.dispose();await rm(persist,{recursive:true,force:true});}
});

test('authenticated player routes enforce identity, origin, limits, ownership, ticket revocation and no direct score writes',{timeout:30000},async()=>{
  const f=runtime();
  try{
    const a=await f.session(),b=await f.session();
    assert.equal((await f.call('/v1/player/runs',{body:selection})).status,401);
    for(const body of [{...selection,accountId:b.accountId},{...selection,time:1},{...selection,slot:0},{map:'endless',preset:'classic'},{map:'free',preset:'classic'}])
      assert.equal((await f.call('/v1/player/runs',{body,token:a.token})).status,400);
    assert.equal((await f.call('/v1/player/runs',{body:{...selection,padding:'x'.repeat(5000)},token:a.token})).status,413);
    assert.equal((await f.call('/v1/player/runs',{body:selection,token:a.token,headers:{origin:'https://evil.example'}})).status,403);
    assert.equal((await f.call('/v1/player/runs',{body:selection,token:a.token,headers:{'x-test-deny-rate':'1'}})).status,429);
    const preflight=await f.call('/v1/player/runs',{method:'OPTIONS',headers:{'access-control-request-method':'POST','access-control-request-headers':'authorization,content-type'}});
    assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
    assert.equal(preflight.headers.get('access-control-allow-credentials'),null);
    const allocation=await f.call('/v1/player/runs',{body:selection,token:a.token});assert.equal(allocation.status,201);
    const run=await allocation.json(),path='/v1/player/runs/'+run.runId;
    assert.equal((await f.call(path,{token:b.token})).status,404);
    assert.equal((await f.call(path+'/cancel',{method:'POST',token:b.token})).status,404);
    assert.equal((await f.call('/v1/player/runs',{body:selection,token:a.token})).status,429);
    assert.equal((await f.call('/v1/stop-all',{method:'POST',token:a.token})).status,401);
    assert.equal((await f.call('/v1/leaderboards/bhop-school/classic',{body:{time:1},token:a.token})).status,405);
    assert.equal((await f.call('/v1/player/scores',{body:{time:1},token:a.token})).status,401);
    assert.equal((await f.call('/v1/auth/logout',{body:{},token:a.token})).status,200);
    const upgrade={upgrade:'websocket','sec-websocket-protocol':'movementlab-v1,ticket.'+run.ticket};
    assert.equal((await f.call(run.socketPath,{headers:upgrade})).status,401,'Logout revokes an unused connection ticket.');
    assert.equal((await f.call(run.socketPath,{headers:{...upgrade,origin:'https://evil.example'}})).status,403);
    await f.call('/v1/stop-all',{method:'POST',token:ownerKey});
    assert.equal((await (await f.call(boardPath)).json()).records.length,0);
    const clients=await Promise.all(Array.from({length:9},()=>f.session()));
    for(let i=0;i<4;i++)assert.equal((await f.call('/v1/player/runs',{body:selection,token:clients[i].token})).status,201);
    const fifth=await f.call('/v1/player/runs',{body:selection,token:clients[4].token});assert.equal(fifth.status,429);assert.equal((await fifth.json()).error,'network-active');
    for(let i=4;i<8;i++)assert.equal((await f.call('/v1/player/runs',{body:selection,token:clients[i].token,headers:{'x-test-network':'203.0.113.2'}})).status,201);
    const ninth=await f.call('/v1/player/runs',{body:selection,token:clients[8].token,headers:{'x-test-network':'203.0.113.3'}});assert.equal(ninth.status,429);assert.equal((await ninth.json()).error,'server-full');
    await f.call('/v1/stop-all',{method:'POST',token:ownerKey});
    assert.equal((await (await f.call('/v1/status',{token:ownerKey})).json()).active,0);
  }finally{await f.mf.dispose();}
});

test('private workerd testing streams the real client replay into its own score store while public submissions stay disabled',{timeout:35000},async()=>{
  const f=runtime({vars:{PLAYER_RUNS_ENABLED:'false',RANKED_SUBMISSIONS_ENABLED:'false',PRIVATE_PLAYER_TESTING_ENABLED:'true'}});let client,run;
  try{
    const player=await f.session();
    assert.equal((await f.call('/v1/player/test/enroll',{method:'POST',token:player.token,headers:{'x-staging-key':ownerKey}})).status,200);
    let endResolve;const ended=new Promise(resolve=>{endResolve=resolve;});
    class RuntimeSocket extends EventTarget{
      constructor(url,protocols){
        super();this.readyState=0;this.bufferedAmount=0;this.raw=null;
        void f.call(new URL(url).pathname,{headers:{upgrade:'websocket','sec-websocket-protocol':protocols.join(',')}}).then(response=>{
          assert.equal(response.status,101);this.raw=response.webSocket;
          if(this.readyState===3){this.raw.accept();this.raw.close();return;}
          this.readyState=1;this.raw.addEventListener('message',event=>this.dispatchEvent(new MessageEvent('message',{data:event.data})));
          this.raw.addEventListener('close',()=>{this.readyState=3;this.dispatchEvent(new Event('close'));});this.raw.accept();
        }).catch(()=>this.dispatchEvent(new Event('error')));
      }
      send(raw){this.raw.send(raw);}close(){this.readyState=3;this.raw?.close();}
    }
    client=new VerifiedRunClient({endpoint:'https://movement-lab-verifier-staging.test.workers.dev',authorization:()=> 'Bearer '+player.token,
      fetcher:async(url,options)=>{
        const response=await f.mf.dispatchFetch(url,{...options,headers:{...options.headers,origin}});
        if(url.endsWith('/v1/player/runs')&&response.ok)run=await response.clone().json();return response;
      },createSocket:(...args)=>new RuntimeSocket(...args),
      loadTurnstile:async()=>({render(container,options){options.callback('valid-test-bot-token');return 'test-widget';},remove(){}}),
      onChange:state=>{if(['saved','ended','idle'].includes(state.phase)&&state.result)endResolve(state.result);},
    });
    const selected={map:selection.map,preset:selection.preset,revision:1};
    assert.equal(await client.prepare(selected,{}),true);assert.equal(await client.start(selected),true);
    const start=performance.now();
    for(let firstTick=0;firstTick<referenceFrames.length;firstTick+=16){
      const frames=referenceFrames.slice(firstTick,firstTick+16);
      await wait(Math.max(0,start+(firstTick+frames.length)*1000/256-performance.now()));
      for(const frame of frames)client.input(frame);
    }
    client.finish();
    const result=await ended;
    assert.equal(result.reason,'completed');assert.equal(result.ranked,true);assert.equal(result.scoreStatus,'saved');
    assert.ok(Math.abs(result.time-scoredReference.time)<1e-9);assert.equal(result.checkpoint,3);
    const board=await (await f.call(boardPath,{token:player.token})).json();assert.equal(board.records.length,1);assert.equal(board.records[0].playerId,player.accountId);assert.equal(board.records[0].timeNs,14711312665);
    assert.match(client.state().status,/Private test verified/);
    const publicStore=await (await f.call('/__test/score/board',{body:{map:'bhop-school',preset:'classic',revision:1}})).json();assert.equal(publicStore.records.length,0);
    assert.equal((await (await f.call('/health')).json()).ranked,false);
    const status=await (await f.call('/v1/player/runs/'+run.runId,{token:player.token})).json();assert.equal(status.scoreStatus,'saved');assert.equal(status.scoreCandidate,undefined);
    const operator=await (await f.call('/v1/private-test/status',{token:ownerKey})).json();
    assert.equal(operator.testerEnrolled,true);assert.equal(operator.best.timeNs,14711312665);assert.equal(operator.best.proof.timeMatches,true);
    assert.equal(operator.best.proof.reason,'completed');assert.equal(operator.best.proof.checkpoints,3);assert.equal(operator.best.proof.privateTest,true);
    assert.equal(JSON.stringify(operator).includes(player.accountId),false,'Operator summaries omit account identifiers.');
    assert.equal((await f.call(run.socketPath,{headers:{upgrade:'websocket','sec-websocket-protocol':'movementlab-v1,ticket.'+run.ticket}})).status,409,'Connection tickets cannot be reused.');
    assert.equal((await (await f.call('/v1/status',{token:ownerKey})).json()).active,0);
  }finally{client?.dispose();await f.mf.dispose();}
});

test('deployment flags keep player runs and leaderboard writes closed by default',{timeout:30000},async()=>{
  const f=runtime({vars:{PLAYER_RUNS_ENABLED:'false',RANKED_SUBMISSIONS_ENABLED:'false'}});
  try{
    const a=await f.session();assert.equal((await f.call('/v1/player/runs',{body:selection,token:a.token})).status,503);
    assert.equal((await f.call(boardPath)).status,503);assert.equal((await (await f.call('/health')).json()).ranked,false);
  }finally{await f.mf.dispose();}
});

test('a player socket rejects submitted state and a cancelled attempt leaves the score table empty',{timeout:30000},async()=>{
  const f=runtime();let socket;
  try{
    const player=await f.session(),run=await (await f.call('/v1/player/runs',{body:selection,token:player.token})).json();
    const response=await f.call(run.socketPath,{headers:{upgrade:'websocket','sec-websocket-protocol':'movementlab-v1,ticket.'+run.ticket}});
    assert.equal(response.status,101);socket=response.webSocket;
    let endResolve;const ended=new Promise(resolve=>{endResolve=resolve;});
    socket.addEventListener('message',event=>{const value=JSON.parse(event.data);if(value.type==='ended')endResolve(value);});
    socket.accept();socket.send(JSON.stringify({seq:0,firstTick:0,frames:[{...referenceFrames[0],time:1,checkpoint:3}]}));
    const result=await ended;assert.equal(result.reason,'invalid-packet');assert.equal(result.ranked,false);assert.equal(result.scoreStatus,'not-eligible');
    assert.equal((await (await f.call(boardPath)).json()).records.length,0);
    const next=await (await f.call('/v1/player/runs',{body:selection,token:player.token})).json();
    assert.equal((await f.call('/v1/player/runs/'+next.runId+'/cancel',{method:'POST',token:player.token})).status,200);
    const outcome=await (await f.call('/v1/player/runs/'+next.runId,{token:player.token})).json();assert.equal(outcome.reason,'player-cancelled');
    assert.equal((await (await f.call(boardPath)).json()).records.length,0);
    assert.equal((await (await f.call('/v1/status',{token:ownerKey})).json()).active,0);
  }finally{socket?.close();await f.mf.dispose();}
});

test('missing or rejected bot proofs allocate no runs and a missing secret keeps configuration closed',{timeout:30000},async()=>{
  const f=runtime({botSuccess:false});
  try{
    const player=await f.session();
    for(const body of [{map:'bhop-school',preset:'classic'},{...selection,turnstileToken:''},selection]){
      const response=await f.call('/v1/player/runs',{body,token:player.token});assert.ok([400,403].includes(response.status));
    }
    assert.equal((await (await f.call('/v1/status',{token:ownerKey})).json()).active,0);
  }finally{await f.mf.dispose();}
  const closed=runtime({vars:{TURNSTILE_SECRET_KEY:''}});
  try{assert.equal((await (await closed.call('/v1/player/config')).json()).enabled,false);}
  finally{await closed.mf.dispose();}
});

test('private enrollment needs owner proof plus a real session and is bound atomically to one account',{timeout:30000},async()=>{
  const persist=await mkdtemp(join(tmpdir(),'movementsim-private-account-'));
  const vars={PLAYER_RUNS_ENABLED:'false',RANKED_SUBMISSIONS_ENABLED:'false',PRIVATE_PLAYER_TESTING_ENABLED:'true',ALLOWED_ORIGINS:origin+',https://sealsarecute2.github.io'};
  let f=runtime({persist,vars});
  try{
    const a=await f.session(),b=await f.session(),path='/v1/player/test/enroll';
    assert.equal((await f.call('/v1/private-test/status')).status,401);
    assert.equal((await f.call('/v1/private-test/status',{token:a.token})).status,401);
    const emptyStatus=await (await f.call('/v1/private-test/status',{token:ownerKey})).json();assert.equal(emptyStatus.testerEnrolled,false);assert.equal(emptyStatus.best,null);
    const anonymous=await (await f.call('/v1/player/config')).json();assert.equal(anonymous.enabled,false);assert.equal(anonymous.privateTest,true);
    const preflight=await f.call('/v1/player/config',{method:'OPTIONS',headers:{'access-control-request-method':'GET','access-control-request-headers':'authorization'}});assert.equal(preflight.status,204);
    assert.equal((await f.call(path,{method:'POST',token:a.token})).status,401);
    assert.equal((await f.call(path,{method:'POST',headers:{'x-staging-key':ownerKey}})).status,401);
    const enrolled=await Promise.all([a,b].map(player=>f.call(path,{method:'POST',token:player.token,headers:{'x-staging-key':ownerKey}})));
    assert.deepEqual(enrolled.map(response=>response.status).sort(),[200,409]);
    const winner=enrolled[0].status===200?a:b,other=winner===a?b:a;
    assert.equal((await (await f.call('/v1/player/config',{token:winner.token})).json()).enabled,true);
    assert.equal((await (await f.call('/v1/player/config',{token:other.token})).json()).enabled,false);
    assert.equal((await f.call('/v1/player/runs',{body:selection,token:other.token})).status,403);
    assert.equal((await f.call(boardPath,{token:other.token})).status,403);
    assert.equal((await f.call('/v1/player/runs',{body:{...selection,map:'course'},token:winner.token})).status,400);
    assert.equal((await f.call('/v1/player/runs',{body:{...selection,preset:'practice'},token:winner.token})).status,400);
    const pagesConfig=await (await f.call('/v1/player/config',{headers:{origin:'https://sealsarecute2.github.io'}})).json();assert.equal(pagesConfig.enabled,false);
    assert.equal((await f.call('/v1/player/runs',{body:selection,token:winner.token,headers:{origin:'https://sealsarecute2.github.io'}})).status,503);
    await f.mf.dispose();f=runtime({persist,vars});
    assert.equal((await (await f.call('/v1/player/config',{token:winner.token})).json()).enabled,true,'The bound account survives a runtime restart.');
    assert.equal((await f.call(path,{method:'POST',token:other.token,headers:{'x-staging-key':ownerKey}})).status,409);
    const run=await f.call('/v1/player/runs',{body:selection,token:winner.token});assert.equal(run.status,201);assert.equal((await run.json()).privateTest,true);
    await f.call('/v1/stop-all',{method:'POST',token:ownerKey});
    assert.equal((await (await f.call('/v1/status',{token:ownerKey})).json()).active,0);
  }finally{await f.mf.dispose();await rm(persist,{recursive:true,force:true});}
});

test('public beta accepts a signed Pages session for only Bhop School classic and rejects unsupported courses before admission',{timeout:30000},async()=>{
  const pages='https://sealsarecute2.github.io',f=runtime({vars:{ALLOWED_ORIGINS:origin+','+pages},botHostname:'sealsarecute2.github.io'});
  try{
    const config=await (await f.call('/v1/player/config',{headers:{origin:pages}})).json();
    assert.equal(config.enabled,true);assert.equal(config.beta,true);assert.equal(config.privateTest,undefined);
    assert.deepEqual(config.courses,[{map:'bhop-school',revision:1,preset:'classic'}]);
    const player=await f.session(pages),headers={origin:pages};
    for(const body of [{...selection,map:'course'},{...selection,map:'ladder-run'},{...selection,map:'bhop_lego'},{...selection,map:'bhop_kitsune'},{...selection,preset:'practice'}]){
      const response=await f.call('/v1/player/runs',{body,token:player.token,headers});assert.equal(response.status,400);assert.equal((await response.json()).error,'course-not-ranked');
    }
    assert.equal((await (await f.call('/v1/status',{token:ownerKey})).json()).active,0);
    const denied=await f.call('/v1/leaderboards/course/classic?revision=1',{headers});assert.equal(denied.status,400);
    const preflight=await f.call('/v1/player/runs',{method:'OPTIONS',headers:{...headers,'access-control-request-method':'POST','access-control-request-headers':'authorization,content-type'}});assert.equal(preflight.status,204);
    const response=await f.call('/v1/player/runs',{body:selection,token:player.token,headers});assert.equal(response.status,201);
    const run=await response.json();assert.equal(run.ranked,true);assert.equal(run.privateTest,false);
    assert.equal((await f.call('/v1/player/runs/'+run.runId+'/cancel',{method:'POST',token:player.token,headers})).status,200);
    assert.equal((await (await f.call('/v1/status',{token:ownerKey})).json()).active,0);
  }finally{await f.mf.dispose();}
});
