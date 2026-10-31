import {SignJWT,jwtVerify,createRemoteJWKSet,decodeProtectedHeader,customFetch} from 'jose';
import {configuredSecret,networkKey} from './auth.js';

export const PLAYER_SESSION_MS=15*60000;
export const LOGIN_CHALLENGE_MS=5*60000;
const googleIssuers=['https://accounts.google.com','accounts.google.com'];
const googleKeysUrl='https://www.googleapis.com/oauth2/v3/certs';
const clientIdPattern=/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
const opaquePattern=/^[A-Za-z0-9_-]{43}$/;
const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const textEncoder=new TextEncoder();
const bytesKey=secret=>textEncoder.encode(secret);
const randomOpaque=()=>Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
export const loginProofHash=async proof=>Buffer.from(await crypto.subtle.digest('SHA-256',textEncoder.encode(proof))).toString('base64url');
const internalAuthRequest=(path,body)=>new Request('https://internal/'+path,{method:'POST',body:JSON.stringify(body)});
export class PlayerAuthError extends Error {
  constructor(code,status=401){super(code);this.code=code;this.status=status;}
}
const refuse=(code='login-invalid',status=401)=>{throw new PlayerAuthError(code,status);};

// Only Google's fixed public-key endpoint is used. Token headers never select a URL.
// Reuse jose's key cache and refresh cooldown across requests in this isolate.
async function fetchGoogleKeys(url,options){
  try{
  if(String(url)!==googleKeysUrl)throw Error('invalid-key-endpoint');
  // workerd supports manual/follow only. Keep redirects disabled and reject
  // non-200 responses rather than using the unsupported Fetch error mode.
  const response=await fetch(url,{...options,redirect:'manual'});
  if(response.status!==200||!response.body)throw Error('google-keys-unavailable');
  const reader=response.body.getReader();let size=0;const chunks=[];
  while(true){
    const {done,value}=await reader.read();if(done)break;
    size+=value.length;if(size>65536){await reader.cancel();throw Error('google-keys-size');}chunks.push(value);
  }
  return new Response(Buffer.concat(chunks),{status:200,headers:response.headers});
  }catch{throw new PlayerAuthError('google-unavailable',503);}
}
const googleKeys=createRemoteJWKSet(new URL(googleKeysUrl),{
  timeoutDuration:5000,cooldownDuration:60000,cacheMaxAge:600000,[customFetch]:fetchGoogleKeys,
});
export function createGoogleVerifier(keySet=googleKeys){
  return async(credential,{clientId,nonce,now=Date.now()})=>{
    if(!clientIdPattern.test(clientId)||!opaquePattern.test(nonce)||typeof credential!=='string'||credential.length>16384)refuse();
    try{
      const header=decodeProtectedHeader(credential);
      if(header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid||header.kid.length>128||header.jku||header.jwk||header.x5u)refuse();
      const {payload}=await jwtVerify(credential,keySet,{
        algorithms:['RS256'],issuer:googleIssuers,audience:clientId,currentDate:new Date(now),clockTolerance:5,
        requiredClaims:['sub','exp','iat','nonce'],
      });
      const seconds=now/1000;
      if(payload.aud!==clientId||(payload.azp!==undefined&&payload.azp!==clientId)||payload.nonce!==nonce||
        typeof payload.sub!=='string'||!/^[A-Za-z0-9_-]{1,255}$/.test(payload.sub)||
        !Number.isSafeInteger(payload.iat)||!Number.isSafeInteger(payload.exp)||payload.iat>seconds+5||
        payload.exp<=seconds||payload.exp<=payload.iat||payload.exp-payload.iat>3700)refuse();
      // Do not retain Google's email, name, picture or access tokens.
      return {accountId:await loginProofHash('google-account-v1:'+payload.sub)};
    }catch(error){
      if(error instanceof PlayerAuthError)throw error;
      if(error?.code==='ERR_JWKS_TIMEOUT')refuse('google-unavailable',503);
      refuse();
    }
  };
}
const verifyGoogle=createGoogleVerifier();
async function signedPlayerToken(payload,secret,{type,audience,now,expiresAt}){
  return new SignJWT(payload).setProtectedHeader({alg:'HS256',typ:type}).setIssuer('movement-lab')
    .setAudience(audience).setIssuedAt(Math.floor(now/1000)).setExpirationTime(Math.floor(expiresAt/1000)).sign(bytesKey(secret));
}
async function checkedPlayerToken(token,secret,{type,audience,now,maxAge}){
  if(!configuredSecret(secret)||typeof token!=='string'||token.length>2048)refuse();
  try{
    const {payload}=await jwtVerify(token,bytesKey(secret),{
      algorithms:['HS256'],typ:type,issuer:'movement-lab',audience,currentDate:new Date(now),
      requiredClaims:['iat','exp'],maxTokenAge:maxAge/1000,
    });
    if(!Number.isSafeInteger(payload.exp)||!Number.isSafeInteger(payload.iat)||payload.iat>now/1000||
      payload.exp<=payload.iat||payload.exp-payload.iat>maxAge/1000)refuse();
    return payload;
  }catch{refuse();}
}
async function boundedLoginJson(request){
  if(request.headers.get('content-type')?.split(';')[0].toLowerCase()!=='application/json')refuse('content-type',415);
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>24576))refuse('body-size',413);
  const reader=request.body?.getReader();if(!reader)refuse('body-size',413);
  let timer;const chunks=[];let size=0;
  try{
    await Promise.race([(async()=>{
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>24576)refuse('body-size',413);chunks.push(value);}
    })(),new Promise((_,reject)=>{timer=setTimeout(()=>{reject(new PlayerAuthError('body-timeout',408));void reader.cancel().catch(()=>{});},5000);})]);
    const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!result||typeof result!=='object'||Array.isArray(result))refuse('invalid-body',400);
    return result;
  }catch(error){void reader.cancel().catch(()=>{});if(error instanceof PlayerAuthError)throw error;refuse('invalid-body',400);}
  finally{clearTimeout(timer);}
}
function onlyKeys(value,keys){if(Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))refuse('invalid-body',400);}
const playerSessions=(env,id)=>env.PLAYER_SESSIONS.get(env.PLAYER_SESSIONS.idFromName(id));

