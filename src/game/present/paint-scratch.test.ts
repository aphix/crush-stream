import { todoRow } from "../kernel/todo-row.test-util.ts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { COUNT, frameParts } from "../kernel/frame-parts.ts";
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
import { applyScratch, CREASE_FAR, CREASE_NEAR, DENT_FLOOR, DENT_REBUILD_S, DENT_SETTLE_S, PaintScratches, SCRATCH_TIER } from "./paint-scratch.ts";
import { channelTexels, cloneOfFinished, sampledScratch, scraped, stubGpu, UNPACK_ROW_LENGTH, wearOf, wearTexels } from "./paint-scratch.test-util.ts";
import { must } from "../kernel/must.test-util.ts";
import { makeCar, runWall } from "../contact/crash-scenarios.test-util.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { SURFACE_IDS } from "../world/catalog.ts";
import { SkidMarks } from "./engine-marks.ts";
import { tierWorkStart } from "../kernel/tier-work.ts";

/** Bytes a frame may allocate: one boxed double, as the other allocation rows hold. */
const FRAME_BOUND_B = 16;
const FRAMES = 10_000;
/** Frames a dent allocation read runs, each a full redraw of a crushed nose. */
const DENT_FRAMES = 300;
/** What a finish program's key carries (`applyFinish`), and a function only its shader declares. */
const FINISH_KEY_MARK = "|finish-";
const FINISH_FUNCTION = "finishMeshNear()";

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
        const r = mask[at(u, v) * 4]!;
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
  for (let y = fy; y < fy + fh; y++) for (let x = fx; x < fx + Math.round(fw * share); x++) out.push(data[(y * CAR_SPRAY.w + x) * 4 + 1]!);
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
  const ridge = (x: number, y: number) => x >= 0 && y >= 0 && x < fw && y < fh && data[((fy + y) * CAR_SPRAY.w + fx + x) * 4 + 1]! >= RIDGE_G;
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

/** Normalized Gaussian weights of σ `sigma` texels out to 3σ either side, as Float32 as the blur takes them. */
function gaussianOf(sigma: number): Float32Array {
  const r = Math.ceil(3 * sigma);
  const k = Float32Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const sum = k.reduce((a, b) => a + b, 0);
  return k.map((w) => w / sum);
}

