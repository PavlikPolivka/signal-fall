import { Assets, Container, Matrix, Mesh, MeshGeometry, MeshSimple, Shader, Texture } from 'pixi.js';
import { TERRAIN } from '@signal-fall/sim';
import { TILE_H, TILE_W } from '../game/iso';

const vertex = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
out vec2 vTile;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vTile = aUV;
}`;

/** Screen height of a cliff (mesa) face in px. */
export const CLIFF_H = 32;

// Splat map channels (one texel per tile, linearly filtered for soft blends):
//   uSplat:   r = rough ground, g = water, b = ground variant, a = obstacle base (rock / cliff / ruins)
//   uSurface: r = road, g = ford / bridge, b = plaza paving
const fragment = /* glsl */ `
in vec2 vTile;
uniform sampler2D uSplat;
uniform sampler2D uSurface;
uniform sampler2D uGround;
uniform sampler2D uGround2;
uniform sampler2D uRough;
uniform sampler2D uWater;
uniform sampler2D uRoad;
uniform sampler2D uPlaza;
uniform sampler2D uNoise;
uniform vec2 uMapSize;
uniform float uTime;
uniform float uBridge;

float edge(float w, float n) {
  // Noise-broken, fairly crisp transitions: gritty edges instead of soft gradients.
  return smoothstep(0.38, 0.62, w + (n - 0.5) * 0.55);
}

void main() {
  // Screen-space texture coordinates keep the textures undistorted by the iso projection.
  vec2 px = vec2(${TILE_W / 2}.0 * (vTile.x - vTile.y), ${TILE_H / 2}.0 * (vTile.x + vTile.y));
  vec2 tuv = px / 320.0;
  vec4 splat = texture(uSplat, vTile / uMapSize);
  float n = texture(uNoise, px / 340.0).r;
  float n2 = texture(uNoise, px / 97.0 + 0.37).r;

  // Two differently scaled copies of each texture, blended by large-scale noise, hide the repeat.
  float big = texture(uNoise, px / 900.0 + 0.13).r;
  vec2 tuv2 = mat2(0.8, -0.6, 0.6, 0.8) * tuv * 0.57 + 0.31;
  vec3 col = mix(texture(uGround, tuv).rgb, texture(uGround, tuv2).rgb, smoothstep(0.35, 0.65, big));
  vec3 g2 = mix(texture(uGround2, tuv * 0.83 + 0.21).rgb, texture(uGround2, tuv2 * 1.1).rgb, smoothstep(0.35, 0.65, n));
  col = mix(col, g2, edge(splat.b, n));
  col = mix(col, texture(uRough, tuv * 1.17).rgb, edge(splat.r, n2));
  vec4 surf = texture(uSurface, vTile / uMapSize);
  // Roads: crisp worn edges with a lighter shoulder line, then the surface.
  vec3 road = mix(texture(uRoad, tuv * 0.9).rgb, texture(uRoad, tuv2).rgb, 0.4);
  float rw = surf.r + (n2 - 0.5) * 0.18;
  col = mix(col, col * 1.18 + 0.03, smoothstep(0.22, 0.32, rw) * (1.0 - smoothstep(0.4, 0.5, rw)) * 0.8);
  col = mix(col, road, smoothstep(0.4, 0.5, rw));
  // Plaza paving is sampled in tile space so the slabs follow the iso grid.
  vec3 paving = texture(uPlaza, vTile * 0.25).rgb * (0.9 + 0.2 * n);
  col = mix(col, paving, edge(surf.b, n * 0.6 + 0.2));
  // Obstacle bases: rough, darkened ground under rocks and ruins.
  float ob = edge(splat.a, n);
  col = mix(col, texture(uRough, tuv * 1.4 + 0.5).rgb * 0.62, ob);
  // Water: animated ripples, darker wet shore band around it.
  float wet = smoothstep(0.12, 0.45, splat.g + (n - 0.5) * 0.3);
  col *= 1.0 - wet * 0.35;
  vec2 flow = vec2(uTime * 0.01, uTime * 0.006);
  vec3 water = mix(texture(uWater, tuv + flow).rgb, texture(uWater, tuv * 1.3 - flow * 0.7).rgb, 0.5);
  col = mix(col, water, edge(splat.g, n2));
  // Crossings: a shallow ford with wet stones, or in the city a concrete causeway.
  float ford = edge(surf.g, n2);
  vec3 shallow = mix(col * 0.75, water, 0.45);
  vec3 deck = mix(texture(uPlaza, vTile * 0.25).rgb * 0.85, road, 0.5);
  col = mix(col, mix(shallow, deck, uBridge), ford);
  // Large-scale light variation (clouds / terrain undulation).
  col *= 0.88 + 0.24 * texture(uNoise, px / 1400.0).r;
  gl_FragColor = vec4(col, 1.0);
}`;

// Mesa tops: the obstacle tiles' rough ground raised by CLIFF_H, crisp along the tile grid.
const topFragment = /* glsl */ `
in vec2 vTile;
uniform sampler2D uCliffMask;
uniform sampler2D uGround;
uniform sampler2D uRough;
uniform sampler2D uNoise;
uniform vec2 uMapSize;

