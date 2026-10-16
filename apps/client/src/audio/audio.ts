import { DAMAGE, type Rules } from '@signal-fall/data';
import { FX_EVENT, FX_STRIDE, KIND } from '@signal-fall/sim';
import type { ClientState } from '../game/state';
import { isoX, isoY } from '../game/iso';
import { Music } from './music';
import { renderSfx } from './sfx';
import { VoicePlayer, type VoiceLine } from './voice';
import { PLACEMENT_MESSAGES } from '@signal-fall/sim';

const FX = 1024;
const KEY = 'signalfall.audio';
const KINETIC = DAMAGE.indexOf('kinetic');
const EXPLOSIVE = DAMAGE.indexOf('explosive');
const ENERGY = DAMAGE.indexOf('energy');
const FLAK = DAMAGE.indexOf('flak');
const SIEGE = DAMAGE.indexOf('siege');

export interface AudioSettings {
  /** 0..1 each. */
  music: number;
  sfx: number;
  /** The announcer. */
  voice: number;
  /** Everything silent, volumes kept for unmuting. */
  muted: boolean;
}

/** Minimum ms between two plays of the same sound, and how many may overlap. */
const LIMITS: Record<string, [number, number]> = {
  rifle: [45, 5],
  mg: [50, 4],
  cannon: [70, 4],
  rocket: [70, 4],
  artillery: [120, 3],
  flak: [50, 4],
  energy: [50, 4],
  hit: [70, 3],
  coin: [90, 2],
  boom: [80, 4],
  bigBoom: [200, 2],
};

/** Alert texts the announcer speaks. */
const VOICE_FOR: Record<string, VoiceLine> = {
  'Construction complete': 'construction_complete',
  'Unit ready': 'unit_ready',
  'Base under attack': 'base_attack',
  'Harvester under attack': 'harvester_attack',
  'Unit under attack': 'units_attack',
  'Low power': 'low_power',
  'Not enough money': 'no_money',
  'Structure lost': 'structure_lost',
  'Unit lost': 'unit_lost',
  'Research complete': 'research_complete',
  'New construction options': 'new_options',
  'Echo field depleted': 'field_depleted',
};
const PLACEMENT_TEXTS = new Set<string>(Object.values(PLACEMENT_MESSAGES));

/** Where the listener is: screen-relative position of a sim point (-1..1 = on screen). */
export type Listener = (x: number, y: number) => { nx: number; ny: number };

