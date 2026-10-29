import { describe, expect, it } from "vitest";
import { todoRow } from "../kernel/todo-row.test-util.ts";
import * as THREE from "three";
import { CLASSES } from "../vehicle/vehicle-classes.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { FREEWHEEL, holdThrottle, launch, makeCar, makeWorld, Probe, run, tickWorld, type CrashWorld } from "./crash-scenarios.test-util.ts";
import { DT, massCentroid } from "../vehicle/test-support.ts";

describe("given a coasting 53 km/h T-bone (a bullet car's nose driven into a resting car's right door)", () => {
  // The calibration's 53 km/h t-bone, coasting: the bullet drives its nose into the resting car's right door.
  it("when the crash plays out, then the speed the struck car reports, integrated over the crash, covers at least 70 % of the distance its masses really travel", () => {
    const struck = makeCar();
    const bullet = makeCar();
    launch(struck, 0, 0, 0, 0, 0);
    launch(bullet, 6, 0, -Math.PI / 2, -53 / 3.6, 0);
    const w = makeWorld([struck, bullet], false, false, FREEWHEEL);
    let travel = 0;
    let reported = 0;
    let before = massCentroid(struck.deform.masses);
    let started = false;
    for (let frame = 0; frame < 60 * 4; frame++) {
      const scale = w.clock.timeScale;
      tickWorld(w);
      const simDt = (DT * (scale + w.clock.timeScale)) / 2;
      const after = massCentroid(struck.deform.masses);
      if (started) {
        travel += Math.hypot(after.x - before.x, after.z - before.z);
        reported += struck.velocity.length() * simDt;
      }
      started ||= struck.crashed;
      before = after;
    }
    expect(travel, `the struck car did not travel (${travel.toFixed(2)} m): the scene is not the shove`).toBeGreaterThan(2);
    expect(reported, `the struck car travelled ${travel.toFixed(2)} m at a reported ${reported.toFixed(2)} m of speed`).toBeGreaterThanOrEqual(0.7 * travel);
  });
});

describe("given two 30 km/h cars driving head-on at each other", () => {
  /** Two 30 km/h cars head-on, both holding the throttle for `pulse` s from first contact. */
  function headOn(pulse: number): { nose: number; engine: number; added: number[] } {
    const a = makeCar();
    const b = makeCar();
    launch(a, -5, 0, Math.PI / 2, 30 / 3.6, 0);
    launch(b, 5, 0, -Math.PI / 2, -30 / 3.6, 0);
    const w = makeWorld([a, b], false, false, FREEWHEEL);
    const added = holdThrottle(w, [a, b], pulse);
    const pa = new Probe(a, new THREE.Vector3(1, 0, 0));
    const pb = new Probe(b, new THREE.Vector3(-1, 0, 0));
    run(w, [pa, pb], 1.5);
    const r = pa.finish();
    return { nose: (r.noseShortL + r.noseShortR) / 2, engine: r.engineTravel, added };
  }

  it("when both hold the throttle through the 0.12 s engine pulse, then the drive adds no more than the launch pull over that time, and the noses crush as they do when coasting", () => {
    const coast = headOn(0);
    const held = headOn(0.12);
    const thrust = CLASSES.sedan.launch[0];
    for (const dv of held.added) expect(dv > 0 && dv <= thrust * 0.12 * 1.01, `the drive added ${dv.toFixed(2)} m/s over 0.12 s (the launch pull ${thrust} m/s²)`).toBeTruthy();
    expect(Math.abs(held.nose - coast.nose), `nose ${held.nose.toFixed(3)} m held, ${coast.nose.toFixed(3)} m coasting`).toBeLessThanOrEqual(Math.max(0.03, 0.15 * coast.nose));
    expect(Math.abs(held.engine - coast.engine), `engine block ${held.engine.toFixed(3)} m held, ${coast.engine.toFixed(3)} m coasting`).toBeLessThanOrEqual(0.005);
  });
});

/** The calibration's 53 km/h t-bone: the bullet drives its nose into the resting car's right door. */
function tBone(): { struck: DeformableCar; bullet: DeformableCar; w: CrashWorld } {
  const struck = makeCar();
  const bullet = makeCar();
  launch(struck, 0, 0, 0, 0, 0);
  launch(bullet, 6, 0, -Math.PI / 2, -53 / 3.6, 0);
  return { struck, bullet, w: makeWorld([struck, bullet], false, false, FREEWHEEL) };
}

