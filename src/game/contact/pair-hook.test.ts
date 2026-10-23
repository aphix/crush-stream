import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { applyDrive, idleDrive } from "../vehicle/car-drive.ts";
import { armKill, assignClass, carClass, CLASSES, HANDLING, killClass, VEHICLE_CLASS_IDS, type VehicleClassId } from "../vehicle/vehicle-classes.ts";
import { newWorld, settleStep, stepWorld } from "../engine/world-step.ts";
import { INITIAL_HUD } from "../hud/hud-store.ts";
import { physicsSlice, satCars, sliceSpeed } from "./sat.ts";
import { tyreOverlap } from "./crash-scenarios.test-util.ts";
import { sampleField } from "./cage-outline.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

/**
 * Hooked cars: two cars locked together while one drives away (the owner's cop cars "hooked" onto the cars they chase, the
 * front car's rear corner inside the follower's nose). A pair's contact axis comes from its cages' outlines; a corner pushed past
 * its partner's midplane used to read "out" the way that drives the whole cars deeper in, and the next SAT pass picked the
 * opposite side's row and undid the push.
 */
const FRAME = 1 / FRAME_HZ;
const scene = new THREE.Scene();

/** A car as the race builds it: its class's body, the HUD's default crush knobs and the class's kill travel. */
function build(cls: VehicleClassId): DeformableCar {
  const car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: cls }, scene, null, CLASSES[cls].style);
  assignClass(car, cls);
  car.deform.squash = INITIAL_HUD.squash;
  car.deform.buckle = INITIAL_HUD.buckle;
  car.deform.setMode(INITIAL_HUD.deformMode);
  armKill(car.deform, killClass(car), HANDLING.realism, "default");
  return car;
}

const toOther = new THREE.Matrix4();
const corner = new THREE.Vector3();
/** A tyre's two sides, across and along it. */
const SIDES = [-1, 1] as const;

/**
 * How deep (m) any of `t`'s tyres stands in `o`'s body in the plan, negative for the clearance: its tyres as drawn (2·r × 2·halfW at the
 * class's wheel scale, on each hub), each corner read in `o`'s plan field where `o`'s body column there spans the tyre's heights.
 */
function tyreDepthIn(t: DeformableCar, o: DeformableCar): number {
  const scale = CLASSES[carClass(t)].wheelScale;
  const { r, halfW } = t.frame.rig.tyre;
  const { style, fields } = o.cage;
  const lift = CLASSES[carClass(o)].lift;
  t.group.updateMatrixWorld(true);
  o.group.updateMatrixWorld(true);
  toOther.copy(o.group.matrixWorld).invert();
  let deepest = -Infinity;
  for (const m of t.deform.masses) {
    if (!m.hub || m.popped) continue;
    const at = t.deform.massActive ? m.local : m.rest;
    for (const across of SIDES) {
      for (const along of SIDES) {
        corner.set(at.x + across * halfW * scale, r * scale, at.z + along * r * scale).applyMatrix4(t.group.matrixWorld).applyMatrix4(toOther);
        const i = Math.round((corner.x - style.u0) / style.step);
        const j = Math.round((corner.z - style.v0) / style.step);
        if (i < 0 || j < 0 || i >= style.nu || j >= style.nv) continue;
        const k = j * style.nu + i;
        if (fields.covered[k] === 0 || fields.bottom[k]! + lift >= corner.y + r * scale || fields.top[k]! + lift <= corner.y - r * scale) continue;
        deepest = Math.max(deepest, -sampleField(o.cage.planField(), style, corner.x, corner.z));
      }
    }
  }
  return deepest;
}

/** Whether the pair is in contact the way `resolveCarPair` tests it: the cages' plan outlines, the tyres overlap, or a tyre stands in the other's body. */
function touching(a: DeformableCar, b: DeformableCar, n: THREE.Vector3, p: THREE.Vector3): boolean {
  return satCars(a, b, n, p) !== null || tyreOverlap(a, b) > 0 || tyreDepthIn(a, b) > 0 || tyreDepthIn(b, a) > 0;
}

/**
 * `a` placed where a hook leaves it on `b`, both at 22 m/s: B faces +z at the origin; A's rear-right corner (its drawn body's right and
 * rear edges) sits 0.6 m right of B's axis, 1.0 m inside B's nose (its drawn front edge), A turned 0.15 rad to B's left. A tyre never
 * stands in another car's tyre or body: a start that put a sedan's tyre 0.33 m inside a monster's, or a hatch's rear tyre 0.40 m inside
 * an SUV's nose, moves A on along B's nose, 1 cm at a time, until its tyres clear B's tyres and body and B's tyres clear its body.
 */
