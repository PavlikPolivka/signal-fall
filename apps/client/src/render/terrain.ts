import { Assets, BufferImageSource, Container, Mesh, MeshGeometry, Shader, Texture } from 'pixi.js';
import { TERRAIN } from '@signal-fall/sim';
import { isoX, isoY, TILE_H, TILE_W } from '../game/iso';

/** Screen height of a cliff (mesa) top above the ground in px. */
export const CLIFF_H = 38;

/** Height-field samples per tile (lighting and cliff mesh resolution). */
const RES = 4;
/** Screen px of lift per tile of real height: converts px heights into slopes for the lighting. */
const PX_PER_TILE = 40;
/** Toward the sun, in tile space (x = +u, y = +v, z = up): from the left and a little above, like the unit renders. */
const SUN_DIR = (() => {
  const e = (40 * Math.PI) / 180;
  const h = Math.hypot(-0.75, 0.45);
  return [(Math.cos(e) * -0.75) / h, (Math.cos(e) * 0.45) / h, Math.sin(e)] as const;
})();

const vertex = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
out vec2 vTile;
out vec2 vScreen;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vTile = aUV;
  vScreen = aPosition;
}`;

// Masks (one texel per tile, linear):
//   uMask1: r = rough ground, g = water, b = ground variant, a = obstacle base (rock / cliff / ruins)
//   uMask2: r = road, g = ford / bridge, b = plaza paving, a = Echo field (stained ground)
// uLight (RES texels per tile): r, g = surface normal x, y; b = sun visibility (cast shadows); a = ambient occlusion.
// Relief maps (*N): r, g = the material's normal (OpenGL), b = its height, for height-based blending.
const fragment = /* glsl */ `
in vec2 vTile;
in vec2 vScreen;
uniform sampler2D uMask1;
uniform sampler2D uMask2;
uniform sampler2D uLight;
uniform sampler2D uNoise;
uniform sampler2D uGround;
uniform sampler2D uGround2;
uniform sampler2D uRough;
uniform sampler2D uRoad;
uniform sampler2D uPlaza;
uniform sampler2D uCliff;
uniform sampler2D uGroundN;
uniform sampler2D uRoughN;
uniform sampler2D uRoadN;
uniform sampler2D uCliffN;
uniform vec2 uMapSize;
uniform vec2 uLightSize;
uniform float uTime;
uniform float uBridge;
uniform float uRoughGain;
uniform vec3 uWaterTint;

const vec3 SUN = vec3(${SUN_DIR.map((v) => v.toFixed(4)).join(', ')});
const vec3 VIEW = vec3(0.55, 0.55, 0.63);

float edge(float w, float n) {
  return smoothstep(0.38, 0.62, w + (n - 0.5) * 0.55);
}

// Weight of material B over A from the blend mask and both materials' heights:
// the higher surface wins near the boundary, so stones poke through and sand settles between them.
float hblend(float w, float hA, float hB) {
  float a = hA * 0.6 + (1.0 - w);
  float b = hB * 0.6 + w;
  return smoothstep(-0.06, 0.06, b - a);
}

