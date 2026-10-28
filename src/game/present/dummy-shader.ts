import type * as THREE from "three";
import { DECAL_FACE_AT, DECAL_FLAT, DECAL_H, DECAL_HALF_X, DECAL_HALF_Z, DECAL_NO_PAINT, DECAL_RAISE_STEP, DECAL_W, DECAL_Y, decalMap, FABRIC, FABRIC_CONTRAST, FABRIC_ENV, FABRIC_MAP, FABRIC_RELIEF, FABRIC_ROUGHNESS, FABRIC_TILE } from "./dummy-cloth.ts";
import { DRESS_DECALS } from "./dummy-dress.ts";
import { CAPPED, CUTS_AT, FLAGS_AT, NORMAL_PORTLY_ATTRIBUTE, NORMAL_WOMAN_ATTRIBUTE, OPTIONAL, ORBS_AT, PALETTE_AT, PRINT_ATTRIBUTE, ROLE, ROLES, SHAPE_PORTLY_ATTRIBUTE, SHAPE_WOMAN_ATTRIBUTE } from "./dummy-rig.ts";
import { FACE_RELIEF, faceReliefMap, PRINT_CELL, PRINT_CELLS, PRINT_TEXELS, printMap } from "./dummy-texture.ts";
import { RIM_FRAGMENT, RIM_LIGHT } from "./rim-light.ts";
import { MATERIAL_STRENGTH, MATERIAL_STRENGTH_GLSL } from "../vehicle/material-class.ts";

/**
 * The dummies' shader patch: GLSL skinning from the slot's pose row; in the fragment the slot's garment cuts over the body
 * (sleeve, trouser leg and waist, neckline, shoe top), its fabrics' weave and relief, its outfit's decals, then the prints.
 */

/**
 * The skinning in GLSL: each vertex rides bones `bones.x` and `bones.y` (weight `bones.z` on the second), moved by the
 * slot's bone transforms (`pose`); `dollShown` and `skinPoint` are the same rules in TS. A vertex the slot's build does not
 * draw collapses to a point. A man's clothes hang off the body (the push in the shapes' and normals' w: the woman's for the man
 * and her, the portly man's for him) where the slot's cuts put cloth, scaled by its outfit (flags texel z: torso and sleeves, w: trousers).
 */
const DOLL_COMMON = /* glsl */ `
attribute vec4 ${SHAPE_WOMAN_ATTRIBUTE};
attribute vec4 ${SHAPE_PORTLY_ATTRIBUTE};
attribute vec4 ${NORMAL_WOMAN_ATTRIBUTE};
attribute vec4 ${NORMAL_PORTLY_ATTRIBUTE};
attribute vec4 bones;
attribute vec4 roleKind;
uniform sampler2D dolls;
vec4 dollTexel(int x) { return texelFetch(dolls, ivec2(x, gl_InstanceID), 0); }
vec3 dollTurn(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
bool dollShown() {
  int flags = int(dollTexel(${FLAGS_AT}).x + 0.5);
  int kinds = int(roleKind.y + 0.5);
  return (kinds & flags & 7) != 0 && (kinds & ${OPTIONAL} & ~flags) == 0;
}
void dollSkin(out vec3 p, out vec3 n) {
  int a = int(bones.x + 0.5);
  int b = int(bones.y + 0.5);
  vec4 qa = dollTexel(2 * a + 1);
  vec4 qb = dollTexel(2 * b + 1);
  int flags = int(dollTexel(${FLAGS_AT}).x + 0.5);
  vec3 shaped = position;
  vec3 shapedNormal = normal;
  if ((flags & 2) != 0) {
    shaped = ${SHAPE_WOMAN_ATTRIBUTE}.xyz;
    shapedNormal = ${NORMAL_WOMAN_ATTRIBUTE}.xyz;
  } else if ((flags & 4) != 0) {
    shaped = ${SHAPE_PORTLY_ATTRIBUTE}.xyz;
    shapedNormal = ${NORMAL_PORTLY_ATTRIBUTE}.xyz;
  }
  int role = int(roleKind.x + 0.5);
  vec4 cuts = dollTexel(${CUTS_AT});
  vec4 flagged = dollTexel(${FLAGS_AT});
  vec2 hung = (flags & 4) != 0 ? vec2(${SHAPE_PORTLY_ATTRIBUTE}.w, ${NORMAL_PORTLY_ATTRIBUTE}.w) : vec2(${SHAPE_WOMAN_ATTRIBUTE}.w, ${NORMAL_WOMAN_ATTRIBUTE}.w);
  float hangs = role == ${ROLE.ARM} ? flagged.z * step(cuts.x, position.y) : (role == ${ROLE.LEGS} ? flagged.w * step(cuts.y, position.y) : flagged.z);
  vec3 rest = shaped + hangs * vec3(hung.x, 0.0, hung.y) + roleKind.z * dollTexel(${ORBS_AT}).xyz + roleKind.w * dollTexel(${ORBS_AT} + 1).xyz;
  vec3 pa = dollTexel(2 * a).xyz + dollTurn(qa, rest);
  vec3 pb = dollTexel(2 * b).xyz + dollTurn(qb, rest);
  p = dollShown() ? mix(pa, pb, bones.z) : vec3(0.0);
  n = normalize(mix(dollTurn(qa, shapedNormal), dollTurn(qb, shapedNormal), bones.z));
}
vec3 dollColour() { return dollTexel(${PALETTE_AT} + int(roleKind.x + 0.5)).rgb; }`;

