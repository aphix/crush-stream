import { describe, expect, it } from "vitest";
import { todoRow } from "../kernel/todo-row.test-util.ts";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { CAGE_STEP } from "../vehicle/car-cage.ts";
import { cageLift, crownY, keelY } from "../vehicle/car-cage-rig.ts";
import { assignClass, CLASSES, type VehicleClassId } from "../vehicle/vehicle-classes.ts";
import { ROLLED_UP_Y, satCars } from "./sat.ts";
import { OUTLINE_REACH, sampleField, VERTICAL_CLEAR } from "./cage-outline.ts";

// A pair's plan SAT against the two cages' overlap in 3D when one car is pitched: the owner's clip 5T3X-7JX2 had a monster truck pinned
// nose-up 27° on a monument's tier and a cop driven into its lowered tail.

const PITCH = (27 * Math.PI) / 180;
/** How far (m) back along z the cop's centre stands from the monster's when its nose is 0.1 m into the tail (lowered 0.5 m), and per 0.1 m more. */
const NOSE_IN = 4.4;
const DEEPER_STEPS = 7;
/** Heights up each cage column the oracle reads (every 2-3 cm of a car's height): the deepest point of a pitched column is anywhere on it. */
const LEVELS = 40;
/** The sweep of the monster's centre height (m) and the cop's distance back (m) the SAT may not read deeper than the cages stand. */
const RISES = [0.5, 1, 1.5];
/** The pitches (degrees) either side of the 30° where the pair's tilt turns the SAT from the outline's bands to every node's own column. */
const SWITCH_PITCHES = [28, 29.5, 30.5, 32];
const SWEEP_FROM = 2.5;
const SWEEP_TO = 4.8;
const SWEEP_STEP = 0.1;
/** The rolls (degrees) a lying monster is staged at: past the 60° where its body lift starts to fade and the pair's tilt turns the SAT to its interior nodes, short of the steep ones where a column lies too flat to share a lattice step of height with the cop's (nothing near 90°, a lift-free police car's alike). Its centre stands `LYING_RISE` m up, the cop's centre `LYING_FROM` to `LYING_TO` m from it (the nose in its roof). */
const ROLLS = [65, 70, 75];
const LYING_RISE = 1.1;
const LYING_FROM = 2.4;
const LYING_TO = 3.6;
const scene = new THREE.Scene();
const one = new THREE.Vector3(1, 1, 1);
const toWorld = new THREE.Matrix4();
const toB = new THREE.Matrix4();
const point = new THREE.Vector3();

function build(cls: VehicleClassId): DeformableCar {
  const car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: cls }, scene, null, CLASSES[cls].style);
  assignClass(car, cls);
  return car;
}

/**
 * How deep (m) `a`'s cage stands in `b`'s, read as the SAT reads a node (`OUTLINE_REACH` less `b`'s plan field there): of every covered
 * node of `a` at `LEVELS` + 1 heights up its column (full poses, drawn body lifts on: `cageLift`) inside `b`'s cage column, the deepest; 0 when none is.
 * With `grazeFree`, a node counts only where its whole column shares more than `VERTICAL_CLEAR` of height with `b`'s column there (a body
 * that overlaps another by less is one over the other, not a plan contact): a level of a column that grazes the other's top is no overlap.
 */
function cageDepthIn(a: DeformableCar, b: DeformableCar, grazeFree: boolean): number {
  const sa = a.cage.style, fa = a.cage.fields, sb = b.cage.style, fb = b.cage.fields;
  const liftA = cageLift(a), liftB = cageLift(b);
  toWorld.compose(a.group.position, a.group.quaternion, one);
  toB.compose(b.group.position, b.group.quaternion, one).invert();
  const plan = b.cage.planField();
  let depth = 0;
  for (let k = 0; k < sa.nu * sa.nv; k++) {
    if (!fa.covered[k]) continue;
    const x = sa.u0 + (k % sa.nu) * sa.step, z = sa.v0 + Math.floor(k / sa.nu) * sa.step;
    const from = point.set(x, fa.bottom[k]! + liftA, z).applyMatrix4(toWorld).applyMatrix4(toB).y;
    const to = point.set(x, fa.top[k]! + liftA, z).applyMatrix4(toWorld).applyMatrix4(toB).y;
    for (let s = 0; s <= LEVELS; s++) {
      point.set(x, fa.bottom[k]! + ((fa.top[k]! - fa.bottom[k]!) * s) / LEVELS + liftA, z).applyMatrix4(toWorld).applyMatrix4(toB);
      const i = Math.round((point.x - sb.u0) / sb.step), j = Math.round((point.z - sb.v0) / sb.step);
      if (i < 0 || j < 0 || i >= sb.nu || j >= sb.nv) continue;
      const kb = j * sb.nu + i;
      if (!fb.covered[kb] || point.y - liftB < fb.bottom[kb]! || point.y - liftB > fb.top[kb]!) continue;
      if (grazeFree && Math.min(Math.max(from, to), fb.top[kb]! + liftB) - Math.max(Math.min(from, to), fb.bottom[kb]! + liftB) <= VERTICAL_CLEAR) continue;
      depth = Math.max(depth, OUTLINE_REACH - sampleField(plan, sb, point.x, point.z));
    }
  }
  return depth;
}