void main() {
  // Screen-space texture coordinates keep the textures undistorted by the iso projection.
  vec2 px = vec2(${TILE_W / 2}.0 * (vTile.x - vTile.y), ${TILE_H / 2}.0 * (vTile.x + vTile.y));
  vec2 tuv = px / 320.0;
  vec2 mt = vTile / uMapSize;
  vec4 m1 = texture(uMask1, mt);
  vec4 m2 = texture(uMask2, mt);
  vec4 light = texture(uLight, (vTile * ${RES}.0 + 0.5) / uLightSize);
  float n = texture(uNoise, px / 340.0).r;
  float n2 = texture(uNoise, px / 97.0 + 0.37).r;

  // Two differently scaled copies of each texture, blended by large-scale noise, hide the repeat.
  float big = texture(uNoise, px / 900.0 + 0.13).r;
  vec2 tuv2 = mat2(0.8, -0.6, 0.6, 0.8) * tuv * 0.57 + 0.31;
  float bw = smoothstep(0.35, 0.65, big);
  vec3 col = mix(texture(uGround, tuv).rgb, texture(uGround, tuv2).rgb, bw);
  vec3 rel = mix(texture(uGroundN, tuv).rgb, texture(uGroundN, tuv2).rgb, bw);
  vec3 g2 = mix(texture(uGround2, tuv * 0.83 + 0.21).rgb, texture(uGround2, tuv2 * 1.1).rgb, smoothstep(0.35, 0.65, n));
  col = mix(col, g2, edge(m1.b, n));

  // Rough ground blends in by height.
  vec2 ruv = tuv * 1.17;
  vec3 rough = texture(uRough, ruv).rgb * uRoughGain;
  vec3 roughN = texture(uRoughN, ruv).rgb;
  float wr = hblend(m1.r + (n2 - 0.5) * 0.35, rel.b, roughN.b);
  col = mix(col, rough, wr);
  rel = mix(rel, roughN, wr);

  // Roads: worn edges with a lighter shoulder line, then the surface.
  vec3 road = mix(texture(uRoad, tuv * 0.9).rgb, texture(uRoad, tuv2).rgb, 0.4);
  float rw = m2.r + (n2 - 0.5) * 0.18;
  col = mix(col, col * 1.18 + 0.03, smoothstep(0.22, 0.32, rw) * (1.0 - smoothstep(0.4, 0.5, rw)) * 0.8);
  float roadW = smoothstep(0.4, 0.5, rw);
  col = mix(col, road, roadW);
  rel = mix(rel, texture(uRoadN, tuv * 0.9).rgb, roadW);
  // Plaza paving is sampled in tile space so the slabs follow the iso grid.
  vec3 paving = texture(uPlaza, vTile * 0.25).rgb * (0.9 + 0.2 * n);
  float pw = edge(m2.b, n * 0.6 + 0.2);
  col = mix(col, paving, pw);
  rel = mix(rel, vec3(0.5, 0.5, 0.5), pw * 0.7);

  // Obstacle bases: rough, darker ground under rocks and ruins.
  vec3 obN = texture(uRoughN, tuv * 1.4 + 0.5).rgb;
  float ob = hblend(m1.a + (n - 0.5) * 0.4, rel.b, obN.b);
  col = mix(col, texture(uRough, tuv * 1.4 + 0.5).rgb * 0.8 * uRoughGain, ob);
  rel = mix(rel, obN, ob);

  // Echo fields: the ground around the crystals is stained a dark teal with faint glowing veins.
  float stain = smoothstep(0.1, 0.7, m2.a + (n2 - 0.5) * 0.5);
  float vn = texture(uNoise, px / 180.0 + 0.71).r;
  float vein = smoothstep(0.485, 0.5, vn) * (1.0 - smoothstep(0.5, 0.515, vn));
  col = mix(col, col * vec3(0.62, 0.86, 0.9) + vec3(0.0, 0.03, 0.04), stain * 0.8);

  // Macro shape from the height field; slopes show bare rock, mapped on the screen so faces aren't stretched.
  vec3 nm = vec3(light.rg * 2.0 - 1.0, 0.0);
  nm.z = sqrt(max(0.02, 1.0 - dot(nm.xy, nm.xy)));
  float steep = 1.0 - smoothstep(0.5, 0.8, nm.z);
  vec2 cuv = vScreen / vec2(300.0, 240.0);
  vec3 cliff = mix(texture(uCliff, cuv).rgb, texture(uCliff, cuv * 0.61 + 0.3).rgb, 0.35) * 1.2;
  col = mix(col, cliff, steep);
  rel = mix(rel, texture(uCliffN, cuv).rgb, steep);

  // Lighting: the macro normal tilted by the material's own relief (texture axes run along the screen).
  vec2 d = rel.rg * 2.0 - 1.0;
  vec2 dw = d.x * vec2(0.7071, -0.7071) + d.y * vec2(-0.7071, -0.7071);
  vec3 N = normalize(nm + vec3(dw * 1.3, 0.0));
  float cloud = 1.0 - 0.32 * smoothstep(0.42, 0.72, texture(uNoise, px / 2600.0 + uTime * vec2(0.0035, 0.0012)).r);
  float sun = max(dot(N, SUN), 0.0) * light.b * cloud;
  float amb = (0.5 + 0.15 * N.z) * light.a;
  // Flat open ground in sunlight comes out at about 1.0, the brightness the textures were graded for.
  col *= (amb * vec3(0.9, 0.95, 1.06) + sun * 0.66 * vec3(1.08, 1.0, 0.88)) / 1.05;

  col += vec3(0.03, 0.18, 0.2) * vein * stain * (0.5 + 0.5 * sin(uTime * 1.3 + n * 9.0));

  // Water: depth from the blurred water mask, darker deep middle, foam line, sun glints on the ripples.
  float deep = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.785;
    deep += texture(uMask1, mt + vec2(cos(a), sin(a)) * (1.5 + float(k - k / 2 * 2) * 2.0) / uMapSize).g;
  }
  deep *= 0.125;
  float wet = smoothstep(0.08, 0.45, m1.g + (n - 0.5) * 0.3);
  col *= 1.0 - wet * 0.35;
  float ws = edge(m1.g, n2);
  vec2 flow = vec2(uTime * 0.012, uTime * 0.007);
  float r1 = texture(uNoise, px / 60.0 + flow * 3.0).r;
  float r2 = texture(uNoise, px / 45.0 - flow * 2.3 + 0.5).r;
  vec3 shallowW = mix(vec3(0.2, 0.32, 0.31), uWaterTint, 0.35);
  vec3 deepW = mix(vec3(0.02, 0.06, 0.09), uWaterTint * 0.25, 0.3);
  vec3 water = mix(shallowW, deepW, smoothstep(0.3, 0.9, deep));
  water = mix(water, col * 0.75, (1.0 - smoothstep(0.25, 0.65, deep)) * 0.4);
  // A broad sheen where the ripples face the sun, no sparkle noise.
  vec3 wn = normalize(vec3((r1 - 0.5) * 0.7, (r2 - 0.5) * 0.7, 1.0));
  float spec = pow(max(dot(wn, normalize(SUN + VIEW)), 0.0), 10.0);
  water *= 0.9 + 0.2 * r1;
  water += vec3(1.0, 0.95, 0.85) * spec * 0.12 * light.b * cloud;
  float g = m1.g + (n2 - 0.5) * 0.25;
  float foam = smoothstep(0.28, 0.42, g) * (1.0 - smoothstep(0.48, 0.62, g));
  foam *= 0.6 + 0.4 * sin(uTime * 1.7 + n2 * 14.0);
  water = mix(water, vec3(0.78, 0.8, 0.76) * (0.6 + 0.4 * light.b), foam * 0.7);
  col = mix(col, water, max(ws, foam * 0.8));
  // Crossings: a shallow ford with wet stones, or in the city a concrete causeway.
  float ford = edge(m2.g, n2);
  // Shallow wet gravel: the bed shows through a thin sheet of water with ripples catching the light.
  vec3 bed = texture(uRough, tuv * 1.6 + 0.2).rgb * uRoughGain * (amb * 0.9 + sun * 0.6);
  vec3 shallow = mix(bed * 0.7, shallowW, 0.3 + 0.2 * r2);
  shallow += vec3(0.75, 0.8, 0.78) * smoothstep(0.6, 0.72, r1 * 0.6 + r2 * 0.4) * 0.22;
  vec3 deck = mix(texture(uPlaza, vTile * 0.25).rgb * 0.85, road, 0.5) * (0.6 + 0.4 * light.b);
  col = mix(col, mix(shallow, deck, uBridge), ford);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Mean brightness (0-1) of a loaded texture, from a small downscaled copy. */
