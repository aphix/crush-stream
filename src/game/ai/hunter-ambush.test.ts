import { describe, expect, it } from "vitest";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { PropCollider } from "../world/placements.ts";
import { blankAiCar } from "./derby-ai.ts";
import { EscapeLine } from "./ambush.ts";
import { HUNT, RAM_AFTER } from "./hunter.ts";
import { Obstacles } from "./obstacles.ts";
import { spec } from "./hunter-rig.test-util.ts";
import { atFullAggression, onRamp } from "./ramp.test-util.ts";
import { AMBUSHING, ambusher, ambushers, convoy, dir, drivePast, firstAmbush, frame, HUNTING, lost, PLAYER_SPEED, states, sweep, type Line } from "./hunter-ambush.test-util.ts";

atFullAggression();

/** The lines the rows sweep: 40 across Havana's box, the player at 20 m/s. */
const LINES = sweep(40);
/** The paseo's flat stretch, along +z, where a cop is set up to meet a mate ahead. */
const PASEO = -200;

describe("given Survival's pack with the player holding a line at 20 m/s, and a cop wrecked", () => {
  it("when its replacement drops in, then it lies in ambush 80-120 m ahead and 5-20 m beside the line, and the ambusher is counted once", () => {
    let found = 0;
    for (const [s, l] of LINES.entries()) {
      const r = lost(l, s + 1);
      const u = ambusher(r);
      if (u < 0) continue;
      found++;
      const { along, off } = frame(l, r.cars[r.brain.first + u]!);
      expect(r.brain.stats.ambushes, `line ${s}`).toBe(1);
      expect(off, `line ${s}: ${off.toFixed(1)} m off the line`).toBeGreaterThanOrEqual(5);
      expect(off, `line ${s}: ${off.toFixed(1)} m off the line`).toBeLessThanOrEqual(20);
      expect(along, `line ${s}: ${along.toFixed(0)} m ahead`).toBeGreaterThanOrEqual(80);
      expect(along, `line ${s}: ${along.toFixed(0)} m ahead`).toBeLessThanOrEqual(120);
    }
    expect(found, `${found} of ${LINES.length} lines found a spot beside them`).toBeGreaterThanOrEqual(10);
  });

  it("when the camera sees every spot but those 100 m ahead and farther, then every ambusher drops in out of view", () => {
    let found = 0;
    for (const [s, l] of LINES.entries()) {
      const hidden = (x: number, z: number): boolean => frame(l, { x, z }).along > 100;
      const r = lost(l, s + 1, 1, { hidden });
      const u = ambusher(r);
      if (u < 0) continue;
      found++;
      const at = r.cars[r.brain.first + u]!;
      expect(hidden(at.x, at.z), `line ${s}: the ambusher dropped in at ${frame(l, at).along.toFixed(0)} m ahead, in view`).toBeTruthy();
    }
    expect(found, `${found} of ${LINES.length} lines found a hidden spot beside them`).toBeGreaterThanOrEqual(3);
  });

  it("when a wall stands across the line 90 m ahead, then the ambusher parks beside the choke's mouth (12 m either side of its face), not 80-120 m anywhere", () => {
    let found = 0;
    for (const [s, l] of LINES.entries()) {
      const d = dir(l);
      const wall: PropCollider = { index: 0, prefab: "building", body: "solid", x: l.x + d.x * 90, z: l.z + d.z * 90, yaw: l.yaw, kind: "box", r: 10, hx: 10, hz: 2, mass: 0, base: 0, top: 14, ends: 3 };
      const r = lost(l, s + 1, 1, { colliders: [wall] });
      const u = ambusher(r);
      if (u < 0) continue;
      found++;
      const { along } = frame(l, r.cars[r.brain.first + u]!);
      expect(Math.abs(along - 88), `line ${s}: ${along.toFixed(0)} m ahead`).toBeLessThanOrEqual(14);
    }
    expect(found, `${found} of ${LINES.length} lines found a spot beside the choke`).toBeGreaterThanOrEqual(3);
  });

  it("when the player drives the boulevard's own line, then the ambusher is on a cross street beside it, never on the boulevard", () => {
    const l: Line = { x: 0, z: 330, v: PLAYER_SPEED, yaw: Math.PI };
    let found = 0;
    for (let s = 1; s <= 24; s++) {
      const r = lost(l, s);
      const u = ambusher(r);
      if (u < 0) continue;
      found++;
      expect(frame(l, r.cars[r.brain.first + u]!).off, `seed ${s}`).toBeGreaterThanOrEqual(5);
    }
    expect(found, `${found} of 24 seeds found a cross street`).toBeGreaterThanOrEqual(8);
  });

  it("when the player's speed is read for a line, then a window out of reach of a drop-in has no search: none under 11 m/s or over 30 m/s on a clear road", () => {
    const line = new EscapeLine();
    const clear = new Obstacles([]);
    const reads = [10, 12, 30, 31].map((v) => line.read({ ...blankAiCar(0), vz: v }, clear, HUNT.dropMin, HUNT.dropMax));
    expect(reads).toEqual([false, true, true, false]);
  });
});

