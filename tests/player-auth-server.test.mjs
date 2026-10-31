import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import worker from '../verification/worker.js';
import {createGoogleVerifier,createPlayerAuthHandler,PlayerSessions,authenticatePlayer,loginProofHash,PLAYER_SESSION_MS} from '../verification/player-auth.js';
const require=createRequire(new URL('../verification/package.json',import.meta.url));
const {SignJWT,generateKeyPair,exportJWK,createLocalJWKSet,decodeJwt}=await import(require.resolve('jose'));
const keys=await generateKeyPair('RS256',{extractable:true}),otherKeys=await generateKeyPair('RS256');
const jwk={...await exportJWK(keys.publicKey),kid:'google-test',alg:'RS256',use:'sig'};
const verify=createGoogleVerifier(createLocalJWKSet({keys:[jwk]}));
const clientId='123456-test.apps.googleusercontent.com',origin='https://sealsarecute2.github.io';
const secret='test-player-signing-key-1234567890123456789012345';
function context(){
  const data=new Map();let alarm=null,tail=Promise.resolve();
  return {data,storage:{async get(k){return structuredClone(data.get(k));},async put(k,v){data.set(k,structuredClone(v));},async setAlarm(v){alarm=v;},async getAlarm(){return alarm;},async deleteAll(){data.clear();alarm=null;}},
    blockConcurrencyWhile(fn){const result=tail.then(fn);tail=result.catch(()=>{});return result;}};
}
function environment(){
  const accounts=new Map(),calls={google:0,rate:0};
  const env={GOOGLE_LOGIN_ENABLED:'true',GOOGLE_CLIENT_ID:clientId,PLAYER_AUTH_KEY:secret,ALLOWED_ORIGINS:origin+',http://localhost:5173',
    AUTH_RATE:{async limit(){calls.rate++;return {success:true};}},PLAYER_SESSIONS:{idFromName:id=>id,get(id){
      if(!accounts.has(id)){const ctx=context();accounts.set(id,{ctx,object:new PlayerSessions(ctx)});}
      return {fetch:request=>accounts.get(id).object.fetch(request)};
    }}};
  const handle=createPlayerAuthHandler({googleVerifier:(...args)=>{calls.google++;return verify(...args);}});
  return {env,accounts,calls,handle};
}
function request(path,{body,method,headers={}}={}){
  const raw=body===undefined?undefined:JSON.stringify(body);
  return new Request('https://test.example/v1/auth/'+path,{method:method||(body===undefined?'GET':'POST'),body:raw,
    headers:{origin,'cf-connecting-ip':'203.0.113.1',...(raw?{'content-type':'application/json'}:{}),...headers}});
}
async function idToken(nonce,changes={},privateKey=keys.privateKey){
  const now=Math.floor(Date.now()/1000);
  return new SignJWT({iss:'https://accounts.google.com',aud:clientId,sub:'100000000000000000001',iat:now,exp:now+3600,nonce,
    email:'private@example.com',name:'Private Person',picture:'https://example.com/photo',...changes})
    .setProtectedHeader({alg:'RS256',kid:'google-test'}).sign(privateKey);
}
async function challenge(fixture){
  const proof=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const response=await fixture.handle(request('challenge',{body:{proofHash:await loginProofHash(proof)}}),fixture.env);
  assert.equal(response.status,200);return {...await response.json(),proof};
}
async function signIn(fixture,changes={}){
  const c=await challenge(fixture),credential=await idToken(c.nonce,changes);
  const response=await fixture.handle(request('google',{body:{credential,challenge:c.challenge,proof:c.proof,persistent:true}}),fixture.env);
  assert.equal(response.status,200);return response.json();
}
test('Google signatures, issuer, audience, nonce, subject and time claims are checked before accepting an identity',async()=>{
  const nonce='a'.repeat(43),now=Date.now();
  const result=await verify(await idToken(nonce),{clientId,nonce,now});assert.match(result.accountId,/^[A-Za-z0-9_-]{43}$/);
  const nowSeconds=Math.floor(now/1000);
  for(const change of [{iss:'https://evil.example'},{aud:'999-other.apps.googleusercontent.com'},{aud:[clientId,'other']},{azp:'other'},
    {nonce:'b'.repeat(43)},{sub:''},{sub:10},{exp:nowSeconds-1},{iat:nowSeconds+60},{exp:nowSeconds+7200},{iat:undefined}]){
    await assert.rejects(verify(await idToken(nonce,change),{clientId,nonce,now}),/login-invalid/);
  }
  await assert.rejects(verify(await idToken(nonce,{},otherKeys.privateKey),{clientId,nonce,now}),/login-invalid/);
  const unsigned=Buffer.from(JSON.stringify({alg:'none',kid:'google-test'})).toString('base64url')+'.'+Buffer.from('{}').toString('base64url')+'.';
  await assert.rejects(verify(unsigned,{clientId,nonce,now}),/login-invalid/);
  assert.deepEqual(await verify(await idToken(nonce,{email:'changed@example.com',name:'New Name'}),{clientId,nonce,now}),result);
});
test('cross-origin configuration and preflights are explicit; disabled or incomplete login cannot create accounts',async()=>{
  const fixture=environment();
  let response=await fixture.handle(request('config'),fixture.env);assert.equal(response.status,200);
  assert.equal(response.headers.get('access-control-allow-origin'),origin);assert.equal(response.headers.get('access-control-allow-credentials'),null);
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).clientId,clientId);
  for(const value of ['https://evil.example','null',''])assert.equal((await fixture.handle(request('config',{headers:{origin:value}}),fixture.env)).status,403);
  response=await fixture.handle(request('google',{method:'OPTIONS',headers:{'access-control-request-method':'POST','access-control-request-headers':'Content-Type'}}),fixture.env);
  assert.equal(response.status,204);
  assert.equal((await fixture.handle(request('google',{method:'OPTIONS',headers:{'access-control-request-method':'POST','access-control-request-headers':'X-Internal-Auth'}}),fixture.env)).status,403);
  for(const changed of [{GOOGLE_LOGIN_ENABLED:'false'},{GOOGLE_CLIENT_ID:'bad'},{PLAYER_AUTH_KEY:''},{AUTH_RATE:null},{PLAYER_SESSIONS:null}])
    assert.equal((await fixture.handle(request('config'),{...fixture.env,...changed})).status,503);
  assert.equal(fixture.accounts.size,0);
});
test('Google key retrieval uses the fixed endpoint, caches keys and does not refetch for attacker-selected key IDs',async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url:String(url),options});return Response.json({keys:[jwk]});};
  try{
    const remote=createGoogleVerifier(),nonce='z'.repeat(43),credential=await idToken(nonce);
    await remote(credential,{clientId,nonce});await remote(credential,{clientId,nonce});
    const forged=await new SignJWT({}).setProtectedHeader({alg:'RS256',kid:'attacker-chosen'}).sign(keys.privateKey);
    await assert.rejects(remote(forged,{clientId,nonce}),/login-invalid/);
    assert.equal(calls.length,1);assert.equal(calls[0].url,'https://www.googleapis.com/oauth2/v3/certs');assert.equal(calls[0].options.redirect,'manual');
    assert.ok(calls[0].options.signal instanceof AbortSignal);
  }finally{globalThis.fetch=original;}
});
test('a real signed Google credential creates a persistent, revocable session without retaining Google profile data',async()=>{
  const fixture=environment(),session=await signIn(fixture);
  assert.equal(session.ranked,false);assert.equal(session.expiresAt,null);assert.equal(session.persistent,true);
  assert.equal(JSON.stringify(session).includes('private@example.com'),false);
  const claims=decodeJwt(session.token);assert.equal(claims.sub,session.player.id);assert.equal(claims.email,undefined);assert.equal(claims.name,undefined);assert.equal(claims.exp,undefined);
  const authenticated=await authenticatePlayer(request('session',{headers:{authorization:'Bearer '+session.token}}),fixture.env);
  assert.equal(authenticated.accountId,session.player.id);
  let response=await fixture.handle(request('session',{headers:{authorization:'Bearer '+session.token}}),fixture.env);assert.equal(response.status,200);
  const saved=JSON.stringify([...fixture.accounts.values()][0].ctx.data.get('sessions'));
  assert.ok(!saved.includes('Private Person')&&!saved.includes('private@example.com')&&!saved.includes(session.token));
  const account=fixture.accounts.get(session.player.id);account.object=new PlayerSessions(account.ctx);
  assert.equal((await fixture.handle(request('session',{headers:{authorization:'Bearer '+session.token}}),fixture.env)).status,200);
  response=await fixture.handle(request('logout',{body:{},headers:{authorization:'Bearer '+session.token}}),fixture.env);assert.equal(response.status,200);
  assert.equal((await fixture.handle(request('session',{headers:{authorization:'Bearer '+session.token}}),fixture.env)).status,401);
});
test('wrong browser proof, changed origin, forged or expired challenges and submitted account IDs cannot open sessions',async()=>{
  const fixture=environment(),c=await challenge(fixture),credential=await idToken(c.nonce);
  const good={credential,challenge:c.challenge,proof:c.proof};
  const pieces=c.challenge.split('.');pieces[2]=(pieces[2][0]==='x'?'y':'x')+pieces[2].slice(1);
  for(const body of [{...good,proof:'x'.repeat(43)},{...good,challenge:pieces.join('.')},{...good,accountId:'forged'},{...good,credential:'bad'}])
    assert.ok([400,401].includes((await fixture.handle(request('google',{body}),fixture.env)).status));
  assert.equal((await fixture.handle(request('google',{body:good,headers:{origin:'http://localhost:5173'}}),fixture.env)).status,401);
  const late=createPlayerAuthHandler({googleVerifier:verify,now:()=>Date.now()+300001});
  assert.equal((await late(request('google',{body:good}),fixture.env)).status,401);
  assert.equal(fixture.accounts.size,0);
});
test('concurrent replay of a login challenge succeeds once and remains consumed after logout',async()=>{
  const fixture=environment(),c=await challenge(fixture),body={credential:await idToken(c.nonce),challenge:c.challenge,proof:c.proof};
  const responses=await Promise.all([fixture.handle(request('google',{body}),fixture.env),fixture.handle(request('google',{body}),fixture.env)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const session=await responses.find(r=>r.status===200).json();
  await fixture.handle(request('logout',{body:{},headers:{authorization:'Bearer '+session.token}}),fixture.env);
  assert.equal((await fixture.handle(request('google',{body}),fixture.env)).status,409);
  assert.equal(fixture.accounts.size,1);
});
test('persistent sessions remain origin-bound and valid years later, reject forgeries and reject other token types',async()=>{
  const fixture=environment(),session=await signIn(fixture),c=await challenge(fixture);
  for(const token of ['bad',c.challenge,await idToken(c.nonce)])assert.equal((await fixture.handle(request('session',{headers:{authorization:'Bearer '+token}}),fixture.env)).status,401);
  await assert.rejects(authenticatePlayer(request('session',{headers:{authorization:'Bearer '+session.token,origin:'http://localhost:5173'}}),fixture.env),/player-auth-required/);
  await assert.rejects(authenticatePlayer(request('session',{headers:{authorization:'Bearer '+session.token}}),{...fixture.env,PLAYER_AUTH_KEY:'another-test-secret-12345678901234567890123456789'}),/login-invalid/);
  assert.equal((await authenticatePlayer(request('session',{headers:{authorization:'Bearer '+session.token}}),fixture.env,{now:Date.now()+10*365*86400000})).accountId,session.player.id);
  assert.equal(fixture.accounts.size,1);
});
test('persistent session storage is bounded to three devices and nonce cleanup retains active logins',async()=>{
  const fixture=environment(),sessions=[];for(let n=0;n<4;n++)sessions.push(await signIn(fixture));
  assert.equal(new Set(sessions.map(s=>s.player.id)).size,1);
  assert.equal((await fixture.handle(request('session',{headers:{authorization:'Bearer '+sessions[0].token}}),fixture.env)).status,401);
  assert.equal((await fixture.handle(request('session',{headers:{authorization:'Bearer '+sessions[3].token}}),fixture.env)).status,200);
  const {ctx,object}=fixture.accounts.get(sessions[0].player.id),state=await ctx.storage.get('sessions');
  assert.equal(state.sessions.length,3);assert.equal(state.nonces.length,4);
  state.nonces.forEach(s=>s.expiresAt=Date.now()-1);await ctx.storage.put('sessions',state);
  await object.alarm();assert.equal((await ctx.storage.get('sessions')).sessions.length,3);assert.equal((await ctx.storage.get('sessions')).nonces.length,0);
  assert.equal((await fixture.handle(request('session',{headers:{authorization:'Bearer '+sessions[3].token}}),fixture.env)).status,200);
  for(const session of sessions.slice(1))await fixture.handle(request('logout',{body:{},headers:{authorization:'Bearer '+session.token}}),fixture.env);
  assert.equal(ctx.data.size,0);
});
test('legacy expiring sessions still expire and persistent claims cannot bypass server revocation',async()=>{
  const f=environment(),accountId='a'.repeat(43),sessionId=crypto.randomUUID(),at=Math.floor(Date.now()/1000),expiresAt=(at+900)*1000;
  f.env.PLAYER_SESSIONS.get(accountId);
  const object=f.accounts.get(accountId).object;
  assert.equal((await object.fetch(new Request('https://internal/open',{method:'POST',body:JSON.stringify({accountId,sessionId,expiresAt,nonce:crypto.randomUUID(),nonceExpiresAt:(at+300)*1000})}))).status,200);
  const sign=payload=>new SignJWT(payload).setProtectedHeader({alg:'HS256',typ:'ml-session+jwt'}).setIssuer('movement-lab').setAudience('movement-lab-player').setIssuedAt(at).sign(new TextEncoder().encode(secret));
  const legacy=await sign({sub:accountId,sid:sessionId,origin,exp:expiresAt/1000});
  assert.equal((await authenticatePlayer(request('session',{headers:{authorization:'Bearer '+legacy}}),f.env)).accountId,accountId);
  await assert.rejects(authenticatePlayer(request('session',{headers:{authorization:'Bearer '+legacy}}),f.env,{now:expiresAt+1000}),/login-invalid/);
  const altered=await sign({sub:accountId,sid:sessionId,origin,persistent:true});
  await assert.rejects(authenticatePlayer(request('session',{headers:{authorization:'Bearer '+altered}}),f.env),/player-auth-required/);
  const missingExpiry=await sign({sub:accountId,sid:sessionId,origin});
  await assert.rejects(authenticatePlayer(request('session',{headers:{authorization:'Bearer '+missingExpiry}}),f.env),/login-invalid/);
});
test('rate, body and credential bounds reject input before expensive Google checks or account allocation',async()=>{
  const fixture=environment();fixture.env.AUTH_RATE.limit=async()=>({success:false});
  assert.equal((await fixture.handle(request('challenge',{body:{proofHash:'x'.repeat(43)}}),fixture.env)).status,429);
  assert.equal(fixture.calls.google,0);assert.equal(fixture.accounts.size,0);
  fixture.env.AUTH_RATE.limit=async()=>({success:true});
  assert.equal((await fixture.handle(request('google',{body:{x:'x'.repeat(24576)}}),fixture.env)).status,413);
  assert.equal((await fixture.handle(request('google',{body:{x:'x'.repeat(24576)},headers:{'content-length':'16'}}),fixture.env)).status,413);
  assert.equal((await fixture.handle(request('challenge',{body:{proofHash:'x'.repeat(43),extra:1}}),fixture.env)).status,400);
  assert.equal((await fixture.handle(request('challenge',{body:{proofHash:'x'.repeat(43)},headers:{'content-type':'text/plain'}}),fixture.env)).status,415);
  assert.equal((await fixture.handle(request('challenge',{body:{proofHash:'x'.repeat(43)},headers:{'content-length':'50000'}}),fixture.env)).status,413);
  assert.equal(fixture.calls.google,0);assert.equal(fixture.accounts.size,0);
});
test('the Worker exposes login only through the login flag; player tokens cannot access operator controls or start runs',async()=>{
  const fixture=environment(),session=await signIn(fixture);
  assert.equal((await worker.fetch(request('config'),fixture.env)).status,200);
  assert.equal((await worker.fetch(request('config'),{})).status,403);
  const env={...fixture.env,STAGING_ENABLED:'true',STAGING_KEY:'operator-secret-123456789012345678901234567890'};
  for(const path of ['/v1/status','/v1/stop-all','/v1/runs']){
    const response=await worker.fetch(new Request('https://test.example'+path,{method:'POST',headers:{origin,authorization:'Bearer '+session.token}}),env);
    assert.equal(response.status,401);
  }
});

test('cached clients can still sign in with the legacy contract during rollout',async()=>{
  const f=environment(),c=await challenge(f),credential=await idToken(c.nonce);
  const response=await f.handle(request('google',{body:{credential,challenge:c.challenge,proof:c.proof}}),f.env);
  assert.equal(response.status,200);const session=await response.json();
  assert.equal(session.persistent,false);assert.ok(session.expiresAt>Date.now()&&session.expiresAt<=Date.now()+PLAYER_SESSION_MS);
  assert.equal((await f.handle(request('session',{headers:{authorization:'Bearer '+session.token}}),f.env)).status,200);
});