/** `src` over face `face` blurred by `kernel` (rows, then columns) at every texel with every tap, the face's edge texels standing in past it; face-local, row by row. */
function faceBlur(src: Float32Array, face: number, kernel: Float32Array): Float32Array {
  const [fx, fy, fw, fh] = CAR_SPRAY.faces[face]!;
  const r = (kernel.length - 1) >> 1;
  const rows = new Float32Array(fw * fh);
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += kernel[k + r]! * src[(fy + y) * CAR_SPRAY.w + fx + Math.min(fw - 1, Math.max(0, x + k))]!;
      rows[y * fw + x] = sum;
    }
  }
  const out = new Float32Array(fw * fh);
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += kernel[k + r]! * rows[Math.min(fh - 1, Math.max(0, y + k)) * fw + x]!;
      out[y * fw + x] = sum;
    }
  }
  return out;
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
  const redraws = () => frameParts.count[COUNT.dentRedraws]!;
  const mask = () => wearOf(crushed.lookMeshes().bodyPaint);
  /**
   * A frame in which the crushed car is touched (a contact: its quiet is 0), so its crush plays out for the next `DENT_SETTLE_S` of the
   * view's clock. The rows share the view, whose clock runs on from row to row, so a row that needs dents redrawn on a skin write
   * stages its own touch rather than lean on how much clock the rows before it took.
   */
  const touchedFrame = (): void => {
    const quiet = vi.spyOn(crushed.deform, "quietTime").mockReturnValue(0);
    try {
      view.frame(cars, DENT_REBUILD_S);
    } finally {
      quiet.mockRestore();
    }
  };

  it("when the masks are drawn, then the crushed car's dents (G) are up on its nose and nowhere on its tail or the rear of its flanks, and the car that never crashed samples no mask", () => {
    expect(Math.max(...dentsOn(crushed, SPRAY_FACE.front)), "the nose").toBeGreaterThan(0);
    expect(Math.max(...dentsOn(crushed, SPRAY_FACE.back)), "the tail").toBe(0);
    for (const flank of [SPRAY_FACE.left, SPRAY_FACE.right]) expect(Math.max(...dentsOn(crushed, flank, 0.4)), `the rear of flank ${flank}`).toBe(0);
    expect(wearOf(intact.lookMeshes().bodyPaint).image.width, "the intact car's mask").toBe(1);
  });

  it(`when the masks are drawn, then each face draws at most ${CREASE_RIDGES_MAX} crease ridges, and every texel shaded lies on skin that moved`, () => {
    const depths = view["depths"];
    const data = wearTexels(crushed);
    const shaded = Array.from({ length: CAR_SPRAY.w * CAR_SPRAY.h }, (_, i) => i).filter((i) => data[i * 4 + 1]! > 0);
    expect(shaded.length, "the control: the nose is shaded").toBeGreaterThan(0);
    expect(creaseRidges(crushed, SPRAY_FACE.front), "the control: the nose draws a crease").toBeGreaterThan(0);
    expect(shaded.find((i) => !(depths[i]! > 0)), "a shaded texel whose skin did not move").toBeUndefined();
    const ridges = CAR_SPRAY.faces.map((_, face) => creaseRidges(crushed, face));
    expect(Math.max(...ridges), `ridges per face: ${ridges.join(" ")}`).toBeLessThanOrEqual(CREASE_RIDGES_MAX);
  });

  it("when the masks are drawn, then every dented texel's two crease blurs equal, bit for bit, the whole face blurred tap by tap with its edge texels standing in past it", () => {
    const depths = view["depths"];
    const { near, far } = view["blurs"];
    let dented = 0;
    for (let face = 0; face < CAR_SPRAY.faces.length; face++) {
      for (const [sigma, blur, name] of [[CREASE_NEAR, near, "near"], [CREASE_FAR, far, "far"]] as const) {
        const want = faceBlur(depths, face, gaussianOf(sigma));
        const [fx, fy, fw, fh] = CAR_SPRAY.faces[face]!;
        for (let y = 0; y < fh; y++) {
          for (let x = 0; x < fw; x++) {
            const i = (fy + y) * CAR_SPRAY.w + fx + x;
            if (!(depths[i]! > 0)) continue;
            dented++;
            expect(blur[i], `face ${face} texel ${x},${y}: the ${name} blur`).toBe(want[y * fw + x]);
          }
        }
      }
    }
    expect(dented, "the control: the nose is dented").toBeGreaterThan(0);
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
    touchedFrame();
    const scratches = channelTexels(crushed, 0);
    const before = redraws();
    skinWritten(crushed);
    view.frame(cars, DENT_REBUILD_S);
    expect(redraws(), "the control: the dents were redrawn").toBeGreaterThan(before);
    expect(scratches.some((v) => v > 0), "the control: the car is scratched").toBe(true);
    expect(firstMismatch(channelTexels(crushed, 0), scratches), "R").toBeUndefined();
  });

  it("when its dents are redrawn without their creases and flushed, then the GPU's copy of the mask equals the mask bit for bit, from fewer texels than a whole upload, and the unpack row length is back to 0", () => {
    view.frame(cars, DENT_REBUILD_S);
    const gpu = stubGpu(mask());
    SCRATCH_TIER.value = 1;
    try {
      view.frame(cars, DENT_REBUILD_S);
    } finally {
      SCRATCH_TIER.value = 2;
    }
    view.flush(gpu.renderer);
    const sent = gpu.calls.reduce((n, [, , w, h]) => n + w! * h!, 0);
    expect(sent, "the control: texels changed and went up").toBeGreaterThan(0);
    expect(sent, "texels sent").toBeLessThan(CAR_SPRAY.w * CAR_SPRAY.h);
    expect(firstMismatch(gpu.bytes, wearTexels(crushed)), "the GPU's copy").toBeUndefined();
    expect(gpu.unpack.get(UNPACK_ROW_LENGTH), "UNPACK_ROW_LENGTH after the flush: three's other uploads read rows at their own width").toBe(0);
  });

  it("when its skin is written again and its dents are redrawn to the texels they had, then no call is sent", () => {
    touchedFrame();
    const gpu = stubGpu(mask());
    const before = redraws();
    skinWritten(crushed);
    view.frame(cars, DENT_REBUILD_S);
    view.flush(gpu.renderer);
    expect(redraws(), "the control: the dents were redrawn").toBeGreaterThan(before);
    expect(gpu.calls.length, "calls").toBe(0);
  });

  it(`when its skin is written every frame for 1 s, then its dents are redrawn at most every ${DENT_REBUILD_S} s`, () => {
    touchedFrame();
    let drawn = 0;
    for (let i = 0; i < FRAME_HZ; i++) {
      const before = redraws();
      skinWritten(crushed);
      view.frame(cars, 1 / FRAME_HZ);
      if (redraws() > before) drawn++;
    }
    expect(drawn, "the control: redrawn").toBeGreaterThan(1);
    expect(drawn, "redraws in 1 s").toBeLessThanOrEqual(1 / DENT_REBUILD_S + 1);
  });

  // Main's version of this row never redrew (it read settled frames). Staged so every frame redraws: the redraw is the work the row bounds.
  // mutation: sed -i 's|const work = { ms: 0, timed: false };|const work = { ms: 0, timed: true };|' src/game/kernel/tier-work.ts  (the tier-work clock reads with nothing reading it: a redraw's crease pass reads it twice, and Node's `performance.now` allocates a wrapper's argument array a call: this row reads over 16 B)
  todoRow(
    `when its skin is written and its dents redrawn every frame, a contact each frame holding its crush open, then a frame, with its flush, allocates at most ${FRAME_BOUND_B} B`,
    "36.9 B a frame in the full suite on the worker (69.6 before the tier-work clock was read once per redraw, not twice per creased face); the rest is not yet attributed",
    () => {
      // The skin write as the skin makes it: the attribute's version, not a `lookMeshes()` read (its arrays are the row's, not the frame's).
      const skin = crushed.lookMeshes().body.geometry.getAttribute("position");
      const { renderer } = stubGpu(mask(), false);
      // The sim's own contact mark, not a spy (a spy records every call it sees): `elapsed` stands still here, so the car's quiet stays 0.
      const frames = (count: number) => {
        for (let i = 0; i < count; i++) {
          skin.needsUpdate = true;
          crushed.deform.notifyContact();
          view.frame(cars, DENT_REBUILD_S);
          view.flush(renderer);
        }
      };
      const before = redraws();
      frames(DENT_FRAMES);
      expect(redraws() - before, "the control: every frame redrew the dents").toBe(DENT_FRAMES);
      const perFrame = untilQuiet(() => allocatedBytes(() => frames(DENT_FRAMES)) / DENT_FRAMES, FRAME_BOUND_B);
      expect(perFrame, `${perFrame.toFixed(1)} B a frame`).toBeLessThanOrEqual(FRAME_BOUND_B);
    },
  );

  it(`when a mask's texels change every frame over a patch of rows and each flush sends them as one run, then a frame allocates at most ${FRAME_BOUND_B} B`, () => {
    const texture = mask();
    const owner = view["made"].find((m) => m.texture === texture);
    must(owner !== undefined, "the control: the crushed car's mask is the view's");
    const { renderer } = stubGpu(texture, false);
    // The tail takes no dents (the first row): a patch of its G, written between two values, is the dents' redraw with the dent code left out.
    const [fx, fy] = CAR_SPRAY.faces[SPRAY_FACE.back]!;
    const PATCH = 16;
    const write = (value: number): void => {
      for (let y = fy; y < fy + PATCH; y++) for (let x = fx; x < fx + PATCH; x++) owner.data[(y * CAR_SPRAY.w + x) * 4 + 1] = value;
      owner.touch(fx, fy, fx + PATCH - 1, fy + PATCH - 1);
      owner.flush(renderer);
    };
    let tick = 0;
    const frames = (count: number) => {
      for (let i = 0; i < count; i++) write(45 * ((tick++ & 1) + 1));
    };
    try {
      const sent = frameParts.count[COUNT.wearUploads]!;
      frames(DENT_FRAMES);
      expect(frameParts.count[COUNT.wearUploads]! - sent, "the control: every flush sent the patch, one call each").toBe(DENT_FRAMES);
      const perFrame = untilQuiet(() => allocatedBytes(() => frames(DENT_FRAMES)) / DENT_FRAMES, FRAME_BOUND_B);
      expect(perFrame, `${perFrame.toFixed(1)} B a frame`).toBeLessThanOrEqual(FRAME_BOUND_B);
    } finally {
      write(0);
    }
  });

  // mutation: sed -i 's|const work = { ms: 0, timed: false };|const work = { ms: 0, timed: true };|' src/game/kernel/tier-work.ts  (the tier-work clock reads with nothing reading it: a redraw's crease pass reads it twice, and Node's `performance.now` allocates a wrapper's argument array a call: this row reads over 16 B)
  todoRow(
    `when the crease tier flips every frame, so each dent redraw changes texels and each flush sends them, then a frame allocates at most ${FRAME_BOUND_B} B`,
    "over 16 B a frame in the full suite on the worker after the once-per-redraw clock; the dent redraw's remaining allocation is not yet attributed",
    () => {
      const { renderer } = stubGpu(mask(), false);
      let tick = 0;
      const frames = (count: number) => {
        for (let i = 0; i < count; i++) {
          SCRATCH_TIER.value = tick++ % 2 === 0 ? 1 : 2;
          view.frame(cars, DENT_REBUILD_S);
          view.flush(renderer);
        }
      };
      try {
        const redrawn = redraws();
        const sent = frameParts.count[COUNT.wearUploads]!;
        frames(DENT_FRAMES);
        expect(redraws() - redrawn, "the control: every frame redrew the dents").toBe(DENT_FRAMES);
        expect(frameParts.count[COUNT.wearUploads]! - sent, "the control: every flush sent texels").toBeGreaterThanOrEqual(DENT_FRAMES);
        const perFrame = untilQuiet(() => allocatedBytes(() => frames(DENT_FRAMES)) / DENT_FRAMES, FRAME_BOUND_B);
        expect(perFrame, `${perFrame.toFixed(1)} B a frame`).toBeLessThanOrEqual(FRAME_BOUND_B);
      } finally {
        SCRATCH_TIER.value = 2;
      }
    },
  );

  it(`when it goes untouched while its skin keeps moving (a wreck at rest: the tyre hold, the sag), then once a draw is made ${DENT_SETTLE_S} s after its last touch its dents are not redrawn, and a new touch redraws them`, () => {
    // The car's quiet as its sim keeps it, stepped here with the frames: the row's sedan stands still in sim time.
    let quiet = 0;
    const clock = vi.spyOn(crushed.deform, "quietTime").mockImplementation(() => quiet);
    const redrawsOver = (seconds: number): number => {
      let drawn = 0;
      for (let i = 0; i < Math.round(seconds * FRAME_HZ); i++) {
        const before = redraws();
        skinWritten(crushed);
        quiet += 1 / FRAME_HZ;
        view.frame(cars, 1 / FRAME_HZ);
        if (redraws() > before) drawn++;
      }
      return drawn;
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
    expect(old.some((v, i) => i % 4 === 1 && v > 0), "the control: dented").toBe(true);
    crushed.spawnFacing(0, 0, 0, 0);
    view.frame(cars, 1 / FRAME_HZ);
    expect(wearOf(crushed.lookMeshes().bodyPaint).image.width, "the repaired car's mask").toBe(1);
    expect(old.some((v) => v > 0), "its old mask, back in the pool").toBe(false);
  });
});

