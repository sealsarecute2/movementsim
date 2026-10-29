import test from 'node:test';
import assert from 'node:assert/strict';
import {galleryCaptureSize,galleryShadowMatrix,galleryShadowNormalMatrix} from '../dist/gallery-renderer.js';
import {MAP_LIST} from '../dist/course.js';

test('gallery captures supersample within device and memory limits, with a sharp 1920-pixel output',()=>{
 for(const aspect of [.35,.8,1,16/9,3,NaN])for(const maxEdge of [1024,2048,3072]){
  const size=galleryCaptureSize(aspect,maxEdge);
  assert.ok(size.width<=maxEdge&&size.height<=maxEdge);
  assert.ok(size.width*size.height<=5*1024*1024);
  assert.ok(size.outputWidth<=size.width&&size.outputHeight<=size.height);
  if(maxEdge>=2048)assert.equal(Math.max(size.outputWidth,size.outputHeight),1920);
 }
});
test('shadow receiver planes stay aligned with their surfaces at every PCF sample',()=>{
 const matrix=galleryShadowMatrix(MAP_LIST[0].boxes,[-.45,.85,.27]),normal=galleryShadowNormalMatrix(matrix);
 for(let axis=0;axis<3;axis++)for(let tangent=0;tangent<3;tangent++)if(axis!==tangent){
  const dot=[0,1,2].reduce((sum,row)=>sum+normal[axis*3+row]*matrix[tangent*4+row],0);
  assert.ok(Math.abs(dot)<1e-6,'light-space normal remains perpendicular to a surface tangent');
 }
});
test('directional shadow cameras contain every map corner and stay finite with an overhead light',()=>{
 for(const map of MAP_LIST)for(const light of [[-.45,.85,.27],[0,1,0],[.7,.2,-.4]]){
  const matrix=galleryShadowMatrix(map.boxes,light);assert.ok([...matrix].every(Number.isFinite));
  for(const box of map.boxes)for(const x of [box.min[0],box.max[0]])for(const y of [box.min[1],box.max[1]])for(const z of [box.min[2],box.max[2]]){
   for(let row=0;row<3;row++)assert.ok(Math.abs(matrix[row]*x+matrix[row+4]*y+matrix[row+8]*z+matrix[row+12])<1,'shadow volume contains the geometry');
  }
 }
});
