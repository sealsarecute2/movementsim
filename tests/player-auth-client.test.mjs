import test from 'node:test';
import assert from 'node:assert/strict';
import {GooglePlayerLogin,validPlayerAuthEndpoint} from '../dist/player-auth.js';
import {boot} from './helpers/boot-app.mjs';
const endpoint='https://movement-lab-verifier-staging.example.workers.dev';
function fixture(overrides={}){
  let now=Date.now(),options,expiry;const calls=[],states=[],rendered=[];
  const google={initialize(value){options=value;},renderButton(...args){rendered.push(args);},disableAutoSelect(){this.disabled=true;}};
  const fetcher=async(url,init)=>{
    calls.push({url,init});const path=url.split('/').at(-1);
    return Response.json(path==='config'?{enabled:true,clientId:'123-test.apps.googleusercontent.com',ranked:false}:
      path==='challenge'?{clientId:'123-test.apps.googleusercontent.com',challenge:'signed-challenge',nonce:'n'.repeat(43),expiresAt:now+300000}:
      path==='google'?{token:'application-session',player:{id:'p'.repeat(43)},expiresAt:now+900000,ranked:false}:{signedOut:true});
  };
  const client=new GooglePlayerLogin({endpoint,fetcher,now:()=>now,loadGoogle:async()=>google,onChange:s=>states.push(s),schedule:fn=>{expiry=fn;return 1;},unschedule(){},...overrides});
  const container={replaceChildren(){this.cleared=true;}};
  return {client,calls,states,google,container,rendered,get options(){return options;},expire(){now+=900001;expiry?.();},advance(ms){now+=ms;}};
}
test('disabled Google login makes no network request on game boot and leaves practice available',()=>{
  const app=boot({},'',null,{playerAuthConfig:{enabled:false,endpoint:''},fetch:()=>{throw Error('Unexpected network request');}});assert.equal(app.read('playerLogin'),null);
  app.element('play').fire('click');assert.equal(app.requests(),1);
  for(const value of ['http://example.com','https://evil.example','https://movement-lab-verifier-staging.example.workers.dev/','https://movement-lab-verifier-staging.example.workers.dev@evil.example'])assert.equal(validPlayerAuthEndpoint(value),false);
  assert.equal(validPlayerAuthEndpoint(endpoint),true);
});
test('the Google button uses a fresh nonce and the server receives only credential, challenge and browser proof',async()=>{
  const f=fixture();assert.equal(await f.client.prepare(f.container),true);
  assert.equal(f.options.nonce,'n'.repeat(43));assert.equal(f.options.auto_select,false);assert.equal(f.options.ux_mode,'popup');
  assert.equal(f.rendered.length,1);assert.equal(f.client.state().prepared,true);
  assert.equal(await f.client.acceptCredential({credential:'google-signed-token'}),true);
  assert.equal(f.client.state().signedIn,true);assert.equal(f.client.authorization(),'Bearer application-session');
  const sent=JSON.parse(f.calls.find(c=>c.url.endsWith('/google')).init.body);
  assert.deepEqual(Object.keys(sent).sort(),['challenge','credential','persistent','proof']);assert.equal(sent.persistent,true);assert.match(sent.proof,/^[A-Za-z0-9_-]{43}$/);
  assert.ok(f.calls.every(c=>c.init.credentials==='omit'&&c.init.redirect==='error'&&c.init.cache==='no-store'));
  assert.ok(f.calls.every(c=>!c.url.includes('token')&&!c.url.includes(sent.proof)));
  assert.ok(f.states.every(s=>!JSON.stringify(s).includes('application-session')&&!JSON.stringify(s).includes(sent.proof)));
  f.client.dispose();
});
test('logout revokes the bearer session and legacy expiry removes credentials',async()=>{
  const f=fixture();await f.client.prepare(f.container);await f.client.acceptCredential({credential:'google-token'});
  await f.client.signOut();assert.equal(f.client.authorization(),null);assert.equal(f.client.state().signedIn,false);assert.equal(f.google.disabled,true);
  assert.equal(f.calls.at(-1).init.headers.authorization,'Bearer application-session');
  const second=fixture();await second.client.prepare(second.container);await second.client.acceptCredential({credential:'google-token'});
  second.expire();assert.equal(second.client.authorization(),null);assert.equal(second.client.state().signedIn,false);assert.match(second.client.state().status,/Sign in again/);
});
test('default expiry timers preserve the browser Window receiver through login, logout and disposal',async()=>{
  const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,liveTimers=new Set();let calls=0;
  globalThis.setTimeout=function(...args){
    assert.ok(this===undefined||this===null||this===globalThis,'Timer receiver must be the browser global.');
    calls++;const timer=originalSet(...args);liveTimers.add(timer);return timer;
  };
  globalThis.clearTimeout=function(timer){
    assert.ok(this===undefined||this===null||this===globalThis,'Timer receiver must be the browser global.');
    calls++;liveTimers.delete(timer);return originalClear(timer);
  };
  try{
    const f=fixture({schedule:undefined,unschedule:undefined});
    assert.equal(await f.client.prepare(f.container),true);
    assert.equal(await f.client.acceptCredential({credential:'google-token'}),true);
    assert.equal(f.client.state().signedIn,true);assert.equal(f.client.state().status,'Signed in with Google.');
    await f.client.signOut();assert.equal(f.client.state().signedIn,false);assert.equal(f.client.state().status,'Signed out.');
    f.client.dispose();assert.ok(calls>=8);
  }finally{
    for(const timer of liveTimers)originalClear(timer);
    globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;
  }
});
test('an expiry-timer failure cannot leave the client signed in while displaying an error',async()=>{
  const f=fixture({schedule(){throw new TypeError('Timer setup failed');}});
  await f.client.prepare(f.container);
  assert.equal(await f.client.acceptCredential({credential:'google-token'}),false);
  assert.equal(f.client.state().signedIn,false);assert.equal(f.client.authorization(),null);
});
test('expired challenges, forged server responses and network errors never mark a player signed in',async()=>{
  const f=fixture();await f.client.prepare(f.container);f.advance(300001);
  assert.equal(await f.client.acceptCredential({credential:'google-token'}),false);assert.equal(f.calls.length,2);assert.equal(f.client.authorization(),null);
  const invalid=fixture();await invalid.client.prepare(invalid.container);invalid.client.fetcher=async()=>Response.json({token:'bad',ranked:true});
  assert.equal(await invalid.client.acceptCredential({credential:'google-token'}),false);assert.equal(invalid.client.authorization(),null);
  const offline=fixture();offline.client.fetcher=async()=>{throw Error('network secret should not be shown');};
  assert.equal(await offline.client.prepare(offline.container),false);assert.equal(offline.client.state().busy,false);
  assert.ok(!offline.client.state().status.includes('secret'));
});
test('late login responses after sign-out are discarded and their newly created session is revoked',async()=>{
  const f=fixture();await f.client.prepare(f.container);let finish;
  const original=f.client.fetcher;f.client.fetcher=(url,init)=>url.endsWith('/google')?new Promise(resolve=>{finish=resolve;}):original(url,init);
  const pending=f.client.acceptCredential({credential:'google-token'});await f.client.signOut();
  finish(Response.json({token:'late-token',expiresAt:Date.now()+900000,player:{id:'p'.repeat(43)},ranked:false}));
  assert.equal(await pending,false);assert.equal(f.client.authorization(),null);
  assert.equal(f.calls.at(-1).init.headers.authorization,'Bearer late-token');
});
test('provider and server failures have distinct messages without exposing raw diagnostics',async()=>{
  for(const [code,message] of [['google-unavailable',/Google sign-in is temporarily unavailable/],['login-unavailable',/Could not finish signing in/]]){
    const f=fixture();await f.client.prepare(f.container);
    f.client.fetcher=async()=>Response.json({error:code,details:'private internal error'},{status:503});
    assert.equal(await f.client.acceptCredential({credential:'google-token'}),false);
    assert.match(f.client.state().status,message);assert.equal(f.client.authorization(),null);
    assert.ok(!f.client.state().status.includes('private'));
  }
});
test('Settings wires optional sign-in, status and sign-out without touching gameplay',async()=>{
  class Login {
    constructor(options){this.options=options;this.signedIn=false;}
    state(){return {signedIn:this.signedIn,prepared:false,busy:false,status:this.signedIn?'Signed in.':'Sign in.'};}
    authorization(){return null;}
    async prepare(){this.signedIn=true;this.options.onChange(this.state());}
    async signOut(){this.signedIn=false;this.options.onChange(this.state());}
    dispose(){this.disposed=true;}
  }
  const app=boot({},'',null,{playerAuthConfig:{enabled:true,endpoint},PlayerLoginClass:Login});
  assert.equal(app.element('player-account').classList.contains('hidden'),false);
  await app.element('account-prepare').fire('click');assert.equal(app.element('account-status').textContent,'Signed in.');
  assert.equal(app.element('account-prepare').classList.contains('hidden'),true);
  await app.element('account-signout').fire('click');assert.equal(app.element('account-status').textContent,'Sign in.');
  app.element('play').fire('click');assert.equal(app.requests(),1);app.window.fire('pagehide');assert.equal(app.read('playerLogin.disposed'),true);
});

