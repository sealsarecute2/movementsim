import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleSceneLight,projectPlayerShadow} from '../dist/lighting.js';
import {sampleSkybox,BLACK_HOLE_DIRECTION} from '../dist/skybox.js';

const floor={min:[-1000,-20,-1000],max:[1000,0,1000]};
const vertical={direction:[0,1,0],power:1};
test('lighting follows the visible sun, moon and black hole and stays fixed on black',()=>{
  const day=sampleSkybox('cycle',300),night=sampleSkybox('cycle',900);
  const sunlight=sampleSceneLight('cycle',day),moonlight=sampleSceneLight('cycle',night);
  assert.deepEqual(sunlight.direction,day.sunDirection);assert.deepEqual(moonlight.direction,night.moonDirection);
  assert.ok(sunlight.power>moonlight.power&&moonlight.power>0);assert.ok(sunlight.colour[0]>moonlight.colour[0]);
  assert.deepEqual(sampleSceneLight('blackhole',sampleSkybox('blackhole')).direction,BLACK_HOLE_DIRECTION);
  assert.deepEqual(sampleSceneLight('black',sampleSkybox('black',0)),sampleSceneLight('black',sampleSkybox('black',800)));
});
test('light fades at the horizon and ambient lighting stays continuous through dawn and dusk',()=>{
  for(const boundary of [0,600,1200]){
    const before=sampleSceneLight('cycle',sampleSkybox('cycle',boundary-.001));
    const after=sampleSceneLight('cycle',sampleSkybox('cycle',boundary+.001));
    assert.ok(before.power<1e-6&&after.power<1e-6);
    assert.ok(before.ambient.every((n,i)=>Math.abs(n-after.ambient[i])<1e-5));
  }
});
test('the circular player shadow projects away from the light onto the ground',()=>{
  const shadow=projectPlayerShadow({x:0,y:100,z:0},[floor],{direction:[.6,.8,0],power:1});
  assert.ok(Math.abs(shadow.x+96)<1e-9);assert.equal(shadow.y,0);assert.equal(shadow.z,0);
  const grounded=projectPlayerShadow({x:0,y:0,z:0},[floor],vertical);
  assert.ok(shadow.radius>grounded.radius);assert.ok(shadow.opacity<grounded.opacity);
});
test('only the nearest lower platform receives the player shadow; ceilings and ladders do not',()=>{
  const pad={min:[-100,20,-100],max:[100,50,100]},ceiling={min:[-100,140,-100],max:[100,150,100]};
  const shadow=projectPlayerShadow({x:0,y:100,z:0},[floor,ceiling,{...ceiling,ladder:true},pad],vertical);
  assert.equal(shadow.y,50);
  assert.equal(projectPlayerShadow({x:0,y:100,z:0},[ceiling,{...floor,ladder:true}],vertical),null);
});
test('the blob can touch a platform edge but disappears over empty space',()=>{
  const pad={min:[-20,-20,-20],max:[20,0,20]};
  assert.ok(projectPlayerShadow({x:30,y:0,z:0},[pad],vertical));
  assert.equal(projectPlayerShadow({x:50,y:0,z:0},[pad],vertical),null);
});
test('shadow projection safely handles no player, grazing light, darkness and distant floors',()=>{
  const player={x:0,y:0,z:0};
  assert.equal(projectPlayerShadow(null,[floor],vertical),null);
  assert.equal(projectPlayerShadow(player,[floor],{direction:[1,.001,0],power:1}),null);
  assert.equal(projectPlayerShadow(player,[floor],{...vertical,power:0}),null);
  assert.equal(projectPlayerShadow({x:NaN,y:0,z:0},[floor],vertical),null);
  assert.equal(projectPlayerShadow({x:0,y:1000,z:0},[floor],vertical),null);
  assert.ok(projectPlayerShadow({...player,duckAmount:1},[floor],vertical).radius<projectPlayerShadow(player,[floor],vertical).radius);
});
