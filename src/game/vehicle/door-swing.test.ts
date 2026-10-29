import { describe, it } from "vitest";
import assert from "node:assert/strict";
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
      assert.ok(swingAccel(SPEC, sx, 0.5, 0, -6, 0, 0) > 0, `side ${sx} braking`);
      assert.ok(swingAccel(SPEC, sx, 0.5, 0, 6, 0, 0) < 0, `side ${sx} accelerating`);
    }
  });

  it("when the car turns, then the door on the outside of the turn is pushed open and the one on the inside shut, by one law mirrored left to right", () => {
    // A turn toward +x pushes the frame's contents toward −x: the −x (left) door opens, the +x one shuts.
    assert.ok(swingAccel(SPEC, -1, 0.6, 8, 0, 0, 0) > 0 && swingAccel(SPEC, 1, 0.6, 8, 0, 0, 0) < 0);
    for (const [ax, az, w, al] of [
      [5, -3, 0.4, 0.2],
      [-2, 4, 1, -3],
    ] as const) assert.ok(Math.abs(swingAccel(SPEC, -1, 0.7, -ax, az, w, -al) - swingAccel(SPEC, 1, 0.7, ax, az, w, al)) < 1e-9, "mirror");
  });

  it("when a car brakes at 9 m/s² with a door shut, then the shut door gets no swing push, because the force is along its slab", () => {
    assert.equal(swingAccel(SPEC, 1, 0, 0, -9, 0, 0), 0);
  });
});

describe("given an unlatched open door that swings with the car's acceleration", () => {
  it("when the car brakes at 6 m/s² for 0.52 s, then a door opened to 30° on either side swings forward past 50° and stays unlatched", () => {
    for (const side of [-1, 1] as const) {
      const car = open(30, side);
      push(car, 0, -6, 0.52);
      assert.ok(deg(car, side) > 50, `side ${side} at ${deg(car, side).toFixed(1)}°`);
      assert.ok(!car.doorHinge(side).latched);
    }
  });

  it("when the car accelerates at 6 m/s² for 0.92 s, then a door opened to 30° on either side swings back and latches shut, and stays on the car", () => {
    for (const side of [-1, 1] as const) {
      const car = open(30, side);
      push(car, 0, 6, 0.92);
      const h = car.doorHinge(side);
      assert.ok(h.latched && h.theta === 0, `side ${side}: ${deg(car, side).toFixed(1)}° latched ${h.latched}`);
      assert.ok(!car.partOff(side < 0 ? "doorL" : "doorR"), "the door tore off");
    }
  });

  it("when 6 m/s² pushes a 60° door shut for only 0.1 s, then it stays open between 20° and 55°; a push lasting 1 s latches it; and a gentle 1 m/s² push does not move a 30° door at all", () => {
    const brief = open(60);
    push(brief, 0, 6, 0.1);
    push(brief, 0, 0, 3);
    assert.ok(deg(brief) > 20 && deg(brief) < 55 && !brief.doorHinge(1).latched, `brief push left it at ${deg(brief).toFixed(1)}°`);
    const long = open(60);
    push(long, 0, 6, 0.1);
    push(long, 0, 6, 0.9);
    assert.ok(long.doorHinge(1).latched, `a long push left it at ${deg(long).toFixed(1)}°`);
    const gentle = open(30);
    push(gentle, 0, 1, 3);
    assert.ok(Math.abs(deg(gentle) - 30) < 1e-6, "1 m/s² moved a door the hinge friction holds");
  });

  it("when the car turns with 8 m/s² of sideways acceleration for 0.5 s, then the outside door swings open past 60° and the inside door slams shut and latches", () => {
    const out = open(40, -1);
    push(out, 8, 0, 0.5);
    assert.ok(deg(out, -1) > 60, `outside door at ${deg(out, -1).toFixed(1)}°`);
    const inside = open(40, 1);
    push(inside, 8, 0, 0.5);
    assert.ok(inside.doorHinge(1).latched && !inside.partOff("doorR"), "the inside door should latch");
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
    assert.ok(base[7]! > 50, "the base case did not swing");
    for (const [yaw, v0] of [
      [Math.PI / 2, 0],
      [2.2, 0],
      [0, 30],
    ] as const) {
      const other = at(yaw, v0);
      for (let k = 0; k < 8; k++) assert.ok(Math.abs(other[k]! - base[k]!) < 1e-6, `yaw ${yaw} v0 ${v0} step ${k}: ${other[k]} vs ${base[k]}`);
    }
  });

  it("when a crash's 15 m/s jolt lands in a single step, then the door does not tear off and opens no further than its stop", () => {
    const car = open(30);
    car.velocity.z -= 15;
    for (let k = 0; k < 60; k++) car.swingHinges(H);
    assert.ok(!car.partOff("doorR"));
    assert.ok(deg(car) <= DOOR_OPEN_MAX / D2R + 1e-9);
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
      assert.equal(car.partOff("doorR"), off, `${share}× slam energy`);
      if (!off) assert.ok(car.doorHinge(1).latched);
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
      assert.ok(Math.abs(deg(held) - 30) < 1e-9, `${id} (door ${length} m) at 0.9×: ${deg(held)}°, checked ${checked.join()}`);
      assert.ok(deg(swung) > 30.5, `${id} (door ${length} m) at 1.1×: ${deg(swung)}°, checked ${checked.join()}`);
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
    assert.ok(Math.abs(deg(car) - DOOR_OPEN_MAX / D2R) < 0.5, `${deg(car)}°`);
    assert.ok(!car.partOff("doorR"));
  });

  it("when it launches from 3 m/s at full throttle with the door at 60°, then the door swings shut, latches and stays on", () => {
    const car = drive(3, 60, { throttle: 1 }, 3);
    assert.ok(car.doorHinge(1).latched && !car.partOff("doorR"), `${deg(car)}°`);
  });

  it("when it drives at 15 m/s through a turn that puts the open door on the inside, then the door shuts and latches", () => {
    const car = drive(15, 40, { throttle: 0.6, steer: 1 }, 3);
    assert.ok(car.doorHinge(1).latched, `${deg(car)}°`);
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
    assert.equal(sides.length, 1, `unlatched doors: ${sides.length}`);
    const jam = car.jam(sides[0]!);
    assert.ok(jam > DOOR_AJAR, `jam ${jam}`);
    assert.ok(car.doorHinge(sides[0]!).theta >= Math.min(jam * 1.45, DOOR_OPEN_MAX) - 1e-9, "the door hangs shut past its jam");
  });

  it("when it hits a wall side-on at 40 km/h in shape deform mode, then its cage drops the sprung door's panel and keeps the latched door's (the doors are the cage's last two panels, left then right)", () => {
    const car = new Probe(paint(), new THREE.Scene());
    car.deform.setMode("shape");
    runWall(40, 1, "side", { car });
    car.refitCage();
    const on = car.cage.fields.panelOn;
    assert.ok(([-1, 1] as const).some((s) => !car.doorHinge(s).latched), "no door sprung");
    for (const side of [-1, 1] as const) {
      const flag = on[on.length - (side < 0 ? 2 : 1)];
      assert.equal(flag, car.doorHinge(side).latched ? 1 : 0, `side ${side} latched ${car.doorHinge(side).latched}: its door panel ${flag}`);
    }
  });
});
