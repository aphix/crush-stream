import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DerbyMatch, snapshotAiCar } from "./derby.ts";
import { DERBY_RADIUS } from "../scenes/derby-arena.ts";
import { arenaWorld, leaveArena } from "../scenes/derby-arena.test-util.ts";
import { DERBY_FREE_PROPS } from "../scenes/derby-ground.ts";
import { applyAiDrive } from "../ai/input-fade.ts";
import { layoutDerby } from "../scenes/fleet.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { physicsSlice } from "../contact/sat.ts";
import { stepWorld } from "../engine/world-step.ts";
import { CAR_STYLE_IDS, CAR_STYLES } from "../vehicle/car-variants.ts";
import { carFrame } from "../vehicle/car-rig.ts";
import { armKill, carClass, DEFAULT_REALISM } from "../vehicle/vehicle-classes.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { EPICENTER, epicenterValues, loadEpicenter } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";

/**
 * The epicenter freeze on a derby: six AI cars in the arena at the realistic crush knobs (the long-run's `REALISTIC`), seed 7, the first 15 s. A wreck that spins on its running drivetrain has its wheel hubs standing up
 * to 1.5 m off their car-frame places (the world's place of a planted hub, not its pin); the freeze used to re-derive each hub's car-frame place from that world place, so the frozen wreck kept its hubs (and the drawn
 * wheels, which sit at their hubs' frame x and z) there for good: a rear wheel drawn at the front on the other side. Seed 7's first such freeze is at 13.2 s.
 */
const SEED = 7;
const SECONDS = 15;
/** How far (m) a frozen wreck's hub may stand from its rest place in the car frame, and a drawn wheel from its own: a bumper crushes to 0.6 m, a hub is shoved by a face (0.1 to 0.35 m). */
const HUB_BOUND = 0.5;
const saved = epicenterValues();
afterEach(() => loadEpicenter(saved));

function derbySeed(): { frozenSlices: number; worstHub: number; worstWheel: number } {
  loadEpicenter(EPICENTER_AT_LOAD);
  EPICENTER.on = 1;
  const rears = CAR_STYLE_IDS.map((id) => carFrame(CAR_STYLES[id]).rig.cages.find((c) => c.name === "chassisRear")!);
  const rests = rears.map((c) => c.maxCrush);
  for (const c of rears) c.maxCrush = 0.38;
  try {
    const scene = new THREE.Scene();
    const cars = Array.from({ length: 6 }, (_, i) => new DeformableCar({ body: 0xc5c8ce, accent: 0x9aa0a8, name: `c${i}` }, scene));
    let s = SEED;
    const rng = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    const slots = layoutDerby(cars.length, DERBY_RADIUS, rng, DERBY_FREE_PROPS);
    for (const [i, c] of cars.entries()) c.spawnFacing(slots[i]!.x, slots[i]!.z, slots[i]!.yaw, 0);
    const match = new DerbyMatch();
    match.begin(cars.map((_, i) => ({ id: i, name: `c${i}` })), {});
    const { world: w } = arenaWorld(cars);
    for (const c of cars) {
      c.deform.squash = 0.32;
      c.deform.buckle = 0.45;
      c.deform.setMode("shape");
      armKill(c.deform, carClass(c), DEFAULT_REALISM, "derby");
    }
    let t = match.time;
    let frozenSlices = 0;
    let worstHub = 0;
    let worstWheel = 0;
    while (t < SECONDS) {
      let vmax = 8;
      for (const c of cars) vmax = Math.max(vmax, c.speed);
      const h = physicsSlice(1 / FRAME_HZ, vmax);
      const snaps = match.snapshots(cars.length);
      for (const [i, c] of cars.entries()) snapshotAiCar(snaps[i]!, i, c, c.deform.drivetrainAlive);
      for (const [i, c] of cars.entries()) applyAiDrive(c, match.think(snaps[i]!, snaps, h), h);
      w.pairHit = (a, b, pair) => {
        match.noteHit(a, b, -(cars[a]!.velocity.x * pair.normal.x + cars[a]!.velocity.z * pair.normal.z), cars[b]!.velocity.x * pair.normal.x + cars[b]!.velocity.z * pair.normal.z, pair.impulse);
      };
      stepWorld(w, h);
      for (const c of cars) if (c.deform.massActive && !c.deform.drivetrainAlive) c.deform.cutDrive(h);
      match.step(h, cars.map((c, i) => ({ id: i, name: `c${i}`, alive: c.deform.drivetrainAlive, x: c.group.position.x, z: c.group.position.z })));
      for (const c of cars) {
        if (!c.deform.frozen || !c.deform.frozenReady) continue;
        frozenSlices++;
        for (const [k, name] of (["hubFL", "hubFR", "hubRL", "hubRR"] as const).entries()) {
          if (c.deform.hubPopped(name)) continue;
          const hub = c.deform.massLocal(name);
          const rp = c.frame.wheels[k]!;
          worstHub = Math.max(worstHub, Math.hypot(hub.x - rp[0], hub.z - rp[2]));
          const wp = c.wheels[k]!.position;
          worstWheel = Math.max(worstWheel, Math.hypot(wp.x - rp[0], wp.z - rp[2]));
        }
      }
      t += h;
    }
    return { frozenSlices, worstHub, worstWheel };
  } finally {
    for (const [k, c] of rears.entries()) c.maxCrush = rests[k]!;
    leaveArena();
  }
}

describe("given a six-car derby (seed 7) with the epicenter activation on", () => {
  it("when it runs 15 s, then every frozen wreck's hubs and drawn wheels stay within half a metre of their car-frame places", () => {
    const { frozenSlices, worstHub, worstWheel } = derbySeed();
    assert.ok(frozenSlices > 1000, `${frozenSlices} frozen wreck slices: the row proves nothing`);
    assert.ok(worstHub < HUB_BOUND, `a frozen wreck's hub stood ${worstHub.toFixed(2)} m off its place in the car frame`);
    assert.ok(worstWheel < HUB_BOUND, `a frozen wreck's drawn wheel stood ${worstWheel.toFixed(2)} m off its place`);
  });
});
