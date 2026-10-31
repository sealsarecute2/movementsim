import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {loadMetricsIdentity,createMetricsApi,MetricsReadError,metricsCooldownUntil,validateMetricsQueryStructure} from './cloudflare-metrics-client.mjs';
import {verifiedCpuEvidence,CPU_UNIT_DIVISORS} from './cpu-unit-evidence.mjs';

export const METRICS_SCRIPT='movement-lab-verifier-staging';
export const metricsResultName=reference=>reference?.workload==='sustained-moving-reference'?'hosted-sustained-metrics-results.json':reference?.workload==='moving-reference'?'hosted-moving-metrics-results.json':'hosted-metrics-results.json';
const datasets=['durableObjectsPeriodicGroups','durableObjectsInvocationsAdaptiveGroups','workersInvocationsAdaptive'];
const desired={
  durableObjectsPeriodicGroups:{sum:['cpuTime','activeTime','duration','exceededCpuErrors','exceededMemoryErrors','fatalInternalErrors','inboundWebsocketMsgCount','outboundWebsocketMsgCount','rowsRead','rowsWritten'],
    max:['memoryUsageBytes','activeWebsocketConnections'],quantiles:['memoryUsageBytesP50','memoryUsageBytesP99']},
  durableObjectsInvocationsAdaptiveGroups:{sum:['requests','errors'],quantiles:['cpuTimeP50','cpuTimeP99','wallTimeP99']},
  workersInvocationsAdaptive:{sum:['requests','errors','subrequests','cpuTimeUs'],quantiles:['cpuTimeP50','cpuTimeP99','wallTimeP99','memoryUsageBytesP50','memoryUsageBytesP99']},
};
const reference='name kind ofType { name kind ofType { name kind ofType { name kind } } }';
const typeNames=depth=>depth?'name ofType { '+typeNames(depth-1)+' }':'name';
const typeName=type=>type?(type.name||typeName(type.ofType)):null;
const validName=name=>typeof name==='string'&&/^[_A-Za-z][_0-9A-Za-z]*$/.test(name);
// Keep the normal read independent of schema introspection. These small field
// sets come from the provider's Durable Objects metrics page and Workers
// metrics tutorial. A changed/unsupported field stays unavailable; we never
// retry a broader query or guess a CPU unit from a field name.
export function documentedMetrics(){
  return [
    {name:'durableObjectsPeriodicGroups',filters:new Set(['datetime_geq','datetime_lt','namespaceId']),
      selections:{sum:['cpuTime'],quantiles:['memoryUsageBytesP50','memoryUsageBytesP99']},
      units:{'sum.cpuTime':'provider-unit-unspecified','quantiles.memoryUsageBytesP50':'bytes','quantiles.memoryUsageBytesP99':'bytes'}},
    {name:'durableObjectsInvocationsAdaptiveGroups',filters:new Set(['datetime_geq','datetime_lt','namespaceId']),
      selections:{sum:['requests']},units:{'sum.requests':'count'}},
    {name:'workersInvocationsAdaptive',filters:new Set(['datetime_geq','datetime_lt','scriptName']),
      selections:{sum:['requests','errors','subrequests'],quantiles:['cpuTimeP50','cpuTimeP99']},
      units:{'sum.requests':'count','sum.errors':'count','sum.subrequests':'count',
        'quantiles.cpuTimeP50':'provider-unit-unspecified','quantiles.cpuTimeP99':'provider-unit-unspecified'}},
  ];
}
function literal(value){
  if(typeof value==='string')return JSON.stringify(value);
  if(value&&typeof value==='object'&&!Array.isArray(value))return '{'+Object.entries(value).map(([key,item])=>{
    if(!validName(key))throw Error('Invalid GraphQL filter');return key+':'+literal(item);
  }).join(',')+'}';
  throw Error('Unsupported GraphQL literal');
}
export function metricWindow(report,now=Date.now()){
  const ended=Date.parse(report.generatedAt),duration=report.replaySeconds;
  if(report.mode!=='private-staging'||report.ranked!==false||
    report.activeAfter!==0||typeof report.endpoint!=='string'||!/^https:\/\/movement-lab-verifier-staging\.[a-z0-9-]+\.workers\.dev$/.test(report.endpoint)||
    !Number.isFinite(ended)||ended>now+60000||now-ended>30*86400000||!Number.isFinite(duration)||duration<=0||duration>540)throw new MetricsReadError('reference-required','A recent passing hosted reference report is required before reading its resource metrics.');
  if(report.workload==='sustained-moving-reference'){
    const rounds=report.rounds,offsets=report.roundStartOffsetsMs,start=Date.parse(report.testStartedAt),finish=Date.parse(report.testEndedAt);
    const interval=Math.max(30000,Math.ceil(duration*1000+5000));
    const refuse=()=>{throw new MetricsReadError('reference-required','A passing ten-round sustained report with 80 matched runs, paced starts and complete cleanup is required.');};
    if(report.status!=='passed'||report.clients!==8||report.roundCount!==10||report.completedRounds!==10||report.plannedRuns!==80||report.totalRuns!==80||
      report.maxWorkloadMs!==720000||duration<1||duration>60||report.roundIntervalMs!==interval||
      !Number.isSafeInteger(report.inputTicks)||report.inputTicks/256!==duration||report.local?.ticks!==report.inputTicks||
      !Number.isFinite(report.local?.time)||report.local.time<0||!Number.isSafeInteger(report.local?.checkpoint)||
      !Number.isFinite(start)||!Number.isFinite(finish)||finish<=start||finish-start>720000||finish>ended||
      !Number.isFinite(report.elapsedSeconds)||report.elapsedSeconds<=0||report.elapsedSeconds>720||
      !Array.isArray(rounds)||rounds.length!==10||rounds.some(round=>!round||typeof round!=='object')||!Array.isArray(offsets)||offsets.length!==10||offsets[0]!==0||
      offsets.some((offset,index)=>!Number.isFinite(offset)||offset<0||(index>0&&offset-offsets[index-1]<interval))||
      report.elapsedSeconds*1000<offsets.at(-1)+duration*.75*1000||
      report.testStartedAt!==rounds[0].testStartedAt||report.testEndedAt!==rounds.at(-1).testEndedAt)refuse();
    let comparisons=0,overlap=0;const ids=new Set();
    for(let index=0;index<rounds.length;index++){
      const round=rounds[index];
      if(round?.workload!=='moving-reference'||round.endpoint!==report.endpoint||round.file!==report.file||round.sha256!==report.sha256||
        round.map!==report.map||round.revision!==report.revision||round.preset!==report.preset||round.inputTicks!==report.inputTicks||round.replaySeconds!==duration||
        round.local?.time!==report.local.time||round.local?.checkpoint!==report.local.checkpoint||
        (index>0&&Date.parse(round.testStartedAt)<Date.parse(rounds[index-1].testEndedAt))||Date.parse(round.generatedAt)>ended)refuse();
      metricWindow(round,now);overlap+=round.overlapSeconds;
      for(const run of round.runs){
        if(ids.has(run.runId)||!Number.isSafeInteger(run.stateComparisons)||run.stateComparisons<2||run.stateComparisons>3001)refuse();
        ids.add(run.runId);comparisons+=run.stateComparisons;
      }
    }
    if(ids.size!==80||report.totalStateComparisons!==comparisons||!Number.isFinite(report.totalEightClientOverlapSeconds)||Math.abs(report.totalEightClientOverlapSeconds-overlap)>1e-6||
      report.plannedInputPlayerSeconds!==80*duration)refuse();
    return {from:new Date(Math.floor((start-60000)/60000)*60000).toISOString(),to:new Date(Math.ceil((finish+60000)/60000)*60000).toISOString()};
  }
  if(report.workload==='moving-reference'){
    const startedAt=Date.parse(report.testStartedAt),endedAt=Date.parse(report.testEndedAt),runs=report.runs;
    if(report.status!=='passed'||report.clients!==8||report.peakActiveClients!==8||duration<1||duration>60||
      !Number.isFinite(startedAt)||!Number.isFinite(endedAt)||endedAt-startedAt<duration*.75*1000||endedAt-startedAt>120000||endedAt>ended||
      !Number.isFinite(report.overlapSeconds)||report.overlapSeconds<duration*.75||report.overlapSeconds>(endedAt-startedAt)/1000||
      report.requiredOverlapSeconds!==duration*.75||!Number.isSafeInteger(report.inputTicks)||report.inputTicks/256!==duration||
      !Number.isFinite(report.local?.time)||report.local.time<0||report.local?.ticks!==report.inputTicks||!Number.isSafeInteger(report.local?.checkpoint)||
      !Array.isArray(runs)||runs.length!==8||new Set(runs.map(run=>run.runId)).size!==8||
      runs.some(run=>!(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/).test(run.runId)||run.reason!=='completed'||run.completed!==true||run.invalid!==null||run.ranked!==false||
        run.timeDifferenceSeconds!==0||run.time!==report.local.time||run.ticks!==report.inputTicks||run.checkpoint!==report.local.checkpoint)){
      throw new MetricsReadError('reference-required','A recent passing eight-client moving report with matched results, overlap and cleanup is required.');
    }
    return {from:new Date(Math.floor((startedAt-60000)/60000)*60000).toISOString(),
      to:new Date(Math.ceil((endedAt+60000)/60000)*60000).toISOString()};
  }
  if(report.hosted?.reason!=='completed'||report.hosted?.completed!==true||report.hosted?.invalid!==null||report.timeDifferenceSeconds!==0)throw new MetricsReadError('reference-required','A recent passing hosted reference report is required before reading its resource metrics.');
  return {from:new Date(Math.floor((ended-duration*1000-60000)/60000)*60000).toISOString(),
    to:new Date(Math.ceil((ended+60000)/60000)*60000).toISOString()};
}
export function unitFromDescription(description=''){
  if(/microseconds|microsecond|\bµs\b/i.test(description))return 'microseconds';
  if(/nanoseconds|nanosecond/i.test(description))return 'nanoseconds';
  if(/milliseconds|millisecond/i.test(description))return 'milliseconds';
  if(/GB\s*\*?\s*s\b|GB.seconds/i.test(description))return 'GB-seconds';
  if(/\bbytes\b/i.test(description))return 'bytes';
  return 'provider-unit-unspecified';
}
export async function discoverMetrics(api,{log=()=>{}}={}){
  // Use the documented minimal __schema root and one unaliased __type at a
  // time. Cache repeated types and bound discovery instead of sending large
  // nested or multi-type introspection requests.
  const cache=new Map();
  const views={fields:`name fields { name type { ${reference} } }`,
    account:`name fields { name type { ${typeNames(3)} } args { name type { ${typeNames(2)} } } }`,
    filter:'name inputFields { name }',values:'name fields { name description }'};
  for(const view of Object.values(views))validateMetricsQueryStructure(`query VerifierMetricsTypeSchema { __type(name:"Preflight") { ${view} } }`);
  const readType=async(name,stage,view='fields')=>{
    if(!validName(name))throw new MetricsReadError('schema-unavailable','A required GraphQL type was not returned.',stage);
    if(cache.has(name))return cache.get(name);
    if(cache.size>=24)throw new MetricsReadError('schema-unavailable','Schema discovery exceeded its bounded type limit.',stage);
    log('Reading schema type '+name+'...');
    let data;
    try{data=await api.graphql(`query VerifierMetricsTypeSchema { __type(name:${JSON.stringify(name)}) { ${views[view]} } }`);}
    catch(error){if(error instanceof MetricsReadError)error.stage=stage;throw error;}
    if(!data?.__type)throw new MetricsReadError('schema-unavailable','Cloudflare did not return schema type '+name+'.',stage);
    cache.set(name,data.__type);return data.__type;
  };
  let root;
  log('Reading GraphQL query root...');
  try{root=await api.graphql('query VerifierMetricsRootSchema { __schema { queryType { name } } }');}
  catch(error){if(error instanceof MetricsReadError)error.stage='query-root';throw error;}
  const queryName=root?.__schema?.queryType?.name;
  const queryType=await readType(queryName,'query-root');
  const viewerName=typeName(queryType.fields?.find(field=>field.name==='viewer')?.type);
  const viewer=await readType(viewerName,'viewer-accounts');
  const accountName=typeName(viewer.fields?.find(field=>field.name==='accounts')?.type);
  const account=await readType(accountName,'account-datasets','account'),fields=account.fields;
  if(!Array.isArray(fields))throw new MetricsReadError('schema-unavailable','The discovered account type has no dataset fields.','account-datasets');
  const scopeTypes={query:queryName,viewer:viewerName,account:accountName},discovered=[];
  for(const name of datasets){
    const field=fields.find(field=>field.name===name),filter=field?.args?.find(argument=>argument.name==='filter');
    if(!validName(typeName(field?.type))||!validName(typeName(filter?.type)))continue;
    const node=await readType(typeName(field.type),'dataset-node:'+name);
    const filterType=await readType(typeName(filter.type),'dataset-filter:'+name,'filter');
    const selections={},units={};
    for(const group of Object.keys(desired[name])){
      const valueType=typeName(node.fields?.find(field=>field.name===group)?.type);
      if(!validName(valueType))continue;
      const values=await readType(valueType,'aggregate:'+valueType,'values'),valueFields=values.fields||[];
      const selected=desired[name][group].filter(key=>valueFields.some(field=>field.name===key));
      if(selected.length){
        selections[group]=selected;
        for(const key of selected)units[group+'.'+key]=unitFromDescription(valueFields.find(field=>field.name===key).description);
      }
    }
    discovered.push({name,filters:new Set((filterType.inputFields||[]).map(field=>field.name)),selections,units});
  }
  if(!discovered.length)throw new MetricsReadError('schema-unavailable','No supported Worker or Durable Object metrics datasets were discovered.','account-datasets');
  return {datasets:discovered,scopeTypes};
}
export function buildMetricQuery({accountId,descriptor,window,namespaceId}){
  const filter={};
  if(!descriptor.filters.has('datetime_geq')||!descriptor.filters.has('datetime_lt'))return null;
  filter.datetime_geq=window.from;filter.datetime_lt=window.to;
  if(descriptor.name==='workersInvocationsAdaptive'){
    if(!descriptor.filters.has('scriptName'))return null;filter.scriptName=METRICS_SCRIPT;
  }else{
    if(!descriptor.filters.has('namespaceId')||!/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(namespaceId))return null;filter.namespaceId=namespaceId;
  }
  const selection=Object.entries(descriptor.selections).map(([group,names])=>group+' { '+names.join(' ')+' }').join(' ');
  if(!selection)return null;
  return 'query VerifierMetricsRead { viewer { accounts(filter:{accountTag:'+literal(accountId)+'}) { rows:'+descriptor.name+'(limit:1,filter:'+literal(filter)+') { '+selection+' } } } }';
}
export function summariseMetricRows(rows,descriptor){
  if(!Array.isArray(rows))throw new MetricsReadError('invalid-response','The aggregate metrics response is missing its rows.');
  if(!rows.length)return {status:'pending',values:null,units:descriptor.units,derived:{}};
  if(rows.length!==1)throw new MetricsReadError('invalid-response','An aggregate metrics query returned unexpected groups.');
  const values={};
  for(const [group,fields] of Object.entries(descriptor.selections))for(const field of fields){
    const value=rows[0]?.[group]?.[field];
    if(value!==null&&value!==undefined&&(typeof value!=='number'||!Number.isFinite(value)||value<0))throw new MetricsReadError('invalid-response','Cloudflare returned an invalid numeric measurement.');
    values[group+'.'+field]=value??null;
  }
  const derived={};
  for(const [field,value] of Object.entries(values)){
    if(value===null)continue;
    if(/cpuTime/.test(field)){
      const divisor=CPU_UNIT_DIVISORS[descriptor.units[field]];
      if(divisor)derived[field+'Ms']=value/divisor;
    }
    if(/memoryUsageBytes/.test(field)&&descriptor.units[field]==='bytes')derived[field+'MiB']=value/1048576;
  }
  return {status:Object.values(values).some(value=>value!==null)?'available':'pending',values,units:descriptor.units,derived};
}
export async function collectHostedMetrics({api,reference,now=()=>Date.now(),log=console.log,schemaMode='documented',cpuEvidence=null,
  save=value=>writeFileSync(new URL('./'+metricsResultName(reference),import.meta.url),JSON.stringify(value,null,2)+'\n')}={}){
  if(!['documented','discover'].includes(schemaMode))throw new MetricsReadError('invalid-request','Unknown metrics schema mode.');
  const window=metricWindow(reference,now());
  log('Reading staging namespace metadata...');
  const namespaces=(await api.namespaces()).filter(item=>item.script===METRICS_SCRIPT&&['VerifiedRun','AdmissionCoordinator'].includes(item.class));
  if(namespaces.length!==2||new Set(namespaces.map(item=>item.class)).size!==2)throw new MetricsReadError('namespace-unavailable','The two staging Durable Object namespaces were not found uniquely. Check the staging account selection.');
  const discovery=schemaMode==='discover'?await discoverMetrics(api,{log}):{datasets:documentedMetrics(),scopeTypes:null};
  const descriptors=discovery.datasets,measurements=[];
  const cpuConfirmation=schemaMode==='documented'?verifiedCpuEvidence(cpuEvidence,{now:now(),script:METRICS_SCRIPT}):null;
  if(cpuConfirmation){
    for(const descriptor of descriptors)for(const key of Object.keys(descriptor.units)){
      const unit=cpuConfirmation.units[descriptor.name+'.'+key];if(unit)descriptor.units[key]=unit;
    }
    log('Reusing the recent confirmed CPU unit metadata; no additional schema requests.');
  }
  if(discovery.scopeTypes)log(`Discovered GraphQL types: ${discovery.scopeTypes.query} -> ${discovery.scopeTypes.viewer} -> ${discovery.scopeTypes.account}.`);
  else log('Reading five small metrics queries using documented fields. Schema discovery is skipped.');
  for(const dataset of datasets){
    const descriptor=descriptors.find(item=>item.name===dataset);
    for(const namespace of dataset==='workersInvocationsAdaptive'?[null]:namespaces){
      const entry={dataset,scope:namespace?'namespace-window':'worker-window',className:namespace?.class||null,namespaceId:namespace?.id||null};
      const query=descriptor&&buildMetricQuery({accountId:api.accountId,descriptor,window,namespaceId:namespace?.id});
      if(!query){measurements.push({...entry,status:'unavailable',reason:'schema-field-unavailable',values:null,derived:{}});continue;}
      log(`Reading ${namespace?.class||'Worker'} / ${dataset}...`);
      try{
        const data=await api.graphql(query),accounts=data?.viewer?.accounts;
        if(!Array.isArray(accounts)||accounts.length!==1)throw new MetricsReadError('analytics-access-required','The requested account did not return metrics. Check analytics read access.');
        measurements.push({...entry,...summariseMetricRows(accounts[0].rows,descriptor)});
      }catch(error){
        if(!(error instanceof MetricsReadError))throw error;
        if(error.code==='analytics-rate-limited')throw error;
        measurements.push({...entry,status:'unavailable',reason:error.code,stage:error.stage,diagnostics:error.diagnostics,values:null,derived:{}});
      }
    }
  }
  const run=measurements.find(item=>item.dataset==='durableObjectsPeriodicGroups'&&item.className==='VerifiedRun');
  const cpu=run?.values?.['sum.cpuTime'],memory=run?.values?.['quantiles.memoryUsageBytesP99']??run?.values?.['max.memoryUsageBytes'];
  const issues=measurements.flatMap(item=>Object.entries(item.values||{}).filter(([key,value])=>/exceededCpuErrors|exceededMemoryErrors|fatalInternalErrors|sum.errors/.test(key)&&value>0).map(([metric,value])=>({dataset:item.dataset,className:item.className,metric,value})));
  const status=issues.length?'review-needed':cpu===undefined||cpu===null||!(memory>0)||measurements.some(item=>item.status!=='available')?'incomplete':'collected';
  const report={generatedAt:new Date(now()).toISOString(),status,script:METRICS_SCRIPT,accountId:api.accountId,
    mode:'private-staging',ranked:false,reference:{generatedAt:reference.generatedAt,map:reference.map,preset:reference.preset,
      ...(reference.workload==='sustained-moving-reference'?{workload:reference.workload,clients:8,rounds:10,runIds:reference.rounds.flatMap(round=>round.runs.map(run=>run.runId))}:
        reference.workload==='moving-reference'?{workload:'moving-reference',clients:8,runIds:reference.runs.map(run=>run.runId)}:{runId:reference.hosted.runId})},window,
    schemaSource:schemaMode==='discover'?'live-introspection':'provider-documentation',schemaTypes:discovery.scopeTypes,
    ...(cpuConfirmation?{cpuUnitsEvidence:{generatedAt:cpuConfirmation.generatedAt,source:'live-provider-schema',evidence:cpuEvidence.evidence}}:{}),
    measurements,issues,dashboardUrl:`https://dash.cloudflare.com/${api.accountId}/workers/durable-objects`,
    limitations:['Aggregates cover the named namespace or Worker during a padded test window, and may include other activity.',
      'Memory samples describe the V8 isolate; several objects and the Worker may share it. These are not per-player allocations.',
      'Missing samples remain pending/unavailable, never zero. Analytics can arrive after a delay.',
      reference.workload==='sustained-moving-reference'?'Ten paced batches include cooldown gaps and repeated short sessions; they do not establish continuous full load, long individual sessions or worst-route capacity.':
        reference.workload==='moving-reference'?'Eight copies of one short route/preset do not establish sustained or worst-route capacity.':'The existing 17-second moving run is a small workload; this is not an eight-player moving-load or worst-route capacity certification.',
      'Provider analytics are operational measurements, not an exact bill or a guarantee that daily free allocations cannot be exhausted.',
      ...(schemaMode==='documented'?[
        'The small documented queries omit Durable Object resource-error counters and invocation percentiles; their absence does not mean zero errors.',
        ...(cpuConfirmation?['CPU conversions use the dated, saved live-schema confirmation. They do not establish a maximum player count or an exact bill.']:
          ['CPU units are not established by these documentation examples. Raw CPU values are retained without conversion or capacity estimates.'])]:[])]};
  await save(report);
  log(`Saved ${metricsResultName(reference)} (${status}).`);
  for(const entry of measurements){
    log(`${entry.className||'Worker'} / ${entry.dataset}: ${entry.status}`);
    for(const diagnostic of entry.diagnostics||[])log('  Provider: '+diagnostic.message);
    for(const [key,value] of Object.entries(entry.derived||{}))log(`  ${key}: ${value}`);
    for(const [key,value] of Object.entries(entry.values||{}))if(/cpuTime/.test(key)&&entry.units[key]==='provider-unit-unspecified')log(`  ${key}: ${value??'pending'} (provider unit unspecified; no conversion)`);
  }
  if(status==='incomplete')log('CPU or memory samples are missing. Wait a few minutes and rerun this reader, or use the namespace Metrics tab. This is not a failed physics test.');
  if(status==='review-needed')log('Cloudflare reported errors in this time window. Review the saved measurements before enabling public submissions.');
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2),moving=args.includes('--moving-load'),sustained=args.includes('--sustained-load');
  const outputUrl=new URL(sustained?'./hosted-sustained-metrics-results.json':moving?'./hosted-moving-metrics-results.json':'./hosted-metrics-results.json',import.meta.url);
  try{
    if(args.length>2||(moving&&sustained)||new Set(args).size!==args.length||args.some(arg=>!['--discover-schema','--moving-load','--sustained-load'].includes(arg)))throw new MetricsReadError('invalid-request','Usage: node hosted-metrics.mjs [--moving-load | --sustained-load] [--discover-schema]');
    const reference=JSON.parse(readFileSync(new URL(sustained?'./hosted-sustained-results.json':moving?'./hosted-moving-results.json':'./hosted-reference-results.json',import.meta.url),'utf8'));
    if(moving&&reference.workload!=='moving-reference')throw new MetricsReadError('reference-required','The moving-load report is missing its workload identifier.');
    if(sustained&&reference.workload!=='sustained-moving-reference')throw new MetricsReadError('reference-required','The sustained report is missing its workload identifier.');
    metricWindow(reference);
    let initialCooldownUntil=0;
    for(const path of ['./hosted-metrics-results.json','./hosted-moving-metrics-results.json','./hosted-sustained-metrics-results.json','./hosted-cpu-units-results.json'])try{
      const previous=JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
      initialCooldownUntil=Math.max(initialCooldownUntil,metricsCooldownUntil(previous));
    }catch{}
    console.log('Using your existing Wrangler login to read metrics. No deploy or gameplay is started.');
    const api=createMetricsApi({...await loadMetricsIdentity(),minIntervalMs:2500,initialCooldownUntil,log:console.log,
      onRateLimit:error=>writeFileSync(outputUrl,JSON.stringify({generatedAt:new Date().toISOString(),
        status:'waiting',mode:'private-staging',ranked:false,script:METRICS_SCRIPT,reason:error.code,retryAt:error.retryAt,
        diagnostics:error.diagnostics,measurements:[]},null,2)+'\n')});
    let cpuEvidence;try{cpuEvidence=JSON.parse(readFileSync(new URL('./hosted-cpu-units-results.json',import.meta.url),'utf8'));}catch{}
    const report=await collectHostedMetrics({api,reference,cpuEvidence,schemaMode:args.includes('--discover-schema')?'discover':'documented'});if(report.status!=='collected')process.exitCode=2;
  }catch(error){
    // Do not print raw subprocess/network errors, which can carry credentials.
    try{writeFileSync(outputUrl,JSON.stringify({generatedAt:new Date().toISOString(),
      status:'unavailable',mode:'private-staging',ranked:false,script:METRICS_SCRIPT,
      reason:error instanceof MetricsReadError?error.code:'check-failed',stage:error instanceof MetricsReadError?error.stage:undefined,
      diagnostics:error instanceof MetricsReadError?error.diagnostics:undefined,retryAt:error instanceof MetricsReadError?error.retryAt:undefined,measurements:[]},null,2)+'\n');}catch{}
    console.error('Metrics check stopped: '+(error instanceof MetricsReadError?error.message:'The reference report or metrics response could not be read.'));
    process.exitCode=1;
  }
}
