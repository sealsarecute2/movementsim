import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';

const addressPattern=/^https:\/\/movement-lab-verifier-staging\.[a-z0-9-]+\.workers\.dev$/;
const transientCodes=new Set(['ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE','ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR','ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','ETIMEDOUT','TIMEOUT']);
const transientStatuses=new Set([404,502,503,520,521,522,523,524,525,526,530]);
export class StagingConnectionError extends Error {
  constructor(message,code){super(message);this.name='StagingConnectionError';this.code=code;}
}
export function loadStagingConfig(directory=new URL('.',import.meta.url)){
  let base,secret;
  try{
    base=readFileSync(new URL('.staging-url',directory),'utf8').trim();
    secret=JSON.parse(readFileSync(new URL('.staging-secrets.json',directory),'utf8')).STAGING_KEY;
  }catch{throw Error('Cannot read the local staging setup files. Run setup-staging.command once before testing.');}
  if(!addressPattern.test(base))throw Error('Unexpected staging address; refusing to send credentials. Check .staging-url.');
  if(typeof secret!=='string'||secret.length<32||secret.length>256)throw Error('The local staging access key is missing or invalid. Run setup-staging.command again.');
  return {base,secret};
}
export function connectionError(error,where){
  const rawCode=error?.cause?.code||(error?.name==='TimeoutError'?'TIMEOUT':error?.code);
  const code=typeof rawCode==='string'&&/^[A-Z0-9_]{1,64}$/.test(rawCode)?rawCode:'NETWORK_ERROR';
  const detail=code.startsWith('ERR_SSL_')?'The TLS handshake failed before the service received the request.':
    ['ENOTFOUND','EAI_AGAIN'].includes(code)?'The hostname could not be resolved.':
    code==='TIMEOUT'||code==='UND_ERR_CONNECT_TIMEOUT'?'The connection timed out.':'The network connection failed.';
  // Do not include raw errors/headers: WebSocket errors may contain run tickets.
  return new StagingConnectionError(`${where}: ${detail} (${code})`,code);
}
export function createStagingClient({base,secret,fetchFn=globalThis.fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>performance.now(),log=console.log}){
  if(!addressPattern.test(base))throw Error('Unexpected staging address; refusing to send credentials.');
  async function call(path,body,{authenticated=true,timeoutMs=15000}={}){
    if(!/^\/v1\/[a-z0-9/-]+$/.test(path)&&path!=='/health')throw Error('Invalid staging request path');
    try{
      return await fetchFn(base+path,{method:body===undefined?'GET':'POST',headers:{
        ...(authenticated?{authorization:'Bearer '+secret}:{}),...(body===undefined?{}:{'content-type':'application/json'})},
        body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
    }catch(error){throw connectionError(error,`${body===undefined?'GET':'POST'} ${base}${path}`);}
  }
  async function json(path,body,options){
    const response=await call(path,body,options);let value;
    try{value=await response.json();}catch{throw Error(`${path}: HTTP ${response.status} returned an unexpected response. Check ${base}/health in your browser.`);}
    if(!response.ok){
      const reason=/^[a-z-]{1,64}$/.test(value?.error)?value.error:'request-rejected';
      throw Error(`${path}: HTTP ${response.status} (${reason}).`);
    }
    return value;
  }
  async function ready({attempts=18,delayMs=5000,maxWaitMs=180000}={}){
    const started=now();let last;
    for(let attempt=1;attempt<=attempts;attempt++){
      const remaining=maxWaitMs-(now()-started);if(remaining<=0)break;
      try{
        const response=await call('/health',undefined,{authenticated:false,timeoutMs:Math.max(1,Math.min(10000,Math.ceil(remaining)))});
        if(!response.ok){
          await response.body?.cancel();
          if(!transientStatuses.has(response.status))throw Error(`Health check returned HTTP ${response.status}. Check ${base}/health in your browser.`);
          last=new StagingConnectionError('Health check returned HTTP '+response.status,'HTTP_'+response.status);
        }else{
          let health;try{health=await response.json();}catch{throw Error(`The health check returned an unexpected response. Check ${base}/health in your browser.`);}
          if(health?.service!=='movement-lab-verifier'||health.mode!=='private-staging'||health.ranked!==false)throw Error('The address did not return the expected private staging service. Check .staging-url.');
          if(attempt>1)log('Cloudflare HTTPS is ready. Starting the authenticated checks.');
          return health;
        }
      }catch(error){
        if(!(error instanceof StagingConnectionError)||!transientCodes.has(error.code))throw error;
        last=error;
      }
      if(attempt===attempts||now()-started>=maxWaitMs)break;
      log(`Waiting for Cloudflare HTTPS (${attempt}/${attempts}, ${last.code}). Checking again shortly…`);
      await sleep(Math.min(delayMs,Math.max(0,maxWaitMs-(now()-started))));
    }
    throw new StagingConnectionError(`Cloudflare HTTPS did not become ready (${last?.code||'TIMEOUT'}). Open ${base}/health in your browser. A new workers.dev hostname may still be provisioning. Once that page works, rerun test-staging.command; redeployment is not needed.`,last?.code||'TIMEOUT');
  }
  return {base,call,json,ready};
}
