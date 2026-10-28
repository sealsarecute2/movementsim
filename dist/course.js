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

const stage=(title,tip)=>({title,tip});

const endlessPreview = createEndless(1);
export const MAP_LIST = [
  { id: 'course', title: 'Starter course', timed: true,
    description: 'The original three-part route: runway, strafes, and movement control.',
    boxes: COURSE, spawns: SPAWNS,
    stages: [stage('Find your momentum.', 'Build speed on the runway. Jump at the edge.'),
      stage('Carry it through the turn.', 'Release W. Match A / D with a smooth mouse turn.'),
      stage('Slow down. Stay in control.', 'Walk the beam. Crouch under the low ceiling.')] },
  { id: 'endless', revision: 2, title: 'Endless', endless: true, timed: false,
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
}];
