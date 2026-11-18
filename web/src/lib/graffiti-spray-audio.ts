export const SPRAY_CAN_SHAKE_MS = 520;
export const SPRAY_CAN_IMPACT_OFFSETS = [.16, .32, .59, .76] as const;

export class GraffitiSprayAudio {
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private voice: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private rattle: AudioBuffer | null = null;
  private shaking: AudioBufferSourceNode | null = null;

  private audioContext() {
    const context = this.context ??= new AudioContext();
    if (context.state !== 'running') void context.resume().catch(() => {});
    return context;
  }

  start() {
    if (this.voice || typeof AudioContext === 'undefined') return;
    try {
      const context = this.audioContext();
      if (!this.noise) {
        this.noise = context.createBuffer(1, Math.ceil(context.sampleRate * .8), context.sampleRate);
        const samples = this.noise.getChannelData(0);
        for (let i = 0; i < samples.length; i++) {
          samples[i] = (Math.random() * 2 - 1) * (.88 + .12 * Math.sin(i / context.sampleRate * 2 * Math.PI * 17));
        }
      }
      const source = context.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 3150;
      filter.Q.value = .68;
      const gain = context.createGain();
      const now = context.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(.12, now + .027);
      source.connect(filter).connect(gain).connect(context.destination);
      source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
      source.start();
      this.voice = { source, gain };
    } catch { /* A browser without available audio output can still spray. */ }
  }

  shake() {
    if (typeof AudioContext === 'undefined') return;
    try {
      const context = this.audioContext();
      this.shaking?.stop();
      if (!this.rattle) {
        const duration = SPRAY_CAN_SHAKE_MS / 1000;
        this.rattle = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
        const samples = this.rattle.getChannelData(0);
        // Two swings, each with a rolling impact and a sharper hit against the can.
        const strengths = [.19, .25, .17, .23];
        for (const [index, offset] of SPRAY_CAN_IMPACT_OFFSETS.entries()) {
          const strength = strengths[index];
          const start = Math.round(offset * duration * context.sampleRate);
          const length = Math.round(.055 * context.sampleRate);
          for (let i = 0; i < length && start + i < samples.length; i++) {
            const time = i / context.sampleRate, phase = 2 * Math.PI * time;
            const metal = .47 * Math.sin(phase * 1230) + .28 * Math.sin(phase * 2940);
            const grit = .25 * (Math.random() * 2 - 1);
            samples[start + i] += strength * Math.exp(-time / .011) * (metal + grit);
          }
        }
      }
      const source = context.createBufferSource();
      source.buffer = this.rattle;
      source.connect(context.destination);
      source.onended = () => {
        source.disconnect();
        if (this.shaking === source) this.shaking = null;
      };
      source.start();
      this.shaking = source;
    } catch { /* The shake can still animate when audio is unavailable. */ }
  }

  stop() {
    const voice = this.voice, context = this.context;
    this.voice = null;
    if (!voice || !context || context.state === 'closed') return;
    const now = context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0, now, .014);
    voice.source.stop(now + .055);
  }

  silence() {
    this.stop();
    this.shaking?.stop();
    this.shaking = null;
  }

  dispose() {
    this.silence();
    const context = this.context;
    this.context = null;
    this.noise = null;
    this.rattle = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }
}
