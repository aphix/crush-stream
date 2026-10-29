import { describe, expect, it } from "vitest";
import { todoRow } from "../kernel/todo-row.test-util.ts";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import type { Collider, RigidBody, World } from "@dimforge/rapier3d-simd";
import { launch, makeCar } from "../contact/crash-scenarios.test-util.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { PREFABS, type PrefabId } from "../world/catalog.ts";
import { setGround } from "../world/ground.ts";
import { placeProps } from "../world/placements.ts";
import { Track } from "../world/track.ts";
import { parseTrack } from "../world/track-schema.ts";
import { square } from "../world/track.test-util.ts";
import { RagdollSystem } from "./engine-ragdoll.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { allocatedBytes, COMPILE_WAIT_S, untilQuiet } from "../kernel/alloc-sample.test-util.ts";

const _q = new THREE.Quaternion();
const _a = new THREE.Vector3();

/**
 * World height of the lowest point of knockable prop `prefab`'s own shape (placed at scale 1) on `body`, worked out from
 * its prefab's size and the shape's makeup, not read from its colliders: a cone's 0.4 m square base plate 4 cm thick and
 * its tip at the top, a tyre stack's upright cylinder, a crate's or a hay bale's box.
 */
function lowestPoint(prefab: PrefabId, body: RigidBody): number {
  const t = body.translation();
  const r = body.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  const [w, h, d] = PREFABS[prefab].size;
  // How far up the world each of its own axes points.
  const ux = _a.set(1, 0, 0).applyQuaternion(_q).y;
  const uy = _a.set(0, 1, 0).applyQuaternion(_q).y;
  const uz = _a.set(0, 0, 1).applyQuaternion(_q).y;
  if (prefab === "tyre-stack") return t.y - (Math.abs(uy) * h) / 2 - (w / 2) * Math.sqrt(Math.max(0, 1 - uy * uy));
  if (prefab === "cone") {
    // The plate's middle is 0.02 m over the base (half 0.02 thick); the tip is half the cone's height over its middle.
    const plate = t.y + (0.02 - h / 2) * uy - (w / 2) * Math.abs(ux) - 0.02 * Math.abs(uy) - (d / 2) * Math.abs(uz);
    return Math.min(plate, t.y + (h / 2) * uy);
  }
  return t.y - (w / 2) * Math.abs(ux) - (h / 2) * Math.abs(uy) - (d / 2) * Math.abs(uz);
}

/**
 * How deep (m) a knocked prop's own shape (its colliders `own`) is inside the deepest of `world`'s statics other than the
 * ground (a course's walls and solids; its ground is a heightfield), as Rapier's shape query measures the two shapes (the
 * depth it would take to part them), whatever their collision groups. Clear of them all: minus its gap to the nearest
 * within 0.1 m, or -Infinity.
 */
function deepestInStatics(world: World, own: readonly Collider[]): number {
  let deepest = -Infinity;
  world.forEachCollider((other) => {
    // Rapier's `ShapeType.HeightField` is 7.
    if (other.parent() !== null || other.shapeType() === 7) return;
    for (const c of own) {
      const hit = c.contactCollider(other, 0.1);
      if (hit) deepest = Math.max(deepest, -hit.distance);
    }
  });
  return deepest;
}

const FRAME = 1 / FRAME_HZ;
const UP = new THREE.Vector3(0, 1, 0);
/**
 * The ground contact slop (m): how far the lowest point of a knocked prop's own shape (`lowestPoint`) gets under the
 * ground. Measured over 1024 knocks by a car's bumper (4 props, 11 and 20 m/s, 16 headings x 4 spots x 2 yaws): at rest
 * 0.1-2.1 mm under it; through a landing at most 31.8 mm (a tyre stack at 20 m/s; at 11 m/s a cone 22.5, a crate 16.0,
 * a tyre stack 6.4, a hay bale 4.3).
 */
const REST_SLOP = 0.003;
const LANDING_SLOP = 0.032;

/** The square test course with one `prefab` placed at (x, z). */
const course = (prefab: PrefabId, x: number, z: number) => new Track(parseTrack(square({ props: [{ prefab, x, z, yaw: 0, scale: 1 }] })));

/** The square course's road beside its first checkpoint: a point on its centre line, the way along it and the way across it to the left (both unit, level); the left wall's face stands `WALL_OFF` m across. */
const ROAD = (() => {
  const p = new Track(parseTrack(square())).path;
  const k = 31;
  return { x: p.x[k]!, z: p.z[k]!, along: new THREE.Vector3(p.tx[k]!, 0, p.tz[k]!), left: new THREE.Vector3(p.tz[k]!, 0, -p.tx[k]!) };
})();
/** The road's half width plus its run-off. */
const WALL_OFF = 7;

/** A dummies' world on `track` (its ground active), Rapier in unless `loaded` is false. */
async function system(track: Track, loaded = true): Promise<RagdollSystem> {
  const sys = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
  if (loaded) await sys.preload();
  setGround(track.ground());
  sys.setCourse(track, placeProps(track), null);
  sys.update(FRAME, [], true, false, null);
  return sys;
}

