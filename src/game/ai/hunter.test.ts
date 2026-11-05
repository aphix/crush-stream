import { describe, expect, it } from "vitest";
import { physicsSlice } from "../contact/sat.ts";
import * as THREE from "three";
import { DRIVE, idleDrive } from "../vehicle/car-drive.ts";
import { applyAiDrive } from "./input-fade.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { snapshotAiCar } from "../match/derby.ts";
import { aggression, BLOCKABLE, CALM_END, copsWanted, HUNT, RAM_AFTER, RAMP, RUN_UP, SETTLE } from "./hunter.ts";
import { humanSlot } from "../match/survival.ts";
import { ATTACK, attackTarget } from "./cop-brain.ts";
import { setGround } from "../world/ground.ts";
import type { PropCollider } from "../world/placements.ts";
import { blankProjection, projectPath } from "../world/track.ts";
import { FINE_HZ, FRAME_HZ } from "../kernel/constants.ts";
import { BEAT, FAR, rig, spec, track } from "./hunter-rig.test-util.ts";
import { atFullAggression, onRamp } from "./ramp.test-util.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { turnRate } from "./race-ai.ts";
import { assignClass, classStats } from "../vehicle/vehicle-classes.ts";
import { SURFACES } from "../world/catalog.ts";

// The rows below pin the pack at full aggression (the end of the ramp, today's pack from the green); the ramp's own rows call `onRamp`.
atFullAggression();

describe("given the Survival schedule of how many cops are wanted as the heat goes on, with a starting formation of cops", () => {
  it("when the wanted count is read at different times, then it starts at the formation size, grows by one every 12 s, stops at the cap of 12 and adds nothing before the green", () => {
    const n = spec.formation.length;
    expect(copsWanted(0, n)).toBe(n);
    expect(copsWanted(HUNT.every - 0.01, n)).toBe(n);
    expect(copsWanted(HUNT.every, n)).toBe(n + 1);
    expect(copsWanted(HUNT.every * 3 + 1, n)).toBe(n + 3);
    expect(copsWanted(10_000, n)).toBe(HUNT.cap);
    expect(copsWanted(-5, n), "before the green nothing is added").toBe(n);
  });
});

describe("given Survival's aggression a(t), the pack's meanness as one number a run reads from the green", () => {
  it("when a is read before the green and up to 30 s in, then it is 0.25, from there it eases in cubically to 1 at 90 s and stays there", () => {
    onRamp();
    const floor = aggression(0);
    expect(floor).toBe(0.25);
    for (const t of [-5, 0, 15, 30]) expect(aggression(t), `at ${t} s`).toBe(floor);
    expect(aggression(60), "half way along the ramp it has gone an eighth of the way up").toBeCloseTo(0.25 + 0.75 / 8, 12);
    expect(aggression(90)).toBe(1);
    expect(aggression(500)).toBe(1);
    let last = floor;
    for (let t = 31; t <= 90; t++) {
      expect(aggression(t), `at ${t} s`).toBeGreaterThan(last);
      last = aggression(t);
    }
  });

  it("when the wanted count is read on the ramp, then no cop is added in the first 48 s, the schedule's steps are a of the full ones after that, and the cap is met at 90 s", () => {
    onRamp();
    const n = spec.formation.length;
    const added = (t: number): number => copsWanted(t, n) - n;
    expect([0, 12, 24, 36, 47.9].map(added)).toEqual([0, 0, 0, 0, 0]);
    expect([48, 60, 72, 84].map(added)).toEqual([1, 1, 3, 5]);
    expect(copsWanted(90, n)).toBe(HUNT.cap);
    expect(copsWanted(-5, n), "before the green nothing is added").toBe(n);
  });

  it("when the pack hunts a human on the ramp, then at the green ceil(a × units) of the units seek a hit, and at the top every unit does", () => {
    onRamp();
    const r = rig();
    const seeking = (): number => r.brain["seeks"].reduce((n, s) => n + s, 0);
    r.run(1);
    expect(r.brain.hunting).toBe(spec.formation.length);
    expect(seeking(), "units seeking at the green").toBe(Math.ceil(RAMP.floor * spec.formation.length));
    r.run(100);
    expect(r.brain.hunting, "the pack at the cap").toBe(HUNT.cap);
    expect(seeking(), "units seeking at the top").toBe(HUNT.cap);
  });

  it("when the formation goes in on the ramp, then the units that do not seek a hit fly the opening at full aggression (a closing speed the floor's cap brakes for is driven straight on), and once the opening is over they follow a(t)", () => {
    onRamp();
    const r = rig();
    r.run(5);
    const flyers = [...r.brain["flies"]].flatMap((f, u) => (f === 1 ? [u] : []));
    expect(flyers.length, "the formation's units that do not seek a hit").toBe(spec.formation.length - Math.ceil(RAMP.floor * spec.formation.length));
    expect(
      flyers.some((u) => r.brain["seeks"][u] === 1),
      "a unit that seeks a hit flies",
    ).toBe(false);
    const u = flyers[0]!;
    const closeOn = (): { throttle: number; brake: number } => {
      Object.assign(r.cars[0]!, { x: 0, z: PASEO + 11, vx: 0, vz: 12 });
      Object.assign(r.cars[1 + u]!, { x: 3, z: PASEO, yaw: 0, vx: 0, vz: 32 });
      let o = r.brain.think(r.cars[1 + u]!, r.cars, 1 / FRAME_HZ);
      for (let k = 0; k < FRAME_HZ; k++) o = r.brain.think(r.cars[1 + u]!, r.cars, 1 / FRAME_HZ);
      return { throttle: o.throttle, brake: o.brake };
    };
    const flying = closeOn();
    expect(flying.throttle, "a flyer lifted for a hit in the opening").toBe(1);
    expect(flying.brake, "a flyer braked for a hit in the opening").toBe(0);
    r.run(HUNT.opening + 1);
    expect(closeOn().brake, "a unit still flew after the opening").toBe(1);
  });
});

