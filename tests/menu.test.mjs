import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_LIST, COMMUNITY_MAPS } from '../dist/course.js';
import { mapPreviewSVG, createGalleryEntries, mapScreenshotCamera, captureMapScreenshot, createMenuSlideshow } from '../dist/menu.js';

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
test('the expanded gallery includes 15 distinct views, all native maps and both community previews',()=>{
 const entries=createGalleryEntries(MAP_LIST,COMMUNITY_MAPS);assert.equal(entries.length,15);
 assert.equal(new Set(entries.map(e=>e.title)).size,15);
 for(const map of MAP_LIST){
  const views=entries.filter(e=>e.map===map);assert.equal(views.length,map.timed?3:2);
  const cameras=views.map(e=>mapScreenshotCamera(map,e.view));assert.ok(cameras.every(c=>Object.values(c).every(Number.isFinite)));
  assert.equal(new Set(cameras.map(c=>JSON.stringify(c))).size,views.length);
 }
 assert.deepEqual(entries.filter(e=>e.thumbnail).map(e=>e.thumbnail),COMMUNITY_MAPS.map(m=>m.thumbnail));
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
  assert.equal(args.snapshot.width,1920);assert.equal(args.snapshot.height,1080);
  assert.deepEqual(calls.find(c=>c[0]==='encode'),['encode','image/webp',.95]);
  assert.equal(calls.at(-2)[1],originalBoxes);assert.deepEqual(calls.at(-1),['sky','black']);
  args.canvas={width:1080,height:3840};captureMapScreenshot(args);
  assert.equal(args.snapshot.height,1920);assert.ok(args.snapshot.width<1920);
});
test('gallery uses the selected cycling sky without toggling it off or selecting removed presets',()=>{
  const {args,calls}=shotFixture();
  captureMapScreenshot({...args,skybox:'cycle',restoreSkybox:'cycle'});
  assert.deepEqual(calls.filter(c=>c[0]==='sky'),[['sky','cycle'],['sky','cycle']]);
});
test('later-section slides use a different camera and highlight the next checkpoint for that section',()=>{
 const {args,calls}=shotFixture(),view={section:1,side:-1};captureMapScreenshot({...args,view});
 const draw=calls.find(c=>c[0]==='draw');assert.deepEqual(draw[1],mapScreenshotCamera(args.map,{...view,aspect:3840/2160}));assert.equal(draw[3].checkpoint,2);
});
test('captures use the menu panel shape and flip offscreen pixels upright before downsampling',()=>{
 const {args,calls}=shotFixture(),frames=[];let created=0;
 const raster={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:image=>frames.push([...image.data])};
 args.snapshot.ownerDocument={createElement:()=>{created++;return {getContext:()=>raster};}};
 args.renderer.capture=(camera,fov,target,aspect)=>{calls.push(['capture',camera,fov,target,aspect]);return {width:1,height:2,outputWidth:1,outputHeight:1,pixels:new Uint8Array([1,2,3,255,5,6,7,255])};};
 captureMapScreenshot({...args,aspect:.8});captureMapScreenshot({...args,aspect:.8});
 assert.equal(created,1,'reuse the staging canvas');assert.deepEqual(frames[0],[5,6,7,255,1,2,3,255]);
 assert.equal(calls.filter(c=>c[0]==='draw').length,0);assert.equal(calls.find(c=>c[0]==='capture')[4],.8);
 assert.equal(args.snapshot.width,1);assert.equal(args.snapshot.height,1);
 assert.deepEqual(calls.at(-1),['sky','black']);
});
test('camera framing keeps each featured section inside portrait and landscape panels with room for the slide motion',()=>{
 for(const entry of createGalleryEntries(MAP_LIST).filter(e=>e.map))for(const aspect of [.55,1,2.2]){
  const camera=mapScreenshotCamera(entry.map,{...entry.view,aspect}),platforms=entry.map.boxes.filter(b=>!b.roof&&!b.ladder&&!b.obstacle);
  const first=entry.view.start??(entry.view.section?Math.max(0,platforms.findIndex(b=>b.checkpoint===entry.view.section)):0);
  for(const box of platforms.slice(first,first+(entry.view.count||5)))for(const x of [box.min[0],box.max[0]])for(const y of [box.min[1],box.max[1]])for(const z of [box.min[2],box.max[2]]){
   const dx=x-camera.x,dy=y-camera.y-64,dz=z-camera.z,forward=dx*Math.sin(camera.yaw)-dz*Math.cos(camera.yaw);
   const depth=forward*Math.cos(camera.pitch)+dy*Math.sin(camera.pitch),tanV=Math.tan(72*Math.PI/360)*.75;
   const horizontal=(dx*Math.cos(camera.yaw)+dz*Math.sin(camera.yaw))/(depth*tanV*aspect);
   const vertical=(dy*Math.cos(camera.pitch)-forward*Math.sin(camera.pitch))/(depth*tanV);
   assert.ok(depth>0&&Math.abs(horizontal)<.9&&Math.abs(vertical)<.9,entry.title+' fits '+aspect);
  }
 }
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
  gallery.step(6500);assert.equal(gallery.current,1);assert.equal(title.textContent,MAP_LIST[1].title);
  assert.equal(count.textContent,'02 / '+String(MAP_LIST.length).padStart(2,'0'));assert.equal(slides[0]['aria-hidden'],'true');
  gallery.step(7000,false);gallery.step(30000);assert.equal(gallery.current,1);
  gallery.step(36500);assert.equal(gallery.current,2);
  gallery.show(MAP_LIST.length-1);gallery.next();assert.equal(gallery.current,0);
  gallery.previous();assert.equal(gallery.current,MAP_LIST.length-1);
});
test('reduced motion disables automatic slideshow movement and leaves manual controls usable',()=>{
  const {gallery}=slideshow(true);gallery.step(0);gallery.step(50000);
  assert.equal(gallery.current,0);gallery.next();assert.equal(gallery.current,1);
});