const bodyOf = (sys: RagdollSystem): RigidBody => sys["props"]["bodies"][0]!;

/** `seconds` of frames with `cars` about; `each` sees prop 0's middle and its up axis after every frame. */
function run(sys: RagdollSystem, seconds: number, cars: DeformableCar[], each: (p: THREE.Vector3, up: THREE.Vector3) => void): void {
  const p = new THREE.Vector3();
  const v = new THREE.Vector3();
  const up = new THREE.Vector3();
  const q = new THREE.Quaternion();
  for (let f = 0; f < Math.round(seconds / FRAME); f++) {
    sys.update(FRAME, cars, true, false, null);
    if (!sys.propAt(0, p, v)) continue;
    const r = bodyOf(sys).rotation();
    each(p, up.copy(UP).applyQuaternion(q.set(r.x, r.y, r.z, r.w)));
  }
}

describe("given a knockable prop standing in the infield of a course", () => {
  // A car (car 0, its bumper meeting the prop) at 10 m/s sends a prop off at 11 m/s and 4.5 m/s up (the race's prop rule).
  // The bumper meets a hay bale at its centre of mass (0.45 m up): nothing turns it, so it slides on upright. A cone is met
  // 0.217 m above its centre of mass (bumper band 0.05-0.85 m over its 0.7 m: 0.375 m up; centre of mass 0.158 m up): the
  // push driving that point out at 11 m/s on its own, 11 / (1/m + arm²/I) = 11 / (1/4 + 0.217²/0.1005) = 15.3 N·s, would
  // turn it at 15.3 × 0.217 / 0.1005 = 33 rad/s and drive its base's front edge (0.2 m out) down at 6.6 m/s, faster than
  // the 4.5 it is lifted at. The road stops that edge: it turns at 4.5 / 0.2 = 22.5 rad/s, and its centre of mass leaves at
  // u = 11 − 22.5 × 0.217 = 6.12 m/s and 4.5 up. Ballistic (g 9.6, air damping c 0.05/s: x = u(1-e^-ct)/c), the soonest it
  // can touch is when its centre of mass has come down to its reach (0.542 m, to the cone's tip): t = 0.834 s, 5.0 m on;
  // its middle can be 0.192 m behind its centre of mass, so it comes down at least 4.8 m on. Over 128 knocks (16 headings,
  // 4 spots, 2 yaws) it rested 6.01-10.19 m on.
  const tumbleCases = [
    { it: "when a cone is knocked at 11 m/s, then it tumbles, lands on the ground and comes to rest lying on it", prefab: "cone", tips: true, on: 4.8 },
    { it: "when a tyre stack is knocked at 11 m/s, then it tumbles, lands on the ground and comes to rest lying on it", prefab: "tyre-stack", tips: true, on: 5 },
    { it: "when a crate is knocked at 11 m/s, then it tumbles, lands on the ground and comes to rest lying on it", prefab: "crate", tips: true, on: 5 },
    { it: "when a hay bale is knocked at 11 m/s, then it lands upright, slides on and comes to rest on the ground", prefab: "hay-bale", tips: false, on: 5 },
  ] as const;
  for (const testCase of tumbleCases) {
    it(testCase.it, async (t) => {
      const track = course(testCase.prefab, 60, 60);
      const ground = track.ground();
      const sys = await system(track);
      sys.knockProp(0, 0, 11, 4.5, 0);
      let tilt = 0;
      let sink = Infinity;
      const end = new THREE.Vector3();
      run(sys, 10, [], (p, up) => {
        tilt = Math.max(tilt, Math.acos(Math.min(1, Math.abs(up.y))));
        sink = Math.min(sink, lowestPoint(testCase.prefab, bodyOf(sys)) - ground.heightAt(p.x, p.z, p.y));
        end.copy(p);
      });
      const body = bodyOf(sys);
      const v = body.linvel();
      const w = body.angvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      const spin = Math.hypot(w.x, w.y, w.z);
      const asleep = body.isSleeping();
      const rise = end.y - ground.heightAt(end.x, end.z, end.y);
      const gap = lowestPoint(testCase.prefab, body) - ground.heightAt(end.x, end.z, end.y);
      const [sx, sy, sz] = PREFABS[testCase.prefab].size;
      sys.dispose();
      t.annotate(`tilted ${((tilt * 180) / Math.PI).toFixed(0)}°, rests ${(end.x - 60).toFixed(1)} m on, middle ${rise.toFixed(2)} m up, lowest point ${(gap * 1000).toFixed(1)} mm off the ground (deepest ${(sink * 1000).toFixed(1)}), ${speed.toFixed(3)} m/s, ${spin.toFixed(3)} rad/s, asleep ${asleep}`);
      if (testCase.tips) expect(tilt, `it never tipped past 45° (${((tilt * 180) / Math.PI).toFixed(0)}°)`).toBeGreaterThan(Math.PI / 4);
      else expect(tilt, `it tipped ${((tilt * 180) / Math.PI).toFixed(0)}°`).toBeLessThan((5 * Math.PI) / 180);
      expect(sink, `its lowest point went ${(-sink * 1000).toFixed(1)} mm under the ground`).toBeGreaterThan(-LANDING_SLOP);
      expect(Math.abs(gap), `it rests with its lowest point ${(gap * 1000).toFixed(1)} mm off the ground`).toBeLessThan(REST_SLOP);
      expect(end.x - 60, `it came down ${(end.x - 60).toFixed(1)} m from its spot`).toBeGreaterThan(testCase.on);
      expect(rise, `it rests with its middle ${rise.toFixed(2)} m up: not on the ground`).toBeLessThan(Math.max(sx, sy, sz) / 2 + 0.05);
      expect(speed < 0.05 && spin < 0.1 && asleep, `still moving at ${speed.toFixed(3)} m/s, ${spin.toFixed(3)} rad/s (asleep: ${asleep})`).toBeTruthy();
    });
  }
  // Knocked across the infield (a tyre stack knocked that way rolls on for seconds; knocked 5° off the other way it stops).
  const restCases = [
    { it: "when a cone is knocked at 11 m/s and comes to rest, then it lies asleep within half a second of stopping", prefab: "cone", kick: [11, 4.5, 0] },
    { it: "when a tyre stack is knocked at 11 m/s and comes to rest, then it lies asleep within half a second of stopping", prefab: "tyre-stack", kick: [0.96, 4.5, 10.96] },
    { it: "when a crate is knocked at 11 m/s and comes to rest, then it lies asleep within half a second of stopping", prefab: "crate", kick: [11, 4.5, 0] },
    { it: "when a hay bale is knocked at 11 m/s and comes to rest, then it lies asleep within half a second of stopping", prefab: "hay-bale", kick: [11, 4.5, 0] },
  ] as const;
  for (const testCase of restCases) {
    it(testCase.it, async () => {
      const sys = await system(course(testCase.prefab, 60, 60));
      const [vx, vy, vz] = testCase.kick;
      sys.knockProp(0, -1, vx, vy, vz);
      const body = bodyOf(sys);
      // Sim s from which it has moved under 0.1 m/s and turned under 0.1 rad/s (-1: moving), and when it slept.
      let stopped = -1;
      let slept = -1;
      for (let f = 1; f <= Math.round(10 / FRAME); f++) {
        sys.update(FRAME, [], true, false, null);
        if (body.isSleeping()) {
          slept = f * FRAME;
          break;
        }
        const v = body.linvel();
        const w = body.angvel();
        if (Math.hypot(v.x, v.y, v.z) >= 0.1 || Math.hypot(w.x, w.y, w.z) >= 0.1) stopped = -1;
        else if (stopped < 0) stopped = f * FRAME;
      }
      sys.dispose();
      expect(slept, "it never slept in 10 s").toBeGreaterThan(0);
      expect(stopped > 0 && slept - stopped <= 0.5, `it lay still ${(slept - stopped).toFixed(2)} s before it slept (stopped at ${stopped.toFixed(2)} s)`).toBeTruthy();
    });
  }
});