/** What a body region shows where the cuts put it: bare skin, the top, the trousers, the shoes (their roles, in this order). */
const PICK = { BARE: 0, TOP: 1, PANTS: 2, SHOES: 3 } as const;
/** A neckline's curve (the slot's scoop texel) is its front, at rest z past this (m). */
const SCOOP_FRONT_Z = 0;
/** Behind, a neckline runs no lower than the neck's base (m, the man's rest). */
const BACK_NECKLINE = 1.46;
/** The body's skin above this (m, the man's rest: under the neck, over every hand) takes the torso's cut too, so a neckline falling between a shirt row and the neck's skin row is cut sharp instead of blended along the triangle. */
const NECK_SKIN_FROM = 1.3;
/** Cut-offs fray (m) over this much above the leg's cut and drop threads this far below it; long trousers (cut under this) do not. */
const FRAY_ABOVE = 0.012;
const FRAY_BELOW = 0.01;
const FRAY_FROM = 0.05;
/** A loose thread's colour (linear): bleached indigo. */
const FRAY_THREAD = [0.62, 0.66, 0.72] as const;
/** The steepest a fabric's relief may tilt the normal (rise over run): woven crests reach 0.24, a jump between two fabrics at a cut would glint. */
const BUMP_SLOPE = 0.3;
/** Added to a vertex's role in the flat role varying when it is the body's own (not a garment shell): only the body takes decals. */
const ON_BODY_MESH = 32;

/** Each role's fabric, or the outfit's (its top's, trousers', shoes'), or a crown's: a cap's twill over the head, else hair. */
const OUTFIT_TOP = -1;
const OUTFIT_PANTS = -2;
const OUTFIT_SHOES = -3;
const CROWN = -4;
const ROLE_FABRIC: Record<keyof typeof ROLE, number> = {
  SHIRT: OUTFIT_TOP, SKIN: FABRIC.SKIN, LEGS: OUTFIT_PANTS, HAIR: CROWN, SHOE: OUTFIT_SHOES, BRIM: FABRIC.TWILL, BADGE: FABRIC.NONE, EYES: FABRIC.NONE, LOCKS: FABRIC.HAIR,
  MUSTACHE: FABRIC.HAIR, TIE: FABRIC.TWILL, COLLAR: FABRIC.COTTON, ARM: OUTFIT_TOP, BELT: FABRIC.LEATHER, BUCKLE: FABRIC.NONE, SOLE: FABRIC.NONE, PATCH: FABRIC.TWILL,
};
/** A role's own roughness, over its fabric's (-1: the fabric's): metal, glass and rubber. */
const ROLE_ROUGHNESS: Partial<Record<keyof typeof ROLE, number>> = { BADGE: 0.3, BUCKLE: 0.3, EYES: 0.1, SOLE: 0.8 };
const ROLE_METAL: Partial<Record<keyof typeof ROLE, number>> = { BADGE: 1, BUCKLE: 1 };
/** A role's own env share over its fabric's (-1: the fabric's): the metal and the eyes mirror the studio, a rubber sole barely. */
const ROLE_ENV: Partial<Record<keyof typeof ROLE, number>> = { BADGE: 1, BUCKLE: 1, EYES: 1, SOLE: 0.25 };

