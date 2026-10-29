// Render the actual collision geometry as a compact, horizontal top-down route.
export function mapPreviewSVG(map) {
  const platforms=map.boxes.filter(box=>!box.roof&&!box.obstacle&&!box.ladder);
  const minX=Math.min(...platforms.map(b=>b.min[0])),maxX=Math.max(...platforms.map(b=>b.max[0]));
  const minZ=Math.min(...platforms.map(b=>b.min[2])),maxZ=Math.max(...platforms.map(b=>b.max[2]));
  const scale=Math.min(288/Math.max(1,maxZ-minZ),76/Math.max(1,maxX-minX));
  const x=z=>160+((minZ+maxZ)/2-z)*scale,y=x=>50+(x-(minX+maxX)/2)*scale;
  const route=platforms.map(b=>`${x((b.min[2]+b.max[2])/2)},${y((b.min[0]+b.max[0])/2)}`).join(' ');
  const shapes=map.boxes.map((b,i)=>`<rect x="${x(b.max[2])}" y="${y(b.min[0])}" width="${Math.max(.7,(b.max[2]-b.min[2])*scale)}" height="${Math.max(.7,(b.max[0]-b.min[0])*scale)}" class="${b.ladder?'preview-ladder':b.obstacle&&!b.roof?'preview-wall':b.roof?'preview-roof':b.finish?'preview-finish':b.checkpoint?'preview-checkpoint':i===0?'preview-start':'preview-platform'}"/>`).join('');
  return `<svg viewBox="0 0 320 100" aria-hidden="true" focusable="false"><path d="M0 25H320M0 50H320M0 75H320M40 0V100M80 0V100M120 0V100M160 0V100M200 0V100M240 0V100M280 0V100" class="preview-grid"/><polyline points="${route}" class="preview-route"/>${shapes}<circle cx="${x(map.spawns[0].z)}" cy="${y(map.spawns[0].x)}" r="2" class="preview-spawn"/></svg>`;
}

export function createGalleryEntries(maps,community=[]) {
  return [...maps.flatMap(map=>[
    {title:map.title,map,view:map.id==='free'?{start:1,count:4}:{count:5}},
    ...(map.timed?[
      {title:map.title+' / Section 2',map,view:{section:1,count:4,side:-1}},
      {title:map.title+' / Final section',map,view:{section:map.spawns.length-1,count:4}},
    ]:[{title:map.title+(map.endless?' / Checkpoint run':' / Ladder tower'),map,view:map.endless?{section:1,side:-1}:{start:6,count:2,side:-1}}]),
  ]),...community.map(map=>({title:map.title+' / Route preview',thumbnail:map.thumbnail}))];
}

export function mapScreenshotCamera(map,{section=0,start=null,count=5,side=1,aspect=1,fov=72}={}) {
  const platforms=map.boxes.filter(b=>!b.roof&&!b.ladder&&!b.obstacle);
  const first=start??(section?Math.max(0,platforms.findIndex(b=>b.checkpoint===section)):0);
  const visible=platforms.slice(first,first+count);
  const left=Math.min(...visible.map(b=>b.min[0])),right=Math.max(...visible.map(b=>b.max[0]));
  const near=Math.max(...visible.map(b=>b.max[2])),far=Math.min(...visible.map(b=>b.min[2]));
  const top=Math.max(...visible.map(b=>b.max[1])),bottom=Math.min(...visible.map(b=>b.min[1]));
  const centre=[(left+right)/2,(top+bottom)/2,(near+far)/2],length=Math.hypot(.9,.85,1),out=[-.9*side/length,.85/length,1/length];
  const yaw=Math.atan2(-out[0],out[2]),pitch=Math.atan2(-out[1],Math.hypot(out[0],out[2]));
  const r=[Math.cos(yaw),0,Math.sin(yaw)],u=[-Math.sin(yaw)*Math.sin(pitch),Math.cos(pitch),Math.cos(yaw)*Math.sin(pitch)];
  const tanV=Math.tan(fov*Math.PI/360)*.75,tanH=tanV*Math.max(.35,Math.min(3,Number.isFinite(aspect)?aspect:1));
  let distance=280;
  for(const box of visible)for(const x of [box.min[0],box.max[0]])for(const y of [box.min[1],box.max[1]])for(const z of [box.min[2],box.max[2]]){
    const p=[x-centre[0],y-centre[1],z-centre[2]],depth=-p.reduce((sum,n,i)=>sum+n*out[i],0);
    const horizontal=Math.abs(p.reduce((sum,n,i)=>sum+n*r[i],0)),vertical=Math.abs(p.reduce((sum,n,i)=>sum+n*u[i],0));
    distance=Math.max(distance,horizontal/(tanH*.78)-depth,vertical/(tanV*.68)-depth);
  }
  distance*=1.03;
  return {x:centre[0]+out[0]*distance,y:centre[1]+out[1]*distance-64,z:centre[2]+out[2]*distance,
    yaw,pitch:pitch-.035,duckAmount:0};
}

