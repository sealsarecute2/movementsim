import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import {boot} from './helpers/boot-app.mjs';
import {REFERENCE_MAX_TICKS,ReferenceRunRecorder} from '../dist/reference-run.js';
import {checkReference} from '../verification/reference-check.mjs';
import {createReferenceServer} from '../verification/reference-server.mjs';

// A continuous test course exercises full spawn-to-finish capture without
// placing the player at checkpoints. Real bundled routes need human fixtures.
const map={id:'course',title:'Reference test course',timed:true,spawns:[{x:0,y:0,z:100,yaw:0},{x:0,y:0,z:-200,yaw:0},{x:0,y:0,z:-400,yaw:0}],
  boxes:[{min:[-100,-120,-100],max:[100,0,200]},
    {min:[-100,-120,-300],max:[100,0,-100],checkpoint:1},
    {min:[-100,-120,-500],max:[100,0,-300],checkpoint:2},
    {min:[-100,-120,-700],max:[100,0,-500],finish:true}],stages:[{title:'Start'},{title:'Middle'},{title:'End'}]};
const options={resolveCourse:()=>map};
function completeReference(preset='classic'){
  const app=boot({},'?referenceRun=1');
  app.context.MAPS={...app.context.MAPS,course:map};
  app.read(`chooseMap('course');choosePreset('${preset}');keys.add('KeyW')`);
  for(let tick=0;tick<1500&&!app.read('completed');tick++)app.read('tick()');
  assert.equal(app.read('completed'),true);assert.equal(app.read('respawns'),0);
  return {app,record:JSON.parse(app.read('JSON.stringify(referenceRecorder.export())'))};
}
test('opt-in records the actual app inputs through every checkpoint and exact fractional finish',()=>{
  for(const preset of ['classic','practice']){
    const {app,record}=completeReference(preset),{result}=checkReference(JSON.stringify(record),options);
    assert.equal(result.completed,true);assert.equal(result.checkpoint,2);
    assert.equal(result.time,app.read('runTime'));assert.equal(result.ticks,record.frames.length);
    assert.equal(result.ranked,false);
    assert.equal(app.element('check-reference').classList.contains('hidden'),false);
    assert.ok(record.samples.some(sample=>sample.checkpoint===1));
    assert.ok(record.samples.some(sample=>sample.checkpoint===2));
  }
});
test('recording stays off normally, restarts on Q/full reset, and disallows assisted and multiplayer attempts',()=>{
  const ordinary=boot();ordinary.read("keys.add('KeyW');tick()");
  assert.equal(ordinary.read('referenceRecorder'),null);assert.equal(ordinary.element('reference-status').textContent,'');
  const {app}=completeReference();app.read('reset(false)');
  assert.throws(()=>app.read('referenceRecorder.export()'),/Finish a clean run/);
  assert.equal(app.read('referenceRecorder.frames.length'),0);
  app.read('reset();keys.add("KeyW");tick()');assert.equal(app.read('referenceRecorder.reason'),null);
  assert.equal(app.read('referenceRecorder.frames.length'),1);
  app.read("room={busy:true};tick()");assert.match(app.read('referenceRecorder.reason'),/solo/);
  app.read("room=null;chooseMap('free')");assert.equal(app.read('referenceRecorder'),null);
});
test('reference inputs retain bounded angles and the recorder bounds memory',()=>{
  const app=boot({},'?referenceRun=1');app.read('player.yaw=20;tick()');
  assert.ok(Math.abs(app.read('referenceRecorder.frames[0].yaw'))<=Math.PI);
  assert.equal(app.read('referenceRecorder.frames[0].yaw'),app.read('player.yaw'));
  const recorder=new ReferenceRunRecorder(map,'classic');recorder.frames.length=REFERENCE_MAX_TICKS;
  recorder.input({});assert.match(recorder.reason,/nine minutes/);assert.equal(recorder.frames.length,0);
});
test('reference checks reject modified scores, movement, truncation, map revisions and client state in inputs',()=>{
  const {record}=completeReference();
  for(const change of [
    r=>r.samples.at(-1).time+=.001,
    r=>r.samples.at(-1).x+=1,
    r=>r.frames.pop(),
    r=>r.frames[0].x=1000,
    r=>r.frames[0].yaw=100,
    r=>r.revision=2,
    r=>r.map='local-map',
    r=>r.samples.at(-1).completed=false,
    r=>r.frames[0].forward=-1,
  ]){
    const modified=structuredClone(record);change(modified);
    assert.throws(()=>checkReference(JSON.stringify(modified),options));
  }
});
test('local helper writes only checked fixtures and rejects cross-origin and wrong-host requests',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'movementlab-reference-'));
  const server=createReferenceServer({directory,check:raw=>checkReference(raw,options),log:()=>{}});
  try{
    await new Promise((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept);});
    const origin='http://127.0.0.1:'+server.address().port;
    const submit=(body,headers={})=>fetch(origin+'/__verification/reference',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});
    const {record}=completeReference();
    assert.equal((await submit(record,{origin:'https://example.com'})).status,403);
    const wrongHostStatus=await new Promise((accept,reject)=>{
      const req=httpRequest(origin,{headers:{host:'wrong.example'}},res=>{res.resume();accept(res.statusCode);});req.on('error',reject);req.end();
    });
    assert.equal(wrongHostStatus,403);
    assert.equal((await submit(record,{'content-type':'text/plain'})).status,403);
    const changed=structuredClone(record);changed.samples.at(-1).x+=1;
    assert.equal((await submit(changed)).status,400);
    const response=await submit(record);assert.equal(response.status,200);
    assert.equal((await response.json()).completed,true);
    const saved=JSON.parse(await readFile(join(directory,'latest-result.json'),'utf8'));
    assert.equal(saved.time,record.samples.at(-1).time);
    assert.deepEqual(JSON.parse(await readFile(join(directory,saved.file),'utf8')),record);
    assert.equal((await fetch(origin+'/.staging-secrets.json')).status,404);
    assert.equal((await fetch(origin+'/%2e%2e%2fverification/.staging-secrets.json')).status,404);
    assert.equal((await fetch(origin+'/')).status,200);
  }finally{await new Promise(done=>server.close(done));await rm(directory,{recursive:true,force:true});}
});
