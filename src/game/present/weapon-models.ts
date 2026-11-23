import * as THREE from "three";

/** The firearms a person holds. */
export type GunModelId = "pistol" | "shotgun" | "rifle" | "hook";

/**
 * A held firearm: one faceted mesh with a colour per vertex, in the hand's frame. The origin is the grip (where the hand closes), +x runs along the barrel to the
 * muzzle, +y is up, z is across. `muzzle` is the barrel's tip in that frame (x along the barrel, y above the grip): the point a shot and its tracer leave from.
 */
export type GunModel = { readonly geometry: THREE.BufferGeometry; readonly muzzle: readonly [x: number, y: number] };

type Point = readonly [x: number, y: number];
/** One slab of a gun: its colour (sRGB hex), its thickness across (m), its side outline (m), and how far it is turned about the bore (rad). */
type Slab = readonly [colour: number, thick: number, outline: readonly Point[], turn?: number];
type Design = { readonly grip: Point; readonly muzzle: Point; readonly slabs: readonly Slab[] };

const GUNMETAL = 0x2c2f34;
const CHARCOAL = 0x1b1c1f;
const WALNUT = 0x6b4226;
const STEEL = 0xb9bdc4;
const TAN = 0xa58a55;
const ORANGE = 0xf07a2a;
const CABLE = 0xf2d21b;

/** A side outline that is a rectangle. */
const bar = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** A grapple's prong in the side view, above the bore at y = 0.06; the launcher carries three, turned about the bore. */
const PRONG: readonly Point[] = [
  [0.21, 0.068],
  [0.222, 0.066],
  [0.24, 0.086],
  [0.262, 0.092],
  [0.265, 0.1],
  [0.235, 0.095],
];
const THIRD_TURN = (2 * Math.PI) / 3;

/**
 * Each gun as slabs traced from its side view (the model sheets are in `.bench/newShots/weapons/`), in metres with the barrel along +x. Real lengths: a service
 * pistol about 0.2 m, a pump shotgun and a rifle about 1 m.
 */
