import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DRIVER_CARS } from "../match/types.ts";
import {
  DEGREES_TO_RADIANS,
  HIGH_JUMP_KICKER,
  LIP_BACK_FACE_PITCH_DEGREES,
  LONG_JUMP_INCLINE,
  MINIGAME_MODES,
  RING_FLING_LANE,
  RUN_UP_LENGTH,
  START_HILL_LENGTH,
  START_HILL,
  STATION_ANCHORS,
  STATION_HALF_WIDTH,
  THROW_YAW,
  type MinigameMode,
} from "./minigame-constants.ts";
import { climbFootX, floorHeightAt, lipHeight, stationBackX, stationFrontX, stationStartPose } from "./minigame-profile.ts";
import {
  capForLipSpeed,
  driveIntoBarrier,
  driveToBarrier,
  driveToLip,
  FINE_CELL,
  lipPitch,
  highJumpVariant,
  lipFlight,
  longJumpVariant,
  ProfileGround,
  stationDriveProfile,
  type BarrierRun,
  type BarrierHit,
  type ClimbRun,
  type DriveProfile,
  type LipFlight,
  type LongJumpDesign,
  MINIMUM_SPEED,
} from "./minigame-profile.test-util.ts";
import { BARRIER_HALF } from "../contact/sat.ts";
import { RANGE } from "./range.ts";

/** High jump: the least ballistic apex (m above the lip) any driver car's unboosted throw must reach at full throttle: every class gets over several boards. */
const HIGH_JUMP_MIN_APEX = 40;

/** Metres between the samples that the floor's continuity is read at. */
const READ_STEP = 0.05;
/** The grid may be this far (m) from the analytic floor. */
const GRID_TOLERANCE = 0.002;
/** A parked car on the start hill's pad slides no further than this (m) in the seconds it is left alone: the hill holds it. */
const PARKED_SLIDE_LIMIT = 0.5;
/** The steepest face (deg) a parked car is pinned to hold on (`vehicle/ramp.test.ts`'s wedges are 10, 20 and 30). */
const PARKED_HOLD_DEGREES = 20;
/** The slowest (m/s) any class may carry through the climb's last stretch, below its bar: it never stalls. */
const CLIMB_STALL_ALLOWANCE = 1;


function table(rows: readonly (readonly [string, ClimbRun])[]): string {
  return rows.map(([label, run]) => `${label.padEnd(9)} reached ${run.reachedLip} foot ${run.footSpeed.toFixed(1)} lip nose ${run.lipSpeed.toFixed(1)} centre ${run.lipCentreSpeed.toFixed(1)} slowest ${run.slowestOnClimb.toFixed(1)} m/s`).join("\n");
}

const floorSamples = (mode: MinigameMode, step: number): number[] => {
  const heights: number[] = [];
  for (let localX = stationBackX(mode); localX <= stationFrontX(mode) + 1; localX += step) heights.push(floorHeightAt(mode, localX, 0));
  return heights;
};

describe("given each station's floor read every 5 cm from the back of its pad to past its lip", () => {
  const testCases = [
    { it: "when the long jump's floor is read, then no step is taller than its steepest slope (the start hill) allows", mode: "longJump", steepestDegrees: PARKED_HOLD_DEGREES },
    { it: "when the high jump's floor is read, then no step is taller than its steepest slope (the back face) allows", mode: "highJump", steepestDegrees: LIP_BACK_FACE_PITCH_DEGREES },
    { it: "when Ring Fling's floor is read, then no step is taller than its steepest slope (the back face) allows", mode: "ringFling", steepestDegrees: LIP_BACK_FACE_PITCH_DEGREES },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const heights = floorSamples(testCase.mode, READ_STEP);
      const allowed = READ_STEP * Math.tan(testCase.steepestDegrees * DEGREES_TO_RADIANS) * 1.001;
      let tallest = 0;
      for (let i = 1; i < heights.length; i++) tallest = Math.max(tallest, Math.abs(heights[i]! - heights[i - 1]!));
      assert.ok(heights.length >= Math.floor((stationFrontX(testCase.mode) - stationBackX(testCase.mode)) / READ_STEP), `${heights.length} samples`);
      assert.ok(tallest <= allowed, `tallest step ${tallest} m against ${allowed} m`);
      assert.ok(tallest >= allowed * 0.1, `tallest step ${tallest} m: the floor is not flat`);
    });
  }
});

