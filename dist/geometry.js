// Untextured convex solids shared by the importer, renderer and player hull.
// A curved brush is a polygonal solid; its original facets stay intact.
const GEOMETRY_EPS = 1e-5;
const geometryFaces = new WeakMap();
const geometryDot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const geometryCross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const isShapedBrush = box => !!box.planes?.some(p=>p.normal.some(n=>Math.abs(n)>GEOMETRY_EPS&&Math.abs(n)<1-GEOMETRY_EPS));

export function boxPlanes(box) {
  return [0,1,2].flatMap(axis=>[1,-1].map(sign=>({normal:[0,1,2].map(i=>i===axis?sign:0),distance:sign>0?box.max[axis]:-box.min[axis]})));
}

function clipGeometryFace(points,plane) {
  const result=[];
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length],da=geometryDot(a,plane.normal)-plane.distance,db=geometryDot(b,plane.normal)-plane.distance;
    if(da<=GEOMETRY_EPS)result.push(a);
    if(da>GEOMETRY_EPS&&db<-GEOMETRY_EPS||da<-GEOMETRY_EPS&&db>GEOMETRY_EPS) {
      const t=da/(da-db);result.push(a.map((v,j)=>v+(b[j]-v)*t));
    }
  }
  return result.filter((p,i)=>Math.hypot(...p.map((v,j)=>v-result[(i+result.length-1)%result.length][j]))>GEOMETRY_EPS);
}

export function convexFaces(box) {
  if(geometryFaces.has(box))return geometryFaces.get(box);
  const planes=box.planes||boxPlanes(box),extent=Math.max(131072,...planes.map(p=>Math.abs(p.distance)*4));
  const faces=[];
  for(const plane of planes) {
    const n=plane.normal,axis=Math.abs(n[1])<.9?[0,1,0]:[1,0,0];
    let u=geometryCross(axis,n);const length=Math.hypot(...u);u=u.map(v=>v/length);
    const v=geometryCross(n,u),centre=n.map(t=>t*plane.distance);
    let points=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>centre.map((t,j)=>t+extent*(a*u[j]+b*v[j])));
    for(const other of planes)if(other!==plane&&points.length)points=clipGeometryFace(points,other);
    if(points.length<3)continue;
    // An open or corrupt hull must not generate an enormous fake platform.
    if(points.some(p=>Math.abs(geometryDot(p.map((t,j)=>t-centre[j]),u))>extent-1||Math.abs(geometryDot(p.map((t,j)=>t-centre[j]),v))>extent-1))throw Error('The map contains an open collision shape.');
    const area=points.slice(1,-1).reduce((sum,p,i)=>sum+Math.hypot(...geometryCross(p.map((t,j)=>t-points[0][j]),points[i+2].map((t,j)=>t-points[0][j]))),0);
    if(area>GEOMETRY_EPS)faces.push({normal:n,distance:plane.distance,points});
  }
  geometryFaces.set(box,faces);return faces;
}

export function makeConvexBrush(input) {
  if(!Array.isArray(input)||input.length<4||input.length>512)throw Error('Unsupported collision shape.');
  const planes=[];
  for(const p of input) {
    if(!p||!Array.isArray(p.normal)||p.normal.length!==3||!p.normal.every(Number.isFinite)||!Number.isFinite(p.distance))throw Error('Invalid collision planes.');
    const length=Math.hypot(...p.normal);
    if(length<1e-6||Math.abs(p.distance/length)>1000000)throw Error('Invalid collision planes.');
    const normal=p.normal.map(n=>n/length),distance=p.distance/length;
    const duplicate=planes.find(q=>normal.every((n,i)=>Math.abs(n-q.normal[i])<1e-7));
    if(duplicate)duplicate.distance=Math.min(duplicate.distance,distance);else planes.push({normal,distance});
  }
  const brush={planes},min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  // Most brushes are boxes. Avoid polygon clipping for this common case.
  if(!isShapedBrush(brush)) {
    min.fill(-Infinity);max.fill(Infinity);
    for(const p of planes){const axis=p.normal.findIndex(n=>Math.abs(n)>.99999);if(p.normal[axis]>0)max[axis]=Math.min(max[axis],p.distance);else min[axis]=Math.max(min[axis],-p.distance);}
  } else {
    const faces=convexFaces(brush);
    if(faces.length<4)throw Error('The map contains an empty collision shape.');
    for(const face of faces)for(const point of face.points)for(let i=0;i<3;i++){min[i]=Math.min(min[i],point[i]);max[i]=Math.max(max[i],point[i]);}
    // Hull/brush edge bevels make the swept square player exact at corners.
    // Reconstruct them too when a rotated model has no world-axis bevels.
    const points=faces.flatMap(f=>f.points);
    const addAxis=normal=>{
      const length=Math.hypot(...normal);if(length<1e-7)return;
      normal=normal.map(n=>n/length);
      if(planes.some(p=>normal.every((n,i)=>Math.abs(n-p.normal[i])<1e-6)))return;
      planes.push({normal,distance:Math.max(...points.map(p=>geometryDot(p,normal)))});
    };
    for(let i=0;i<3;i++)for(const sign of [-1,1])addAxis([0,1,2].map(j=>i===j?sign:0));
    for(const face of faces)for(let i=0;i<face.points.length;i++) {
      const edge=face.points[(i+1)%face.points.length].map((v,j)=>v-face.points[i][j]);
      for(const axis of [[1,0,0],[0,1,0],[0,0,1]]){const n=geometryCross(edge,axis);addAxis(n);addAxis(n.map(v=>-v));}
    }
  }
  if(min.some((n,i)=>!Number.isFinite(n)||!Number.isFinite(max[i])||max[i]-n<GEOMETRY_EPS))throw Error('The map contains an empty collision shape.');
  brush.min=min;brush.max=max;return brush;
}

