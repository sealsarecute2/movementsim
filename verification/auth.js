import {timingSafeEqual} from 'node:crypto';
const encoder=new TextEncoder();
const encode=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const key=secret=>crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
export function configuredSecret(secret){return typeof secret==='string'&&secret.length>=32&&secret.length<=256;}
export function ownerAuthorized(request,secret){
  if(!configuredSecret(secret))return false;
  const auth=request.headers.get('authorization');if(!auth?.startsWith('Bearer ')||auth.length>263)return false;
  const a=encoder.encode(auth.slice(7)),b=encoder.encode(secret);
  return a.length===b.length&&timingSafeEqual(a,b);
}
export async function networkKey(address,secret,now=Date.now()){
  if(typeof address!=='string'||!address||address.length>128)throw Error('missing-network');
  const bytes=await crypto.subtle.sign('HMAC',await key(secret),encoder.encode('network-v1:'+Math.floor(now/86400000)+':'+address));
  return encode(new Uint8Array(bytes));
}
export async function signTicket(claims,secret){
  const body=encode(encoder.encode(JSON.stringify(claims)));
  const signature=await crypto.subtle.sign('HMAC',await key(secret),encoder.encode('run-v1:'+body));
  return body+'.'+encode(new Uint8Array(signature));
}
export async function verifyTicket(token,secret,runId,now=Date.now()){
  if(!configuredSecret(secret)||typeof token!=='string'||token.length>2048||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(token))throw Error('invalid-ticket');
  const [body,signature]=token.split('.');let claims;
  try{
    if(!await crypto.subtle.verify('HMAC',await key(secret),decode(signature),encoder.encode('run-v1:'+body)))throw Error();
    claims=JSON.parse(new TextDecoder().decode(decode(body)));
  }catch{throw Error('invalid-ticket');}
  if(claims.v!==1||claims.runId!==runId||!/^[-a-f0-9]{36}$/.test(runId)||!Number.isFinite(claims.exp)||claims.exp<=now||claims.exp>now+60000||typeof claims.accountId!=='string')throw Error('invalid-ticket');
  return claims;
}
