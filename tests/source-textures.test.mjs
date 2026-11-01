import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadSourceMap} from '../dist/source-map.js';
import {base64ToBytes,bytesToBase64,decodeVtf} from '../dist/source-textures.js';
import {prepareCustomRoomMap,decodeCustomRoomMap} from '../dist/room-map.js';

const archive=readFileSync(new URL('../dist/maps/bhop_lego.zip',import.meta.url));

test('custom imports default to geometry-only even when the archive includes textures',async()=>{
  const map=await loadSourceMap(archive,{id:'local-map',title:'Untextured'});
  assert.equal(map.textureMeshes,undefined);
  assert.ok(map.boxes.length>100);
});

test('opt-in loads embedded Source textures without changing the original collision geometry',async()=>{
  const grey=await loadSourceMap(archive,{id:'local-map',title:'Grey'});
  const textured=await loadSourceMap(archive,{id:'local-map',title:'Textured',includeTextures:true});
  assert.equal(textured.boxes.length,grey.boxes.length);
  assert.deepEqual(textured.spawns,grey.spawns);
  assert.ok(textured.textureMeshes.length>10);
  for(const entry of textured.textureMeshes){
    assert.ok(entry.material.length>0);
    assert.ok(['png','jpeg','webp','vtf'].includes(entry.type));
    assert.equal(base64ToBytes(entry.vertices).length%72,0);
    assert.ok(base64ToBytes(entry.image).length>0);
  }
  const vtfs=textured.textureMeshes.filter(entry=>entry.type==='vtf');
  assert.ok(vtfs.length>10);
  for(const entry of vtfs){
    const image=decodeVtf(base64ToBytes(entry.image));
    assert.equal(image.pixels.length,image.width*image.height*4);
    assert.ok(image.pixels.some(pixel=>pixel!==0));
  }
  const prepared=await prepareCustomRoomMap(textured,'Multiplayer test');
  const transferred=await decodeCustomRoomMap(prepared.bytes,prepared.descriptor);
  assert.equal(transferred.textureMeshes.length,textured.textureMeshes.length);
  assert.deepEqual(transferred.spawns,textured.spawns);
});

test('base64 serialization and texture validation reject malformed assets',()=>{
  assert.deepEqual(base64ToBytes(bytesToBase64(Uint8Array.of(0,128,255))),Uint8Array.of(0,128,255));
  assert.throws(()=>decodeVtf(Uint8Array.of(1,2,3)),/Invalid VTF/);
});

test('both custom map upload screens expose unchecked texture options',()=>{
  const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
  for(const id of ['source-map-textures','room-map-textures']){
    assert.match(html,new RegExp('id="'+id+'" type="checkbox"'));
    assert.doesNotMatch(html,new RegExp('id="'+id+'"[^>]*checked'));
    assert.ok(app.includes("$('"+id+"').checked"));
  }
});