function luma(tex: Texture): number {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(tex.source.resource as CanvasImageSource, 0, 0, 16, 16);
  const d = ctx.getImageData(0, 0, 16, 16).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.3 * d[i]! + 0.59 * d[i + 1]! + 0.11 * d[i + 2]!;
  return sum / (256 * 255);
}

function hash2(a: number, b: number, seed: number): number {
  let v = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(seed, 982451653);
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0,1) (cosmetic, client only). */
function noise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  let tx = x - x0;
  let ty = y - y0;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0, seed) + (hash2(x0 + 1, y0, seed) - hash2(x0, y0, seed)) * tx;
  const b = hash2(x0, y0 + 1, seed) + (hash2(x0 + 1, y0 + 1, seed) - hash2(x0, y0 + 1, seed)) * tx;
  return a + (b - a) * ty;
}

function fbm(x: number, y: number, seed: number): number {
  return noise(x, y, seed) * 0.55 + noise(x * 2.1, y * 2.1, seed + 1) * 0.3 + noise(x * 4.3, y * 4.3, seed + 2) * 0.15;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Separable box blur of a w x h field, in place. */
function blur(f: Float32Array, w: number, h: number, r: number): void {
  const tmp = new Float32Array(f.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += f[y * w + Math.max(0, Math.min(w - 1, x + k))]!;
      tmp[y * w + x] = s / (2 * r + 1);
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.max(0, Math.min(h - 1, y + k)) * w + x]!;
      f[y * w + x] = s / (2 * r + 1);
    }
}