// Also used by the future verified-run route: an ID token or submitted account
// name is never an application session. Check revocation before admission.
export async function authenticatePlayer(request,env,{now=Date.now()}={}){
  const header=request.headers.get('authorization');
  if(!header?.startsWith('Bearer '))refuse('player-auth-required');
  const claims=await checkedPlayerToken(header.slice(7),env.PLAYER_AUTH_KEY,{
    type:'ml-session+jwt',audience:'movement-lab-player',now,maxAge:PLAYER_SESSION_MS,
  });
  if(!opaquePattern.test(claims.sub)||!uuidPattern.test(claims.sid)||claims.origin!==request.headers.get('origin'))refuse('player-auth-required');
  const response=await playerSessions(env,claims.sub).fetch(internalAuthRequest('check',{
    accountId:claims.sub,sessionId:claims.sid,expiresAt:claims.exp*1000,
  }));
  if(response.status===401)refuse('player-auth-required');
  if(!response.ok)refuse('login-unavailable',503);
  return {accountId:claims.sub,sessionId:claims.sid,expiresAt:claims.exp*1000};
}

export function createPlayerAuthHandler({googleVerifier=verifyGoogle,now=Date.now}={}){
  return async(request,env)=>{
    const path=new URL(request.url).pathname,origin=request.headers.get('origin');
    const allowed=(env.ALLOWED_ORIGINS||'').split(',').filter(Boolean);
    const permitted=!!origin&&origin!=='null'&&allowed.includes(origin);
    const reply=(data,status=200)=>Response.json(data,{status,headers:{
      'cache-control':'no-store','x-content-type-options':'nosniff','vary':'Origin',
      ...(permitted?{'access-control-allow-origin':origin}:{}),
    }});
    if(!permitted)return reply({error:'origin-not-allowed'},403);
    if(env.GOOGLE_LOGIN_ENABLED!=='true'||!clientIdPattern.test(env.GOOGLE_CLIENT_ID)||!configuredSecret(env.PLAYER_AUTH_KEY)||
      !env.PLAYER_SESSIONS||!env.AUTH_RATE)return reply({error:'login-disabled'},503);
    const paths={'/v1/auth/config':'GET','/v1/auth/challenge':'POST','/v1/auth/google':'POST','/v1/auth/session':'GET','/v1/auth/logout':'POST'};
    if(!Object.hasOwn(paths,path))return reply({error:'not-found'},404);
    try{
      if(request.method==='OPTIONS'){
        const headers=(request.headers.get('access-control-request-headers')||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
        if(request.headers.get('access-control-request-method')!==paths[path]||headers.some(x=>!['authorization','content-type'].includes(x)))return reply({error:'invalid-preflight'},403);
        return new Response(null,{status:204,headers:{'access-control-allow-origin':origin,'vary':'Origin',
          'access-control-allow-methods':paths[path],'access-control-allow-headers':'Authorization, Content-Type','access-control-max-age':'600','cache-control':'no-store'}});
      }
      if(request.method!==paths[path])return reply({error:'method-not-allowed'},405);
      const address=request.headers.get('cf-connecting-ip');if(!address)return reply({error:'missing-network'},400);
      const net=await networkKey(address,env.PLAYER_AUTH_KEY,now());
      if(!(await env.AUTH_RATE.limit({key:'auth:'+net})).success)return reply({error:'login-rate'},429);
      if(path==='/v1/auth/config')return reply({enabled:true,clientId:env.GOOGLE_CLIENT_ID,sessionSeconds:PLAYER_SESSION_MS/1000,ranked:false});
      if(path==='/v1/auth/challenge'){
        const body=await boundedLoginJson(request);onlyKeys(body,['proofHash']);
        if(!opaquePattern.test(body.proofHash))refuse('invalid-body',400);
        const at=now(),expiresAt=Math.floor((at+LOGIN_CHALLENGE_MS)/1000)*1000,nonce=randomOpaque();
        const challenge=await signedPlayerToken({nonce,origin,proofHash:body.proofHash,jti:crypto.randomUUID(),clientId:env.GOOGLE_CLIENT_ID},env.PLAYER_AUTH_KEY,{
          type:'ml-challenge+jwt',audience:'movement-lab-google-login',now:at,expiresAt,
        });
        return reply({challenge,nonce,expiresAt,clientId:env.GOOGLE_CLIENT_ID});
      }
      if(path==='/v1/auth/google'){
        const body=await boundedLoginJson(request);onlyKeys(body,['credential','challenge','proof']);
        if(!opaquePattern.test(body.proof))refuse();
        const at=now(),claims=await checkedPlayerToken(body.challenge,env.PLAYER_AUTH_KEY,{
          type:'ml-challenge+jwt',audience:'movement-lab-google-login',now:at,maxAge:LOGIN_CHALLENGE_MS,
        });
        if(claims.origin!==origin||claims.clientId!==env.GOOGLE_CLIENT_ID||!uuidPattern.test(claims.jti)||
          !opaquePattern.test(claims.nonce)||claims.proofHash!==await loginProofHash(body.proof))refuse();
        const {accountId}=await googleVerifier(body.credential,{clientId:env.GOOGLE_CLIENT_ID,nonce:claims.nonce,now:at});
        if(!opaquePattern.test(accountId))refuse();
        const sessionId=crypto.randomUUID(),expiresAt=Math.floor((at+PLAYER_SESSION_MS)/1000)*1000;
        const opened=await playerSessions(env,accountId).fetch(internalAuthRequest('open',{
          accountId,sessionId,expiresAt,nonce:claims.jti,nonceExpiresAt:claims.exp*1000,
        }));
        if(!opened.ok){if(opened.status===409)return reply({error:'login-already-used'},409);refuse('login-unavailable',503);}
        const token=await signedPlayerToken({sub:accountId,sid:sessionId,origin},env.PLAYER_AUTH_KEY,{
          type:'ml-session+jwt',audience:'movement-lab-player',now:at,expiresAt,
        });
        return reply({token,expiresAt,player:{id:accountId},ranked:false});
      }
      const session=await authenticatePlayer(request,env,{now:now()});
      if(path==='/v1/auth/session')return reply({player:{id:session.accountId},expiresAt:session.expiresAt,ranked:false});
      const closed=await playerSessions(env,session.accountId).fetch(internalAuthRequest('logout',session));
      if(!closed.ok)refuse('login-unavailable',503);
      return reply({signedOut:true});
    }catch(error){return reply({error:error instanceof PlayerAuthError?error.code:'login-unavailable'},error instanceof PlayerAuthError?error.status:503);}
  };
}
export const handlePlayerAuth=createPlayerAuthHandler();

export class PlayerSessions {
  constructor(ctx){this.ctx=ctx;}
  async fetch(request){
    return this.ctx.blockConcurrencyWhile(async()=>{
      const path=new URL(request.url).pathname,body=await request.json(),at=Date.now();
      if(!opaquePattern.test(body.accountId)||!uuidPattern.test(body.sessionId))return Response.json({error:'invalid-session'},{status:400});
      const state=await this.ctx.storage.get('sessions')||{accountId:body.accountId,sessions:[],nonces:[]};
      if(state.accountId!==body.accountId)return Response.json({error:'invalid-account'},{status:401});
      state.sessions=state.sessions.filter(s=>s.expiresAt>at);state.nonces=state.nonces.filter(n=>n.expiresAt>at);
      let status=200;
      if(path==='/open'){
        if(!Number.isSafeInteger(body.expiresAt)||body.expiresAt<=at||body.expiresAt>at+PLAYER_SESSION_MS+5000||
          !uuidPattern.test(body.nonce)||!Number.isSafeInteger(body.nonceExpiresAt)||body.nonceExpiresAt<=at||body.nonceExpiresAt>at+LOGIN_CHALLENGE_MS+5000)return Response.json({error:'invalid-session'},{status:400});
        if(state.nonces.some(n=>n.id===body.nonce))return Response.json({error:'login-already-used'},{status:409});
        if(state.nonces.length>=64)return Response.json({error:'account-login-rate'},{status:429});
        state.nonces.push({id:body.nonce,expiresAt:body.nonceExpiresAt});
        state.sessions.push({id:body.sessionId,expiresAt:body.expiresAt});
        // Bound retained sessions; signing in on a fourth tab revokes the oldest.
        state.sessions=state.sessions.slice(-3);
      }else if(path==='/check'){
        if(!state.sessions.some(s=>s.id===body.sessionId&&s.expiresAt===body.expiresAt))status=401;
      }else if(path==='/logout')state.sessions=state.sessions.filter(s=>s.id!==body.sessionId);
      else return Response.json({error:'not-found'},{status:404});
      await this.ctx.storage.put('sessions',state);
      const expiries=[...state.sessions,...state.nonces].map(s=>s.expiresAt);
      if(expiries.length)await this.ctx.storage.setAlarm(Math.min(...expiries));
      else await this.ctx.storage.deleteAll();
      return Response.json(status===200?{ok:true}:{error:'player-auth-required'},{status});
    });
  }
  async alarm(){
    await this.ctx.blockConcurrencyWhile(async()=>{
      const state=await this.ctx.storage.get('sessions');if(!state)return;
      const at=Date.now();state.sessions=state.sessions.filter(s=>s.expiresAt>at);state.nonces=state.nonces.filter(s=>s.expiresAt>at);
      const expiries=[...state.sessions,...state.nonces].map(s=>s.expiresAt);
      if(!expiries.length){await this.ctx.storage.deleteAll();return;}
      await this.ctx.storage.put('sessions',state);await this.ctx.storage.setAlarm(Math.min(...expiries));
    });
  }
}
