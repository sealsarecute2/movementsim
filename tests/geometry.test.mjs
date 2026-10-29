import test from 'node:test';
import assert from 'node:assert/strict';
import {makeConvexBrush,convexFaces,boxPlanes,brushSurface,buildBrushMesh,safeGeometrySpawn,brushHullOverlap,brushCheckpointVolumes} from '../dist/geometry.js';
import {createPlayer,step,support,PRESETS,DT} from '../dist/physics.js';
import {sourceTriggerCrossing,createSourceRuntime} from '../dist/source-runtime.js';
import {hydrateParkourMap,makeImportedGeometryMap} from '../dist/parkour-map.js';
const close=(a,b,tolerance=1e-5)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const ramp=()=>makeConvexBrush([...boxPlanes({min:[-200,-100,-100],max:[200,100,100]}),{normal:[-.25,1,0],distance:0}]);
const cylinder=()=>makeConvexBrush([{normal:[0,1,0],distance:0},{normal:[0,-1,0],distance:64},...Array.from({length:12},(_,i)=>({normal:[Math.cos(i*Math.PI/6),0,Math.sin(i*Math.PI/6)],distance:64}))]);

test('clipped convex faces preserve ramps and polygonal cylinders with outward normals',()=>{
 for(const [brush,count] of [[ramp(),6],[cylinder(),14]]){
  const faces=convexFaces(brush);assert.equal(faces.length,count);
  for(const face of faces){
   for(const point of face.points)for(const p of brush.planes)assert.ok(point.reduce((v,n,i)=>v+n*p.normal[i],0)<=p.distance+1e-5);
   const [a,b,c]=face.points,ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i]);
   const cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
   assert.ok(cross.reduce((v,n,i)=>v+n*face.normal[i],0)>0);
  }
 }
 close(ramp().max[1],50);
});

test('rendered triangles follow the real ramp surface and use its sloping normal',()=>{
 const brush=ramp(),mesh=buildBrushMesh(brush);assert.equal(mesh.length%33,0);
 let slopeVertices=0;
 for(let i=0;i<mesh.length;i+=11){
  const [x,y,z]=mesh.slice(i,i+3);
  assert.ok(brush.planes.every(p=>x*p.normal[0]+y*p.normal[1]+z*p.normal[2]<=p.distance+1e-5));
  if(mesh[i+7]<-.2&&mesh[i+8]>.9){close(y,.25*x);slopeVertices++;}
 }
 assert.ok(slopeVertices>=6);
});

test('walking up and down a ramp stays grounded without repeated landing events',()=>{
 for(const direction of [-1,1]){
  const brush=ramp(),x=direction>0?-120:120,p=createPlayer({x,y:.25*(x+16),z:0,yaw:direction*Math.PI/2});
  for(let i=0;i<200;i++){step(p,{forward:1},[brush],PRESETS.practice);assert.ok(p.grounded);close(p.y,.25*(p.x+16));assert.equal(p.landTime,-10);}
  assert.ok(Math.abs(p.x-x)>100);
 }
});

test('jumps leave sloping ground and land at the hull contact rather than the bounding-box top',()=>{
 const brush=ramp(),p=createPlayer({x:0,y:4,z:0,yaw:0});step(p,{jumpPressed:true},[brush]);
 assert.ok(!p.grounded&&p.vy>0&&p.y>4);
 for(let i=0;i<250;i++)step(p,{},[brush]);
 assert.ok(p.grounded);close(p.y,.25*(p.x+16));assert.ok(p.y<10);assert.ok(support(p,[brush]));
});

test('cylindrical platforms do not support their empty bounding-box corners',()=>{
 const brush=cylinder();
 assert.equal(brushSurface(brush,80,80),null);
 const miss=createPlayer({x:80,y:2,z:80,yaw:0});miss.grounded=false;
 for(let i=0;i<128;i++)step(miss,{},[brush]);
 assert.ok(!miss.grounded&&miss.y<0);
 const hit=createPlayer({x:0,y:100,z:0,yaw:0});hit.grounded=false;
 for(let i=0;i<256;i++)step(hit,{},[brush]);assert.ok(hit.grounded);close(hit.y,0);
});

test('high-speed movement cannot tunnel through a thin diagonal wall',()=>{
 const c=Math.SQRT1_2,normal=[c,0,c],tangent=[c,0,-c];
 const wall=makeConvexBrush([{normal,distance:2},{normal:normal.map(v=>-v),distance:2},{normal:tangent,distance:300},{normal:tangent.map(v=>-v),distance:300},{normal:[0,1,0],distance:200},{normal:[0,-1,0],distance:100}]);
 const p=createPlayer({x:-120,y:20,z:-120,yaw:0});p.grounded=false;p.vx=p.vz=12000;
 step(p,{},[wall],PRESETS.practice,DT);
 assert.ok((p.x+p.z)*c<=-2-32*c+1e-4);assert.ok(!brushHullOverlap(p,wall));
});

