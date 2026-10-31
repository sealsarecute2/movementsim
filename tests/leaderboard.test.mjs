import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formatLeaderboardScore,leaderboardRows,hasLeaderboard} from '../dist/leaderboard.js';
import {MAP_LIST,COMMUNITY_MAPS} from '../dist/course.js';
import {RANKED_COURSES} from '../dist/ranked-courses.js';

test('time and distance formatting use the same millisecond rounding as accepted finishes',()=>{
 assert.equal(formatLeaderboardScore(61.005),'01:01.005');assert.equal(formatLeaderboardScore(6.500624962),'00:06.501');assert.equal(formatLeaderboardScore(12345,true),'12,345 u');
});
test('leaderboard rendering escapes usernames and displays at most five rows',()=>{
 const rows=leaderboardRows(Array.from({length:8},(_,i)=>({name:i?'Seal '+i:'<img src=x onerror=alert(1)>',value:12+i})));
 assert.equal((rows.match(/<tr>/g)||[]).length,5);assert.ok(rows.includes('&lt;img'));assert.ok(!rows.includes('<img'));assert.ok(!rows.includes('Seal 5'));
});
test('every bundled scored map has a verified board for both presets, with current revisions only',()=>{
 for(const map of [...MAP_LIST.filter(m=>m.timed||m.endless),...COMMUNITY_MAPS]){
  assert.equal(hasLeaderboard(map.id,map.revision||1),true,map.id);
  for(const preset of ['classic','practice'])assert.ok(RANKED_COURSES.some(c=>c.map===map.id&&c.revision===(map.revision||1)&&c.preset===preset));
  assert.equal(hasLeaderboard(map.id,99),false);
 }
 for(const id of ['free','local-map','unknown','__proto__','../course'])assert.equal(hasLeaderboard(id),false);
});
test('the game exposes only verified boards and never fetches manual text records',()=>{
 const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8'),html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
 for(const obsolete of ['leaderboard-published','leaderboard-verified','loadLeaderboard','leaderboardSource']){assert.ok(!app.includes(obsolete));assert.ok(!html.includes(obsolete));}
 assert.ok(!readFileSync(new URL('../dist/leaderboard.js',import.meta.url),'utf8').includes('fetcher'));
 assert.match(html,/id="verify-endless"/);
});
