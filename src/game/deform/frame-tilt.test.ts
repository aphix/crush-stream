import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { StreamedDeformation } from "./streamed-deform.ts";
import { dummyGeom, mass } from "../vehicle/test-support.ts";
import { stepWreck, type WreckRig } from "./physics-util.test-util.ts";
import { FINE_HZ } from "../kernel/constants.ts";

/**
 * The rigid step poses a wreck's frame from its tyres and hull; the cloud's own solve (goals, clamps) leaves its masses' heights where they
 * were. The difference reads in the frame as lifted wing and rail points. Between 0.045 s and the plant (0.2 s) after the contact the frame takes, by an eased share a step, the tilt its masses have taken in it (`followGroup`'s `seatTilt`), about
 * their centroid, so nothing moves in the world; while a face still presses, the contact solve's pose is the truth and the frame keeps it.
 */
const STEP = 1 / FINE_HZ;
/** The lean (m of lift per m along the car) the masses are given against a level frame: 1.7°, 6 cm at the car's nose. */
const LEAN = 0.03;
/** Sim seconds the wreck has been quiet: past `TILT_SEAT_QUIET` (0.045) and short of the plant (0.2), where the frame takes the masses' tilt. */
const QUIET_S = 0.07;
/** Fixed-step reads of the frame: the tilt is taken by an eased share per step (`TILT_SEAT_TIME` 0.05 s), 99 % of it after these. */
const TILT_CALLS = 60;
/** Sim seconds of quiet past `PLANT_QUIET` (0.2). */
const PLANTED_S = 0.25;

/** A level wreck 0.9 m up whose hit has just been taken (no contact since: it is quiet from here on). */
function levelWreck(): WreckRig {
  const d = new StreamedDeformation(dummyGeom());
  d.mode = "shape";
  const group = new THREE.Group();
  group.position.y = 0.9;
  group.updateMatrixWorld();
  const vel = new THREE.Vector3();
  const omega = new THREE.Vector3();
  d.beginCrush(new THREE.Vector3(0, 0.36, 2.06), new THREE.Vector3(0, 0, -1), 0, 0, group, vel, omega);
  return { d, group, vel, omega };
}

/** The body masses' lift over their rest (m) at the car's nose, in the frame: the lump the lean reads as. */
function noseLift(s: WreckRig): number {
  const nose = mass(s.d, "bumperFL");
  return nose.local.y - nose.rest.y;
}

/** The body masses given the lean in the world, as a cloud solve that held its own heights leaves them against a frame that sank under them: a pure pitch about their centroid (a lean with a mean lift is also a rise no turn can take). */
function lean(s: WreckRig): void {
  let sum = 0;
  let mean = 0;
  for (const m of s.d.masses) {
    if (!m.dynamic || m.hub) continue;
    sum += m.mass;
    mean += m.rest.z * m.mass;
  }
  mean /= sum;
  for (const m of s.d.masses) if (!m.hub) m.world.y += LEAN * (m.rest.z - mean);
}

describe("given a quiet wreck whose masses lean against its level frame", () => {
  it(`when its frame is read for a quarter of a second of steps, then it takes the lean (pitched ${LEAN} rad up the car's length), the nose reads no lift and no mass moved in the world`, () => {
    const s = levelWreck();
    for (let i = 0; i < QUIET_S * FINE_HZ + 1; i++) stepWreck(s, STEP);
    expect(s.d.quietTime(), "the wreck has been quiet").toBeGreaterThan(0.05);
    lean(s);
    const before = s.d.masses.map((m) => m.world.y);
    for (let i = 0; i < TILT_CALLS; i++) s.d.followGroup(s.group, s.vel, s.omega, STEP);
    expect(s.group.rotation.x, "the frame's pitch (rad, nose up is negative)").toBeCloseTo(-LEAN, 2);
    expect(Math.abs(noseLift(s)), "the nose's lift over its rest in the frame (m)").toBeLessThan(0.005);
    const moved = s.d.masses.reduce((worst, m, i) => Math.max(worst, Math.abs(m.world.y - before[i]!)), 0);
    expect(moved, "the most a mass moved in the world (m)").toBeLessThan(0.002);
  });

  it("when the same lean comes while a contact is still pressing, then the frame keeps the pose the contact solve gave it", () => {
    const s = levelWreck();
    expect(s.d.quietTime(), "the hit has just been taken").toBeLessThan(0.05);
    lean(s);
    s.d.followGroup(s.group, s.vel, s.omega, STEP);
    expect(Math.abs(s.group.rotation.x), "the frame's pitch (rad)").toBeLessThan(1e-6);
    expect(noseLift(s), "the nose's lift over its rest in the frame (m)").toBeGreaterThan(LEAN);
  });

  it("when one step reads the lean, then the frame takes a small share of it (the drawn body never steps)", () => {
    const s = levelWreck();
    for (let i = 0; i < QUIET_S * FINE_HZ + 1; i++) stepWreck(s, STEP);
    lean(s);
    s.d.followGroup(s.group, s.vel, s.omega, STEP);
    const turned = -s.group.rotation.x;
    expect(turned, "the frame turned toward the lean (rad)").toBeGreaterThan(0);
    expect(turned, "the most the frame turns in one step (rad)").toBeLessThan(LEAN * 0.2);
  });

  it("when the wreck has been quiet past the plant, then the frame keeps the pose its hubs and the ground gave it", () => {
    const s = levelWreck();
    for (let i = 0; i < PLANTED_S * FINE_HZ + 1; i++) stepWreck(s, STEP);
    expect(s.d.quietTime(), "the wreck is planted").toBeGreaterThan(PLANTED_S);
    const planted = s.group.rotation.x;
    lean(s);
    for (let i = 0; i < TILT_CALLS; i++) s.d.followGroup(s.group, s.vel, s.omega, STEP);
    expect(Math.abs(s.group.rotation.x - planted), "the pitch the lean added to the frame (rad)").toBeLessThan(1e-6);
  });

  it("when the same lean comes while the wreck is still turning at 1 rad/s, then the frame keeps its pose: a wreck in flight is not settling on its wheels", () => {
    const s = levelWreck();
    for (let i = 0; i < QUIET_S * FINE_HZ + 1; i++) stepWreck(s, STEP);
    expect(s.d.quietTime(), "the wreck has been quiet").toBeGreaterThan(0.05);
    lean(s);
    s.omega.set(1, 0, 0);
    for (let i = 0; i < TILT_CALLS; i++) s.d.followGroup(s.group, s.vel, s.omega, STEP);
    expect(Math.abs(s.group.rotation.x), "the frame's pitch (rad)").toBeLessThan(1e-6);
    expect(noseLift(s), "the nose's lift over its rest in the frame (m)").toBeGreaterThan(LEAN);
  });
});
