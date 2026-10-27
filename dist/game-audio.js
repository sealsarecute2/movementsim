import { RULES } from './physics.js';

export const CHECKPOINT_CHIMES = Object.freeze({
  pulse: { label: 'Pulse', wave: 'sine', notes: [[880, 0, .13], [1320, .09, .2]], level: .18 },
  glass: { label: 'Glass', wave: 'sine', notes: [[1568, 0, .25], [2093, .065, .3], [3136, .025, .18]], level: .1 },
  arcade: { label: 'Arcade', wave: 'triangle', notes: [[659, 0, .09], [831, .065, .09], [988, .13, .09], [1319, .195, .15]], level: .14 },
});
export const FINISH_CHIME = Object.freeze({
  wave: 'triangle', level: .14,
  notes: [[523.25, 0, .12], [659.25, .1, .12], [783.99, .2, .12], [1046.5, .32, .42], [1318.51, .32, .42]],
});
export const MOVEMENT_SAMPLES = Object.freeze({
  jump: ['jump_launch_01.wav'],
  step: ['concrete_ct_01.wav', 'concrete_ct_02.wav', 'concrete_ct_03.wav', 'concrete_ct_04.wav'],
  land: ['land_concrete_01.wav'],
});

export class GameAudio {
  constructor({ context, fetcher = globalThis.fetch?.bind(globalThis), assetBase = 'sounds/',
    movementEnabled = true, checkpointSound = 'pulse', volume = .65, random = Math.random,
    onReady = () => {}, onError = () => {} }) {
    this.context = context;this.fetcher = fetcher;this.assetBase = assetBase;this.random = random;
    this.onReady = onReady;this.onError = onError;this.buffers = new Map();this.voices = new Set();
    this.master = context.createGain();this.master.connect(context.destination);
    this.movementEnabled = !!movementEnabled;this.checkpointSound = checkpointSound;
    this.stepDistance = 0;this.lastStep = -1;this.pendingLanding = null;this.loading = null;this.ready = false;
    this.setVolume(volume);
  }

  async activate() {
    if (this.context.state === 'suspended') await this.context.resume();
    if (this.movementEnabled && !this.loading) {
      this.loading = this.load().catch(error => { this.loading = null;this.onError(error); });
    }
    return this;
  }

  async load() {
    await Promise.all(Object.values(MOVEMENT_SAMPLES).flat().map(async file => {
      if (this.buffers.has(file)) return;
      const response = await this.fetcher(this.assetBase + file);
      if (!response.ok) throw new Error(`Movement sound unavailable: ${file}`);
      this.buffers.set(file, await this.context.decodeAudioData(await response.arrayBuffer()));
    }));
    this.ready = true;this.onReady();
  }

  setVolume(volume) {
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : .65;
    this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, .01);
  }

  setMovementEnabled(enabled) { this.movementEnabled = !!enabled;this.stepDistance = 0;this.pendingLanding = null; }

  voice(source, level, start, duration, decay = false) {
    const gain = this.context.createGain(), end = start + duration;
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.linearRampToValueAtTime(level, start + Math.min(.006, duration / 4));
    if (decay) gain.gain.exponentialRampToValueAtTime(.0001, end);
    else {
      gain.gain.setValueAtTime(level, end - Math.min(.012, duration / 4));
      gain.gain.linearRampToValueAtTime(.0001, end);
    }
    source.connect(gain);gain.connect(this.master);
    const voice = { source, gain };
    source.onended = () => { this.voices.delete(voice);source.disconnect();gain.disconnect(); };
    this.voices.add(voice);source.start(start);source.stop(end);
  }

  sample(kind, level) {
    if (this.context.state !== 'running') return;
    const files = MOVEMENT_SAMPLES[kind];
    let index = 0;
    if (kind === 'step') {
      index = (this.lastStep + 1 + Math.floor(this.random() * (files.length - 1))) % files.length;
      this.lastStep = index;
    }
    const buffer = this.buffers.get(files[index]);
    if (!buffer) return;
    const source = this.context.createBufferSource();source.buffer = buffer;
    this.voice(source, level, this.context.currentTime, buffer.duration);
  }

  movement(before, after, input) {
    if (!this.movementEnabled) return;
    const landed = after.landTime > before.landTime, jumped = after.totalJumps > before.totalJumps;
    const moving = Math.hypot(after.vx, after.vz) >= RULES.maxSpeed * RULES.walkScale;
    const cleanHop = jumped && moving && after.jumpFeedback === 'CLEAN HOP';
    // Keep takeoff and landing clearly audible. Only moving bhops get a modest
    // reduction; repeated vertical jumps and hard falls keep their normal mix.
    if (landed) {
      const level = Math.min(.7, .2 + after.landImpact / 1100);
      this.pendingLanding = null;this.stepDistance = 0;
      if (after.landImpact > RULES.jump * 1.4) this.sample('land', level);
      else if (cleanHop) this.sample('land', level * .65);
      else this.pendingLanding = { time: after.landTime, level };
    }
    if (this.pendingLanding) {
      const age = after.time - this.pendingLanding.time;
      // Wait only the existing bhop window so a just-after-landing jump can
      // soften its landing before a loud sample has already started playing.
      if (cleanHop && age >= 0 && age <= RULES.bhopHalfWindow + 1e-9) {
        this.sample('land', this.pendingLanding.level * .65);this.pendingLanding = null;
      } else if (age > RULES.bhopHalfWindow || age < 0) {
        this.sample('land', this.pendingLanding.level);this.pendingLanding = null;
      }
    }
    if (jumped) { this.sample('jump', cleanHop ? .32 : .5);this.stepDistance = 0; }
    if (input.walk || input.duck || after.ducked) { this.stepDistance = 0;return; }
    if (!before.grounded || !after.grounded || landed) return;
    const distance = Math.hypot(after.x - before.x, after.z - before.z);
    if (distance < .01) return;
    this.stepDistance += distance;
    const stride = 95;
    if (this.stepDistance >= stride) {
      this.stepDistance %= stride;
      this.sample('step', .43);
    }
  }

  checkpoint(style = this.checkpointSound) {
    const chime = Object.hasOwn(CHECKPOINT_CHIMES, style) ? CHECKPOINT_CHIMES[style] : null;
    this.chime(chime);
  }

  finish() { this.chime(FINISH_CHIME); }

  chime(chime) {
    if (!chime || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    for (const [frequency, delay, duration] of chime.notes) {
      const oscillator = this.context.createOscillator();oscillator.type = chime.wave;
      oscillator.frequency.setValueAtTime(frequency, now + delay);
      this.voice(oscillator, chime.level, now + delay, duration, true);
    }
  }

  stopAll() {
    const now = this.context.currentTime;
    for (const { source, gain } of this.voices) {
      gain.gain.cancelScheduledValues(now);gain.gain.setTargetAtTime(0, now, .003);
      source.stop(now + .012);
    }
    this.voices.clear();this.stepDistance = 0;this.pendingLanding = null;
  }
}

export function createGameAudio(options = {}) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) return null;
  return new GameAudio({ ...options, context: new Context() });
}
