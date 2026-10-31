import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {mkdir,writeFile,realpath,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {REFERENCE_MAX_BYTES} from '../dist/reference-run.js';
import {checkReference} from './reference-check.mjs';

const assets=fileURLToPath(new URL('../dist/',import.meta.url));
const recordings=fileURLToPath(new URL('./reference-runs/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon',
  '.woff2':'font/woff2','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.glb':'model/gltf-binary'};
function json(response,status,value){response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(value));}
function body(request){
  return new Promise((accept,reject)=>{
    let bytes=0;const chunks=[];
    const cleanup=()=>{request.setTimeout(0);request.off('data',data);request.off('end',end);request.off('error',error);request.off('aborted',aborted);};
    const fail=message=>{cleanup();request.resume();reject(Error(message));};
    const data=chunk=>{bytes+=chunk.length;if(bytes>REFERENCE_MAX_BYTES)fail('The recording exceeds 48 MiB.');else chunks.push(chunk);};
    const end=()=>{cleanup();accept(Buffer.concat(chunks).toString('utf8'));};
    const error=()=>fail('The recording could not be read.');
    const aborted=()=>fail('The recording was interrupted.');
    request.on('data',data);request.on('end',end);request.on('error',error);request.on('aborted',aborted);
    request.setTimeout(15000,()=>fail('The recording upload timed out.'));
  });
}
// Binds only to loopback, serves only game assets, requires the exact local
// Origin for writes, and checks one bounded fixture at a time. No cloud key or
// Cloudflare endpoint is exposed to the browser; this helper is local only.
export function createReferenceServer({directory=recordings,check=checkReference,log=console.log}={}){
  let busy=false;
  return createServer(async(request,response)=>{
    response.setHeader('x-content-type-options','nosniff');
    response.setHeader('referrer-policy','no-referrer');
    const origin='http://127.0.0.1:'+request.socket.localPort;
    if(request.headers.host!==new URL(origin).host||request.headers.origin&&request.headers.origin!==origin){json(response,403,{error:'Open this test from its local Terminal link.'});return;}
    const url=new URL(request.url,origin);
    if(url.pathname==='/__verification/reference'){
      if(request.method!=='POST'){json(response,405,{error:'Use the finish-screen reference button.'});return;}
      if(request.headers.origin!==origin||request.headers['content-type']!=='application/json'){json(response,403,{error:'Reference checks require a same-origin JSON request.'});return;}
      if(busy){json(response,429,{error:'A reference check is already running.'});return;}
      if(Number(request.headers['content-length'])>REFERENCE_MAX_BYTES){json(response,413,{error:'The recording exceeds 48 MiB.'});return;}
      busy=true;
      try{
        const raw=await body(request),{record,result}=check(raw);
        await mkdir(directory,{recursive:true});
        const filename=`${record.map}-v${record.revision}-${record.preset}-${Date.now()}.json`;
        await writeFile(resolve(directory,filename),JSON.stringify(record)+'\n',{flag:'wx'});
        await writeFile(resolve(directory,'latest-result.json'),JSON.stringify({generatedAt:new Date().toISOString(),file:filename,...result},null,2)+'\n');
        log(`PASS: ${record.map} / ${record.preset}, ${result.ticks} ticks, ${result.time.toFixed(6)}s; ${result.samplesChecked} samples matched. Saved ${filename}.`);
        json(response,200,result);
      }catch(error){log('Reference check failed: '+error.message);json(response,400,{error:error.message});}
      finally{busy=false;}
      return;
    }
    if(!['GET','HEAD'].includes(request.method)){json(response,405,{error:'Method not allowed.'});return;}
    try{
      const path=await realpath(resolve(assets,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname)));
      if(!path.startsWith(assets.endsWith(sep)?assets:assets+sep)||!(await stat(path)).isFile()){json(response,404,{error:'Not found.'});return;}
      response.writeHead(200,{'content-type':types[extname(path)]||'application/octet-stream','cache-control':'no-store'});
      if(request.method==='HEAD')response.end();else createReadStream(path).on('error',()=>response.destroy()).pipe(response);
    }catch{json(response,404,{error:'Not found.'});}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const server=createReferenceServer();
  server.listen(0,'127.0.0.1',()=>{
    const url=`http://127.0.0.1:${server.address().port}/?referenceRun=1&course=bhop-school`;
    console.log('\nOpen this local test link:\n'+url+'\n\nChoose Bhop practice for an easier first run. Finish without E or a fall, then click CHECK REFERENCE RUN. Q starts a fresh recording.\nLeave this Terminal open while playing. Press Control-C when finished. No records are submitted.\n');
    if(process.env.REFERENCE_OPEN_BROWSER==='1')import('node:child_process').then(({spawn})=>{
      const child=spawn('open',[url],{stdio:'ignore'});child.on('error',()=>{});
    });
  });
  server.on('error',error=>{console.error('Local reference test could not start: '+error.message);process.exitCode=1;});
}
