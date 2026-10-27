import {
  AnimationClip, AnimationMixer, LoopOnce, LoopRepeat, PropertyBinding,
} from 'three';

export class ButterflyController {
  constructor(root, clips, { rareChance = 0.15, random = Math.random, blendSeconds = 0.07, onStateChange = () => {} } = {}) {
    if (!Number.isFinite(rareChance) || rareChance < 0 || rareChance > 1) throw new RangeError('rareChance must be between 0 and 1');
    this.root = root;
    this.mixer = new AnimationMixer(root);
    this.clips = new Map(clips.map(clip => [clip.name, clip]));
    for (const name of ['draw', 'idle', 'light_1', 'heavy', 'inspect', 'inspect_rare']) {
      if (!this.clips.has(name)) throw new Error(`Missing Butterfly animation: ${name}`);
    }
    this.actions = new Map(clips.map(clip => [clip.name, this.mixer.clipAction(clip)]));
    const templates = new Map(clips.flatMap(clip => clip.tracks.map(track => [track.name, track])));
    this.poseBindings = [...templates.values()].map(template => {
      const binding = PropertyBinding.create(root, template.name);
      binding.bind();
      return { template, binding };
    });
    this.rareChance = rareChance;
    this.random = random;
    this.blendSeconds = blendSeconds;
    this.onStateChange = onStateChange;
    this.state = 'none';
    this.category = 'none';
    this.enabled = true;
    this.generation = 0;
    this.lightIndex = 0;
    this.inspectIndex = 0;
    this.fade = null;
    this.pendingFinished = null;
    this.cleanups = new Set();
    this.heldAttacks = new Set();
    this.onFinished = event => {
      if (event.action === this.activeAction && this.category !== 'idle') {
        this.pendingFinished = { action: event.action, generation: this.generation };
      }
    };
    this.mixer.addEventListener('finished', this.onFinished);
  }

  snapshot(duration) {
    const tracks = this.poseBindings.map(({ template, binding }) => {
      const values = new Float32Array(template.getValueSize());
      binding.getValue(values, 0);
      // Use the original track names so the mixer shares each property's
      // binding between the captured pose and the destination clip.
      const track = template.clone();
      track.times = new Float32Array([0]);
      track.values = values;
      return track;
    });
    return new AnimationClip(`transition_pose_${this.generation}`, Math.max(duration, 0.001), tracks);
  }

  clearFade() {
    if (!this.fade) return;
    const { action, clip } = this.fade;
    action.stop();
    this.mixer.uncacheClip(clip);
    this.fade = null;
  }

