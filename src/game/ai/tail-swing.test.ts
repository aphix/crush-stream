import { describe, expect, it } from "vitest";
import { FRAME_HZ } from "../kernel/constants.ts";
import { aiCar as car, DT } from "../vehicle/test-support.ts";
import { launch, makeCar } from "../contact/crash-scenarios.test-util.ts";
import { physicsSlice, sliceSpeed } from "../contact/sat.ts";
import { newWorld, stepWorld } from "../engine/world-step.ts";
import { applyDrive } from "../vehicle/car-drive.ts";
import { verticalTurn } from "./vertical-turn.test-util.ts";
import { rig } from "./hunter-rig.test-util.ts";
import { atFullAggression } from "./ramp.test-util.ts";
import { SWING_COOL, SWING_FOR, tailSwing } from "./tail-swing.ts";

atFullAggression();

/** A flat paved stretch of Havana (the paseo) running along +z, as `hunter.test.ts` drives on. */
const PASEO = -200;
/** The target overtaking on the cop's left, its nose angled in at the cop's rear wheel: 18 m/s against the cop's 12. */
const TARGET = { x: 2.2, z: PASEO - 3.5, yaw: -0.35, vx: -18 * Math.sin(0.35), vz: 18 * Math.cos(0.35) };

function staged(cop: { vz: number } = { vz: 12 }, target: Partial<typeof TARGET> = {}) {
  const r = rig();
  r.run(0.25);
  const unit = r.cars[1]!;
  const reset = (): void => {
    Object.assign(unit, { x: 0, z: PASEO, yaw: 0, vx: 0, vz: cop.vz });
    Object.assign(r.cars[0]!, TARGET, target);
  };
  reset();
  return { r, unit, reset, think: () => r.brain.think(unit, r.cars, 1 / FRAME_HZ) };
}

describe("given the e-brake swipe's geometry (`tailSwing`, the derby's test)", () => {
  it("when a rival's nose sits 1.8 m to the left level with our rear wheel and points at our side, then the swing steers right (-1), mirrored it steers left (+1), and a rival beside our front wheel or pointing away gives none", () => {
    const me = car(0, { vz: 9 });
    expect(tailSwing(me, car(1, { x: 3.5, z: -1.8, yaw: -Math.PI / 2, vz: 0 }), 4, 13)).toBe(-1);
    expect(tailSwing(me, car(1, { x: -3.5, z: -1.8, yaw: Math.PI / 2, vz: 0 }), 4, 13)).toBe(1);
    expect(tailSwing(me, car(1, { x: 3.5, z: 2.5, yaw: -Math.PI / 2, vz: 0 }), 4, 13), "beside the front wheel").toBe(0);
    expect(tailSwing(me, car(1, { x: 3.5, z: -1.8, yaw: Math.PI / 2, vz: 0 }), 4, 13), "pointing away").toBe(0);
    expect(tailSwing(car(0, { vz: 14 }), car(1, { x: 3.5, z: -1.8, yaw: -Math.PI / 2, vz: 0 }), 4, 13), "over the speed gate").toBe(0);
    expect(tailSwing(car(0, { vz: 14 }), car(1, { x: 3.5, z: -1.8, yaw: -Math.PI / 2, vz: 0 }), 4, 24), "the gate is a parameter").toBe(-1);
  });
});

