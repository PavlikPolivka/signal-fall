import { Assets, Texture } from 'pixi.js';

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
    const root = `${this.base}assets/sprites/${faction}/`;
    let catalog: Catalog;
    try {
      const res = await fetch(`${root}catalog.json`);
      if (!res.ok) return; // no art for this faction yet
      catalog = (await res.json()) as Catalog;
    } catch {
      return;
    }
    for (let i = 0; i < catalog.pages; i++) {
      const sheet = (await Assets.load(`${root}atlas-${i}.json`)) as { textures: Record<string, Texture> };
      for (const [name, tex] of Object.entries(sheet.textures)) this.textures.set(name, tex);
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
