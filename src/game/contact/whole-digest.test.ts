import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { FREEWHEEL, launch, makeCar, makeWorld, PARKED, Probe, run } from "./crash-scenarios.test-util.ts";
import { layOnGround } from "../vehicle/car-air-points.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import type { DriveInput } from "../vehicle/car-drive.ts";
import { EPICENTER, epicenterValues, loadEpicenter } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";

/**
 * `whole` (the epicenter activation off, set by `staged`: the default is on) is the solver as it was before the activation existed: a hash of every mass (world, velocity, local) and every car's pose and
 * velocity after four staged crashes reads the same on the tree before the activation (`ed4aef07`) and after it. The pins are of THIS solver: a deliberate change to contact,
 * deform or car physics moves them and re-pins them (the commit says why); an activation change that moves one has changed `whole`.
 */
const KPH = 1 / 3.6;
const saved = epicenterValues();
afterEach(() => loadEpicenter(saved));

function digestOf(cars: DeformableCar[]): string {
  const hash = createHash("sha1");
  const n: number[] = [];
  for (const c of cars) {
    for (const m of c.deform.masses) n.push(m.world.x, m.world.y, m.world.z, m.vel.x, m.vel.y, m.vel.z, m.local.x, m.local.y, m.local.z);
    const p = c.group.position;
    const q = c.group.quaternion;
    n.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w, c.velocity.x, c.velocity.y, c.velocity.z, c.angular.x, c.angular.y, c.angular.z);
  }
  hash.update(new Uint8Array(new Float64Array(n).buffer));
  return hash.digest("hex").slice(0, 16);
}

function staged(cars: DeformableCar[], barrier: boolean, probes: Probe[], pedals: DriveInput[], after: number): string {
  loadEpicenter(EPICENTER_AT_LOAD);
  EPICENTER.on = 0;
  for (const c of cars) layOnGround(c);
  const w = makeWorld(cars, barrier, false, FREEWHEEL);
  for (const [i, c] of cars.entries()) w.pedals.set(c, pedals[i]!);
  run(w, probes, after);
  return digestOf(cars);
}

const X = new THREE.Vector3(1, 0, 0);
const NX = new THREE.Vector3(-1, 0, 0);

// Three re-pinned for a pair's crush patch at most its face wide (`feedOverlap`): head-on e2fe2a6ea3f54ade -> baff0220de6d5ea7, door 4338c12666a975b6 -> a822a3b1f1a859d0, pile-up d15a38884ad0eaac -> 8bfde84dd16812c1; the barrier's is unchanged (no pair).
// Re-pinned for the cage's refit skipping the pose of a torn-off or shattered pane and refitting for a panel's pose only once its tip has moved 1 cm (REPLAY 162, 163; the cage stands up to 1 cm off a swinging lid or door between fits, which the contact reads): door a822a3b1f1a859d0 -> a5928a5241b57ca2, barrier 9fd91e7d5989df85 -> ca2e30a830f5a144, pile-up 8bfde84dd16812c1 -> 89f13dd0b4f77e81; the head-on is unchanged.
// Pile-up re-pinned for land-163, the other three unchanged: the creeping wreck's 2 mm skin rebake (5eba324a, `SKIN_DRIFT`: the cage follows the creep) 89f13dd0b4f77e81 -> dd2e1cfe38b39d3b, a striker along the car springing the shut lid's latch by contact (0714f314) -> b7ebb3306d68d636, and that latch springing on 2 cm of tail crush instead of the striker's energy (31bd7f13) -> 9808dbe9f7b483e3.
describe("given four staged crashes with the epicenter activation off", () => {
  it("when the owner's head-on, 20 m/s each, runs 5 s, then every mass and pose is the pinned one", () => {
    const a = makeCar("shape");
    const b = makeCar("shape");
    launch(a, -5, 0, Math.PI / 2, 20, 0);
    launch(b, 5, 0, -Math.PI / 2, -20, 0);
    expect(staged([a, b], false, [new Probe(a, X), new Probe(b, NX)], [FREEWHEEL, FREEWHEEL], 5)).toBe("baff0220de6d5ea7");
  });

  it("when a car meets a parked one's door at 50 km/h, 5 s, then every mass and pose is the pinned one", () => {
    const a = makeCar("shape");
    const b = makeCar("shape");
    launch(a, 0, 0, 0, 0, 0);
    launch(b, 6, 0, -Math.PI / 2, -50 * KPH, 0);
    expect(staged([a, b], false, [new Probe(a, NX), new Probe(b, NX)], [PARKED, FREEWHEEL], 5)).toBe("a5928a5241b57ca2");
  });

  it("when a car hits the held barrier at 50 km/h, 5 s, then every mass and pose is the pinned one", () => {
    const a = makeCar("shape");
    launch(a, 6.2, 0, -Math.PI / 2, -50 * KPH, 0);
    expect(staged([a], true, [new Probe(a, a.velocity)], [FREEWHEEL], 5)).toBe("ca2e30a830f5a144");
  });

  it("when three cars pile up, 6 s, then every mass and pose is the pinned one", () => {
    const a = makeCar("shape");
    const b = makeCar("shape");
    const c = makeCar("shape");
    launch(a, -4, 0, Math.PI / 2, 50 * KPH, 0);
    launch(b, 4, 0, -Math.PI / 2, -50 * KPH, 0);
    launch(c, 28, 0, -Math.PI / 2, -90 * KPH, 0);
    expect(staged([a, b, c], false, [new Probe(a, X), new Probe(b, NX), new Probe(c, NX)], [FREEWHEEL, FREEWHEEL, FREEWHEEL], 6)).toBe("70c3a36e418f60ad");
  });
});
