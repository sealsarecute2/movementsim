export const ROOM_PLAYER_COLOURS = [[.48,.77,1],[1,.68,.4],[.46,.9,.7],[.78,.65,1]];
// Remote players are visual geometry only; these boxes never enter collision.
export function buildRemotePlayerMesh(players) {
  const result=[];
  for(const p of players){
    if(![p.x,p.y,p.z,p.yaw,p.duckAmount].every(Number.isFinite))continue;
    const colour=ROOM_PLAYER_COLOURS[p.slot]||ROOM_PLAYER_COLOURS[0],duck=Math.max(0,Math.min(1,p.duckAmount)),height=72-duck*18;
    const cy=Math.cos(p.yaw),sy=Math.sin(p.yaw);
    function box(x,y,z,X,Y,Z,rgb,tilt=0){
      const centreY=(y+Y)/2,centreZ=(z+Z)/2,ct=Math.cos(tilt),st=Math.sin(tilt);
      const faces=[[[[x,Y,z],[x,Y,Z],[X,Y,Z],[X,Y,z]],[0,1,0],1.12],[[[x,y,z],[X,y,z],[X,y,Z],[x,y,Z]],[0,-1,0],.38],
        [[[x,y,z],[x,y,Z],[x,Y,Z],[x,Y,z]],[-1,0,0],.65],[[[X,y,Z],[X,y,z],[X,Y,z],[X,Y,Z]],[1,0,0],.8],
        [[[X,y,z],[x,y,z],[x,Y,z],[X,Y,z]],[0,0,-1],.72],[[[x,y,Z],[X,y,Z],[X,Y,Z],[x,Y,Z]],[0,0,1],.87]];
      for(const [points,n,shade] of faces)for(const index of [0,1,2,0,2,3]){
        const [a,b,c]=points[index],dy=b-centreY,dz=c-centreZ;
        const y=centreY+dy*ct-dz*st,z=centreZ+dy*st+dz*ct,ny=n[1]*ct-n[2]*st,nz=n[1]*st+n[2]*ct;
        result.push(p.x+a*cy-z*sy,p.y+y,p.z+a*sy+z*cy,...rgb,0,n[0]*cy-nz*sy,ny,n[0]*sy+nz*cy,shade);
      }
    }
    function limb(x,ay,az,by,bz,width,depth,rgb){
      const length=Math.hypot(by-ay,bz-az),y=(ay+by)/2,z=(az+bz)/2;
      box(x-width/2,y-length/2,z-depth/2,x+width/2,y+length/2,z+depth/2,rgb,Math.atan2(bz-az,by-ay));
    }
    // duckAmount already eases locally and is interpolated over the network.
    // Bend the legs and reach the arms forward instead of shrinking the avatar.
    const hip=30-duck*12,knee=16-duck*4,trousers=colour.map(c=>c*.6),shoes=colour.map(c=>c*.35);
    box(-13,hip,-8-duck*2,13,height-19,8-duck*2,colour);
    box(-10,height-19,-10-duck*4,10,height,10-duck*4,[.8,.83,.85]);
    for(const x of [-7.5,7.5])limb(x,knee,-duck*12,hip,duck*3,11,12,trousers);
    for(const x of [-7.5,7.5])limb(x,6,0,knee,-duck*12,10,10,trousers);
    for(const x of [-7.5,7.5])box(x-6,0,-10,x+6,6,8,shoes);
    for(const x of [-17.5,17.5])limb(x,height-42,-duck*10,height-23,0,7,10,colour);
    box(-6,height-12,-12-duck*4,6,height-8,-10-duck*4,[.08,.1,.12]);
  }
  return new Float32Array(result);
}
