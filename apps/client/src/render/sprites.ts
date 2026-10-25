import { Assets, Container, RenderTexture, Sprite, Texture, type Renderer, type TextureSource } from 'pixi.js';

/** Sprite metadata written by tools/assets/pack.ts. */
export interface SpriteInfo {
  kind: 'infantry' | 'vehicle' | 'air' | 'building';
  frame: number;
  dirs: number;
  anims: Record<string, number>;
  turret: boolean;
  footprint?: [number, number];
}

interface Catalog {
  faction: string;
  pages: number;
  sprites: Record<string, SpriteInfo>;
}

export type Pass = 'color' | 'mask' | 'shadow';

/**
 * Loads faction spritesheets on demand and hands out textures by name:
 * `<id>/<part>/<anim>/<dir>/<frame>.<pass>`. Factions without art return null
 * and the renderer falls back to placeholder shapes.
 */
export class SpriteLibrary {
  private sprites = new Map<string, SpriteInfo>();
  private textures = new Map<string, Texture>();
  private loading = new Map<string, Promise<void>>();
  private loaded = new Set<string>();
  /** Atlas pages per faction (to bake them all up front). */
  private pages = new Map<string, TextureSource[]>();

  /** Load the 2x atlases (Ultra graphics on a high-DPI screen); set before anything loads. */
  hiDpi = false;

  /**
   * Bakes team colors into the art (set by the renderer). Drawn live, the team color is a tinted mask
   * multiplied over each sprite, and switching blend modes sprite by sprite costs a draw call per unit
   * (hundreds a frame in a battle, ruinous on Firefox). Baked, a unit is one plain sprite and a whole
   * army draws in a few batches.
   */
  renderer: Renderer | null = null;
  /** Mask frames per atlas page (to bake that page). */
  private pageMasks = new Map<TextureSource, string[]>();
  /** Baked pages, by page and team color. */
  private baked = new Map<TextureSource, Map<number, TextureSource>>();
  /** Baked frame textures, by `color:name`. */
  private coloredTextures = new Map<string, Texture>();

  /** Base URL for assets (Vite serves /public at the root). */
  constructor(private readonly base = import.meta.env.BASE_URL) {}

  loadFaction(faction: string): Promise<void> {
    let p = this.loading.get(faction);
    if (!p) {
      p = this.doLoad(faction);
      this.loading.set(faction, p);
    }
    return p;
  }

  private async doLoad(faction: string): Promise<void> {
    let root = `${this.base}assets/sprites/${faction}/`;
    let catalog: Catalog;
    try {
      // 2x pages when asked for and present, else the 1x ones.
      let res = this.hiDpi ? await fetch(`${this.base}assets/sprites/${faction}@2x/catalog.json`) : null;
      if (res?.ok) root = `${this.base}assets/sprites/${faction}@2x/`;
      else res = await fetch(`${root}catalog.json`);
      if (!res.ok) return; // no art for this faction yet
      catalog = (await res.json()) as Catalog;
    } catch {
      return;
    }
    for (let i = 0; i < catalog.pages; i++) {
      const sheet = (await Assets.load(`${root}atlas-${i}.json`)) as { textures: Record<string, Texture> };
      // Mipmaps: zoomed out, sprites sample a pre-shrunk page instead of shimmering.
      const source = Object.values(sheet.textures)[0]?.source;
      if (source && !source.autoGenerateMipmaps) {
        source.autoGenerateMipmaps = true;
        source.style.mipmapFilter = 'linear';
        source.style.update();
        source.updateMipmaps();
      }
      if (source) this.pages.set(faction, [...(this.pages.get(faction) ?? []), source]);
      for (const [name, tex] of Object.entries(sheet.textures)) {
        this.textures.set(name, tex);
        if (name.endsWith('.mask')) {
          const list = this.pageMasks.get(tex.source) ?? [];
          list.push(name);
          this.pageMasks.set(tex.source, list);
        }
      }
    }
    for (const [id, info] of Object.entries(catalog.sprites)) this.sprites.set(id, info);
    this.loaded.add(faction);
  }

