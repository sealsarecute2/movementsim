// Direction-based skies stay at infinity and use the world's camera lens.
export const SKYBOXES = Object.freeze({
  black: { label:'Default · Black', zenith:[0,0,0], horizon:[0,0,0], ground:[0,0,0] },
  cycle: { label:'Day / night cycle · 20 min' },
  blackhole: { label:'Black hole · End-inspired' },
});

export function normaliseSkybox(value) {
  return typeof value==='string'&&Object.hasOwn(SKYBOXES,value)?value:'black';
}

export const DAY_NIGHT_CYCLE_SECONDS = 20 * 60;
export const BLACK_HOLE_DIRECTION = Object.freeze([-.12,.44,-.89].map(n=>n/Math.hypot(-.12,.44,-.89)));
// Dawn, midday, dusk and midnight are five minutes apart. Ease the palettes
// through every phase and the wrap to dawn; move the two bodies continuously.
const SKY_PHASES = [
  { zenith:[.055,.11,.24], horizon:[.38,.43,.59], ground:[.055,.065,.10], cloud:[.62,.55,.59], sun:[1,.57,.28], clouds:.62, stars:0 },
  { zenith:[.055,.31,.66], horizon:[.66,.80,.94], ground:[.20,.28,.38], cloud:[.96,.975,1], sun:[1,.96,.84], clouds:.78, stars:0 },
  { zenith:[.09,.045,.21], horizon:[.34,.23,.40], ground:[.045,.035,.075], cloud:[.55,.33,.43], sun:[1,.40,.18], clouds:.58, stars:0 },
  { zenith:[.002,.004,.017], horizon:[.022,.035,.077], ground:[.005,.008,.016], cloud:[.095,.12,.19], sun:[1,.65,.40], clouds:.32, stars:1 },
];
function skyEase(value) { const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t); }
const BLACK_HOLE_SKY = {
  zenith:[.006,.008,.018],horizon:[.025,.026,.039],ground:[.003,.004,.009],
  cloud:[0,0,0],sun:[0,0,0],sunDirection:[0,1,0],moonDirection:[0,-1,0],
  clouds:0,stars:1,sunVisibility:0,moonVisibility:0,cloudOffset:[0,0],blackHole:1,
};
export function sampleSkybox(value,elapsedSeconds=0) {
  const selected=normaliseSkybox(value);
  if(selected==='black')return SKYBOXES.black;
  const seconds=Number.isFinite(elapsedSeconds)?elapsedSeconds:0;
  if(selected==='blackhole')return {...BLACK_HOLE_SKY,time:((seconds%600)+600)%600};
  const time=((seconds%DAY_NIGHT_CYCLE_SECONDS)+DAY_NIGHT_CYCLE_SECONDS)%DAY_NIGHT_CYCLE_SECONDS;
  const phase=time/DAY_NIGHT_CYCLE_SECONDS*4,index=Math.floor(phase),blend=skyEase(phase-index);
  const from=SKY_PHASES[index],to=SKY_PHASES[(index+1)%4],frame={blackHole:0};
  for(const key of ['zenith','horizon','ground','cloud','sun'])frame[key]=from[key].map((n,i)=>n+(to[key][i]-n)*blend);
  for(const key of ['clouds','stars'])frame[key]=from[key]+(to[key]-from[key])*blend;
  const angle=time/DAY_NIGHT_CYCLE_SECONDS*Math.PI*2,sine=Math.sin(angle);
  frame.sunDirection=[-Math.cos(angle),sine*.9,-sine*Math.sqrt(1-.9*.9)];
  frame.moonDirection=frame.sunDirection.map(n=>-n);
  frame.sunVisibility=skyEase((frame.sunDirection[1]+.08)/.16);
  frame.moonVisibility=skyEase((frame.moonDirection[1]+.08)/.16);
  frame.cloudOffset=[Math.sin(angle)*1.2,(1-Math.cos(angle))*.7];
  frame.daylight=skyEase((frame.sunDirection[1]+.10)/.42);
  frame.twilight=1-skyEase(Math.abs(frame.sunDirection[1])/.24);
  frame.stars=skyEase((-frame.sunDirection[1]-.06)/.30);
  const noon=skyEase((frame.sunDirection[1]-.08)/.50)*.85;
  for(const key of ['zenith','horizon','cloud','sun'])frame[key]=frame[key].map((n,i)=>n+(SKY_PHASES[1][key][i]-n)*noon);
  frame.time=time;
  return frame;
}

export const SKY_GRADIENT_GLSL = `
  vec3 backgroundGradient(vec3 direction,vec3 horizon,vec3 zenith,vec3 ground){
    vec3 upper=mix(horizon,zenith,pow(max(direction.y,0.0),0.45));
    return mix(ground,upper,smoothstep(-0.18,0.035,direction.y));
  }
`;

