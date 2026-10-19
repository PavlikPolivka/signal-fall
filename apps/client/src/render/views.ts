import { Container, Sprite, type Texture } from 'pixi.js';
import { isoY } from '../game/iso';
import { SpriteLibrary, type SpriteInfo } from './sprites';

const WRECK_TINT = 0x6e6862;
let nextTie = 0;

function sprite(layer: Container): Sprite {
  const s = new Sprite();
  s.anchor.set(0.5);
  layer.addChild(s);
  return s;
}

/** Sim velocity (Q10 per tick) to a binary angle (4096 per turn), or null when still. */
function velocityAngle(vx: number, vy: number): number | null {
  if (vx === 0 && vy === 0) return null;
  const a = Math.atan2(vy, vx);
  return Math.round(((a / (2 * Math.PI)) * 4096 + 4096) % 4096);
}

/** How a unit moves, for the motion drawn on top of its frames. */
type Motion = 'hover' | 'air' | 'wheels' | 'tracks' | 'walker';
const MOTION: Record<string, Motion> = {
  jackrabbit: 'wheels',
  mule: 'wheels',
  patch: 'wheels',
  homestead: 'wheels',
  flak_track: 'tracks',
  ironclad: 'walker',
  bulldog: 'tracks',
  thumper: 'tracks',
  ping: 'hover',
  fetch: 'hover',
  vector: 'hover',
  firewall: 'hover',
  broadcast: 'hover',
  root: 'hover',
  init: 'hover',
  glissando: 'hover',
  refrain: 'hover',
  basso: 'tracks',
  falsetto: 'hover',
  crescendo: 'hover',
  requiem: 'hover',
  overture: 'hover',
  hornet: 'air',
  seek: 'air',
  aria: 'air',
};

/**
 * A rendered unit made of: shadow (shadow layer), color sprite + team mask
 * (multiplied with the team color), and for turreted vehicles a separately
 * aimed turret. Hulls face their movement direction; turrets and infantry face
 * where they shoot.
 */
export class UnitSpriteView {
  readonly root = new Container();
  private readonly shadow: Sprite | null;
  private readonly body: Sprite;
  private readonly team: Sprite;
  private readonly turret: Sprite | null;
  private readonly turretTeam: Sprite | null;
  private hullAngle: number;
  private readonly tie = (nextTie++ % 997) / 1000;
  private animStart = performance.now();
  private lastAnim = '';
  private readonly motion: Motion | undefined;

  constructor(
    private readonly lib: SpriteLibrary,
    readonly id: string,
    readonly info: SpriteInfo,
    shadowLayer: Container,
    facing: number,
  ) {
    this.shadow = info.kind === 'air' ? null : sprite(shadowLayer);
    this.body = sprite(this.root);
    this.team = sprite(this.root);
    this.team.blendMode = 'multiply';
    this.turret = info.turret ? sprite(this.root) : null;
    this.turretTeam = info.turret ? sprite(this.root) : null;
    if (this.turretTeam) this.turretTeam.blendMode = 'multiply';
    this.hullAngle = facing;
    this.motion = MOTION[id];
  }

  /**
   * Height above the drawn position, in pixels: hover craft float and bob over their shadow, aircraft
   * sway, and wheels and tracks shake over rough ground while they drive.
   */
  private lift(moving: boolean, wreck: boolean): { y: number; x: number } {
    if (wreck || !this.motion) return { x: 0, y: 0 };
    const t = performance.now() / 1000 + this.tie * 13;
    switch (this.motion) {
      case 'hover':
        return { x: 0, y: 3 + 1.4 * Math.sin(t * 2.2) + (moving ? 0.5 * Math.sin(t * 9) : 0) };
      case 'air':
        return { x: 1.2 * Math.sin(t * 0.9), y: 2 * Math.sin(t * 1.7) };
      case 'wheels':
        return { x: 0, y: moving ? 0.6 * Math.sin(t * 23) + 0.4 * Math.sin(t * 37) : 0 };
      case 'tracks':
        return { x: 0, y: moving ? 0.45 * Math.sin(t * 31) : 0.15 * Math.sin(t * 40) };
      case 'walker':
        // A heavy stride: up on each step, a little roll from side to side.
        return moving ? { x: 0.8 * Math.sin(t * 4), y: 1.6 * Math.abs(Math.sin(t * 4)) } : { x: 0, y: 0 };
    }
  }

  /** Last animation and direction, for the death effect. */
  get pose(): { dir: number } {
    return { dir: SpriteLibrary.dirFor(this.hullAngle, this.info.dirs) };
  }

