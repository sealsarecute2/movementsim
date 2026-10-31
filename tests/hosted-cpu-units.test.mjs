import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmHostedCpuUnits,cpuUnitFromDescription} from '../verification/hosted-cpu-units.mjs';
import {createMetricsApi,MetricsReadError,validateMetricsQueryStructure} from '../verification/cloudflare-metrics-client.mjs';
import {METRICS_SCRIPT} from '../verification/hosted-metrics.mjs';
import {verifiedCpuEvidence} from '../verification/cpu-unit-evidence.mjs';

const accountId='a'.repeat(32),token='private-cpu-metadata-test-token';
const now=()=>Date.parse('2026-10-30T02:45:00Z');
function sources(){return ['hosted-metrics-results.json','hosted-moving-metrics-results.json'].map((file,index)=>({file,report:{
  generatedAt:'2026-10-30T02:40:00Z',status:'collected',mode:'private-staging',ranked:false,script:METRICS_SCRIPT,accountId,
  window:{from:'2026-10-30T02:32:00Z',to:'2026-10-30T02:36:00Z'},measurements:[
    {dataset:'durableObjectsPeriodicGroups',className:'VerifiedRun',status:'available',scope:'namespace-window',values:{'sum.cpuTime':index?2329987:654228}},
    {dataset:'durableObjectsPeriodicGroups',className:'AdmissionCoordinator',status:'available',scope:'namespace-window',values:{'sum.cpuTime':index?17955:5496}},
    ...['VerifiedRun','AdmissionCoordinator'].map(className=>({dataset:'durableObjectsInvocationsAdaptiveGroups',className,status:'available',values:{'sum.requests':8}})),
    {dataset:'workersInvocationsAdaptive',className:null,status:'available',scope:'worker-window',values:{'quantiles.cpuTimeP50':2201,'quantiles.cpuTimeP99':5667}},
  ],
}}));}
function metadata(query,{sum='Sum of CPU time - microseconds',p50='CPU time - microseconds',p99='CPU time - microseconds',missingType=false}={}){
  const typeName=query.match(/__type\(name:"(\w+)"\)/)?.[1];
  return {__type:missingType?null:{name:typeName,fields:typeName.endsWith('Sum')?[{name:'cpuTime',description:sum}]:[
    {name:'cpuTimeP50',description:p50},{name:'cpuTimeP99',description:p99},
  ]}};
}
function apiFor(change){
  const queries=[];
  return {queries,api:{accountId,async graphql(query){
    validateMetricsQueryStructure(query);queries.push(query);return metadata(query,change);
  },async namespaces(){assert.fail('CPU unit confirmation must not enumerate namespaces');}}};
}
test('two small metadata reads confirm CPU units and convert both saved windows without changing their source reports',async()=>{
  const {api,queries}=apiFor(),input=sources(),before=structuredClone(input),logs=[];let saved;
  const report=await confirmHostedCpuUnits({api,sources:input,now,log:value=>logs.push(value),save:value=>{saved=value;}});
  assert.equal(saved,report);assert.equal(report.status,'confirmed');assert.equal(report.source,'live-provider-schema');
  assert.equal(verifiedCpuEvidence(report,{now:now(),script:METRICS_SCRIPT}).units['durableObjectsPeriodicGroups.sum.cpuTime'],'microseconds');
  assert.equal(queries.length,2);assert.equal(report.evidence.length,3);assert.equal(report.samples.length,2);
  assert.deepEqual(input,before,'Raw metrics files must retain their original timestamps, units and values');
  for(const query of queries){
    assert.ok(query.length<200);assert.equal([...query.matchAll(/__type\(/g)].length,1);
    assert.ok(!query.includes('__schema'));assert.ok(query.includes('name fields { name description }'));
    assert.ok(!query.includes('accounts('));assert.ok(!query.includes('ofType'));assert.ok(!query.includes('mutation'));
  }
  const verified=report.samples[1].cpu.find(item=>item.className==='VerifiedRun');
  assert.equal(report.samples[0].cpu.find(item=>item.className==='VerifiedRun').milliseconds,654.228);
  assert.equal(report.samples[1].cpu.find(item=>item.className==='AdmissionCoordinator').milliseconds,17.955);
  assert.equal(verified.raw,2329987);assert.equal(verified.unit,'microseconds');assert.ok(Math.abs(verified.milliseconds-2329.987)<1e-9);
  assert.equal(report.samples[1].cpu.length,4);assert.ok(logs.some(value=>value.includes('Saved hosted-cpu-units-results.json (confirmed)')));
  assert.ok(!JSON.stringify(report).includes(token));assert.ok(report.limitations.some(value=>value.includes('not total run CPU')));
});
test('time conversions follow each field description and retain zero as a real measurement',async()=>{
  const {api}=apiFor({sum:'CPU time - nanoseconds',p50:'CPU time - milliseconds',p99:'CPU time - microseconds'}),input=sources();
  input[0].report.measurements[0].values['sum.cpuTime']=0;
  const report=await confirmHostedCpuUnits({api,sources:input,now,log(){},save(){}});
  assert.equal(report.samples[0].cpu[0].milliseconds,0);
  const moving=report.samples[1].cpu;
  assert.ok(Math.abs(moving.find(item=>item.className==='VerifiedRun').milliseconds-2.329987)<1e-12);
  assert.equal(moving.find(item=>item.metric==='quantiles.cpuTimeP50').milliseconds,2201);
  assert.ok(Math.abs(moving.find(item=>item.metric==='quantiles.cpuTimeP99').milliseconds-5.667)<1e-12);
});
test('absent fields/types and ambiguous descriptions retain raw values without guessing or broad discovery',async()=>{
  for(const options of [{missingType:true},{sum:'Sum of CPU time',p50:null,p99:'CPU time in milliseconds; formerly microseconds'},
    {sum:'x'.repeat(513),p50:'provider ticks',p99:'CPU time, unit unspecified'}]){
    const {api,queries}=apiFor(options);
    const report=await confirmHostedCpuUnits({api,sources:sources(),now,log(){},save(){}});
    assert.equal(report.status,'unavailable');assert.equal(queries.length,2);
    assert.ok(report.samples.every(sample=>sample.cpu.every(item=>item.milliseconds===null&&item.unit===null)));
  }
  const {api}=apiFor({sum:null});
  const report=await confirmHostedCpuUnits({api,sources:sources(),now,log(){},save(){}});
  assert.equal(report.status,'partial');assert.equal(report.samples[0].cpu.find(item=>item.className==='VerifiedRun').milliseconds,null);
  assert.equal(cpuUnitFromDescription('CPU time - µs'),'microseconds');assert.equal(cpuUnitFromDescription('CPU time - μs'),'microseconds');
  assert.equal(cpuUnitFromDescription('microseconds or nanoseconds'),null);
});
test('unavailable or invalid saved CPU samples and account mismatches stop before metadata requests',async()=>{
  for(const change of [s=>s[0].report.ranked=true,s=>s[0].report.status='incomplete',s=>s[0].report.accountId='b'.repeat(32),
    s=>s[0].report.script='other-worker',s=>s[0].report.generatedAt='2020-01-01',s=>s[0].file='../.staging-secrets.json',
    s=>s[0].report.measurements.pop(),s=>s[0].report.measurements[0].values['sum.cpuTime']=-1,
    s=>s[0].report.measurements[0].values['sum.cpuTime']=NaN,s=>s[0].report.measurements[4].values['quantiles.cpuTimeP99']=null,
    s=>s[0].report.window.to='2026-10-31T00:00:00Z',s=>s.push(s[0])]){
    const {api,queries}=apiFor(),input=sources();change(input);
    await assert.rejects(confirmHostedCpuUnits({api,sources:input,now,log(){},save(){assert.fail('No invalid conversions may be saved');}}),error=>error.code==='metrics-required');
    assert.equal(queries.length,0);
  }
});
test('unexpected type metadata fails locally and a provider rate rejection stops the second lookup',async()=>{
  for(const response of [{__type:{name:'WrongType',fields:[]}},
    {__type:{name:'AccountDurableObjectsPeriodicGroupsSum',fields:Array.from({length:129},()=>({name:'other',description:''}))}}]){
    let calls=0;const api={accountId,async graphql(){calls++;return response;}};
    await assert.rejects(confirmHostedCpuUnits({api,sources:sources(),now,log(){},save(){assert.fail('No success report');}}),error=>error.code==='invalid-response');
    assert.equal(calls,1);
  }
  let calls=0;const api={accountId,async graphql(){calls++;throw new MetricsReadError('analytics-rate-limited','Cooldown required');}};
  await assert.rejects(confirmHostedCpuUnits({api,sources:sources(),now,log(){},save(){assert.fail('No success report');}}),error=>error.code==='analytics-rate-limited');
  assert.equal(calls,1);
});
test('the shared client paces the two metadata lookups and retries only the limited query after its cooldown',async()=>{
  let time=now();const requests=[],cooldowns=[];
  const api=createMetricsApi({accountId,token,now:()=>time,sleep:async ms=>{time+=ms;},minIntervalMs:2500,
    onRateLimit:error=>cooldowns.push(error),fetchFn:async(url,options)=>{
      assert.equal(url,'https://api.cloudflare.com/client/v4/graphql');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');
      const {query}=JSON.parse(options.body);requests.push({at:time,query});
      if(requests.length===1)return Response.json({errors:[{message:'Rate limiter budget depleted. Please try again after 5 minutes.'}]});
      return Response.json({data:metadata(query)});
    }});
  const report=await confirmHostedCpuUnits({api,sources:sources(),now:()=>time,log(){},save(){}});
  assert.equal(report.status,'confirmed');assert.equal(requests.length,3);assert.equal(cooldowns.length,1);
  assert.equal(requests[0].query,requests[1].query);assert.notEqual(requests[1].query,requests[2].query);
  assert.deepEqual(requests.map(item=>item.at-now()),[0,305000,307500]);
});
