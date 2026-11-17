/** A quiet motor, roller and latch sound, synthesized locally without an audio download. */
export const RECORD_INSERT_MS = 1120;

export class RecordPlayerAudio {
  private context: AudioContext | null = null;
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private generation = 0;

  // Called directly from pointerdown so mobile browsers can unlock sound in the gesture.
  unlock() {
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch { /* Sound is optional when the browser has no audio output. */ }
  }

  insert() {
    this.stop();
    const context = this.context;
    if (!context || context.state === 'closed') return;
    const generation = this.generation;
    const start = () => { if (generation === this.generation && context.state === 'running') this.schedule(context); };
    if (context.state === 'running') start();
    else void context.resume().then(start).catch(() => {});
  }

  private schedule(context: AudioContext) {
    const at = context.currentTime + .012;
    const master = context.createGain();
    master.gain.value = .16;
    master.connect(context.destination); this.nodes.push(master);
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 1.25), context.sampleRate);
    const samples = buffer.getChannelData(0);
    let seed = 179, smooth = 0;
    for (let i = 0; i < samples.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      smooth = .72 * smooth + .28 * (seed / 2147483648);
      samples[i] = smooth;
    }
    const envelope = (when: number, duration: number, volume: number) => {
      const gain = context.createGain();
      gain.gain.setValueAtTime(.0001, at + when);
      gain.gain.exponentialRampToValueAtTime(volume, at + when + Math.min(.018, duration / 4));
      gain.gain.exponentialRampToValueAtTime(.0001, at + when + duration);
      gain.connect(master); this.nodes.push(gain); return gain;
    };
    const noise = (when: number, duration: number, frequency: number, volume: number) => {
      const source = context.createBufferSource(), filter = context.createBiquadFilter();
      source.buffer = buffer; filter.type = 'bandpass'; filter.frequency.value = frequency; filter.Q.value = .65;
      source.connect(filter); filter.connect(envelope(when, duration, volume)); this.nodes.push(source, filter); this.sources.push(source);
      source.start(at + when); source.stop(at + when + duration);
    };
    const motor = context.createOscillator();
    motor.type = 'triangle';
    motor.frequency.setValueAtTime(95, at + .17);
    motor.frequency.exponentialRampToValueAtTime(155, at + .42);
    motor.frequency.exponentialRampToValueAtTime(72, at + .91);
    motor.connect(envelope(.17, .78, .19)); this.nodes.push(motor); this.sources.push(motor);
    motor.start(at + .17); motor.stop(at + .96);
    noise(0, .045, 1800, .30);       // Disc touching the slot.
    noise(.19, .71, 620, .46);      // Soft rubber rollers pulling the disc in.
    noise(.91, .085, 1100, .45);    // The loading latch closing.
    noise(.985, .065, 2100, .20);   // A small final mechanical click.
    const last = this.sources[this.sources.length - 1];
    last.onended = () => this.stop();
  }

  stop() {
    this.generation++;
    for (const source of this.sources) { source.onended = null; try { source.stop(); } catch {} }
    for (const node of this.nodes) node.disconnect();
    this.sources = []; this.nodes = [];
  }

  dispose() {
    this.stop();
    const context = this.context; this.context = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }
}
