import { Application, Container, Graphics, Matrix, Sprite, Texture } from 'pixi.js';
import { CAPTURE_RADIUS, CAPTURE_TICKS, KIND, MARKER, POINT, TERRAIN } from '@signal-fall/sim';
import { E, ENT_FLAG, PR, WAYPOINTS } from '../protocol';
import { TEAM_COLORS, type ClientState } from '../game/state';
import { TILE_H, TILE_W, facingToRotation, isoX, isoY, tileU, tileV } from '../game/iso';
import { SpriteLibrary } from './sprites';
import { Culler } from './culler';
import { Weather } from './weather';
import { NightLight } from './night';
import { TerrainLayer } from './terrain';
import { DeathEffect, StructureSpriteView, UnitSpriteView } from './views';
import { Effects } from './effects';

const FX = 1024;
/** Share of open ground tiles with a bit of clutter, and how many clutter variants each biome has. */
const CLUTTER_DENSITY: Record<string, number> = { wasteland: 0.1, city: 0.07, crystal: 0.07 };
const CLUTTER_VARIANTS: Record<string, number> = { wasteland: 8, city: 10, crystal: 4 };
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
  /** Halcyon's network coverage, always shown to its own player; rebuilt when structures change. */
  private readonly coverageGfx = new Graphics();
  private coverageKey = '';
  private lastFrameAt = performance.now();
  /** Enemy structures as last seen: footprint, so a ghost can outlive the building until the spot is seen again. */
  private structFootprints = new Map<number, { x0: number; y0: number; w: number; h: number; owner: number }>();
  /** All sprite shadows, under every unit and building. */
  private readonly shadows = new Container();
  /** Shadows of map props (hidden on the lower graphics settings). */
  private readonly propShadows = new Container();
  /** Small ground clutter: drawn under units, never depth-sorted. */
  private readonly flat = new Container();
  private readonly ground = new Container();
  /** Static map sprites are only in the scene graph near the screen. */
  private readonly culler = new Culler();
  private readonly air = new Container();
  private readonly fx = new Graphics();
  /** Particle effects (flashes, fire, smoke) and scorch marks. */
  private readonly particles = new Container();
  private readonly scorchLayer = new Container();
  readonly effects: Effects;
  private readonly fogLayer = new Container();
  /** Dust, ash or crystal motes in the air (cosmetic). */
  readonly weather = new Weather();
  /** Dusk and night maps: a light map over the battlefield. */
  readonly night = new NightLight();
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
  private collapsing: StructureSpriteView[] = [];
  /** Last rendered world-pixel position per entity handle (ground point). */
  readonly rendered = new Map<number, { x: number; y: number; air: boolean; shape: Shape | null }>();
  private fogCanvas: HTMLCanvasElement | null = null;
  private fogTexture: Texture | null = null;
  private fogVersion = -1;
  private echoVersion = -1;
  private propsReady = false;
  private echoSprites = new Map<number, Sprite>();
  /** Capture point models placed so far (by tile). */
  private pointSprites = new Set<number>();
  /** Crate sprites by tile (crates come and go). */
  private crateSprites = new Map<number, Sprite>();
  /** Shields per entity last frame: a drop means a hit, shown as a shimmer. */
  private lastShields = new Map<number, number>();
  /** Supplies the placement ghost under the cursor while placing a structure. */
  placementGhost: () => { tx: number; ty: number; rule: { footprintW: number; footprintH: number; weapon?: { range: number } | null }; error: string | null } | null = () => null;
  /** The sim point (Q10) under the cursor, for targeting previews. */
  cursorPoint: () => { x: number; y: number } | null = () => null;
  /** Click feedback markers in world px. */
  private pings: { x: number; y: number; color: number; at: number }[] = [];

  constructor(private readonly state: ClientState) {
    this.effects = new Effects(state.rules, this.particles, this.scorchLayer, (x, y) => this.worthDrawing(x, y), (owner) => !state.spectator && owner === state.localPlayer);
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
    await this.app.init({ resizeTo: host, background: 0x0b0d10, antialias: true, autoDensity: true, preference: 'webgl' });
    host.appendChild(this.app.canvas);
    this.ground.sortableChildren = true;
    this.air.sortableChildren = true;
    this.world.addChild(this.terrainLayer, this.scorchLayer, this.echoLayer, this.coverageGfx, this.decals, this.propShadows, this.shadows, this.flat, this.ground, this.fx, this.air, this.night.sprite, this.particles, this.weather.layer, this.fogLayer, this.overlay);
    this.app.stage.addChild(this.world, this.screen);
    this.makeTextures();
  }

  /**
   * Graphics quality. Ultra renders at the screen's full pixel density (sharp on high-DPI screens, with
   * 2x sprites); Balanced drops ground clutter and prop shadows; Performance also renders at 75%
   * resolution and uses the cheap terrain shader.
   */
  setGraphics(q: GraphicsQuality): void {
    this.flat.visible = q === 'high' || q === 'ultra';
    this.propShadows.visible = q === 'high' || q === 'ultra';
    this.terrain.setLite(q === 'performance');
    const res = q === 'performance' ? 0.75 : q === 'ultra' ? ultraResolution() : 1;
    if (this.app.renderer && this.app.renderer.resolution !== res) {
      this.app.renderer.resolution = res;
      this.app.resize();
    }
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
      // The drawn sprite's box (trimmed a little: its corners are mostly empty), so big models
      // are clickable wherever they show; the per-shape radius covers placeholders.
      let hit = d <= PICK_RADIUS[r.shape] * this.camera.zoom;
      const view = this.spriteUnits.get(h);
      if (!hit && view?.root.visible) {
        const b = view.root.getBounds();
        const mx = b.width * 0.15;
        const my = b.height * 0.15;
        hit = sx >= b.x + mx && sx <= b.x + b.width - mx && sy >= b.y + my && sy <= b.y + b.height - my;
      }
      // Prefer air (drawn on top), then nearest.
      const score = d - (r.air ? 4 : 0);
      if (hit && score < bestD) {
        best = h;
        bestD = score;
      }
    }
    if (best >= 0) return best;
    // Structures (placeholder or sprite): the footprint, or the building standing on it,
    // so a click on a tall building's roof counts too (front-most building wins).
    let found = -1;
    let foundDepth = -Infinity;
    for (const h of [...this.structures.keys(), ...this.spriteStructures.keys()]) {
      // Ghosts of buildings already gone cannot be picked.
      if (s.cur?.index.get(h) === undefined || !this.visibleEntity(h)) continue;
      const rule = s.ruleOf(h);
      if (rule.kind !== 'structure') continue;
      const cx = s.field(h, E.x) / FX;
      const cy = s.field(h, E.y) / FX;
      for (const lift of [0, 16, 32, 48]) {
        const { u, v } = this.screenToTile(sx, sy + lift * this.camera.zoom);
        if (Math.abs(u - cx) > rule.footprintW / 2 || Math.abs(v - cy) > rule.footprintH / 2) continue;
        // Taller lifts only for buildings big enough to stand that high.
        if (lift > 16 * Math.min(rule.footprintW, rule.footprintH)) continue;
        if (cx + cy > foundDepth) {
          found = h;
          foundDepth = cx + cy;
        }
        break;
      }
    }
    return found;
  }

  /** Is any tile of this footprint in sight right now? */
  private footprintInSight(x0: number, y0: number, w: number, h: number): boolean {
    const s = this.state;
    if (!s.fog || s.spectator) return true;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < s.width && y < s.height && s.fog[y * s.width + x]! & 1) return true;
    return false;
  }

  /**
   * An enemy building gone from the snapshot stays as a ghost until its spot is in sight again:
   * the player only learns it is gone by looking.
   */
  private keepGhost(h: number, root: { tint: number; alpha: number }): boolean {
    const f = this.structFootprints.get(h);
    if (!f || f.owner === this.state.localPlayer || this.footprintInSight(f.x0, f.y0, f.w, f.h)) {
      this.structFootprints.delete(h);
      return false;
    }
    root.tint = 0x8a8f99;
    root.alpha = 0.6;
    this.rendered.delete(h);
    return true;
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
      .build(this.terrainLayer, s.biome, s.width, s.height, s.terrain, s.surface, (i) => s.decoration[i] === 5)
      .then(() => this.drawProps())
      .catch((err) => console.warn('terrain shader unavailable, using flat tiles', err));
    this.buildFog();
  }

  /** Obstacle formations, decorations and clutter as rendered prop sprites, depth-sorted with units. */
  private async drawProps(): Promise<void> {
    const s = this.state;
    await this.lib.loadFaction('props');
    if (!this.lib.info('rock_wasteland_0')) return;
    const ground = this.terrain.groundDecor;
    const top = this.terrain.topDecor;
    ground.removeChildren();
    top.removeChildren();
    this.culler.clear();
    this.echoSprites.clear();
    this.pointSprites.clear();
    const hash = (x: number, y: number, k: number) => {
      let h = Math.imul(x + 1, 374761393) + Math.imul(y + 1, 668265263) + Math.imul(k, 982451653);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < s.width && y < s.height ? s.terrain[y * s.width + x]! : -1);
    const mesa = (x: number, y: number) => TerrainLayer.isMesa(at(x, y));
    const obstacle = (t: number): string | null => {
      if (t === TERRAIN.ruins) return 'rock_city';
      if (t === TERRAIN.rock) return 'rock_wasteland';
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
        this.culler.add(sp, layer === this.ground || layer === this.flat ? this.propShadows : layer, px, py);
      }
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      sp.position.set(px, py);
      sp.scale.set(scale * flip, scale);
      sp.zIndex = py;
      this.culler.add(sp, layer, px, py);
    };
    this.drawLandmarks(place);
    // Rock outcrops that aren't copses become big formations; city ruins become buildings.
    const grove = (x: number, y: number) => s.biome !== 'crystal' && hash(x >> 2, y >> 2, 21) < (s.biome === 'city' ? 0.35 : 0.45);
    const built =
      s.biome === 'city'
        ? this.drawBlocks(place, hash, (i) => s.terrain[i] === TERRAIN.ruins, 'bld', 4)
        : this.drawBlocks(place, hash, (i) => s.terrain[i] === TERRAIN.rock && !grove(i % s.width, Math.floor(i / s.width)), `fmn_${s.biome}`, 3);
    const DECO_IDS = ['', 'deco_rubble', 'deco_wreck', 'deco_outcrop', 'deco_tree', ''];
    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        const i = y * s.width + x;
        if (s.landmark[i] || built[i]) continue;
        const cx = isoX(x + 0.5, y + 0.5);
        const cy = isoY(x + 0.5, y + 0.5);
        if (mesa(x, y)) {
          // Mesa tops: crystal spires or the odd boulder; scree at the foot of exposed faces.
          const r = hash(x, y, 7);
          if (s.biome === 'wasteland' && r > 0.9) {
            place(`tree_wasteland_${Math.floor(hash(x, y, 2) * 6)}`, top, cx, cy - this.terrain.heightAt(x + 0.5, y + 0.5), 0.8, hash(x, y, 6) < 0.5 ? -1 : 1, false);
          } else if (s.biome === 'crystal' ? r < 0.12 : r < 0.1) {
            const id = s.biome === 'crystal' ? `fmn_crystal_1x1_${Math.floor(hash(x, y, 2) * 3)}` : `rock_wasteland_${Math.floor(hash(x, y, 2) * 6)}`;
            place(id, top, cx, cy - this.terrain.heightAt(x + 0.5, y + 0.5), s.biome === 'crystal' ? 0.7 : 0.55, hash(x, y, 6) < 0.5 ? -1 : 1, false);
          }
          continue;
        }
        if ((mesa(x - 1, y) || mesa(x, y - 1)) && hash(x, y, 8) < 0.3) {
          place(s.biome === 'crystal' ? `clutter_crystal_${4 + Math.floor(hash(x, y, 9) * 2)}` : `deco_rubble_${Math.floor(hash(x, y, 9) * 3)}`, this.flat, cx - 6 + hash(x, y, 10) * 12, cy - 4, 0.9, 1, false);
        }
        // Wasteland rock outcrops turn into copses where a coarse noise says so.
        if (s.terrain[i] === TERRAIN.rock && grove(x, y)) {
          const jx = (hash(x, y, 3) - 0.5) * 0.3;
          const jy = (hash(x, y, 4) - 0.5) * 0.3;
          const kind = s.biome === 'city' ? `tree_city_${Math.floor(hash(x, y, 1) * 3)}` : `tree_wasteland_${Math.floor(hash(x, y, 1) * 6)}`;
          place(kind, this.ground, isoX(x + 0.5 + jx, y + 0.5 + jy), isoY(x + 0.5 + jx, y + 0.5 + jy), 0.9 + hash(x, y, 5) * 0.25, hash(x, y, 6) < 0.5 ? -1 : 1, true);
          continue;
        }
        const ob = obstacle(s.terrain[i]!);
        // Craters are pressed into the terrain itself (see TerrainLayer.build).
        const deco = DECO_IDS[s.decoration[i] ?? 0] ?? '';
        // Crystal rubble: dark stones, not the pale sand rocks of the wasteland.
        const decoId =
          deco === 'deco_rubble' && s.biome === 'crystal'
            ? `clutter_crystal_${4 + Math.floor(hash(x, y, 2) * 2)}`
            : deco === 'deco_outcrop'
              ? `fmn_crystal_1x1_${Math.floor(hash(x, y, 2) * 3)}`
              : deco
                ? `${deco}_${Math.floor(hash(x, y, 2) * 3)}`
                : null;
        const id = ob ? `${ob}_${Math.floor(hash(x, y, 1) * 6)}` : decoId;
        if (!id) {
          // Clutter on open ground (cosmetic): bushes and stones, street furniture, small crystals.
          const open = (s.terrain[i] === TERRAIN.ground || s.terrain[i] === TERRAIN.rough) && !(s.surface[i] ?? 0) && !(s.echo[i] ?? 0);
          // Clumped, not sprinkled: dense patches (more of them by water), bare stretches between.
          const near = (dx: number, dy: number) => at(x + dx, y + dy) === TERRAIN.water || TerrainLayer.isMesa(at(x + dx, y + dy));
          const bank = near(2, 0) || near(-2, 0) || near(0, 2) || near(0, -2) ? 1.6 : 1;
          const clump = (hash(x >> 2, y >> 2, 41) + hash((x + 2) >> 2, (y + 2) >> 2, 42)) * 0.5;
          if (open && hash(x, y, 11) < CLUTTER_DENSITY[s.biome]! * bank * (0.2 + 2.2 * clump * clump)) {
            const kind = `clutter_${s.biome}`;
            const n = CLUTTER_VARIANTS[s.biome]!;
            const jx = (hash(x, y, 12) - 0.5) * 0.7;
            const jy = (hash(x, y, 13) - 0.5) * 0.7;
            place(`${kind}_${Math.floor(hash(x, y, 14) * n)}`, this.flat, isoX(x + 0.5 + jx, y + 0.5 + jy), isoY(x + 0.5 + jx, y + 0.5 + jy), 0.85 + hash(x, y, 15) * 0.3, hash(x, y, 16) < 0.5 ? -1 : 1, true);
          }
          continue;
        }

        // Jitter inside the tile, random size and mirroring so formations don't repeat.
        const jx = (hash(x, y, 3) - 0.5) * (ob ? 0.3 : 0.6);
        const jy = (hash(x, y, 4) - 0.5) * (ob ? 0.3 : 0.6);
        const px = isoX(x + 0.5 + jx, y + 0.5 + jy);
        const py = isoY(x + 0.5 + jx, y + 0.5 + jy);
        // Outcrops on open ground stay small so they don't read as obstacles.
        const scale = ob ? 1.05 + hash(x, y, 5) * 0.35 : deco === 'deco_outcrop' ? 0.5 + hash(x, y, 5) * 0.15 : 0.85 + hash(x, y, 5) * 0.3;
        const flip = hash(x, y, 6) < 0.5 ? -1 : 1;
        place(id, this.ground, px, py, scale, flip, true);
      }
    }
    this.propsReady = true;
    this.echoVersion = -1;
  }

  /**
   * Obstacle clusters drawn as big pieces: each cluster of matching tiles is cut into rectangular
   * blocks (3x3 down to 1x1), each one sprite `${prefix}_${WxD}_${variant}` (city buildings, rock
   * formations). Returns the tiles covered.
   */
  private drawBlocks(
    place: (id: string, layer: Container, px: number, py: number, scale: number, flip: number, shadow: boolean) => void,
    hash: (x: number, y: number, k: number) => number,
    match: (i: number) => boolean,
    prefix: string,
    variants: number,
  ): Uint8Array {
    const s = this.state;
    const built = new Uint8Array(s.width * s.height);
    const free = (x: number, y: number) => x < s.width && y < s.height && match(y * s.width + x) && !built[y * s.width + x] && !s.landmark[y * s.width + x];
    const fits = (x: number, y: number, w: number, h: number) => {
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (!free(x + dx, y + dy)) return false;
      return true;
    };
    // [w, d, sprite footprint, mirrored]: a mirrored sprite swaps the footprint's axes on screen.
    const SHAPES: [number, number, string, boolean][] = [
      [3, 3, '3x3', false],
      [3, 2, '3x2', false],
      [2, 3, '3x2', true],
      [2, 2, '2x2', false],
      [2, 1, '2x1', false],
      [1, 2, '2x1', true],
      [1, 1, '1x1', false],
    ];
    for (let y = 0; y < s.height; y++)
      for (let x = 0; x < s.width; x++) {
        if (!free(x, y)) continue;
        // Not always the biggest block: mixed sizes read as a real street.
        const skip = hash(x, y, 31) < 0.35 ? 2 : 0;
        const shape = SHAPES.slice(skip).find(([w, d]) => fits(x, y, w, d)) ?? SHAPES[SHAPES.length - 1]!;
        const [w, d, id, mirrored] = shape;
        for (let dy = 0; dy < d; dy++) for (let dx = 0; dx < w; dx++) built[(y + dy) * s.width + x + dx] = 1;
        const variant = Math.floor(hash(x, y, 32) * variants);
        place(`${prefix}_${id}_${variant}`, this.ground, isoX(x + w / 2, y + d / 2), isoY(x + w / 2, y + d / 2), 1, mirrored ? -1 : 1, true);
      }
    return built;
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
    const hw = this.width / 2 / this.camera.zoom;
    const hh = this.height / 2 / this.camera.zoom;
    this.culler.update(this.camera.x - hw, this.camera.y - hh, this.camera.x + hw, this.camera.y + hh);
    this.weather.update(this.camera.x - hw, this.camera.y - hh, this.camera.x + hw, this.camera.y + hh);

    const alpha = Math.min(1, (performance.now() - s.curAt) / 50);
    const nowMs = performance.now();
    const frameDt = Math.min(0.1, (nowMs - this.lastFrameAt) / 1000);
    this.lastFrameAt = nowMs;
    const burning = new Set<number>();
    const prev = s.prev;
    const seen = new Set<number>();
    const selected = new Set(s.selection);
    this.decals.clear();
    this.overlay.clear();
    this.fx.clear();
    this.drawCoverage();
    this.drawPoints();
    this.drawCrates();
    this.drawObjectives();
    this.drawChorus();
    this.shimmerEcho();
    this.night.begin();
    const lowPower = !s.spectator && s.lowPower;
    const ghosts = new Set<number>();
    const salvage = !s.spectator && (s.rules.factions[s.players[s.localPlayer]?.faction ?? 0]?.salvagePct ?? 0) > 0;

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
        // Salvage you can see: a glinting scrap marker on every wreck the player's faction can cash in.
        if (visible && salvage) {
          const t = performance.now() / 1000 + (h % 7);
          const glint = 0.55 + 0.45 * Math.sin(t * 3);
          const my = py - 20 - 2 * Math.sin(t * 2);
          this.overlay.poly([px, my - 6, px + 5, my, px, my + 6, px - 5, my]).fill({ color: 0xffd75a, alpha: 0.35 + 0.5 * glint }).stroke({ width: 1, color: 0x3a2a08, alpha: 0.8 });
          this.overlay.circle(px + 6, my - 6, 1.2 + glint).fill({ color: 0xfff6c8, alpha: glint });
        }
        continue;
      }
      if (kind === KIND.structure) {
        const srule = s.rules.structures[cur.get(o, E.type)]!;
        const hpFrac = cur.get(o, E.hp) / Math.max(1, cur.get(o, E.maxHp));
        if (!this.updateStructureSprite(h, srule.id, px, py, py + isoY(srule.footprintW / 2, srule.footprintH / 2), color, hpFrac, cur.get(o, E.facing), visible, cur.tick))
          this.updateStructure(h, cur.get(o, E.type), px, py, color, visible);
        this.rendered.set(h, { x: px, y: py, air: false, shape: null });
        // Low power: our buildings that draw power go dim, with a blinking red bolt.
        // Enemy buildings out of sight are last-seen ghosts: faded, grey, no health bar.
        const sview = this.spriteStructures.get(h)?.root ?? this.structures.get(h)?.root;
        const unpowered = owner === s.localPlayer && lowPower && srule.power < 0;
        const x0 = Math.floor(cur.get(o, E.x) / FX - srule.footprintW / 2);
        const y0 = Math.floor(cur.get(o, E.y) / FX - srule.footprintH / 2);
        this.structFootprints.set(h, { x0, y0, w: srule.footprintW, h: srule.footprintH, owner });
        const ghost = visible && owner !== s.localPlayer && !this.footprintInSight(x0, y0, srule.footprintW, srule.footprintH);
        if (ghost) ghosts.add(h);
        if (sview) {
          sview.tint = unpowered ? 0x7a7a8a : ghost ? 0x8a8f99 : 0xffffff;
          sview.alpha = ghost ? 0.6 : 1;
        }
        // Damaged buildings smoke, badly damaged ones burn (not ghosts: their health is unknown).
        if (visible && !ghost) {
          this.effects.burn(h, px, py, srule.footprintW, hpFrac, frameDt);
          burning.add(h);
        }
        if (visible && unpowered && Math.floor(performance.now() / 500) % 2 === 0) {
          const by = py - 64;
          this.overlay.poly([px + 2, by - 8, px - 4, by + 1, px, by + 1, px - 2, by + 8, px + 4, by - 1, px, by - 1]).fill({ color: 0xff4d4d }).stroke({ width: 1, color: 0x2a0606 });
        }
        if (visible && cur.get(o, E.repairing) === 1) {
          const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150);
          this.overlay.rect(px - 2, py - 70, 4, 12).fill({ color: 0x4ade80, alpha: pulse });
          this.overlay.rect(px - 6, py - 66, 12, 4).fill({ color: 0x4ade80, alpha: pulse });
        }
      } else {
        const rule = s.rules.units[cur.get(o, E.type)]!;
        const shape = SHAPES[rule.armor]!;
        const firing = cur.get(o, E.target) >= 0;
        if (!this.updateUnitSprite(h, rule.sprite, px, py, color, cur.get(o, E.facing), cur.get(o, E.vx), cur.get(o, E.vy), firing, visible, false))
          this.updateUnit(h, shape, rule.weapon !== null, px, py, color, cur.get(o, E.facing), visible);
        if (visible) this.rendered.set(h, { x: px, y: py, air: rule.isAir, shape });
        else this.rendered.delete(h);
        // Phased-out units shimmer, half there.
        const flags = cur.get(o, E.flags);
        const view = this.spriteUnits.get(h)?.root ?? this.units.get(h)?.root;
        if (view) view.alpha = flags & ENT_FLAG.phased ? 0.3 + 0.15 * Math.sin(performance.now() / 70) : 1;
        if (visible && flags & ENT_FLAG.jammed) {
          // Jammed: crackling static above the unit.
          const t = performance.now() / 60;
          const top = py - (rule.isAir ? AIR_ALTITUDE : 0) - 22;
          for (let k = 0; k < 3; k++) {
            const jx = px - 8 + ((Math.floor(t) * 7 + k * 5) % 16);
            this.overlay.moveTo(jx, top - 4).lineTo(jx + 3, top).lineTo(jx - 1, top + 2).lineTo(jx + 2, top + 6).stroke({ width: 1.4, color: 0x9ff3ff, alpha: 0.9 });
          }
        }
        if (visible && flags & (ENT_FLAG.dugIn | ENT_FLAG.digging)) {
          // Dug in: a ring of sandbags on the ground around the unit (half-built while digging).
          const built = (flags & ENT_FLAG.dugIn) !== 0;
          const bags = built ? 12 : 6;
          for (let k = 0; k < bags; k++) {
            const a = (k / 12) * Math.PI * 2 + Math.PI / 12;
            const bx = px + Math.cos(a) * 17;
            const by = py + Math.sin(a) * 8.5;
            this.decals.ellipse(bx, by, 5.2, 3.2).fill({ color: 0xd8c08a, alpha: built ? 1 : 0.65 }).stroke({ width: 1.2, color: 0x3a2c14, alpha: 0.9 });
            this.decals.moveTo(bx - 3, by).lineTo(bx + 3, by).stroke({ width: 0.8, color: 0x7a6440, alpha: 0.8 });
          }
        }
        if (visible && flags & ENT_FLAG.garrisoned) {
          // In the ruins: a little house in the team color over the building, and a muzzle-slit glint.
          const top = py - 40;
          this.overlay.poly([px - 7, top, px, top - 7, px + 7, top, px + 7, top + 8, px - 7, top + 8]).fill({ color, alpha: 0.95 }).stroke({ width: 1.5, color: 0x111111 });
          this.overlay.rect(px - 4, top + 2, 8, 2).fill(0x111111);
        }
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
      if (this.night.active) {
        // Buildings throw warm pools of light; units carry small lamps.
        if (kind === KIND.structure) this.night.add(px, py, 60 + s.rules.structures[cur.get(o, E.type)]!.footprintW * 34, 0xffcf96, 1);
        else if (kind === KIND.unit) this.night.add(px, py - lift, 58, 0xfff1d6, 0.75);
      }
      const isSel = selected.has(h);
      if (isSel && kind === KIND.structure && cur.get(o, E.rallyX) >= 0 && owner === s.localPlayer) {
        const rx2 = cur.get(o, E.rallyX) / FX;
        const ry2 = cur.get(o, E.rallyY) / FX;
        const fx = isoX(rx2, ry2);
        const fy = isoY(rx2, ry2);
        this.overlay.moveTo(px, py).lineTo(fx, fy).stroke({ width: 1, color: 0xe8c35a, alpha: 0.7 });
        this.overlay.rect(fx - 1, fy - 16, 2, 16).fill(0xe8c35a).poly([fx + 1, fy - 16, fx + 10, fy - 13, fx + 1, fy - 10]).fill(0xe8c35a);
      }
      const enemy = s.players[owner]?.team !== s.players[s.localPlayer]?.team;
      if (isSel || (h === s.hoverEntity && enemy && kind !== KIND.wreck)) {
        // Own selection rings take the unit's health color; enemies are red (also when only hovered).
        const rx = kind === KIND.structure ? 40 : 14;
        const life = cur.get(o, E.hp) / Math.max(1, cur.get(o, E.maxHp));
        const ring = owner !== s.localPlayer ? 0xff6d6d : life > 0.6 ? 0x6dff8a : life > 0.3 ? 0xfacc15 : 0xef4444;
        this.decals.ellipse(px, py, rx, rx / 2).stroke({ width: isSel ? 1.5 : 1, color: ring, alpha: isSel ? 1 : 0.7 });
        // Weapon range: selected defenses always, any selection while Alt is held.
        const rule = kind === KIND.structure ? s.rules.structures[cur.get(o, E.type)]! : kind === KIND.unit ? s.rules.units[cur.get(o, E.type)]! : null;
        if (isSel && rule?.weapon && (s.altHeld || kind === KIND.structure)) this.rangeRing(px, py, rule.weapon.range / FX, ring);
      }
      if (isSel) {
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
      if (maxSh > 0) {
        const before = this.lastShields.get(h);
        if (before !== undefined && sh < before) this.effects.shieldHit(px, py - lift - (kind === KIND.structure ? 30 : 10), kind === KIND.structure ? 2.2 : 0.8);
        this.lastShields.set(h, sh);
      }
      if ((isSel || hp < maxHp || sh < maxSh || s.altHeld) && !ghosts.has(h)) {
        const w = kind === KIND.structure ? 48 : 22;
        const top = py - lift - (kind === KIND.structure ? 56 : 20);
        const frac = Math.max(0, hp / maxHp);
        this.overlay.rect(px - w / 2, top, w, 3).fill(0x111111);
        this.overlay.rect(px - w / 2, top, w * frac, 3).fill(frac > 0.6 ? 0x4ade80 : frac > 0.3 ? 0xfacc15 : 0xef4444);
        if (maxSh > 0) {
          this.overlay.rect(px - w / 2, top - 3, w, 2).fill(0x111111);
          this.overlay.rect(px - w / 2, top - 3, (w * sh) / maxSh, 2).fill(0xb48cff);
        }
        const cargo = cur.get(o, E.cargo);
        if (cargo > 0) this.overlay.rect(px - w / 2, top + 4, (w * Math.min(700, cargo)) / 700, 2).fill(0x3ee6ff);
        // Veterancy chevrons beside the health bar, stacked upward.
        const rank = cur.get(o, E.rank);
        for (let r = 0; r < rank; r++) {
          const cx = px + w / 2 + 6;
          const cy = top + 2 - r * 4;
          this.overlay.poly([cx - 4, cy - 2, cx, cy + 1, cx + 4, cy - 2], false).stroke({ width: 3.5, color: 0x1a1406 });
          this.overlay.poly([cx - 4, cy - 2, cx, cy + 1, cx + 4, cy - 2], false).stroke({ width: 1.8, color: 0xfacc15 });
        }
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
      if (seen.has(h) || this.keepGhost(h, v.root)) continue;
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
      if (seen.has(h) || this.keepGhost(h, v.root)) continue;
      // Destroyed (a death burst where it stood, just now) rather than sold: collapse it.
      const now = performance.now();
      const k = this.effects.fallen.findIndex((f) => now - f.t < 1500 && Math.abs(f.px - v.root.x) < 40 && Math.abs(f.py - v.root.y) < 40);
      if (k >= 0 && v.root.visible) {
        this.effects.fallen.splice(k, 1);
        this.collapsing.push(v);
      } else v.destroy();
      this.spriteStructures.delete(h);
      this.rendered.delete(h);
    }
    this.deaths = this.deaths.filter((d) => d.update());
    this.collapsing = this.collapsing.filter((c) => c.collapse());
    this.effects.burnKeep(burning);
    for (const h of this.lastShields.keys()) if (!seen.has(h)) this.lastShields.delete(h);

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
    // Team pings (Alt+click): rings pulsing outward for a few seconds, in the pinger's color.
    for (const p of s.mapPings) {
      const age = (now - p.time) / 1000;
      if (age > 5) continue;
      const px = isoX(p.x / FX, p.y / FX);
      const py = isoY(p.x / FX, p.y / FX);
      const color = TEAM_COLORS[p.player % TEAM_COLORS.length]!;
      for (let k = 0; k < 2; k++) {
        const t = ((age + k * 0.5) % 1);
        const r = 10 + 50 * t;
        this.overlay.ellipse(px, py, r, r / 2).stroke({ width: 2.5, color, alpha: (1 - t) * Math.min(1, 5 - age) });
      }
      this.overlay.poly([px - 6, py - 30, px + 6, py - 30, px, py - 16]).fill({ color, alpha: Math.min(1, 5 - age) });
    }
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
    if (this.night.active) {
      // Echo glows faintly in the dark.
      for (const sp of this.echoSprites.values()) if (sp.parent) this.night.add(sp.x, sp.y, 40, 0x3ee6ff, 0.5);
      this.night.end(this.app.renderer, this.camera.x - hw, this.camera.y - hh, this.camera.x + hw, this.camera.y + hh, this.width, this.height);
    }
  }

  private updateEcho(): void {
    const s = this.state;
    if (this.echoVersion === s.echoVersion) return;
    this.echoVersion = s.echoVersion;
    if (this.propsReady) {
      this.echoLayer.clear();
      this.updateEchoSprites();
      this.terrain.setEcho(this.state.echo);
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

  /** Echo shimmer: each cluster's light swells and fades on its own beat. */
  private shimmerEcho(): void {
    const t = performance.now() / 1000;
    for (const [i, sp] of this.echoSprites) {
      if (!sp.visible) continue;
      const k = 0.5 + 0.5 * Math.sin(t * 1.6 + (i % 97) * 0.7);
      const c = Math.round(205 + 50 * k);
      sp.tint = (c << 16) | (Math.min(255, c + 20) << 8) | 255;
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
          this.culler.remove(sp);
          sp.destroy();
          this.echoSprites.delete(i);
        }
        continue;
      }
      const size = n >= 10 ? 4 : n >= 7 ? 3 : n >= 4 ? 2 : 1;
      const x = i % s.width;
      const y = Math.floor(i / s.width);
      // A variant per tile, jittered and sized a little differently, so fields don't read as a grid.
      const r = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      // Leave gaps: the stained ground shows the field, crystals stand in clumps rather than a carpet.
      const nb = (s.echo[i + 1] ?? 0) + (s.echo[i - 1] ?? 0) + (s.echo[i + s.width] ?? 0) + (s.echo[i - s.width] ?? 0);
      if ((r >>> 7) % 10 < 4 && nb > 0) {
        if (sp) {
          this.culler.remove(sp);
          sp.destroy();
          this.echoSprites.delete(i);
        }
        continue;
      }
      // Rich tiles deep in a field can hold a towering mother crystal; elsewhere sizes wander a step
      // below what the tile holds, so a full field isn't a carpet of identical clusters.
      const core = n >= 10 && (s.echo[i + 1] ?? 0) >= 7 && (s.echo[i - 1] ?? 0) >= 7 && (s.echo[i + s.width] ?? 0) >= 7 && (s.echo[i - s.width] ?? 0) >= 7;
      const shown = (r >>> 13) % 4 === 0 ? Math.max(1, size - 1) : size;
      const id = core && (r >>> 20) % 6 === 0 ? `echo_mother_${r % 3}` : `echo_${shown}_${r % 4}`;
      const tex = this.lib.texture(id, 'body', 'idle', 0, 0, 'color') ?? this.lib.texture(`echo_${size}_0`, 'body', 'idle', 0, 0, 'color');
      if (!tex) continue;
      if (!sp) {
        sp = new Sprite(tex);
        sp.anchor.set(0.5);
        const jx = ((r >>> 4) % 100) / 100 - 0.5;
        const jy = ((r >>> 11) % 100) / 100 - 0.5;
        const px = isoX(x + 0.5 + jx * 0.45, y + 0.5 + jy * 0.45);
        const py = isoY(x + 0.5 + jx * 0.45, y + 0.5 + jy * 0.45);
        sp.position.set(px, py);
        sp.zIndex = py - 2;
        const k = 0.78 + ((r >>> 18) % 100) / 230;
        sp.scale.set(((r >>> 25) & 1) === 1 ? -k : k, k);
        this.culler.add(sp, this.ground, px, py);
        this.echoSprites.set(i, sp);
      }
      sp.texture = tex;
    }
  }

  /** Choir Chorus: thin violet threads between armed Choir units close enough to harmonize. */
  private drawChorus(): void {
    const s = this.state;
    const cur = s.cur;
    if (!cur) return;
    const pts: { x: number; y: number; owner: number; r: number }[] = [];
    for (let i = 0; i < cur.entityCount; i++) {
      const o = cur.ent(i);
      if (cur.get(o, E.kind) !== KIND.unit) continue;
      const rule = s.rules.units[cur.get(o, E.type)]!;
      const f = s.rules.factions[rule.faction]!;
      if (f.chorusPct <= 0 || !rule.weapon || rule.isAir || !this.visibleEntity(cur.get(o, E.handle))) continue;
      pts.push({ x: cur.get(o, E.x), y: cur.get(o, E.y), owner: cur.get(o, E.owner), r: f.chorusRadius });
    }
    const t = performance.now() / 600;
    for (let a = 0; a < pts.length; a++) {
      const p = pts[a]!;
      let links = 0;
      for (let b = a + 1; b < pts.length && links < 4; b++) {
        const q = pts[b]!;
        if (q.owner !== p.owner || Math.hypot(q.x - p.x, q.y - p.y) > p.r) continue;
        links++;
        const ax = isoX(p.x / FX, p.y / FX);
        const ay = isoY(p.x / FX, p.y / FX) - 8;
        const bx = isoX(q.x / FX, q.y / FX);
        const by = isoY(q.x / FX, q.y / FX) - 8;
        this.fx.moveTo(ax, ay).lineTo(bx, by).stroke({ width: 1, color: 0xc58cff, alpha: 0.18 + 0.12 * Math.sin(t + a) });
      }
    }
  }

  /**
   * Halcyon's network: a faint cyan grid over every covered tile with a brighter edge, so the
   * player always sees where units fire faster and self-repair (and where Recompile pays).
   */
  private drawCoverage(): void {
    const s = this.state;
    const cur = s.cur;
    const faction = s.rules.factions[s.players[s.localPlayer]?.faction ?? 0];
    if (!cur || s.spectator || !faction || faction.placement !== 'coverage') {
      if (this.coverageKey !== '') this.coverageGfx.clear();
      this.coverageKey = '';
      return;
    }
    const sources: [number, number, number][] = [];
    for (let i = 0; i < cur.entityCount; i++) {
      const o = cur.ent(i);
      if (cur.get(o, E.kind) !== KIND.structure || cur.get(o, E.owner) !== s.localPlayer) continue;
      const r = s.rules.structures[cur.get(o, E.type)]!.coverageRadius;
      if (r > 0) sources.push([cur.get(o, E.x), cur.get(o, E.y), r]);
    }
    // Uplinked units carry network with them (moving, so rounded to a tile to keep the cache useful).
    for (let i = 0; i < cur.entityCount; i++) {
      const o = cur.ent(i);
      if (cur.get(o, E.kind) !== KIND.unit || cur.get(o, E.owner) !== s.localPlayer || !(cur.get(o, E.flags) & ENT_FLAG.uplink)) continue;
      const up = s.rules.units[cur.get(o, E.type)]!.abilities.find((a) => a.kind === 'uplink');
      if (up && up.kind === 'uplink') sources.push([(cur.get(o, E.x) >> 10) * FX + FX / 2, (cur.get(o, E.y) >> 10) * FX + FX / 2, up.radius]);
    }
    const key = sources.map((v) => v.join(',')).join(';');
    if (key === this.coverageKey) return;
    this.coverageKey = key;
    const w = this.state.width;
    const h = this.state.height;
    const covered = new Uint8Array(w * h);
    for (const [cx, cy, r] of sources) {
      const r2 = (r / FX) * (r / FX);
      const x0 = Math.max(0, Math.floor((cx - r) / FX));
      const x1 = Math.min(w - 1, Math.ceil((cx + r) / FX));
      const y0 = Math.max(0, Math.floor((cy - r) / FX));
      const y1 = Math.min(h - 1, Math.ceil((cy + r) / FX));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx / FX;
          const dy = y + 0.5 - cy / FX;
          if (dx * dx + dy * dy <= r2) covered[y * w + x] = 1;
        }
    }
    const g = this.coverageGfx;
    g.clear();
    const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && covered[y * w + x] === 1;
    const color = 0x3ee6ff;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!at(x, y)) continue;
        const t = [isoX(x, y), isoY(x, y)] as const;
        const r = [isoX(x + 1, y), isoY(x + 1, y)] as const;
        const b = [isoX(x + 1, y + 1), isoY(x + 1, y + 1)] as const;
        const l = [isoX(x, y + 1), isoY(x, y + 1)] as const;
        g.poly([...t, ...r, ...b, ...l]).fill({ color, alpha: 0.035 }).stroke({ width: 1, color, alpha: 0.07 });
        // The network's edge, brighter.
        const edge = (ax: readonly number[], bx: readonly number[]) => g.moveTo(ax[0]!, ax[1]!).lineTo(bx[0]!, bx[1]!).stroke({ width: 1.5, color, alpha: 0.4 });
        if (!at(x, y - 1)) edge(t, r);
        if (!at(x + 1, y)) edge(r, b);
        if (!at(x, y + 1)) edge(b, l);
        if (!at(x - 1, y)) edge(l, t);
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

  /** Place-first: where our queued buildings will stand, as an outline filling with progress. */
  private drawPlannedSites(): void {
    const s = this.state;
    const cur = s.cur;
    if (!cur || s.spectator) return;
    for (let cat = 0; cat < 2; cat++) {
      const q = cur.buildQueue(s.localPlayer, cat);
      if (q.item < 0 || !q.at) continue;
      const rule = s.rules.structures[q.item]!;
      const done = q.ready ? 1 : q.progress / 1000;
      for (let y = q.at.ty; y < q.at.ty + rule.footprintH; y++) {
        for (let x = q.at.tx; x < q.at.tx + rule.footprintW; x++) {
          const px = isoX(x, y);
          const py = isoY(x, y);
          this.overlay
            .poly([px, py, px + TILE_W / 2, py + TILE_H / 2, px, py + TILE_H, px - TILE_W / 2, py + TILE_H / 2])
            .fill({ color: 0x9fd7ff, alpha: 0.08 + 0.22 * done })
            .stroke({ width: 1, color: 0x9fd7ff, alpha: 0.55 });
        }
      }
    }
  }

  /**
   * Capture points: a pad with the site on it (derrick, watchtower, repair depot) in the holder's
   * color (grey when neutral), the capture circle, and a filling ring while someone takes it.
   */
  private drawPoints(): void {
    const s = this.state;
    const cur = s.cur;
    if (!cur) return;
    const fog = s.fog;
    for (const p of cur.points()) {
      if (fog && !s.spectator && (fog[p.y * s.width + p.x]! & 2) === 0) continue;
      const px = isoX(p.x + 0.5, p.y + 0.5);
      const py = isoY(p.x + 0.5, p.y + 0.5);
      const color = p.owner >= 0 ? TEAM_COLORS[p.owner % TEAM_COLORS.length]! : 0x9aa0a6;
      const rx = CAPTURE_RADIUS * (TILE_W / 2) * Math.SQRT2;
      this.decals.ellipse(px, py, rx, rx / 2).stroke({ width: 1.5, color, alpha: 0.45 });
      this.decals.ellipse(px, py, 46, 23).stroke({ width: 2.5, color, alpha: 0.9 });
      // The site itself: a rendered model (drawn shapes until the props atlas is in).
      const key = p.y * s.width + p.x;
      if (p.kind === POINT.hill) {
        // The hill: a tall flag in the holder's color, waving.
        const t = performance.now() / 1000;
        this.overlay.rect(px - 2, py - 70, 4, 70).fill(0x3a3632);
        const w = Math.sin(t * 3) * 3;
        this.overlay.poly([px + 2, py - 70, px + 34, py - 62 + w, px + 2, py - 50]).fill({ color, alpha: 0.95 }).stroke({ width: 1.5, color: 0x1a1a1a });
        this.overlay.circle(px, py - 72, 3).fill(0xe8c35a);
      } else if (!this.pointSprites.has(key)) {
        const id = p.kind === POINT.derrick ? 'pt_derrick' : p.kind === POINT.watchtower ? 'pt_watchtower' : 'pt_depot';
        const tex = this.lib.texture(id, 'body', 'idle', 0, 0, 'color');
        if (tex) {
          const sh = this.lib.texture(id, 'body', 'idle', 0, 0, 'shadow');
          if (sh) {
            const shadow = new Sprite(sh);
            shadow.anchor.set(0.5);
            shadow.position.set(px, py);
            shadow.scale.set(p.kind === POINT.watchtower ? 1 : 1.3);
            this.culler.add(shadow, this.propShadows, px, py);
          }
          const sp = new Sprite(tex);
          sp.anchor.set(0.5);
          sp.position.set(px, py);
          sp.scale.set(p.kind === POINT.watchtower ? 1 : 1.3);
          sp.zIndex = py;
          this.culler.add(sp, this.ground, px, py);
          this.pointSprites.add(key);
        }
      }
      if (this.pointSprites.has(key) || p.kind === POINT.hill) {
        // Drawn by the sprite (or the flag above).
      } else if (p.kind === POINT.derrick) {
        this.overlay.poly([px - 7, py, px - 3, py - 26, px + 3, py - 26, px + 7, py]).fill(0x3b3f45).stroke({ width: 1.5, color });
        this.overlay.circle(px, py - 28, 4).fill(0x3ee6ff);
      } else if (p.kind === POINT.watchtower) {
        this.overlay.rect(px - 2, py - 38, 4, 38).fill(0x4a4036);
        this.overlay.rect(px - 9, py - 44, 18, 7).fill(0x5a4c3e).stroke({ width: 1.5, color });
      } else {
        this.overlay.rect(px - 10, py - 14, 20, 12).fill(0x3b3f45).stroke({ width: 1.5, color });
        this.overlay.rect(px - 1.5, py - 12, 3, 8).fill(0x6dff8a);
        this.overlay.rect(px - 4, py - 9.5, 8, 3).fill(0x6dff8a);
      }
      if (p.capturer >= 0 && p.progress > 0) {
        const team = s.players.findIndex((x) => x.team === p.capturer);
        const c = TEAM_COLORS[Math.max(0, team) % TEAM_COLORS.length]!;
        const t = p.progress / CAPTURE_TICKS;
        this.overlay.arc(px, py - 70, 9, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2).stroke({ width: 3, color: c });
      }
    }
  }

  /**
   * Campaign objectives, through fog: a gold ring on areas to reach or hold, a bouncing gold arrow over
   * targets to destroy, and a green ring around the unit to keep alive.
   */
  private drawObjectives(): void {
    const cur = this.state.cur;
    if (!cur || !this.state.mission) return;
    const t = performance.now() / 1000;
    const bob = 4 * Math.sin(t * 4);
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    // Two objectives can point at the same target (the first relay, then all of them): draw it once.
    const drawn = new Set<string>();
    for (const m of cur.markers()) {
      const key = `${m.kind}:${m.x}:${m.y}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      const px = isoX(m.x / FX, m.y / FX);
      const py = isoY(m.x / FX, m.y / FX);
      if (m.kind === MARKER.area) {
        const rx = m.r * (TILE_W / 2) * Math.SQRT2;
        this.decals.ellipse(px, py, rx, rx / 2).fill({ color: 0xffd34d, alpha: 0.05 + 0.05 * pulse }).stroke({ width: 2.5, color: 0xffd34d, alpha: 0.9 });
        this.overlay.poly([px - 9, py - 46 + bob, px + 9, py - 46 + bob, px, py - 32 + bob]).fill(0xffd34d).stroke({ width: 1.5, color: 0x1a1a1a });
      } else if (m.kind === MARKER.target) {
        this.decals.ellipse(px, py, 34, 17).stroke({ width: 2, color: 0xffd34d, alpha: 0.5 + 0.4 * pulse });
        this.overlay.poly([px - 10, py - 78 + bob, px + 10, py - 78 + bob, px, py - 62 + bob]).fill(0xffd34d).stroke({ width: 1.5, color: 0x1a1a1a });
      } else {
        this.decals.ellipse(px, py, 22, 11).stroke({ width: 2.5, color: 0x6dff8a, alpha: 0.6 + 0.4 * pulse });
      }
    }
  }

  /** Crates on the map: a sprite each, bobbing a little, with a glint so they catch the eye. */
  private drawCrates(): void {
    const s = this.state;
    const cur = s.cur;
    if (!cur) return;
    const seen = new Set<number>();
    const t = performance.now() / 1000;
    for (const c of cur.crates()) {
      const key = c.y * s.width + c.x;
      if (s.fog && !s.spectator && (s.fog[key]! & 1) === 0) continue;
      seen.add(key);
      const px = isoX(c.x + 0.5, c.y + 0.5);
      const py = isoY(c.x + 0.5, c.y + 0.5);
      let sp = this.crateSprites.get(key);
      if (!sp) {
        const tex = this.lib.texture('pt_crate', 'body', 'idle', 0, 0, 'color');
        if (!tex) continue;
        sp = new Sprite(tex);
        sp.anchor.set(0.5);
        sp.zIndex = py;
        this.ground.addChild(sp);
        this.crateSprites.set(key, sp);
      }
      sp.position.set(px, py - 2 - 2 * Math.sin(t * 3 + key));
      const glint = 0.5 + 0.5 * Math.sin(t * 4 + key);
      this.overlay.circle(px + 4, py - 20, 2 + glint * 2).fill({ color: 0xffe28a, alpha: 0.4 + 0.5 * glint });
    }
    for (const [key, sp] of this.crateSprites)
      if (!seen.has(key)) {
        sp.destroy();
        this.crateSprites.delete(key);
      }
  }

  /** A weapon range circle of r tiles around a world point (an ellipse on the iso grid). */
  private rangeRing(px: number, py: number, r: number, color: number): void {
    const rx = r * (TILE_W / 2) * Math.SQRT2;
    this.decals.ellipse(px, py, rx, rx / 2).fill({ color, alpha: 0.04 }).stroke({ width: 1, color, alpha: 0.4 });
  }

  /** Targeting a support power: its area under the cursor. */
  private drawPowerTarget(): void {
    const s = this.state;
    if (s.mode !== 'power') return;
    const power = s.rules.factions[s.players[s.localPlayer]?.faction ?? 0]?.power;
    const p = this.cursorPoint();
    if (!power || !p) return;
    const r = power.kind === 'jam' ? power.radius / FX : power.reach / FX;
    const rx = r * (TILE_W / 2) * Math.SQRT2;
    const px = isoX(p.x / FX, p.y / FX);
    const py = isoY(p.x / FX, p.y / FX);
    const color = power.kind === 'jam' ? 0x3ee6ff : 0xc58cff;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
    this.overlay.ellipse(px, py, rx, rx / 2).fill({ color, alpha: 0.08 + 0.06 * pulse }).stroke({ width: 2, color, alpha: 0.85 });
    this.overlay.ellipse(px, py, rx * 0.6, rx * 0.3).stroke({ width: 1, color, alpha: 0.4 * pulse });
  }

  /**
   * Superweapons: the area under the cursor while targeting, and every strike on its way (seen by
   * everyone, through fog): a red zone with a ring closing in until impact.
   */
  private drawStrikes(): void {
    const s = this.state;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 120);
    const zone = (x: number, y: number, r: number, closing: number) => {
      const rx = r * (TILE_W / 2) * Math.SQRT2;
      const px = isoX(x / FX, y / FX);
      const py = isoY(x / FX, y / FX);
      this.overlay.ellipse(px, py, rx, rx / 2).fill({ color: 0xff3a2a, alpha: 0.1 + 0.08 * pulse }).stroke({ width: 2, color: 0xff5a3a, alpha: 0.9 });
      if (closing >= 0) this.overlay.ellipse(px, py, rx * closing, (rx * closing) / 2).stroke({ width: 3, color: 0xffd0a0, alpha: 0.8 });
      this.overlay.moveTo(px - 10, py).lineTo(px + 10, py).moveTo(px, py - 6).lineTo(px, py + 6).stroke({ width: 2, color: 0xffd0a0, alpha: 0.9 });
    };
    for (const st of s.strikes()) {
      const sw = s.superweaponRule(st.player)?.superweapon;
      if (sw) zone(st.x, st.y, sw.radius / FX, Math.max(0.05, st.left / sw.delay));
    }
    if (s.mode === 'superweapon') {
      const sw = s.superweaponRule()?.superweapon;
      const p = this.cursorPoint();
      if (sw && p) zone(p.x, p.y, sw.radius / FX, -1);
    }
  }

  private drawGhost(): void {
    this.drawPowerTarget();
    this.drawStrikes();
    this.drawPlannedSites();
    const ghost = this.placementGhost();
    if (!ghost) return;
    this.drawBuildRange();
    const color = ghost.error ? 0xff5a5a : 0x6dff8a;
    // A defense being placed shows how far it will shoot.
    if (ghost.rule.weapon) {
      const cx = ghost.tx + ghost.rule.footprintW / 2;
      const cy = ghost.ty + ghost.rule.footprintH / 2;
      this.rangeRing(isoX(cx, cy), isoY(cx, cy), ghost.rule.weapon.range / FX, 0xffb46d);
    }
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

  /** Formation line being drawn (right-drag), with a dot where each unit will stand. */
  drawLine(line: { x0: number; y0: number; x1: number; y1: number } | null, count = 0): void {
    this.screen.clear();
    if (!line) return;
    this.screen.moveTo(line.x0, line.y0).lineTo(line.x1, line.y1).stroke({ width: 2, color: 0x6dff8a, alpha: 0.8 });
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      this.screen.circle(line.x0 + (line.x1 - line.x0) * t, line.y0 + (line.y1 - line.y0) * t, 3).fill({ color: 0x6dff8a, alpha: 0.9 });
    }
  }
}

export type GraphicsQuality = 'ultra' | 'high' | 'balanced' | 'performance';

/** Ultra's render resolution: the screen's pixel density, at most 2. */
export function ultraResolution(): number {
  return Math.min(2, Math.max(1, window.devicePixelRatio || 1));
}
