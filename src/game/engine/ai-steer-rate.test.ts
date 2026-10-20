import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CrashEngine } from "./engine.ts";
import { benchRaceEngine, disposeBenchEngine } from "./engine-bench-headless.test-util.ts";
import { FEEL } from "../vehicle/drive-input.ts";
import { THROTTLE_STEPS, type DriveInput } from "../vehicle/car-drive.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { standingBite } from "../vehicle/wheel-bite.ts";
import { QUIET_HZ } from "../kernel/constants.ts";
import { blankPoint } from "../world/track.ts";

const STEP = 1 / QUIET_HZ;
/** Seconds of each scene judged, from its green light. */
const RACE_S = 20;
const SURVIVAL_S = 15;
const DERBY_S = 20;
/** The fewest car-steps a kind must be judged on: a second of one car. */
const FEWEST = QUIET_HZ;

type Kind = "racer" | "traffic" | "police" | "hunter" | "derby";
type Tally = { steps: number; worst: number; at: string };

/** The most a pad player's wheel moves in a step of `dt` s (`FEEL.steerPad`), on the grid `applyDrive` runs it on (a byte: half a step either way). */
function reach(dt: number): number {
  return FEEL.steerPad * dt + 0.5 / THROTTLE_STEPS + 1e-9;
}

/** `applyDrive` runs a car's input this step: its drivetrain alive and a wheel down with bite (else it zeroes the pedals). */
function drives(car: DeformableCar): boolean {
  return car.deform.drivetrainAlive && car.wheelsDown !== 0 && standingBite(car) > 0;
}

/** Which AI driver has car `i` this step (null: the player, a peer, a hold, a coast, or nobody's input reaches the road). */
function aiKind(engine: CrashEngine, i: number): Kind | null {
  const car = engine["live"]()[i]!;
  if (!drives(car)) return null;
  const seat = engine["seat"];
  if (engine.derbyMode) return engine["derby"].winnerId == null && !engine["derbySeated"].has(i) && !(seat.mode === "drive" && seat.carIndex === i) ? "derby" : null;
  const race = engine["race"];
  const s = race["session"];
  if (!race.active || s === null || race["brain"] === null || car.driverOut !== null || race["dormant"][i] === 1) return null;
  if (i >= race["policeFrom"]) return s.phase === "finished" || race["police"] === null ? null : race.survival ? "hunter" : "police";
  if (i >= race["entrants"].length) return race["traffic"] === null ? null : "traffic";
  if (race["entrants"][i]!.kind === "remote" || race["seatDrives"](i)) return null;
  const rec = s.cars[race["rowOf"][i]!]!;
  return (s.phase === "racing" && rec.status === "racing") || rec.status === "finished" ? "racer" : null;
}

/**
 * Every step the engine takes from now: per AI kind, the steps judged and the most the wheel the sim ran (`drive.steer`) moved in one over a pad player's reach (≤ 0: never faster).
 * A car put on a spot since the step before or during the step (a respawn, a start) is not judged on that step or its first step there: it starts with its wheel straight, a jump from the wheel it had where it was.
 */
function watchSteer(engine: CrashEngine): Map<Kind, Tally> {
  const tally = new Map<Kind, Tally>();
  const fixedStep = engine["fixedStep"].bind(engine);
  const kinds: (Kind | null)[] = [];
  const was: number[] = [];
  const placed: number[] = [];
  engine["fixedStep"] = (dt: number): void => {
    const cars = engine["live"]();
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      kinds[i] = placed[i] === car.placements ? aiKind(engine, i) : null;
      placed[i] = car.placements;
      was[i] = car.drive.steer;
    }
    fixedStep(dt);
    for (let i = 0; i < cars.length; i++) {
      const kind = kinds[i];
      if (!kind || cars[i]!.placements !== placed[i]) continue;
      const now = cars[i]!.drive.steer;
      const over = Math.abs(now - was[i]!) - reach(dt);
      const t = tally.get(kind) ?? { steps: 0, worst: -Infinity, at: "" };
      t.steps++;
      if (over > t.worst) {
        t.worst = over;
        t.at = `car ${i}: ${was[i]!.toFixed(3)} to ${now.toFixed(3)} in ${(dt * 1000).toFixed(2)} ms`;
      }
      tally.set(kind, t);
    }
  };
  return tally;
}

function run(engine: CrashEngine, seconds: number): void {
  for (let s = 0; s < Math.round(seconds / STEP); s++) engine.advance(STEP, { frameDt: STEP });
}

function untilGreen(engine: CrashEngine): void {
  for (let i = 0; i < 20 * QUIET_HZ && engine["race"].phase !== "racing"; i++) engine.advance(STEP, { frameDt: STEP });
}

