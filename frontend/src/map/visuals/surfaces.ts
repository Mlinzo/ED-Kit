// Bake programs for planet surfaces and clouds. Each writes linear RGB (+ height in alpha) into an
// sRGB render target; the planet material decodes it in hardware.

import { Color, Vector3, Vector4 } from 'three'
import { registerBakeProgram, type BakeSpec } from './bake'
import { NOISE_GLSL } from './glsl'
import type { Params } from './recipe'

const HEADER = /* glsl */ `
precision highp float;
precision highp int;
varying vec2 vUv;
#define EDK_ROLLED_NOISE
${NOISE_GLSL}
`

const ROCKY = /* glsl */ `
${HEADER}
uniform vec3 uSeed;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uIceCol;
uniform vec3 uCrackCol;
uniform float uIce;
uniform float uCaps;
uniform float uCraters;
uniform float uCracks;
uniform float uRough;
uniform float uMaria;
uniform float uFrost;
uniform float uLava;
uniform float uLavaLevel;

float craters(vec3 p, float salt, float density) {
  vec3 c = floor(p);
  vec3 f = p - c;
  float h = 0.0;
  int lo = -1 + EDK_ZERO;
  for (int z = lo; z <= 1; z++)
  for (int y = lo; y <= 1; y++)
  for (int x = lo; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 r = edkHash3(c + g + vec3(salt * 17.0, salt * 31.0, salt * 7.0));
    if (fract(r.x * 91.37 + r.z * 47.13) > density) continue;
    vec3 o = g + r - f;
    float rad = 0.17 + 0.33 * fract(r.y * 13.7 + r.x * 7.1);
    float d = length(o) / rad;
    if (d < 2.2) {
      float bowl = d < 1.0 ? (0.55 * d * d * d + 0.45 * d * d - 1.0) : 0.0;
      float rim = exp(-pow((d - 1.0) * 5.0, 2.0)) * 0.55;
      float ejecta = d > 1.0 ? exp(-(d - 1.0) * 2.4) * 0.1 : 0.0;
      h += bowl * 0.95 + rim + ejecta;
    }
  }
  return h;
}

// Bright ejecta splash around a few young craters (filled, fading outward).
float splash(vec3 p, float salt, float density) {
  vec3 c = floor(p);
  vec3 f = p - c;
  float s = 0.0;
  int lo = -1 + EDK_ZERO;
  for (int z = lo; z <= 1; z++)
  for (int y = lo; y <= 1; y++)
  for (int x = lo; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 r = edkHash3(c + g + vec3(salt * 17.0, salt * 31.0, salt * 7.0));
    if (fract(r.x * 91.37 + r.z * 47.13) > density) continue;
    float d = length(g + r - f) / (0.12 + 0.12 * r.y);
    s = max(s, exp(-d * d * 0.35) * (1.0 - 0.6 * exp(-d * d * 4.0)));
  }
  return s;
}

void main() {
  vec3 p = edkSphere(vUv);
  vec3 q = p + uSeed;
  vec3 w = vec3(edkFbm(q * 1.3, 4), edkFbm(q * 1.3 + 17.1, 4), edkFbm(q * 1.3 + 41.7, 4));
  float cont = edkFbm(q * 1.7 + w * 0.9, 6);
  float detail = edkFbm(q * 8.0 + w * 0.6, 5);
  float ridge = edkRidged(q * 3.0 + w * 0.7, 6);

  float cr = 0.0;
  if (uCraters > 0.0) {
    // Five crater scales in one rolled loop (one inlined copy of craters()).
    const float CS[5] = float[5](2.0, 4.6, 10.5, 23.0, 47.0);
    const float CD[5] = float[5](0.5, 0.6, 0.65, 0.7, 0.75);
    const float CW[5] = float[5](1.0, 0.65, 0.45, 0.3, 0.16);
    for (int i = EDK_ZERO; i < 5; i++) {
      cr += craters(q * CS[i], float(i + 1), CD[i]) * CW[i];
    }
    cr *= uCraters;
  }

  float h = 0.52 + cont * 0.4 + detail * 0.1 + (ridge - 0.45) * 0.3 * uRough + cr * 0.14;

  // Albedo regions
  float region = smoothstep(-0.28, 0.32, cont + detail * 0.45);
  vec3 col = mix(uC0, uC1, region);
  float hi = smoothstep(0.05, 0.55, edkFbm(q * 3.2 + w * 1.4, 5));
  col = mix(col, uC2, hi * 0.6);
  float acc = smoothstep(0.15, 0.6, edkFbm(q * 2.1 - w * 1.2, 4));
  col = mix(col, uC3, acc * 0.55);
  col = mix(col, uC2, smoothstep(0.55, 0.95, ridge) * 0.35 * uRough);

  // Maria: dark smooth basins
  float maria = smoothstep(0.08, 0.32, edkFbm(q * 0.9 + 3.3, 4)) * uMaria;
  col = mix(col, uC0 * 0.75, maria * 0.75);
  h -= maria * 0.1;

  // Crater shading: dark floors, bright rims and ejecta
  col *= 1.0 + clamp(cr, -0.8, 0.6) * 0.42;
  // A few young craters with bright ejecta halos
  float young = splash(q * 5.5 + w * 0.3, 7.0, 0.22);
  col = mix(col, uC2 * 1.15, young * 0.32 * uCraters);

  // Fine grain
  col *= 0.86 + 0.28 * (edkFbm(q * 34.0 + w, 3) * 0.5 + 0.5);

  // Ice: bright plains with blue-grey variation
  if (uIce > 0.0) {
    float iceMask = smoothstep(0.75 - uIce, 1.05 - uIce, region * 0.6 + hi * 0.5 + detail * 0.3);
    col = mix(col, uIceCol * (0.86 + 0.14 * region), iceMask * clamp(uIce, 0.0, 1.0) * 0.85);
  }

  // Lineae (Europa-like cracks)
  if (uCracks > 0.0) {
    float l1 = pow(1.0 - abs(edkNoise(q * 3.2 + w * 1.6)), 16.0);
    float l2 = pow(1.0 - abs(edkNoise(q * 7.5 - w * 2.4)), 22.0);
    float l3 = pow(1.0 - abs(edkNoise(q * 1.4 + w * 0.8)), 10.0) * smoothstep(0.0, 0.4, edkFbm(q * 2.0, 3));
    float cracks = clamp(l1 + l2 * 0.7 + l3 * 0.8, 0.0, 1.0) * uCracks;
    col = mix(col, uCrackCol, cracks * 0.75);
    h -= cracks * 0.04;
  }

  // Polar caps and frost
  float lat = abs(p.y);
  float edgeN = edkFbm(q * 4.5 + w, 4);
  float capT = lat + 0.11 * edgeN;
  float cap = smoothstep(uCaps, uCaps + 0.09, capT);
  float lowland = smoothstep(0.62, 0.42, h);
  cap = max(cap, smoothstep(uCaps - 0.1, uCaps + 0.03, capT) * lowland * 0.85);
  col = mix(col, uIceCol * (0.92 + 0.08 * edgeN), cap * 0.9);
  float frost = smoothstep(0.62, 0.38, h + detail * 0.15) * uFrost;
  col = mix(col, uIceCol * 0.95, frost * 0.55);

  // Lava: dark basalt plains with molten channels carved below uLavaLevel (glow in material)
  if (uLava > 0.0) {
    float plains = smoothstep(0.55, 0.35, h) * uLava;
    col = mix(col, uC0 * 0.45, plains * 0.8);
    float ch = pow(1.0 - abs(edkNoise(q * 5.0 + w * 2.0)), 9.0);
    ch = max(ch, pow(1.0 - abs(edkNoise(q * 11.0 - w * 1.5)), 14.0) * 0.8);
    ch *= smoothstep(0.2, 0.75, plains + 0.3 * uLava);
    h = max(h, uLavaLevel + 0.08);
    h = mix(h, uLavaLevel - 0.12, ch);
    col = mix(col, vec3(0.08, 0.03, 0.02), ch * 0.85);
  } else {
    h = max(h, uLavaLevel + 0.06);
  }

  gl_FragColor = vec4(max(col, vec3(0.0)), clamp(h, 0.0, 1.0));
}
`

