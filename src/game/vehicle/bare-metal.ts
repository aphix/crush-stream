/**
 * What the paint shows where a panel or bumper has gone (`primer` 1): bare riveted sheet steel, procedural in object space on the body's
 * own skinned vertices, so it stretches and bends with the crush and costs no texture or draw. Panels of `CELL` with dark seams, a rivet
 * row inside each seam at `RIVET_PITCH`, and a per-panel tint so neighbouring sheets read apart.
 */
const CELL = [0.24, 0.16] as const;
/** Seam half-width (m) and the rivet rows' offset from it, spacing and radius (m). */
const SEAM = 0.005;
const RIVET_INSET = 0.014;
const RIVET_PITCH = 0.04;
const RIVET_R = 0.0055;
/** Bare steel (linear RGB), its roughness and metalness. */
const STEEL = [0.2, 0.205, 0.215] as const;
const STEEL_ROUGHNESS = 0.55;
const STEEL_METALNESS = 0.75;
/** The share of that steel's colour an unpainted inner panel keeps (`primer` 2, the bay trough): dark grey under the engine. */
const INNER_SHADE = 0.25;
/** A wheel well's flat colour (linear RGB, `primer` 3): no rivets and no sheen, so a sunlit liner still reads as the dark well. */
const WELL_DARK = 0.012;

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : `${x}`);

export const BARE_METAL_VERTEX = {
  pars: "varying vec3 vBarePos;\nvarying vec3 vBareN;",
  main: "vBarePos = position;\nvBareN = objectNormal;",
} as const;

/** Declares `bareMetal(p, n)`: the riveted steel colour at object-space point `p` with object normal `n`. */
const FUNCTIONS = /* glsl */ `
varying vec3 vBarePos;
varying vec3 vBareN;
float bareRivets(float along, float across) {
  float a = (fract(along / ${f(RIVET_PITCH)}) - 0.5) * ${f(RIVET_PITCH)};
  float b = across - ${f(RIVET_INSET)};
  return 1.0 - smoothstep(${f(RIVET_R * 0.6)}, ${f(RIVET_R)}, length(vec2(a, b)));
}
vec3 bareMetal(vec3 p, vec3 n) {
  vec3 m = abs(n);
  vec2 uv = m.x > m.y && m.x > m.z ? p.zy : (m.y > m.z ? p.xz : p.xy);
  vec2 cell = vec2(${f(CELL[0])}, ${f(CELL[1])});
  vec2 id = floor(uv / cell);
  vec2 local = (uv / cell - id) * cell;
  vec2 edge = min(local, cell - local);
  float seam = 1.0 - smoothstep(${f(SEAM * 0.5)}, ${f(SEAM)}, min(edge.x, edge.y));
  float rivet = max(bareRivets(uv.x, edge.y), bareRivets(uv.y, edge.x));
  float tint = 0.9 + 0.2 * fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 steel = vec3(${f(STEEL[0])}, ${f(STEEL[1])}, ${f(STEEL[2])}) * tint;
  return mix(mix(steel, steel * 0.35, seam), steel * 1.6, rivet);
}`;

/** Fragment replacements, each appended after its include: the colour, roughness, metalness and clearcoat give way to the steel by `bareW`. */
export const BARE_METAL_FRAGMENT = {
  pars: FUNCTIONS,
  color: `float bareW = smoothstep(0.3, 0.6, vPrimer);\nfloat wellW = smoothstep(2.2, 2.8, vPrimer);\ndiffuseColor.rgb = mix(diffuseColor.rgb, bareMetal(vBarePos, vBareN), bareW);\ndiffuseColor.rgb *= mix(1.0, ${f(INNER_SHADE)}, smoothstep(1.2, 1.8, vPrimer));\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(${f(WELL_DARK)}), wellW);`,
  roughness: `roughnessFactor = mix(mix(roughnessFactor, ${f(STEEL_ROUGHNESS)}, bareW), 1.0, wellW);`,
  metalness: `metalnessFactor = mix(metalnessFactor, ${f(STEEL_METALNESS)}, bareW) * (1.0 - wellW);`,
  clearcoat: "#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= 1.0 - bareW;\n#endif",
} as const;