export function hullPlaneDistance(plane,height=72,radius=16) {
  const n=plane.normal;return plane.distance+radius*(Math.abs(n[0])+Math.abs(n[2]))-Math.min(0,n[1])*height;
}

export function brushHullOverlap(player,box,height=72,radius=16) {
  const p=[player.x,player.y,player.z];
  if(p.some((v,i)=>v+(i===1?height:radius)<=box.min[i]+GEOMETRY_EPS||v-(i===1?0:radius)>=box.max[i]-GEOMETRY_EPS))return false;
  return !box.planes||box.planes.every(plane=>geometryDot(p,plane.normal)<hullPlaneDistance(plane,height,radius)-GEOMETRY_EPS);
}

// The highest actual contact under a hull, including sloping tops. Side and
// bevel constraints reject empty corners of wedges and polygonal cylinders.
export function brushSurface(box,x,z,radius=16,height=72,minUp=.7) {
  if(x+radius<=box.min[0]+GEOMETRY_EPS||x-radius>=box.max[0]-GEOMETRY_EPS||z+radius<=box.min[2]+GEOMETRY_EPS||z-radius>=box.max[2]-GEOMETRY_EPS)return null;
  if(!box.planes)return {height:box.max[1],normal:[0,1,0]};
  let y=Infinity,normal=null;
  for(const plane of box.planes)if(plane.normal[1]>GEOMETRY_EPS) {
    const top=(hullPlaneDistance(plane,height,radius)-x*plane.normal[0]-z*plane.normal[2])/plane.normal[1];
    if(top<y){y=top;normal=plane.normal;}
  }
  if(!normal||normal[1]<minUp||!Number.isFinite(y)||box.planes.some(plane=>x*plane.normal[0]+y*plane.normal[1]+z*plane.normal[2]>hullPlaneDistance(plane,height,radius)+.0001))return null;
  return {height:y,normal};
}

export function safeGeometrySpawn(point,boxes,maxDrop=512) {
  for(const [dx,dz] of [[0,0],...Array.from({length:3},(_,i)=>(i+1)*32).flatMap(r=>[[r,0],[-r,0],[0,r],[0,-r],[r,r],[-r,r],[r,-r],[-r,-r]])]) {
    const x=point.x+dx,z=point.z+dz;
    const candidates=boxes.filter(b=>!b.ladder).map(box=>({box,surface:brushSurface(box,x,z)}))
      .filter(c=>c.surface&&c.surface.height<=point.y+18&&c.surface.height>=point.y-maxDrop).sort((a,b)=>b.surface.height-a.surface.height);
    for(const {box,surface} of candidates) {
      const spawn={...point,x,y:surface.height,z,pitch:0};
      if(!boxes.some(b=>!b.ladder&&brushHullOverlap(spawn,b)))return {spawn,box};
    }
  }
  throw Error('No clear standing space was found near the map spawn.');
}

// Extrude each upward face vertically to form an accurate checkpoint volume.
const geometryCheckpointVolumes=new WeakMap();
export function brushCheckpointVolumes(box) {
  if(!isShapedBrush(box))return [{min:[box.min[0],box.max[1]-.01,box.min[2]],max:[box.max[0],box.max[1]+96,box.max[2]]}];
  if(geometryCheckpointVolumes.has(box))return geometryCheckpointVolumes.get(box);
  const volumes=convexFaces(box).filter(f=>f.normal[1]>.7).map(face=>{
    const n=face.normal,planes=[{normal:n,distance:face.distance+96*n[1]},{normal:n.map(v=>-v),distance:-face.distance+.01*n[1]}];
    for(let i=0;i<face.points.length;i++) {
      const a=face.points[i],b=face.points[(i+1)%face.points.length],normal=[a[2]-b[2],0,b[0]-a[0]];
      planes.push({normal,distance:geometryDot(normal,a)});
    }
    return {planes};
  });
  geometryCheckpointVolumes.set(box,volumes);return volumes;
}

export function buildBrushMesh(box,base=.46) {
  const data=[],rgb=Array.isArray(base)?base:[base,base,base];
  for(const {normal,points} of convexFaces(box)) {
    const top=normal[1]>.7?1:0,shade=.76+.36*Math.max(0,normal[1])+.38*Math.min(0,normal[1])+.075*normal[0]+.075*normal[2];
    for(let i=1;i<points.length-1;i++)for(const point of [points[0],points[i],points[i+1]])data.push(...point,...rgb,top,...normal,shade);
  }
  return data;
}