describe("given an ambusher lying in wait beside the player's line", () => {
  it("when the player drives on past it, then it holds until the player is within 30 m, and once woken it leads in for 2 s and hunts", () => {
    let flips = 0;
    for (const [s, l] of LINES.entries()) {
      const r = lost(l, s + 1, 1, { think: true });
      const u = ambusher(r);
      if (u < 0) continue;
      const at = r.cars[r.brain.first + u]!;
      let woke = -1;
      drivePast(r, l, 12, (p, t) => {
        const near = Math.hypot(at.x - p.x, at.z - p.z) < 30;
        if (woke < 0 && states(r)[u] === HUNTING) {
          woke = t;
          flips++;
          expect(near, `line ${s}: woke ${Math.hypot(at.x - p.x, at.z - p.z).toFixed(0)} m from the player`).toBeTruthy();
        }
        if (woke < 0) expect(near, `line ${s}: still in ambush ${Math.hypot(at.x - p.x, at.z - p.z).toFixed(0)} m from the player`).toBeFalsy();
        // The rig's cars stand still, so the wedge backs the unit off for a share of the time (no lead-in then): 4 s is room for the 2 s of it.
        if (woke >= 0 && t - woke > 4) expect(r.brain["leadIn"][u]!, `line ${s}: the lead-in never ran out`).toBeLessThanOrEqual(0);
        if (woke >= 0 && t - woke > 0.5) expect(r.brain["leadIn"][u]!, `line ${s}: the lead-in did not run`).toBeLessThan(2);
      });
      expect(woke, `line ${s}: never woke`).toBeGreaterThanOrEqual(0);
    }
    expect(flips).toBeGreaterThanOrEqual(10);
  });

  it("when the player swerves wide and drives past it 60 m off, then it wakes at once: the player has gone by", () => {
    const { r, line, u } = firstAmbush(LINES);
    const at = r.cars[r.brain.first + u]!;
    const d = dir(line);
    Object.assign(r.cars[0]!, { x: at.x + d.x * 50 + d.z * 35, z: at.z + d.z * 50 - d.x * 35, vx: d.x * PLAYER_SPEED, vz: d.z * PLAYER_SPEED });
    r.run(r.now() + 0.25);
    expect(states(r)[u], "stayed in ambush with the player 60 m off and past").toBe(HUNTING);
  });

  it("when the player stops 100 m off and does not come, then it holds 25 s and then wakes: the pack is not a cop short for ever", () => {
    const { r, u } = firstAmbush(LINES);
    Object.assign(r.cars[0]!, { vx: 0, vz: 0 });
    r.run(r.now() + 23);
    expect(states(r)[u], "woke early").toBe(AMBUSHING);
    r.run(r.now() + 4);
    expect(states(r)[u], "never woke").toBe(HUNTING);
  });

  it("when it is parked, then it is held on the brake and is not a unit out driving, and a hunter closing on it at 20 m/s brakes for it as for a wreck", () => {
    const { r, u } = firstAmbush(LINES);
    const id = r.brain.first + u;
    expect(r.brain.drives(id), "an ambusher is a stopped obstacle, not a unit out driving").toBe(false);
    const held = r.brain.think(r.cars[id]!, r.cars, 1 / FRAME_HZ);
    expect([held.throttle, held.brake], "an ambusher is held on the brake").toEqual([0, 1]);
    Object.assign(r.cars[0]!, { x: 0, z: PASEO + 100, yaw: 0, vx: 0, vz: 0 });
    Object.assign(r.cars[id]!, { x: 0, z: PASEO + 12, yaw: 0, vx: 0, vz: 0 });
    Object.assign(r.cars[1]!, { x: 0, z: PASEO, yaw: 0, vx: 0, vz: 20 });
    expect(r.brain.think(r.cars[1]!, r.cars, 1 / FRAME_HZ).brake, "drove on into an ambusher").toBeGreaterThan(0.5);
  });
});

