import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { StreamedDeformation } from "./streamed-deform.ts";
import { DT, dummyGeom, mass } from "../vehicle/test-support.ts";
import { stepWreck, type WreckRig } from "./physics-util.test-util.ts";

/**
 * A planted wreck (quiet 0.2 s, its wheels on the ground) keeps what its clamp writes back, turn included: the frame
 * follows the engine → axle axis and every mass is written into it. That turn moved positions only, so the masses'
 * velocities about their centroid stayed where they were: the same defect as `driveMasses` before it. The next hold of
 * the angular momentum (`yawMomentum`) then handed the difference back as a rigid spin on every mass, and the drawn
 * heading ran away (derby seed 269 c8: the axis went 3 → 7.8 rad/s in 0.17 s while the masses' L/I was 1.5).
 */
function planted(): WreckRig {
  const d = new StreamedDeformation(dummyGeom());
  d.mode = "shape";
  const group = new THREE.Group();
  group.updateMatrixWorld();
  const vel = new THREE.Vector3();
  const omega = new THREE.Vector3();
  d.beginCrush(new THREE.Vector3(0, 0.36, 2.06), new THREE.Vector3(0, 0, -1), 0, 0, group, vel, omega);
  const rig = { d, group, vel, omega };
  for (let i = 0; i < 20; i++) stepWreck(rig, DT);
  expect(d.quietTime(), `quiet ${d.quietTime().toFixed(2)} s: not planted`).toBeGreaterThan(0.25);
  return rig;
}

/** Every mass turning rigidly at `w` rad/s about the centroid (v = w (z, −x)), the engine block swinging 3 m/s on top of it. */
function spin(d: StreamedDeformation, w: number): void {
  let m = 0;
  let cx = 0;
  let cz = 0;
  for (const q of d.masses) {
    m += q.mass;
    cx += q.world.x * q.mass;
    cz += q.world.z * q.mass;
  }
  cx /= m;
  cz /= m;
  for (const q of d.masses) {
    q.vel.x = w * (q.world.z - cz) + (q.name === "engineL" ? 3 : q.name === "engineR" ? -3 : 0);
    q.vel.y = 0;
    q.vel.z = -w * (q.world.x - cx);
  }
}

type P = [number, number];

/** The net turn (rad, v = w (z, −x) sense) between two position sets of the masses, about their own centroids. */
function turnBetween(a: P[], b: P[], ms: number[]): number {
  const total = ms.reduce((t, x) => t + x, 0);
  const cen = (p: P[]): P => [p.reduce((t, q, i) => t + q[0] * ms[i]!, 0) / total, p.reduce((t, q, i) => t + q[1] * ms[i]!, 0) / total];
  const [ax, az] = cen(a);
  const [bx, bz] = cen(b);
  let s = 0;
  let c = 0;
  for (const [i, p] of a.entries()) {
    const rx = p[0] - ax;
    const rz = p[1] - az;
    const sx = b[i]![0] - bx;
    const sz = b[i]![1] - bz;
    s += ms[i]! * (rz * sx - rx * sz);
    c += ms[i]! * (rx * sx + rz * sz);
  }
  return Math.atan2(s, c);
}

/** The angular momentum (kg·m²/s about +y) of masses `ms` at `p` moving at `v`, about their centroid and relative to their mean velocity. */
function momentum(p: P[], v: P[], ms: number[]): number {
  const total = ms.reduce((t, x) => t + x, 0);
  const at = (a: P[], k: 0 | 1): number => a.reduce((t, q, i) => t + q[k] * ms[i]!, 0) / total;
  const [cx, cz, vx, vz] = [at(p, 0), at(p, 1), at(v, 0), at(v, 1)];
  return p.reduce((l, q, i) => l + ms[i]! * ((q[1] - cz) * (v[i]![0] - vx) - (q[0] - cx) * (v[i]![1] - vz)), 0);
}

