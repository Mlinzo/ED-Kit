// Materials for planets: the lit surface (MeshStandardMaterial with small shader patches), cloud
// layer, two-shell atmosphere and rings. Everything is lit by the scene's PointLights, so
// multi-star systems get correct terminators and per-star ring shadows.

import {
  BackSide,
  Color,
  DoubleSide,
  FrontSide,
  MeshStandardMaterial,
  ShaderChunk,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  type IUniform,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { DIM_GLSL } from './glsl'
import { LAVA_LEVEL, type PlanetRecipe } from './recipe'
import { ADDITIVE } from './shared'

export type Uniform<T> = IUniform<T>

interface SurfaceExtra {
  [name: string]: IUniform
  uDim: Uniform<number>
  uSea: Uniform<number>
  uLavaLevel: Uniform<number>
  uRelief: Uniform<number>
  uRingTex: Uniform<Texture | null>
  uRingInner: Uniform<number>
  uRingOuter: Uniform<number>
}

const SURFACE_FRAG_DECL = /* glsl */ `
uniform float uDim;
uniform float uSea;
uniform float uLavaLevel;
uniform float uRelief;
${DIM_GLSL}
// Dim relative to the body's mean albedo, so icy moons and pale giants recede as far as dark
// rocks (a flat factor left them as bright as an ordinary lit rock); texture contrast is kept.
vec3 edkDimBody(vec3 c, vec3 mean, float dim) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float m = max(dot(mean, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
  float target = 0.07 * m / (0.15 + m) + 0.012;
  float k = clamp(target / m, 0.1, 0.6);
  return mix(c, vec3(l), dim * 0.85) * mix(1.0, k, dim);
}
#ifdef EDK_RELIEF
varying vec3 vEdkEast;
varying vec3 vEdkNorth;
varying vec3 vEdkObj;
#endif
#ifdef EDK_RING_SHADOW
uniform sampler2D uRingTex;
uniform float uRingInner;
uniform float uRingOuter;
varying vec3 vEdkCenter;
varying vec3 vEdkRingN;
varying float vEdkScale;
float edkRingShadow(vec3 L, vec3 pos) {
  float denom = dot(L, vEdkRingN);
  if (abs(denom) < 1e-4) return 1.0;
  float t = dot(vEdkCenter - pos, vEdkRingN) / denom;
  if (t <= 0.0) return 1.0;
  vec3 hit = pos + L * t;
  float r = length(hit - vEdkCenter) / vEdkScale;
  float u = (r - uRingInner) / (uRingOuter - uRingInner);
  if (u < 0.0 || u > 1.0) return 1.0;
  return 1.0 - texture2D(uRingTex, vec2(u, 0.5)).a * 0.85;
}
#endif
`

// After each point / directional light: ring shadow, and how lit this point is (lava and hot
// giants only glow on the night side; a weak fill light counts for less than a star).
const AFTER_LIGHT = /* glsl */ `
		#ifdef EDK_RING_SHADOW
		directLight.color *= edkRingShadow( directLight.direction, geometryPosition );
		#endif
		edkLit += clamp( dot( geometryNormal, directLight.direction ), 0.0, 1.0 ) *
			min( 1.0, dot( directLight.color, vec3( 0.2126, 0.7152, 0.0722 ) ) * 0.5 );`

const POINT_INFO = 'getPointLightInfo( pointLight, geometryPosition, directLight );'
const DIR_INFO = 'getDirectionalLightInfo( directionalLight, directLight );'
const LIGHTS_BEGIN_PATCHED =
  'float edkLit = 0.0;\n' +
  ShaderChunk.lights_fragment_begin
    .replace(POINT_INFO, POINT_INFO + AFTER_LIGHT)
    .replace(DIR_INFO, DIR_INFO + AFTER_LIGHT)

function patchSurface(shader: WebGLProgramParametersWithUniforms, extra: SurfaceExtra) {
  Object.assign(shader.uniforms, extra)
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      /* glsl */ `#include <common>
#ifdef EDK_RING_SHADOW
varying vec3 vEdkCenter;
varying vec3 vEdkRingN;
varying float vEdkScale;
#endif
#ifdef EDK_RELIEF
varying vec3 vEdkEast;
varying vec3 vEdkNorth;
varying vec3 vEdkObj;
#endif`,
    )
    .replace(
      '#include <project_vertex>',
      /* glsl */ `#include <project_vertex>
#ifdef EDK_RING_SHADOW
vEdkCenter = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
vEdkRingN = normalize((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
vEdkScale = length((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
#endif
#ifdef EDK_RELIEF
vec3 edkP = normalize(position);
vec3 edkE = vec3(edkP.z, 0.0, -edkP.x);
float edkEl = length(edkE);
edkE = edkEl > 1e-5 ? edkE / edkEl : vec3(0.0, 0.0, 1.0);
vEdkEast = normalize(normalMatrix * edkE);
vEdkNorth = normalize(normalMatrix * cross(edkP, edkE));
vEdkObj = edkP;
#endif`,
    )
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${SURFACE_FRAG_DECL}`)
    .replace(
      '#include <map_fragment>',
      /* glsl */ `#include <map_fragment>
float edkH = 0.5;
vec3 edkMean = diffuseColor.rgb;
#ifdef USE_MAP
edkH = sampledDiffuseColor.a;
diffuseColor.a = 1.0;
edkMean = textureLod(map, vec2(0.5), 16.0).rgb; // 1x1 mip level: the body's mean albedo
#endif
diffuseColor.rgb = edkDimBody(diffuseColor.rgb, edkMean, uDim);`,
    )
    .replace(
      '#include <normal_fragment_maps>',
      /* glsl */ `#include <normal_fragment_maps>
#if defined( EDK_RELIEF ) && defined( USE_MAP )
{
  // Height (texture alpha) gradient on the sphere -> tilt the normal along east / north.
  vec2 ts = 1.0 / vec2(textureSize(map, 0));
  float hE = texture2D(map, vMapUv + vec2(ts.x, 0.0)).a;
  float hW = texture2D(map, vMapUv - vec2(ts.x, 0.0)).a;
  float hN = texture2D(map, vMapUv + vec2(0.0, ts.y)).a;
  float hS = texture2D(map, vMapUv - vec2(0.0, ts.y)).a;
  vec3 po = normalize(vEdkObj);
  float cosLat = max(sqrt(max(1.0 - po.y * po.y, 0.0)), 0.1);
  float sE = (hE - hW) / (2.0 * ts.x * 6.2831853 * cosLat);
  float sN = (hN - hS) / (2.0 * ts.y * 3.1415927);
  normal = normalize(normal - uRelief * (sE * normalize(vEdkEast) + sN * normalize(vEdkNorth)));
}
#endif`,
    )
    .replace(
      '#include <roughnessmap_fragment>',
      /* glsl */ `#include <roughnessmap_fragment>
#ifdef EDK_OCEAN
float edkWet = 1.0 - smoothstep(uSea, uSea + 0.025, edkH);
roughnessFactor = mix(roughnessFactor, 0.45, edkWet);
#endif
roughnessFactor = mix(roughnessFactor, 1.0, uDim);`,
    )
    .replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
