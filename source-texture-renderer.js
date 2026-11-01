import {base64ToBytes,decodeVtf} from './source-textures.js';

// A separate pass overlays supported embedded material images on BSP faces.
// Collision stays in the usual untextured brush renderer, and missing materials
// leave the existing grey geometry untouched.
export function createSourceTextureRenderer(gl){
  const vertex=`attribute vec3 aPosition;attribute vec2 aUv;attribute float aShade;
    uniform vec3 uEye;uniform vec2 uAngles;uniform vec2 uScale;
    varying vec2 vUv;varying float vShade;varying float vDistance;
    void main(){
      vec3 p=aPosition-uEye;
      float cy=cos(uAngles.x),sy=sin(uAngles.x),cp=cos(uAngles.y),sp=sin(uAngles.y);
      float right=p.x*cy+p.z*sy,forward=p.x*sy-p.z*cy;
      float up=p.y*cp-forward*sp,depth=forward*cp+p.y*sp;
      gl_Position=vec4(right*uScale.x,up*uScale.y,1.0001*depth-2.0001,depth);
      vUv=aUv;vShade=aShade;vDistance=length(p);
    }`;
  const fragment=`precision mediump float;
    uniform sampler2D uImage;varying vec2 vUv;varying float vShade;varying float vDistance;
    void main(){
      vec4 texel=texture2D(uImage,vUv);
      if(texel.a<0.15)discard;
      float fade=1.0-smoothstep(1700.0,6500.0,vDistance);
      gl_FragColor=vec4(texel.rgb*max(0.35,vShade)*fade,1.0);
    }`;
  const compile=(type,source)=>{
    const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const program=gl.createProgram(),v=compile(gl.VERTEX_SHADER,vertex),f=compile(gl.FRAGMENT_SHADER,fragment);
  gl.attachShader(program,v);gl.attachShader(program,f);gl.linkProgram(program);
  gl.deleteShader(v);gl.deleteShader(f);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  const attributes=[['aPosition',3,0],['aUv',2,12],['aShade',1,20]]
    .map(([name,count,offset])=>({loc:gl.getAttribLocation(program,name),count,offset}));
  const uniforms=Object.fromEntries(['uEye','uAngles','uScale','uImage'].map(name=>[name,gl.getUniformLocation(program,name)]));
  let resources=[],revision=0;
  function dispose(){
    revision++;
    for(const resource of resources){gl.deleteBuffer(resource.buffer);gl.deleteTexture(resource.texture);}
    resources=[];
  }
  function prepareTexture(resource,source,pixels=null){
    if(resource.revision!==revision)return;
    const texture=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    const pot=x=>x>0&&(x&(x-1))===0;
    const wrap=pot(source.width)&&pot(source.height)?gl.REPEAT:gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,wrap);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,wrap);
    if(pixels)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,source.width,source.height,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
    resource.texture=texture;
    gl.bindTexture(gl.TEXTURE_2D,null);gl.activeTexture(gl.TEXTURE0);
  }
  function set(entries){
    dispose();
    for(const entry of entries||[]){
      try{
        const bytes=base64ToBytes(entry.vertices);
        if(bytes.length<72||bytes.length%72)continue;
        const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
        gl.bufferData(gl.ARRAY_BUFFER,bytes,gl.STATIC_DRAW);
        const resource={buffer,texture:null,count:bytes.length/24,revision};
        resources.push(resource);
        if(entry.type==='vtf'){
          const decoded=decodeVtf(base64ToBytes(entry.image));
          prepareTexture(resource,decoded,decoded.pixels);
        }else{
          const image=new Image();
          image.onload=()=>{try{prepareTexture(resource,image);}catch{ /* Unsupported image: retain grey fallback. */ }};
          image.onerror=()=>{};
          image.src='data:image/'+entry.type+';base64,'+entry.image;
        }
      }catch{ /* Unsupported material: keep the untextured geometry. */ }
    }
  }
  function draw(player,scaleX,scaleY,height,worldPipeline,bindWorld){
    if(!resources.some(r=>r.texture))return;
    const active=gl.getParameter(gl.ACTIVE_TEXTURE);
    for(const attribute of worldPipeline.attributes)gl.disableVertexAttribArray(attribute.loc);
    gl.useProgram(program);
    for(const attribute of attributes)if(attribute.loc>=0)gl.enableVertexAttribArray(attribute.loc);
    gl.uniform3f(uniforms.uEye,player.x,player.y+height,player.z);
    gl.uniform2f(uniforms.uAngles,player.yaw,player.pitch);
    gl.uniform2f(uniforms.uScale,scaleX,scaleY);
    gl.uniform1i(uniforms.uImage,1);
    gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(-1,-1);
    for(const resource of resources){
      if(!resource.texture)continue;
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,resource.texture);
      gl.bindBuffer(gl.ARRAY_BUFFER,resource.buffer);
      for(const a of attributes)if(a.loc>=0)gl.vertexAttribPointer(a.loc,a.count,gl.FLOAT,false,24,a.offset);
      gl.drawArrays(gl.TRIANGLES,0,resource.count);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    for(const a of attributes)if(a.loc>=0)gl.disableVertexAttribArray(a.loc);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,null);gl.activeTexture(active);
    gl.useProgram(worldPipeline.program);
    for(const a of worldPipeline.attributes)gl.enableVertexAttribArray(a.loc);
    bindWorld();
  }
  return {set,draw,dispose};
}
