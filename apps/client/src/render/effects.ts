import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { DAMAGE, type Rules } from '@signal-fall/data';
import { FX_EVENT, FX_STRIDE, KIND } from '@signal-fall/sim';
import { isoX, isoY } from '../game/iso';

const FX = 1024;
const AIR_ALTITUDE = 26;
const KINETIC = DAMAGE.indexOf('kinetic');
const EXPLOSIVE = DAMAGE.indexOf('explosive');
const ENERGY = DAMAGE.indexOf('energy');
const FLAK = DAMAGE.indexOf('flak');
const SIEGE = DAMAGE.indexOf('siege');

/** Soft round blob: white center fading to transparent (tinted per use). */
function glowTexture(size: number, hard: number): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(hard, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return Texture.from(c);
}

/** Lumpy smoke puff: a few overlapping soft circles. */
function smokeTexture(size: number): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9; i++) {
    const x = size / 2 + (rnd() - 0.5) * size * 0.4;
    const y = size / 2 + (rnd() - 0.5) * size * 0.4;
    const r = size * (0.18 + rnd() * 0.16);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  return Texture.from(c);
}

/** Thin bright streak (sparks, tracers). */
function streakTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 4;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 32, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad;
  g.fillRect(0, 1, 32, 2);
  return Texture.from(c);
}

interface Particle {
  sprite: Sprite;
  x: number;
  y: number;
  /** Height above the ground in px (drawn upward). */
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  drag: number;
  age: number;
  life: number;
  scale0: number;
  scale1: number;
  alpha0: number;
  /** Seconds to wait before appearing (staggered building explosions). */
  delay: number;
  spin: number;
}

interface Beam {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: number;
  width: number;
  age: number;
  life: number;
  /** Jagged arc (chain lightning) instead of a straight beam; re-randomized every frame. */
  jagged: boolean;
}

/** Beam colors by faction index (Holdout tracers, Halcyon cyan, Choir violet). */
const FACTION_BEAM = [0xffd27a, 0x5cecff, 0xc58cff];

interface Scorch {
  sprite: Sprite;
  age: number;
}

/**
 * Combat effects driven by the sim's cosmetic event log: muzzle flashes,
 * impacts by damage type, explosions and lingering smoke, scorch marks.
 */
export class Effects {
  private readonly glow = glowTexture(64, 0.25);
  private readonly hot = glowTexture(64, 0.55);
  private readonly smoke = smokeTexture(64);
  private readonly streak = streakTexture();
  private readonly particles: Particle[] = [];
  private readonly free: Sprite[] = [];
  private readonly scorches: Scorch[] = [];
  private readonly beams: Beam[] = [];
  /** Beams, arcs and tracers, redrawn every frame (additive). */
  private readonly beamGfx = new Graphics();
  private last = performance.now();

  constructor(
    private readonly rules: Rules,
    /** Additive fire/flash layer above units. */
    private readonly layer: Container,
    /** Ground decals (scorch marks) below units. */
    private readonly ground: Container,
    /** Is a sim point (Q10) worth drawing: on screen and visible to the player. */
    private readonly visible: (x: number, y: number) => boolean,
  ) {
    this.beamGfx.blendMode = 'add';
    this.layer.addChild(this.beamGfx);
  }

  /** Number of live particles (perf overlay / tests). */
  get count(): number {
    return this.particles.length;
  }

  ingest(events: Int32Array): void {
    for (let i = 0; i + FX_STRIDE <= events.length; i += FX_STRIDE) {
      const kind = events[i]!;
      const a = events[i + 1]!;
      const b = events[i + 2]!;
      const x = events[i + 4]!;
      const y = events[i + 5]!;
      if (!this.visible(x, y)) continue;
      if (kind === FX_EVENT.fire) this.fire(a, b, x, y, events[i + 6]!, events[i + 7]!);
      else if (kind === FX_EVENT.impact) this.impact(a, b, x, y, events[i + 6]!, events[i + 7]!);
      else if (kind === FX_EVENT.death) this.death(a, b, x, y);
      else if (kind === FX_EVENT.ability) this.ability(a, x, y, events[i + 6]!, events[i + 7]!);
    }
  }