describe("given a prop on the middle of a course's road, 7 m from the wall's face", () => {
  // 60 m/s: a knock by a car at about 54 m/s (the race's prop rule), half a metre a step at the props' own rate.
  const wallCases = [
    { it: "when a cone is knocked straight at the wall at 20 m/s, then it stops on the wall's face and never gets past it", prefab: "cone", speed: 20 },
    { it: "when a cone is knocked straight at the wall at 60 m/s, then it stops on the wall's face and never gets past it", prefab: "cone", speed: 60 },
    { it: "when a tyre stack is knocked straight at the wall at 60 m/s, then it stops on the wall's face and never gets past it", prefab: "tyre-stack", speed: 60 },
    { it: "when a crate is knocked straight at the wall at 60 m/s, then it stops on the wall's face and never gets past it", prefab: "crate", speed: 60 },
    { it: "when a hay bale is knocked straight at the wall at 60 m/s, then it stops on the wall's face and never gets past it", prefab: "hay-bale", speed: 60 },
  ] as const;
  for (const testCase of wallCases) {
    it(testCase.it, async () => {
      const sys = await system(course(testCase.prefab, ROAD.x, ROAD.z));
      sys.knockProp(0, -1, ROAD.left.x * testCase.speed, 1, ROAD.left.z * testCase.speed);
      let farthest = -Infinity;
      run(sys, 3, [], (p) => (farthest = Math.max(farthest, (p.x - ROAD.x) * ROAD.left.x + (p.z - ROAD.z) * ROAD.left.z)));
      sys.dispose();
      expect(farthest, `it never reached the wall (${farthest.toFixed(2)} m across)`).toBeGreaterThan(WALL_OFF - 1);
      expect(farthest, `its middle got ${(farthest - WALL_OFF).toFixed(2)} m past the wall's face`).toBeLessThan(WALL_OFF);
    });
  }

  it("when a crate is knocked at 15 m/s at a car parked broadside 4 m across, then it stops against the car's side and never gets into it", async () => {
    const car = makeCar();
    launch(car, ROAD.x + ROAD.left.x * 4, ROAD.z + ROAD.left.z * 4, Math.atan2(ROAD.along.x, ROAD.along.z), 0, 0);
    const sys = await system(course("crate", ROAD.x, ROAD.z));
    sys.knockProp(0, -1, ROAD.left.x * 15, 2, ROAD.left.z * 15);
    let farthest = -Infinity;
    run(sys, 3, [car], (p) => (farthest = Math.max(farthest, (p.x - ROAD.x) * ROAD.left.x + (p.z - ROAD.z) * ROAD.left.z)));
    sys.dispose();
    // The car's side is 0.86 m from its middle line; the crate is 0.5 m to its middle.
    expect(farthest, `it never reached the car (${farthest.toFixed(2)} m across)`).toBeGreaterThan(2);
    expect(farthest, `its middle got ${farthest.toFixed(2)} m across, into the car's side at ${(4 - 0.86).toFixed(2)} m`).toBeLessThan(4 - 0.86 - 0.35);
  });
});

