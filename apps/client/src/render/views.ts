import { Container, Sprite, type Texture } from 'pixi.js';
import { SpriteLibrary, type SpriteInfo } from './sprites';

const WRECK_TINT = 0x4a4744;
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
      const tdir = SpriteLibrary.dirFor(o.facing, info.dirs);
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