describe("given the Survival hunter pack (the cops that chase the player) on a stub world, the player on the start line and the cops in their start formation", () => {
  it("when the heat is set up before the green, then the cops launch onto their formation slots with nothing dropped in yet and are held on the brake", () => {
    const r = rig();
    expect(r.brain.hunting).toBe(spec.formation.length);
    const slots = r.drops.slice(0, spec.formation.length);
    for (const [k, f] of spec.formation.entries()) {
      expect(Math.abs(slots[k]!.x - f.x) < 1e-9 && Math.abs(slots[k]!.z - f.z) < 1e-9 && slots[k]!.id === 1 + k, `slot ${k}`).toBeTruthy();
    }
    expect(r.drops.length, "nothing dropped in before the green").toBe(spec.formation.length);
    const out = r.brain.think(r.cars[1]!, r.cars, 1 / FRAME_HZ);
    expect(firstMismatch([out.throttle, out.brake], [0, 1]), "held on the brake until the green").toBeUndefined();
  });

  it("when 300 s pass with the cops driving to the player and waiting beside it, then one more cop drops in every 12 s up to the cap and never past it, and halfway through each interval the pack has what the schedule wants", () => {
    const r = rig();
    const n = spec.formation.length;
    const mid = new Set([6, 18, 30, 42, 66, 90, 294]);
    r.run(300, (t) => {
      // The cops drive at the player (30 m/s) and wait beside it, so their drop-in spots are free again.
      for (const c of r.cars.slice(1)) {
        const d = Math.hypot(r.cars[0]!.x - c.x, r.cars[0]!.z - c.z);
        if (c.x === FAR || d < 15) continue;
        c.x += ((r.cars[0]!.x - c.x) / d) * 30 * BEAT;
        c.z += ((r.cars[0]!.z - c.z) / d) * 30 * BEAT;
      }
      expect(r.brain.hunting, `${r.brain.hunting} hunting at ${t}`).toBeLessThanOrEqual(HUNT.cap);
      // Halfway through an interval the pack has what the schedule wants.
      if (mid.has(t)) expect(r.brain.hunting, `at ${t} s`).toBe(copsWanted(t, n));
    });
    expect(r.brain.hunting, "at the cap").toBe(HUNT.cap);
    expect(r.brain.stats.peak).toBe(HUNT.cap);
    expect(r.brain.stats.drops).toBe(HUNT.cap - n);
  });

  it("when the camera sees every spot, then no cop drops in, and when only the far end of the road is hidden, then every drop lands on a hidden spot", () => {
    const blind = rig({ hidden: () => false });
    blind.run(120);
    expect(blind.brain.stats.drops, "dropped in view").toBe(0);
    expect(blind.asked.length > 0 && blind.asked.length <= (120 / BEAT) * HUNT.tests, "it did look for a spot").toBeTruthy();

    // Only the far end of the boulevard is hidden.
    const r = rig({ hidden: (_x, z) => z > 300 });
    r.run(60);
    expect(r.brain.stats.drops, `${r.brain.stats.drops} drops`).toBeGreaterThanOrEqual(3);
    for (const d of r.drops.slice(spec.formation.length)) expect(d.z, `a cop dropped in at z ${d.z.toFixed(0)}, which the camera sees`).toBeGreaterThan(300);
  });

  it("when cops drop in over 80 s, then each lands on a road, 70-120 m from the player and 12 m clear of every car, facing along the road toward the player", () => {
    const r = rig();
    r.run(80);
    const proj = blankProjection();
    const target = r.cars[0]!;
    const fresh = r.drops.slice(spec.formation.length);
    expect(fresh.length).toBeGreaterThanOrEqual(4);
    for (const d of fresh) {
      const off = Math.sqrt(Math.min(...track.paths().map((p) => projectPath(p, d.x, d.z, -1, proj).dist2)));
      expect(off, `${off.toFixed(1)} m off every road`).toBeLessThan(1.5);
      const dist = Math.hypot(d.x - target.x, d.z - target.z);
      expect(dist >= HUNT.dropMin - 1e-6 && dist <= HUNT.dropMax + 1e-6, `${dist.toFixed(0)} m from the player`).toBeTruthy();
      // Facing: the nose has a positive component toward the player.
      expect(Math.sin(d.yaw) * (target.x - d.x) + Math.cos(d.yaw) * (target.z - d.z), "facing away from the player").toBeGreaterThan(0);
      expect(d.room, `${d.room.toFixed(1)} m from the nearest car`).toBeGreaterThanOrEqual(HUNT.clear);
    }
  });

  it("when the player drives at 30 m/s and the next cop drops in, then it lands ahead of the player's direction of travel", () => {
    const r = rig();
    // The player drives at 30 m/s toward the hill: ahead is -z.
    Object.assign(r.cars[0]!, { z: 300, vx: 0, vz: -30, yaw: Math.PI });
    r.run(HUNT.every + 3);
    const drop = r.drops[spec.formation.length];
    expect(drop, "no drop").toBeTruthy();
    const d = Math.hypot(drop.x, drop.z - 300);
    expect((drop.z - 300) * -1, `dropped at z ${drop.z.toFixed(0)}, not ahead of a player heading -z from 300`).toBeGreaterThan(d * 0.3);
  });

  it("when the player drives straight at a drop-in spot at 16 or 30 m/s, then every seed drops a cop in and at the frame it shows it is still at least 70 m from the player", (t) => {
    for (const v of [16, 30]) {
      const near = approach(v);
      const worst = near.length > 0 ? near.reduce((a, b) => (b.near < a.near ? b : a)) : null;
      t.annotate(`${v} m/s: ${near.length} of ${SEEDS} seeds dropped in; nearest judged ${Math.min(...near.map((n) => n.judged)).toFixed(3)} m, nearest at the show ${worst?.near.toFixed(3)} m`);
      expect(near.length, `${v} m/s: ${SEEDS - near.length} seeds never dropped in`).toBe(SEEDS);
      expect(worst!.near, `${v} m/s: seed ${worst!.seed} judged its spot ${worst!.judged.toFixed(3)} m off, and the player was ${worst!.near.toFixed(3)} m from it as the cop showed`).toBeGreaterThanOrEqual(HUNT.dropMin - 1e-6);
    }
  });

  it("when drop-in spots are judged only where the cop is placed, with no allowance for the player driving on, then at 16 and 30 m/s some cop shows closer than 70 m to the player", (t) => {
    const lag = Reflect.get(HUNT, "lag");
    Reflect.set(HUNT, "lag", 0);
    try {
      for (const v of [16, 30]) {
        const near = approach(v);
        t.annotate(`${v} m/s: ${near.filter((n) => n.near < HUNT.dropMin).length} of ${near.length} drop-ins inside the minimum at the show, nearest ${Math.min(...near.map((n) => n.near)).toFixed(3)} m`);
        expect(near.some((n) => n.near < HUNT.dropMin), `${v} m/s: no seed dropped a cop inside the minimum`).toBeTruthy();
      }
    } finally {
      Reflect.set(HUNT, "lag", lag);
    }
  });

  it("when a cop is wrecked, then it is put away only after 6 s and only once nobody can see it, and a replacement drops in so the pack is back to what the schedule wants", () => {
    let visible = true;
    const r = rig({ hidden: () => !visible });
    // Let the pack grow to a sixth cop first: the drop needs a hidden spot too.
    visible = false;
    r.run(HUNT.every + 3);
    visible = true;
    const before = r.brain.hunting;
    r.down.add(2);
    r.run(r.now() + HUNT.wreckStore + 10);
    expect(r.stored.filter((s) => s.id === 2).length, "put away in view").toBe(0);
    visible = false;
    const t0 = r.now();
    r.run(t0 + 1);
    expect(r.stored.filter((s) => s.id === 2).length, "not put away once unseen").toBe(1);
    expect(r.stored[0]!.t - t0 >= 0 && r.stored[0]!.t - t0 < 1).toBeTruthy();
    r.run(r.now() + 6);
    expect(before).toBeGreaterThanOrEqual(spec.formation.length + 1);
    expect(r.brain.hunting, "the pack is back to what the schedule wants").toBe(copsWanted(r.now(), spec.formation.length));
    expect(r.brain.stats.disabled).toBe(1);
    // Hidden from the start: still not before wreckStore.
    const q = rig();
    q.down.add(3);
    q.run(HUNT.wreckStore - 1);
    expect(q.stored.length, "put away early").toBe(0);
    q.run(HUNT.wreckStore + 1);
    expect(q.stored.filter((s) => s.id === 3).length).toBe(1);
  });

  it("when a cop's car is crashed with a live drivetrain, then the pack counts it down as a wrecked one: put away once unseen after 6 s, and a replacement drops in", () => {
    const r = rig();
    r.run(1);
    const cop = r.cars.find((c) => c.id > 0 && c.x !== FAR)!;
    const t0 = r.now();
    cop.crashed = true;
    r.run(t0 + HUNT.gap + BEAT);
    expect(r.drops.some((d) => d.t >= t0 && d.id !== cop.id), "no cop dropped in for the crashed one").toBeTruthy();
    r.run(r.now() + HUNT.wreckStore + HUNT.gap + 1);
    expect(r.stored.filter((s) => s.id === cop.id).length, "the crashed cop put away").toBe(1);
    expect(r.brain.hunting, "the pack is back to what the schedule wants").toBe(copsWanted(r.now(), spec.formation.length));
    expect(r.brain.stats.disabled).toBe(1);
  });

  it("when a cop is lost far from the player, then it is put away after 5 s out of sight and never while seen, and another cop drops in to take its place", () => {
    let visible = false;
    const r = rig({ hidden: () => !visible });
    r.cars[3]!.x = 0;
    r.cars[3]!.z = spec.start.z - HUNT.far - 30;
    const hold = (): void => {
      r.cars[3]!.x = 0;
      r.cars[3]!.z = spec.start.z - HUNT.far - 30;
    };
    visible = true;
    r.run(HUNT.farTime + 4, hold);
    expect(r.stored.length, "put away in view").toBe(0);
    visible = false;
    const t0 = r.now();
    r.run(t0 + HUNT.farTime + 1, hold);
    expect(r.stored.filter((s) => s.id === 3).length).toBe(1);
    expect(r.stored[0]!.t - t0, `put away after ${(r.stored[0]!.t - t0).toFixed(2)} s`).toBeGreaterThanOrEqual(HUNT.farTime - BEAT);
    expect(r.brain.stats.despawns).toBe(1);
    const storedAt = r.stored[0]!.t;
    r.run(r.now() + 4);
    expect(r.drops.some((d) => d.id === 3 && d.t >= storedAt && d.t < storedAt + 2), "no cop took its place").toBeTruthy();
    expect(r.brain.hunting).toBe(copsWanted(r.now(), spec.formation.length));
  });
});