  private weaponOf(kind: number, type: number) {
    if (kind === KIND.unit) return this.rules.units[type]?.weapon ?? null;
    if (kind === KIND.structure) return this.rules.structures[type]?.weapon ?? null;
    return null;
  }

  private fire(kind: number, type: number, x: number, y: number, tx: number, ty: number): void {
    const weapon = this.weaponOf(kind, type);
    const unit = kind === KIND.unit ? this.rules.units[type] : null;
    const air = unit?.isAir ?? false;
    const infantry = unit?.tab === 'infantry';
    // Muzzle a little toward the target and up off the ground.
    const px = isoX(x / FX, y / FX);
    const py = isoY(x / FX, y / FX);
    const dx = isoX(tx / FX, ty / FX) - px;
    const dy = isoY(tx / FX, ty / FX) - py;
    const d = Math.hypot(dx, dy) || 1;
    const reach = infantry ? 7 : kind === KIND.structure ? 14 : 16;
    const mx = px + (dx / d) * reach;
    const my = py + (dy / d) * reach * 0.8;
    const z = (air ? AIR_ALTITUDE : 0) + (infantry ? 7 : 10);
    const big = weapon?.type === SIEGE || weapon?.type === EXPLOSIVE;
    const size = infantry ? 0.22 : big ? 0.55 : 0.36;
    const tint = weapon?.type === ENERGY ? 0x8fe8ff : 0xffd27a;
    this.spawn(this.hot, mx, my, z, { life: 0.07, scale0: size, scale1: size * 1.4, tint });
    // Instant weapons draw their shot: energy as a beam in the faction's color, bullets as a tracer.
    if (weapon && weapon.projectileSpeed === 0) {
      const faction = unit ? unit.faction : kind === KIND.structure ? (this.rules.structures[type]?.faction ?? 0) : 0;
      const tz = 8;
      const ex = isoX(tx / FX, ty / FX);
      const ey = isoY(tx / FX, ty / FX) - tz;
      const sweep = unit?.abilities.some((a) => a.kind === 'sweep') ?? false;
      if (weapon.type === ENERGY)
        this.beam(mx, my - z, ex, ey, FACTION_BEAM[faction] ?? 0x5cecff, sweep ? 7 : infantry ? 1.6 : 2.6, sweep ? 0.45 : 0.12);
      else if (weapon.type === KINETIC) {
        // A short tracer most of the way to the target.
        const t0 = 0.25 + Math.random() * 0.3;
        this.beam(mx + (ex - mx) * t0, my - z + (ey - my + z) * t0, ex, ey, 0xfff0b8, 1.2, 0.06);
      }
      if (sweep) for (let k = 1; k < 7; k++) this.spawn(this.glow, mx + ((ex - mx) * k) / 7, my - z + ((ey - my + z) * k) / 7, 0, { life: 0.5, scale0: 0.35, scale1: 0.6, tint: 0xc58cff, alpha: 0.7 });
    }
    if (big) {
      this.spawn(this.smoke, mx, my, z, { life: 1.1, scale0: 0.25, scale1: 0.7, tint: 0x9a9184, alpha: 0.45, vz: 14, add: false });
    }
  }

  private impact(type: number, splash: number, x: number, y: number, fx = 0, fy = 0): void {
    const px = isoX(x / FX, y / FX);
    const py = isoY(x / FX, y / FX);
    if (type === ENERGY && (fx !== 0 || fy !== 0)) {
      // Chain hit: an arc jumps from the previous victim.
      this.beam(isoX(fx / FX, fy / FX), isoY(fx / FX, fy / FX) - 8, px, py - 8, 0x7ff0ff, 2, 0.25, true);
    }
    if (type === FLAK) {
      // Dark flak bursts up in the air.
      for (let i = 0; i < 2; i++)
        this.spawn(this.smoke, px + rand(-6, 6), py + rand(-4, 4), AIR_ALTITUDE + rand(-4, 6), { life: 0.9, scale0: 0.2, scale1: 0.5, tint: 0x2c2a28, alpha: 0.75, add: false });
      this.spawn(this.hot, px, py, AIR_ALTITUDE, { life: 0.08, scale0: 0.3, scale1: 0.45, tint: 0xffc070 });
      return;
    }
    if (type === KINETIC) {
      this.spawn(this.smoke, px, py, 2, { life: 0.45, scale0: 0.12, scale1: 0.3, tint: 0xb0a088, alpha: 0.5, vz: 10, add: false });
      for (let i = 0; i < 2; i++) this.spark(px, py, 4, 0xffe2a0, 60);
      return;
    }
    if (type === ENERGY) {
      this.spawn(this.hot, px, py, 6, { life: 0.18, scale0: 0.4, scale1: 0.7, tint: 0x7fe3ff });
      return;
    }
    // Explosive / siege: a fireball sized by the splash radius.
    const r = Math.max(0.5, splash / FX);
    this.explosion(px, py, 0.5 + r * 0.35, type === SIEGE ? 1.2 : 1);
  }

