// Offscreen buffers are reused while the slideshow is captured, then released.
// Gameplay uses a separate shader without the gallery's shadow sampling.
export const GALLERY_SHADOW_VERTEX = `attribute vec3 aPosition;
uniform mat4 uGalleryShadowMatrix;
varying highp float vGalleryDepth;
void main(){
  vec4 position=uGalleryShadowMatrix*vec4(aPosition,1.0);
  vGalleryDepth=position.z*0.5+0.5;gl_Position=position;
}`;
export const GALLERY_SHADOW_FRAGMENT = `
precision highp float;
varying highp float vGalleryDepth;
void main(){
  vec2 depth=fract(min(vGalleryDepth,0.99998)*vec2(1.0,255.0));
  depth.x-=depth.y/255.0;gl_FragColor=vec4(depth,0.0,1.0);
}`;
export const GALLERY_SHADOW_GLSL = `
uniform highp sampler2D uGalleryShadowMap;
uniform float uGalleryShadowTexel;
uniform mat3 uGalleryShadowNormalMatrix;
varying highp vec3 vGalleryShadow;
float galleryVisibility(vec3 normal,vec3 light){
  vec3 p=vGalleryShadow;
  if(any(lessThan(p,vec3(0.0)))||any(greaterThan(p,vec3(1.0))))return 1.0;
  if(dot(normal,light)<=0.001)return 1.0;
  vec3 plane=uGalleryShadowNormalMatrix*normal;
  vec2 slope=-plane.xy/plane.z;
  float visible=0.0;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 uv=p.xy+vec2(float(x),float(y))*uGalleryShadowTexel*1.5;
    vec2 centre=(floor(uv/uGalleryShadowTexel)+0.5)*uGalleryShadowTexel;
    vec2 sampleDepth=texture2D(uGalleryShadowMap,uv).rg;
    float receiver=p.z+dot(slope,centre-p.xy);
    visible+=step(receiver-0.00035,dot(sampleDepth,vec2(1.0,1.0/255.0)));
  }
  return visible/9.0;
}`;

export function galleryShadowMatrix(boxes,direction) {
  const length=Math.hypot(...direction),light=direction.map(n=>n/length),side=Math.hypot(light[0],light[2]);
  const right=side>.001?[light[2]/side,0,-light[0]/side]:[1,0,0];
  const up=[light[1]*right[2]-light[2]*right[1],light[2]*right[0]-light[0]*right[2],light[0]*right[1]-light[1]*right[0]];
  const axes=[right,up,light.map(n=>-n)],bounds=axes.map(()=>[Infinity,-Infinity]);
  for(const box of boxes)for(const x of [box.min[0],box.max[0]])for(const y of [box.min[1],box.max[1]])for(const z of [box.min[2],box.max[2]]){
    axes.forEach((axis,i)=>{const v=x*axis[0]+y*axis[1]+z*axis[2];bounds[i][0]=Math.min(bounds[i][0],v);bounds[i][1]=Math.max(bounds[i][1],v);});
  }
  const matrix=new Float32Array(16);matrix[15]=1;
  axes.forEach((axis,row)=>{
    const min=bounds[row][0]-32,max=bounds[row][1]+32,scale=2/Math.max(1,max-min);
    for(let col=0;col<3;col++)matrix[col*4+row]=axis[col]*scale;
    matrix[12+row]=-(max+min)/Math.max(1,max-min);
  });
  return matrix;
}

export function galleryCaptureSize(aspect=1,maxEdge=3072) {
  aspect=Number.isFinite(aspect)?Math.max(.35,Math.min(3,aspect)):1;
  const outputWidth=Math.round(aspect>=1?1920:1920*aspect),outputHeight=Math.round(aspect>=1?1920/aspect:1920);
  const scale=Math.min(1.5,maxEdge/Math.max(outputWidth,outputHeight),Math.sqrt(5*1024*1024/(outputWidth*outputHeight)));
  return {width:Math.max(1,Math.floor(outputWidth*scale)),height:Math.max(1,Math.floor(outputHeight*scale)),
    outputWidth:Math.min(outputWidth,Math.max(1,Math.floor(outputWidth*scale))),outputHeight:Math.min(outputHeight,Math.max(1,Math.floor(outputHeight*scale)))};
}

// Transform a receiver plane into light space so each soft-shadow tap compares
// against the same surface, including on sloping sides and long platforms.
export function galleryShadowNormalMatrix(matrix){
  const normal=new Float32Array(9);
  for(let row=0;row<3;row++){
    const scale=matrix[row]**2+matrix[row+4]**2+matrix[row+8]**2;
    for(let col=0;col<3;col++)normal[col*3+row]=matrix[col*4+row]/scale;
  }
  return normal;
}

export function createGalleryTarget(gl,width,height) {
  const framebuffer=gl.createFramebuffer(),texture=gl.createTexture(),depth=gl.createRenderbuffer();
  const dispose=()=>{gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);gl.deleteRenderbuffer(depth);};
  try {
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,width,height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Gallery capture buffer unavailable.');
    return {framebuffer,texture,width,height,dispose};
  }catch(error){dispose();throw error;}
}
