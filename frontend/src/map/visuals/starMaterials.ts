// Unlit materials for stars and their effects: animated photosphere, additive glow billboard,
// black hole photon ring and accretion disc, pulsar jets, protoplanetary dust disc, Wolf-Rayet
// nebula and the selection reticle.

import { Color, DoubleSide, ShaderMaterial, type IUniform } from 'three'
import { BILLBOARD_VERT, DIM_GLSL, NOISE_GLSL } from './glsl'
import { ADDITIVE } from './shared'

type U<T> = IUniform<T>

/** Shared animation clock (seconds), advanced by mounted bodies. */
export const TIME: U<number> = { value: 0 }

const HEAD = /* glsl */ `
${NOISE_GLSL}
${DIM_GLSL}
`

// ---------------------------------------------------------------------------------------------
// Photosphere

const STAR_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vP;
varying vec3 vObj;
void main() {
  vObj = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vP = mv.xyz;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`

const STAR_FRAG = /* glsl */ `
${HEAD}
uniform vec3 uCore;
uniform vec3 uMid;
uniform vec3 uLimb;
uniform float uIntensity;
uniform float uTime;
uniform float uGranScale;
uniform float uGranAmp;
uniform float uSpots;
uniform float uBands;
uniform float uDim;
uniform vec3 uSeed;
varying vec3 vN;
varying vec3 vP;
varying vec3 vObj;
void main() {
  vec3 n = normalize(vN);
  vec3 v = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-vP);
  float mu = clamp(dot(n, v), 0.0, 1.0);
  vec3 p = normalize(vObj);
  float t = uTime;
  vec3 q = p * uGranScale + uSeed;
  float g1 = edkFbm(q + vec3(0.0, t * 0.03, t * 0.02), 3);
  float cells = 1.0 - abs(edkNoise(q * 2.2 - vec3(t * 0.04, 0.0, t * 0.03)));
  float g2 = edkFbm(q * 3.1 + vec3(t * 0.05), 2);
  float gran = g1 * 0.6 + (cells - 0.6) * 0.5 + g2 * 0.25;
  float heat = gran * uGranAmp * 1.8; // > 0 hot cells, < 0 cooler lanes
  if (uBands > 0.0) {
    float w = edkFbm(vec3(p.x * 1.5, p.y * 5.0, p.z * 1.5) + uSeed + vec3(t * 0.01, 0.0, 0.0), 3);
    float b = sin(p.y * 10.0 + w * 3.5);
    heat += b * 0.3 * uBands;
  }
  float spot = 0.0;
  if (uSpots > 0.0) {
    spot = smoothstep(0.38, 0.6, edkFbm(p * 2.0 + uSeed * 1.3 + vec3(t * 0.004), 3)) * uSpots;
  }
  float hot = clamp(heat, 0.0, 1.0);
  float cool = clamp(-heat + spot * 0.8, 0.0, 1.0);
  vec3 col = mix(uLimb, uMid, smoothstep(0.0, 0.6, mu));
  col = mix(col, uCore, smoothstep(0.5, 1.0, mu) * 0.85);
  // Cooler plasma shifts toward the deep limb colour (and darkens) instead of going grey on an
  // over-exposed disc; hot cells brighten.
  col = mix(col, uLimb, cool * 0.6);
  col *= (1.0 + hot * 0.4) * (1.0 - cool * 0.3) * (1.0 - spot * 0.3);
  float limb = 0.38 + 0.62 * pow(mu, 0.5);
  col *= limb * uIntensity;
  col = edkDim(col, uDim, 0.5, 0.65);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export function createStarSurfaceMaterial(o: {
  core: string
  mid: string
  limb: string
  intensity: number
  granScale: number
  granAmp: number
  spots: number
  bands: number
  seed: number[]
  dim: U<number>
}): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    uniforms: {
      uCore: { value: new Color(o.core) },
      uMid: { value: new Color(o.mid) },
      uLimb: { value: new Color(o.limb) },
      uIntensity: { value: o.intensity },
      uTime: TIME,
      uGranScale: { value: o.granScale },
      uGranAmp: { value: o.granAmp },
      uSpots: { value: o.spots },
      uBands: { value: o.bands },
      uDim: o.dim,
      uSeed: { value: o.seed },
    },
  })
}

