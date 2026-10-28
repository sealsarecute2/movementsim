import { createEndless } from './endless.js';
// All distances and velocities use Source units. y is up; forward is -z.
const box = (x, z, w, d, top = 0, extra = {}) => ({
  min: [x - w / 2, top - 120, z - d / 2],
  max: [x + w / 2, top, z + d / 2], ...extra,
});
export const COURSE = [
  box(0, -100, 480, 600, 0, { label: '01 / RUNWAY' }),
  box(-25, -575, 220, 170, 0),
  box(65, -845, 220, 170, 0),
  box(-25, -1110, 220, 180, 0),
  box(0, -1420, 440, 240, 0, { checkpoint: 1, label: '02 / STRAFE' }),
  box(140, -1670, 200, 170, 0),
  box(290, -1920, 220, 170, 0),
  box(300, -2180, 400, 240, 0, { checkpoint: 2, label: '03 / CONTROL' }),
  box(300, -2340, 240, 80, 16),
  box(300, -2420, 240, 80, 32),
  box(300, -2630, 240, 340, 48),
  { min: [180, 106, -2730], max: [420, 132, -2520], roof: true },
  box(300, -2870, 72, 140, 48),
  box(300, -3115, 400, 290, 48, { finish: true, label: 'FINISH' }),
];
export const PRACTICE = [
  box(0,-600,2200,2200,0,{label:'SANDBOX / MOVEMENT LAB'}),
  box(-650,-650,48,64,24),box(-760,-850,36,48,48),box(-630,-1050,28,36,72),
  box(550,-650,22,540,32),box(550,-990,96,140,32),
  box(0,-1400,180,160,240),
  {min:[-40,0,-1322],max:[40,242,-1320],ladder:true,normal:[0,0,1]},
  {min:[-48,-120,-1416],max:[48,240,-1322],obstacle:true,tower:true},
  box(360,-1410,140,320,0),{min:[290,56,-1530],max:[430,84,-1290],roof:true},
  {min:[-16,0,-500],max:[16,240,-386],obstacle:true,wrapWall:true},
];
export const SPAWNS = [
  { x: 0, y: 0, z: 100, yaw: 0 },
  { x: 0, y: 0, z: -1390, yaw: -0.28 },
  { x: 300, y: 0, z: -2160, yaw: 0 },
];

// Route nodes describe the intended line as well as the visible platforms.
// Keeping that line with the map lets the geometry checks exercise real gaps,
// stairs, beams and tunnels with the same controller used in the game.
const node = (x,z,w=96,d=96,top=0,extra={})=>({x,z,w,d,top,...extra});
const stage=(title,tip)=>({title,tip});
const obstacle=(min,max,extra={})=>({min,max,obstacle:true,...extra});
function makeCourse(id,title,difficulty,description,nodes,stages,obstacles=[],skips=[]) {
  const platforms=nodes.map((n,i)=>box(n.x,n.z,n.w,n.d,n.top,{
    ...(n.checkpoint?{checkpoint:n.checkpoint}:{}),
    ...(i===nodes.length-1?{finish:true,label:'FINISH'}:i===0||n.checkpoint?{label:title.toUpperCase()}:{}),
    ...(skips.some(s=>s.from===i)?{skipLaunch:true}:{}),
  }));
  const spawns=nodes.flatMap((n,i)=>{
    if(i&&!n.checkpoint)return [];
    const next=nodes[i+1]||n,dx=next.x-n.x,dz=next.z-n.z,length=Math.hypot(dx,dz)||1;
    const retreat=n.checkpoint?0:Math.max(0,Math.min(60,(n.w/2-24)/(Math.abs(dx/length)||1e-6),(n.d/2-24)/(Math.abs(dz/length)||1e-6)));
    return [{x:n.x-dx/length*retreat,y:n.top,z:n.z-dz/length*retreat,yaw:Math.atan2(dx,-dz)}];
  });
  return {id,title,difficulty,description,timed:true,revision:2,
    boxes:[...platforms,...obstacles,...skips.filter(s=>s.via).map(s=>box(s.via.x,s.via.z,s.via.w,s.via.d,s.via.top,{shortcut:true}))],platforms,route:nodes,spawns,stages,skips,
    features:[...(obstacles.some(b=>b.ladder)?['Ladders']:[]),...(nodes.some(n=>n.via)?['Wraps']:[]),...(skips.length?['Hard skips']:[])]};
}
// The obstacle is taller than a jump: the line must bend around its exposed end.
function wrapWall(x,z,top=0,mirror=1) {
  return obstacle([x-16,top-120,z-90],[x+16,top+220,z+72],{wrapWall:true,mirror});
}
function ladderTower(x,z,bottom,height,width=96) {
  return [
    {min:[x-width/2+8,bottom,z],max:[x+width/2-8,bottom+height+2,z+2],ladder:true,normal:[0,0,1]},
    obstacle([x-width/2,bottom-120,z-96],[x+width/2,bottom+height,z],{tower:true}),
  ];
}
const cp=(checkpoint)=>({checkpoint});
const cut=(from,to,tip)=>({from,to,tip,expert:true});

