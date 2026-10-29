import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { runWall } from "../contact/crash-scenarios.test-util.ts";
import { DeformableCar } from "./car.ts";
import { bakeRestNormals, CONTOUR_SMOOTHING, SMOOTHING_TIER, smoothNormals } from "./normal-smooth.ts";
import { freshGeometry, ownGeometry, restNormalsOf, type StyleProduct } from "./car-templates.ts";
import { CAR_STYLE_IDS, CAR_STYLES, type CarStyleId } from "./car-variants.ts";
import { paint } from "./test-support.ts";

const CRUSH_SPEED_KPH = 64;
/** Degrees. A soft edge is a facet step the pass is meant to round (between these), a hard edge one it must leave. */
const SOFT_FROM = 10;
const SOFT_TO = 55;
const HARD_FROM = 70;

/** The angle (degrees) between the two vertex normals of every distinct edge of an indexed mesh, in first-seen order. */
function edgeAngles(geometry: THREE.BufferGeometry): number[] {
  const index = geometry.index!.array;
  const nor = geometry.getAttribute("normal").array;
  const count = geometry.getAttribute("normal").count;
  const seen = new Set<number>();
  const angles: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = index[t + k]!;
      const b = index[t + ((k + 1) % 3)]!;
      const key = Math.min(a, b) * count + Math.max(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      const dot = nor[a * 3]! * nor[b * 3]! + nor[a * 3 + 1]! * nor[b * 3 + 1]! + nor[a * 3 + 2]! * nor[b * 3 + 2]!;
      angles.push((Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI);
    }
  }
  return angles;
}

/** The mean angle after, over the edges whose angle before lies in [from, to). */
function meanOver(before: number[], after: number[], from: number, to: number): { edges: number; before: number; after: number } {
  let edges = 0;
  let sumBefore = 0;
  let sumAfter = 0;
  for (let i = 0; i < before.length; i++) {
    if (before[i]! < from || before[i]! >= to) continue;
    edges++;
    sumBefore += before[i]!;
    sumAfter += after[i]!;
  }
  return { edges, before: sumBefore / edges, after: sumAfter / edges };
}

function crushedSedan(strength: number): DeformableCar {
  CONTOUR_SMOOTHING.value = strength;
  SMOOTHING_TIER.value = 1;
  const car = new DeformableCar(paint(), new THREE.Scene(), null, "sedan");
  car.deform.setMode("shape");
  runWall(CRUSH_SPEED_KPH, 1, "front", { car });
  car.flushDeferredSkin();
  car.updateSkin();
  return car;
}

const simHash = (car: DeformableCar): string => createHash("sha256").update(JSON.stringify(car.deform.snapshot())).digest("hex");

describe("given a sedan crushed by a 64 km/h wall hit, drawn at three Car contour strengths", () => {
  const off = crushedSedan(0);
  const normal = crushedSedan(1);
  const twice = crushedSedan(2);
  CONTOUR_SMOOTHING.value = 1;
  const angles = { off: edgeAngles(off.body.geometry), normal: edgeAngles(normal.body.geometry), twice: edgeAngles(twice.body.geometry) };

  it("when the soft facet steps are measured, then the default's mean angle across them is under 80% of the off value and strength 2's lower still", () => {
    const soft = meanOver(angles.off, angles.normal, SOFT_FROM, SOFT_TO);
    const softTwice = meanOver(angles.off, angles.twice, SOFT_FROM, SOFT_TO);
    expect(soft.edges, `the crush leaves ${soft.edges} soft edges to round`).toBeGreaterThan(500);
    expect(soft.after, `strength 1: ${soft.after.toFixed(1)} against ${soft.before.toFixed(1)} degrees`).toBeLessThan(soft.before * 0.8);
    expect(softTwice.after, `strength 2: ${softTwice.after.toFixed(1)} against ${soft.after.toFixed(1)} degrees`).toBeLessThan(soft.after);
  });

  it("when the hard edges are measured, then the default keeps at least 70% of their mean angle", () => {
    const hard = meanOver(angles.off, angles.normal, HARD_FROM, 181);
    expect(hard.edges, `the body has ${hard.edges} hard edges`).toBeGreaterThan(100);
    expect(hard.after, `hard edges ${hard.after.toFixed(1)} against ${hard.before.toFixed(1)} degrees`).toBeGreaterThan(hard.before * 0.7);
  });

  it("when every smoothed normal is read, then it is finite and unit length", () => {
    const nor = normal.body.geometry.getAttribute("normal");
    for (let v = 0; v < nor.count; v++) {
      const length = Math.hypot(nor.getX(v), nor.getY(v), nor.getZ(v));
      expect(Number.isFinite(length) && Math.abs(length - 1) < 1e-4, `vertex ${v}: length ${length}`).toBeTruthy();
    }
  });

  it("when the sim's state is hashed at each strength, then it is the same: smoothing only touches what is drawn", () => {
    expect(simHash(normal), "strength 1 against off").toBe(simHash(off));
    expect(simHash(twice), "strength 2 against off").toBe(simHash(off));
  });

  it("when the slider moves after the crash, then the crashed car's normals follow it on the next skin", () => {
    CONTOUR_SMOOTHING.value = 0;
    off.updateSkin();
    off.flushDeferredSkin();
    const flat = meanOver(angles.off, edgeAngles(off.body.geometry), SOFT_FROM, SOFT_TO);
    CONTOUR_SMOOTHING.value = 1;
    off.updateSkin();
    off.flushDeferredSkin();
    const followed = meanOver(angles.off, edgeAngles(off.body.geometry), SOFT_FROM, SOFT_TO);
    expect(followed.after, `after the slider went to 1: ${followed.after.toFixed(1)} against ${flat.after.toFixed(1)} degrees`).toBeLessThan(flat.after * 0.85);
  });
});

