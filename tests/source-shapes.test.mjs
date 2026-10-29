import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSourceMap,parseSourceBsp} from '../dist/source-map.js';
import {makeConvexBrush,boxPlanes,brushSurface} from '../dist/geometry.js';
import {createPlayer,step,PRESETS,support} from '../dist/physics.js';
// Small actual BSP binary fixtures exercise the complete upload parser. All
// authored coordinates here use the simulator axes; the writer converts them.
const toSource=v=>[v[0],-v[2],v[1]];
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-4,`${a} != ${b}`);
function bspFixture(brushes,{spawn=[0,8,0],entity=null}={}) {
 const chunks=new Map(),encode=new TextEncoder();
 const entityText=e=>'{'+Object.entries(e).map(([k,v])=>`"${k}" "${v}"`).join('\n')+'}\n';
 chunks.set(0,encode.encode(entityText({classname:'worldspawn'})+entityText({classname:'info_player_start',origin:toSource(spawn).join(' '),angles:'0 90 0'})+(entity?entityText({classname:'func_brush',model:'*1',...entity}):'')+'\0'));
 const planeList=brushes.flatMap(b=>b),planes=new Uint8Array(planeList.length*20),pv=new DataView(planes.buffer);
 const putVec=(view,offset,vec)=>vec.forEach((n,i)=>view.setFloat32(offset+i*4,n,true));
 planeList.forEach((p,i)=>{putVec(pv,i*20,toSource(p.normal));pv.setFloat32(i*20+12,p.distance,true);});chunks.set(1,planes);
 const sides=new Uint8Array(planeList.length*8),sv=new DataView(sides.buffer);
 planeList.forEach((p,i)=>{sv.setUint16(i*8,i,true);sv.setInt16(i*8+2,-1,true);});chunks.set(19,sides);
 let first=0;const brushBytes=new Uint8Array(brushes.length*12),bv=new DataView(brushBytes.buffer);
 brushes.forEach((b,i)=>{bv.setInt32(i*12,first,true);bv.setInt32(i*12+4,b.length,true);bv.setInt32(i*12+8,1,true);first+=b.length;});chunks.set(18,brushBytes);
 const count=entity?2:1,models=new Uint8Array(count*48),mv=new DataView(models.buffer),leaves=new Uint8Array(count*32),lv=new DataView(leaves.buffer);
 for(let i=0;i<count;i++){
  const assigned=entity?(i===0?brushes.slice(0,-1):brushes.slice(-1)):brushes;
  const shapes=assigned.map(b=>makeConvexBrush(b)),min=[0,1,2].map(a=>Math.min(...shapes.map(b=>b.min[a]))),max=[0,1,2].map(a=>Math.max(...shapes.map(b=>b.max[a])));
  putVec(mv,i*48,toSource(min));putVec(mv,i*48+12,toSource(max));mv.setInt32(i*48+36,-i-1,true);
  lv.setUint16(i*32+24,i===0?0:brushes.length-1,true);lv.setUint16(i*32+26,assigned.length,true);
 }
 chunks.set(14,models);chunks.set(10,leaves);
 const refs=new Uint8Array(brushes.length*2),rv=new DataView(refs.buffer);brushes.forEach((b,i)=>rv.setUint16(i*2,i,true));chunks.set(17,refs);
 let size=1036;for(const bytes of chunks.values())size+=bytes.length;
 const result=new Uint8Array(size),view=new DataView(result.buffer);result.set([86,66,83,80]);view.setInt32(4,20,true);
 let offset=1036;for(const [index,bytes] of chunks){view.setInt32(8+index*16,offset,true);view.setInt32(12+index*16,bytes.length,true);if(index===10)view.setInt32(16+index*16,1,true);result.set(bytes,offset);offset+=bytes.length;}
 return result;
}
const floor=()=>boxPlanes({min:[-3000,-120,-3000],max:[3000,-100,3000]});
const sloping=()=>[...boxPlanes({min:[-256,-100,-128],max:[256,128,128]}),{normal:[-.25,1,0],distance:0}];

test('uploading a BSP preserves sloping and large geometry and chooses the actual starting surface',async()=>{
 const map=await loadSourceMap(bspFixture([floor(),sloping()],{spawn:[0,12,0]}));
 assert.ok(map.importedGeometry);assert.equal(map.boxes.length,2);assert.ok(map.boxes[0].planes);close(map.spawns[0].y,4);
 close(map.boxes.find(b=>b.min[0]<-2000).max[0],3000);
 const p=createPlayer(map.spawns[0]);for(let i=0;i<128;i++)step(p,{forward:1},map.boxes,PRESETS.practice);
 assert.ok(p.grounded);assert.ok(support(p,map.boxes));
});

test('a slanted brush without six axial bounding planes is no longer silently dropped',()=>{
 const c=Math.SQRT1_2,brush=[{normal:[c,0,c],distance:100},{normal:[-c,0,-c],distance:100},{normal:[c,0,-c],distance:60},{normal:[-c,0,c],distance:60},{normal:[0,1,0],distance:0},{normal:[0,-1,0],distance:32}];
 const map=parseSourceBsp(bspFixture([floor(),brush]));assert.equal(map.boxes.length,2);
 const shape=map.boxes[1];close(shape.max[0],160*c);close(shape.min[2],-160*c);assert.ok(brushSurface(shape,0,0));
});

test('brush entity rotation and origin transform collision and bounds together',()=>{
 const platform=boxPlanes({min:[-160,-32,-48],max:[160,0,48]});
 const map=parseSourceBsp(bspFixture([floor(),platform],{entity:{origin:'400 200 100',angles:'0 45 0'}}));
 const brush=map.boxes[1];close(brush.min[0],400-208*Math.SQRT1_2);close(brush.max[0],400+208*Math.SQRT1_2);
 close(brush.min[2],-200-208*Math.SQRT1_2);close(brush.max[1],100);assert.ok(brush.planes.some(p=>Math.abs(p.normal[0])>.5&&Math.abs(p.normal[2])>.5));
 const surface=brushSurface(brush,400,-200);close(surface.height,100);
 assert.equal(brushSurface(brush,brush.max[0]-1,brush.max[2]-1),null);
});

test('walking across adjoining coplanar convex brushes does not catch on their seam',()=>{
 const a=makeConvexBrush([...boxPlanes({min:[-400,-120,-100],max:[0,100,100]}),{normal:[-.25,1,0],distance:0}]);
 const b=makeConvexBrush([...boxPlanes({min:[0,-120,-100],max:[400,100,100]}),{normal:[-.25,1,0],distance:0}]);
 const p=createPlayer({x:-90,y:.25*(-90+16),z:0,yaw:Math.PI/2});
 for(let i=0;i<200;i++)step(p,{forward:1},[a,b],PRESETS.practice);
 assert.ok(p.x>50);assert.ok(p.grounded);close(p.y,.25*(p.x+16));
});
