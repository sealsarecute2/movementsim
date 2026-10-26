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
  box(0, -600, 2200, 2200, 0, { label: 'FREE MOVEMENT' }),
  box(-500, -700, 160, 160, 32),
  box(-700, -960, 160, 160, 64),
  box(-450, -1220, 200, 180, 96),
  box(540, -600, 80, 600, 32),
  box(730, -1000, 200, 160, 48),
];
export const SPAWNS = [
  { x: 0, y: 0, z: 100, yaw: 0 },
  { x: 0, y: 0, z: -1390, yaw: -0.28 },
  { x: 300, y: 0, z: -2160, yaw: 0 },
];

// Route nodes describe the intended line as well as the visible platforms.
// Keeping that line with the map lets the geometry checks exercise real gaps,
// stairs, beams and tunnels with the same controller used in the game.
const node = (x, z, w = 200, d = 180, top = 0, extra = {}) => ({ x, z, w, d, top, ...extra });
function makeCourse(id, title, difficulty, description, nodes, stages, obstacles = []) {
  const platforms = nodes.map((n, i) => box(n.x, n.z, n.w, n.d, n.top, {
    ...(n.checkpoint ? { checkpoint: n.checkpoint } : {}),
    ...(i === nodes.length - 1 ? { finish: true, label: 'FINISH' } :
      i === 0 || n.checkpoint ? { label: title.toUpperCase() } : {}),
  }));
  const spawns = nodes.flatMap((n, i) => {
    if (i !== 0 && !n.checkpoint) return [];
    const next = nodes[i + 1] || n, dx = next.x - n.x, dz = next.z - n.z;
    const length = Math.hypot(dx, dz) || 1;
    const retreat = Math.min(80, (n.w / 2 - 36) / (Math.abs(dx / length) || 1e-6),
      (n.d / 2 - 36) / (Math.abs(dz / length) || 1e-6));
    return [{ x: n.x - dx / length * retreat, y: n.top,
      z: n.z - dz / length * retreat, yaw: Math.atan2(dx, -dz) }];
  });
  return { id, title, difficulty, description, timed: true,
    boxes: [...platforms, ...obstacles], spawns, stages, route: nodes, platforms };
}
const stage = (title, tip) => ({ title, tip });
const momentum = makeCourse('momentum', 'Momentum Mile', 'Easy',
  'A long rhythm course with generous landings and two recovery decks.',
  [node(0, 0, 480, 480), ...Array.from({ length: 21 }, (_, i) => {
    const checkpoint = i === 6 ? 1 : i === 13 ? 2 : 0;
    return node(i % 2 ? 35 : -35, -420 - i * 280,
      checkpoint || i === 20 ? 400 : 240, checkpoint ? 240 : 200, 0, { checkpoint });
  })], [stage('Find a steady rhythm.', 'Wide blocks give you room to line up each takeoff.'),
    stage('Keep the chain alive.', 'Hold Space and use small, smooth strafes.'),
    stage('Finish with momentum.', 'Look ahead to the next block instead of at your feet.')]);
const zigzag = makeCourse('zigzag', 'Zigzag Alley', 'Medium',
  'Alternating left and right landings for learning deliberate air strafes.',
  [node(0, 0, 440, 440), ...Array.from({ length: 15 }, (_, i) => {
    const checkpoint = i === 4 ? 1 : i === 9 ? 2 : 0;
    return node(checkpoint || i === 14 ? 0 : i % 2 ? 125 : -125,
      -380 - i * 250, checkpoint || i === 14 ? 380 : 180,
      checkpoint ? 240 : 180, 0, { checkpoint });
  })], [stage('Commit to the turn.', 'Release W in the air. Match A / D to your mouse turn.'),
    stage('Reverse your strafe.', 'Set up the opposite direction before the next takeoff.'),
    stage('Link the final zigzags.', 'Aim for the middle of each landing to leave room for the next turn.')]);
