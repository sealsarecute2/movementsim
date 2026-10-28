import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SKYBOXES, normaliseSkybox, sampleSkybox, DAY_NIGHT_CYCLE_SECONDS } from '../dist/skybox.js';
import { createRenderer } from '../dist/renderer.js';

function fixture(t) {
  const previousWindow=globalThis.window;globalThis.window={devicePixelRatio:1};
  t.after(()=>{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;});
  const uploads=[],draws=[],programs=[],pointers=new Map(),enabled=new Set();let current,depth=true,writeDepth=true,blend=false;
  const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,ARRAY_BUFFER:5,STATIC_DRAW:6,
    FLOAT:7,DEPTH_TEST:8,BLEND:9,COLOR_BUFFER_BIT:16,DEPTH_BUFFER_BIT:32,TRIANGLES:10,ONE:11,
    createShader:type=>({type}),shaderSource:(shader,source)=>{shader.source=source;},compileShader(){},getShaderParameter:()=>true,
    createProgram(){const p={shaders:[],uniforms:{}};programs.push(p);return p;},attachShader:(p,s)=>p.shaders.push(s),linkProgram(){},getProgramParameter:()=>true,
    useProgram:p=>{current=p;},createBuffer:()=>({}),bindBuffer(){},bufferData(target,data){uploads.push(data);},
    getAttribLocation:(p,name)=>({aPosition:0,aColor:1,aTop:2,aNormal:3,aShade:4,aClip:0})[name],
    enableVertexAttribArray:loc=>enabled.add(loc),disableVertexAttribArray:loc=>enabled.delete(loc),
    vertexAttribPointer:(loc,count)=>pointers.set(loc,count),getUniformLocation:(program,name)=>({program,name}),
    uniform1f:(u,x)=>{u.program.uniforms[u.name]=x;},uniform2f:(u,...v)=>{u.program.uniforms[u.name]=v;},uniform3f:(u,...v)=>{u.program.uniforms[u.name]=v;},
    uniform4f:(u,...v)=>{u.program.uniforms[u.name]=v;},
    enable:cap=>{if(cap===8)depth=true;if(cap===9)blend=true;},disable:cap=>{if(cap===8)depth=false;if(cap===9)blend=false;},
    depthMask:value=>{writeDepth=value;},clearColor(...value){this.background=value;},clear(){},viewport(){},blendFunc(){},
    drawArrays(mode,first,count){draws.push({sky:current.shaders.some(s=>s.source.includes('attribute vec2 aClip')),count,
      uniforms:structuredClone(current.uniforms),depth,writeDepth,blend,pointers:new Map(pointers),enabled:new Set(enabled)});},
  };
  const canvas={clientWidth:1280,clientHeight:720,width:0,height:0,getContext:()=>gl};
  let clock=0;
  const box={min:[-100,-20,-100],max:[100,0,100]},renderer=createRenderer(canvas,[box],{now:()=>clock});
  const camera={x:0,y:0,z:80,yaw:.6,pitch:.2,duckAmount:0};
  return {renderer,camera,box,gl,draws,programs,uploads,setTime:seconds=>{clock=seconds*1000;}};
}

