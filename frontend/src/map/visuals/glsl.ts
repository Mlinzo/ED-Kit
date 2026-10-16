// Shared GLSL snippets (WebGL2 / GLSL ES 3.00: three.js r163+ only targets WebGL2).

/**
 * Integer-hash gradient noise, fBm, ridged fBm, sphere mapping and rotation helpers.
 * Fragment shaders only (EDK_ZERO reads gl_FragCoord).
 */
export const NOISE_GLSL = /* glsl */ `
// A zero the compiler cannot prove: loops bounded with it stay rolled. ANGLE on Windows hands
// GLSL to D3D's FXC, which fully unrolls constant loops and inlines every call — the bake
// shaders took 1-11 s each to compile (blocking the page) before this.
#define EDK_ZERO int(min(gl_FragCoord.x, 0.0))
uvec3 edkPcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 edkHash3(vec3 p) {
  uvec3 u = edkPcg3d(uvec3(ivec3(p) + 1048576));
  return vec3(u) * (1.0 / 4294967295.0);
}
#ifdef EDK_ROLLED_NOISE
// Same noise with the eight lattice corners in a rolled loop: one inlined hash per call site
// instead of eight. Used by the one-off bake shaders, where compile time matters more than the
// small per-pixel cost.
float edkNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float acc = 0.0;
  for (int c = EDK_ZERO; c < 8; c++) {
    vec3 o = vec3(float(c & 1), float((c >> 1) & 1), float((c >> 2) & 1));
    vec3 w = mix(1.0 - u, u, o);
    acc += dot(edkHash3(i + o) * 2.0 - 1.0, f - o) * w.x * w.y * w.z;
  }
  return 1.6 * acc;
}
#else
float edkNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(edkHash3(i) * 2.0 - 1.0, f);
  float n100 = dot(edkHash3(i + vec3(1.0, 0.0, 0.0)) * 2.0 - 1.0, f - vec3(1.0, 0.0, 0.0));
  float n010 = dot(edkHash3(i + vec3(0.0, 1.0, 0.0)) * 2.0 - 1.0, f - vec3(0.0, 1.0, 0.0));
  float n110 = dot(edkHash3(i + vec3(1.0, 1.0, 0.0)) * 2.0 - 1.0, f - vec3(1.0, 1.0, 0.0));
  float n001 = dot(edkHash3(i + vec3(0.0, 0.0, 1.0)) * 2.0 - 1.0, f - vec3(0.0, 0.0, 1.0));
  float n101 = dot(edkHash3(i + vec3(1.0, 0.0, 1.0)) * 2.0 - 1.0, f - vec3(1.0, 0.0, 1.0));
  float n011 = dot(edkHash3(i + vec3(0.0, 1.0, 1.0)) * 2.0 - 1.0, f - vec3(0.0, 1.0, 1.0));
  float n111 = dot(edkHash3(i + vec3(1.0, 1.0, 1.0)) * 2.0 - 1.0, f - vec3(1.0, 1.0, 1.0));
  return 1.6 * mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z);
}
#endif
float edkFbm(vec3 p, int octaves) {
  float a = 0.5;
  float s = 0.0;
  int n = octaves + EDK_ZERO;
  for (int i = 0; i < n; i++) {
    s += a * edkNoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
// 0..1, sharp crests
float edkRidged(vec3 p, int octaves) {
  float a = 0.5;
  float s = 0.0;
  float w = 1.0;
  int count = octaves + EDK_ZERO;
  for (int i = 0; i < count; i++) {
    float n = 1.0 - abs(edkNoise(p));
    n *= n;
    s += a * n * w;
    w = clamp(n * 1.6, 0.0, 1.0);
    p = p * 2.07 + vec3(5.3, 1.1, 7.7);
    a *= 0.5;
  }
  return s;
}
// Equirectangular uv -> unit sphere point, matching three.js SphereGeometry uvs.
vec3 edkSphere(vec2 uv) {
  float lon = uv.x * 6.28318530718;
  float lat = (uv.y - 0.5) * 3.14159265359;
  float c = cos(lat);
  return vec3(-cos(lon) * c, sin(lat), sin(lon) * c);
}
vec3 edkRotate(vec3 p, vec3 axis, float a) {
  float s = sin(a);
  float c = cos(a);
  return p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
}
// Unit vector from (sin latitude, longitude)
vec3 edkDir(float sinLat, float lon) {
  float c = sqrt(max(0.0, 1.0 - sinLat * sinLat));
  return vec3(-cos(lon) * c, sinLat, sin(lon) * c);
}
`

/** Desaturate + darken a linear colour by a 0..1 dim factor. */
export const DIM_GLSL = /* glsl */ `
vec3 edkDim(vec3 c, float dim, float darken, float desat) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(c, vec3(l), dim * desat) * (1.0 - dim * darken);
}
`

/** Camera-facing quad: PlaneGeometry(2, 2) positions in -1..1, sized in object units. */
export const BILLBOARD_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
varying float vScale;
void main() {
  vUv = position.xy;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  vScale = s;
  mv.xy += position.xy * uSize * s;
  gl_Position = projectionMatrix * mv;
}
`
