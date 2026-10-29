import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { makeWorld, tickWorld, type CrashWorld } from "../contact/crash-scenarios.test-util.ts";
import { FACE_TOP } from "../deform/load-crush.ts";
import { Ground, setGround } from "../world/ground.ts";
import type { DeformableCar } from "./car.ts";
import type { DriveInput } from "./car-drive.ts";
import { BELLY, buildCar, cellX, cellZ, drawnField, drawnRange, NX, NZ, stepFrames, TOP_PARTS } from "./drawn-body.test-util.ts";
import { fit, FRAME } from "./ground-probe.test-util.ts";
import { C_H, C_NX, C_NY, C_NZ, HIT_SIZE } from "../world/surfaces.ts";
import { TOUCH } from "./car-air-body.ts";
import { UPRIGHT_UP_Y } from "./car-suspension.ts";

/**
 * The owner's stuck stack (docs/UNIFIED_CONTACT.md 10.6): a sedan resting on another sedan whose roof the load has crushed
 * 0.40-0.45 m. The tyres of the car above stand on what is drawn (the plate under them stood 0.54-0.56 m, the drawn hood
 * and boot 7.5-13.6 cm higher, so the tyres sat inside the body), and the car drives off the roof at the speed the same car
 * has on flat ground at that height (E2 of the same document, on a crushed roof).
 */
const FULL: DriveInput = { throttle: 1, steer: 0, brake: 0, ebrake: false, boost: false };
const SINK_M = 0.05;
/** How far over the drawn body a tyre may hang and still stand on it: the sim's own `TOUCH` (a tyre within it is down). */
const HOVER_M = TOUCH;
const SPEED_SHARE = 0.05;
/** Seconds after the throttle goes down at which the speed is read (frames of 1/60 s). */
const READ_AT = [0.25, 0.5, 1, 1.5] as const;
/**
 * Where a car standing on the hood and boot is judged: the first of `READ_AT`. The sedan is front-driven, and an axle with no tyre down has no traction
 * (`applyDrive`), so once its front tyres roll off the hood's nose (0.47 m on, frame 16, 0.27 s: their lifts 0.015 → -0.005 → -0.037 m) it coasts: 3.6 m/s at
 * frame 15, 3.9-4.1 m/s to frame 26, 3.5 m/s at 0.5 s, where the platform's car, with no nose, reads 7.3. The later reads are for the car beached on the crown.
 */
const ON_THE_HOOD = 0;

/** A flat asphalt platform at height `y`, under everything. */
class Platform extends Ground {
  constructor(y: number) {
    super();
    this.addPlane(y, -1e4, 1e4, -1e4, 1e4, Infinity);
  }
}

/** The drawn top of a car, held in the car's frame (`frame`: its matrixWorld) as a `Ground`: what a tyre above would stand on, with nothing under it. */
class DrawnTop extends Ground {
  constructor(heights: Float32Array, frame: ArrayLike<number>) {
    super();
    const e = frame;
    this.addGrid({ nu: NX, nv: NZ, step: cellX(1) - cellX(0), stepV: cellZ(1) - cellZ(0), u0: cellX(0), v0: cellZ(0), heights, ox: e[12]!, oy: e[13]!, oz: e[14]!, axes: [e[0]!, e[1]!, e[2]!, e[4]!, e[5]!, e[6]!, e[8]!, e[9]!, e[10]!], reach: 1.2, hmax: 3 });
  }
}

/** Two sedans: the lower with its roof crushed by `crush` (a car a load crushed past its elastic range is crashed: `CarSurfaces.commit`), the upper put down on the drawn roof's crown and settled for 5 s. */
function crushedStack(crush: number) {
  const lower = buildCar("sedan", "sedan");
  lower.spawnFacing(0, 0, 0, 0);
  lower.deform.bindKinematic(lower.group, lower.velocity, lower.angular);
  lower.deform.crush[FACE_TOP] = crush;
  lower.deform.bakeLoadCrush();
  lower.crashed = true;
  const upper = buildCar("sedan", "sedan");
  upper.spawnFacing(0, 12, 0, 0);
  upper.airborne = true;
  const world = makeWorld([lower, upper], false, false);
  stepFrames(world, 1);
  const crown = lower.group.position.y + drawnRange(drawnField(lower), TOP_PARTS.cabin).top;
  upper.group.position.set(lower.group.position.x, crown - drawnRange(drawnField(upper), BELLY).bottom + 0.02, lower.group.position.z);
  upper.group.updateMatrixWorld(true);
  stepFrames(world, 5);
  return { lower, upper, world };
}

/** Full throttle for 1.5 s: the speed (m/s) at each of `READ_AT`, and whether the car was flagged airborne in its first 0.2 s. */
function driveOff(w: CrashWorld, c: DeformableCar): { speeds: number[]; airEarly: boolean } {
  const speeds: number[] = [];
  let airEarly = false;
  w.pedals.set(c, FULL);
  for (let f = 1; f <= 90; f++) {
    tickWorld(w, FRAME);
    if (f <= 12 && c.airborne) airEarly = true;
    if (READ_AT.some((s) => s * 60 === f)) speeds.push(Math.hypot(c.velocity.x, c.velocity.z));
  }
  return { speeds, airEarly };
}

