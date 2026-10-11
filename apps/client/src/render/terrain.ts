import { Assets, Matrix, Mesh, MeshGeometry, Shader, Texture, type Container } from 'pixi.js';
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

// Splat map channels (one texel per tile, linearly filtered for soft blends):
//   r = rough ground, g = water, b = ground variant, a = obstacle base (rock / cliff / ruins)
const fragment = /* glsl */ `
in vec2 vTile;
uniform sampler2D uSplat;
uniform sampler2D uGround;
uniform sampler2D uGround2;
uniform sampler2D uRough;
uniform sampler2D uWater;
uniform sampler2D uNoise;
uniform vec2 uMapSize;
uniform float uTime;

float edge(float w, float n) {
  // Noise-broken, fairly crisp transitions: gritty edges instead of soft gradients.
  return smoothstep(0.38, 0.62, w + (n - 0.5) * 0.55);
}

void main() {
  // Screen-space texture coordinates keep the textures undistorted by the iso projection.
  vec2 px = vec2(${TILE_W / 2}.0 * (vTile.x - vTile.y), ${TILE_H / 2}.0 * (vTile.x + vTile.y));
  vec2 tuv = px / 512.0;
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
  // Obstacle bases: rough, darkened ground under rocks and ruins.
  float ob = edge(splat.a, n);
  col = mix(col, texture(uRough, tuv * 1.4 + 0.5).rgb * 0.62, ob);
  // Water: animated ripples, darker wet shore band around it.
  float wet = smoothstep(0.12, 0.45, splat.g + (n - 0.5) * 0.3);
  col *= 1.0 - wet * 0.35;
  vec2 flow = vec2(uTime * 0.01, uTime * 0.006);
  vec3 water = mix(texture(uWater, tuv + flow).rgb, texture(uWater, tuv * 1.3 - flow * 0.7).rgb, 0.5);
  col = mix(col, water, edge(splat.g, n2));
  // Large-scale light variation (clouds / terrain undulation).
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

  async build(layer: Container, biome: string, width: number, height: number, terrain: Uint8Array): Promise<void> {
    const base = `${import.meta.env.BASE_URL}assets/terrain/`;
    const load = async (name: string) => {
      const tex = (await Assets.load(`${base}${name}`)) as Texture;
      tex.source.style.addressMode = 'repeat';
      tex.source.style.update();
      return tex;
    };
    const [ground, ground2, rough, water, noise] = await Promise.all([
      load(`${biome}/ground.png`),
      load(`${biome}/ground2.png`),
      load(`${biome}/rough.png`),
      load(`${biome}/water.png`),
      load('noise.png'),
    ]);

    // Splat map: one texel per tile.
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const t = terrain[i]!;
        const o = i * 4;
        img.data[o] = t === TERRAIN.rough ? 255 : 0;
        img.data[o + 1] = t === TERRAIN.water ? 255 : 0;
        img.data[o + 2] = variant(x, y) > 0.55 ? 255 : 0;
        img.data[o + 3] = t === TERRAIN.rock || t === TERRAIN.cliff || t === TERRAIN.ruins ? 255 : 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    const splat = Texture.from(canvas);
    splat.source.style.scaleMode = 'linear';
    // Premultiplied alpha would wipe colour where a = 0; we read raw channels.
    splat.source.alphaMode = 'no-premultiply-alpha';

    this.shader = Shader.from({
      gl: { vertex, fragment },
      resources: {
        uSplat: splat.source,
        uGround: ground.source,
        uGround2: ground2.source,
        uRough: rough.source,
        uWater: water.source,
        uNoise: noise.source,
        terrainUniforms: {
          uMapSize: { value: [width, height], type: 'vec2<f32>' },
          uTime: { value: 0, type: 'f32' },
        },
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
    layer.removeChildren();
    layer.addChild(this.mesh);
  }

  update(): void {
    if (!this.shader) return;
    const u = this.shader.resources.terrainUniforms as { uniforms: { uTime: number } };
    u.uniforms.uTime = (performance.now() - this.start) / 1000;
  }
}
