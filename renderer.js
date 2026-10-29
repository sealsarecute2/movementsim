import { sampleSkybox, normaliseSkybox, SKY_GRADIENT_GLSL, createSkyRenderer } from './skybox.js';
import { sampleSceneLight, projectPlayerShadow } from './lighting.js';
import { buildSignMesh } from './signs.js';
import { buildRemotePlayerMesh } from './players.js';
import { GALLERY_SHADOW_VERTEX, GALLERY_SHADOW_FRAGMENT, GALLERY_SHADOW_GLSL, galleryShadowMatrix, galleryShadowNormalMatrix, galleryCaptureSize, createGalleryTarget } from './gallery-renderer.js';

// The setting is horizontal FOV at 4:3; both cameras use this vertical lens.
export function verticalFov(fov = 100) {
  return 2 * Math.atan(Math.tan(fov * Math.PI / 360) * 0.75) * 180 / Math.PI;
}

export function projectWorldPoint(camera,point,width,height,fov=100) {
  const x=point.x-camera.x,y=point.y-camera.y-(64-camera.duckAmount*18),z=point.z-camera.z;
  const cy=Math.cos(camera.yaw),sy=Math.sin(camera.yaw),cp=Math.cos(camera.pitch),sp=Math.sin(camera.pitch);
  const right=x*cy+z*sy,forward=x*sy-z*cy,up=y*cp-forward*sp,depth=forward*cp+y*sp;
  if(depth<=1||Math.hypot(x,y,z)>6500)return null;
  const f=1/Math.tan(verticalFov(fov)*Math.PI/360),screenX=(.5+right*f/(width/height)/depth*.5)*width,screenY=(.5-up*f/depth*.5)*height;
  return screenX>=0&&screenX<=width&&screenY>=0&&screenY<=height?{x:screenX,y:screenY}:null;
}

export const WORLD_VERTEX_GLSL = `attribute vec3 aPosition; attribute vec3 aColor; attribute float aTop;
    attribute vec3 aNormal; attribute float aShade;
    uniform vec3 uEye; uniform vec2 uAngles; uniform vec2 uScale;
    #ifdef GALLERY_SHADOWS
    uniform mat4 uGalleryShadowMatrix; varying highp vec3 vGalleryShadow;
    #endif
    varying vec3 vWorld; varying vec3 vColor; varying vec3 vNormal; varying float vShade; varying float vTop; varying float vDistance;
    void main(){
      vec3 p=aPosition-uEye;
      float cy=cos(uAngles.x),sy=sin(uAngles.x),cp=cos(uAngles.y),sp=sin(uAngles.y);
      float right=p.x*cy+p.z*sy,forward=p.x*sy-p.z*cy;
      float up=p.y*cp-forward*sp,depth=forward*cp+p.y*sp;
      gl_Position=vec4(right*uScale.x,up*uScale.y,1.0001*depth-2.0001,depth);
      vWorld=aPosition;vColor=aColor;vNormal=aNormal;vShade=aShade;vTop=aTop;vDistance=length(p);
      #ifdef GALLERY_SHADOWS
      vGalleryShadow=(uGalleryShadowMatrix*vec4(aPosition,1.0)).xyz*0.5+0.5;
      #endif
    }`;