describe("given the coasting 53 km/h T-bone, where the two cars should only be held to a common speed once the crush along the contact is spent", () => {
  // The floor stood at 2.15 m + 0.28 m of each car's FRONTAL leftover crumple. A car hit on its flank counted its untouched
  // nose, so the floor fired 30 ms into the coasting t-bone at 2.64 m against 2.69 m with the door at 48 % of its stroke:
  // the rigid exchange then rang the crush (a driven bullet's nose ended at 0.06 m against 0.20 m coasting). The struck car's speed
  // now rises with the crush force from the first slice (the pair's one exchange, `bodyContact` capped by the crush force over the
  // slice) and the pair is held to its common speed when the softer of the two faces in series is spent: the bullet's nose, not the
  // stiffer door (measured: the door at 58 % of its stroke, the nose at 100 %).
  it("when the struck car's masses first reach 90 % of the pair's common speed, then the more crushed of the two faces on the contact has already used at least 80 % of its crush stroke", () => {
    const { struck, bullet, w } = tBone();
    const inner = w.world.beforeSlice!;
    // Equal masses: the pair's common speed is half the bullet's.
    const common = 53 / 3.6 / 2;
    let used = -1;
    w.world.beforeSlice = (h) => {
      if (used < 0) {
        let p = 0;
        let m = 0;
        for (const q of struck.deform.masses) {
          p += q.vel.x * q.mass;
          m += q.mass;
        }
        if (Math.abs(p / m) > 0.9 * common) used = Math.max(struck.deform.strokeUsed(), bullet.deform.strokeUsed());
      }
      return inner(h);
    };
    for (let frame = 0; frame < 60; frame++) tickWorld(w);
    expect(used, "the struck car never took the pair's speed: the scene is not the exchange").toBeGreaterThanOrEqual(0);
    expect(used, `the struck car's masses took the pair's speed with the more crushed face at ${(used * 100).toFixed(0)} % of its stroke`).toBeGreaterThanOrEqual(0.8);
  });

  /** The t-bone's final dents with the bullet holding the throttle for `hold` s from first contact. */
  function dents(hold: number): { bulletNose: number; struckNose: number; door: number; engine: number } {
    const { struck, bullet, w } = tBone();
    holdThrottle(w, [bullet], hold);
    const ps = new Probe(struck, new THREE.Vector3(-1, 0, 0));
    const pb = new Probe(bullet, new THREE.Vector3(-1, 0, 0));
    run(w, [ps, pb], 2.5);
    const a = ps.finish();
    const b = pb.finish();
    return { bulletNose: (b.noseShortL + b.noseShortR) / 2, struckNose: a.noseShortR, door: a.doorMaxR, engine: a.engineTravel };
  }

  todoRow("when the bullet holds the throttle for the 0.12 s pulse or at full throttle, then its nose, the struck door and the struck engine block crush as they do when coasting, and for the pulse so does the struck nose", "after the plan: find why the bullet's nose crushes 0.035 m less at full throttle than coasting; at full throttle its nose crushes 0.173 m against 0.208 m coasting (bound 0.031 m); the 0.12 s pulse (nose 0.197 m, door 0.215 m, engine 0.0136 m, struck nose -0.007 m) and the struck door and engine at full throttle already pass", () => {
    const coast = dents(0);
    for (const hold of [0.12, Infinity]) {
      const held = dents(hold);
      const where = `${hold} s of throttle`;
      expect(Math.abs(held.bulletNose - coast.bulletNose), `${where}: bullet nose ${held.bulletNose.toFixed(3)} m, ${coast.bulletNose.toFixed(3)} m coasting`).toBeLessThanOrEqual(Math.max(0.03, 0.15 * coast.bulletNose));
      expect(Math.abs(held.door - coast.door), `${where}: struck door ${held.door.toFixed(3)} m, ${coast.door.toFixed(3)} m coasting`).toBeLessThanOrEqual(Math.max(0.03, 0.15 * coast.door));
      expect(Math.abs(held.engine - coast.engine), `${where}: struck engine block ${held.engine.toFixed(3)} m, ${coast.engine.toFixed(3)} m coasting`).toBeLessThanOrEqual(0.005);
    }
    // The struck nose is no dent: the full-throttle shove accelerates the struck car for seconds and its nose lags (7 cm), so the pulse only.
    const pulse = dents(0.12);
    expect(Math.abs(pulse.struckNose - coast.struckNose), `struck nose ${pulse.struckNose.toFixed(3)} m driven, ${coast.struckNose.toFixed(3)} m coasting`).toBeLessThanOrEqual(0.03);
  });
});
