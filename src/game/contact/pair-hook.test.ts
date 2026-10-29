import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { applyDrive, idleDrive } from "../vehicle/car-drive.ts";
import { armKill, assignClass, CLASSES, HANDLING, killClass, VEHICLE_CLASS_IDS, type VehicleClassId } from "../vehicle/vehicle-classes.ts";
import { newWorld, settleStep, stepWorld } from "../engine/world-step.ts";
import { INITIAL_HUD } from "../hud/hud-store.ts";
import { physicsSlice, satCars, sliceSpeed } from "./sat.ts";
import { tyreOverlap } from "./crash-scenarios.test-util.ts";
import { DT } from "../vehicle/test-support.ts";

/**
 * Hooked cars: two cars locked together while one drives away (the owner's cop cars "hooked" onto the cars they chase, the
 * front car's rear corner inside the follower's nose). A pair's contact axis comes from its cages' outlines; a corner pushed past
 * its partner's midplane used to read "out" the way that drives the whole cars deeper in, and the next SAT pass picked the
 * opposite side's row and undid the push.
 */
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

/** Whether the pair is in contact the way `resolveCarPair` tests it: the cages' plan outlines or the tyres overlap. */
function touching(a: DeformableCar, b: DeformableCar, n: THREE.Vector3, p: THREE.Vector3): boolean {
  return satCars(a, b, n, p) !== null || tyreOverlap(a, b) > 0;
}

/** A car's cage extent in its own frame, its length and width (m). */
function cageSize(car: DeformableCar): { length: number; width: number } {
  car.refitCage();
  const box = car.cage.fields.planBox;
  return { length: box[3]! - box[2]!, width: box[1]! - box[0]! };
}

/** The pose grid of the first row, in the cages' own size: A ahead of B by these shares of the cage length, to the right of it by these shares of its width (both inside the cages' overlap), turned by these yaws (rad). */
const GAP_SHARES = Array.from({ length: 8 }, (_, i) => 0.38 + 0.08 * i);
const LATERAL_SHARES = Array.from({ length: 20 }, (_, j) => -0.9 + (1.8 * j) / 19);
const YAWS = [-0.8, -0.4, 0, 0.4, 0.8];
/** The least overlapping poses of the grid for the row to say anything. */
const MIN_OVERLAPPING_POSES = 500;
/** How far (m) the stacked cars' cages overlap along the lane in the second row. */
const LANE_OVERLAP = 1.22;

