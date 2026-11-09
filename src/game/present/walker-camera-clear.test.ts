import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { setGround } from "../world/ground.ts";
import { driverLook } from "./driver-look.ts";
import type { RagdollSystem } from "./engine-ragdoll.ts";
import { WALKER_SLOT } from "./ragdoll-pool.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";
import { CAMERA_RADIUS, PIVOT_OVER_TORSO, SHOULDER_BOOM, SHOULDER_PITCH, type Sweep, WalkerView } from "./walker-camera.ts";
import type { FloorBox } from "./walker-floor.ts";

const FRAME = 1 / FRAME_HZ;
/** The orbit's yaw that stands the eye behind a walker facing +z (the eye at (sin, cos) of it from its point): its right is then -x. */
const BEHIND = Math.PI;
/** A wall beside his right shoulder, its face this far (m) from his middle: clear of his arm (0.29 m out), inside the shoulder camera's 0.5 m. */
const WALL_FACE_X = -0.35;
const WALL: FloorBox = { x0: -0.75, z0: -4, x1: WALL_FACE_X, z1: 4, y0: 0, y1: 3 };

let system: RagdollSystem | null = null;

afterEach(() => {
  system?.dispose();
  system = null;
  setGround(null);
});

/** The shoulder camera's eye (x, y, z) behind the walker standing at the origin facing +z, with `boxes` streamed in beside him. */
async function shoulderEye(boxes: readonly FloorBox[]): Promise<THREE.Vector3> {
  const sys = await flatSystem();
  system = sys;
  expect(sys.startWalker(new THREE.Vector3(0, 0, 0), 0, { cop: false, look: driverLook(0, 0) }), "the walker is placed").toBe(WALKER_SLOT);
  sys.setFixedBoxes(boxes);
  for (let f = 0; f < FRAME_HZ / 2; f++) sys.update(FRAME, [], true, true, null);
  const torso = new THREE.Vector3();
  expect(sys.walkerTorso(torso), "he is out").toBe(true);
  const sweep: Sweep = (x, y, z, dx, dy, dz, length) => sys.sightClear(x, y, z, dx, dy, dz, length, CAMERA_RADIUS);
  const view = new WalkerView();
  view.shoulder(torso.x, torso.y, torso.z, torso.x, torso.y + PIVOT_OVER_TORSO, torso.z, BEHIND, SHOULDER_PITCH, SHOULDER_BOOM, sweep, FRAME);
  return new THREE.Vector3(view.eye[0], view.eye[1], view.eye[2]);
}

describe("given the walker standing with a wall streamed in beside his right shoulder", () => {
  // mutation: sed -i 's/return hit === null ? length : Math.min(length, hit.time_of_impact);/return length;/' src/game/present/ragdoll-throw.ts
  it("when the shoulder camera is placed, then its eye stands out of the wall by its ball, where with no wall it would stand inside it", async () => {
    const open = await shoulderEye([]);
    expect(open.x, `with no wall the eye is out at the shoulder: x ${open.x.toFixed(2)}`).toBeLessThan(WALL_FACE_X);
    system!.dispose();
    system = null;
    const walled = await shoulderEye([WALL]);
    expect(walled.x, `the eye stays its ball's width off the wall: x ${walled.x.toFixed(2)}`).toBeGreaterThanOrEqual(WALL_FACE_X + CAMERA_RADIUS - 1e-3);
    expect(walled.z, `and still behind him: z ${walled.z.toFixed(2)}`).toBeLessThan(-1);
  });
});
