import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const execute=promisify(execFile),root=fileURLToPath(new URL('.',import.meta.url));
export class MetricsReadError extends Error {
  constructor(code,message,stage){super(message);this.code=code;if(stage)this.stage=stage;}
}
// Check the structure of our generated read-only queries before spending an
// analytics request. Strings/comments may contain delimiters; ignore those.
// This is a delimiter guard, not a substitute for GraphQL schema validation.
export function validateMetricsQueryStructure(query){
  if(typeof query!=='string'||!/^query\s/.test(query)||/\b(?:mutation|subscription)\b/.test(query))throw new MetricsReadError('invalid-request','Only read-only metrics queries are allowed.');
  const stack=[],pairs={'}':'{',')':'(',']':'['};let quoted=false,comment=false;
  for(let index=0;index<query.length;index++){
    const char=query[index];
    if(comment){if(char==='\n'||char==='\r')comment=false;continue;}
    if(quoted){if(char==='\\')index++;else if(char==='"')quoted=false;continue;}
    if(char==='"'){quoted=true;continue;}
    if(char==='#'){comment=true;continue;}
    if('{(['.includes(char))stack.push(char);
    else if(Object.hasOwn(pairs,char)&&stack.pop()!==pairs[char])throw new MetricsReadError('invalid-request','A generated metrics query has mismatched delimiters at character '+(index+1)+'. No request was sent.');
  }
  if(quoted||stack.length)throw new MetricsReadError('invalid-request','A generated metrics query has an unfinished string or selection. No request was sent.');
}
export function safeMetricsDiagnostics(errors,{token,accountId}={}){
  const redact=value=>{
    let text=String(value);
    for(const secret of [token,accountId].filter(Boolean))for(const form of new Set([secret,encodeURIComponent(secret)]))text=text.split(form).join('[redacted]');
    return text.replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/https?:\/\/[^\s<>"']+/gi,'[url]')
      .replace(/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?\b/g,'[redacted]')
      .replace(/\b[a-f0-9]{32,}\b/gi,'[id]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]')
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,'[address]').replace(/\b(?:[a-f0-9]{0,4}:){2,}[a-f0-9:.%]+\b/gi,'[address]')
      .replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').slice(0,400);
  };
  return (Array.isArray(errors)?errors:[]).slice(0,3).map(error=>({
    message:redact(typeof error?.message==='string'?error.message:'Unspecified provider error'),
    ...(Number.isSafeInteger(error?.code)?{code:error.code}:{}),
  }));
}
export function parseWranglerJson(output){
  // Wrangler can prepend a proxy notice to JSON. Never reflect the captured
  // text in an error: auth-token output contains credentials.
  const clean=output.replace(/\u001b\[[0-9;]*m/g,'');
  try{return JSON.parse(clean.slice(clean.indexOf('{'),clean.lastIndexOf('}')+1));}
  catch{throw new MetricsReadError('login-required','Wrangler did not return usable authentication. Run the existing staging login helper again.');}
}
export async function loadMetricsIdentity({run=execute,env=process.env}={}){
  const directory=await mkdtemp(join(tmpdir(),'movementlab-metrics-auth-'));
  try{
    // Wrangler debug logs also receive CLI output. Discard them for these
    // credential reads; stdout/stderr remain captured in memory, never echoed.
    const logPath=join(directory,'auth.log');await symlink('/dev/null',logPath);
    const childEnv={...env,WRANGLER_LOG:'none',WRANGLER_LOG_PATH:logPath,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false',NO_COLOR:'1'};
    const read=async args=>{
      let value;
      try{value=await run(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),...args,'--json','--config',join(root,'wrangler.json')],
        {cwd:root,env:childEnv,timeout:30000,maxBuffer:1024*1024});}
      catch{throw new MetricsReadError('login-required','Could not read the existing Wrangler login. Sign back into Wrangler or use the dashboard Metrics tab; do not paste credentials into chat.');}
      return parseWranglerJson(value.stdout);
    };
    const credentials=await read(['auth','token']);
    if(!['oauth','api_token'].includes(credentials.type)||typeof credentials.token!=='string'||credentials.token.length<16||credentials.token.length>4096)throw new MetricsReadError('login-required','A Wrangler OAuth login or scoped API token is required. Global API keys are not used by this helper.');
    let accountId=env.CLOUDFLARE_ACCOUNT_ID;
    if(accountId===undefined){
      const identity=await read(['whoami']);
      if(!identity.loggedIn||!Array.isArray(identity.accounts)||identity.accounts.length!==1)throw new MetricsReadError('account-required','More than one account, or no account, was returned. Set CLOUDFLARE_ACCOUNT_ID to the staging account ID and run the check again.');
      accountId=identity.accounts[0].id;
    }
    if(!/^[a-f0-9]{32}$/.test(accountId))throw new MetricsReadError('account-required','CLOUDFLARE_ACCOUNT_ID must be the staging account’s 32-character ID.');
    return {accountId,token:credentials.token};
  }finally{await rm(directory,{recursive:true,force:true});}
}

