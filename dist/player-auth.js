const googleLoginClientId=/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
let movementGoogleScriptPromise=null;
function loadMovementGoogle(){
  if(globalThis.google?.accounts?.id)return Promise.resolve(globalThis.google.accounts.id);
  if(movementGoogleScriptPromise)return movementGoogleScriptPromise;
  movementGoogleScriptPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');let timer;
    const failed=()=>{clearTimeout(timer);script.remove();movementGoogleScriptPromise=null;reject(Error('google-unavailable'));};
    script.src='https://accounts.google.com/gsi/client';script.async=true;script.referrerPolicy='strict-origin-when-cross-origin';
    script.onerror=failed;script.onload=()=>{
      clearTimeout(timer);const google=globalThis.google?.accounts?.id;
      if(!google){failed();return;}resolve(google);
    };
    timer=setTimeout(failed,10000);document.head.append(script);
  });
  return movementGoogleScriptPromise;
}
function movementLoginRandom(cryptoApi){return btoa(String.fromCharCode(...cryptoApi.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
async function movementLoginHash(value,cryptoApi){
  const hash=new Uint8Array(await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...hash)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
export function validPlayerAuthEndpoint(endpoint){
  return typeof endpoint==='string'&&/^https:\/\/movement-lab-verifier-staging\.[a-z0-9-]+\.workers\.dev$/.test(endpoint);
}
const movementLoginMessage=code=>({
  'login-rate':'Too many sign-in attempts. Wait a minute and try again.',
  'login-disabled':'Account sign-in is temporarily unavailable.',
  'login-invalid':'Sign-in could not be verified. Try again.',
  'login-already-used':'That sign-in has already been used. Try again.',
  'login-expired':'Sign-in expired. Try again.',
  'google-unavailable':'Google sign-in is temporarily unavailable. Try again.',
  'login-unavailable':'Could not finish signing in. Please try again.',
}[code]||'Could not finish signing in. Please try again.');

export class GooglePlayerLogin {
  #session=null;
  constructor({endpoint,fetcher=(...args)=>fetch(...args),cryptoApi=globalThis.crypto,now=Date.now,
    loadGoogle=loadMovementGoogle,onChange=()=>{},schedule=(...args)=>globalThis.setTimeout(...args),
    unschedule=(...args)=>globalThis.clearTimeout(...args)}={}){
    if(!validPlayerAuthEndpoint(endpoint))throw Error('invalid-auth-endpoint');
    Object.assign(this,{endpoint,fetcher,cryptoApi,now,loadGoogle,onChange,schedule,unschedule});
    this.generation=0;this.busy=false;this.challenge=null;this.google=null;this.expiryTimer=null;
    this.status='Sign in to your Movement Lab account.';
  }
  state(){return {signedIn:!!this.#session&&this.#session.expiresAt>this.now(),expiresAt:this.#session?.expiresAt||null,
    busy:this.busy,prepared:!!this.challenge,status:this.status};}
  authorization(){return this.#session?.expiresAt>this.now()?'Bearer '+this.#session.token:null;}
  async request(path,{body,authorization}={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await this.fetcher(this.endpoint+'/v1/auth/'+path,{method:body===undefined?'GET':'POST',
        credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,
        headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(authorization?{authorization}:{})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      let raw='';
      if(response.body?.getReader){
        const reader=response.body.getReader(),decoder=new TextDecoder();let size=0;
        while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;
          if(size>32768){await reader.cancel();throw Error('response-size');}raw+=decoder.decode(value,{stream:true});}
        raw+=decoder.decode();
      }else raw=await response.text();
      if(raw.length>32768)throw Error('response-size');
      const data=JSON.parse(raw);if(!response.ok)throw Error(data?.error||'login-unavailable');return data;
    }finally{clearTimeout(timer);}
  }
  async prepare(container){
    if(this.busy||this.state().signedIn)return false;
    const generation=++this.generation;
    this.busy=true;this.challenge=null;this.status='Preparing Google sign-in…';this.onChange(this.state());
    try{
      container.replaceChildren();
      const config=await this.request('config');
      if(generation!==this.generation)return false;
      if(config.enabled!==true||!googleLoginClientId.test(config.clientId)||config.ranked!==false)throw Error('login-disabled');
      const proof=movementLoginRandom(this.cryptoApi),proofHash=await movementLoginHash(proof,this.cryptoApi);
      if(generation!==this.generation)return false;
      const challenge=await this.request('challenge',{body:{proofHash}});
      if(generation!==this.generation)return false;
      if(challenge.clientId!==config.clientId||typeof challenge.challenge!=='string'||challenge.challenge.length>2048||
        !/^[A-Za-z0-9_-]{43}$/.test(challenge.nonce)||!Number.isSafeInteger(challenge.expiresAt)||
        challenge.expiresAt<=this.now()||challenge.expiresAt>this.now()+300000)throw Error('login-invalid');
      const google=await this.loadGoogle();
      if(generation!==this.generation)return false;
      this.google=google;this.challenge={...challenge,proof};
      google.initialize({client_id:config.clientId,nonce:challenge.nonce,auto_select:false,ux_mode:'popup',
        callback:response=>{void this.acceptCredential(response,generation);}});
      google.renderButton(container,{theme:'filled_black',size:'large',shape:'rectangular',text:'signin_with',width:280});
      this.status='Choose your Google account to sign in.';return true;
    }catch(error){if(generation===this.generation){this.challenge=null;this.status=movementLoginMessage(error.message);}return false;}
    finally{if(generation===this.generation){this.busy=false;this.onChange(this.state());}}
  }
  async acceptCredential(response,generation=this.generation){
    if(generation!==this.generation||this.busy||!this.challenge)return false;
    const challenge=this.challenge;this.busy=true;this.status='Checking sign-in…';this.onChange(this.state());
    try{
      if(challenge.expiresAt<=this.now())throw Error('login-expired');
      if(typeof response?.credential!=='string'||!response.credential||response.credential.length>16384)throw Error('login-invalid');
      const session=await this.request('google',{body:{credential:response.credential,challenge:challenge.challenge,proof:challenge.proof}});
      if(generation!==this.generation){
        if(typeof session.token==='string')await this.request('logout',{body:{},authorization:'Bearer '+session.token}).catch(()=>{});
        return false;
      }
      if(typeof session.token!=='string'||!session.token||session.token.length>2048||!Number.isSafeInteger(session.expiresAt)||
        session.expiresAt<=this.now()||session.expiresAt>this.now()+900000||session.ranked!==false||
        !/^[A-Za-z0-9_-]{43}$/.test(session.player?.id))throw Error('login-invalid');
      this.unschedule(this.expiryTimer);
      // Complete browser timer setup before exposing an authenticated state.
      const expiryTimer=this.schedule(()=>{
        this.#session=null;this.status='Your session expired. Sign in again.';this.onChange(this.state());
      },session.expiresAt-this.now());
      this.#session={token:session.token,expiresAt:session.expiresAt};this.challenge=null;this.expiryTimer=expiryTimer;
      this.status='Signed in with Google.';return true;
    }catch(error){if(generation===this.generation){this.challenge=null;this.status=movementLoginMessage(error.message);}return false;}
    finally{if(generation===this.generation){this.busy=false;this.onChange(this.state());}}
  }
  async signOut(){
    ++this.generation;const authorization=this.authorization();
    this.#session=null;this.challenge=null;this.busy=false;this.unschedule(this.expiryTimer);this.expiryTimer=null;
    this.google?.disableAutoSelect?.();this.status='Signed out.';this.onChange(this.state());
    if(authorization)try{await this.request('logout',{body:{},authorization});}
    catch{this.status='Signed out of this tab. The server session will expire shortly.';this.onChange(this.state());}
  }
  dispose(){++this.generation;this.#session=null;this.challenge=null;this.busy=false;this.unschedule(this.expiryTimer);this.expiryTimer=null;
    this.status='Sign in to your Movement Lab account.';this.onChange(this.state());}
}
