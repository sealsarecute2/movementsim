import {authenticatePlayer,PlayerAuthError} from './player-auth.js';
import {configuredSecret,networkKey,signTicket,verifyTicket} from './auth.js';
import {scoreBoard} from './score-store.js';
import {verifyBot,turnstileConfigured} from './bot-check.js';
import {privateTestingEnabled,privateTestOrigin,privateTesterAllowed,enrollPrivateTester} from './private-access.js';
import {VERIFIED_BETA_COURSES,betaCourseAllowed} from './catalog.js';

const internal=(path,body)=>new Request('https://internal/'+path,{method:'POST',body:JSON.stringify(body)});
const coordinator=env=>env.ADMISSION.get(env.ADMISSION.idFromName('global-v1'));
const runObject=(env,id)=>env.RUNS.get(env.RUNS.idFromName(id));
const validId=id=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
export const rankedEnabled=env=>env.PLAYER_RUNS_ENABLED==='true'&&env.RANKED_SUBMISSIONS_ENABLED==='true';

async function selectionBody(request){
  if(request.headers.get('content-type')?.split(';')[0].toLowerCase()!=='application/json')throw new PlayerAuthError('content-type',415);
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>4096))throw new PlayerAuthError('body-size',413);
  const reader=request.body?.getReader();if(!reader)throw new PlayerAuthError('body-size',413);
  let timer,size=0;const chunks=[];
  try{
    await Promise.race([(async()=>{
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096)throw new PlayerAuthError('body-size',413);chunks.push(value);}
    })(),new Promise((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(new PlayerAuthError('body-timeout',408));},5000);})]);
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!=='map,preset,turnstileToken')throw Error();
    if(typeof value.turnstileToken!=='string'||!value.turnstileToken||value.turnstileToken.length>2048)throw new PlayerAuthError('bot-check-required',400);
    const board=scoreBoard(value.map,value.preset);
    return {selection:{map:board.map,revision:board.revision,preset:board.preset},turnstileToken:value.turnstileToken};
  }catch(error){void reader.cancel().catch(()=>{});if(error instanceof PlayerAuthError)throw error;throw new PlayerAuthError('invalid-selection',400);}
  finally{clearTimeout(timer);}
}