describe("given each station's lip", () => {
  const testCases = [
    { it: "when the long jump's lip is read, then the floor is exactly the pad's level and level", mode: "longJump", lipHeightMin: 0, lipHeightMax: 0, lipPitchMinDegrees: 0, lipPitchMaxDegrees: 0 },
    { it: "when the high jump's lip is read, then it stands 8 to 11 m up and its floor climbs at 55 to 65 degrees", mode: "highJump", lipHeightMin: 8, lipHeightMax: 11, lipPitchMinDegrees: 55, lipPitchMaxDegrees: 65 },
    { it: "when Ring Fling's lip is read, then it stands under 1.5 m up and its floor climbs at 22 to 30 degrees", mode: "ringFling", lipHeightMin: 0.5, lipHeightMax: 1.5, lipPitchMinDegrees: 22, lipPitchMaxDegrees: 30 },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const height = lipHeight(testCase.mode);
      const pitchDegrees = lipPitch(testCase.mode) / DEGREES_TO_RADIANS;
      const lastCentimetre = Math.atan((floorHeightAt(testCase.mode, 0, 0) - floorHeightAt(testCase.mode, -0.01, 0)) / 0.01) / DEGREES_TO_RADIANS;
      assert.equal(height, floorHeightAt(testCase.mode, 0, 0), "lip height is the floor's at x = 0");
      assert.ok(height >= testCase.lipHeightMin && height <= testCase.lipHeightMax, `lip height ${height}`);
      assert.ok(pitchDegrees >= testCase.lipPitchMinDegrees && pitchDegrees <= testCase.lipPitchMaxDegrees, `lip pitch ${pitchDegrees} deg`);
      assert.ok(Math.abs(pitchDegrees - lastCentimetre) < 0.1, `lip pitch ${pitchDegrees} deg against the floor's last centimetre ${lastCentimetre} deg`);
    });
  }

  it("when the long jump's last metres are read, then the floor is exactly level with the pad from the flat tail on, where the barrier stands", () => {
    for (let localX = -LONG_JUMP_INCLINE.flatTail; localX <= 1; localX += 0.1) assert.equal(floorHeightAt("longJump", localX, 0), 0, `x = ${localX}`);
    assert.ok(floorHeightAt("longJump", -LONG_JUMP_INCLINE.flatTail - LONG_JUMP_INCLINE.length - 20, 0) < -1, "the run-up before the incline lies below the pad");
  });

  it("when the high jump's and Ring Fling's lips are compared, then the high jump's floor climbs at least 8 degrees steeper than Ring Fling's and than the long jump's incline", () => {
    const STEEPER_BY_DEGREES = 8;
    const highJumpDegrees = lipPitch("highJump") / DEGREES_TO_RADIANS;
    assert.ok(highJumpDegrees >= lipPitch("ringFling") / DEGREES_TO_RADIANS + STEEPER_BY_DEGREES, `high jump ${highJumpDegrees} deg against Ring Fling ${lipPitch("ringFling") / DEGREES_TO_RADIANS}`);
    assert.ok(highJumpDegrees >= LONG_JUMP_INCLINE.pitchDegrees + STEEPER_BY_DEGREES, `high jump ${highJumpDegrees} deg against the long jump's incline ${LONG_JUMP_INCLINE.pitchDegrees}`);
  });

  it("when Ring Fling's hop is read, then it is the machine's 3.35 in on a 120 in lane scaled to this lane", () => {
    const laneLength = RING_FLING_LANE.inclineLength + RING_FLING_LANE.hopLength;
    const hopStartX = -RING_FLING_LANE.hopLength;
    const hopHeight = floorHeightAt("ringFling", 0, 0) - floorHeightAt("ringFling", hopStartX, 0);
    const expected = (laneLength * RING_FLING_LANE.machineHopInches) / RING_FLING_LANE.machineLaneInches + RING_FLING_LANE.hopLength * Math.tan(RING_FLING_LANE.inclinePitchDegrees * DEGREES_TO_RADIANS);
    assert.ok(Math.abs(hopHeight - expected) < 0.01, `hop ${hopHeight} m against ${expected} m`);
  });

  it("when the high jump's and Ring Fling's lips are passed, then the floor falls away behind them at the back face's pitch to the landing's level", () => {
    for (const mode of ["highJump", "ringFling"] as const) {
      const run = stationFrontX(mode);
      const fall = lipHeight(mode) - floorHeightAt(mode, run / 2, 0);
      assert.ok(Math.abs(Math.atan(fall / (run / 2)) / DEGREES_TO_RADIANS - LIP_BACK_FACE_PITCH_DEGREES) < 0.01, `${mode} back face`);
      assert.equal(floorHeightAt(mode, run + 0.5, 0), 0, `${mode} landing`);
    }
  });
});

describe("given each station's start", () => {
  for (const mode of MINIGAME_MODES) {
    it(`when the ${mode} start is read, then the car stands on the flat pad facing the throw and the hill from it falls no steeper than a parked car holds on`, () => {
      const start = stationStartPose(mode);
      const backX = stationBackX(mode);
      assert.equal(start.yaw, THROW_YAW, "faces the throw");
      assert.equal(start.z, 0, "on the lane's middle");
      assert.ok(start.x >= backX + 1 && start.x <= backX + START_HILL.padLength - 1, `start x ${start.x} on the pad from ${backX}`);
      for (let localX = backX; localX <= backX + START_HILL.padLength; localX += 0.5) assert.equal(floorHeightAt(mode, localX, 0), 0, `pad at ${localX}`);
      let steepest = 0;
      for (let localX = backX; localX <= climbFootX(mode) - RUN_UP_LENGTH[mode]; localX += 0.1) {
        steepest = Math.max(steepest, Math.abs(floorHeightAt(mode, localX + 0.1, 0) - floorHeightAt(mode, localX, 0)) / 0.1);
      }
      assert.ok(steepest > 0.05, `the start hill's steepest slope ${steepest}: there is a hill`);
      assert.ok(steepest <= Math.tan(PARKED_HOLD_DEGREES * DEGREES_TO_RADIANS), `start hill slope ${steepest}`);
    });
  }

  it("when the stations' anchors are read, then each lane's strip is clear of the others and of the range's landing field", () => {
    const strips = MINIGAME_MODES.map((mode) => ({ low: STATION_ANCHORS[mode].z - STATION_HALF_WIDTH, high: STATION_ANCHORS[mode].z + STATION_HALF_WIDTH }));
    assert.equal(STATION_ANCHORS.longJump.z, 0, "the long jump's lip is the world origin, where the jersey barrier is");
    assert.equal(STATION_ANCHORS.longJump.x, 0, "the long jump's lip is the world origin, where the jersey barrier is");
    for (const next of [strips[1]!, strips[2]!]) assert.ok(next.low > RANGE.halfWidth, `strip from z = ${next.low} clear of the range's field to ${RANGE.halfWidth}`);
    assert.ok(strips[2]!.low > strips[1]!.high, "the high jump's and Ring Fling's strips do not overlap");
  });
});

