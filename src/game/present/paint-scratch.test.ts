import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { fleetClass, fleetStyle } from "../scenes/fleet.ts";
import { assignClass } from "../vehicle/vehicle-classes.ts";
import { FACE_BITS, FACE_MASK, FACE_WIDTH, SCRAPE_MAX, SEVERITY, STROKE_BYTES, U0, U1, V0, V1 } from "../vehicle/paint-scrapes.ts";
import { CAR_SPRAY, SPRAY_FACE } from "../vehicle/spray-box.ts";
import { compileHooks } from "../vehicle/car-detail-map.test-util.ts";
import { allocatedBytes, untilQuiet } from "../kernel/alloc-sample.test-util.ts";
import { scavengesDuring } from "../kernel/gc.test-util.ts";
import type { CrashEngine } from "../engine/engine.ts";
import { bootEngine, runSeconds, stubBrowser } from "../engine/engine-headless.test-util.ts";
import "../kernel/rapier-node.test-util.ts";
import { setGround } from "../world/ground.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { applyScratch, DENT_FLOOR, DENT_REBUILD_S, DENT_SETTLE_S, PaintScratches, SCRATCH_TIER } from "./paint-scratch.ts";
import { channelTexels, sampledScratch, wearOf, wearTexels } from "./paint-scratch.test-util.ts";
import { must } from "../kernel/must.test-util.ts";
import { makeCar, runWall } from "../contact/crash-scenarios.test-util.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

/** Bytes a frame may allocate: one boxed double, as the other allocation rows hold. */
const FRAME_BOUND_B = 16;
const FRAMES = 10_000;
/** Frames a dent allocation read runs, each a full redraw of a crushed nose. */
const DENT_FRAMES = 300;

/** A hard shove along a car's left flank at each rest point (-0.85, y, z) of `at`, each episode committed and closed: one stroke each. */
function scraped(car: DeformableCar, at: readonly (readonly [number, number])[]): void {
  car.group.updateMatrixWorld(true);
  const q = car.group.quaternion;
  const inward = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const slide = new THREE.Vector3(0, 0, 8).applyQuaternion(q);
  for (const [y, z] of at) {
    car.scrape(car.group.localToWorld(new THREE.Vector3(-0.85, y, z)), inward, slide, 0.3, 3, 1);
    car.scratches.slice(0.25);
    car.scratches.slice(0.25);
  }
}

describe("given a car with a full stroke list whose list changes before every frame", () => {
  const car = new DeformableCar({ body: 0x808080, accent: 0, name: "a" }, new THREE.Scene(), null, fleetStyle(0));
  assignClass(car, fleetClass(0));
  car.spawnFacing(0, 0, 0, 0);
  scraped(car, Array.from({ length: 200 }, (_, i) => [0.3 + 0.02 * (i % 37), -2 + 0.02 * i] as const));
  applyScratch(car);
  const view = new PaintScratches();
  const cars = [car];
  const frames = (count: number): void => {
    const list = car.scratches.list;
    for (let i = 0; i < count; i++) {
      list[(i % SCRAPE_MAX) * STROKE_BYTES + SEVERITY]! ^= 1;
      car.scratches.version++;
      view.frame(cars, 1 / FRAME_HZ);
    }
  };

  it(`when the wear masks are drawn, then a frame allocates at most ${FRAME_BOUND_B} B`, () => {
    expect(car.scratches.count, "the control: the list is full").toBe(SCRAPE_MAX);
    const perFrame = untilQuiet(() => allocatedBytes(() => frames(FRAMES)) / FRAMES, FRAME_BOUND_B);
    expect(perFrame, `${perFrame.toFixed(1)} B a frame`).toBeLessThanOrEqual(FRAME_BOUND_B);
  });

  it("when the wear masks are drawn, then the garbage collector never runs", async () => {
    frames(FRAMES);
    const minor = await scavengesDuring(() => frames(FRAMES));
    expect(minor, `${minor} minor collections`).toBe(0);
  });
});

