import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { makeCar, runWall } from "../contact/crash-scenarios.test-util.ts";
import { physicsSlice, sliceSpeed } from "../contact/sat.ts";
import { newWorld, stepWorld } from "../engine/world-step.ts";
import { DeformableCar } from "./car.ts";
import { DOOR_AJAR, DOOR_DETENT_ACC, DOOR_OPEN_MAX, SLAM_TEAR_J } from "./car-core.ts";
import { CAR_STYLE_IDS, type CarStyleId } from "./car-variants.ts";
import { applyDrive, type DriveInput, idleDrive } from "./car-drive.ts";
import { swingAccel } from "./car-wear.ts";
import { DT, paint } from "./test-support.ts";
import { FINE_HZ } from "../kernel/constants.ts";

/**
 * An unlatched door is a pendulum on its hinge, driven by the car's own acceleration in the car frame (docs/PANEL_FLAP.md):
 * braking swings it forward (open), accelerating shuts it, the outside of a turn opens it and the inside shuts it. It latches
 * through the same `closeSwing` rule as the Doors ram.
 */

const D2R = Math.PI / 180;
const H = 1 / FINE_HZ;

/** Open `deg` on `side`, then `steps` of `H` with the car-frame acceleration (`ax` right, `az` forward, m/s²). */
function push(car: DeformableCar, ax: number, az: number, seconds: number): void {
  const r = car.rightFlat;
  const f = car.fwdFlat;
  for (let t = 0; t < seconds - 1e-9; t += H) {
    car.velocity.x += (ax * r.x + az * f.x) * H;
    car.velocity.z += (ax * r.z + az * f.z) * H;
    car.swingHinges(H);
  }
}

function open(deg: number, side: -1 | 1 = 1, yaw = 0, v0 = 0): DeformableCar {
  const car = makeCar();
  car.spawnFacing(0, 0, yaw, v0);
  car.setDoorOpen(side, deg * D2R);
  return car;
}

const deg = (car: DeformableCar, side: -1 | 1 = 1): number => car.doorHinge(side).theta / D2R;
const SPEC = makeCar().doorHinge(1).spec;

describe("given swingAccel (the swing push the car's own acceleration puts on an unlatched door's hinge)", () => {
  it("when the car brakes at 6 m/s² or accelerates at 6 m/s², then braking pushes a door on either side open and accelerating pushes it shut", () => {
    for (const sx of [-1, 1]) {
      expect(swingAccel(SPEC, sx, 0.5, 0, -6, 0, 0), `side ${sx} braking`).toBeGreaterThan(0);
      expect(swingAccel(SPEC, sx, 0.5, 0, 6, 0, 0), `side ${sx} accelerating`).toBeLessThan(0);
    }
  });

  it("when the car turns, then the door on the outside of the turn is pushed open and the one on the inside shut, by one law mirrored left to right", () => {
    // A turn toward +x pushes the frame's contents toward −x: the −x (left) door opens, the +x one shuts.
    expect(swingAccel(SPEC, -1, 0.6, 8, 0, 0, 0) > 0 && swingAccel(SPEC, 1, 0.6, 8, 0, 0, 0) < 0).toBeTruthy();
    for (const [ax, az, w, al] of [
      [5, -3, 0.4, 0.2],
      [-2, 4, 1, -3],
    ] as const) expect(Math.abs(swingAccel(SPEC, -1, 0.7, -ax, az, w, -al) - swingAccel(SPEC, 1, 0.7, ax, az, w, al)), "mirror").toBeLessThan(1e-9);
  });

  it("when a car brakes at 9 m/s² with a door shut, then the shut door gets no swing push, because the force is along its slab", () => {
    expect(swingAccel(SPEC, 1, 0, 0, -9, 0, 0)).toBe(0);
  });
});