const momentum=makeCourse('momentum','Overdrive','Hard',
  'Long takeoffs, staggered drops, and a hairpin shortcut. Keep speed while the route changes height.',[
  node(0,0,360,320),node(-40,-340,88,100),node(30,-590,80,88),node(-45,-840,72,88),
  node(0,-1110,240,180,0,cp(1)),node(200,-1110,64,72),node(420,-1110,64,64),
  node(420,-1340,64,64),node(200,-1340,48,56),node(0,-1530,220,180,-48,cp(2)),
  node(-180,-1740,72,80,-48),node(-20,-1950,64,72,-72),node(150,-2160,56,72,-96),
  node(0,-2430,240,160,-120)
], [stage('Build and commit.','Small staggered landings punish wide corrections. Jump from the last few units.'),
  stage('Cut the hairpin.','The amber-marked ledge can skip the outside turn. The 48-unit landing leaves little margin.'),
  stage('Ride the drops.','The platforms step down. Use the extra airtime without overshooting.')],[],[cut(5,8,'Skip the outside hairpin with a precise 230-unit transfer.')]);

const zigzag=makeCourse('zigzag','Blindside','Expert',
  'Three wall wraps reverse your line. Tall walls block straight jumps; commit around the exposed ends.',[
  node(0,0,320,300),node(-85,-310,80,90),
  node(85,-310,64,90,0,{via:[{x:0,z:-205}]}),node(200,-510,72,80),
  node(190,-740,220,160,0,cp(1)),node(105,-960,72,90),
  node(275,-960,64,90,0,{via:[{x:190,z:-855}]}),node(390,-1160,64,80),
  node(360,-1390,220,160,24,cp(2)),node(275,-1610,64,90,24),
  node(445,-1610,56,90,24,{via:[{x:360,z:-1505}]}),node(560,-1810,56,80,24),
  node(390,-1980,64,72,0),node(300,-2210,240,160,-120)
], [stage('Round the first wall.','Strafe around the near end of the tall wall. Its top is out of jump reach.'),
  stage('Reverse your line.','Set up the wrap from the outside edge. Turning too early hits the wall.'),
  stage('The blind finish.','The last wrap has a smaller landing. An early diagonal drop skips one exit pillar.')],
  [wrapWall(0,-310),wrapWall(190,-960),wrapWall(360,-1610,24)],
  [cut(11,13,'Drop diagonally past the final exit pillar; the landing is below the takeoff.')]);

const skyline=makeCourse('skyline','Vertigo','Expert',
  'Climb three exposed ladder towers, cross their tiny balconies, then drop into a narrow finish.',[
  node(0,0,340,320),node(0,-330,80,100),node(0,-570,180,160),
  node(0,-730,160,160,240,{ladder:true,checkpoint:1}),
  node(170,-940,64,72,240),node(330,-1130,64,72,264),node(330,-1370,170,160,264),
  node(330,-1530,160,160,544,{ladder:true,checkpoint:2}),
  node(160,-1740,56,72,544),node(0,-1940,56,72,520),node(0,-2180,160,160,520),
  node(0,-2340,160,160,840,{ladder:true,checkpoint:3}),
  node(170,-2540,48,64,840),node(320,-2760,48,64,792),node(170,-3000,220,160,640)
], [stage('Catch the first ladder.','Move into the cyan rungs. Your view angle controls climbing speed; Space pushes you off.'),
  stage('Cross the balcony.','Narrow offset pads lead to the second tower. Stay centered when you attach.'),
  stage('Climb the exposed spine.','Look upward while pressing into the ladder. Clear the top before turning.'),
  stage('The high drop.','Carry speed off the top balcony. The direct diagonal cut demands a very late takeoff.')],
  [...ladderTower(0,-650,0,240),...ladderTower(330,-1450,264,280),...ladderTower(0,-2260,520,320)],
  [cut(12,14,'Skip the last tiny balcony with a long descending jump.')]);

