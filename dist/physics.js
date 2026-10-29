// Independent Source-style movement recreation. No Valve code or assets included.
// Projected air acceleration follows the model in Valve's public Source SDK.
// CS2 subtick timing / landing penalties are approximated, not engine-identical.
import { hullPlaneDistance, brushHullOverlap, brushSurface } from './geometry.js';
export const DT = 1 / 256;
export const RULES = Object.freeze({
  gravity: 800, jump: 301.993377, accelerate: 5.5, airAccelerate: 12,
  airCap: 30, friction: 5.2, stopSpeed: 80, maxSpeed: 250,
  walkScale: 0.52, crouchScale: 0.34, radius: 16,
  standHeight: 72, duckHeight: 54, stepHeight: 18,
  ladderSpeed: 200, ladderReach: 2, ladderJump: 270, ladderRegrab: .2,
  // Simulator tuning values; not assertions of exact current CS2 convars.
  bhopHalfWindow: 0.015625, spamDelay: 0.015625, landingRecovery: 0.16,
});
export const PRESETS = {
  classic: { title: 'CS-style', airAccelerate: 12, autoBhop: true, speedLimit: true, landingSlow: true },
  practice: { title: 'Bhop practice', airAccelerate: 100, autoBhop: true, speedLimit: false, landingSlow: false },
};
const EPS = 0.0001;
export const speed = p => Math.hypot(p.vx, p.vz);
// Intersect the player's path with the column above a platform. Sweeping the
// hull catches fast passes even when neither endpoint is above the platform.
export function platformAirspace(from, to, platform) {
  const low = [platform.min[0] - RULES.radius, platform.max[1] - 0.001, platform.min[2] - RULES.radius];
  const high = [platform.max[0] + RULES.radius, Infinity, platform.max[2] + RULES.radius];
  let enter = 0, exit = 1;
  for (const [axis, key] of ['x', 'y', 'z'].entries()) {
    const origin = from[key], delta = to[key] - origin;
    if (Math.abs(delta) < 1e-9) {
      if (origin < low[axis] || origin > high[axis]) return null;
    } else {
      const a = (low[axis] - origin) / delta, b = (high[axis] - origin) / delta;
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
      if (enter > exit) return null;
    }
  }
  return { enter, exit };
}
export function createPlayer(spawn = { x: 0, y: 0, z: 100, yaw: 0 }) {
  return { ...spawn, vx: 0, vy: 0, vz: 0, pitch: 0, grounded: true,
    ducked: false, duckAmount: 0, time: 0, landTime: -10,
    lastPress: -10, validPress: -10, usedPress: -10,
    hops: 0, totalJumps: 0, lastJumpSpeed: 0, lastLandSpeed: 0,
    jumpFeedback: '', landImpact: 0, peakSpeed: 0, groundBox: null,
    ladder: null, ladderNormal: null, ladderDetachTime: -10, jumpHeldLast: false };
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
function planeExtent(plane,height) {
  return hullPlaneDistance(plane,height);
}
function brushOverlap(p,brush) {
  return brushHullOverlap(p,brush,p.ducked?54:72);
}
function supportHeight(p,box) {
  return brushSurface(box,p.x,p.z,16,p.ducked?54:72)?.height??-Infinity;
}
function blocked(p, boxes) { const b = bounds(p); return boxes.some(o => !o.ladder&&(o.planes?brushOverlap(p,o):overlaps(b, o))); }
export function support(p, boxes, distance = 0.08) {
  if(boxes.nearby)boxes=boxes.nearby(p);
  if(boxes.some(b=>b.planes))return boxes.find(b=>{
    if(b.ladder||p.x+16<=b.min[0]+EPS||p.x-16>=b.max[0]-EPS||p.z+16<=b.min[2]+EPS||p.z-16>=b.max[2]-EPS)return false;
    const top=supportHeight(p,b);
    return Number.isFinite(top)&&p.y>=top-EPS&&p.y-top<=distance;
  });
  return boxes.find(b => !b.ladder&&p.x + 16 > b.min[0] + EPS && p.x - 16 < b.max[0] - EPS &&
    p.z + 16 > b.min[2] + EPS && p.z - 16 < b.max[2] - EPS &&
    p.y >= b.max[1] - EPS && p.y - b.max[1] <= distance);
}
// Swept player hull against Minkowski-expanded axis-aligned boxes. Slab traces
// prevent tunnelling; repeated traces clip velocity to walls and corners.
function sweep(p, delta, boxes, includeLadders = false) {
  let best = { t: 1, normal: [0, 0, 0], box: null };
  const height = p.ducked ? 54 : 72;
  for (const b of boxes) {
    if(b.ladder&&!includeLadders)continue;
    if(b.planes) {
      let enter=-Infinity,leave=1,normal=null,valid=true;
      for(const plane of b.planes) {
        const n=plane.normal,start=p.x*n[0]+p.y*n[1]+p.z*n[2]-planeExtent(plane,height),motion=delta[0]*n[0]+delta[1]*n[1]+delta[2]*n[2];
        // Touching a surface while moving along/away from it is not entry.
        // Otherwise coplanar brush seams act like invisible vertical walls.
        if(start>=-EPS&&motion>=-1e-12){valid=false;break;}
        if(Math.abs(motion)<1e-12){if(start>EPS){valid=false;break;}continue;}
        const time=-start/motion;
        if(motion<0){if(time>enter){enter=time;normal=n;}}else leave=Math.min(leave,time);
        if(enter>leave){valid=false;break;}
      }
      if(valid&&normal&&enter>=-EPS&&enter<=leave&&enter<best.t&&enter<=1)best={t:Math.max(0,enter),normal,box:b};
      continue;
    }
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
    if(includeLadders&&b.ladder&&valid&&enter<0&&leave>=0) {
      const n=b.normal,axis=n?.findIndex(v=>v!==0);
      const face=axis>=0?(n[axis]>0?b.max[axis]:b.min[axis]):0;
      if(axis>=0&&(pos[axis]-face)*n[axis]>=RULES.radius-2-EPS&&delta[axis]*n[axis]<0){enter=0;normal=n;}
    }
    if (valid && enter <= leave && leave >= 0 && enter >= -EPS && (enter < best.t||includeLadders&&b.ladder&&enter===best.t&&enter<1) && enter <= 1) {
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
    if (hit.normal[1] > .7) { groundBox = hit.box; impact = Math.max(impact, -p.vy); }
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
      if (down.box && down.normal[1] > .7) {
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
// Independent implementation of Valve's public Source ladder-plane projection:
// https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/shared/gamemovement.cpp
// Pitch contributes to climbing; velocity into the face becomes upward motion.
// These browser timings are not a claim of CS2 subtick parity.
function ladderMove(p,input,boxes,dt,jumpEdge) {
  const forward=input.forward||0,side=input.side||0;
  const cp=Math.cos(p.pitch),sp=Math.sin(p.pitch),sy=Math.sin(p.yaw),cy=Math.cos(p.yaw);
  const direction=p.ladderNormal? p.ladderNormal.map(v=>-v):
    [sy*cp*forward+cy*side,sp*forward,-cy*cp*forward+sy*side];
  const length=Math.hypot(...direction);
  const detach=()=>{p.ladder=null;p.ladderNormal=null;};
  if(p.time<p.ladderDetachTime||!length){detach();return false;}
  const trace=sweep(p,direction.map(v=>v/length*RULES.ladderReach),boxes,true);
  const ladder=trace.box;
  if(!ladder?.ladder||!ladder.normal||trace.normal.some((v,i)=>Math.abs(v-ladder.normal[i])>EPS)) {detach();return false;}
  const normal=ladder.normal,onFloor=p.grounded;
  p.ladder=ladder;p.ladderNormal=normal;p.grounded=false;p.groundBox=null;
  p.hops=0;p.jumpFeedback='LADDER';p.landImpact=0;
  if(jumpEdge) {
    p.vx=normal[0]*RULES.ladderJump;p.vy=0;p.vz=normal[2]*RULES.ladderJump;
    p.totalJumps++;p.lastJumpSpeed=speed(p);
    p.ladderDetachTime=p.time+RULES.ladderRegrab;p.usedPress=p.validPress;
    p.jumpFeedback='LADDER JUMP';detach();return false;
  }
  const scale=p.ducked?RULES.crouchScale:input.walk?RULES.walkScale:1;
  const climb=RULES.ladderSpeed*scale;
  const vx=(sy*cp*forward+cy*side)*climb,vy=sp*forward*climb,vz=(-cy*cp*forward+sy*side)*climb;
  const into=vx*normal[0]+vz*normal[2];
  let lx=vx-into*normal[0],lz=vz-into*normal[2];
  // Counter-Strike's public Source branch damps lateral drift when facing in.
  if(into/Math.max(EPS,Math.hypot(into,lx,lz))<-.707){lx*=.2;lz*=.2;}
  p.vx=lx;p.vy=vy-into;p.vz=lz;
  if(onFloor&&into>0){p.vx+=normal[0]*climb;p.vz+=normal[2]*climb;}
  const result=move(p,dt,boxes,false);
  if(result.groundBox){p.grounded=true;p.groundBox=result.groundBox;p.vy=0;}
  p.peakSpeed=Math.max(p.peakSpeed,speed(p));
  return true;
}
export function step(p, input, boxes, mode = PRESETS.classic, dt = DT) {
  if(boxes.nearby)boxes=boxes.nearby(p,dt);
  p.time += dt;
  const jumpEdge=!!input.jumpPressed||!!input.jumpHeld&&!p.jumpHeldLast;
  p.jumpHeldLast=!!input.jumpHeld;
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
  if(ladderMove(p,input,boxes,dt,jumpEdge))return p;
  const ground = p.vy <= 0 ? support(p, boxes) : null;
  if (p.grounded && !ground) p.grounded = false;
  if (p.grounded) { p.y = supportHeight(p,ground); p.groundBox = ground; }
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
  let landed = result.groundBox || (p.vy <= 0 && support(p, boxes));
  // Follow descending ramps and small steps while walking. A jump never snaps.
  if(!landed&&wasGrounded&&p.vy<=0){
    const down=sweep(p,[0,-RULES.stepHeight,0],boxes);
    if(down.box&&down.normal[1]>.7){p.y-=RULES.stepHeight*down.t;landed=down.box;}
  }
  if (landed) {
    p.grounded = true; p.vy = 0; p.y = supportHeight(p,landed); p.groundBox = landed;
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