describe("given a grid of cell 5 cm laid over each station's floor", () => {
  for (const mode of MINIGAME_MODES) {
    it(`when the ${mode} grid is read between its nodes, then it is within 2 mm of the analytic floor except within a cell of the lip's and back face's creases, and (high jump) a grid of cell 1 m is not`, () => {
      /** A cell (m) coarse enough that the bilinear grid is over the tolerance off the kicker's arc (radius 30 m: its sag is about cell squared over 4 radii). */
      const COARSE_CELL = 1;
      const worst = (cell: number): { smooth: number; crease: number } => {
        const ground = new ProfileGround(stationDriveProfile(mode), cell);
        const result = { smooth: 0, crease: 0 };
        for (let localX = stationBackX(mode) + 0.3; localX <= stationFrontX(mode) + 0.3; localX += 0.0137) {
          const nearCrease = Math.abs(localX) <= cell * 1.5 || Math.abs(localX - stationFrontX(mode)) <= cell * 1.5;
          for (const localZ of [-1.3, 0, 0.9]) {
            const analytic = floorHeightAt(mode, localX, localZ);
            const error = Math.abs(ground.heightAt(localX, localZ, analytic + 0.5) - analytic);
            if (nearCrease) result.crease = Math.max(result.crease, error);
            else result.smooth = Math.max(result.smooth, error);
          }
        }
        return result;
      };
      const fine = worst(FINE_CELL);
      assert.ok(fine.smooth <= GRID_TOLERANCE, `fine grid ${fine.smooth} m off`);
      assert.ok(fine.crease <= FINE_CELL * Math.tan(LIP_BACK_FACE_PITCH_DEGREES * DEGREES_TO_RADIANS), `fine grid ${fine.crease} m off at a crease`);
      if (mode === "highJump") assert.ok(worst(COARSE_CELL).smooth > GRID_TOLERANCE, "a coarse grid is more than 2 mm off the arc");
    });
  }
});

describe("given each of the 7 car types parked on the pad of each station and released at full throttle, the grid at 5 cm", () => {
  for (const mode of MINIGAME_MODES) {
    it(`when each rides the ${mode} from the hilltop, then it holds still parked, reaches the lip without stalling and meets its stated speeds`, (t) => {
      const rows: (readonly [string, ClimbRun])[] = [];
      for (const type of DRIVER_CARS) {
        const run = driveToLip(type, stationDriveProfile(mode), FINE_CELL);
        const minimum = MINIMUM_SPEED[mode][type.id]!;
        rows.push([type.id, run]);
        assert.ok(run.heldSlide <= PARKED_SLIDE_LIMIT, `${type.id} slid ${run.heldSlide} m parked`);
        assert.ok(run.reachedLip, `${type.id} reached the lip (stopped at x = ${run.endX})`);
        assert.ok(run.footSpeed >= minimum.foot, `${type.id} at the foot ${run.footSpeed} against ${minimum.foot}`);
        assert.ok(run.lipCentreSpeed >= minimum.lip, `${type.id} at the lip ${run.lipCentreSpeed} against ${minimum.lip}`);
        assert.ok(run.slowestOnClimb >= minimum.lip - CLIMB_STALL_ALLOWANCE - 1e-9 || mode !== "highJump", `${type.id} slowest ${run.slowestOnClimb}`);
      }
      t.diagnostic(`${mode}, speeds in m/s:\n${table(rows)}`);
    });
  }

  it("when each rides the high jump on a grid of 10 cm and of 25 cm, then every car type reaches the lip as it does on the 5 cm one: the cell does not decide the climb", (t) => {
    for (const cell of [0.1, 0.25]) {
      const rows: (readonly [string, ClimbRun])[] = [];
      for (const type of DRIVER_CARS) {
        const run = driveToLip(type, stationDriveProfile("highJump"), cell);
        rows.push([type.id, run]);
        assert.ok(run.reachedLip, `${type.id} at cell ${cell}`);
        assert.ok(run.lipCentreSpeed >= MINIMUM_SPEED.highJump[type.id]!.lip, `${type.id} at cell ${cell}: ${run.lipCentreSpeed}`);
      }
      t.diagnostic(`high jump, cell ${cell} m:\n${table(rows)}`);
    }
  });
});