#ifdef EDK_LAVA
totalEmissiveRadiance *= 1.0 - smoothstep(uLavaLevel - 0.1, uLavaLevel - 0.015, edkH);
#endif
#ifdef EDK_GLOW
totalEmissiveRadiance *= diffuseColor.rgb * 1.8;
#endif
totalEmissiveRadiance *= 1.0 - 0.8 * uDim;`,
    )
    .replace('#include <lights_fragment_begin>', LIGHTS_BEGIN_PATCHED)
    .replace(
      '#include <lights_fragment_end>',
      /* glsl */ `#include <lights_fragment_end>
#if defined( EDK_LAVA ) || defined( EDK_GLOW )
totalEmissiveRadiance *= 1.0 - 0.95 * smoothstep( 0.0, 0.45, edkLit );
#endif`,
    )
}

export interface SurfaceOptions {
  map: Texture
  recipe: PlanetRecipe
  dim: Uniform<number>
  ring: { texture: Texture; inner: number; outer: number } | null
}

export function createSurfaceMaterial({ map, recipe, dim, ring }: SurfaceOptions): MeshStandardMaterial {
  const mt = recipe.material
  const m = new MeshStandardMaterial({
    map,
    roughness: mt.roughness,
    metalness: mt.metalness,
  })
  const defines: Record<string, string> = {}
  if (mt.bump > 0) defines.EDK_RELIEF = ''
  if (mt.sea >= 0) defines.EDK_OCEAN = ''
  if (mt.lava > 0) {
    defines.EDK_LAVA = ''
    m.emissive = new Color(mt.lavaColor)
    m.emissiveIntensity = 2.4 * mt.lava
  } else if (mt.glow > 0) {
    defines.EDK_GLOW = ''
    m.emissive = new Color(mt.glowColor)
    m.emissiveIntensity = mt.glow
  }
  if (ring) defines.EDK_RING_SHADOW = ''
  m.defines = defines
  const extra: SurfaceExtra = {
    uDim: dim,
    uSea: { value: mt.sea },
    uLavaLevel: { value: LAVA_LEVEL },
    uRelief: { value: mt.bump },
    uRingTex: { value: ring?.texture ?? null },
    uRingInner: { value: ring?.inner ?? 1 },
    uRingOuter: { value: ring?.outer ?? 2 },
  }
  m.onBeforeCompile = (shader) => patchSurface(shader, extra)
  m.customProgramCacheKey = () => 'edk-surface-v3'
  return m
}

