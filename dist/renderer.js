import { sampleSkybox, normaliseSkybox, SKY_GRADIENT_GLSL, createSkyRenderer } from './skybox.js';

// The setting is horizontal FOV at 4:3; both cameras use this vertical lens.
export function verticalFov(fov = 100) {
  return 2 * Math.atan(Math.tan(fov * Math.PI / 360) * 0.75) * 180 / Math.PI;
}

export function createRenderer(canvas, boxes, {now=()=>performance.now()}={}) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
  if (!gl) throw new Error('WebGL is unavailable. Enable hardware acceleration and reload.');
  const vertex = `attribute vec3 aPosition; attribute vec3 aColor; attribute float aTop;
    uniform vec3 uEye; uniform vec2 uAngles; uniform vec2 uScale;
    varying vec3 vWorld; varying vec3 vColor; varying float vTop; varying float vDistance;
    void main(){
      vec3 p=aPosition-uEye;
      float cy=cos(uAngles.x),sy=sin(uAngles.x),cp=cos(uAngles.y),sp=sin(uAngles.y);
      float right=p.x*cy+p.z*sy,forward=p.x*sy-p.z*cy;
      float up=p.y*cp-forward*sp,depth=forward*cp+p.y*sp;
      gl_Position=vec4(right*uScale.x,up*uScale.y,1.0001*depth-2.0001,depth);
      vWorld=aPosition;vColor=aColor;vTop=aTop;vDistance=length(p);
    }`;
  const fragment = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform vec3 uTargetMin; uniform vec3 uTargetMax; uniform float uTargetActive;
    uniform vec3 uFogEye; uniform vec3 uSkyHorizon; uniform vec3 uSkyZenith; uniform vec3 uSkyGround; uniform float uFogGain;
    varying vec3 vWorld; varying vec3 vColor; varying float vTop; varying float vDistance;
    ${SKY_GRADIENT_GLSL}
    void main(){
      vec2 grid=mod(vWorld.xz+0.6,64.0);
      float line=(1.0-step(1.2,min(grid.x,grid.y)))*vTop;
      vec3 color=mix(vColor,vColor*0.76,line);
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
  function shader(type, source) {
    const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
    return s;
  }
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const buffer = gl.createBuffer(), glowBuffer = gl.createBuffer();
  const attributes = [];
  for (const [name, count, offset] of [['aPosition', 3, 0], ['aColor', 3, 12], ['aTop', 1, 24]]) {
    const loc = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(loc);
    attributes.push({loc,count,offset});
  }
  function bindGeometry(targetBuffer) {
    gl.bindBuffer(gl.ARRAY_BUFFER, targetBuffer);
    for(const {loc,count,offset} of attributes) gl.vertexAttribPointer(loc,count,gl.FLOAT,false,28,offset);
  }
  const eye = gl.getUniformLocation(program, 'uEye'), angles = gl.getUniformLocation(program, 'uAngles');
  const scale = gl.getUniformLocation(program, 'uScale');
  const targetMin = gl.getUniformLocation(program, 'uTargetMin'), targetMax = gl.getUniformLocation(program, 'uTargetMax');
  const targetActive = gl.getUniformLocation(program, 'uTargetActive');
  const skyHorizon=gl.getUniformLocation(program,'uSkyHorizon'),skyZenith=gl.getUniformLocation(program,'uSkyZenith');
  const skyGround=gl.getUniformLocation(program,'uSkyGround'),fogGain=gl.getUniformLocation(program,'uFogGain');
  const fogEye=gl.getUniformLocation(program,'uFogEye');
  gl.enable(gl.DEPTH_TEST); gl.clearColor(0, 0, 0, 1);
  let skybox='black',skyRenderer=null,cycleStarted=0;
  function setSkybox(value) {
    const next=normaliseSkybox(value);
    if(next!=='black'&&!skyRenderer)skyRenderer=createSkyRenderer(gl);
    if(next==='cycle'&&skybox!=='cycle')cycleStarted=now();
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
          data.push(p[0]+n[0]*d,y,p[1]+n[1]*d,0.045*c,0.42*c,c,0);
        }
      }
    }
    glowCount=data.length/7;
    bindGeometry(glowBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);
  }
  function addBox(b, base = 0.46) {
    const [x,y,z]=b.min,[X,Y,Z]=b.max;
    const faces = [
      [[[x,Y,z],[x,Y,Z],[X,Y,Z],[X,Y,z]],1.12,1],
      [[[x,y,z],[X,y,z],[X,y,Z],[x,y,Z]],0.38,0],
      [[[x,y,z],[x,y,Z],[x,Y,Z],[x,Y,z]],0.65,0],
      [[[X,y,Z],[X,y,z],[X,Y,z],[X,Y,Z]],0.8,0],
      [[[X,y,z],[x,y,z],[x,Y,z],[X,Y,z]],0.72,0],
      [[[x,y,Z],[X,y,Z],[X,Y,Z],[x,Y,Z]],0.87,0],
    ];
    for(const [points,shade,top] of faces) for(const index of [0,1,2,0,2,3]) {
      const rgb=Array.isArray(base)?base:[base,base,base];
      vertices.push(...points[index],...rgb.map(c=>c*shade),top);
    }
  }
  function setBoxes(next) {
    currentBoxes = next; vertices=[];
    for(const b of next) {
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
    count=vertices.length/7;
    bindGeometry(buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
  }
  setBoxes(boxes);
  function resize() {
    const ratio=Math.min(window.devicePixelRatio||1,2);
    const w=Math.round(canvas.clientWidth*ratio),h=Math.round(canvas.clientHeight*ratio);
    if(canvas.width!==w||canvas.height!==h) {canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);}
  }
  function draw(p,fov=100,target=null) {
    resize(); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    const f=1/Math.tan(verticalFov(fov)*Math.PI/360),scaleX=f/(canvas.width/canvas.height),preset=sampleSkybox(skybox,(now()-cycleStarted)/1000);
    if(skybox!=='black') {
      for(const {loc} of attributes)gl.disableVertexAttribArray(loc);
      skyRenderer.draw(p,scaleX,f,preset);
      for(const {loc} of attributes)gl.enableVertexAttribArray(loc);
    }
    gl.useProgram(program);
    for(const {loc} of attributes)gl.enableVertexAttribArray(loc);
    const height=64-p.duckAmount*18;
    gl.uniform3f(eye,p.x,p.y+height,p.z);gl.uniform2f(angles,p.yaw,p.pitch);
    gl.uniform3f(fogEye,p.x,p.y+height,p.z);
    // CS-style FOV setting is horizontal at 4:3; widescreen adds horizontal view.
    gl.uniform2f(scale,scaleX,f);
    gl.uniform3f(skyHorizon,...preset.horizon);gl.uniform3f(skyZenith,...preset.zenith);gl.uniform3f(skyGround,...preset.ground);
    gl.uniform1f(fogGain,skybox==='black'?0:1);
    gl.uniform1f(targetActive,target?1:0);
    if(target) {
      gl.uniform3f(targetMin,...target.min);gl.uniform3f(targetMax,...target.max);
    }
    bindGeometry(buffer);
    gl.drawArrays(gl.TRIANGLES,0,count);
    setGlow(target);
    if(glowCount) {
      gl.uniform1f(targetActive,0);
      gl.uniform1f(fogGain,0);
      bindGeometry(glowBuffer);gl.depthMask(false);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);
      gl.drawArrays(gl.TRIANGLES,0,glowCount);
      gl.disable(gl.BLEND);gl.depthMask(true);
    }
  }
  return {draw,setBoxes,setSkybox,get boxes(){return currentBoxes;},get skybox(){return skybox;}};
}
