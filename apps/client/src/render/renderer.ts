import { Application, Container, Graphics, Matrix, Sprite, Texture } from 'pixi.js';
import { KIND } from '@signal-fall/sim';
import { E, PR, WAYPOINTS } from '../protocol';
import { TEAM_COLORS, type ClientState } from '../game/state';
import { TILE_H, TILE_W, facingToRotation, isoX, isoY, tileU, tileV } from '../game/iso';

const FX = 1024;
const CHUNK = 16;
const AIR_ALTITUDE = 26;

// Placeholder terrain palettes per biome: ground, rough, rock, water, cliff, ruins.
export const BIOME_COLORS: Record<string, number[]> = {
  wasteland: [0x5e5238, 0x75653f, 0x6b625a, 0x2f5468, 0x56443a, 0x6b6157],
  city: [0x45484c, 0x5b5850, 0x686b70, 0x284360, 0x524c46, 0x7a6e60],
  crystal: [0x34463a, 0x485846, 0x535e68, 0x22505f, 0x4c3f66, 0x5a5a66],
};

interface UnitView {
  root: Container;
  body: Sprite;
  barrel: Sprite | null;
  shadow: Sprite | null;
}

interface StructureView {
  root: Graphics;
}

/** Shape class for placeholder art, by armor. */
type Shape = 'light' | 'medium' | 'heavy' | 'air';
const SHAPES: Shape[] = ['light', 'medium', 'heavy', 'air'];
/** Click radius in screen px per shape. */
const PICK_RADIUS: Record<Shape, number> = { light: 9, medium: 14, heavy: 18, air: 16 };

export class Renderer {
  readonly app = new Application();
  readonly world = new Container();
  private readonly terrainLayer = new Container();
  private readonly echoLayer = new Graphics();
  private readonly decals = new Graphics();
  private readonly ground = new Container();
  private readonly air = new Container();
  private readonly fx = new Graphics();
  private readonly fogLayer = new Container();
  private readonly overlay = new Graphics();
  /** Screen-space overlay (selection box). */
  readonly screen = new Graphics();

  camera = { x: 0, y: 0, zoom: 1 };
  private textures = new Map<string, Texture>();
  private units = new Map<number, UnitView>();
  private structures = new Map<number, StructureView>();
  /** Last rendered world-pixel position per entity handle (ground point). */
  readonly rendered = new Map<number, { x: number; y: number; air: boolean; shape: Shape | null }>();
  private fogCanvas: HTMLCanvasElement | null = null;
  private fogTexture: Texture | null = null;
  private fogVersion = -1;
  private echoVersion = -1;
  /** Supplies the placement ghost under the cursor while placing a structure. */
  placementGhost: () => { tx: number; ty: number; rule: { footprintW: number; footprintH: number }; error: string | null } | null = () => null;
  /** Click feedback markers in world px. */
  private pings: { x: number; y: number; color: number; at: number }[] = [];