describe("given the high jump's kicker made steeper, an arc of the shipped radius", () => {
  /**
   * The sweep's pitches (deg), and the speed (m/s) under which a car is called to have lost the climb at the lip: the plan's lowest lip speed.
   * The sweep stops at the steepest 5° step the sedan still climbs over that speed: one step steeper the face bears too little of the car's
   * weight for the tyres' drive (`standingBite`), and the next pitch is a wall by the drive model.
   */
  const SWEEP_DEGREES = [HIGH_JUMP_KICKER.lipPitchDegrees, 65, 70, 75];
  const LIP_SPEED_FLOOR = 17;
  /** The largest radius (m), in 5 m steps under the shipped one, at which the sedan reaches the shipped pitch's lip under its bar. */
  const TIGHT_RADIUS = 15;
  const sedan = DRIVER_CARS.find((type) => type.id === "sedan")!;

  it("when every car type climbs each pitch, then all reach the lip at any of them (no tyre treats the face as a wall) and the sedan's lip speed falls with the pitch yet stays over the floor even at the steepest", (t) => {
    const sedanCentre: number[] = [];
    for (const pitch of SWEEP_DEGREES) {
      const rows: (readonly [string, ClimbRun])[] = [];
      for (const type of DRIVER_CARS) {
        const run = driveToLip(type, highJumpVariant(HIGH_JUMP_KICKER.radius, pitch, RUN_UP_LENGTH.highJump), FINE_CELL);
        rows.push([type.id, run]);
        assert.ok(run.reachedLip, `${type.id} at ${pitch} deg stopped at x = ${run.endX}`);
        if (type.id === "sedan") sedanCentre.push(run.lipCentreSpeed);
      }
      t.diagnostic(`arc radius ${HIGH_JUMP_KICKER.radius} m to ${pitch} deg:\n${table(rows)}`);
    }
    for (let i = 1; i < sedanCentre.length; i++) assert.ok(sedanCentre[i]! <= sedanCentre[i - 1]! + 1e-6, `sedan lip speeds ${sedanCentre.join(", ")}`);
    assert.ok(sedanCentre[sedanCentre.length - 1]! >= LIP_SPEED_FLOOR, `the sedan's lip speed at the steepest swept pitch ${sedanCentre[sedanCentre.length - 1]}: the climb has no wall in the sweep`);
  });

  it("when the shipped radius is swept one 5° step past the steepest pitch, then the sedan's lip speed is under the floor: the floor row can fail", () => {
    const past = SWEEP_DEGREES[SWEEP_DEGREES.length - 1]! + 5;
    const run = driveToLip(sedan, highJumpVariant(HIGH_JUMP_KICKER.radius, past, RUN_UP_LENGTH.highJump), FINE_CELL);
    assert.ok(run.reachedLip && run.lipCentreSpeed < LIP_SPEED_FLOOR, `sedan at ${past} deg: ${run.lipCentreSpeed}, reached ${run.reachedLip}`);
  });

  it("when the shipped pitch is given a radius of 15 m, then the sedan reaches the lip under the speed the shipped kicker gives it: the climb row can fail", () => {
    const shipped = driveToLip(sedan, stationDriveProfile("highJump"), FINE_CELL);
    const tighter = driveToLip(sedan, highJumpVariant(TIGHT_RADIUS, HIGH_JUMP_KICKER.lipPitchDegrees, RUN_UP_LENGTH.highJump), FINE_CELL);
    assert.ok(shipped.lipCentreSpeed >= MINIMUM_SPEED.highJump.sedan!.lip, "shipped meets its bar");
    assert.ok(tighter.reachedLip && tighter.lipCentreSpeed < MINIMUM_SPEED.highJump.sedan!.lip, `a ${TIGHT_RADIUS} m radius gives ${tighter.lipCentreSpeed}, reached ${tighter.reachedLip}`);
  });

  it("when the sweep's builder is given the shipped numbers, then its floor is the shipped floor", () => {
    const shipped = stationDriveProfile("highJump");
    const rebuilt = highJumpVariant(HIGH_JUMP_KICKER.radius, HIGH_JUMP_KICKER.lipPitchDegrees, RUN_UP_LENGTH.highJump);
    assert.ok(Math.abs(rebuilt.backX - shipped.backX) < 1e-9 && Math.abs(rebuilt.startX - shipped.startX) < 1e-9, "same station extent");
    for (let localX = shipped.backX; localX <= shipped.frontX; localX += 0.37) {
      assert.ok(Math.abs(rebuilt.heightAtX(localX) - shipped.heightAtX(localX)) < 1e-9, `x = ${localX}`);
    }
  });
});

