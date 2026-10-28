import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SKYBOXES, normaliseSkybox } from '../dist/skybox.js';
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
    getAttribLocation:(p,name)=>({aPosition:0,aColor:1,aTop:2,aClip:0})[name],
    enableVertexAttribArray:loc=>enabled.add(loc),disableVertexAttribArray:loc=>enabled.delete(loc),
    vertexAttribPointer:(loc,count)=>pointers.set(loc,count),getUniformLocation:(program,name)=>({program,name}),
    uniform1f:(u,x)=>{u.program.uniforms[u.name]=x;},uniform2f:(u,...v)=>{u.program.uniforms[u.name]=v;},uniform3f:(u,...v)=>{u.program.uniforms[u.name]=v;},
    enable:cap=>{if(cap===8)depth=true;if(cap===9)blend=true;},disable:cap=>{if(cap===8)depth=false;if(cap===9)blend=false;},
    depthMask:value=>{writeDepth=value;},clearColor(...value){this.background=value;},clear(){},viewport(){},blendFunc(){},
    drawArrays(mode,first,count){draws.push({sky:current.shaders.some(s=>s.source.includes('attribute vec2 aClip')),count,
      uniforms:structuredClone(current.uniforms),depth,writeDepth,blend,pointers:new Map(pointers),enabled:new Set(enabled)});},
  };
  const canvas={clientWidth:1280,clientHeight:720,width:0,height:0,getContext:()=>gl};
  const box={min:[-100,-20,-100],max:[100,0,100]},renderer=createRenderer(canvas,[box]);
  const camera={x:0,y:0,z:80,yaw:.6,pitch:.2,duckAmount:0};
  return {renderer,camera,box,gl,draws,programs,uploads};
}

test('black is the default and all four named skies have distinct palettes',()=>{
  assert.deepEqual(Object.keys(SKYBOXES),['black','dawn','midday','dusk','midnight']);
  for(const value of [undefined,null,'unknown','__proto__',3])assert.equal(normaliseSkybox(value),'black');
  for(const name of ['dawn','midday','dusk','midnight'])assert.equal(normaliseSkybox(name),name);
  assert.equal(new Set(Object.values(SKYBOXES).map(p=>p.zenith.join(','))).size,5);
});
test('default black keeps the original clear colour and skips the sky rendering pass',t=>{
  const f=fixture(t);f.renderer.draw(f.camera);
  assert.equal(f.renderer.skybox,'black');assert.deepEqual(f.gl.background,[0,0,0,1]);
  assert.equal(f.programs.length,1,'default mode does not compile an unused sky program');
  assert.equal(f.draws.length,1);assert.equal(f.draws[0].sky,false);assert.equal(f.draws[0].uniforms.uFogGain,0);
});
test('each sky draws behind geometry with matching camera angles, FOV and aspect ratio',t=>{
  const f=fixture(t);
  for(const name of ['dawn','midday','dusk','midnight']) for(const fov of [80,100,120]) {
    f.renderer.setSkybox(name);f.draws.length=0;f.renderer.draw(f.camera,fov);
    const [sky,world]=f.draws;
    assert.equal(f.draws.length,2);assert.equal(sky.sky,true);assert.equal(world.sky,false);
    assert.deepEqual(sky.uniforms.uSkyAngles,world.uniforms.uAngles);assert.deepEqual(sky.uniforms.uSkyScale,world.uniforms.uScale);
    assert.deepEqual(sky.uniforms.uHorizon,SKYBOXES[name].horizon);
    assert.equal(sky.depth,false);assert.equal(sky.writeDepth,false);assert.equal(world.depth,true);assert.equal(world.writeDepth,true);
    assert.equal(sky.pointers.get(0),2);assert.equal(world.pointers.get(0),3);
    assert.deepEqual([...world.enabled].sort(),[0,1,2]);assert.equal(world.uniforms.uFogGain,1);
  }
  assert.equal(f.programs.length,2,'switching sky presets reuses the same shader');
  f.renderer.setBoxes([f.box]);assert.equal(f.renderer.skybox,'midnight');
  f.renderer.setSkybox('invalid');f.draws.length=0;f.renderer.draw(f.camera);
  assert.equal(f.renderer.skybox,'black');assert.equal(f.draws.length,1);
});
test('blue checkpoint glow stays additive and is not tinted by sky fog',t=>{
  const f=fixture(t);f.renderer.setSkybox('dawn');f.renderer.draw(f.camera,100,f.box);
  const [sky,world,glow]=f.draws;
  assert.equal(sky.sky,true);assert.equal(world.uniforms.uFogGain,1);
  assert.equal(glow.uniforms.uFogGain,0);assert.equal(glow.blend,true);assert.equal(glow.writeDepth,false);
  f.draws.length=0;f.renderer.draw(f.camera);
  assert.equal(f.draws[1].writeDepth,true);assert.equal(f.draws[1].blend,false);
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
  const mesh=f.uploads.at(-1);assert.ok(mesh.length>36*7*2,'individual rungs must accompany the two rails');
  assert.ok(mesh.every(Number.isFinite));
  for(let i=0;i<mesh.length;i+=7)assert.ok(mesh[i+5]>mesh[i+3]&&mesh[i+4]>mesh[i+3],'rungs must be cyan rather than grey');
 }
});
