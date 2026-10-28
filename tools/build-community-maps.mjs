// Rebuild the small platform-only cache from the original, unchanged archives.
import {readFileSync,writeFileSync} from 'node:fs';
import {COMMUNITY_MAPS} from '../dist/course.js';
import {loadSourceMap} from '../dist/source-map.js';
import {mapPreviewSVG} from '../dist/menu.js';
for(const metadata of COMMUNITY_MAPS){
  const source=new URL('../dist/'+metadata.archive,import.meta.url);
  const map=await loadSourceMap(readFileSync(source),metadata);
  const data=JSON.stringify(map,(key,value)=>key==='sourceMap'?undefined:value)+'\n';
  writeFileSync(new URL('../dist/'+metadata.geometry,import.meta.url),data);
  const style='<style>svg{background:#101419}.preview-platform{fill:#747e86;stroke:#0b0e11;stroke-width:.2}.preview-checkpoint,.preview-spawn{fill:#7ec8ff}.preview-finish{fill:white}.preview-grid{stroke:#ffffff0d;stroke-width:.3}.preview-route{display:none}</style>';
  const preview=mapPreviewSVG(map).replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" ').replace('aria-hidden="true"','').replace('<path ',style+'<path ');
  writeFileSync(new URL('../dist/'+metadata.thumbnail,import.meta.url),preview);
  console.log(`${metadata.title}: ${map.boxes.length} parkour blocks, ${data.length.toLocaleString()} bytes`);
}
