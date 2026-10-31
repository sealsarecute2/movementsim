import {writeFileSync} from 'node:fs';
import {loadStagingConfig,createStagingClient} from './staging-client.mjs';
try{
  const api=createStagingClient(loadStagingConfig());
  const [verification,admission]=await Promise.all([api.json('/v1/private-test/status'),api.json('/v1/status')]);
  const best=verification.best,proof=best?.proof;
  const passed=!!best&&best.scoreSaved===true&&(!proof||(proof.reason==='completed'&&proof.completed===true&&proof.invalid===null&&
    proof.scoreStatus==='saved'&&proof.privateTest===true&&proof.checkpoints===3&&proof.timeMatches===true));
  const status=passed?'verified-score-saved':best?'saved-score-needs-review':verification.testerEnrolled?'account-linked-no-saved-score':'account-not-linked';
  const report={generatedAt:new Date().toISOString(),status,passed,testerEnrolled:verification.testerEnrolled,enrolledAt:verification.enrolledAt,
    privateTestingEnabled:verification.privateTestingEnabled,publicRanked:verification.publicRanked,map:verification.map,preset:verification.preset,
    activeAttempts:admission.active,limit:admission.limit,best,
    scope:'Read-only owner check of enrollment and persisted private leaderboard; no run or challenge is started.'};
  writeFileSync(new URL('./current-verification-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}catch(error){console.error('Verification check stopped: '+error.message);process.exitCode=1;}