describe("given each of the 7 car types released at full throttle from the high jump's hilltop and thrown unboosted at the lip", () => {
  /** The flight of each car type's driver, from the car's velocity at the lip plus the usual pop, on `profile`. */
  const flightsOn = (profile: DriveProfile): { id: string; flight: LipFlight }[] =>
    DRIVER_CARS.map((type) => {
      const run = driveToLip(type, profile, FINE_CELL);
      assert.ok(run.reachedLip, `${type.id} reached the lip (stopped at x = ${run.endX})`);
      return { id: type.id, flight: lipFlight(run, profile.heightAtX(0)) };
    });
  const flightTable = (rows: readonly { id: string; flight: LipFlight }[]): string =>
    rows
      .map(({ id, flight }) => `${id.padEnd(9)} lip horizontal ${flight.horizontalSpeed.toFixed(1)} vertical ${flight.verticalSpeed.toFixed(1)} m/s, apex ${flight.apexHeight.toFixed(1)} m over the lip at ${flight.apexDistance.toFixed(1)} m past it, lands ${flight.landingDistance.toFixed(1)} m past it`)
      .join("\n");
  const apexesOf = (rows: readonly { flight: LipFlight }[]): number[] => rows.map(({ flight }) => flight.apexHeight);
  const spreadOf = (rows: readonly { flight: LipFlight }[]): number => Math.max(...apexesOf(rows)) / Math.min(...apexesOf(rows));
  /** The best apex over the worst is at most this. */
  const MOST_SPREAD = 4;
  /** The mid run's lip speed is this share of the full-throttle one, within this share. */
  const MID_SHARE = 0.7;
  const MID_SHARE_TOLERANCE = 0.03;
  /**
   * The mutations the apex rows must fail: a kicker too shallow to throw high (deg), and one tight and steep enough (radius m, pitch deg)
   * that the sedan family's climb cliffs while the monster's tyres carry it, found by a sweep of radius, pitch and run-up.
   */
  const SHALLOW_DEGREES = 36;
  const CLIFF_RADIUS = 3;
  const CLIFF_DEGREES = 85;
  const shipped = flightsOn(stationDriveProfile("highJump"));

  it("when each is thrown at the shipped kicker's lip, then every class's unboosted apex is at least the minimum", (t) => {
    t.diagnostic(`shipped kicker (radius ${HIGH_JUMP_KICKER.radius} m, ${HIGH_JUMP_KICKER.lipPitchDegrees} deg, run-up ${RUN_UP_LENGTH.highJump} m), full throttle, minimum apex ${HIGH_JUMP_MIN_APEX} m, best over worst ${spreadOf(shipped).toFixed(2)}:\n${flightTable(shipped)}`);
    for (const { id, flight } of shipped) assert.ok(flight.apexHeight >= HIGH_JUMP_MIN_APEX, `${id} apex ${flight.apexHeight} under the minimum`);
  });

  it("when the best apex is read against the worst, then the ratio is at most 4", () => {
    assert.ok(spreadOf(shipped) <= MOST_SPREAD, `best over worst apex ${spreadOf(shipped)}`);
  });

  it("when the shipped radius is given a shallow pitch, then a class is under the minimum apex; and when a 3 m radius is given 85 degrees, then the ratio is over 4: the apex rows can fail", () => {
    const shallow = flightsOn(highJumpVariant(HIGH_JUMP_KICKER.radius, SHALLOW_DEGREES, RUN_UP_LENGTH.highJump));
    const cliffed = flightsOn(highJumpVariant(CLIFF_RADIUS, CLIFF_DEGREES, RUN_UP_LENGTH.highJump));
    assert.ok(Math.min(...apexesOf(shallow)) < HIGH_JUMP_MIN_APEX, `${SHALLOW_DEGREES} degrees: ${apexesOf(shallow).join(", ")}`);
    assert.ok(spreadOf(cliffed) > MOST_SPREAD, `a ${CLIFF_RADIUS} m radius at ${CLIFF_DEGREES} degrees: ratio ${spreadOf(cliffed)}`);
  });

  it("when each is governed to about 70 percent of its full-throttle lip speed, then it still reaches the lip, at that speed, and flies lower and shorter than at full throttle", (t) => {
    const middle: { id: string; flight: LipFlight }[] = [];
    for (const [index, type] of DRIVER_CARS.entries()) {
      const full = shipped[index]!.flight;
      const cap = capForLipSpeed(type, stationDriveProfile("highJump"), FINE_CELL, MID_SHARE * full.horizontalSpeed);
      const run = driveToLip(type, stationDriveProfile("highJump"), FINE_CELL, cap);
      assert.ok(run.reachedLip, `${type.id} governed to ${cap} reached the lip`);
      const flight = lipFlight(run, lipHeight("highJump"));
      middle.push({ id: type.id, flight });
      assert.ok(Math.abs(flight.horizontalSpeed / full.horizontalSpeed - MID_SHARE) <= MID_SHARE_TOLERANCE, `${type.id} lip speed ${flight.horizontalSpeed} of ${full.horizontalSpeed}`);
      assert.ok(flight.apexHeight < full.apexHeight && flight.landingDistance < full.landingDistance, `${type.id} mid run ${flight.apexHeight} m / ${flight.landingDistance} m against full ${full.apexHeight} m / ${full.landingDistance} m`);
    }
    t.diagnostic(`governed to ${MID_SHARE} of the full-throttle lip speed:\n${flightTable(middle)}`);
  });
});