async function boundedJson(response){
  const reader=response.body?.getReader();if(!reader)throw new MetricsReadError('invalid-response','The metrics API returned an empty response.');
  const chunks=[];let bytes=0;
  while(true){
    const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
    if(bytes>2*1024*1024){await reader.cancel();throw new MetricsReadError('invalid-response','The metrics response exceeded its 2 MiB limit.');}
    chunks.push(Buffer.from(value));
  }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{throw new MetricsReadError('invalid-response','Cloudflare returned an unexpected metrics response.');}
}
export function metricsRetryDelay(headers,text,now=Date.now()){
  const header=headers.get('retry-after');
  const headerMs=header===null?0:/^\d+$/.test(header)?Number(header)*1000:Math.max(0,Date.parse(header)-now)||0;
  const match=text.match(/try again after\s+(\d+)\s*(seconds?|minutes?)/i);
  const messageMs=match?Number(match[1])*(/^minute/i.test(match[2])?60000:1000):0;
  return Math.max(headerMs,messageMs,headerMs||messageMs?0:300000)+5000;
}
export function metricsCooldownUntil(report,now=Date.now()){
  if(report?.reason!=='analytics-rate-limited'&&!report?.diagnostics?.some(item=>/rate limiter budget depleted/i.test(item.message)))return 0;
  const deadline=Number.isFinite(report.retryAt)?report.retryAt:Date.parse(report.generatedAt)+305000;
  return Number.isFinite(deadline)&&deadline>now?deadline:0;
}
export function createMetricsApi({accountId,token,fetchFn=globalThis.fetch,now=()=>Date.now(),sleep=ms=>new Promise(done=>setTimeout(done,ms)),
  log=()=>{},minIntervalMs=0,maxRateRetries=1,maxWaitMs=610000,initialCooldownUntil=0,onRateLimit=()=>{}}){
  if(!/^[a-f0-9]{32}$/.test(accountId)||typeof token!=='string'||token.length<16||token.length>4096)throw new MetricsReadError('login-required','The metrics account or login is invalid.');
  let nextGraphqlAt=0,cooldownUntil=initialCooldownUntil,retriesLeft=maxRateRetries,sleptMs=0;
  async function request(path,query){
    const namespaces='/accounts/'+accountId+'/workers/durable_objects/namespaces';
    if(!(path==='/graphql'&&typeof query==='string'&&/^query\s/.test(query)&&!/\b(?:mutation|subscription)\b/.test(query))&&!(query===undefined&&new RegExp('^'+namespaces+'\\?per_page=100&page=\\d{1,2}$').test(path)))throw new MetricsReadError('invalid-request','Only the fixed read-only metrics endpoints are allowed.');
    if(path==='/graphql')validateMetricsQueryStructure(query);
    const operation=query?.match(/^query\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
    let response;
    try{response=await fetchFn('https://api.cloudflare.com/client/v4'+path,{method:query===undefined?'GET':'POST',
      headers:{authorization:'Bearer '+token,...(query===undefined?{}:{'content-type':'application/json'})},
      ...(query===undefined?{}:{body:JSON.stringify({query})}),redirect:'error',signal:AbortSignal.timeout(15000)});}
    catch{throw new MetricsReadError('network-unavailable','Cloudflare analytics could not be reached. Run this command from your normal Terminal and keep TLS verification enabled.');}
    let value;
    try{value=await boundedJson(response);}
    catch(error){if(response.ok)throw error;value={};}
    if(!response.ok||value.errors?.length||value.success===false){
      const text=JSON.stringify(value.errors||[]);
      const denied=[401,403].includes(response.status)||/authoriz|permission|authentication|access denied|not allowed|does not have access|not entitled/i.test(text);
      const limited=response.status===429||/rate limiter budget depleted|rate limit(?:ed| exceeded)|too many queries in progress/i.test(text);
      const code=denied?'analytics-access-required':limited?'analytics-rate-limited':!response.ok&&response.status>=500?'api-unavailable':'query-unavailable';
      const summary=denied?'The current login cannot read these Cloudflare metrics.':
        limited?'Cloudflare analytics is rate limited; wait before retrying.':'Cloudflare rejected the metrics query.';
      const diagnostics=safeMetricsDiagnostics(value.errors,{token,accountId});
      const error=new MetricsReadError(code,summary+(operation?' Operation: '+operation+'.':'')+
        (diagnostics.length?' Provider: '+diagnostics.map(item=>item.message).join(' | '):' HTTP '+response.status+'.'),operation);
      error.diagnostics=diagnostics;error.httpStatus=response.status;
      if(code==='analytics-rate-limited'){error.retryAfterMs=metricsRetryDelay(response.headers,text,now());error.retryAt=now()+error.retryAfterMs;}
      throw error;
    }
    return query===undefined?value:value.data;
  }
  const waitUntil=async(deadline,showProgress=false)=>{
    let remaining=Math.max(0,deadline-now());
    if(remaining>maxWaitMs-sleptMs){
      const error=new MetricsReadError('analytics-rate-limited','The analytics cooldown exceeds this reader’s bounded wait budget. Retry after the provider cooldown.');
      error.retryAt=deadline;throw error;
    }
    if(showProgress&&remaining)log(`Cloudflare analytics cooldown: ${Math.ceil(remaining/1000)} seconds. Leave this Terminal open; the reader will resume automatically.`);
    while(remaining>0){
      const chunk=Math.min(remaining,30000);
      if(sleptMs+chunk>maxWaitMs){
        const error=new MetricsReadError('analytics-rate-limited','The bounded analytics wait budget is exhausted. Leave the cooldown time before trying again.');
        error.retryAt=deadline;throw error;
      }
      await sleep(chunk);sleptMs+=chunk;remaining=Math.max(0,deadline-now());
      if(showProgress&&remaining)log(`Analytics cooldown: ${Math.ceil(remaining/1000)} seconds remaining...`);
    }
  };
  const graphql=async query=>{
    validateMetricsQueryStructure(query);
    while(true){
      await waitUntil(cooldownUntil,true);await waitUntil(nextGraphqlAt);
      nextGraphqlAt=now()+minIntervalMs;
      try{return await request('/graphql',query);}
      catch(error){
        if(!(error instanceof MetricsReadError)||error.code!=='analytics-rate-limited')throw error;
        cooldownUntil=Math.max(cooldownUntil,error.retryAt);onRateLimit(error);
        if(retriesLeft<=0||error.retryAfterMs>maxWaitMs-sleptMs)throw error;
        retriesLeft--;log('The analytics budget is exhausted. Waiting once, then retrying only this read-only query.');
      }
    }
  };
  return {accountId,graphql,async namespaces(){
    const result=[];
    for(let page=1;page<=10;page++){
      const value=await request(`/accounts/${accountId}/workers/durable_objects/namespaces?per_page=100&page=${page}`);
      if(!Array.isArray(value.result))throw new MetricsReadError('invalid-response','Cloudflare did not return namespace metadata.');
      result.push(...value.result);
      if(value.result.length<100||value.result_info?.total_pages<=page)return result;
    }
    throw new MetricsReadError('too-many-namespaces','Namespace discovery exceeded its bounded page limit.');
  }};
}