// ---------------------------------------------------------------------------------------------
// Glow billboard (corona, halo, rays, diffraction spikes)

const GLOW_FRAG = /* glsl */ `
${HEAD}
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uSize;
uniform float uDisc;
uniform float uStrength;
uniform float uRays;
uniform float uSpikes;
uniform float uTime;
uniform float uDim;
uniform float uSeedF;
varying vec2 vUv;
varying float vScale;
void main() {
  float r = length(vUv);
  if (r >= 1.0) discard;
  float rr = r * uSize;
  float x = max(rr - uDisc, 0.0) / uDisc;
  float core = exp(-x * 5.5);
  float halo = exp(-x * 1.8) * 0.045;
  float ang = atan(vUv.y, vUv.x);
  float rays = 0.0;
  if (uRays > 0.0) {
    vec2 c = vec2(cos(ang), sin(ang));
    float n1 = edkNoise(vec3(c * 2.5, uTime * 0.07 + uSeedF)) * 0.5 + 0.5;
    float n2 = edkNoise(vec3(c * 7.0, uTime * 0.11 - uSeedF)) * 0.5 + 0.5;
    rays = pow(n1 * 0.55 + n2 * 0.45, 3.0) * exp(-x * 2.2) * uRays * 0.35;
  }
  float spikes = 0.0;
  if (uSpikes > 0.0) {
    vec2 a = abs(vUv);
    float thin = 90.0;
    spikes = exp(-a.y * thin) * exp(-a.x * 2.6) + exp(-a.x * thin) * exp(-a.y * 2.6);
    vec2 d = abs(vec2(vUv.x + vUv.y, vUv.x - vUv.y)) * 0.7071;
    spikes += (exp(-d.y * thin * 1.4) * exp(-d.x * 5.0) + exp(-d.x * thin * 1.4) * exp(-d.y * 5.0)) * 0.35;
    spikes *= uSpikes * 0.5 * smoothstep(uDisc * 0.9, uDisc * 1.6, rr);
  }
  float fade = 1.0 - smoothstep(0.7, 1.0, r);
  float inten = (core + halo + rays) * uStrength + spikes;
  vec3 col = mix(uColor, uCore, core * 0.75) * inten * fade;
  col = edkDim(col, uDim, 0.7, 0.6);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

export function createGlowMaterial(o: {
  color: string
  core: string
  size: number
  disc: number
  strength: number
  rays: number
  spikes: number
  seed: number
  dim: U<number>
}): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: BILLBOARD_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    depthWrite: false,
    ...ADDITIVE,
    toneMapped: false,
    uniforms: {
      uColor: { value: new Color(o.color) },
      uCore: { value: new Color(o.core) },
      uSize: { value: o.size },
      uDisc: { value: o.disc },
      uStrength: { value: o.strength },
      uRays: { value: o.rays },
      uSpikes: { value: o.spikes },
      uTime: TIME,
      uDim: o.dim,
      uSeedF: { value: o.seed },
    },
  })
}

// ---------------------------------------------------------------------------------------------
// Black hole: photon ring + lensed disc image (billboard) and accretion disc

const LENS_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
varying vec3 vDiskN;
void main() {
  vUv = position.xy;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  vDiskN = normalize((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  mv.xy += position.xy * uSize * s;
  gl_Position = projectionMatrix * mv;
}
`