describe("given a wreck that has sat still on its wheels for over 0.2 s, whose frame is then re-aligned to the engine-to-axle axis", () => {
  it("when the re-alignment swings the engine block by 1 rad, then the write-back reshapes the wreck and keeps the angular momentum of its parts about their centre to within 0.1 %, with a real momentum to keep (over 1000)", () => {
    const rig = planted();
    const { d } = rig;
    spin(d, 2);
    const axle = mass(d, "axleR").world;
    for (const name of ["engineL", "engineR"]) {
      const e = mass(d, name).world;
      const dx = e.x - axle.x;
      const dz = e.z - axle.z;
      e.x = axle.x + dx * Math.cos(1) + dz * Math.sin(1);
      e.z = axle.z - dx * Math.sin(1) + dz * Math.cos(1);
    }
    const ms = d.masses.map((q) => q.mass);
    const velocities = (): P[] => d.masses.map((q): P => [q.vel.x, q.vel.z]);
    const positions = (): P[] => d.masses.map((q): P => [q.world.x, q.world.z]);
    const p0 = positions();
    const l0 = momentum(p0, velocities(), ms);
    d.followGroup(rig.group, new THREE.Vector3(), new THREE.Vector3(), 0);
    const w = turnBetween(p0, positions(), ms);
    expect(Math.abs(w), `the write-back turned the masses ${w.toFixed(3)} rad: the setup no longer turns them`).toBeGreaterThan(0.1);
    const l1 = momentum(positions(), velocities(), ms);
    expect(Math.abs(l0), `no momentum to keep: ${l0.toFixed(0)} kg·m²/s`).toBeGreaterThan(1000);
    expect(Math.abs(l1 / l0 - 1), `the write-back moved the angular momentum ${l0.toFixed(1)} → ${l1.toFixed(1)} kg·m²/s (it turned the masses ${w.toFixed(2)} rad)`).toBeLessThan(1e-3);
  });

  it("when the re-alignment swings the engine block by 0.5 rad, then the car's spin velocity carries only the parts' own momentum spin, not the re-alignment's snap, and the shown spin adds that kept turn to within 25 %", () => {
    const rig = planted();
    const { d } = rig;
    const axle = mass(d, "axleR").world;
    for (const name of ["engineL", "engineR"]) {
      const e = mass(d, name).world;
      const dx = e.x - axle.x;
      const dz = e.z - axle.z;
      e.x = axle.x + dx * Math.cos(0.5) + dz * Math.sin(0.5);
      e.z = axle.z - dx * Math.sin(0.5) + dz * Math.cos(0.5);
    }
    const ms = d.masses.map((q) => q.mass);
    const p0 = d.masses.map((q): P => [q.world.x, q.world.z]);
    const omega = rig.omega;
    stepWreck(rig, DT);
    const w = turnBetween(p0, d.masses.map((q): P => [q.world.x, q.world.z]), ms);
    expect(Math.abs(w), `the write-back turned the masses ${w.toFixed(3)} rad: the setup no longer turns them`).toBeGreaterThan(0.03);
    const total = ms.reduce((t, x) => t + x, 0);
    const cx = d.masses.reduce((t, q) => t + q.world.x * q.mass, 0) / total;
    const cz = d.masses.reduce((t, q) => t + q.world.z * q.mass, 0) / total;
    const vx = d.masses.reduce((t, q) => t + q.vel.x * q.mass, 0) / total;
    const vz = d.masses.reduce((t, q) => t + q.vel.z * q.mass, 0) / total;
    let l = 0;
    let inertia = 0;
    for (const q of d.masses) {
      l += q.mass * ((q.world.z - cz) * (q.vel.x - vx) - (q.world.x - cx) * (q.vel.z - vz));
      inertia += q.mass * ((q.world.x - cx) ** 2 + (q.world.z - cz) ** 2);
    }
    const spin = l / inertia;
    // What the sim reads (`car.angular`: a fake fall seeded from a replay/netplay pose, a flight) is the momentum's spin alone: a
    // 0.1 rad snap of this step's write-back is a position correction, and at 240 Hz it would read 24 rad/s of spin that is not there.
    expect(Math.abs(omega.y - spin), `angular.y ${omega.y.toFixed(3)} rad/s, the masses' L/I ${spin.toFixed(3)} (the kept turn ${(w / DT).toFixed(1)} rad/s leaked into it)`).toBeLessThan(0.02 + 0.02 * Math.abs(spin));
    // What is shown (HUD, spin metrics): that spin plus the turn the write-back kept, as the drawn heading turned.
    const shown = (omega.y + d.keptSpin) * DT;
    expect(Math.abs(shown - (spin * DT + w)), `shown ${shown.toFixed(4)} rad over the step, the masses made ${(spin * DT + w).toFixed(4)}`).toBeLessThan(0.25 * Math.abs(w));
  });
});