const DESIGNS: Record<GunModelId, Design> = {
  pistol: {
    grip: [-0.03, -0.03],
    muzzle: [0.153, 0.05],
    slabs: [
      [GUNMETAL, 0.028, [[-0.05, 0.035], [0.15, 0.035], [0.15, 0.058], [0.143, 0.065], [-0.045, 0.065], [-0.05, 0.06]]],
      [CHARCOAL, 0.026, bar(-0.045, 0.018, 0.15, 0.035)],
      [CHARCOAL, 0.026, [[-0.045, 0.02], [0, 0.02], [-0.015, -0.085], [-0.065, -0.085]]],
      [WALNUT, 0.032, [[-0.04, 0.01], [-0.006, 0.01], [-0.02, -0.07], [-0.058, -0.07]]],
      [CHARCOAL, 0.026, bar(-0.066, -0.092, -0.014, -0.085)],
      [CHARCOAL, 0.012, bar(0.01, -0.03, 0.065, -0.024)],
      [CHARCOAL, 0.012, bar(0.059, -0.03, 0.065, 0.018)],
      [STEEL, 0.008, [[0.02, 0.018], [0.03, 0.018], [0.026, -0.012], [0.02, -0.012]]],
      [STEEL, 0.029, bar(0.03, 0.052, 0.075, 0.0655)],
      [STEEL, 0.018, bar(0.15, 0.04, 0.153, 0.06)],
      [STEEL, 0.006, bar(0.135, 0.065, 0.143, 0.071)],
      [CHARCOAL, 0.014, bar(-0.045, 0.065, -0.035, 0.072)],
    ],
  },
  shotgun: {
    grip: [-0.09, 0],
    muzzle: [0.6, 0.051],
    slabs: [
      [WALNUT, 0.04, [[-0.42, -0.09], [-0.14, -0.02], [-0.06, -0.005], [-0.05, 0.045], [-0.08, 0.03], [-0.2, 0.035], [-0.42, 0.03]]],
      [CHARCOAL, 0.042, bar(-0.435, -0.09, -0.42, 0.03)],
      [CHARCOAL, 0.045, [[-0.06, -0.005], [0.14, -0.005], [0.14, 0.065], [-0.02, 0.065], [-0.06, 0.045]]],
      [GUNMETAL, 0.022, bar(0.14, 0.04, 0.6, 0.062)],
      [GUNMETAL, 0.022, bar(0.14, 0.012, 0.46, 0.034)],
      [STEEL, 0.024, bar(0.46, 0.01, 0.475, 0.036)],
      [WALNUT, 0.046, bar(0.2, 0, 0.4, 0.04)],
      [STEEL, 0.012, bar(0, -0.03, 0.07, -0.024)],
      [STEEL, 0.012, bar(0.064, -0.03, 0.07, -0.005)],
      [STEEL, 0.008, bar(0.03, -0.022, 0.036, -0.005)],
      [STEEL, 0.046, bar(0.03, 0.035, 0.1, 0.055)],
      [STEEL, 0.006, bar(0.585, 0.062, 0.595, 0.07)],
    ],
  },
  rifle: {
    grip: [-0.11, -0.04],
    muzzle: [0.56, 0.038],
    slabs: [
      [CHARCOAL, 0.035, [[-0.42, -0.075], [-0.17, 0.01], [-0.17, 0.05], [-0.42, 0.045]]],
      [GUNMETAL, 0.04, [[-0.17, 0], [0.12, 0], [0.12, 0.06], [-0.15, 0.06], [-0.17, 0.05]]],
      [CHARCOAL, 0.02, bar(-0.14, 0.06, -0.1, 0.075)],
      [CHARCOAL, 0.03, [[-0.12, 0], [-0.07, 0], [-0.1, -0.1], [-0.15, -0.09]]],
      [TAN, 0.028, [[0, 0], [0.06, 0], [0.085, -0.11], [0.03, -0.115]]],
      [TAN, 0.028, [[0.03, -0.115], [0.085, -0.11], [0.12, -0.19], [0.07, -0.205]]],
      [STEEL, 0.012, bar(-0.07, -0.035, 0, -0.03)],
      [STEEL, 0.008, bar(-0.04, -0.03, -0.034, 0)],
      [CHARCOAL, 0.045, [[0.12, 0.005], [0.36, 0.012], [0.36, 0.06], [0.12, 0.065]]],
      [GUNMETAL, 0.016, bar(0.36, 0.03, 0.52, 0.046)],
      [GUNMETAL, 0.012, bar(0.4, 0.046, 0.415, 0.09)],
      [GUNMETAL, 0.022, bar(0.52, 0.026, 0.56, 0.05)],
      [STEEL, 0.041, bar(-0.02, 0.03, 0.06, 0.05)],
    ],
  },
  hook: {
    grip: [-0.06, -0.03],
    muzzle: [0.265, 0.06],
    slabs: [
      [ORANGE, 0.06, [[-0.09, 0.02], [0.2, 0.02], [0.2, 0.095], [0.19, 0.105], [-0.08, 0.105], [-0.09, 0.095]]],
      [ORANGE, 0.02, bar(0, -0.02, 0.07, -0.012)],
      [ORANGE, 0.02, bar(0.062, -0.02, 0.07, 0.02)],
      [CHARCOAL, 0.04, [[-0.07, 0.02], [-0.02, 0.02], [-0.05, -0.09], [-0.1, -0.075]]],
      [ORANGE, 0.042, [[-0.1, -0.075], [-0.05, -0.09], [-0.055, -0.105], [-0.105, -0.09]]],
      [STEEL, 0.085, bar(0.02, 0.01, 0.028, 0.115)],
      [STEEL, 0.085, bar(0.062, 0.01, 0.07, 0.115)],
      [CABLE, 0.075, bar(0.028, 0.02, 0.062, 0.105)],
      [STEEL, 0.03, bar(0.2, 0.045, 0.215, 0.075)],
      [STEEL, 0.012, [[0.215, 0.052], [0.26, 0.06], [0.215, 0.068]]],
      [STEEL, 0.012, PRONG, 0],
      [STEEL, 0.012, PRONG, THIRD_TURN],
      [STEEL, 0.012, PRONG, 2 * THIRD_TURN],
    ],
  },
};

/** One slab as flat-shaded triangles about the design's grip; a turned slab is turned about the bore (the line through the muzzle along x). */
function slabGeometry(design: Design, [, thick, outline, turn]: Slab): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  geometry.translate(0, 0, -thick / 2);
  if (turn !== undefined && turn !== 0) {
    geometry.translate(0, -design.muzzle[1], 0);
    geometry.rotateX(turn);
    geometry.translate(0, design.muzzle[1], 0);
  }
  geometry.translate(-design.grip[0], -design.grip[1], 0);
  geometry.computeVertexNormals();
  return geometry;
}

/** The design's slabs as one geometry: positions, flat normals and a colour per vertex. Built once a gun, when it is first asked for. */
function build(design: Design): GunModel {
  const slabs = design.slabs.map((slab) => slabGeometry(design, slab));
  const vertices = slabs.reduce((sum, slab) => sum + slab.getAttribute("position").count, 0);
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const color = new Float32Array(vertices * 3);
  const tint = new THREE.Color();
  let at = 0;
  for (let s = 0; s < slabs.length; s++) {
    const slab = slabs[s]!;
    position.set(slab.getAttribute("position").array, at * 3);
    normal.set(slab.getAttribute("normal").array, at * 3);
    tint.setHex(design.slabs[s]![0]);
    const count = slab.getAttribute("position").count;
    for (let v = at; v < at + count; v++) tint.toArray(color, v * 3);
    at += count;
    slab.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(color, 3));
  return { geometry, muzzle: [design.muzzle[0] - design.grip[0], design.muzzle[1] - design.grip[1]] };
}

const built = new Map<GunModelId, GunModel>();

/** The model of a held firearm, made on first use and shared by everyone who holds one. */
export function gunModel(id: GunModelId): GunModel {
  let model = built.get(id);
  if (model === undefined) {
    model = build(DESIGNS[id]);
    built.set(id, model);
  }
  return model;
}
