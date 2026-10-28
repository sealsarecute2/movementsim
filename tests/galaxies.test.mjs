import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzlibSync} from '../dist/vendor/fflate.module.js';
import {decodeGalaxyAsset,loadGalaxyEnvironment} from '../dist/galaxies.js';
import {GALAXY_ENVIRONMENT} from '../dist/galaxy-data.js';
import {sampleSkybox} from '../dist/skybox.js';
import {sampleSceneLight} from '../dist/lighting.js';

const packed=readFileSync(new URL('../dist/backgrounds/galaxies.mlbg',import.meta.url));
test('the game background decodes the original HDRI conversion and the public copy matches',()=>{
  const {width,height,pixels}=decodeGalaxyAsset(packed,unzlibSync);
  assert.equal(width,2048);assert.equal(height,1024);assert.equal(pixels.length,width*height*4);
  assert.equal(createHash('sha256').update(packed).digest('hex'),GALAXY_ENVIRONMENT.packedSha256);
  assert.deepEqual(readFileSync(new URL('../backgrounds/galaxies.mlbg',import.meta.url)),packed);
  assert.ok(packed.length<6*1024*1024);assert.deepEqual(GALAXY_ENVIRONMENT.sourceSize,[7680,4320]);
  assert.ok(pixels.some((n,i)=>i%4!==3&&n>200));assert.ok(pixels.some((n,i)=>i%4!==3&&n<20));
});
test('invalid or incomplete galaxy containers are rejected before texture upload',()=>{
  assert.throws(()=>decodeGalaxyAsset(new Uint8Array(5),unzlibSync),/Invalid/);
  const bad=Uint8Array.from(packed);bad[4]=99;assert.throws(()=>decodeGalaxyAsset(bad,unzlibSync),/Invalid/);
  bad.set(packed);bad[8]=0;bad[9]=1;assert.throws(()=>decodeGalaxyAsset(bad,unzlibSync),/dimensions/);
  assert.throws(()=>decodeGalaxyAsset(packed,()=>new Uint8Array(4)),/Incomplete/);
});
test('galaxy loading uses the local game asset and reports download failures',async()=>{
  const calls=[];
  const data=await loadGalaxyEnvironment({fetcher:async(url,options)=>{calls.push({url,options});return {ok:true,arrayBuffer:async()=>Uint8Array.from(packed).buffer};}});
  assert.equal(data.width,2048);assert.equal(calls[0].url,'backgrounds/galaxies.mlbg?v=1');assert.equal(calls[0].options.cache,'force-cache');
  await assert.rejects(loadGalaxyEnvironment({fetcher:async()=>({ok:false})}),/download/);
});
test('the two galaxy light colours and directions come from the environment and stay stable',()=>{
  const frame=sampleSkybox('galaxies',200),light=sampleSceneLight('galaxies',frame);
  assert.equal(frame.galaxies,1);assert.equal(frame.blackHole,0);assert.deepEqual(sampleSkybox('galaxies',900),frame);
  assert.ok(Math.abs(Math.hypot(...light.direction)-1)<1e-5);assert.ok(Math.abs(Math.hypot(...light.fillDirection)-1)<1e-5);
  assert.ok(Math.max(...light.colour)-Math.min(...light.colour)>.2);assert.ok(Math.max(...light.fillColour)-Math.min(...light.fillColour)>.2);
  assert.ok(light.direction.reduce((sum,n,i)=>sum+n*light.fillDirection[i],0)<.7);
  assert.deepEqual(frame.horizon,light.horizon);assert.deepEqual(frame.zenith,light.zenith);
});