  update(o: { px: number; py: number; color: number; facing: number; vx: number; vy: number; firing: boolean; visible: boolean; wreck: boolean }): void {
    const info = this.info;
    const moving = velocityAngle(o.vx, o.vy);
    // Infantry face where they shoot when standing, where they walk when moving.
    if (info.kind === 'infantry') this.hullAngle = moving !== null && !o.firing ? moving : o.facing;
    else if (moving !== null) this.hullAngle = moving;
    else if (!info.turret) this.hullAngle = o.facing;

    let anim = 'idle';
    if (info.kind === 'air') anim = 'fly';
    else if (moving !== null && info.anims.walk) anim = 'walk';
    else if (o.firing && info.anims.fire) anim = 'fire';
    if (o.wreck) anim = info.kind === 'air' ? 'fly' : 'idle';
    if (anim !== this.lastAnim) {
      this.lastAnim = anim;
      this.animStart = performance.now();
    }
    const frames = info.anims[anim] ?? 1;
    const fps = anim === 'fly' ? 18 : anim === 'fire' ? 8 : 10;
    const frame = o.wreck ? 0 : Math.floor(((performance.now() - this.animStart) / 1000) * fps) % frames;
    const dir = SpriteLibrary.dirFor(this.hullAngle, info.dirs);
    const part = 'hull';
    const tex = (pass: 'color' | 'mask' | 'shadow', p = part, a = anim, d = dir, f = frame): Texture | null => this.lib.texture(this.id, p, a, d, f, pass);

    this.root.visible = o.visible;
    this.root.position.set(o.px, o.py);
    // Rounded depth plus a fixed per-view tie-break: units at nearly the same depth keep a stable
    // order instead of trading places every frame as they jostle (the flicker in crowds).
    this.root.zIndex = Math.round(o.py) + this.tie;
    const lift = this.lift(moving !== null, o.wreck);
    for (const sp of [this.body, this.team, this.turret, this.turretTeam]) sp?.position.set(lift.x, -lift.y);
    this.body.texture = tex('color') ?? this.body.texture;
    this.body.tint = o.wreck ? WRECK_TINT : 0xffffff;
    const mask = o.wreck ? null : tex('mask');
    this.team.visible = mask !== null;
    if (mask) {
      this.team.texture = mask;
      this.team.tint = o.color;
    }
    if (this.shadow) {
      const sh = tex('shadow');
      this.shadow.visible = o.visible && sh !== null && !o.wreck;
      if (sh) this.shadow.texture = sh;
      this.shadow.position.set(o.px, o.py);
    }
    if (this.turret && this.turretTeam) {
      // Parked and quiet: the turret looks around now and then (one direction left or right).
      const idle = !o.firing && !o.wreck && Math.abs(o.vx) + Math.abs(o.vy) < 0.01;
      const look = idle ? Math.round(Math.sin(performance.now() / 4000 + this.tie * 40) * 1.4) * (4096 / info.dirs) : 0;
      const tdir = SpriteLibrary.dirFor(o.facing + look, info.dirs);
      const tc = this.lib.texture(this.id, 'turret', 'idle', tdir, 0, 'color');
      const tm = this.lib.texture(this.id, 'turret', 'idle', tdir, 0, 'mask');
      this.turret.visible = tc !== null;
      if (tc) this.turret.texture = tc;
      this.turret.tint = o.wreck ? WRECK_TINT : 0xffffff;
      this.turretTeam.visible = tm !== null && !o.wreck;
      if (tm) {
        this.turretTeam.texture = tm;
        this.turretTeam.tint = o.color;
      }
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.shadow?.destroy();
  }
}

/**
 * A rendered building: shadow, body (built / damaged / construction state),
 * team mask, and for armed defenses an aimed turret. New buildings show the
 * construction state briefly as a build-up.
 */
export class StructureSpriteView {
  readonly root = new Container();
  private readonly shadow: Sprite;
  private readonly body: Sprite;
  private readonly team: Sprite;
  private readonly turret: Sprite | null;
  private readonly turretTeam: Sprite | null;
  private readonly born = performance.now();

  constructor(
    private readonly lib: SpriteLibrary,
    readonly id: string,
    readonly info: SpriteInfo,
    shadowLayer: Container,
    /** Already standing when first seen (map start or revealed from fog): skip the build-up. */
    preexisting: boolean,
  ) {
    this.shadow = sprite(shadowLayer);
    this.body = sprite(this.root);
    this.team = sprite(this.root);
    this.team.blendMode = 'multiply';
    this.turret = info.turret ? sprite(this.root) : null;
    this.turretTeam = info.turret ? sprite(this.root) : null;
    if (this.turretTeam) this.turretTeam.blendMode = 'multiply';
    if (preexisting) this.born = 0;
  }