const circuit=makeCourse('circuit','Switchback Foundry','Expert',
  'A folded industrial route with sharp reversals, a wall wrap, and descending shortcuts across the inside.',[
  node(0,0,340,320),node(0,-330,72,90),node(0,-560,64,80),node(210,-560,64,72),
  node(420,-560,220,180,0,cp(1)),node(420,-330,64,72),node(210,-330,56,64),
  node(210,-100,200,160,24,cp(2)),node(420,-100,64,90,24),
  node(590,-100,56,90,24,{via:[{x:505,z:5}]}),node(720,-310,56,72,24),
  node(720,-540,200,160,24,cp(3)),node(930,-700,56,64,0),node(1150,-700,48,64,-24),
  node(1150,-940,56,64,-48),node(930,-940,40,48,-72),node(730,-1160,240,160,-96)
], [stage('Turn at speed.','The route folds to the right. Aim through the corner before touching down.'),
  stage('Reverse the straight.','A tight return lane climbs toward the inside checkpoint.'),
  stage('Wrap the furnace.','Go around the near end. The wall is too high to clear.'),
  stage('Cut the return.','The route doubles back below you. A precise descending cut skips the outside pillar.')],
  [wrapWall(505,-100,24)], [cut(12,15,'Transfer diagonally across the inside of the lower return.')]);

const balance=makeCourse('balance','Razorwire','Expert',
  '20-unit beams, broken corner pads, and an exposed ladder exit. Sprinting the safe line is a risk.',[
  node(0,0,320,300),node(0,-350,24,400,0,{walk:true}),node(0,-600,72,100,0,{walk:true}),
  node(135,-600,220,22,0,{walk:true}),node(280,-600,80,100,0,{walk:true,checkpoint:1}),
  node(280,-840,22,400,0,{walk:true}),node(280,-1090,64,100,0,{walk:true}),
  node(160,-1290,48,64,16),node(40,-1490,160,160,32,cp(2)),
  node(40,-1650,160,160,232,{ladder:true}),node(40,-1900,20,340,232,{walk:true}),
  node(40,-2120,64,100,232,{walk:true}),node(230,-2270,40,56,208),node(40,-2450,220,160,184)
], [stage('Find the wire.','Use Shift on the 24-unit rail. The corner beam is even thinner.'),
  stage('Broken connections.','Release Shift for the diagonal gaps, then settle on the small landing.'),
  stage('Climb and balance.','Clear the cyan ladder before aligning with the 20-unit beam. The final cut is a blind drop.')],
  ladderTower(40,-1570,32,200),[{...cut(9,11,'Leave the wire and double-hop through the outside 24-unit pin.'),via:node(180,-1880,24,32,232)}]);

const underpass=makeCourse('underpass','Compression','Expert',
  'Low roofs, crouch gaps, a vertical escape, and a tight wall exit. Switch stance before the geometry forces it.',[
  node(0,0,340,300),node(0,-360,112,420,0,{walk:true,duck:true}),
  node(0,-630,120,120,0,{walk:true}),node(110,-840,64,80,16),
  node(-10,-1050,180,160,16,cp(1)),node(-10,-1370,80,480,16,{walk:true,duck:true}),
  node(-10,-1670,160,160,16,{walk:true}),node(-10,-1830,160,160,256,{ladder:true,checkpoint:2}),
  node(-95,-2050,64,90,256),node(75,-2050,56,90,256,{via:[{x:-10,z:-1945}]}),
  node(180,-2240,64,72,232),node(180,-2500,80,500,232,{duck:true,walk:true}),
  node(180,-2760,220,160,232,{walk:true})
], [stage('Crouch before the roof.','The first tunnel has only 56 units of clearance. Do not auto-hop inside.'),
  stage('Stay low, then go vertical.','Cross the narrow passage, stand in the exit bay, and catch the ladder.'),
  stage('Wrap into the last duct.','Clear the wall from the exposed end, then crouch again for the finish duct.')],
  [obstacle([-56,56,-500],[56,84,-200],{roof:true}),
    obstacle([-50,72,-1550],[30,100,-1160],{roof:true}),
    ...ladderTower(-10,-1750,16,240),wrapWall(-10,-2050,256),
    obstacle([140,288,-2610],[220,316,-2390],{roof:true})],
  [cut(9,11,'Drop directly into the final duct. You must crouch before your head reaches its front edge.')]);

