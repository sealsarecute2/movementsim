import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,unlink,symlink,cp,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),script=join(root,'tools/music_catalog.py');
async function fixture(){const path=await mkdtemp(join(tmpdir(),'movement-music-'));await mkdir(join(path,'music'));return path;}
const update=path=>{const result=spawnSync('python3',[script,'--root',path],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);};

test('folder discovery adds and removes supported songs, encodes filenames, ignores hidden files and preserves metadata titles',async()=>{
 const path=await fixture();
 try{
  await mkdir(join(path,'music/nested'));await writeFile(join(path,'music/Track #1.MP3'),'song');await writeFile(join(path,'music/nested/Seal 🦭.ogg'),'song');await writeFile(join(path,'music/.hidden.mp3'),'hidden');await writeFile(join(path,'music/notes.txt'),'notes');
  await writeFile(join(path,'outside.mp3'),'private');await symlink(join(path,'outside.mp3'),join(path,'music/outside.mp3'));
  await writeFile(join(path,'music/sources.json'),JSON.stringify({tracks:[{file:'Track #1.MP3',provided_filename:'Artist - Original.mp3'}]}));
  update(path);let manifest=JSON.parse(await readFile(join(path,'music/playlist.json'),'utf8'));
  assert.deepEqual(manifest.tracks,[{title:'Seal 🦭',src:'music/nested/Seal%20%F0%9F%A6%AD.ogg'},{title:'Artist - Original',src:'music/Track%20%231.MP3'}]);
  await unlink(join(path,'music/Track #1.MP3'));await writeFile(join(path,'music/New song.flac'),'new');update(path);manifest=JSON.parse(await readFile(join(path,'music/playlist.json'),'utf8'));
  assert.equal(manifest.tracks.length,2);assert.ok(manifest.tracks.some(track=>track.src==='music/New%20song.flac'));assert.ok(!manifest.tracks.some(track=>track.src.includes('Track')));
  assert.equal(await readFile(join(path,'music/New song.flac'),'utf8'),'new');assert.equal(await readFile(join(path,'dist/music/playlist.json'),'utf8'),await readFile(join(path,'music/playlist.json'),'utf8'));
 }finally{await rm(path,{recursive:true,force:true});}
});
test('generated catalog JavaScript escapes HTML-breaking song titles',async()=>{
 const path=await fixture();try{
  await writeFile(join(path,'music/test.mp3'),'song');await writeFile(join(path,'music/sources.json'),JSON.stringify({tracks:[{file:'test.mp3',title:'</script><script>bad()</script>'}]}));update(path);
  const source=await readFile(join(path,'music-catalog.js'),'utf8');assert.ok(!source.includes('</script>'));assert.ok(source.includes('\\u003c'));
  assert.equal(JSON.parse(await readFile(join(path,'music/playlist.json'),'utf8')).tracks[0].title,'</script><script>bad()</script>');
 }finally{await rm(path,{recursive:true,force:true});}
});
test('the normal build keeps root music authoritative and removes stale preview copies',async()=>{
 const path=await fixture();try{
  await mkdir(join(path,'tools'));await cp(script,join(path,'tools/music_catalog.py'));await cp(join(root,'build-standalone.py'),join(path,'build-standalone.py'));await mkdir(join(path,'dist'));
  for(const name of await readdir(join(root,'dist')))if(/\.(js|html|css|ico|svg)$/.test(name))await cp(join(root,'dist',name),join(path,'dist',name));
  for(const directory of ['butterfly','vendor','sounds','maps','music'])await mkdir(join(path,'dist',directory));await mkdir(join(path,'leaderboards'));
  await writeFile(join(path,'music/new.wav'),'owner audio');await writeFile(join(path,'dist/music/stale.mp3'),'stale preview');
  const result=spawnSync('python3',[join(path,'build-standalone.py')],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  assert.equal(await readFile(join(path,'music/new.wav'),'utf8'),'owner audio');assert.equal(await readFile(join(path,'dist/music/new.wav'),'utf8'),'owner audio');assert.ok(!(await readdir(join(path,'dist/music'))).includes('stale.mp3'));
  assert.ok((await readFile(join(path,'index.html'),'utf8')).includes('music/new.wav'));
 }finally{await rm(path,{recursive:true,force:true});}
});
test('local preview discovers folder changes without rebuilding and serves new audio with its MIME type',{timeout:10000},async()=>{
 const path=await fixture();let server;try{
  await mkdir(join(path,'dist'));await writeFile(join(path,'dist/index.html'),'preview');
  server=spawn('python3',[join(root,'tools/dev_server.py'),'--port','0','--root',path],{stdio:['ignore','pipe','pipe']});
  const origin=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Preview did not start')),5000);server.on('error',reject);server.stdout.on('data',data=>{output+=data;const match=output.match(/http:\/\/localhost:(\d+)\//);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});});
  assert.equal((await (await fetch(origin+'/music/playlist.json')).json()).tracks.length,0);
  await writeFile(join(path,'music/New #song.M4A'),'new audio');let manifest=await (await fetch(origin+'/music/playlist.json')).json();assert.equal(manifest.tracks.length,1);
  const audio=await fetch(origin+'/'+manifest.tracks[0].src);assert.equal(audio.headers.get('content-type'),'audio/mp4');assert.equal(await audio.text(),'new audio');
  await unlink(join(path,'music/New #song.M4A'));manifest=await (await fetch(origin+'/music/playlist.json')).json();assert.equal(manifest.tracks.length,0);
 }finally{if(server){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}await rm(path,{recursive:true,force:true});}
});