/** A flat paved stretch of Havana (the paseo) running along +z: the hunter reads the crests and the grip of the ground it drives on. */
const PASEO = -200;

describe("given one cop on the paseo facing +z, driven by the hunter brain, with its target ahead", () => {
  /** One cop on the paseo facing +z, its quarry `dist` m ahead, optionally behind a wall of `hx` × `hz` m `wall.z` m ahead. */
  function drive(dist: number, wall?: { hx: number; hz: number; z: number }) {
    const colliders: PropCollider[] = wall
      ? [{ index: 0, prefab: "building", body: "solid", x: 0, z: PASEO + wall.z, yaw: 0, kind: "box", r: Math.hypot(wall.hx, wall.hz), hx: wall.hx, hz: wall.hz, mass: 0, base: 0, top: 14, ends: 3 }]
      : [];
    const r = rig({ colliders });
    r.run(0.25);
    const cop = r.cars[1]!;
    const tg = r.cars[0]!;
    Object.assign(cop, { x: 0, z: PASEO, yaw: 0, vx: 0, vz: 12 });
    Object.assign(tg, { x: 0, z: PASEO + dist, yaw: 0, vx: 0, vz: 0 });
    return { r, cop, tg, out: () => r.brain.think(cop, r.cars, 1 / FRAME_HZ) };
  }

  it("when the heat is before the green and then the green comes, then the cop is held on the brake until the green and drives once it comes", () => {
    const r = rig();
    Object.assign(r.cars[1]!, { x: 0, z: PASEO, yaw: 0, vx: 0, vz: 10 });
    Object.assign(r.cars[0]!, { x: 0, z: PASEO + 100 });
    expect(r.brain.think(r.cars[1]!, r.cars, 1 / FRAME_HZ).brake).toBe(1);
    r.run(0.25);
    let out = r.brain.think(r.cars[1]!, r.cars, 1 / FRAME_HZ);
    for (let k = 0; k < FRAME_HZ / 2; k++) out = r.brain.think(r.cars[1]!, r.cars, 1 / FRAME_HZ);
    expect(firstMismatch([out.brake, out.throttle], [0, 1])).toBeUndefined();
  });

  it("when the target is 100 m ahead in the open, then the cop chases at full throttle with a catch-up boost, steering straight at it", () => {
    const d = drive(100);
    const o = d.out();
    expect(o.throttle).toBe(1);
    expect(o.boost, "no catch-up boost 100 m behind").toBeTruthy();
    expect(Math.abs(o.steer), `steer ${o.steer}`).toBeLessThan(0.05);
  });

  it("when its car is crashed with a live drivetrain, then the cop gives no throttle and holds the brake, and it chases again once the car is not crashed", () => {
    const d = drive(100);
    Object.assign(d.cop, { crashed: true, alive: true });
    const o = d.out();
    expect(firstMismatch([o.throttle, o.brake, o.boost], [0, 1, false])).toBeUndefined();
    d.cop.crashed = false;
    let again = d.out();
    for (let k = 0; k < FRAME_HZ / 2; k++) again = d.out();
    expect(again.throttle).toBe(1);
  });

  it("when a solid wall stands between it and the target, then the cop bends round the wall and keeps to the side it chose on the next call, and without the wall it steers straight", () => {
    const wall = { hx: 15, hz: 7, z: 20 };
    const free = drive(100).out().steer;
    const walled = drive(100, wall);
    const o = walled.out();
    expect(Math.abs(free)).toBeLessThan(0.05);
    expect(Math.abs(o.steer), `steer ${o.steer} with a wall dead ahead`).toBeGreaterThan(0.3);
    // And it keeps to the side it chose on the next call (no dither).
    expect(Math.sign(walled.out().steer)).toBe(Math.sign(o.steer));
  });

  it("when a mate lies stopped on its line 12 m ahead at 20 m/s, then the cop brakes for it if it is knocked out, and a mate that is driving (it may be pulling out) is not braked for as hard", () => {
    const brakeFor = (down: boolean) => {
      const r = rig();
      if (down) r.down.add(2);
      r.run(0.5);
      Object.assign(r.cars[1]!, { x: 0, z: PASEO, yaw: 0, vx: 0, vz: 20 });
      Object.assign(r.cars[0]!, { x: 0, z: PASEO + 100, yaw: 0, vx: 0, vz: 0 });
      Object.assign(r.cars[2]!, { x: 0, z: PASEO + 12, yaw: 0, vx: 0, vz: 0 });
      r.run(0.75);
      Object.assign(r.cars[1]!, { x: 0, z: PASEO, yaw: 0, vx: 0, vz: 20 });
      Object.assign(r.cars[2]!, { x: 0, z: PASEO + 12, yaw: 0, vx: 0, vz: 0 });
      return r.brain.think(r.cars[1]!, r.cars, 1 / FRAME_HZ).brake;
    };
    expect(brakeFor(true), "drove on into a wreck").toBeGreaterThan(0.5);
    expect(brakeFor(false)).toBeLessThan(brakeFor(true));
  });

  it(`when the target is inside the ${ATTACK} m attack range, then the cop drives exactly as the police's own attack driving does`, () => {
    const d = drive(ATTACK - 10);
    const got = { ...d.out() };
    const want = idleDrive();
    want.brake = 0;
    attackTarget(d.cop, d.tg, 0, turnRate(classStats("sedan"), 12, SURFACES.asphalt), 12, ATTACK - 10, false, want, false);
    expect(got.throttle).toBe(want.throttle);
    expect(got.brake).toBe(want.brake);
    expect(got.boost).toBe(want.boost);
    expect(got.steer).toBe(want.steer);
  });

  it("when it holds the throttle with no motion for longer than the wedge window, then it backs off, as the police do", () => {
    const d = drive(100);
    // Throttle held, no motion, for longer than the wedge window.
    Object.assign(d.cop, { vx: 0, vz: 0 });
    let reversed = false;
    for (let i = 0; i < 60 * 3 && !reversed; i++) reversed = d.out().throttle < 0;
    expect(reversed, "never backed off").toBeTruthy();
  });

  it("when it holds full throttle against a wall corner for 3 s with its measured speed stuck at 1.5 m/s while it barely moves, then it still backs off", () => {
    const d = drive(100);
    let reversed = false;
    // The contact takes the displacement back each step, so the velocity the brain reads stays at 1.5 m/s: the car moves 0.3 m in 3 s.
    for (let i = 0; i < 60 * 3 && !reversed; i++) {
      Object.assign(d.cop, { vx: 0, vz: 1.5, z: d.cop.z + 0.1 / 60 });
      reversed = d.out().throttle < 0;
    }
    expect(reversed, "a car pushing a wall for 3 s without moving never backed off").toBeTruthy();
  });

  it("when it sits 4 m behind and 2.6 m beside a target at the target's own speed, then at 30 m/s it holds its row instead of closing up and at 10 m/s it presses on with its PIT (the nudge that spins the target out)", () => {
    // The cop 4 m behind the target and 2.6 m to one side, at the target's own speed: inside the first row (6 m).
    const fast = drive(4);
    Object.assign(fast.tg, { x: 0, z: PASEO + 4, vx: 0, vz: 30 });
    Object.assign(fast.cop, { x: 2.6, z: PASEO, vx: 0, vz: 30 });
    const held = { ...fast.out() };
    expect(held.throttle, "closed up on a fast target it was already inside the row of").toBe(0);
    expect(held.brake, "did not ease back to its row").toBeGreaterThan(0);
    const slow = drive(4);
    Object.assign(slow.tg, { x: 0, z: PASEO + 4, vx: 0, vz: 10 });
    Object.assign(slow.cop, { x: 2.6, z: PASEO, vx: 0, vz: 10 });
    const pit = { ...slow.out() };
    expect(pit.throttle, "did not press its PIT on a slow target").toBe(1);
  });

  it("when it closes at 20 m/s on a stopped target 13 m ahead, then it brakes fully without steering, in the target's lane and one lane over", () => {
    // A stopped target 13 m ahead, the cop at 20 m/s: 20² > 16 × 13.
    const inLine = drive(13);
    Object.assign(inLine.cop, { x: 0, z: PASEO, vx: 0, vz: 20 });
    const hit = { ...inLine.out() };
    expect(hit.brake, "did not brake for a stopped car in its lane").toBe(1);
    expect(hit.steer, "turned into it").toBe(0);
    const beside = drive(13);
    Object.assign(beside.cop, { x: 3, z: PASEO, vx: 0, vz: 20 });
    const past = { ...beside.out() };
    expect(past.steer, "turned into a target it was passing").toBe(0);
    expect(past.brake, "did not brake for a stopped car one lane over").toBe(1);
  });

  /** The cop's pedals after a second of one scene: the target `gap` m ahead on the cop's heading doing `tv`, the cop `offset` m to one side doing `v`, a seeker or not. */
  function pedalsIn(gap: number, seeks: 0 | 1, tv: number, offset: number, v: number): { throttle: number; brake: number; boost: boolean } {
    const d = drive(gap);
    d.r.brain["seeks"][0] = seeks;
    Object.assign(d.tg, { x: 0, z: PASEO + gap, vx: 0, vz: tv });
    Object.assign(d.cop, { x: offset, z: PASEO, vx: 0, vz: v });
    let o = d.out();
    for (let k = 0; k < FRAME_HZ; k++) o = d.out();
    return { throttle: o.throttle, brake: o.brake, boost: o.boost };
  }

  it("when a seeker closes at 20 m/s on a moving target 11 m ahead, one lane over, then at the floor of a it lifts and brakes for a hit it can take, and at full aggression it goes straight on", () => {
    onRamp();
    const floor = pedalsIn(11, 1, 12, 3, 32);
    expect(floor.throttle, "kept the gas on into a hit over the floor's closing cap").toBe(0);
    expect(floor.brake, "did not brake for it").toBe(1);
    Reflect.set(RAMP, "hold", -Infinity);
    const full = pedalsIn(11, 1, 12, 3, 32);
    expect(full.throttle, "lifted at full aggression").toBe(1);
    expect(full.brake).toBe(0);
  });

  it("when a seeker is 10 m behind a target doing 30 m/s, then under a of 0.5 it drives on into its tail boosting, and at full aggression it holds its queue row without boost", () => {
    onRamp();
    const floor = pedalsIn(10, 1, 30, 0, 30);
    expect(floor.throttle, "no gas into the tail").toBe(1);
    expect(floor.boost, "no boost into the tail").toBeTruthy();
    Reflect.set(RAMP, "hold", -Infinity);
    expect(pedalsIn(10, 1, 30, 0, 30).boost, "boosting in the queue at full aggression").toBeFalsy();
  });

  it("when a unit that does not seek is 8 m behind a target doing 15 m/s at its own speed, then it brakes back to its slot 12 m behind, and 30 m behind it closes on it", () => {
    onRamp();
    expect(pedalsIn(8, 0, 15, 0, 15).brake, "held its place 8 m off a target it was not to hit").toBeGreaterThan(0);
    const far = pedalsIn(30, 0, 15, 0, 15);
    expect(far.throttle, "did not close up to its slot").toBeGreaterThan(0);
    expect(far.brake).toBe(0);
  });

  it("when a human doing 35 m/s is 10 m behind a unit doing 20 m/s, then at the floor of a the unit does not brake for it: the closing cap is for a unit driving at its target, not a brake-check in front of a faster human", () => {
    onRamp();
    const ahead = pedalsIn(-10, 0, 35, 0, 20);
    expect(ahead.brake, "braked in front of a faster human").toBe(0);
    expect(ahead.throttle, "lifted in front of a faster human").toBeGreaterThan(0);
  });
});

