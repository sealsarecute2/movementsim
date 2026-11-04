import {base64ToBytes,decodeVtf} from './source-textures.js';

// Derive a face normal for lighting without changing saved or shared map data.
function sourceTextureVertices(bytes){
  const packed=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
  if(!packed.every(Number.isFinite))return null;
  const vertices=new Float32Array(packed.length/6*9);
  for(let i=0,j=0;i<packed.length;i+=18){
    const ax=packed[i+6]-packed[i],ay=packed[i+7]-packed[i+1],az=packed[i+8]-packed[i+2];
    const bx=packed[i+12]-packed[i],by=packed[i+13]-packed[i+1],bz=packed[i+14]-packed[i+2];
    const nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx;
    const length=Math.hypot(nx,ny,nz)||1;
    for(let k=i;k<i+18;k+=6,j+=9){
      for(let component=0;component<6;component++)vertices[j+component]=packed[k+component];
      vertices[j+6]=nx/length;vertices[j+7]=ny/length;vertices[j+8]=nz/length;
    }
  }
  return vertices;
}

// A separate pass overlays supported embedded material images on BSP faces.
// Collision stays in the usual untextured brush renderer, and missing materials
// leave the existing grey geometry untouched.
export function createSourceTextureRenderer(gl,pipeline){
  const {program,attributes,uniforms}=pipeline;
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
        const vertices=sourceTextureVertices(bytes);
        if(!vertices)continue;
        const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
        gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
        const resource={buffer,texture:null,count:vertices.length/9,revision};
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
  function draw(worldPipeline,setFrameUniforms,bindWorld){
    if(!resources.some(r=>r.texture))return;
    const active=gl.getParameter(gl.ACTIVE_TEXTURE);
    for(const attribute of worldPipeline.attributes)gl.disableVertexAttribArray(attribute.loc);
    gl.useProgram(program);
    for(const attribute of attributes)if(attribute.loc>=0)gl.enableVertexAttribArray(attribute.loc);
    setFrameUniforms(pipeline);
    gl.uniform1i(uniforms.uImage,1);
    gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(-1,-1);
    for(const resource of resources){
      if(!resource.texture)continue;
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,resource.texture);
      gl.bindBuffer(gl.ARRAY_BUFFER,resource.buffer);
      for(const a of attributes)if(a.loc>=0)gl.vertexAttribPointer(a.loc,a.count,gl.FLOAT,false,36,a.offset);
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
