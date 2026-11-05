import * as THREE from "three";
import { DerbyMatch, snapshotAiCar } from "./derby.ts";
import { arenaWorld, placeDerby } from "../scenes/derby-arena.test-util.ts";
import { setGround } from "../world/ground.ts";
import { applyAiDrive } from "../ai/input-fade.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { physicsSlice } from "../contact/sat.ts";
import { stepWorld } from "../engine/world-step.ts";
import { CAR_STYLE_IDS, CAR_STYLES } from "../vehicle/car-variants.ts";
import { carFrame } from "../vehicle/car-rig.ts";
import { armKill, carClass, DEFAULT_REALISM } from "../vehicle/vehicle-classes.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { EPICENTER, loadEpicenter } from "../deform/epicenter.ts";
import { HUB_PIN_MAX, HUB_PULL_STEP } from "../deform/constants.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";

/**
 * The epicenter freeze on a derby: six AI cars in the arena at the realistic crush knobs (the long-run's `REALISTIC`), seed 10, the first 15 s. A wreck that spins on its running drivetrain has its wheel hubs standing up
 * to 1.5 m off their car-frame places (the world's place of a planted hub, not its pin); the freeze used to re-derive each hub's car-frame place from that world place, so the frozen wreck kept its hubs (and the drawn
 * wheels, which sit at their hubs' frame x and z) there for good: a rear wheel drawn at the front on the other side. Seed 10 once had such a freeze (a hub 0.80 m off its place when the re-derive was restored: `HUB_PIN_MAX` infinite); on 7917d954c it no longer reaches one (the staged row in epicenter-thaw.test.ts pins the keep).
 */
const SEED = 10;
const SECONDS = 15;
/** How far (m) a drawn wheel of a frozen wreck may stand from its hub (in plan). */
export const WHEEL_BOUND = 0.5;
/** The most (m, in plan) the freeze-start slice may move a hub's car-frame place from its pin (the freeze keeps the pin of a hub farther than this off it; a nearer one is re-derived, as `Car.integrateWreck` reads). */
export const KEEP = HUB_PIN_MAX + HUB_PULL_STEP;
const HUBS = ["hubFL", "hubFR", "hubRL", "hubRR"] as const;
const _wheel = new THREE.Vector3();
const _place = new THREE.Vector3();

/**
 * How far (m, in the world's plan) a car's drawn wheel `k` stands from its hub's place in the car frame. The suspension seats a wheel on the surface it rides (a prop, another wreck's top)
 * along the world's vertical, which a rolled body's frame reads as a sideways car-frame offset: a frame distance would count that legitimate seat as the freeze bug, the plan distance does not.
 */
function wheelOffHub(car: DeformableCar, k: number, hub: THREE.Vector3): number {
  car.group.updateMatrixWorld(true);
  car.group.localToWorld(_wheel.copy(car.wheels[k]!.position));
  car.group.localToWorld(_place.set(hub.x, car.frame.wheels[k]![1]!, hub.z));
  return Math.hypot(_wheel.x - _place.x, _wheel.z - _place.z);
}

export function derbySeed(): { frozenSlices: number; worstJump: number; worstWheel: number } {
  loadEpicenter(EPICENTER_AT_LOAD);
  EPICENTER.on = 1;
  const rears = CAR_STYLE_IDS.map((id) => carFrame(CAR_STYLES[id]).rig.cages.find((c) => c.name === "chassisRear")!);
  const rests = rears.map((c) => c.maxCrush);
  for (const c of rears) c.maxCrush = 0.38;
  try {
    const scene = new THREE.Scene();
    const cars = Array.from({ length: 6 }, (_, i) => new DeformableCar({ body: 0xc5c8ce, accent: 0x9aa0a8, name: `c${i}` }, scene));
    placeDerby(cars, SEED);
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
    let worstJump = 0;
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
      // The freeze-start slice (`settleFreeze` set `frozen` last slice, the rigid step has not cached it): each unpopped hub's pin, before the slice.
      const pins: { c: DeformableCar; k: number; x: number; z: number }[] = [];
      for (const c of cars) {
        if (!c.deform.frozen || c.deform.frozenReady) continue;
        for (const [k, name] of HUBS.entries()) {
          if (c.deform.hubPopped(name)) continue;
          const l = c.deform.massLocal(name);
          pins.push({ c, k, x: l.x, z: l.z });
        }
      }
      stepWorld(w, h);
      for (const q of pins) {
        if (!q.c.deform.frozenReady) continue; // thawed by a contact in the slice: its clamps move the hub, not the freeze
        const l = q.c.deform.massLocal(HUBS[q.k]!);
        const jump = Math.hypot(l.x - q.x, l.z - q.z);
        worstJump = Math.max(worstJump, jump);
      }
      for (const c of cars) if (c.deform.massActive && !c.deform.drivetrainAlive) c.deform.cutDrive(h);
      match.step(h, cars.map((c, i) => ({ id: i, name: `c${i}`, alive: c.deform.drivetrainAlive, x: c.group.position.x, z: c.group.position.z })));
      for (const c of cars) {
        if (!c.deform.frozen || !c.deform.frozenReady) continue;
        frozenSlices++;
        for (const [k, name] of HUBS.entries()) {
          if (c.deform.hubPopped(name)) continue;
          const hub = c.deform.massLocal(name);
          worstWheel = Math.max(worstWheel, wheelOffHub(c, k, hub));
        }
      }
      t += h;
    }
    return { frozenSlices, worstJump, worstWheel };
  } finally {
    for (const [k, c] of rears.entries()) c.maxCrush = rests[k]!;
    setGround(null);
  }
}

