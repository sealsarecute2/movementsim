import {validPlayerAuthEndpoint} from './player-auth.js';
import {RANKED_COURSES,rankedCourseAllowed,LEADERBOARD_LIMIT,RANKED_ENDLESS_SEED} from './ranked-courses.js';
export const VERIFIED_COURSES=Object.freeze(Object.fromEntries(RANKED_COURSES.map(course=>[course.map,course.revision])));
export const supportsVerifiedRun=rankedCourseAllowed;
const movementVerifiedId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const movementVerifiedMessage=code=>({
  'server-full':'All verified run slots are busy. Try again shortly.',
  'account-active':'You already have a verified run open. Wait a moment and try again.',
  'network-active':'Too many verified runs on this network. Try again shortly.',
  'daily-budget':'Verified runs have reached today’s limit. Solo practice is available.',
  'start-rate':'Too many starts. Wait a minute before trying again.',
  'request-rate':'Too many requests. Wait a minute before trying again.',
  'player-auth-required':'Sign in again in Settings to start a verified run.',
  'login-invalid':'Sign in again in Settings to start a verified run.',
  'player-runs-disabled':'Verified runs are not available yet.',
  'verification-unavailable':'Verified runs are temporarily unavailable.',
  'bot-check-failed':'The browser check expired or failed. Try again.',
  'bot-check-required':'Complete the browser check before starting.',
  'bot-check-unavailable':'The browser check is unavailable. Try again shortly.',
  'revision-mismatch':'This course has changed. Reload the game.',
  'private-test-access-required':'Sign in through Settings to enable your private test access.',
  'private-test-account-mismatch':'Private testing is linked to another Google account. Sign in with the account used to set it up.',
  'private-test-course-only':'Private testing is available on Bhop School / CS-style.',
  'private-test-unavailable':'Could not enable private testing. Keep the local test server running and try signing in again.',
  'course-not-ranked':'Choose a bundled scored map and its current revision.',
}[code]||'Verification lost its connection. You can continue practising.');
let movementTurnstileScript=null;
function loadMovementTurnstile(){
  if(globalThis.turnstile?.render)return Promise.resolve(globalThis.turnstile);
  if(movementTurnstileScript)return movementTurnstileScript;
  movementTurnstileScript=new Promise((resolve,reject)=>{
    const script=document.createElement('script');let timer;
    const fail=()=>{clearTimeout(timer);script.remove();movementTurnstileScript=null;reject(Error('bot-check-unavailable'));};
    script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.referrerPolicy='strict-origin-when-cross-origin';
    script.onerror=fail;script.onload=()=>{clearTimeout(timer);if(globalThis.turnstile?.render)resolve(globalThis.turnstile);else fail();};
    timer=setTimeout(fail,10000);document.head.append(script);
  });return movementTurnstileScript;
}

