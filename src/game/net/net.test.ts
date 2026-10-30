import { describe, expect, it } from "vitest";
import { todoRow } from "../kernel/todo-row.test-util.ts";
import { idleDrive } from "../vehicle/car-drive.ts";
import { DerbyMatch } from "../match/derby.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import * as THREE from "three";
import { FREEWHEEL, launch, makeCar, makeWorld, runWall, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { buildCar } from "../vehicle/drawn-body.test-util.ts";
import { assertSameDigest, assertSameNumbers, itModes } from "../vehicle/test-support.ts";
import { EPICENTER, epicenterValues, loadEpicenter } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";
import {
  ensureFrames,
  makeCarFrame,
  makeSnapshot,
  Q,
  readDerby,
  readInput,
  Reader,
  readSnapshot,
  snapshotMaxBytes,
  writeDerby,
  writeInput,
  writeSnapshot,
  Writer,
  type CarFrame,
  type DerbyNetState,
  type NetLayout,
  type Snapshot,
} from "./codec.ts";
import { carLayout, readCarPose } from "./car-pose.ts";
import { tyreClearance } from "../vehicle/tyre-clearance.test-util.ts";
import { drawnTriangles } from "../vehicle/drawn-body.test-util.ts";
import { drawSnapshots } from "./net-view.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { SCRAPE_MAX } from "../vehicle/paint-scrapes.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

const L: NetLayout = { masses: 20, clusters: 16, sensors: 21, parts: 8, wheels: 4 };

/** `car`'s body skin as the sim wrote it, before the drawn tyre hold (`TyreSkin`): what crosses the wire. Each peer holds it over its own drawn wheels, as it draws its own springs. */
function simSkin(car: DeformableCar): ArrayLike<number> {
  return car["bodyTyres"]?.["written"] ?? car.body.geometry.getAttribute("position").array;
}

/** The clearance (m) a drawn tyre top keeps under the drawn skin (`tyre-hood.test.ts`). */
const TYRE_CLEARANCE_M = 0.005;

/** The host car's frame after a trip through the wire (`writeSnapshot` → `readSnapshot`). */
function wire(host: DeformableCar): CarFrame {
  const L = carLayout(host);
  const out = makeSnapshot();
  ensureFrames(out, 1, L);
  out.count = 1;
  const f = out.cars[0]!;
  f.x = host.group.position.x;
  f.y = host.group.position.y;
  f.z = host.group.position.z;
  f.pitch = host.group.rotation.x;
  f.yaw = host.group.rotation.y;
  f.roll = host.group.rotation.z;
  f.crashed = host.crashed;
  f.wreck = true;
  host.deform.readNetState(f.deform);
  host.readPartNetState(f.parts);
  const w = new Writer();
  writeSnapshot(w, out, L);
  const got = makeSnapshot();
  readSnapshot(new Reader().reset(w.done()), got, L);
  return got.cars[0]!;
}

/** Applies a frame the way NetPlay does: pose first, then the wreck. */
function apply(client: DeformableCar, g: CarFrame): DeformableCar {
  client.group.position.set(g.x, g.y, g.z);
  client.group.rotation.set(g.pitch, g.yaw, g.roll, "YXZ");
  client.crashed = g.crashed;
  client.refreshBasis();
  client.writeNetState(g.deform, g.parts);
  return client;
}

function looseParts(car: DeformableCar): number {
  const f = makeCarFrame(carLayout(car));
  car.readPartNetState(f.parts);
  return f.parts.flags.filter((x) => x & 1).length;
}

describe("given a network snapshot carrying the host's scene clear count (0..127) beside its keyframe flag", () => {
  it("when snapshots with clear counts 0, 1, 77 and 127 and mixed keyframe flags are written and read, then each count and flag comes back unchanged, a count of 0 being what an older host sends", () => {
    const testCases = [
      { clearGen: 0, keyframe: false },
      { clearGen: 1, keyframe: true },
      { clearGen: 77, keyframe: false },
      { clearGen: 127, keyframe: true },
    ] as const;
    for (const testCase of testCases) {
      const s = makeSnapshot();
      ensureFrames(s, 1, L);
      s.count = 1;
      s.keyframe = testCase.keyframe;
      s.clearGen = testCase.clearGen;
      const w = new Writer();
      writeSnapshot(w, s, L);
      const got = makeSnapshot();
      readSnapshot(new Reader().reset(w.done()), got, L);
      expect(got.clearGen, `clear count ${testCase.clearGen}`).toBe(testCase.clearGen);
      expect(got.keyframe, `keyframe flag beside clear count ${testCase.clearGen}`).toBe(testCase.keyframe);
    }
  });
});

describe("given a two-car network snapshot with every field filled in", () => {
  it("when it is written and read back, then everything matches within the quantization steps and the wreck section is left out when asked", () => {
    const s = makeSnapshot();
    ensureFrames(s, 2, L);
    s.seq = 70000;
    s.time = 12345.678;
    s.keyframe = true;
    s.count = 2;
    s.realism = 0.25;
    s.phase = 2;
    s.timeScale = 0.032;
    for (let c = 0; c < 2; c++) {
      const f = s.cars[c]!;
      // Car 0 a falling fake, car 1 vaporized with its sirens on: each flag must come back on its own car only.
      Object.assign(f, { x: 12.345 + c, y: 0.0123, z: -40.5, yaw: 3.1, pitch: -0.12, roll: 0.4, vx: 17.3, vy: -1.2, vz: -0.07, wy: 2.345, crashed: true, wreck: c === 0, falling: c === 0, vaporized: c === 1, sirens: c === 1, marked: c === 1, style: 4 + c, cls: 3 - c, meter: c === 0 ? 0.4 : -1, spin: c === 0 ? 12.37 : 0 });
      const d = f.deform;
      for (let i = 0; i < d.local.length; i++) d.local[i] = Math.sin(i * 1.7) * 2.2;
      for (let i = 0; i < d.skinPos.length; i++) d.skinPos[i] = Math.cos(i * 0.9) * 2.1;
      for (let i = 0; i < d.skinXf.length; i++) d.skinXf[i] = Math.sin(i) * 1.3;
      for (let i = 0; i < d.sensor.length; i++) d.sensor[i] = (i % 5) * 0.11;
      d.impact.set([0.3, 0.36, 2.1, 0, 0, -1, 0.07, 0.45, 0.4]);
      d.popped = (1 << 16) | (1 << 19);
      d.skinPopped = 1 << 16;
      d.flags = 1 | 2 | 8;
      d.engineTravel = 0.123;
      d.killTravel = 0.5;
      d.crush.set([0.008, 0, 0.0123, 0.4, 0.05]);
      d.crushBaked.set([0.008, 0, 0.012, 0.39, 0.05]);
      const p = f.parts;
      p.flags.set([1, 0, 2, 3, 5, 4, 1, 0]);
      for (let i = 0; i < p.hinge.length; i++) p.hinge[i] = (i % 3) * 0.37;
      p.lamps = 0b1010;
      p.glass = 0b10_01_00_10_01_00;
      p.wheelLoose = 0b0101;
      for (let i = 0; i < L.wheels; i++) p.wheels.set([-2.5 + i, 0.32, 9.75, 0, 0.7071068, 0, 0.7071068], i * 7);
    }
    const w = new Writer();
    writeSnapshot(w, s, L);
    const got = makeSnapshot();
    readSnapshot(new Reader().reset(w.done()), got, L);

    expect(got.seq).toBe(70000 & 0xffff);
    expect(got.time).toBe(12345.678);
    expect(got.keyframe).toBe(true);
    expect(got.count).toBe(2);
    expect(Math.abs(got.realism - 0.25)).toBeLessThanOrEqual(0.5 / 255);
    expect(got.phase).toBe(2);
    expect(Math.abs(got.timeScale - 0.032)).toBeLessThanOrEqual(0.5e-4);
    for (let c = 0; c < 2; c++) {
      const a = s.cars[c]!;
      const b = got.cars[c]!;
      expect(b.x).toBe(Math.fround(a.x));
      expect(b.z).toBe(Math.fround(a.z));
      expect(Math.abs(b.yaw - a.yaw)).toBeLessThanOrEqual(Q.fine / 2 + 1e-12);
      expect(Math.abs(b.roll - a.roll)).toBeLessThanOrEqual(Q.fine / 2 + 1e-12);
      expect(Math.abs(b.vx - a.vx)).toBeLessThanOrEqual(Q.vel / 2 + 1e-9);
      expect(Math.abs(b.wy - a.wy)).toBeLessThanOrEqual(Q.rate / 2 + 1e-9);
      expect(b.crashed).toBe(true);
      expect(b.style).toBe(a.style);
      expect(b.cls).toBe(a.cls);
      expect(b.wreck).toBe(c === 0);
      expect(b.falling).toBe(c === 0);
      expect(b.vaporized).toBe(c === 1);
      expect(b.sirens).toBe(c === 1);
      expect(b.marked).toBe(c === 1);
      if (c === 0) expect(Math.abs(b.meter - 0.4), `meter ${b.meter}`).toBeLessThanOrEqual(0.5 / 254);
      else expect(b.meter, "a car with no nitrous reads back as none").toBe(-1);
      expect(Math.abs(b.spin - a.spin), `spin ${b.spin}`).toBeLessThanOrEqual(0.125 + 1e-9);
    }
    const a = s.cars[0]!;
    const b = got.cars[0]!;
    assertSameNumbers(b.deform.local, a.deform.local, "particles within 0.25 mm", Q.pos / 2 + 1e-6);
    assertSameNumbers(b.deform.skinPos, a.deform.skinPos, "skinPos", Q.pos / 2 + 1e-6);
    assertSameNumbers(b.deform.skinXf, a.deform.skinXf, "skinXf", Q.xf / 2 + 1e-6);
    assertSameNumbers(b.deform.sensor, a.deform.sensor, "sensor", Q.fine / 2 + 1e-6);
    assertSameNumbers(b.deform.impact, a.deform.impact, "impact", Q.fine / 2 + 1e-6);
    expect(b.deform.popped).toBe(a.deform.popped);
    expect(b.deform.skinPopped).toBe(a.deform.skinPopped);
    expect(b.deform.flags).toBe(a.deform.flags);
    expect(Math.abs(b.deform.engineTravel - 0.123)).toBeLessThanOrEqual(Q.pos / 2 + 1e-6);
    expect(Math.abs(b.deform.killTravel - 0.5)).toBeLessThanOrEqual(Q.pos / 2 + 1e-6);
    assertSameNumbers(b.deform.crush, a.deform.crush, "face depths within 0.05 mm", Q.fine / 2 + 1e-6);
    assertSameNumbers(b.deform.crushBaked, a.deform.crushBaked, "crushBaked", Q.fine / 2 + 1e-6);
    assertSameNumbers(b.parts.flags, a.parts.flags, "part flags");
    assertSameNumbers(b.parts.hinge, a.parts.hinge, "hinge", Q.fine / 2 + 1e-6);
    expect(b.parts.lamps).toBe(a.parts.lamps);
    expect(b.parts.glass).toBe(a.parts.glass);
    expect(b.parts.wheelLoose).toBe(a.parts.wheelLoose);
    for (const i of [0, 2]) {
      for (let k = 0; k < 3; k++) expect(b.parts.wheels[i * 7 + k]).toBe(Math.fround(a.parts.wheels[i * 7 + k]!));
      for (let k = 3; k < 7; k++) expect(Math.abs(b.parts.wheels[i * 7 + k]! - a.parts.wheels[i * 7 + k]!)).toBeLessThanOrEqual(Q.quat);
    }
    // 17-byte header, 30-byte poses (body, meter, spin, pose), a 688-byte wreck (its impact block is 12 numbers of 2 bytes, its load crush 10, its paint's stroke count 1) with 20 more per loose wheel (2): a loose part's pose is not sent.
    expect(w.off).toBe(17 + 30 + (688 + 20 * 2) + 30);
  });
});

describe("given a host car whose driven wheels spin ahead of the body", () => {
  it("when its pose crosses the wire and a client car draws it, then the client's wheelspin is the host's within a wire step, and one past the byte's range reads as its top", () => {
    const host = makeCar();
    const layout = carLayout(host);
    const s = makeSnapshot();
    ensureFrames(s, 1, layout);
    s.count = 1;
    s.time = 5;
    const client = makeCar();
    const testCases = [
      { spin: 12.37, expected: 12.37 },
      { spin: 0, expected: 0 },
      { spin: 70, expected: 63.75 },
    ] as const;
    for (const testCase of testCases) {
      host.drive.spinSpeed = testCase.spin;
      readCarPose(host, s.cars[0]!);
      const w = new Writer();
      writeSnapshot(w, s, layout);
      const got = makeSnapshot();
      readSnapshot(new Reader().reset(w.done()), got, layout);
      drawSnapshots([got], [1], [], [client], 5, 1 / FRAME_HZ, { setVaporized: () => {}, clearScene: () => {} }, -1);
      expect(Math.abs(client.drive.spinSpeed - testCase.expected), `spin ${testCase.spin} drew as ${client.drive.spinSpeed}`).toBeLessThanOrEqual(0.125 + 1e-9);
    }
  });
});

describe("given 32 cars wrecked as far as a snapshot can carry: every part and wheel loose, every paint stroke used", () => {
  it("when they are written, then the snapshot is exactly the most bytes a snapshot is allowed to hold (the recorder sizes its fixed buffers from it)", () => {
    const s = makeSnapshot();
    ensureFrames(s, 32, L);
    s.count = 32;
    for (let c = 0; c < 32; c++) {
      const f = s.cars[c]!;
      Object.assign(f, { crashed: true, wreck: true, meter: 0.5 });
      f.parts.flags.fill(1);
      f.parts.wheelLoose = (1 << L.wheels) - 1;
      f.parts.scrapeCount = SCRAPE_MAX;
    }
    const w = new Writer();
    writeSnapshot(w, s, L);
    expect(w.off).toBe(snapshotMaxBytes(32, L));
  });
});

describe("given the network writer's 16-bit fixed-point numbers", () => {
  it("when values far outside the 16-bit range are written, then they clamp to its ends instead of wrapping", () => {
    const w = new Writer();
    w.q16(1e9, 1);
    w.q16(-1e9, 1);
    const r = new Reader().reset(w.done());
    expect(r.q16(1)).toBe(32767);
    expect(r.q16(1)).toBe(-32767);
  });
});

describe("given a drive input of throttle, steer, brake, handbrake and boost, sent with the peer's boost meter", () => {
  it("when it is written and read back, then each value and the meter come back within their quantization step", () => {
    const input = { throttle: -0.5, steer: 1, brake: 0.25, ebrake: true, boost: false };
    const w = new Writer();
    writeInput(w, input, 0, 0.6);
    const out = idleDrive();
    const meter = new Float64Array(1);
    readInput(new Reader().reset(w.done()), out, meter);
    expect(Math.abs(out.throttle - input.throttle)).toBeLessThan(1 / 127);
    expect(out.steer).toBe(1);
    expect(Math.abs(out.brake - 0.25)).toBeLessThan(1 / 255);
    expect(out.ebrake).toBe(true);
    expect(out.boost).toBe(false);
    expect(Math.abs(meter[0]! - 0.6), `meter ${meter[0]}`).toBeLessThan(1 / 254);
  });
});

describe("given a client car that applies the host car's state from the wire", () => {
  itModes("when the host hits a wall at 64 km/h with 40% overlap and the client applies its state, then the client's skin, cage, part states and graded engine damage match the host's", (mode) => {
    const host = makeCar(mode);
    // An arcade-end kill travel the client's default does not share: graded damage must come over the wire.
    host.deform.killTravel = 0.5;
    runWall(64, 0.4, "front", { car: host, after: 1.5 });
    expect(host.crashed && host.deform.massActive).toBeTruthy();
    const client = apply(makeCar(mode), wire(host));

    const hv = simSkin(host);
    const cv = simSkin(client);
    const rest = makeCar(mode).body.geometry.getAttribute("position").array;
    const dent = Array.from(hv, (v, i) => Math.abs(v - rest[i]!)).reduce((m, d) => Math.max(m, d), 0);
    expect(dent, `the host car is dented (${dent.toFixed(3)} m)`).toBeGreaterThan(0.05);
    // The client re-skins from the host's baked inputs; only quantization (≤ 0.25 mm per particle) separates them.
    assertSameNumbers(cv, hv, "skin vertices within 2 mm", 0.002);
    const tris = drawnTriangles(client);
    for (const wheel of [0, 1]) {
      if (client["looseWheels"][wheel]!.loose) continue;
      const clearance = tyreClearance(client, wheel, tris);
      expect(clearance, `the client's wheel ${wheel} stands ${(clearance * 1000).toFixed(1)} mm under its drawn hood`).toBeGreaterThanOrEqual(TYRE_CLEARANCE_M);
    }

    host.refitCage();
    client.refitCage();
    assertSameNumbers(client.cage.fields.planBox, host.cage.fields.planBox, "cage plan box within 1 mm", 0.001);

    const a = makeCarFrame(carLayout(host));
    const b = makeCarFrame(carLayout(host));
    host.readPartNetState(a.parts);
    client.readPartNetState(b.parts);
    assertSameNumbers(b.parts.flags, a.parts.flags, "part states identical");
    expect(b.parts.lamps).toBe(a.parts.lamps);
    expect(b.parts.glass).toBe(a.parts.glass);
    expect(client.deform.drivetrainAlive).toBe(host.deform.drivetrainAlive);
    expect(host.deform.drivetrainHealth, "the hit cost the engine some health").toBeLessThan(1);
    expect(Math.abs(client.deform.drivetrainHealth - host.deform.drivetrainHealth), "graded damage matches").toBeLessThan(0.01);
  });

  it("when the host's next wreck has a part back on that an earlier crash tore off, then the client re-attaches it", () => {
    const host = makeCar();
    runWall(72, 1, "front", { car: host, after: 1.5 });
    const client = apply(makeCar(), wire(host));
    expect(looseParts(client), "a 72 km/h wall hit tears a part off").toBeGreaterThan(0);
    expect(looseParts(client)).toBe(looseParts(host));

    host.resetVisual();
    host.crashed = false;
    runWall(24, 1, "front", { car: host, after: 1 });
    expect(host.crashed && looseParts(host) === 0).toBeTruthy();
    apply(client, wire(host));
    expect(looseParts(client)).toBe(0);
    assertSameNumbers(simSkin(client), simSkin(host), "skin vertices within 2 mm", 0.002);
  });

  // todo -> after the plan: recalibrate the off-centre wall hit's crush against the lever's spin. The 58 km/h rear corner hit tears no quarter
  // panel (0 of the 1 the test needs): the lever spins the car away, so the corner crushes less.
  todoRow("when a body panel is torn off and another hinged loose, then the client shows the same hole and shell, throws its own loose panel, and the next wreck clears them", true, () => {
    type Row = { name: string; detached: boolean; hingeT: number; pos: { x: number; y: number; z: number } };
    const panels = (c: DeformableCar) => (c.snapshot().parts as Row[]).filter((p) => /^(quarter|arch)/.test(p.name));
    const primer = (c: DeformableCar) => (c.body.geometry.getAttribute("primer").array as Float32Array).reduce((a, b) => a + b, 0);
    const host = makeCar();
    runWall(58, 0.3, "rear", { car: host, after: 1.5 });
    const client = apply(makeCar(), wire(host));
    const h = panels(host);
    const c = panels(client);
    expect(h.filter((p) => p.detached).length, "the 58 km/h rear corner hit tears one quarter panel").toBe(1);
    expect(h.some((p) => !p.detached && p.hingeT > 0.1), "and hinges another panel").toBeTruthy();
    for (const [i, p] of h.entries()) {
      expect(c[i]!.detached, `${p.name} torn on the client`).toBe(p.detached);
      expect(Math.abs(c[i]!.hingeT - p.hingeT), `${p.name} hinge ${c[i]!.hingeT} vs ${p.hingeT}`).toBeLessThan(1e-3);
      if (p.detached) expect(Math.hypot(c[i]!.pos.x - client.group.position.x, c[i]!.pos.y, c[i]!.pos.z - client.group.position.z), `${p.name} is loose in the client's own world, near its car (the host's pose is not sent: debris is per player)`).toBeLessThan(20);
    }
    expect(primer(host) > 20 && Math.abs(primer(client) - primer(host)) < 0.5, `primer under the panels: host ${primer(host)}, client ${primer(client)}`).toBeTruthy();

    host.resetVisual();
    host.crashed = false;
    runWall(24, 1, "front", { car: host, after: 1 });
    apply(client, wire(host));
    expect(panels(client).every((p) => !p.detached && p.hingeT === 0), "the next wreck has every panel on, flat").toBeTruthy();
    expect(primer(client)).toBe(0);
  });

  it("when a wheel is torn off on the host, then the client's wheel lies where the host's does, the client never throws one itself, and the next wreck has all four wheels on", () => {
    const host = makeCar();
    runWall(40, 1, "front", { car: host, after: 0.5 });
    host.deform.popHub(host.deform.masses.find((m) => m.name === "hubFL")!);
    for (let i = 0; i < 90; i++) {
      host.integrate(1 / FRAME_HZ);
      host.afterContacts(1 / FRAME_HZ);
    }
    const hostWheel = host.wheels[0]!.getWorldPosition(host.wheels[0]!.position.clone());
    expect(hostWheel.distanceTo(host.group.position), "the host's wheel left the car").toBeGreaterThan(0.5);

    const client = apply(makeCar(), wire(host));
    for (let i = 0; i < 30; i++) client.netFrame(1 / FRAME_HZ);
    const f = makeCarFrame(carLayout(client));
    client.readPartNetState(f.parts);
    expect(f.parts.wheelLoose, "only wheel 0 is loose").toBe(1);
    const clientWheel = client.wheels[0]!.getWorldPosition(client.wheels[0]!.position.clone());
    expect(clientWheel.distanceTo(hostWheel), `loose wheel within 1 mm (${clientWheel.distanceTo(hostWheel)})`).toBeLessThan(0.001);

    host.resetVisual();
    host.crashed = false;
    runWall(24, 1, "front", { car: host, after: 1 });
    apply(client, wire(host));
    client.readPartNetState(f.parts);
    expect(f.parts.wheelLoose, "the next wreck has all four wheels on").toBe(0);
  });
});

/** A pickup at the fleet's crumple settings, as the tyre-hood rows build it. */
function pickup(): DeformableCar {
  const car = buildCar("pickup", "truck");
  car.deform.squash = 0.32;
  car.deform.buckle = 0.45;
  return car;
}
/** How long (s) the head-on runs before the host's state is sent: its hood is crushed down onto its front tyres by then. */
const HEAD_ON_S = 1;
const HEAD_ON_MPS = 50 / 3.6;

describe("given a host pickup that met a second pickup head-on at 50 km/h, and a client that applies its state from the wire", () => {
  it("when the client draws it, then the sim's skin matches the host's, and the client's drawn hood stands over its own front tyres by the clearance (each peer holds the hood over its own drawn wheels)", () => {
    const host = pickup();
    const other = pickup();
    const w = makeWorld([host, other], false, false);
    w.pedals.set(host, FREEWHEEL);
    w.pedals.set(other, FREEWHEEL);
    launch(host, -5, 0, Math.PI / 2, HEAD_ON_MPS, 0);
    launch(other, 5, 0, -Math.PI / 2, -HEAD_ON_MPS, 0);
    for (let f = 0; f < HEAD_ON_S * FRAME_HZ; f++) tickWorld(w, 1 / FRAME_HZ);
    host.updateSkin();
    const client = apply(pickup(), wire(host));
    assertSameNumbers(simSkin(client), simSkin(host), "skin vertices within 2 mm", 0.002);
    const tris = drawnTriangles(client);
    let kept = 0;
    for (const wheel of [0, 1]) {
      if (client["looseWheels"][wheel]!.loose) continue;
      kept++;
      const clearance = tyreClearance(client, wheel, tris);
      expect(clearance, `the client's wheel ${wheel} stands ${(clearance * 1000).toFixed(1)} mm under its drawn hood`).toBeGreaterThanOrEqual(TYRE_CLEARANCE_M);
    }
    expect(kept, "no front wheel kept: the row proves nothing").toBeGreaterThan(0);
  });
});

describe("given a host wreck the epicenter freeze holds (the activation on) and a client that applies its state from the wire", () => {
  it("when the host hits a wall at 64 km/h and sits 9 s, then the client's skin, cage and engine damage match the host's, as for a wreck that never froze", () => {
    const saved = epicenterValues();
    try {
      loadEpicenter(EPICENTER_AT_LOAD);
      EPICENTER.on = 1;
      const host = makeCar();
      host.deform.killTravel = 0.5;
      runWall(64, 0.4, "front", { car: host, after: 9 });
      expect(host.crashed && host.deform.massActive && host.deform.frozen, "the host wreck is frozen: the row proves nothing otherwise").toBeTruthy();
      const client = apply(makeCar(), wire(host));
      const hv = simSkin(host);
      const cv = simSkin(client);
      assertSameNumbers(cv, hv, "skin vertices within 2 mm", 0.002);
      host.refitCage();
      client.refitCage();
      assertSameNumbers(client.cage.fields.planBox, host.cage.fields.planBox, "cage plan box within 1 mm", 0.001);
      expect(Math.abs(client.deform.drivetrainHealth - host.deform.drivetrainHealth), "graded damage matches").toBeLessThan(0.01);
    } finally {
      loadEpicenter(saved);
    }
  });
});

describe("given a derby match played on the host and sent to clients as derby state", () => {
  /** A match on the host after `steps` 1 s steps: car 1 scored on car 2, car 2's engine died, car 3 never moves. */
  function playedMatch(steps: number): DerbyMatch {
    const m = new DerbyMatch();
    m.begin(
      [0, 1, 2, 3].map((id) => ({ id, name: id === 2 ? "Player 2" : `Car ${id}` })),
      { radius: 18.5, hitClock: 20, start: 0 },
    );
    const moving = (id: number, t: number) => ({ id, name: "", alive: true, x: id === 3 ? 0 : 5 * Math.sin(t + id), z: 0 });
    for (let t = 1; t <= steps; t++) {
      if (t === 2) expect(m.noteHit(1, 2, 6, 0.5, 6), "a hard hit is a contact").toBeTruthy();
      m.step(1, [0, 1, 2, 3].map((id) => ({ ...moving(id, t), alive: !(id === 2 && t >= 3) })));
    }
    return m;
  }

  function netState(m: DerbyMatch, round: number, lobby: number | null): DerbyNetState {
    return { round, active: m.active, time: m.time, hold: m.hold, radius: 18.5, winnerId: m.winnerId, winnerName: m.winnerName, decided: m.decided, lobby, seats: 1 << 2, board: m.board };
  }

  function wire(s: DerbyNetState): DerbyNetState {
    const w = new Writer();
    writeDerby(w, s);
    return readDerby(new Reader().reset(w.done()));
  }

  it("when a running match is sent over the wire, then scores, hits, disables, alive flags, count-out clocks and seats all come back", () => {
    const m = playedMatch(10);
    const s = netState(m, 70001, null);
    expect(m.winnerId, "still running after 10 s").toBe(null);
    expect(m.board.find((r) => r.id === 1)!.score > 0 && !m.board.find((r) => r.id === 2)!.alive, "the host's board moved").toBeTruthy();
    const got = wire(s);
    expect(got.round).toBe(70001 & 0xffff);
    expect(got.active).toBe(true);
    expect(got.lobby).toBe(null);
    expect(got.seats).toBe(1 << 2);
    expect(got.winnerId).toBe(null);
    expect(got.decided).toBe(null);
    expect(Math.abs(got.time - s.time) < 1e-5 && Math.abs(got.radius - 18.5) < 1e-5).toBeTruthy();
    expect(got.board.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      const [a, b] = [s.board[i]!, got.board[i]!];
      assertSameDigest({ ...b, clock: 0 }, { ...a, clock: 0 }, `row ${a.id}`);
      expect(Math.abs(b.clock - a.clock), `row ${a.id} clock ${a.clock} → ${b.clock}`).toBeLessThanOrEqual(0.05);
    }
  });

  it("when a decided match and a lobby are sent over the wire, then the winner and how he won come back, and the lobby comes back with its countdown and no match", () => {
    // Car 3 never moves: hitClock 20 s counts every idle car out, the last standing wins.
    const m = playedMatch(25);
    expect(m.winnerId, "decided within 25 s").not.toBe(null);
    const got = wire(netState(m, 3, null));
    expect(got.winnerId).toBe(m.winnerId);
    expect(got.winnerName).toBe(m.winnerName);
    expect(got.decided).toBe(m.decided);
    assertSameDigest(
      got.board.map((r) => [r.id, r.score, r.alive, r.out]),
      m.board.map((r) => [r.id, r.score, r.alive, r.out]),
      "board",
    );

    const lobby = new DerbyMatch();
    const l = wire(netState(lobby, 4, 12.5));
    expect(l.active).toBe(false);
    expect(l.lobby).toBe(12.5);
    expect(l.board).toHaveLength(0);
  });
});

describe("given snapshots and derby boards of values a host never sends", () => {
  /** A 2-car snapshot written with `edit` applied, then read back. */
  function readBack(edit: (s: Snapshot) => void): () => void {
    const s = makeSnapshot();
    ensureFrames(s, 2, L);
    s.count = 2;
    s.time = 1;
    for (const f of s.cars) {
      f.crashed = true;
      f.wreck = true;
      f.parts.flags[0] = 1;
    }
    edit(s);
    const w = new Writer(1 << 17);
    writeSnapshot(w, s, L);
    return () => readSnapshot(new Reader().reset(w.done()), makeSnapshot(), L);
  }

  it("when a well-formed snapshot is read, then it is accepted", () => {
    readBack(() => {})();
  });

  it("when the snapshot has an empty or oversized field or a non-finite clock or pose, then reading refuses it as a RangeError", () => {
    expect(readBack((s) => (s.count = 0))).toThrow(RangeError);
    expect(readBack((s) => {
        ensureFrames(s, 33, L);
        s.count = 33;
      })).toThrow(RangeError);
    expect(readBack((s) => (s.time = Number.NaN))).toThrow(RangeError);
    expect(readBack((s) => (s.cars[1]!.z = Number.POSITIVE_INFINITY))).toThrow(RangeError);
  });

  it("when a derby board is larger than any field, names a winner outside it, or has a non-finite clock or bowl, then reading refuses it as a RangeError, and a well-formed board reads fine", () => {
    const base: DerbyNetState = { round: 1, active: true, time: 3, hold: 0, radius: 18, winnerId: null, winnerName: null, decided: null, lobby: null, seats: 0, board: [] };
    const row = (id: number) => ({ id, name: `Car ${id}`, score: 0, hits: 0, disables: 0, alive: true, out: false, clock: 60 });
    const read = (s: DerbyNetState) => () => {
      const w = new Writer(1 << 15);
      writeDerby(w, s);
      return readDerby(new Reader().reset(w.done()));
    };
    read({ ...base, board: [row(0), row(1)] })();
    expect(read({ ...base, board: Array.from({ length: 33 }, (_, i) => row(i)) })).toThrow(RangeError);
    expect(read({ ...base, board: [row(0)], winnerId: 40, winnerName: "x", decided: "wreck" })).toThrow(RangeError);
    expect(read({ ...base, radius: Number.NaN })).toThrow(RangeError);
    expect(read({ ...base, time: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });
});

describe("given a host car whose paint a slide scratched, and nothing else: not crashed, no load crush", () => {
  it("when its snapshots cross the wire and a client draws them, then the client's strokes are the host's byte for byte, and once the host repairs the car the client's are gone", () => {
    const host = makeCar();
    const client = makeCar();
    host.spawnFacing(0, 0, 0, 0);
    client.spawnFacing(0, 0, 0, 0);
    const inward = new THREE.Vector3(1, 0, 0);
    const slide = new THREE.Vector3(0, 0, 8);
    for (const z of [-1, -0.4]) {
      host.scrape(new THREE.Vector3(-0.85, 0.5, z), inward, slide, 0.3, 3, 1);
      host.scratches.slice(0.25);
    }
    host.scratches.slice(0.25);
    expect(host.scratches.count > 0 && !host.crashed && !host.deform.loadCrushed(), "the control: scratched only").toBeTruthy();
    const layout = carLayout(host);
    // The host's frame as `NetPlay.hostFrame` builds it: a crashed or marked car sends its wreck section.
    const hostSnapshot = (time: number): Snapshot => {
      const s = makeSnapshot();
      ensureFrames(s, 1, layout);
      s.count = 1;
      s.time = time;
      const f = s.cars[0]!;
      readCarPose(host, f);
      f.wreck = f.crashed || f.marked;
      if (f.wreck) {
        host.deform.readNetState(f.deform);
        host.readPartNetState(f.parts);
      }
      const w = new Writer();
      writeSnapshot(w, s, layout);
      const got = makeSnapshot();
      readSnapshot(new Reader().reset(w.done()), got, layout);
      return got;
    };
    const game = { setVaporized: () => {}, clearScene: () => {} };
    const applied: number[] = [];
    drawSnapshots([hostSnapshot(5)], [1], applied, [client], 5, 1 / FRAME_HZ, game, -1);
    expect(client.scratches.count, "the client's stroke count").toBe(host.scratches.count);
    expect(firstMismatch(client.scratches.list, host.scratches.list), "the client's stroke bytes").toBeUndefined();
    host.spawnFacing(0, 0, 0, 0);
    drawSnapshots([hostSnapshot(6)], [2], applied, [client], 6, 1 / FRAME_HZ, game, -1);
    expect(client.scratches.count, "repaired on the client").toBe(0);
  });
});
