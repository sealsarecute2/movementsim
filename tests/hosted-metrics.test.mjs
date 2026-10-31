import test from 'node:test';
import assert from 'node:assert/strict';
import {lstat,readlink} from 'node:fs/promises';
import {createMetricsApi,loadMetricsIdentity,parseWranglerJson,MetricsReadError,safeMetricsDiagnostics,metricsRetryDelay,metricsCooldownUntil,validateMetricsQueryStructure} from '../verification/cloudflare-metrics-client.mjs';
import {metricWindow,discoverMetrics,buildMetricQuery,summariseMetricRows,collectHostedMetrics,unitFromDescription,METRICS_SCRIPT} from '../verification/hosted-metrics.mjs';
import {CPU_UNIT_SPECS,verifiedCpuEvidence} from '../verification/cpu-unit-evidence.mjs';

const accountId='a'.repeat(32),runNamespace='b'.repeat(32),admissionNamespace='c'.repeat(32),token='test-private-token-never-reflect-this';
const reference={generatedAt:'2026-10-30T00:38:07.823Z',mode:'private-staging',ranked:false,
  endpoint:'https://movement-lab-verifier-staging.example.workers.dev',map:'bhop-school',preset:'classic',
  replaySeconds:17.30859375,hosted:{runId:'12345678-1234-4123-8123-123456789012',reason:'completed',completed:true,invalid:null},activeAfter:0,timeDifferenceSeconds:0};
const now=()=>Date.parse('2026-10-30T00:45:00Z');
function movingReference(){
  const report={...structuredClone(reference),generatedAt:'2026-10-30T00:44:00Z',status:'passed',workload:'moving-reference',clients:8,
    peakActiveClients:8,inputTicks:4431,testStartedAt:'2026-10-30T00:37:40Z',testEndedAt:'2026-10-30T00:38:05Z',
    overlapSeconds:17,requiredOverlapSeconds:reference.replaySeconds*.75,local:{ticks:4431,time:14.711312665044947,checkpoint:3}};
  delete report.hosted;
  report.runs=Array.from({length:8},(_,index)=>({runId:'12345678-1234-4123-8123-'+String(index).padStart(12,'0'),
    reason:'completed',completed:true,invalid:null,ranked:false,ticks:4431,time:report.local.time,checkpoint:3,timeDifferenceSeconds:0}));
  return report;
}
function sustainedReference(){
  const first=movingReference(),base=Date.parse('2026-10-30T00:37:40Z');
  const report={...first,workload:'sustained-moving-reference',roundCount:10,completedRounds:10,plannedRuns:80,totalRuns:80,maxWorkloadMs:720000,
    file:'fixture.json',sha256:'e'.repeat(64),revision:1,roundIntervalMs:30000,roundStartOffsetsMs:Array.from({length:10},(_,index)=>index*30000),
    elapsedSeconds:296,totalStateComparisons:6800,totalEightClientOverlapSeconds:170,plannedInputPlayerSeconds:80*first.replaySeconds};
  report.rounds=Array.from({length:10},(_,index)=>{
    const round={...structuredClone(first),file:report.file,sha256:report.sha256,revision:1,
      testStartedAt:new Date(base+index*30000).toISOString(),testEndedAt:new Date(base+index*30000+25000).toISOString(),
      generatedAt:new Date(base+index*30000+26000).toISOString()};
    round.runs.forEach((run,slot)=>{run.runId='12345678-1234-4123-8123-'+String(index*8+slot).padStart(12,'0');run.stateComparisons=85;});
    return round;
  });
  delete report.runs;report.testStartedAt=report.rounds[0].testStartedAt;report.testEndedAt=report.rounds.at(-1).testEndedAt;
  return report;
}
function cpuEvidence(){return {generatedAt:new Date(now()).toISOString(),status:'confirmed',source:'live-provider-schema',mode:'private-staging',ranked:false,script:METRICS_SCRIPT,
  evidence:CPU_UNIT_SPECS.flatMap(spec=>spec.fields.map(field=>({dataset:spec.dataset,typeName:spec.typeName,field,metric:spec.group+'.'+field,unit:'microseconds',description:'CPU time - microseconds'})))};}
