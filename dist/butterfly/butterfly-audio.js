export class ButterflyAudio {
  constructor(controller, { manifest, buffers, context, random = Math.random }) {
    this.controller = controller;
    this.manifest = manifest;
    this.buffers = buffers;
    this.context = context;
    this.random = random;
    this.master = context.createGain();
    this.master.connect(context.destination);
    this.voices = new Set();
    this.cleanups = new Set();
    this.generation = -1;
    this.cursor = 0;
    this.muted = false;
    this.disposed = false;
  }

  async activate() {
    if (!this.disposed && this.context.state === 'suspended') await this.context.resume();
  }

  setMuted(muted) {
    this.muted = !!muted;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.context.currentTime, .005);
  }

  bindActivation(target = window) {
    const activate = () => { void this.activate().catch(error => console.error('Sound activation failed', error)); };
    const pause = () => { this.stopAll();this.generation = -1; };
    const visibility = () => { if (target.document.hidden) pause(); };
    target.addEventListener('pointerdown', activate, true);
    target.addEventListener('keydown', activate, true);
    target.addEventListener('blur', pause);
    target.document?.addEventListener('visibilitychange', visibility);
    const cleanup = () => {
      target.removeEventListener('pointerdown', activate, true);
      target.removeEventListener('keydown', activate, true);
      target.removeEventListener('blur', pause);
      target.document?.removeEventListener('visibilitychange', visibility);
      this.cleanups.delete(cleanup);
    };
    this.cleanups.add(cleanup);
    return cleanup;
  }

  stopAll() {
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.volume, now);
      voice.gain.gain.linearRampToValueAtTime(0, now + .008);
      voice.source.stop(now + .008);
    }
    this.voices.clear();
  }

  play(cue, clipTime) {
    const definition = this.manifest.events[cue.name];
    if (!definition) return;
    const url = definition.samples[Math.min(definition.samples.length - 1, Math.floor(this.random() * definition.samples.length))];
    const buffer = this.buffers.get(url);
    if (!buffer) return;
    const pitch = definition.pitch > 0 ? definition.pitch : 1;
    const elapsed = Math.max(0, clipTime - cue.time);
    const lifetime = Math.min(buffer.duration / pitch, cue.continueAtEnd || cue.duration <= 0 ? Infinity : cue.duration);
    if (elapsed >= lifetime) return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;source.playbackRate.value = pitch;
    const now = this.context.currentTime, remaining = lifetime - elapsed;
    gain.gain.setValueAtTime(definition.volume, now);
    const fade = Math.min(.008, remaining / 2);
    gain.gain.setValueAtTime(definition.volume, now + remaining - fade);
    gain.gain.linearRampToValueAtTime(0, now + remaining);
    source.connect(gain);gain.connect(this.master);
    const voice = { source, gain, volume: definition.volume };
    source.onended = () => { this.voices.delete(voice);source.disconnect();gain.disconnect(); };
    this.voices.add(voice);
    source.start(now, elapsed * pitch);
    source.stop(now + remaining);
  }

  update() {
    if (this.disposed) return;
    const controller = this.controller, action = controller.activeAction;
    if (!controller.enabled || !action || this.context.state !== 'running') {
      this.stopAll();this.generation = -1;return;
    }
    const time = action.time, now = this.context.currentTime;
    const drift = this.lastTime === undefined ? 0 : Math.abs((time - this.lastTime) - (now - this.lastClock));
    if (controller.generation !== this.generation || time < this.lastTime || drift > .08) {
      this.stopAll();this.cursor = 0;this.generation = controller.generation;
    }
    this.lastTime = time;this.lastClock = now;
    const cues = this.manifest.clips[controller.state]?.events || [];
    while (this.cursor < cues.length && cues[this.cursor].time <= time + 1e-6) {
      this.play(cues[this.cursor++], time);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;this.stopAll();
    for (const cleanup of [...this.cleanups]) cleanup();
    this.master.disconnect();
    void this.context.close().catch(() => {});
  }
}

export async function createButterflyAudio(controller, { manifestUrl = new URL('./butterfly-audio.json', import.meta.url) } = {}) {
  const response = await fetch(manifestUrl);
  if (!response.ok) throw new Error('Butterfly sound manifest unavailable');
  const manifest = await response.json();
  const context = new AudioContext();
  try {
    const buffers = new Map();
    const queue = [...new Set(Object.values(manifest.events).flatMap(event => event.samples))];
    const loadSample = async url => {
      let failure;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const sample = await fetch(new URL(url, manifestUrl));
          if (!sample.ok) throw new Error(`HTTP ${sample.status}`);
          return await sample.arrayBuffer();
        } catch (error) {
          failure = error;
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
        }
      }
      throw new Error(`Could not load sound ${url}: ${failure.message}`);
    };
    const packed = manifest.pack ? await loadSample(manifest.pack.url) : null;
    if (packed && packed.byteLength !== manifest.pack.bytes) throw new Error('Incomplete Butterfly sound pack');
    const samples = new Map(Object.values(manifest.samples).map(sample => [sample.url, sample]));
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length) {
        const url = queue.shift();
        const sample = samples.get(url);
        const bytes = packed ? packed.slice(sample.offset, sample.offset + sample.bytes) : await loadSample(url);
        buffers.set(url, await context.decodeAudioData(bytes));
      }
    }));
    return new ButterflyAudio(controller, { manifest, buffers, context });
  } catch (error) { await context.close();throw error; }
}