const GAS = /* glsl */ `
${HEADER}
uniform vec3 uSeed;
uniform vec3 uP0;
uniform vec3 uP1;
uniform vec3 uP2;
uniform vec3 uP3;
uniform vec3 uP4;
uniform float uBands;
uniform float uTurb;
uniform float uContrast;
uniform vec4 uStorm0;
uniform vec4 uStorm1;
uniform vec4 uStorm2;
uniform vec3 uStormCol;
uniform float uLife;
uniform vec3 uLifeCol;

vec3 pal(float t) {
  t = clamp(t, 0.0, 1.0) * 4.0;
  vec3 c = mix(uP0, uP1, clamp(t, 0.0, 1.0));
  c = mix(c, uP2, clamp(t - 1.0, 0.0, 1.0));
  c = mix(c, uP3, clamp(t - 2.0, 0.0, 1.0));
  c = mix(c, uP4, clamp(t - 3.0, 0.0, 1.0));
  return c;
}

vec3 swirl(vec3 p, vec4 s) {
  if (s.w == 0.0) return p;
  vec3 c = edkDir(s.x, s.y);
  float d = distance(p, c);
  float k = exp(-pow(d / s.z, 2.0));
  return normalize(edkRotate(p, c, k * s.w * 4.0));
}

float storm(vec3 p, vec4 s) {
  if (s.w == 0.0) return 0.0;
  vec3 c = edkDir(s.x, s.y);
  vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), c));
  vec3 north = cross(c, east);
  vec3 d = p - c;
  float e = length(vec2(dot(d, east) / 1.7, dot(d, north))) / s.z;
  return 1.0 - smoothstep(0.35, 0.75, e);
}

void main() {
  vec3 p = edkSphere(vUv);
  vec3 sp = swirl(swirl(swirl(p, uStorm0), uStorm1), uStorm2);
  vec3 q = sp + uSeed;

  // Turbulent flow field stretched along latitude lines.
  vec3 s = vec3(sp.x * 2.2, sp.y * 6.5, sp.z * 2.2) + uSeed;
  vec3 w1 = vec3(edkFbm(s * 1.4, 4), edkFbm(s * 1.4 + 7.3, 4), edkFbm(s * 1.4 + 13.1, 4));
  float flow = edkFbm(s * 2.3 + w1 * 1.7, 5);
  float lat = sp.y + flow * uTurb * 0.05;

  // Irregular zones and belts (1D noise in latitude), plus finer ribbons.
  float z1 = edkFbm(vec3(lat * uBands * 0.55, uSeed.x, uSeed.y), 4);
  float z2 = edkFbm(vec3(lat * uBands * 2.3, uSeed.z, uSeed.x), 3);
  float t = 0.5 + (z1 * 1.35 + z2 * 0.4) * uContrast;
  t += edkFbm(q * vec3(5.0, 15.0, 5.0) + w1 * 1.2, 4) * 0.14 * uTurb;
  t = clamp(t, 0.0, 1.0);
  vec3 col = pal(t);

  // Filaments along the flow and soft eddies
  float fil = edkFbm(vec3(lat * 80.0, q.x * 0.6, q.z * 0.6) + vec3(flow * 4.0), 3);
  col *= 1.0 + fil * 0.1 * uContrast;
  float ed = edkFbm(q * vec3(7.0, 20.0, 7.0) + vec3(flow * 3.0), 3);
  col = mix(col, pal(clamp(t + 0.25, 0.0, 1.0)), smoothstep(0.2, 0.55, ed) * 0.25 * uTurb);

  // Biology tint (life-bearing giants): soft patches in the bright zones
  if (uLife > 0.0) {
    float lifeMask = smoothstep(0.05, 0.45, edkFbm(q * vec3(3.0, 9.0, 3.0) + vec3(flow), 4)) * smoothstep(0.35, 0.8, t);
    col = mix(col, uLifeCol, lifeMask * 0.4 * uLife);
  }

  // Storm ovals
  col = mix(col, uStormCol, storm(p, uStorm0) * 0.85);
  col = mix(col, mix(uStormCol, uP4, 0.5), storm(p, uStorm1) * 0.75);
  col = mix(col, mix(uStormCol, uP3, 0.5), storm(p, uStorm2) * 0.7);

  // Calmer, slightly darker poles
  float pole = smoothstep(0.75, 0.98, abs(p.y));
  col = mix(col, mix(uP1, uP2, 0.5) * 0.85, pole * 0.5);

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`