float cliffAt(vec2 t) { return texture(uCliffMask, t / uMapSize).a; }

void main() {
  if (cliffAt(vTile) < 0.5) discard;
  vec2 px = vec2(${TILE_W / 2}.0 * (vTile.x - vTile.y), ${TILE_H / 2}.0 * (vTile.x + vTile.y));
  vec2 tuv = px / 320.0;
  float n = texture(uNoise, px / 210.0).r;
  vec3 col = mix(texture(uRough, tuv * 1.1 + 0.3).rgb, texture(uGround, tuv * 0.9).rgb, smoothstep(0.3, 0.7, n)) * 1.06;
  // Lighter lip along the drop on every exposed edge.
  float d = 0.18;
  float lip = 4.0 - cliffAt(vTile + vec2(d, 0.0)) - cliffAt(vTile - vec2(d, 0.0)) - cliffAt(vTile + vec2(0.0, d)) - cliffAt(vTile - vec2(0.0, d));
  col = mix(col, col * 1.35, clamp(lip, 0.0, 1.0) * 0.6);
  col *= 0.88 + 0.24 * texture(uNoise, px / 1400.0).r;
  gl_FragColor = vec4(col, 1.0);
}`;

/** Deterministic smooth noise in [0,1) per tile, for ground variant patches. */
function variant(x: number, y: number): number {
  const h = (a: number, b: number) => {
    let v = Math.imul(a, 374761393) + Math.imul(b, 668265263);
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  };
  const s = 7;
  const x0 = Math.floor(x / s);
  const y0 = Math.floor(y / s);
  const tx = x / s - x0;
  const ty = y / s - y0;
  const a = h(x0, y0) + (h(x0 + 1, y0) - h(x0, y0)) * tx;
  const b = h(x0, y0 + 1) + (h(x0 + 1, y0 + 1) - h(x0, y0 + 1)) * tx;
  return a + (b - a) * ty;
}

/**
 * Terrain drawn as one textured mesh with a splat-map shader: smooth, noisy
 * blends between ground, rough ground, water and obstacle bases.
 */
export class TerrainLayer {
  private mesh: Mesh<MeshGeometry, Shader> | null = null;
  private shader: Shader | null = null;
  private start = performance.now();

  /** Ground-level decals (craters) drawn over the terrain, under cliffs. */
  readonly groundDecor = new Container();
  /** Props standing on mesa tops. */
  readonly topDecor = new Container();

  /** Whether a tile is a raised mesa (cliff). */
  static isMesa(t: number): boolean {
    return t === TERRAIN.cliff;
  }

  async build(layer: Container, biome: string, width: number, height: number, terrain: Uint8Array, surface: Uint8Array): Promise<void> {
    const base = `${import.meta.env.BASE_URL}assets/terrain/`;
    const load = async (name: string) => {
      const tex = (await Assets.load(`${base}${name}`)) as Texture;
      tex.source.style.addressMode = 'repeat';
      // Mipmaps: photo textures shimmer when zoomed out without them.
      tex.source.style.mipmapFilter = 'linear';
      tex.source.autoGenerateMipmaps = true;
      tex.source.style.update();
      tex.source.updateMipmaps();
      return tex;
    };
    const [ground, ground2, rough, water, road, plaza, cliff, noise] = await Promise.all([
      load(`${biome}/ground.jpg`),
      load(`${biome}/ground2.jpg`),
      load(`${biome}/rough.jpg`),
      load(`${biome}/water.png`),
      load(`${biome}/road.jpg`),
      load(`${biome}/plaza.jpg`),
      load(`${biome}/cliff.jpg`),
      load('noise.png'),
    ]);
    const splatTexture = (fill: (x: number, y: number, i: number, out: Uint8ClampedArray, o: number) => void, linear: boolean) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      const img = ctx.createImageData(width, height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) fill(x, y, y * width + x, img.data, (y * width + x) * 4);
      ctx.putImageData(img, 0, 0);
      const tex = Texture.from(canvas);
      tex.source.style.scaleMode = linear ? 'linear' : 'nearest';
      // Premultiplied alpha would wipe colour where a = 0; we read raw channels.
      tex.source.alphaMode = 'no-premultiply-alpha';
      return tex;
    };
    const surf = splatTexture((_x, _y, i, d, o) => {
      const v = surface[i] ?? 0;
      d[o] = v === 1 ? 255 : 0;
      d[o + 1] = v === 2 ? 255 : 0;
      d[o + 2] = v === 3 ? 255 : 0;
      d[o + 3] = 255;
    }, true);
    const cliffMask = splatTexture((_x, _y, i, d, o) => {
      d[o + 3] = TerrainLayer.isMesa(terrain[i]!) ? 255 : 0;
    }, false);

    // Splat map: one texel per tile.
    const splat = splatTexture((x, y, i, d, o) => {
      const t = terrain[i]!;
      d[o] = t === TERRAIN.rough ? 255 : 0;
      d[o + 1] = t === TERRAIN.water ? 255 : 0;
      d[o + 2] = variant(x, y) > 0.55 ? 255 : 0;
      d[o + 3] = t === TERRAIN.rock || t === TERRAIN.cliff || t === TERRAIN.ruins ? 255 : 0;
    }, true);

    this.shader = Shader.from({
      gl: { vertex, fragment },
      resources: {
        uSplat: splat.source,
        uSurface: surf.source,
        uGround: ground.source,
        uGround2: ground2.source,
        uRough: rough.source,
        uWater: water.source,
        uRoad: road.source,
        uPlaza: plaza.source,
        uNoise: noise.source,
        terrainUniforms: {
          uMapSize: { value: [width, height], type: 'vec2<f32>' },
          uTime: { value: 0, type: 'f32' },
          uBridge: { value: biome === 'city' ? 1 : 0, type: 'f32' },
        },
      },
    });
    const topShader = Shader.from({
      gl: { vertex, fragment: topFragment },
      resources: {
        uCliffMask: cliffMask.source,
        uGround: ground.source,
        uRough: rough.source,
        uNoise: noise.source,
        topUniforms: { uMapSize: { value: [width, height], type: 'vec2<f32>' } },
      },
    });
    const geometry = new MeshGeometry({
      positions: new Float32Array([0, 0, width, 0, width, height, 0, height]),
      uvs: new Float32Array([0, 0, width, 0, width, height, 0, height]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    this.mesh = new Mesh({ geometry, shader: this.shader });
    // Tile space -> iso world px, like the fog layer.
    this.mesh.setFromMatrix(new Matrix(TILE_W / 2, TILE_H / 2, -TILE_W / 2, TILE_H / 2, 0, 0));
    const top = new Mesh({ geometry, shader: topShader });
    top.setFromMatrix(new Matrix(TILE_W / 2, TILE_H / 2, -TILE_W / 2, TILE_H / 2, 0, -CLIFF_H));
    layer.removeChildren();
    layer.addChild(this.mesh, this.groundDecor, ...this.cliffFaces(cliff, width, height, terrain), top, this.topDecor);
  }

  /**
   * Cliff faces on the two visible sides of every mesa tile (+x faces lower right, +y lower left),
   * each a quad from the raised top edge down to the ground.
   */
  private cliffFaces(tex: Texture, width: number, height: number, terrain: Uint8Array): MeshSimple[] {
    const mesa = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && TerrainLayer.isMesa(terrain[y * width + x]!);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    const iso = (u: number, v: number): [number, number] => [(u - v) * hw, (u + v) * hh];
    const build = (side: 'x' | 'y', tint: number) => {
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          if (!mesa(x, y)) continue;
          const open = side === 'x' ? x + 1 < width && !mesa(x + 1, y) : y + 1 < height && !mesa(x, y + 1);
          if (!open) continue;
          // Edge endpoints at ground level, ordered left to right on screen.
          const [a, b] = side === 'x' ? [iso(x + 1, y), iso(x + 1, y + 1)] : [iso(x, y + 1), iso(x + 1, y + 1)];
          const along = side === 'x' ? y : x;
          const k = pos.length / 2;
          pos.push(a[0], a[1] - CLIFF_H, b[0], b[1] - CLIFF_H, b[0], b[1], a[0], a[1]);
          const u0 = along * 0.55;
          uv.push(u0, 0, u0 + 0.55, 0, u0 + 0.55, 1, u0, 1);
          idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
        }
      const m = new MeshSimple({ texture: tex, vertices: new Float32Array(pos), uvs: new Float32Array(uv), indices: new Uint32Array(idx) });
      m.tint = tint;
      return m;
    };
    // Light comes from the upper left: the lower-left faces are lit, the lower-right ones in shade.
    return [build('x', 0x9a9a9a), build('y', 0xe6e6e6)];
  }

  update(): void {
    if (!this.shader) return;
    const u = this.shader.resources.terrainUniforms as { uniforms: { uTime: number } };
    u.uniforms.uTime = (performance.now() - this.start) / 1000;
  }
}