const skyline = makeCourse('skyline', 'Skyline Ascent', 'Medium',
  'Climb floating terraces, gaining 24 units with every jump.',
  [node(0, 0, 440, 400), ...Array.from({ length: 15 }, (_, i) => {
    const checkpoint = i === 4 ? 1 : i === 9 ? 2 : 0;
    return node(Math.round(Math.sin(i * 0.55) * 150), -340 - i * 210,
      checkpoint || i === 14 ? 360 : 180, checkpoint ? 250 : 150,
      (i + 1) * 24, { checkpoint });
  })], [stage('Start the climb.', 'Jump close to the edge. Each landing is one terrace higher.'),
    stage('Follow the skyline.', 'Keep your turns smooth as the path bends.'),
    stage('Reach the summit.', 'Preserve your running speed for the final raised platforms.')]);
const circuit = makeCourse('circuit', 'Broken Circuit', 'Medium',
  'Four straights joined by sharp right-angle turns over the void.',
  [node(0, 0, 440, 440), node(0, -380), node(0, -640),
    node(0, -900, 360, 280, 0, { checkpoint: 1 }),
    node(300, -900), node(560, -900), node(820, -900),
    node(1080, -900, 300, 300, 0, { checkpoint: 2 }),
    node(1080, -1180), node(1080, -1440), node(1080, -1700),
    node(1080, -1960, 320, 280, 0, { checkpoint: 3 }),
    node(800, -1960), node(540, -1960), node(280, -1960), node(0, -1960, 400, 280)],
  [stage('Approach the first corner.', 'Use the wide corner deck to aim down the next straight.'),
    stage('Turn right.', 'The route now runs to your right. Reset your aim before jumping.'),
    stage('Turn left into the next lane.', 'Stay centered through the long middle straight.'),
    stage('Bring it home.', 'Turn left again and follow the blocks to the finish.')]);
const balance = makeCourse('balance', 'Balance Lab', 'Medium',
  'Connected beams, small corner pads, and a thin final crossing. Space is optional.',
  [node(0, 0, 400, 400), node(0, -420, 56, 440, 0, { walk: true }),
    node(0, -730, 180, 180, 0, { walk: true }),
    node(60, -960, 52, 280, 0, { walk: true }),
    node(60, -1190, 180, 180, 0, { walk: true, checkpoint: 1 }),
    node(360, -1190, 420, 52, 0, { walk: true }),
    node(660, -1190, 180, 180, 0, { walk: true, checkpoint: 2 }),
    node(660, -1540, 48, 520, 0, { walk: true }),
    node(660, -1890, 180, 180, 0, { walk: true }),
    node(660, -2210, 44, 460, 0, { walk: true }),
    node(660, -2580, 400, 280, 0, { walk: true })],
  [stage('Walk the centerline.', 'Hold Shift. Release Space to walk along the beams.'),
    stage('Make the corner.', 'Use the square pad to line up with the horizontal beam.'),
    stage('Cross the thin finish.', 'Slow adjustments are enough. Keep your view level.')]);
const tunnelNodes = [node(0, 0, 420, 360),
  node(0, -460, 220, 560, 0, { walk: true, duck: true }),
  node(0, -880, 360, 280, 0, { walk: true }), node(120, -1120, 160, 140),
  node(-20, -1360, 180, 160), node(0, -1620, 400, 280, 0, { checkpoint: 1 }),
  node(0, -2060, 160, 600, 0, { walk: true, duck: true }),
  node(0, -2500, 340, 280, 0, { walk: true, checkpoint: 2 }),
  node(0, -2840, 64, 400, 0, { walk: true }), node(0, -3190, 400, 300, 0, { walk: true })];
const underpass = makeCourse('underpass', 'Underpass', 'Medium',
  'Two low tunnels linked by offset jumps and a beam exit.', tunnelNodes,
  [stage('Get under the first roof.', 'Release Space and hold Ctrl or C before entering the tunnel.'),
    stage('Stay low through the passage.', 'The second roof is narrower. Stand only after you clear it.'),
    stage('Balance on the exit.', 'Release crouch, hold Shift, and follow the beam to the finish.')],
  [{ min: [-110, 58, -680], max: [110, 84, -240], roof: true },
    { min: [-80, 58, -2300], max: [80, 84, -1820], roof: true }]);
