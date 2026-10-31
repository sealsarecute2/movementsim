import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createMetricsApi,loadMetricsIdentity,MetricsReadError,metricsCooldownUntil,validateMetricsQueryStructure} from './cloudflare-metrics-client.mjs';
import {METRICS_SCRIPT} from './hosted-metrics.mjs';
import {CPU_UNIT_SPECS as specs,CPU_UNIT_DIVISORS as divisor,cpuUnitFromDescription} from './cpu-unit-evidence.mjs';
export {cpuUnitFromDescription} from './cpu-unit-evidence.mjs';

const outputUrl=new URL('./hosted-cpu-units-results.json',import.meta.url);
const sourceFiles=['hosted-metrics-results.json','hosted-moving-metrics-results.json'];
// These are narrow candidate type names, not assumed units. The response must
// confirm each exact type, field and unambiguous unit description. A changed
// type/field stays unknown; do not fall back to whole-account introspection.
function validateSources(sources,accountId,now){
  if(!Array.isArray(sources)||!sources.length||sources.length>2||new Set(sources.map(source=>source.file)).size!==sources.length)throw new MetricsReadError('metrics-required','One or two distinct collected staging metrics reports are required.');
  for(const {file,report} of sources){
    const generatedAt=Date.parse(report?.generatedAt),from=Date.parse(report?.window?.from),to=Date.parse(report?.window?.to);
    if(!sourceFiles.includes(file)||report?.status!=='collected'||report.mode!=='private-staging'||report.ranked!==false||report.script!==METRICS_SCRIPT||report.accountId!==accountId||
      !Number.isFinite(generatedAt)||generatedAt>now+60000||now-generatedAt>30*86400000||!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>600000||
      !Array.isArray(report.measurements)||report.measurements.length!==5)throw new MetricsReadError('metrics-required','The saved metrics must be recent, collected private-staging reports for the logged-in staging account.');
    for(const [dataset,className,keys] of [
      ['durableObjectsPeriodicGroups','VerifiedRun',['sum.cpuTime']],
      ['durableObjectsPeriodicGroups','AdmissionCoordinator',['sum.cpuTime']],
      ['workersInvocationsAdaptive',null,['quantiles.cpuTimeP50','quantiles.cpuTimeP99']],
    ]){
      const rows=report.measurements.filter(row=>row?.dataset===dataset&&row.className===className),row=rows[0];
      if(rows.length!==1||row.status!=='available'||keys.some(key=>typeof row.values?.[key]!=='number'||!Number.isFinite(row.values[key])||row.values[key]<0))throw new MetricsReadError('metrics-required','A required raw CPU measurement is missing or invalid.');
    }
  }
}
export async function confirmHostedCpuUnits({api,sources,now=()=>Date.now(),log=console.log,
  save=report=>writeFileSync(outputUrl,JSON.stringify(report,null,2)+'\n')}={}){
  validateSources(sources,api.accountId,now());
  const queries=specs.map(spec=>'query VerifierCpuUnitSchema { __type(name:'+JSON.stringify(spec.typeName)+') { name fields { name description } } }');
  queries.forEach(validateMetricsQueryStructure);
  const evidence=[];
  for(let index=0;index<specs.length;index++){
    const spec=specs[index];log('Reading CPU unit descriptions: '+spec.typeName+'...');
    const data=await api.graphql(queries[index]),type=data?.__type;
    if(type&&(type.name!==spec.typeName||!Array.isArray(type.fields)||type.fields.length>128))throw new MetricsReadError('invalid-response','Cloudflare returned unexpected or excessive CPU type metadata.');
    for(const field of spec.fields){
      const found=type?.fields.filter(item=>item?.name===field)||[],description=found.length===1?found[0].description:null;
      const unit=cpuUnitFromDescription(description);
      evidence.push({dataset:spec.dataset,typeName:spec.typeName,field,metric:spec.group+'.'+field,unit,
        description:typeof description==='string'&&description.length<=512?description.replace(/[\u0000-\u001f\u007f-\u009f]/g,' '):null,
        ...(!unit?{reason:!type?'type-unavailable':found.length!==1?'field-unavailable':'unit-unconfirmed'}:{})});
    }
  }
  const samples=sources.map(({file,report})=>({sourceFile:file,metricsGeneratedAt:report.generatedAt,window:report.window,
    cpu:report.measurements.flatMap(row=>evidence.filter(item=>item.dataset===row.dataset&&
      (item.dataset==='durableObjectsPeriodicGroups'?['VerifiedRun','AdmissionCoordinator'].includes(row.className):row.className===null)).map(item=>({
      className:row.className,dataset:row.dataset,scope:row.scope,metric:item.metric,raw:row.values[item.metric],unit:item.unit,
      milliseconds:item.unit?row.values[item.metric]/divisor[item.unit]:null,typeName:item.typeName,field:item.field,
    })))}));
  const known=evidence.filter(item=>item.unit).length,status=known===evidence.length?'confirmed':known?'partial':'unavailable';
  const report={generatedAt:new Date(now()).toISOString(),status,mode:'private-staging',ranked:false,script:METRICS_SCRIPT,
    source:'live-provider-schema',evidence,samples,limitations:[
      'Unit descriptions are live provider metadata; the saved metric values and their original collection times are preserved separately.',
      'CPU sums cover a namespace/window and may include other activity. Quantiles cover Worker invocations; they are not total run CPU.',
      'This does not establish per-player CPU, a maximum player count, sustained capacity, resource-error absence or an exact bill.',
    ]};
  await save(report);log('Saved hosted-cpu-units-results.json ('+status+').');
  for(const sample of samples){
    log(sample.sourceFile+':');
    for(const cpu of sample.cpu)log(`  ${cpu.className||'Worker'} / ${cpu.metric}: ${cpu.milliseconds===null?'unit unconfirmed (raw '+cpu.raw+')':cpu.milliseconds+' ms (raw '+cpu.raw+' '+cpu.unit+')'}`);
  }
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==2)throw new MetricsReadError('invalid-request','Usage: node hosted-cpu-units.mjs');
    const sources=sourceFiles.map(file=>({file,report:JSON.parse(readFileSync(new URL('./'+file,import.meta.url),'utf8'))}));
    let initialCooldownUntil=0;
    for(const file of [...sourceFiles,'hosted-sustained-metrics-results.json','hosted-cpu-units-results.json'])try{
      initialCooldownUntil=Math.max(initialCooldownUntil,metricsCooldownUntil(JSON.parse(readFileSync(new URL('./'+file,import.meta.url),'utf8'))));
    }catch{}
    console.log('Reading two small CPU metadata queries with the existing Wrangler login. No gameplay or deployment is started.');
    const api=createMetricsApi({...await loadMetricsIdentity(),minIntervalMs:2500,initialCooldownUntil,log:console.log,
      onRateLimit:error=>writeFileSync(outputUrl,JSON.stringify({generatedAt:new Date().toISOString(),status:'waiting',mode:'private-staging',ranked:false,
        reason:error.code,retryAt:error.retryAt,diagnostics:error.diagnostics},null,2)+'\n')});
    const report=await confirmHostedCpuUnits({api,sources});if(report.status!=='confirmed')process.exitCode=2;
  }catch(error){
    const safe=error instanceof MetricsReadError?error:null;
    try{writeFileSync(outputUrl,JSON.stringify({generatedAt:new Date().toISOString(),status:'unavailable',mode:'private-staging',ranked:false,
      reason:safe?.code||'check-failed',stage:safe?.stage,retryAt:safe?.retryAt,diagnostics:safe?.diagnostics},null,2)+'\n');}catch{}
    console.error('CPU unit check stopped: '+(safe?safe.message:'The saved metrics reports or unit metadata could not be read.'));process.exitCode=1;
  }
}