  update(o: { px: number; py: number; depth: number; color: number; hp: number; facing: number; visible: boolean }): void {
    const age = performance.now() - this.born;
    const state = age < 900 ? 'construction' : o.hp < 0.5 ? 'damaged' : 'built';
    const tex = (pass: 'color' | 'mask' | 'shadow') => this.lib.texture(this.id, 'body', state, 0, 0, pass);
    this.root.visible = o.visible;
    this.root.position.set(o.px, o.py);
    this.root.zIndex = o.depth;
    this.body.texture = tex('color') ?? this.body.texture;
    const mask = tex('mask');
    this.team.visible = mask !== null;
    if (mask) {
      this.team.texture = mask;
      this.team.tint = o.color;
    }
    const sh = tex('shadow');
    this.shadow.visible = o.visible && sh !== null;
    if (sh) this.shadow.texture = sh;
    this.shadow.position.set(o.px, o.py);
    if (this.turret && this.turretTeam) {
      const showTurret = state !== 'construction';
      const d = SpriteLibrary.dirFor(o.facing, 16);
      const tc = this.lib.texture(this.id, 'turret', 'idle', d, 0, 'color');
      const tm = this.lib.texture(this.id, 'turret', 'idle', d, 0, 'mask');
      this.turret.visible = showTurret && tc !== null;
      if (tc) this.turret.texture = tc;
      this.turretTeam.visible = showTurret && tm !== null;
      if (tm) {
        this.turretTeam.texture = tm;
        this.turretTeam.tint = o.color;
      }
    }
  }

  /**
   * Destroyed: the building shakes, leans, darkens and crumbles down onto its footprint, then fades.
   * Returns false when done.
   */
  collapse(): boolean {
    const now = performance.now();
    if (!this.collapsing) {
      this.collapsing = now;
      const [w, h] = this.info.footprint ?? [2, 2];
      // Pivot on the footprint's front corner so it crumbles down onto the ground, not into the air.
      this.base = isoY(w / 2, h / 2);
      this.root.pivot.set(0, this.base);
      this.root.y += this.base;
      this.lean = Math.random() < 0.5 ? -1 : 1;
    }
    const t = (now - this.collapsing) / 1000;
    const k = Math.min(1, t / 2);
    const e = k * k;
    this.root.scale.y = 1 - 0.62 * e;
    this.root.skew.x = this.lean * 0.12 * e;
    this.root.pivot.x = k < 1 ? Math.sin(t * 70) * 2.5 * (1 - k) : 0;
    const c = Math.round(255 - 150 * k);
    for (const sp of [this.body, this.turret]) if (sp) sp.tint = (c << 16) | (c << 8) | c;
    this.team.alpha = 1 - k;
    if (this.turretTeam) this.turretTeam.alpha = 1 - k;
    this.shadow.alpha = 1 - k;
    this.root.alpha = t < 2 ? 1 : Math.max(0, 1 - (t - 2) / 1);
    if (t > 3) {
      this.destroy();
      return false;
    }
    return true;
  }

  private collapsing = 0;
  private base = 0;
  private lean = 1;

  destroy(): void {
    this.root.destroy({ children: true });
    this.shadow.destroy();
  }
}

/** Infantry death: plays the death frames where the unit fell, then fades out. */
export class DeathEffect {
  readonly sprite = new Sprite();
  private readonly start = performance.now();

  constructor(
    private readonly lib: SpriteLibrary,
    private readonly id: string,
    private readonly dir: number,
    layer: Container,
    px: number,
    py: number,
  ) {
    this.sprite.anchor.set(0.5);
    this.sprite.position.set(px, py);
    this.sprite.zIndex = py - 1;
    layer.addChild(this.sprite);
  }

  /** Returns false when finished. */
  update(): boolean {
    const t = (performance.now() - this.start) / 1000;
    const frame = Math.min(3, Math.floor(t * 8));
    const tex = this.lib.texture(this.id, 'hull', 'death', this.dir, frame, 'color');
    if (tex) this.sprite.texture = tex;
    this.sprite.alpha = t < 2 ? 1 : Math.max(0, 1 - (t - 2) / 1.5);
    if (t > 3.5) {
      this.sprite.destroy();
      return false;
    }
    return true;
  }
}
