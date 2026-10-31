import {trustedCourse,betaCourseAllowed} from './catalog.js';
import {DT} from '../dist/physics.js';

export const SCORE_RULESET='verified-v1';
const accountPattern=/^[A-Za-z0-9_-]{43}$/;
const runPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
export function scoreBoard(mapId,preset){
  const map=trustedCourse(mapId);
  if(!map.timed||map.endless||!['classic','practice'].includes(preset))throw Error('unsupported-board');
  return {map:map.id,revision:map.revision||1,preset,ruleset:SCORE_RULESET};
}
const boardKey=board=>`${board.ruleset}:${board.map}:${board.revision}:${board.preset}`;

// Called only with the Durable Object's saved initialization and simulation
// outcome. There is deliberately no HTTP route for posting a score.
export function scoreFromOutcome(init,outcome){
  if(init?.kind!=='player'||init.scoreEligible!==true||init.botVerified!==true||outcome?.reason!=='completed'||
    outcome.completed!==true||outcome.invalid!==null)return null;
  const board=scoreBoard(init.selection.map,init.selection.preset);
  if(!betaCourseAllowed(board))return null;
  if(board.revision!==init.selection.revision||!accountPattern.test(init.lease.accountId)||!runPattern.test(init.lease.id)||
    !Number.isSafeInteger(outcome.ticks)||outcome.ticks<1||outcome.ticks>600/DT||
    !Number.isFinite(outcome.time)||outcome.time<=0||outcome.time>outcome.ticks*DT+1e-8||
    outcome.checkpoint!==trustedCourse(board.map).spawns.length-1||
    !Number.isSafeInteger(outcome.endedAt)||outcome.endedAt<init.lease.startedAt||outcome.endedAt>init.lease.expiresAt)return null;
  const timeNs=Math.round(outcome.time*1e9);
  if(!Number.isSafeInteger(timeNs)||timeNs<1)return null;
  return {...board,accountId:init.lease.accountId,runId:init.lease.id,timeNs,achievedAt:outcome.endedAt};
}
function checkedScore(value){
  const board=scoreBoard(value.map,value.preset);
  if(Object.keys(value).sort().join(',')!=='accountId,achievedAt,map,preset,revision,ruleset,runId,timeNs'||
    value.revision!==board.revision||value.ruleset!==board.ruleset||!accountPattern.test(value.accountId)||!runPattern.test(value.runId)||
    !Number.isSafeInteger(value.timeNs)||value.timeNs<1||value.timeNs>600e9||!Number.isSafeInteger(value.achievedAt)||value.achievedAt<1)throw Error('invalid-score');
  return board;
}
const publicRow=row=>({playerId:row.account_id,name:'Player '+row.account_id.slice(0,8),value:row.time_ns/1e9,
  timeNs:row.time_ns,runId:row.run_id,achievedAt:row.achieved_at});

// One durable SQLite database. One best per account/board; indexed top-100
// reads and no growing per-attempt receipt table. Repeated writes are harmless.
export class VerifiedScores {
  constructor(ctx){
    this.ctx=ctx;this.sql=ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS personal_bests (
      board_id TEXT NOT NULL, account_id TEXT NOT NULL, time_ns INTEGER NOT NULL CHECK(time_ns>0),
      run_id TEXT NOT NULL, achieved_at INTEGER NOT NULL,
      PRIMARY KEY(board_id,account_id), UNIQUE(run_id))`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS board_order ON personal_bests(board_id,time_ns,achieved_at,account_id)');
  }
  async fetch(request){
    try{
      const path=new URL(request.url).pathname,body=await request.json();
      if(path==='/record'){
        const board=checkedScore(body),key=boardKey(board);
        const result=this.ctx.storage.transactionSync(()=>{
          // A run ID can never be reassigned to a different account or score.
          const previous=[...this.sql.exec('SELECT * FROM personal_bests WHERE run_id=?',body.runId)][0];
          if(previous&&(previous.board_id!==key||previous.account_id!==body.accountId||previous.time_ns!==body.timeNs||previous.achieved_at!==body.achievedAt))throw Error('run-conflict');
          this.sql.exec(`INSERT INTO personal_bests(board_id,account_id,time_ns,run_id,achieved_at) VALUES(?,?,?,?,?)
            ON CONFLICT(board_id,account_id) DO UPDATE SET time_ns=excluded.time_ns,run_id=excluded.run_id,achieved_at=excluded.achieved_at
            WHERE excluded.time_ns<personal_bests.time_ns`,key,body.accountId,body.timeNs,body.runId,body.achievedAt);
          return [...this.sql.exec('SELECT * FROM personal_bests WHERE board_id=? AND account_id=?',key,body.accountId)][0];
        });
        return json({saved:true,personalBest:result.run_id===body.runId,best:publicRow(result)});
      }
      if(path==='/board'){
        const board=scoreBoard(body.map,body.preset);
        if(body.revision!==board.revision)return json({error:'revision-mismatch'},409);
        const rows=[...this.sql.exec('SELECT * FROM personal_bests WHERE board_id=? ORDER BY time_ns,achieved_at,account_id LIMIT 100',boardKey(board))];
        return json({...board,records:rows.map(publicRow)});
      }
      return json({error:'not-found'},404);
    }catch{return json({error:'score-store-rejected'},400);}
  }
}