const needles=makeCourse('needles','Deadpoint','Extreme',
  'Tiny 28–48 unit landings, off-axis jumps, and raised pins. The optional inside cut removes your recovery pad.',[
  node(0,0,320,300),node(-35,-310,48,56),node(45,-510,40,48,16),node(-50,-710,36,48,32),
  node(40,-910,32,40,48),node(0,-1140,180,160,48,cp(1)),
  node(-60,-1370,32,40,48),node(-270,-1370,36,40,48),node(-270,-1580,32,40,48),
  node(-60,-1580,28,36,48),node(30,-1780,36,40,72),node(0,-2010,180,160,72,cp(2)),
  node(120,-2220,32,40,48),node(-20,-2420,28,36,24),node(110,-2620,28,36,0),
  node(-30,-2820,32,40,-24),node(0,-3050,220,160,-24)
], [stage('Hit the deadpoint.','Raised pins require an early takeoff. There is almost no room to correct a missed line.'),
  stage('The 28-unit cut.','The inside shortcut skips two pillars, but its landing is the smallest on the course.'),
  stage('Keep the landing quiet.','The final pins descend and alternate. Brake the turn before you touch down.')],[],
  [cut(6,9,'A precise 210-unit pin-to-pin cut skips the outside pair.')]);

const gauntlet=makeCourse('gauntlet','Blackout','Extreme',
  'A long mixed test: blind wraps, ladder towers, crouch roofs, wire beams, and a falling ladder catch.',[
  node(0,0,340,300),node(-85,-310,64,90),node(85,-310,56,90,0,{via:[{x:0,z:-205}]}),
  node(180,-520,48,64),node(180,-750,180,160,0,cp(1)),
  node(180,-910,160,160,280,{ladder:true}),node(50,-1110,48,64,304),
  node(50,-1380,88,460,304,{walk:true,duck:true}),node(50,-1630,180,160,304,{walk:true,checkpoint:2}),
  node(50,-1880,20,420,304,{walk:true}),node(50,-2140,64,100,304,{walk:true}),
  node(185,-2300,36,48,280),node(50,-2500,32,40,208),node(50,-2730,180,160,208,cp(3)),
  node(50,-2890,160,160,488,{ladder:true}),node(190,-3100,40,56,464),
  node(340,-3320,36,48,416),node(340,-3550,160,160,224,cp(4)),
  node(340,-3710,160,160,424,{ladder:true}),node(210,-3910,32,48,400),node(340,-4130,220,160,352)
], [stage('Blind entry.','Round the wall and land the small offset pin. Shortcuts cannot skip the blue checkpoints.'),
  stage('Tower into the duct.','Climb, clear the raised pin, then release Space and crouch under the roof.'),
  stage('Wire and pin.','Walk the 20-unit beam. The direct cut to the lower pin needs a perfect takeoff.'),
  stage('Climb, then fall.','The high tower leads into a steep drop. The next cyan ladder can catch your fall.'),
  stage('No recovery at the end.','Clear the last ladder and land the final offset pin before the finish.')],
  [wrapWall(0,-310),...ladderTower(180,-830,0,280),
    obstacle([6,360,-1500],[94,388,-1260],{roof:true}),
    ...ladderTower(50,-2810,208,280),...ladderTower(340,-3630,224,200)],
  [cut(10,12,'Cut diagonally off the wire end onto the lower 32-unit pin.'),cut(15,17,'Skip the lower pillar with a long fall into the checkpoint bay.')]);

const endlessPreview = createEndless(1);
export const MAP_LIST = [
  { id: 'course', title: 'Starter course', difficulty: 'Easy', timed: true,
    description: 'The original three-part route: runway, strafes, and movement control.',
    boxes: COURSE, spawns: SPAWNS,
    stages: [stage('Find your momentum.', 'Build speed on the runway. Jump at the edge.'),
      stage('Carry it through the turn.', 'Release W. Match A / D with a smooth mouse turn.'),
      stage('Slow down. Stay in control.', 'Walk the beam. Crouch under the low ceiling.')] },
  momentum, zigzag, skyline, circuit, balance, underpass, needles, gauntlet,
  { id: 'endless', revision: 2, title: 'Endless', difficulty: 'Infinite', endless: true, timed: false,
    description: 'Mixed sections with checkpoints every 8 blocks.',
    boxes: endlessPreview.boxes, spawns: [endlessPreview.spawn],
    stages: [stage('See how far you can go.', 'Checkpoints every 8 blocks. E returns to the latest save. Q starts a new route.')] },
  { id: 'free', title: 'Free roam', difficulty: 'Sandbox', timed: false,
    description: 'A wide floor for strafing, hops, and stopping practice.', boxes: PRACTICE,
    spawns: [SPAWNS[0]], stages: [stage('Make your own line.', 'A wide floor for strafing, hops, and stopping practice.')] },
];
export const MAPS = Object.fromEntries(MAP_LIST.map(map => [map.id, map]));