const TERRA = /* glsl */ `
${HEADER}
uniform vec3 uSeed;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uLandLow;
uniform vec3 uLandHigh;
uniform vec3 uDesert;
uniform vec3 uTundra;
uniform vec3 uRock;
uniform vec3 uIceCol;
uniform float uSea;
uniform float uCaps;
uniform float uVeg;

void main() {
  vec3 p = edkSphere(vUv);
  vec3 q = p + uSeed;
  vec3 w = vec3(edkFbm(q * 1.1, 4), edkFbm(q * 1.1 + 11.3, 4), edkFbm(q * 1.1 + 27.9, 4));
  float e = edkFbm(q * 1.4 + w * 1.2, 7) * 0.5 + 0.5;
  e += (edkRidged(q * 4.0 + w, 4) - 0.4) * 0.08;
  float alat = abs(p.y);
  vec3 col;
  float h;

  if (e < uSea) {
    float depth = (uSea - e) / max(uSea, 0.01);
    col = mix(uShallow, uDeep, smoothstep(0.0, 0.22, depth));
    col = mix(col, uShallow * 1.25, (1.0 - smoothstep(0.0, 0.03, depth)) * 0.6);
    col *= 0.95 + 0.07 * edkFbm(q * 10.0, 3);
    h = 0.08;
  } else {
    float hl = clamp((e - uSea) / max(1.0 - uSea, 0.01) * 1.5, 0.0, 1.0);
    float moist = edkFbm(q * 2.4 + w * 0.9 + 5.0, 5) * 0.5 + 0.5;
    float temp = 1.0 - alat * 0.95 - hl * 0.4 + edkFbm(q * 3.0 + 9.0, 3) * 0.25;
    float desertBelt = exp(-pow((alat - 0.4) / 0.15, 2.0));
    float dry = clamp((1.0 - moist) * 1.1 + desertBelt * 0.35 - 0.3 + (1.0 - uVeg) * 0.7, 0.0, 1.0);
    vec3 green = mix(uLandLow, uLandHigh, smoothstep(0.0, 0.7, hl + moist * 0.2));
    col = mix(green, uDesert, smoothstep(0.35, 0.7, dry));
    col = mix(col, uTundra, smoothstep(0.38, 0.12, temp));
    col = mix(col, uRock, smoothstep(0.6, 0.9, hl) * 0.7);
    col = mix(col, uIceCol, smoothstep(0.88, 0.98, hl + (1.0 - temp) * 0.25));
    col *= 0.88 + 0.22 * (edkFbm(q * 22.0, 3) * 0.5 + 0.5);
    float rel = (edkRidged(q * 9.0 + w, 4) - 0.4) * 0.25;
    h = 0.14 + 0.86 * clamp(hl * 0.8 + rel, 0.0, 1.0);
  }

  float cap = smoothstep(uCaps, uCaps + 0.05, alat + 0.07 * edkFbm(q * 5.0, 4));
  col = mix(col, uIceCol, cap);
  h = mix(h, max(h, 0.2), cap);
  gl_FragColor = vec4(max(col, vec3(0.0)), h);
}
`

