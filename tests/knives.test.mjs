import test from 'node:test';
import assert from 'node:assert/strict';
import { KNIFE_LIST,KNIVES,DEFAULT_KNIFE,buildKnife,triangulateBlade,inspectDuration,inspectPose,createInspectController } from '../dist/knives.js';
import { knifeMatrices } from '../dist/viewmodel.js';
import { createRenderer } from '../dist/renderer.js';

test('the catalog includes 20 vanilla knife types and both default knives',()=>{
  assert.equal(KNIFE_LIST.length,22);assert.equal(new Set(KNIFE_LIST.map(k=>k.id)).size,22);
  assert.ok(KNIVES['default-ct']&&KNIVES['default-t']&&KNIVES.butterfly&&KNIVES.kukri);
});
test('curved and hooked blade triangulations preserve the full blade area',()=>{
  for(const k of KNIFE_LIST){
    const area=(a,b,c)=>Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
    const polygon=Math.abs(k.profile.reduce((s,p,i)=>{const q=k.profile[(i+1)%k.profile.length];return s+p[0]*q[1]-p[1]*q[0];},0))/2;
    const triangles=triangulateBlade(k.profile);assert.equal(triangles.length,k.profile.length-2);
    const sum=triangles.reduce((s,t)=>s+area(...t.map(i=>k.profile[i])),0);
    assert.ok(Math.abs(sum-polygon)<1e-8,k.name);
  }
});
test('all knife and glove meshes have finite positions, unit normals and valid materials',()=>{
  for(const k of KNIFE_LIST){const meshes=buildKnife(k.id);
    for(const [name,mesh] of Object.entries(meshes).filter(([key])=>['main','free','hand'].includes(key))){
      assert.equal(mesh.length%33,0,`${k.name} ${name} must contain triangles`);
      for(let i=0;i<mesh.length;i+=11){
        for(let j=0;j<11;j++)assert.ok(Number.isFinite(mesh[i+j]),k.name);
        assert.ok(Math.abs(Math.hypot(mesh[i+3],mesh[i+4],mesh[i+5])-1)<.0001,k.name);
        assert.ok(mesh[i+9]>=0&&mesh[i+9]<=1);assert.ok(mesh[i+10]>0&&mesh[i+10]<=1);
      }
    }
    assert.ok(meshes.main.length>1000);if(k.id==='butterfly')assert.ok(meshes.free.length>1000);
  }
});
test('inspect poses remain finite, return to idle and use separate butterfly and dual-dagger parts',()=>{
  for(const k of KNIFE_LIST){
    const duration=inspectDuration(k.id);
    for(let frame=0;frame<=Math.ceil(duration*60);frame++){
      const pose=inspectPose(k.id,frame/60),matrices=knifeMatrices(k.id,pose,{time:frame/60,playing:true,grounded:true,speed:250});
      assert.equal(matrices.length,k.dual?2:1);
      for(const m of matrices)for(const key of ['main','free','hand'])assert.ok(m[key].every(Number.isFinite),`${k.name} frame ${frame}`);
    }
    const idle=inspectPose(k.id,duration+1);assert.equal(idle.active,false);
    assert.ok([...idle.offset,...idle.rotation].every(value=>Math.abs(value)<1e-10));
  }
  const butterfly=inspectPose('butterfly',.8);assert.ok(Math.abs(butterfly.hinge)>.1);
  const matrices=knifeMatrices('butterfly',butterfly);assert.notDeepEqual(matrices[0].main,matrices[0].free);
});
test('inspect repeat protection, equipping and cancelling keep animation state predictable',()=>{
  const controller=createInspectController();assert.equal(controller.knife,DEFAULT_KNIFE);
  assert.equal(controller.inspect(10),true);assert.equal(controller.inspect(10.1),false);
  assert.equal(controller.inspect(15),true);assert.equal(controller.equip('butterfly'),true);
  assert.equal(controller.knife,'butterfly');assert.equal(controller.equip('invalid'),false);
  assert.equal(controller.inspect(16),true);controller.cancel();assert.equal(controller.pose(16).active,false);
});