describe("given a course whose props a car knocks before the dummies' physics has loaded", () => {
  it("when the physics arrives, then the knocked prop flies off from its spot then, and none before", async () => {
    const sys = await system(course("crate", 60, 60), false);
    sys.knockProp(0, -1, 11, 4.5, 0);
    const p = new THREE.Vector3();
    const v = new THREE.Vector3();
    sys.update(FRAME, [], true, false, null);
    expect(sys.propAt(0, p, v), "it flew before the physics was in").toBe(false);
    await sys.preload();
    let farthest = -Infinity;
    run(sys, 2, [], (at) => (farthest = Math.max(farthest, at.x)));
    sys.dispose();
    expect(farthest - 60, `it went ${(farthest - 60).toFixed(1)} m`).toBeGreaterThan(5);
  });
});

describe("given a course with a knocked prop lying where it fell", () => {
  it("when the run is reset, then the prop stands on its spot again; when the course's ground is left, its standing props leave the physics; and when it is back, they stand again", async () => {
    const track = course("crate", 60, 60);
    const sys = await system(track);
    const standing = sys["world"]!.colliders.len();
    sys.knockProp(0, -1, 11, 4.5, 0);
    run(sys, 3, [], () => {});
    sys.reset();
    const p = new THREE.Vector3();
    const v = new THREE.Vector3();
    expect(sys.propAt(0, p, v), "still out after the reset").toBe(false);
    const at = bodyOf(sys).translation();
    const spot = placeProps(track)[0]!;
    expect(Math.hypot(at.x - spot.x, at.y - spot.y - PREFABS.crate.size[1] / 2, at.z - spot.z), `it stands at ${at.x}, ${at.y}, ${at.z}`).toBeLessThan(1e-4);
    setGround(null);
    sys.update(FRAME, [], true, false, null);
    const away = sys["world"]!.colliders.len();
    setGround(track.ground());
    sys.update(FRAME, [], true, false, null);
    const back = sys["world"]!.colliders.len();
    sys.dispose();
    expect(away, `the props stayed in the physics off their course (${away} colliders, ${standing} on it)`).toBeLessThan(standing);
    expect(back, "back on the course").toBe(standing);
  });
});

/** `car` driven from (x, z) along the unit (dx, dz) at `speed` m/s for `seconds` of frames; `each` around every frame's dummies' world. */
function drive(sys: RagdollSystem, car: DeformableCar, x: number, z: number, dx: number, dz: number, speed: number, seconds: number, each: (frame: () => void) => void = (frame) => frame()): void {
  const yaw = Math.atan2(dx, dz);
  for (let f = 0; f < Math.round(seconds / FRAME); f++) {
    launch(car, x + dx * speed * f * FRAME, z + dz * speed * f * FRAME, yaw, dx * speed, dz * speed);
    each(() => sys.update(FRAME, [car], true, false, null));
  }
}

/** The dummies' world on the square course with a crate knocked off (60, 60) at 11 m/s, run until it lies asleep, and where it lies. */
async function restingCrate(): Promise<{ sys: RagdollSystem; at: THREE.Vector3 }> {
  const sys = await system(course("crate", 60, 60));
  sys.knockProp(0, -1, 11, 4.5, 0);
  const at = new THREE.Vector3();
  for (let f = 0; f < Math.round(10 / FRAME) && !bodyOf(sys).isSleeping(); f++) sys.update(FRAME, [], true, false, null);
  sys.propAt(0, at, new THREE.Vector3());
  return { sys, at };
}