const LENS_FRAG = /* glsl */ `
${HEAD}
uniform float uSize;
uniform float uShadow;
uniform vec3 uHot;
uniform vec3 uWarm;
uniform float uTime;
uniform float uDim;
uniform float uStrength;
varying vec2 vUv;
varying vec3 vDiskN;
void main() {
  float r = length(vUv);
  if (r >= 1.0) discard;
  float rr = r * uSize;
  vec2 dir = vUv / max(r, 1e-4);
  // Photon ring hugging the shadow
  float ring = exp(-pow((rr - uShadow * 1.05) / (uShadow * 0.022), 2.0));
  float ring2 = exp(-pow((rr - uShadow * 1.1) / (uShadow * 0.05), 2.0)) * 0.25;
  // Lensed image of the far side of the disc: arcs above/below the disc plane
  vec2 np = length(vDiskN.xy) > 1e-3 ? normalize(vDiskN.xy) : vec2(0.0, 1.0);
  float edgeOn = 1.0 - abs(vDiskN.z);
  float side = mix(1.0, pow(abs(dot(dir, np)), 1.6), edgeOn);
  float band = smoothstep(uShadow * 1.08, uShadow * 1.18, rr) * (1.0 - smoothstep(uShadow * 1.3, uShadow * 1.65, rr));
  float ang = atan(vUv.y, vUv.x);
  float streak = edkFbm(vec3(cos(ang - uTime * 0.25) * 2.0, sin(ang - uTime * 0.25) * 2.0, rr * 3.0), 3) * 0.5 + 0.5;
  float lens = band * side * (0.3 + 0.8 * streak);
  float glow = exp(-max(rr - uShadow, 0.0) / uShadow * 2.2) * 0.07 * smoothstep(uShadow * 0.98, uShadow * 1.05, rr);
  float fade = 1.0 - smoothstep(0.75, 1.0, r);
  vec3 col = uHot * (ring * 1.2 + ring2) + uWarm * (lens * 0.75 + glow);
  col *= uStrength * fade;
  col = edkDim(col, uDim, 0.65, 0.6);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

export function createLensMaterial(o: {
  size: number
  shadow: number
  hot: string
  warm: string
  strength: number
  dim: U<number>
}): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: LENS_VERT,
    fragmentShader: LENS_FRAG,
    transparent: true,
    depthWrite: false,
    ...ADDITIVE,
    toneMapped: false,
    uniforms: {
      uSize: { value: o.size },
      uShadow: { value: o.shadow },
      uHot: { value: new Color(o.hot) },
      uWarm: { value: new Color(o.warm) },
      uTime: TIME,
      uDim: o.dim,
      uStrength: { value: o.strength },
    },
  })
}

const DISK_VERT = /* glsl */ `
varying vec2 vL;
varying vec3 vP;
varying vec3 vVel;
void main() {
  vL = position.xy;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vP = mv.xyz;
  vec3 tang = normalize(vec3(-position.y, position.x, 0.0));
  vVel = normalize((modelViewMatrix * vec4(tang, 0.0)).xyz);
  gl_Position = projectionMatrix * mv;
}
`

const ACCRETION_FRAG = /* glsl */ `
${HEAD}
uniform float uInner;
uniform float uOuter;
uniform float uTime;
uniform float uDim;
uniform float uStrength;
uniform float uSeedF;
uniform vec3 uHot;
uniform vec3 uWarm;
uniform vec3 uCool;
varying vec2 vL;
varying vec3 vP;
varying vec3 vVel;
void main() {
  float r = length(vL);
  float t = (r - uInner) / (uOuter - uInner);
  if (t < 0.0 || t > 1.0) discard;
  float ang = atan(vL.y, vL.x);
  float omega = 0.5 / pow(r / uInner, 1.5);
  float a2 = ang - uTime * omega;
  vec2 c = vec2(cos(a2), sin(a2));
  float streak = edkFbm(vec3(c * 1.6, r * 7.0 + uSeedF), 4) * 0.5 + 0.5;
  float fine = edkFbm(vec3(c * 5.0, r * 22.0 - uSeedF), 2) * 0.5 + 0.5;
  float dens = pow(1.0 - t, 2.0) * smoothstep(0.0, 0.03, t) * pow(0.15 + 0.95 * streak, 3.0) * (0.65 + 0.6 * fine);
  vec3 col = mix(uHot, uWarm, smoothstep(0.0, 0.3, t));
  col = mix(col, uCool, smoothstep(0.3, 1.0, t));
  vec3 v = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-vP);
  float beam = clamp(1.0 + 0.55 * dot(vVel, v), 0.3, 1.7);
  col *= dens * beam * beam * uStrength;
  col = edkDim(col, uDim, 0.65, 0.6);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