const glslFloat = (value: number): string => value.toFixed(6);
const byRole = (table: Partial<Record<keyof typeof ROLE, number>>, absent: number): number[] =>
  Object.entries(ROLE).sort(([, a], [, b]) => a - b).map(([name]) => table[name as keyof typeof ROLE] ?? absent);

const DECAL_LAYERS = DRESS_DECALS.length;
const FRONT_TEXELS = DECAL_FACE_AT["-z"];
const SIDE_TEXELS = DECAL_FACE_AT["-x"] - DECAL_FACE_AT["+x"];

/**
 * The garment cuts (both stages, `dolls` declared): a body vertex's region (torso, arm, leg, foot by its role) takes its
 * colour from where the slot's cuts put its rest point; `pick` is the strongest region's (`PICK`).
 */
const DOLL_CUTS = /* glsl */ `
vec4 dollRow(int x, int slot) { return texelFetch(dolls, ivec2(x, slot), 0); }
const int DOLL_PICK_ROLE[4] = int[4](${ROLE.SKIN}, ${ROLE.SHIRT}, ${ROLE.LEGS}, ${ROLE.SHOE});
vec3 dollPicked(int slot, int pick) { return dollRow(${PALETTE_AT} + DOLL_PICK_ROLE[pick], slot).rgb; }
vec3 dollCut(int slot, vec3 p, vec4 region, out int pick) {
  vec4 cuts = dollRow(${CUTS_AT}, slot);
  vec4 scoop = dollRow(${CUTS_AT + 1}, slot);
  float across = abs(p.x) / max(scoop.z, 0.001);
  float neckline = mix(scoop.x, scoop.y, pow(across, float((int(scoop.w + 0.5) >> 16) & 15)));
  bool scooped = p.y > (p.z > ${glslFloat(SCOOP_FRONT_Z)} ? neckline : max(neckline, ${glslFloat(BACK_NECKLINE)}));
  ivec4 picks = ivec4(p.y < cuts.z ? ${PICK.PANTS} : (scooped ? ${PICK.BARE} : ${PICK.TOP}), p.y < cuts.x ? ${PICK.BARE} : ${PICK.TOP}, p.y < cuts.y ? ${PICK.BARE} : ${PICK.PANTS}, p.y < cuts.w ? ${PICK.SHOES} : ${PICK.BARE});
  int strongest = region.x >= max(region.y, max(region.z, region.w)) ? 0 : (region.y >= max(region.z, region.w) ? 1 : (region.z >= region.w ? 2 : 3));
  pick = region.x + region.y + region.z + region.w > 0.0 ? picks[strongest] : ${PICK.BARE}; // no region weight (a hand, a shell): never a garment picked by rest height alone
  vec4 share = region / max(region.x + region.y + region.z + region.w, 0.0001);
  return share.x * dollPicked(slot, picks.x) + share.y * dollPicked(slot, picks.y) + share.z * dollPicked(slot, picks.z) + share.w * dollPicked(slot, picks.w);
}`;