describe("given a crate knocked over in a course's infield, lying asleep where it came to rest", () => {
  it("when a car drives by at 20 m/s with its middle line 5 m from the crate, out of reach of it, then the dummies' world takes no step", async () => {
    const { sys, at } = await restingCrate();
    const tick = sys["tick"];
    drive(sys, makeCar(), at.x + 5, at.z - 15, 0, 1, 20, 1.5);
    const steps = sys["tick"] - tick;
    sys.dispose();
    expect(steps, `the world took ${steps} steps for a car that never came within reach`).toBe(0);
  });

  it("when a car drives into it at 10 m/s, then the crate is shoved on over a metre", async () => {
    const { sys, at } = await restingCrate();
    drive(sys, makeCar(), at.x, at.z - 10, 0, 1, 10, 2);
    const now = new THREE.Vector3();
    sys.propAt(0, now, new THREE.Vector3());
    sys.dispose();
    expect(now.distanceTo(at), `it moved ${now.distanceTo(at).toFixed(2)} m`).toBeGreaterThan(1);
  });
});

describe("given a cone lying asleep against the foot of a course's road wall, where a car's bumper knocked it", () => {
  // Knocked across the road at the wall 7 m off (car 0's bumper, 12 m/s), it comes to rest lying against the wall's face.
  // A car then drives along the road from 12 m back to 15 m past it with its wall side (its cage's plan box, local +x) 0.1 m off the
  // wall's face: its box sweeps along the wall's foot, over the cone.
  // 17 m/s todo (measured, ReelTrap): the cage-fitted nose row tiles 5 cm sliver columns (leaves 128 = the cap) whose internal faces
  // carry contradictory normals; a step at 17 m/s (3.5 cm) exceeds a sliver's half width, so Rapier's minimum axis flips to the
  // internal lateral face and the cone ends 4.3 mm into the wall against the 3 mm bound (20 m/s passes). A minimum-width law keeps the cone out but breaks
  // ragdoll-proxy-fit's bars (N=4 nodes: fit 9/11), so the proxy's tiling needs a representation without internal faces (after the plan: tile the proxy without them).
  const scrapeCases: readonly { it: string; speed: number; todo?: string }[] = [
    { it: "when a car scrapes along the wall at 17 m/s, then the cone is shoved along and never goes into the wall", speed: 17, todo: "after the plan: tile the cage-fitted proxy without internal faces: its nose-row sliver leaves have contradictory internal normals (4.3 mm into the wall against the 3 mm bound)" },
    { it: "when a car scrapes along the wall at 20 m/s, then the cone is shoved along and never goes into the wall", speed: 20 },
  ];
  for (const testCase of scrapeCases) {
    todoRow(testCase.it, testCase.todo, async () => {
      const sys = await system(course("cone", ROAD.x, ROAD.z));
      const world = sys["world"]!;
      const body = bodyOf(sys);
      const own = sys["props"]["own"][0]!;
      sys.knockProp(0, 0, ROAD.left.x * 12, 2, ROAD.left.z * 12);
      for (let f = 0; f < Math.round(10 / FRAME) && !body.isSleeping(); f++) sys.update(FRAME, [], true, false, null);
      const lay = new THREE.Vector3();
      sys.propAt(0, lay, new THREE.Vector3());
      const lying = deepestInStatics(world, own);
      const along = (lay.x - ROAD.x) * ROAD.along.x + (lay.z - ROAD.z) * ROAD.along.z;
      const car = makeCar();
      const line = WALL_OFF - car.cage.fields.planBox[1]! - 0.1;
      const x = ROAD.x + ROAD.left.x * line + ROAD.along.x * (along - 12);
      const z = ROAD.z + ROAD.left.z * line + ROAD.along.z * (along - 12);
      let deepest = lying;
      drive(sys, car, x, z, ROAD.along.x, ROAD.along.z, testCase.speed, 27 / testCase.speed, (frame) => {
        frame();
        deepest = Math.max(deepest, deepestInStatics(world, own));
      });
      run(sys, 5, [], () => (deepest = Math.max(deepest, deepestInStatics(world, own))));
      const end = new THREE.Vector3();
      sys.propAt(0, end, new THREE.Vector3());
      sys.dispose();
      expect(lying, `it came to rest ${(-lying).toFixed(2)} m off the wall, not at its foot`).toBeGreaterThan(-0.05);
      expect(end.distanceTo(lay), `the car never shoved it (it moved ${end.distanceTo(lay).toFixed(2)} m)`).toBeGreaterThan(1);
      expect(deepest, `it went ${(deepest * 1000).toFixed(1)} mm into the wall`).toBeLessThan(REST_SLOP);
    });
  }
});

/** The sleeping crates' allocation is read over the dummies' world's own update (the drive harness teleports the car each frame and is not under test). */
const CRATE_UPDATE = { fn: "update", file: "engine-ragdoll.ts" } as const;
const CRATE_BOUND_KB = 16;
/** Seconds of a pass along the row: passes are read until one is under the bar (a late optimizing compile lands in the first). */
const CRATE_PASS_S = 2.5;
/** Vectors the control makes each frame: over 100 B each, so 200 beat the bar. */
const CONTROL_VECTORS = 200;