export class VerifiedRunClient {
  #run=null;#runAuth=null;#botToken=null;#socket=null;
  constructor({endpoint,authorization=()=>null,fetcher=(...args)=>fetch(...args),createSocket=(...args)=>new WebSocket(...args),
    loadTurnstile=loadMovementTurnstile,now=Date.now,onChange=()=>{},schedule=(...args)=>globalThis.setTimeout(...args),
    unschedule=(...args)=>globalThis.clearTimeout(...args)}={}){
    if(!validPlayerAuthEndpoint(endpoint))throw Error('invalid-auth-endpoint');
    Object.assign(this,{endpoint,authorization,fetcher,createSocket,loadTurnstile,now,onChange,schedule,unschedule});
    this.config=null;this.configRequest=null;this.phase='idle';this.status='Choose Verified Run to check availability.';this.generation=0;
    this.selection=null;this.result=null;this.frames=[];this.seq=0;this.sentTicks=0;this.timer=null;this.widget=null;this.widgetId=null;
    this.readyResolve=null;this.readyReject=null;
    this.accessGeneration=0;
  }
  state(){return {phase:this.phase,status:this.status,enabled:this.config?.enabled===true,prepared:this.phase==='prepared',
    busy:['access','loading','checking','allocating','connecting','finishing'].includes(this.phase),active:this.phase==='active',privateTest:this.config?.privateTest===true,
    selection:this.selection?{...this.selection}:null,result:this.result};}
  emit(){this.onChange(this.state());}
  clearTimer(){this.unschedule(this.timer);this.timer=null;}
  clearWidget(){this.clearTimer();if(this.widgetId!==null){try{this.widget?.remove(this.widgetId);}catch{}this.widgetId=null;}}
  async request(path,{body,method,authorization,signal}={}){
    const controller=new AbortController(),timer=this.schedule(()=>controller.abort(),10000);
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    try{
      const response=await this.fetcher(this.endpoint+path,{method:method||(body===undefined?'GET':'POST'),credentials:'omit',redirect:'error',cache:'no-store',
        referrerPolicy:'no-referrer',signal:controller.signal,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(authorization?{authorization}:{})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      let raw='';
      if(response.body?.getReader){
        const reader=response.body.getReader(),decoder=new TextDecoder();let size=0;
        while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw Error('response-size');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
      }else raw=await response.text();
      if(raw.length>65536)throw Error('response-size');const value=JSON.parse(raw);
      if(!response.ok)throw Error(value?.error||'verification-unavailable');return value;
    }finally{this.unschedule(timer);signal?.removeEventListener('abort',abort);}
  }
  async loadConfig(){
    if(this.config)return this.config;
    if(this.configRequest)return this.configRequest;
    this.configRequest=(async()=>{
      try{
        const config=await this.request('/v1/player/config',{authorization:this.authorization()});
        if(typeof config.enabled!=='boolean'||config.ranked!==config.enabled||config.tickRate!==256||config.ruleset!=='verified-v1'||
          (config.enabled&&(!/^[A-Za-z0-9_-]{20,256}$/.test(config.siteKey)||/^\d+x0{10,}/.test(config.siteKey))))throw Error('verification-unavailable');
        if(config.courses!==undefined&&(!Array.isArray(config.courses)||!config.courses.length||config.courses.length>16||!config.courses.every(supportsVerifiedRun)))throw Error('verification-unavailable');
        if(config.privateTest===true&&(!Array.isArray(config.courses)||config.courses.length!==1||config.courses[0].map!=='bhop-school'||config.courses[0].revision!==1||config.courses[0].preset!=='classic'))throw Error('verification-unavailable');
        this.config=config;this.status=config.privateTest?
          config.enabled?'Private test ready · Bhop School / CS-style.':'Sign in through Settings to enable private testing.':
          config.enabled?'Sign in, then complete the browser check. Only the top five reach the leaderboard.':'Verified runs are not available yet.';
        if(!config.enabled)this.phase='unavailable';this.emit();return config;
      }finally{this.configRequest=null;}
    })();return this.configRequest;
  }
  supportsSelection(selection){return supportsVerifiedRun(selection)&&(!this.config?.courses||this.config.courses.some(course=>['map','revision','preset'].every(key=>course[key]===selection[key])));}
  async refreshAccess({enroll=false}={}){
    const generation=++this.accessGeneration,authorization=this.authorization();
    try{
      await this.configRequest?.catch(()=>{});if(generation!==this.accessGeneration)return false;
      this.config=null;const config=await this.loadConfig();
      if(generation!==this.accessGeneration||authorization!==this.authorization())return false;
      if(config.privateTest&&config.requiresEnrollment&&enroll){
        if(globalThis.location?.origin!=='http://localhost:5173')throw Error('private-test-unavailable');
        this.phase='access';this.status='Linking your account for private testing…';this.emit();
        const controller=new AbortController(),timer=this.schedule(()=>controller.abort(),15000);
        try{
          const response=await this.fetcher('/__verification/private-tester',{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',
            signal:controller.signal,headers:{authorization}});
          const raw=await response.text();if(raw.length>4096)throw Error('private-test-unavailable');const result=JSON.parse(raw);
          if(!response.ok||result.enrolled!==true)throw Error(result.error||'private-test-unavailable');
        }finally{this.unschedule(timer);}
        if(generation!==this.accessGeneration||authorization!==this.authorization())return false;
        this.config=null;await this.loadConfig();
      }
      if(generation===this.accessGeneration){this.phase=this.config?.enabled?'idle':'unavailable';this.emit();}return this.config?.enabled===true;
    }catch(error){if(generation===this.accessGeneration){this.phase='error';this.status=movementVerifiedMessage(error.message==='private-test-account-mismatch'?error.message:'private-test-unavailable');this.emit();}return false;}
  }
  async prepare(selection,container){
    if(this.state().busy||this.state().active||!supportsVerifiedRun(selection))return false;
    this.cancel('',false);const generation=this.generation;this.selection={...selection};this.phase='loading';this.status='Checking verified run availability…';this.emit();
    try{
      const config=await this.loadConfig();if(generation!==this.generation)return false;
      if(!config.enabled)throw Error(config.privateTest?'private-test-access-required':'player-runs-disabled');if(!this.authorization())throw Error('player-auth-required');
      if(!this.supportsSelection(selection))throw Error(config.privateTest?'private-test-course-only':'course-not-ranked');
      this.phase='checking';this.status='Complete the browser check, then start your run.';this.emit();
      this.widget=await this.loadTurnstile();if(generation!==this.generation)return false;
      const fail=()=>{if(generation!==this.generation)return;this.#botToken=null;this.phase='error';this.status=movementVerifiedMessage('bot-check-failed');this.clearWidget();this.emit();};
      this.timer=this.schedule(fail,120000);
      this.widgetId=this.widget.render(container,{sitekey:config.siteKey,action:'verified-run',theme:'dark',appearance:'interaction-only',
        'response-field':false,'refresh-expired':'never',callback:token=>{
          if(generation!==this.generation||this.phase!=='checking')return;
          if(typeof token!=='string'||!token||token.length>2048){fail();return;}
          this.clearTimer();this.#botToken={value:token,expiresAt:this.now()+270000};this.phase='prepared';
          this.status='Ready. Pausing or resetting ends verification.';this.timer=this.schedule(fail,270000);this.emit();
        },'error-callback':()=>{fail();return true;},'expired-callback':fail,'timeout-callback':fail});
      return true;
    }catch(error){if(generation===this.generation){this.phase='error';this.status=movementVerifiedMessage(error.message);this.clearWidget();this.emit();}return false;}
  }
  async start(selection){
    if(this.phase!=='prepared'||!this.#botToken||this.#botToken.expiresAt<=this.now()||
      !this.supportsSelection(selection)||!['map','revision','preset'].every(key=>selection[key]===this.selection?.[key]))return false;
    const generation=this.generation,authorization=this.authorization(),token=this.#botToken.value;
    if(!authorization){this.cancel(movementVerifiedMessage('player-auth-required'));return false;}
    this.clearWidget();this.#botToken=null;this.phase='allocating';this.status='Connecting your verified run…';this.emit();
    try{
      const run=await this.request('/v1/player/runs',{body:{map:selection.map,preset:selection.preset,turnstileToken:token},authorization});
      if(generation!==this.generation){if(movementVerifiedId(run.runId))void this.cancelRemote(run.runId,authorization);return false;}
      if(!movementVerifiedId(run.runId)||typeof run.ticket!=='string'||run.ticket.length>2048||run.ranked!==true||
        run.socketPath!==`/v1/player/runs/${run.runId}/socket`||!Number.isSafeInteger(run.expiresAt)||run.expiresAt<=this.now()||
        run.selection?.map!==selection.map||run.selection?.revision!==selection.revision||run.selection?.preset!==selection.preset||!!run.privateTest!==!!this.config.privateTest||
        (selection.map==='endless'&&run.seed!==RANKED_ENDLESS_SEED)){
        if(movementVerifiedId(run.runId))void this.cancelRemote(run.runId,authorization);throw Error('revision-mismatch');
      }
      this.#run={id:run.runId};this.#runAuth=authorization;this.frames=[];this.sentTicks=0;this.seq=0;this.phase='connecting';
      const ready=new Promise((resolve,reject)=>{this.readyResolve=resolve;this.readyReject=reject;});
      void ready.catch(()=>{});
      this.#socket=this.createSocket(this.endpoint.replace('https:','wss:')+run.socketPath,['movementlab-v1','ticket.'+run.ticket]);
      this.#socket.addEventListener('message',event=>{if(generation===this.generation)this.message(event.data,generation);});
      const disconnected=()=>{if(generation===this.generation&&['connecting','active','finishing'].includes(this.phase))this.cancel('Verification lost its connection. You can continue practising.');};
      this.#socket.addEventListener('close',disconnected);this.#socket.addEventListener('error',disconnected);
      this.timer=this.schedule(()=>this.cancel('The verifier took too long to connect. Try again.'),8000);this.emit();
      await ready;return generation===this.generation&&this.phase==='active';
    }catch(error){if(generation===this.generation)this.cancel(movementVerifiedMessage(error.message));return false;}
  }
  message(raw,generation){
    try{
      if(typeof raw!=='string'||raw.length>65536)throw Error();const value=JSON.parse(raw);
      if(value.type==='ready'){
        if(this.phase!=='connecting'||value.runId!==this.#run.id||value.tickRate!==256||value.ranked!==true||!!value.privateTest!==!!this.config.privateTest)throw Error();
        this.clearTimer();this.phase='active';this.status=this.config.privateTest?'Private verified test · server connected':'Verified run · server connected';this.readyResolve?.();this.readyResolve=null;this.readyReject=null;this.emit();return;
      }
      if(value.type==='state')return;
      if(value.type!=='ended'||!['active','finishing'].includes(this.phase)||typeof value.reason!=='string')throw Error();
      const endless=this.selection?.map==='endless';
      const clean=endless?((value.reason==='respawn'&&value.invalid==='respawn')||(value.reason==='run-expired'&&value.invalid===null))&&Number.isFinite(value.distance)&&value.distance>=1&&value.distance<=1e9:
        value.reason==='completed'&&value.completed===true&&value.invalid===null;
      const eligible=clean&&Number.isFinite(value.time)&&value.time>0&&value.time<=600;
      this.clearTimer();this.result={completed:value.completed===true,time:value.time,distance:endless?Math.floor(value.distance):undefined,checkpoint:value.checkpoint,reason:value.reason,ranked:false,verified:false,scoreStatus:value.scoreStatus};
      const saved=eligible&&value.ranked===true&&value.scoreStatus==='saved'&&value.score?.saved===true;
      if(saved){this.result.ranked=true;this.result.personalBest=value.score.personalBest===true;this.phase='saved';
        this.result.verified=true;
        this.status=this.config.privateTest?'Private test verified · score saved.':this.result.personalBest?'Verified · top-five record saved.':'Verified · your better ranked personal best is kept.';this.#runAuth=null;}
      else if(eligible&&value.verified===true&&value.scoreStatus==='outside-top-five'&&value.score?.outsideTopFive===true){
        this.result.verified=true;this.phase='ended';this.status='Verified finish · outside the top five. No leaderboard entry added.';this.#runAuth=null;
      }else if(eligible&&value.scoreStatus==='pending'){
        this.phase='pending';this.status='Finished. Your verified score is waiting to save.';this.pollResult(generation,0);
      }else{this.phase='ended';this.status=value.reason==='completed'?'Finished. The score was not saved.':'Verification ended. You can continue practising.';this.#runAuth=null;}
      this.emit();
    }catch{this.cancel('Verification received an invalid response. You can continue practising.');}
  }
  input(frame){
    if(this.phase!=='active')return;
    const {forward,side,yaw,pitch,walk,duck,jumpHeld,jumpPressed}=frame;
    if(![-1,0,1].includes(forward)||![-1,0,1].includes(side)||!Number.isFinite(yaw)||Math.abs(yaw)>Math.PI||
      !Number.isFinite(pitch)||Math.abs(pitch)>1.5||![walk,duck,jumpHeld,jumpPressed].every(value=>typeof value==='boolean')){
      this.cancel('Verification received invalid controls. You can continue practising.');return;
    }
    this.frames.push({forward,side,yaw,pitch,walk,duck,jumpHeld,jumpPressed});if(this.frames.length>=16)this.flush();
  }
  flush(){
    if(!this.frames.length)return;
    if(!this.#socket||this.#socket.readyState!==1||this.#socket.bufferedAmount>16384){this.cancel('Verification connection is too slow. You can continue practising.');return;}
    const frames=this.frames.splice(0,16);
    try{this.#socket.send(JSON.stringify({seq:this.seq++,firstTick:this.sentTicks,frames}));this.sentTicks+=frames.length;}
    catch{this.cancel('Verification lost its connection. You can continue practising.');}
  }
  finish(){
    if(this.phase!=='active')return;this.flush();if(this.phase!=='active')return;
    this.phase='finishing';this.status='Checking the finish with the server…';this.timer=this.schedule(()=>this.cancel('The finish could not be confirmed. Check the leaderboard later.'),10000);this.emit();
  }
  pollResult(generation,index){
    if(index>=4)return;
    this.timer=this.schedule(async()=>{
      if(generation!==this.generation||this.phase!=='pending'||!this.#runAuth)return;
      try{
        const result=await this.request('/v1/player/runs/'+this.#run.id,{authorization:this.#runAuth});
        if(generation!==this.generation||this.phase!=='pending')return;
        if(result.scoreStatus!=='pending'){this.phase='finishing';this.message(JSON.stringify({type:'ended',...result}),generation);return;}
      }catch{}
      if(generation===this.generation&&this.phase==='pending')this.pollResult(generation,index+1);
    },[2000,5000,15000,30000][index]);
  }
  async cancelRemote(id,authorization){try{await this.request(`/v1/player/runs/${id}/cancel`,{method:'POST',authorization});}catch{}}
  cancel(status='Verification ended. You can continue practising.',notify=true){
    ++this.generation;this.clearWidget();this.#botToken=null;this.readyReject?.(Error('cancelled'));this.readyResolve=null;this.readyReject=null;
    const run=this.#run,authorization=this.#runAuth,socket=this.#socket;
    this.#run=null;this.#runAuth=null;this.#socket=null;this.frames=[];this.result=null;
    this.phase='idle';this.status=status||'Choose Verified Run to check availability.';
    try{socket?.close();}catch{}if(run&&authorization)void this.cancelRemote(run.id,authorization);if(notify)this.emit();
  }
  dispose(){++this.accessGeneration;this.cancel('',false);}
  async leaderboard(selection,{signal}={}){
    if(!supportsVerifiedRun(selection))throw Error('invalid-board');
    const data=await this.request(`/v1/leaderboards/${selection.map}/${selection.preset}?revision=${selection.revision}`,{signal,authorization:this.config?.privateTest?this.authorization():undefined});
    const endless=selection.map==='endless';
    if(data.map!==selection.map||data.preset!==selection.preset||data.revision!==selection.revision||data.ruleset!==(endless?'verified-endless-v1':'verified-v1')||!Array.isArray(data.records)||data.records.length>LEADERBOARD_LIMIT)throw Error('invalid-board');
    if(!data.records.every(row=>typeof row.name==='string'&&row.name.length<=40&&Number.isFinite(row.value)&&row.value>0&&
      (endless?Number.isSafeInteger(row.value)&&row.value<=1e9:row.value<=600)&&movementVerifiedId(row.runId)))throw Error('invalid-board');
    return data.records;
  }
}