describe("given a sedan whose four wheels roll on mud at 15 m/s for 2 s, its rears spinning", () => {
  const car = makeCar();
  applyScratch(car);
  const view = new PaintScratches();
  const wheels = new SkidMarks(1).wheels;
  const mud = SURFACE_IDS.indexOf("mud");
  wheels.surface.fill(mud);
  wheels.vz.fill(15);
  wheels.slip.set([0, 0, 1, 1]);
  for (let i = 0; i < 2 * FRAME_HZ; i++) {
    view.spatter([car], wheels, 1 / FRAME_HZ);
    view.frame([car], 1 / FRAME_HZ);
  }

  it("when its mask is drawn, then its flanks below the belt and its tail wear mud and nothing above them does, and once it is repaired the spatter is gone and the mask it handed back is clean", () => {
    const cover = channelTexels(car, 2);
    const surface = channelTexels(car, 3);
    /** Spattered texels of `face` in its rows `y0` to `y1`. */
    const spattered = (face: number, y0: number, y1: number): number => {
      const [fx, fy, fw] = CAR_SPRAY.faces[face]!;
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = 0; x < fw; x++) if (cover[(fy + y) * CAR_SPRAY.w + fx + x]! > 0) n++;
      return n;
    };
    // Rows of a flank or the tail at 0.9 m: the dots land up to 0.75 m, 2 cm blobs.
    const flankBelt = Math.ceil((0.9 / 1.6) * CAR_SPRAY.faces[SPRAY_FACE.left]![3]);
    const tailBelt = Math.ceil((0.9 / 1.6) * CAR_SPRAY.faces[SPRAY_FACE.back]![3]);
    for (const face of [SPRAY_FACE.left, SPRAY_FACE.right, SPRAY_FACE.back]) {
      const [, , , fh] = CAR_SPRAY.faces[face]!;
      const belt = face === SPRAY_FACE.back ? tailBelt : flankBelt;
      expect(spattered(face, 0, belt), `face ${face} below the belt`).toBeGreaterThan(20);
      expect(spattered(face, belt, fh), `face ${face} above it`).toBe(0);
    }
    expect(spattered(SPRAY_FACE.top, 0, CAR_SPRAY.faces[SPRAY_FACE.top]![3]), "the roof").toBe(0);
    expect(surface.find((s, i) => cover[i]! > 0 && s !== mud), "a spattered texel not of mud").toBeUndefined();
    const old = wearTexels(car);
    car.spawnFacing(0, 0, 0, 0);
    view.frame([car], 1 / FRAME_HZ);
    expect(wearOf(car.lookMeshes().bodyPaint).image.width, "the repaired car's mask").toBe(1);
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
    const texel = (face: number, u: number, v: number) => data[((CAR_SPRAY.faces[face]![1] + v) * CAR_SPRAY.w + CAR_SPRAY.faces[face]![0] + u) * 4]!;
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

  it("when every car is scraped and the FX tier steps high, low and high, then each bumper's own trim keys and compiles the finish by its own state: finished at High only, and never on a chrome trim", async () => {
    for (const car of engine["live"]()) scraped(car, [[0.5, -0.5]]);
    runSeconds(engine, 1 / FRAME_HZ);
    let finishable = 0;
    for (const [tier, finished] of [["high", true], ["low", false], ["high", true]] as const) {
      await engine.setFxTier(tier);
      for (const car of engine["live"]()) {
        for (const mesh of car.lookMeshes().bumpers) {
          const material = mesh.material as THREE.Material;
          expect(material.userData.shared, `${tier}: the control: the bumper wears its own copy`).toBe(false);
          const wears = cloneOfFinished(material);
          if (wears) finishable++;
          expect(material.userData.carFinish !== undefined, `${tier}: the copy has a finish state exactly where its trim has one (a chrome trim has none)`).toBe(wears);
          expect(material.customProgramCacheKey().includes(FINISH_KEY_MARK), `${tier}: key ${material.customProgramCacheKey()}`).toBe(finished && wears);
          expect(compileHooks(material).fragmentShader.includes(FINISH_FUNCTION), `${tier}: compile`).toBe(finished && wears);
        }
      }
    }
    expect(finishable, "the control: some bumper wears a finishing trim").toBeGreaterThan(0);
  });

  // mutation: sed -i 's|timeTierWork(this.autoFx.auto);|timeTierWork(false);|' src/game/engine/engine-input.ts  (the tier-work clock stays off while the FX tier is automatic: the first expect reads 0)
  it("when the FX tier is automatic, then a frame leaves the tier-gated present work's clock reading for the FX governor, and once the player picks a tier it reads none", async () => {
    engine.setFxAuto();
    runSeconds(engine, 1 / FRAME_HZ);
    expect(engine["autoFx"].auto, "the control: the FX tier is automatic").toBe(true);
    expect(tierWorkStart(), "the tier-work clock with the tier automatic").toBeGreaterThan(0);
    await engine.setFxTier("low");
    runSeconds(engine, 1 / FRAME_HZ);
    expect(engine["autoFx"].auto, "the control: the tier is picked").toBe(false);
    expect(tierWorkStart(), "the tier-work clock with the tier picked").toBe(0);
  });
});