describe("given a hunter at 35 m/s heading at a stopped player car 40 m away, driven by the hunter brain on the course's ground", () => {
  const START = 35;
  const GAP = 40;

  /** The speed (m/s) the real car has when it first comes within `SETTLE` m of the player car (its final speed if it stopped short of that). */
  function arrival(side: number): number {
    const r = rig();
    r.run(0.25);
    const ground = track.ground();
    setGround(ground);
    const car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: "cop" }, new THREE.Scene());
    const { x, z, yaw } = spec.start;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    car.spawnFacing(x + fz * side, z - fx * side, yaw, START);
    Object.assign(r.cars[0]!, { x: x + fx * GAP, z: z + fz * GAP, yaw, vx: 0, vz: 0 });
    const cop = r.cars[1]!;
    let at: number | null = null;
    for (let step = 0; step < 6 * 60; step++) {
      snapshotAiCar(cop, 1, car, true);
      const dist = Math.hypot(r.cars[0]!.x - cop.x, r.cars[0]!.z - cop.z);
      if (at === null && dist < SETTLE) at = Math.hypot(cop.vx, cop.vz);
      applyAiDrive(car, r.brain.think(cop, r.cars, 1 / FRAME_HZ), 1 / FRAME_HZ);
      car.integrate(1 / FRAME_HZ);
    }
    setGround(null);
    return at ?? Math.hypot(cop.vx, cop.vz);
  }

  it("when it drives at the player car, then it is slower than a blockable player car by the time it is within the settle distance, in its lane and a lane over", () => {
    expect(START ** 2 / (2 * DRIVE.brake) + SETTLE, "the scenario leaves the room a braking hunter needs").toBeLessThan(GAP);
    for (const side of [0, 3]) {
      const v = arrival(side);
      expect(v, `${v.toFixed(1)} m/s within ${SETTLE} m of the player car, ${side} m off its line`).toBeLessThan(BLOCKABLE);
    }
  });
});

