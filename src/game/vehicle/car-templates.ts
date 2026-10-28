import * as THREE from "three";
import { bakeRestNormals, passesFor } from "./normal-smooth.ts";
import { makeChassisGeometry, withGateSurround } from "./car-chassis-mesh.ts";
import { makeDoorGeometry } from "./car-door-mesh.ts";
import { withFrontBand, withHoodBulge, withRearFittings } from "./car-fittings-mesh.ts";
import { makeRearGlass, makeRearSideGlass, makeSideGlass, makeWindshield, windshieldPoint } from "./car-glass.ts";
import { makeLightBar, withPushBar } from "./car-materials.ts";
import { makeBumperGeometry, makeHoodGeometry, makeTrunkGeometry } from "./car-mesh.ts";
import { drawnStyle, type BodyStyle } from "./car-variants.ts";
import { withSeamCover } from "./part-variants.ts";

/**
 * The geometries a car draws that are a pure function of its style. A style builds each once (`ownGeometry`) and every car gets its own
 * copy: the skin writes positions and normals, `restoreRest` and the panels read the index and `userData`. A template is never drawn or
 * uploaded, so it owns no GPU buffer and leaves with its style (a WeakMap); a car frees only its copy (`DeformableCar.dispose`).
 */
export const STYLE_PRODUCTS = ["body", "hood", "trunkLid", "doorLeft", "doorRight", "bumperFront", "bumperRear", "windshield", "rearGlass", "doorGlassLeft", "doorGlassRight", "quarterGlassLeft", "quarterGlassRight", "policeLightBar"] as const;

export type StyleProduct = (typeof STYLE_PRODUCTS)[number];

function bumperGeometry(front: boolean, style: BodyStyle): THREE.BufferGeometry {
  const fascia = makeBumperGeometry(front, style);
  // A push bar is merged into the front bumper: it follows the bumper's masses and tears off with it (its flying box is the bumper's as drawn); the cage carries its box.
  const drawn = front ? withFrontBand(style.pushBar ? withPushBar(fascia) : fascia, style) : withRearFittings(fascia, style);
  return withSeamCover(drawn, style, front);
}

function hoodGeometry(style: BodyStyle): THREE.BufferGeometry {
  const drawn = drawnStyle(style);
  return withHoodBulge(makeHoodGeometry(drawn), drawn);
}

function windshieldGeometry(style: BodyStyle): THREE.BufferGeometry {
  const drawn = drawnStyle(style);
  const windshield = makeWindshield(drawn);
  if (drawn !== style) {
    // The windshield's centre is the thrown driver's exit point (sim): the style's own pane's, wherever its drawn twin stands.
    const centre = windshieldPoint(style, 0, 0.5);
    windshield.userData.centre = [centre.x, centre.y, centre.z];
  }
  return windshield;
}

const RECIPES: Record<StyleProduct, (style: BodyStyle) => THREE.BufferGeometry> = {
  body: (style) => makeChassisGeometry(drawnStyle(style)),
  hood: hoodGeometry,
  trunkLid: (style) => withGateSurround(makeTrunkGeometry(style), drawnStyle(style)),
  doorLeft: (style) => makeDoorGeometry(-1, style),
  doorRight: (style) => makeDoorGeometry(1, style),
  bumperFront: (style) => bumperGeometry(true, style),
  bumperRear: (style) => bumperGeometry(false, style),
  windshield: windshieldGeometry,
  rearGlass: (style) => makeRearGlass(drawnStyle(style)),
  doorGlassLeft: (style) => makeSideGlass(-1, drawnStyle(style)),
  doorGlassRight: (style) => makeSideGlass(1, drawnStyle(style)),
  quarterGlassLeft: (style) => makeRearSideGlass(-1, drawnStyle(style)),
  quarterGlassRight: (style) => makeRearSideGlass(1, drawnStyle(style)),
  policeLightBar: () => makeLightBar(),
};

/** `product` of `style`, built now, shared with no one. */
export function freshGeometry(style: BodyStyle, product: StyleProduct): THREE.BufferGeometry {
  return RECIPES[product](style);
}

/** A built geometry that is never given out, and the `userData` it was built with (its own is only the shared mark). */
interface Template {
  geometry: THREE.BufferGeometry;
  userData: THREE.BufferGeometry["userData"];
  /** The rest normals last baked, and the relax passes they were baked at. */
  baked?: { passes: number; normals: Float32Array | null };
}

interface StyleTemplates {
  /** The style's fields as the templates were built from them: a field replaced since (a test swaps `door`, `drawn`) retires them. */
  fields: ReadonlyMap<string, unknown>;
  built: Map<StyleProduct, Template>;
}

const templatesByStyle = new WeakMap<BodyStyle, StyleTemplates>();

function sameFields(style: BodyStyle, fields: ReadonlyMap<string, unknown>): boolean {
  const now = Object.entries(style);
  return now.length === fields.size && now.every(([name, value]) => fields.get(name) === value);
}

function templatesOf(style: BodyStyle): StyleTemplates {
  const known = templatesByStyle.get(style);
  if (known !== undefined && sameFields(style, known.fields)) return known;
  const fresh = { fields: new Map(Object.entries(style)), built: new Map<StyleProduct, Template>() };
  templatesByStyle.set(style, fresh);
  return fresh;
}

function templateOf(style: BodyStyle, product: StyleProduct): Template {
  const { built } = templatesOf(style);
  let template = built.get(product);
  if (template === undefined) {
    const geometry = freshGeometry(style, product);
    template = { geometry, userData: geometry.userData };
    geometry.userData = { shared: true };
    built.set(product, template);
  }
  return template;
}

/** A copy of `product` of `style` to own: its own attribute and index arrays, groups, bounds and `userData`, equal to `freshGeometry`'s. */
export function ownGeometry(style: BodyStyle, product: StyleProduct): THREE.BufferGeometry {
  const template = templateOf(style, product);
  const own = template.geometry.clone();
  own.userData = structuredClone(template.userData);
  return own;
}

/** `product`'s built normals relaxed at `strength` (`bakeRestNormals`), once per style and pass count and shared by every car of the style: read them, never write them. */
export function restNormalsOf(style: BodyStyle, product: StyleProduct, strength: number): Float32Array | null {
  const template = templateOf(style, product);
  const passes = passesFor(strength);
  if (template.baked?.passes !== passes) template.baked = { passes, normals: bakeRestNormals(template.geometry, strength) };
  return template.baked.normals;
}
