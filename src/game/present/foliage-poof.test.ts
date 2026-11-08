import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { allocatedBytes, COMPILE_WAIT_S, untilQuiet } from "../kernel/alloc-sample.test-util.ts";
import type { PrefabId } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import type { Placed } from "../world/placements.ts";
import { FoliagePoof, PIECES, type FoliageCar } from "./foliage-poof.ts";
import { foliageTint } from "./prefabs-foliage.ts";
import { PropTumble } from "./prop-tumble.ts";

const plain = new THREE.MeshBasicMaterial();
const MATS = { plain, concrete: plain, building: plain, billboard: plain, water: plain };
const STEP = 1 / FRAME_HZ;
const UP = new THREE.Vector3(0, 1, 0);
/** A car with its nose to +x: the yaw that turns local +z there. */
const EAST = Math.PI / 2;
/** A row of bushes (m apart) at z = ROW_Z, from x = ROW_X: far from any other row, in one draw cell. */
const ROW_X = 100;
const ROW_Z = 100;
const GAP = 3;

function plant(prefab: PrefabId, x: number, z: number): Placed {
  return { prefab, x, y: 0, z, yaw: 0, sx: 1, sy: 1, sz: 1 };
}

const row = (n: number): Placed[] => Array.from({ length: n }, (_, i) => plant(PREFAB.bush, ROW_X + GAP * i, ROW_Z));

type Bed = { poof: FoliagePoof; meshes: THREE.InstancedMesh[] };

function bed(placed: Placed[]): Bed {
  const meshes: THREE.InstancedMesh[] = [];
  const tumble = new PropTumble(placed, MATS, (mesh) => meshes.push(mesh));
  return { poof: new FoliagePoof(placed, tumble, plain), meshes };
}

/** A sedan-sized car on (x, z) heading east at `speed`. */
function car(x: number, z: number, speed = 10): FoliageCar {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.quaternion.setFromAxisAngle(UP, EAST);
  return { group, velocity: new THREE.Vector3(speed, 0, 0), frame: { half: { x: 0.95 }, footHalfL: 2.4 } };
}

/** `c` driven east to x = `to`, a frame at a time at its own speed. */
function drive(b: Bed, c: FoliageCar, to: number): void {
  const cars = [c];
  while (c.group.position.x < to) {
    c.group.position.x += c.velocity.x * STEP;
    b.poof.frame(cars, STEP);
  }
}

const m4 = new THREE.Matrix4();

/** Slots of `mesh` still drawn at a size (a hidden one is scaled to nothing). */
function standing(mesh: THREE.InstancedMesh): number[] {
  const out: number[] = [];
  for (let s = 0; s < mesh.count; s++) {
    mesh.getMatrixAt(s, m4);
    if (m4.elements[0] !== 0) out.push(s);
  }
  return out;
}

const BUSH_LEAVES = PIECES[PREFAB.bush]!;

/** Plants puffed away and leaves in the air, each exactly. */
function expectCounts(b: Bed, hidden: number, leaves: number): void {
  const now = b.poof.snapshot();
  expect(now.hidden, "plants hidden").toBe(hidden);
  expect(now.leaves, "leaves in the air").toBe(leaves);
}
/** The car's front edge at x = 104 reaches the third bush (x = 106) and not the fourth (x = 109). */
const THIRD_BUSH = ROW_X + 4;

