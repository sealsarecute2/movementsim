export const CPU_UNIT_SPECS=[
  {dataset:'durableObjectsPeriodicGroups',typeName:'AccountDurableObjectsPeriodicGroupsSum',group:'sum',fields:['cpuTime']},
  {dataset:'workersInvocationsAdaptive',typeName:'AccountWorkersInvocationsAdaptiveQuantiles',group:'quantiles',fields:['cpuTimeP50','cpuTimeP99']},
];
export const CPU_UNIT_DIVISORS={microseconds:1000,nanoseconds:1000000,milliseconds:1};
export function cpuUnitFromDescription(description){
  if(typeof description!=='string'||description.length>512)return null;
  const matches=[['microseconds',/microseconds?|(?:^|\W)[µμ]s(?:$|\W)/i],['nanoseconds',/nanoseconds?/i],['milliseconds',/milliseconds?/i]]
    .filter(([,pattern])=>pattern.test(description));
  return matches.length===1?matches[0][0]:null;
}
// Reuse only a recent, complete primary-source confirmation. No API calls.
export function verifiedCpuEvidence(report,{now=Date.now(),script}={}){
  const at=Date.parse(report?.generatedAt);
  if(report?.status!=='confirmed'||report.source!=='live-provider-schema'||report.mode!=='private-staging'||report.ranked!==false||report.script!==script||
    !Number.isFinite(at)||at>now+60000||now-at>30*86400000||!Array.isArray(report.evidence)||report.evidence.length!==3)return null;
  const units={};
  for(const spec of CPU_UNIT_SPECS)for(const field of spec.fields){
    const metric=spec.group+'.'+field,found=report.evidence.filter(item=>item?.dataset===spec.dataset&&item.metric===metric),item=found[0];
    if(found.length!==1||item.typeName!==spec.typeName||item.field!==field||!item.unit||cpuUnitFromDescription(item.description)!==item.unit)return null;
    units[spec.dataset+'.'+metric]=item.unit;
  }
  return {generatedAt:report.generatedAt,units};
}