function memoryStorage(){
  const values=new Map();return {values,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}
function persistentFixture(storage=memoryStorage(),overrides={}){
  const f=fixture({storage,schedule(){throw Error('Persistent logins must not schedule expiry');},...overrides});
  const original=f.client.fetcher;
  const player={id:'p'.repeat(43),username:null};
  f.client.fetcher=async(url,init)=>{
    if(url.endsWith('/google'))return Response.json({token:'saved-device-session',player,expiresAt:null,persistent:true,ranked:false});
    if(url.endsWith('/session'))return Response.json({player,expiresAt:null,persistent:true,ranked:false});
    if(url.endsWith('/profile'))return Response.json({player:{...player,username:JSON.parse(init.body).username},ranked:false});
    return original(url,init);
  };
  return {...f,storage};
}
async function persistentSignIn(f){await f.client.prepare(f.container);assert.equal(await f.client.acceptCredential({credential:'private-google-id-token'}),true);}
test('persistent login survives years, page disposal and a new browser instance without storing the Google credential',async()=>{
  const f=persistentFixture();await persistentSignIn(f);f.advance(10*365*86400000);
  assert.equal(f.client.state().signedIn,true);assert.equal(f.client.state().expiresAt,null);
  assert.equal(f.storage.values.size,1);assert.ok(!JSON.stringify([...f.storage.values.values()]).includes('private-google-id-token'));
  f.client.dispose();assert.equal(f.storage.values.size,1);
  const reopened=persistentFixture(f.storage);assert.equal(reopened.client.state().signedIn,false);
  assert.equal(await reopened.client.restore(),true);assert.equal(reopened.client.authorization(),'Bearer saved-device-session');
  await reopened.client.signOut();assert.equal(f.storage.values.size,0);
  assert.equal(reopened.calls.at(-1).init.headers.authorization,'Bearer saved-device-session');
  assert.equal(await f.client.restore(),false);
});
test('saved sessions are revalidated and revoked sessions are removed; temporary network failures preserve the login',async()=>{
  const f=persistentFixture();await persistentSignIn(f);f.client.dispose();
  const reopened=persistentFixture(f.storage);reopened.client.fetcher=async()=>{throw Error('offline');};
  assert.equal(await reopened.client.restore(),false);assert.equal(f.storage.values.size,1);assert.match(reopened.client.state().status,/login is saved/);
  reopened.client.fetcher=async()=>Response.json({error:'player-auth-required'},{status:401});
  assert.equal(await reopened.client.restore(),false);assert.equal(f.storage.values.size,0);assert.equal(reopened.client.authorization(),null);
});
test('late restoration after sign-out cannot resurrect the saved login',async()=>{
  const f=persistentFixture();await persistentSignIn(f);f.client.dispose();const reopened=persistentFixture(f.storage);
  let finish;const original=reopened.client.fetcher;
  reopened.client.fetcher=(url,init)=>url.endsWith('/session')?new Promise(resolve=>{finish=resolve;}):original(url,init);
  const pending=reopened.client.restore();await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof finish,'function');
  await reopened.client.signOut();finish(Response.json({player:{id:'p'.repeat(43)},expiresAt:null,persistent:true,ranked:false}));
  assert.equal(await pending,false);assert.equal(reopened.client.authorization(),null);assert.equal(f.storage.values.size,0);
  assert.equal(reopened.calls.at(-1).init.headers.authorization,'Bearer saved-device-session');
});
test('offline logout clears the remembered login immediately and retries server revocation on reconnect',async()=>{
  const f=persistentFixture();await persistentSignIn(f);const original=f.client.fetcher;
  f.client.fetcher=async()=>{throw Error('offline');};await f.client.signOut();
  assert.equal(f.client.authorization(),null);assert.equal(f.client.savedToken(),null);assert.ok(f.storage.getItem(f.client.logoutKey));
  f.client.fetcher=original;await f.client.restore();assert.equal(f.storage.values.size,0);
  assert.equal(f.calls.at(-1).init.headers.authorization,'Bearer saved-device-session');
});
test('username saving uses only the authenticated session and keeps the current name on conflicts',async()=>{
  const f=persistentFixture();await persistentSignIn(f);
  assert.equal(await f.client.saveUsername('  seals_are_cute  '),true);assert.equal(f.client.state().player.username,'seals_are_cute');
  assert.match(f.client.state().status,/seals_are_cute/);assert.equal(f.client.authorization(),'Bearer saved-device-session');
  assert.equal(await f.client.saveUsername('<img src=x>'),false);assert.match(f.client.state().profileStatus,/3–20/);
  f.client.fetcher=async()=>Response.json({error:'username-taken'},{status:409});
  assert.equal(await f.client.saveUsername('someone_else'),false);assert.equal(f.client.state().player.username,'seals_are_cute');assert.match(f.client.state().profileStatus,/taken/);
});
test('blocked browser storage leaves a persistent server login usable in this tab',async()=>{
  const storage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
  const f=persistentFixture(storage);await persistentSignIn(f);assert.match(f.client.state().status,/storage is unavailable/);
  await f.client.restore();assert.equal(f.client.state().signedIn,true);await f.client.signOut();assert.equal(f.client.authorization(),null);
});
