import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { FREEWHEEL, launch, makeCar, makeWorld, PARKED, type CrashWorld } from "./crash-scenarios.test-util.ts";
import { dressedCar } from "./off-centre-hit.test-util.ts";
import { satCars } from "./sat.ts";
import { stepWorld } from "../engine/world-step.ts";
import { PUSH_SPEED, PushBudget } from "../deform/push-budget.ts";
import { satPushCap } from "../deform/physics-util.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { FRAME_HZ, QUIET_HZ } from "../kernel/constants.ts";

/** The slice a slow field steps at (`physicsSlice(1/60, 4)`): the longest, so the loosest per-slice cap. */
const H = 1 / FRAME_HZ;

function centroid(c: DeformableCar): [number, number] {
  let x = 0;
  let z = 0;
  let m = 0;
  for (const q of c.deform.masses) {
    x += q.world.x * q.mass;
    z += q.world.z * q.mass;
    m += q.mass;
  }
  return [x / m, z / m];
}

/**
 * A wreck (a bullet's slow head-on, settled 2.5 s) with two plain cars across its flank, `depth` m into it. The pair
 * solver pushes the wreck out along the flank's normal in every SAT pass of every slice.
 */
function wedged(depth: number): { wreck: DeformableCar; world: CrashWorld } {
  const wreck = makeCar("shape");
  const bullet = makeCar("shape");
  launch(wreck, 0, 0, 0, 0, 0);
  launch(bullet, 0, 9, Math.PI, 0, -9);
  const settle = makeWorld([wreck, bullet], false, false, FREEWHEEL);
  for (let t = 0; t < 2.5; t += 1 / QUIET_HZ) stepWorld(settle.world, 1 / QUIET_HZ);
  assert.ok(wreck.deform.massActive && wreck.deform.quietTime() > 1, "no settled wreck to wedge");
  const [wx, wz] = centroid(wreck);
  const yaw = wreck.yaw;
  const flank = 0.95 + 2.3 - depth;
  const across = (zl: number): DeformableCar => {
    const c = makeCar("shape");
    launch(c, wx + Math.cos(yaw) * flank + Math.sin(yaw) * zl, wz - Math.sin(yaw) * flank + Math.cos(yaw) * zl, yaw + Math.PI / 2, 0, 0);
    return c;
  };
  return { wreck, world: makeWorld([wreck, across(-1.2), across(1.2)], false, false) };
}

describe("given a settled wreck with two plain cars wedged 1.4 m into its flank", () => {
  // Zip: a live mass centroid moving more than 3·v·h + 5 cm in a step (the derby bar, `zip-bound.test-util.ts`). The pair
  // solver's pushes shared one satPushCap a slice, 0.09 m at this slice, and the wreck went 0.079 m in a step and
  // 0.062 the next, against the 0.05 m the bound gives a wreck at rest.
  it("when four 1/60 s steps run, then its centre never moves more than 3 × its speed × the step + 5 cm in a step", () => {
    const { wreck, world } = wedged(1.4);
    for (let s = 0; s < 4; s++) {
      const before = centroid(wreck);
      const v0 = Math.hypot(wreck.velocity.x, wreck.velocity.z);
      stepWorld(world.world, H);
      const after = centroid(wreck);
      const moved = Math.hypot(after[0] - before[0], after[1] - before[1]);
      const bound = 3 * Math.max(v0, Math.hypot(wreck.velocity.x, wreck.velocity.z)) * H + 0.05;
      assert.ok(moved <= bound, `step ${s}: moved ${moved.toFixed(4)} m, bound ${bound.toFixed(4)} m`);
    }
  });
});

/** The fleet capture's pile: a coupe's door grazed at this EBS (m/s) armed its hit, then its nose hit a pickup 19.5 m/s faster. */
const GRAZE_EBS = 2.8;
/** Deepest overlap (m) of the grazed coupe in the pickup: its nose hit sized from its own barrier speed, as an ungrazed coupe's is. */
const GRAZED_SINK = 0.2;

/** Peak plan overlap (m) of a coupe grazed on its right door, then driven nose-first at 19.5 m/s into a parked pickup: into its left flank, or (`corner`) its rear corner 0.9 m off its centre line. */
function grazedNoseHit(corner: boolean): number {
  const pickup = dressedCar("pickup", "truck", 0);
  const coupe = dressedCar("coupe", "muscle", 1);
  launch(pickup, 0, 0, 0, 0, 0);
  if (corner) launch(coupe, 0.9, -7, 0, 0, 19.5);
  else launch(coupe, -6.5, 0, Math.PI / 2, 19.5, 0);
  const w = makeWorld([pickup, coupe], false, false);
  w.pedals.set(pickup, PARKED);
  coupe.applyImpact(coupe.group.localToWorld(new THREE.Vector3(0.9, 0.5, 0)), coupe.right.clone().negate(), GRAZE_EBS, GRAZE_EBS);
  const n = new THREE.Vector3();
  const p = new THREE.Vector3();
  let deepest = 0;
  w.world.afterCar = (car) => {
    if (car === coupe) deepest = Math.max(deepest, satCars(coupe, pickup, n, p, 0) ?? 0);
  };
  for (let s = 0; s < 1.2 / H; s++) stepWorld(w.world, H);
  return deepest;
}

