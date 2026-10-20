import { DAMAGE, type Rules } from '@signal-fall/data';
import { FX_EVENT, FX_STRIDE, KIND } from '@signal-fall/sim';
import type { ClientState } from '../game/state';
import { E, ENT_FLAG } from '../protocol';
import { isoX, isoY } from '../game/iso';
import { Music } from './music';
import { renderSfx } from './sfx';
import { LINE_TEXT, VoicePlayer, type AckKind, type VoiceLine } from './voice';
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
  /** Interface clicks and cues (part of the effects). */
  ui: number;
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
  'Superweapon launch detected': 'super_launch',
  'Enemy superweapon in 30 seconds': 'super_30',
  'Enemy superweapon ready': 'super_enemy_ready',
  'Capture point taken': 'point_taken',
  'Capture point lost': 'point_lost',
};
const PLACEMENT_TEXTS = new Set<string>(Object.values(PLACEMENT_MESSAGES));

/** Interface sounds (not battle sounds) that take the faction's pitch. */
const UI_CUES = new Set(['click', 'complete', 'ready', 'error', 'ack', 'place']);

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
  settings: AudioSettings = { music: 0.5, sfx: 0.8, voice: 0.9, ui: 1, muted: false };
  private voiceGain: GainNode | null = null;
  private voice: VoicePlayer | null = null;
  private ducked = false;
  private ended = false;
  /** The selection last frame, to reply when the player picks units. */
  private lastSelection = '';
  /** Base ambience: a power hum and factory work near the camera. */
  private hum: { gain: GainNode } | null = null;
  private lastAmbience = 0;
  private pingsSeen = 0;
  private chatSeen = 0;
  /** Own soldiers inside ruins at the last look (-1: not counted yet). */
  private garrisoned = -1;
  /** Interface cues pitched per faction: Holdout low and mechanical, Halcyon bright, Choir deep. */
  private uiRate = 1;

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

  /** Silence everything for good (the page hands over to another screen). */
  close(): void {
    this.music?.stop();
    void this.ctx?.close();
  }

  set(kind: 'music' | 'sfx' | 'voice' | 'ui', value: number): void {
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
        if (events[i + 3] === s.localPlayer && !s.spectator) {
          // A crate (reason 3) gets its own chime and a word from the announcer.
          if (b === 3) {
            this.play('crate', x, y, 0.8);
            this.announcer()?.say('crate');
          } else this.play('coin', x, y, 0.6);
        }
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
    this.music?.setTheme(faction);
    this.uiRate = faction === 'halcyon' ? 1.3 : faction === 'choir' ? 0.72 : 0.88;
    this.voice.onSpeaking = (on) => {
      this.ducked = on;
      this.apply();
    };
    this.voice.onLine = (line) => this.state.subtitle(LINE_TEXT[line]);
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
      else if (a.text === 'Superweapon launch detected') this.play('siren');
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
    const ack = (kind: AckKind) => {
      if (s.settings.unitVoices && !s.spectator && !s.replay && this.voiceGain) voice?.ack(kind, this.voiceGain);
    };
    for (const c of newSent) {
      if (c.type === 'place') this.play('place');
      else if (c.type === 'sell') this.play('cash');
      else if (c.type === 'move' || c.type === 'attackMove' || c.type === 'attack' || c.type === 'patrol' || c.type === 'guard') {
        this.play('ack', undefined, undefined, 0.6);
        ack(c.type === 'attack' ? 'attack' : 'move');
      } else if (c.type === 'build' || c.type === 'train') this.play('click');
    }
    // Picking units gets a reply too (not buildings).
    const selection = s.selection.join(',');
    if (selection !== this.lastSelection) {
      this.lastSelection = selection;
      if (s.selectedUnits().some((h) => s.ruleOf(h).kind === 'unit')) ack('select');
    }
    // Soldiers going into ruins or coming out reply, with a thud of the door.
    if (cur && !s.spectator) {
      let inside = 0;
      for (let i = 0; i < cur.entityCount; i++) {
        const o = cur.ent(i);
        if (cur.get(o, E.owner) === s.localPlayer && (cur.get(o, E.flags) & ENT_FLAG.garrisoned) !== 0) inside++;
      }
      if (this.garrisoned >= 0 && inside !== this.garrisoned) {
        this.play('place', undefined, undefined, 0.5);
        if (inside > this.garrisoned) ack('move');
      }
      this.garrisoned = inside;
    }
    // A ping or a chat line from someone else gets a short chirp.
    const pinged = s.mapPings.length > 0 ? s.mapPings[s.mapPings.length - 1]!.time : 0;
    if (pinged > this.pingsSeen) {
      this.pingsSeen = pinged;
      this.play('ready', undefined, undefined, 0.6);
    }
    const said = s.chat.length > 0 ? s.chat[s.chat.length - 1]!.time : 0;
    if (said > this.chatSeen) {
      this.chatSeen = said;
      if (s.chat[s.chat.length - 1]!.player !== s.localPlayer) this.play('click', undefined, undefined, 0.7);
    }
    const now = performance.now();
    if (now - this.lastAmbience > 500) {
      this.lastAmbience = now;
      this.ambience();
    }
    this.combat = this.combat.filter((t) => now - t < 15000);
    const recent = this.combat.filter((t) => now - t < 6000).length;
    this.music?.setIntensity(recent >= 10 ? 2 : this.combat.length > 0 ? 1 : 0);
  }

  /**
   * Quiet base ambience: power plants on screen hum (louder with more of them), and working
   * factories now and then clank. Twice a second is plenty.
   */
  private ambience(): void {
    const ctx = this.ctx;
    const cur = this.state.cur;
    if (!ctx || !cur || !this.sfxGain) return;
    if (!this.hum) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 260;
      for (const [freq, level] of [[55, 1], [110, 0.5], [165, 0.2]] as const) {
        const o = ctx.createOscillator();
        o.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.value = level;
        o.connect(g).connect(f);
        o.start();
      }
      // A slow wobble, like a generator under load.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.3;
      const depth = ctx.createGain();
      depth.gain.value = 40;
      lfo.connect(depth).connect(f.frequency);
      lfo.start();
      f.connect(gain).connect(this.sfxGain);
      this.hum = { gain };
    }
    let power = 0;
    for (let i = 0; i < cur.entityCount; i++) {
      const o = cur.ent(i);
      if (cur.get(o, E.kind) !== KIND.structure) continue;
      const x = cur.get(o, E.x);
      const y = cur.get(o, E.y);
      const { nx, ny } = this.listener(x, y);
      if (Math.abs(nx) > 1 || Math.abs(ny) > 1) continue;
      const rule = this.rules.structures[cur.get(o, E.type)]!;
      if (rule.power > 0) power++;
      // Own factories now and then clank.
      if (rule.produces && cur.get(o, E.owner) === this.state.localPlayer && Math.random() < 0.08) this.play('click', x, y, 0.18);
    }
    this.hum.gain.gain.setTargetAtTime(Math.min(1, power * 0.35) * 0.05, ctx.currentTime, 0.6);
  }

  /** A spoken mission line (a file under assets/voice), at announcer volume. */
  playLine(path: string): void {
    const ctx = this.ctx;
    if (!ctx || !this.voiceGain) return;
    void fetch(`${import.meta.env.BASE_URL}assets/voice/${path}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.voiceGain!);
        src.start();
      })
      .catch(() => undefined);
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
    const ui = x === undefined && UI_CUES.has(name);
    if (ui) gain *= this.settings.ui;
    src.playbackRate.value = (0.93 + Math.random() * 0.14) * (ui ? this.uiRate : 1);
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
