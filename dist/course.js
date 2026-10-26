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