const UP = [0, 0, 1];
const SIDEWAYS = [0.342, 0, 0.94];

/** A flat patch of `columns` by `rows` vertices (z = 0, indexed, one open edge round it), its normals `normals` dealt out in turn; the vertices not on its border are `interior`. */
function flatPatch(columns: number, rows: number, normals: number[][]): { geometry: THREE.BufferGeometry; positions: Float32Array; interior: number[] } {
  const positions = new Float32Array(columns * rows * 3);
  const index: number[] = [];
  const interior: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const v = r * columns + c;
      positions.set([c, r, 0], v * 3);
      if (c > 0 && c < columns - 1 && r > 0 && r < rows - 1) interior.push(v);
      if (c < columns - 1 && r < rows - 1) index.push(v, v + 1, v + columns + 1, v, v + columns + 1, v + columns);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions.slice(), 3));
  geometry.setIndex(index);
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(Array.from({ length: columns * rows }, (_, v) => normals[v % normals.length]!).flat()), 3));
  return { geometry, positions, interior };
}

describe("given two flat faces meeting at a right angle with noisy normals", () => {
  it("when the pass runs, then the noise on a face is pulled together and the edge between the faces keeps its step", () => {
    const columns = 6;
    const { geometry, positions } = flatPatch(columns, 3, [UP]);
    const normals = geometry.getAttribute("normal") as THREE.BufferAttribute;
    const row = columns;
    const tilted = [0.342, 0, 0.94];
    for (let r = 0; r < 3; r++) {
      normals.setXYZ(r * columns + 2, tilted[0]!, tilted[1]!, tilted[2]!);
      for (const c of [3, 4, 5]) normals.setXYZ(r * columns + c, 1, 0, 0);
    }
    const before = normals.array.slice();
    smoothNormals(geometry, positions.map((value) => value + 1), 1);
    const after = normals.array;
    const dot = (a: ArrayLike<number>, i: number, j: number) => a[i * 3]! * a[j * 3]! + a[i * 3 + 1]! * a[j * 3 + 1]! + a[i * 3 + 2]! * a[j * 3 + 2]!;
    const [flat, bent, step, face] = [row + 1, row + 2, row + 3, row + 4];
    expect(dot(after, bent, flat), "the tilted vertex moves toward its flat neighbour").toBeGreaterThan(dot(before, bent, flat));
    expect(dot(after, bent, step), "the step across the 70 degree edge never closes").toBeLessThanOrEqual(dot(before, bent, step) + 1e-6);
    expect(Math.abs(after[face * 3]! - 1) < 1e-6 && Math.abs(after[face * 3 + 2]!) < 1e-6, "the side face's normal, with no neighbour inside the angle but its own face, is untouched").toBeTruthy();
  });
});

/** The sedan and the muscle car (`coupe`): the two bodies the owner looks at. */
const INTACT_STYLES: readonly CarStyleId[] = ["sedan", "coupe"];
/** The body, bonnet, boot lid and the two door skins: the meshes a car draws round. */
const SHELL_COUNT = 5;

function intactCar(style: CarStyleId, strength: number): DeformableCar {
  CONTOUR_SMOOTHING.value = strength;
  SMOOTHING_TIER.value = 1;
  const car = new DeformableCar(paint(), new THREE.Scene(), null, style);
  CONTOUR_SMOOTHING.value = 1;
  return car;
}