test('shape checkpoints reject empty corners and sweep crossings over a sloping face',()=>{
 const brush=ramp(),volumes=brushCheckpointVolumes(brush);
 assert.equal(volumes.length,1);
 assert.ok(sourceTriggerCrossing({x:-250,y:20,z:0},{x:250,y:20,z:0},volumes[0],0,0));
 const round=cylinder();assert.ok(!brushCheckpointVolumes(round).some(v=>sourceTriggerCrossing({x:60,y:20,z:60},{x:60,y:20,z:60},v,0,0)));
 assert.ok(brushCheckpointVolumes(round).some(v=>sourceTriggerCrossing({x:0,y:20,z:0},{x:0,y:20,z:0},v,0,0)));
});

test('local geometry keeps large floors and slopes and survives checkpoint JSON restore',()=>{
 const floor={min:[-2000,-120,-2000],max:[2000,-100,2000]},brush=ramp();
 const source={id:'local-map',title:'Shape test',revision:2,boxes:[floor,brush],spawns:[{x:0,y:12,z:0,yaw:0}]};
 const map=makeImportedGeometryMap(source);assert.equal(map.boxes.length,2);assert.ok(map.importedGeometry);close(map.spawns[0].y,4);
 assert.equal(map.checkpointPads[0],0);assert.ok(support(createPlayer(map.spawns[0]),map.boxes));
 const restored=hydrateParkourMap(JSON.parse(JSON.stringify(map,(key,value)=>key==='sourceMap'?undefined:value)));
 const p=createPlayer(restored.spawns[0]);for(let i=0;i<100;i++)step(p,{},restored.boxes);close(p.y,4);assert.ok(p.grounded);
 assert.ok(createSourceRuntime(restored));
 const roof={min:[-2100,30,-2100],max:[2100,70,2100]};
 assert.throws(()=>safeGeometrySpawn(source.spawns[0],[floor,brush,roof]),/standing space/);
});

test('malformed planes and open shapes are rejected instead of creating giant fake platforms',()=>{
 for(const planes of [[{normal:[NaN,0,0],distance:0},...boxPlanes({min:[-1,-1,-1],max:[1,1,1]})],boxPlanes({min:[-1,-1,-1],max:[1,1,1]}).slice(1)])assert.throws(()=>makeConvexBrush(planes));
 const shape=ramp();assert.throws(()=>hydrateParkourMap({boxes:[{...shape,planes:[{normal:[0,0,0],distance:0}]}],spawns:[{x:0,y:0,z:0,yaw:0}],stages:[{}],checkpointPads:[0],finishPad:null,sectionFalls:[-100]}));
});

test('a finish on a shared large floor only completes near the finish destination',()=>{
 const floor={min:[-2000,-120,-2000],max:[2000,0,2000]};
 const map=makeImportedGeometryMap({id:'local-map',title:'Shared floor',boxes:[floor],spawns:[{x:0,y:8,z:0,yaw:0}],finish:{x:600,y:8,z:0,yaw:0}});
 assert.equal(map.finishPad,0);assert.ok(map.finishArea);const runtime=createSourceRuntime(map),p=createPlayer(map.spawns[0]);
 assert.deepEqual(runtime.step(p,{...p},DT),[]);p.x=600;assert.ok(runtime.step(p,{...p},DT).some(e=>e.type==='finish'));
});

test('simple uploaded boost and teleport volumes remain usable after shape conversion and JSON restore',()=>{
 const boxes=[{min:[-2000,-120,-2000],max:[2000,0,2000]}],destination={x:500,y:8,z:0,yaw:0,pitch:0};
 const source={id:'local-map',title:'Triggers',boxes,spawns:[{x:0,y:8,z:0,yaw:0}],destinations:new Map([['reset',destination]]),triggers:[
  {classname:'trigger_push',min:[-30,0,-30],max:[30,30,30],pushdir:'-90 0 0',speed:'1000'},
  {classname:'trigger_teleport',min:[180,0,-30],max:[220,60,30],target:'reset'},
  {classname:'trigger_teleport',min:[480,0,-30],max:[520,60,30],target:'reset'},
 ]};
 const map=hydrateParkourMap(JSON.parse(JSON.stringify(makeImportedGeometryMap(source),(key,value)=>key==='sourceMap'?undefined:value)));
 const runtime=createSourceRuntime(map),p=createPlayer(map.spawns[0]);runtime.step(p,{...p},.01);assert.ok(p.vy>9);
 p.x=200;const events=runtime.step(p,{...p},.01);assert.equal(events[0].type,'teleport');assert.equal(p.x,500);assert.equal(p.y,8);assert.equal(p.vy,0);
 assert.deepEqual(runtime.step(p,{...p},.01),[],'cooldown prevents a destination teleport loop');
});