const galleryCaptureSurfaces=new WeakMap();
// Capture once at the menu panel's aspect ratio, then restore the game renderer.
export function captureMapScreenshot({renderer,canvas,map,view={},aspect=1,restoreBoxes,restoreSkybox,skybox='black',snapshot}) {
  try {
    renderer.setBoxes(map.boxes);renderer.setSkybox(skybox);
    const context=snapshot.getContext('2d');if(!context)return null;
    const target=map.boxes.find(b=>b.checkpoint===(view.section||0)+1)||map.boxes.find(b=>b.finish);
    let frame=null;
    try{if(snapshot.ownerDocument)frame=renderer.capture?.(mapScreenshotCamera(map,{...view,aspect}),72,target,aspect);}catch{}
    if(frame){
      let surface=galleryCaptureSurfaces.get(snapshot);
      if(!surface){surface=snapshot.ownerDocument.createElement('canvas');galleryCaptureSurfaces.set(snapshot,surface);}
      surface.width=frame.width;surface.height=frame.height;
      const raster=surface.getContext('2d'),image=raster.createImageData(frame.width,frame.height),row=frame.width*4;
      for(let y=0;y<frame.height;y++)image.data.set(frame.pixels.subarray((frame.height-1-y)*row,(frame.height-y)*row),y*row);
      raster.putImageData(image,0,0);snapshot.width=frame.outputWidth;snapshot.height=frame.outputHeight;
      context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(surface,0,0,snapshot.width,snapshot.height);
    }else{
      const fallbackAspect=canvas.clientWidth/canvas.clientHeight||canvas.width/canvas.height||1;
      renderer.draw(mapScreenshotCamera(map,{...view,aspect:fallbackAspect}),72,target);
      const ratio=Math.min(1,1920/Math.max(canvas.width,canvas.height));
      snapshot.width=Math.max(1,Math.round(canvas.width*ratio));snapshot.height=Math.max(1,Math.round(canvas.height*ratio));
      context.drawImage(canvas,0,0,snapshot.width,snapshot.height);
    }
    return snapshot.toDataURL('image/webp',.95);
  }finally{renderer.setBoxes(restoreBoxes);renderer.setSkybox(restoreSkybox);}
}

// A single animation clock keeps the gallery asleep while a run is active.
export function createMenuSlideshow({slides,maps,title,count,reducedMotion=false}) {
  let current=0,previous=null;
  function show(index) {
    current=(index+slides.length)%slides.length;previous=null;
    slides.forEach((slide,i)=>{
      slide.classList.toggle('is-active',i===current);
      slide.setAttribute('aria-hidden',String(i!==current));
    });
    title.textContent=maps[current].title;
    count.textContent=`${String(current+1).padStart(2,'0')} / ${String(slides.length).padStart(2,'0')}`;
  }
  show(0);
  return {show,next(){show(current+1);},previous(){show(current-1);},
    step(now,active=true) {
      if(!active||reducedMotion) {previous=null;return;}
      if(previous===null)previous=now;
      else if(now-previous>=6500)show(current+1);
    },get current(){return current;}};
}