  constructor(private readonly state: ClientState) {}

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: host, background: 0x0b0d10, antialias: true, preference: 'webgl' });
    host.appendChild(this.app.canvas);
    this.ground.sortableChildren = true;
    this.air.sortableChildren = true;
    this.world.addChild(this.terrainLayer, this.echoLayer, this.decals, this.ground, this.fx, this.air, this.fogLayer, this.overlay);
    this.app.stage.addChild(this.world, this.screen);
    this.makeTextures();
  }

  get width(): number {
    return this.app.screen.width;
  }

  get height(): number {
    return this.app.screen.height;
  }

  // --- coordinate conversion ---

  /** Screen px -> float tile coordinates. */
  screenToTile(sx: number, sy: number): { u: number; v: number } {
    const wx = (sx - this.width / 2) / this.camera.zoom + this.camera.x;
    const wy = (sy - this.height / 2) / this.camera.zoom + this.camera.y;
    return { u: tileU(wx, wy), v: tileV(wx, wy) };
  }

  /** World px -> screen px. */
  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.camera.x) * this.camera.zoom + this.width / 2,
      y: (wy - this.camera.y) * this.camera.zoom + this.height / 2,
    };
  }

  /** Screen position of an entity as last rendered (air units at altitude). */
  screenOf(h: number): { x: number; y: number } | null {
    const r = this.rendered.get(h);
    if (!r) return null;
    return this.worldToScreen(r.x, r.y - (r.air ? AIR_ALTITUDE : 0));
  }

  centerOnSim(x: number, y: number): void {
    this.camera.x = isoX(x / FX, y / FX);
    this.camera.y = isoY(x / FX, y / FX);
    this.clampCamera();
  }

  clampCamera(): void {
    const s = this.state;
    const minX = isoX(0, s.height);
    const maxX = isoX(s.width, 0);
    this.camera.x = Math.max(minX, Math.min(maxX, this.camera.x));
    this.camera.y = Math.max(0, Math.min(isoY(s.width, s.height), this.camera.y));
    this.camera.zoom = Math.max(0.4, Math.min(2, this.camera.zoom));
  }

  /** Topmost entity under a screen point, or -1. */
  pick(sx: number, sy: number): number {
    const s = this.state;
    let best = -1;
    let bestD = Infinity;
    for (const [h, r] of this.rendered) {
      if (!r.shape) continue;
      const p = this.worldToScreen(r.x, r.y - (r.air ? AIR_ALTITUDE : 0));
      const d = Math.hypot(p.x - sx, p.y - sy);
      const radius = PICK_RADIUS[r.shape] * this.camera.zoom;
      // Prefer air (drawn on top), then nearest.
      const score = d - (r.air ? 4 : 0);
      if (d <= radius && score < bestD) {
        best = h;
        bestD = score;
      }
    }
    if (best >= 0) return best;
    // Structures: point in footprint.
    const { u, v } = this.screenToTile(sx, sy);
    for (const h of this.structures.keys()) {
      if (!this.visibleEntity(h)) continue;
      const rule = s.ruleOf(h);
      if (rule.kind !== 'structure') continue;
      const cx = s.field(h, E.x) / FX;
      const cy = s.field(h, E.y) / FX;
      if (Math.abs(u - cx) <= rule.footprintW / 2 && Math.abs(v - cy) <= rule.footprintH / 2) return h;
    }
    return -1;
  }

  /** Is the entity visible to the local player (own, or in a visible fog tile)? */
  visibleEntity(h: number): boolean {
    const s = this.state;
    if (s.field(h, E.owner) === s.localPlayer) return true;
    if (!s.fog) return true;
    const tx = Math.floor(s.field(h, E.x) / FX);
    const ty = Math.floor(s.field(h, E.y) / FX);
    if (s.field(h, E.kind) !== KIND.structure) return (s.fog[ty * s.width + tx]! & 1) === 1;
    const rule = s.ruleOf(h);
    if (rule.kind !== 'structure') return false;
    // Structures stay drawn once explored (last-seen).
    const x0 = Math.floor(s.field(h, E.x) / FX - rule.footprintW / 2);
    const y0 = Math.floor(s.field(h, E.y) / FX - rule.footprintH / 2);
    for (let y = y0; y < y0 + rule.footprintH; y++)
      for (let x = x0; x < x0 + rule.footprintW; x++) if (s.fog[y * s.width + x]! & 2) return true;
    return false;
  }

  // --- static content ---

  private makeTextures(): void {
    const r = this.app.renderer;
    const tex = (name: string, g: Graphics) => {
      this.textures.set(name, r.generateTexture({ target: g, resolution: 2 }));
      g.destroy();
    };
    tex('light', new Graphics().circle(0, 0, 6).fill(0xffffff).stroke({ width: 1.5, color: 0x000000, alpha: 0.6 }));
    tex(
      'medium',
      new Graphics()
        .poly([-12, 0, 0, -7, 12, 0, 0, 7])
        .fill(0xffffff)
        .poly([-12, 0, 0, 7, 0, 11, -12, 4])
        .fill(0xb0b0b0)
        .poly([12, 0, 0, 7, 0, 11, 12, 4])
        .fill(0x909090)
        .stroke({ width: 1, color: 0x000000, alpha: 0.5 }),
    );
    tex(
      'heavy',
      new Graphics()
        .poly([-16, 0, 0, -9, 16, 0, 0, 9])
        .fill(0xffffff)
        .poly([-16, 0, 0, 9, 0, 15, -16, 6])
        .fill(0xb0b0b0)
        .poly([16, 0, 0, 9, 0, 15, 16, 6])
        .fill(0x909090)
        .rect(-5, -5, 10, 8)
        .fill(0xdddddd)
        .stroke({ width: 1, color: 0x000000, alpha: 0.5 }),
    );
    tex('air', new Graphics().poly([0, -10, 12, 8, 0, 3, -12, 8]).fill(0xffffff).stroke({ width: 1.5, color: 0x000000, alpha: 0.6 }));
    tex('shadow', new Graphics().ellipse(0, 0, 12, 5).fill({ color: 0x000000, alpha: 0.35 }));
    tex('barrel', new Graphics().rect(0, -1.5, 13, 3).fill(0xffffff));
  }

  /** Build terrain chunks and the fog overlay. Call once after the map arrives. */
  buildMap(): void {
    const s = this.state;
    this.terrainLayer.removeChildren();
    for (let cy = 0; cy < s.height; cy += CHUNK) {
      for (let cx = 0; cx < s.width; cx += CHUNK) {
        const g = new Graphics();
        for (let y = cy; y < Math.min(cy + CHUNK, s.height); y++) {
          for (let x = cx; x < Math.min(cx + CHUNK, s.width); x++) {
            const t = s.terrain[y * s.width + x]!;
            const shade = ((x * 7 + y * 13) % 5) * 0x030303;
            const color = (BIOME_COLORS[s.biome] ?? BIOME_COLORS.wasteland!)[t]! + shade;
            const px = isoX(x, y);
            const py = isoY(x, y);
            g.poly([px, py, px + TILE_W / 2, py + TILE_H / 2, px, py + TILE_H, px - TILE_W / 2, py + TILE_H / 2]).fill(color);
            if (t === 2 || t === 4 || t === 5) {
              // Raised block for impassable tiles.
              g.poly([px, py - 10, px + 26, py + 3, px, py + 16, px - 26, py + 3]).fill(color + 0x161616);
            }
            this.drawDecoration(g, s.decoration[y * s.width + x] ?? 0, px, py + TILE_H / 2, x * 31 + y * 17);
          }
        }
        g.cacheAsTexture(true);
        this.terrainLayer.addChild(g);
      }
    }
    // Fog: one pixel per tile, drawn through the iso matrix.
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = s.width;
    this.fogCanvas.height = s.height;
    this.fogTexture = Texture.from(this.fogCanvas);
    this.fogTexture.source.scaleMode = 'linear';
    const sprite = new Sprite(this.fogTexture);
    this.fogLayer.removeChildren();
    this.fogLayer.setFromMatrix(new Matrix(TILE_W / 2, TILE_H / 2, -TILE_W / 2, TILE_H / 2, 0, 0));
    this.fogLayer.addChild(sprite);
  }

  /** Cosmetic decoration (mapgen DECO ids) drawn into the static terrain. */
  private drawDecoration(g: Graphics, deco: number, px: number, py: number, salt: number): void {
    const ox = (salt % 17) - 8;
    const oy = (salt % 7) - 3;
    const x = px + ox;
    const y = py + oy;
    switch (deco) {
      case 1: // rubble
        g.poly([x - 6, y, x - 2, y - 4, x + 3, y - 3, x + 6, y + 1, x, y + 3]).fill(0x8a8178);
        g.poly([x + 4, y - 6, x + 8, y - 7, x + 9, y - 4, x + 5, y - 3]).fill(0x6f675f);
        break;
      case 2: // burnt-out wreck
        g.poly([x - 9, y, x, y - 5, x + 9, y, x, y + 5]).fill(0x2b2723);
        g.rect(x - 2, y - 7, 4, 4).fill(0x3a342e);
        break;
      case 3: // crystal outcrop
        g.poly([x - 4, y + 2, x - 1, y - 12, x + 2, y + 2]).fill(0x9a7bd8);
        g.poly([x + 1, y + 2, x + 4, y - 7, x + 6, y + 2]).fill(0xc9b0ff);
        break;
      case 4: // dead tree
        g.rect(x - 1, y - 12, 2, 12).fill(0x4a3a2a);
        g.rect(x - 5, y - 9, 5, 1.5).fill(0x4a3a2a);
        g.rect(x, y - 7, 5, 1.5).fill(0x4a3a2a);
        break;
    }
  }

  // --- per frame ---

  frame(): void {
    const s = this.state;
    const cur = s.cur;
    if (!cur) return;
    this.world.scale.set(this.camera.zoom);
    this.world.position.set(this.width / 2 - this.camera.x * this.camera.zoom, this.height / 2 - this.camera.y * this.camera.zoom);

    const alpha = Math.min(1, (performance.now() - s.curAt) / 50);
    const prev = s.prev;
    const seen = new Set<number>();
    const selected = new Set(s.selection);
    this.decals.clear();
    this.overlay.clear();
    this.fx.clear();

    for (let i = 0; i < cur.entityCount; i++) {
      const o = cur.ent(i);
      const h = cur.get(o, E.handle);
      seen.add(h);
      const kind = cur.get(o, E.kind);
      const owner = cur.get(o, E.owner);
      let x = cur.get(o, E.x);
      let y = cur.get(o, E.y);
      const po = prev?.index.get(h);
      if (po !== undefined && prev) {
        x = prev.get(po, E.x) + (x - prev.get(po, E.x)) * alpha;
        y = prev.get(po, E.y) + (y - prev.get(po, E.y)) * alpha;
      }
      const px = isoX(x / FX, y / FX);
      const py = isoY(x / FX, y / FX);
      const visible = this.visibleEntity(h);
      const color = TEAM_COLORS[owner % TEAM_COLORS.length]!;

      if (kind === KIND.wreck) {
        const rule = s.rules.units[cur.get(o, E.type)]!;
        this.updateUnit(h, SHAPES[rule.armor]!, false, px, py, 0x2a2a2a, cur.get(o, E.facing), visible);
        this.units.get(h)!.root.alpha = 0.8;
        if (visible) this.rendered.set(h, { x: px, y: py, air: false, shape: SHAPES[rule.armor]! });
        continue;
      }
      if (kind === KIND.structure) {
        this.updateStructure(h, cur.get(o, E.type), px, py, color, visible);
        this.rendered.set(h, { x: px, y: py, air: false, shape: null });
        if (visible && cur.get(o, E.repairing) === 1) {
          const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150);
          this.overlay.rect(px - 2, py - 70, 4, 12).fill({ color: 0x4ade80, alpha: pulse });
          this.overlay.rect(px - 6, py - 66, 12, 4).fill({ color: 0x4ade80, alpha: pulse });
        }
      } else {
        const rule = s.rules.units[cur.get(o, E.type)]!;
        const shape = SHAPES[rule.armor]!;
        this.updateUnit(h, shape, rule.weapon !== null, px, py, color, cur.get(o, E.facing), visible);
        if (visible) this.rendered.set(h, { x: px, y: py, air: rule.isAir, shape });
        else this.rendered.delete(h);
      }
      if (!visible) continue;

      const air = kind === KIND.unit && s.rules.units[cur.get(o, E.type)]!.isAir;
      const lift = air ? AIR_ALTITUDE : 0;
      const isSel = selected.has(h);
      if (isSel && kind === KIND.structure && cur.get(o, E.rallyX) >= 0 && owner === s.localPlayer) {
        const rx2 = cur.get(o, E.rallyX) / FX;
        const ry2 = cur.get(o, E.rallyY) / FX;
        const fx = isoX(rx2, ry2);
        const fy = isoY(rx2, ry2);
        this.overlay.moveTo(px, py).lineTo(fx, fy).stroke({ width: 1, color: 0xe8c35a, alpha: 0.7 });
        this.overlay.rect(fx - 1, fy - 16, 2, 16).fill(0xe8c35a).poly([fx + 1, fy - 16, fx + 10, fy - 13, fx + 1, fy - 10]).fill(0xe8c35a);
      }
      if (isSel) {
        const rx = kind === KIND.structure ? 40 : 14;
        this.decals.ellipse(px, py, rx, rx / 2).stroke({ width: 1.5, color: owner === s.localPlayer ? 0x6dff8a : 0xff6d6d });
        // Order line (and, with Shift held, the whole queued path with markers).
        const ox = cur.get(o, E.orderX);
        const order = cur.get(o, E.order);
        if (order > 0 && ox >= 0 && owner === s.localPlayer) {
          const oy = cur.get(o, E.orderY);
          const lineColor = order === 1 ? 0x6dff8a : order === 4 ? 0x6db8ff : 0xff9a6d;
          let lx = isoX(ox / FX, oy / FX);
          let ly = isoY(ox / FX, oy / FX);
          this.overlay.moveTo(px, py - lift).lineTo(lx, ly).stroke({ width: 1, color: lineColor, alpha: 0.5 });
          if (s.shiftHeld) {
            this.overlay.circle(lx, ly, 3).fill({ color: lineColor, alpha: 0.8 });
            for (let k = 0; k < WAYPOINTS; k++) {
              const wx = cur.get(o, E.wp + 2 * k);
              if (wx < 0) break;
              const wy = cur.get(o, E.wp + 2 * k + 1);
              const nx = isoX(wx / FX, wy / FX);
              const ny = isoY(wx / FX, wy / FX);
              this.overlay.moveTo(lx, ly).lineTo(nx, ny).stroke({ width: 1, color: 0xe8c35a, alpha: 0.7 });
              this.overlay.circle(nx, ny, 3).fill({ color: 0xe8c35a, alpha: 0.9 });
              lx = nx;
              ly = ny;
            }
          }
        }
        // Target line: what this unit is shooting at.
        const tgt = cur.get(o, E.target);
        const to = tgt >= 0 ? cur.index.get(tgt) : undefined;
        if (to !== undefined && owner === s.localPlayer) {
          const tx = cur.get(to, E.x) / FX;
          const ty = cur.get(to, E.y) / FX;
          this.overlay.moveTo(px, py - lift).lineTo(isoX(tx, ty), isoY(tx, ty)).stroke({ width: 1, color: 0xff4d4d, alpha: 0.55 });
        }
      }
      const hp = cur.get(o, E.hp);
      const maxHp = cur.get(o, E.maxHp);
      const sh = cur.get(o, E.shields);
      const maxSh = cur.get(o, E.maxShields);
      if (isSel || hp < maxHp || sh < maxSh) {
        const w = kind === KIND.structure ? 48 : 22;
        const top = py - lift - (kind === KIND.structure ? 56 : 20);
        const frac = Math.max(0, hp / maxHp);
        this.overlay.rect(px - w / 2, top, w, 3).fill(0x111111);
        this.overlay.rect(px - w / 2, top, w * frac, 3).fill(frac > 0.6 ? 0x4ade80 : frac > 0.3 ? 0xfacc15 : 0xef4444);
        if (maxSh > 0) {
          this.overlay.rect(px - w / 2, top - 3, w, 2).fill(0x111111);
          this.overlay.rect(px - w / 2, top - 3, (w * sh) / maxSh, 2).fill(0x60a5fa);
        }
        const cargo = cur.get(o, E.cargo);
        if (cargo > 0) this.overlay.rect(px - w / 2, top + 4, (w * Math.min(700, cargo)) / 700, 2).fill(0x3ee6ff);
        const rank = cur.get(o, E.rank);
        for (let r = 0; r < rank; r++) this.overlay.rect(px + w / 2 + 2, top + 1 - r * 4, 3, 3).fill(0xfacc15);
      }
    }

    // Remove views of entities that no longer exist.
    for (const [h, v] of this.units) {
      if (seen.has(h)) continue;
      v.root.destroy({ children: true });
      v.shadow?.destroy();
      this.units.delete(h);
      this.rendered.delete(h);
    }
    for (const [h, v] of this.structures) {
      if (seen.has(h)) continue;
      v.root.destroy();
      this.structures.delete(h);
      this.rendered.delete(h);
    }

    // Projectiles: tracer dots interpolated between origin and impact.
    for (let i = 0; i < cur.projectileCount; i++) {
      const p = cur.proj(i);
      const total = cur.get(p, PR.total);
      const left = cur.get(p, PR.ticks) - alpha;
      const t = total > 0 ? Math.max(0, Math.min(1, 1 - left / total)) : 1;
      const ox = cur.get(p, PR.ox);
      const oy = cur.get(p, PR.oy);
      const x = ox + (cur.get(p, PR.x) - ox) * t;
      const y = oy + (cur.get(p, PR.y) - oy) * t;
      this.fx.circle(isoX(x / FX, y / FX), isoY(x / FX, y / FX) - 6, 2).fill(0xffe9a8);
    }

    // Click feedback: shrinking iso ellipse at ordered points.
    const now = performance.now();
    this.pings = this.pings.filter((p) => now - p.at < 500);
    for (const p of this.pings) {
      const t = (now - p.at) / 500;
      const r = 16 * (1 - t) + 4;
      this.overlay.ellipse(p.x, p.y, r, r / 2).stroke({ width: 2, color: p.color, alpha: 1 - t });
    }

    this.updateEcho();
    this.drawGhost();
    this.updateFog();
  }

  private updateEcho(): void {
    const s = this.state;
    if (this.echoVersion === s.echoVersion) return;
    this.echoVersion = s.echoVersion;
    const g = this.echoLayer;
    g.clear();
    for (let i = 0; i < s.echo.length; i++) {
      const n = s.echo[i]!;
      if (n === 0) continue;
      const x = i % s.width;
      const y = Math.floor(i / s.width);
      const px = isoX(x + 0.5, y + 0.5);
      const py = isoY(x + 0.5, y + 0.5);
      g.poly([px, py - 15, px + 30, py, px, py + 15, px - 30, py]).fill({ color: 0x1a8a99, alpha: 0.55 });
      // Crystal clusters; more crystals = more and taller spikes.
      const spikes = 2 + Math.min(4, Math.floor(n / 3));
      for (let k = 0; k < spikes; k++) {
        const ox = ((x * 31 + y * 17 + k * 13) % 30) - 15;
        const oy = ((x * 7 + y * 29 + k * 11) % 12) - 6;
        const hgt = 10 + n * 1.5;
        g.poly([px + ox - 5, py + oy, px + ox, py + oy - hgt, px + ox + 5, py + oy]).fill(k % 2 ? 0x9cfbff : 0x3ee6ff);
        g.poly([px + ox, py + oy - hgt, px + ox + 5, py + oy, px + ox + 1, py + oy]).fill({ color: 0x0b4f5a, alpha: 0.6 });
      }
    }
  }

  private drawGhost(): void {
    const ghost = this.placementGhost();
    if (!ghost) return;
    const color = ghost.error ? 0xff5a5a : 0x6dff8a;
    for (let y = ghost.ty; y < ghost.ty + ghost.rule.footprintH; y++) {
      for (let x = ghost.tx; x < ghost.tx + ghost.rule.footprintW; x++) {
        const px = isoX(x, y);
        const py = isoY(x, y);
        this.overlay
          .poly([px, py, px + TILE_W / 2, py + TILE_H / 2, px, py + TILE_H, px - TILE_W / 2, py + TILE_H / 2])
          .fill({ color, alpha: 0.35 })
          .stroke({ width: 1, color, alpha: 0.8 });
      }
    }
  }

  /** Show click feedback at a screen point. */
  ping(sx: number, sy: number, color: number): void {
    const wx = (sx - this.width / 2) / this.camera.zoom + this.camera.x;
    const wy = (sy - this.height / 2) / this.camera.zoom + this.camera.y;
    this.pings.push({ x: wx, y: wy, color, at: performance.now() });
  }

  private updateUnit(h: number, shape: Shape, armed: boolean, px: number, py: number, color: number, facing: number, visible: boolean): void {
    let v = this.units.get(h);
    if (!v) {
      const root = new Container();
      const air = shape === 'air';
      const shadow = air ? new Sprite(this.textures.get('shadow')!) : null;
      if (shadow) shadow.anchor.set(0.5);
      const body = new Sprite(this.textures.get(shape)!);
      body.anchor.set(0.5);
      const barrel = armed && shape !== 'light' ? new Sprite(this.textures.get('barrel')!) : null;
      if (barrel) {
        barrel.anchor.set(0, 0.5);
        barrel.tint = 0x333333;
      }
      root.addChild(body);
      if (barrel) root.addChild(barrel);
      if (air) {
        body.y = -AIR_ALTITUDE;
        if (barrel) barrel.y = -AIR_ALTITUDE;
        this.ground.addChild(shadow!);
        this.air.addChild(root);
      } else this.ground.addChild(root);
      v = { root, body, barrel, shadow };
      this.units.set(h, v);
    }
    v.root.visible = visible;
    v.root.position.set(px, py);
    v.root.zIndex = py;
    v.body.tint = color;
    if (v.barrel) v.barrel.rotation = facingToRotation(facing);
    if (v.shadow) {
      v.shadow.visible = visible;
      v.shadow.position.set(px, py);
      v.shadow.zIndex = py - 1;
    }
  }

  private updateStructure(h: number, type: number, px: number, py: number, color: number, visible: boolean): void {
    let v = this.structures.get(h);
    if (!v) {
      const rule = this.state.rules.structures[type]!;
      const g = new Graphics();
      const w = rule.footprintW;
      const d = rule.footprintH;
      const height = rule.role === 'wall' ? 10 : rule.weapon ? 18 : 14 + 6 * Math.min(w, d);
      // Footprint corners relative to the center, in world px.
      const c = (u: number, v2: number) => [isoX(u, v2), isoY(u, v2)] as const;
      const [nX, nY] = c(-w / 2, -d / 2);
      const [eX, eY] = c(w / 2, -d / 2);
      const [sX, sY] = c(w / 2, d / 2);
      const [wX, wY] = c(-w / 2, d / 2);
      g.poly([wX, wY, sX, sY, sX, sY - height, wX, wY - height]).fill(0xa8a8a8);
      g.poly([sX, sY, eX, eY, eX, eY - height, sX, sY - height]).fill(0x8a8a8a);
      g.poly([nX, nY - height, eX, eY - height, sX, sY - height, wX, wY - height]).fill(0xffffff).stroke({ width: 1, color: 0x000000, alpha: 0.4 });
      if (rule.weapon) g.circle(0, -height - 4, 5).fill(0xdddddd);
      v = { root: g };
      this.structures.set(h, v);
      this.ground.addChild(g);
      // Depth: the front corner of the footprint.
      g.zIndex = py + isoY(w / 2, d / 2);
    }
    v.root.visible = visible;
    v.root.position.set(px, py);
    v.root.tint = color;
  }

  private updateFog(): void {
    const s = this.state;
    if (!s.fog || !this.fogCanvas || !this.fogTexture || this.fogVersion === s.fogVersion) return;
    this.fogVersion = s.fogVersion;
    const ctx = this.fogCanvas.getContext('2d')!;
    const img = ctx.createImageData(s.width, s.height);
    const d = img.data;
    for (let i = 0; i < s.fog.length; i++) {
      const f = s.fog[i]!;
      d[i * 4 + 3] = f & 1 ? 0 : f & 2 ? 130 : 255;
    }
    ctx.putImageData(img, 0, 0);
    this.fogTexture.source.update();
  }

  /** Draw the drag-select rectangle in screen space. */
  drawBox(box: { x0: number; y0: number; x1: number; y1: number } | null): void {
    this.screen.clear();
    if (!box) return;
    const x = Math.min(box.x0, box.x1);
    const y = Math.min(box.y0, box.y1);
    this.screen
      .rect(x, y, Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0))
      .fill({ color: 0x6dff8a, alpha: 0.08 })
      .stroke({ width: 1, color: 0x6dff8a, alpha: 0.8 });
  }
}
