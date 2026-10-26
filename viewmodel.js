import { KNIVES, DEFAULT_KNIFE, buildKnife, buildGlove, createInspectController } from './knives.js';

const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
export function multiplyMatrix(a,b){
  const out=new Array(16).fill(0);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];
  return out;
}
const translate=(x,y,z)=>{const m=identity();m[12]=x;m[13]=y;m[14]=z;return m;};
const scale=(x,y=x,z=x)=>[x,0,0,0,0,y,0,0,0,0,z,0,0,0,0,1];
function rotate(x,y,z){
  const cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
  return multiplyMatrix([cz,sz,0,0,-sz,cz,0,0,0,0,1,0,0,0,0,1],
    multiplyMatrix([cy,0,-sy,0,0,1,0,0,sy,0,cy,0,0,0,0,1],[1,0,0,0,0,cx,sx,0,0,-sx,cx,0,0,0,0,1]));
}
const pivotRotate=(p,z)=>multiplyMatrix(translate(...p),multiplyMatrix(rotate(0,0,z),translate(...p.map(v=>-v))));
export function knifeMatrices(id,pose,motion={}){
  const k=KNIVES[id]||KNIVES[DEFAULT_KNIFE],time=motion.time||0,speed=motion.speed||0;
  const moving=motion.playing&&motion.grounded?Math.min(1,speed/250):0;
  const bobX=Math.sin(time*9)*.012*moving,bobY=Math.cos(time*18)*.010*moving;
  const swayX=motion.swayX||0,swayY=motion.swayY||0,drop=motion.equipDrop||0;
  const hands=k.dual?[false,true]:[false];
  return hands.map(left=>{
    const sign=left?-1:1;
    const offset=[sign*(k.dual?.52:.68)+pose.offset[0]*sign+bobX+swayX,
      -.64+pose.offset[1]+bobY+swayY-drop,1.60+pose.offset[2]];
    let rig=multiplyMatrix(translate(...offset),multiplyMatrix(scale(sign,1,1),
      multiplyMatrix(rotate(-.20+pose.rotation[0],Math.PI-.30+pose.rotation[1],.94+pose.rotation[2]),
        multiplyMatrix(scale(.63*(k.scale||1)),translate(0,.45,0)))));
    const main=multiplyMatrix(rig,pivotRotate(pose.pivot,pose.spin));
    const free=multiplyMatrix(main,pivotRotate([.065,0,0],pose.hinge));
    return {main,free,hand:rig,left};
  });
}
export function createKnifeViewmodel(gl){
  const vertex=`attribute vec3 aPosition;attribute vec3 aNormal;attribute vec3 aColor;
    attribute float aMetal;attribute float aRough;uniform mat4 uModel;uniform vec2 uScale;
    varying vec3 vPosition;varying vec3 vNormal;varying vec3 vColor;varying float vMetal;varying float vRough;
    void main(){vec3 p=(uModel*vec4(aPosition,1.0)).xyz;
      vPosition=p;vNormal=mat3(uModel)*aNormal;vColor=aColor;vMetal=aMetal;vRough=aRough;
      gl_Position=vec4(p.x*uScale.x,p.y*uScale.y,1.002002*p.z-.02002002,p.z);}`;
  const fragment=`precision mediump float;varying vec3 vPosition;varying vec3 vNormal;varying vec3 vColor;
    varying float vMetal;varying float vRough;
    void main(){vec3 N=normalize(vNormal),V=normalize(-vPosition);
      vec3 L=normalize(vec3(-.45,.7,-1.0)),H=normalize(L+V);
      float diffuse=max(dot(N,L),0.0),hemi=.36+.28*max(N.y,0.0);
      float exponent=mix(110.0,12.0,vRough);
      float spec=pow(max(dot(N,H),0.0),exponent)*(1.0-vRough*.65);
      vec3 R=reflect(-V,N);
      float strip=pow(max(dot(R,normalize(vec3(.1,.8,-.7))),0.0),18.0);
      float band=pow(max(0.0,1.0-abs(R.y+.25)*1.7),5.0);
      float rim=pow(1.0-clamp(dot(N,V),0.0,1.0),4.0);
      vec3 f0=mix(vec3(.045),vColor,.85*vMetal);
      vec3 color=vColor*(hemi+diffuse*.75)*(1.0-vMetal*.35);
      color+=f0*(spec*3.2+strip*1.8+band*.45*vMetal)*(.45+vMetal*.55);
      color+=vec3(.18,.20,.22)*rim*(.2+.8*vMetal);
      color*=1.35;color=color/(vec3(1.0)+color);
      gl_FragColor=vec4(pow(color,vec3(.454545)),1.0);}`;
  function compile(type,source){
    const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;
  }
  const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));
  gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
  const attributes=[['aPosition',3,0],['aNormal',3,12],['aColor',3,24],['aMetal',1,36],['aRough',1,40]]
    .map(([name,count,offset])=>({location:gl.getAttribLocation(program,name),count,offset}));
  const model=gl.getUniformLocation(program,'uModel'),projection=gl.getUniformLocation(program,'uScale');
  const maxAttributes=gl.getParameter(gl.MAX_VERTEX_ATTRIBS),cache=new Map(),controller=createInspectController();
  let current=null,equippedAt=-Infinity,lastTime=0,lastYaw=null,lastPitch=null,swayX=0,swayY=0;
  function upload(vertices){const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);return{buffer,count:vertices.length/11};}
  const hand=upload(buildGlove());
  function setKnife(id,now=performance.now()/1000){
    if(!Object.hasOwn(KNIVES,id))return false;
    if(!cache.has(id)){const meshes=buildKnife(id);cache.set(id,{main:upload(meshes.main),free:upload(meshes.free)});}
    current=cache.get(id);controller.equip(id);equippedAt=now;return true;
  }
  function drawMesh(mesh,matrix){
    if(!mesh.count)return;
    gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);
    for(const a of attributes){gl.enableVertexAttribArray(a.location);gl.vertexAttribPointer(a.location,a.count,gl.FLOAT,false,44,a.offset);}
    gl.uniformMatrix4fv(model,false,new Float32Array(matrix));gl.drawArrays(gl.TRIANGLES,0,mesh.count);
  }
  function draw(player,width,height,options={}){
    if(!current)return;
    const now=options.time??performance.now()/1000,dt=Math.max(0,Math.min(.1,now-lastTime));lastTime=now;
    const yaw=player.yaw||0,pitch=player.pitch||0;
    let dy=lastYaw===null?0:yaw-lastYaw;while(dy>Math.PI)dy-=Math.PI*2;while(dy< -Math.PI)dy+=Math.PI*2;
    const dp=lastPitch===null?0:pitch-lastPitch;lastYaw=yaw;lastPitch=pitch;
    const blend=1-Math.exp(-dt*12);
    swayX+=(Math.max(-.035,Math.min(.035,-dy*.9))-swayX)*blend;
    swayY+=(Math.max(-.025,Math.min(.025,-dp*.7))-swayY)*blend;
    const t=Math.max(0,Math.min(1,(now-equippedAt)/.38)),equipDrop=.65*(1-t)*(1-t);
    const poses=knifeMatrices(controller.knife,controller.pose(now),{time:now,speed:Math.hypot(player.vx||0,player.vz||0),
      grounded:player.grounded,playing:options.playing,swayX,swayY,equipDrop});
    gl.useProgram(program);for(let i=0;i<maxAttributes;i++)gl.disableVertexAttribArray(i);
    gl.clear(gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);
    const f=1/(Math.tan(68*Math.PI/360)*.75);gl.uniform2f(projection,f/(width/height),f);
    for(const pose of poses){drawMesh(hand,pose.hand);drawMesh(current.main,pose.main);drawMesh(current.free,pose.free);}
  }
  setKnife(DEFAULT_KNIFE,-Infinity);
  return{draw,setKnife,inspect:(now=performance.now()/1000)=>controller.inspect(now),cancelInspect:()=>controller.cancel(),
    get knife(){return controller.knife;},dispose(){for(const mesh of [hand,...[...cache.values()].flatMap(v=>[v.main,v.free])])gl.deleteBuffer(mesh.buffer);gl.deleteProgram(program);}};
}