/** The fragment's tables and helpers: fabric by pick and by role, and the bump (three's `perturbNormalArb`, from a height's screen slopes). */
const DOLL_FRAGMENT_COMMON = /* glsl */ `
uniform sampler2D dolls;
uniform sampler2D prints;
uniform sampler2D faceRelief;
uniform float uRim;
uniform float uSkinSss;
uniform highp sampler2DArray fabrics;
uniform highp sampler2DArray decals;
varying vec4 vPrint;
flat varying int vDollRole;
// MSAA shades a pixel's centre even off a sliver triangle; centroid keeps the region weights between their vertices' 0 and 1.
centroid varying vec4 vDollRegion;
varying vec3 vDollColour;
flat varying int vDollSlot;
${DOLL_CUTS}
const float DOLL_RELIEF[${FABRIC.NONE}] = float[${FABRIC.NONE}](${FABRIC_RELIEF.map(glslFloat).join(", ")});
const float DOLL_CONTRAST[${FABRIC.NONE}] = float[${FABRIC.NONE}](${FABRIC_CONTRAST.map(glslFloat).join(", ")});
const float DOLL_FABRIC_ROUGHNESS[${FABRIC.NONE + 1}] = float[${FABRIC.NONE + 1}](${FABRIC_ROUGHNESS.map(glslFloat).join(", ")});
const float DOLL_FABRIC_ENV[${FABRIC.NONE + 1}] = float[${FABRIC.NONE + 1}](${FABRIC_ENV.map(glslFloat).join(", ")});
const int DOLL_ROLE_FABRIC[${ROLES}] = int[${ROLES}](${byRole(ROLE_FABRIC, FABRIC.NONE).join(", ")});
const float DOLL_ROLE_ROUGHNESS[${ROLES}] = float[${ROLES}](${byRole(ROLE_ROUGHNESS, -1).map(glslFloat).join(", ")});
const float DOLL_ROLE_METAL[${ROLES}] = float[${ROLES}](${byRole(ROLE_METAL, 0).map(glslFloat).join(", ")});
const float DOLL_ROLE_ENV[${ROLES}] = float[${ROLES}](${byRole(ROLE_ENV, -1).map(glslFloat).join(", ")});
int dollPickFabric(int pick, int kit) { return pick == ${PICK.BARE} ? ${FABRIC.SKIN} : (kit >> (4 * (pick - 1))) & 15; }
int dollRoleFabric(int role, int kit, int flags) {
  int fabric = DOLL_ROLE_FABRIC[role];
  if (fabric == ${CROWN}) return (flags & ${CAPPED}) != 0 ? ${FABRIC.TWILL} : ${FABRIC.HAIR};
  return fabric < 0 ? (kit >> (4 * (-fabric - 1))) & 15 : fabric;
}
vec3 dollBump(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float facing) {
  vec3 sigmaX = dFdx(surfPos);
  vec3 sigmaY = dFdy(surfPos);
  vec2 steepest = ${glslFloat(BUMP_SLOPE)} * vec2(length(sigmaX), length(sigmaY));
  dHdxy = clamp(dHdxy, -steepest, steepest);
  vec3 r1 = cross(sigmaY, surfNorm);
  vec3 r2 = cross(surfNorm, sigmaX);
  float det = dot(sigmaX, r1) * facing;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}`;

/**
 * The cloth over a fragment: the cut colour blended over the vertex colour by how much body region the fragment is, the
 * fabric's weave (triplanar on the rest point, so it rides the body) darkening its hollows, cut-offs' fray, then the
 * outfit's decals on the body itself, never a shell over it (relief and shade on its cloth, paint on any of it). The rest point and normal are the spray patch's `vSprayP`/`vSprayN`.
 */