const shellsOf = (car: DeformableCar): THREE.BufferGeometry[] => car.skinGeometries().slice(0, SHELL_COUNT);
const normalsOf = (geometry: THREE.BufferGeometry): Float32Array => (geometry.getAttribute("normal").array as Float32Array).slice();

/** The largest difference between two lists of equally long arrays: 0 when they are equal to the bit, Infinity when their shapes differ. */
function largestGap(a: readonly ArrayLike<number>[], b: readonly ArrayLike<number>[]): number {
  if (a.length !== b.length) return Infinity;
  let gap = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.length !== b[i]!.length) return Infinity;
    for (let k = 0; k < a[i]!.length; k++) gap = Math.max(gap, Math.abs(a[i]![k]! - b[i]![k]!));
  }
  return gap;
}

for (const style of INTACT_STYLES) {
  describe(`given an intact ${style} built at three Car contour strengths`, () => {
    const off = intactCar(style, 0);
    const builtNormals = shellsOf(off).map(normalsOf);
    const normal = intactCar(style, 1);
    const twice = intactCar(style, 2);
    const laterOff = intactCar(style, 0);
    const angles = { off: shellsOf(off).map(edgeAngles), normal: shellsOf(normal).map(edgeAngles), twice: shellsOf(twice).map(edgeAngles) };

    it("when the body's soft facet steps are measured, then the default's mean angle across them is under 80% of off's and strength 2's lower still", () => {
      const soft = meanOver(angles.off[0]!, angles.normal[0]!, SOFT_FROM, SOFT_TO);
      const softTwice = meanOver(angles.off[0]!, angles.twice[0]!, SOFT_FROM, SOFT_TO);
      expect(soft.edges, `the body has ${soft.edges} soft edges to round`).toBeGreaterThan(1000);
      expect(soft.after, `strength 1: ${soft.after.toFixed(1)} against ${soft.before.toFixed(1)} degrees`).toBeLessThan(soft.before * 0.8);
      expect(softTwice.after, `strength 2: ${softTwice.after.toFixed(1)} against ${soft.after.toFixed(1)} degrees`).toBeLessThan(soft.after * 0.95);
    });

    it("when each shell's soft facet steps are measured, then the default rounds every one of them", () => {
      for (let shell = 0; shell < SHELL_COUNT; shell++) {
        const soft = meanOver(angles.off[shell]!, angles.normal[shell]!, SOFT_FROM, SOFT_TO);
        expect(soft.edges > 0 && soft.after < soft.before * 0.95, `shell ${shell}: ${soft.after.toFixed(1)} against ${soft.before.toFixed(1)} degrees over ${soft.edges} edges`).toBeTruthy();
      }
    });

    it("when the body's hard edges are measured, then the default keeps at least 70% of their mean angle", () => {
      const hard = meanOver(angles.off[0]!, angles.normal[0]!, HARD_FROM, 181);
      expect(hard.edges, `the body has ${hard.edges} hard edges`).toBeGreaterThan(100);
      expect(hard.after, `hard edges ${hard.after.toFixed(1)} against ${hard.before.toFixed(1)} degrees`).toBeGreaterThan(hard.before * 0.7);
    });

    it("when every drawn normal is read, then it is finite and unit length", () => {
      for (const geometry of shellsOf(twice)) {
        const nor = geometry.getAttribute("normal");
        for (let v = 0; v < nor.count; v++) {
          const length = Math.hypot(nor.getX(v), nor.getY(v), nor.getZ(v));
          expect(Number.isFinite(length) && Math.abs(length - 1) < 1e-4, `vertex ${v}: length ${length}`).toBeTruthy();
        }
      }
    });

    it("when the sim's state is hashed at each strength, then it is the same", () => {
      expect(simHash(normal)).toBe(simHash(off));
      expect(simHash(twice)).toBe(simHash(off));
    });

    it("when a car is built after smoothed ones, then its normals are the built ones to the bit: the baked arrays are never written through", () => {
      expect(largestGap(shellsOf(laterOff).map(normalsOf), builtNormals)).toBe(0);
    });

    it("when the slider goes up and back to 0 on the built car, then the normals follow it and return to the built ones", () => {
      CONTOUR_SMOOTHING.value = 1;
      off.updateSkin();
      const rounded = meanOver(angles.off[0]!, edgeAngles(off.body.geometry), SOFT_FROM, SOFT_TO);
      expect(rounded.after, `after the slider went to 1: ${rounded.after.toFixed(1)} against ${rounded.before.toFixed(1)} degrees`).toBeLessThan(rounded.before * 0.8);
      CONTOUR_SMOOTHING.value = 0;
      off.updateSkin();
      CONTOUR_SMOOTHING.value = 1;
      expect(largestGap(shellsOf(off).map(normalsOf), builtNormals)).toBe(0);
    });
  });
}