export function createAccretionMaterial(o: {
  inner: number
  outer: number
  hot: string
  warm: string
  cool: string
  strength: number
  seed: number
  dim: U<number>
}): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: DISK_VERT,
    fragmentShader: ACCRETION_FRAG,
    transparent: true,
    depthWrite: false,
    ...ADDITIVE,
    side: DoubleSide,
    toneMapped: false,
    uniforms: {
      uInner: { value: o.inner },
      uOuter: { value: o.outer },
      uTime: TIME,
      uDim: o.dim,
      uStrength: { value: o.strength },
      uSeedF: { value: o.seed },
      uHot: { value: new Color(o.hot) },
      uWarm: { value: new Color(o.warm) },
      uCool: { value: new Color(o.cool) },
    },
  })
}

// ---------------------------------------------------------------------------------------------
// Protoplanetary dust disc (T Tauri / Herbig Ae/Be)

const DUST_FRAG = /* glsl */ `
${HEAD}
uniform float uInner;
uniform float uOuter;
uniform float uTime;
uniform float uDim;
uniform float uSeedF;
uniform vec3 uColor;
varying vec2 vL;
varying vec3 vP;
varying vec3 vVel;
void main() {
  float r = length(vL);
  float t = (r - uInner) / (uOuter - uInner);
  if (t < 0.0 || t > 1.0) discard;
  float ang = atan(vL.y, vL.x) - uTime * 0.05 / pow(r / uInner, 1.5);
  vec2 c = vec2(cos(ang), sin(ang));
  float n = edkFbm(vec3(c * 2.0, r * 5.0 + uSeedF), 4) * 0.5 + 0.5;
  float gaps = 0.55 + 0.45 * smoothstep(-0.4, 0.5, sin(r * 9.0 + n * 2.0 + uSeedF));
  float dens = smoothstep(0.0, 0.12, t) * pow(1.0 - t, 1.2) * (0.4 + 0.7 * n) * gaps;
  float lit = 1.6 / (0.6 + r / uInner);
  vec3 col = uColor * lit;
  col = edkDim(col, uDim, 0.6, 0.6);
  gl_FragColor = vec4(col, dens * 0.55 * (1.0 - 0.4 * uDim));
  #include <colorspace_fragment>
}
`

export function createDustDiskMaterial(o: {
  inner: number
  outer: number
  color: string
  seed: number
  dim: U<number>
}): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: DISK_VERT,
    fragmentShader: DUST_FRAG,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
    uniforms: {
      uInner: { value: o.inner },
      uOuter: { value: o.outer },
      uTime: TIME,
      uDim: o.dim,
      uSeedF: { value: o.seed },
      uColor: { value: new Color(o.color) },
    },
  })
}

// ---------------------------------------------------------------------------------------------
// Pulsar jets (cone geometry along +Y, y in 0..1)

const JET_VERT = /* glsl */ `
varying float vT;
varying vec3 vN;
varying vec3 vP;
void main() {
  vT = position.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vP = mv.xyz;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`

