export function createRenderer(canvas, boxes) {
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
  const fragment = `precision mediump float;
    varying vec3 vWorld; varying vec3 vColor; varying float vTop; varying float vDistance;
    void main(){
      vec2 grid=mod(vWorld.xz+0.6,64.0);
      float line=(1.0-step(1.2,min(grid.x,grid.y)))*vTop;
      vec3 color=mix(vColor,vColor*0.76,line);
      float fade=1.0-smoothstep(1700.0,6500.0,vDistance);
      gl_FragColor=vec4(color*fade,1.0);
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
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (const [name, count, offset] of [['aPosition', 3, 0], ['aColor', 3, 12], ['aTop', 1, 24]]) {
    const loc = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, count, gl.FLOAT, false, 28, offset);
  }
  const eye = gl.getUniformLocation(program, 'uEye'), angles = gl.getUniformLocation(program, 'uAngles');
  const scale = gl.getUniformLocation(program, 'uScale');
  gl.enable(gl.DEPTH_TEST); gl.clearColor(0, 0, 0, 1);
  let vertices = [], count = 0, currentBoxes = boxes;
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
      const c=base*shade; vertices.push(...points[index],c,c,c,top);
    }
  }
  function setBoxes(next) {
    currentBoxes = next; vertices=[];
    for(const b of next) {
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
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
  }
  setBoxes(boxes);
  function resize() {
    const ratio=Math.min(window.devicePixelRatio||1,2);
    const w=Math.round(canvas.clientWidth*ratio),h=Math.round(canvas.clientHeight*ratio);
    if(canvas.width!==w||canvas.height!==h) {canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);}
  }
  function draw(p,fov=100) {
    resize(); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    const height=64-p.duckAmount*18;
    gl.uniform3f(eye,p.x,p.y+height,p.z);gl.uniform2f(angles,p.yaw,p.pitch);
    // CS-style FOV setting is horizontal at 4:3; widescreen adds horizontal view.
    const f=1/(Math.tan(fov*Math.PI/360)*0.75);
    gl.uniform2f(scale,f/(canvas.width/canvas.height),f);
    gl.drawArrays(gl.TRIANGLES,0,count);
  }
  return {draw,setBoxes,get boxes(){return currentBoxes;}};
}
