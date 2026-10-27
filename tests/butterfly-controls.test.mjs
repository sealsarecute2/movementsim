import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AnimationClip, Object3D } from '../dist/vendor/three/build/three.module.js';

// Resolve the browser's import-map alias to the same vendored Three.js in Node.
const threeUrl=new URL('../dist/vendor/three/build/three.module.js',import.meta.url);
const source=readFileSync(new URL('../dist/butterfly/butterfly-controller.js',import.meta.url),'utf8')
  .replace("from 'three';",`from ${JSON.stringify(threeUrl.href)};`);
const { ButterflyController }=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const advance=(controller,seconds)=>{
  for(let remaining=seconds;remaining>1e-9;remaining-=1/120)controller.update(Math.min(remaining,1/120));
};
function surface() {
  const listeners=new Map();
  return {
    addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
    removeEventListener(name,fn){listeners.get(name)?.delete(fn);},
    fire(name,values={}){for(const fn of listeners.get(name)||[])fn({target:{},preventDefault(){},stopImmediatePropagation(){},...values});},
  };
}
function setup() {
  const states=[],clips=Object.entries({draw:.12,idle:.4,light_1:.2,light_2:.2,heavy:.35,inspect:1,inspect_rare:1.2})
    .map(([name,duration])=>new AnimationClip(name,duration,[]));
  const controller=new ButterflyController(new Object3D(),clips,{onStateChange:event=>states.push(event.state)});
  controller.equip();advance(controller,.2);
  const target=surface(),document=surface(),canvas=surface();canvas.ownerDocument=document;
  let active=true;
  const unbind=controller.bindControls({canvas,target,isActive:()=>active});
  return {controller,states,target,document,canvas,unbind,setActive:value=>active=value};
}
test('holding left click alternates full swings and release stops repetition',()=>{
  const {controller:c,states,target,canvas}=setup();
  canvas.fire('mousedown',{button:0});const first=c.activeAction;
  advance(c,.1);assert.equal(c.activeAction,first);assert.ok(first.time>0);
  advance(c,.65);
  assert.deepEqual(states.filter(name=>name.startsWith('light')),['light_1','light_2','light_1','light_2']);
  target.fire('mouseup',{button:0});const count=states.length;
  advance(c,1);assert.equal(c.category,'idle');
  assert.equal(states.slice(count).some(name=>name.startsWith('light')),false);
  c.dispose();
});
test('holding right click repeats heavy attacks at the existing animation cadence',()=>{
  const {controller:c,states,target,canvas}=setup();
  canvas.fire('mousedown',{button:2});advance(c,1.1);
  assert.equal(states.filter(name=>name==='heavy').length,4);
  target.fire('mouseup',{button:2});advance(c,.5);assert.equal(c.category,'idle');c.dispose();
});
test('the most recently pressed attack takes priority and releasing it resumes the other held button',()=>{
  const {controller:c,target,canvas}=setup();
  canvas.fire('mousedown',{button:0});canvas.fire('mousedown',{button:2});
  assert.equal(c.category,'light','a second button cannot interrupt the current swing');
  advance(c,.25);assert.equal(c.category,'heavy');
  target.fire('mouseup',{button:2});advance(c,.4);assert.equal(c.category,'light');
  target.fire('mouseup',{button:0});advance(c,.3);assert.equal(c.category,'idle');c.dispose();
});
test('blur, cancellation, lost capture, hidden tabs, disabling, re-equipping and unbinding clear held attacks',()=>{
  for(const stop of [
    h=>h.target.fire('blur'),h=>h.target.fire('pointercancel'),
    h=>{h.setActive(false);h.document.fire('pointerlockchange');},
    h=>{h.document.hidden=true;h.document.fire('visibilitychange');},
    h=>{h.controller.enabled=false;h.controller.update(.01);h.controller.enabled=true;},
    h=>h.controller.equip(),h=>h.unbind(),
  ]) {
    const h=setup();h.canvas.fire('mousedown',{button:0});stop(h);
    assert.equal(h.controller.heldAttacks.size,0);
    const count=h.states.length;h.setActive(true);advance(h.controller,1);
    assert.equal(h.states.slice(count).some(name=>name.startsWith('light')),false);
    assert.equal(h.controller.category,'idle');h.controller.dispose();
  }
});
test('pressing outside active play does not queue an attack and inspect can be interrupted by a held attack',()=>{
  const h=setup();h.setActive(false);h.canvas.fire('mousedown',{button:0});
  assert.equal(h.controller.heldAttacks.size,0);
  h.setActive(true);h.controller.inspect({variant:'rare'});h.canvas.fire('mousedown',{button:0});
  assert.equal(h.controller.category,'light');advance(h.controller,.5);
  assert.ok(h.states.filter(name=>name.startsWith('light')).length>=3);h.controller.dispose();
});
