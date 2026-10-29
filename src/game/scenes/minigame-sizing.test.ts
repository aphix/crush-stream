import { afterAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { FREEWHEEL, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { DRIVER_CARS, type DriverCar } from "../match/types.ts";
import { RagdollSystem } from "../present/engine-ragdoll.ts";
import { NO_RELEASE_SCALE, type ReleaseScale } from "../present/ragdoll-boxes.ts";
import { displayFrames } from "../present/range-run.test-util.ts";
import { layOnGround } from "../vehicle/car-air-points.ts";
import { idleDrive, type DriveInput } from "../vehicle/car-drive.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import type { Ejection } from "../vehicle/ejection.ts";
import { activeGround, setGround, type Ground } from "../world/ground.ts";
import { HIGH_JUMP_MEASURED, REST_HOLD, STATION_ANCHORS, THROW_BOOST, type MinigameMode } from "./minigame-constants.ts";
import { BAIL_ELEVATION_DEGREES, BAIL_PERFECT_SECONDS, BAIL_WINDOW_SECONDS, bailRelease, bailVerdict } from "./minigame-bail.ts";
import { JerseyBarrier } from "./engine-props.ts";
import { RANGE } from "./range.ts";
import { MinigameGround } from "./minigame-ground.ts";
import { BOX_NET_CLEARANCE, BOX_PILE_TRAIL, HighJumpPeak, highJumpLayout, POSTS_DISTANCE, type HighJumpMeasured } from "./minigame-high-jump.ts";
import { lipHeight } from "./minigame-profile.ts";
import { dressedDriverCar, heldRagdolls, HOLD_SECONDS, holdHorizontalSpeed, RUN_SECONDS, STALL_SECONDS, STALLED_SPEED, steerAlongLane } from "./minigame-profile.test-util.ts";
import { withoutFrame } from "./minigame-frame.test-util.ts";
import { RING_BACKSTOP, RING_BOARD_BOUNDS, RING_CUPS, ringScore } from "./minigame-ring.ts";
import { must } from "../kernel/must.test-util.ts";

/**
 * Sizing of `THROW_BOOST` and `HIGH_JUMP_MEASURED`: every number here is measured with the real pieces. The car is driven from its parked
 * start on the real `MinigameGround` (the lip's forced throw through `collideHook`), the sim's own Ejection event is taken, and the real
 * `RagdollSystem.launch` throws the dummy with the boost under test and steps him until he lies still. A run is a car type's best (full
 * throttle) or its mid run (its throttle and brake hold its horizontal speed to `MID_RUN_SPEED_SHARE` of the best run's speed at the lip).
 */

/** The net the measurement ground hangs: far past every landing, so it never touches the throws it measures. The posts and slats are the real ones (the pinned best run's layout): a throw meets what the player meets. */
const FAR_NET = { netX: 400, netHalfWidth: 6, netHeight: 14, frame: highJumpLayout(HIGH_JUMP_MEASURED, lipHeight("highJump")) } as const;

const FRAME = 1 / FRAME_HZ;
/**
 * A mid run is governed to this share of the best run's horizontal speed at the lip (the long jump: of its approach speed, the fastest before
 * the barrier). The long jump's is higher because the barrier's hit throws no driver below about 18 m/s (the muscle, truck and monster at 70%
 * of their 24.5-26.7 m/s approach do not throw at all, the monster needs 21.5), so 70% is not a run the game can score.
 */
const MID_RUN_SPEED_SHARE: Readonly<Record<MinigameMode, number>> = { longJump: 0.85, highJump: 0.7, ringFling: 0.7 };
/** A thrown dummy is stepped until his torso has lain still `REST_HOLD` s, or this many sim seconds. */
const THROW_LIMIT_SECONDS = 60;
/** A ragdoll is not bit-deterministic across runs (the display's frame times change his steps): each shipped throw is made this many times, seeded `0` (steady 60 Hz) up, and the worst is held to the bar. */
const REPEATS = 3;
/** How many times each kind of run is thrown: nothing reads a mid run's other seeds but the perfect bail's check, so a shipped measurement throws it once. */
type Throws = { best: number; mid: number };
const SHIPPED_THROWS: Throws = { best: REPEATS, mid: 1 };
const PERFECT_BAIL_THROWS: Throws = { best: REPEATS, mid: REPEATS };
/** A mutation's bar reads only the best runs' first throw. */
const BEST_ONCE: Throws = { best: 1, mid: 0 };
/** His torso has touched down when it is this near (m) the ground under it, after its apex. */
const TOUCHDOWN_HEIGHT = 1;
/** The mutations: forward times this must carry the best runs past the high jump's box piles (and Ring Fling's mid cups), upward times this must lift the monster over the apex band. */
const FORWARD_MUTATION_FACTOR = 1.5;
const UPWARD_MUTATION_FACTOR = 1.1;
/** A recomputed `HIGH_JUMP_MEASURED` number is within this share of the pinned one. */
const MEASURED_TOLERANCE = 0.02;

/**
 * The high jump's bars, on the score: the highest point his torso reaches above the lip inside the band `SCORE_BAND_HALF_DEPTH` either
 * side of the posts' plane (`HighJumpPeak`), measured on the free pad (the posts and slats are taken out of the ragdoll's world:
 * the launch alone). The best class's best run (the frame is set from it) scores in `BEST_HEIGHT_BAND`: the owner's accepted 150-160 m is
 * that run's crossing height at the posts' plane (the table prints both), so the band is 150-160 times the run's score over its crossing
 * height, measured on this throw: not a loosening. Every best run scores at least `BEST_RUN_HEIGHT_MINIMUM` (well up the boards). The old
 * bar was that every class's run at `SLOW_RUN_SHARE` of the full-throttle lip speed still crosses the posts' plane (scores above 0); with
 * the band a run whose apex lies just inside it scores least, so the bar is that an 80% run still scores `SLOW_RUN_HEIGHT_MINIMUM`, under
 * the least of them and well over 0.
 */
const BEST_HEIGHT_BAND = { minimum: 163, maximum: 174 } as const;
const BEST_RUN_HEIGHT_MINIMUM = 60;
const SLOW_RUN_SHARE = 0.8;
const SLOW_RUN_HEIGHT_MINIMUM = 50;
/** With the posts and slats in the world a catch may cost the best class some height, never below the owner's accepted 150 m. */
const FRAMED_BEST_HEIGHT_MINIMUM = 150;
/** The mutation that shrinks the slow runs: upward times this must put an 80% run under the bar. 0.7: with the lip's push the least 80% run scores 96.5 m (the SUV's), and 0.8 left an 80% run over the bar of 50. */
const UPWARD_CUT_FACTOR = 0.7;

/** The five classes whose full-throttle speed at Ring Fling's lip is within 1% of one another (32.2 to 32.5 m/s); the muscle (35.6) and the monster (38.2) are the higher lines. */
const STANDARD_CLASS_IDS: readonly string[] = ["sedan", "truck", "police", "hatch", "suv"];
/** The speed shares of the best run that the Ring Fling sweep walks through. */
const RING_SWEEP = { first: 0.6, last: 1, step: 0.02 } as const;

/**
 * The long jump's bars (m past the barrier), on the landing (the rest is a skid lottery of up to about 35 m on top of it). The range's last sign
 * stands at `signStep * signs` (the field's end), past every perfect landing: the signs run past the best run. A perfect bail lands the
 * farthest class near the far end and every class well down the field; a run with no bail lands mid-field; each farther press lands shorter by
 * a step, and an early press lands as a late one of its distance does (the ragdoll's own scatter is the slack).
 */
const LONG_JUMP_LAST_SIGN = RANGE.signStep * RANGE.signs;
const LONG_JUMP_BEST_BAND = { minimum: 97, maximum: 108 } as const;
const LONG_JUMP_CLASS_MINIMUM = 85;
const LONG_JUMP_NO_BAIL_BAND = { minimum: 42, maximum: 58 } as const;
const LONG_JUMP_FADE_STEP = 8;
const LONG_JUMP_FADE_SLACK = 1;
const LONG_JUMP_EARLY_LATE_GAP = 4;
/** The long jump's mutations: the perfect elevation cut to this (deg) must leave the best run short of the far end; forward times this must carry it past the band. */
const LONG_JUMP_ELEVATION_CUT_DEGREES = 25;
const LONG_JUMP_FORWARD_BOOST = 1.3;

type RunKind = "best" | "mid";

/** One drive's throw: the sim's own Ejection event, the car's velocity as he left, and the horizontal speed (m/s) the run came in at: the lip's, or the fastest before the barrier's hit (the car is slowed by the hit before the event reads its velocity). */
type Capture = { event: Ejection; horizontalSpeed: number; verticalSpeed: number; approachSpeed: number };

function copyEjection(event: Ejection): Ejection {
  return { ...event, pos: event.pos.clone(), local: event.local.clone(), dir: event.dir.clone(), quat: event.quat.clone(), rel: event.rel.clone(), carVel: event.carVel.clone(), spin: event.spin.clone() };
}

const captures = new Map<string, Capture>();

/** The ground of every drive: one instance, so its surface raster is built once. */
const driveGround = new MinigameGround({ highJump: FAR_NET });

/**
 * One car of `type` parked at the station's start on the real ground, left alone, then released at full throttle (the mid run: its throttle
 * and brake hold its horizontal speed to `speedCap`) and steered down the lane's middle until the sim throws its driver: at the lip on the high
 * jump and Ring Fling (`collideHook`), by the hit on the jersey barrier at the world origin on the long jump.
 */
function drive(type: DriverCar, mode: MinigameMode, speedCap: number): Capture {
  const anchor = STATION_ANCHORS[mode];
  setGround(driveGround);
  const car = dressedDriverCar(type);
  try {
    const start = driveGround.stationStart(mode);
    car.spawnFacing(start.x, start.z, start.yaw, 0);
    car.group.position.y = start.y;
    layOnGround(car);
    car.parked = true;
    const world = makeWorld([car], false, false, FREEWHEEL);
    if (mode === "longJump") {
      const barrier = new JerseyBarrier(new THREE.Scene(), new THREE.Group());
      barrier.orient(car.group.position, false);
      world.world.barrier = barrier;
    } else {
      world.world.collide = driveGround.collideHook([car], world.world.ejection!);
    }
    const outcome: { capture: Capture | null } = { capture: null };
    world.onEject = (event) => {
      outcome.capture ??= { event: copyEjection(event), horizontalSpeed: Math.hypot(event.carVel.x, event.carVel.z), verticalSpeed: event.carVel.y, approachSpeed: 0 };
    };
    for (let step = 0; step < HOLD_SECONDS / FRAME; step++) tickWorld(world);
    const input: DriveInput = { ...idleDrive(), throttle: 1 };
    world.pedals.set(car, input);
    let stalledFor = 0;
    let fastestApproach = 0;
    for (let step = 0; step < RUN_SECONDS / FRAME && outcome.capture === null; step++) {
      steerAlongLane(input, car, anchor.z);
      fastestApproach = Math.max(fastestApproach, holdHorizontalSpeed(input, car, speedCap));
      tickWorld(world);
      stalledFor = car.speed < STALLED_SPEED ? stalledFor + FRAME : 0;
      if (stalledFor > STALL_SECONDS) break;
    }
    must(outcome.capture !== null, `${type.id} on ${mode} at cap ${speedCap}: nobody was thrown`);
    outcome.capture.approachSpeed = mode === "longJump" ? fastestApproach : outcome.capture.horizontalSpeed;
    return outcome.capture;
  } finally {
    car.dispose();
    setGround(null);
  }
}

/** The throw of `type` on `mode`: the best run (full throttle) or the mid one (governed to `MID_RUN_SPEED_SHARE` of the best's horizontal speed at the lip). */
function capture(type: DriverCar, mode: MinigameMode, run: RunKind): Capture {
  const key = `${mode}:${type.id}:${run}`;
  let cached = captures.get(key);
  if (cached === undefined) {
    const speedCap = run === "best" ? Infinity : MID_RUN_SPEED_SHARE[mode] * capture(type, mode, "best").approachSpeed;
    cached = drive(type, mode, speedCap);
    captures.set(key, cached);
  }
  return cached;
}

/** A ragdoll system and the ground it was built on: its statics are built once, at its first throw, from the ground active then. */
type RagdollRange = { system: RagdollSystem; ground: Ground };

const systems: RagdollSystem[] = [];
let launchCar: DeformableCar | null = null;

afterAll(() => {
  for (const system of systems.splice(0)) system.dispose();
  launchCar?.dispose();
});

/** `heldRagdolls` on `ground`, disposed after the file; the active ground left flat. */
async function ragdollOn(ground: Ground): Promise<RagdollRange> {
  const system = await heldRagdolls(ground);
  systems.push(system);
  setGround(null);
  return { system, ground };
}

const ranges = new Map<MinigameMode, Promise<RagdollRange>>();

/** The boost is sized on the free pad (the posts and slats taken out of the ragdoll's world: the launch's own numbers); their effect has its own rows. */
function rangeFor(mode: MinigameMode): Promise<RagdollRange> {
  let range = ranges.get(mode);
  if (range === undefined) {
    range = ragdollOn(withoutFrame(new MinigameGround({ highJump: FAR_NET }), FAR_NET.frame));
    ranges.set(mode, range);
  }
  return range;
}

/** What one thrown dummy did, in the station's frame: x past the lip, y above the lip, z off the lane's middle. */
type Flight = {
  apexHeight: number;
  apexDistance: number;
  /** His score: the highest point his torso reached above the lip from the throw until he lay still (`HighJumpPeak`, the score's own rule). */
  height: number;
  /** His torso's height above the lip as it first crossed the posts' plane: the owner's measure of a jump (the band's base, `BEST_HEIGHT_BAND`). */
  crossingHeight: number;
  /** Where his torso first came within `TOUCHDOWN_HEIGHT` of the ground after its apex. */
  landingDistance: number;
  /** Where his torso lay when it had been still `REST_HOLD` s, and its height (m above the pad). */
  restDistance: number;
  restLateral: number;
  restHeight: number;
  still: number;
  /** The launch velocity he left at (m/s, world): the event's, scaled. */
  release: THREE.Vector3;
};

/** `thrown`'s dummy launched through the real `RagdollSystem.launch` with `scale`, stepped (frame times seeded by `seed`) until he lies still. */
function fly(range: RagdollRange, mode: MinigameMode, thrown: Capture, scale: ReleaseScale, seed: number): Flight {
  const { system, ground } = range;
  setGround(ground);
  const anchor = STATION_ANCHORS[mode];
  const lip = lipHeight(mode);
  launchCar ??= dressedDriverCar(DRIVER_CARS[0]!);
  system.holdThrown();
  system.launch(thrown.event, [launchCar], true, scale);
  const dummy = system["dolls"].find((doll) => doll.live)!;
  const launched = dummy.bodies[0]!.linvel();
  const torso = new THREE.Vector3();
  const frameSeconds = displayFrames(FRAME_HZ, seed);
  const peak = new HighJumpPeak();
  const flight: Flight = {
    apexHeight: -Infinity,
    apexDistance: 0,
    height: 0,
    crossingHeight: NaN,
    landingDistance: NaN,
    restDistance: 0,
    restLateral: 0,
    restHeight: 0,
    still: 0,
    release: new THREE.Vector3(launched.x, launched.y, launched.z),
  };
  for (let elapsed = 0; elapsed < THROW_LIMIT_SECONDS && flight.still < REST_HOLD; ) {
    const frameDuration = frameSeconds();
    elapsed += frameDuration;
    system.update(frameDuration, [], true, false, null);
    flight.still = system.latest(torso);
    const distance = torso.x - anchor.x;
    flight.height = peak.step({ x: distance, y: torso.y, z: torso.z - anchor.z, still: flight.still }, POSTS_DISTANCE, lip);
    if (Number.isNaN(flight.crossingHeight) && distance >= POSTS_DISTANCE) flight.crossingHeight = torso.y - lip;
    if (torso.y - lip > flight.apexHeight) {
      flight.apexHeight = torso.y - lip;
      flight.apexDistance = distance;
    }
    const afterApex = flight.apexDistance < distance;
    if (Number.isNaN(flight.landingDistance) && afterApex && torso.y - activeGround().heightAt(torso.x, torso.z, torso.y) <= TOUCHDOWN_HEIGHT) flight.landingDistance = distance;
  }
  flight.restDistance = torso.x - anchor.x;
  flight.restLateral = torso.z - anchor.z;
  flight.restHeight = torso.y;
  system.releaseThrown();
  setGround(null);
  return flight;
}

/** One car type's run on a station with a boost: the drive's throw and every seed's flight. */
type Measurement = { type: DriverCar; run: RunKind; thrown: Capture; flights: Flight[] };

const flights = new Map<string, Flight>();
/** The classes the long jump throws: the monster flies its barrier and lands past it, its driver in (`minigame-profile.test.ts`). */
const LONG_JUMP_CARS = DRIVER_CARS.filter((type) => type.id !== "monster");
const RUN_KINDS = ["best", "mid"] as const;

/** The flight of `type`'s `run` at `seed` with `scale`, made once: every measurement that reads that seed shares it. */
function flightOf(range: RagdollRange, mode: MinigameMode, type: DriverCar, run: RunKind, scale: ReleaseScale, seed: number): Flight {
  const key = `${mode}:${type.id}:${run}:${scale.forward}:${scale.upward}:${scale.elevation}:${seed}`;
  let flight = flights.get(key);
  if (flight === undefined) {
    flight = fly(range, mode, capture(type, mode, run), scale, seed);
    flights.set(key, flight);
  }
  return flight;
}

/** Every class's best and mid run through `mode` with `scale`, thrown `throws` times each; on the long jump, every class but the monster. */
async function measure(mode: MinigameMode, scale: ReleaseScale, throws: Throws): Promise<Measurement[]> {
  const range = await rangeFor(mode);
  const rows: Measurement[] = [];
  for (const type of mode === "longJump" ? LONG_JUMP_CARS : DRIVER_CARS) {
    for (const run of RUN_KINDS) {
      if (throws[run] === 0) continue;
      rows.push({ type, run, thrown: capture(type, mode, run), flights: Array.from({ length: throws[run] }, (_, seed) => flightOf(range, mode, type, run, scale, seed)) });
    }
  }
  return rows;
}

const lowest = (measurement: Measurement, pick: (flight: Flight) => number): number => Math.min(...measurement.flights.map(pick));
const highest = (measurement: Measurement, pick: (flight: Flight) => number): number => Math.max(...measurement.flights.map(pick));
const heightOf = (flight: Flight): number => flight.height;
const landingOf = (flight: Flight): number => flight.landingDistance;
const restOf = (flight: Flight): number => flight.restDistance;

const bestRunsOf = (rows: readonly Measurement[]): Measurement[] => rows.filter((row) => row.run === "best");
const midRunsOf = (rows: readonly Measurement[]): Measurement[] => rows.filter((row) => row.run === "mid");

/** The class whose best run crosses the posts' plane highest: the one the frame is sized to. */
function bestClassRun(rows: readonly Measurement[]): Measurement {
  return bestRunsOf(rows).reduce((best, row) => (lowest(row, heightOf) > lowest(best, heightOf) ? row : best));
}

const scaled = (scale: ReleaseScale, factors: Partial<ReleaseScale>): ReleaseScale => ({ forward: scale.forward * (factors.forward ?? 1), upward: scale.upward * (factors.upward ?? 1), elevation: scale.elevation });
const metres = (value: number): string => value.toFixed(1);

/** What `highJumpLayout` is given from repeat `repeat`: the best class's best score (the highest point he reaches), and the farthest any class's best run lands. */
function measuredBest(rows: readonly Measurement[], repeat: number): HighJumpMeasured {
  return {
    bestHeight: bestClassRun(rows).flights[repeat]!.height,
    landingDistance: Math.max(...bestRunsOf(rows).map((row) => row.flights[repeat]!.landingDistance)),
  };
}

/** What a high jump boost breaks, from every class's best run: empty when every bar holds. */
function highJumpViolations(rows: readonly Measurement[]): string[] {
  const violations: string[] = [];
  const bestClass = bestClassRun(rows);
  // The net's distance past the posts does not depend on any measurement; a boost that never lands the dummy (a NaN landing) has no layout to build.
  const { netX } = highJumpLayout(HIGH_JUMP_MEASURED, lipHeight("highJump"));
  if (lowest(bestClass, heightOf) < BEST_HEIGHT_BAND.minimum) violations.push(`the ${bestClass.type.id}'s best score is ${metres(lowest(bestClass, heightOf))} m, under ${BEST_HEIGHT_BAND.minimum}`);
  if (highest(bestClass, heightOf) > BEST_HEIGHT_BAND.maximum) violations.push(`the ${bestClass.type.id}'s best score is ${metres(highest(bestClass, heightOf))} m, over ${BEST_HEIGHT_BAND.maximum}`);
  for (const row of bestRunsOf(rows)) {
    if (lowest(row, heightOf) < BEST_RUN_HEIGHT_MINIMUM) violations.push(`the ${row.type.id}'s best run scores only ${metres(lowest(row, heightOf))} m`);
    if (highest(row, landingOf) + BOX_PILE_TRAIL > netX - BOX_NET_CLEARANCE) violations.push(`the ${row.type.id}'s best run lands at ${metres(highest(row, landingOf))} m, past the box piles' end (net at ${metres(netX)})`);
  }
  return violations;
}

/** Per class: the score of a best run thrown at `SLOW_RUN_SHARE` of its full-throttle lip speed (the release scaled alike, horizontal and vertical). */
async function slowRunHeights(scale: ReleaseScale): Promise<Map<string, number>> {
  const range = await rangeFor("highJump");
  const slow = scaled(scale, { forward: SLOW_RUN_SHARE, upward: SLOW_RUN_SHARE });
  return new Map(DRIVER_CARS.map((type) => [type.id, fly(range, "highJump", capture(type, "highJump", "best"), slow, 0).height]));
}

/** The classes whose 80% run scores under `SLOW_RUN_HEIGHT_MINIMUM`. */
function slowRunViolations(heights: ReadonlyMap<string, number>): string[] {
  return [...heights].filter(([, height]) => height < SLOW_RUN_HEIGHT_MINIMUM).map(([id, height]) => `the ${id}'s run at ${SLOW_RUN_SHARE * 100}% of full speed scores only ${metres(height)} m, under ${SLOW_RUN_HEIGHT_MINIMUM}`);
}

/** The mid cups' band along the lane (m past the lip): from the 30 cup's near edge to the 40 cup's far edge. */
const MID_CUP_BAND = { near: RING_CUPS[2]!.centreX - RING_CUPS[2]!.radius, far: RING_CUPS[3]!.centreX + RING_CUPS[3]!.radius } as const;
/** The backstop's back face (m past the lip): a resting torso never lies past it. */
const BACKSTOP_BACK_FACE = RING_BOARD_BOUNDS.maxX + RING_BACKSTOP.distancePastBoard + RING_BACKSTOP.thickness;

/** What a Ring Fling boost breaks: the standard classes' full-throttle runs come down in the mid cups' band, and no class's run is carried past the backstop. */
function ringFlingViolations(rows: readonly Measurement[]): string[] {
  const violations: string[] = [];
  for (const row of bestRunsOf(rows)) {
    if (STANDARD_CLASS_IDS.includes(row.type.id)) {
      for (const [name, pick] of [["lands", landingOf], ["rests", restOf]] as const) {
        const near = lowest(row, pick);
        const far = highest(row, pick);
        if (near < MID_CUP_BAND.near || far > MID_CUP_BAND.far) violations.push(`the ${row.type.id}'s full-throttle run ${name} at ${metres(near)} to ${metres(far)} m, outside the mid cups' ${metres(MID_CUP_BAND.near)} to ${metres(MID_CUP_BAND.far)}`);
      }
    }
    if (highest(row, restOf) > BACKSTOP_BACK_FACE) violations.push(`the ${row.type.id}'s full-throttle run rests at ${metres(highest(row, restOf))} m, past the backstop (${metres(BACKSTOP_BACK_FACE)})`);
  }
  return violations;
}

/** What the perfect bail breaks, from every class's best run: empty when every bar holds. The best class is the one whose best run lands farthest (a rest is a skid lottery on top of the landing). */
function perfectBailViolations(rows: readonly Measurement[]): string[] {
  const violations: string[] = [];
  const bestClass = bestRunsOf(rows).reduce((best, row) => (lowest(row, landingOf) > lowest(best, landingOf) ? row : best));
  if (lowest(bestClass, landingOf) < LONG_JUMP_BEST_BAND.minimum) violations.push(`the ${bestClass.type.id}'s best run lands at ${metres(lowest(bestClass, landingOf))} m, short of ${LONG_JUMP_BEST_BAND.minimum} m`);
  if (highest(bestClass, landingOf) > LONG_JUMP_BEST_BAND.maximum) violations.push(`the ${bestClass.type.id}'s best run lands at ${metres(highest(bestClass, landingOf))} m, past ${LONG_JUMP_BEST_BAND.maximum} m`);
  if (highest(bestClass, landingOf) >= LONG_JUMP_LAST_SIGN) violations.push(`the ${bestClass.type.id}'s best run lands at ${metres(highest(bestClass, landingOf))} m, at or past the last sign (${LONG_JUMP_LAST_SIGN} m)`);
  for (const row of bestRunsOf(rows)) {
    if (lowest(row, landingOf) < LONG_JUMP_CLASS_MINIMUM) violations.push(`the ${row.type.id}'s best run lands at ${metres(lowest(row, landingOf))} m, short of ${LONG_JUMP_CLASS_MINIMUM} m`);
  }
  return violations;
}

/** What the mid runs break, with every class's best and mid run: a mid run lands shorter than its class's best run. */
function midRunViolations(rows: readonly Measurement[]): string[] {
  const violations: string[] = [];
  for (const best of bestRunsOf(rows)) {
    const mid = midRunsOf(rows).find((row) => row.type.id === best.type.id)!;
    if (lowest(best, landingOf) <= highest(mid, landingOf)) violations.push(`the ${best.type.id}'s mid run lands at ${metres(highest(mid, landingOf))} m, no shorter than its best run's ${metres(lowest(best, landingOf))} m`);
  }
  return violations;
}

/** What a run with no bail breaks: every class's best run lands mid-field. */
function noBailViolations(rows: readonly Measurement[]): string[] {
  const violations: string[] = [];
  for (const row of bestRunsOf(rows)) {
    if (lowest(row, landingOf) < LONG_JUMP_NO_BAIL_BAND.minimum) violations.push(`the ${row.type.id}'s no-bail run lands at ${metres(lowest(row, landingOf))} m, short of ${LONG_JUMP_NO_BAIL_BAND.minimum} m`);
    if (highest(row, landingOf) > LONG_JUMP_NO_BAIL_BAND.maximum) violations.push(`the ${row.type.id}'s no-bail run lands at ${metres(highest(row, landingOf))} m, past ${LONG_JUMP_NO_BAIL_BAND.maximum} m`);
  }
  return violations;
}

/**
 * What the fade breaks, per class's best run: the landing never grows with the press's distance (the slack is the ragdoll's own scatter in
 * where a touchdown is read), it falls by a step across each of the coarse stages (perfect, 0.1 s, 0.2 s, no press), and an early press lands
 * as a late one of its distance does.
 */
function fadeViolations(byOffset: ReadonlyMap<number | null, readonly Measurement[]>): string[] {
  const violations: string[] = [];
  const landingAt = (offset: number | null, id: string): number => bestRunsOf(byOffset.get(offset)!).find((row) => row.type.id === id)!.flights[0]!.landingDistance;
  const distances = [0, 0.05, 0.1, 0.2];
  for (const type of LONG_JUMP_CARS) {
    const stages = distances.map((distance) => (landingAt(-distance, type.id) + landingAt(distance, type.id)) / 2);
    stages.push(landingAt(null, type.id));
    for (let at = 1; at < stages.length; at++) {
      if (stages[at]! > stages[at - 1]! + LONG_JUMP_FADE_SLACK) violations.push(`the ${type.id}'s landing grows from fade stage ${at - 1} to ${at}: ${metres(stages[at - 1]!)} to ${metres(stages[at]!)} m`);
    }
    const coarse = [stages[0]!, stages[2]!, stages[3]!, stages[4]!];
    for (let at = 1; at < coarse.length; at++) {
      if (coarse[at - 1]! - coarse[at]! < LONG_JUMP_FADE_STEP) violations.push(`the ${type.id}'s landing falls only ${metres(coarse[at - 1]! - coarse[at]!)} m across coarse stage ${at}, under ${LONG_JUMP_FADE_STEP} m`);
    }
    for (const distance of distances.slice(1)) {
      const gap = Math.abs(landingAt(-distance, type.id) - landingAt(distance, type.id));
      if (gap > LONG_JUMP_EARLY_LATE_GAP) violations.push(`the ${type.id}'s early and late ${distance} s presses land ${metres(gap)} m apart, over ${LONG_JUMP_EARLY_LATE_GAP} m`);
    }
  }
  return violations;
}

/** One compact line per run: lip speed (horizontal/vertical), release speed (horizontal/vertical), apex (height @ distance), first touchdown, rest, and `zone`. */
function tableOf(rows: readonly Measurement[], zone: (flight: Flight) => string): string {
  return rows
    .map((row) => {
      const flight = row.flights[0]!;
      const release = `${metres(Math.hypot(flight.release.x, flight.release.z))}/${metres(flight.release.y)}`;
      return `| ${row.type.id} | ${row.run} | ${metres(row.thrown.horizontalSpeed)}/${metres(row.thrown.verticalSpeed)} | ${release} | ${metres(flight.apexHeight)} @ ${metres(flight.apexDistance)} | ${metres(flight.landingDistance)} | ${metres(flight.restDistance)} | ${zone(flight)} |`;
    })
    .join("\n");
}

const TABLE_HEADER = "| class | run | lip h/v (m/s) | release h/v (m/s) | apex (m @ m) | lands (m) | rests (m) | zone |";

describe("given the high jump with THROW_BOOST.highJump on the free pad (no frame in the ragdoll's world), with the real car, ground and ragdoll", () => {
  it("when each of the 7 classes' best and mid runs is thrown, then the best class scores 163-174 m, every class's best run is well up the boards and lands in the box field, and every class's 80% run still scores 50 m", async (t) => {
    const rows = await measure("highJump", THROW_BOOST.highJump, SHIPPED_THROWS);
    const slowRuns = await slowRunHeights(THROW_BOOST.highJump);
    const layout = highJumpLayout(measuredBest(rows, 0), lipHeight("highJump"));
    const slowLines = [...slowRuns].map(([id, height]) => `${id} ${metres(height)} m`).join(", ");
    t.annotate(`THROW_BOOST.highJump ${JSON.stringify(THROW_BOOST.highJump)}; posts ${layout.postsX} m, net ${layout.netX} m, box piles end ${metres(layout.boxes.reduce((end, box) => Math.max(end, box.x), 0))} m, frame top ${layout.frameTop} m\nscore of a run at ${SLOW_RUN_SHARE * 100}% of full lip speed: ${slowLines}\n${TABLE_HEADER}\n${tableOf(rows, (flight) => `scores ${metres(flight.height)} m, crosses the posts' plane at ${metres(flight.crossingHeight)} m`)}`);
    expect(highJumpViolations(rows)).toHaveLength(0);
    expect(slowRunViolations(slowRuns)).toHaveLength(0);
  });

  it("when the boost is the identity (the throw as the sim has it), then the bars break: the best class scores far under the band and every landing is far past the net", async () => {
    const violations = highJumpViolations(await measure("highJump", NO_RELEASE_SCALE, BEST_ONCE));
    expect(violations.some((violation) => violation.includes("best score")), violations.join("; ")).toBeTruthy();
    expect(violations.some((violation) => violation.includes("past the box piles")), violations.join("; ")).toBeTruthy();
  });

  it(`when forward is ${FORWARD_MUTATION_FACTOR} times the chosen, then the best runs land past the box piles' end (the window holds only at the chosen forward)`, async () => {
    const violations = highJumpViolations(await measure("highJump", scaled(THROW_BOOST.highJump, { forward: FORWARD_MUTATION_FACTOR }), BEST_ONCE));
    expect(violations.some((violation) => violation.includes("past the box piles")), violations.join("; ")).toBeTruthy();
  });

  it(`when upward is ${UPWARD_MUTATION_FACTOR} times the chosen, then the best class scores over the band`, async () => {
    const violations = highJumpViolations(await measure("highJump", scaled(THROW_BOOST.highJump, { upward: UPWARD_MUTATION_FACTOR }), BEST_ONCE));
    expect(violations.some((violation) => violation.includes("best score") && violation.includes("over")), violations.join("; ")).toBeTruthy();
  });

  it(`when upward is ${UPWARD_CUT_FACTOR} times the chosen, then the 80% runs no longer score ${SLOW_RUN_HEIGHT_MINIMUM} m`, async () => {
    const violations = slowRunViolations(await slowRunHeights(scaled(THROW_BOOST.highJump, { upward: UPWARD_CUT_FACTOR })));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("when the best class's best run is thrown again, then HIGH_JUMP_MEASURED is its crossing height and the farthest best landing, within 2%", async () => {
    const rows = await measure("highJump", THROW_BOOST.highJump, SHIPPED_THROWS);
    for (let repeat = 0; repeat < REPEATS; repeat++) {
      const measured = measuredBest(rows, repeat);
      for (const key of ["bestHeight", "landingDistance"] as const) {
        expect(Math.abs(measured[key] - HIGH_JUMP_MEASURED[key]), `${key}: measured ${metres(measured[key])} against pinned ${HIGH_JUMP_MEASURED[key]}`).toBeLessThanOrEqual(MEASURED_TOLERANCE * HIGH_JUMP_MEASURED[key]);
      }
    }
  });
});

/** The slats catch: at least one class's best run scores this much (m) less with the posts and slats in the ragdoll's world than on the free pad. */
const FRAME_COSTS_BY = 5;

/** Every class's best run thrown at the framed ground (the real posts and slats are colliders), once at the ragdoll's steady 60 Hz. */
async function framedBestRuns(): Promise<Measurement[]> {
  const range = await ragdollOn(new MinigameGround({ highJump: FAR_NET }));
  return DRIVER_CARS.map((type) => {
    const thrown = capture(type, "highJump", "best");
    return { type, run: "best", thrown, flights: [fly(range, "highJump", thrown, THROW_BOOST.highJump, 0)] };
  });
}

/** What the frame breaks, from every class's best run with it in the world: empty when every bar holds. The landing is not asked: a run caught on the frame falls back short of the posts. */
function framedViolations(rows: readonly Measurement[]): string[] {
  const violations: string[] = [];
  const bestClass = bestClassRun(rows);
  if (lowest(bestClass, heightOf) < FRAMED_BEST_HEIGHT_MINIMUM) violations.push(`the ${bestClass.type.id}'s best score is ${metres(lowest(bestClass, heightOf))} m, under ${FRAMED_BEST_HEIGHT_MINIMUM} with the frame`);
  for (const row of bestRunsOf(rows)) {
    if (lowest(row, heightOf) < BEST_RUN_HEIGHT_MINIMUM) violations.push(`the ${row.type.id}'s best run scores only ${metres(lowest(row, heightOf))} m with the frame`);
  }
  return violations;
}

describe("given the high jump's posts and slats as ragdoll colliders, with the real car and ragdoll", () => {
  it("when each class's best run is thrown at them, then the best class still scores at least 150 m, every best run still scores well up the boards, and the frame costs at least one run some height against the free pad", async (t) => {
    const framed = await framedBestRuns();
    const free = bestRunsOf(await measure("highJump", THROW_BOOST.highJump, BEST_ONCE));
    const cost = framed.map((row) => free.find((candidate) => candidate.type.id === row.type.id)!.flights[0]!.height - row.flights[0]!.height);
    t.annotate(`with the frame (score on the free pad minus score with it: ${framed.map((row, index) => `${row.type.id} ${metres(cost[index]!)} m`).join(", ")}; lands NaN: caught on the frame, he falls back short of his apex's distance)\n${TABLE_HEADER}\n${tableOf(framed, (flight) => `scores ${metres(flight.height)} m`)}`);
    expect(framedViolations(framed)).toHaveLength(0);
    expect(Math.max(...cost), `no best run scores ${FRAME_COSTS_BY} m less with the frame: ${cost.map((gap) => metres(gap)).join(", ")}`).toBeGreaterThanOrEqual(FRAME_COSTS_BY);
  });
});

describe("given Ring Fling with THROW_BOOST.ringFling on the real ground, car and ragdoll", () => {
  it("when each of the 7 classes' best and mid runs is thrown, then the standard classes' full-throttle runs come down in the mid cups and the backstop holds the rest", async (t) => {
    const rows = await measure("ringFling", THROW_BOOST.ringFling, SHIPPED_THROWS);
    t.annotate(`THROW_BOOST.ringFling ${JSON.stringify(THROW_BOOST.ringFling)}\n${TABLE_HEADER}\n${tableOf(rows, (flight) => `cup ${ringScore(flight.restDistance, flight.restLateral)}`)}`);
    expect(ringFlingViolations(rows)).toHaveLength(0);
  });

  it("when the boost is the identity (the throw as the sim has it), then every full-throttle run is carried far past the board", async () => {
    const violations = ringFlingViolations(await measure("ringFling", NO_RELEASE_SCALE, BEST_ONCE));
    expect(violations.some((violation) => violation.includes("outside the mid cups")), violations.join("; ")).toBeTruthy();
  });

  it(`when forward is ${FORWARD_MUTATION_FACTOR} times the chosen, then the standard classes' full-throttle runs overshoot the mid cups`, async () => {
    const violations = ringFlingViolations(await measure("ringFling", scaled(THROW_BOOST.ringFling, { forward: FORWARD_MUTATION_FACTOR }), BEST_ONCE));
    expect(violations.some((violation) => violation.includes("outside the mid cups")), violations.join("; ")).toBeTruthy();
  });

  it("when the sedan's best run is slowed from full throttle down to 60% of its speed, then the 10, 20 and 30 cups each hold a rest at some speed", async (t) => {
    const range = await rangeFor("ringFling");
    const sedan = DRIVER_CARS.find((type) => type.id === "sedan")!;
    const thrown = capture(sedan, "ringFling", "best");
    const sweepRows: string[] = [];
    const cupsHeld = new Set<number>();
    for (let share = RING_SWEEP.first; share <= RING_SWEEP.last + 1e-9; share += RING_SWEEP.step) {
      const flight = fly(range, "ringFling", thrown, scaled(THROW_BOOST.ringFling, { forward: share, upward: share }), 0);
      const cup = ringScore(flight.restDistance, flight.restLateral);
      sweepRows.push(`${share.toFixed(2)} x lip speed (${metres(share * thrown.horizontalSpeed)} m/s): lands ${metres(flight.landingDistance)} rests ${metres(flight.restDistance)} cup ${cup}`);
      if (cup > 0) cupsHeld.add(cup);
    }
    t.annotate(`lip speed share -> where the sedan's dummy lands:\n${sweepRows.join("\n")}`);
    for (const cup of [10, 20, 30]) expect(cupsHeld.has(cup), `no run in the sweep rested in the ${cup} cup: ${[...cupsHeld].join(", ")}`).toBeTruthy();
  });
});

/** The bail offsets the long jump table walks, press minus hit in seconds (null: no press). Early and late of one distance earn the same launch. */
const BAIL_OFFSETS = [0, -0.05, 0.05, -0.1, 0.1, -0.2, 0.2, null] as const;

/** What the bail does at `offsetSeconds`: the long jump's release the bail module makes of that press. */
function releaseAtOffset(offsetSeconds: number | null): ReleaseScale {
  return bailRelease(THROW_BOOST.longJump, bailVerdict(offsetSeconds).quality);
}

const offsetName = (offset: number | null): string => (offset === null ? "no press" : offset === 0 ? "perfect" : `${offset > 0 ? "+" : ""}${offset.toFixed(2)} s`);

/** Per class, the best run's landing and rest (m) at every bail offset: one line a class. */
function bailTable(byOffset: ReadonlyMap<number | null, readonly Measurement[]>): string {
  const header = `| class | ${BAIL_OFFSETS.map(offsetName).join(" | ")} |`;
  const lines = LONG_JUMP_CARS.map((type) => {
    const cells = BAIL_OFFSETS.map((offset) => {
      const flight = bestRunsOf(byOffset.get(offset)!).find((row) => row.type.id === type.id)!.flights[0]!;
      return `${metres(flight.landingDistance)} / ${metres(flight.restDistance)}`;
    });
    return `| ${type.id} | ${cells.join(" | ")} |`;
  });
  return `lands / rests (m), best run\n${header}\n${lines.join("\n")}`;
}

/** The perfect bail's mid runs are read at every seed (`midRunViolations`) and the no-press runs' best at the worst of `REPEATS`; every other offset is read at its first seed (`fadeViolations`). */
const throwsAtOffset = (offset: number | null): Throws => (offset === 0 ? PERFECT_BAIL_THROWS : offset === null ? SHIPPED_THROWS : BEST_ONCE);

async function bailMeasurements(): Promise<Map<number | null, Measurement[]>> {
  const byOffset = new Map<number | null, Measurement[]>();
  for (const offset of BAIL_OFFSETS) byOffset.set(offset, await measure("longJump", releaseAtOffset(offset), throwsAtOffset(offset)));
  return byOffset;
}

describe("given the long jump's timed bail with THROW_BOOST.longJump on the real ground, car, barrier and ragdoll", () => {
  it("when the best and mid run of every class the long jump throws (all but the monster, which flies the barrier) is thrown at each bail offset, then the perfect bail lands the best class near the far end short of the last sign, every no-press run lands mid-field, and the metres fade smoothly and alike for an early and a late press", async (t) => {
    const byOffset = await bailMeasurements();
    const perfect = byOffset.get(0)!;
    const none = byOffset.get(null)!;
    t.annotate(`THROW_BOOST.longJump ${JSON.stringify(THROW_BOOST.longJump)}; bail window ${BAIL_WINDOW_SECONDS} s, perfect within ${BAIL_PERFECT_SECONDS} s\n${bailTable(byOffset)}\nperfect, all runs\n${TABLE_HEADER}\n${tableOf(perfect, (flight) => `sign ${Math.min(LONG_JUMP_LAST_SIGN, Math.floor(flight.restDistance / RANGE.signStep) * RANGE.signStep)} m`)}\nno press, all runs\n${TABLE_HEADER}\n${tableOf(none, (flight) => `sign ${Math.min(LONG_JUMP_LAST_SIGN, Math.floor(flight.restDistance / RANGE.signStep) * RANGE.signStep)} m`)}`);
    expect(perfectBailViolations(perfect), "the perfect bail").toHaveLength(0);
    expect(midRunViolations(perfect), "the mid runs").toHaveLength(0);
    expect(noBailViolations(none), "no bail").toHaveLength(0);
    expect(fadeViolations(byOffset), "the fade").toHaveLength(0);
  });

  it("when the boost is the identity (the throw as the sim has it), then the perfect bar breaks: the best run is far short of the far end", async () => {
    const violations = perfectBailViolations(await measure("longJump", NO_RELEASE_SCALE, BEST_ONCE));
    expect(violations.some((violation) => violation.includes("best run lands") && violation.includes("short of")), violations.join("; ")).toBeTruthy();
  });

  it(`when the perfect elevation is ${LONG_JUMP_ELEVATION_CUT_DEGREES} degrees instead of ${BAIL_ELEVATION_DEGREES.perfect}, then the perfect run falls short of the far end`, async () => {
    const cut = { ...releaseAtOffset(0), elevation: LONG_JUMP_ELEVATION_CUT_DEGREES * (Math.PI / 180) };
    const violations = perfectBailViolations(await measure("longJump", cut, BEST_ONCE));
    expect(violations.some((violation) => violation.includes("best run lands") && violation.includes("short of")), violations.join("; ")).toBeTruthy();
  });

  it(`when forward is ${LONG_JUMP_FORWARD_BOOST} times the chosen, then the perfect run is carried past the far end's band`, async () => {
    const violations = perfectBailViolations(await measure("longJump", scaled(releaseAtOffset(0), { forward: LONG_JUMP_FORWARD_BOOST }), BEST_ONCE));
    expect(violations.some((violation) => violation.includes("best run lands") && violation.includes("past")), violations.join("; ")).toBeTruthy();
  });

  it("when no bail is pressed but the elevation is the perfect one, then the no-bail bar breaks: the run lands far past mid-field", async () => {
    const violations = noBailViolations(await measure("longJump", bailRelease(THROW_BOOST.longJump, 1), BEST_ONCE));
    expect(violations.some((violation) => violation.includes("past")), violations.join("; ")).toBeTruthy();
  });
});