describe("given the real engine's AI drivers, one step at the phone's coarse 1/80 s: the city bench race (racers, traffic, police), a Survival run on the Mall (hunters) and a derby", () => {
  let engine: CrashEngine;
  let tally: Map<Kind, Tally>;
  /** The player's car in the race: per step the seat shaped it, the wheel the seat handed the drive, and the wheel the car ran. */
  const player = { asked: [] as number[], ran: [] as number[], fastest: 0 };
  before(async () => {
    engine = await benchRaceEngine();
    engine.pace.pin = true;
    tally = watchSteer(engine);
    untilGreen(engine);
    run(engine, RACE_S);
    playerDrives(engine, player);
    engine["seat"].mode = "follow";
    engine.toggleSurvival();
    engine.raceCommand({ type: "start" });
    untilGreen(engine);
    run(engine, SURVIVAL_S);
    engine["seat"].mode = "global";
    engine.toggleDerby();
    run(engine, DERBY_S);
  });
  after(() => disposeBenchEngine(engine));

  for (const kind of ["racer", "traffic", "police", "hunter", "derby"] as const) {
    it(`when the ${kind} AI drives, then no car's wheel moves faster than a pad player's ${FEEL.steerPad} of lock a second in any step`, (ctx) => {
      const t = tally.get(kind);
      assert.ok(t !== undefined && t.steps >= FEWEST, `${t?.steps ?? 0} ${kind} car-steps judged`);
      ctx.diagnostic(`${t.steps} car-steps; the fastest: ${t.at}`);
      assert.ok(t.worst <= 0, `${kind}: ${t.at}, ${t.worst.toFixed(3)} of lock past the reach`);
    });
  }

  it("when the player drives the race (keyboard: gas, the wheel held left and right, the handbrake tapped at speed), then every step the car runs the wheel the seat shaped, bit for bit, steps faster than a pad's included", (ctx) => {
    assert.ok(player.ran.length >= 4 * QUIET_HZ, `${player.ran.length} steps judged`);
    ctx.diagnostic(`${player.ran.length} steps; the fastest moved the wheel ${player.fastest.toFixed(3)} in a step`);
    assert.ok(player.fastest > reach(STEP), `the fastest step moved the wheel ${player.fastest.toFixed(3)}: nothing a limiter would have cut`);
    for (let k = 0; k < player.ran.length; k++) assert.equal(player.ran[k], player.asked[k], `step ${k}`);
  });
});

/** Seconds the player drives, and the keys held through them: the wheel swaps sides every `SWAP_S` s and the handbrake is down for `TAP_S` of every second. */
const PLAYER_S = 6;
const SWAP_S = 1.5;
const TAP_S = 0.2;

/** The player starts at rest at the head of the course's straightest stretch this long (m): left where the race had it, car 0 entered the drive at race speed and a wall could throw its driver. */
const PLAYER_ROOM = 100;

/** Car 0 put at rest at the head of the course's straightest `PLAYER_ROOM` m (the stretch whose sharpest bend is the gentlest), facing along it. */
function startOnStraight(engine: CrashEngine, car: DeformableCar): void {
  const race = engine["race"];
  const track = race["track"];
  assert.ok(track !== null, "the race has a course");
  const { curv, count } = track.path;
  const span = Math.ceil((PLAYER_ROOM / track.length) * count);
  let best = 0;
  let gentlest = Infinity;
  for (let k = 0; k < count; k++) {
    let sharpest = 0;
    for (let j = 0; j < span; j++) sharpest = Math.max(sharpest, Math.abs(curv[(k + j) % count]!));
    if (sharpest < gentlest) {
      gentlest = sharpest;
      best = k;
    }
  }
  const pt = track.pointAt((best / count) * track.length, blankPoint());
  race["place"](car, pt.x, pt.z, Math.atan2(pt.tx, pt.tz), pt.y);
}

/** The engine's seat takes car 0 in the race, put on the straight (`startOnStraight`); per step, the wheel it handed the drive (on the byte grid `applyDrive` runs it on) against the wheel the car ran. */
function playerDrives(engine: CrashEngine, out: { asked: number[]; ran: number[]; fastest: number }): void {
  const seat = engine["seat"];
  const car = engine["live"]()[0]!;
  startOnStraight(engine, car);
  seat.focus(0);
  seat.mode = "drive";
  const input = seat.input.bind(seat);
  /** The step's shaped wheel on the byte grid; NaN: the seat did not drive the car this step or `applyDrive` zeroes it (no bite). */
  const shaped = { steer: NaN };
  seat.input = (c, dt): DriveInput => {
    const given = input(c, dt);
    shaped.steer = c === car && drives(car) ? Math.round(Math.max(-1, Math.min(1, given.steer)) * THROTTLE_STEPS) / THROTTLE_STEPS + 0 : NaN;
    return given;
  };
  const keys = engine["keys"];
  keys.clear();
  keys.add("KeyW");
  let last = car.drive.steer;
  for (let s = 0; s < Math.round(PLAYER_S / STEP); s++) {
    const t = s * STEP;
    keys.delete("KeyA");
    keys.delete("KeyD");
    keys.add(Math.floor(t / SWAP_S) % 2 === 0 ? "KeyA" : "KeyD");
    if (t % 1 < TAP_S) keys.add("Space");
    else keys.delete("Space");
    shaped.steer = NaN;
    engine.advance(STEP, { frameDt: STEP });
    if (!Number.isNaN(shaped.steer)) {
      out.asked.push(shaped.steer);
      out.ran.push(car.drive.steer);
      out.fastest = Math.max(out.fastest, Math.abs(car.drive.steer - last));
    }
    last = car.drive.steer;
  }
  keys.clear();
  seat.input = input;
}
