import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { applyDrive, idleDrive, type DriveInput } from "../vehicle/car-drive.ts";
import { arenaWorld, placeDerby } from "../scenes/derby-arena.test-util.ts";
import { setGround } from "../world/ground.ts";
import { fleetStyle } from "../scenes/fleet.ts";
import { resolveCarPair } from "./pair-contact.ts";
import { partContactPair } from "./external-contact.ts";
import { physicsSlice, sliceSpeed } from "./sat.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { allocatedBytes, COMPILE_WAIT_S, untilQuiet } from "../kernel/alloc-sample.test-util.ts";

/**
 * docs/PERF_HITCH.md "GC during races": physics garbage is what drives the race GC pauses. A warmed 24-car
 * pile-up in the engine's derby contact order (drive, integrate/sync, part contact, SAT passes, structure, then the
 * arena's prisms met at the end of the slice),
 * every car driving at the arena centre. Read as the bytes V8's sampling heap profiler sees allocated per frame, dead or alive.
 * A pile-up is not steady (the cars crash into each other), so a late tier-up is waited out by fresh pile-ups until
 * one reads under the bar. 75bc12d: 2280–2300 KB per frame; f8821eb (boxing, iterator
 * and closure fixes): 657–672; with the split mass loops, typed-array outs and double-from-construction fields:
 * 421–425 (heap deltas summed per frame). The bound sits between.
 */
const CARS = 24;
const WARM = 600;
const MEASURE = 300;
const BOUND_KB = 540;
/** Vectors the control makes each frame: far more than the bar's worth (over 50 B each). */
const CONTROL_VECTORS = 12000;

function pileUp(): { cars: DeformableCar[]; step: () => void } {
  const scene = new THREE.Scene();
  const cars = Array.from({ length: CARS }, (_, i) => new DeformableCar({ body: 0xc5c8ce, accent: 0x9aa0a8, name: `c${i}` }, scene, null, fleetStyle(i)));
  placeDerby(cars, 11, 12);
  const inputs: DriveInput[] = cars.map(() => ({ ...idleDrive(), throttle: 1 }));
  const { world } = arenaWorld(cars);
  const step = () => {
    const h = physicsSlice(1 / FRAME_HZ, sliceSpeed(cars));
    for (let i = 0; i < CARS; i++) {
      const c = cars[i]!;
      // Steer at the centre: +1 swings the nose left, toward a centre on the left of the heading.
      const p = c.group.position;
      inputs[i]!.steer = c.fwdFlat.x * -p.z - c.fwdFlat.z * -p.x > 0 ? -1 : 1;
      applyDrive(c, inputs[i]!, h);
      if (c.deform.massActive) c.syncPose(h);
      else c.integrate(h);
    }
    for (let a = 0; a < CARS; a++) {
      for (let b = a + 1; b < CARS; b++) {
        const ca = cars[a]!;
        const cb = cars[b]!;
        if (ca.group.position.distanceToSquared(cb.group.position) > 28) continue;
        partContactPair(ca, cb, h);
      }
    }
    for (let i = 0; i < CARS; i++) {
      if (cars[i]!.deform.massActive) cars[i]!.syncPose(0);
      else cars[i]!.refreshBasis();
    }
    for (let a = 0; a < CARS; a++) for (let b = a + 1; b < CARS; b++) resolveCarPair(cars[a]!, cars[b]!, h);
    for (let i = 0; i < CARS; i++) {
      const c = cars[i]!;
      if (c.deform.massActive) {
        c.deform.stepStructure(h);
        c.syncPose(h);
        if (!c.deform.drivetrainAlive) c.deform.cutDrive(h);
      }
      c.afterContacts(h);
    }
    for (let i = 0; i < CARS; i++) world.collide?.(cars[i]!, i, h);
  };
  return { cars, step };
}

/** Bytes a window of `MEASURE` frames of a fresh warmed pile-up allocates, in KB a frame; `extra` is more work each frame. */
function pileUpKbPerFrame(extra: () => void = () => {}): number {
  const { cars, step } = pileUp();
  try {
    for (let f = 0; f < WARM; f++) step();
    const crashed = cars.filter((c) => c.deform.massActive).length;
    expect(crashed, `only ${crashed} of ${CARS} cars crashed: the pile-up no longer exercises the crush path`).toBeGreaterThanOrEqual(CARS / 2);
    const kb =
      allocatedBytes(() => {
        for (let f = 0; f < MEASURE; f++) {
          step();
          extra();
        }
      }) /
      1024 /
      MEASURE;
    if (process.env.ALLOC_PRINT) console.log(`physics-alloc: ${kb.toFixed(1)} KB/frame, ${crashed} crashed`);
    return kb;
  } finally {
    setGround(null);
  }
}

describe("given a warmed 24-car derby pile-up with every car driving at the arena centre", () => {
  it(`when 300 frames are stepped, then physics allocates at most ${BOUND_KB} KB per frame (boxed doubles, iterators and per-call arrays would show up as race GC pauses)`, () => {
    const kb = untilQuiet(() => pileUpKbPerFrame(), BOUND_KB);
    expect(kb, `${kb.toFixed(0)} KB per frame > ${BOUND_KB} in every pile-up for ${COMPILE_WAIT_S} s: a hot physics path allocates again (see docs/PERF_HITCH.md)`).toBeLessThanOrEqual(BOUND_KB);
  });
});

describe("given the allocation measure on a derby pile-up", () => {
  it("when each frame also makes twelve thousand vectors, then it reads over the bar", () => {
    const kept: THREE.Vector3[] = [];
    const kb = pileUpKbPerFrame(() => {
      for (let i = 0; i < CONTROL_VECTORS; i++) kept[i % 8] = new THREE.Vector3();
    });
    expect(kb, `${kb.toFixed(0)} KB per frame for ${CONTROL_VECTORS} vectors a frame: the measure sees nothing`).toBeGreaterThan(BOUND_KB);
  });
});
