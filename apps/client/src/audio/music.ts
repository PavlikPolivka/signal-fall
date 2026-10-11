/**
 * Generative battle score in WebAudio: a dark D-minor loop whose layers follow
 * the fighting. Calm: pads and a slow bass. Tension: driving bass, kick and hats.
 * Combat: full drums and an echoing arpeggio. Nothing is pre-recorded.
 */

const BPM = 88;
const STEP = 60 / BPM / 4; // one sixteenth
const LOOKAHEAD = 0.15;
// Two bars per chord: Dm, Bb, Gm, A (harmonic minor turnaround). MIDI notes.
const CHORDS = [
  [50, 53, 57],
  [46, 50, 53],
  [43, 46, 50],
  [45, 49, 52],
];
const BASS = [38, 34, 31, 33];
// Bass rhythm per 16th step (1 = note); calm uses only the quarter notes.
const BASS_PATTERN = [1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0];
const KICK = [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0];
const SNARE = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1];

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export class Music {
  readonly out: GainNode;
  private readonly pad: GainNode;
  private readonly bass: GainNode;
  private readonly drums: GainNode;
  private readonly arp: GainNode;
  private readonly noise: AudioBuffer;
  private step = 0;
  private next = 0;
  private timer: number | null = null;
  private padVoices: { stop: (t: number) => void }[] = [];
  /** 0 calm, 1 tension, 2 combat. */
  private intensity = 0;

  constructor(private readonly ctx: AudioContext) {
    this.out = ctx.createGain();
    const mk = (g: number) => {
      const n = ctx.createGain();
      n.gain.value = g;
      n.connect(this.out);
      return n;
    };
    this.pad = mk(0.06);
    this.bass = mk(0.1);
    this.drums = mk(0);
    // The arpeggio runs through a dark feedback delay.
    this.arp = ctx.createGain();
    this.arp.gain.value = 0;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 1800;
    this.arp.connect(this.out);
    this.arp.connect(delay);
    delay.connect(tone).connect(fb).connect(delay);
    tone.connect(this.out);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  start(): void {
    if (this.timer !== null) return;
    this.next = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    for (const v of this.padVoices) v.stop(this.ctx.currentTime + 0.5);
    this.padVoices = [];
  }

  setIntensity(level: number): void {
    if (level === this.intensity) return;
    this.intensity = level;
    const t = this.ctx.currentTime;
    this.drums.gain.setTargetAtTime(level === 0 ? 0 : level === 1 ? 0.12 : 0.2, t, 1.2);
    this.arp.gain.setTargetAtTime(level === 2 ? 0.05 : 0, t, 1.5);
    this.bass.gain.setTargetAtTime(level === 0 ? 0.09 : 0.13, t, 1);
  }

  private schedule(): void {
    while (this.next < this.ctx.currentTime + LOOKAHEAD) {
      this.play(this.step, this.next);
      this.next += STEP;
      this.step++;
    }
  }

  private play(step: number, t: number): void {
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    const chord = Math.floor(bar / 2) % CHORDS.length;
    if (step % 32 === 0) this.padChord(CHORDS[chord]!, t, STEP * 32);
    // Bass: quarters when calm, the full pattern otherwise.
    const bassHit = this.intensity === 0 ? s16 % 4 === 0 : BASS_PATTERN[s16] === 1;
    if (bassHit) this.bassNote(hz(BASS[chord]! + (s16 === 14 && this.intensity > 0 ? 12 : 0)), t, s16 % 4 === 0 ? 1 : 0.7);
    if (this.intensity > 0) {
      if (KICK[s16] || (this.intensity === 2 && s16 === 10)) this.kick(t);
      if (this.intensity === 2 && SNARE[s16]) this.snare(t);
      if (s16 % 2 === 0 || this.intensity === 2) this.hat(t, s16 % 4 === 2 ? 0.6 : 0.3);
    }
    if (this.intensity === 2) {
      const notes = CHORDS[chord]!;
      const up = [0, 1, 2, 1, 2, 3, 2, 1];
      const k = up[s16 % 8]!;
      this.arpNote(hz(notes[k % 3]! + 12 + (k === 3 ? 12 : 0)), t);
    }
  }

  private padChord(notes: number[], t: number, dur: number): void {
    for (const v of this.padVoices) v.stop(t + 1.5);
    this.padVoices = [];
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(500, t);
    f.frequency.linearRampToValueAtTime(1100, t + dur / 2);
    f.frequency.linearRampToValueAtTime(600, t + dur);
    f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 1.5);
    f.connect(g).connect(this.pad);
    const oscs: OscillatorNode[] = [];
    for (const n of notes)
      for (const detune of [-8, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(n);
        o.detune.value = detune;
        o.connect(f);
        o.start(t);
        oscs.push(o);
      }
    this.padVoices.push({
      stop: (at: number) => {
        g.gain.cancelScheduledValues(at - 1.5);
        g.gain.setTargetAtTime(0.0001, at - 1.5, 0.5);
        for (const o of oscs) o.stop(at + 0.5);
      },
    });
  }

  private bassNote(freq: number, t: number, accent: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(220 + 900 * accent, t);
    f.frequency.exponentialRampToValueAtTime(140, t + STEP * 1.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(accent, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + STEP * 1.9);
    o.connect(f).connect(g).connect(this.bass);
    o.start(t);
    o.stop(t + STEP * 2);
  }

  private kick(t: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(1.4, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.34);
  }

  private noiseHit(t: number, type: BiquadFilterType, freq: number, decay: number, gain: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(this.drums);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.02);
  }

  private snare(t: number): void {
    this.noiseHit(t, 'bandpass', 1800, 0.16, 1.1);
    this.noiseHit(t, 'lowpass', 400, 0.08, 0.6);
  }

  private hat(t: number, gain: number): void {
    this.noiseHit(t, 'highpass', 7500, 0.035, gain);
  }

  private arpNote(freq: number, t: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.8, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + STEP * 0.9);
    o.connect(f).connect(g).connect(this.arp);
    o.start(t);
    o.stop(t + STEP);
  }
}
