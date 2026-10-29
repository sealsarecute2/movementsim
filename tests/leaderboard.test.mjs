import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseLeaderboard, formatLeaderboardScore, leaderboardRows, loadLeaderboard, hasLeaderboard } from '../dist/leaderboard.js';
import { MAP_LIST, COMMUNITY_MAPS } from '../dist/course.js';

test('plain text records support either time format, separate modes, and keep each player’s best result',()=>{
  const text='\uFEFF# comment\r\nYouhong | 00:23.456 | classic\r\nAlice | 22.1\r\nyouhong | 21.000 | classic\nAlice | 20 | practice\nBob | 01:01.005 | classic\n';
  assert.deepEqual(parseLeaderboard(text),[{name:'youhong',value:21},{name:'Alice',value:22.1},{name:'Bob',value:61.005}]);
  assert.deepEqual(parseLeaderboard(text,{preset:'practice'}),[{name:'Alice',value:20}]);assert.equal(formatLeaderboardScore(61.005),'01:01.005');
});
test('malformed, negative, zero, nonfinite and excessive-precision records are ignored',()=>{
  assert.deepEqual(parseLeaderboard('A | -2\nB | NaN\nC | 0\nD | 01:60\nE | 1:5\nF | 3.14159\nG | 20 | other\n | 5\nH | 20 | classic | extra'),[]);
});
test('Endless ranks whole-number distance highest first and keeps the longest entry',()=>{
  assert.deepEqual(parseLeaderboard('A | 100\nB | 1500\nA | 2000\nC | 1.5\nD | 9007199254740992',{endless:true}),[{name:'A',value:2000},{name:'B',value:1500}]);assert.equal(formatLeaderboardScore(1500,true),'1,500 u');
});
test('player-controlled markup stays inert when rendered as leaderboard rows',()=>{
  const rows=leaderboardRows(parseLeaderboard('<img src=x onerror=alert(1)> | 12\nA&B | 15'));
  assert.ok(rows.includes('&lt;img'));assert.ok(!rows.includes('<img'));assert.ok(rows.includes('A&amp;B'));
});
test('cloud loading only reads the selected text file and reports failures instead of inventing records',async()=>{
  const calls=[];
  const records=await loadLeaderboard('course','classic',{fetcher:async(url,options)=>{calls.push({url,options});return {ok:true,text:async()=> 'Seal | 12.345'};}});
  assert.deepEqual(records,[{name:'Seal',value:12.345}]);assert.match(calls[0].url,/^leaderboards\/course\.txt\?v=\d+$/);
  assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.method,undefined,'there is no client write request');
  await assert.rejects(loadLeaderboard('../secret','classic'),/Invalid/);await assert.rejects(loadLeaderboard('course','invalid'),/Invalid/);
  await assert.rejects(loadLeaderboard('course','classic',{fetcher:async()=>({ok:false})}),/unavailable/);
});
test('each scored course has an editable root text file and accepts owner-published records',()=>{
  for(const map of [...MAP_LIST.filter(m=>m.timed||m.endless),...COMMUNITY_MAPS]) {
    const root=readFileSync(new URL('../leaderboards/'+map.id+(map.revision>1?'-v'+map.revision:'')+'.txt',import.meta.url),'utf8');
    assert.equal(readFileSync(new URL('../dist/leaderboards/'+map.id+(map.revision>1?'-v'+map.revision:'')+'.txt',import.meta.url),'utf8'),root);
    assert.doesNotThrow(()=>parseLeaderboard(root,{endless:!!map.endless}));
    const example=map.endless?'Real player | 12345 | classic':'Real player | 12.345 | classic';
    assert.ok(parseLeaderboard(root+'\n'+example,{endless:!!map.endless}).some(entry=>entry.name==='Real player'));
  }
});
test('bhop_lego reads its revision-specific board and separates both physics modes',async()=>{
  const calls=[],fetcher=async(url,options)=>{calls.push({url,options});return {ok:true,text:async()=> 'Seal | 02:34.567 | practice\nClassic player | 210 | classic\nSeal | 180 | practice'};};
  assert.equal(hasLeaderboard('bhop_lego',2),true);assert.equal(hasLeaderboard('bhop_lego',1),false);
  assert.deepEqual(await loadLeaderboard('bhop_lego','practice',{revision:2,fetcher}),[{name:'Seal',value:154.567}]);
  assert.deepEqual(await loadLeaderboard('bhop_lego','classic',{revision:2,fetcher}),[{name:'Classic player',value:210}]);
  assert.ok(calls.every(c=>/^leaderboards\/bhop_lego-v2\.txt\?v=\d+$/.test(c.url)&&c.options.cache==='no-store'&&c.options.method===undefined));
  for(const revision of [1,3,NaN])await assert.rejects(loadLeaderboard('bhop_lego','practice',{revision,fetcher}),/Invalid/);
  assert.equal(calls.length,2,'invalid revisions do not fetch an older board');
});
test('a rebuild preserves owner-edited root records and updates the preview copy',()=>{
  const folder=mkdtempSync(join(tmpdir(),'movement-leaderboard-build-'));
  try {
    copyFileSync(new URL('../build-standalone.py',import.meta.url),join(folder,'build-standalone.py'));
    for(const path of ['dist/butterfly','dist/vendor','dist/sounds','dist/music','dist/maps','dist/leaderboards','leaderboards'])mkdirSync(join(folder,path),{recursive:true});
    for(const name of ['index.html','style.css','endless.js','course.js','physics.js','skybox.js','lighting.js','signs.js','parkour-map.js','source-map.js','source-runtime.js','players.js','renderer.js','game-audio.js','leaderboard.js','menu.js','menu-music.js','multiplayer-config.js','multiplayer.js','app.js','favicon.ico','favicon.svg'])writeFileSync(join(folder,'dist',name),'');
    writeFileSync(join(folder,'leaderboards/course.txt'),'Seal | 12.345 | classic\n');writeFileSync(join(folder,'dist/leaderboards/course.txt'),'# stale preview\n');writeFileSync(join(folder,'dist/leaderboards/endless.txt'),'# retired\n');
    writeFileSync(join(folder,'leaderboards/bhop_lego-v2.txt'),'Seal | 154.567 | practice\n');writeFileSync(join(folder,'dist/leaderboards/bhop_lego-v2.txt'),'# stale community preview\n');
    const result=spawnSync('python3',[join(folder,'build-standalone.py')],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
    assert.equal(existsSync(join(folder,'dist/leaderboards/endless.txt')),false);
    assert.equal(readFileSync(join(folder,'leaderboards/course.txt'),'utf8'),'Seal | 12.345 | classic\n');assert.equal(readFileSync(join(folder,'dist/leaderboards/course.txt'),'utf8'),'Seal | 12.345 | classic\n');
    assert.equal(readFileSync(join(folder,'leaderboards/bhop_lego-v2.txt'),'utf8'),'Seal | 154.567 | practice\n');assert.equal(readFileSync(join(folder,'dist/leaderboards/bhop_lego-v2.txt'),'utf8'),'Seal | 154.567 | practice\n');
  } finally {rmSync(folder,{recursive:true,force:true});}
});

test('retired courses, local imports and unknown IDs cannot load shared boards',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return {ok:true,text:async()=>''};};
 for(const id of ['momentum','zigzag','skyline','circuit','balance','underpass','needles','gauntlet','free','local-map','other-community','__proto__','../bhop_lego'])await assert.rejects(loadLeaderboard(id,'classic',{fetcher}),/Invalid/);
 await assert.rejects(loadLeaderboard('course','classic',{revision:2,fetcher}),/Invalid/);assert.equal(calls,0);
 for(const path of ['../leaderboards/','../dist/leaderboards/'])assert.deepEqual(readdirSync(new URL(path,import.meta.url)).filter(n=>n.endsWith('.txt')).sort(),['bhop-school.txt','bhop_kitsune-v3.txt','bhop_lego-v2.txt','course.txt','endless-v3.txt','ladder-run.txt']);
});
test('the new native and Kitsune boards load times while Endless ranks distance under revision 3',async()=>{
 const calls=[],fetcher=async(url)=>{calls.push(url);return {ok:true,text:async()=> 'Seal | 12345 | practice\nSecond | 456 | practice'};};
 for(const id of ['bhop-school','ladder-run']){
  assert.equal(hasLeaderboard(id),true);await loadLeaderboard(id,'practice',{fetcher});assert.match(calls.at(-1),new RegExp('leaderboards/'+id+'\\.txt'));
 }
 await loadLeaderboard('bhop_kitsune','practice',{revision:3,fetcher});assert.match(calls.at(-1),/bhop_kitsune-v3\.txt/);
 for(const revision of [1,2])await assert.rejects(loadLeaderboard('bhop_kitsune','practice',{revision,fetcher}),/Invalid/);
 const records=await loadLeaderboard('endless','practice',{revision:3,fetcher});assert.equal(records[0].value,12345);assert.match(calls.at(-1),/endless-v3\.txt/);
 for(const revision of [1,2])await assert.rejects(loadLeaderboard('endless','practice',{revision,fetcher}),/Invalid/);
});
