import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {loadStagingConfig,createStagingClient,connectionError} from './staging-client.mjs';

function connect(run,{abuse=false,base}={}){
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(base.replace('https:','wss:')+'/v1/runs/'+run.runId+'/socket',['movementlab-v1','ticket.'+run.ticket]);
    const timeout=setTimeout(()=>{ws.close();reject(Error('WebSocket ready timeout'));},15000);
    ws.addEventListener('error',event=>{clearTimeout(timeout);reject(connectionError(event.error,'WebSocket handshake'));});
    ws.addEventListener('message',event=>{
      const message=JSON.parse(event.data);if(message.type!=='ready')return;clearTimeout(timeout);
      let stopped=false,timer,seq=0,ticks=0,lastState=null,maxCatchup=0,peakQueue=0;
      const epoch=performance.now(),gaps=[],acks=[],pending=[];
      const pump=()=>{
        if(stopped)return;
        if(abuse){ws.send('x'.repeat(4097));return;}
        const frames=Array.from({length:16},()=>({forward:0,side:0,yaw:0,pitch:0,walk:false,duck:false,jumpHeld:true,jumpPressed:false}));
        const firstTick=ticks;ws.send(JSON.stringify({seq:seq++,firstTick,frames}));ticks+=16;
        pending.push({tick:ticks,at:performance.now()});
        // Bound client-side diagnostic storage if the server stops acknowledging.
        if(pending.length>128){stopped=true;ws.close();return;}
        timer=setTimeout(pump,Math.max(0,epoch+seq*62.5-performance.now()));
      };
      const ended=new Promise(done=>ws.addEventListener('close',()=>{stopped=true;clearTimeout(timer);done();}));
      const reasons=[];
      ws.addEventListener('message',ev=>{
        const state=JSON.parse(ev.data),now=performance.now();
        if(state.type==='ended')reasons.push(state.reason);
        if(state.type==='state'){
          if(lastState!==null)gaps.push(now-lastState);lastState=now;
          while(pending.length&&pending[0].tick<=state.ticks)acks.push(now-pending.shift().at);
          maxCatchup=Math.max(maxCatchup,state.metrics.maxCatchup);peakQueue=Math.max(peakQueue,state.metrics.peakQueue);
        }
      });
      pump();
      resolve({runId:run.runId,ws,ended,gaps,acks,reasons,metrics:()=>({maxCatchup,peakQueue,sentTicks:ticks}),stop(){stopped=true;clearTimeout(timer);ws.close();}});
    });
  });
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const percentile=(xs,p)=>xs.length?[...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(xs.length*p))]:null;
export async function runHostedBenchmark({api,connectClient=connect,wait=pause,log=console.log,save=report=>writeFileSync(new URL('hosted-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n')}={}){
const clients=[];let attemptedStarts=false;
const start=async(slot,map='bhop_lego')=>api.json('/v1/runs',{slot,map,preset:'practice'});
try{
  await api.ready();
  const before=await api.json('/v1/status');
  if(!Number.isInteger(before.active))throw Error('The status endpoint returned an invalid response.');
  if(before.active!==0)throw Error('Existing test attempts are active. Stop them before benchmarking.');
  log('Starting eight private stationary-bhop simulations. No leaderboard records will be written.');
  attemptedStarts=true;
  const starts=await Promise.allSettled(Array.from({length:8},async(_,slot)=>{
    const client=await connectClient(await start(slot),{base:api.base});clients.push(client);return client;
  }));
  const failed=starts.find(r=>r.status==='rejected');
  if(failed)throw Error('At least one test client failed: '+failed.reason.message);
  const ninth=await api.call('/v1/runs',{slot:8,map:'course',preset:'classic'});
  if(ninth.status!==429)throw Error('Concurrency protection did not reject a ninth attempt.');
  const ninthReason=(await ninth.json()).error;
  await wait(8000);
  if(clients.some(c=>c.ws.readyState!==WebSocket.OPEN||c.reasons.length))throw Error('An ordinary simulation disconnected early.');
  for(const c of clients)c.stop();await Promise.all(clients.map(c=>c.ended));
  let after;
  for(let i=0;i<10;i++){after=await api.json('/v1/status');if(!after.active)break;await wait(500);}
  if(after.active)throw Error('A closed run retained capacity.');
  const abusive=await connectClient(await start(16),{abuse:true,base:api.base});clients.push(abusive);
  await Promise.race([abusive.ended,pause(5000).then(()=>{throw Error('Oversized input was not disconnected.');})]);
  const outcome=await api.json('/v1/runs/'+abusive.runId);
  if(outcome.reason!=='packet-size'||outcome.ticks!==0)throw Error('Oversized input reached physics or returned an unexpected result.');
  const gaps=clients.slice(0,8).flatMap(c=>c.gaps),acks=clients.slice(0,8).flatMap(c=>c.acks);
  const report={generatedAt:new Date().toISOString(),endpoint:api.base,mode:'private-staging',ranked:false,
    workload:'8 stationary auto-bhop attempts on bhop_lego; input at 256 ticks/sec. No complete-course or CPU profiling claim.',
    stateGapP95Ms:percentile(gaps,.95),inputAcknowledgementP95Ms:percentile(acks,.95),
    note:'Acknowledgement latency includes simulation scheduling, 200 ms state reporting and network delay. It is not pure network RTT. Read actual per-invocation CPU/memory in Cloudflare metrics.',
    ordinary:clients.slice(0,8).map(c=>({runId:c.runId,...c.metrics()})),ninthAttempt:{status:429,reason:ninthReason},
    oversizedPacket:{reason:outcome.reason,physicsTicks:outcome.ticks},activeAfterNormalRuns:after.active};
  save(report);log(JSON.stringify(report,null,2));return report;
}finally{
  for(const client of clients)client.stop();
  // Clean up reservations even after a partial connection or a failed test.
  if(attemptedStarts)await api.call('/v1/stop-all',{}).catch(()=>{});
}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await runHostedBenchmark({api:createStagingClient(loadStagingConfig())});}
  catch(error){console.error('Staging test stopped: '+error.message);process.exitCode=1;}
}