describe("given two cars hooked together (the front car's rear corner inside the follower's nose, as a cop car hooks onto the car it chases)", () => {
  it("when the pair's contact axis is read over a grid of overlapping poses, then it never pushes the two cars' centres together", (t) => {
    const a = build("sedan");
    const b = build("sedan");
    const { length, width } = cageSize(b);
    const n = new THREE.Vector3();
    const p = new THREE.Vector3();
    let hits = 0;
    let together = 0;
    let first = "";
    // A ahead of B by `gap` m along B's nose, `lat` m to its right and turned `yaw` rad: every overlap of the grid.
    for (const gapShare of GAP_SHARES) {
      for (const lateralShare of LATERAL_SHARES) {
        for (const yaw of YAWS) {
          const gap = gapShare * length;
          const lat = lateralShare * width;
          b.spawnFacing(0, 0, 0, 0);
          a.spawnFacing(lat, gap, yaw, 0);
          const dx = a.group.position.x - b.group.position.x;
          const dz = a.group.position.z - b.group.position.z;
          if (satCars(a, b, n, p) === null) continue;
          hits++;
          // `satCars`' axis runs b → a: against a − b it would push the cars deeper in.
          if (n.x * dx + n.z * dz < 0) {
            together++;
            first ||= `gap ${gap.toFixed(2)} lat ${lat.toFixed(2)} yaw ${yaw.toFixed(1)}`;
          }
        }
      }
    }
    t.annotate(`cage ${length.toFixed(3)} x ${width.toFixed(3)} m: ${hits} of ${GAP_SHARES.length * LATERAL_SHARES.length * YAWS.length} poses overlap`);
    expect(hits, `only ${hits} overlapping poses: the grid missed the cars`).toBeGreaterThan(MIN_OVERLAPPING_POSES);
    expect(together, `${together} of ${hits} contact axes pushed the cars' centres together, first at ${first}`).toBe(0);
  });

  it(`when two cars lie stacked in one lane, their cages overlapping ${LANE_OVERLAP} m along it, and one moves 4 mm across the other's axis, then the contact axis does not turn`, () => {
    // The pair is interlocked past the outline's reach: its mean outline normal is square to the centre line, so which side it points to
    // was the sign of the lateral offset, and a pile of wrecks flipped it every slice (the push-out moved them 6 mm to and fro, drawn).
    const a = build("sedan");
    const b = build("sedan");
    const apart = cageSize(b).length - LANE_OVERLAP;
    const n = new THREE.Vector3();
    const p = new THREE.Vector3();
    const axes: THREE.Vector3[] = [];
    for (const lat of [-0.002, 0.002]) {
      b.spawnFacing(0, 0, 0, 0);
      a.spawnFacing(lat, apart, 0, 0);
      expect(satCars(a, b, n, p), `no contact at lat ${lat}`).not.toBe(null);
      axes.push(n.clone());
    }
    const turn = axes[0]!.dot(axes[1]!);
    expect(turn, `the axis turned: cos ${turn.toFixed(2)} between (${axes[0]!.x.toFixed(2)}, ${axes[0]!.z.toFixed(2)}) and (${axes[1]!.x.toFixed(2)}, ${axes[1]!.z.toFixed(2)})`).toBeGreaterThan(0.9);
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
      expect(satCars(a, b, n, p), `no contact at lat ${lat}`).not.toBe(null);
      const cos = (n.x * side) / Math.hypot(n.x, n.z);
      expect(cos, `side ${side} lat ${lat.toFixed(3)}: axis (${n.x.toFixed(2)}, ${n.z.toFixed(2)}) is ${((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI).toFixed(0)}° off the lateral`).toBeGreaterThan(Math.cos((20 * Math.PI) / 180));
    }
  });

  describe("when every class pair drives flat out with the front car's rear corner 1 m inside the follower's nose", () => {
    for (const front of VEHICLE_CLASS_IDS) {
      for (const back of VEHICLE_CLASS_IDS) {
        if (front === "suv" && back === "monster") continue;
        it(`then a ${front} ahead of a ${back} is not hooked: in contact for under 1 s of the first 3 s, none of the last second, and its centre ends farther from the other's than it started`, (t) => {
          const a = build(front);
          const b = build(back);
          // B faces +z at the origin; A's rear-right corner (0.95 right, 2.2 behind its origin) sits 0.6 m right of B's axis,
          // 1.0 m inside B's nose (2.3 m ahead of B's origin), A turned 0.15 rad to B's left.
          const yaw = -0.15;
          const px = 0.6 - (0.95 * Math.cos(yaw) - 2.2 * Math.sin(yaw));
          const pz = 2.3 - 1.0 - (-0.95 * Math.sin(yaw) - 2.2 * Math.cos(yaw));
          b.spawnFacing(0, 0, 0, 22);
          a.spawnFacing(px, pz, yaw, 22);
          const cars = [a, b];
          const w = newWorld(cars);
          const gas = { ...idleDrive(), throttle: 1 };
          const n = new THREE.Vector3();
          const p = new THREE.Vector3();
          let acc = 0;
          let contact = 0;
          let lastContact = -1;
          const gapOf = (): number => Math.hypot(a.group.position.x - b.group.position.x, a.group.position.z - b.group.position.z);
          const start = gapOf();
          for (let f = 0; f < 3 / DT; f++) {
            acc = Math.min(0.05, acc + DT);
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
              contact += DT;
              lastContact = (f + 1) * DT;
            }
          }
          // Not hooked is apart and staying apart, not a distance: two cars driven flat out side by side part by their speeds' difference
          // alone (a truck ahead of a muscle: 3.4 m at the start, 5.85 m at 3 s after 0.15 s of contact, the muscle 3.6 m/s faster).
          const gap = gapOf();
          t.annotate(`contact ${contact.toFixed(2)} s, last at ${lastContact.toFixed(2)} s; centres ${start.toFixed(2)} -> ${gap.toFixed(2)} m`);
          expect(contact, `in contact ${contact.toFixed(2)} s of 3 s, centres ${gap.toFixed(1)} m apart: hooked`).toBeLessThan(1);
          expect(lastContact, `still in contact at ${lastContact.toFixed(2)} s: hooked`).toBeLessThan(2);
          expect(gap, `centres ${start.toFixed(2)} -> ${gap.toFixed(2)} m apart after 3 s: held together`).toBeGreaterThan(start);
        });
      }
    }
  });
});
