// Textured BSP faces use the game's WebGL context and camera.
export function createSourceRenderer(gl) {
  const vertex=`attribute vec3 aPosition;attribute vec2 aUV;attribute float aShade;
    uniform vec3 uEye;uniform vec2 uAngles;uniform vec2 uScale;
    varying vec2 vUV;varying float vShade;varying float vDistance;
    void main(){vec3 p=aPosition-uEye;float cy=cos(uAngles.x),sy=sin(uAngles.x),cp=cos(uAngles.y),sp=sin(uAngles.y);
      float right=p.x*cy+p.z*sy,forward=p.x*sy-p.z*cy;
      float up=p.y*cp-forward*sp,depth=forward*cp+p.y*sp;
      gl_Position=vec4(right*uScale.x,up*uScale.y,1.0001*depth-2.0001,depth);
      vUV=aUV;vShade=aShade;vDistance=length(p);}`;
  const fragment=`precision mediump float;uniform sampler2D uTexture;uniform vec3 uColour;uniform float uTextured;uniform float uUnlit;
    varying vec2 vUV;varying float vShade;varying float vDistance;
    void main(){vec4 tex=mix(vec4(uColour,1.0),texture2D(uTexture,vUV),uTextured);if(tex.a<.35)discard;
      gl_FragColor=vec4(tex.rgb*mix(vShade,1.0,uUnlit)*(1.0-smoothstep(9000.0,18000.0,vDistance)),1.0);}`;
  const shader=(type,text)=>{const s=gl.createShader(type);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  const attributes=[['aPosition',3,0],['aUV',2,12],['aShade',1,20]].map(([name,count,offset])=>({loc:gl.getAttribLocation(program,name),count,offset}));
  const uniforms=Object.fromEntries(['uEye','uAngles','uScale','uTexture','uColour','uTextured','uUnlit'].map(n=>[n,gl.getUniformLocation(program,n)]));
  let current=null,batches=[];
  const white=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,white);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
  return {
    setMap(map) {
      if(map===current)return;
      for(const b of batches){gl.deleteBuffer(b.buffer);if(b.texture!==white)gl.deleteTexture(b.texture);}batches=[];current=map;
      for(const mesh of map.mesh){
        const material=map.materials[mesh.material],buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,mesh.data,gl.STATIC_DRAW);
        let texture=white;
        if(material.image){
          const image=material.image;texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,image.width,image.height,0,gl.RGBA,gl.UNSIGNED_BYTE,image.rgba);
          const pot=n=>(n&(n-1))===0;
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,pot(image.width)&&pot(image.height)?gl.REPEAT:gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,pot(image.width)&&pot(image.height)?gl.REPEAT:gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        }
        batches.push({buffer,texture,material,count:mesh.data.length/6});
      }
    },
    draw(p,scaleX,scaleY) {
      gl.useProgram(program);gl.uniform3f(uniforms.uEye,p.x,p.y+64-p.duckAmount*18,p.z);gl.uniform2f(uniforms.uAngles,p.yaw,p.pitch);gl.uniform2f(uniforms.uScale,scaleX,scaleY);gl.uniform1i(uniforms.uTexture,0);gl.activeTexture(gl.TEXTURE0);
      for(const a of attributes)gl.enableVertexAttribArray(a.loc);
      for(const batch of batches){
        gl.bindBuffer(gl.ARRAY_BUFFER,batch.buffer);for(const a of attributes)gl.vertexAttribPointer(a.loc,a.count,gl.FLOAT,false,24,a.offset);
        gl.bindTexture(gl.TEXTURE_2D,batch.texture);gl.uniform3f(uniforms.uColour,...batch.material.colour);gl.uniform1f(uniforms.uTextured,batch.material.image?1:0);gl.uniform1f(uniforms.uUnlit,batch.material.unlit?1:0);gl.drawArrays(gl.TRIANGLES,0,batch.count);
      }
      for(const a of attributes)gl.disableVertexAttribArray(a.loc);
    },
  };
}