function startHooked(a: DeformableCar, b: DeformableCar): number {
  const yaw = -0.15;
  const boxA = a.cage.fields.planBox;
  const cornerX = boxA[1]!;
  const cornerZ = boxA[2]!;
  const px = 0.6 - (cornerX * Math.cos(yaw) + cornerZ * Math.sin(yaw));
  let pz = b.cage.fields.planBox[3]! - 1.0 - (-cornerX * Math.sin(yaw) + cornerZ * Math.cos(yaw));
  b.spawnFacing(0, 0, 0, 22);
  a.spawnFacing(px, pz, yaw, 22);
  const tyresIn = (): number => Math.max(tyreOverlap(a, b), tyreDepthIn(a, b), tyreDepthIn(b, a));
  let walk = 0;
  for (; walk < 200 && tyresIn() > 0; walk++) {
    pz += 0.01;
    a.spawnFacing(px, pz, yaw, 22);
  }
  assert.ok(tyresIn() <= 0, `a bad start: a tyre still stands ${tyresIn().toFixed(3)} m in the other car after 2 m along B's nose`);
  return walk * 0.01;
}

/**
 * `front` ahead of `back`, both flat out for 3 s from where a hook leaves them (`startHooked`). Returns how far the start walked on, the
 * seconds in contact, the last second of contact, the centres' gap at the start and the end, and the deepest `back`'s tyres stand in
 * `front`'s body once they have first stood clear of it.
 */
function driveHooked(front: VehicleClassId, back: VehicleClassId): { walk: number; contact: number; lastContact: number; start: number; gap: number; runIn: number } {
  const a = build(front);
  const b = build(back);
  const walk = startHooked(a, b);
  const cars = [a, b];
  const w = newWorld(cars);
  const gas = { ...idleDrive(), throttle: 1 };
  const n = new THREE.Vector3();
  const p = new THREE.Vector3();
  let acc = 0;
  let contact = 0;
  let lastContact = -1;
  let clear = false;
  let runIn = -Infinity;
  const start = Math.hypot(a.group.position.x - b.group.position.x, a.group.position.z - b.group.position.z);
  for (let f = 0; f < 3 / FRAME; f++) {
    acc = Math.min(0.05, acc + FRAME);
    const vmax = sliceSpeed(cars);
    for (let steps = 0; acc > 1e-5 && steps < 8; steps++) {
      const h = Math.fround(physicsSlice(acc, vmax));
      applyDrive(a, gas, h);
      applyDrive(b, gas, h);
      stepWorld(w, h);
      acc -= h;
      settleStep(cars, h, false);
    }
    if (touching(a, b, n, p)) {
      contact += FRAME;
      lastContact = (f + 1) * FRAME;
    }
    const tyres = tyreDepthIn(b, a);
    if (clear) runIn = Math.max(runIn, tyres);
    else clear = tyres <= 0;
  }
  const gap = Math.hypot(a.group.position.x - b.group.position.x, a.group.position.z - b.group.position.z);
  return { walk, contact, lastContact, start, gap, runIn };
}