const JET_FRAG = /* glsl */ `
${HEAD}
uniform vec3 uColor;
uniform float uTime;
uniform float uDim;
uniform float uStrength;
varying float vT;
varying vec3 vN;
varying vec3 vP;
void main() {
  vec3 v = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-vP);
  float side = abs(dot(normalize(vN), v));
  float core = pow(side, 4.0);
  float along = pow(1.0 - vT, 2.2) * smoothstep(0.0, 0.03, vT);
  float flow = 0.6 + 0.4 * (edkNoise(vec3(vT * 9.0 - uTime * 2.2, side * 2.0, 0.0)) * 0.5 + 0.5);
  vec3 col = uColor * core * along * flow * uStrength;
  col = edkDim(col, uDim, 0.65, 0.5);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

export function createJetMaterial(o: { color: string; strength: number; dim: U<number> }): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: JET_VERT,
    fragmentShader: JET_FRAG,
    transparent: true,
    depthWrite: false,
    ...ADDITIVE,
    side: DoubleSide,
    toneMapped: false,
    uniforms: {
      uColor: { value: new Color(o.color) },
      uTime: TIME,
      uDim: o.dim,
      uStrength: { value: o.strength },
    },
  })
}

// ---------------------------------------------------------------------------------------------
// Wolf-Rayet wind nebula (billboard)

const NEBULA_FRAG = /* glsl */ `
${HEAD}
uniform vec3 uColor;
uniform float uSize;
uniform float uShell;
uniform float uTime;
uniform float uDim;
uniform float uSeedF;
varying vec2 vUv;
varying float vScale;
void main() {
  float r = length(vUv);
  if (r >= 1.0) discard;
  float rr = r * uSize;
  float ang = atan(vUv.y, vUv.x);
  vec2 c = vec2(cos(ang), sin(ang));
  float clump = edkFbm(vec3(c * 2.2, rr * 0.9 + uSeedF + uTime * 0.02), 5) * 0.5 + 0.5;
  float shell = exp(-pow((rr - uShell * (0.9 + 0.25 * clump)) / (uShell * 0.22), 2.0));
  float fill = exp(-rr / uShell * 2.0) * 0.03;
  float a = (shell * pow(clump, 2.2) + fill) * (1.0 - smoothstep(0.75, 1.0, r));
  vec3 col = uColor * a * 0.09;
  col = edkDim(col, uDim, 0.7, 0.6);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

export function createNebulaMaterial(o: {
  color: string
  size: number
  shell: number
  seed: number
  dim: U<number>
}): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: BILLBOARD_VERT,
    fragmentShader: NEBULA_FRAG,
    transparent: true,
    depthWrite: false,
    ...ADDITIVE,
    toneMapped: false,
    uniforms: {
      uColor: { value: new Color(o.color) },
      uSize: { value: o.size },
      uShell: { value: o.shell },
      uTime: TIME,
      uDim: o.dim,
      uSeedF: { value: o.seed },
    },
  })
}

// ---------------------------------------------------------------------------------------------
// Selection / hover reticle (billboard, always on top)

const RETICLE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uSel;
uniform float uHov;
uniform float uTime;
varying vec2 vUv;
varying float vScale;
void main() {
  float r = length(vUv);
  if (r >= 1.0) discard;
  float aa = fwidth(r);
  float r0 = 0.74;
  float w = mix(0.45, 0.8, uSel) * aa;
  float line = 1.0 - smoothstep(w, w + aa * 1.1, abs(r - r0));
  float glow = exp(-pow((r - r0) / 0.035, 2.0)) * 0.16;
  float ang = atan(vUv.y, vUv.x) + uTime * 0.35;
  float seg = abs(fract(ang * 4.0 / 6.2831853) - 0.5);
  float segAA = fwidth(seg);
  float tickArc = 1.0 - smoothstep(0.1, 0.1 + segAA * 1.5, seg);
  float tickRad = 1.0 - smoothstep(aa * 1.1, aa * 2.3, abs(r - 0.87));
  float ticks = tickArc * tickRad;
  float a = line * max(uSel, uHov * 0.6) + glow * uSel + ticks * uSel * 0.95;
  a = clamp(a, 0.0, 1.0);
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`

export function createReticleMaterial(o: { color: string; size: number }): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: BILLBOARD_VERT,
    fragmentShader: RETICLE_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    uniforms: {
      uColor: { value: new Color(o.color) },
      uSize: { value: o.size },
      uSel: { value: 0 },
      uHov: { value: 0 },
      uTime: TIME,
    },
  })
}
