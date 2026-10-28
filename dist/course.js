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
  ...lessonSign(140,-150,0,'01 / BUNNY HOP',['W = GET MOVING','SPACE = KEEP HOPPING','RELEASE W IN THE AIR']),
  ...lessonSign(-125,-1490,0,'02 / AIR STRAFE',['RELEASE W IN THE AIR','A + MOUSE LEFT','D + MOUSE RIGHT']),
  ...lessonSign(410,-2220,0,'03 / CONTROL',['SHIFT = WALK SLOWLY','CTRL / C = CROUCH','DUCK UNDER THE ROOF']),
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

const stage=(title,tip)=>({title,tip});
function lessonSign(x,z,floor,title,lines) { return [
  {min:[x-90,floor+32,z-4],max:[x+90,floor+118,z],obstacle:true,sign:{title,lines}},
  {min:[x-3,floor,z-3],max:[x+3,floor+32,z-1],obstacle:true,signPost:true},
]; }
const BHOP_SCHOOL = [
  box(0,-80,600,560,0,{label:'01 / KEEP HOPPING'}),
  box(0,-475,220,140),box(0,-680,200,140),
  box(0,-920,600,280,0,{checkpoint:1,label:'02 / AIR STRAFE'}),
  box(80,-1190,220,140),box(-30,-1410,220,140),
  box(0,-1650,600,280,0,{checkpoint:2,label:'03 / STAY IN CONTROL'}),
  box(80,-1930,200,140),box(140,-2150,180,140,16),box(60,-2360,200,140,32),
  box(0,-2590,600,280,32,{checkpoint:3,label:'04 / PUT IT TOGETHER'}),
  box(-70,-2860,200,140,32),box(60,-3070,220,140,32),
  box(0,-3320,440,240,32,{finish:true,label:'FINISH'}),
  ...lessonSign(170,-140,0,'01 / KEEP HOPPING',['HOLD W TO GET MOVING','HOLD SPACE TO KEEP HOPPING','RELEASE W AFTER TAKEOFF']),
  ...lessonSign(170,-1000,0,'02 / AIR STRAFE',['A + MOUSE LEFT','D + MOUSE RIGHT','TURN SMOOTHLY IN THE AIR']),
  ...lessonSign(170,-1730,0,'03 / CONTROL',['AIM FOR THE NEXT BOX','SMALL TURNS KEEP CONTROL','KEEP SPACE HELD TO BOUNCE']),
  ...lessonSign(170,-2670,32,'04 / CHECKPOINTS',['BLUE = NEXT CHECKPOINT','E = TRY THIS SECTION AGAIN','Q = RESTART THE COURSE']),
];
const LADDER_RUN = [
  box(0,-80,600,560,0,{label:'01 / CLIMB'}),
  {min:[-40,0,-360],max:[40,226,-358],ladder:true,normal:[0,0,1]},
  {min:[-48,-120,-424],max:[48,224,-360],obstacle:true,tower:true},
  box(0,-510,600,200,224,{checkpoint:1,label:'02 / ROOFTOP HOPS',feature:'ladder'}),
  box(80,-780,200,140,224),box(-20,-1000,200,140,240),
  box(0,-1230,600,260,240,{checkpoint:2,label:'03 / SECOND CLIMB'}),
  {min:[-40,240,-1360],max:[40,466,-1358],ladder:true,normal:[0,0,1]},
  {min:[-48,120,-1424],max:[48,464,-1360],obstacle:true,tower:true},
  box(0,-1510,600,200,464,{checkpoint:3,label:'04 / HIGH JUMPS',feature:'ladder'}),
  box(-80,-1780,180,140,464),box(50,-2000,200,140,464),box(100,-2210,180,140,480),
  box(0,-2450,440,260,480,{finish:true,label:'FINISH'}),
  ...lessonSign(170,-140,0,'01 / CLIMB',['MOVE INTO THE CYAN LADDER','HOLD W AND LOOK UP','WALK OVER THE TOP']),
  ...lessonSign(170,-565,224,'02 / ROOFTOP HOPS',['HOLD SPACE TO CHAIN HOPS','A/D + MOUSE TO STEER','BLUE PLATFORM SAVES YOU']),
  ...lessonSign(170,-1305,240,'03 / SECOND CLIMB',['RELEASE SPACE AND CLIMB','LOOK UP AND HOLD W','SPACE PUSHES OFF A LADDER']),
  ...lessonSign(170,-1565,464,'04 / HIGH JUMPS',['JUMP BETWEEN THE ROOFTOPS','E = RETURN TO CHECKPOINT','REACH THE FINISH STRIPES']),
];