const field=(name,description='',type)=>({name,description,...(type?{type:{name:type,kind:'OBJECT'}}:{})});
function schemaApi({missingField,pending=false,resourceErrors=false,unit='microseconds',queryType='Query',viewerType='viewer',accountType='account'}={}){
  const calls=[];
  const schemas={
    [queryType]:{name:queryType,fields:[field('viewer','',viewerType)]},
    [viewerType]:{fields:[{name:'accounts',type:{kind:'NON_NULL',ofType:{kind:'LIST',ofType:{kind:'NON_NULL',ofType:{kind:'OBJECT',name:accountType}}}}}]},
    [accountType]:{fields:[
    {name:'durableObjectsPeriodicGroups',type:{kind:'LIST',ofType:{name:'Periodic',kind:'OBJECT'}},args:[{name:'filter',type:{name:'PeriodicFilter'}}]},
    {name:'durableObjectsInvocationsAdaptiveGroups',type:{name:'Invocations'},args:[{name:'filter',type:{name:'InvocationsFilter'}}]},
    {name:'workersInvocationsAdaptive',type:{name:'Workers'},args:[{name:'filter',type:{name:'WorkersFilter'}}]},
  ]},Periodic:{fields:[field('sum','','PeriodicSum'),field('max','','PeriodicMax'),field('quantiles','','PeriodicQuantiles')]},
    Invocations:{fields:[field('sum','','InvocationSum'),field('quantiles','','InvocationQuantiles')]},
    Workers:{fields:[field('sum','','WorkerSum'),field('quantiles','','WorkerQuantiles')]},
    PeriodicFilter:{inputFields:['datetime_geq','datetime_lt','namespaceId'].map(name=>({name}))},
    InvocationsFilter:{inputFields:['datetime_geq','datetime_lt','namespaceId'].map(name=>({name}))},
    WorkersFilter:{inputFields:['datetime_geq','datetime_lt','scriptName'].map(name=>({name}))},
    PeriodicSum:{fields:[field('cpuTime','Sum of CPU time - '+unit),field('activeTime','Sum of active time - microseconds'),field('duration','Sum of Duration - GB*s'),
      ...['exceededCpuErrors','exceededMemoryErrors','fatalInternalErrors','inboundWebsocketMsgCount','outboundWebsocketMsgCount','rowsRead','rowsWritten'].map(name=>field(name))]},
    PeriodicMax:{fields:[field('memoryUsageBytes','Maximum isolate memory - bytes'),field('activeWebsocketConnections')]},
    PeriodicQuantiles:{fields:[field('memoryUsageBytesP50','Isolate memory - bytes'),field('memoryUsageBytesP99','Isolate memory - bytes')]},
    InvocationSum:{fields:[field('requests'),field('errors')]},InvocationQuantiles:{fields:[field('cpuTimeP50','CPU time - microseconds'),field('cpuTimeP99','CPU time - microseconds'),field('wallTimeP99','Wall time - microseconds')]},
    WorkerSum:{fields:[field('requests'),field('errors'),field('subrequests'),field('cpuTimeUs','CPU time - microseconds')]},
    WorkerQuantiles:{fields:[field('cpuTimeP50','CPU time - microseconds'),field('cpuTimeP99','CPU time - microseconds'),field('wallTimeP99','Wall time - microseconds'),field('memoryUsageBytesP50','Memory - bytes'),field('memoryUsageBytesP99','Memory - bytes')]},
  };
  if(missingField)for(const type of Object.values(schemas))if(type.fields)type.fields=type.fields.filter(value=>value.name!==missingField);
  const api={accountId,async namespaces(){calls.push('namespaces');return [
    {id:runNamespace,script:METRICS_SCRIPT,class:'VerifiedRun'},
    {id:admissionNamespace,script:METRICS_SCRIPT,class:'AdmissionCoordinator'},
    {id:'d'.repeat(32),script:'other-worker',class:'VerifiedRun'},
  ];},async graphql(query){
    validateMetricsQueryStructure(query);
    calls.push(query);
    if(query.includes('__schema')){
      assert.equal(query,'query VerifierMetricsRootSchema { __schema { queryType { name } } }');
      return {__schema:{queryType:{name:queryType}}};
    }
    if(query.includes('__type')){
      assert.equal([...query.matchAll(/\b__type\(/g)].length,1,'Read one type per request');
      assert.ok(!/\w+:\s*__type/.test(query),'Use the documented unaliased form');
      const name=query.match(/__type\(name:"(\w+)"\)/)?.[1];return {__type:schemas[name]||null};
    }
    const periodic=query.includes('rows:durableObjectsPeriodicGroups');
    return {viewer:{accounts:[{rows:pending?[]:periodic?[{sum:{cpuTime:125000,activeTime:20000000,duration:2.5,
      exceededCpuErrors:resourceErrors?1:0,exceededMemoryErrors:0,fatalInternalErrors:0,inboundWebsocketMsgCount:277,outboundWebsocketMsgCount:85,rowsRead:3,rowsWritten:5},
      max:{memoryUsageBytes:64*1048576,activeWebsocketConnections:1},quantiles:{memoryUsageBytesP50:32*1048576,memoryUsageBytesP99:48*1048576}}]:[
        {sum:{requests:10,errors:0,subrequests:8,cpuTimeUs:500},quantiles:{cpuTimeP50:25,cpuTimeP99:50,wallTimeP99:20000000,memoryUsageBytesP50:32*1048576,memoryUsageBytesP99:48*1048576}},
      ]}]}};
  }};
  return {api,calls,schemas};
}
test('metrics window is a bounded context around a passing private reference; no additional runs start',()=>{
  const window=metricWindow(reference,now());assert.deepEqual(window,{from:'2026-10-30T00:36:00.000Z',to:'2026-10-30T00:40:00.000Z'});
  for(const change of [r=>r.ranked=true,r=>r.timeDifferenceSeconds=1,r=>r.activeAfter=1,r=>r.hosted.completed=false,r=>r.hosted.invalid='respawn',r=>r.replaySeconds=9999,r=>r.endpoint='https://other.example',r=>r.generatedAt='2020-01-01',r=>r.generatedAt='2099-01-01']){
    const altered=structuredClone(reference);change(altered);assert.throws(()=>metricWindow(altered,now()),/recent passing/);
  }
});
test('moving metrics use the actual eight-client test window and reject incomplete or inconsistent reports before any requests',async()=>{
  const reference=movingReference();
  assert.deepEqual(metricWindow(reference,now()),{from:'2026-10-30T00:36:00.000Z',to:'2026-10-30T00:40:00.000Z'});
  for(const change of [r=>r.status='failed',r=>r.clients=7,r=>r.peakActiveClients=7,r=>r.overlapSeconds=1,
    r=>r.requiredOverlapSeconds=0,r=>r.activeAfter=1,r=>r.runs.pop(),r=>r.runs[0].timeDifferenceSeconds=.001,
    r=>r.runs[0].time+=1,r=>r.runs[0].completed=false,r=>r.runs[0].ranked=true,r=>r.runs[0].ticks--,
    r=>r.runs[0].checkpoint--,r=>r.runs[0].runId=r.runs[1].runId,r=>r.testStartedAt='2020-01-01',
    r=>r.testEndedAt='2026-10-30T00:39:50Z',r=>r.replaySeconds=120,r=>r.local.ticks--]){
    const altered=structuredClone(reference);change(altered);const {api,calls}=schemaApi();
    await assert.rejects(collectHostedMetrics({api,reference:altered,now,log(){},save(){assert.fail('No invalid report may be saved');}}),error=>error.code==='reference-required');
    assert.equal(calls.length,0);
  }
});
test('moving collection retains eight run IDs and labels its separate output without extra schema queries',async()=>{
  const {api,calls}=schemaApi(),logs=[];let saved;
  const report=await collectHostedMetrics({api,reference:movingReference(),now,log:value=>logs.push(value),save:value=>{saved=value;}});
  assert.equal(saved,report);assert.equal(report.status,'collected');assert.equal(report.reference.clients,8);
  assert.equal(report.reference.workload,'moving-reference');assert.equal(report.reference.runIds.length,8);
  assert.equal(calls.filter(value=>value.startsWith('query ')).length,5);assert.ok(!calls.some(value=>/__type|__schema/.test(value)));
  assert.ok(logs.some(value=>value.includes('Saved hosted-moving-metrics-results.json')));
  assert.ok(report.limitations.some(value=>value.includes('do not establish sustained')));
});
test('sustained metrics validate all ten rounds and use the full test window for exactly five queries',async()=>{
  const reference=sustainedReference(),{api,calls}=schemaApi(),logs=[];
  const expectedWindow={from:'2026-10-30T00:36:00.000Z',to:'2026-10-30T00:44:00.000Z'};
  assert.deepEqual(metricWindow(reference,now()),expectedWindow);
  const report=await collectHostedMetrics({api,reference,now,cpuEvidence:cpuEvidence(),log:value=>logs.push(value),save(){}});
  assert.equal(report.status,'collected');assert.equal(report.reference.rounds,10);assert.equal(report.reference.runIds.length,80);
  assert.deepEqual(report.window,expectedWindow);assert.equal(calls.filter(value=>value.startsWith('query ')).length,5);
  assert.ok(!calls.some(value=>/__type|__schema/.test(value)));assert.ok(logs.some(value=>value.includes('Saved hosted-sustained-metrics-results.json')));
  assert.ok(report.limitations.some(value=>value.includes('cooldown gaps')));
  const run=report.measurements.find(value=>value.className==='VerifiedRun'&&value.dataset==='durableObjectsPeriodicGroups');
  assert.equal(run.derived['sum.cpuTimeMs'],125);assert.equal(run.units['sum.cpuTime'],'microseconds');
  assert.equal(report.cpuUnitsEvidence.source,'live-provider-schema');assert.ok(logs.some(value=>value.includes('no additional schema requests')));
});
test('partial, unpaced, inconsistent or reused sustained runs are rejected before analytics reads',async()=>{
  for(const change of [r=>r.status='running',r=>r.completedRounds=9,r=>r.rounds.pop(),r=>r.rounds[0]=null,
    r=>r.roundStartOffsetsMs[1]=29999,r=>r.roundIntervalMs=1000,r=>r.activeAfter=1,r=>r.totalRuns=79,
    r=>r.rounds[2].activeAfter=1,r=>r.rounds[2].runs[0].timeDifferenceSeconds=.01,
    r=>r.rounds[1].runs[0].runId=r.rounds[0].runs[0].runId,r=>r.rounds[2].sha256='0'.repeat(64),
    r=>r.local.time+=1,r=>r.totalStateComparisons--,r=>r.totalEightClientOverlapSeconds=NaN,
    r=>r.elapsedSeconds=100,r=>r.maxWorkloadMs=999999,r=>r.rounds[2].testStartedAt=r.rounds[0].testStartedAt]){
    const reference=sustainedReference(),{api,calls}=schemaApi();change(reference);
    await assert.rejects(collectHostedMetrics({api,reference,now,log(){},save(){assert.fail('No partial pass');}}),error=>error.code==='reference-required');
    assert.equal(calls.length,0);
  }
});
test('CPU unit reuse rejects stale or incomplete evidence without additional requests or guessed conversions',async()=>{
  assert.ok(verifiedCpuEvidence(cpuEvidence(),{now:now(),script:METRICS_SCRIPT}));
  for(const change of [e=>e.status='partial',e=>e.generatedAt='2020-01-01',e=>e.generatedAt='2099-01-01',e=>e.script='other-worker',
    e=>e.evidence.pop(),e=>e.evidence[0].typeName='OtherType',e=>e.evidence[0].description='microseconds or nanoseconds',
    e=>e.evidence[0].unit='milliseconds',e=>e.ranked=true]){
    const evidence=cpuEvidence();change(evidence);const {api,calls}=schemaApi();
    assert.equal(verifiedCpuEvidence(evidence,{now:now(),script:METRICS_SCRIPT}),null);
    const report=await collectHostedMetrics({api,reference:movingReference(),now,cpuEvidence:evidence,log(){},save(){}});
    const run=report.measurements.find(value=>value.className==='VerifiedRun'&&value.dataset==='durableObjectsPeriodicGroups');
    assert.equal(run.derived['sum.cpuTimeMs'],undefined);assert.equal(run.units['sum.cpuTime'],'provider-unit-unspecified');
    assert.equal(report.cpuUnitsEvidence,undefined);assert.equal(calls.filter(value=>value.startsWith('query ')).length,5);
  }
});
test('the rejected account query is stopped locally before cooldowns or a Cloudflare request',async()=>{
  const rejected='query VerifierMetricsTypeSchema { __type(name:"account") { name fields { name type { name ofType { name ofType { name ofType { name } } } } args { name type { name ofType { name ofType { name } } } } } } } }';
  assert.throws(()=>validateMetricsQueryStructure(rejected),/mismatched delimiters/);
  const api=createMetricsApi({accountId,token,initialCooldownUntil:Date.now()+300000,
    sleep:async()=>assert.fail('Malformed queries must fail before a wait'),fetchFn:async()=>assert.fail('Malformed queries must not reach Cloudflare')});
  await assert.rejects(api.graphql(rejected),error=>error.code==='invalid-request');
  for(const valid of ['query Q { field(arg:"escaped \\" and }]) text") }',
    'query Q { field(arg:{nested:["}","("]}) { name } }',
    'query Q { # ignored }])\n field }'])assert.doesNotThrow(()=>validateMetricsQueryStructure(valid));
  for(const invalid of ['query Q { field ) }','query Q { field','query Q { field(arg:"unfinished) }'])assert.throws(()=>validateMetricsQueryStructure(invalid));
});
test('schema-driven read-only queries isolate the staging namespaces and convert only described units',async()=>{
  const {api,calls}=schemaApi();let saved;
  const report=await collectHostedMetrics({api,reference,now,schemaMode:'discover',log(){},save:value=>{saved=value;}});
  assert.equal(saved,report);assert.equal(report.status,'collected');assert.equal(report.ranked,false);
  assert.deepEqual(report.schemaTypes,{query:'Query',viewer:'viewer',account:'account'});
  assert.equal(report.measurements.length,5);assert.equal(report.issues.length,0);
  const run=report.measurements.find(value=>value.className==='VerifiedRun'&&value.dataset==='durableObjectsPeriodicGroups');
  assert.equal(run.derived['sum.cpuTimeMs'],125);assert.equal(run.derived['quantiles.memoryUsageBytesP99MiB'],48);
  assert.equal(run.scope,'namespace-window');assert.ok(report.limitations.some(value=>value.includes('not per-player')));
  for(const query of calls.filter(value=>value.startsWith('query VerifierMetricsRead'))){
    assert.ok(query.includes('limit:1'));assert.ok(query.includes('datetime_geq:'));assert.ok(query.includes('datetime_lt:'));
    assert.ok(query.includes(runNamespace)||query.includes(admissionNamespace)||query.includes(METRICS_SCRIPT));
    assert.ok(!query.includes('other-worker'));assert.ok(!query.includes('mutation'));assert.ok(!query.includes(reference.hosted.runId));
  }
});
test('the default reader skips introspection and uses exactly five small, scoped metrics queries',async()=>{
  const {api,calls}=schemaApi(),read=api.graphql,logs=[];let saved;
  api.graphql=async query=>{
    assert.ok(!/__schema|__type/.test(query),'Normal collection must never discover the schema');
    assert.ok(query.length<750,'Each query stays small');
    return read(query);
  };
  const report=await collectHostedMetrics({api,reference,now,log:value=>logs.push(value),save:value=>{saved=value;}});
  assert.equal(saved,report);assert.equal(report.status,'collected');assert.equal(report.schemaSource,'provider-documentation');
  assert.equal(report.schemaTypes,null);assert.equal(report.measurements.length,5);
  const queries=calls.filter(value=>value.startsWith('query '));assert.equal(queries.length,5);
  for(const query of queries){
    assert.ok(query.includes('limit:1'));assert.ok(query.includes('datetime_geq:'));assert.ok(query.includes('datetime_lt:'));
    assert.ok(query.includes('accountTag:"'+accountId+'"'));
    assert.ok(query.includes('namespaceId:"'+runNamespace+'"')||query.includes('namespaceId:"'+admissionNamespace+'"')||query.includes('scriptName:"'+METRICS_SCRIPT+'"'));
  }
  const run=report.measurements.find(value=>value.className==='VerifiedRun'&&value.dataset==='durableObjectsPeriodicGroups');
  assert.equal(run.derived['quantiles.memoryUsageBytesP99MiB'],48);
  assert.equal(run.values['sum.cpuTime'],125000);assert.equal(run.units['sum.cpuTime'],'provider-unit-unspecified');
  assert.equal(run.derived['sum.cpuTimeMs'],undefined);assert.equal(run.values['sum.exceededCpuErrors'],undefined);
  assert.ok(logs.some(value=>value.includes('125000 (provider unit unspecified')));
  assert.ok(report.limitations.some(value=>value.includes('absence does not mean zero errors')));
});
test('small queries retain missing data and provider failures without expanding into schema discovery',async()=>{
  const pending=await collectHostedMetrics({api:schemaApi({pending:true}).api,reference,now,log(){},save(){}});
  assert.equal(pending.status,'incomplete');assert.ok(pending.measurements.every(value=>value.values===null));
  const {api,calls}=schemaApi(),read=api.graphql;
  api.graphql=async query=>{
    if(query.includes('durableObjectsPeriodicGroups')){calls.push(query);throw new MetricsReadError('query-unavailable','Unsupported field.');}
    return read(query);
  };
  const unavailable=await collectHostedMetrics({api,reference,now,log(){},save(){}});
  assert.equal(unavailable.status,'incomplete');assert.equal(calls.filter(value=>value.startsWith('query ')).length,5);
  assert.ok(!calls.some(value=>/__schema|__type/.test(value)));
  assert.equal(unavailable.measurements.filter(value=>value.status==='unavailable').length,2);
  const errorSource=schemaApi(),errorRead=errorSource.api.graphql;
  errorSource.api.graphql=async query=>{
    const data=await errorRead(query);
    if(query.includes('workersInvocationsAdaptive'))data.viewer.accounts[0].rows[0].sum.errors=2;
    return data;
  };
  const failed=await collectHostedMetrics({api:errorSource.api,reference,now,log(){},save(){}});
  assert.equal(failed.status,'review-needed');assert.equal(failed.issues[0].value,2);
  await assert.rejects(collectHostedMetrics({api,reference,now,schemaMode:'unknown',log(){},save(){}}),error=>error.code==='invalid-request');
});
test('missing data stays pending, unsupported fields stay unavailable, and resource errors require review',async()=>{
  const pending=await collectHostedMetrics({api:schemaApi({pending:true}).api,reference,now,schemaMode:'discover',log(){},save(){}});
  assert.equal(pending.status,'incomplete');assert.ok(pending.measurements.every(value=>value.values===null&&value.status==='pending'));
  const unavailable=await collectHostedMetrics({api:schemaApi({missingField:'cpuTime'}).api,reference,now,schemaMode:'discover',log(){},save(){}});
  assert.equal(unavailable.status,'incomplete');assert.ok(unavailable.measurements.every(value=>!Object.hasOwn(value.derived,'sum.cpuTimeMs')));
  const errors=await collectHostedMetrics({api:schemaApi({resourceErrors:true}).api,reference,now,schemaMode:'discover',log(){},save(){}});
  assert.equal(errors.status,'review-needed');assert.ok(errors.issues.some(value=>value.metric==='sum.exceededCpuErrors'&&value.value===1));
});
test('schema evolution cannot broaden filters or guess CPU units',async()=>{
  const {api}=schemaApi({unit:'unspecified provider units'}),{datasets:descriptors}=await discoverMetrics(api);
  const descriptor=descriptors[0],window=metricWindow(reference,now());
  assert.equal(buildMetricQuery({accountId,descriptor:{...descriptor,filters:new Set(['datetime_geq','datetime_lt'])},window,namespaceId:runNamespace}),null);
  assert.equal(buildMetricQuery({accountId,descriptor,window,namespaceId:'bad namespace'}),null);
  const summary=summariseMetricRows([{sum:{cpuTime:125000}}],descriptor);
  assert.equal(summary.values['sum.cpuTime'],125000);assert.equal(summary.derived['sum.cpuTimeMs'],undefined);
  assert.equal(unitFromDescription('Memory - bytes'),'bytes');assert.equal(unitFromDescription('CPU time - nanoseconds'),'nanoseconds');
  assert.equal(unitFromDescription('Duration - GB*s'),'GB-seconds');
  assert.throws(()=>summariseMetricRows([{sum:{cpuTime:NaN}}],descriptor),/invalid numeric/);
  assert.throws(()=>summariseMetricRows(undefined,descriptor),/missing its rows/);
});
test('type discovery follows the GraphQL root with exact casing instead of assuming Account exists',async()=>{
  for(const names of [{queryType:'Query',viewerType:'viewer',accountType:'account'},
    {queryType:'AnalyticsRoot',viewerType:'AuthenticatedViewer',accountType:'AccountScope'}]){
    const {api,calls,schemas}=schemaApi(names);
    assert.equal(schemas.Account,undefined,'The old guessed type is deliberately absent');
    const discovery=await discoverMetrics(api);
    assert.equal(discovery.scopeTypes.account,names.accountType);assert.equal(discovery.datasets.length,3);
    assert.ok(calls.some(query=>query.includes('__schema')));
    assert.ok(calls.some(query=>query.includes('__type(name:'+JSON.stringify(names.viewerType)+')')));
    assert.ok(calls.some(query=>query.includes('__type(name:'+JSON.stringify(names.accountType)+')')));
    assert.ok(!calls.some(query=>query.includes('__type(name:"Account")')));
  }
});
test('missing root, viewer and account schema nodes fail at an identified stage without guessing names',async()=>{
  for(const stage of ['query-root','viewer-accounts','account-datasets']){
    const {api}=schemaApi(),original=api.graphql;
    api.graphql=async query=>{
      if(stage==='query-root'&&query.includes('__schema'))return {__schema:null};
      if(stage==='viewer-accounts'&&query.includes('__type(name:"viewer")'))return {__type:null};
      if(stage==='account-datasets'&&query.includes('__type(name:"account")'))return {__type:null};
      return original(query);
    };
    await assert.rejects(discoverMetrics(api),error=>error.code==='schema-unavailable'&&error.stage===stage);
  }
});
test('type discovery identifies provider rejections at the failed type and reads each type once',async()=>{
  const {api,calls}=schemaApi(),original=api.graphql;
  api.graphql=async query=>{
    if(query.includes('__type(name:"PeriodicSum")'))throw new MetricsReadError('query-unavailable','Provider rejected the request.','operation-name');
    return original(query);
  };
  await assert.rejects(discoverMetrics(api),error=>error.code==='query-unavailable'&&error.stage==='aggregate:PeriodicSum');
  assert.equal(calls.filter(query=>query.includes('__type(name:"Periodic")')).length,1);
});
test('namespace ambiguity and invalid references stop before reading any account-wide metrics',async()=>{
  const {api,calls}=schemaApi();api.namespaces=async()=>[];
  await assert.rejects(collectHostedMetrics({api,reference,now,log(){}}),/not found uniquely/);assert.equal(calls.length,0);
  await assert.rejects(collectHostedMetrics({api,reference:{...reference,ranked:true},now,log(){}}),/recent passing/);assert.equal(calls.length,0);
});
test('credential subprocess output is captured and its debug log is discarded',async()=>{
  const commands=[];let logFile;
  const identity=await loadMetricsIdentity({env:{PATH:'/example'},run:async(executable,args,options)=>{
    commands.push(args);assert.ok(!args.includes(token));assert.equal(executable,process.execPath);assert.equal(options.timeout,30000);
    assert.equal(options.env.WRANGLER_LOG,'none');assert.equal(options.env.WRANGLER_SEND_METRICS,'false');
    assert.equal(options.env.WRANGLER_WRITE_LOGS,'false');
    logFile=options.env.WRANGLER_LOG_PATH;assert.equal(await readlink(logFile),'/dev/null');
    return {stdout:args[1]==='auth'?'Proxy notice\n'+JSON.stringify({type:'oauth',token}):JSON.stringify({loggedIn:true,email:'private@example.com',accounts:[{id:accountId}]})};
  }});
  assert.deepEqual(identity,{accountId,token});assert.equal(commands.length,2);await assert.rejects(lstat(logFile),{code:'ENOENT'});
});
test('authentication failures and ambiguous accounts do not expose captured credentials',async()=>{
  for(const run of [async()=>{throw Error(token);},async()=>({stdout:'not valid JSON '+token}),async()=>({stdout:JSON.stringify({type:'api_key',key:token,email:'private@example.com'})})]){
    await assert.rejects(loadMetricsIdentity({env:{},run}),error=>!error.message.includes(token)&&!error.message.includes('private@example.com'));
  }
  let calls=0;
  await assert.rejects(loadMetricsIdentity({env:{},run:async()=>({stdout:JSON.stringify(++calls===1?{type:'oauth',token}:{loggedIn:true,accounts:[{id:accountId},{id:runNamespace}]})})}),/More than one account/);
});
test('metrics requests only use fixed HTTPS endpoints, retain TLS, refuse redirects and never echo provider errors',async()=>{
  const requests=[];const api=createMetricsApi({accountId,token,fetchFn:async(url,options)=>{
    requests.push({url,options});return Response.json(url.endsWith('/graphql')?{data:{value:1}}:{success:true,result:[]});
  }});
  assert.deepEqual(await api.namespaces(),[]);assert.deepEqual(await api.graphql('query Test { value }'),{value:1});
  for(const {url,options} of requests){assert.ok(url.startsWith('https://api.cloudflare.com/client/v4/'));assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,'Bearer '+token);assert.equal(options.rejectUnauthorized,undefined);assert.equal(options.dispatcher,undefined);}
  await assert.rejects(api.graphql('mutation Change { deleteAll }'),/read-only/);assert.equal(requests.length,2);
  await assert.rejects(api.graphql('query Safe { value } mutation Change { deleteAll }'),/read-only/);assert.equal(requests.length,2);
  for(const response of [Response.json({errors:[{message:'not authorized '+token}]}),Response.json({errors:[{message:token}]}),new Response('secret '+token,{status:403})]){
    const rejected=createMetricsApi({accountId,token,fetchFn:async()=>response});
    await assert.rejects(rejected.graphql('query Test { value }'),error=>error instanceof MetricsReadError&&!error.message.includes(token));
  }
  const network=createMetricsApi({accountId,token,fetchFn:async()=>{throw Error(token);}});
  await assert.rejects(network.graphql('query Test { value }'),error=>error.code==='network-unavailable'&&!error.message.includes(token));
  assert.throws(()=>parseWranglerJson('invalid '+token),error=>!error.message.includes(token));
});
test('provider rejection diagnostics retain the reason and operation while redacting credentials and identifiers',async()=>{
  const message='unknown field "fields" on queryType; Bearer '+token+'; account '+accountId+'; https://example.com/?ticket=private; private@example.com; 192.0.2.4';
  for(const status of [200,400]){
    const api=createMetricsApi({accountId,token,fetchFn:async()=>Response.json({errors:[{message,code:1234}]},{status})});
    await assert.rejects(api.graphql('query VerifierMetricsRootSchema { __schema { queryType { name } } }'),error=>{
      assert.equal(error.stage,'VerifierMetricsRootSchema');assert.equal(error.httpStatus,status);
      assert.equal(error.diagnostics[0].code,1234);assert.match(error.diagnostics[0].message,/unknown field/);
      for(const secret of [token,accountId,'private@example.com','192.0.2.4','ticket=private'])assert.ok(!JSON.stringify(error.diagnostics).includes(secret));
      assert.ok(!error.message.includes(token));return true;
    });
  }
  const diagnostics=safeMetricsDiagnostics(Array.from({length:5},()=>({message:'x'.repeat(800)+'\u001b[31m'+token})),{token,accountId});
  assert.equal(diagnostics.length,3);assert.equal(diagnostics[0].message.length,400);
  const denied=createMetricsApi({accountId,token,fetchFn:async()=>Response.json({errors:[{message:'does not have access to the path'}]})});
  await assert.rejects(denied.graphql('query Test { value }'),error=>error.code==='analytics-access-required');
});
test('GraphQL rate-limit errors in HTTP 200 and HTTP 429 wait for the provider cooldown, then retry once',async()=>{
  for(const status of [200,429]){
    let time=0;const requests=[],sleeps=[],events=[],logs=[];
    const api=createMetricsApi({accountId,token,now:()=>time,sleep:async ms=>{sleeps.push(ms);time+=ms;},log:value=>logs.push(value),onRateLimit:error=>events.push(error),
      fetchFn:async()=>{requests.push(time);return requests.length===1?Response.json({errors:[{message:'Rate limiter budget depleted. Please try again after 5 minutes.'}]},{status}):Response.json({data:{value:1}});}});
    assert.deepEqual(await api.graphql('query Test { value }'),{value:1});
    assert.deepEqual(requests,[0,305000]);assert.ok(sleeps.every(ms=>ms<=30000));assert.equal(events.length,1);
    assert.equal(events[0].code,'analytics-rate-limited');assert.equal(events[0].retryAt,305000);
    assert.ok(logs.some(message=>message.includes('Terminal open')));
  }
});
test('the shared retry budget ends repeated rate limits without a request loop',async()=>{
  let time=0,calls=0;
  const api=createMetricsApi({accountId,token,now:()=>time,sleep:async ms=>{time+=ms;},fetchFn:async()=>{
    calls++;return Response.json({errors:[{message:'Rate limiter budget depleted. Please try again after 5 minutes.'}]});
  }});
  await assert.rejects(api.graphql('query Test { value }'),error=>error.code==='analytics-rate-limited'&&error.retryAt===610000);
  assert.equal(calls,2);assert.equal(time,305000);
});
test('cooldowns honour Retry-After and persisted deadlines; request pacing prevents bursts',async()=>{
  assert.equal(metricsRetryDelay(new Headers(), 'Please try again after 5 minutes.',0),305000);
  assert.equal(metricsRetryDelay(new Headers({'retry-after':'600'}), 'Please try again after 5 minutes.',0),605000);
  assert.equal(metricsRetryDelay(new Headers({'retry-after':new Date(120000).toUTCString()}),'',0),125000);
  assert.equal(metricsCooldownUntil({reason:'query-unavailable',generatedAt:new Date(0).toISOString(),diagnostics:[{message:'Rate limiter budget depleted'}]},100000),305000);
  assert.equal(metricsCooldownUntil({reason:'analytics-rate-limited',retryAt:900000},100000),900000);
  assert.equal(metricsCooldownUntil({reason:'analytics-rate-limited',retryAt:100000},200000),0);
  let time=0;const requests=[];
  const api=createMetricsApi({accountId,token,now:()=>time,sleep:async ms=>{time+=ms;},minIntervalMs:1250,initialCooldownUntil:60000,
    fetchFn:async()=>{requests.push(time);return Response.json({data:{value:1}});}});
  await api.graphql('query First { value }');await api.graphql('query Second { value }');
  assert.deepEqual(requests,[60000,61250]);
  const blocked=createMetricsApi({accountId,token,now:()=>0,initialCooldownUntil:900000,fetchFn:async()=>assert.fail('No request before the cooldown')});
  await assert.rejects(blocked.graphql('query Test { value }'),error=>error.code==='analytics-rate-limited'&&error.retryAt===900000);
});
test('a schema rate limit resumes the failed lookup without repeating successful discovery requests',async()=>{
  const source=schemaApi(),calls=[];let time=0,limited=false;
  const api=createMetricsApi({accountId,token,now:()=>time,sleep:async ms=>{time+=ms;},fetchFn:async(_url,options)=>{
    const {query}=JSON.parse(options.body);calls.push(query);
    if(query.includes('__type(name:"account")')&&!limited){limited=true;return Response.json({errors:[{message:'Rate limiter budget depleted. Please try again after 5 minutes.'}]});}
    return Response.json({data:await source.api.graphql(query)});
  }});
  const discovery=await discoverMetrics(api);assert.equal(discovery.datasets.length,3);
  assert.equal(calls.filter(query=>query.includes('__schema')).length,1);
  assert.equal(calls.filter(query=>query.includes('__type(name:"Query")')).length,1);
  assert.equal(calls.filter(query=>query.includes('__type(name:"viewer")')).length,1);
  const accountQueries=calls.filter(query=>query.includes('__type(name:"account")'));
  assert.equal(accountQueries.length,2);assert.equal(accountQueries[0],accountQueries[1]);
  assert.ok(!accountQueries[0].includes('description'));assert.ok(!accountQueries[0].includes('inputFields'));
  assert.equal(time,305000);
});
test('a quota failure during measurement collection stops further queries',async()=>{
  const source=schemaApi(),original=source.api.graphql;let reads=0;
  source.api.graphql=async query=>{
    if(query.startsWith('query VerifierMetricsRead')){reads++;throw new MetricsReadError('analytics-rate-limited','Cooldown required');}
    return original(query);
  };
  await assert.rejects(collectHostedMetrics({api:source.api,reference,now,log(){},save(){assert.fail('No success result');}}),error=>error.code==='analytics-rate-limited');
  assert.equal(reads,1);
});
