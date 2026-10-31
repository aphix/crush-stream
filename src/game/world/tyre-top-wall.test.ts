import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { assignClass, CLASSES } from "../vehicle/vehicle-classes.ts";
import { paint } from "../vehicle/test-support.ts";
import { makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { armSolids, armTops, C_H, C_OWNER, HIT_SIZE, PQ_SIZE, PQ_X, PQ_Y, PQ_Z, pointContact, Surface, wheelContact } from "./surfaces.ts";
import { SKIN } from "../vehicle/car-surfaces.ts";
import { Ground, setGround } from "./ground.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { PLATFORM_TYRE } from "../kernel/rig-spec.ts";
import { carFrame } from "../vehicle/car-rig.ts";
import { CAR_STYLES } from "../vehicle/car-variants.ts";

/**
 * A tyre's footprint asks the surfaces from its hub's height: a face lower than the hub is the ground it sits in, a taller one is a wall
 * (`wheelContact`). A car's top has a skin of `SKIN` over a hull point, which a tyre must not take: derby seed 1 (docs/UNIFIED_CONTACT.md
 * 11.6), a car's front tyre met a flattened wreck's top 0.12 m over its hub, read it as ground 0.5 m above its tread and was lifted 0.1 m
 * past its spring stop in one 5 ms slice (a first-contact hop of 0.102 m against the bar 3·v·h + 2 cm = 0.093 m).
 */
const FRAME = 1 / FRAME_HZ;
/** How far over the hub the sedan's roof stands in the wall case: inside the roof's skin (`SKIN`), above the hub. */
const OVER = 0.12;
const out = new Float64Array(HIT_SIZE);
const hub = new Float64Array(3);
const axes = Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1);
const q = new Float64Array(PQ_SIZE);

describe("given a sedan standing with a roof, and a tyre's hub over its crown", () => {
  afterEach(() => {
    armTops(null);
    setGround(null);
  });

  function roofAndWorld(): number {
    const sedan = new DeformableCar(paint(), new THREE.Scene());
    assignClass(sedan, "sedan");
    sedan.spawnFacing(0, 0, 0, 0);
    sedan.parked = true;
    const w = makeWorld([sedan], false, false);
    for (let f = 0; f < 30; f++) tickWorld(w, FRAME);
    // A world step disarms the tops when it ends: arm the roof it left, as a car's slice does.
    armTops(w.world.surfaces);
    q[PQ_X] = 0;
    q[PQ_Z] = 0;
    q[PQ_Y] = Infinity;
    pointContact(q, -1, out);
    return out[C_H]!;
  }

  it("when the hub is below the roof by less than its skin, then the roof is a wall: the tyre reads no rise from it", () => {
    const roof = roofAndWorld();
    expect(roof > 1 && OVER < SKIN, `roof ${roof}`).toBeTruthy();
    hub[0] = 0;
    hub[1] = roof - OVER;
    hub[2] = 0;
    wheelContact(hub, axes, 1, 1, -1, out);
    // The only ground left is the road far under the tread: a gap of more than the hub's height over it, not a roof 0.5 m up the tread.
    expect(out[C_H]! < -0.5 || out[C_OWNER] === -1, `rise ${out[C_H]} owner ${out[C_OWNER]} over a roof ${OVER} m above the hub`).toBeTruthy();
    expect(!(out[C_OWNER]! >= 0), `the tyre took the roof as ground: owner ${out[C_OWNER]}`).toBe(true);
  });

  it("when the hub is above the roof, then the tyre rests on it: the roof is its ground", () => {
    const roof = roofAndWorld();
    hub[0] = 0;
    hub[1] = roof + 0.2;
    hub[2] = 0;
    wheelContact(hub, axes, 1, 1, -1, out);
    expect(out[C_OWNER]! >= 0 && out[C_H]! > 0, `rise ${out[C_H]} owner ${out[C_OWNER]} over a roof 0.2 m under the hub`).toBeTruthy();
  });
});

/** The prism's top height (m): under the hub, over the plain. */
const PRISM_TOP = 0.3;
/** The radius (m) of a shoulder ring of the tyre's footprint (`RINGS`). */
const SHOULDER_RADIUS = 0.314;