/**
 * Police hunters as real cars on Havana's ground, driven by the hunter brain toward a parked quarry: each starts at `speed` m/s from its
 * `spot`; `each` sees every car after every step for `seconds` s.
 */
function hunt(spots: readonly { x: number; z: number; yaw: number }[], speed: number, quarry: { x: number; z: number }, seconds: number, each: (k: number, car: DeformableCar) => void): void {
  const r = rig();
  r.run(0.25);
  setGround(track.ground());
  const cars = spots.map((s, k) => {
    const car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: "cop" }, new THREE.Scene());
    assignClass(car, "police");
    r.brain.setClass(1 + k, classStats("police"));
    car.spawnFacing(s.x, s.z, s.yaw, speed);
    return car;
  });
  for (let k = spots.length + 1; k < r.cars.length; k++) Object.assign(r.cars[k]!, { x: FAR, z: FAR });
  Object.assign(r.cars[0]!, { x: quarry.x, z: quarry.z, vx: 0, vz: 0 });
  const dt = 1 / FRAME_HZ;
  for (let step = 0; step < seconds * FRAME_HZ; step++) {
    for (let k = 0; k < cars.length; k++) snapshotAiCar(r.cars[1 + k]!, 1 + k, cars[k]!, true);
    for (let k = 0; k < cars.length; k++) applyAiDrive(cars[k]!, r.brain.think(r.cars[1 + k]!, r.cars, dt), dt);
    for (let k = 0; k < cars.length; k++) {
      cars[k]!.integrate(dt);
      each(k, cars[k]!);
    }
  }
  setGround(null);
}

