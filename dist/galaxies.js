import { GALAXY_ENVIRONMENT } from './galaxy-data.js';

export function decodeGalaxyAsset(input,inflate) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.length<17||bytes.length>12*1024*1024||String.fromCharCode(...bytes.subarray(0,4))!=='MLBG'||bytes[4]!==1||bytes[5]!==4)throw Error('Invalid galaxy background.');
  const header=new DataView(bytes.buffer,bytes.byteOffset,16),width=header.getUint16(8,true),height=header.getUint16(10,true),size=header.getUint32(12,true);
  if(width!==GALAXY_ENVIRONMENT.width||height!==GALAXY_ENVIRONMENT.height||size!==width*height*4)throw Error('Invalid galaxy dimensions.');
  const pixels=inflate(bytes.subarray(16),{out:new Uint8Array(size)});
  if(pixels.length!==size)throw Error('Incomplete galaxy background.');
  return {width,height,pixels};
}

export async function loadGalaxyEnvironment({fetcher=globalThis.fetch}={}) {
  const response=await fetcher('backgrounds/galaxies.mlbg?v=1',{cache:'force-cache'});
  if(!response.ok)throw Error('Could not download the galaxy background.');
  const data=await response.arrayBuffer(),{unzlibSync}=await import('./vendor/fflate.module.js');
  return decodeGalaxyAsset(data,unzlibSync);
}