  /** Whether rendered art (and icons) exist for a faction. */
  has(faction: string): boolean {
    return this.loaded.has(faction);
  }

  info(id: string): SpriteInfo | undefined {
    return this.sprites.get(id);
  }

  texture(id: string, part: string, anim: string, dir: number, frame: number, pass: Pass): Texture | null {
    return this.textures.get(`${id}/${part}/${anim}/${String(dir).padStart(2, '0')}/${frame}.${pass}`) ?? null;
  }

  /**
   * The color pass with the team color already in it (null without art, or when the renderer can't bake):
   * one sprite instead of a body and a multiplied team layer.
   */
  colored(id: string, part: string, anim: string, dir: number, frame: number, color: number): Texture | null {
    const name = `${id}/${part}/${anim}/${String(dir).padStart(2, '0')}/${frame}`;
    const key = `${color}:${name}`;
    const hit = this.coloredTextures.get(key);
    if (hit) return hit;
    const tex = this.textures.get(`${name}.color`);
    if (!tex || !this.renderer) return null;
    const page = this.bake(tex.source, color);
    if (!page) return null;
    const out = new Texture({ source: page, frame: tex.frame.clone(), orig: tex.orig.clone(), trim: tex.trim?.clone(), defaultAnchor: tex.defaultAnchor });
    this.coloredTextures.set(key, out);
    return out;
  }

  /** Bake a faction's pages in a team color ahead of time (match start), so no page is baked mid-game. */
  prebake(faction: string, color: number): void {
    if (!this.renderer) return;
    for (const page of this.pages.get(faction) ?? []) this.bake(page, color);
  }

  /** A copy of an atlas page with every mask, tinted `color`, multiplied onto its color frame (once per page and color). */
  private bake(source: TextureSource, color: number): TextureSource | null {
    let byColor = this.baked.get(source);
    if (!byColor) this.baked.set(source, (byColor = new Map()));
    const done = byColor.get(color);
    if (done) return done;
    const renderer = this.renderer!;
    const scene = new Container();
    scene.addChild(new Sprite(new Texture({ source })));
    for (const maskName of this.pageMasks.get(source) ?? []) {
      const mask = this.textures.get(maskName)!;
      const col = this.textures.get(maskName.slice(0, -5) + '.color');
      if (!col || col.source !== source) continue;
      // Place the mask over its color frame: both are trimmed out of the same cell, by different boxes.
      const sp = new Sprite(new Texture({ source, frame: mask.frame.clone() }));
      sp.position.set(col.frame.x + (mask.trim?.x ?? 0) - (col.trim?.x ?? 0), col.frame.y + (mask.trim?.y ?? 0) - (col.trim?.y ?? 0));
      sp.tint = color;
      sp.blendMode = 'multiply';
      scene.addChild(sp);
    }
    const target = RenderTexture.create({ width: source.width, height: source.height, resolution: source.resolution });
    renderer.render({ container: scene, target, clear: true, clearColor: [0, 0, 0, 0] });
    scene.destroy({ children: true });
    const page = target.source;
    page.autoGenerateMipmaps = true;
    page.style.mipmapFilter = 'linear';
    page.style.update();
    page.updateMipmaps();
    byColor.set(color, page);
    return page;
  }

  /** Sprite direction index for a sim binary angle (4096 per turn, 0 = +x). */
  static dirFor(angle: number, dirs: number): number {
    const step = 4096 / dirs;
    return ((Math.round((((angle % 4096) + 4096) % 4096) / step) % dirs) + dirs) % dirs;
  }

  /** URL of a sidebar icon / portrait for a sprite id. */
  icon(faction: string, id: string): string {
    return `${this.base}assets/icons/${faction}/${id}.png`;
  }
}