export async function handlePlayerRuns(request,env){
  const url=new URL(request.url),path=url.pathname,origin=request.headers.get('origin');
  const permitted=!!origin&&origin!=='null'&&(env.ALLOWED_ORIGINS||'').split(',').includes(origin);
  const headers={'cache-control':'no-store','x-content-type-options':'nosniff','vary':'Origin',...(permitted?{'access-control-allow-origin':origin}:{})};
  const reply=(data,status=200)=>Response.json(data,{status,headers});
  const wrap=response=>new Response(response.body,{status:response.status,headers:{...Object.fromEntries(response.headers),...headers}});
  if(!permitted)return reply({error:'origin-not-allowed'},403);
  const privateMode=privateTestingEnabled(env)&&origin===privateTestOrigin&&env.PLAYER_RUNS_ENABLED!=='true';
  if(path==='/v1/player/test/enroll'){
    try{return wrap(await enrollPrivateTester(request,env));}
    catch(error){return reply({error:error instanceof PlayerAuthError?error.code:'private-test-unavailable'},error instanceof PlayerAuthError?error.status:503);}
  }
  if(path==='/v1/player/config'){
    if(request.method==='OPTIONS'){
      if(request.headers.get('access-control-request-method')!=='GET'||(request.headers.get('access-control-request-headers')||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean).some(x=>x!=='authorization'))return reply({error:'invalid-preflight'},403);
      return new Response(null,{status:204,headers:{...headers,'access-control-allow-methods':'GET','access-control-allow-headers':'Authorization','access-control-max-age':'600'}});
    }
    if(request.method!=='GET')return reply({error:'method-not-allowed'},405);
    if(!configuredSecret(env.PLAYER_AUTH_KEY)||!env.START_RATE)return reply({error:'player-runs-disabled'},503);
    const address=request.headers.get('cf-connecting-ip');if(!address)return reply({error:'missing-network'},400);
    const net=await networkKey(address,env.PLAYER_AUTH_KEY);
    if(!(await env.START_RATE.limit({key:'player-config:'+net})).success)return reply({error:'request-rate'},429);
    let tester=false,signedIn=false;
    if(privateMode&&request.headers.has('authorization')){
      try{const player=await authenticatePlayer(request,env);signedIn=true;tester=await privateTesterAllowed(env,player.accountId);}
      catch(error){if(!(error instanceof PlayerAuthError)||error.status!==401)return reply({error:'private-test-unavailable'},503);}
    }
    const enabled=(rankedEnabled(env)||privateMode&&tester)&&env.GOOGLE_LOGIN_ENABLED==='true'&&turnstileConfigured(env);
    return reply({enabled,ranked:enabled,siteKey:enabled?env.TURNSTILE_SITE_KEY:null,tickRate:256,ruleset:'verified-v1',courses:VERIFIED_BETA_COURSES,beta:!privateMode,
      ...(privateMode?{privateTest:true,requiresEnrollment:signedIn&&!tester}:{})});
  }
  if((env.PLAYER_RUNS_ENABLED!=='true'&&!privateMode)||env.GOOGLE_LOGIN_ENABLED!=='true'||!configuredSecret(env.PLAYER_AUTH_KEY)||
    !env.PLAYER_SESSIONS||!env.ADMISSION||!env.RUNS||!env.SCORES||!env.START_RATE)return reply({error:'player-runs-disabled'},503);
  const match=/^\/v1\/player\/runs\/([^/]+)(?:\/(socket|cancel))?$/.exec(path);
  const boardMatch=/^\/v1\/leaderboards\/([^/]+)\/(classic|practice)$/.exec(path);
  const method=path==='/v1/player/runs'?'POST':boardMatch?'GET':match&&validId(match[1])?(match[2]==='cancel'?'POST':'GET'):null;
  if(!method)return reply({error:'not-found'},404);
  if(request.method==='OPTIONS'){
    const asked=(request.headers.get('access-control-request-headers')||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
    if(request.headers.get('access-control-request-method')!==method||asked.some(x=>!['authorization','content-type'].includes(x)))return reply({error:'invalid-preflight'},403);
    return new Response(null,{status:204,headers:{...headers,'access-control-allow-methods':method,'access-control-allow-headers':'Authorization, Content-Type','access-control-max-age':'600'}});
  }
  if(request.method!==method)return reply({error:'method-not-allowed'},405);
  try{
    const address=request.headers.get('cf-connecting-ip');if(!address)return reply({error:'missing-network'},400);
    // Share the network identity with owner staging traffic when it is configured.
    const net=await networkKey(address,configuredSecret(env.STAGING_KEY)?env.STAGING_KEY:env.PLAYER_AUTH_KEY);
    if(!(await env.START_RATE.limit({key:'player-api:'+net})).success)return reply({error:'request-rate'},429);
    let player=null;
    if(privateMode&&match?.[2]!=='socket'){
      player=await authenticatePlayer(request,env);
      if(!await privateTesterAllowed(env,player.accountId))return reply({error:'private-test-access-required'},403);
    }
    if(boardMatch){
      if(!rankedEnabled(env)&&!privateMode)return reply({error:'leaderboards-disabled'},503);
      let board;try{board=scoreBoard(boardMatch[1],boardMatch[2]);}catch{return reply({error:'invalid-board'},400);}
      if(url.searchParams.get('revision')!==String(board.revision)||[...url.searchParams.keys()].some(k=>k!=='revision'))return reply({error:'revision-mismatch'},409);
      if(!privateMode&&!betaCourseAllowed(board))return reply({error:'course-not-ranked'},400);
      return wrap(await env.SCORES.get(env.SCORES.idFromName(privateMode?'private-test-v1':'global-v1')).fetch(internal('board',board)));
    }
    if(match?.[2]==='socket'){
      if(request.headers.get('upgrade')?.toLowerCase()!=='websocket')return reply({error:'invalid-upgrade'},400);
      const protocols=request.headers.get('sec-websocket-protocol')||'';
      if(protocols.length>2200)return reply({error:'invalid-ticket'},401);
      const offered=protocols.split(',').map(x=>x.trim());if(!offered.includes('movementlab-v1'))return reply({error:'invalid-protocol'},400);
      let claims;try{claims=await verifyTicket(offered.find(x=>x.startsWith('ticket.'))?.slice(7),env.PLAYER_AUTH_KEY,match[1]);}
      catch{return reply({error:'invalid-ticket'},401);}
      if(claims.kind!=='player'||claims.origin!==origin)return reply({error:'invalid-ticket'},401);
      if(!!claims.privateTest!==privateMode)return reply({error:'invalid-ticket'},401);
      const active=await env.PLAYER_SESSIONS.get(env.PLAYER_SESSIONS.idFromName(claims.accountId)).fetch(internal('check',{
        accountId:claims.accountId,sessionId:claims.playerSessionId,expiresAt:claims.playerExpiresAt,
      }));
      if(!active.ok)return reply({error:'player-auth-required'},active.status===401?401:503);
      if(privateMode&&!await privateTesterAllowed(env,claims.accountId))return reply({error:'private-test-access-required'},403);
      // Never forward caller-supplied internal headers.
      return runObject(env,match[1]).fetch(new Request('https://internal/socket',{headers:{upgrade:'websocket','sec-websocket-protocol':'movementlab-v1','x-run-claims':JSON.stringify(claims)}}));
    }
    player=player||await authenticatePlayer(request,env);
    if(match)return wrap(await runObject(env,match[1]).fetch(internal(match[2]==='cancel'?'player-cancel':'player-status',{accountId:player.accountId,privateTest:privateMode})));
    const {selection,turnstileToken}=await selectionBody(request);
    if(!betaCourseAllowed(selection))return reply({error:privateMode?'private-test-course-only':'course-not-ranked'},400);
    await verifyBot(turnstileToken,{env,origin,address});
    const response=await coordinator(env).fetch(internal('acquire',{accountId:player.accountId,networkKey:net,kind:'player'}));
    if(!response.ok)return wrap(response);
    const lease=await response.json(),seed=crypto.getRandomValues(new Uint32Array(1))[0],scoreEligible=rankedEnabled(env)||privateMode;
    try{
      const allocated=await runObject(env,lease.id).fetch(internal('init',{lease,selection,seed,kind:'player',origin,scoreEligible,botVerified:true,privateTest:privateMode}));
      if(!allocated.ok)throw Error('allocation-failed');
      const expiresAt=Math.min(Date.now()+30000,lease.expiresAt,player.expiresAt??Infinity);
      const ticket=await signTicket({v:1,runId:lease.id,accountId:player.accountId,exp:expiresAt,kind:'player',origin,
        playerSessionId:player.sessionId,playerExpiresAt:player.expiresAt,privateTest:privateMode},env.PLAYER_AUTH_KEY);
      return reply({runId:lease.id,ticket,expiresAt,selection,seed,ranked:scoreEligible,privateTest:privateMode,socketPath:`/v1/player/runs/${lease.id}/socket`},201);
    }catch{
      await coordinator(env).fetch(internal('release',{id:lease.id,accountId:player.accountId}));
      return reply({error:'allocation-failed'},503);
    }
  }catch(error){return reply({error:error instanceof PlayerAuthError?error.code:'player-runs-unavailable'},error instanceof PlayerAuthError?error.status:503);}
}
