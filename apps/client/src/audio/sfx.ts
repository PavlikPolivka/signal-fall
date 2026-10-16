/**
 * Sound effects synthesized at startup with an OfflineAudioContext: every
 * sound is a small graph of oscillators / noise, filters and envelopes, so
 * nothing ships as an audio file (no licensing, no download).
 */

type Wave = OscillatorType | 'noise';

interface Layer {
  wave: Wave;
  /** Start / end frequency (Hz); for noise, the filter sweep. */
  f0: number;
  f1?: number;
  /** Filter for this layer. */
  filter?: { type: BiquadFilterType; f0: number; f1?: number; q?: number };
  gain: number;
  attack?: number;
  /** Time to decay to silence (exponential). */
  decay: number;
  /** Start offset in seconds. */
  at?: number;
}

const NOISE_SECONDS = 2;

export const SFX: Record<string, Layer[]> = {
  rifle: [
    { wave: 'noise', f0: 2600, filter: { type: 'bandpass', f0: 2600, f1: 1400, q: 0.9 }, gain: 0.9, decay: 0.09 },
    { wave: 'square', f0: 1300, f1: 600, gain: 0.12, decay: 0.02 },
  ],
  mg: [
    { wave: 'noise', f0: 1600, filter: { type: 'bandpass', f0: 1700, f1: 900, q: 0.8 }, gain: 0.9, decay: 0.07 },
    { wave: 'sine', f0: 190, f1: 90, gain: 0.5, decay: 0.06 },
  ],
  cannon: [
    { wave: 'noise', f0: 0, filter: { type: 'lowpass', f0: 1800, f1: 180, q: 0.7 }, gain: 1, decay: 0.42 },
    { wave: 'sine', f0: 120, f1: 42, gain: 0.9, decay: 0.32 },
  ],
  rocket: [
    { wave: 'noise', f0: 0, filter: { type: 'bandpass', f0: 700, f1: 2600, q: 1.1 }, gain: 1.6, attack: 0.03, decay: 0.45 },
    { wave: 'noise', f0: 0, filter: { type: 'lowpass', f0: 900, f1: 300 }, gain: 0.5, decay: 0.12 },
    { wave: 'sawtooth', f0: 320, f1: 180, filter: { type: 'lowpass', f0: 900 }, gain: 0.12, decay: 0.3 },
  ],
  artillery: [
    { wave: 'sine', f0: 80, f1: 28, gain: 1, decay: 0.7 },
    { wave: 'noise', f0: 0, filter: { type: 'lowpass', f0: 900, f1: 90, q: 0.6 }, gain: 0.9, decay: 0.8 },
  ],
  flak: [
    { wave: 'noise', f0: 0, filter: { type: 'highpass', f0: 900 }, gain: 0.7, decay: 0.05 },
    { wave: 'sine', f0: 420, f1: 180, gain: 0.35, decay: 0.07 },
  ],
  energy: [
    { wave: 'square', f0: 1400, f1: 380, filter: { type: 'lowpass', f0: 4000, f1: 1200 }, gain: 0.3, decay: 0.16 },
    { wave: 'sine', f0: 2600, f1: 900, gain: 0.25, decay: 0.12 },
  ],
  /** Credits from Recompile or salvage: two bright metallic ticks. */
  coin: [
    { wave: 'triangle', f0: 1760, gain: 0.22, decay: 0.12 },
    { wave: 'triangle', f0: 2640, gain: 0.18, decay: 0.18, at: 0.07 },
    { wave: 'noise', f0: 0, filter: { type: 'highpass', f0: 5000 }, gain: 0.06, decay: 0.03 },
  ],
  hit: [{ wave: 'noise', f0: 0, filter: { type: 'highpass', f0: 2800 }, gain: 0.35, decay: 0.035 }],
  boom: [
    { wave: 'noise', f0: 0, filter: { type: 'lowpass', f0: 2400, f1: 140, q: 0.6 }, gain: 1, decay: 0.75 },
    { wave: 'sine', f0: 95, f1: 30, gain: 0.9, decay: 0.55 },
  ],
  bigBoom: [
    { wave: 'noise', f0: 0, filter: { type: 'lowpass', f0: 1800, f1: 70, q: 0.5 }, gain: 1, decay: 1.8 },
    { wave: 'sine', f0: 62, f1: 24, gain: 1, decay: 1.3 },
    { wave: 'noise', f0: 0, filter: { type: 'lowpass', f0: 1200, f1: 90, q: 0.5 }, gain: 0.7, decay: 1.1, at: 0.18 },
    { wave: 'noise', f0: 0, filter: { type: 'bandpass', f0: 3000, f1: 800, q: 0.5 }, gain: 0.25, decay: 0.9, at: 0.05 },
  ],
  click: [
    { wave: 'sine', f0: 1900, gain: 0.25, decay: 0.035 },
    { wave: 'square', f0: 950, gain: 0.06, decay: 0.02 },
  ],
  ack: [
    { wave: 'square', f0: 700, filter: { type: 'bandpass', f0: 1400, q: 2 }, gain: 0.25, decay: 0.05 },
    { wave: 'square', f0: 1050, filter: { type: 'bandpass', f0: 1400, q: 2 }, gain: 0.25, decay: 0.06, at: 0.06 },
    { wave: 'noise', f0: 0, filter: { type: 'bandpass', f0: 2200, q: 1.5 }, gain: 0.08, decay: 0.14 },
  ],
  error: [
    { wave: 'square', f0: 170, filter: { type: 'lowpass', f0: 1400 }, gain: 0.3, decay: 0.09 },
    { wave: 'square', f0: 150, filter: { type: 'lowpass', f0: 1400 }, gain: 0.3, decay: 0.12, at: 0.11 },
  ],
  place: [
    { wave: 'sine', f0: 150, f1: 60, gain: 0.8, decay: 0.2 },
    { wave: 'noise', f0: 0, filter: { type: 'lowpass', f0: 500, f1: 120 }, gain: 0.6, decay: 0.22 },
    { wave: 'square', f0: 620, filter: { type: 'bandpass', f0: 1800, q: 3 }, gain: 0.15, decay: 0.06, at: 0.04 },
  ],
  complete: [
    { wave: 'triangle', f0: 659, gain: 0.35, attack: 0.01, decay: 0.22 },
    { wave: 'triangle', f0: 988, gain: 0.35, attack: 0.01, decay: 0.35, at: 0.13 },
  ],
  ready: [
    { wave: 'triangle', f0: 880, gain: 0.3, attack: 0.005, decay: 0.12 },
    { wave: 'triangle', f0: 1319, gain: 0.3, attack: 0.005, decay: 0.2, at: 0.08 },
  ],
  alarm: [
    { wave: 'square', f0: 880, filter: { type: 'lowpass', f0: 2600 }, gain: 0.2, decay: 0.13 },
    { wave: 'square', f0: 660, filter: { type: 'lowpass', f0: 2600 }, gain: 0.2, decay: 0.13, at: 0.16 },
    { wave: 'square', f0: 880, filter: { type: 'lowpass', f0: 2600 }, gain: 0.2, decay: 0.13, at: 0.32 },
    { wave: 'square', f0: 660, filter: { type: 'lowpass', f0: 2600 }, gain: 0.2, decay: 0.16, at: 0.48 },
  ],
  lowPower: [{ wave: 'sawtooth', f0: 440, f1: 90, filter: { type: 'lowpass', f0: 1800, f1: 300 }, gain: 0.3, decay: 0.7 }],
  cash: [
    { wave: 'sine', f0: 1568, gain: 0.25, decay: 0.12 },
    { wave: 'sine', f0: 2093, gain: 0.25, decay: 0.2, at: 0.06 },
  ],
};

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < d.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return buf;
}

