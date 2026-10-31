import {readFileSync,writeFileSync,statSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {DT} from '../dist/physics.js';
import {REFERENCE_MAX_BYTES} from '../dist/reference-run.js';
import {RunSimulation} from './simulation.js';
import {checkReference,compareReferenceState} from './reference-check.mjs';
import {loadStagingConfig,createStagingClient,connectionError} from './staging-client.mjs';

const runIdPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fixturePattern=/^(course|bhop-school|ladder-run|bhop_lego|bhop_kitsune)-v[1-9]\d{0,4}-(classic|practice)-\d{13}\.json$/;
const pause=ms=>new Promise(done=>setTimeout(done,ms));
export function loadLatestReference(directory=new URL('./reference-runs/',import.meta.url)){
  let file;
  try{file=JSON.parse(readFileSync(new URL('latest-result.json',directory),'utf8')).file;}
  catch{throw Error('No checked reference was found. Finish a run using reference-run.command first.');}
  if(typeof file!=='string'||!fixturePattern.test(file))throw Error('The latest reference filename is invalid. Record and check a new run.');
  const root=realpathSync(fileURLToPath(directory)),path=realpathSync(resolve(root,file));
  if(!path.startsWith(root+sep)||!statSync(path).isFile()||statSync(path).size>REFERENCE_MAX_BYTES)throw Error('The reference file is outside its folder or exceeds 48 MiB.');
  return {file,raw:readFileSync(path,'utf8')};
}

// Send only recorded controls, in bounded 16-tick packets at real-time speed.
// Samples/scores never cross the socket. Error text never includes a ticket.
export function connectReference(run,{base,record,onState=()=>{},onReady=()=>{},createSocket=(url,protocols)=>new WebSocket(url,protocols),
  now=()=>performance.now(),schedule=setTimeout,cancel=clearTimeout}={}){
  if(!runIdPattern.test(run.runId)||typeof run.ticket!=='string'||!/^[A-Za-z0-9_.-]{1,2048}$/.test(run.ticket))throw Error('The service returned an invalid run ticket.');
  let ws;
  try{ws=createSocket(base.replace('https:','wss:')+'/v1/runs/'+run.runId+'/socket',['movementlab-v1','ticket.'+run.ticket]);}
  catch(error){throw connectionError(error,'Reference WebSocket');}
  let ready=false,settled=false,sentTicks=0,sequence=0,epoch=0,pumpTimer,deadline,previousPump=0;
  let accept,reject;
  const done=new Promise((yes,no)=>{accept=yes;reject=no;});
  const close=()=>{try{ws.close();}catch{}};
  const finish=(error,value)=>{
    if(settled)return;settled=true;cancel(pumpTimer);cancel(deadline);
    close();if(error)reject(error);else accept({...value,sentTicks,packetsSent:sequence});
  };
  deadline=schedule(()=>finish(Error('The reference WebSocket did not become ready within 15 seconds.')),15000);
  function pump(){
    if(settled)return;
    const at=now();
    if(at-previousPump>250){finish(Error('The replay input timer was delayed. Keep Terminal active and retry once.'));return;}
    previousPump=at;
    if(ws.readyState!==1||ws.bufferedAmount>65536){finish(Error('The reference connection closed or could not keep up with input.'));return;}
    const frames=record.frames.slice(sentTicks,sentTicks+16);
    try{ws.send(JSON.stringify({seq:sequence++,firstTick:sentTicks,frames}));}
    catch(error){finish(connectionError(error,'Sending reference inputs'));return;}
    sentTicks+=frames.length;
    if(!settled&&sentTicks<record.frames.length)pumpTimer=schedule(pump,Math.max(0,epoch+sentTicks*DT*1000-now()));
  }
  ws.addEventListener('message',event=>{
    if(settled)return;
    try{
      if(typeof event.data!=='string'||event.data.length>16384)throw Error('The reference server sent an invalid message.');
      let state;try{state=JSON.parse(event.data);}catch{throw Error('The reference server sent invalid JSON.');}
      if(state.type==='ready'){
        if(ready||state.runId!==run.runId||state.tickRate!==1/DT||state.ranked!==false)throw Error('The reference server returned an unexpected ready message.');
        ready=true;cancel(deadline);epoch=now();previousPump=epoch;
        deadline=schedule(()=>finish(Error('The server did not finish the reference within the replay deadline.')),record.frames.length*DT*1000+10000);
        onReady();
        pump();return;
      }
      if(!ready)throw Error('The reference server sent state before readiness.');
      if(state.type==='state'){
        if(state.ticks>sentTicks)throw Error('The server acknowledged inputs that were not sent.');
        onState(state);return;
      }
      if(state.type==='ended'){
        if(state.reason!=='completed'){
          const reason=/^[a-z-]{1,64}$/.test(state.reason)?state.reason:'unexpected-outcome';
          throw Error('The hosted reference ended without finishing ('+reason+').');
        }
        onState(state);finish(null,state);return;
      }
      throw Error('The reference server sent an unknown message type.');
    }catch(error){finish(error);}
  });
  ws.addEventListener('error',event=>finish(connectionError(event.error,'Reference WebSocket')));
  ws.addEventListener('close',()=>finish(Error('The reference socket closed before a completed outcome arrived.')));
  return {done,stop(){finish(Error('The reference replay was stopped.'));}};
}

export async function runHostedReference({raw,file,api,connectClient=connectReference,validate=checkReference,wait=pause,log=console.log,
  save=report=>writeFileSync(new URL('./hosted-reference-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n')}={}){
  // Validate and compute the local expectation BEFORE any network allocation.
  log('Checking the saved reference locally...');
  const {record,map,result:local}=validate(raw),expected=new RunSimulation(map,record.preset);
  let client,stateComparisons=0,previousTick=0;
  const compare=state=>{
    if(!Number.isSafeInteger(state.ticks)||state.ticks<previousTick||state.ticks>record.frames.length)throw Error('The hosted reference reported invalid tick progress.');
    if(++stateComparisons>3001)throw Error('The hosted reference exceeded its state-message budget.');
    while(expected.ticks<state.ticks)expected.step(record.frames[expected.ticks]);
    compareReferenceState(state,expected.state());previousTick=state.ticks;
  };
  try{
    log('Checking Cloudflare HTTPS readiness...');
    await api.ready();
    log('Checking available staging capacity...');
    const before=await api.json('/v1/status');
    if(before.active!==0)throw Error('Existing staging attempts are active. Finish or stop them before this replay.');
    log(`Replaying ${record.map} / ${record.preset}: ${record.frames.length} input ticks, ${(record.frames.length*DT).toFixed(1)} seconds in real time. No leaderboard record will be written.`);
    const run=await api.json('/v1/runs',{slot:24,map:record.map,preset:record.preset});
    if(run.ranked!==false||run.selection?.map!==record.map||run.selection?.revision!==record.revision||run.selection?.preset!==record.preset)throw Error('The hosted map revision or physics mode differs from the saved reference.');
    client=connectClient(run,{base:api.base,record,onState:compare});
    const ended=await client.done;
    if(ended.reason!=='completed'||ended.invalid!==null||ended.ranked!==false||ended.sentTicks!==record.frames.length)throw Error('The hosted reference did not return a clean private completion.');
    compareReferenceState(ended,record.samples.at(-1));
    let outcome;
    for(let attempt=0;attempt<10;attempt++){
      outcome=await api.json('/v1/runs/'+run.runId);
      if(outcome.reason)break;await wait(250);
    }
    if(outcome.reason!=='completed'||outcome.invalid!==null||outcome.ranked!==false)throw Error('The persisted hosted outcome did not confirm a clean completion.');
    compareReferenceState(outcome,record.samples.at(-1));
    let after;
    for(let attempt=0;attempt<10;attempt++){
      after=await api.json('/v1/status');if(after.active===0)break;await wait(250);
    }
    if(after.active!==0)throw Error('Staging still reports active attempts after the replay. No other attempts were stopped.');
    const report={generatedAt:new Date().toISOString(),file,sha256:createHash('sha256').update(raw).digest('hex'),endpoint:api.base,
      mode:'private-staging',ranked:false,map:record.map,revision:record.revision,preset:record.preset,
      inputTicks:record.frames.length,replaySeconds:record.frames.length*DT,stateComparisons,
      local:{ticks:local.ticks,time:local.time,checkpoint:local.checkpoint,samplesChecked:local.samplesChecked},
      hosted:{runId:run.runId,reason:outcome.reason,ticks:outcome.ticks,time:outcome.time,checkpoint:outcome.checkpoint,
        completed:outcome.completed,invalid:outcome.invalid,metrics:outcome.metrics},
      timeDifferenceSeconds:outcome.time-local.time,packetsSent:ended.packetsSent,activeAfter:after.active,
      note:'One recorded complete route, streamed as input only; movement, checkpoints and final time compared. This is not a CPU/memory measurement or public anti-cheat certification.'};
    await save(report);
    log(`PASS: hosted ${outcome.time.toFixed(9)}s matches local ${local.time.toFixed(9)}s; ${stateComparisons} state comparisons, all checkpoints, zero active attempts afterward. Saved hosted-reference-results.json.`);
    return report;
  }finally{
    // Close only this replay. Never stop unrelated runs or retry allocation.
    // An unopened reservation is reclaimed by the server's 15-second alarm.
    client?.stop();
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await runHostedReference({...loadLatestReference(),api:createStagingClient(loadStagingConfig())});}
  catch(error){console.error('Hosted reference test stopped: '+error.message);process.exitCode=1;}
}