const endlessPreview = createEndless(1);
export const MAP_LIST = [
  { id: 'course', title: 'Starter course', timed: true,features:['Tutorial signs'],
    description: 'The original three-part route, with compact signs for hopping, strafing, and control.',
    boxes: COURSE, spawns: SPAWNS,
    stages: [stage('Find your momentum.', 'Build speed on the runway. Jump at the edge.'),
      stage('Carry it through the turn.', 'Release W. Match A / D with a smooth mouse turn.'),
      stage('Slow down. Stay in control.', 'Walk the beam. Crouch under the low ceiling.')] },
  { id:'bhop-school',title:'Bhop School',timed:true,features:['Tutorial signs'],
    description:'Learn bunny hopping with readable signs, forgiving jumps, and checkpoint lessons.',
    boxes:BHOP_SCHOOL,spawns:[{x:0,y:0,z:100,yaw:0},{x:0,y:0,z:-830,yaw:0},{x:0,y:0,z:-1560,yaw:0},{x:0,y:32,z:-2500,yaw:0}],
    stages:[stage('Keep hopping.','Read the sign. Hold W to move, then hold Space and release W in the air.'),
      stage('Match your strafe.','A + mouse left. D + mouse right. Make smooth turns.'),
      stage('Stay in control.','Aim for each box. Small turns make the landing easier.'),
      stage('Put it together.','Follow the blue platform. E returns to this checkpoint; Q restarts.')] },
  { id:'ladder-run',title:'Ladder Run',timed:true,features:['Ladders','Jumps'],
    description:'Climb two cyan ladders and link rooftop jumps on the way to the finish.',
    boxes:LADDER_RUN,spawns:[{x:0,y:0,z:100,yaw:0},{x:0,y:224,z:-470,yaw:0},{x:0,y:240,z:-1140,yaw:0},{x:0,y:464,z:-1470,yaw:0}],
    stages:[stage('Climb the first tower.','Move into the cyan ladder, hold W, and look up. Walk over the top.'),
      stage('Jump across the rooftops.','Hold Space for the jumps. Release it before climbing the next ladder.'),
      stage('Climb again.','Hold W and look up on the second ladder. Space pushes you away.'),
      stage('Take the high route.','Link the last rooftop jumps and reach the striped finish.')] },
  { id: 'endless', revision: 3, title: 'Endless', endless: true, timed: false,
    description: 'Mixed sections with checkpoints every 8 blocks.',
    boxes: endlessPreview.boxes, spawns: [endlessPreview.spawn],
    stages: [stage('See how far you can go.', 'Checkpoints every 8 blocks. E returns to the latest save. Q starts a new route.')] },
  { id: 'free', title: 'Sandbox', timed: false,
    description: 'A wide floor for strafing, hops, and stopping practice.', boxes: PRACTICE,
    spawns: [SPAWNS[0]], stages: [stage('Make your own line.', 'A wide floor for strafing, hops, and stopping practice.')] },
];
export const MAPS = Object.fromEntries(MAP_LIST.map(map => [map.id, map]));

// Community archives load only when selected; native practice maps stay instant.
export const COMMUNITY_MAPS = [{
  id:'bhop_lego',title:'bhop_lego',author:'Tony Montana',textures:'Man Walker',
  archive:'maps/bhop_lego.zip',geometry:'maps/bhop_lego.json',revision:2,thumbnail:'maps/bhop_lego.svg',
  source:'https://gamebanana.com/mods/125406',license:'https://creativecommons.org/licenses/by-nc-nd/4.0/',
  entryTarget:'1a',stageTargets:['1a','1b','1c','1d','1e','1f','2a','2b','2c','3a','3b','3c','4a','4b','4c','4d','5a','5b','6a','6b','6c','6d','7a','7b','7c'],
},{
  id:'bhop_kitsune',title:'bhop_kitsune',author:'NoNimus (Ghost1447951)',
  archive:'maps/bhop_kitsune.zip',geometry:'maps/bhop_kitsune.json',revision:3,thumbnail:'maps/bhop_kitsune.svg',routeSurfacesOnly:true,
  source:'https://gamebanana.com/mods/126424',license:'https://creativecommons.org/licenses/by-nc-nd/4.0/',
  entryTarget:'enterredmarker',finishTarget:'exitwhitemarker',
  stageTargets:['enterredmarker','enterorangemarker','entercyanmarker','entergreenmarker','enterpurplemarker','enterwhitemarker'],
  resetTargets:['restartred','restartorange','restartcyan','restartgreen','restartpurple','restartwhite'],
  exitTargets:['exitredmarker','exitorangemarker','exitcyanmarker','exitgreenmarker','exitpurplemarker','exitwhitemarker'],
  stageTitles:['Red','Orange','Cyan','Green','Purple','White'],
  // White descends through a narrow ramp, arch and stacked jumping pads.
  // [end X, highest route surface, half-width] excludes the surrounding shell.
  routeBands:{enterwhitemarker:[[-1696,8836,480],[-1152,8672,480],[256,8672,184],[320,8448,184],[960,8480,184],[1584,8074,480],[3000,6408,480]]},
}];