function patchDimOnly(shader: WebGLProgramParametersWithUniforms, dim: Uniform<number>) {
  shader.uniforms.uDim = dim
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nuniform float uDim;\n${DIM_GLSL}`)
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>\ndiffuseColor.rgb = edkDim(diffuseColor.rgb, uDim, 0.78, 0.85);\ndiffuseColor.a *= 1.0 - 0.35 * uDim;`,
    )
}

export function createCloudMaterial(map: Texture, dim: Uniform<number>): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    map,
    transparent: true,
    depthWrite: false,
    roughness: 1,
    metalness: 0,
  })
  m.onBeforeCompile = (shader) => patchDimOnly(shader, dim)
  m.customProgramCacheKey = () => 'edk-clouds-v2'
  return m
}

// ---------------------------------------------------------------------------------------------
// Atmosphere: an outer back-face halo beyond the limb plus an inner front-face limb glow.

const ATMO_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vP;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vP = mv.xyz;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`

const ATMO_FRAG = /* glsl */ `
#include <common>
#include <lights_pars_begin>
uniform vec3 uTint;
uniform float uStrength;
uniform float uDim;
uniform float uEdge;
uniform float uHaze;
varying vec3 vN;
varying vec3 vP;
${DIM_GLSL}
// Lit side glows (wrapped past the terminator), and the rim lights up when backlit.
vec3 edkAtmoLight(vec3 n, vec3 v, vec3 L, vec3 color) {
  float wrap = smoothstep(-0.35, 0.65, dot(n, L));
  float forward = pow(max(dot(-v, L), 0.0), 6.0) * 0.6;
  return color * (wrap + forward);
}
void main() {
  vec3 n = normalize(vN);
  vec3 v = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-vP);
  float ndv = dot(n, v);
#ifdef EDK_OUTER
  float x = clamp(-ndv / uEdge, 0.0, 1.0);
  float a = pow(x, 2.6) * 1.1;
#else
  float f = 1.0 - clamp(ndv, 0.0, 1.0);
  float a = pow(f, 3.5) * 0.9 + f * uHaze * 0.22;
#endif
  vec3 light = ambientLightColor * 0.5;
#if NUM_POINT_LIGHTS > 0
  for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
    vec3 lv = pointLights[i].position - vP;
    float d = length(lv);
    vec3 c = pointLights[i].color * getDistanceAttenuation(d, pointLights[i].distance, pointLights[i].decay);
    light += edkAtmoLight(n, v, lv / max(d, 1e-6), c);
  }
#endif
#if NUM_DIR_LIGHTS > 0
  for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
    light += edkAtmoLight(n, v, directionalLights[i].direction, directionalLights[i].color);
  }
#endif
  vec3 col = uTint * light * RECIPROCAL_PI * a * uStrength;
  col = edkDim(col, uDim, 0.72, 0.75);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

function lightUniforms(): Record<string, IUniform> {
  return UniformsUtils.clone(UniformsLib.lights) as Record<string, IUniform>
}

