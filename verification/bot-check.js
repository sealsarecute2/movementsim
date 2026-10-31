import {PlayerAuthError} from './player-auth.js';
export function turnstileConfigured(env){
  const valid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{20,256}$/.test(value)&&!/^\d+x0{10,}/.test(value);
  return valid(env.TURNSTILE_SITE_KEY)&&valid(env.TURNSTILE_SECRET_KEY);
}
export function createBotVerifier(fetcher=(...args)=>fetch(...args),now=Date.now){
  return async(token,{env,origin,address})=>{
    if(!turnstileConfigured(env))throw new PlayerAuthError('verification-unavailable',503);
    if(typeof token!=='string'||!token||token.length>2048)throw new PlayerAuthError('bot-check-required',400);
    try{
      const response=await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
        method:'POST',redirect:'manual',signal:AbortSignal.timeout(5000),headers:{'content-type':'application/json'},
        body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY,response:token,remoteip:address,idempotency_key:crypto.randomUUID()}),
      });
      if(response.status!==200||!response.body)throw Error();
      const reader=response.body.getReader();let size=0;const chunks=[];
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw Error();}chunks.push(value);}
      const result=JSON.parse(Buffer.concat(chunks).toString('utf8')),issued=Date.parse(result.challenge_ts);
      if(result.success!==true||result.hostname!==new URL(origin).hostname||result.action!=='verified-run'||
        !Number.isFinite(issued)||issued>now()+15000||issued<now()-300000)throw new PlayerAuthError('bot-check-failed',403);
    }catch(error){if(error instanceof PlayerAuthError)throw error;throw new PlayerAuthError('bot-check-unavailable',503);}
  };
}
export const verifyBot=createBotVerifier();