// Validate buffer sizes, active attribute layouts and uniform ownership as the
// real world renderer switches to the viewmodel pass and back on later frames.
function mockGL(){
  let current=null,bound=null,created=0;const enabled=new Set(),pointers=new Map(),draws=[];
  const gl={ARRAY_BUFFER:1,FLOAT:2,STATIC_DRAW:3,TRIANGLES:4,DEPTH_TEST:5,
    COLOR_BUFFER_BIT:0x4000,DEPTH_BUFFER_BIT:0x0100,VERTEX_SHADER:6,FRAGMENT_SHADER:7,
    COMPILE_STATUS:8,LINK_STATUS:9,MAX_VERTEX_ATTRIBS:10,
    createShader:type=>({type}),shaderSource:(s,source)=>s.source=source,compileShader(){},getShaderParameter:()=>true,
    createProgram:()=>({attributes:new Map()}),attachShader(){},linkProgram(){},getProgramParameter:()=>true,
    useProgram:p=>{current=p;},getParameter:()=>8,
    getAttribLocation:(p,name)=>{if(!p.attributes.has(name))p.attributes.set(name,p.attributes.size);return p.attributes.get(name);},
    getUniformLocation:(p,name)=>({program:p,name}),
    createBuffer:()=>{created++;return{};},bindBuffer:(_,b)=>{bound=b;},bufferData:(_,data)=>{bound.data=data;},
    enableVertexAttribArray:i=>enabled.add(i),disableVertexAttribArray:i=>enabled.delete(i),
    vertexAttribPointer:(i,size,type,normal,stride,offset)=>pointers.set(i,{buffer:bound,size,stride,offset}),
    enable(){},clearColor(){},clear(){},viewport(){},deleteBuffer(){},deleteProgram(){},
    drawArrays:(_,first,count)=>{
      for(const i of enabled){const a=pointers.get(i);assert.ok(a&&a.buffer?.data);
        assert.ok(a.offset+(first+count-1)*a.stride+a.size*4<=a.buffer.data.byteLength,`attribute ${i} overruns its buffer`);}
      draws.push({attributes:enabled.size,count});
    }};
  for(const name of ['uniform2f','uniform3f','uniformMatrix4fv'])gl[name]=(location,...values)=>{
    assert.equal(location.program,current,'uniforms must belong to the active shader');
    for(const value of values)if(typeof value==='number')assert.ok(Number.isFinite(value));
    if(name==='uniformMatrix4fv')assert.ok([...values[1]].every(Number.isFinite));
  };
  return{gl,draws,buffers:()=>created};
}
test('world and knife rendering keep valid GPU state across every knife and map change',()=>{
  const previous=globalThis.window;globalThis.window={devicePixelRatio:1};
  try{
    const state=mockGL(),canvas={getContext:()=>state.gl,clientWidth:1280,clientHeight:720,width:0,height:0};
    const floor=[{min:[-100,-100,-100],max:[100,0,100],label:'TEST'}];
    const renderer=createRenderer(canvas,floor),player={x:0,y:0,z:0,yaw:0,pitch:0,duckAmount:0,vx:0,vz:250,grounded:true};
    let time=performance.now()/1000+1;
    for(const k of KNIFE_LIST){renderer.setKnife(k.id);renderer.inspect();
      renderer.draw(player,100,{time:time+=.1,playing:true});
      renderer.setBoxes([...floor,...floor]);renderer.draw(player,90,{time:time+=.1,playing:true});
      renderer.cancelInspect();
    }
    assert.ok(state.draws.some(d=>d.attributes===3));assert.ok(state.draws.some(d=>d.attributes===5));
    const buffers=state.buffers();renderer.setKnife(DEFAULT_KNIFE);assert.equal(state.buffers(),buffers,'re-equipping must reuse cached meshes');
    assert.ok(buffers<=46,'GPU mesh cache must be bounded by the catalog size');
  }finally{globalThis.window=previous;}
});