export function createAtmosphereMaterials(
  atmo: NonNullable<PlanetRecipe['atmosphere']>,
  dim: Uniform<number>,
): { inner: ShaderMaterial; outer: ShaderMaterial } {
  const tint = { value: new Color(atmo.tint) }
  const strength = { value: atmo.strength }
  const common = {
    vertexShader: ATMO_VERT,
    fragmentShader: ATMO_FRAG,
    lights: true,
    transparent: true,
    depthWrite: false,
    ...ADDITIVE,
  }
  const inner = new ShaderMaterial({
    ...common,
    side: FrontSide,
    uniforms: {
      ...lightUniforms(),
      uTint: tint,
      uStrength: strength,
      uDim: dim,
      uEdge: { value: 1 },
      uHaze: { value: atmo.haze },
    },
  })
  const s = atmo.scale
  const outer = new ShaderMaterial({
    ...common,
    side: BackSide,
    defines: { EDK_OUTER: '' },
    uniforms: {
      ...lightUniforms(),
      uTint: tint,
      uStrength: strength,
      uDim: dim,
      uEdge: { value: Math.sqrt(1 - 1 / (s * s)) },
      uHaze: { value: atmo.haze },
    },
  })
  return { inner, outer }
}

// ---------------------------------------------------------------------------------------------
// Rings: banded 1D texture, lit from both sides, shadowed by the planet.

const RING_VERT = /* glsl */ `
varying vec2 vLocal;
varying vec3 vP;
varying vec3 vN;
varying vec3 vCenter;
varying float vScale;
void main() {
  vLocal = position.xy;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vP = mv.xyz;
  vN = normalize(normalMatrix * normal);
  vCenter = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vScale = length((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  gl_Position = projectionMatrix * mv;
}
`

const RING_FRAG = /* glsl */ `
#include <common>
#include <lights_pars_begin>
uniform sampler2D uTex;
uniform float uInner;
uniform float uOuter;
uniform float uPlanetR;
uniform float uDim;
uniform float uOpacity;
varying vec2 vLocal;
varying vec3 vP;
varying vec3 vN;
varying vec3 vCenter;
varying float vScale;
${DIM_GLSL}
// One light on the ring: lit face, light diffusing through to the unlit face, planet shadow.
vec3 edkRingLight(vec3 L, vec3 color, vec3 n, float nv, float density) {
  float nl = dot(n, L);
  float lit = 0.7 + 0.5 * abs(nl);
  if (nl * nv < 0.0) lit *= 0.25 + 0.55 * (1.0 - density);
  vec3 toC = vCenter - vP;
  float tca = dot(toC, L);
  float shadow = 1.0;
  if (tca > 0.0 && uPlanetR > 0.0) {
    float d = sqrt(max(dot(toC, toC) - tca * tca, 0.0));
    float R = vScale * uPlanetR;
    shadow = smoothstep(R * 0.985, R * 1.03, d);
  }
  return color * lit * shadow;
}
void main() {
  float r = length(vLocal);
  float t = (r - uInner) / (uOuter - uInner);
  if (t < 0.0 || t > 1.0) discard;
  vec4 tex = texture2D(uTex, vec2(t, 0.5));
  float alpha = tex.a * uOpacity;
  if (alpha < 0.004) discard;
  vec3 n = normalize(vN);
  vec3 v = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-vP);
  float nv = dot(n, v);
  vec3 light = ambientLightColor * 0.8;
#if NUM_POINT_LIGHTS > 0
  for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
    vec3 lv = pointLights[i].position - vP;
    float d = length(lv);
    vec3 c = pointLights[i].color * getDistanceAttenuation(d, pointLights[i].distance, pointLights[i].decay);
    light += edkRingLight(lv / max(d, 1e-6), c, n, nv, tex.a);
  }
#endif
#if NUM_DIR_LIGHTS > 0
  for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
    light += edkRingLight(directionalLights[i].direction, directionalLights[i].color, n, nv, tex.a);
  }
#endif
  vec3 col = tex.rgb * light * RECIPROCAL_PI;
  col = edkDim(col, uDim, 0.87, 0.85); // rings are paler than most bodies: recede further
  gl_FragColor = vec4(col, alpha * (1.0 - 0.3 * uDim));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export function createRingMaterial(opts: {
  texture: Texture
  inner: number
  outer: number
  dim: Uniform<number>
  opacity?: number
}): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    lights: true,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      ...lightUniforms(),
      uTex: { value: opts.texture },
      uInner: { value: opts.inner },
      uOuter: { value: opts.outer },
      uPlanetR: { value: 1 },
      uDim: opts.dim,
      uOpacity: { value: opts.opacity ?? 1 },
    },
  })
}
