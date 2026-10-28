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

export function mapScreenshotCamera(map) {
  const visible=map.boxes.filter(b=>!b.roof&&!b.ladder&&!b.obstacle).slice(0,9);
  const left=Math.min(...visible.map(b=>b.min[0])),right=Math.max(...visible.map(b=>b.max[0]));
  const near=Math.max(...visible.map(b=>b.max[2])),far=Math.min(...visible.map(b=>b.min[2]));
  const top=Math.max(...visible.map(b=>b.max[1]));
  const x=(left+right)/2,z=(near+far)/2,extent=Math.max(650,(near-far)*.65,(right-left)*1.1);
  const eye={x:x-extent*.85,y:top+extent*.8,z:z+extent*.7};
  return {...eye,y:eye.y-64,yaw:Math.atan2(x-eye.x,eye.z-z),
    pitch:Math.atan2(top-eye.y,Math.hypot(x-eye.x,z-eye.z)),duckAmount:0};
}

// Capture one real WebGL frame, then restore the player's geometry and sky.
// Images are generated once per visit, without extra WebGL contexts or downloads.
export function captureMapScreenshot({renderer,canvas,map,restoreBoxes,restoreSkybox,skybox='dawn',snapshot}) {
  try {
    renderer.setBoxes(map.boxes);renderer.setSkybox(skybox);
    renderer.draw(mapScreenshotCamera(map),85,map.boxes.find(b=>b.checkpoint)||map.boxes.find(b=>b.finish));
    const context=snapshot.getContext('2d');
    if(!context)return null;
    const ratio=Math.min(1,1200/Math.max(canvas.width,canvas.height));
    snapshot.width=Math.max(1,Math.round(canvas.width*ratio));snapshot.height=Math.max(1,Math.round(canvas.height*ratio));
    context.drawImage(canvas,0,0,snapshot.width,snapshot.height);
    return snapshot.toDataURL('image/jpeg',.88);
  } finally {
    renderer.setBoxes(restoreBoxes);renderer.setSkybox(restoreSkybox);
  }
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
