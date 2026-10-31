import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {platform,arch,cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {RunInputGate,VERIFICATION_LIMITS,VERIFICATION_TICK_RATE} from '../verification/limits.js';
import {benchmarkMaps,makeWorkload,benchmarkFrame} from './verification-workload.mjs';

const options=Object.fromEntries(process.argv.slice(2).map(arg=>arg.replace(/^--/,'').split('=')));
const seconds=Number(options.seconds||8),samples=Number(options.samples||3);
const loads=(options.concurrency||'1,4,8,16,32').split(',').map(Number);
if(!Number.isFinite(seconds)||seconds<1||seconds>60||!Number.isInteger(samples)||samples<1||samples>5||loads.some(n=>!Number.isInteger(n)||n<1||n>64))throw Error('Use seconds=1..60, samples=1..5, concurrency=1..64');
const loadStart=performance.now(),maps=benchmarkMaps(),loadMs=performance.now()-loadStart;
const cases=maps.flatMap(map=>['classic','practice'].map(preset=>({name:map.id+' / '+preset,map,preset,feature:'route'})));
const ladder=maps.find(m=>m.id==='ladder-run'),kitsune=maps.find(m=>m.id==='bhop_kitsune');
for(const preset of ['classic','practice']){
  cases.push({name:'ladder climb / '+preset,map:ladder,preset,feature:'ladder'});
  cases.push({name:'Kitsune portals / '+preset,map:kitsune,preset,feature:'portal'});
}
cases.push({name:'Kitsune high speed / practice',map:kitsune,preset:'practice',feature:'fast'});
cases.push({name:'Lego repeated landings / practice',map:maps.find(m=>m.id==='bhop_lego'),preset:'practice',feature:'landing'});
const mixedNames=['bhop_lego / classic','bhop_kitsune / practice','endless / classic','ladder climb / classic',
  'course / practice','bhop-school / classic','bhop_lego / practice','Kitsune portals / practice'];
const mixed=mixedNames.map(name=>cases.find(c=>c.name===name));
const packetTicks=16,packetMs=packetTicks/VERIFICATION_TICK_RATE*1000;
function runGroup(descriptors,duration){
  let clock=0;const actors=descriptors.map(d=>({descriptor:d,gate:new RunInputGate({now:()=>clock}),workload:makeWorkload(d.map,d.preset,d)}));
  const batches=Math.floor(duration*1000/packetMs),batchTimes=[];
  const cpuStart=process.cpuUsage(),start=performance.now();
  for(let batch=0;batch<batches;batch++){
    const begin=performance.now();
    for(const {gate,descriptor} of actors){
      const frames=Array.from({length:packetTicks},(_,i)=>benchmarkFrame(gate.receivedTicks+i,descriptor.feature));
      gate.receive(JSON.stringify({seq:gate.sequence,firstTick:gate.receivedTicks,frames}));
    }
    clock+=packetMs;
    for(const {gate,workload} of actors)gate.advance(workload.simulate);
    batchTimes.push(performance.now()-begin);
  }
  const wallMs=performance.now()-start,cpu=process.cpuUsage(cpuStart);
  return {cpuMs:(cpu.user+cpu.system)/1000,wallMs,batchTimes,seconds:batches*packetMs/1000,
    coverage:actors.reduce((a,{workload})=>{for(const [key,value] of Object.entries(workload.coverage))a[key]=(a[key]||0)+value;return a;},{})};
}
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
function measure(descriptors){
  const trials=Array.from({length:samples},()=>runGroup(descriptors,seconds));
  const cpuMs=trials.reduce((a,t)=>a+t.cpuMs,0),simulationSeconds=trials.reduce((a,t)=>a+t.seconds,0);
  return {runs:descriptors.length,simulationSeconds,cpuMs,wallMs:trials.reduce((a,t)=>a+t.wallMs,0),
    cpuMsPerRunSecond:cpuMs/(simulationSeconds*descriptors.length),
    oneCorePercent:cpuMs/(simulationSeconds*1000)*100,
    batchP95Ms:percentile(trials.flatMap(t=>t.batchTimes),.95),batchMaxMs:Math.max(...trials.flatMap(t=>t.batchTimes)),
    coverage:trials.reduce((a,t)=>{for(const [k,v] of Object.entries(t.coverage))a[k]=(a[k]||0)+v;return a;},{})};
}
console.log(`Local verifier workload: ${VERIFICATION_TICK_RATE} Hz, ${cases.length} scenarios, ${samples} × ${seconds}s; no network traffic.`);
for(const descriptor of cases)runGroup([descriptor],1); // JIT/cache warm-up excluded.
const scenarios=[];
for(const descriptor of cases){
  const result={name:descriptor.name,boxes:descriptor.map.boxes.length,...measure([descriptor])};scenarios.push(result);
  console.log(`${result.name}: ${result.cpuMsPerRunSecond.toFixed(2)} CPU ms/run-second; batch p95 ${result.batchP95Ms.toFixed(2)} ms`);
}
const concurrency=[];
for(const count of loads){
  const result=measure(Array.from({length:count},(_,i)=>mixed[i%mixed.length]));concurrency.push(result);
  console.log(`${count} mixed runs: ${result.oneCorePercent.toFixed(1)}% of one local CPU core; batch p95 ${result.batchP95Ms.toFixed(2)} / ${packetMs} ms`);
}
const heaviest=scenarios.reduce((a,b)=>a.cpuMsPerRunSecond>b.cpuMsPerRunSecond?a:b);
const heavyDescriptor=cases.find(c=>c.name===heaviest.name),worstCaseConcurrency=[];
for(const count of loads.filter(n=>n>=VERIFICATION_LIMITS.activeRuns)){
  const result={scenario:heaviest.name,...measure(Array.from({length:count},()=>heavyDescriptor))};worstCaseConcurrency.push(result);
  console.log(`${count} runs all on ${heaviest.name}: ${result.oneCorePercent.toFixed(1)}% of one local CPU core; batch p95 ${result.batchP95Ms.toFixed(2)} / ${packetMs} ms`);
}
// An attack test stays local: oversized messages must never enter physics.
let physicsCalls=0,rejected=0;const attackStart=performance.now();
const oversize='x'.repeat(100000);
for(let i=0;i<10000;i++){
  const gate=new RunInputGate({now:()=>0});
  try{gate.receive(oversize);gate.advance(()=>physicsCalls++);}catch{rejected++;}
}
const abuse={oversizedPackets:10000,rejected,physicsCalls,wallMs:performance.now()-attackStart};
const worst=Math.max(...scenarios.map(s=>s.cpuMsPerRunSecond));
const report={generatedAt:new Date().toISOString(),environment:{platform:platform(),arch:arch(),cpu:cpus()[0]?.model,node:process.version},
  method:{tickRate:VERIFICATION_TICK_RATE,seconds,samples,packetTicks,packetMs,mixedScenarios:mixedNames,
    note:'Local Node CPU benchmark with bounded input parsing, existing physics, checkpoint/trigger checks and episode resets. Not a Cloudflare, network, complete-route or memory-capacity benchmark. Mixed runs share one event loop; each scenario rotates route surfaces. High-speed/portal fixtures are synthetic stress states.'},
  coldMapLoadMs:loadMs,memory:process.memoryUsage(),limits:VERIFICATION_LIMITS,scenarios,concurrency,worstCaseConcurrency,abuse,
  recommendation:{initialActiveRuns:VERIFICATION_LIMITS.activeRuns,
    localCpuOnlyCeilingAt50Percent:Math.max(0,Math.floor(500/worst)),
    note:'The CPU-only ceiling is an extrapolation from the slowest scenario on this Mac, not a safe public capacity. Start with 8 only after hosted testing passes; measure Worker CPU, memory, latency and daily usage before enabling ranked submissions.'}};
const out=resolve(options.out||'verification/benchmark-results.json');mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(`Saved ${out}; ${rejected}/10000 oversized packets rejected, ${physicsCalls} physics calls.`);