export const WORLD_FRAGMENT_GLSL = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform vec3 uTargetMin; uniform vec3 uTargetMax; uniform float uTargetActive;
    uniform vec3 uFogEye; uniform vec3 uSkyHorizon; uniform vec3 uSkyZenith; uniform vec3 uSkyGround; uniform float uFogGain;
    uniform vec3 uLightDirection; uniform vec3 uLightColour; uniform vec3 uAmbientColour;
    uniform float uLightPower; uniform float uShadersGain; uniform vec4 uPlayerShadow; uniform float uShadowOpacity;
    varying vec3 vWorld; varying vec3 vColor; varying vec3 vNormal; varying float vShade; varying float vTop; varying float vDistance;
    ${SKY_GRADIENT_GLSL}
    #ifdef GALLERY_SHADOWS
    ${GALLERY_SHADOW_GLSL}
    #endif
    void main(){
      vec2 grid=mod(vWorld.xz+0.6,64.0);
      float line=(1.0-step(1.2,min(grid.x,grid.y)))*vTop;
      vec3 color=vColor*abs(vShade);
      if(uShadersGain>0.5&&vShade>0.0){
        vec3 normal=normalize(vNormal);
        float diffuse=max(dot(normal,uLightDirection),0.0);
        vec3 ambient=uAmbientColour*mix(0.65,1.2,normal.y*0.5+0.5);
        vec3 halfLight=normalize(uLightDirection+normalize(uFogEye-vWorld)+vec3(0.0001));
        float gloss=pow(max(dot(normal,halfLight),0.0),28.0)*0.12*uLightPower;
        float visibility=1.0;
        #ifdef GALLERY_SHADOWS
        visibility=galleryVisibility(normal,uLightDirection);
        #endif
        color=vColor*(ambient+uLightColour*diffuse*uLightPower*visibility)+uLightColour*gloss*visibility;
        if(vTop>0.5&&uShadowOpacity>0.0&&abs(vWorld.y-uPlayerShadow.y)<0.5){
          float distance=length(vWorld.xz-uPlayerShadow.xz)/max(uPlayerShadow.w,1.0);
          float shadow=1.0-smoothstep(0.15,1.0,distance);
          color*=1.0-shadow*uShadowOpacity;
        }
      }
      color=mix(color,color*0.76,line);
      vec3 bounds=step(uTargetMin-vec3(0.01),vWorld)*step(vWorld,uTargetMax+vec3(0.6));
      float target=bounds.x*bounds.y*bounds.z*uTargetActive;
      vec3 d=min(abs(vWorld-uTargetMin),abs(uTargetMax-vWorld));
      float edge=min(max(d.x,d.y),min(max(d.x,d.z),max(d.y,d.z)));
      float glow=1.0-smoothstep(0.0,13.0,edge);
      float core=1.0-smoothstep(0.5,2.5,edge);
      color=mix(color,vec3(0.07,0.55,1.0),core*target);
      color+=vec3(0.015,0.22,0.65)*glow*target;
      float fade=1.0-smoothstep(1700.0,6500.0,vDistance);
      vec3 fog=vec3(0.0);
      if(uFogGain>0.5)fog=backgroundGradient(normalize(vWorld-uFogEye),uSkyHorizon,uSkyZenith,uSkyGround);
      gl_FragColor=vec4(mix(fog,color,fade),1.0);
    }`;

export function createRenderer(canvas, boxes, {now=()=>performance.now()}={}) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
  if (!gl) throw new Error('WebGL is unavailable. Enable hardware acceleration and reload.');
  function shader(type, source) {
    const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
    return s;
  }
  function worldPipeline(gallery=false){
    const program=gl.createProgram(),prefix=gallery?'#define GALLERY_SHADOWS\n':'';
    const shaders=[shader(gl.VERTEX_SHADER,prefix+WORLD_VERTEX_GLSL),shader(gl.FRAGMENT_SHADER,prefix+WORLD_FRAGMENT_GLSL)];
    for(const s of shaders){gl.attachShader(program,s);gl.deleteShader?.(s);}
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)){gl.deleteProgram?.(program);throw Error(gl.getProgramInfoLog(program));}
    const attributes=[['aPosition',3,0],['aColor',3,12],['aTop',1,24],['aNormal',3,28],['aShade',1,40]]
      .map(([name,count,offset])=>({loc:gl.getAttribLocation(program,name),count,offset}));
    const uniforms=Object.fromEntries(['uEye','uAngles','uScale','uTargetMin','uTargetMax','uTargetActive','uSkyHorizon','uSkyZenith','uSkyGround','uFogGain','uFogEye',
      'uLightDirection','uLightColour','uAmbientColour','uLightPower','uShadersGain','uPlayerShadow','uShadowOpacity',
      ...(gallery?['uGalleryShadowMatrix','uGalleryShadowMap','uGalleryShadowTexel','uGalleryShadowNormalMatrix']:[])].map(name=>[name,gl.getUniformLocation(program,name)]));
    return {program,attributes,uniforms};
  }
  const standardPipeline=worldPipeline();let pipeline=standardPipeline,captureState=null,galleryResources=null,galleryUnavailable=false;
  gl.useProgram(pipeline.program);
  const buffer = gl.createBuffer(), glowBuffer = gl.createBuffer(), playerBuffer=gl.createBuffer();
  for(const {loc} of pipeline.attributes)gl.enableVertexAttribArray(loc);
  function bindGeometry(targetBuffer) {
    gl.bindBuffer(gl.ARRAY_BUFFER, targetBuffer);
    for(const {loc,count,offset} of pipeline.attributes) gl.vertexAttribPointer(loc,count,gl.FLOAT,false,44,offset);
  }
  gl.enable(gl.DEPTH_TEST); gl.clearColor(0, 0, 0, 1);
  let skybox='black',skyRenderer=null,skyStarted=0,shadersEnabled=false;
  function setShaders(value) { shadersEnabled=value===true; }
  function setSkybox(value) {
    const next=normaliseSkybox(value);
    if(next!=='black'&&!skyRenderer)skyRenderer=createSkyRenderer(gl);
    if(next!=='black'&&skybox!==next)skyStarted=now();
    skybox=next;
  }
  let vertices = [], count = 0, currentBoxes = boxes;
  let glowCount = 0, glowKey = '';
  function setGlow(target) {
    const key=target?[...target.min,...target.max].join(','):'';
    if(key===glowKey) return;
    glowKey=key;glowCount=0;
    if(!target) return;
    const [x,,z]=target.min,[X,Y,Z]=target.max, y=Y+0.8;
    const data=[],bands=[[-14,0],[-5,0.16],[-1,0.65],[0,1],[1,0.65],[5,0.16],[14,0]];
    for(const [a,b,n] of [[[x,z],[X,z],[0,1]],[[X,z],[X,Z],[1,0]],[[X,Z],[x,Z],[0,1]],[[x,Z],[x,z],[1,0]]]) {
      for(let i=1;i<bands.length;i++) {
        const [d0,c0]=bands[i-1],[d1,c1]=bands[i];
        const points=[[a,d0,c0],[b,d0,c0],[b,d1,c1],[a,d1,c1]];
        for(const index of [0,1,2,0,2,3]) {
          const [p,d,c]=points[index];
          data.push(p[0]+n[0]*d,y,p[1]+n[1]*d,0.045*c,0.42*c,c,0,0,1,0,1);
        }
      }
    }
    glowCount=data.length/11;
    bindGeometry(glowBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);
  }
  function addBox(b, base = 0.46) {
    const [x,y,z]=b.min,[X,Y,Z]=b.max;
    const faces = [
      [[[x,Y,z],[x,Y,Z],[X,Y,Z],[X,Y,z]],1.12,1,[0,1,0]],
      [[[x,y,z],[X,y,z],[X,y,Z],[x,y,Z]],0.38,0,[0,-1,0]],
      [[[x,y,z],[x,y,Z],[x,Y,Z],[x,Y,z]],0.65,0,[-1,0,0]],
      [[[X,y,Z],[X,y,z],[X,Y,z],[X,Y,Z]],0.8,0,[1,0,0]],
      [[[X,y,z],[x,y,z],[x,Y,z],[X,Y,z]],0.72,0,[0,0,-1]],
      [[[x,y,Z],[X,y,Z],[X,Y,Z],[x,Y,Z]],0.87,0,[0,0,1]],
    ];
    for(const [points,shade,top,normal] of faces) for(const index of [0,1,2,0,2,3]) {
      const rgb=Array.isArray(base)?base:[base,base,base];
      vertices.push(...points[index],...rgb,top,...normal,shade);
    }
  }
  function setBoxes(next) {
    currentBoxes = next; vertices=[];
    for(const b of next) {
      if(b.sign){addBox(b,[.045,.065,.085]);vertices.push(...buildSignMesh(b));continue;}
      if(b.signPost){addBox(b,[.11,.14,.17]);continue;}
      if(b.ladder) {
        const [x,y,z]=b.min,[X,Y,Z]=b.max,n=b.normal;
        // Cyan rails and individual rungs mark the exact climbable face.
        const front=n[2]?(n[2]>0?Z:z):0,side=n[0]?(n[0]>0?X:x):0;
        const piece=(a,c)=>addBox({min:a,max:c},[.13,.64,.80]);
        if(n[2]) {
          const a=front+(n[2]>0?0:-4);
          piece([x,y,a],[x+4,Y,a+4]);piece([X-4,y,a],[X,Y,a+4]);
          for(let h=y+12;h<Y;h+=24)piece([x,h,a],[X,h+3,a+4]);
        } else {
          const a=side+(n[0]>0?0:-4);
          piece([a,y,z],[a+4,Y,z+4]);piece([a,y,Z-4],[a+4,Y,Z]);
          for(let h=y+12;h<Y;h+=24)piece([a,h,z],[a+4,h+3,Z]);
        }
        continue;
      }
      addBox(b,b.roof?0.35:0.46);
      if(b.label) {
        const cx=(b.min[0]+b.max[0])/2, top=b.max[1]+0.12;
        const start=b.min[2]+20, end=b.max[2]-20;
        // White threshold strips and lane markings remain ordinary untextured boxes.
        for(const z of b.finish?[start,end]:[start]) addBox({min:[b.min[0]+8,top,z],max:[b.max[0]-8,top+0.3,z+3]},0.78);
        if(!b.finish) for(let z=end-30;z>start+30;z-=80)
          addBox({min:[cx-2,top,z-18],max:[cx+2,top+0.3,z+18]},0.61);
        const tile=(b.max[0]-b.min[0])/10;
        if(b.finish) for(let i=0;i<10;i++) for(let j=0;j<2;j++) if((i+j)%2===0)
          addBox({min:[b.min[0]+i*tile,top,end-24+j*20],max:[b.min[0]+(i+1)*tile,top+0.3,end-4+j*20]},0.82);
      }
    }
    count=vertices.length/11;
    bindGeometry(buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
  }
  setBoxes(boxes);
  function resize() {
    const ratio=Math.min(window.devicePixelRatio||1,2);
    const w=Math.round(canvas.clientWidth*ratio),h=Math.round(canvas.clientHeight*ratio);
    if(canvas.width!==w||canvas.height!==h) {canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);}
  }
  function draw(p,fov=100,target=null,shadowCaster=null,remotePlayers=[]) {
    if(!captureState)resize();gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    const {program,attributes,uniforms:u}=pipeline;
    const f=1/Math.tan(verticalFov(fov)*Math.PI/360),scaleX=f/((captureState||canvas).width/(captureState||canvas).height),preset=captureState?.preset||sampleSkybox(skybox,(now()-skyStarted)/1000);
    if(skybox!=='black') {
      for(const {loc} of attributes)gl.disableVertexAttribArray(loc);
      skyRenderer.draw(p,scaleX,f,preset);
      for(const {loc} of attributes)gl.enableVertexAttribArray(loc);
    }
    gl.useProgram(program);
    for(const {loc} of attributes)gl.enableVertexAttribArray(loc);
    const height=64-p.duckAmount*18;
    gl.uniform3f(u.uEye,p.x,p.y+height,p.z);gl.uniform2f(u.uAngles,p.yaw,p.pitch);
    gl.uniform3f(u.uFogEye,p.x,p.y+height,p.z);
    // CS-style FOV setting is horizontal at 4:3; widescreen adds horizontal view.
    gl.uniform2f(u.uScale,scaleX,f);
    gl.uniform3f(u.uSkyHorizon,...preset.horizon);gl.uniform3f(u.uSkyZenith,...preset.zenith);gl.uniform3f(u.uSkyGround,...preset.ground);
    gl.uniform1f(u.uFogGain,skybox==='black'?0:1);
    gl.uniform1f(u.uShadersGain,captureState||shadersEnabled?1:0);
    const light=captureState?.light||sampleSceneLight(skybox,preset),shadow=shadersEnabled?projectPlayerShadow(shadowCaster,currentBoxes,light):null;
    gl.uniform3f(u.uLightDirection,...light.direction);gl.uniform3f(u.uLightColour,...light.colour);gl.uniform3f(u.uAmbientColour,...light.ambient);gl.uniform1f(u.uLightPower,light.power);
    gl.uniform4f(u.uPlayerShadow,shadow?.x||0,shadow?.y||0,shadow?.z||0,shadow?.radius||1);gl.uniform1f(u.uShadowOpacity,shadow?.opacity||0);
    if(captureState){
      gl.uniformMatrix4fv(u.uGalleryShadowMatrix,false,captureState.matrix);
      gl.uniformMatrix3fv(u.uGalleryShadowNormalMatrix,false,captureState.normalMatrix);
      gl.uniform1i(u.uGalleryShadowMap,0);gl.uniform1f(u.uGalleryShadowTexel,1/galleryResources.shadow.width);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,galleryResources.shadow.texture);
    }
    gl.uniform1f(u.uTargetActive,target?1:0);
    if(target) {
      gl.uniform3f(u.uTargetMin,...target.min);gl.uniform3f(u.uTargetMax,...target.max);
    }
    bindGeometry(buffer);
    gl.drawArrays(gl.TRIANGLES,0,count);
    if(remotePlayers.length){
      const mesh=buildRemotePlayerMesh(remotePlayers);
      gl.uniform1f(u.uTargetActive,0);gl.uniform1f(u.uShadowOpacity,0);
      bindGeometry(playerBuffer);gl.bufferData(gl.ARRAY_BUFFER,mesh,gl.DYNAMIC_DRAW||gl.STATIC_DRAW);
      gl.drawArrays(gl.TRIANGLES,0,mesh.length/11);
    }
    setGlow(target);
    if(glowCount) {
      gl.uniform1f(u.uTargetActive,0);
      gl.uniform1f(u.uFogGain,0);
      gl.uniform1f(u.uShadersGain,0);
      bindGeometry(glowBuffer);gl.depthMask(false);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);
      gl.drawArrays(gl.TRIANGLES,0,glowCount);
      gl.disable(gl.BLEND);gl.depthMask(true);
    }
  }
  function releaseCaptures(){
    if(!galleryResources)return;
    galleryResources.shadow?.dispose();galleryResources.image?.dispose();
    if(galleryResources.pipeline)gl.deleteProgram(galleryResources.pipeline.program);
    if(galleryResources.shadowProgram)gl.deleteProgram(galleryResources.shadowProgram);
    galleryResources=null;
  }
  function capture(p,fov,target,aspect=1){
    if(galleryUnavailable)return null;
    const previousFramebuffer=gl.getParameter(gl.FRAMEBUFFER_BINDING),previousViewport=gl.getParameter(gl.VIEWPORT);
    const previousTextureUnit=gl.getParameter(gl.ACTIVE_TEXTURE),previousTexture=gl.getParameter(gl.TEXTURE_BINDING_2D),previousRenderbuffer=gl.getParameter(gl.RENDERBUFFER_BINDING);
    gl.activeTexture(gl.TEXTURE0);const previousTexture0=gl.getParameter(gl.TEXTURE_BINDING_2D);
    try {
      const maxEdge=Math.min(3072,gl.getParameter(gl.MAX_TEXTURE_SIZE),gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)),size=galleryCaptureSize(aspect,maxEdge);
      if(!galleryResources){
        galleryResources={pipeline:worldPipeline(true)};
        galleryResources.shadow=createGalleryTarget(gl,Math.min(2048,maxEdge),Math.min(2048,maxEdge));
        const program=gl.createProgram();galleryResources.shadowProgram=program;
        for(const s of [shader(gl.VERTEX_SHADER,GALLERY_SHADOW_VERTEX),shader(gl.FRAGMENT_SHADER,GALLERY_SHADOW_FRAGMENT)]){gl.attachShader(program,s);gl.deleteShader?.(s);}
        gl.bindAttribLocation(program,standardPipeline.attributes[0].loc,'aPosition');gl.linkProgram(program);
        if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
      }
      const resources=galleryResources;
      if(resources.image?.width!==size.width||resources.image?.height!==size.height){
        resources.image?.dispose();resources.image=null;resources.image=createGalleryTarget(gl,size.width,size.height);resources.pixels=new Uint8Array(size.width*size.height*4);
      }
      const preset=sampleSkybox(skybox,(now()-skyStarted)/1000),light=sampleSceneLight(skybox,preset),matrix=galleryShadowMatrix(currentBoxes,light.direction);
      gl.bindFramebuffer(gl.FRAMEBUFFER,resources.shadow.framebuffer);gl.viewport(0,0,resources.shadow.width,resources.shadow.height);
      gl.clearColor(1,1,1,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.useProgram(resources.shadowProgram);gl.uniformMatrix4fv(gl.getUniformLocation(resources.shadowProgram,'uGalleryShadowMatrix'),false,matrix);
      bindGeometry(buffer);gl.drawArrays(gl.TRIANGLES,0,count);
      gl.bindFramebuffer(gl.FRAMEBUFFER,resources.image.framebuffer);gl.viewport(0,0,size.width,size.height);gl.clearColor(0,0,0,1);
      pipeline=resources.pipeline;captureState={...size,matrix,normalMatrix:galleryShadowNormalMatrix(matrix),preset,light};draw(p,fov,target);
      gl.readPixels(0,0,size.width,size.height,gl.RGBA,gl.UNSIGNED_BYTE,resources.pixels);
      return {...size,pixels:resources.pixels};
    }catch {
      galleryUnavailable=true;releaseCaptures();return null;
    }finally {
      captureState=null;pipeline=standardPipeline;
      gl.bindFramebuffer(gl.FRAMEBUFFER,previousFramebuffer);gl.viewport(...previousViewport);gl.clearColor(0,0,0,1);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,previousTexture0);
      gl.activeTexture(previousTextureUnit);gl.bindTexture(gl.TEXTURE_2D,previousTexture);gl.bindRenderbuffer(gl.RENDERBUFFER,previousRenderbuffer);
      gl.useProgram(pipeline.program);for(const {loc} of pipeline.attributes)gl.enableVertexAttribArray(loc);bindGeometry(buffer);
    }
  }
  return {draw,capture,releaseCaptures,setBoxes,setSkybox,setShaders,get boxes(){return currentBoxes;},get skybox(){return skybox;},get shaders(){return shadersEnabled;}};
}