test('black, the day/night cycle and the black hole are selectable; old settings fall back to black',()=>{
  assert.deepEqual(Object.keys(SKYBOXES),['black','cycle','blackhole']);
  for(const value of [undefined,null,'unknown','__proto__',3,'dawn','midday','dusk','midnight'])assert.equal(normaliseSkybox(value),'black');
  assert.equal(normaliseSkybox('cycle'),'cycle');
  assert.equal(sampleSkybox('black',450),SKYBOXES.black);
  const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  const select=html.match(/<select id="skybox-select">(.*?)<\/select>/s)[1];
  assert.deepEqual([...select.matchAll(/value="([^"]+)"/g)].map(m=>m[1]),['black','cycle','blackhole']);
});
test('the black hole uses a night palette, a bounded animation clock and its own rendering pass',t=>{
  const start=sampleSkybox('blackhole',0);
  assert.equal(normaliseSkybox('blackhole'),'blackhole');assert.equal(start.blackHole,1);assert.equal(start.sunVisibility,0);
  assert.deepEqual(sampleSkybox('blackhole',600),start);assert.deepEqual(sampleSkybox('blackhole',NaN),start);
  assert.ok(start.horizon.every(n=>n>=0&&n<.05));
  const f=fixture(t);f.setTime(100);f.renderer.setSkybox('blackhole');f.setTime(125);f.renderer.draw(f.camera,100,f.box);
  const [sky,world,glow]=f.draws;
  assert.equal(sky.uniforms.uBlackHole,1);assert.equal(sky.uniforms.uSkyTime,25);
  assert.deepEqual(sky.uniforms.uSkyAngles,[f.camera.yaw,f.camera.pitch]);assert.deepEqual(sky.uniforms.uSkyScale,world.uniforms.uScale);
  assert.deepEqual(world.uniforms.uSkyHorizon,start.horizon);assert.equal(glow.uniforms.uFogGain,0);
  f.renderer.setBoxes([f.box]);f.renderer.setSkybox('blackhole');f.draws.length=0;f.setTime(140);f.renderer.draw(f.camera);
  assert.equal(f.draws[0].uniforms.uSkyTime,40);
  f.renderer.setSkybox('cycle');f.draws.length=0;f.renderer.draw(f.camera);
  assert.equal(f.draws[0].uniforms.uBlackHole,0);assert.equal(f.draws[0].uniforms.uSkyTime,0);
  f.renderer.setSkybox('black');f.draws.length=0;f.renderer.draw(f.camera);assert.equal(f.draws.length,1);
});
test('the twenty-minute cycle has four distinct phases, an orbiting sun and an opposite moon',()=>{
  assert.equal(DAY_NIGHT_CYCLE_SECONDS,1200);
  const phases=[0,300,600,900].map(time=>sampleSkybox('cycle',time));
  assert.equal(new Set(phases.map(p=>p.zenith.join(','))).size,4);
  assert.ok(phases[1].sunDirection[1]>.85);assert.equal(phases[1].sunVisibility,1);assert.equal(phases[1].moonVisibility,0);
  assert.ok(phases[3].moonDirection[1]>.85);assert.equal(phases[3].moonVisibility,1);assert.equal(phases[3].sunVisibility,0);
  assert.equal(phases[1].stars,0);assert.equal(phases[3].stars,1);
  for(let second=0;second<1200;second+=13){
    const frame=sampleSkybox('cycle',second);
    assert.ok(Math.abs(Math.hypot(...frame.sunDirection)-1)<1e-12);
    assert.deepEqual(frame.moonDirection,frame.sunDirection.map(n=>-n));
    for(const key of ['zenith','horizon','ground','cloud','sun'])assert.ok(frame[key].every(n=>Number.isFinite(n)&&n>=0&&n<=1));
  }
});
test('palettes, stars, clouds and celestial motion blend smoothly at phase boundaries and the loop',()=>{
  const numbers=frame=>Object.values(frame).flat().filter(n=>typeof n==='number').slice(0,-1);
  for(const boundary of [0,300,600,900,1200]){
    const before=numbers(sampleSkybox('cycle',boundary-.001)),after=numbers(sampleSkybox('cycle',boundary+.001));
    assert.ok(before.every((n,i)=>Math.abs(n-after[i])<.0001),'no jump at '+boundary);
  }
  for(const time of [0,42.5,300,899,1199])assert.deepEqual(sampleSkybox('cycle',time),sampleSkybox('cycle',time+1200));
  assert.deepEqual(sampleSkybox('cycle',NaN),sampleSkybox('cycle',0));
  assert.notDeepEqual(sampleSkybox('cycle',150).cloudOffset,sampleSkybox('cycle',0).cloudOffset);
});
test('default black keeps the original clear colour and skips the sky rendering pass',t=>{
  const f=fixture(t);f.renderer.draw(f.camera);
  assert.equal(f.renderer.skybox,'black');assert.deepEqual(f.gl.background,[0,0,0,1]);
  assert.equal(f.programs.length,1,'default mode does not compile an unused sky program');
  assert.equal(f.draws.length,1);assert.equal(f.draws[0].sky,false);assert.equal(f.draws[0].uniforms.uFogGain,0);
});
test('every cycle phase draws behind geometry with matching camera, lens and distance haze',t=>{
  const f=fixture(t);
  f.renderer.setSkybox('cycle');
  for(const time of [0,300,600,900]) for(const fov of [80,100,120]) {
    f.setTime(time);f.draws.length=0;f.renderer.draw(f.camera,fov);
    const [sky,world]=f.draws;
    assert.equal(f.draws.length,2);assert.equal(sky.sky,true);assert.equal(world.sky,false);
    assert.deepEqual(sky.uniforms.uSkyAngles,world.uniforms.uAngles);assert.deepEqual(sky.uniforms.uSkyScale,world.uniforms.uScale);
    assert.deepEqual(sky.uniforms.uHorizon,sampleSkybox('cycle',time).horizon);
    assert.deepEqual(sky.uniforms.uHorizon,world.uniforms.uSkyHorizon);
    assert.deepEqual(sky.uniforms.uSunDirection,sampleSkybox('cycle',time).sunDirection);
    assert.deepEqual(sky.uniforms.uMoonDirection,sampleSkybox('cycle',time).moonDirection);
    assert.equal(sky.depth,false);assert.equal(sky.writeDepth,false);assert.equal(world.depth,true);assert.equal(world.writeDepth,true);
    assert.equal(sky.pointers.get(0),2);assert.equal(world.pointers.get(0),3);
    assert.deepEqual([...world.enabled].sort(),[0,1,2,3,4]);assert.equal(world.uniforms.uFogGain,1);
  }
  assert.equal(f.programs.length,2,'the cycle reuses the same shader');
  f.renderer.setBoxes([f.box]);assert.equal(f.renderer.skybox,'cycle');
  f.renderer.setSkybox('invalid');f.draws.length=0;f.renderer.draw(f.camera);
  assert.equal(f.renderer.skybox,'black');assert.equal(f.draws.length,1);
});
test('the cycle starts when enabled and keeps its clock across maps, previews and repeated selection',t=>{
  const f=fixture(t);f.setTime(100);f.renderer.setSkybox('cycle');f.renderer.draw(f.camera);
  assert.equal(f.draws[0].uniforms.uSkyTime,0);
  f.setTime(400);f.renderer.setBoxes([f.box]);f.renderer.setSkybox('cycle');f.draws.length=0;f.renderer.draw(f.camera);
  assert.equal(f.draws[0].uniforms.uSkyTime,300);
  f.setTime(1300);f.draws.length=0;f.renderer.draw(f.camera);
  assert.equal(f.draws[0].uniforms.uSkyTime,0);
  f.renderer.setSkybox('black');f.setTime(2000);f.renderer.setSkybox('cycle');f.draws.length=0;f.renderer.draw(f.camera);
  assert.equal(f.draws[0].uniforms.uSkyTime,0);
  assert.equal(f.programs.length,2);
});
test('blue checkpoint glow stays additive and is not tinted by sky fog',t=>{
  const f=fixture(t);f.renderer.setSkybox('cycle');f.renderer.draw(f.camera,100,f.box);
  const [sky,world,glow]=f.draws;
  assert.equal(sky.sky,true);assert.equal(world.uniforms.uFogGain,1);
  assert.equal(glow.uniforms.uFogGain,0);assert.equal(glow.blend,true);assert.equal(glow.writeDepth,false);
  f.draws.length=0;f.renderer.draw(f.camera);
  assert.equal(f.draws[1].writeDepth,true);assert.equal(f.draws[1].blend,false);
});
test('optional box lighting follows the sky source while shadows and checkpoints keep separate controls',t=>{
  const f=fixture(t);f.renderer.draw(f.camera,100,f.box,f.camera);
  assert.equal(f.renderer.shaders,false);assert.equal(f.draws[0].uniforms.uShadersGain,0);assert.equal(f.draws[0].uniforms.uShadowOpacity,0);
  f.renderer.setShaders(true);f.renderer.setSkybox('cycle');f.setTime(300);f.draws.length=0;
  const player={x:0,y:0,z:0,duckAmount:0};f.renderer.draw(f.camera,100,f.box,player);
  const [sky,world,glow]=f.draws;
  assert.equal(world.uniforms.uShadersGain,1);assert.deepEqual(world.uniforms.uLightDirection,sky.uniforms.uSunDirection);
  assert.ok(world.uniforms.uShadowOpacity>0);assert.equal(world.uniforms.uPlayerShadow[1],0);
  assert.equal(world.pointers.get(3),3);assert.equal(world.pointers.get(4),1);
  assert.equal(glow.uniforms.uShadersGain,0);assert.equal(glow.uniforms.uFogGain,0);assert.equal(glow.blend,true);
  f.draws.length=0;f.renderer.draw(f.camera);assert.equal(f.draws[1].uniforms.uShadersGain,1);assert.equal(f.draws[1].uniforms.uShadowOpacity,0,'gallery cameras have no player shadow');
  f.setTime(900);f.draws.length=0;f.renderer.draw(f.camera,100,null,player);
  assert.deepEqual(f.draws[1].uniforms.uLightDirection,f.draws[0].uniforms.uMoonDirection);
  f.renderer.setSkybox('blackhole');f.draws.length=0;f.renderer.draw(f.camera,100,null,player);
  assert.equal(f.renderer.shaders,true);assert.ok(f.draws[1].uniforms.uLightDirection[1]>0);assert.ok(f.draws[1].uniforms.uShadowOpacity>0);
  f.renderer.setShaders(false);f.draws.length=0;f.renderer.draw(f.camera,100,null,player);
  assert.equal(f.draws[1].uniforms.uShadersGain,0);assert.equal(f.draws[1].uniforms.uShadowOpacity,0);
});
test('favicon contains all browser icon sizes and is copied unchanged into the public build',()=>{
  const ico=readFileSync(new URL('../dist/favicon.ico',import.meta.url));
  assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);
  const sizes=[];
  for(let i=0;i<ico.readUInt16LE(4);i++) {
    const entry=6+i*16,size=ico[entry]||256,bytes=ico.readUInt32LE(entry+8),offset=ico.readUInt32LE(entry+12);
    sizes.push(size);assert.ok(offset+bytes<=ico.length);assert.equal(ico.subarray(offset+1,offset+4).toString(),'PNG');
  }
  assert.deepEqual(sizes,[16,32,48,64,128,256]);assert.deepEqual(readFileSync(new URL('../favicon.ico',import.meta.url)),ico);
  for(const file of ['index.html','movement-lab.html'])assert.match(readFileSync(new URL('../'+file,import.meta.url),'utf8'),/rel="icon" href="favicon.ico"/);
});

test('ladders render as cyan rails and rungs on all four climbable faces',t=>{
 const f=fixture(t);
 for(const normal of [[0,0,1],[0,0,-1],[1,0,0],[-1,0,0]]) {
  const z=normal[2]!==0;
  f.renderer.setBoxes([{min:[0,0,0],max:z?[80,240,2]:[2,240,80],ladder:true,normal}]);
  const mesh=f.uploads.at(-1);assert.ok(mesh.length>36*11*2,'individual rungs must accompany the two rails');
  assert.ok(mesh.every(Number.isFinite));
  for(let i=0;i<mesh.length;i+=11){
    assert.ok(mesh[i+5]>mesh[i+3]&&mesh[i+4]>mesh[i+3],'rungs must be cyan rather than grey');
    assert.equal(Math.hypot(...mesh.slice(i+7,i+10)),1,'every face has a unit surface normal');
  }
 }
});
