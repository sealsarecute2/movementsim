import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseLeaderboard, formatLeaderboardScore, leaderboardRows, loadLeaderboard } from '../dist/leaderboard.js';
import { MAP_LIST } from '../dist/course.js';

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
  for(const map of MAP_LIST.filter(m=>m.timed||m.endless)) {
    const root=readFileSync(new URL('../leaderboards/'+map.id+'.txt',import.meta.url),'utf8');
    assert.doesNotThrow(()=>parseLeaderboard(root,{endless:!!map.endless}));
    const example=map.endless?'Real player | 12345 | classic':'Real player | 12.345 | classic';
    assert.ok(parseLeaderboard(root+'\n'+example,{endless:!!map.endless}).some(entry=>entry.name==='Real player'));
  }
});
test('a rebuild preserves owner-edited root records and updates the preview copy',()=>{
  const folder=mkdtempSync(join(tmpdir(),'movement-leaderboard-build-'));
  try {
    copyFileSync(new URL('../build-standalone.py',import.meta.url),join(folder,'build-standalone.py'));
    for(const path of ['dist/butterfly','dist/vendor','dist/sounds','dist/leaderboards','leaderboards'])mkdirSync(join(folder,path),{recursive:true});
    for(const name of ['index.html','style.css','endless.js','course.js','physics.js','skybox.js','renderer.js','game-audio.js','leaderboard.js','menu.js','app.js','favicon.ico','favicon.svg'])writeFileSync(join(folder,'dist',name),'');
    writeFileSync(join(folder,'leaderboards/course.txt'),'Seal | 12.345 | classic\n');writeFileSync(join(folder,'dist/leaderboards/course.txt'),'# stale preview\n');
    const result=spawnSync('python3',[join(folder,'build-standalone.py')],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
    assert.equal(readFileSync(join(folder,'leaderboards/course.txt'),'utf8'),'Seal | 12.345 | classic\n');assert.equal(readFileSync(join(folder,'dist/leaderboards/course.txt'),'utf8'),'Seal | 12.345 | classic\n');
  } finally {rmSync(folder,{recursive:true,force:true});}
});