describe("given the high jump's run-up made shorter", () => {
  const RUN_UPS = [0, 10, 20, 30, 40];
  /** The speed (m/s) the fastest car should have at the kicker's foot, from, and to: where the apex measurements are meant to be taken. */
  const BEST_FOOT_SPEED_MIN = 30;
  const BEST_FOOT_SPEED_MAX = 35;
  const SLOWEST_FOOT_SPEED_MIN = 20;

  it("when every car type is released, then the fastest reaches the foot at 30 to 35 m/s and the slowest at over 20 only with the shipped run-up, and shorter ones leave the fastest under 30", (t) => {
    const best: number[] = [];
    for (const runUp of RUN_UPS) {
      const feet: number[] = [];
      const rows: (readonly [string, ClimbRun])[] = [];
      for (const type of DRIVER_CARS) {
        const run = driveToLip(type, highJumpVariant(HIGH_JUMP_KICKER.radius, HIGH_JUMP_KICKER.lipPitchDegrees, runUp), FINE_CELL);
        feet.push(run.footSpeed);
        rows.push([type.id, run]);
      }
      best.push(Math.max(...feet));
      t.diagnostic(`run-up ${runUp} m:\n${table(rows)}`);
      if (runUp === RUN_UP_LENGTH.highJump) {
        assert.ok(Math.max(...feet) >= BEST_FOOT_SPEED_MIN && Math.max(...feet) <= BEST_FOOT_SPEED_MAX, `best at the foot ${Math.max(...feet)}`);
        assert.ok(Math.min(...feet) >= SLOWEST_FOOT_SPEED_MIN, `slowest at the foot ${Math.min(...feet)}`);
      }
    }
    for (let i = 1; i < best.length; i++) assert.ok(best[i]! > best[i - 1]!, `best foot speeds ${best.join(", ")}`);
    assert.ok(best[0]! < BEST_FOOT_SPEED_MIN, "with no run-up the fastest car is under 30 m/s");
  });
});

describe("given the long jump's driver in the monster truck, driven at full throttle into the jersey barrier at the world origin", () => {
  const monster = DRIVER_CARS.find((type) => type.id === "monster")!;
  /** Where (local x, m) the driver lifts his foot, best of: the range's cars coast into the barrier in neutral. */
  const LIFT_CHOICES = [-30, -15, -8, -4, -2];
  const farthestSign = (distance: number): number => Math.min(RANGE.signs, Math.floor(distance / RANGE.signStep)) * RANGE.signStep;
  const bestDistance = async (onStation: boolean, carryVertical: boolean): Promise<number> => {
    const profile = stationDriveProfile("longJump");
    let best = 0;
    for (const liftX of LIFT_CHOICES) {
      const run: BarrierRun = { liftX, carryVertical };
      const result = await driveIntoBarrier(monster, onStation ? new ProfileGround(profile, FINE_CELL) : null, profile.startX, run);
      best = Math.max(best, result.distance ?? 0);
    }
    return best;
  };

  /**
   * The farthest sign (m) the flat range's throw may reach, the monster's (Main, the owner's ruling: keep its throw): its lifted body and
   * own class throw it 51.9 m on the flat (sign 50; the bar was 40, below the 50 sign), on the union f2a8062d.
   */
  const FARTHEST_SIGN_FLAT = 50;
  // Off the incline's crest the monster flies the slab: its tyres never meet the face (a wall over their hubs, as on the flat range), it
  // lands past it and its driver stays in. It was thrown at the 40 and 50 signs while its tyres read the slab's top as a floor.
  it(`when it is driven into the barrier on the flat range, then he is thrown no farther than the ${FARTHEST_SIGN_FLAT} sign, and driven down the incline, with or without the ejection's vertical carry, it flies the barrier and nobody is thrown`, async (t) => {
    const flat = await bestDistance(false, false);
    const incline = await bestDistance(true, false);
    const inclineWithCarry = await bestDistance(true, true);
    t.diagnostic(`long jump, best of lifts at ${LIFT_CHOICES.join(", ")}: flat ${flat.toFixed(1)} m (sign ${farthestSign(flat)}), incline ${incline.toFixed(1)} m, incline with the vertical carry ${inclineWithCarry.toFixed(1)} m`);
    assert.ok(flat > 0 && farthestSign(flat) <= FARTHEST_SIGN_FLAT, `flat ${flat.toFixed(1)} m, sign ${farthestSign(flat)}`);
    assert.equal(incline, 0, `incline: thrown ${incline.toFixed(1)} m`);
    assert.equal(inclineWithCarry, 0, `incline with the carry: thrown ${inclineWithCarry.toFixed(1)} m`);
  });

  it("when he is thrown from the flat range and from the incline, then the incline throws him over 3 m farther", { todo: "after the overhaul: the monster flies the incline's barrier (nobody thrown), so the incline's throw is the best class thrown there; union f2a8062d: flat 51.9 m, incline 49.4 m (the monster's flat throw kept, Main)" }, async () => {
    const flat = await bestDistance(false, false);
    const incline = await bestDistance(true, false);
    assert.ok(incline > flat + 3, `incline ${incline} against flat ${flat}`);
  });
});

