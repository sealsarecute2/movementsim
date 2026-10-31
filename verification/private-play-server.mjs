import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {realpath,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadStagingConfig} from './staging-client.mjs';

const assets=fileURLToPath(new URL('../dist/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json',
  '.svg':'image/svg+xml','.ico':'image/x-icon','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.glb':'model/gltf-binary'};
const reply=(response,status,data)=>{response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(data));};
async function emptyBody(request){
  request.setTimeout(3000,()=>request.destroy());let size=0;
  for await(const chunk of request){size+=chunk.length;if(size>128)throw Error('body-size');}
  request.setTimeout(0);if(size)throw Error('body-size');
}
export function createPrivatePlayServer({base,secret,fetcher=(...args)=>fetch(...args)}={}){
  if(!/^https:\/\/movement-lab-verifier-staging\.[a-z0-9-]+\.workers\.dev$/.test(base)||typeof secret!=='string'||secret.length<32||secret.length>256)throw Error('invalid-private-setup');
  let rateAt=0,requests=0;
  return createServer(async(request,response)=>{
    response.setHeader('x-content-type-options','nosniff');response.setHeader('referrer-policy','no-referrer');
    const origin='http://localhost:'+request.socket.localPort;
    if(request.headers.host!==new URL(origin).host||(request.headers.origin&&request.headers.origin!==origin))return reply(response,403,{error:'local-origin-required'});
    const url=new URL(request.url,origin);
    if(url.pathname==='/__verification/private-test'&&request.method==='GET')return reply(response,200,{privateTestHelper:true});
    if(url.pathname==='/__verification/private-tester'){
      if(request.method!=='POST')return reply(response,405,{error:'method-not-allowed'});
      if(request.headers.origin!==origin)return reply(response,403,{error:'local-origin-required'});
      const authorization=request.headers.authorization;
      if(!authorization?.startsWith('Bearer ')||authorization.length>2055)return reply(response,401,{error:'player-auth-required'});
      if(Number(request.headers['content-length']||0)>128)return reply(response,413,{error:'body-size'});
      const now=Date.now();if(now-rateAt>=60000){rateAt=now;requests=0;}if(++requests>6)return reply(response,429,{error:'request-rate'});
      try{
        await emptyBody(request);
        const upstream=await fetcher(base+'/v1/player/test/enroll',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),
          headers:{origin,authorization,'x-staging-key':secret}});
        const reader=upstream.body?.getReader();if(!reader)throw Error();let size=0;const chunks=[];
        while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();throw Error();}chunks.push(value);}
        const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(upstream.ok&&value.enrolled===true)return reply(response,200,{enrolled:true});
        const error=typeof value.error==='string'&&/^[a-z-]{1,64}$/.test(value.error)?value.error:'private-test-unavailable';
        return reply(response,[400,401,403,409,429,503].includes(upstream.status)?upstream.status:503,{error});
      }catch(error){return reply(response,error.message==='body-size'?413:503,{error:error.message==='body-size'?'body-size':'private-test-unavailable'});}
    }
    if(!['GET','HEAD'].includes(request.method))return reply(response,405,{error:'method-not-allowed'});
    try{
      const path=await realpath(resolve(assets,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname)));
      if(!path.startsWith(assets.endsWith(sep)?assets:assets+sep)||!(await stat(path)).isFile())return reply(response,404,{error:'not-found'});
      response.writeHead(200,{'content-type':types[extname(path)]||'application/octet-stream','cache-control':'no-store'});
      if(request.method==='HEAD')response.end();else createReadStream(path).on('error',()=>response.destroy()).pipe(response);
    }catch{return reply(response,404,{error:'not-found'});}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const server=createPrivatePlayServer(loadStagingConfig());
    server.listen(5173,'127.0.0.1',()=>console.log('Private test game: http://localhost:5173/?course=bhop-school\nSign in through Settings, then choose Bhop School / CS-style → Private Verified Run.'));
    server.on('error',()=>{console.error('The private test server could not start. Port 5173 may already be in use.');process.exitCode=1;});
  }catch{console.error('The existing private staging setup is unavailable. No credentials were printed.');process.exitCode=1;}
}