const CLOTH_FRAGMENT = /* glsl */ `
vec3 dollP = vSprayP;
vec3 dollN = normalize(vSprayN);
int dollPick;
vec3 dollCutColour = dollCut(vDollSlot, dollP, vDollRegion, dollPick);
float dollOnBody = min(vDollRegion.x + vDollRegion.y + vDollRegion.z + vDollRegion.w, 1.0);
vec3 dollCloth = mix(vDollColour, dollCutColour, dollOnBody);
vec4 dollCuts = dollRow(${CUTS_AT}, vDollSlot);
int dollKit = int(dollRow(${CUTS_AT + 1}, vDollSlot).w + 0.5);
int dollRoleHere = vDollRole & ${ON_BODY_MESH - 1};
int dollFabric = dollOnBody > 0.5 ? dollPickFabric(dollPick, dollKit) : dollRoleFabric(dollRoleHere, dollKit, int(dollRow(${FLAGS_AT}, vDollSlot).x + 0.5));
int dollWeaveAt = min(dollFabric, ${FABRIC.NONE - 1});
vec3 dollPlanes = pow(abs(dollN), vec3(4.0));
dollPlanes /= dollPlanes.x + dollPlanes.y + dollPlanes.z;
vec3 dollTile = dollP / ${glslFloat(FABRIC_TILE)};
float dollLayer = float(dollWeaveAt >> 2);
vec4 dollWeave = dollPlanes.x * texture(fabrics, vec3(dollTile.zy, dollLayer)) + dollPlanes.y * texture(fabrics, vec3(dollTile.xz, dollLayer)) + dollPlanes.z * texture(fabrics, vec3(dollTile.xy, dollLayer));
float dollRise = dollWeave[dollWeaveAt & 3];
float dollWoven = float(dollFabric < ${FABRIC.NONE});
dollCloth *= 1.0 + dollWoven * DOLL_CONTRAST[dollWeaveAt] * (dollRise - 0.5) * 2.0;
float dollHeight = dollWoven * DOLL_RELIEF[dollWeaveAt] * dollRise;
float dollAbove = dollP.y - dollCuts.y;
float dollFray = dollPick == ${PICK.PANTS} || dollRoleHere == ${ROLE.LEGS} ? 1.0 - smoothstep(0.0, ${glslFloat(FRAY_ABOVE)}, dollAbove) : (dollPick == ${PICK.BARE} && vDollRegion.z > 0.5 ? 1.0 - smoothstep(0.0, ${glslFloat(FRAY_BELOW)}, -dollAbove) : 0.0);
dollFray *= step(${glslFloat(FRAY_FROM)}, dollCuts.y) * step(${glslFloat(-FRAY_BELOW)}, dollAbove) * step(dollAbove, ${glslFloat(FRAY_ABOVE)});
dollCloth = mix(dollCloth, vec3(${FRAY_THREAD.map(glslFloat).join(", ")}), dollFray * smoothstep(0.45, 0.7, dollWeave.g));
int dollDecalLayer = (dollKit >> 12) & 15;
vec3 dollFacing = abs(dollN);
bool dollSideways = dollFacing.x >= dollFacing.z;
float dollAcross = dollSideways ? (dollP.z + ${glslFloat(DECAL_HALF_Z)}) / ${glslFloat(2 * DECAL_HALF_Z)} : (dollP.x + ${glslFloat(DECAL_HALF_X)}) / ${glslFloat(2 * DECAL_HALF_X)};
float dollFaceAt = dollSideways ? (dollN.x > 0.0 ? ${glslFloat(DECAL_FACE_AT["+x"])} : ${glslFloat(DECAL_FACE_AT["-x"])}) : (dollN.z > 0.0 ? ${glslFloat(DECAL_FACE_AT["+z"])} : ${glslFloat(DECAL_FACE_AT["-z"])});
vec2 dollDecalSt = vec2((dollFaceAt + clamp(dollAcross, 0.0, 1.0) * (dollSideways ? ${glslFloat(SIDE_TEXELS)} : ${glslFloat(FRONT_TEXELS)})) / ${glslFloat(DECAL_W)}, (dollP.y - ${glslFloat(DECAL_Y[0])}) / ${glslFloat(DECAL_Y[1] - DECAL_Y[0])});
float dollDecalOn = float(vDollRole >= ${ON_BODY_MESH} && dollDecalLayer < ${DECAL_LAYERS}) * step(0.0, dollAcross) * step(dollAcross, 1.0) * step(0.0, dollDecalSt.y) * step(dollDecalSt.y, 1.0) * step(dollFacing.y, max(dollFacing.x, dollFacing.z));
int dollDecalLayerAt = min(dollDecalLayer, ${DECAL_LAYERS - 1});
vec4 dollDecal = texture(decals, vec3(dollDecalSt, float(dollDecalLayerAt)));
float dollPaint = texelFetch(decals, ivec3(ivec2(clamp(dollDecalSt, 0.0, 0.9999) * vec2(${DECAL_W}.0, ${DECAL_H}.0)), dollDecalLayerAt), 0).b * 255.0;
float dollOnCloth = dollDecalOn * step(0.5, dollOnBody) * float(dollPick != ${PICK.BARE});
dollCloth *= mix(1.0, dollDecal.r * 255.0 / ${glslFloat(DECAL_FLAT)}, dollOnCloth);
dollHeight += dollOnCloth * (dollDecal.g * 255.0 - ${glslFloat(DECAL_FLAT)}) * ${glslFloat(DECAL_RAISE_STEP)};
if (dollPaint < ${glslFloat(DECAL_NO_PAINT - 0.5)}) dollCloth = mix(dollCloth, dollRow(${PALETTE_AT} + int(dollPaint + 0.5), vDollSlot).rgb, dollDecal.a * dollDecalOn);
diffuseColor.rgb *= dollCloth;
float dollRoughness = DOLL_ROLE_ROUGHNESS[dollRoleHere] >= 0.0 ? DOLL_ROLE_ROUGHNESS[dollRoleHere] : DOLL_FABRIC_ROUGHNESS[min(dollFabric, ${FABRIC.NONE})];
float dollMetalness = DOLL_ROLE_METAL[dollRoleHere];
float dollEnv = DOLL_ROLE_ENV[dollRoleHere] >= 0.0 ? DOLL_ROLE_ENV[dollRoleHere] : DOLL_FABRIC_ENV[min(dollFabric, ${FABRIC.NONE})];`;