const needles = makeCourse('needles', 'Needleworks', 'Hard',
  'Small pillars demand accurate takeoffs and controlled landings.',
  [node(0, 0, 400, 380), ...Array.from({ length: 18 }, (_, i) => {
    const checkpoint = i === 5 ? 1 : i === 11 ? 2 : 0;
    return node(checkpoint || i === 17 ? 0 : [-65, 15, 95, 15][i % 4],
      -320 - i * 180, checkpoint || i === 17 ? 320 : 70,
      checkpoint || i === 17 ? 180 : 88, 0, { checkpoint });
  })], [stage('Land with precision.', 'Use small strafes. The pillars leave little room for corrections.'),
    stage('Control each takeoff.', 'A clean landing sets up the next jump.'),
    stage('Thread the final needles.', 'Keep your turns shallow and aim through the next pillar.')]);
const gauntlet = makeCourse('gauntlet', 'The Gauntlet', 'Hard',
  'A full movement test: offset hops, raised terraces, a tunnel, and narrow beams.',
  [node(0, 0, 420, 400), node(70, -360, 120, 140), node(-50, -570, 120, 140),
    node(70, -780, 120, 140), node(0, -1030, 360, 260, 0, { checkpoint: 1 }),
    node(100, -1260, 140, 150, 24), node(210, -1470, 140, 150, 48),
    node(320, -1680, 140, 150, 72), node(400, -1910, 360, 260, 96, { checkpoint: 2 }),
    node(400, -2080, 160, 80, 112, { walk: true }),
    node(400, -2160, 160, 80, 128, { walk: true }),
    node(400, -2410, 160, 420, 144, { walk: true, duck: true }),
    node(400, -2760, 320, 280, 144, { walk: true, checkpoint: 3 }),
    node(400, -3100, 48, 400, 144, { walk: true }), node(470, -3410, 80, 120, 144),
    node(390, -3630, 80, 120, 144), node(400, -3890, 400, 240, 144)],
  [stage('Set your line.', 'Link the offset blocks while keeping your speed under control.'),
    stage('Climb the terraces.', 'Take off near each edge to reach the higher platforms.'),
    stage('Switch to control.', 'Release Space, climb the steps, and crouch before the roof.'),
    stage('Finish the gauntlet.', 'Walk the beam, then jump the last two pillars.')],
  [{ min: [320, 202, -2530], max: [480, 228, -2250], roof: true }]);

const endlessPreview = createEndless(1);
export const MAP_LIST = [
  { id: 'course', title: 'Starter course', difficulty: 'Easy', timed: true,
    description: 'The original three-part route: runway, strafes, and movement control.',
    boxes: COURSE, spawns: SPAWNS,
    stages: [stage('Find your momentum.', 'Build speed on the runway. Jump at the edge.'),
      stage('Carry it through the turn.', 'Release W. Match A / D with a smooth mouse turn.'),
      stage('Slow down. Stay in control.', 'Walk the beam. Crouch under the low ceiling.')] },
  momentum, zigzag, skyline, circuit, balance, underpass, needles, gauntlet,
  { id: 'endless', title: 'Endless', difficulty: 'Infinite', endless: true, timed: false,
    description: 'A new never-ending route each run. Checkpoints every 8 blocks. Chase your farthest distance.',
    boxes: endlessPreview.boxes, spawns: [endlessPreview.spawn],
    stages: [stage('See how far you can go.', 'Checkpoints every 8 blocks. E returns to the latest save. R starts a new route.')] },
  { id: 'free', title: 'Free roam', difficulty: 'Sandbox', timed: false,
    description: 'A wide floor for strafing, hops, and stopping practice.', boxes: PRACTICE,
    spawns: [SPAWNS[0]], stages: [stage('Make your own line.', 'A wide floor for strafing, hops, and stopping practice.')] },
];
export const MAPS = Object.fromEntries(MAP_LIST.map(map => [map.id, map]));
