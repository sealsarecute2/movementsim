// Original browser models and animation curves, inspired by the vanilla knives.
// These are recreations, not Valve meshes or original Source 2 animation clips.
const steel=[.36,.39,.42],black=[.045,.052,.049],olive=[.10,.13,.075],wood=[.25,.12,.065];
const knife=(id,name,profile,handle=black,motion='standard',extra={})=>({id,name,profile,handle,motion,blade:steel,...extra});
export const KNIFE_LIST=[
  knife('default-ct','Default CT',[[-.12,0],[.12,0],[.14,.70],[.02,1.02],[-.12,.77]],olive),
  knife('default-t','Default T',[[-.13,0],[.13,0],[.19,.63],[.09,1.05],[-.15,.91],[-.20,.55]],black,'standard',{serrated:true}),
  knife('bayonet','Bayonet',[[-.12,0],[.12,0],[.12,.91],[0,1.27],[-.12,.96]],olive,'standard',{fuller:true,guard:.26}),
  knife('m9','M9 Bayonet',[[-.15,0],[.15,0],[.15,.37],[.21,.41],[.14,.45],[.21,.49],[.14,.53],[.21,.57],[.14,.61],[.21,.65],[.14,.69],[.21,.73],[.14,.77],[.19,.87],[.05,1.19],[-.13,1.06],[-.18,.68]],olive,'standard',{fuller:true,guard:.31,blade:[.12,.14,.145]}),
  knife('karambit','Karambit',[[-.08,0],[.09,.03],[.22,.22],[.29,.48],[.24,.72],[.08,.90],[-.12,.95],[-.27,.89],[-.06,.83],[.07,.67],[.10,.48],[.04,.30],[-.08,.16]],black,'ring',{ring:[0,-.70],scale:1.12}),
  knife('butterfly','Butterfly Knife',[[-.085,0],[.085,0],[.12,.66],[.055,.93],[-.07,1.12],[-.14,.77],[-.12,.30]],black,'butterfly',{handleKind:'butterfly',guard:0}),
  knife('flip','Flip Knife',[[-.12,0],[.11,0],[.16,.55],[.07,.87],[-.05,1.06],[-.16,.73],[-.19,.27]],black,'flip',{handleKind:'folding'}),
  knife('gut','Gut Knife',[[-.12,0],[.13,0],[.19,.55],[.24,.61],[.11,.64],[.12,.75],[.22,.78],[.09,.97],[-.12,1.04],[-.23,.79],[-.20,.25]],wood,'standard',{handleKind:'wood'}),
  knife('huntsman','Huntsman Knife',[[-.18,0],[.16,0],[.18,.43],[.24,.47],[.17,.51],[.24,.55],[.17,.59],[.24,.63],[.17,.67],[.24,.71],[.13,.80],[.12,1.03],[-.16,1.13],[-.29,.82],[-.26,.23]],black,'heavy',{guard:.29,blade:[.15,.17,.18]}),
  knife('falchion','Falchion Knife',[[-.10,0],[.10,0],[.20,.41],[.24,.73],[.13,1.01],[-.05,1.16],[-.21,.88],[-.25,.47],[-.16,.18]],black,'balance',{handleKind:'folding'}),
  knife('bowie','Bowie Knife',[[-.17,0],[.17,0],[.20,.78],[.32,1.07],[.12,1.21],[-.06,1.23],[-.28,.91],[-.28,.35]],black,'heavy',{guard:.35,scale:.93,blade:[.16,.18,.19]}),
  knife('daggers','Shadow Daggers',[[-.14,0],[.14,0],[.13,.50],[0,.86],[-.13,.50]],black,'daggers',{dual:true,handleKind:'push',scale:.94}),
  knife('ursus','Ursus Knife',[[-.12,0],[.12,0],[.12,.90],[.04,1.13],[-.13,.98]],olive,'flip',{guard:.22}),
  knife('navaja','Navaja Knife',[[-.10,0],[.09,0],[.13,.54],[.04,.81],[-.14,.96],[-.17,.70],[-.16,.25]],wood,'flip',{handleKind:'wood',scale:1.05}),
  knife('stiletto','Stiletto Knife',[[-.065,0],[.065,0],[.065,.88],[0,1.22],[-.065,.88]],olive,'flip',{handleKind:'stiletto',guard:.22}),
  knife('talon','Talon Knife',[[-.09,0],[.12,.04],[.32,.34],[.34,.55],[.25,.80],[.02,.98],[-.22,.98],[-.32,.89],[-.09,.80],[.07,.60],[.05,.37],[-.10,.16]],[.62,.57,.43],'ring',{ring:[0,-.70],scale:1.10}),
  knife('classic','Classic Knife',[[-.11,0],[.11,0],[.11,.94],[.035,1.20],[-.12,1.01]],black,'standard',{guard:.25,fuller:true}),
  knife('paracord','Paracord Knife',[[-.13,0],[.13,0],[.14,.87],[.025,1.18],[-.14,.92]],olive,'standard',{handleKind:'cord',guard:.19}),
  knife('survival','Survival Knife',[[-.14,0],[.14,0],[.18,.70],[.06,1.08],[-.13,1.14],[-.22,.88],[-.20,.32]],olive,'flip',{guard:.23,blade:[.22,.25,.25]}),
  knife('nomad','Nomad Knife',[[-.13,0],[.12,0],[.19,.56],[.11,.89],[-.04,1.13],[-.18,.91],[-.22,.47]],black,'flip',{handleKind:'folding'}),
  knife('skeleton','Skeleton Knife',[[-.10,0],[.10,0],[.11,.80],[.015,1.12],[-.11,.93]],steel,'ring',{ring:[0,-.30],handleKind:'skeleton'}),
  knife('kukri','Kukri Knife',[[-.11,0],[.11,0],[.19,.30],[.34,.64],[.39,.94],[.24,1.18],[.10,1.30],[-.16,1.17],[-.31,.94],[-.20,.67],[-.12,.36]],black,'heavy',{scale:.95,blade:[.07,.085,.09],guard:.20}),
];
const curveTips={karambit:7,talon:7,kukri:6,flip:4,falchion:5,gut:8,navaja:4,nomad:4,survival:5};
for(const k of KNIFE_LIST){
  if(!Object.hasOwn(curveTips,k.id))continue;
  const original=k.profile,rounded=[];
  original.forEach((p,i)=>{
    if(i<2||i===curveTips[k.id]){rounded.push(p);return;}
    const previous=original[(i+original.length-1)%original.length],next=original[(i+1)%original.length];
    const a=p.map((v,j)=>v+(previous[j]-v)*.33),b=p.map((v,j)=>v+(next[j]-v)*.33);
    for(let step=0;step<=5;step++){const t=step/5;rounded.push(p.map((v,j)=>(1-t)**2*a[j]+2*(1-t)*t*v+t*t*b[j]));}
  });
  k.profile=rounded;
}
export const KNIVES=Object.fromEntries(KNIFE_LIST.map(k=>[k.id,k]));
export const DEFAULT_KNIFE='m9';
const normalize=v=>{const length=Math.hypot(...v)||1;return v.map(n=>n/length);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
class KnifeMesh {
  constructor(){this.vertices=[];}
  vertex(p,n,color,metal,rough){this.vertices.push(...p,...n,...color,metal,rough);}
  tri(a,b,c,color,metal=.1,rough=.7,normals=null){
    const n=normals||normalize(cross(b.map((v,i)=>v-a[i]),c.map((v,i)=>v-a[i])));
    [a,b,c].forEach((p,i)=>this.vertex(p,Array.isArray(n[0])?n[i]:n,color,metal,rough));
  }
  quad(a,b,c,d,color,metal,rough){this.tri(a,b,c,color,metal,rough);this.tri(a,c,d,color,metal,rough);}
  box(center,size,color,metal=.1,rough=.7){
    const [x,y,z]=center.map((v,i)=>v-size[i]/2),[X,Y,Z]=center.map((v,i)=>v+size[i]/2);
    for(const f of [ [[x,Y,z],[x,Y,Z],[X,Y,Z],[X,Y,z]],[[x,y,z],[X,y,z],[X,y,Z],[x,y,Z]],
      [[x,y,z],[x,y,Z],[x,Y,Z],[x,Y,z]],[[X,y,Z],[X,y,z],[X,Y,z],[X,Y,Z]],
      [[X,y,z],[x,y,z],[x,Y,z],[X,Y,z]],[[x,y,Z],[X,y,Z],[X,Y,Z],[x,Y,Z]] ])this.quad(...f,color,metal,rough);
  }
  ellipsoid(center,radii,color,metal=.05,rough=.8){
    const point=(i,j)=>{const a=-Math.PI/2+i*Math.PI/10,b=j*Math.PI*2/16;
      const q=[Math.cos(a)*Math.cos(b),Math.sin(a),Math.cos(a)*Math.sin(b)];
      return {p:q.map((v,k)=>center[k]+radii[k]*v),n:normalize(q.map((v,k)=>v/radii[k]))};};
    for(let i=0;i<10;i++)for(let j=0;j<16;j++){
      const a=point(i,j),b=point(i+1,j),c=point(i+1,j+1),d=point(i,j+1);
      if(i)this.tri(a.p,b.p,d.p,color,metal,rough,[a.n,b.n,d.n]);
      if(i<9)this.tri(b.p,c.p,d.p,color,metal,rough,[b.n,c.n,d.n]);
    }
  }
  tube(a,b,r,color,metal=.2,rough=.6,sides=12){
    const axis=normalize(b.map((v,i)=>v-a[i]));
    const u=normalize(cross(axis,Math.abs(axis[1])<.9?[0,1,0]:[1,0,0])),v=cross(axis,u);
    const point=(p,t)=>p.map((n,i)=>n+r*(u[i]*Math.cos(t)+v[i]*Math.sin(t)));
    for(let i=0;i<sides;i++){
      const t=i*2*Math.PI/sides,T=(i+1)*2*Math.PI/sides;
      this.quad(point(a,T),point(b,T),point(b,t),point(a,t),color,metal,rough);
      this.tri(a,point(a,T),point(a,t),color,metal,rough);this.tri(b,point(b,t),point(b,T),color,metal,rough);
    }
  }
  torus(center,R,r,color,axis='z',metal=.9){
    const point=(i,j)=>{const a=i*Math.PI*2/28,b=j*Math.PI*2/8;
      let n=[Math.cos(a)*Math.cos(b),Math.sin(a)*Math.cos(b),Math.sin(b)];
      let p=[(R+r*Math.cos(b))*Math.cos(a),(R+r*Math.cos(b))*Math.sin(a),r*Math.sin(b)];
      if(axis==='y'){p=[p[0],p[2],p[1]];n=[n[0],n[2],n[1]];}
      return {p:p.map((x,k)=>x+center[k]),n};};
    for(let i=0;i<28;i++)for(let j=0;j<8;j++){
      const a=point(i,j),b=point(i+1,j),c=point(i+1,j+1),d=point(i,j+1);
      this.tri(a.p,b.p,c.p,color,metal,.3,[a.n,b.n,c.n]);this.tri(a.p,c.p,d.p,color,metal,.3,[a.n,c.n,d.n]);
    }
  }
  finish(){return new Float32Array(this.vertices);}
}
// Ear clipping preserves the hooked inner edges of curved blades.
export function triangulateBlade(points){
  const area=points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p[0]*q[1]-q[0]*p[1];},0);
  const remaining=points.map((_,i)=>i);if(area<0)remaining.reverse();
  const result=[],side=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  while(remaining.length>3){let clipped=false;
    for(let i=0;i<remaining.length;i++){
      const ai=remaining[(i+remaining.length-1)%remaining.length],bi=remaining[i],ci=remaining[(i+1)%remaining.length];
      const a=points[ai],b=points[bi],c=points[ci];if(side(a,b,c)<=1e-10)continue;
      const inside=remaining.some(k=>k!==ai&&k!==bi&&k!==ci&&side(a,b,points[k])>=-1e-10&&side(b,c,points[k])>=-1e-10&&side(c,a,points[k])>=-1e-10);
      if(inside)continue;result.push([ai,bi,ci]);remaining.splice(i,1);clipped=true;break;
    }
    if(!clipped)throw new Error('Knife blade profile cannot be triangulated.');
  }
  result.push([...remaining]);return result;
}
function addBlade(mesh,k){
  const points=k.profile,cx=points.reduce((s,p)=>s+p[0],0)/points.length,cy=points.reduce((s,p)=>s+p[1],0)/points.length;
  const inner=points.map(p=>[cx+(p[0]-cx)*.79,cy+(p[1]-cy)*.98]);
  const triangles=triangulateBlade(inner),at=(p,z)=>[p[0],p[1],z];
  for(const [a,b,c]of triangles){
    mesh.tri(at(inner[a],.034),at(inner[b],.034),at(inner[c],.034),k.blade,.96,.26,[0,0,1]);
    mesh.tri(at(inner[c],-.034),at(inner[b],-.034),at(inner[a],-.034),k.blade,.96,.29,[0,0,-1]);
  }
  for(let i=0;i<points.length;i++){
    const j=(i+1)%points.length,edge=[.53,.57,.60];
    mesh.quad(at(points[i],0),at(points[j],0),at(inner[j],.034),at(inner[i],.034),edge,.98,.20);
    mesh.quad(at(points[j],0),at(points[i],0),at(inner[i],-.034),at(inner[j],-.034),edge,.98,.22);
  }
  if(k.fuller)for(const z of [-.035,.035])mesh.box([-.005,.47,z],[.048,.58,.002],k.blade.map(x=>x*.58),.9,.36);
}
function addHandle(mesh,k,x=0){
  const color=k.handle;
  if(k.handleKind==='skeleton'){
    mesh.tube([-.09,-.03,0],[-.08,-.72,0],.036,steel,.96,.3);
    mesh.tube([.09,-.03,0],[.08,-.72,0],.036,steel,.96,.3);
    mesh.torus([0,-.62,0],.08,.027,steel);
  }else if(k.handleKind==='push'){
    mesh.tube([0,0,0],[0,-.20,0],.043,steel,.9,.3);
    mesh.ellipsoid([0,-.25,0],[.25,.10,.11],color,.12,.65);
  }else if(k.handleKind==='butterfly'){
    mesh.box([x,-.37,0],[.10,.72,.10],color,.65,.35);
    for(const offset of [-.048,.048])mesh.box([x+offset,-.37,0],[.018,.70,.12],steel,.95,.24);
    for(let i=0;i<5;i++)mesh.ellipsoid([x,-.15-i*.105,.057],[.026,.035,.006],[.008,.010,.011],.3,.7);
  }else{
    const width=k.handleKind==='stiletto'?.085:.12;
    mesh.ellipsoid([0,-.37,0],[width,.39,.092],color,.07,.66);
    if(k.handleKind==='cord'){
      for(let i=0;i<96;i++){
        const a=i*Math.PI/4,b=(i+1)*Math.PI/4;
        mesh.tube([.115*Math.cos(a),-.05-i*.007,.094*Math.sin(a)],
          [.115*Math.cos(b),-.05-(i+1)*.007,.094*Math.sin(b)],.016,color.map(c=>c*1.25),.05,.9,6);
      }
    }else if(k.handleKind!=='wood'&&k.handleKind!=='folding'){
      for(let i=0;i<6;i++)mesh.torus([0,-.13-i*.09,0],width*.91,.008,color.map(c=>c*.65),'y',.08);
    }
    for(const y of [-.13,-.61]){
      mesh.tube([0,y,.085],[0,y,.101],.024,steel,.9,.23,14);
      mesh.box([0,y,.103],[.029,.005,.003],[.025,.03,.032],.7,.5);
    }
    if(k.handleKind==='stiletto')mesh.ellipsoid([0,-.20,.093],[.025,.035,.008],steel,.95,.2);
  }
  if(k.ring)mesh.torus([k.ring[0],k.ring[1],0],.115,.028,k.handleKind==='skeleton'?steel:color,'z',.8);
  const guard=k.guard??(k.handleKind==='folding'||k.ring?0:.17);
  if(guard)mesh.box([0,-.012,0],[guard*2,.052,.16],steel.map(c=>c*.60),.9,.28);
}
let gloveMesh;
export function buildGlove(){
  if(gloveMesh)return gloveMesh;
  const m=new KnifeMesh(),fabric=[.022,.029,.024],rubber=[.007,.011,.009],seam=[.075,.085,.068];
  m.ellipsoid([.03,-.47,.11],[.16,.235,.105],fabric);
  m.ellipsoid([.05,-.91,.07],[.145,.36,.13],[.020,.027,.033],.05,.9);
  m.ellipsoid([.08,-1.27,.04],[.165,.30,.14],[.018,.024,.030],.03,.92);
  m.ellipsoid([.045,-.73,.095],[.158,.10,.13],rubber);
  m.box([.06,-.72,.205],[.16,.09,.022],fabric,.08,.8);
  for(let i=0;i<4;i++){
    const y=-.275-i*.108;
    m.ellipsoid([-.10,y,.13],[.084,.053,.055],fabric);
    m.ellipsoid([-.145,y,.048],[.048,.051,.068],fabric);
    m.ellipsoid([-.105,y,-.017],[.062,.047,.043],rubber);
    m.ellipsoid([-.042,y,.206],[.067,.045,.020],rubber,.08,.65);
    m.tube([-.095,y+.045,.177],[-.005,y+.045,.207],.0035,seam,.05,.9,6);
  }
  m.ellipsoid([.155,-.29,.105],[.070,.14,.065],fabric);
  m.ellipsoid([.10,-.20,.045],[.095,.065,.058],rubber);
  gloveMesh=m.finish();return gloveMesh;
}
export function buildKnife(id){
  const k=KNIVES[id]||KNIVES[DEFAULT_KNIFE],main=new KnifeMesh(),free=new KnifeMesh();addBlade(main,k);
  if(k.handleKind==='butterfly'){
    addHandle(main,k,-.065);addHandle(free,k,.065);
    main.tube([-.065,0,-.065],[-.065,0,.065],.035,steel,.98,.2);
    free.tube([.065,0,-.065],[.065,0,.065],.035,steel,.98,.2);
  }else addHandle(main,k);
  return {knife:k,main:main.finish(),free:free.finish(),hand:buildGlove()};
}
export function knifeIcon(id){
  const k=KNIVES[id]||KNIVES[DEFAULT_KNIFE];
  const path=k.profile.map((p,i)=>`${i?'L':'M'}${p[0]} ${-p[1]}`).join(' ')+'Z';
  const color=`rgb(${k.handle.map(c=>Math.round(c**.454545*255)).join(',')})`;
  let handle=`<rect x="-.10" y=".02" width=".2" height=".7" rx=".06" fill="${color}"/>`;
  if(k.handleKind==='butterfly')handle=`<g fill="${color}" stroke="#a3aaab" stroke-width=".017"><rect x="-.125" y=".02" width=".10" height=".73" rx=".025" transform="rotate(7)"/><rect x=".025" y=".02" width=".10" height=".73" rx=".025" transform="rotate(-7)"/></g>`;
  if(k.handleKind==='push')handle=`<path d="M-.035 0h.07v.18h.22v.14h-.51v-.14h.22Z" fill="${color}"/>`;
  if(k.handleKind==='skeleton')handle='<path d="M-.09 .02L-.08 .71M.09 .02L.08 .71" fill="none" stroke="#9ba3a6" stroke-width=".055"/>';
  return `<svg viewBox="-1.28 -1.3 2.6 2.6" aria-hidden="true"><g transform="rotate(-58)"><path d="${path}" fill="#bfc4c6" stroke="#e1e4e5" stroke-width=".014"/>${handle}${k.ring?`<circle cx="0" cy="${-k.ring[1]}" r=".11" fill="none" stroke="#969c9b" stroke-width=".04"/>`:''}${k.dual?`<g transform="translate(.44 .15)"><path d="${path}" fill="#aab1b4"/>${handle}</g>`:''}</g></svg>`;
}
const smooth=(a,b,t)=>{const q=Math.max(0,Math.min(1,(t-a)/(b-a)));return q*q*(3-2*q);};
export function inspectDuration(id){return KNIVES[id]?.motion==='butterfly'?4.3:KNIVES[id]?.motion==='balance'?4.0:3.5;}
export function inspectPose(id,elapsed){
  const k=KNIVES[id]||KNIVES[DEFAULT_KNIFE],t=Math.max(0,Math.min(1,elapsed/inspectDuration(k.id)));
  const lift=smooth(0,.22,t)*(1-smooth(.78,1,t));
  let spin=0,hinge=0;
  if(k.motion==='ring')spin=2*Math.PI*smooth(.04,.42,t);
  if(k.motion==='butterfly'){spin=2*Math.PI*smooth(.03,.48,t);hinge=Math.PI*2.05*Math.sin(Math.PI*smooth(.02,.48,t))**2;}
  if(k.motion==='flip')spin=2*Math.PI*smooth(.04,.38,t);
  if(k.motion==='heavy'&&k.id==='kukri')spin=2*Math.PI*smooth(.08,.48,t);
  if(k.motion==='balance')spin=(Math.PI*.5*Math.sin(Math.PI*t)+Math.sin(t*20)*.045)*lift;
  if(k.motion==='daggers')spin=2*Math.PI*smooth(.02,.45,t);
  return {offset:[-.30*lift,.26*lift,-.13*lift],rotation:[.24*lift,.85*Math.sin(t*Math.PI*3)*lift,-.94*lift],spin,hinge,
    pivot:k.motion==='ring'?[k.ring?.[0]||0,k.ring?.[1]||-.3,0]:k.motion==='butterfly'?[0,0,0]:[0,-.38,0],active:t>0&&t<1};
}
export function createInspectController(id=DEFAULT_KNIFE){
  let selected=Object.hasOwn(KNIVES,id)?id:DEFAULT_KNIFE,start=-Infinity;
  return {get knife(){return selected;},equip(value){if(!Object.hasOwn(KNIVES,value))return false;selected=value;start=-Infinity;return true;},
    inspect(now){if(now-start<inspectDuration(selected))return false;start=now;return true;},
    pose(now){return inspectPose(selected,now-start);},cancel(){start=-Infinity;}};
}