/**
 * The print over a fragment: the atlas cell's texel at the vertex's (u, v), held inside the cell, over the cloth by its
 * alpha and the vertex's weight; a face's relief raises its brows, lips and chin where its picture shows. Cell -1 is the
 * slot's face (its flags texel's y).
 */
const PRINT_FRAGMENT = /* glsl */ `
if (vPrint.w > 0.0) {
  vec2 printUv = clamp(vPrint.xy, ${(0.5 / PRINT_TEXELS).toFixed(5)}, ${(1 - 0.5 / PRINT_TEXELS).toFixed(5)});
  vec4 ink = texture2D(prints, vec2(printUv.x, (floor(vPrint.z + 0.5) + printUv.y) / ${PRINT_CELLS}.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, ink.rgb, ink.a * vPrint.w);
  if (vPrint.z < ${glslFloat(PRINT_CELL.BADGE - 0.5)}) dollHeight += ${glslFloat(FACE_RELIEF)} * (texture2D(faceRelief, printUv).r * 2.0 - 1.0) * ink.a * vPrint.w;
}`;

/** 1 on the tiers that draw the skin's subsurface look (high, ultra), 0 elsewhere: the one switch every dummy material shares (a uniform, so no program changes). */
export const SKIN_SSS = { value: 0 };

/** After a plain skin shader's fresnel look (three.js forum, "Skin shader WIP"): blood under the edge, deeper albedo at grazing angles, a soft warm rim. */
const SKIN_BLOOD = [0.15, 0.02, 0.03] as const;
/** The albedo's edge: how far it goes toward its square (saturated, same luma), how much darker, and the colour-to-luma ratio's cap (a blue texel of the face print has a ratio near 14: unbounded it flared); the rim's share is of the albedo itself. Tuned from shots: the forum's full square and 0.5 added rim glowed orange at game distances. */
const SKIN_EDGE_SATURATION = 0.5;
const SKIN_EDGE_DEPTH = 0.9;
const SKIN_TONE_RATIO_MAX = 2.0;
const SKIN_RIM = 0.1;
/** The dark-shade blood tint's share, and the albedo luma (linear) under which it fades to the dark skin's share: a flat add of blood on dark skin glows red. */
const SKIN_SHADE_TINT = 0.25;
const SKIN_DARK_SHARE = 0.3;
const SKIN_DARK_LUMA_FROM = 0.04;
const SKIN_DARK_LUMA_TO = 0.3;

/** Skin fragments' albedo: deeper, more saturated and bloodied toward the edge, plus a rim; arithmetic on the view normal, no fetch. The print's varying is extrapolated at a silhouette sample, so its albedo can be negative there: clamped before the colour-to-luma ratio, which blew it up to a bright sparkle. Declares `skinBlood` (the tint with its edge share) for the shade after the lights. */
const SKIN_FRAGMENT = /* glsl */ `
float skinSss = uSkinSss * float(dollFabric == ${FABRIC.SKIN});
vec3 skinBlood = vec3(0.0);
if (skinSss > 0.0) {
  float skinFresnel = skinSss * (1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0));
  float skinSublit = skinFresnel * skinFresnel;
  vec3 skinAlbedo = max(diffuseColor.rgb, vec3(0.0));
  float skinLuma = dot(skinAlbedo, vec3(0.2126, 0.7152, 0.0722));
  vec3 skinDeep = skinAlbedo * mix(vec3(1.0), min(skinAlbedo / max(skinLuma, 0.0001), vec3(${glslFloat(SKIN_TONE_RATIO_MAX)})), ${glslFloat(SKIN_EDGE_SATURATION)}) * ${glslFloat(SKIN_EDGE_DEPTH)};
  skinDeep *= vec3(1.0) + vec3(${SKIN_BLOOD.map(glslFloat).join(", ")});
  diffuseColor.rgb = mix(skinAlbedo, skinDeep, skinSublit);
  diffuseColor.rgb *= 1.0 + pow(skinFresnel, 4.0) * ${glslFloat(SKIN_RIM)};
  skinBlood = skinSublit * vec3(${SKIN_BLOOD.map(glslFloat).join(", ")}) * ${glslFloat(SKIN_SHADE_TINT)} * mix(${glslFloat(SKIN_DARK_SHARE)}, 1.0, smoothstep(${glslFloat(SKIN_DARK_LUMA_FROM)}, ${glslFloat(SKIN_DARK_LUMA_TO)}, skinLuma));
}`;