describe("given each of the 7 car types released at full throttle from the long jump's hilltop into the jersey barrier, from 5 start phases (the pad's start moved 0 to 0.55 m, so each slice meets the barrier differently)", () => {
  /** The lowest arrival speed (m/s) at which any class was not thrown while a running car's barrier hit threw only once it packed the block, in a sweep of 20 start phases over speed caps 24 to 34 m/s on the pre-retune long jump (the truck, 31.4; nothing below failed): the shipped window keeps its margin under it, though the hit now throws by the speed it lost (`ejection.ts`). */
  const LOWEST_FAILING_ARRIVAL = 31.4;
  /** The slowest arrival speed (m/s) every class but the monster is thrown at, at every start phase: the truck's, the last of them thrown. */
  const MINIMUM_EJECTING_ARRIVAL = 17.6;
  /**
   * The monster's arrival (m/s) over which it flies the barrier at every start phase, lands past it and keeps its driver in; under it its
   * tyres meet the slab's face, a wall over their hubs, and its driver is thrown once.
   */
  const MONSTER_FLYING_ARRIVAL = 22.5;
  /** The arrival speeds are kept this far (m/s) inside that window, on each side. */
  const SAFETY_MARGIN = 3;
  /** A class's window floor: its slowest ejecting arrival (the monster's flying one) and the margin. */
  const floorOf = (id: string): number => (id === "monster" ? MONSTER_FLYING_ARRIVAL : MINIMUM_EJECTING_ARRIVAL) + SAFETY_MARGIN;
  const ARRIVAL_CEILING = LOWEST_FAILING_ARRIVAL - SAFETY_MARGIN;
  const START_PHASES = [0, 0.13, 0.27, 0.41, 0.55];
  /** The speed caps (m/s) the pins hold a car to: under, and over, its slowest ejecting arrival (the monster's flying one). */
  const SLOW_CAP = 17;
  const FAST_ENOUGH_CAP = 18.5;
  const MONSTER_SLOW_CAP = 22.4;
  const MONSTER_FAST_CAP = 23.2;
  /** The pre-retune approach: the start hill 24 m, the run-up 36 m, the incline 24 m and the crest's radius 180 m. */
  const PRE_RETUNE: LongJumpDesign = { hillLength: 24, runUp: 36, inclineLength: 24, crestRadius: 180 };
  const shipped: LongJumpDesign = { hillLength: START_HILL_LENGTH.longJump, runUp: RUN_UP_LENGTH.longJump, inclineLength: LONG_JUMP_INCLINE.length, crestRadius: LONG_JUMP_INCLINE.crestRadius };
  const monsterCar = DRIVER_CARS.find((type) => type.id === "monster")!;
  const truck = DRIVER_CARS.find((type) => type.id === "truck")!;

  /** One car type's barrier hits, one per start phase. */
  type ClassHits = { id: string; hits: BarrierHit[] };
  const hitsOf = (profile: DriveProfile, speedCap: number): ClassHits[] =>
    DRIVER_CARS.map((type) => ({ id: type.id, hits: START_PHASES.map((phase) => driveToBarrier(type, profile, phase, speedCap)) }));
  const hitTable = (rows: readonly ClassHits[]): string =>
    rows
      .map(({ id, hits }) => `${id.padEnd(9)} arrival ${Math.min(...hits.map((hit) => hit.arrivalSpeed)).toFixed(2)} to ${Math.max(...hits.map((hit) => hit.arrivalSpeed)).toFixed(2)} m/s, vertical ${hits[0]!.arrivalVertical.toFixed(2)} m/s, thrown once ${hits.filter((hit) => hit.ejections === 1).length} of ${hits.length}`)
      .join("\n");
  /** The monster flew the slab: nobody thrown, its centre past the far face. `asPinned`: every other class's driver is thrown once. */
  const flew = (hit: BarrierHit): boolean => hit.ejections === 0 && hit.endX > BARRIER_HALF.x;
  const asPinned = (id: string, hit: BarrierHit): boolean => (id === "monster" ? flew(hit) : hit.ejections === 1);
  const allAsPinned = (rows: readonly ClassHits[]): boolean => rows.every(({ id, hits }) => hits.every((hit) => asPinned(id, hit)));
  const fastest = (rows: readonly ClassHits[]): number => Math.max(...rows.flatMap(({ hits }) => hits.map((hit) => hit.arrivalSpeed)));
  const slowest = (rows: readonly ClassHits[]): number => Math.min(...rows.flatMap(({ hits }) => hits.map((hit) => hit.arrivalSpeed)));
  const shippedHits = hitsOf(longJumpVariant(shipped), Infinity);

  it("when each is released at full throttle on the shipped approach, then every class but the monster is thrown exactly once at every phase and the monster flies the barrier and lands past it, its driver in, the slowest arrives at least 3 m/s over the slowest speed it throws at (the monster's flying one) and the fastest at least 3 m/s under the lowest it fails at", (t) => {
    t.diagnostic(`shipped approach (hill ${shipped.hillLength} m, run-up ${shipped.runUp} m, incline ${shipped.inclineLength} m, crest radius ${shipped.crestRadius} m), window ${floorOf("sedan")} (the monster ${floorOf("monster")}) to ${ARRIVAL_CEILING.toFixed(1)} m/s:\n${hitTable(shippedHits)}`);
    for (const { id, hits } of shippedHits) {
      for (const [index, hit] of hits.entries()) {
        assert.ok(asPinned(id, hit), `${id} at phase ${START_PHASES[index]}: ${hit.ejections} throws, at x ${hit.endX.toFixed(1)} (arrival ${hit.arrivalSpeed})`);
        assert.ok(hit.arrivalSpeed >= floorOf(id), `${id} arrives at ${hit.arrivalSpeed}, under ${floorOf(id)}`);
        assert.ok(hit.arrivalSpeed <= ARRIVAL_CEILING, `${id} arrives at ${hit.arrivalSpeed}, over ${ARRIVAL_CEILING}`);
      }
    }
  });

  it("when the approach is the pre-retune one, then every class but the monster is thrown once at every phase, its truck at 31.4 m/s too, the monster flies the barrier, but the fastest arrives over the ceiling", (t) => {
    const old = hitsOf(longJumpVariant(PRE_RETUNE), Infinity);
    t.diagnostic(`pre-retune approach:\n${hitTable(old)}`);
    assert.ok(allAsPinned(old), "a class not thrown once, or the monster not flying the barrier, on the old approach");
    assert.ok(fastest(old) > ARRIVAL_CEILING, `the old fastest arrival ${fastest(old)}`);
  });

  it("when the monster is held to 22.4 m/s and to 23.2 m/s on the shipped approach, then under its flying speed its tyres meet the slab's face (its 0.81 m top stands over their 0.614 m hubs: a wall) and it is thrown once at every phase, and over it it flies the barrier and lands past it at every phase, its driver in", () => {
    const slow = START_PHASES.map((phase) => driveToBarrier(monsterCar, longJumpVariant(shipped), phase, MONSTER_SLOW_CAP));
    const fast = START_PHASES.map((phase) => driveToBarrier(monsterCar, longJumpVariant(shipped), phase, MONSTER_FAST_CAP));
    const read = (hits: readonly BarrierHit[]): string => hits.map((hit) => `${hit.arrivalSpeed.toFixed(2)}/${hit.ejections} at x ${hit.endX.toFixed(1)}`).join(" ");
    assert.ok(slow.every((hit) => hit.arrivalSpeed < MONSTER_FLYING_ARRIVAL && hit.ejections === 1), `held to ${MONSTER_SLOW_CAP}: ${read(slow)}`);
    assert.ok(fast.every((hit) => hit.arrivalSpeed >= MONSTER_FLYING_ARRIVAL && flew(hit)), `held to ${MONSTER_FAST_CAP}: ${read(fast)}`);
  });

  it("when the truck is held to 17 m/s and to 18.5 m/s on the shipped approach, then it is not thrown at any phase under the slowest ejecting speed and is thrown once at every phase over it", () => {
    const slow = START_PHASES.map((phase) => driveToBarrier(truck, longJumpVariant(shipped), phase, SLOW_CAP));
    const fast = START_PHASES.map((phase) => driveToBarrier(truck, longJumpVariant(shipped), phase, FAST_ENOUGH_CAP));
    assert.ok(slow.every((hit) => hit.arrivalSpeed < MINIMUM_EJECTING_ARRIVAL && hit.ejections === 0), `held to ${SLOW_CAP}: ${slow.map((hit) => `${hit.arrivalSpeed.toFixed(2)}/${hit.ejections}`).join(" ")}`);
    assert.ok(fast.every((hit) => hit.arrivalSpeed >= MINIMUM_EJECTING_ARRIVAL && hit.ejections === 1), `held to ${FAST_ENOUGH_CAP}: ${fast.map((hit) => `${hit.arrivalSpeed.toFixed(2)}/${hit.ejections}`).join(" ")}`);
    assert.ok(slowest(shippedHits) >= floorOf("sedan"), "the slowest class on the shipped approach is over the floor");
  });

  it("when the truck is held to 32 m/s at start phase 0.55 on the pre-retune approach, then it arrives at the old lowest failing speed and is thrown: the barrier hit throws by the speed it lost, its block packed or not", () => {
    const FAILING_CAP = 32;
    const FAILING_PHASE = 0.55;
    const hit = driveToBarrier(truck, longJumpVariant(PRE_RETUNE), FAILING_PHASE, FAILING_CAP);
    assert.ok(Math.abs(hit.arrivalSpeed - LOWEST_FAILING_ARRIVAL) <= 0.1 && hit.ejections === 1, `arrival ${hit.arrivalSpeed}, ${hit.ejections} throws`);
  });

  it("when the builder is given the shipped numbers, then its floor is the shipped floor", () => {
    const built = longJumpVariant(shipped);
    const station = stationDriveProfile("longJump");
    assert.ok(Math.abs(built.backX - station.backX) < 1e-9 && Math.abs(built.startX - station.startX) < 1e-9 && Math.abs(built.footX - station.footX) < 1e-9, "same station extent");
    for (let localX = station.backX; localX <= station.frontX + 1; localX += 0.37) assert.ok(Math.abs(built.heightAtX(localX) - station.heightAtX(localX)) < 1e-9, `x = ${localX}`);
  });
});
