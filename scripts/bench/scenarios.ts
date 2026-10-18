/**
 * The named scenarios of the scenario bench (`bench.mjs`): each a fixed config on the flat Fleet pad's ground, scripted pedals (no AI), a fixed seed-free layout, one
 * variable apart from its neighbour rows, and the cut it sizes. `build` stages the cars and returns the sim ready for the warm-up; the window's counters then
 * tell what the sim did (`slices`, `liveCarSlices`, `wreckCarSlices`, `frozenCarSlices`, `pairTests`, `pairContacts`, ...). Rows with wrecks stage ONE crash in an
 * isolated zone with every knob off, then move each wreck to its row's place keeping its damage (`relaunchDamaged`), so the two arms of an A/B start from the same bytes.
 */
import { relaunchDamaged, launch } from "../../src/game/contact/crash-scenarios.test-util.ts";
import { makeCar } from "../../src/game/vehicle/ground-probe.test-util.ts";
import { idleDrive, type DriveInput } from "../../src/game/vehicle/car-drive.ts";
import type { VehicleClassId } from "../../src/game/vehicle/vehicle-classes.ts";
import type { DeformableCar } from "../../src/game/vehicle/car.ts";
import { Sim, type SimLike } from "./sim.ts";

const HEAD_X = Math.PI / 2;
/** Cruise speed of the intact rows and of a driving wreck (m/s). */
const CRUISE = 15;
/** The head-on crash of the staging zone: each car's speed, the lateral offset that makes it a glancing 65 % face, the zone's pitch between pairs (m: far outside any reach). */
const CRASH_MPS = 12;
const CRASH_OFFSET = 0.6;
const ZONE_PITCH = 100;
/** Sim seconds a staged wreck rolls on after its crash before it is moved. */
const AFTER_CRASH_S = 2.5;

const gas = (): DriveInput => ({ ...idleDrive(), throttle: 1 });
const brake = (): DriveInput => ({ ...idleDrive(), brake: 1 });
const neutral = (): DriveInput => ({ ...idleDrive(), neutral: true });

export interface Scenario {
  /** Place the cars and give them their pedals (the sim's scripted inputs). */
  build(): SimLike | Promise<SimLike>;
  /** Per-car labels printed with the row (class, state). */
  label(sim: SimLike): string;
}

const cars = (n: number, cls: (i: number) => VehicleClassId): DeformableCar[] => Array.from({ length: n }, (_, i) => makeCar(cls(i)));

/** Cars in one line along z (m apart), all heading +x at `CRUISE` with the throttle held: nobody meets anybody. */
function intactApart(n: number, spacing: number, cls: (i: number) => VehicleClassId): Sim {
  const list = cars(n, cls);
  const sim = new Sim(list, true);
  for (const [i, c] of list.entries()) {
    launch(c, 0, (i - (n - 1) / 2) * spacing, HEAD_X, CRUISE, 0);
    sim.pedals.set(c, gas());
  }
  return sim;
}

/**
 * Cars in a grid of `cols` columns, `along` m apart front to back and `across` m side to side, all at `CRUISE` with the throttle held (a held formation: identical cars,
 * identical pedals, so none meets another): every car has its neighbours inside the lone test's reach (`CONTACT_REACH` + `LONE_MARGIN`).
 */
function intactConvoy(n: number, cols: number, along: number, across: number, cls: (i: number) => VehicleClassId): Sim {
  const list = cars(n, cls);
  const sim = new Sim(list, true);
  for (const [i, c] of list.entries()) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    launch(c, -row * along, (col - (cols - 1) / 2) * across, HEAD_X, CRUISE, 0);
    sim.pedals.set(c, gas());
  }
  return sim;
}

/**
 * The safety row of a tighter lone test: two sedans abeam, 3.5 m apart (hulls 1.6 m clear), side by side at `speed`; the far one holds the throttle and steers across at full lock (steer +1 swings
 * the nose left, towards the other car), so a pair that was not closing at the step's start is in contact a few steps later. Every step it spends near and not yet touching is a step a hull-gap lone
 * test must still cut into slices once the closing begins: the census's false-negative count and the arms' end states say whether it did.
 */
function sideswipe(speed: number): Sim {
  const list = cars(2, sedan);
  const sim = new Sim(list, true);
  launch(list[0]!, 0, 0, HEAD_X, speed, 0);
  launch(list[1]!, 0, 3.5, HEAD_X, speed, 0);
  sim.pedals.set(list[0]!, gas());
  sim.pedals.set(list[1]!, { ...gas(), steer: 1 });
  return sim;
}

/** `n` cars crashed head-on in pairs in the isolated zone, every knob off, until all have crashed and rolled `AFTER_CRASH_S` on: the wrecks, still in the zone. */
function stageWrecks(n: number, cls: (i: number) => VehicleClassId, lone: boolean): Sim {
  const list = cars(n, cls);
  const sim = new Sim(list, lone);
  for (const [i, c] of list.entries()) {
    const pair = Math.floor(i / 2);
    const dir = i % 2 === 0 ? 1 : -1;
    launch(c, -dir * 40, pair * ZONE_PITCH + dir * CRASH_OFFSET, (dir * Math.PI) / 2, dir * CRASH_MPS, 0);
    sim.pedals.set(c, neutral());
  }
  sim.runUntil(() => list.every((c) => c.crashed), 8);
  sim.run(AFTER_CRASH_S);
  return sim;
}