/** The lit skin's shade takes a red tint where it is dark and near an edge, after the forum's `outgoingLight += (1 - length) * blood * fresnel`. */
const SKIN_SHADE_FRAGMENT = "outgoingLight += max(1.0 - length(outgoingLight), 0.0) * skinBlood;";

/** Every outfit's decals, one layer each (`DRESS_DECALS`), baked once for every dummy. */
const DECALS = decalMap(DRESS_DECALS);

/**
 * Patch `material` to skin from `dolls`; `lit` also skins the normal and draws the cloth: the slot's cut colours, fabrics,
 * decals and prints in the fragment, the fabric's relief as a bump, each role's roughness and metal, and the rim light (`RIM_LIGHT`).
 */
export function applyDolls(material: THREE.Material, dolls: THREE.Texture, lit: boolean): void {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  const prints = printMap();
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.uniforms.dolls = { value: dolls };
    if (!lit) {
      shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>\n${DOLL_COMMON}`);
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvec3 dollP;\nvec3 dollN;\ndollSkin(dollP, dollN);\ntransformed = dollP;");
      return;
    }
    Object.assign(shader.uniforms, { prints: { value: prints }, faceRelief: { value: faceReliefMap() }, fabrics: { value: FABRIC_MAP }, decals: { value: DECALS }, uRim: RIM_LIGHT, uSkinSss: SKIN_SSS, materialStrength: MATERIAL_STRENGTH });
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\n${DOLL_COMMON}\n${DOLL_CUTS}\nattribute vec4 ${PRINT_ATTRIBUTE};\nvarying vec4 vPrint;\nflat varying int vDollRole;\ncentroid varying vec4 vDollRegion;\nvarying vec3 vDollColour;\nflat varying int vDollSlot;`,
      )
      .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvec3 dollP;\nvec3 dollN;\ndollSkin(dollP, dollN);\nobjectNormal = dollN;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vPrint = vec4(${PRINT_ATTRIBUTE}.xy, ${PRINT_ATTRIBUTE}.z < -0.5 ? dollTexel(${FLAGS_AT}).y : ${PRINT_ATTRIBUTE}.z, ${PRINT_ATTRIBUTE}.w);
int dollRole = int(roleKind.x + 0.5);
float dollBodyMesh = bones.w;
vDollRole = dollRole + ${ON_BODY_MESH} * int(dollBodyMesh);
vDollRegion = dollBodyMesh * vec4(float(dollRole == ${ROLE.SHIRT} || (dollRole == ${ROLE.SKIN} && position.y > ${glslFloat(NECK_SKIN_FROM)})), float(dollRole == ${ROLE.ARM}), float(dollRole == ${ROLE.LEGS}), float(dollRole == ${ROLE.SHOE}));
int dollVertexPick;
vDollColour = vDollRegion.x + vDollRegion.y + vDollRegion.z + vDollRegion.w > 0.0 ? dollCut(gl_InstanceID, position, vDollRegion, dollVertexPick) : dollColour();
vDollSlot = gl_InstanceID;
transformed = dollP;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${MATERIAL_STRENGTH_GLSL}\n${DOLL_FRAGMENT_COMMON}`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${CLOTH_FRAGMENT}\n${PRINT_FRAGMENT}\n${SKIN_FRAGMENT}`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = dollRoughness;")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = dollMetalness;")
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = dollBump(-vViewPosition, normal, vec2(dFdx(dollHeight), dFdy(dollHeight)), faceDirection);")
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n${RIM_FRAGMENT}\nreflectedLight.indirectSpecular *= materialSpecular(dollEnv);`)
      .replace("#include <opaque_fragment>", `${SKIN_SHADE_FRAGMENT}\n#include <opaque_fragment>`);
  };
  material.vertexColors = false;
  material.customProgramCacheKey = () => `${prevKey.call(material)}|dolls-${lit}`;
  material.needsUpdate = true;
}