/** The monster at the origin facing +z, pitched `pitch` rad nose-up, its centre `rise` m up; the cop level on y = 0, facing it from `back` m behind. */
function stage(monster: DeformableCar, cop: DeformableCar, rise: number, back: number, pitch = PITCH): void {
  monster.spawnFacing(0, 0, 0, 0);
  monster.group.position.y = rise;
  monster.group.rotation.set(-pitch, 0, 0, "YXZ");
  monster.refreshBasis();
  cop.spawnFacing(0, -back, 0, 0);
  cop.group.position.y = 0;
  cop.refreshBasis();
}

/** The monster at the origin rolled `rollDeg` onto its left side, its roof facing -x, resting a cage half-width up; the cop level, facing +x into the roof from `back` m away. */
function lieOver(monster: DeformableCar, cop: DeformableCar, rollDeg: number, back: number): void {
  monster.spawnFacing(0, 0, 0, 0);
  monster.group.position.y = LYING_RISE;
  monster.group.rotation.set(0, 0, (rollDeg * Math.PI) / 180, "YXZ");
  monster.refreshBasis();
  cop.spawnFacing(-back, 0, Math.PI / 2, 0);
  cop.group.position.y = 0;
  cop.refreshBasis();
}

const monster = build("monster");
const cop = build("police");
const normal = new THREE.Vector3();
const contact = new THREE.Vector3();

/** The deeper of the two cages' depths in each other (`cageDepthIn`), read graze-free where the SAT reads every node's own column (the pair's tilt past `ROLLED_UP_Y`), as it reads grazes where it reads the outline. */
function overlapOf(): number {
  const a = cop.group.matrixWorld.elements;
  const b = monster.group.matrixWorld.elements;
  const grazeFree = Math.abs(a[4]! * b[4]! + a[5]! * b[5]! + a[6]! * b[6]!) < ROLLED_UP_Y;
  return Math.max(cageDepthIn(cop, monster, grazeFree), cageDepthIn(monster, cop, grazeFree));
}

describe("given a monster truck pitched 27° nose-up and a level cop facing its tail", () => {
  it("when the cop's nose is 0.1 to 0.8 m into the tail, lowered 0.5 m, then the contact check reads the cages' 3D overlap to within a lattice step", () => {
    let worst = "";
    let worstOff = 0;
    for (let s = 0; s <= DEEPER_STEPS; s++) {
      stage(monster, cop, 0.5, NOSE_IN - s * 0.1);
      const overlap = overlapOf();
      const sat = satCars(cop, monster, normal, contact, 0) ?? 0;
      if (Math.abs(sat - overlap) <= worstOff) continue;
      worstOff = Math.abs(sat - overlap);
      worst = `${(NOSE_IN - s * 0.1).toFixed(1)} m back: SAT ${sat.toFixed(3)} m against ${overlap.toFixed(3)} m`;
    }
    // The oracle reads as the SAT does; a step is the window of heights (`bandAround`) a node's band takes from its neighbours.
    expect(worstOff, worst).toBeLessThanOrEqual(CAGE_STEP);
  });

  it("when the tail is raised 1.5 m over the cop's cab, no part of either in the other, then the contact check finds no contact", () => {
    stage(monster, cop, 1.5, 3);
    expect(overlapOf(), "the cages overlap").toBe(0);
    const sat = satCars(cop, monster, normal, contact, 0);
    expect(sat, `SAT ${sat?.toFixed(3)} m`).toBe(null);
  });

  it("when its centre stands 0.5, 1.0 or 1.5 m up and the cop 2.5 to 4.8 m back, then the contact check never reads the cages a lattice step deeper in each other than they stand (a raised tail over the cab is no contact)", () => {
    let worst = "";
    let worstOver = 0;
    for (const rise of RISES) {
      for (let back = SWEEP_FROM; back <= SWEEP_TO + 1e-9; back += SWEEP_STEP) {
        stage(monster, cop, rise, back);
        const overlap = overlapOf();
        const sat = satCars(cop, monster, normal, contact, 0) ?? 0;
        if (sat - overlap <= worstOver) continue;
        worstOver = sat - overlap;
        worst = `${rise} m up, ${back.toFixed(1)} m back: SAT ${sat.toFixed(3)} m against ${overlap.toFixed(3)} m`;
      }
    }
    expect(worstOver, worst).toBeLessThanOrEqual(CAGE_STEP);
  });
});

