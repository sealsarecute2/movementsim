import {readFileSync,writeFileSync,existsSync,chmodSync} from 'node:fs';
import {mkdtemp,symlink,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadMetricsIdentity} from './cloudflare-metrics-client.mjs';

const root=fileURLToPath(new URL('.',import.meta.url)),run=promisify(execFile);
const widgetName='Movement Lab verified runs',domains=['localhost','sealsarecute2.github.io'];
const privateFile=join(root,'.turnstile-secrets.json');
const validKey=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{20,256}$/.test(value)&&!/^\d+x0{10,}/.test(value);
try{
  if(!existsSync(join(root,'.google-login.wrangler.json')))throw Error('Complete the existing Google login setup first.');
  const {accountId,token}=await loadMetricsIdentity();
  async function api(path='',body){
    const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/challenges/widgets${path}`,{
      method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const data=await response.json();
    if(!response.ok||data.success!==true)throw Error(`Cloudflare Turnstile setup was rejected (HTTP ${response.status}). The existing login may lack Turnstile write permission.`);
    return data.result;
  }
  const widgets=await api();if(!Array.isArray(widgets))throw Error('Cloudflare returned an invalid widget list.');
  const matching=widgets.filter(widget=>widget.name===widgetName);if(matching.length>1)throw Error('Multiple matching widgets exist; no widget was changed.');
  const createdWidget=matching.length===0;
  const widget=createdWidget?await api('',{name:widgetName,domains,mode:'managed',clearance_level:'no_clearance'}):await api('/'+matching[0].sitekey);
  if(!validKey(widget.sitekey)||widget.mode!=='managed'||!domains.every(host=>widget.domains?.includes(host)))throw Error('The widget has unexpected settings; player runs remain disabled.');
  let secret=widget.secret;
  if(!validKey(secret)&&existsSync(privateFile))secret=JSON.parse(readFileSync(privateFile,'utf8')).TURNSTILE_SECRET_KEY;
  if(!validKey(secret))throw Error('The widget secret was not returned. Player runs remain disabled; no secret was rotated.');
  writeFileSync(privateFile,JSON.stringify({TURNSTILE_SECRET_KEY:secret})+'\n',{mode:0o600});chmodSync(privateFile,0o600);
  for(const name of ['.google-login.wrangler.json','.staging.wrangler.json']){
    const file=join(root,name);if(!existsSync(file))continue;
    const config=JSON.parse(readFileSync(file,'utf8'));
    config.vars.TURNSTILE_SITE_KEY=widget.sitekey;config.vars.PLAYER_RUNS_ENABLED='false';config.vars.RANKED_SUBMISSIONS_ENABLED='false';
    writeFileSync(file,JSON.stringify(config,null,2)+'\n');
  }
  const temporary=await mkdtemp(join(tmpdir(),'movementlab-turnstile-'));
  try{
    const log=join(temporary,'secret.log');await symlink('/dev/null',log);
    await run(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'secret','bulk',privateFile,'--config',join(root,'.google-login.wrangler.json')],{
      cwd:root,timeout:60000,maxBuffer:1024*1024,
      env:{...process.env,WRANGLER_LOG:'none',WRANGLER_LOG_PATH:log,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false',NO_COLOR:'1'},
    }).catch(()=>{throw Error('The widget was configured locally, but saving its Cloudflare secret did not complete. The existing private file can be reused.');});
  }finally{await rm(temporary,{recursive:true,force:true});}
  const report={generatedAt:new Date().toISOString(),configured:true,createdWidget,siteKey:widget.sitekey,domains,mode:'managed',
    secretStoredInCloudflare:true,playerRunsEnabled:false,rankedSubmissionsEnabled:false,deployedGame:false};
  writeFileSync(join(root,'turnstile-setup-results.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({configured:true,createdWidget,domains,mode:'managed',secretStoredInCloudflare:true,publicSubmissionsEnabled:false}));
}catch(error){
  // Never echo provider bodies, CLI output, token-bearing headers or secrets.
  const message=error?.message;
  console.error(typeof message==='string'&&/^(Complete the existing|Cloudflare Turnstile setup was rejected|Cloudflare returned|Multiple matching|The widget has|The widget secret|The widget was configured)/.test(message)?message:
    'Turnstile setup could not complete. Player runs remain disabled; no credentials were printed.');
  process.exitCode=1;
}