// A small analytic atmosphere is shared by the sky and distance haze. Twilight
// follows the sun's direction, with a cool opposite horizon and warm solar haze.
export const SKY_ATMOSPHERE_GLSL = `
  vec3 cycleAtmosphere(vec3 direction,vec3 horizon,vec3 zenith,vec3 ground,vec3 sunDirection,vec3 sunColour,float daylight,float twilight){
    vec3 colour=mix(horizon,zenith,pow(max(direction.y,0.0),0.45));
    vec2 horizontal=normalize(direction.xz+vec2(0.00001)),solar=normalize(sunDirection.xz+vec2(0.00001));
    float facing=dot(horizontal,solar),low=pow(1.0-clamp(direction.y,0.0,1.0),3.0);
    float warm=pow(max(facing,0.0),3.0)*low*twilight;
    colour+=mix(vec3(1.0,0.36,0.13),sunColour,0.35)*warm*0.62;
    colour+=vec3(0.12,0.035,0.12)*pow(max(-facing,0.0),2.0)*low*twilight;
    float sunDot=max(dot(direction,sunDirection),0.0);
    colour+=sunColour*(pow(sunDot,12.0)*0.065+pow(sunDot,64.0)*0.10)*daylight;
    return mix(ground,colour,smoothstep(-0.18,0.035,direction.y));
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
  uniform float uDaylight; uniform float uTwilight;
  varying vec2 vClip;
  ${SKY_GRADIENT_GLSL}
  ${SKY_ATMOSPHERE_GLSL}
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
  // Tileable noise keeps the two wind layers moving through the cycle boundary.
  float skyCloudNoise(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(skyHash(mod(i,8.0)),skyHash(mod(i+vec2(1.0,0.0),8.0)),f.x),
      mix(skyHash(mod(i+vec2(0.0,1.0),8.0)),skyHash(mod(i+vec2(1.0,1.0),8.0)),f.x),f.y);
  }
  float skyCloudField(vec2 p){return skyCloudNoise(p)*0.57+skyCloudNoise(p*2.0+2.0)*0.29+skyCloudNoise(p*4.0+5.0)*0.14;}
  vec3 cycleCloudLayer(vec3 colour,vec3 direction,float upper){
    float wind=uSkyTime/1200.0;
    vec2 p=direction.xz/(direction.y+mix(0.22,0.45,upper))*mix(4.0,3.8,upper);
    p*=mix(vec2(1.0),vec2(0.65,2.2),upper);
    p+=vec2(8.4,1.7)+uCloudOffset*0.12+vec2(wind*mix(8.0,16.0,upper),upper*3.1);
    float noise=skyCloudField(p),density=smoothstep(mix(0.49,0.57,upper),mix(0.68,0.79,upper),noise);
    float cover=density*smoothstep(0.015,0.17,direction.y)*uClouds*mix(0.92,0.35,upper);
    vec2 light=normalize(uSunDirection.xz+vec2(0.00001));
    float slope=skyCloudNoise(p+light*0.18)-skyCloudNoise(p);
    float shade=clamp(0.94+slope*1.4-density*0.16,0.46,1.12);
    vec3 cloud=uCloudColour*shade;
    float forward=pow(max(dot(direction,uSunDirection),0.0),7.0);
    float rim=density*(1.0-smoothstep(0.12,0.78,density));
    cloud+=uSunColour*rim*forward*(0.7*uDaylight+0.9*uTwilight);
    cloud+=vec3(0.025,0.035,0.065)*pow(max(dot(direction,uMoonDirection),0.0),5.0)*(1.0-uDaylight);
    return mix(colour,cloud,cover);
  }
  float cycleCrater(vec2 p,vec2 centre,float radius){
    float d=length(p-centre)/radius;
    return exp(-pow((d-1.0)*9.0,2.0))*0.10-(1.0-smoothstep(0.3,1.0,d))*0.16;
  }
  vec3 cycleMoon(vec3 colour,vec3 direction,float above){
    vec3 moon=normalize(uMoonDirection),right=normalize(cross(moon,vec3(0.0,1.0,0.0))),up=cross(right,moon);
    float facing=dot(direction,moon);
    colour+=vec3(0.55,0.67,1.0)*(pow(max(facing,0.0),42.0)*0.025+pow(max(facing,0.0),180.0)*0.018)*above*uMoonVisibility;
    vec2 p=vec2(dot(direction,right),dot(direction,up))/0.022;
    float radius=length(p);
    if(facing>0.0&&radius<1.03){
      vec3 normal=vec3(p,sqrt(max(0.0,1.0-dot(p,p))));
      float surface=0.88-0.19*smoothstep(0.35,0.62,skyNoise(p*3.4+7.1))+skyNoise(p*23.0)*0.045;
      surface+=cycleCrater(p,vec2(-0.38,0.19),0.19)+cycleCrater(p,vec2(0.24,-0.31),0.14);
      surface+=cycleCrater(p,vec2(0.43,0.28),0.11)+cycleCrater(p,vec2(-0.12,-0.51),0.12);
      float light=0.24+0.76*max(dot(normal,normalize(vec3(-0.24,0.32,0.92))),0.0);
      vec3 moonColour=vec3(0.75,0.81,0.92)*surface*light;
      float disc=(1.0-smoothstep(0.94,1.025,radius))*above*uMoonVisibility;
      colour=mix(colour,moonColour,disc);
    }
    return colour;
  }
  void main(){
    float cy=cos(uSkyAngles.x),sy=sin(uSkyAngles.x),cp=cos(uSkyAngles.y),sp=sin(uSkyAngles.y);
    vec2 plane=vClip/uSkyScale;
    float forward=cp-plane.y*sp;
    vec3 direction=normalize(vec3(plane.x*cy+forward*sy,plane.y*cp+sp,plane.x*sy-forward*cy));
    if(uBlackHole>0.5){gl_FragColor=vec4(blackHoleSky(direction,uSkyTime),1.0);return;}
    vec3 colour=cycleAtmosphere(direction,uHorizon,uZenith,uGround,uSunDirection,uSunColour,uDaylight,uTwilight);
    float above=smoothstep(-0.015,0.06,direction.y);
    float sunDot=max(dot(direction,normalize(uSunDirection)),0.0);
    if(uStars>0.0&&direction.y>0.0){
      vec2 uv=vec2(atan(direction.z,direction.x)*0.15915494+0.5,asin(clamp(direction.y,-1.0,1.0))*0.31830989+0.5);
      for(int layer=0;layer<2;layer++){
        float size=320.0+float(layer)*320.0;
        vec2 cells=uv*vec2(size,size*0.5),cell=floor(cells);
        vec2 offset=mix(vec2(0.2),vec2(0.8),vec2(skyHash(cell+17.0),skyHash(cell+59.0)));
        float seed=skyHash(cell+37.0),radius=mix(0.08,0.19,seed*seed);
        float point=1.0-smoothstep(radius*0.25,radius,length(fract(cells)-offset));
        float star=point*step(0.992+float(layer)*0.004,skyHash(cell))*smoothstep(0.02,0.25,direction.y)*uStars;
        float twinkle=0.92+0.08*sin(uSkyTime/1200.0*6.2831853*(30.0+30.0*step(0.5,seed))+seed*30.0);
        vec3 tint=mix(vec3(0.60,0.74,1.0),vec3(1.0,0.85,0.64),skyHash(cell+7.0));
        colour+=tint*star*twinkle*mix(0.28,0.95,seed)*mix(1.0,0.65,float(layer));
      }
    }
    float glow=pow(sunDot,28.0)*0.14+pow(sunDot,160.0)*0.12;
    float disc=smoothstep(0.99962,0.99984,sunDot);
    colour+=uSunColour*(glow+disc*1.15)*above*uSunVisibility;
    if(uMoonVisibility>0.0)colour=cycleMoon(colour,direction,above);
    // Bodies sit behind the clouds; the moon also masks the stars.
    if(direction.y>0.015){colour=cycleCloudLayer(colour,direction,1.0);colour=cycleCloudLayer(colour,direction,0.0);}
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
  const names=['uSkyAngles','uSkyScale','uHorizon','uZenith','uGround','uCloudColour','uSunColour','uSunDirection','uMoonDirection','uCloudOffset','uClouds','uStars','uSunVisibility','uMoonVisibility','uSkyTime','uBlackHole','uDaylight','uTwilight'];
  const uniforms=Object.fromEntries(names.map(name=>[name,gl.getUniformLocation(program,name)]));
  return {draw(camera,scaleX,scaleY,preset){
    gl.useProgram(program);gl.disable(gl.DEPTH_TEST);gl.depthMask(false);
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    gl.uniform2f(uniforms.uSkyAngles,camera.yaw,camera.pitch);gl.uniform2f(uniforms.uSkyScale,scaleX,scaleY);
    for(const [name,value] of [['uHorizon',preset.horizon],['uZenith',preset.zenith],['uGround',preset.ground],
      ['uCloudColour',preset.cloud],['uSunColour',preset.sun],['uSunDirection',preset.sunDirection],['uMoonDirection',preset.moonDirection]])gl.uniform3f(uniforms[name],...value);
    gl.uniform2f(uniforms.uCloudOffset,...preset.cloudOffset);
    gl.uniform1f(uniforms.uBlackHole,preset.blackHole);
    gl.uniform1f(uniforms.uDaylight,preset.daylight||0);gl.uniform1f(uniforms.uTwilight,preset.twilight||0);
    for(const [name,key] of [['uClouds','clouds'],['uStars','stars'],['uSunVisibility','sunVisibility'],['uMoonVisibility','moonVisibility'],['uSkyTime','time']])gl.uniform1f(uniforms[name],preset[key]);
    gl.drawArrays(gl.TRIANGLES,0,3);gl.disableVertexAttribArray(position);
    gl.depthMask(true);gl.enable(gl.DEPTH_TEST);
  }};
}
