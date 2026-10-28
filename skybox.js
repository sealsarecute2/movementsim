// Direction-based skies stay at infinity and use the world's camera lens.
export const SKYBOXES = Object.freeze({
  black: { label:'Default · Black', zenith:[0,0,0], horizon:[0,0,0], ground:[0,0,0] },
  cycle: { label:'Day / night cycle · 20 min' },
});

export function normaliseSkybox(value) {
  return typeof value==='string'&&Object.hasOwn(SKYBOXES,value)?value:'black';
}

export const DAY_NIGHT_CYCLE_SECONDS = 20 * 60;
// Dawn, midday, dusk and midnight are five minutes apart. Ease the palettes
// through every phase and the wrap to dawn; move the two bodies continuously.
const SKY_PHASES = [
  { zenith:[.07,.13,.28], horizon:[.94,.55,.34], ground:[.055,.065,.11], cloud:[.69,.56,.59], sun:[1,.76,.48], clouds:.48, stars:.12 },
  { zenith:[.055,.34,.72], horizon:[.68,.84,.97], ground:[.20,.28,.38], cloud:[.98,.985,1], sun:[1,.96,.83], clouds:.75, stars:0 },
  { zenith:[.12,.07,.26], horizon:[.93,.32,.25], ground:[.045,.035,.075], cloud:[.53,.32,.43], sun:[1,.46,.24], clouds:.50, stars:.14 },
  { zenith:[.003,.006,.025], horizon:[.035,.055,.115], ground:[.006,.009,.02], cloud:[.075,.095,.16], sun:[1,.65,.40], clouds:.28, stars:1 },
];
function skyEase(value) { const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t); }
export function sampleSkybox(value,elapsedSeconds=0) {
  if(normaliseSkybox(value)==='black')return SKYBOXES.black;
  const seconds=Number.isFinite(elapsedSeconds)?elapsedSeconds:0;
  const time=((seconds%DAY_NIGHT_CYCLE_SECONDS)+DAY_NIGHT_CYCLE_SECONDS)%DAY_NIGHT_CYCLE_SECONDS;
  const phase=time/DAY_NIGHT_CYCLE_SECONDS*4,index=Math.floor(phase),blend=skyEase(phase-index);
  const from=SKY_PHASES[index],to=SKY_PHASES[(index+1)%4],frame={};
  for(const key of ['zenith','horizon','ground','cloud','sun'])frame[key]=from[key].map((n,i)=>n+(to[key][i]-n)*blend);
  for(const key of ['clouds','stars'])frame[key]=from[key]+(to[key]-from[key])*blend;
  const angle=time/DAY_NIGHT_CYCLE_SECONDS*Math.PI*2,sine=Math.sin(angle);
  frame.sunDirection=[-Math.cos(angle),sine*.9,-sine*Math.sqrt(1-.9*.9)];
  frame.moonDirection=frame.sunDirection.map(n=>-n);
  frame.sunVisibility=skyEase((frame.sunDirection[1]+.08)/.16);
  frame.moonVisibility=skyEase((frame.moonDirection[1]+.08)/.16);
  frame.cloudOffset=[Math.sin(angle)*1.2,(1-Math.cos(angle))*.7];
  frame.time=time;
  return frame;
}

export const SKY_GRADIENT_GLSL = `
  vec3 backgroundGradient(vec3 direction,vec3 horizon,vec3 zenith,vec3 ground){
    vec3 upper=mix(horizon,zenith,pow(max(direction.y,0.0),0.45));
    return mix(ground,upper,smoothstep(-0.18,0.035,direction.y));
  }
`;

export const SKY_VERTEX_GLSL = `
  attribute vec2 aClip;
  varying vec2 vClip;
  void main(){vClip=aClip;gl_Position=vec4(aClip,1.0,1.0);}
`;