describe("given a monster truck pitched 28° to 32° nose-up, either side of the 30° where the contact check reads every node's own column, and a level cop facing its tail", () => {
  const testCases = SWITCH_PITCHES.map((degrees) => ({
    it: `when the cop's nose is 0.1 to 0.8 m into the tail pitched ${degrees}°, lowered 0.5 m, then the contact check reads the cages' 3D overlap to within a lattice step`,
    degrees,
  }));
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const { degrees } = testCase;
      let worst = "";
      let worstOff = 0;
      for (let s = 0; s <= DEEPER_STEPS; s++) {
        stage(monster, cop, 0.5, NOSE_IN - s * 0.1, (degrees * Math.PI) / 180);
        const overlap = overlapOf();
        const sat = satCars(cop, monster, normal, contact, 0) ?? 0;
        if (Math.abs(sat - overlap) <= worstOff) continue;
        worstOff = Math.abs(sat - overlap);
        worst = `${degrees}° pitched, ${(NOSE_IN - s * 0.1).toFixed(1)} m back: SAT ${sat.toFixed(3)} m against ${overlap.toFixed(3)} m`;
      }
      expect(worstOff, worst).toBeLessThanOrEqual(CAGE_STEP);
    });
  }
});

describe("given a monster truck lying rolled 65°, 70° or 75° over (its body lift faded with the tilt) and a level cop facing its roof", () => {
  const testCases = ROLLS.map((roll) => ({
    it: `when the cop's nose goes into the roof of the monster rolled ${roll}° over, then the contact check reads contact where the cages overlap by more than a lattice step of height, to within a lattice step`,
    roll,
  }));
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const { roll } = testCase;
      let worst = "";
      let worstOff = 0;
      let deepest = 0;
      for (let back = LYING_FROM; back <= LYING_TO + 1e-9; back += SWEEP_STEP) {
        lieOver(monster, cop, roll, back);
        const overlap = overlapOf();
        const sat = satCars(cop, monster, normal, contact, 0) ?? 0;
        deepest = Math.max(deepest, overlap);
        if (Math.abs(sat - overlap) <= worstOff) continue;
        worstOff = Math.abs(sat - overlap);
        worst = `${roll}° over, ${back.toFixed(1)} m back: SAT ${sat.toFixed(3)} m against ${overlap.toFixed(3)} m`;
      }
      expect(deepest, `${roll}° over: the sweep never gets the cop's nose into the roof (deepest ${deepest.toFixed(3)} m)`).toBeGreaterThan(0.3);
      expect(worstOff, worst).toBeLessThanOrEqual(CAGE_STEP);
    });
  }
});

/** How far (m) into the other's roof a car's keel stands: a lattice step less 1 cm, and a step plus 1 cm. */
const KEEL_INTO = [VERTICAL_CLEAR - 0.01, VERTICAL_CLEAR + 0.01];
/** How far (m) over the lower car's centre line the upper car's flank stands: its side edge is over the roof. */
const ROOF_SHIFT = 0.9;

