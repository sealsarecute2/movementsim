// Optional Source 1 material images. Source's game-installed textures cannot be
// recovered from the BSP; only image assets shipped inside the map are used.
const MAX_ASSET_BYTES=4*1024*1024;
const MAX_TOTAL_BYTES=8*1024*1024;
const MAX_MESH_BYTES=5*1024*1024;
const MAX_MATERIALS=64;
const imageExtension=/\.(vtf|png|jpe?g|webp)$/i;
const assetExtension=/\.(vtf|png|jpe?g|webp|vmt)$/i;
const normalized=name=>String(name).toLowerCase().replace(/\\/g,'/').replace(/^.*?(?:materials\/)/,'').replace(/^\/+|\.(vtf|vmt|png|jpe?g|webp)$/g,'');
export function bytesToBase64(bytes){
  let string='';for(let i=0;i<bytes.length;i+=8192)string+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(string);
}
export function base64ToBytes(text){return Uint8Array.from(atob(text),c=>c.charCodeAt(0));}
const formatOf=name=>name.toLowerCase().split('.').pop().replace('jpg','jpeg');
async function archiveAssets(bytes) {
  if(bytes.length<4||bytes[0]!==80||bytes[1]!==75)return new Map();
  const {unzipSync}=await import('./vendor/fflate.module.js');
  let selected=0,declared=0;
  const entries=unzipSync(bytes,{filter:f=>{
    if(!assetExtension.test(f.name)||f.originalSize<1||f.originalSize>MAX_ASSET_BYTES||selected>=512)return false;
    if(declared+f.originalSize>24*1024*1024)return false;
    selected++;declared+=f.originalSize;return true;
  }});
  return new Map(Object.entries(entries).map(([key,data])=>[normalized(key)+'.'+formatOf(key),{name:key,data}]));
}
export async function collectSourceTextures(input,pak,mesh){
  if(!mesh?.length)return [];
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  const [external,embedded]=await Promise.all([archiveAssets(bytes).catch(()=>new Map()),archiveAssets(pak).catch(()=>new Map())]);
  const assets=new Map([...external,...embedded]); // Embedded BSP assets take priority.
  const redirects=new Map();
  for(const [key,{name,data}] of assets)if(/\.vmt$/i.test(name)){
    const match=new TextDecoder('windows-1252').decode(data).match(/\$basetexture\s+"?([^"\s]+)"?/i);
    if(match)redirects.set(normalized(name),normalized(match[1]));
  }
  let total=0,meshTotal=0;
  const result=[];
  for(const batch of mesh){
    if(result.length>=MAX_MATERIALS)break;
    const key=normalized(batch.material),base=redirects.get(key)||key;
    const choices=[base,key].flatMap(s=>[s+'.vtf',s+'.png',s+'.jpg',s+'.jpeg',s+'.webp']);
    // Assets are indexed by their normalized file stem, preserving the extension
    // separately so Source .vmt redirection and folders both work.
    let asset=null;
    for(const candidate of choices){
      const match=assets.get(candidate);
      if(match){asset=match;break;}
    }
    if(!asset||!imageExtension.test(asset.name))continue;
    const vertexData=new Uint8Array(batch.data.buffer,batch.data.byteOffset,batch.data.byteLength);
    if(!vertexData.length||vertexData.length%72||vertexData.length>MAX_MESH_BYTES)continue;
    if(total+asset.data.length>MAX_TOTAL_BYTES||meshTotal+vertexData.length>MAX_MESH_BYTES)continue;
    const type=formatOf(asset.name);
    result.push({material:batch.material,type,image:bytesToBase64(asset.data),vertices:bytesToBase64(vertexData)});
    total+=asset.data.length;meshTotal+=vertexData.length;
  }
  return result;
}