describe("given a coupe whose door a graze armed, driven nose-first into a parked pickup at 19.5 m/s before it is quiet", () => {
  for (const [where, corner] of [["its left flank", false], ["its rear corner", true]] as const) {
    it(`when the coupe's nose meets ${where}, then it sinks into the pickup no deeper than ${GRAZED_SINK} m`, (t) => {
      const sink = grazedNoseHit(corner);
      t.diagnostic(`sink ${sink.toFixed(3)} m`);
      assert.ok(sink <= GRAZED_SINK, `the coupe sank ${sink.toFixed(3)} m into the pickup`);
    });
  }
});

describe("given two sedans in a plain 50 km/h head-on or T-bone", () => {
  for (const kind of ["head-on", "t-bone"] as const) {
    it(`when the ${kind} runs 1.5 s, then each car keeps the barrier speed its hit armed at: a hit's own pulse never re-arms it`, () => {
      const a = makeCar();
      const b = makeCar();
      if (kind === "head-on") {
        launch(a, -5, 0, Math.PI / 2, 50 / 3.6, 0);
        launch(b, 5, 0, -Math.PI / 2, -50 / 3.6, 0);
      } else {
        launch(a, 0, 0, 0, 0, 0);
        launch(b, 6, 0, -Math.PI / 2, -50 / 3.6, 0);
      }
      const w = makeWorld([a, b], false, false);
      for (const car of w.cars) w.pedals.set(car, car.spawnSpeed === 0 ? PARKED : FREEWHEEL);
      const armed = new Map<DeformableCar, number>();
      w.world.afterCar = (car) => {
        if (car.crashed && !armed.has(car)) armed.set(car, car.deform.hitSpeedValue);
      };
      for (let s = 0; s < 1.5 / H; s++) stepWorld(w.world, H);
      for (const car of [a, b]) {
        assert.ok(armed.has(car), `car ${car === a ? "A" : "B"} never crashed`);
        assert.ok(car.deform.hitSpeedValue === armed.get(car), `car ${car === a ? "A" : "B"} re-armed: ${armed.get(car)!.toFixed(2)} -> ${car.deform.hitSpeedValue.toFixed(2)} m/s`);
      }
    });
  }
});

describe("given a PushBudget (the cap on the net translation contact pushes may move a car in one slice)", () => {
  const cap = PUSH_SPEED * H;

  it("when three 1 cm pushes go the same way, then the first gets 1 cm, the second only what is left of the cap and the third nothing", () => {
    const b = new PushBudget();
    const got = [0.01, 0.01, 0.01].map((a) => b.take(1, 1, 0, a, H, 0));
    assert.ok(Math.abs(got[0]! - 0.01) < 1e-12 && Math.abs(got[1]! - (cap - 0.01)) < 1e-12 && got[2] === 0, JSON.stringify(got));
  });

  it("when a 1 cm push is followed by a 1 cm push back the other way, then both are granted, the net translation is zero and a push across the cancelled squeeze gets the whole cap", () => {
    const b = new PushBudget();
    assert.ok(Math.abs(b.take(1, 1, 0, 0.01, H, 0) - 0.01) < 1e-12);
    assert.ok(Math.abs(b.take(1, -1, 0, 0.01, H, 0) - 0.01) < 1e-12, "the push back the other way was refused");
    assert.ok(Math.hypot(b.x, b.z) < 1e-12, "the squeeze left a net translation");
    assert.ok(Math.abs(b.take(1, 0, 1, 0.2, H, 0) - cap) < 1e-12, "a push across a cancelled squeeze gets the whole cap");
  });

  it("when a wall translation or sphere shift of 1 cm is debited first, then a following push gets the cap less 1 cm and nothing once the corrections fill the cap", () => {
    const b = new PushBudget();
    b.debit(1, 0.01, 0);
    assert.ok(Math.abs(b.take(1, 1, 0, 0.05, H, 0) - (cap - 0.01)) < 1e-12);
    assert.equal(b.take(1, 1, 0, 0.05, H, 0), 0, "nothing is left once the corrections fill the cap");
  });

  it("when the partner moves at 20 m/s, then the cap is lifted to the fast-hit push cap, so a 20 m/s hit separates as before", () => {
    const b = new PushBudget();
    assert.ok(Math.abs(b.take(1, 1, 0, 0.2, H, 20) - satPushCap(H)) < 1e-12);
  });

  it("when the next slice starts, then the budget is empty again and a push gets the whole cap", () => {
    const b = new PushBudget();
    b.take(1, 1, 0, 1, H, 0);
    assert.ok(Math.abs(b.take(1 + H, 1, 0, 1, H, 0) - cap) < 1e-12);
  });
});