describe("given an unlatched open door that swings with the car's acceleration", () => {
  it("when the car brakes at 6 m/s² for 0.52 s, then a door opened to 30° on either side swings forward past 50° and stays unlatched", () => {
    for (const side of [-1, 1] as const) {
      const car = open(30, side);
      push(car, 0, -6, 0.52);
      expect(deg(car, side), `side ${side} at ${deg(car, side).toFixed(1)}°`).toBeGreaterThan(50);
      expect(!car.doorHinge(side).latched).toBe(true);
    }
  });

  it("when the car accelerates at 6 m/s² for 0.92 s, then a door opened to 30° on either side swings back and latches shut, and stays on the car", () => {
    for (const side of [-1, 1] as const) {
      const car = open(30, side);
      push(car, 0, 6, 0.92);
      const h = car.doorHinge(side);
      expect(h.latched && h.theta === 0, `side ${side}: ${deg(car, side).toFixed(1)}° latched ${h.latched}`).toBeTruthy();
      expect(!car.partOff(side < 0 ? "doorL" : "doorR"), "the door tore off").toBe(true);
    }
  });

  it("when 6 m/s² pushes a 60° door shut for only 0.1 s, then it stays open between 20° and 55°; a push lasting 1 s latches it; and a gentle 1 m/s² push does not move a 30° door at all", () => {
    const brief = open(60);
    push(brief, 0, 6, 0.1);
    push(brief, 0, 0, 3);
    expect(deg(brief) > 20 && deg(brief) < 55 && !brief.doorHinge(1).latched, `brief push left it at ${deg(brief).toFixed(1)}°`).toBeTruthy();
    const long = open(60);
    push(long, 0, 6, 0.1);
    push(long, 0, 6, 0.9);
    expect(long.doorHinge(1).latched, `a long push left it at ${deg(long).toFixed(1)}°`).toBeTruthy();
    const gentle = open(30);
    push(gentle, 0, 1, 3);
    expect(Math.abs(deg(gentle) - 30), "1 m/s² moved a door the hinge friction holds").toBeLessThan(1e-6);
  });

  it("when the car turns with 8 m/s² of sideways acceleration for 0.5 s, then the outside door swings open past 60° and the inside door slams shut and latches", () => {
    const out = open(40, -1);
    push(out, 8, 0, 0.5);
    expect(deg(out, -1), `outside door at ${deg(out, -1).toFixed(1)}°`).toBeGreaterThan(60);
    const inside = open(40, 1);
    push(inside, 8, 0, 0.5);
    expect(inside.doorHinge(1).latched && !inside.partOff("doorR"), "the inside door should latch").toBeTruthy();
  });

  it("when the car faces any heading or is carried at 30 m/s, then the door swings exactly as it does on a car at rest facing forward, because only the acceleration in the car's own frame counts", () => {
    const at = (yaw: number, v0: number) => {
      const car = open(35, 1, yaw, v0);
      const trace: number[] = [];
      for (let k = 0; k < 8; k++) {
        push(car, -2, -5, 0.05);
        trace.push(deg(car));
      }
      return trace;
    };
    const base = at(0, 0);
    expect(base[7]!, "the base case did not swing").toBeGreaterThan(50);
    for (const [yaw, v0] of [
      [Math.PI / 2, 0],
      [2.2, 0],
      [0, 30],
    ] as const) {
      const other = at(yaw, v0);
      for (let k = 0; k < 8; k++) expect(Math.abs(other[k]! - base[k]!), `yaw ${yaw} v0 ${v0} step ${k}: ${other[k]} vs ${base[k]}`).toBeLessThan(1e-6);
    }
  });

  it("when a crash's 15 m/s jolt lands in a single step, then the door does not tear off and opens no further than its stop", () => {
    const car = open(30);
    car.velocity.z -= 15;
    for (let k = 0; k < 60; k++) car.swingHinges(H);
    expect(!car.partOff("doorR")).toBe(true);
    expect(deg(car)).toBeLessThanOrEqual(DOOR_OPEN_MAX / D2R + 1e-9);
  });

  it("when the open door swings shut carrying 0.85× then 1.15× the slam-tear energy, then it latches at 0.85× and tears off at 1.15×, as the Doors ram's slam rule says (past the slam-tear energy limit the door leaves)", () => {
    // The rule is `closeSwing` (door-rig.test.ts pins its energies); here the car's own swing reaches it.
    for (const [share, off] of [
      [0.85, false],
      [1.15, true],
    ] as const) {
      const car = open(30);
      car.doorHinge(1).omega = -Math.sqrt((2 * share * SLAM_TEAR_J) / SPEC.inertia);
      for (let k = 0; k < 240; k++) car.swingHinges(H);
      expect(car.partOff("doorR"), `${share}× slam energy`).toBe(off);
      if (!off) expect(car.doorHinge(1).latched).toBeTruthy();
    }
  });

  it("when each car's 30° door is pushed for 1 s at 0.9× and then 1.1× the push its hinge detent holds, then the first leaves it where it hangs and the second swings it open, whatever the door's length", () => {
    // Braking across a slab at 30° pushes the hinge with `az` × sin 30°: the share is of the detent's `DOOR_DETENT_ACC` in that measure.
    const pushed = (id: CarStyleId, share: number): DeformableCar => {
      const car = new DeformableCar(paint(), new THREE.Scene(), null, id);
      car.deform.setMode("shape");
      car.spawnFacing(0, 0, 0, 0);
      car.setDoorOpen(1, 30 * D2R);
      push(car, 0, (-DOOR_DETENT_ACC * share) / Math.sin(30 * D2R), 1);
      return car;
    };
    const checked: string[] = [];
    for (const id of CAR_STYLE_IDS) {
      const held = pushed(id, 0.9);
      const swung = pushed(id, 1.1);
      const length = held.doorHinge(1).spec.length;
      expect(Math.abs(deg(held) - 30), `${id} (door ${length} m) at 0.9×: ${deg(held)}°, checked ${checked.join()}`).toBeLessThan(1e-9);
      expect(deg(swung), `${id} (door ${length} m) at 1.1×: ${deg(swung)}°, checked ${checked.join()}`).toBeGreaterThan(30.5);
      checked.push(id);
    }
  });
});