/** What a wreck does in a row: keeps driving (throttle held), stands braked with the drivetrain alive, or stands with the drivetrain dead. */
type Wreck = "driving" | "stopped" | "dead";

/** Move each staged wreck to `place(i)` (x, z, yaw) with its damage, and give it the pedal and drivetrain of `state`. */
function place(sim: Sim, state: Wreck, at: (i: number) => [number, number, number]): Sim {
  for (const [i, c] of sim.cars.entries()) {
    const [x, z, yaw] = at(i);
    relaunchDamaged(c, x, z, yaw, state === "driving" ? CRUISE : 0, 0);
    if (state === "dead") c.deform.drivetrainAlive = false;
    sim.pedals.set(c, state === "driving" ? gas() : state === "stopped" ? brake() : neutral());
  }
  return sim;
}

const apart = (spacing: number) => (i: number): [number, number, number] => [0, (i - 3.5) * spacing, HEAD_X];
/** A pile: 2 columns of 4, centres 4.2 m apart along x (the hulls 4.44 m long: a 0.24 m overlap) and 2.1 m across: the wrecks touch and feed each other lightly, as a settled pile does. */
const piled = (i: number): [number, number, number] => [-(i >> 1) * 4.2, ((i & 1) - 0.5) * 2.1, HEAD_X];
/** The same 8 wrecks thrown together 3.0 m apart (a 1.4 m overlap): the pair pass pushes them apart every slice for a second, a car is thawed by a push in every slice. */
const pushed = (i: number): [number, number, number] => [-(i >> 1) * 3.0, ((i & 1) - 0.5) * 2.1, HEAD_X];

const sedan = (): VehicleClassId => "sedan";
const MIX: readonly VehicleClassId[] = ["sedan", "muscle", "truck", "monster"];
const mixed = (i: number): VehicleClassId => MIX[i % MIX.length]!;

const wreckLabel = (sim: SimLike): string => `${sim.cars.filter((c) => c.crashed).length}/${sim.cars.length} crashed, ${sim.cars.filter((c) => c.deform.drivetrainAlive).length} drivetrains alive`;
const intactLabel = (sim: SimLike): string => `${sim.cars.length} intact, ${sim.cars.filter((c) => c.crashed).length} crashed`;
const cityLabel = (sim: SimLike): string => `${sim.cars.length} cars, ${sim.cars.filter((c) => c.crashed).length} crashed at the start`;
const derbyLabel = (sim: SimLike): string => `${sim.cars.length} derby AI cars`;

export const SCENARIOS: Record<string, Scenario> = {
  "intact-alone": { build: () => intactApart(16, 40, sedan), label: intactLabel },
  "intact-convoy": { build: () => intactConvoy(16, 2, 5, 3.5, sedan), label: intactLabel },
  "intact-convoy-mixed": { build: () => intactConvoy(16, 2, 6, 3.8, mixed), label: intactLabel },
  "wreck-driving-apart": { build: () => place(stageWrecks(8, sedan, true), "driving", apart(40)), label: wreckLabel },
  "wreck-stopped-apart": { build: () => place(stageWrecks(8, sedan, true), "stopped", apart(40)), label: wreckLabel },
  "wreck-dead-apart": { build: () => place(stageWrecks(8, sedan, true), "dead", apart(40)), label: wreckLabel },
  "wreck-dead-piled": { build: () => place(stageWrecks(8, sedan, true), "dead", piled), label: wreckLabel },
  "wreck-pile-pushed": { build: () => place(stageWrecks(8, sedan, true), "dead", pushed), label: wreckLabel },
  "intact-alone-race": { build: () => intactApart(16, 40, sedan).useRaceSchedule(), label: intactLabel },
  "intact-convoy-race": { build: () => intactConvoy(16, 2, 5, 3.5, sedan).useRaceSchedule(), label: intactLabel },
  "wreck-driving-apart-race": { build: () => place(stageWrecks(8, sedan, true), "driving", apart(40)).useRaceSchedule(), label: wreckLabel },
  city: { build: async () => (await import("./engine-sim.ts")).EngineSim.city(false), label: cityLabel },
  "city-race": { build: async () => (await import("./engine-sim.ts")).EngineSim.city(true), label: cityLabel },
  strip: { build: async () => (await import("./engine-sim.ts")).EngineSim.strip(), label: cityLabel },
  "sideswipe-15-race": { build: () => sideswipe(15).useRaceSchedule(), label: intactLabel },
  "sideswipe-30-race": { build: () => sideswipe(30).useRaceSchedule(), label: intactLabel },
  "derby-8-s3": { build: async () => new (await import("./derby-sim.ts")).DerbySim(8, 3), label: derbyLabel },
  "derby-8-s8": { build: async () => new (await import("./derby-sim.ts")).DerbySim(8, 8), label: derbyLabel },
};
