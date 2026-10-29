import { describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { makeCar } from "../contact/crash-scenarios.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { blankEjection, ejectionVelocity } from "../vehicle/ejection.ts";
import type { RagdollSystem } from "./engine-ragdoll.ts";
import { type BoxPlacement, NO_RELEASE_SCALE, type ReleaseScale } from "./ragdoll-boxes.ts";
import type { Doll } from "./ragdoll-body.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";

const FRAME = 1 / FRAME_HZ;
/** The default life of a thrown dummy (s): `LIFE` in engine-ragdoll.ts. */
const DEFAULT_LIFE_SECONDS = 10;
/** Sim seconds a held dummy must outlive (the minigames' flow: the camera holds with no timer). */
const HELD_SECONDS = 60;
/** A dummy held that long has been still for most of it (s). */
const HELD_STILL_SECONDS = 30;
/** The release scale of the scaled-launch row, and how near (m/s, an f32's resolution at 11 m/s) a scaled component must be. */
const FORWARD_SCALE = 0.5;
const UPWARD_SCALE = 1.2;
/** The elevation row's scale: forward, and the angle (rad) the whole of the scaled horizontal speed is turned up to. */
const ELEVATION_FORWARD = 0.5;
const ELEVATION_RADIANS = Math.PI / 6;
const SPEED_TOLERANCE = 1e-5;
const ONE_BOX: readonly BoxPlacement[] = [{ x: 20, y: 0.5, z: 0, yaw: 0, width: 1, height: 1, depth: 1 }];

/** An ejection out of the car's windshield, far from the origin: car velocity (7, -1, 5), his own (2, 12, 3). */
function farEjection() {
  const ejection = blankEjection();
  ejection.dir.set(0, 0, 1);
  ejection.pos.set(-300, 1.5, 0);
  ejection.rel.set(2, 12, 3);
  ejection.carVel.set(7, -1, 5);
  return ejection;
}

const dummyOf = (sys: RagdollSystem) => sys["dolls"][0]!;

/** The dummy's centre-of-mass velocity: a thrown driver's limbs leave loose (`limp`), so no one part moves at his launch velocity. */
function velocityOf(doll: Doll): THREE.Vector3 {
  const sum = new THREE.Vector3();
  let mass = 0;
  for (const body of doll.bodies) {
    sum.addScaledVector(body.linvel() as THREE.Vector3, body.mass());
    mass += body.mass();
  }
  return sum.divideScalar(mass);
}

describe("given a dummy launched through launch() from a car", () => {
  it("when holdThrown() was called and a minute of sim passes, then he is still alive and still, and releaseThrown() removes him", async () => {
    const sys = await flatSystem();
    const car = makeCar();
    sys.holdThrown();
    sys.launch(farEjection(), [car]);
    const torso = new THREE.Vector3();
    for (let frame = 0; frame < HELD_SECONDS * FRAME_HZ; frame++) sys.update(FRAME, [], true, false, null);
    const heldStill = sys.latest(torso);
    sys.releaseThrown();
    const afterRelease = sys.latest(torso);
    sys.dispose();
    expect(heldStill, `after ${HELD_SECONDS} s he has lain still for ${heldStill.toFixed(1)} s (-1: he is gone)`).toBeGreaterThan(HELD_STILL_SECONDS);
    expect(afterRelease, "released: he is gone").toBe(-1);
  });

  it("when nothing was held and 11 s of sim pass, then his 10 s life is over and he is gone", async () => {
    const sys = await flatSystem();
    const car = makeCar();
    sys.launch(farEjection(), [car]);
    const torso = new THREE.Vector3();
    for (let frame = 0; frame < (DEFAULT_LIFE_SECONDS + 1) * FRAME_HZ; frame++) sys.update(FRAME, [], true, false, null);
    const gone = sys.latest(torso);
    sys.dispose();
    expect(gone, "gone after LIFE").toBe(-1);
  });

  it("when he was held and released, then the next dummy lives 10 s again", async () => {
    const sys = await flatSystem();
    const car = makeCar();
    sys.holdThrown();
    sys.releaseThrown();
    sys.launch(farEjection(), [car]);
    const torso = new THREE.Vector3();
    for (let frame = 0; frame < (DEFAULT_LIFE_SECONDS + 1) * FRAME_HZ; frame++) sys.update(FRAME, [], true, false, null);
    const gone = sys.latest(torso);
    sys.dispose();
    expect(gone, "the default life is back").toBe(-1);
  });

  it("when reset() is called while a box stands and a dummy is held, then the box is gone and the next dummy lives 10 s", async () => {
    const sys = await flatSystem();
    sys.setBoxes(ONE_BOX);
    sys.holdThrown();
    sys.reset();
    const count = sys.copyBoxPoses(new Float32Array(0));
    const car = makeCar();
    sys.launch(farEjection(), [car]);
    const life = dummyOf(sys).life;
    sys.dispose();
    expect(count, "no boxes after reset").toBe(0);
    expect(life, "LIFE after reset").toBe(DEFAULT_LIFE_SECONDS);
  });

  it("when launched with no scale, with the identity scale and with forward 0.5 and upward 1.2, then his centre of mass moves at the ejection's own velocity, the identity scales equal it bit for bit, and the third has its horizontal halved and its vertical raised by a fifth", async () => {
    const car = makeCar();
    const launched = async (scale: ReleaseScale | null) => {
      const sys = await flatSystem();
      const ejection = farEjection();
      if (scale === null) sys.launch(ejection, [car]);
      else sys.launch(ejection, [car], true, scale);
      const velocity = velocityOf(dummyOf(sys));
      const position = dummyOf(sys).bodies[0]!.translation();
      const own = ejectionVelocity(ejection, new THREE.Vector3());
      sys.dispose();
      return { velocity, position, own };
    };
    const unscaled = await launched(null);
    const identity = await launched({ forward: 1, upward: 1, elevation: null });
    const named = await launched(NO_RELEASE_SCALE);
    const scaled = await launched({ forward: FORWARD_SCALE, upward: UPWARD_SCALE, elevation: null });
    expect(Math.abs(unscaled.velocity.x - unscaled.own.x), `default x ${unscaled.velocity.x} vs ${unscaled.own.x}`).toBeLessThan(SPEED_TOLERANCE);
    expect(Math.abs(unscaled.velocity.y - unscaled.own.y), `default y ${unscaled.velocity.y} vs ${unscaled.own.y}`).toBeLessThan(SPEED_TOLERANCE);
    expect(Math.abs(unscaled.velocity.z - unscaled.own.z), `default z ${unscaled.velocity.z} vs ${unscaled.own.z}`).toBeLessThan(SPEED_TOLERANCE);
    expect(identity.velocity.x, "identity x").toBe(unscaled.velocity.x);
    expect(identity.velocity.y, "identity y").toBe(unscaled.velocity.y);
    expect(identity.velocity.z, "identity z").toBe(unscaled.velocity.z);
    expect(named.velocity.x, "NO_RELEASE_SCALE x").toBe(unscaled.velocity.x);
    expect(named.velocity.y, "NO_RELEASE_SCALE y").toBe(unscaled.velocity.y);
    expect(named.velocity.z, "NO_RELEASE_SCALE z").toBe(unscaled.velocity.z);
    expect(NO_RELEASE_SCALE.forward, "the named identity's forward").toBe(1);
    expect(NO_RELEASE_SCALE.upward, "the named identity's upward").toBe(1);
    expect(NO_RELEASE_SCALE.elevation, "the named identity's elevation").toBe(null);
    expect(Math.abs(scaled.velocity.x - FORWARD_SCALE * unscaled.own.x), `scaled x ${scaled.velocity.x} vs ${FORWARD_SCALE * unscaled.own.x}`).toBeLessThan(SPEED_TOLERANCE);
    expect(Math.abs(scaled.velocity.y - UPWARD_SCALE * unscaled.own.y), `scaled y ${scaled.velocity.y} vs ${UPWARD_SCALE * unscaled.own.y}`).toBeLessThan(SPEED_TOLERANCE);
    expect(Math.abs(scaled.velocity.z - FORWARD_SCALE * unscaled.own.z), `scaled z ${scaled.velocity.z} vs ${FORWARD_SCALE * unscaled.own.z}`).toBeLessThan(SPEED_TOLERANCE);
    expect(scaled.position.x, "the scale does not move him: same start x").toBe(unscaled.position.x);
    expect(scaled.position.y, "the scale does not move him: same start y").toBe(unscaled.position.y);
    expect(scaled.position.z, "the scale does not move him: same start z").toBe(unscaled.position.z);
  });

  it("when launched with forward 0.5 and an elevation of 30 degrees, then his whole speed is half the ejection's horizontal speed, aimed 30 degrees up along its heading, whatever the ejection's own vertical was", async () => {
    const sys = await flatSystem();
    const ejection = farEjection();
    sys.launch(ejection, [makeCar()], true, { forward: ELEVATION_FORWARD, upward: 1, elevation: ELEVATION_RADIANS });
    const velocity = velocityOf(dummyOf(sys));
    const own = ejectionVelocity(ejection, new THREE.Vector3());
    sys.dispose();
    const speed = ELEVATION_FORWARD * Math.hypot(own.x, own.z);
    const horizontal = Math.hypot(velocity.x, velocity.z);
    expect(own.y, "the ejection has a vertical of its own to be dropped").not.toBe(0);
    expect(Math.abs(horizontal - speed * Math.cos(ELEVATION_RADIANS)), `horizontal ${horizontal} vs ${speed * Math.cos(ELEVATION_RADIANS)}`).toBeLessThan(SPEED_TOLERANCE);
    expect(Math.abs(velocity.y - speed * Math.sin(ELEVATION_RADIANS)), `vertical ${velocity.y} vs ${speed * Math.sin(ELEVATION_RADIANS)}`).toBeLessThan(SPEED_TOLERANCE);
    expect(Math.abs(velocity.x / horizontal - own.x / Math.hypot(own.x, own.z)), "the heading is the ejection's").toBeLessThan(SPEED_TOLERANCE);
  });
});