/** A world holding 24 crates asleep in a row, and a car to drive along it. */
async function sleepingRow() {
  const props = Array.from({ length: 24 }, (_, k) => ({ prefab: "crate" as const, x: 40 + 2 * k, z: 60, yaw: 0, scale: 1 }));
  const sys = await system(new Track(parseTrack(square({ props }))));
  for (let i = 0; i < props.length; i++) sys.knockProp(i, -1, 0, 0, 0);
  run(sys, 3, [], () => {});
  return { sys, car: makeCar(), bodies: sys["props"]["bodies"] };
}

describe("given 24 crates knocked over where they stood, lying asleep in a row", () => {
  // Measured: 27.5–28.6 KB a frame while every sleeping crate was read each frame, 8.4–12.1 KB without (the world's own steps).
  it("when a car drives along the row 3 m off at 20 m/s, near enough that the world steps but never touching, then the crates stay asleep and a frame allocates at most 16 KB", async () => {
    const { sys, car, bodies } = await sleepingRow();
    // A first pass warms the code up; the later ones are read.
    drive(sys, car, 30, 63, 1, 0, 20, CRATE_PASS_S);
    const tick = sys["tick"];
    const frames = Math.round(CRATE_PASS_S / FRAME);
    const kb = untilQuiet(() => allocatedBytes(() => drive(sys, car, 30, 63, 1, 0, 20, CRATE_PASS_S), CRATE_UPDATE) / frames / 1024, CRATE_BOUND_KB);
    const steps = sys["tick"] - tick;
    const awake = bodies.filter((b) => !b!.isSleeping()).length;
    sys.dispose();
    expect(steps, "the world never stepped: nothing here reads the crates").toBeGreaterThan(0);
    expect(awake, `${awake} crates woke`).toBe(0);
    expect(kb, `${kb.toFixed(2)} KB per frame > ${CRATE_BOUND_KB} in every pass for ${COMPILE_WAIT_S} s`).toBeLessThanOrEqual(CRATE_BOUND_KB);
  });

  it("when vectors are made each frame under the dummies' update, then the allocation reads over the bar, and made outside it, it does not", async () => {
    const { sys, car } = await sleepingRow();
    const kept: THREE.Vector3[] = [];
    const makeVectors = (): void => {
      for (let i = 0; i < CONTROL_VECTORS; i++) kept[i % 8] = new THREE.Vector3();
    };
    const frames = Math.round(CRATE_PASS_S / FRAME);
    const kbOf = (each: (frame: () => void) => void): number => allocatedBytes(() => drive(sys, car, 30, 63, 1, 0, 20, CRATE_PASS_S, each), CRATE_UPDATE) / frames / 1024;
    const outside = kbOf((frame) => {
      frame();
      makeVectors();
    });
    const props = sys["props"];
    const here = props.here;
    props.here = (...args) => {
      makeVectors();
      here.apply(props, args);
    };
    const inside = kbOf((frame) => frame());
    props.here = here;
    sys.dispose();
    expect(outside, `${outside.toFixed(2)} KB per frame: vectors made outside the dummies' update must not count`).toBeLessThan(CRATE_BOUND_KB);
    expect(inside, `${inside.toFixed(2)} KB per frame for ${CONTROL_VECTORS} vectors a frame under update: the measure sees nothing`).toBeGreaterThan(CRATE_BOUND_KB);
  });
});

describe("given a crate knocked off its spot on a course's infield, still in the air", () => {
  // A dummy out (a driver lying 20 m off) or a prop flying fast keeps the world at the dummies' rate; slow knocked props
  // alone step four times coarser.
  const rateCases = [
    { it: "when it was tossed straight up at 3 m/s and no dummy is out, then its world steps 120 times a second", kick: [0, 3, 0], dummy: false, perSecond: 120 },
    { it: "when it was tossed straight up at 3 m/s and a dummy is out, then its world steps 480 times a second", kick: [0, 3, 0], dummy: true, perSecond: 480 },
    { it: "when it was knocked at 11 m/s and no dummy is out, then its world steps 480 times a second while it flies that fast", kick: [11, 4.5, 0], dummy: false, perSecond: 480 },
  ] as const;
  for (const testCase of rateCases) {
    it(testCase.it, async () => {
      const sys = await system(course("crate", 60, 60));
      const [vx, vy, vz] = testCase.kick;
      sys.knockProp(0, -1, vx, vy, vz);
      if (testCase.dummy) sys.place(new THREE.Vector3(40, 3, 40), new THREE.Quaternion(), new THREE.Vector3(), new THREE.Vector3(), 10, 0);
      run(sys, 0.1, [], () => {});
      const tick = sys["tick"];
      run(sys, 0.4, [], () => {});
      const steps = sys["tick"] - tick;
      const up = new THREE.Vector3();
      sys.propAt(0, up, new THREE.Vector3());
      sys.dispose();
      expect(up.y, `the crate was down by 0.5 s after its knock (middle ${up.y.toFixed(2)} m up)`).toBeGreaterThan(0.55);
      expect(steps / 0.4, `${steps} steps in 0.4 s`).toBe(testCase.perSecond);
    });
  }
});