const CLOUDS = /* glsl */ `
${HEADER}
uniform vec3 uSeed;
uniform float uCover;
uniform vec3 uCol;
uniform float uBanding;

vec3 cyclone(vec3 p, vec3 c, float size, float strength) {
  float d = distance(p, c);
  float k = exp(-pow(d / size, 2.0));
  return normalize(edkRotate(p, c, k * strength));
}

void main() {
  vec3 p = edkSphere(vUv);
  vec3 sp = p;
  for (int i = EDK_ZERO; i < 4; i++) {
    vec3 h = edkHash3(floor(uSeed) + vec3(float(i) * 7.0, 3.0, 11.0));
    float lat = (h.x * 2.0 - 1.0) * 0.8;
    vec3 c = edkDir(lat, h.y * 6.2831853);
    float dir = lat >= 0.0 ? 1.0 : -1.0;
    sp = cyclone(sp, c, 0.1 + h.z * 0.1, dir * (1.4 + h.z * 1.8) * (1.0 - uBanding * 0.7));
  }
  vec3 q = sp + uSeed;
  vec3 s = mix(q, vec3(q.x * 0.7, q.y * 3.2, q.z * 0.7), uBanding);
  vec3 w = vec3(edkFbm(s * 1.8, 4), edkFbm(s * 1.8 + 7.7, 4), edkFbm(s * 1.8 + 19.1, 4));
  float n = edkFbm(s * 2.6 + w * 1.7, 6) * 0.5 + 0.5;
  float alat = abs(p.y);
  float latMod = (0.1 * cos(alat * 11.0) + 0.05) * (1.0 - uBanding);
  float th = 1.0 - uCover;
  float a = smoothstep(th - 0.1, th + 0.2, n + latMod);
  a *= 0.7 + 0.3 * (edkFbm(q * 12.0 + w, 3) * 0.5 + 0.5);
  float shade = 0.82 + 0.18 * smoothstep(0.3, 0.8, n);
  gl_FragColor = vec4(uCol * shade, clamp(a, 0.0, 1.0));
}
`

registerBakeProgram('rocky', ROCKY)
registerBakeProgram('gas', GAS)
registerBakeProgram('terra', TERRA)
registerBakeProgram('clouds', CLOUDS)

function toUniform(v: Params[string]): unknown {
  if (typeof v === 'string') return new Color(v) // sRGB hex -> linear working space
  if (typeof v === 'number') return v
  if (v.length === 3) return new Vector3(v[0], v[1], v[2])
  return new Vector4(v[0], v[1], v[2], v[3])
}

export const SURFACE_W = 512
export const SURFACE_H = 256

export function bakeSpec(program: string, params: Params, width = SURFACE_W, height = SURFACE_H): BakeSpec {
  const uniforms: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(params)) uniforms[k] = toUniform(v)
  return {
    key: `${program}:${width}x${height}:${JSON.stringify(params)}`,
    program,
    uniforms,
    width,
    height,
  }
}