/** Slow enough that the crush leaves the rear half of the body where it stood (about 40% of its vertices move at this speed). */
const GENTLE_KPH = 10;

describe(`given a sedan built round and then crushed by a ${GENTLE_KPH} km/h wall hit`, () => {
  const intact = intactCar("sedan", 1);
  const crushed = intactCar("sedan", 1);
  crushed.deform.setMode("shape");
  runWall(GENTLE_KPH, 1, "front", { car: crushed });
  crushed.flushDeferredSkin();
  crushed.updateSkin();
  const rest = crushed.deform.restSkin;
  const unmoved = (v: number) => Math.hypot(...[0, 1, 2].map((k) => crushed.body.geometry.getAttribute("position").array[v * 3 + k]! - rest[v * 3 + k]!)) < 1e-3;

  it("when the vertices the crush left in place are read, then they keep the normals the intact car was drawn with", () => {
    const crushedNormals = crushed.body.geometry.getAttribute("normal").array;
    const intactNormals = intact.body.geometry.getAttribute("normal").array;
    let still = 0;
    for (let v = 0; v < crushed.body.geometry.getAttribute("normal").count; v++) {
      if (!unmoved(v)) continue;
      still++;
      for (let k = 0; k < 3; k++) expect(Math.abs(crushedNormals[v * 3 + k]! - intactNormals[v * 3 + k]!), `vertex ${v} component ${k}`).toBeLessThan(1e-6);
    }
    expect(still > 500 && still < crushed.body.geometry.getAttribute("normal").count - 500, `${still} vertices stayed in place`).toBeTruthy();
  });

  it("when the crashed car is reset, then it is drawn with the intact car's normals again", () => {
    crushed.resetVisual();
    expect(largestGap(shellsOf(crushed).map(normalsOf), shellsOf(intact).map(normalsOf))).toBe(0);
  });
});

describe("given a skin with its border at rest and its interior moved, and rest normals to give", () => {
  it("when the pass runs, then the vertices at rest take the rest normals to the bit and the moved ones are relaxed toward them", () => {
    const { geometry, positions, interior } = flatPatch(6, 3, [SIDEWAYS]);
    const restNormals = new Float32Array(Array.from({ length: 18 }, () => UP).flat());
    smoothNormals(geometry, positions.map((value, i) => (interior.includes(Math.floor(i / 3)) ? value + 1 : value)), 1, restNormals);
    const after = geometry.getAttribute("normal").array;
    const [first, second] = [interior[0]!, interior[1]!];
    expect(largestGap([after.slice(0, 3)], [UP]), "vertex 0 stayed: its rest normal").toBe(0);
    expect(after[first * 3]! < SIDEWAYS[0] && after[first * 3 + 2]! > SIDEWAYS[2], "an interior vertex moved: relaxed toward the rest normals around it").toBeTruthy();
    expect(after[second * 3]!, "and so did the next").toBeLessThan(SIDEWAYS[0]);
  });
});

describe("given a patch whose border is an open edge and noisy normals everywhere", () => {
  it("when the pass runs with every vertex moved, then the interior is pulled together and the border vertices keep their own normals to the bit", () => {
    const noisy = [[0, 0, 1], [0.2, 0, 0.98], [0, 0.2, 0.98], [-0.2, 0, 0.98], [0, -0.2, 0.98]];
    const { geometry, positions, interior } = flatPatch(5, 5, noisy);
    const before = geometry.getAttribute("normal").array.slice();
    smoothNormals(geometry, positions.map((value) => value + 1), 1);
    const after = geometry.getAttribute("normal").array;
    const border = Array.from({ length: 25 }, (_, v) => v).filter((v) => !interior.includes(v));
    expect(largestGap(border.map((v) => after.slice(v * 3, v * 3 + 3)), border.map((v) => before.slice(v * 3, v * 3 + 3))), `${border.length} border vertices untouched`).toBe(0);
    const spread = (a: ArrayLike<number>) => Math.max(...interior.map((v) => Math.hypot(a[v * 3]!, a[v * 3 + 1]!)));
    expect(spread(after), `the interior's tilt fell from ${spread(before).toFixed(3)} to ${spread(after).toFixed(3)}`).toBeLessThan(spread(before) * 0.7);
  });
});

