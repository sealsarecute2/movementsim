import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as physics from '../dist/physics.js';
import * as course from '../dist/course.js';

// Exercise the real app event handlers with a browser API test double. Rendering
// is stubbed here; these checks verify capture, pause and error behavior only.
function boot() {
  function element() {
    const listeners=new Map(),classes=new Set();
    return {textContent:'',innerHTML:'',style:{},disabled:false,
      classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),
        contains:k=>classes.has(k),toggle:(k,on)=>on?classes.add(k):classes.delete(k)},
      addEventListener:(name,fn)=>listeners.set(name,fn),
      fire:(name,event={})=>listeners.get(name)?.(event),focus(){}};
  }
  const elements=new Map(),document=element(),window=element();
  document.getElementById=id=>{
    if(!elements.has(id))elements.set(id,element());
    return elements.get(id);
  };
  document.querySelectorAll=()=>[];document.body=element();document.pointerLockElement=null;
  const canvas=document.getElementById('world');let requests=0,lastCamera;
  canvas.requestPointerLock=()=>{requests++;};
  document.exitPointerLock=()=>{document.pointerLockElement=null;document.fire('pointerlockchange');};
  const context=vm.createContext({...physics,...course,document,window,
    performance:{now:()=>0},localStorage:{getItem:()=>null,setItem(){}},
    requestAnimationFrame(){},createRenderer:()=>({setBoxes(){},draw:p=>lastCamera=p})});
  const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
  vm.runInContext(source,context);
  return {context,document,window,canvas,element:id=>document.getElementById(id),
    requests:()=>requests,camera:()=>lastCamera,
    lock(){document.pointerLockElement=canvas;document.fire('pointerlockchange');}};
}
test('Enter waits for capture, then mouse movement looks without dragging',()=>{
  const app=boot();app.element('play').fire('click');
  assert.equal(app.requests(),1);
  assert.equal(app.document.body.classList.contains('playing'),false);
  assert.equal(app.element('play').disabled,true);
  app.lock();
  assert.equal(app.document.body.classList.contains('playing'),true);
  assert.equal(app.element('overlay').classList.contains('hidden'),true);
  app.document.fire('mousemove',{movementX:100,movementY:0});
  app.context.frame(16);
  assert.ok(app.camera().yaw>0.07,'captured mouse movement must turn the camera without a pressed button');
});
test('Esc releases capture and pauses; resume captures again',()=>{
  const app=boot();app.element('play').fire('click');app.lock();
  app.document.fire('keydown',{code:'Escape'});
  assert.equal(app.document.pointerLockElement,null);
  assert.equal(app.document.body.classList.contains('playing'),false);
  assert.equal(app.element('overlay').classList.contains('hidden'),false);
  app.element('play').fire('click');app.lock();
  assert.equal(app.requests(),2);assert.equal(app.document.body.classList.contains('playing'),true);
});
test('capture rejection keeps the menu usable and permits retry',async()=>{
  const app=boot();app.canvas.requestPointerLock=()=>Promise.reject(new Error('blocked'));
  app.element('play').fire('click');await Promise.resolve();
  assert.equal(app.element('play').disabled,false);
  assert.equal(app.document.body.classList.contains('playing'),false);
  assert.equal(app.element('overlay').classList.contains('hidden'),false);
  assert.match(app.element('input-note').textContent,/blocked/);
  app.canvas.requestPointerLock=()=>{};app.element('play').fire('click');app.lock();
  assert.equal(app.document.body.classList.contains('playing'),true);
});
test('losing focus cancels a pending capture and a late grant cannot start play',()=>{
  const app=boot();app.element('play').fire('click');app.window.fire('blur');app.lock();
  assert.equal(app.document.pointerLockElement,null);
  assert.equal(app.document.body.classList.contains('playing'),false);
  assert.equal(app.element('play').disabled,false);
});