async function render(layers: Layer[], rate: number): Promise<AudioBuffer> {
  const length = Math.max(...layers.map((l) => (l.at ?? 0) + (l.attack ?? 0) + l.decay)) + 0.05;
  const ctx = new OfflineAudioContext(1, Math.ceil(length * rate), rate);
  const noise = noiseBuffer(ctx);
  for (const l of layers) {
    const t0 = l.at ?? 0;
    const attack = l.attack ?? 0.002;
    const end = t0 + attack + l.decay;
    let src: AudioScheduledSourceNode;
    if (l.wave === 'noise') {
      const n = ctx.createBufferSource();
      n.buffer = noise;
      src = n;
    } else {
      const o = ctx.createOscillator();
      o.type = l.wave;
      o.frequency.setValueAtTime(l.f0, t0);
      if (l.f1) o.frequency.exponentialRampToValueAtTime(l.f1, end);
      src = o;
    }
    let node: AudioNode = src;
    if (l.filter) {
      const f = ctx.createBiquadFilter();
      f.type = l.filter.type;
      f.Q.value = l.filter.q ?? 0.7;
      f.frequency.setValueAtTime(l.filter.f0, t0);
      if (l.filter.f1) f.frequency.exponentialRampToValueAtTime(l.filter.f1, end);
      node.connect(f);
      node = f;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(l.gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    node.connect(g).connect(ctx.destination);
    src.start(t0);
    src.stop(end + 0.01);
  }
  const buf = await ctx.startRendering();
  // Keep peaks under full scale; relative loudness between sounds is part of their design.
  const d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]!));
  if (peak > 0.95) for (let i = 0; i < d.length; i++) d[i]! *= 0.95 / peak;
  return buf;
}

/** Render every sound effect; resolves to name -> buffer. */
export async function renderSfx(rate: number): Promise<Map<string, AudioBuffer>> {
  const out = new Map<string, AudioBuffer>();
  await Promise.all(Object.entries(SFX).map(async ([name, layers]) => out.set(name, await render(layers, rate))));
  return out;
}
