// A repeatable route with a bounded set of nearby platforms. Coordinates are
// shifted periodically so long runs keep the renderer and collision hull precise.
export function createEndless(seed = Math.floor(Math.random() * 0x100000000)) {
  seed >>>= 0;
  let originZ = 0, checkpointIndex = 0, furthestBlock = 0, furthestDistance = 0;
  let windowIndex = -1, boxes = [], spawn = { x: 0, y: 0, z: 80, yaw: 0 };
  function random(index, salt) {
    let h = (seed ^ Math.imul(index, 0x45d9f3b) ^ salt) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
  }
  function center(index) {
    if (!index) return { x: 0, y: 0, z: originZ };
    return { x: Math.round(Math.sin(index * 0.48 + seed % 31) * 100 + (random(index, 17) - 0.5) * 50),
      y: 12 * Math.round(Math.sin(index * 0.27) * 2), z: -380 - (index - 1) * 250 + originZ };
  }
  function platform(index) {
    const p = center(index), saved = index % 8 === 0;
    const width = !index ? 480 : saved ? 400 : 180 + 20 * Math.floor(random(index, 29) * 4);
    const depth = !index ? 480 : saved ? 280 : 180 + 20 * Math.floor(random(index, 53) * 3);
    return { min: [p.x - width / 2, p.y - 120, p.z - depth / 2],
      max: [p.x + width / 2, p.y, p.z + depth / 2], endlessIndex: index,
      ...(saved ? { checkpoint: index / 8, label: index ? 'CHECKPOINT' : 'ENDLESS / START' } : {}) };
  }
  function rebuild(index) {
    const wanted = new Set();
    for (let i = Math.max(0, index - 6); i <= index + 30; i++) wanted.add(i);
    // Keep the saved deck and a small runway ahead even after a missed checkpoint.
    for (let i = Math.max(0, checkpointIndex - 2); i <= checkpointIndex + 6; i++) wanted.add(i);
    boxes = [...wanted].sort((a, b) => a - b).map(platform);
    windowIndex = index;
  }
  function update(player, ground = null) {
    furthestDistance = Math.max(furthestDistance, originZ - player.z);
    let checkpointSaved = false, shift = 0;
    if (ground && Number.isInteger(ground.endlessIndex)) {
      furthestBlock = Math.max(furthestBlock, ground.endlessIndex);
      if (ground.endlessIndex > checkpointIndex && ground.endlessIndex % 8 === 0) {
        checkpointIndex = ground.endlessIndex;
        const p = center(checkpointIndex), next = center(checkpointIndex + 1);
        const yaw = Math.atan2(next.x - p.x, p.z - next.z);
        spawn = { x: p.x - Math.sin(yaw) * 65, y: p.y, z: p.z + Math.cos(yaw) * 65, yaw };
        checkpointSaved = true;
      }
    }
    if (Math.abs(player.z) > 8192) {
      shift = Math.trunc(player.z / 4096) * 4096;
      player.z -= shift; originZ -= shift; spawn.z -= shift;
    }
    const index = Math.max(0, 1 + Math.round((originZ - player.z - 380) / 250));
    const changed = index !== windowIndex || checkpointSaved || shift !== 0;
    if (changed) rebuild(index);
    return { changed, checkpointSaved, shift };
  }
  rebuild(0);
  return { seed, update, platform,
    get boxes() { return boxes; }, get spawn() { return { ...spawn }; },
    get checkpoint() { return checkpointIndex / 8; },
    get furthestBlock() { return furthestBlock; }, get distance() { return Math.max(0, furthestDistance); },
    get originZ() { return originZ; } };
}