  transition(name, category, { fade = this.blendSeconds, loop = category === 'idle' } = {}) {
    const next = this.actions.get(name);
    if (!next) throw new Error(`Unknown Butterfly animation: ${name}`);
    const useFade = !!this.activeAction && fade > 0;
    // Capture the actual blended pose before stopping old actions. This makes
    // rapid inspect cancels continuous even while an earlier blend is running.
    const pose = useFade ? this.snapshot(fade) : null;
    this.mixer.stopAllAction();
    this.clearFade();
    this.pendingFinished = null;
    this.generation++;
    if (pose) {
      const action = this.mixer.clipAction(pose);
      action.reset().setLoop(LoopRepeat, Infinity).setEffectiveWeight(1).play().fadeOut(fade);
      this.fade = { action, clip: pose, remaining: fade };
    }
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1);
    next.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.play();
    if (pose) next.fadeIn(fade);
    this.activeAction = next;
    this.state = name;
    this.category = category;
    this.mixer.update(0);
    this.onStateChange({ state: name, category });
    return true;
  }

  equip({ alternate = false } = {}) {
    this.releaseAttacks();
    return this.transition(alternate && this.clips.has('draw_alt') ? 'draw_alt' : 'draw', 'draw');
  }

  releaseAttacks() {
    this.heldAttacks.clear();
  }

  inspect({ variant } = {}) {
    if (this.category === 'inspect' && !variant) return false;
    if (!['idle', 'none', 'inspect'].includes(this.category)) return false;
    const rare = variant === 'rare' || (!variant && this.random() < this.rareChance);
    const normals = ['inspect', 'inspect_alt'].filter(name => this.clips.has(name));
    const name = rare ? 'inspect_rare' : normals[this.inspectIndex++ % normals.length];
    return this.transition(name, 'inspect');
  }

  cancelInspect() {
    if (this.category !== 'inspect') return false;
    return this.transition('idle', 'idle', { fade: 0.05 });
  }

  attack(kind = 'light', { hit = false, backstab = false } = {}) {
    if (!['light', 'heavy'].includes(kind)) throw new TypeError('Attack must be light or heavy');
    if (!['idle', 'inspect'].includes(this.category)) return false;
    let name;
    if (kind === 'heavy') name = backstab ? 'heavy_backstab' : hit ? 'heavy_hit' : 'heavy';
    else {
      const index = this.lightIndex++ % 2 + 1;
      name = backstab ? `light_backstab_${index}` : hit ? `light_hit_${index}` : `light_${index}`;
    }
    if (!this.clips.has(name)) name = kind === 'heavy' ? 'heavy' : 'light_1';
    return this.transition(name, kind, { fade: 0.045 });
  }

  preview(name) {
    const category = name.startsWith('inspect') ? 'inspect' : name.startsWith('idle') ? 'idle'
      : name.startsWith('light') ? 'light' : name.startsWith('heavy') ? 'heavy' : 'draw';
    return this.transition(name, category);
  }

  update(deltaSeconds) {
    if (!this.enabled) { this.releaseAttacks();return; }
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) return;
    const delta = Math.min(deltaSeconds, 0.1);
    this.mixer.update(delta);
    if (this.fade) {
      this.fade.remaining -= delta;
      if (this.fade.remaining <= 0) this.clearFade();
    }
    const finished = this.pendingFinished;
    this.pendingFinished = null;
    if (finished && finished.action === this.activeAction && finished.generation === this.generation) {
      this.transition('idle', 'idle');
    }
    const held = [...this.heldAttacks].at(-1);
    if (held) this.attack(held);
  }

  bindControls({ canvas, target = window, isActive = () => document.pointerLockElement === canvas } = {}) {
    if (!canvas) throw new TypeError('A canvas is required');
    let cancelKeyHeld = false;
    const editing = event => event.target?.closest?.('input,textarea,select,[contenteditable="true"]');
    const consume = event => { event.preventDefault(); event.stopImmediatePropagation(); };
    const keydown = event => {
      if (!isActive() || editing(event)) return;
      if (event.code === 'KeyR' && cancelKeyHeld) { consume(event); return; }
      if (event.repeat) return;
      if (event.code === 'KeyR' && this.cancelInspect()) {
        cancelKeyHeld = true;
        consume(event);
      } else if (event.code === 'KeyF') {
        this.inspect();
        consume(event);
      }
    };
    const keyup = event => { if (event.code === 'KeyR') cancelKeyHeld = false; };
    const mousedown = event => {
      if (!isActive() || ![0, 2].includes(event.button)) return;
      const kind = event.button === 0 ? 'light' : 'heavy';
      this.heldAttacks.delete(kind);this.heldAttacks.add(kind);
      this.attack(kind);
      consume(event);
    };
    const mouseup = event => {
      if (event.button === 0) this.heldAttacks.delete('light');
      if (event.button === 2) this.heldAttacks.delete('heavy');
    };
    const contextmenu = event => { if (isActive()) event.preventDefault(); };
    const blur = () => { cancelKeyHeld = false;this.releaseAttacks(); };
    const ownerDocument = canvas.ownerDocument;
    const captureChanged = () => { if (!isActive()) blur(); };
    const visibilityChanged = () => { if (ownerDocument.hidden) blur(); };
    // Capture on window so inspect cancellation consumes R before other listeners.
    target.addEventListener('keydown', keydown, true);
    target.addEventListener('keyup', keyup, true);
    target.addEventListener('blur', blur);
    // Mouse events report each button transition, including button chords.
    target.addEventListener('mouseup', mouseup, true);
    target.addEventListener('pointercancel', blur, true);
    ownerDocument?.addEventListener('pointerlockchange', captureChanged);
    ownerDocument?.addEventListener('visibilitychange', visibilityChanged);
    canvas.addEventListener('mousedown', mousedown);
    canvas.addEventListener('contextmenu', contextmenu);
    const cleanup = () => {
      target.removeEventListener('keydown', keydown, true);
      target.removeEventListener('keyup', keyup, true);
      target.removeEventListener('blur', blur);
      target.removeEventListener('mouseup', mouseup, true);
      target.removeEventListener('pointercancel', blur, true);
      ownerDocument?.removeEventListener('pointerlockchange', captureChanged);
      ownerDocument?.removeEventListener('visibilitychange', visibilityChanged);
      canvas.removeEventListener('mousedown', mousedown);
      canvas.removeEventListener('contextmenu', contextmenu);
      blur();
      this.cleanups.delete(cleanup);
    };
    this.cleanups.add(cleanup);
    return cleanup;
  }

  dispose() {
    for (const cleanup of [...this.cleanups]) cleanup();
    this.mixer.removeEventListener('finished', this.onFinished);
    this.mixer.stopAllAction();
    this.clearFade();
    this.mixer.uncacheRoot(this.root);
    for (const { binding } of this.poseBindings) binding.unbind();
  }
}