describe("given a car driven for real in shape deform mode with its right door open", () => {
  function drive(v0: number, deg0: number, input: Partial<DriveInput>, seconds: number): DeformableCar {
    const car = new DeformableCar(paint(), new THREE.Scene());
    car.deform.setMode("shape");
    car.spawnFacing(0, 0, 0, v0);
    car.group.updateMatrixWorld(true);
    car.setDoorOpen(1, deg0 * D2R);
    const w = newWorld([car], null);
    let acc = 0;
    for (let t = 0; t < seconds; t += DT) {
      acc = Math.min(0.05, acc + DT);
      while (acc > 1e-5) {
        const h = physicsSlice(acc, sliceSpeed(w.cars));
        applyDrive(car, { ...idleDrive(), ...input }, h);
        stepWorld(w, h);
        car.stepBreakage(h);
        acc -= h;
      }
      car.updateSkin();
    }
    return car;
  }

  it("when it brakes fully from 25 m/s with the door at 30°, then the door is thrown onto its stop and holds there without tearing off", () => {
    const car = drive(25, 30, { brake: 1 }, 3);
    expect(Math.abs(deg(car) - DOOR_OPEN_MAX / D2R), `${deg(car)}°`).toBeLessThan(0.5);
    expect(!car.partOff("doorR")).toBe(true);
  });

  it("when it launches from 3 m/s at full throttle with the door at 60°, then the door swings shut, latches and stays on", () => {
    const car = drive(3, 60, { throttle: 1 }, 3);
    expect(car.doorHinge(1).latched && !car.partOff("doorR"), `${deg(car)}°`).toBeTruthy();
  });

  it("when it drives at 15 m/s through a turn that puts the open door on the inside, then the door shuts and latches", () => {
    const car = drive(15, 40, { throttle: 0.6, steer: 1 }, 3);
    expect(car.doorHinge(1).latched, `${deg(car)}°`).toBeTruthy();
  });
});

class Probe extends DeformableCar {
  jam(side: -1 | 1): number {
    return this.doorParts[side < 0 ? 0 : 1]!.hingeT;
  }
}

describe("given a car whose door a side hit has sprung open", () => {
  it("when it hits a wall side-on at 40 km/h in shape deform mode, then exactly one door is left unlatched and hangs open at least as far as its crash jam (how far the crash bent it open)", () => {
    const car = new Probe(paint(), new THREE.Scene());
    car.deform.setMode("shape");
    runWall(40, 1, "side", { car });
    const sides = ([-1, 1] as const).filter((s) => !car.doorHinge(s).latched);
    expect(sides.length, `unlatched doors: ${sides.length}`).toBe(1);
    const jam = car.jam(sides[0]!);
    expect(jam, `jam ${jam}`).toBeGreaterThan(DOOR_AJAR);
    expect(car.doorHinge(sides[0]!).theta, "the door hangs shut past its jam").toBeGreaterThanOrEqual(Math.min(jam * 1.45, DOOR_OPEN_MAX) - 1e-9);
  });

  it("when it hits a wall side-on at 40 km/h in shape deform mode, then its cage drops the sprung door's panel and keeps the latched door's (the doors are the cage's last two panels, left then right)", () => {
    const car = new Probe(paint(), new THREE.Scene());
    car.deform.setMode("shape");
    runWall(40, 1, "side", { car });
    car.refitCage();
    const on = car.cage.fields.panelOn;
    expect(([-1, 1] as const).some((s) => !car.doorHinge(s).latched), "no door sprung").toBeTruthy();
    for (const side of [-1, 1] as const) {
      const flag = on[on.length - (side < 0 ? 2 : 1)];
      expect(flag, `side ${side} latched ${car.doorHinge(side).latched}: its door panel ${flag}`).toBe(car.doorHinge(side).latched ? 1 : 0);
    }
  });
});