describe("given a prism standing on the plain, and a tyre whose hub is over its edge", () => {
  afterEach(() => {
    armSolids(null);
    setGround(null);
  });

  it("when no static edge is near, then the prism's top is the tyre's ground where its footprint reaches it, as the plain is where it does not", () => {
    const plain = new Ground();
    plain.addPlane(0, -1e3, 1e3, -1e3, 1e3, Infinity);
    setGround(plain);
    const solids = new Surface();
    solids.addPrism({ x: 0, z: 0, yaw: 0, hx: 1, hz: 3, base: 0, top: PRISM_TOP, id: 0, moves: false });
    armSolids(solids);
    // Over the prism's −x edge, the hub 0.6 m up: the footprint reaches 0.4 m either side of the edge, the plain on one and the prism on the other.
    hub[0] = -1;
    hub[1] = 0.6;
    hub[2] = 0;
    wheelContact(hub, axes, 1, 1, -1, out);
    // The contact is a rise over the tread point (`C_H`): the +x shoulder ring (`RINGS`, offset 0.082, radius 0.314) stands on the prism.
    const rise = PRISM_TOP - (hub[1]! - SHOULDER_RADIUS);
    expect(Math.abs(out[C_H]! - rise), `rise ${out[C_H]} over a prism ${PRISM_TOP} m high, the shoulder ring's bottom ${hub[1]! - SHOULDER_RADIUS} m up`).toBeLessThan(1e-6);
  });
});

/** The drawn tyre's tread rings (`TYRE_PROFILE`): [axle offset, radius] at wheel scale 1, the platform tyre's. */
const TREAD_RINGS = [
  [0, 0.32],
  [0.082, 0.314],
  [-0.082, 0.314],
  [0.104, 0.298],
  [-0.104, 0.298],
] as const;

/** The greatest lift (m) any point of ring `[ox, rad]` (drawn: `ox` along `axle` from `hub`, radius `rad` in the up / `fwd` plane) needs over `ground`, each asked from the hub's height: 0.5° steps, then 1e-3° about the best. */
function ringRise(ground: Ground, hub: THREE.Vector3, axle: THREE.Vector3, fwd: THREE.Vector3, ox: number, rad: number): number {
  const p = new THREE.Vector3();
  const rise = (deg: number): number => {
    const t = (deg * Math.PI) / 180;
    p.copy(hub).addScaledVector(axle, ox).addScaledVector(fwd, Math.sin(t) * rad);
    p.y -= Math.cos(t) * rad;
    return ground.heightAt(p.x, p.z, hub.y) - p.y;
  };
  let best = -Infinity;
  let at = 0;
  for (let d = -90; d <= 90; d += 0.5) {
    const r = rise(d);
    if (r > best) [best, at] = [r, d];
  }
  for (let d = at - 0.5; d <= at + 0.5; d += 1e-3) best = Math.max(best, rise(d));
  return best;
}

describe("given a step 1.6 m over the plain, and a monster's tyre standing off its side with its tread on the edge", () => {
  afterEach(() => setGround(null));

  it("when the tyre is yawed so one tread ring after another reaches the edge first, then its footprint lifts it as far as its drawn tread needs", () => {
    const top = 0.6;
    const ground = new Ground();
    ground.addPlane(-1, -1e3, 1e3, -1e3, 1e3, Infinity);
    ground.addPrism({ x: 0, z: 0, yaw: 0, hx: 1, hz: 3, base: 0, top, id: 0 });
    setGround(ground);
    // The monster's tread is far wider than its radius scales (`wheelsAt`): its rings stand off the crown by `across`, not `scale`.
    const { r, halfW } = carFrame(CAR_STYLES.monster).rig.tyre;
    const { wheelScale } = CLASSES.monster;
    const scale = wheelScale * (r / PLATFORM_TYRE.r);
    const across = wheelScale * (halfW / PLATFORM_TYRE.halfW);
    expect(across / scale, "the monster's tread is wider than its radius scales").toBeGreaterThan(1.2);
    // The hub 0.58 m off the +x side at 0.7 m up: the tread meets the edge near level with the hub, where its height turns fastest.
    const hub = new THREE.Vector3(1.58, 0.7, 0);
    for (const yawDeg of [60, 75, 90, 105, 120]) {
      const yaw = (yawDeg * Math.PI) / 180;
      const axle = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const drawn = Math.max(...TREAD_RINGS.map(([ox, rad]) => ringRise(ground, hub, axle, fwd, ox * across, rad * scale)));
      wheelContact(Float64Array.of(hub.x, hub.y, hub.z), Float64Array.of(axle.x, 0, axle.z, 0, 1, 0, fwd.x, 0, fwd.z), scale, across, -1, out);
      expect(drawn, `yaw ${yawDeg}°: the tread rests on the step's top, not the plain 1 m under it`).toBeGreaterThan(-0.5);
      expect(Math.abs(out[C_H]! - drawn), `yaw ${yawDeg}°: footprint rise ${out[C_H]} against the drawn tread's ${drawn}`).toBeLessThan(1e-3);
    }
  });
});
