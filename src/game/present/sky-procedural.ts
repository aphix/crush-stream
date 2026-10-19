import { TIME_OF_DAY, type TimeOfDay } from "../match/types.ts";

/** A sky gradient's three stops (sRGB hex), where it reaches the zenith colour (rad) and how high it rises out of the haze (rad). */
export type SkyStops = { horizon: string; mid: string; zenith: string; zenithElevation: number; hazeTop: number };

/** What the procedural sky draws over a gradient: its clouds lit and in their own shade (sRGB hex), the disc's tint (linear RGB) and stars or none. */
export type ProceduralLook = { cloudLit: string; cloudShade: string; discTint: readonly [number, number, number]; stars: boolean };

/** The sun's tint: times `SUN_DISC` it stays under the post tiers' 1.6 bloom threshold. */
const SUN_TINT = [1.0, 0.86, 0.6] as const;
/** The moon's tint, cooler and dimmer than the sun's: starting value, tuned from shots. */
const MOON_TINT = [0.55, 0.6, 0.72] as const;

const NIGHT_LOOK: ProceduralLook = { cloudLit: "#2a3140", cloudShade: "#11151e", discTint: MOON_TINT, stars: true };

/** A race's procedural sky over its strip's stops (`SKY_LOOKS`): starting values, tuned from shots. */
export const PROCEDURAL_LOOKS: Record<TimeOfDay, ProceduralLook> = {
  [TIME_OF_DAY.day]: { cloudLit: "#f7f8fa", cloudShade: "#a9b4c2", discTint: SUN_TINT, stars: false },
  [TIME_OF_DAY.sunset]: { cloudLit: "#ffc9a0", cloudShade: "#7a5a6a", discTint: SUN_TINT, stars: false },
  [TIME_OF_DAY.night]: NIGHT_LOOK,
};

/** The sandbox's sky (no time of day), whose day horizon is the studio hemisphere light's colour so the sky and the lights agree: starting values, tuned from shots. */
export const SANDBOX_SKY: Record<"day" | "night", SkyStops & ProceduralLook> = {
  day: { horizon: "#b7c4d8", mid: "#7ba3cb", zenith: "#2f6299", zenithElevation: 1.0, hazeTop: 0.25, cloudLit: "#f4f6f8", cloudShade: "#9aa6b4", discTint: SUN_TINT, stars: false },
  night: { horizon: "#0b0d14", mid: "#06080f", zenith: "#03040a", zenithElevation: 1.2, hazeTop: 0.25, ...NIGHT_LOOK },
};

/** The disc's angular radius (rad): 6x the real sun's, about the size of the strip's disc. */
const SUN_RADIUS = 0.03;
/** The disc's brightness over its tint, drawn over the sky under it: under the 1.6 bloom threshold at the post tiers (the dome writes linear into the HDR target). */
const SUN_DISC = 1.4;
/** The glow round the disc over its tint: starting value, tuned from shots. */
const SUN_GLOW = 0.35;
/** Cloud-plane units per unit of a view ray's run over its rise: starting value, tuned from shots. */
const CLOUD_SCALE = 1.3;
/** The clouds' drift (cloud-plane units/s): slow enough to read as weather, not wind. */
const CLOUD_DRIFT = [0.004, 0.0015] as const;
/** Star cells per unit of direction: about 0.6° each. */
const STAR_CELLS = 90;

/** The procedural sky's uniforms and `proceduralSky(d, el)`, spliced into the dome's fragment shader before `main` (it reads the gradient's uniforms). */
export const PROCEDURAL_SKY_GLSL = /* glsl */ `
uniform float uProcedural;
uniform float uCover;
uniform vec3 uSunDir;
uniform float uTime;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec3 uDiscTint;
uniform float uStars;
const float SUN_RADIUS = ${SUN_RADIUS};
const float SUN_DISC = ${SUN_DISC};
const float SUN_GLOW = ${SUN_GLOW};
const float CLOUD_SCALE = ${CLOUD_SCALE};
const vec2 CLOUD_DRIFT = vec2(${CLOUD_DRIFT[0]}, ${CLOUD_DRIFT[1]});
const float STAR_CELLS = ${STAR_CELLS.toFixed(1)};
// Hash, value noise and fbm after shader-skills (MIT): integer PCG, the same bits on every GPU.
uint pcgHash(uint v) { v = v * 747796405u + 2891336453u; uint w = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u; return (w >> 22u) ^ w; }
float hash12(vec2 p) { uvec2 q = uvec2(ivec2(floor(p)) + 32768); return float(pcgHash(q.x + pcgHash(q.y)) >> 8u) * (1.0 / 16777216.0); }
float valueNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm4(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * valueNoise(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }
// Sun disc with limb darkening (Neckel 1996 exponents) after shader-skills sunDisk; AA by fwidth, legal here: the branch is uniform.
vec3 sunDisc(vec3 d, vec3 sunDir, float radius) {
  float ang = acos(clamp(dot(d, sunDir), -1.0, 1.0));
  float px = max(fwidth(ang), 1e-5);
  float edge = 1.0 - smoothstep(radius - px, radius + px, ang);
  float r = clamp(ang / radius, 0.0, 1.0);
  return edge * pow(vec3(sqrt(max(1.0 - r * r, 0.0))), vec3(0.397, 0.503, 0.652));
}
// Gradient, glow lobes and clouds after shader-skills simpleSky and coastSky (MIT); stars after its per-cell hash star field.
vec3 proceduralSky(vec3 d, float el) {
  vec3 c = mix(mix(horizonColor, midColor, smoothstep(0.0, MID_EL, el)), zenith, smoothstep(MID_EL, zenithEl, el));
  float mu = max(dot(d, uSunDir), 0.0);
  c += uDiscTint * (0.25 * pow(mu, 8.0) + 0.6 * pow(mu, 64.0)) * SUN_GLOW;
  // Clouds: a plane over the eye, fbm in its (x, z); the cover sets the threshold, thick cores shade darker. None under the horizon,
  // where the mask is 0 anyway, so the fbm is skipped there (no derivatives inside: the branch may diverge).
  float cloud = 0.0;
  if (d.y > 0.0) {
    vec2 cp = d.xz / (d.y + 0.08) * CLOUD_SCALE + uTime * CLOUD_DRIFT;
    float n = fbm4(cp);
    float t0 = mix(0.78, 0.38, uCover);
    cloud = smoothstep(t0, t0 + 0.22, n) * smoothstep(0.0, 0.12, d.y);
    vec3 cloudCol = mix(uCloudLit, uCloudShade, smoothstep(t0 + 0.12, t0 + 0.5, n)) + uDiscTint * pow(mu, 8.0) * 0.25;
    c = mix(c, cloudCol, cloud);
  }
  c = mix(c, uDiscTint * SUN_DISC, sunDisc(d, uSunDir, SUN_RADIUS) * (1.0 - cloud));
  if (uStars > 0.5) {
    // One cell in 200 holds a star.
    vec3 cell = floor(d * STAR_CELLS);
    vec3 f = fract(d * STAR_CELLS) - 0.5;
    float r = hash12(cell.xy + cell.z * 131.0);
    float star = step(0.995, r) * (1.0 - smoothstep(0.0, 0.25, length(f))) * (0.6 + 0.4 * sin(uTime * (2.0 + 4.0 * fract(r * 97.0))));
    c += vec3(star) * smoothstep(0.02, 0.2, d.y) * (1.0 - cloud);
  }
  return c;
}`;