/** A moderate grind's severity byte (of 255), and the rows of the left flank its six lanes run along, nose to tail: sill to belt. */
const GRIND_SEVERITY = 128;
const GRIND_ROWS = [6, 12, 18, 24, 30, 36];
/** Recess (mm behind the outermost paint near it) of the paint that counts as proud, and as recessed. */
const PROUD_MM = 3;
const RECESSED_MM = 30;

describe("given a pickup whose left flank, flared arches and the recessed panels below the belt, takes a moderate grind over its whole length", () => {
  const slot = Array.from({ length: 16 }, (_, i) => i).find((i) => fleetStyle(i) === "pickup");
  must(slot !== undefined, "the control: the fleet has a pickup");
  const car = new DeformableCar({ body: 0x808080, accent: 0, name: "p" }, new THREE.Scene(), null, fleetStyle(slot));
  assignClass(car, fleetClass(slot));
  const bytes = new Uint8Array(GRIND_ROWS.length * STROKE_BYTES);
  for (const [k, v] of GRIND_ROWS.entries()) {
    const s = k * STROKE_BYTES;
    bytes[s + U0] = 0;
    bytes[s + U1] = CAR_SPRAY.faces[SPRAY_FACE.left]![2] - 1;
    bytes[s + V0] = v;
    bytes[s + V1] = v;
    bytes[s + FACE_WIDTH] = SPRAY_FACE.left | (30 << FACE_BITS);
    bytes[s + SEVERITY] = GRIND_SEVERITY;
  }
  car.scratches.load(bytes, GRIND_ROWS.length);
  applyScratch(car);
  new PaintScratches().frame([car], 1 / FRAME_HZ);

  it("when its wear mask is drawn, then the proud paint and the arch lips take the grind and paint recessed 3 cm behind them takes under a third of it", () => {
    const cover = car.scratches.cover;
    must(cover, "the control: the pickup has a paint cover");
    const mask = wearTexels(car);
    const [fx, fy, fw] = CAR_SPRAY.faces[SPRAY_FACE.left]!;
    const at = (u: number, v: number): number => (fy + v) * CAR_SPRAY.w + fx + u;
    const sums = { proud: [0, 0], lip: [0, 0], recessed: [0, 0] };
    const add = (sum: number[], r: number): void => {
      sum[0]! += r;
      sum[1]!++;
    };
    for (let v = GRIND_ROWS[0]!; v <= GRIND_ROWS.at(-1)!; v++) {
      for (let u = 0; u < fw; u++) {
        const c = cover[at(u, v)]!;
        if (c === 0) continue;
        const r = mask[at(u, v) * 2]!;
        // The arch's lip: paint just over the wheel's opening (no paint one or two rows below).
        if (cover[at(u, v - 1)] === 0 || cover[at(u, v - 2)] === 0) add(sums.lip, r);
        if (c - 1 <= PROUD_MM) add(sums.proud, r);
        if (c - 1 >= RECESSED_MM) add(sums.recessed, r);
      }
    }
    const mean = (k: keyof typeof sums): number => sums[k][0]! / sums[k][1]!;
    const note = `mean R: proud ${mean("proud").toFixed(1)} (${sums.proud[1]} texels), lip ${mean("lip").toFixed(1)} (${sums.lip[1]}), recessed ${mean("recessed").toFixed(1)} (${sums.recessed[1]})`;
    expect(Math.min(sums.proud[1]!, sums.lip[1]!, sums.recessed[1]!), `the control: each kind of paint lies under the grind; ${note}`).toBeGreaterThan(20);
    expect(mean("recessed") * 3, note).toBeLessThan(mean("proud"));
    expect(mean("recessed") * 3, note).toBeLessThan(mean("lip"));
  });
});

/** A sedan whose nose hit a wall at 50 km/h, its crushed skin drawn. */
function crushedSedan(): DeformableCar {
  const car = makeCar();
  runWall(50, 1, "front", { car, after: 1 });
  car.updateSkin();
  car.flushDeferredSkin();
  return car;
}

