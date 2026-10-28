import { GALAXY_ENVIRONMENT } from './galaxy-data.js';
import { loadGalaxyEnvironment } from './galaxies.js';
// Direction-based skies stay at infinity and use the world's camera lens.
export const SKYBOXES = Object.freeze({
  black: { label:'Default · Black', zenith:[0,0,0], horizon:[0,0,0], ground:[0,0,0] },
  cycle: { label:'Day / night cycle · 20 min' },
  blackhole: { label:'Black hole · End-inspired' },
  galaxies: { label:'Galaxies · HDRI' },
});

export function normaliseSkybox(value) {
  return typeof value==='string'&&Object.hasOwn(SKYBOXES,value)?value:'black';
}

export const DAY_NIGHT_CYCLE_SECONDS = 20 * 60;
export const BLACK_HOLE_DIRECTION = Object.freeze([-.12,.44,-.89].map(n=>n/Math.hypot(-.12,.44,-.89)));
// Dawn, midday, dusk and midnight are five minutes apart. Ease the palettes
// through every phase and the wrap to dawn; move the two bodies continuously.
const SKY_PHASES = [
  { zenith:[.07,.13,.28], horizon:[.94,.55,.34], ground:[.055,.065,.11], cloud:[.69,.56,.59], sun:[1,.76,.48], clouds:.48, stars:.12 },
  { zenith:[.055,.34,.72], horizon:[.68,.84,.97], ground:[.20,.28,.38], cloud:[.98,.985,1], sun:[1,.96,.83], clouds:.75, stars:0 },
  { zenith:[.12,.07,.26], horizon:[.93,.32,.25], ground:[.045,.035,.075], cloud:[.53,.32,.43], sun:[1,.46,.24], clouds:.50, stars:.14 },
  { zenith:[.003,.006,.025], horizon:[.035,.055,.115], ground:[.006,.009,.02], cloud:[.075,.095,.16], sun:[1,.65,.40], clouds:.28, stars:1 },
];
function skyEase(value) { const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t); }
const BLACK_HOLE_SKY = {
  zenith:[.006,.008,.018],horizon:[.025,.026,.039],ground:[.003,.004,.009],
  cloud:[0,0,0],sun:[0,0,0],sunDirection:[0,1,0],moonDirection:[0,-1,0],
  clouds:0,stars:1,sunVisibility:0,moonVisibility:0,cloudOffset:[0,0],blackHole:1,galaxies:0,
};
export function sampleSkybox(value,elapsedSeconds=0) {
  const selected=normaliseSkybox(value);
  if(selected==='black')return SKYBOXES.black;
  const seconds=Number.isFinite(elapsedSeconds)?elapsedSeconds:0;
  if(selected==='blackhole')return {...BLACK_HOLE_SKY,time:((seconds%600)+600)%600};
  if(selected==='galaxies')return {...BLACK_HOLE_SKY,zenith:GALAXY_ENVIRONMENT.lighting.zenith,horizon:GALAXY_ENVIRONMENT.lighting.horizon,ground:GALAXY_ENVIRONMENT.lighting.ground,blackHole:0,galaxies:1,time:0};
  const time=((seconds%DAY_NIGHT_CYCLE_SECONDS)+DAY_NIGHT_CYCLE_SECONDS)%DAY_NIGHT_CYCLE_SECONDS;
  const phase=time/DAY_NIGHT_CYCLE_SECONDS*4,index=Math.floor(phase),blend=skyEase(phase-index);
  const from=SKY_PHASES[index],to=SKY_PHASES[(index+1)%4],frame={blackHole:0,galaxies:0};
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

// Original analytic sky effect, inspired by the broad visual shapes of an End
// black hole. No Minecraft shader code, textures or other pack assets are used.
export const BLACK_HOLE_GLSL = `
  vec3 blackHoleTone(vec3 colour){return pow(vec3(1.0)-exp(-colour*1.25),vec3(0.88));}
  vec3 blackHoleSpace(vec3 ray,float phase){
    vec2 uv=vec2(atan(ray.z,ray.x)*0.15915494+0.5,asin(clamp(ray.y,-1.0,1.0))*0.31830989+0.5);
    float mist=skyNoise(ray.xz*3.1+ray.y*1.7)*skyNoise(ray.xy*7.0+4.2);
    vec3 colour=vec3(0.003,0.005,0.013)+vec3(0.035,0.028,0.055)*mist;
    for(int layer=0;layer<2;layer++){
      float size=310.0+float(layer)*270.0;
      vec2 cells=uv*vec2(size*2.0,size),cell=floor(cells);
      vec2 offset=vec2(skyHash(cell+17.0),skyHash(cell+59.0));
      float point=1.0-smoothstep(0.025,0.17,length(fract(cells)-offset));
      float star=point*step(0.991+float(layer)*0.003,skyHash(cell+float(layer)*91.0));
      float twinkle=0.82+0.18*sin(phase*10.0+skyHash(cell+37.0)*6.2831853);
      colour+=mix(vec3(0.55,0.69,1.0),vec3(1.0,0.84,0.64),skyHash(cell+7.0))*star*twinkle;
    }
    return colour;
  }
  vec3 blackHoleSky(vec3 ray,float time){
    float phase=time*0.0104719755;
    vec3 centre=vec3(${BLACK_HOLE_DIRECTION.join(',')});
    vec3 right=normalize(cross(centre,vec3(0.0,1.0,0.0))),up=cross(right,centre);
    float facing=dot(ray,centre);
    if(facing<=0.05)return blackHoleTone(blackHoleSpace(ray,phase));
    vec2 screen=vec2(dot(ray,right),dot(ray,up))/facing;
    float tilt=0.12;
    vec2 q=vec2(screen.x*cos(tilt)+screen.y*sin(tilt),screen.y*cos(tilt)-screen.x*sin(tilt));
    float radius=length(q);
    // Bend the star field around the silhouette, keeping the rest of the sky
    // fixed in world space as the camera moves or the player changes courses.
    float lens=0.035*exp(-radius*radius*1.5)/max(radius*radius,0.025);
    vec2 warped=screen*(1.0+lens);
    vec3 colour=blackHoleSpace(normalize(centre+right*warped.x+up*warped.y),phase);
    if(radius>1.6)return blackHoleTone(colour);
    float shadow=1.0-smoothstep(0.215,0.226,radius);
    colour=mix(colour,vec3(0.0001,0.0002,0.0005),shadow);
    float angle=atan(q.y,q.x+0.00001);
    float ripple=0.86+0.14*sin(angle*8.0-phase*35.0+radius*100.0);
    float arc=exp(-pow((radius-0.275)/0.038,2.0))*ripple;
    float photon=exp(-abs(radius-0.226)*260.0);
    float halo=exp(-abs(radius-0.29)*9.0)*0.15;
    colour+=(vec3(1.0,0.83,0.61)*arc*1.7+vec3(0.75,0.86,1.0)*photon*1.8+vec3(0.57,0.60,0.78)*halo)*(1.0-shadow);
    // A tilted, thin disk passes in front of the lower shadow. The far half is
    // hidden behind it; the bright circular arcs suggest the lensed far side.
    vec2 diskPoint=vec2(q.x,q.y/0.17);
    float diskRadius=length(diskPoint),diskAngle=atan(diskPoint.y,diskPoint.x+0.00001);
    float disk=smoothstep(0.235,0.31,diskRadius)*(1.0-smoothstep(0.70,1.05,diskRadius));
    vec2 flow=vec2(cos(diskAngle-phase*5.0),sin(diskAngle-phase*5.0))*diskRadius*18.0;
    float grain=skyNoise(flow)*0.55+skyNoise(flow*2.1)*0.25;
    float bands=0.76+0.24*sin(diskRadius*165.0+grain*7.0-phase*30.0);
    float heat=exp(-(diskRadius-0.24)*4.0);
    float visible=1.0-shadow*smoothstep(-0.018,0.018,q.y);
    float beaming=1.25-0.65*smoothstep(-0.8,0.8,q.x);
    vec3 diskColour=mix(vec3(0.82,0.39,0.12),vec3(1.0,0.95,0.82),smoothstep(0.05,0.85,heat));
    colour+=diskColour*disk*(0.4+grain)*bands*(0.65+heat*3.0)*beaming*visible;
    float diskGlow=exp(-abs(q.y)*25.0)*exp(-abs(q.x)*2.6)*0.16;
    colour+=vec3(0.72,0.55,0.39)*diskGlow*(1.0-shadow*0.97);
    return blackHoleTone(colour);
  }
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
  uniform float uClouds; uniform float uStars; uniform float uSunVisibility; uniform float uMoonVisibility; uniform float uSkyTime; uniform float uBlackHole;
  uniform sampler2D uGalaxyMap; uniform float uGalaxies; uniform float uGalaxyOffset;
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
  ${BLACK_HOLE_GLSL}
  void main(){
    float cy=cos(uSkyAngles.x),sy=sin(uSkyAngles.x),cp=cos(uSkyAngles.y),sp=sin(uSkyAngles.y);
    vec2 plane=vClip/uSkyScale;
    float forward=cp-plane.y*sp;
    vec3 direction=normalize(vec3(plane.x*cy+forward*sy,plane.y*cp+sp,plane.x*sy-forward*cy));
    if(uGalaxies>0.5){
      vec2 uv=vec2(fract(atan(direction.z,direction.x)*0.15915494+0.5+uGalaxyOffset),acos(clamp(direction.y,-1.0,1.0))*0.31830989);
      gl_FragColor=vec4(texture2D(uGalaxyMap,uv).rgb,1.0);return;
    }
    if(uBlackHole>0.5){gl_FragColor=vec4(blackHoleSky(direction,uSkyTime),1.0);return;}
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

export function createSkyRenderer(gl,{loadGalaxy=loadGalaxyEnvironment}={}) {
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
  const names=['uSkyAngles','uSkyScale','uHorizon','uZenith','uGround','uCloudColour','uSunColour','uSunDirection','uMoonDirection','uCloudOffset','uClouds','uStars','uSunVisibility','uMoonVisibility','uSkyTime','uBlackHole','uGalaxyMap','uGalaxies','uGalaxyOffset'];
  const uniforms=Object.fromEntries(names.map(name=>[name,gl.getUniformLocation(program,name)]));
  const galaxyTexture=gl.createTexture();let galaxyReady=false,galaxyLoading=null;
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,galaxyTexture);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  return {get galaxiesReady(){return galaxyReady;},loadGalaxies(){
    if(galaxyReady)return Promise.resolve();
    if(!galaxyLoading)galaxyLoading=Promise.resolve().then(()=>loadGalaxy()).then(({width,height,pixels})=>{
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,galaxyTexture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);galaxyReady=true;
    }).catch(error=>{galaxyLoading=null;throw error;});
    return galaxyLoading;
  },draw(camera,scaleX,scaleY,preset){
    gl.useProgram(program);gl.disable(gl.DEPTH_TEST);gl.depthMask(false);
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    gl.uniform2f(uniforms.uSkyAngles,camera.yaw,camera.pitch);gl.uniform2f(uniforms.uSkyScale,scaleX,scaleY);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,galaxyTexture);gl.uniform1i(uniforms.uGalaxyMap,0);
    gl.uniform1f(uniforms.uGalaxies,preset.galaxies);gl.uniform1f(uniforms.uGalaxyOffset,GALAXY_ENVIRONMENT.lighting.uvOffset);
    for(const [name,value] of [['uHorizon',preset.horizon],['uZenith',preset.zenith],['uGround',preset.ground],
      ['uCloudColour',preset.cloud],['uSunColour',preset.sun],['uSunDirection',preset.sunDirection],['uMoonDirection',preset.moonDirection]])gl.uniform3f(uniforms[name],...value);
    gl.uniform2f(uniforms.uCloudOffset,...preset.cloudOffset);
    gl.uniform1f(uniforms.uBlackHole,preset.blackHole);
    for(const [name,key] of [['uClouds','clouds'],['uStars','stars'],['uSunVisibility','sunVisibility'],['uMoonVisibility','moonVisibility'],['uSkyTime','time']])gl.uniform1f(uniforms[name],preset[key]);
    gl.drawArrays(gl.TRIANGLES,0,3);gl.disableVertexAttribArray(position);
    gl.depthMask(true);gl.enable(gl.DEPTH_TEST);
  }};
}
