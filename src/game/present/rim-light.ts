/** The rim's falloff exponent: a thin edge (tuned from shots: 3 washed a lying body's upward face grey under a high eye). */
const RIM_POWER = "5.0";
/** The rim's colour (linear): a warm back light under 1.0 so it never blooms; starting value, tuned from shots. */
const RIM_COLOUR = "vec3(0.85, 0.82, 0.74)";

/** The people's rim light (0 off .. 1 full), one uniform object every dummy material shares: the HUD's slider writes `value`. */
export const RIM_LIGHT = { value: 0 };

/** Rim after shader-skills' rimLight (MIT): pow(1 - n·v, RIM_POWER); in view space `normal` and `geometryViewDir` are three's own, so it follows the skinned, bumped normal. */
export const RIM_FRAGMENT = /* glsl */ `
// after shader-skills (MIT)
float dollRim = uRim * pow(clamp(1.0 - dot(normal, geometryViewDir), 0.0, 1.0), ${RIM_POWER});
reflectedLight.directSpecular += dollRim * ${RIM_COLOUR};`;