describe("given a hunter on the paseo with its target overtaking it on the left, the target's nose angled in at its rear wheel", () => {
  it("when it is in its attack at the target's 18 m/s, then it handbrakes with the throttle off and steers away from the target (right)", () => {
    const s = staged();
    const out = s.think();
    expect(out.ebrake && out.throttle === 0 && out.steer < -0.5, JSON.stringify(out)).toBeTruthy();
  });

  it("when the target is over the PIT cap (25 m/s), or is not overtaking (10 m/s against its 12), then it does not swing", () => {
    expect(staged({ vz: 12 }, { vx: -25 * Math.sin(0.35), vz: 25 * Math.cos(0.35) }).think().ebrake, "over the cap").toBe(false);
    expect(staged({ vz: 12 }, { vx: -10 * Math.sin(0.35), vz: 10 * Math.cos(0.35) }).think().ebrake, "falling back").toBe(false);
  });

  it("when the target creeps past at bust speed (5.5 m/s against its 4.5, under the 6 m/s the bust leaves to the pack's hold), then it does not swing: the bust's slow-arrival brake stands", () => {
    expect(staged({ vz: 4.5 }, { vx: -5.5 * Math.sin(0.35), vz: 5.5 * Math.cos(0.35) }).think().ebrake).toBe(false);
  });

  it("when the unit is not one of the pack's hit seekers (a queued shadow at the ramp's floor), then it does not swing, and does once it seeks", () => {
    const s = staged();
    s.r.brain["seeks"].fill(0);
    s.r.brain["flies"].fill(0);
    expect(s.think().ebrake, "a shadow swung").toBe(false);
    s.r.brain["seeks"][0] = 1;
    s.reset();
    expect(s.think().ebrake, "a seeker did not").toBe(true);
  });

  it("when a swing is under way and the car has all but stopped, then the handbrake lets go", () => {
    const s = staged();
    expect(s.think().ebrake, "no swing to abort").toBe(true);
    Object.assign(s.unit, { vx: 0, vz: 0.5 });
    expect(s.think().ebrake).toBe(false);
  });

  it(`when the geometry holds for ${SWING_COOL + 1} s, then it swings for ${SWING_FOR} s, not again for ${SWING_COOL} s, and then once more`, () => {
    const s = staged();
    const starts: number[] = [];
    let on = false;
    let last = 0;
    for (let k = 0; k < (SWING_COOL + 1) * FRAME_HZ; k++) {
      s.reset();
      const e = s.think().ebrake;
      if (e && !on) starts.push(k / FRAME_HZ);
      if (e) last = k / FRAME_HZ;
      on = e;
    }
    expect(starts.length, `swing starts at ${starts.join(", ")} s`).toBe(2);
    expect(starts[0], "the first swing").toBe(0);
    expect(starts[1]! - starts[0]!, "the second swing's wait").toBeGreaterThanOrEqual(SWING_COOL);
    expect(last - starts[1]!, "the second swing's length").toBeLessThan(SWING_FOR + 0.1);
  });
});

describe("given a hunter at 12 m/s and its target passing it at 18 m/s on the real vehicle stack, the target's nose angled in at the hunter's rear wheel", () => {
  /** The pair for `seconds` s with the hunter driven by the hunter brain: the target's and the hunter's peak yaw rates (rad/s) and the hunter's swings started. */
  function pair(side: number, seconds: number): { target: number; hunter: number; swings: number } {
    const r = rig();
    r.run(0.25);
    const hunter = makeCar("shape");
    const target = makeCar("shape");
    launch(hunter, 0, PASEO, 0, 0, 12);
    launch(target, side * 2.2, PASEO - 3.5, -side * 0.35, -side * 18 * Math.sin(0.35), 18 * Math.cos(0.35));
    const world = newWorld([hunter, target]);
    const last = [hunter, target].map((c) => c.group.quaternion.clone());
    const peak = [0, 0];
    let swings = 0;
    let on = false;
    let owed = 0;
    let t = 0;
    for (let f = 0; f < seconds / DT; f++) {
      owed += DT;
      const vmax = sliceSpeed([hunter, target]);
      while (owed > 1e-6) {
        const h = physicsSlice(Infinity, vmax);
        for (const [i, c] of [hunter, target].entries()) {
          const a = r.cars[1 - i]!;
          Object.assign(a, { x: c.group.position.x, z: c.group.position.z, yaw: c.yaw, vx: c.velocity.x, vz: c.velocity.z });
        }
        const out = r.brain.think(r.cars[1]!, r.cars, h);
        if (out.ebrake && !on) swings++;
        on = out.ebrake;
        applyDrive(hunter, out, h);
        const along = target.velocity.x * target.fwdFlat.x + target.velocity.z * target.fwdFlat.z;
        applyDrive(target, { throttle: Math.max(-1, Math.min(1, (18 - along) * 2)), steer: 0, brake: 0, ebrake: false, boost: false }, h);
        stepWorld(world, h);
        owed -= h;
        t += h;
        for (const [i, c] of [hunter, target].entries()) {
          const d = verticalTurn(last[i]!, c.group.quaternion);
          last[i]!.copy(c.group.quaternion);
          if (t > 0.05) peak[i] = Math.max(peak[i]!, Math.abs(d) / h);
        }
      }
    }
    return { target: peak[1]!, hunter: peak[0]!, swings };
  }

  // Measured (3 s): with the swing the target's peak yaw rate is 0.51-0.55 rad/s (either side) and the hunter whips round at 5.3 rad/s; without it the target's nose lands
  // in the hunter's side and the target spins at 5.95 rad/s on one side (1.48 on the other), the hunter 3.8.
  it("when the hunter handbrakes once, then the target's peak yaw rate stays within 0.3-2 rad/s, not the spin a nose in the hunter's side gives it", () => {
    for (const side of [1, -1]) {
      const m = pair(side, 3);
      expect(m.swings, `side ${side}: swings in 3 s`).toBe(1);
      expect(m.target, `side ${side}: the target's peak yaw rate`).toBeGreaterThan(0.3);
      expect(m.target, `side ${side}: the target's peak yaw rate`).toBeLessThan(2);
    }
  });
});