// Limited, memory-bounded VTF v7 decoder: highest-resolution image, first frame.
export function decodeVtf(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.length<80||String.fromCharCode(...bytes.subarray(0,4))!=='VTF\0')throw Error('Invalid VTF texture.');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),minor=v.getUint32(8,true);
  const header=v.getUint32(12,true),width=v.getUint16(16,true),height=v.getUint16(18,true);
  const frames=v.getUint16(24,true),format=v.getInt32(52,true),levels=bytes[56],lowFormat=v.getInt32(57,true),lw=bytes[61],lh=bytes[62];
  if(v.getUint32(4,true)!==7||minor>5||header<64||header>bytes.length||width<1||height<1||width>2048||height>2048||!frames||frames>64||!levels||levels>16)throw Error('Unsupported VTF header.');
  const size=(w,h,f)=>f===13?Math.ceil(w/4)*Math.ceil(h/4)*8:f===14||f===15?Math.ceil(w/4)*Math.ceil(h/4)*16:
    f===0||f===1||f===12||f===16?w*h*4:f===2||f===3?w*h*3:0;
  const lowSize=lowFormat===-1?0:size(lw,lh,lowFormat);
  if(lowFormat!==-1&&!lowSize)throw Error('Unsupported VTF thumbnail.');
  let offset=header+lowSize;
  for(let i=levels-1;i>=1;i--){
    const sizeAt=size(Math.max(1,width>>i),Math.max(1,height>>i),format);
    if(!sizeAt)throw Error('Unsupported VTF pixel format.');
    offset+=sizeAt*frames;
  }
  const required=size(width,height,format);
  if(!required||offset+required>bytes.length)throw Error('Incomplete VTF texture.');
  const src=bytes.subarray(offset,offset+required),out=new Uint8Array(width*height*4);
  const pixel=(x,y,r,g,b,a=255)=>{
    if(x>=width||y>=height)return;
    const p=(y*width+x)*4;out[p]=r;out[p+1]=g;out[p+2]=b;out[p+3]=a;
  };
  const rgb565=c=>[Math.round(((c>>11)&31)*255/31),Math.round(((c>>5)&63)*255/63),Math.round((c&31)*255/31)];
  if([13,14,15].includes(format)){
    const blockBytes=format===13?8:16;
    for(let by=0;by<Math.ceil(height/4);by++)for(let bx=0;bx<Math.ceil(width/4);bx++){
      const start=(by*Math.ceil(width/4)+bx)*blockBytes,c=start+(format===13?0:8);
      const c0=src[c]|src[c+1]<<8,c1=src[c+2]|src[c+3]<<8,r0=rgb565(c0),r1=rgb565(c1);
      const colors=[r0,r1,c0>c1||format!==13?r0.map((n,i)=>Math.round((2*n+r1[i])/3)):r0.map((n,i)=>Math.round((n+r1[i])/2)),
        c0>c1||format!==13?r0.map((n,i)=>Math.round((n+2*r1[i])/3)):[0,0,0]];
      let alphas=null;
      if(format===15){
        const a0=src[start],a1=src[start+1],palette=[a0,a1];
        for(let j=1;j<=6;j++)palette.push(a0>a1?Math.round(((7-j)*a0+j*a1)/7):
          j<=4?Math.round(((5-j)*a0+j*a1)/5):j===5?0:255);
        let bits=0n;for(let j=0;j<6;j++)bits|=BigInt(src[start+2+j])<<BigInt(j*8);
        alphas=Array.from({length:16},(_,j)=>palette[Number((bits>>BigInt(j*3))&7n)]);
      }
      const indices=src[c+4]|src[c+5]<<8|src[c+6]<<16|src[c+7]<<24;
      for(let j=0;j<16;j++){
        const index=(indices>>>(j*2))&3,shade=colors[index];
        const alpha=format===15?alphas[j]:format===14?((src[start+(j>>1)]>>((j&1)*4))&15)*17:
          format===13&&c0<=c1&&index===3?0:255;
        pixel(bx*4+j%4,by*4+(j>>2),...shade,alpha);
      }
    }
  } else {
    const bpp=[2,3].includes(format)?3:4;
    for(let i=0;i<width*height;i++){
      const a=i*bpp,r=src[a],g=src[a+1],b=src[a+2],alpha=bpp===4?src[a+3]:255;
      if(format===0)pixel(i%width,Math.floor(i/width),r,g,b,alpha);
      else if(format===1)pixel(i%width,Math.floor(i/width),src[a+3],src[a+2],src[a+1],src[a]);
      else if(format===2)pixel(i%width,Math.floor(i/width),r,g,b);
      else pixel(i%width,Math.floor(i/width),b,g,r,format===12?alpha:255);
    }
  }
  return {width,height,pixels:out};
}
