export const ROOM_PLAYER_COLOURS = [[.48,.77,1],[1,.68,.4],[.46,.9,.7],[.78,.65,1]];
// Remote players are visual geometry only; these boxes never enter collision.
export function buildRemotePlayerMesh(players) {
  const result=[];
  for(const p of players){
    if(![p.x,p.y,p.z,p.yaw,p.duckAmount].every(Number.isFinite))continue;
    const colour=ROOM_PLAYER_COLOURS[p.slot]||ROOM_PLAYER_COLOURS[0],height=72-Math.max(0,Math.min(1,p.duckAmount))*18;
    const cy=Math.cos(p.yaw),sy=Math.sin(p.yaw);
    function box(x,y,z,X,Y,Z,rgb){
      const faces=[[[[x,Y,z],[x,Y,Z],[X,Y,Z],[X,Y,z]],[0,1,0],1.12],[[[x,y,z],[X,y,z],[X,y,Z],[x,y,Z]],[0,-1,0],.38],
        [[[x,y,z],[x,y,Z],[x,Y,Z],[x,Y,z]],[-1,0,0],.65],[[[X,y,Z],[X,y,z],[X,Y,z],[X,Y,Z]],[1,0,0],.8],
        [[[X,y,z],[x,y,z],[x,Y,z],[X,Y,z]],[0,0,-1],.72],[[[x,y,Z],[X,y,Z],[X,Y,Z],[x,Y,Z]],[0,0,1],.87]];
      for(const [points,n,shade] of faces)for(const index of [0,1,2,0,2,3]){
        const [a,b,c]=points[index];result.push(p.x+a*cy-c*sy,p.y+b,p.z+a*sy+c*cy,...rgb,0,n[0]*cy-n[2]*sy,n[1],n[0]*sy+n[2]*cy,shade);
      }
    }
    box(-13,18,-8,13,height-19,8,colour);box(-10,height-19,-10,10,height,10,[.8,.83,.85]);
    box(-13,0,-7,-2,18,7,colour.map(c=>c*.6));box(2,0,-7,13,18,7,colour.map(c=>c*.6));
    box(-21,20,-6,-14,height-22,6,colour);box(14,20,-6,21,height-22,6,colour);
    box(-6,height-12,-12,6,height-8,-10,[.08,.1,.12]);
  }
  return new Float32Array(result);
}