export const SKY_FRAGMENT_GLSL = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  uniform vec2 uSkyAngles; uniform vec2 uSkyScale;
  uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uGround;
  uniform vec3 uCloudColour; uniform vec3 uSunColour; uniform vec3 uSunDirection; uniform vec3 uMoonDirection;
  uniform vec2 uCloudOffset;
  uniform float uClouds; uniform float uStars; uniform float uSunVisibility; uniform float uMoonVisibility; uniform float uSkyTime;
  varying vec2 vClip;
  ${SKY_GRADIENT_GLSL}
  float skyHash(vec2 p){
    vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);
    return fract((p3.x+p3.y)*p3.z);
  }
  float skyNoise(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(skyHash(i),skyHash(i+vec2(1.0,0.0)),f.x),
      mix(skyHash(i+vec2(0.0,1.0)),skyHash(i+vec2(1.0,1.0)),f.x),f.y);
  }
  void main(){
    float cy=cos(uSkyAngles.x),sy=sin(uSkyAngles.x),cp=cos(uSkyAngles.y),sp=sin(uSkyAngles.y);
    vec2 plane=vClip/uSkyScale;
    float forward=cp-plane.y*sp;
    vec3 direction=normalize(vec3(plane.x*cy+forward*sy,plane.y*cp+sp,plane.x*sy-forward*cy));
    vec3 colour=backgroundGradient(direction,uHorizon,uZenith,uGround);
    float above=smoothstep(-0.015,0.06,direction.y);
    float sunDot=max(dot(direction,normalize(uSunDirection)),0.0);
    float glow=pow(sunDot,28.0)*0.24;
    float disc=smoothstep(0.99955,0.99982,sunDot);
    colour+=uSunColour*(glow+disc)*above*uSunVisibility;
    float moonDot=max(dot(direction,normalize(uMoonDirection)),0.0);
    float moonDisc=smoothstep(0.99945,0.99978,moonDot);
    float moonSurface=0.78+0.22*skyNoise(direction.xz*950.0);
    colour+=vec3(0.70,0.80,1.0)*(pow(moonDot,36.0)*0.045+moonDisc*moonSurface)*above*uMoonVisibility;
    if(uStars>0.0&&direction.y>0.0){
      vec2 uv=vec2(atan(direction.z,direction.x)*0.15915494+0.5,asin(clamp(direction.y,-1.0,1.0))*0.31830989+0.5);
      vec2 cells=uv*vec2(640.0,320.0),cell=floor(cells);
      vec2 offset=vec2(skyHash(cell+17.0),skyHash(cell+59.0));
      float point=1.0-smoothstep(0.025,0.18,length(fract(cells)-offset));
      float star=point*step(0.995,skyHash(cell))*smoothstep(0.02,0.25,direction.y)*uStars;
      float twinkle=0.83+0.17*sin(uSkyTime*0.15707963+skyHash(cell+91.0)*6.2831853);
      colour+=vec3(0.70,0.80,1.0)*star*twinkle;
    }
    if(direction.y>0.015){
      vec2 cloudUV=direction.xz/(direction.y+0.35)*3.2+vec2(8.4,1.7)+uCloudOffset;
      float noise=skyNoise(cloudUV)*0.57+skyNoise(cloudUV*2.03+4.1)*0.28+skyNoise(cloudUV*4.07)*0.15;
      float cover=smoothstep(0.47,0.72,noise)*smoothstep(0.015,0.22,direction.y)*uClouds;
      colour=mix(colour,uCloudColour,cover);
    }
    gl_FragColor=vec4(clamp(colour,0.0,1.0),1.0);
  }
`;

export function createSkyRenderer(gl) {
  function compile(type,source) {
    const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));
    return shader;
  }
  const program=gl.createProgram();
  gl.attachShader(program,compile(gl.VERTEX_SHADER,SKY_VERTEX_GLSL));
  gl.attachShader(program,compile(gl.FRAGMENT_SHADER,SKY_FRAGMENT_GLSL));gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  const buffer=gl.createBuffer(),position=gl.getAttribLocation(program,'aClip');
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  const names=['uSkyAngles','uSkyScale','uHorizon','uZenith','uGround','uCloudColour','uSunColour','uSunDirection','uMoonDirection','uCloudOffset','uClouds','uStars','uSunVisibility','uMoonVisibility','uSkyTime'];
  const uniforms=Object.fromEntries(names.map(name=>[name,gl.getUniformLocation(program,name)]));
  return {draw(camera,scaleX,scaleY,preset){
    gl.useProgram(program);gl.disable(gl.DEPTH_TEST);gl.depthMask(false);
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    gl.uniform2f(uniforms.uSkyAngles,camera.yaw,camera.pitch);gl.uniform2f(uniforms.uSkyScale,scaleX,scaleY);
    for(const [name,value] of [['uHorizon',preset.horizon],['uZenith',preset.zenith],['uGround',preset.ground],
      ['uCloudColour',preset.cloud],['uSunColour',preset.sun],['uSunDirection',preset.sunDirection],['uMoonDirection',preset.moonDirection]])gl.uniform3f(uniforms[name],...value);
    gl.uniform2f(uniforms.uCloudOffset,...preset.cloudOffset);
    for(const [name,key] of [['uClouds','clouds'],['uStars','stars'],['uSunVisibility','sunVisibility'],['uMoonVisibility','moonVisibility'],['uSkyTime','time']])gl.uniform1f(uniforms[name],preset[key]);
    gl.drawArrays(gl.TRIANGLES,0,3);gl.disableVertexAttribArray(position);
    gl.depthMask(true);gl.enable(gl.DEPTH_TEST);
  }};
}
