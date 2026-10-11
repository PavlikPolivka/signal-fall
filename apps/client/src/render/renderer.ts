import { Application, Container, Graphics, Matrix, Sprite, Texture } from 'pixi.js';
import { KIND, TERRAIN } from '@signal-fall/sim';
import { E, ENT_FLAG, PR, WAYPOINTS } from '../protocol';
import { TEAM_COLORS, type ClientState } from '../game/state';
import { TILE_H, TILE_W, facingToRotation, isoX, isoY, tileU, tileV } from '../game/iso';
import { SpriteLibrary } from './sprites';
import { CLIFF_H, TerrainLayer } from './terrain';
import { DeathEffect, StructureSpriteView, UnitSpriteView } from './views';
import { Effects } from './effects';

const FX = 1024;
const CHUNK = 16;
// Damage types (data DAMAGE order), for projectile looks.
const PROJ_KINETIC = 0;
const PROJ_ENERGY = 2;
const PROJ_FLAK = 3;
const PROJ_SIEGE = 4;
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
  /** All sprite shadows, under every unit and building. */
  private readonly shadows = new Container();
  private readonly ground = new Container();
  private readonly air = new Container();
  private readonly fx = new Graphics();
  /** Particle effects (flashes, fire, smoke) and scorch marks. */
  private readonly particles = new Container();
  private readonly scorchLayer = new Container();
  readonly effects: Effects;
  private readonly fogLayer = new Container();
  private readonly overlay = new Graphics();
  /** Screen-space overlay (selection box). */
  readonly screen = new Graphics();

  camera = { x: 0, y: 0, zoom: 1 };
  private textures = new Map<string, Texture>();
  private units = new Map<number, UnitView>();
  private structures = new Map<number, StructureView>();
  /** Rendered art (Blender sprites); factions without art use the placeholder views above. */
  readonly lib = new SpriteLibrary();
  private readonly terrain = new TerrainLayer();
  private spriteUnits = new Map<number, UnitSpriteView>();
  private spriteStructures = new Map<number, StructureSpriteView>();
  private deaths: DeathEffect[] = [];
  /** Last rendered world-pixel position per entity handle (ground point). */
  readonly rendered = new Map<number, { x: number; y: number; air: boolean; shape: Shape | null }>();
  private fogCanvas: HTMLCanvasElement | null = null;
  private fogTexture: Texture | null = null;
  private fogVersion = -1;
  private echoVersion = -1;
  private propsReady = false;
  private echoSprites = new Map<number, Sprite>();
  /** Supplies the placement ghost under the cursor while placing a structure. */
  placementGhost: () => { tx: number; ty: number; rule: { footprintW: number; footprintH: number }; error: string | null } | null = () => null;
  /** Click feedback markers in world px. */
  private pings: { x: number; y: number; color: number; at: number }[] = [];

  constructor(private readonly state: ClientState) {
    this.effects = new Effects(state.rules, this.particles, this.scorchLayer, (x, y) => this.worthDrawing(x, y));
  }

  /** A sim point (Q10) on or near the screen and visible to the local player. */
  private worthDrawing(x: number, y: number): boolean {
    const s = this.state;
    const tx = x >> 10;
    const ty = y >> 10;
    if (s.fog && (s.fog[ty * s.width + tx]! & 1) === 0) return false;
    const px = (isoX(x / FX, y / FX) - this.camera.x) * this.camera.zoom;
    const py = (isoY(x / FX, y / FX) - this.camera.y) * this.camera.zoom;
    return Math.abs(px) < this.width * 0.7 && Math.abs(py) < this.height * 0.7;
  }

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: host, background: 0x0b0d10, antialias: true, preference: 'webgl' });
    host.appendChild(this.app.canvas);
    this.ground.sortableChildren = true;
    this.air.sortableChildren = true;
    this.world.addChild(this.terrainLayer, this.scorchLayer, this.echoLayer, this.decals, this.shadows, this.ground, this.fx, this.air, this.particles, this.fogLayer, this.overlay);
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
    // Textured terrain (shader); the flat-colour tiles below stay as the instant fallback until it loads.
    this.drawFlatTerrain();
    void this.terrain
      .build(this.terrainLayer, s.biome, s.width, s.height, s.terrain, s.surface)
      .then(() => this.drawProps())
      .catch((err) => console.warn('terrain shader unavailable, using flat tiles', err));
    this.buildFog();
  }

  /** Obstacle formations and decorations as rendered prop sprites, depth-sorted with units. */
  private async drawProps(): Promise<void> {
    const s = this.state;
    await this.lib.loadFaction('props');
    if (!this.lib.info('rock_wasteland_0')) return;
    const ground = this.terrain.groundDecor;
    const top = this.terrain.topDecor;
    ground.removeChildren();
    top.removeChildren();
    const hash = (x: number, y: number, k: number) => {
      let h = Math.imul(x + 1, 374761393) + Math.imul(y + 1, 668265263) + Math.imul(k, 982451653);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < s.width && y < s.height ? s.terrain[y * s.width + x]! : -1);
    const mesa = (x: number, y: number) => TerrainLayer.isMesa(at(x, y));
    const obstacle = (t: number): string | null => {
      if (t === TERRAIN.ruins) return 'rock_city';
      if (t === TERRAIN.rock) return s.biome === 'crystal' ? 'rock_crystal' : 'rock_wasteland';
      return null;
    };
    const place = (id: string, layer: Container, px: number, py: number, scale: number, flip: number, shadow: boolean) => {
      const tex = this.lib.texture(id, 'body', 'idle', 0, 0, 'color');
      if (!tex) return;
      const sh = shadow ? this.lib.texture(id, 'body', 'idle', 0, 0, 'shadow') : null;
      if (sh) {
        const sp = new Sprite(sh);
        sp.anchor.set(0.5);
        sp.position.set(px, py);
        sp.scale.set(scale * flip, scale);
        (layer === this.ground ? this.shadows : layer).addChild(sp);
      }
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      sp.position.set(px, py);
      sp.scale.set(scale * flip, scale);
      sp.zIndex = py;
      layer.addChild(sp);
    };
    this.drawLandmarks(place);
    const DECO_IDS = ['', 'deco_rubble', 'deco_wreck', 'deco_outcrop', 'deco_tree', 'deco_crater'];
    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        const i = y * s.width + x;
        if (s.landmark[i]) continue;
        const cx = isoX(x + 0.5, y + 0.5);
        const cy = isoY(x + 0.5, y + 0.5);
        if (mesa(x, y)) {
          // Mesa tops: crystal spires or the odd boulder; scree at the foot of exposed faces.
          const r = hash(x, y, 7);
          if (s.biome === 'crystal' ? r < 0.3 : r < 0.1) {
            const id = s.biome === 'crystal' ? `deco_outcrop_${Math.floor(hash(x, y, 2) * 3)}` : `rock_wasteland_${Math.floor(hash(x, y, 2) * 6)}`;
            place(id, top, cx, cy - CLIFF_H, s.biome === 'crystal' ? 1.3 : 0.55, hash(x, y, 6) < 0.5 ? -1 : 1, false);
          }
          continue;
        }
        if ((mesa(x - 1, y) || mesa(x, y - 1)) && hash(x, y, 8) < 0.3) {
          place(`deco_rubble_${Math.floor(hash(x, y, 9) * 3)}`, this.ground, cx - 6 + hash(x, y, 10) * 12, cy - 4, 0.9, 1, false);
        }
        const ob = obstacle(s.terrain[i]!);
        const deco = DECO_IDS[s.decoration[i] ?? 0] ?? '';
        const id = ob ? `${ob}_${Math.floor(hash(x, y, 1) * 6)}` : deco ? `${deco}_${Math.floor(hash(x, y, 2) * 3)}` : null;
        if (!id) continue;
        if (deco === 'deco_crater') {
          place(id, ground, cx, cy, 0.9 + hash(x, y, 5) * 0.5, 1, false);
          continue;
        }
        // Jitter inside the tile, random size and mirroring so formations don't repeat.
        const jx = (hash(x, y, 3) - 0.5) * (ob ? 0.3 : 0.6);
        const jy = (hash(x, y, 4) - 0.5) * (ob ? 0.3 : 0.6);
        const px = isoX(x + 0.5 + jx, y + 0.5 + jy);
        const py = isoY(x + 0.5 + jx, y + 0.5 + jy);
        const scale = ob ? 1.05 + hash(x, y, 5) * 0.35 : 0.85 + hash(x, y, 5) * 0.3;
        const flip = hash(x, y, 6) < 0.5 ? -1 : 1;
        place(id, this.ground, px, py, scale, flip, true);
      }
    }
    this.propsReady = true;
    this.echoVersion = -1;
  }

  /** One big sprite per landmark, at the center of its footprint. */
  private drawLandmarks(place: (id: string, layer: Container, px: number, py: number, scale: number, flip: number, shadow: boolean) => void): void {
    const s = this.state;
    const NAMES = ['', 'lm_tower', 'lm_building', 'lm_crashed', 'lm_monolith'];
    const seen = new Uint8Array(s.width * s.height);
    for (let i = 0; i < s.width * s.height; i++) {
      const kind = s.landmark[i] ?? 0;
      if (!kind || seen[i]) continue;
      // Flood the footprint to find its bounds.
      let x0 = s.width;
      let y0 = s.height;
      let x1 = 0;
      let y1 = 0;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop()!;
        const x = j % s.width;
        const y = Math.floor(j / s.width);
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
        for (const k of [j - 1, j + 1, j - s.width, j + s.width]) {
          if (k < 0 || k >= s.width * s.height || seen[k] || s.landmark[k] !== kind) continue;
          if (Math.abs((k % s.width) - x) > 1) continue;
          seen[k] = 1;
          stack.push(k);
        }
      }
      const u = (x0 + x1 + 1) / 2;
      const v = (y0 + y1 + 1) / 2;
      // Mirrored copies on mirror-symmetric maps look less like clones.
      place(NAMES[kind]!, this.ground, isoX(u, v), isoY(u, v), 1.35, (x0 + y0) % 2 ? -1 : 1, true);
    }
  }

  private drawFlatTerrain(): void {
    const s = this.state;
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
  }

  private buildFog(): void {
    const s = this.state;
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
        if (!this.updateUnitSprite(h, rule.id, px, py, 0, cur.get(o, E.facing), 0, 0, false, visible, true)) {
          this.updateUnit(h, SHAPES[rule.armor]!, false, px, py, 0x2a2a2a, cur.get(o, E.facing), visible);
          this.units.get(h)!.root.alpha = 0.8;
        }
        if (visible) this.rendered.set(h, { x: px, y: py, air: false, shape: SHAPES[rule.armor]! });
        continue;
      }
      if (kind === KIND.structure) {
        const srule = s.rules.structures[cur.get(o, E.type)]!;
        const hpFrac = cur.get(o, E.hp) / Math.max(1, cur.get(o, E.maxHp));
        if (!this.updateStructureSprite(h, srule.id, px, py, py + isoY(srule.footprintW / 2, srule.footprintH / 2), color, hpFrac, cur.get(o, E.facing), visible, cur.tick))
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
        const firing = cur.get(o, E.target) >= 0;
        if (!this.updateUnitSprite(h, rule.id, px, py, color, cur.get(o, E.facing), cur.get(o, E.vx), cur.get(o, E.vy), firing, visible, false))
          this.updateUnit(h, shape, rule.weapon !== null, px, py, color, cur.get(o, E.facing), visible);
        if (visible) this.rendered.set(h, { x: px, y: py, air: rule.isAir, shape });
        else this.rendered.delete(h);
        // Phased-out units shimmer, half there.
        const flags = cur.get(o, E.flags);
        const view = this.spriteUnits.get(h)?.root ?? this.units.get(h)?.root;
        if (view) view.alpha = flags & ENT_FLAG.phased ? 0.3 + 0.15 * Math.sin(performance.now() / 70) : 1;
        if (visible && flags & ENT_FLAG.overridden) {
          // Overridden: a cyan signal ring above the unit.
          const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 120);
          const top = py - (rule.isAir ? AIR_ALTITUDE : 0) - 26;
          this.overlay.circle(px, top, 5).stroke({ width: 2, color: 0x3ee6ff, alpha: pulse });
          this.overlay.circle(px, top, 9).stroke({ width: 1, color: 0x3ee6ff, alpha: pulse * 0.5 });
        }
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
    for (const [h, v] of this.spriteUnits) {
      if (seen.has(h)) continue;
      // Infantry play their death animation where they fell.
      if (v.info.kind === 'infantry' && v.root.visible) this.deaths.push(new DeathEffect(this.lib, v.id, v.pose.dir, this.ground, v.root.x, v.root.y));
      v.destroy();
      this.spriteUnits.delete(h);
      this.rendered.delete(h);
    }
    for (const [h, v] of this.spriteStructures) {
      if (seen.has(h)) continue;
      v.destroy();
      this.spriteStructures.delete(h);
      this.rendered.delete(h);
    }
    this.deaths = this.deaths.filter((d) => d.update());

    // Projectiles: tracer dots interpolated between origin and impact.
    for (let i = 0; i < cur.projectileCount; i++) {
      const p = cur.proj(i);
      const total = cur.get(p, PR.total);
      const left = cur.get(p, PR.ticks) - alpha;
      const t = total > 0 ? Math.max(0, Math.min(1, 1 - left / total)) : 1;
      const ox = cur.get(p, PR.ox);
      const oy = cur.get(p, PR.oy);
      const tx = cur.get(p, PR.x);
      const ty = cur.get(p, PR.y);
      const x = ox + (tx - ox) * t;
      const y = oy + (ty - oy) * t;
      const px = isoX(x / FX, y / FX);
      const type = cur.get(p, PR.type);
      // Shells arc; everything else flies straight at about chest height.
      const dist = Math.hypot(isoX((tx - ox) / FX, (ty - oy) / FX), isoY((tx - ox) / FX, (ty - oy) / FX));
      const lift = type === PROJ_SIEGE ? Math.sin(Math.PI * t) * dist * 0.35 : 0;
      const py = isoY(x / FX, y / FX) - 8 - lift;
      // Direction on screen, for streaks.
      const ex = isoX((tx - ox) / FX, (ty - oy) / FX);
      const ey = isoY((tx - ox) / FX, (ty - oy) / FX) - (type === PROJ_SIEGE ? Math.cos(Math.PI * t) * dist * 0.35 * Math.PI * 0.5 : 0);
      const el = Math.hypot(ex, ey) || 1;
      const ux = ex / el;
      const uy = ey / el;
      if (type === PROJ_KINETIC || type === PROJ_ENERGY) {
        const len = type === PROJ_ENERGY ? 14 : 9;
        this.fx
          .moveTo(px - ux * len, py - uy * len)
          .lineTo(px, py)
          .stroke({ width: type === PROJ_ENERGY ? 2 : 1.5, color: type === PROJ_ENERGY ? 0x8fe8ff : 0xfff0b8, alpha: 0.9 });
      } else if (type === PROJ_FLAK) {
        this.fx.circle(px, py - 14, 1.5).fill(0xffd890);
      } else {
        // Rockets and shells: glowing head with a fading smoke trail.
        this.fx
          .moveTo(px - ux * 12, py - uy * 12)
          .lineTo(px, py)
          .stroke({ width: 2.5, color: 0x8a847c, alpha: 0.45 });
        this.fx.circle(px, py, 2.6).fill(0xffb64a);
        this.fx.circle(px, py, 1.3).fill(0xfff3cf);
      }
    }
    this.effects.update();

    // Click feedback: shrinking iso ellipse at ordered points.
    const now = performance.now();
    this.pings = this.pings.filter((p) => now - p.at < 500);
    for (const p of this.pings) {
      const t = (now - p.at) / 500;
      const r = 16 * (1 - t) + 4;
      this.overlay.ellipse(p.x, p.y, r, r / 2).stroke({ width: 2, color: p.color, alpha: 1 - t });
    }

    this.terrain.update();
    this.updateEcho();
    this.drawGhost();
    this.updateFog();
  }

  private updateEcho(): void {
    const s = this.state;
    if (this.echoVersion === s.echoVersion) return;
    this.echoVersion = s.echoVersion;
    if (this.propsReady) {
      this.echoLayer.clear();
      this.updateEchoSprites();
      return;
    }
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

  /** Echo crystal clusters: one sprite per tile, sized by crystals left. */
  private updateEchoSprites(): void {
    const s = this.state;
    for (let i = 0; i < s.echo.length; i++) {
      const n = s.echo[i]!;
      let sp = this.echoSprites.get(i);
      if (n === 0) {
        if (sp) {
          sp.destroy();
          this.echoSprites.delete(i);
        }
        continue;
      }
      const size = n >= 10 ? 4 : n >= 7 ? 3 : n >= 4 ? 2 : 1;
      const tex = this.lib.texture(`echo_${size}`, 'body', 'idle', 0, 0, 'color');
      if (!tex) continue;
      if (!sp) {
        const x = i % s.width;
        const y = Math.floor(i / s.width);
        sp = new Sprite(tex);
        sp.anchor.set(0.5);
        const px = isoX(x + 0.5, y + 0.5);
        const py = isoY(x + 0.5, y + 0.5);
        sp.position.set(px, py);
        sp.zIndex = py - 2;
        if (((x * 7 + y * 13) & 1) === 1) sp.scale.x = -1;
        this.ground.addChild(sp);
        this.echoSprites.set(i, sp);
      }
      sp.texture = tex;
    }
  }

  /**
   * While placing: where this faction may build. Halcyon sees its network
   * coverage, Choir its growth range around structures (and Echo).
   */
  private drawBuildRange(): void {
    const s = this.state;
    const cur = s.cur;
    const faction = s.rules.factions[s.players[s.localPlayer]?.faction ?? 0]!;
    if (!cur || faction.placement === 'adjacent') return;
    const color = faction.placement === 'coverage' ? 0x3ee6ff : 0xc58cff;
    for (let i = 0; i < cur.entityCount; i++) {
      const o = cur.ent(i);
      if (cur.get(o, E.kind) !== KIND.structure || cur.get(o, E.owner) !== s.localPlayer) continue;
      const rule = s.rules.structures[cur.get(o, E.type)]!;
      const r = (faction.placement === 'coverage' ? rule.coverageRadius : rule.growthRadius) / FX;
      if (r <= 0) continue;
      const x = cur.get(o, E.x) / FX;
      const y = cur.get(o, E.y) / FX;
      // A circle of r tiles is an ellipse on the iso grid.
      const rx = r * (TILE_W / 2) * Math.SQRT2;
      this.decals.ellipse(isoX(x, y), isoY(x, y), rx, rx / 2).fill({ color, alpha: 0.06 }).stroke({ width: 1.5, color, alpha: 0.45 });
    }
  }

  private drawGhost(): void {
    const ghost = this.placementGhost();
    if (!ghost) return;
    this.drawBuildRange();
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

  /** Draw a unit with rendered sprites if its faction has art. Returns false to fall back to placeholders. */
  private updateUnitSprite(h: number, id: string, px: number, py: number, color: number, facing: number, vx: number, vy: number, firing: boolean, visible: boolean, wreck: boolean): boolean {
    let v = this.spriteUnits.get(h);
    if (!v) {
      const info = this.lib.info(id);
      if (!info) return false;
      v = new UnitSpriteView(this.lib, id, info, this.shadows, facing);
      // Art finished loading after this unit appeared: retire its placeholder.
      const old = this.units.get(h);
      if (old) {
        old.root.destroy({ children: true });
        old.shadow?.destroy();
        this.units.delete(h);
      }
      (info.kind === 'air' ? this.air : this.ground).addChild(v.root);
      this.spriteUnits.set(h, v);
    }
    v.update({ px, py, color, facing, vx, vy, firing, visible, wreck });
    return true;
  }

  private updateStructureSprite(h: number, id: string, px: number, py: number, depth: number, color: number, hp: number, facing: number, visible: boolean, tick: number): boolean {
    let v = this.spriteStructures.get(h);
    if (!v) {
      const info = this.lib.info(id);
      if (!info) return false;
      // Buildings that exist when the match starts (or are first seen through the fog) skip the build-up.
      v = new StructureSpriteView(this.lib, id, info, this.shadows, tick < 40 || !visible || this.structures.has(h));
      const old = this.structures.get(h);
      if (old) {
        old.root.destroy();
        this.structures.delete(h);
      }
      this.ground.addChild(v.root);
      this.spriteStructures.set(h, v);
    }
    v.update({ px, py, depth, color, hp, facing, visible });
    return true;
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
