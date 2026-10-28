import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_LIST } from '../dist/course.js';
import { mapPreviewSVG, mapScreenshotCamera, captureMapScreenshot, createMenuSlideshow } from '../dist/menu.js';

test('top-down previews draw every actual platform, distinguish roofs, and fit their viewport',()=>{
  for(const map of MAP_LIST.filter(m=>m.timed)) {
    const svg=mapPreviewSVG(map);
    assert.equal([...svg.matchAll(/<rect /g)].length,map.boxes.length,map.title);
    assert.match(svg,/preview-start/);assert.match(svg,/preview-finish/);
    assert.ok(!/NaN|Infinity/.test(svg));
    for(const [,x,y,w,h] of svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)) {
      assert.ok(+x>=0&&+y>=0&&+x+ +w<=320&&+y+ +h<=100,map.title);
    }
    if(map.boxes.some(b=>b.roof))assert.match(svg,/preview-roof/);
  }
});
test('each screenshot camera faces the actual course from above with a finite perspective',()=>{
  for(const map of MAP_LIST.filter(m=>m.timed)) {
    const camera=mapScreenshotCamera(map);
    assert.ok(Object.values(camera).every(Number.isFinite));
    assert.ok(camera.pitch<0&&camera.pitch>-Math.PI/2);
    assert.ok(camera.y+64>Math.max(...map.boxes.slice(0,9).map(b=>b.max[1])));
  }
});
function shotFixture() {
  const calls=[],originalBoxes=[{original:true}];
  const renderer={setBoxes(value){calls.push(['boxes',value]);},setSkybox(value){calls.push(['sky',value]);},draw(...args){calls.push(['draw',...args]);}};
  const snapshot={getContext:()=>({drawImage(...args){calls.push(['copy',...args]);}}),toDataURL:(...args)=>{calls.push(['encode',...args]);return 'data:image/jpeg;base64,real-frame';}};
  const args={renderer,canvas:{width:3840,height:2160},map:MAP_LIST[0],restoreBoxes:originalBoxes,restoreSkybox:'black',snapshot};
  return {args,calls,originalBoxes};
}
test('gallery captures a real renderer frame once, bounds its image size, and restores player geometry and sky',()=>{
  const {args,calls,originalBoxes}=shotFixture();
  assert.equal(captureMapScreenshot(args),'data:image/jpeg;base64,real-frame');
  assert.deepEqual(calls.map(c=>c[0]),['boxes','sky','draw','copy','encode','boxes','sky']);
  assert.equal(calls[0][1],MAP_LIST[0].boxes);
  assert.deepEqual(calls[1],['sky','black']);
  assert.equal(calls[2][3],MAP_LIST[0].boxes.find(b=>b.checkpoint));
  assert.equal(args.snapshot.width,1200);assert.equal(args.snapshot.height,675);
  assert.equal(calls.at(-2)[1],originalBoxes);assert.deepEqual(calls.at(-1),['sky','black']);
  args.canvas={width:1080,height:3840};captureMapScreenshot(args);
  assert.equal(args.snapshot.height,1200);assert.ok(args.snapshot.width<1200);
});
test('gallery uses the selected cycling sky without toggling it off or selecting removed presets',()=>{
  const {args,calls}=shotFixture();
  captureMapScreenshot({...args,skybox:'cycle',restoreSkybox:'cycle'});
  assert.deepEqual(calls.filter(c=>c[0]==='sky'),[['sky','cycle'],['sky','cycle']]);
});
test('snapshot encoding failure and unavailable 2D canvas always restore the game renderer',()=>{
  const {args,calls,originalBoxes}=shotFixture();
  args.snapshot.toDataURL=()=>{throw Error('blocked');};
  assert.throws(()=>captureMapScreenshot(args),/blocked/);
  assert.equal(calls.at(-2)[1],originalBoxes);assert.deepEqual(calls.at(-1),['sky','black']);
  args.snapshot.getContext=()=>null;assert.equal(captureMapScreenshot(args),null);
  assert.equal(calls.at(-2)[1],originalBoxes);assert.deepEqual(calls.at(-1),['sky','black']);
});
function slideshow(reducedMotion=false) {
  const maps=MAP_LIST;
  const slides=maps.map(()=>({active:false,classList:{toggle(name,value){slides[slides.findIndex(s=>s.classList===this)].active=value;}},setAttribute(name,value){this[name]=value;}}));
  const title={},count={};
  return {gallery:createMenuSlideshow({slides,maps,title,count,reducedMotion}),slides,title,count};
}
test('slideshow advances, wraps, updates its caption and stops its clock outside the main menu',()=>{
  const {gallery,slides,title,count}=slideshow();
  assert.equal(gallery.current,0);assert.equal(slides.filter(s=>s.active).length,1);
  gallery.step(0);gallery.step(6499);assert.equal(gallery.current,0);
  gallery.step(6500);assert.equal(gallery.current,1);assert.equal(title.textContent,'Endless');
  assert.equal(count.textContent,'02 / 03');assert.equal(slides[0]['aria-hidden'],'true');
  gallery.step(7000,false);gallery.step(30000);assert.equal(gallery.current,1);
  gallery.step(36500);assert.equal(gallery.current,2);
  gallery.show(2);gallery.next();assert.equal(gallery.current,0);
  gallery.previous();assert.equal(gallery.current,2);
});
test('reduced motion disables automatic slideshow movement and leaves manual controls usable',()=>{
  const {gallery}=slideshow(true);gallery.step(0);gallery.step(50000);
  assert.equal(gallery.current,0);gallery.next();assert.equal(gallery.current,1);
});