/** G of `car`'s wear mask over `face`, texel by texel; with `share`, only the first share of the face's texels along u. */
function dentsOn(car: DeformableCar, face: number, share = 1): number[] {
  const data = wearTexels(car);
  const [fx, fy, fw, fh] = CAR_SPRAY.faces[face]!;
  const out: number[] = [];
  for (let y = fy; y < fy + fh; y++) for (let x = fx; x < fx + Math.round(fw * share); x++) out.push(data[(y * CAR_SPRAY.w + x) * 2 + 1]!);
  return out;
}

/** A crush step's skin write on `car`'s body. */
function skinWritten(car: DeformableCar): void {
  car.lookMeshes().body.geometry.getAttribute("position").needsUpdate = true;
}

/**
 * Distinct crease ridges one face of a 50 km/h nose crush may draw: a crush crumples ≤ 0.6 m of a panel into lobes 10-20 cm long
 * (sheet steel buckling), ≤ 4 folds, and a face shows two crushed panels at most (the roof face the bonnet and the scuttle, the nose
 * the bumper skin and the grille panel): 8. A crinkle draws one per fold-pattern cell, dozens.
 */
const CREASE_RIDGES_MAX = 8;
/** G at which a texel is on a crease ridge: its crease half drawn past the dulled floor. */
const RIDGE_G = Math.ceil(255 * (DENT_FLOOR + (1 - DENT_FLOOR) / 2));

/** The 8-connected runs of texels on `face` of `car`'s mask whose G reaches `RIDGE_G`. */
function creaseRidges(car: DeformableCar, face: number): number {
  const data = wearTexels(car);
  const [fx, fy, fw, fh] = CAR_SPRAY.faces[face]!;
  const ridge = (x: number, y: number) => x >= 0 && y >= 0 && x < fw && y < fh && data[((fy + y) * CAR_SPRAY.w + fx + x) * 2 + 1]! >= RIDGE_G;
  const seen = new Uint8Array(fw * fh);
  let ridges = 0;
  for (let s = 0; s < fw * fh; s++) {
    if (seen[s] || !ridge(s % fw, Math.floor(s / fw))) continue;
    ridges++;
    seen[s] = 1;
    const open = [s];
    while (open.length > 0) {
      const p = open.pop()!;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = (p % fw) + dx;
          const y = Math.floor(p / fw) + dy;
          if (!ridge(x, y) || seen[y * fw + x]) continue;
          seen[y * fw + x] = 1;
          open.push(y * fw + x);
        }
      }
    }
  }
  return ridges;
}