const WATER_TINT: Record<string, [number, number, number]> = {
  wasteland: [0.2, 0.3, 0.28],
  city: [0.16, 0.24, 0.28],
  crystal: [0.2, 0.16, 0.36],
};

/**
 * Terrain drawn as a lit height field: a flat ground quad plus a finer mesh over the cliffs, both with
 * one splat-map shader (photo materials blended by height, normal-mapped, lit by the same sun as the
 * unit renders, with cast shadows and ambient occlusion baked from the height field).
 */
export class TerrainLayer {
  private shader: Shader | null = null;
  private start = performance.now();
  private mask2: BufferImageSource | null = null;
  private size: [number, number] = [0, 0];
  private echoSet = false;
  /** Cliff lift in screen px on the RES grid, for placing props. */
  private lift: Float32Array = new Float32Array(0);

  /** Ground-level decals (craters) drawn over the terrain. */
  readonly groundDecor = new Container();
  /** Props standing on mesa tops. */
  readonly topDecor = new Container();

  /** Whether a tile is a raised mesa (cliff). */
  static isMesa(t: number): boolean {
    return t === TERRAIN.cliff;
  }

  /** Screen px the ground is raised at tile coordinates (u, v): the cliff tops. */
  heightAt(u: number, v: number): number {
    const [w, h] = this.size;
    if (!this.lift.length) return 0;
    const gw = w * RES + 1;
    const gx = Math.max(0, Math.min(w * RES - 0.001, u * RES));
    const gy = Math.max(0, Math.min(h * RES - 0.001, v * RES));
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const ty = gy - y0;
    const at = (x: number, y: number) => this.lift[y * gw + x]!;
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  }