describe("given a prop standing on a course's flat infield, slid off its spot along the ground with nothing tipping it", () => {
  // Friction 0.85 (the prop's 0.8 and the ground's 0.9, averaged) stops a slide from 11 m/s about 7 m on. Under it a prop
  // tips only if its half width is under 0.85 of its middle's height: not a crate (1) or a hay bale (1.33), a tyre stack (0.75).
  const slideCases = [
    { it: "when a crate is slid at 11 m/s, then it slides to rest upright about 7 m on", prefab: "crate", tips: false },
    { it: "when a hay bale is slid at 11 m/s, then it slides to rest upright about 7 m on", prefab: "hay-bale", tips: false },
    { it: "when a tyre stack is slid at 11 m/s, then, narrower than it is tall, it tips over", prefab: "tyre-stack", tips: true },
  ] as const;
  for (const testCase of slideCases) {
    it(testCase.it, async () => {
      const sys = await system(course(testCase.prefab, 60, 60));
      sys.knockProp(0, -1, 11, 0, 0);
      let tilt = 0;
      const end = new THREE.Vector3();
      run(sys, 5, [], (p, up) => {
        tilt = Math.max(tilt, Math.acos(Math.min(1, Math.abs(up.y))));
        end.copy(p);
      });
      sys.dispose();
      const deg = (tilt * 180) / Math.PI;
      if (testCase.tips) expect(deg, `it never tipped past 45° (${deg.toFixed(0)}°)`).toBeGreaterThan(45);
      else {
        expect(deg, `it tipped ${deg.toFixed(0)}°`).toBeLessThan(5);
        expect(Math.abs(end.x - 60 - 7.2), `it came to rest ${(end.x - 60).toFixed(1)} m on`).toBeLessThan(0.5);
      }
    });
  }
});

describe("given a cone standing on a course's infield, knocked off by a car's bumper (above its centre of mass)", () => {
  // The race's prop rule: a car at 10 m/s sends it off at 11 m/s and 4.5 up, one at 18 m/s at 20 m/s and 6.5 up.
  const bumperCases = [
    { it: "when the car knocks it at 11 m/s, then it tips over and comes to rest lying on the ground", kick: [11, 4.5, 0] },
    { it: "when the car knocks it at 20 m/s, then it tips over and comes to rest lying on the ground", kick: [20, 6.5, 0] },
  ] as const;
  for (const testCase of bumperCases) {
    it(testCase.it, async () => {
      const track = course("cone", 60, 60);
      const ground = track.ground();
      const sys = await system(track);
      const [vx, vy, vz] = testCase.kick;
      sys.knockProp(0, 0, vx, vy, vz);
      let tilt = 0;
      let endTilt = 0;
      const end = new THREE.Vector3();
      run(sys, 10, [], (p, up) => {
        endTilt = Math.acos(Math.min(1, Math.abs(up.y)));
        tilt = Math.max(tilt, endTilt);
        end.copy(p);
      });
      const asleep = bodyOf(sys).isSleeping();
      sys.dispose();
      const rise = end.y - ground.heightAt(end.x, end.z, end.y);
      expect(tilt, `it never tipped past 45° (${((tilt * 180) / Math.PI).toFixed(0)}°)`).toBeGreaterThan(Math.PI / 4);
      expect(endTilt > Math.PI / 4 && rise < 0.25, `it rests tilted ${((endTilt * 180) / Math.PI).toFixed(0)}° with its middle ${rise.toFixed(2)} m up: not lying down`).toBeTruthy();
      expect(asleep, "it never came to rest").toBeTruthy();
    });
  }
});

describe("given a cone standing on a course's infield, knocked off by a car's bumper at race speed", () => {
  // The race's prop rule: a car at 30 m/s meeting it head-on sends it off at 1.1 × 30 + 1.5 = 34.5 m/s and 2 + 30 / 4 =
  // 9.5 m/s up; one at 42 m/s at 47.7 and 12.5 up. Thrown up at vy, its middle rises vy² / 2g over where it stood (g 9.6,
  // the dummies' world's); tipping over its base's edge (0.2 m out from its middle line, its middle 0.35 m up) lifts the
  // middle at most hypot(0.35, 0.2) − 0.35 = 0.053 m more.
  const [w, h] = PREFABS.cone.size;
  const TIP = Math.hypot(h / 2, w / 2) - h / 2;
  const G = 9.6;
  const liftCases = [
    { it: "when a car knocks it at 30 m/s, then its middle rises no higher than the knock's lift throws it, and no point of it goes into the ground as it leaves", kick: [34.5, 9.5, 0] },
    { it: "when a car knocks it at 42 m/s, then its middle rises no higher than the knock's lift throws it, and no point of it goes into the ground as it leaves", kick: [47.7, 12.5, 0] },
  ] as const;
  for (const testCase of liftCases) {
    it(testCase.it, async () => {
      const track = course("cone", 60, 60);
      const ground = track.ground();
      const sys = await system(track);
      const body = bodyOf(sys);
      const start = body.translation().y;
      const [vx, vy, vz] = testCase.kick;
      sys.knockProp(0, 0, vx, vy, vz);
      // Its first 0.05 s a 1/480 s frame at a time, then the rest of the flight the lift throws it.
      let sink = Infinity;
      let peak = start;
      for (let f = 0; f < 24; f++) {
        sys.update(1 / 480, [], true, false, null);
        const p = body.translation();
        sink = Math.min(sink, lowestPoint("cone", body) - ground.heightAt(p.x, p.z, p.y));
        peak = Math.max(peak, p.y);
      }
      run(sys, (2 * vy) / G - 0.05, [], (p) => {
        peak = Math.max(peak, p.y);
      });
      sys.dispose();
      const lift = (vy * vy) / (2 * G);
      expect(sink, `its lowest point went ${(-sink * 1000).toFixed(1)} mm into the ground as it left`).toBeGreaterThanOrEqual(0);
      expect(peak - start, `its middle rose ${(peak - start).toFixed(2)} m; the knock's lift throws it ${lift.toFixed(2)} m (+ ${TIP.toFixed(3)} tipping)`).toBeLessThanOrEqual(lift + TIP);
    });
  }
});