  private death(kind: number, type: number, x: number, y: number): void {
    const px = isoX(x / FX, y / FX);
    const py = isoY(x / FX, y / FX);
    if (kind === KIND.structure) {
      const rule = this.rules.structures[type];
      const w = rule?.footprintW ?? 2;
      const h = rule?.footprintH ?? 2;
      // Several bursts across the footprint over about a second, then a smoke column.
      const n = 3 + w * h;
      for (let i = 0; i < n; i++) {
        const u = rand(-w / 2, w / 2);
        const v = rand(-h / 2, h / 2);
        this.explosion(px + isoX(u, v), py + isoY(u, v), rand(0.9, 1.5), 1, rand(0, 0.9));
      }
      for (let i = 0; i < 6; i++)
        this.spawn(this.smoke, px + rand(-20, 20), py + rand(-10, 10), 10, { life: rand(3, 5), scale0: 0.6, scale1: 2.2, tint: 0x3a3632, alpha: 0.55, vz: rand(14, 26), add: false, delay: rand(0.3, 1.2) });
      this.scorch(px, py, 1.4 + (w + h) * 0.35);
      return;
    }
    const unit = this.rules.units[type];
    if (!unit) return;
    if (unit.tab === 'infantry') {
      if (unit.faction === 2) {
        for (let i = 0; i < 5; i++) this.spark(px, py, 6, 0xc58cff, 70);
        this.spawn(this.glow, px, py, 6, { life: 0.4, scale0: 0.25, scale1: 0.6, tint: 0x9a6bff, alpha: 0.7 });
      } else this.spawn(this.smoke, px, py, 2, { life: 0.7, scale0: 0.15, scale1: 0.4, tint: 0x9a8a72, alpha: 0.5, vz: 6, add: false });
      return;
    }
    const air = unit.isAir;
    const z = air ? AIR_ALTITUDE : 0;
    if (unit.faction === 2) {
      // Choir machines shatter: a violet flash and crystal shards flung out, no fire.
      this.spawn(this.hot, px, py - z, 8, { life: 0.2, scale0: 0.8, scale1: 1.3, tint: 0xe9d4ff });
      this.spawn(this.glow, px, py - z, 6, { life: 0.7, scale0: 0.5, scale1: 1.6, tint: 0x9a6bff, alpha: 0.8 });
      for (let i = 0; i < 12; i++) this.spark(px, py - z, 10, i % 3 ? 0xc58cff : 0xffc46b, 140);
      return;
    }
    this.explosion(px, py - z, unit.tab === 'vehicles' ? 1.25 : 1.1, 1);
    if (unit.faction === 1) {
      // Halcyon drives short out: a cyan electrical burst inside the fireball.
      this.spawn(this.hot, px, py - z, 12, { life: 0.25, scale0: 0.9, scale1: 0.3, tint: 0x9ff4ff });
      for (let i = 0; i < 6; i++) this.spark(px, py - z, 12, 0x7ff0ff, 120);
    }
    if (!air) this.scorch(px, py, 1);
  }

  /** A shield takes a hit: a quick violet bubble flash around the unit. */
  shieldHit(px: number, py: number, scale: number): void {
    this.spawn(this.glow, px, py, 0, { life: 0.28, scale0: 0.5 * scale, scale1: 0.75 * scale, tint: 0xb48cff, alpha: 0.55 });
  }