/**
 * Game audio: synthesized effects placed by screen position, UI cues from
 * alerts and commands, and the generative score following the fighting.
 * Starts on the first user gesture (browsers require one).
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private music: Music | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private lastPlay = new Map<string, number>();
  private playing = new Map<string, number>();
  private alertsSeen = 0;
  private sentSeen = 0;
  /** Times (ms) of recent shots near the player, for music intensity. */
  private combat: number[] = [];
  settings: AudioSettings = { music: 0.5, sfx: 0.8, voice: 0.9, muted: false };
  private voiceGain: GainNode | null = null;
  private voice: VoicePlayer | null = null;
  private ducked = false;
  private ended = false;

  constructor(
    private readonly state: ClientState,
    private readonly rules: Rules,
    private readonly listener: Listener,
  ) {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<AudioSettings> | null;
      if (saved) this.settings = { ...this.settings, ...saved };
    } catch {
      // Storage unavailable: defaults.
    }
    this.alertsSeen = state.alertTotal;
    this.sentSeen = state.sentTotal;
  }

  get started(): boolean {
    return this.ctx !== null;
  }

  /** Create the audio graph; call from a user gesture. */
  async unlock(): Promise<void> {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.sfxGain = ctx.createGain();
    this.sfxGain.connect(comp);
    this.music = new Music(ctx);
    this.music.out.connect(comp);
    // The announcer skips the compressor so it stays crisp over a battle.
    this.voiceGain = ctx.createGain();
    this.voiceGain.connect(ctx.destination);
    this.apply();
    this.buffers = await renderSfx(ctx.sampleRate);
  }

  set(kind: 'music' | 'sfx' | 'voice', value: number): void {
    this.settings[kind] = Math.max(0, Math.min(1, value));
    this.settings.muted = false;
    this.save();
    this.apply();
  }

  /** Toggle silence; volumes are kept for when sound comes back. */
  toggleMute(): boolean {
    this.settings.muted = !this.settings.muted;
    this.save();
    this.apply();
    return this.settings.muted;
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.settings));
    } catch {
      // Not persisted; still applies for this session.
    }
  }

  private apply(): void {
    if (!this.ctx || !this.sfxGain || !this.music) return;
    const t = this.ctx.currentTime;
    const on = this.settings.muted ? 0 : 1;
    this.sfxGain.gain.setTargetAtTime(this.settings.sfx * on, t, 0.05);
    this.voiceGain?.gain.setTargetAtTime(this.settings.voice * on, t, 0.05);
    // Music steps back while the announcer speaks.
    this.music.out.gain.setTargetAtTime(this.settings.music * 0.9 * on * (this.ducked ? 0.35 : 1), t, this.ducked ? 0.08 : 0.4);
    if (this.settings.music > 0 && !this.settings.muted) this.music.start();
    else this.music.stop();
  }

  /** Sounds for the sim's cosmetic events. */
  ingest(events: Int32Array): void {
    if (!this.ctx) return;
    const now = performance.now();
    const s = this.state;
    for (let i = 0; i + FX_STRIDE <= events.length; i += FX_STRIDE) {
      const kind = events[i]!;
      const a = events[i + 1]!;
      const b = events[i + 2]!;
      const x = events[i + 4]!;
      const y = events[i + 5]!;
      if (s.fog && (s.fog[(y >> 10) * s.width + (x >> 10)]! & 1) === 0) continue;
      if (kind === FX_EVENT.fire) {
        const name = this.fireSound(a, b);
        if (name && this.play(name, x, y, 0.55)) this.combat.push(now);
      } else if (kind === FX_EVENT.impact) {
        if ((a === EXPLOSIVE || a === SIEGE) && b > 0) this.play('boom', x, y, 0.45);
        else if (a === KINETIC && Math.random() < 0.25) this.play('hit', x, y, 0.3);
      } else if (kind === FX_EVENT.ability) {
        this.play(a === 3 ? 'alarm' : a === 4 ? 'place' : 'energy', x, y, a === 3 ? 0.5 : 0.7);
      } else if (kind === FX_EVENT.power) {
        this.play('alarm', x, y, 0.8);
      } else if (kind === FX_EVENT.credits) {
        if (events[i + 3] === s.localPlayer && !s.spectator) this.play('coin', x, y, 0.6);
      } else if (kind === FX_EVENT.death) {
        if (a === KIND.structure) this.play('bigBoom', x, y, 1);
        else if (a === KIND.unit && this.rules.units[b]?.tab !== 'infantry') this.play('boom', x, y, 0.85);
      }
    }
  }

  private fireSound(kind: number, type: number): string | null {
    const unit = kind === KIND.unit ? this.rules.units[type] : null;
    const weapon = unit ? unit.weapon : kind === KIND.structure ? this.rules.structures[type]?.weapon : null;
    if (!weapon) return null;
    if (weapon.type === KINETIC) return unit?.tab === 'infantry' ? 'rifle' : 'mg';
    if (weapon.type === FLAK) return 'flak';
    if (weapon.type === ENERGY) return 'energy';
    if (weapon.type === SIEGE) return 'artillery';
    return unit?.tab === 'infantry' || unit?.isAir ? 'rocket' : 'cannon';
  }

  /** Lines the announcer has spoken. */
  get spoken(): readonly string[] {
    return this.voice?.history ?? [];
  }

  /** The announcer for our faction, created once the match (and our faction) is known. */
  private announcer(): VoicePlayer | null {
    if (this.voice || !this.ctx || !this.voiceGain || !this.state.ready) return this.voice;
    const faction = this.rules.factions[this.state.players[this.state.localPlayer]?.faction ?? 0]!.id;
    this.voice = new VoicePlayer(this.ctx, this.voiceGain, faction);
    this.voice.onSpeaking = (on) => {
      this.ducked = on;
      this.apply();
    };
    this.voice.preload();
    return this.voice;
  }

  /** Per-frame: UI cues, the announcer and music intensity. */
  update(): void {
    if (!this.ctx) return;
    const s = this.state;
    const voice = this.announcer();
    const say = (line: VoiceLine) => voice?.say(line);
    const newAlerts = s.alerts.slice(Math.max(0, s.alerts.length - (s.alertTotal - this.alertsSeen)));
    this.alertsSeen = s.alertTotal;
    for (const a of newAlerts) {
      const line = VOICE_FOR[a.text] ?? (PLACEMENT_TEXTS.has(a.text) ? 'cant_build' : null);
      if (a.kind === 'warn') this.play('error');
      else if (a.text === 'Construction complete') this.play('complete');
      else if (a.text === 'Unit ready') this.play('ready');
      else if (a.text === 'Low power') this.play('lowPower');
      else if (a.text.endsWith('under attack')) this.play('alarm', undefined, undefined, a.text.startsWith('Base') ? 0.9 : 0.55);
      if (line) say(line);
    }
    // Victory and defeat, once.
    const cur = s.cur;
    if (!this.ended && cur && cur.a[1] === 1 && !s.spectator) {
      this.ended = true;
      say(cur.a[2] === s.players[s.localPlayer]?.team ? 'victory' : 'defeat');
    }
    const newSent = s.sent.slice(Math.max(0, s.sent.length - (s.sentTotal - this.sentSeen)));
    this.sentSeen = s.sentTotal;
    for (const c of newSent) {
      if (c.type === 'place') this.play('place');
      else if (c.type === 'sell') this.play('cash');
      else if (c.type === 'move' || c.type === 'attackMove' || c.type === 'attack' || c.type === 'patrol' || c.type === 'guard') this.play('ack', undefined, undefined, 0.6);
      else if (c.type === 'build' || c.type === 'train') this.play('click');
    }
    const now = performance.now();
    this.combat = this.combat.filter((t) => now - t < 15000);
    const recent = this.combat.filter((t) => now - t < 6000).length;
    this.music?.setIntensity(recent >= 10 ? 2 : this.combat.length > 0 ? 1 : 0);
  }

  /** Play a sound; positioned and attenuated when a sim point is given. Returns whether it played. */
  play(name: string, x?: number, y?: number, gain = 1): boolean {
    const ctx = this.ctx;
    const buf = this.buffers.get(name);
    if (!ctx || !buf || !this.sfxGain || this.settings.sfx <= 0) return false;
    const now = performance.now();
    const [gap, max] = LIMITS[name] ?? [60, 3];
    if (now - (this.lastPlay.get(name) ?? 0) < gap || (this.playing.get(name) ?? 0) >= max) return false;
    let pan = 0;
    if (x !== undefined && y !== undefined) {
      const { nx, ny } = this.listener(x, y);
      const d = Math.max(Math.abs(nx), Math.abs(ny));
      // Full volume on screen, fading out over the next screen and a bit.
      const fall = d <= 1 ? 1 : Math.max(0, 1 - (d - 1) / 1.2);
      if (fall <= 0.02) return false;
      gain *= fall;
      pan = Math.max(-1, Math.min(1, nx)) * 0.6;
    }
    this.lastPlay.set(name, now);
    this.playing.set(name, (this.playing.get(name) ?? 0) + 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.93 + Math.random() * 0.14;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(g).connect(p).connect(this.sfxGain);
    src.onended = () => this.playing.set(name, (this.playing.get(name) ?? 1) - 1);
    src.start();
    return true;
  }
}

/** Screen-relative position helper for a renderer camera. */
export function cameraListener(cam: () => { x: number; y: number; zoom: number; w: number; h: number }): Listener {
  return (x, y) => {
    const c = cam();
    return {
      nx: ((isoX(x / FX, y / FX) - c.x) * c.zoom) / (c.w / 2),
      ny: ((isoY(x / FX, y / FX) - c.y) * c.zoom) / (c.h / 2),
    };
  };
}