describe("given a police hunter at 30 m/s on the south lawn's grass, its quarry parked 60 m off at 50° to its right", () => {
  it("when it turns for its quarry, then it runs no more than 2 m outside the arc to it (the circle tangent to its nose through the quarry)", () => {
    const alpha = (50 * Math.PI) / 180;
    const start = { x: -40, z: -200 };
    const quarry = { x: start.x + 60 * Math.sin(alpha), z: start.z + 60 * Math.cos(alpha) };
    expect(track.ground().surfaceAt(start.x, start.z), "the scenario is on loose ground").toBe("grass");
    // The arc's widest point off the chord from the start to the quarry, on the side its nose starts on (the left of the chord).
    const sagitta = (60 / (2 * Math.sin(alpha))) * (1 - Math.cos(alpha));
    let wide = 0;
    hunt([{ ...start, yaw: 0 }], 30, quarry, 4, (_, car) => {
      const p = car.group.position;
      wide = Math.max(wide, ((p.z - start.z) * (quarry.x - start.x) - (p.x - start.x) * (quarry.z - start.z)) / 60);
    });
    expect(wide, `${wide.toFixed(1)} m left of the chord; the arc to the quarry is ${sagitta.toFixed(1)} m`).toBeLessThanOrEqual(sagitta + 2);
  });
});

/**
 * The pack on a stub world with the player car at its start slot facing north, and the car's speed set by the caller at each beat (`speedAt`; it
 * never moves, and reverses toward the south at that speed). `boxed`: walls on its north, east and west, the way south open, and units 5.7 m
 * south-east and south-west of it lying wrecked; else open ground and every unit far off.
 */
function playerScene(boxed: boolean) {
  const { x, z } = humanSlot(spec.start, 0);
  const wall = (index: number, dx: number, dz: number, hx: number, hz: number): PropCollider => ({ index, prefab: "building", body: "solid", x: x + dx, z: z + dz, yaw: 0, kind: "box", r: Math.hypot(hx, hz), hx, hz, mass: 0, base: 0, top: 14, ends: 3 });
  const r = rig({ hidden: () => false, colliders: boxed ? [wall(0, 0, 6, 12, 1), wall(1, 6, 0, 1, 12), wall(2, -6, 0, 1, 12)] : [] });
  r.cars[0]!.yaw = 0;
  for (let k = 2; k < r.cars.length; k++) Object.assign(r.cars[k]!, boxed && k < 4 ? { x: x + (k === 2 ? 5.7 : -5.7), z: z - 5.7, crashed: true } : { x: FAR, z: FAR });
  return { r, x, z };
}