describe("given a sedan whose nose hit a wall at 50 km/h, a sedan that never crashed, and each one's wear mask drawn at the relief's tier (`SCRATCH_TIER` 2: the creases draw only there)", () => {
  const crushed = crushedSedan();
  const intact = makeCar();
  applyScratch(crushed);
  applyScratch(intact);
  const view = new PaintScratches();
  const cars = [crushed, intact];
  // In beforeAll, not the describe body: the body runs while the file is collected, before every describe's tests.
  beforeAll(() => {
    SCRATCH_TIER.value = 2;
    view.frame(cars, 1 / FRAME_HZ);
  });
  afterAll(() => void (SCRATCH_TIER.value = 1));
  const mask = () => wearOf(crushed.lookMeshes().bodyPaint);

  it("when the masks are drawn, then the crushed car's dents (G) are up on its nose and nowhere on its tail or the rear of its flanks, and the car that never crashed samples no mask", () => {
    expect(Math.max(...dentsOn(crushed, SPRAY_FACE.front)), "the nose").toBeGreaterThan(0);
    expect(Math.max(...dentsOn(crushed, SPRAY_FACE.back)), "the tail").toBe(0);
    for (const flank of [SPRAY_FACE.left, SPRAY_FACE.right]) expect(Math.max(...dentsOn(crushed, flank, 0.4)), `the rear of flank ${flank}`).toBe(0);
    expect(wearOf(intact.lookMeshes().bodyPaint).image.width, "the intact car's mask").toBe(1);
  });

  it(`when the masks are drawn, then each face draws at most ${CREASE_RIDGES_MAX} crease ridges, and every texel shaded lies on skin that moved`, () => {
    const depths = view["depths"];
    const data = wearTexels(crushed);
    const shaded = Array.from({ length: CAR_SPRAY.w * CAR_SPRAY.h }, (_, i) => i).filter((i) => data[i * 2 + 1]! > 0);
    expect(shaded.length, "the control: the nose is shaded").toBeGreaterThan(0);
    expect(creaseRidges(crushed, SPRAY_FACE.front), "the control: the nose draws a crease").toBeGreaterThan(0);
    expect(shaded.find((i) => !(depths[i]! > 0)), "a shaded texel whose skin did not move").toBeUndefined();
    const ridges = CAR_SPRAY.faces.map((_, face) => creaseRidges(crushed, face));
    expect(Math.max(...ridges), `ridges per face: ${ridges.join(" ")}`).toBeLessThanOrEqual(CREASE_RIDGES_MAX);
  });

  it("when the tier drops below the relief's and the dents are redrawn, then they draw the dulled paint alone (no crease), and back at the relief's tier they redraw with their creases at once, the crush long settled", () => {
    const ridgesAtRelief = creaseRidges(crushed, SPRAY_FACE.front);
    expect(ridgesAtRelief, "the control: the nose draws a crease").toBeGreaterThan(0);
    try {
      SCRATCH_TIER.value = 1;
      view.frame(cars, DENT_REBUILD_S);
      const floor = Math.round(255 * DENT_FLOOR);
      expect(Math.max(...dentsOn(crushed, SPRAY_FACE.front)), "the nose's G below the relief's tier: the dulled paint, no crease").toBeLessThanOrEqual(floor);
      expect(Math.max(...dentsOn(crushed, SPRAY_FACE.front)), "the control: still dented").toBeGreaterThan(0);
    } finally {
      SCRATCH_TIER.value = 2;
    }
    view.frame(cars, DENT_REBUILD_S);
    expect(creaseRidges(crushed, SPRAY_FACE.front), "the nose's creases back at the relief's tier").toBe(ridgesAtRelief);
  });

  it("when the crushed car's skin is written again and its dents are redrawn, then its scratches (R) are untouched", () => {
    // One steel band along the left flank's middle, across the nose's dents.
    const stroke = new Uint8Array(STROKE_BYTES);
    stroke[FACE_WIDTH] = SPRAY_FACE.left | (20 << FACE_BITS);
    stroke[U0] = 40;
    stroke[U1] = 250;
    stroke[V0] = 30;
    stroke[V1] = 30;
    stroke[SEVERITY] = 255;
    crushed.scratches.load(stroke, 1);
    view.frame(cars, DENT_REBUILD_S);
    const scratches = channelTexels(crushed, 0);
    const uploads = mask().version;
    skinWritten(crushed);
    view.frame(cars, DENT_REBUILD_S);
    expect(mask().version, "the control: the dents were redrawn").toBeGreaterThan(uploads);
    expect(scratches.some((v) => v > 0), "the control: the car is scratched").toBe(true);
    expect(firstMismatch(channelTexels(crushed, 0), scratches), "R").toBeUndefined();
  });

  it(`when its skin is written every frame for 1 s, then its dents are redrawn at most every ${DENT_REBUILD_S} s`, () => {
    view.frame(cars, DENT_REBUILD_S);
    let redraws = 0;
    for (let i = 0; i < FRAME_HZ; i++) {
      const uploads = mask().version;
      skinWritten(crushed);
      view.frame(cars, 1 / FRAME_HZ);
      if (mask().version > uploads) redraws++;
    }
    expect(redraws, "the control: redrawn").toBeGreaterThan(1);
    expect(redraws, "redraws in 1 s").toBeLessThanOrEqual(1 / DENT_REBUILD_S + 1);
  });

  it(`when its skin is written and its dents redrawn every frame, then a frame allocates at most ${FRAME_BOUND_B} B`, () => {
    // The skin write as the skin makes it: the attribute's version, not a `lookMeshes()` read (its arrays are the row's, not the frame's).
    const skin = crushed.lookMeshes().body.geometry.getAttribute("position");
    const frames = (count: number) => {
      for (let i = 0; i < count; i++) {
        skin.needsUpdate = true;
        view.frame(cars, DENT_REBUILD_S);
      }
    };
    const perFrame = untilQuiet(() => allocatedBytes(() => frames(DENT_FRAMES)) / DENT_FRAMES, FRAME_BOUND_B);
    expect(perFrame, `${perFrame.toFixed(1)} B a frame`).toBeLessThanOrEqual(FRAME_BOUND_B);
  });

  it(`when it goes untouched while its skin keeps moving (a wreck at rest: the tyre hold, the sag), then once a draw is made ${DENT_SETTLE_S} s after its last touch its dents are not redrawn, and a new touch redraws them`, () => {
    // The car's quiet as its sim keeps it, stepped here with the frames: the row's sedan stands still in sim time.
    let quiet = 0;
    const clock = vi.spyOn(crushed.deform, "quietTime").mockImplementation(() => quiet);
    const redrawsOver = (seconds: number): number => {
      let redraws = 0;
      for (let i = 0; i < Math.round(seconds * FRAME_HZ); i++) {
        const uploads = mask().version;
        skinWritten(crushed);
        quiet += 1 / FRAME_HZ;
        view.frame(cars, 1 / FRAME_HZ);
        if (mask().version > uploads) redraws++;
      }
      return redraws;
    };
    try {
      expect(redrawsOver(DENT_SETTLE_S + 2 * DENT_REBUILD_S), "the control: redrawn while the crush plays out").toBeGreaterThan(1);
      expect(redrawsOver(2), "redraws over 2 s untouched").toBe(0);
      quiet = 0;
      expect(redrawsOver(2 * DENT_REBUILD_S), "redraws after a new touch").toBeGreaterThan(0);
    } finally {
      clock.mockRestore();
    }
  });

  it("when the crushed car is put on a spot again (repaired) and a frame runs, then it samples no mask, and the mask it handed back is clean", () => {
    const old = wearTexels(crushed);
    expect(old.some((v, i) => i % 2 === 1 && v > 0), "the control: dented").toBe(true);
    crushed.spawnFacing(0, 0, 0, 0);
    view.frame(cars, 1 / FRAME_HZ);
    expect(wearOf(crushed.lookMeshes().bodyPaint).image.width, "the repaired car's mask").toBe(1);
    expect(old.some((v) => v > 0), "its old mask, back in the pool").toBe(false);
  });
});