describe("given two sedans, one standing with its keel a little into the other's roof", () => {
  const upper = build("sedan");
  const lower = build("sedan");

  it("when the keel stands a lattice step less 1 cm and a step plus 1 cm into the roof under it, then the graze-free overlap reads none and then the depth (a column that grazes the other's top by less than a step is no overlap)", () => {
    const lowerFields = lower.cage.fields, lowerStyle = lower.cage.style, upperFields = upper.cage.fields, upperStyle = upper.cage.style;
    let roof = -1, keel = -1;
    for (let k = 0; k < lowerStyle.nu * lowerStyle.nv; k++) if (lowerFields.covered[k] && (roof < 0 || lowerFields.top[k]! > lowerFields.top[roof]!)) roof = k;
    for (let k = 0; k < upperStyle.nu * upperStyle.nv; k++) if (upperFields.covered[k] && (keel < 0 || upperFields.bottom[k]! < upperFields.bottom[keel]!)) keel = k;
    // The upper car's lowest node over the lower car's highest, both level and facing alike.
    const dx = lowerStyle.u0 + (roof % lowerStyle.nu) * lowerStyle.step - (upperStyle.u0 + (keel % upperStyle.nu) * upperStyle.step);
    const dz = lowerStyle.v0 + Math.floor(roof / lowerStyle.nu) * lowerStyle.step - (upperStyle.v0 + Math.floor(keel / upperStyle.nu) * upperStyle.step);
    const reads = KEEL_INTO.map((into) => {
      lower.spawnFacing(0, 0, 0, 0);
      lower.group.position.y = 0;
      lower.refreshBasis();
      upper.spawnFacing(dx, dz, 0, 0);
      upper.group.position.y = lowerFields.top[roof]! - upperFields.bottom[keel]! - into;
      upper.refreshBasis();
      return [Math.max(cageDepthIn(upper, lower, true), cageDepthIn(lower, upper, true)), Math.max(cageDepthIn(upper, lower, false), cageDepthIn(lower, upper, false))] as const;
    });
    expect(reads[0]![0], `${KEEL_INTO[0]! * 100} cm into: the oracle reads ${reads[0]![0].toFixed(3)} m`).toBe(0);
    expect(reads[1]![0], `${KEEL_INTO[1]! * 100} cm into: the oracle reads ${reads[1]![0].toFixed(3)} m`).toBeGreaterThan(0.5);
    expect(reads[0]![1], `without the rule the ${KEEL_INTO[0]! * 100} cm graze reads ${reads[0]![1].toFixed(3)} m: the rule is what the row pins`).toBeGreaterThan(0.5);
  });

  it("when its flank edge is over the roof, then the contact check reads no contact at a lattice step less 1 cm and the overlap at a step plus 1 cm, whichever car is asked first", () => {
    const reads = KEEL_INTO.map((into) => {
      lower.spawnFacing(0, 0, 0, 0);
      lower.group.position.y = 0;
      lower.refreshBasis();
      upper.spawnFacing(ROOF_SHIFT, 0, 0, 0);
      upper.group.position.y = crownY(lower) - keelY(upper) - into;
      upper.refreshBasis();
      return [satCars(upper, lower, normal, contact, 0), satCars(lower, upper, normal, contact, 0)] as const;
    });
    expect(reads[0]![0], `${KEEL_INTO[0]! * 100} cm into, upper first: SAT ${reads[0]![0]?.toFixed(3)}`).toBe(null);
    expect(reads[0]![1], `${KEEL_INTO[0]! * 100} cm into, lower first: SAT ${reads[0]![1]?.toFixed(3)}`).toBe(null);
    expect((reads[1]![0] ?? 0), `${KEEL_INTO[1]! * 100} cm into, upper first: SAT ${reads[1]![0]?.toFixed(3)}`).toBeGreaterThan(0.5);
    expect(reads[1]![1], "the two orders read the same depth").toBe(reads[1]![0]);
  });
});

describe("given a monster truck pitched 27° nose-up with its centre 1 m up and a level cop facing its tail", () => {
  todoRow("when the cop is 3.6 m back, then the contact check reads no deeper than the graze-free cages' overlap by a lattice step", "the outline's stretched band reads a one-level graze of the tail's top as a plan contact: SAT 0.750 m against the graze-free overlap 0 m (old behaviour, the pitched rows above read the same before and after; the tilt past 30° reads every node's own column instead)", () => {
    stage(monster, cop, 1, 3.6);
    const sat = satCars(cop, monster, normal, contact, 0) ?? 0;
    const overlap = Math.max(cageDepthIn(cop, monster, true), cageDepthIn(monster, cop, true));
    expect(sat - overlap, `SAT ${sat.toFixed(3)} m against ${overlap.toFixed(3)} m`).toBeLessThanOrEqual(CAGE_STEP);
  });
});