describe("given two cars hooked together (the front car's rear corner inside the follower's nose, as a cop car hooks onto the car it chases)", () => {
  it("when the pair's contact axis is read over a grid of overlapping poses, then it never pushes the two cars' centres together", () => {
    const a = build("sedan");
    const b = build("sedan");
    const n = new THREE.Vector3();
    const p = new THREE.Vector3();
    let hits = 0;
    let together = 0;
    let first = "";
    // A ahead of B by `gap` m along B's nose, `lat` m to its right and turned `yaw` rad: every overlap of the grid.
    for (let gap = 1.6; gap <= 4.6; gap += 0.4) {
      for (let lat = -1.9; lat <= 1.9; lat += 0.2) {
        for (let yaw = -0.8; yaw <= 0.8; yaw += 0.4) {
          b.spawnFacing(0, 0, 0, 0);
          a.spawnFacing(lat, gap, yaw, 0);
          const dx = a.group.position.x - b.group.position.x;
          const dz = a.group.position.z - b.group.position.z;
          if (satCars(a, b, n, p) === null) continue;
          hits++;
          // `satCars`' axis runs b → a: against a − b it would push the cars deeper in.
          if (n.x * dx + n.z * dz < 0) {
            together++;
            first ||= `gap ${gap.toFixed(1)} lat ${lat.toFixed(1)} yaw ${yaw.toFixed(1)}`;
          }
        }
      }
    }
    assert.ok(hits > 500, `only ${hits} overlapping poses: the grid missed the cars`);
    assert.equal(together, 0, `${together} of ${hits} contact axes pushed the cars' centres together, first at ${first}`);
  });

  it("when two cars lie stacked in one lane, 3 m apart along it, and one moves 4 mm across the other's axis, then the contact axis does not turn", () => {
    // The pair is interlocked past the outline's reach: its mean outline normal is square to the centre line, so which side it points to
    // was the sign of the lateral offset, and a pile of wrecks flipped it every slice (the push-out moved them 6 mm to and fro, drawn).
    const a = build("sedan");
    const b = build("sedan");
    const n = new THREE.Vector3();
    const p = new THREE.Vector3();
    const axes: THREE.Vector3[] = [];
    for (const lat of [-0.002, 0.002]) {
      b.spawnFacing(0, 0, 0, 0);
      a.spawnFacing(lat, 3, 0, 0);
      assert.ok(satCars(a, b, n, p) !== null, `no contact at lat ${lat}`);
      axes.push(n.clone());
    }
    const turn = axes[0]!.dot(axes[1]!);
    assert.ok(turn > 0.9, `the axis turned: cos ${turn.toFixed(2)} between (${axes[0]!.x.toFixed(2)}, ${axes[0]!.z.toFixed(2)}) and (${axes[1]!.x.toFixed(2)}, ${axes[1]!.z.toFixed(2)})`);
  });

  it("when two cars lie side by side, 1 to 2.5 m apart along the lane and overlapping 5 cm across it, then the contact axis points apart across the lane", () => {
    // The honest side rub: the centre line runs well off lateral, but the true axis is lateral and must stay so, either side.
    const a = build("sedan");
    const b = build("sedan");
    const n = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (const [side, off] of [[1, 2.5], [-1, 2.5], [1, 1], [-1, 1.5]] as const) {
      let lat = 2.4;
      for (; lat > 1; lat -= 0.005) {
        b.spawnFacing(0, 0, 0, 0);
        a.spawnFacing(side * lat, off, 0, 0);
        if (satCars(a, b, n, p) !== null) break;
      }
      lat -= 0.05;
      b.spawnFacing(0, 0, 0, 0);
      a.spawnFacing(side * lat, off, 0, 0);
      assert.ok(satCars(a, b, n, p) !== null, `no contact at lat ${lat}`);
      const cos = (n.x * side) / Math.hypot(n.x, n.z);
      assert.ok(cos > Math.cos((20 * Math.PI) / 180), `side ${side} lat ${lat.toFixed(3)}: axis (${n.x.toFixed(2)}, ${n.z.toFixed(2)}) is ${((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI).toFixed(0)}° off the lateral`);
    }
  });

  describe("when every class pair drives flat out with the front car's rear corner 1 m inside the follower's nose, or as far as their tyres stand clear of each other's tyres and bodies", () => {
    for (const front of VEHICLE_CLASS_IDS) {
      for (const back of VEHICLE_CLASS_IDS) {
        it(`then a ${front} ahead of a ${back} is not hooked: in contact for under 1 s of the first 3 s, none of the last second, and its centre ends farther from the other's than it started; the ${back}'s tyres meet the ${front}'s body and never run into it by more than 1 cm`, (t) => {
          const { walk, contact, lastContact, start, gap, runIn } = driveHooked(front, back);
          // Not hooked is apart and staying apart, not a distance: two cars driven flat out side by side part by their speeds' difference
          // alone (a truck ahead of a muscle: 3.4 m at the start, 5.85 m at 3 s after 0.15 s of contact, the muscle 3.6 m/s faster).
          t.diagnostic(`start walked ${walk.toFixed(2)} m; contact ${contact.toFixed(2)} s, last at ${lastContact.toFixed(2)} s; centres ${start.toFixed(2)} -> ${gap.toFixed(2)} m; tyres in ${runIn.toFixed(3)} m`);
          assert.ok(contact < 1, `in contact ${contact.toFixed(2)} s of 3 s, centres ${gap.toFixed(1)} m apart: hooked`);
          assert.ok(lastContact < 2, `still in contact at ${lastContact.toFixed(2)} s: hooked`);
          assert.ok(gap > start, `centres ${start.toFixed(2)} -> ${gap.toFixed(2)} m apart after 3 s: held together`);
          assert.ok(runIn <= 0.01, `the ${back}'s tyres ran ${runIn.toFixed(3)} m into the ${front}'s body`);
        });
      }
    }
  });
});