/** One real police cop 25 m south of the scene's player car, driven for `seconds` s: each frame the cop's speed, its speed toward the player car (`c`) and its distance to it. */
function copRun(seconds: number, speedAt: (t: number) => number): { t: number; v: number; c: number; d: number }[] {
  const { r, x, z } = playerScene(true);
  const player = r.cars[0]!;
  setGround(track.ground());
  const car = new DeformableCar({ body: 0x808080, accent: 0x404040, name: "cop" }, new THREE.Scene());
  assignClass(car, "police");
  r.brain.setClass(1, classStats("police"));
  car.spawnFacing(x, z - 25, 0, 20);
  const cop = r.cars[1]!;
  const out: { t: number; v: number; c: number; d: number }[] = [];
  const dt = 1 / FRAME_HZ;
  r.run(seconds, (t) => {
    Object.assign(player, { vx: 0, vz: -speedAt(t) });
    for (let step = 0; step < BEAT * FRAME_HZ; step++) {
      snapshotAiCar(cop, 1, car, true);
      applyAiDrive(car, r.brain.think(cop, r.cars, dt), dt);
      car.integrate(dt);
      const d = Math.hypot(player.x - cop.x, player.z - cop.z);
      out.push({ t: t + step * dt, v: Math.hypot(cop.vx, cop.vz), c: (cop.vx * (player.x - cop.x) + cop.vz * (player.z - cop.z)) / d, d });
    }
  });
  setGround(null);
  return out;
}

/** Whether a cop 20 m south of the scene's player car, facing it at 10 m/s, backs off for a run-up (full lock away, the throttle held low) after `seconds` s of the player's squirm. */
function backsOff(seconds: number, boxed: boolean, speedAt: (t: number) => number): boolean {
  const { r, x, z } = playerScene(boxed);
  const player = r.cars[0]!;
  r.run(seconds, (t) => Object.assign(player, { vx: 0, vz: -speedAt(t) }));
  Object.assign(r.cars[1]!, { x, z: z - 20, yaw: 0, vx: 0, vz: 10 });
  let out = r.brain.think(r.cars[1]!, r.cars, 1 / FRAME_HZ);
  for (let frame = 0; frame < FRAME_HZ; frame++) out = r.brain.think(r.cars[1]!, r.cars, 1 / FRAME_HZ);
  return out.throttle < 0.5 && Math.abs(out.steer) > 0.5;
}

/** Centre distance (m) inside which a cop at the player car has hit it (a car is 4.6 m long). */
const CONTACT = 6;

describe("given a player car boxed in by walls on three sides and two wrecks, and a police cop on the open side", () => {
  it("when the same squirm runs at the floor of a, then the cop backs off to no more than a short run-up and arrives at the player car under the kill bar, not at 28 m/s", () => {
    onRamp();
    const run = copRun(RAM_AFTER + 14, () => 8);
    const far = Math.max(...run.filter((f) => f.t > RAM_AFTER).map((f) => f.d));
    const hit = Math.max(0, ...run.filter((f) => f.t > RAM_AFTER && f.d < CONTACT).map((f) => f.c));
    expect(far, `${far.toFixed(0)} m the cop backed off to`).toBeLessThan(RUN_UP - 10);
    expect(hit, `${hit.toFixed(1)} m/s closing on the player car`).toBeGreaterThan(0);
    expect(hit, `${hit.toFixed(1)} m/s closing on the player car`).toBeLessThan(16);
  });
  it("when the player squirms over the bust's 20 km/h for the wait, then a real cop backs off to a run-up and charges in at 28 m/s or more (its speed within 12 m of the player car), and before the wait is up it comes in under 28 m/s", () => {
    const run = copRun(RAM_AFTER + 14, () => 8);
    const early = Math.max(0, ...run.filter((f) => f.t < RAM_AFTER).map((f) => f.v));
    expect(early, `${early.toFixed(1)} m/s before the wait is up`).toBeLessThan(28);
    const far = Math.max(...run.filter((f) => f.t > RAM_AFTER).map((f) => f.d));
    expect(far, `${far.toFixed(0)} m the cop backed off to`).toBeGreaterThanOrEqual(RUN_UP - 10);
    const hit = Math.max(0, ...run.filter((f) => f.t > RAM_AFTER && f.d < SETTLE).map((f) => f.v));
    expect(hit, `${hit.toFixed(1)} m/s at the player car`).toBeGreaterThanOrEqual(28);
  });
  it("when the player has squirmed one second short of the wait, then the cop does not back off, and one beat past it, it does", () => {
    expect(backsOff(RAM_AFTER - 1, true, () => 8)).toBe(false);
    expect(backsOff(RAM_AFTER + 1, true, () => 8)).toBe(true);
  });
  it("when the player sits still instead, then the cop does not back off, however long: the bust is left to hold", () => {
    expect(backsOff(RAM_AFTER * 4, true, () => 0)).toBe(false);
  });
  it("when the player drives off at 20 m/s a beat before the wait is up, then the wait starts over", () => {
    const reset = RAM_AFTER / 2;
    expect(backsOff(RAM_AFTER + 1, true, (t) => (Math.abs(t - reset) < 1e-6 ? 20 : 8))).toBe(false);
  });
  it("when the same squirm is on open ground, with no box round the player, then the cop does not back off", () => {
    expect(backsOff(RAM_AFTER + 14, false, () => 8)).toBe(false);
  });
  it("when the wait is up and a unit of the box backs off out of it (the rammers that boxed the player in are the ones that back off), then the ram goes on: the box no longer clears a wait that is up", () => {
    expect(waitAfterOpening(RAM_AFTER + 1), "the player's clock, s").toBeGreaterThanOrEqual(RAM_AFTER);
  });
  it("when the same unit leaves the box mid-wait, then the wait starts over", () => {
    expect(waitAfterOpening(RAM_AFTER / 2), "the player's clock, s").toBeLessThan(RAM_AFTER / 2);
  });
  it("when the wait is up and the player then sits still for the calm time, then the ram is over and the clock starts over (the bust gets its chance); short of the calm time it goes on", () => {
    expect(clockAfterStill(CALM_END - 1), "sat still short of the calm time, clock s").toBeGreaterThanOrEqual(RAM_AFTER);
    expect(clockAfterStill(CALM_END + 1), "sat still past it, clock s").toBe(0);
  });
  it("when a cop's last ram ended with its charge flag set (the player drove off), then its next ram starts with a back-off: the flag is reset while the wait is not up", () => {
    const { r, x, z } = playerScene(true);
    // Past the green (before it every cop is held on the brake), the player sitting still so the wait does not run.
    r.run(1, () => Object.assign(r.cars[0]!, { vx: 0, vz: 0 }));
    r.brain["charging"][0] = 1;
    Object.assign(r.cars[1]!, { x, z: z - 30, yaw: 0, vx: 0, vz: 10 });
    r.brain.think(r.cars[1]!, r.cars, 1 / FRAME_HZ);
    r.brain["pinned"][0] = RAM_AFTER;
    let out = r.brain.think(r.cars[1]!, r.cars, 1 / FRAME_HZ);
    for (let frame = 0; frame < FRAME_HZ; frame++) out = r.brain.think(r.cars[1]!, r.cars, 1 / FRAME_HZ);
    expect(out.throttle < 0.5 && Math.abs(out.steer) > 0.5, "backing off for its run-up, not charging from 30 m").toBe(true);
  });
});