/** The vertices of an indexed mesh on an edge only one face has, places within 0.1 mm taken as one (a crease copy beside its twin is no open edge): read independently of the pass. */
function openEdgeVertices(geometry: THREE.BufferGeometry): number[] {
  const pos = geometry.getAttribute("position").array;
  const index = geometry.index!.array;
  const place = (v: number) => [0, 1, 2].map((k) => Math.round(pos[v * 3 + k]! * 1e4)).join(",");
  const faces = new Map<string, number>();
  const edge = (a: number, b: number) => [place(a), place(b)].sort().join("|");
  const sides: [number, number][] = [];
  for (let t = 0; t < index.length; t += 3) for (let k = 0; k < 3; k++) sides.push([index[t + k]!, index[t + ((k + 1) % 3)]!]);
  for (const [a, b] of sides) faces.set(edge(a, b), (faces.get(edge(a, b)) ?? 0) + 1);
  const open = new Set<number>();
  for (const [a, b] of sides) if (faces.get(edge(a, b)) === 1) open.add(a).add(b);
  return [...open];
}

const SHELL_PRODUCTS: readonly StyleProduct[] = ["body", "hood", "trunkLid", "doorLeft", "doorRight"];

describe("given each style's body, bonnet, boot lid and door skins baked at the most Car contour", () => {
  const twice = 2;
  for (const id of CAR_STYLE_IDS) {
    it(`when the ${id}'s vertices on an open edge (the door and arch cuts, a window opening's lip) are read, then their baked normals are the built ones to the bit and others' are not`, () => {
      let opened = 0;
      let rounded = 0;
      for (const product of SHELL_PRODUCTS) {
        const built = freshGeometry(CAR_STYLES[id], product);
        const baked = bakeRestNormals(built, twice)!;
        const builtNormals = built.getAttribute("normal").array as Float32Array;
        const open = new Set(openEdgeVertices(built));
        for (let v = 0; v < builtNormals.length / 3; v++) {
          const gap = largestGap([baked.subarray(v * 3, v * 3 + 3)], [builtNormals.subarray(v * 3, v * 3 + 3)]);
          if (open.has(v)) expect(gap, `${product} vertex ${v} on an open edge moved ${gap}`).toBe(0);
          else if (gap > 1e-3) rounded++;
        }
        opened += open.size;
      }
      expect(opened > 0 && rounded > 500, `${opened} open-edge vertices held and ${rounded} others rounded`).toBeTruthy();
    });
  }
});

describe("given a style whose door is replaced by a taller one after its first car", () => {
  it("when a second car's shells are baked, then every shell's baked normals are those of its own geometry, never the first car's", () => {
    const style = { ...CAR_STYLES.sedan };
    const first = restNormalsOf(style, "doorLeft", 1)!.slice();
    style.door = { ...style.door, halfHeight: style.door.halfHeight + 0.05 };
    for (const product of SHELL_PRODUCTS) {
      const own = ownGeometry(style, product);
      const baked = restNormalsOf(style, product, 1)!;
      expect(baked.length, `${product}: one baked normal for each vertex of its own geometry`).toBe(own.getAttribute("normal").array.length);
      expect(largestGap([baked], [bakeRestNormals(freshGeometry(style, product), 1)!]), `${product}: baked from its own geometry`).toBe(0);
    }
    const second = restNormalsOf(style, "doorLeft", 1)!;
    expect(second.length !== first.length || largestGap([second], [first]) > 1e-3, "the control: the taller door has other normals").toBeTruthy();
  });

  it("when a car is built of it, then its door skin is drawn with its own baked normals", () => {
    SMOOTHING_TIER.value = 1;
    CONTOUR_SMOOTHING.value = 1;
    const original = CAR_STYLES.sedan.door;
    try {
      new DeformableCar(paint(), new THREE.Scene(), null, "sedan");
      CAR_STYLES.sedan.door = { ...original, halfHeight: original.halfHeight + 0.05 };
      const car = new DeformableCar(paint(), new THREE.Scene(), null, "sedan");
      const expected = bakeRestNormals(freshGeometry(CAR_STYLES.sedan, "doorLeft"), 1)!;
      expect(largestGap([car["doorMeshL"].geometry.getAttribute("normal").array], [expected])).toBe(0);
    } finally {
      CAR_STYLES.sedan.door = original;
    }
  });
});
