import { glslFloat } from "./car-finish.ts";

/**
 * Candy paint: the car's exterior paint gets deeper colour, a glassier base and a full clear coat, and on the post tiers a thin-film hue
 * shift in the clear coat's reflection. All of it is arithmetic in the paint's own program (uniforms only, no define, no new program);
 * bare steel, black trim and the cabin keep their looks (`candyW` is 0 there).
 */

/** The slider's strength (0-2), the FX tier's share of the effect (0 off and minimal, 1 low and up) and the film's share (1 on high and ultra). Shared by every paint material. */
export const CANDY_STRENGTH = { value: 1 };
export const CANDY_TIER = { value: 1 };
export const CANDY_FILM = { value: 0 };

/** The most the slider times the Materials strength can ask for: past it the colour clips and the paint stops reading as the livery. */
const CANDY_MAX = 1.5;
/** At full candy: colour saturation gain, the tone curve's exponent (whites stay white, mid tones deepen), base roughness and metalness multipliers (the reference shell is 0.057 / 0.084). */
const SATURATION_GAIN = 0.35;
const DEPTH_EXPONENT = 0.3;
const ROUGHNESS_SHARE = 0.45;
const METALNESS_TARGET = 0.08;
const COAT_ROUGHNESS_TARGET = 0.07;
/** The thin film follows the paint's own hue: its colour at full chroma, scaled between FILM_DEEP (face-on) and FILM_BRIGHT (toward grazing) as the view angle cycles; it shows this much of the time face-on and at most this strongly. */
const FILM_CYCLES = 1.2;
const FILM_FACE_ON = 0.3;
const FILM_DEEP = 0.8;
const FILM_BRIGHT = 1.5;
const FILM_STRENGTH = 0.4;
/** Surfaces facing up (hood, roof, boot: the car-frame normal's |y| between these) take this much more saturation than the vertical sides, which keep the base gain. */
const UP_FROM = 0.5;
const UP_TO = 0.95;
const UP_SATURATION_EXTRA = 0.3;

export const CANDY_PARS_GLSL = /* glsl */ `
uniform float candyStrength;
uniform float candyTier;
uniform float candyFilm;`;

/** After `<color_fragment>` and the primer's own colours: declares `candyAmount` and `candyW` (the share of this fragment that is exterior paint) and deepens the colour. */
export const CANDY_COLOR_GLSL = /* glsl */ `
float candyAmount = clamp(candyStrength * materialStrength * candyTier, 0.0, ${glslFloat(CANDY_MAX)});
float candyW = candyAmount * (1.0 - bareW) * (1.0 - glossW) * (1.0 - cabinW) * (1.0 - wellW);
float candyLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
float candyUp = smoothstep(${glslFloat(UP_FROM)}, ${glslFloat(UP_TO)}, abs(normalize(vBareN).y));
vec3 candyColour = max(mix(vec3(candyLuma), diffuseColor.rgb, 1.0 + (${glslFloat(SATURATION_GAIN)} + ${glslFloat(UP_SATURATION_EXTRA)} * candyUp) * candyW), 0.0);
candyColour = pow(candyColour, vec3(1.0 + ${glslFloat(DEPTH_EXPONENT)} * candyW));
diffuseColor.rgb = candyColour;`;

export const CANDY_ROUGHNESS_GLSL = `roughnessFactor *= mix(1.0, ${glslFloat(ROUGHNESS_SHARE)}, min(candyW, 1.0));`;
export const CANDY_METALNESS_GLSL = `metalnessFactor = mix(metalnessFactor, ${glslFloat(METALNESS_TARGET)}, min(candyW, 1.0));`;

/** After `<lights_physical_fragment>` (and the primer's clear coat cut): the clear coat goes to a full, sharp coat where the paint is. */
export const CANDY_COAT_GLSL = `#ifdef USE_CLEARCOAT
material.clearcoat = mix(material.clearcoat, 1.0, min(candyW, 1.0));
material.clearcoatRoughness = mix(material.clearcoatRoughness, ${glslFloat(COAT_ROUGHNESS_TARGET)}, min(candyW, 1.0));
#endif`;

/**
 * After `<lights_fragment_end>`: the clear coat's reflection takes a thin film of the paint's OWN hue: its colour at full chroma, deeper
 * face-on and brighter toward grazing (a cosine of the view angle), so red stays red. The film's share grows toward grazing, where a real
 * film shows most.
 */
export const CANDY_FILM_GLSL = /* glsl */ `
#ifdef USE_CLEARCOAT
if (candyFilm > 0.0) {
  float filmCos = clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0);
  vec3 filmFamily = candyColour / max(max(candyColour.r, candyColour.g), max(candyColour.b, 1e-4));
  float filmWave = 0.5 + 0.5 * cos(6.28318 * (1.0 - filmCos) * ${glslFloat(FILM_CYCLES)});
  vec3 filmHue = filmFamily * mix(${glslFloat(FILM_DEEP)}, ${glslFloat(FILM_BRIGHT)}, filmWave);
  float filmShare = min(candyW, 1.0) * candyFilm * ${glslFloat(FILM_STRENGTH)} * mix(${glslFloat(FILM_FACE_ON)}, 1.0, pow(1.0 - filmCos, 2.0));
  vec3 filmTint = mix(vec3(1.0), filmHue, filmShare);
  clearcoatSpecularDirect *= filmTint;
  clearcoatSpecularIndirect *= filmTint;
  reflectedLight.indirectSpecular *= mix(vec3(1.0), filmTint, 0.5);
}
#endif`;