/**
 * The hunted player's squirm clock after `RAM_AFTER + 2` s of an 8 m/s squirm in the scene, when the box's two units are moved 40 m off (out of the
 * box) at `openAt` s. `clockSquirm` alone is stepped, a beat at a time: the brain's own `update` would drop fresh units in beside the player.
 */
function waitAfterOpening(openAt: number): number {
  const { r } = playerScene(true);
  Object.assign(r.cars[1]!, { x: FAR, z: FAR });
  Object.assign(r.cars[0]!, { vx: 0, vz: -8 });
  for (let t = 0; t < RAM_AFTER + 2; t += BEAT) {
    if (t >= openAt) for (const k of [2, 3]) Object.assign(r.cars[k]!, { x: FAR, z: FAR });
    r.brain["clockSquirm"](r.cars, r.hunt, BEAT);
  }
  return r.brain["pinned"][0]!;
}

/** The player's squirm clock after `RAM_AFTER + 1` s of an 8 m/s squirm in the boxed scene (the box stays), then `stillS` s sitting still: `clockSquirm` alone is stepped, a beat at a time. */
function clockAfterStill(stillS: number): number {
  const { r } = playerScene(true);
  Object.assign(r.cars[1]!, { x: FAR, z: FAR });
  for (let t = 0; t < RAM_AFTER + 1 + stillS; t += BEAT) {
    Object.assign(r.cars[0]!, { vx: 0, vz: t < RAM_AFTER + 1 ? -8 : 0 });
    r.brain["clockSquirm"](r.cars, r.hunt, BEAT);
  }
  return r.brain["pinned"][0]!;
}

/** A frame's steps run at most 8 slices (`SimPacer`'s MAX_STEPS) of `physicsSlice` at the engine's slowest slice speed (8 m/s): the longest a placed cop waits to show while the player drives on. */
const SHOW_LAG = 8 * physicsSlice(Infinity, 8);
const SEEDS = 12;

/** A spot of the main loop far from the formation where the road runs straight through the next two spots: its place, the road's heading, and the spacing of the spots. */
function straightSpot(): { x: number; z: number; ux: number; uz: number; step: number } {
  const p = track.path;
  const gap = HUNT.spacing;
  for (let k = 0; k + 2 * gap < p.count; k += gap) {
    if (Math.hypot(p.x[k]! - spec.start.x, p.z[k]! - spec.start.z) < 250 || p.deck[k] || p.deck[k + gap] || p.deck[k + 2 * gap]) continue;
    if (p.tx[k]! * p.tx[k + gap]! + p.tz[k]! * p.tz[k + gap]! < 0.9999 || p.tx[k]! * p.tx[k + 2 * gap]! + p.tz[k]! * p.tz[k + 2 * gap]! < 0.9999) continue;
    return { x: p.x[k]!, z: p.z[k]!, ux: p.tx[k]!, uz: p.tz[k]!, step: Math.hypot(p.x[k + gap]! - p.x[k]!, p.z[k + gap]! - p.z[k]!) };
  }
  throw new Error("no straight stretch of road for the drop-in spots");
}

/**
 * A player driving at `speed` m/s along a straight road toward the drop-in spot `dropMin + 0.2` m ahead, the camera seeing every spot but the
 * ring just beyond `dropMin` that holds that spot and the next one. Per seed: the first drop-in's distance from the player where the hunter
 * judged it, and the nearest the player came to it over the `SHOW_LAG` s that follow (the cop shows somewhere in them).
 */
function approach(speed: number): { seed: number; judged: number; near: number }[] {
  const s = straightSpot();
  const px = s.x - s.ux * (HUNT.dropMin + 0.2);
  const pz = s.z - s.uz * (HUNT.dropMin + 0.2);
  const ring = (x: number, z: number): boolean => {
    const d = Math.hypot(x - px, z - pz);
    return d >= HUNT.dropMin && d < HUNT.dropMin + 0.2 + s.step + 0.5;
  };
  const out: { seed: number; judged: number; near: number }[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = rig({ seed, hidden: ring });
    Object.assign(r.cars[0]!, { x: px, z: pz, yaw: Math.atan2(s.ux, s.uz), vx: s.ux * speed, vz: s.uz * speed });
    r.run(HUNT.every + 20);
    const drop = r.drops[spec.formation.length];
    if (!drop) continue;
    let near = Infinity;
    for (let t = 0; t <= SHOW_LAG + 1e-9; t += 1 / FINE_HZ) near = Math.min(near, Math.hypot(drop.x - (px + s.ux * speed * t), drop.z - (pz + s.uz * speed * t)));
    out.push({ seed, judged: Math.hypot(drop.x - px, drop.z - pz), near });
  }
  return out;
}