// Last in the file: the engine's browser stand-ins define `document`.
describe("given the real engine with its cars on the screen", () => {
  let engine: CrashEngine;
  beforeAll(async () => {
    stubBrowser();
    engine = await bootEngine();
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when a car's left flank is scraped and a frame runs, then every paint of it samples one mask marked where its stroke starts and bare on its right flank, and an unscraped car samples none", () => {
    const [, car, other] = engine["live"]();
    scraped(car!, [[0.5, -0.5]]);
    runSeconds(engine, 1 / FRAME_HZ);
    const list = car!.scratches.list;
    expect(car!.scratches.count, "the control: the scrape made a stroke").toBeGreaterThan(0);
    const m = car!.lookMeshes();
    const mask = wearOf(m.bodyPaint);
    for (const mesh of [m.hood, m.trunk, ...m.doors]) {
      const hooks = compileHooks(mesh.material as THREE.Material);
      expect(hooks.uniforms.wearMap!.value, "a lid or door samples the body's mask").toBe(mask);
      expect(hooks.fragmentShader.includes("#define PAINT_SCRATCH"), "and draws it").toBe(true);
    }
    const data = mask.image.data as Uint8Array;
    const texel = (face: number, u: number, v: number) => data[((CAR_SPRAY.faces[face]![1] + v) * CAR_SPRAY.w + CAR_SPRAY.faces[face]![0] + u) * 2]!;
    expect(list[FACE_WIDTH]! & FACE_MASK, "the control: the stroke is on the left flank").toBe(SPRAY_FACE.left);
    expect(texel(SPRAY_FACE.left, list[U0]!, list[V0]!), "the stroke's start").toBeGreaterThan(0);
    expect(texel(SPRAY_FACE.right, list[U0]!, list[V0]!), "the right flank opposite it").toBe(0);
    expect(wearOf(other!.lookMeshes().bodyPaint).image.width, "the unscraped car's mask").toBe(1);
  });

  it("when the FX tier goes off, minimal, low and high, then the wear is off, flat, flat, and in relief", () => {
    const paint = engine["live"]()[0]!.lookMeshes().bodyPaint;
    for (const [tier, share] of [["off", 0], ["minimal", 1], ["low", 1], ["high", 2]] as const) {
      engine.setFxTier(tier);
      expect(compileHooks(paint).uniforms.scratchTier!.value, tier).toBe(share);
    }
  });

  it("when the wear goes from flat to relief alone, then a car paint compiles the same shader and program key: the relief is no program variant", () => {
    const paint = engine["live"]()[0]!.lookMeshes().bodyPaint;
    SCRATCH_TIER.value = 1;
    const flat = { ...compileHooks(paint), key: paint.customProgramCacheKey() };
    SCRATCH_TIER.value = 2;
    const relief = { ...compileHooks(paint), key: paint.customProgramCacheKey() };
    expect(flat.fragmentShader.includes("dentPerturbedNormal(normal"), "the control: the relief is in the shader").toBe(true);
    expect(relief.fragmentShader, "the fragment shader").toBe(flat.fragmentShader);
    expect(relief.key, "the program key").toBe(flat.key);
  });

  it("when a fleet car that wears no spray has its left flank scraped and a frame runs, then its paint's program samples the stroke where it lies", () => {
    engine["setScene"]("fleet");
    runSeconds(engine, 1 / FRAME_HZ);
    const car = engine["live"]().find((c) => compileHooks(c.lookMeshes().bodyPaint).uniforms.sprayMap === undefined);
    must(car, "the control: a fleet car with no spray");
    car.group.updateMatrixWorld(true);
    const rest = car.restPointOf(car.group.localToWorld(new THREE.Vector3(-0.85, 0.5, -0.5)), new THREE.Vector3());
    scraped(car, [[0.5, -0.5]]);
    runSeconds(engine, 1 / FRAME_HZ);
    expect(car.scratches.count, "the control: the scrape made a stroke").toBeGreaterThan(0);
    expect(sampledScratch(car.lookMeshes().bodyPaint, rest, new THREE.Vector3(-1, 0, 0)), "the scratch the paint draws there").toBeGreaterThan(0);
  });

  it("when a scraped car that wears its own bumper trims is dressed again, then each bumper's program compiles the scratch once (twice is a redefinition: the program fails to link, and three recompiles it every frame)", () => {
    const car = engine["live"]()[0]!;
    for (let round = 0; round < 2; round++) {
      applyScratch(car);
      scraped(car, [[0.5, -0.5 + round * 0.1]]);
      runSeconds(engine, 1 / FRAME_HZ);
      for (const mesh of car.lookMeshes().bumpers) {
        const material = mesh.material as THREE.Material;
        expect(material.userData.shared, `round ${round}: the control: the bumper wears its own copy`).toBe(false);
        expect(compileHooks(material).fragmentShader.split("#define PAINT_SCRATCH").length - 1, `round ${round}: scratch compiles`).toBe(1);
      }
    }
  });
});