describe("given a row of eight bushes three metres apart and a sedan driving along it at 10 m/s", () => {
  it("when it drives up to the third bush, then exactly the three bushes it crossed are hidden and each fired one puff", () => {
    const b = bed(row(8));
    drive(b, car(ROW_X - 10, ROW_Z), THIRD_BUSH);
    expect(standing(b.meshes[0]!)).toEqual([3, 4, 5, 6, 7]);
    expectCounts(b, 3, 3 * BUSH_LEAVES);
  });

  it("when it drives the same stretch again, then no bush puffs twice", () => {
    const b = bed(row(8));
    drive(b, car(ROW_X - 10, ROW_Z), THIRD_BUSH);
    drive(b, car(ROW_X - 10, ROW_Z), THIRD_BUSH);
    expectCounts(b, 3, 3 * BUSH_LEAVES);
  });

  it("when the scene resets, then all eight stand again and no leaf is left in the air", () => {
    const b = bed(row(8));
    drive(b, car(ROW_X - 10, ROW_Z), THIRD_BUSH);
    b.poof.reset();
    expect(standing(b.meshes[0]!)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expectCounts(b, 0, 0);
  });

  it("when it drives through, then the leaves are the colour of the bush it hit", () => {
    const b = bed(row(1));
    drive(b, car(ROW_X - 10, ROW_Z), ROW_X);
    const want = new THREE.Color();
    foliageTint(PREFAB.bush, 0, want);
    const leaf = b.poof.leaves.instanceColor!;
    for (const [at, channel] of [want.r, want.g, want.b].entries()) {
      expect(leaf.getComponent(0, at), `channel ${at} of the first leaf`).toBeGreaterThanOrEqual(channel * 0.7);
      expect(leaf.getComponent(0, at), `channel ${at} of the first leaf`).toBeLessThanOrEqual(channel * 1.3 + 1e-6);
    }
  });
});

describe("given a bush a car could touch without driving through it", () => {
  const touches: Record<string, (c: FoliageCar) => void> = {
    "creeps at 1 m/s": (c) => c.velocity.set(1, 0, 0),
    "passes three metres to the side": (c) => c.group.position.z += 3,
    "flies three metres above it": (c) => c.group.position.y += 3,
    "is hidden (not in this scene)": (c) => (c.group.visible = false),
  };
  for (const [what, touch] of Object.entries(touches)) {
    it(`when a car that ${what} drives past, then the bush stands and no leaf flies`, () => {
      const b = bed(row(1));
      const c = car(ROW_X - 10, ROW_Z);
      touch(c);
      drive(b, c, ROW_X + 4);
      expect(standing(b.meshes[0]!)).toEqual([0]);
      expectCounts(b, 0, 0);
    });
  }
});

describe("given a flower bed", () => {
  it("when a car drives over it, then both of its parts (blooms and soil) are hidden", () => {
    const b = bed([plant(PREFAB.flowers, ROW_X, ROW_Z)]);
    drive(b, car(ROW_X - 10, ROW_Z), ROW_X);
    expect(b.meshes.map(standing)).toEqual([[], []]);
    expect(b.poof.snapshot().leaves).toBe(PIECES[PREFAB.flowers]);
  });
});

/** 2000 bushes four metres apart (50 by 40) and 16 cars in lanes across them, all driving east. */
const FIELD = { cols: 50, rows: 40, gap: 4, cars: 16, lane: 10 };

type Field = { b: Bed; cars: FoliageCar[] };

function field(): Field {
  const placed: Placed[] = [];
  for (let r = 0; r < FIELD.rows; r++) for (let c = 0; c < FIELD.cols; c++) placed.push(plant(PREFAB.bush, c * FIELD.gap, r * FIELD.gap));
  return { b: bed(placed), cars: Array.from({ length: FIELD.cars }, (_, k) => car(-20, k * FIELD.lane + 2, 30)) };
}

/** Every car back at the west edge and every bush standing: the pass starts over, so puffs keep happening while the rows measure. */
function restart(f: Field): void {
  f.b.poof.reset();
  for (const c of f.cars) c.group.position.x = -20;
}

/** One frame of the field: the cars step east, the poof sees them. */
function step(f: Field): void {
  for (const c of f.cars) c.group.position.x += c.velocity.x * STEP;
  f.b.poof.frame(f.cars, STEP);
}

const BOUND_KB = 8;
const WARM = 400;
const MEASURE = 300;
/** A pass is 240 frames (30 m/s over the field's 200 m and the lead-in). */
const PASS = 240;
/** The most a car may test in a frame: its footprint's grid cells hold a handful of the field's four-metre bushes each. */
const TESTS_PER_CAR = 40;

describe("given 2000 bushes and 16 cars driving through them", () => {
  it("when the cars cross the whole field, then no frame tests more than a grid cell's worth of bushes per car", () => {
    const f = field();
    let worst = 0;
    for (let i = 0; i < PASS; i++) {
      step(f);
      worst = Math.max(worst, f.b.poof.snapshot().tests);
    }
    expect(worst, "bushes tested in the worst frame").toBeLessThanOrEqual(FIELD.cars * TESTS_PER_CAR);
    expect(f.b.poof.snapshot().hidden, "the cars did cross bushes").toBeGreaterThan(0);
  });

  /** KB a frame over `MEASURE` frames of passes of a warmed field; `extra` runs each frame inside the measure. */
  function kbPerFrame(extra?: () => void): number {
    const f = field();
    let n = 0;
    const frame = (): void => {
      if (n++ % PASS === 0) restart(f);
      step(f);
      extra?.();
    };
    for (let i = 0; i < WARM; i++) frame();
    return allocatedBytes(() => {
      for (let i = 0; i < MEASURE; i++) frame();
    }) / 1024 / MEASURE;
  }

  it(`when 300 frames of passes are stepped, then the poof allocates at most ${BOUND_KB} KB per frame`, () => {
    const kb = untilQuiet(() => kbPerFrame(), BOUND_KB);
    expect(kb, `${kb.toFixed(2)} KB per frame > ${BOUND_KB} in every run for ${COMPILE_WAIT_S} s: the poof allocates again`).toBeLessThanOrEqual(BOUND_KB);
  });

  it("when a frame also makes two hundred vectors, then the measure reads over the bar", () => {
    const kept: THREE.Vector3[] = [];
    const kb = kbPerFrame(() => {
      for (let i = 0; i < 200; i++) kept[i % 8] = new THREE.Vector3();
    });
    expect(kb, `${kb.toFixed(2)} KB per frame for 200 vectors a frame: the measure sees nothing`).toBeGreaterThan(BOUND_KB);
  });
});