  async build(
    layer: Container,
    biome: string,
    width: number,
    height: number,
    terrain: Uint8Array,
    surface: Uint8Array,
    /** Tiles with a shell crater: pressed into the height field as a scorched bowl with a rim. */
    craters?: (i: number) => boolean,
  ): Promise<void> {
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
    const names = ['ground', 'ground2', 'rough', 'road', 'plaza', 'cliff', 'ground_n', 'rough_n', 'road_n', 'cliff_n'];
    const [tex, noiseTex] = await Promise.all([Promise.all(names.map((n) => load(`${biome}/${n}.jpg`))), load('noise.png')]);
    const t = Object.fromEntries(names.map((n, i) => [n, tex[i]!])) as Record<string, Texture>;

    const buffer = (w: number, h: number, data: Uint8Array) =>
      new BufferImageSource({ resource: data, width: w, height: h, format: 'rgba8unorm', alphaMode: 'no-premultiply-alpha', scaleMode: 'linear' });
    const at = (x: number, y: number) => terrain[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))]!;

    const m1 = new Uint8Array(width * height * 4);
    const m2 = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const tt = terrain[i]!;
        const v = surface[i] ?? 0;
        m1[i * 4] = tt === TERRAIN.rough ? 255 : 0;
        m1[i * 4 + 1] = tt === TERRAIN.water ? 255 : 0;
        m1[i * 4 + 2] = fbm(x / 7, y / 7, 3) > 0.55 ? 255 : 0;
        m1[i * 4 + 3] = tt === TERRAIN.rock || tt === TERRAIN.cliff || tt === TERRAIN.ruins ? 255 : 0;
        m2[i * 4] = v === 1 ? 255 : 0;
        m2[i * 4 + 1] = v === 2 ? 255 : 0;
        m2[i * 4 + 2] = v === 3 ? 255 : 0;
      }
    this.mask2 = buffer(width, height, m2);
    this.echoSet = false;
    this.size = [width, height];

    // Height field on a RES-per-tile grid: cliffs (raised, organic edges), lake beds, gentle hills.
    const gw = width * RES + 1;
    const gh = height * RES + 1;
    const tileField = (pred: (t: number) => boolean) => {
      const f = new Float32Array(gw * gh);
      for (let gy = 0; gy < gh; gy++)
        for (let gx = 0; gx < gw; gx++) {
          // Bilinear between tile centres.
          const u = gx / RES - 0.5;
          const v = gy / RES - 0.5;
          const x0 = Math.floor(u);
          const y0 = Math.floor(v);
          const tx = u - x0;
          const ty = v - y0;
          const s = (x: number, y: number) => (pred(at(x, y)) ? 1 : 0);
          const a = s(x0, y0) + (s(x0 + 1, y0) - s(x0, y0)) * tx;
          const b = s(x0, y0 + 1) + (s(x0 + 1, y0 + 1) - s(x0, y0 + 1)) * tx;
          f[gy * gw + gx] = a + (b - a) * ty;
        }
      return f;
    };
    const cliffF = tileField(TerrainLayer.isMesa);
    blur(cliffF, gw, gh, 1);
    const waterF = tileField((tt) => tt === TERRAIN.water);
    blur(waterF, gw, gh, 3);
    const lift = new Float32Array(gw * gh);
    const hgt = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) {
        const i = gy * gw + gx;
        const u = gx / RES;
        const v = gy / RES;
        const c = smooth(0.42, 0.58, cliffF[i]! + (fbm(u * 0.8, v * 0.8, 11) - 0.5) * 0.5);
        // Rugged tops with ledges; the face itself gets steeper the higher it climbs.
        const top = CLIFF_H + (fbm(u * 1.3, v * 1.3, 17) - 0.5) * 14;
        lift[i] = c * c * (3 - 2 * c) * top;
        // Ridged noise: dry gullies and wind-cut ridges, so open ground has relief between the hills.
        const ridge = 1 - Math.abs(fbm(u / 2.2, v / 2.2, 37) * 2 - 1);
        hgt[i] =
          lift[i]! -
          smooth(0.15, 0.9, waterF[i]!) * 16 +
          (fbm(u / 6, v / 6, 23) - 0.5) * 40 +
          smooth(0.55, 0.95, ridge) * 9 * (1 - c) +
          (noise(u * 1.1, v * 1.1, 29) - 0.5) * 4;
      }
    this.lift = lift;
    // Shell craters: a bowl with a raised lip, its floor scorched.
    const scorch = new Float32Array(gw * gh).fill(1);
    if (craters)
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          if (!craters(y * width + x)) continue;
          const cu = x + 0.3 + hash2(x, y, 51) * 0.4;
          const cv = y + 0.3 + hash2(x, y, 52) * 0.4;
          const r = 0.42 + hash2(x, y, 53) * 0.3;
          const g0x = Math.max(0, Math.floor((cu - r * 1.6) * RES));
          const g1x = Math.min(gw - 1, Math.ceil((cu + r * 1.6) * RES));
          const g0y = Math.max(0, Math.floor((cv - r * 1.6) * RES));
          const g1y = Math.min(gh - 1, Math.ceil((cv + r * 1.6) * RES));
          for (let gy = g0y; gy <= g1y; gy++)
            for (let gx = g0x; gx <= g1x; gx++) {
              const d = Math.hypot(gx / RES - cu, gy / RES - cv) / r;
              const i = gy * gw + gx;
              // Bowl (cosine) inside, rim bump around d = 1, fading out by 1.6.
              const bowl = d < 1 ? -(0.5 + 0.5 * Math.cos(d * Math.PI)) * 8 : 0;
              const rim = Math.exp(-((d - 1) * (d - 1)) / 0.06) * 6;
              hgt[i] = hgt[i]! + (bowl + rim) * r * 1.6;
              scorch[i] = Math.min(scorch[i]!, 0.74 + 0.26 * smooth(0.1, 1.3, d));
            }
        }

    // Bake the light map: normals, cast shadows toward the sun, ambient occlusion.
    const H = (x: number, y: number) => hgt[Math.max(0, Math.min(gh - 1, y)) * gw + Math.max(0, Math.min(gw - 1, x))]!;
    const avg = new Float32Array(hgt);
    blur(avg, gw, gh, 6);
    const lightData = new Uint8Array(gw * gh * 4);
    const tanE = SUN_DIR[2] / Math.hypot(SUN_DIR[0], SUN_DIR[1]);
    const sx = SUN_DIR[0] / Math.hypot(SUN_DIR[0], SUN_DIR[1]);
    const sy = SUN_DIR[1] / Math.hypot(SUN_DIR[0], SUN_DIR[1]);
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) {
        const i = gy * gw + gx;
        const du = ((H(gx + 1, gy) - H(gx - 1, gy)) * RES) / 2 / PX_PER_TILE;
        const dv = ((H(gx, gy + 1) - H(gx, gy - 1)) * RES) / 2 / PX_PER_TILE;
        const l = Math.hypot(du, dv, 1);
        const h0 = hgt[i]!;
        let occ = 0;
        for (let k = 1; k <= 10; k++) {
          const d = k / RES;
          const hs = H(Math.round(gx + sx * k), Math.round(gy + sy * k));
          occ = Math.max(occ, (hs - h0) / PX_PER_TILE - d * tanE);
        }
        const ao = Math.max(0.6, Math.min(1, 1 - (Math.max(0, avg[i]! - h0) / PX_PER_TILE) * 1.0));
        lightData[i * 4] = Math.round((-du / l) * 127.5 + 127.5);
        lightData[i * 4 + 1] = Math.round((-dv / l) * 127.5 + 127.5);
        lightData[i * 4 + 2] = Math.round((1 - smooth(0, 0.18, occ)) * scorch[i]! * 255);
        lightData[i * 4 + 3] = Math.round(ao * scorch[i]! * 255);
      }

    this.shader = Shader.from({
      gl: { vertex, fragment },
      resources: {
        uMask1: buffer(width, height, m1),
        uMask2: this.mask2,
        uLight: buffer(gw, gh, lightData),
        uNoise: noiseTex.source,
        uGround: t.ground!.source,
        uGround2: t.ground2!.source,
        uRough: t.rough!.source,
        uRoad: t.road!.source,
        uPlaza: t.plaza!.source,
        uCliff: t.cliff!.source,
        uGroundN: t.ground_n!.source,
        uRoughN: t.rough_n!.source,
        uRoadN: t.road_n!.source,
        uCliffN: t.cliff_n!.source,
        terrainUniforms: {
          uMapSize: { value: [width, height], type: 'vec2<f32>' },
          uLightSize: { value: [gw, gh], type: 'vec2<f32>' },
          uTime: { value: 0, type: 'f32' },
          uBridge: { value: biome === 'city' ? 1 : 0, type: 'f32' },
          // Rough patches keep their texture but not a much darker tone than the ground around them.
          uRoughGain: { value: Math.min(1.6, Math.max(1, (0.85 * luma(t.ground!)) / Math.max(0.01, luma(t.rough!)))), type: 'f32' },
          uWaterTint: { value: WATER_TINT[biome] ?? WATER_TINT.wasteland!, type: 'vec3<f32>' },
        },
      },
    });

    // Flat ground: one quad over the whole map.
    const corners = [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ];
    const ground = new MeshGeometry({
      positions: new Float32Array(corners.flatMap(([u, v]) => [isoX(u!, v!), isoY(u!, v!)])),
      uvs: new Float32Array(corners.flat()),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    layer.removeChildren();
    layer.addChild(new Mesh({ geometry: ground, shader: this.shader }));
    const cliffs = this.cliffMesh(gw, gh);
    if (cliffs) layer.addChild(new Mesh({ geometry: cliffs, shader: this.shader }));
    layer.addChild(this.groundDecor, this.topDecor);
  }

  /**
   * The raised parts as a fine mesh, lifted on screen by the height field. Cells are emitted back to
   * front (by u + v), so nearer cliff faces draw over what lies behind them.
   */
  private cliffMesh(gw: number, gh: number): MeshGeometry | null {
    const lift = this.lift;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const vert = new Int32Array(gw * gh).fill(-1);
    const v = (x: number, y: number) => {
      const i = y * gw + x;
      if (vert[i]! < 0) {
        vert[i] = pos.length / 2;
        const u = x / RES;
        const w = y / RES;
        pos.push(isoX(u, w), isoY(u, w) - lift[i]!);
        uv.push(u, w);
      }
      return vert[i]!;
    };
    for (let d = 0; d <= gw + gh - 4; d++)
      for (let y = Math.max(0, d - (gw - 2)); y <= Math.min(gh - 2, d); y++) {
        const x = d - y;
        const raised = lift[y * gw + x]! + lift[y * gw + x + 1]! + lift[(y + 1) * gw + x]! + lift[(y + 1) * gw + x + 1]!;
        if (raised < 0.2) continue;
        const a = v(x, y);
        const b = v(x + 1, y);
        const c = v(x, y + 1);
        const e = v(x + 1, y + 1);
        idx.push(a, b, c, b, e, c);
      }
    if (!idx.length) return null;
    return new MeshGeometry({ positions: new Float32Array(pos), uvs: new Float32Array(uv), indices: new Uint32Array(idx) });
  }

  /** Stain the ground under the Echo fields (once, from the opening layout, so it marks where fields regrow). */
  setEcho(echo: Uint8Array): void {
    if (this.echoSet || !this.mask2 || echo.length === 0) return;
    this.echoSet = true;
    const data = this.mask2.resource as Uint8Array;
    const [w, h] = this.size;
    for (let i = 0; i < w * h; i++) data[i * 4 + 3] = Math.min(255, (echo[i] ?? 0) * 40);
    this.mask2.update();
  }

  update(): void {
    if (!this.shader) return;
    const u = this.shader.resources.terrainUniforms as { uniforms: { uTime: number } };
    u.uniforms.uTime = (performance.now() - this.start) / 1000;
  }
}