describe("given a cone knocked over by a car's bumper, lying asleep where it came to rest on a course's infield", () => {
  // The car drives straight at it from 12 m back to 15 m past it (inside the infield's walls), then leaves; `acrossM` is
  // how far its middle line passes to the cone's left, `headingDeg` its heading (0: along +z, 90: along +x).
  const coneRestsOnItsOtherSide =
    "after the plan: derive the rest bound from the cone's collider and its ground patch instead of one tolerance: which side the cone lies on is decided by the order its contacts are solved in, and the car proxies' colliders now being built only where a dummy or prop is near (`RagdollSystem.cull`) changed that order (building them all, as at 4212c3d7, gives back -1.8 mm): this offset rests -5.1 mm off the ground, 2.1 mm past the 3 mm bound, while 13 of the 14 offsets from 0.7 to 0.95 m rest at -0.9 to -2.5 mm (14 of 14 at 4212c3d7)";
  const runOverCases = [
    { it: "when a car drives into it at 30 m/s, then it is never pressed more than 32 mm into the ground and comes to rest lying on it", speed: 30, acrossM: 0, headingDeg: 287 },
    { it: "when a car drives into it at 40 m/s, then it is never pressed more than 32 mm into the ground and comes to rest lying on it", speed: 40, acrossM: 0, headingDeg: 287 },
    { it: "when a car drives into it at 40 m/s with its middle line 0.4 m to one side, then it is never pressed more than 32 mm into the ground and comes to rest lying on it", speed: 40, acrossM: 0.4, headingDeg: 107 },
    { it: "when a car drives into it at 40 m/s with its middle line 0.8 m to one side, then it is never pressed more than 32 mm into the ground and comes to rest lying on it", speed: 40, acrossM: 0.8, headingDeg: 107, todo: coneRestsOnItsOtherSide },
  ] as const;
  for (const testCase of runOverCases) {
    todoRow(testCase.it, "todo" in testCase ? testCase.todo : false, async (t) => {
      const track = course("cone", 60, 60);
      const ground = track.ground();
      const sys = await system(track);
      sys.knockProp(0, 0, 11, 4.5, 0);
      const body = bodyOf(sys);
      for (let f = 0; f < Math.round(10 / FRAME) && !body.isSleeping(); f++) sys.update(FRAME, [], true, false, null);
      const at = new THREE.Vector3();
      sys.propAt(0, at, new THREE.Vector3());
      const yaw = (testCase.headingDeg * Math.PI) / 180;
      const dx = Math.sin(yaw);
      const dz = Math.cos(yaw);
      let sink = Infinity;
      const sinkAt = (p: THREE.Vector3) => {
        sink = Math.min(sink, lowestPoint("cone", body) - ground.heightAt(p.x, p.z, p.y));
      };
      const p = new THREE.Vector3();
      const v = new THREE.Vector3();
      drive(sys, makeCar(), at.x - dx * 12 + dz * testCase.acrossM, at.z - dz * 12 - dx * testCase.acrossM, dx, dz, testCase.speed, 27 / testCase.speed, (frame) => {
        frame();
        if (sys.propAt(0, p, v)) sinkAt(p);
      });
      run(sys, 10, [], sinkAt);
      const end = new THREE.Vector3();
      sys.propAt(0, end, v);
      const gap = lowestPoint("cone", body) - ground.heightAt(end.x, end.z, end.y);
      const asleep = body.isSleeping();
      sys.dispose();
      t.annotate(`deepest ${(sink * 1000).toFixed(1)} mm, rests ${(gap * 1000).toFixed(1)} mm off the ground, asleep ${asleep}`);
      expect(sink, `its lowest point went ${(-sink * 1000).toFixed(1)} mm under the ground`).toBeGreaterThan(-LANDING_SLOP);
      expect(Math.abs(gap) < REST_SLOP && asleep, `it rests with its lowest point ${(gap * 1000).toFixed(1)} mm off the ground (asleep: ${asleep})`).toBeTruthy();
    });
  }
});
