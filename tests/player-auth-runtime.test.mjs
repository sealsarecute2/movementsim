import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';

const require=createRequire(new URL('../verification/package.json',import.meta.url));
const {Miniflare,convertV4MiniflareOptions,Response:RuntimeResponse,Log,LogLevel}=await import(require.resolve('miniflare'));
const {build}=await import(require.resolve('esbuild'));
const {SignJWT,generateKeyPair,exportJWK}=await import(require.resolve('jose'));
const clientId='123-runtime.apps.googleusercontent.com',origin='http://localhost:5173';
const keyPair=await generateKeyPair('RS256',{extractable:true});
const publicKey={...await exportJWK(keyPair.publicKey),kid:'runtime-google-key',alg:'RS256',use:'sig'};
const bundle=await build({
  stdin:{sourcefile:'runtime-login-test.js',resolveDir:fileURLToPath(new URL('../verification/',import.meta.url)),contents:`
    import app from './worker.js';
    export {PlayerSessions} from './worker.js';
    export default {fetch(request,env,ctx){
      const headers=new Headers(request.headers);headers.set('cf-connecting-ip','203.0.113.1');
      return app.fetch(new Request(request,{headers}),{...env,AUTH_RATE:{limit:async()=>({success:true})}},ctx);
    }};
  `},bundle:true,format:'esm',platform:'browser',target:'es2022',external:['node:*'],write:false,
});
function runtime({redirect=false}={}){
  const outbound=[];
  const mf=new Miniflare(convertV4MiniflareOptions({
    name:'login-runtime-test',modules:true,script:bundle.outputFiles[0].text,cf:false,log:new Log(LogLevel.ERROR),
    compatibilityDate:'2026-10-29',compatibilityFlags:['nodejs_compat'],
    bindings:{GOOGLE_LOGIN_ENABLED:'true',GOOGLE_CLIENT_ID:clientId,PLAYER_AUTH_KEY:'runtime-test-signing-key-12345678901234567890123456789',ALLOWED_ORIGINS:origin},
    durableObjects:{PLAYER_SESSIONS:{className:'PlayerSessions',useSQLite:true}},
    outboundService:async request=>{
      outbound.push(request.url);
      assert.equal(request.url,'https://www.googleapis.com/oauth2/v3/certs','Only the fixed public-key endpoint may be requested.');
      return redirect?new RuntimeResponse(null,{status:302,headers:{location:'https://untrusted.example/keys'}}):
        new RuntimeResponse(JSON.stringify({keys:[publicKey]}),{headers:{'content-type':'application/json'}});
    },
  }));
  const call=(path,{body,token}={})=>mf.dispatchFetch('http://localhost/v1/auth/'+path,{
    method:body===undefined?'GET':'POST',headers:{origin,...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  return {mf,outbound,call};
}
async function loginBody(fixture){
  const proof=randomBytes(32).toString('base64url'),proofHash=createHash('sha256').update(proof).digest('base64url');
  const response=await fixture.call('challenge',{body:{proofHash}});assert.equal(response.status,200);
  const challenge=await response.json(),at=Math.floor(Date.now()/1000);
  const credential=await new SignJWT({iss:'https://accounts.google.com',aud:clientId,sub:'100000000000000000001',iat:at,exp:at+3600,nonce:challenge.nonce})
    .setProtectedHeader({alg:'RS256',kid:'runtime-google-key'}).sign(keyPair.privateKey);
  return {credential,proof,challenge:challenge.challenge,persistent:true};
}

test('workerd verifies a signed credential, creates a real SQLite session and enforces replay protection and logout',{timeout:30000},async()=>{
  const fixture=runtime();
  try{
    const body=await loginBody(fixture),response=await fixture.call('google',{body});
    assert.equal(response.status,200,'Google verification and SQLite session creation must succeed in workerd.');
    const session=await response.json();assert.equal(session.ranked,false);assert.match(session.player.id,/^[A-Za-z0-9_-]{43}$/);
    assert.equal((await fixture.call('session',{token:session.token})).status,200);
    assert.equal((await fixture.call('google',{body})).status,409);
    assert.equal((await fixture.call('logout',{body:{},token:session.token})).status,200);
    assert.equal((await fixture.call('session',{token:session.token})).status,401);
    assert.equal(fixture.outbound.length,1,'Google public keys should be cached across requests.');
  }finally{await fixture.mf.dispose();}
});

test('workerd rejects a redirect from the signing-key endpoint without following it',{timeout:30000},async()=>{
  const fixture=runtime({redirect:true});
  try{
    const body=await loginBody(fixture),response=await fixture.call('google',{body});
    assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'google-unavailable'});
    assert.deepEqual(fixture.outbound,['https://www.googleapis.com/oauth2/v3/certs']);
  }finally{await fixture.mf.dispose();}
});