/** The roof depths (m) the stack's crush law admits: it packs a roof at 0.45 m. */
const crushDepths: readonly { crush: number }[] = [{ crush: 0.4 }, { crush: 0.45 }];

for (const testCase of crushDepths) {
  describe(`given a sedan resting on another sedan's roof that the load has crushed ${testCase.crush} m`, () => {
    afterEach(() => setGround(null));

    it("when it has stood there for 5 s, then none of its tyres is more than 5 cm inside the drawn hood or boot below it, or hangs more than the sim's touch distance over it", (t) => {
      const { lower, upper } = crushedStack(testCase.crush);
      lower.group.updateMatrixWorld(true);
      const drawn = new DrawnTop(drawnField(lower).top, lower.group.matrixWorld.elements);
      const gaps = fit(upper, drawn).gaps.filter(Number.isFinite);
      t.annotate(`tyre bottoms over the drawn body below: ${gaps.map((g) => g.toFixed(3)).join(" ")} m`);
      assert.ok(gaps.length > 0, "no tyre is over the car below");
      assert.ok(Math.min(...gaps) >= -SINK_M, `a tyre is ${(-Math.min(...gaps)).toFixed(3)} m inside the drawn body below`);
      assert.ok(Math.max(...gaps) <= HOVER_M, `a tyre hangs ${Math.max(...gaps).toFixed(3)} m over the drawn body below`);
    });

    it("when it drives at full throttle, then it is not flagged airborne in its first 0.2 s, and its speed at 0.25 s, still on the hood, is within 5 % of the same car on a flat platform at its resting height if a tyre stands on the body below, and under 5 % of it at 0.5, 1 and 1.5 s if the tyres hang clear (beached on its belly: the throttle has nothing to push on)", (t) => {
      const { lower, upper, world } = crushedStack(testCase.crush);
      lower.group.updateMatrixWorld(true);
      const gaps = fit(upper, new DrawnTop(drawnField(lower).top, lower.group.matrixWorld.elements)).gaps.filter(Number.isFinite);
      // The car stands on its tyres, not its belly, when three of them press a face the drive can use (`onTreads`' rule) in the sim's own read: three is the sim's "back on its wheels". A tyre within 5 cm of the drawn body is not one pressing it.
      const e = upper.group.matrixWorld.elements;
      const treads = [0, 1, 2, 3].map((i) => {
        const o = i * HIT_SIZE;
        const h = upper.wheelHit;
        return h[o + C_H]! > 0 && h[o + C_NX]! * e[4]! + h[o + C_NY]! * e[5]! + h[o + C_NZ]! * e[6]! >= UPRIGHT_UP_Y;
      });
      const tyresStand = treads.filter((on) => on).length >= 3;
      const simRead = `lifts ${[0, 1, 2, 3].map((i) => upper.wheelHit[i * HIT_SIZE + C_H]!.toFixed(3)).join(" ")} m, normal up ${[0, 1, 2, 3].map((i) => upper.wheelHit[i * HIT_SIZE + C_NY]!.toFixed(2)).join(" ")}`;
      const y = upper.group.position.y;
      const top = driveOff(world, upper);
      setGround(new Platform(y));
      const flat = buildCar("sedan", "sedan");
      flat.spawnFacing(0, 0, 0, 0);
      flat.group.position.y = y;
      const platform = makeWorld([flat], false, false);
      stepFrames(platform, 5);
      const ref = driveOff(platform, flat);
      t.annotate(`rest y ${y.toFixed(3)}, treads on the body below ${treads.map((on) => (on ? 1 : 0)).join("")} (sim's ${simRead}; drawn gaps ${gaps.map((g) => g.toFixed(3)).join(" ")} m); on the roof ${top.speeds.map((s) => s.toFixed(2)).join("/")} m/s, airborne early ${top.airEarly}; on the platform ${ref.speeds.map((s) => s.toFixed(2)).join("/")} m/s`);
      assert.ok(!top.airEarly, "flagged airborne in its first 0.2 s with its belly on the car below");
      if (tyresStand) {
        const off = Math.abs(top.speeds[ON_THE_HOOD]! - ref.speeds[ON_THE_HOOD]!);
        assert.ok(off <= SPEED_SHARE * ref.speeds[ON_THE_HOOD]!, `${READ_AT[ON_THE_HOOD]} s: ${top.speeds[ON_THE_HOOD]!.toFixed(2)} m/s against the platform's ${ref.speeds[ON_THE_HOOD]!.toFixed(2)}`);
        return;
      }
      for (const [k, at] of READ_AT.entries()) {
        if (k === ON_THE_HOOD) continue;
        assert.ok(top.speeds[k]! <= SPEED_SHARE * ref.speeds[k]!, `${at} s: ${top.speeds[k]!.toFixed(2)} m/s with its tyres hanging clear, platform's ${ref.speeds[k]!.toFixed(2)}`);
      }
    });
  });
}