  private beam(x0: number, y0: number, x1: number, y1: number, color: number, width: number, life: number, jagged = false): void {
    if (this.beams.length > 300) return;
    this.beams.push({ x0, y0, x1, y1, color, width, age: 0, life, jagged });
  }

  private drawBeams(dt: number): void {
    const g = this.beamGfx;
    g.clear();
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]!;
      b.age += dt;
      if (b.age >= b.life) {
        this.beams[i] = this.beams[this.beams.length - 1]!;
        this.beams.pop();
        continue;
      }
      const a = 1 - b.age / b.life;
      if (b.jagged) {
        const n = 6;
        const nx = -(b.y1 - b.y0);
        const ny = b.x1 - b.x0;
        const len = Math.hypot(nx, ny) || 1;
        g.moveTo(b.x0, b.y0);
        for (let k = 1; k < n; k++) {
          const off = (Math.random() - 0.5) * 10;
          g.lineTo(b.x0 + ((b.x1 - b.x0) * k) / n + (nx / len) * off, b.y0 + ((b.y1 - b.y0) * k) / n + (ny / len) * off);
        }
        g.lineTo(b.x1, b.y1).stroke({ width: b.width, color: b.color, alpha: a });
        continue;
      }
      // Glow halo, then a bright core.
      g.moveTo(b.x0, b.y0).lineTo(b.x1, b.y1).stroke({ width: b.width * 2.6, color: b.color, alpha: a * 0.25 });
      g.moveTo(b.x0, b.y0).lineTo(b.x1, b.y1).stroke({ width: b.width, color: 0xffffff, alpha: a * 0.9 });
    }
  }

  /** Blink: flashes at both ends; phase: a shimmer; Override: a signal beam to the victim. */
  private ability(kind: number, x: number, y: number, tx: number, ty: number): void {
    const px = isoX(x / FX, y / FX);
    const py = isoY(x / FX, y / FX);
    if (kind === 1) {
      const qx = isoX(tx / FX, ty / FX);
      const qy = isoY(tx / FX, ty / FX);
      for (const [ex, ey] of [
        [px, py],
        [qx, qy],
      ] as const) {
        this.spawn(this.hot, ex, ey, 8, { life: 0.25, scale0: 0.6, scale1: 0.2, tint: 0xd7b4ff });
        this.spawn(this.glow, ex, ey, 6, { life: 0.5, scale0: 0.3, scale1: 0.9, tint: 0x9a6bff });
      }
      for (let k = 1; k < 6; k++) this.spawn(this.glow, px + ((qx - px) * k) / 6, py + ((qy - py) * k) / 6, 8, { life: 0.3, scale0: 0.18, scale1: 0.05, tint: 0xc58cff });
    } else if (kind === 2) {
      this.spawn(this.glow, px, py, 10, { life: 0.8, scale0: 0.4, scale1: 1.4, tint: 0xc58cff, alpha: 0.7 });
    } else if (kind === 3) {
      const qx = isoX(tx / FX, ty / FX);
      const qy = isoY(tx / FX, ty / FX);
      for (let k = 0; k <= 10; k++)
        this.spawn(this.hot, px + ((qx - px) * k) / 10, py + ((qy - py) * k) / 10, 14, { life: 0.4 + k * 0.03, scale0: 0.2, scale1: 0.08, tint: 0x3ee6ff });
      this.spawn(this.glow, qx, qy, 12, { life: 0.9, scale0: 0.5, scale1: 1.2, tint: 0x3ee6ff });
    }
  }

  /** Fireball, hot core, smoke, sparks. `scale` 1 = vehicle-sized. */
  private explosion(px: number, py: number, scale: number, smokeMul: number, delay = 0): void {
    this.spawn(this.hot, px, py, 6 * scale, { life: 0.12, scale0: 0.6 * scale, scale1: 1.1 * scale, tint: 0xfff2c0, delay });
    for (let i = 0; i < 4; i++)
      this.spawn(this.glow, px + rand(-6, 6) * scale, py + rand(-3, 3) * scale, rand(4, 12) * scale, {
        life: rand(0.35, 0.6),
        scale0: 0.4 * scale,
        scale1: rand(0.9, 1.3) * scale,
        tint: i % 2 ? 0xff8a2a : 0xffb347,
        vz: rand(8, 24),
        delay: delay + rand(0, 0.08),
      });
    for (let i = 0; i < Math.round(3 * smokeMul); i++)
      this.spawn(this.smoke, px + rand(-8, 8) * scale, py + rand(-4, 4) * scale, rand(6, 14) * scale, {
        life: rand(1.4, 2.4),
        scale0: 0.35 * scale,
        scale1: rand(1.1, 1.6) * scale,
        tint: 0x4a4540,
        alpha: 0.6,
        vz: rand(10, 22),
        add: false,
        delay: delay + 0.1,
      });
    for (let i = 0; i < 6; i++) this.spark(px, py, 8 * scale, 0xffcf7a, 110 * scale, delay);
  }

  private spark(px: number, py: number, z: number, tint: number, speed: number, delay = 0): void {
    const a = Math.random() * Math.PI * 2;
    const p = this.spawn(this.streak, px, py, z, {
      life: rand(0.2, 0.45),
      scale0: 0.35,
      scale1: 0.15,
      tint,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed * 0.5,
      vz: rand(20, 80),
      gravity: 260,
      delay,
    });
    p.sprite.rotation = Math.atan2(p.vy - p.vz, p.vx);
  }

  private scorch(px: number, py: number, scale: number): void {
    const s = new Sprite(this.glow);
    s.anchor.set(0.5);
    s.tint = 0x0a0806;
    s.alpha = 0.55;
    s.position.set(px, py);
    s.scale.set(scale, scale * 0.5);
    this.ground.addChild(s);
    this.scorches.push({ sprite: s, age: 0 });
  }

  private spawn(
    tex: Texture,
    x: number,
    y: number,
    z: number,
    o: { life: number; scale0: number; scale1: number; tint: number; alpha?: number; vx?: number; vy?: number; vz?: number; gravity?: number; add?: boolean; delay?: number },
  ): Particle {
    const sprite = this.free.pop() ?? new Sprite();
    sprite.texture = tex;
    sprite.anchor.set(0.5);
    sprite.tint = o.tint;
    sprite.blendMode = o.add === false ? 'normal' : 'add';
    sprite.rotation = Math.random() * Math.PI * 2;
    sprite.visible = false;
    this.layer.addChild(sprite);
    const p: Particle = {
      sprite,
      x,
      y,
      z,
      vx: o.vx ?? 0,
      vy: o.vy ?? 0,
      vz: o.vz ?? 0,
      gravity: o.gravity ?? 0,
      drag: 0.6,
      age: 0,
      life: o.life,
      scale0: o.scale0,
      scale1: o.scale1,
      alpha0: o.alpha ?? 1,
      delay: o.delay ?? 0,
      spin: tex === this.smoke ? rand(-0.6, 0.6) : 0,
    };
    this.particles.push(p);
    return p;
  }

  update(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.drawBeams(dt);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      p.age += dt;
      if (p.age >= p.life) {
        p.sprite.visible = false;
        p.sprite.removeFromParent();
        this.free.push(p.sprite);
        this.particles[i] = this.particles[this.particles.length - 1]!;
        this.particles.pop();
        continue;
      }
      const t = p.age / p.life;
      p.vz -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z = Math.max(0, p.z + p.vz * dt);
      p.vx *= 1 - p.drag * dt;
      p.vy *= 1 - p.drag * dt;
      const s = p.sprite;
      s.visible = true;
      s.position.set(p.x, p.y - p.z);
      const scale = p.scale0 + (p.scale1 - p.scale0) * Math.sqrt(t);
      s.scale.set(scale);
      s.rotation += p.spin * dt;
      s.alpha = p.alpha0 * (t < 0.1 ? 1 : 1 - (t - 0.1) / 0.9);
    }
    for (let i = this.scorches.length - 1; i >= 0; i--) {
      const sc = this.scorches[i]!;
      sc.age += dt;
      if (sc.age > 40) {
        sc.sprite.destroy();
        this.scorches.splice(i, 1);
      } else if (sc.age > 30) sc.sprite.alpha = 0.55 * (1 - (sc.age - 30) / 10);
    }
  }
}

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
