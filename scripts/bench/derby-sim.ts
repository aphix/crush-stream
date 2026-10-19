/**
 * A derby heat for the scenario bench's confirmation rows: `n` AI cars of the fleet's mix on the derby arena through `stepWorld` (the arena's props and walls, `arenaWorld`), every car driven by the
 * derby AI (`DerbyMatch.think`) at frame-sized slices (`physicsSlice`), the derby's own kill rules armed (`armKill`), seeded. No engine, no render. The heat ends when the match does; `run` then
 * stops where it is (a row's window is the sim time actually stepped). The AI drives, so arms may do different work: per-unit rows and the counters.
 */
import * as THREE from "three";
import { DerbyMatch, snapshotAiCar } from "../../src/game/match/derby.ts";
import { DERBY_RADIUS } from "../../src/game/scenes/derby-arena.ts";
import { arenaWorld } from "../../src/game/scenes/derby-arena.test-util.ts";
import { DERBY_FREE_PROPS } from "../../src/game/scenes/derby-ground.ts";
import { fleetStyle, layoutDerby } from "../../src/game/scenes/fleet.ts";
import { INITIAL_HUD } from "../../src/game/hud/hud-store.ts";
import { FRAME_HZ } from "../../src/game/kernel/constants.ts";
import { physicsSlice } from "../../src/game/contact/sat.ts";
import { lap, PHASE, startLaps } from "../../src/game/engine/sim-phases.ts";
import { settleStep, stepWorld, type World } from "../../src/game/engine/world-step.ts";
import { applyAiDrive } from "../../src/game/ai/input-fade.ts";
import { DeformableCar } from "../../src/game/vehicle/car.ts";
import { armKill, assignClass, carClass, HANDLING } from "../../src/game/vehicle/vehicle-classes.ts";
import type { SimLike } from "./sim.ts";

export class DerbySim implements SimLike {
  readonly world: World;
  readonly cars: DeformableCar[];
  readonly stepS = 1 / FRAME_HZ;
  t = 0;
  private readonly match = new DerbyMatch();
  private state = "running";

  constructor(n: number, seed: number) {
    const scene = new THREE.Scene();
    this.cars = Array.from({ length: n }, (_, i) => new DeformableCar({ body: 0xc5c8ce, accent: 0x9aa0a8, name: `c${i}` }, scene, null, fleetStyle(i)));
    let s = seed;
    const rng = (): number => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    const slots = layoutDerby(n, DERBY_RADIUS, rng, DERBY_FREE_PROPS);
    this.match.begin(this.cars.map((_, i) => ({ id: i, name: `c${i}` })), { seed });
    this.world = arenaWorld(this.cars).world;
    for (const [i, c] of this.cars.entries()) {
      c.spawnFacing(slots[i]!.x, slots[i]!.z, slots[i]!.yaw, 0);
      c.deform.squash = INITIAL_HUD.squash;
      c.deform.buckle = INITIAL_HUD.buckle;
      c.deform.setMode(INITIAL_HUD.deformMode);
      const cls = carClass(c);
      assignClass(c, cls);
      armKill(c.deform, cls, HANDLING.realism, "derby");
    }
  }

  /** One AI step of a frame-sized slice. */
  private step(): void {
    const n = this.cars.length;
    let vmax = 8;
    for (const c of this.cars) vmax = Math.max(vmax, c.speed);
    const h = physicsSlice(1 / FRAME_HZ, vmax);
    const phases = this.world.phases;
    startLaps(phases);
    const snaps = this.match.snapshots(n);
    for (const [i, c] of this.cars.entries()) snapshotAiCar(snaps[i]!, i, c, c.deform.drivetrainAlive);
    for (const [i, c] of this.cars.entries()) applyAiDrive(c, this.match.think(snaps[i]!, snaps, h), h);
    lap(phases, PHASE.drive);
    stepWorld(this.world, h);
    lap(phases, PHASE.rules);
    settleStep(this.cars, h, true);
    lap(phases, PHASE.settle);
    this.state = this.match.step(h, this.cars.map((c, i) => ({ id: i, name: `c${i}`, alive: c.deform.drivetrainAlive, x: c.group.position.x, z: c.group.position.z })));
    this.t += h;
  }

  run(seconds: number): void {
    const end = this.t + seconds;
    while (this.state === "running" && this.t < end) this.step();
  }
}