describe("given an ambusher just woken, its car on the paseo and the player 11 m ahead of it", () => {
  /** The first ambusher, woken by the player driving up to it, its car then set on the paseo facing +z at 10 m/s. */
  function woken() {
    const { r, u, line } = firstAmbush(LINES);
    const at = r.cars[r.brain.first + u]!;
    Object.assign(r.cars[0]!, { x: at.x + 15, z: at.z, vx: 0, vz: 0 });
    r.run(r.now() + 0.25);
    expect(states(r)[u], "not woken by the player 15 m off").toBe(HUNTING);
    return { r, u, at, line };
  }

  it("when its lead-in runs, then it steers from its own heading toward the player's point 1 s on and then to it, at full throttle, and the lead-in ends after 2 s", () => {
    const { r, u, at } = woken();
    Object.assign(at, { x: 0, z: PASEO, yaw: 0, vx: 0, vz: 10 });
    Object.assign(r.cars[0]!, { x: 20, z: PASEO + 5, yaw: Math.PI / 2, vx: 20, vz: 0 });
    const first = r.brain.think(at, r.cars, 1 / FRAME_HZ);
    expect([Math.abs(first.steer) < 0.05, first.throttle], "the lead-in starts on its own heading at full throttle").toEqual([true, 1]);
    let steer = 0;
    for (let k = 0; k < FRAME_HZ; k++) {
      at.z += 10 / FRAME_HZ;
      steer = r.brain.think(at, r.cars, 1 / FRAME_HZ).steer;
    }
    expect(steer, "a second in, still not turned toward the player's point").toBeGreaterThan(0.3);
    for (let k = 0; k < FRAME_HZ * 1.2; k++) {
      at.z += 10 / FRAME_HZ;
      r.brain.think(at, r.cars, 1 / FRAME_HZ);
    }
    expect(r.brain["leadIn"][u]!, "the lead-in outlived 2 s").toBeLessThanOrEqual(0);
  });

  it("when the pack is on the ramp (a under 1) and the ambusher flies at the player at 32 m/s from 11 m, then the closing cap brakes it through its lead-in", () => {
    onRamp();
    const { r, at } = woken();
    Object.assign(at, { x: 3, z: PASEO, yaw: 0, vx: 0, vz: 32 });
    Object.assign(r.cars[0]!, { x: 0, z: PASEO + 11, yaw: 0, vx: 0, vz: 12 });
    expect(r.brain.think(at, r.cars, 1 / FRAME_HZ).brake, "no brake for a hit over the ramp's cap").toBe(1);
  });

  it("when its target is pinned past the squirm wait at 3 m/s and a wreck lies 12 m ahead of it, 10 m short of the target, then in its lead-in it is not ramming: the guard sees the wreck and it brakes", () => {
    const { r, at } = woken();
    r.down.add(4);
    r.run(r.now() + 0.25);
    Object.assign(at, { x: 0, z: PASEO, yaw: 0, vx: 0, vz: 20 });
    Object.assign(r.cars[0]!, { x: 0, z: PASEO + 22, yaw: 0, vx: 0, vz: 3 });
    Object.assign(r.cars[4]!, { x: 0, z: PASEO + 12, yaw: 0, vx: 0, vz: 0 });
    r.brain["pinned"][0] = RAM_AFTER;
    expect(r.brain.think(at, r.cars, 1 / FRAME_HZ).brake, "drove on into the box's wreck in its lead-in").toBeGreaterThan(0.5);
  });
});

describe("given three cops wrecked at once with the player holding a line, and a pack that keeps up with it", () => {
  it("when the replacements drop in over the next seconds, then at most one lies in ambush at a time", () => {
    let ambushes = 0;
    for (const [s, l] of LINES.entries()) {
      const r = lost(l, s + 1, 3);
      drivePast(r, l, 8, () => {
        const now = ambushers(r);
        ambushes += now.length > 0 ? 1 : 0;
        expect(now.length, `line ${s}: ${now.length} lying in ambush`).toBeLessThanOrEqual(1);
      });
      expect(r.brain.stats.drops, `line ${s}: all three replaced`).toBeGreaterThanOrEqual(3);
    }
    expect(ambushes, "ambushers seen").toBeGreaterThan(0);
  });

  it("when the pack grows on a 1 s schedule with nobody lost, on the lines that do have an ambush spot, then no drop-in is an ambusher", () => {
    const every = HUNT.every;
    Reflect.set(HUNT, "every", 1);
    try {
      let drops = 0;
      let ambushes = 0;
      for (const [s, l] of LINES.entries()) {
        const r = lost(l, s + 1, 0);
        drivePast(r, l, 8, () => convoy(r, l, spec.formation.length));
        drops += r.brain.stats.drops;
        ambushes += r.brain.stats.ambushes;
      }
      expect(drops, "the packs did grow").toBeGreaterThan(40);
      expect(ambushes, "an ordinary drop-in lay in ambush").toBe(0);
    } finally {
      Reflect.set(HUNT, "every", every);
    }
  });
});
