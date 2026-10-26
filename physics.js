// Independent Source-style movement recreation. No Valve code or assets included.
// Projected air acceleration follows the model in Valve's public Source SDK.
// CS2 subtick timing / landing penalties are approximated, not engine-identical.
export const DT = 1 / 256;
export const RULES = Object.freeze({
  gravity: 800, jump: 301.993377, accelerate: 5.5, airAccelerate: 12,
  airCap: 30, friction: 5.2, stopSpeed: 80, maxSpeed: 250,
  walkScale: 0.52, crouchScale: 0.34, radius: 16,
  standHeight: 72, duckHeight: 54, stepHeight: 18,
  // Simulator tuning values; not assertions of exact current CS2 convars.
  bhopHalfWindow: 0.015625, spamDelay: 0.015625, landingRecovery: 0.16,
});
export const PRESETS = {
  classic: { title: 'CS-style', airAccelerate: 12, autoBhop: true, speedLimit: true, landingSlow: true },
  practice: { title: 'Bhop practice', airAccelerate: 100, autoBhop: true, speedLimit: false, landingSlow: false },
};
const EPS = 0.0001;
export const speed = p => Math.hypot(p.vx, p.vz);
export function createPlayer(spawn = { x: 0, y: 0, z: 100, yaw: 0 }) {
  return { ...spawn, vx: 0, vy: 0, vz: 0, pitch: 0, grounded: true,
    ducked: false, duckAmount: 0, time: 0, landTime: -10,
    lastPress: -10, validPress: -10, usedPress: -10,
    hops: 0, totalJumps: 0, lastJumpSpeed: 0, lastLandSpeed: 0,
    jumpFeedback: '', landImpact: 0, peakSpeed: 0, groundBox: null };
}
export function accelerate(p, wx, wz, wishSpeed, acceleration, dt, cap = wishSpeed) {
  const add = cap - (p.vx * wx + p.vz * wz);
  if (add <= 0) return;
  const amount = Math.min(add, acceleration * wishSpeed * dt);
  p.vx += wx * amount; p.vz += wz * amount;
}
export function friction(p, dt) {
  const s = speed(p);
  if (s < EPS) { p.vx = 0; p.vz = 0; return; }
  const next = Math.max(0, s - Math.max(s, RULES.stopSpeed) * RULES.friction * dt);
  p.vx *= next / s; p.vz *= next / s;
}
function bounds(p) {
  return { min: [p.x - 16, p.y, p.z - 16], max: [p.x + 16, p.y + (p.ducked ? 54 : 72), p.z + 16] };
}
function overlaps(a, b) {
  return a.min.every((v, i) => v < b.max[i] - EPS && a.max[i] > b.min[i] + EPS);
}
function blocked(p, boxes) { const b = bounds(p); return boxes.some(o => overlaps(b, o)); }
export function support(p, boxes, distance = 0.08) {
  return boxes.find(b => p.x + 16 > b.min[0] + EPS && p.x - 16 < b.max[0] - EPS &&
    p.z + 16 > b.min[2] + EPS && p.z - 16 < b.max[2] - EPS &&
    p.y >= b.max[1] - EPS && p.y - b.max[1] <= distance);
}
// Swept player hull against Minkowski-expanded axis-aligned boxes. Slab traces
// prevent tunnelling; repeated traces clip velocity to walls and corners.
function sweep(p, delta, boxes) {
  let best = { t: 1, normal: [0, 0, 0], box: null };
  const height = p.ducked ? 54 : 72;
  for (const b of boxes) {
    const lo = [b.min[0] - 16, b.min[1] - height, b.min[2] - 16];
    const hi = [b.max[0] + 16, b.max[1], b.max[2] + 16];
    const pos = [p.x, p.y, p.z];
    let enter = -Infinity, leave = Infinity, normal = [0, 0, 0], valid = true;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(delta[i]) < 1e-12) {
        if (pos[i] <= lo[i] + EPS || pos[i] >= hi[i] - EPS) { valid = false; break; }
      } else {
        const a = (lo[i] - pos[i]) / delta[i], c = (hi[i] - pos[i]) / delta[i];
        const near = Math.min(a, c), far = Math.max(a, c);
        if (near > enter) { enter = near; normal = [0, 0, 0]; normal[i] = delta[i] > 0 ? -1 : 1; }
        leave = Math.min(leave, far);
      }
    }
    if (valid && enter <= leave && leave >= 0 && enter >= -EPS && enter < best.t && enter <= 1) {
      best = { t: Math.max(0, enter), normal, box: b };
    }
  }
  return best;
}
function slide(p, dt, boxes) {
  let remaining = dt, groundBox = null, hitWall = false, impact = 0;
  for (let n = 0; n < 5 && remaining > 1e-8; n++) {
    const delta = [p.vx * remaining, p.vy * remaining, p.vz * remaining];
    const hit = sweep(p, delta, boxes);
    p.x += delta[0] * hit.t; p.y += delta[1] * hit.t; p.z += delta[2] * hit.t;
    if (!hit.box) break;
    if (hit.normal[1] === 1) { groundBox = hit.box; impact = Math.max(impact, -p.vy); }
    if (hit.normal[0] || hit.normal[2]) hitWall = true;
    const dot = p.vx * hit.normal[0] + p.vy * hit.normal[1] + p.vz * hit.normal[2];
    p.vx -= dot * hit.normal[0]; p.vy -= dot * hit.normal[1]; p.vz -= dot * hit.normal[2];
    remaining *= 1 - hit.t;
  }
  return { groundBox, hitWall, impact };
}
function move(p, dt, boxes, canStep) {
  const before = { ...p };
  let result = slide(p, dt, boxes);
  if (canStep && result.hitWall) {
    const direct = { ...p }, step = { ...before };
    const up = sweep(step, [0, RULES.stepHeight, 0], boxes);
    step.y += RULES.stepHeight * up.t;
    if (!blocked(step, boxes)) {
      const stepped = slide(step, dt, boxes);
      const down = sweep(step, [0, -RULES.stepHeight - 0.1, 0], boxes);
      if (down.box && down.normal[1] === 1) {
        step.y -= (RULES.stepHeight + 0.1) * down.t;
        const distance = q => (q.x - before.x) ** 2 + (q.z - before.z) ** 2;
        if (distance(step) > distance(direct) + EPS) {
          Object.assign(p, step); p.vy = 0;
          result = { ...stepped, groundBox: down.box, impact: 0 };
        }
      }
    }
  }
  return result;
}
function jump(p, mode, perfect) {
  if (mode.speedLimit && speed(p) > RULES.maxSpeed * 1.1) {
    const f = RULES.maxSpeed * 1.1 / speed(p); p.vx *= f; p.vz *= f;
  }
  p.vy = RULES.jump; p.grounded = false; p.groundBox = null;
  p.lastJumpSpeed = speed(p); p.totalJumps++;
  p.hops = perfect ? p.hops + 1 : 0;
  p.jumpFeedback = perfect ? 'CLEAN HOP' : 'JUMP';
  p.usedPress = p.validPress;
}
export function step(p, input, boxes, mode = PRESETS.classic, dt = DT) {
  p.time += dt;
  if (input.jumpPressed) {
    if (p.time - p.lastPress >= RULES.spamDelay) p.validPress = p.time;
    p.lastPress = p.time;
  }
  const wantsDuck = !!input.duck;
  if (wantsDuck) p.ducked = true;
  else if (p.ducked) {
    p.ducked = false;
    if (blocked(p, boxes)) p.ducked = true;
  }
  p.duckAmount += ((p.ducked ? 1 : 0) - p.duckAmount) * Math.min(1, dt * 16);
  const ground = p.vy <= 0 ? support(p, boxes) : null;
  if (p.grounded && !ground) p.grounded = false;
  if (p.grounded) { p.y = ground.max[1]; p.groundBox = ground; }
  const fresh = p.validPress > p.usedPress && p.time - p.validPress <= RULES.bhopHalfWindow;
  const heldAuto = mode.autoBhop && input.jumpHeld;
  if (p.grounded && (fresh || heldAuto)) {
    const perfect = p.time - p.landTime <= RULES.bhopHalfWindow;
    jump(p, mode, perfect);
  }
  const fwd = (input.forward || 0), side = (input.side || 0);
  let wx = Math.sin(p.yaw) * fwd + Math.cos(p.yaw) * side;
  let wz = -Math.cos(p.yaw) * fwd + Math.sin(p.yaw) * side;
  const length = Math.hypot(wx, wz);
  if (length > 0) { wx /= length; wz /= length; }
  let wish = RULES.maxSpeed * Math.min(1, length);
  if (p.ducked) wish *= RULES.crouchScale;
  else if (input.walk) wish *= RULES.walkScale;
  if (p.grounded) {
    friction(p, dt);
    // Post-landing slowdown is time/impact based. This curve is a browser approximation.
    if (mode.landingSlow) {
      const recovery = Math.max(0, 1 - (p.time - p.landTime) / RULES.landingRecovery);
      wish *= 1 - Math.min(0.42, p.landImpact / 900) * recovery;
    }
    accelerate(p, wx, wz, wish, RULES.accelerate, dt);
  } else if (length) {
    accelerate(p, wx, wz, wish, mode.airAccelerate, dt, RULES.airCap);
  }
  const wasGrounded = p.grounded;
  if (!p.grounded) p.vy -= RULES.gravity * dt / 2;
  const result = move(p, dt, boxes, wasGrounded);
  if (!wasGrounded) p.vy -= RULES.gravity * dt / 2;
  const landed = result.groundBox || (p.vy <= 0 && support(p, boxes));
  if (landed) {
    p.grounded = true; p.vy = 0; p.y = landed.max[1]; p.groundBox = landed;
    if (!wasGrounded) {
      p.landTime = p.time; p.landImpact = result.impact; p.lastLandSpeed = speed(p);
      const buffered = p.validPress > p.usedPress && p.time - p.validPress <= RULES.bhopHalfWindow;
      if (buffered || heldAuto) jump(p, mode, true);
      else { p.jumpFeedback = 'LANDED'; }
    }
  } else { p.grounded = false; p.groundBox = null; }
  if (p.grounded && p.time - p.landTime > RULES.bhopHalfWindow) p.hops = 0;
  p.peakSpeed = Math.max(p.peakSpeed, speed(p));
  return p;
}
