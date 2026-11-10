import { describe, expect, it } from "vitest";
import { must } from "../../kernel/must.test-util.ts";
import { ACTIVITY, ACTIVITY_SECONDS } from "../civilians/civilian-activity.ts";
import { CaseTable, CASE_PHASE, SUBJECT_MODE } from "./case-table.ts";
import { BESIDE_COP, ESCORT_ARRIVE, ESCORT_SECONDS, ESCORT_SPEED, FOOT_HOLD_REACH } from "./crime-constants.ts";
import { harness, NODE_SPACING, runFor, runUntil, STATION_NODE, type Harness } from "./crime-fixture.test-util.ts";
import type { FakeStreet } from "./crime-street.test-util.ts";
import { COP_MODE } from "./foot-cops.ts";

const PLAYER_X = 65;
/** The station's door on the line city, and the least a cop takes to walk a prisoner from the player's spot to it (s). */
const STATION_X = STATION_NODE * NODE_SPACING;
const walkSeconds = (fromX: number): number => (STATION_X - fromX - ESCORT_ARRIVE) / ESCORT_SPEED;
/** The longest any stage of the custody takes in these rows (s). */
const STAGE_LIMIT_SECONDS = 60;
/** The yaw the fake street gives a person at a car's driver's door (facing the car): the way he is set down. */
const DOOR_YAW = -Math.PI / 2;

function streetOf(run: Harness): FakeStreet {
  const { street } = run;
  must(street, "the harness has a street");
  return street;
}

/** The car of the cop who holds the player: the street leases the cops' cars in cop order, so cop `k`'s is car `k` of its list (not the slot `MAX_PATROL_CARS + k` the law keeps it in). */
function holdersCar(run: Harness): number {
  return run.scene.foot.table.holder[0]!;
}

/** The player standing on the crossing at x = 65 against the signal, a foot cop at x = 40 who sees him; `homeCars` of the cops have a patrol car of their own, which appears 300 m west. */
function standingBeforeCop(options: { station: boolean; homeCars: number }): Harness {
  const run = harness([40, 0, 0], { station: options.station, withCars: true });
  const street = streetOf(run);
  street.homeCars = options.homeCars;
  street.leaseAt = { x: -300, z: 0, yaw: Math.PI / 2 };
  run.signals.against = true;
  run.scene.setFoot(true, PLAYER_X, 0, 1, 0, 0);
  return run;
}

/** Runs until the hold is full and his cop has him. */
function untilBusted(run: Harness): void {
  untilMode(run, SUBJECT_MODE.escorted);
}

/** Runs until the player's slot is in `mode`. */
function untilMode(run: Harness, mode: number): void {
  runUntil(run, STAGE_LIMIT_SECONDS, () => run.scene.foot.table.mode[0] === mode);
  expect(run.scene.foot.table.mode[0], "the stage was reached").toBe(mode);
}

function untilDelivered(run: Harness, seconds = STAGE_LIMIT_SECONDS): void {
  runUntil(run, seconds, () => run.footDelivered.length > 0);
  expect(run.footDelivered, "he was set down").toHaveLength(1);
}

describe("given the player on foot held the whole hold beside a cop with a patrol car of his own, on a map with a police station", () => {
  // mutation: sed -i 's/    arrestPorts?.busted(seconds);//' src/game/ai/openworld-crime/player-law.ts
  it("when the hold is full, then the engine is told once and his cop leads him away, no longer on patrol", () => {
    const run = standingBeforeCop({ station: true, homeCars: 3 });
    untilBusted(run);
    runFor(run, 0.2);
    const { table, cops } = run.scene.foot;
    expect(run.footBusts, "the engine was told").toHaveLength(1);
    expect(run.footBusts[0]!, "after the cops came and held him").toBeGreaterThan(12);
    expect(table.mode[0], "he is led away").toBe(SUBJECT_MODE.escorted);
    expect(cops.mode[table.holder[0]!], "his cop leads him").toBe(COP_MODE.escort);
  });

  // mutation: sed -i 's/    if (this.caseIndex < 0 || this.arrested) return false;/    if (this.caseIndex < 0) return false;/' src/game/ai/openworld-crime/player-law.ts
  it("when his cop has him, then the pursuit strip is gone: there is no hold left to fill", () => {
    const run = standingBeforeCop({ station: true, homeCars: 3 });
    const strip = { cops: 0, hold: 0, left: 0 };
    runFor(run, 3);
    expect(run.scene.footChaseOf(strip), "chased before the hold is full").toBe(true);
    untilBusted(run);
    runFor(run, 0.2);
    expect(run.scene.footChaseOf(strip), "no strip in custody").toBe(false);
  });

  // mutation: sed -i 's/      arrestPorts?.led(walkers.x\[walker\]!, walkers.z\[walker\]!);//' src/game/ai/openworld-crime/player-law.ts
  it("when his cop leads him to the car, then the engine is told each step where, from beside the cop to the car's driver's door", () => {
    const run = standingBeforeCop({ station: true, homeCars: 3 });
    untilBusted(run);
    untilMode(run, SUBJECT_MODE.boarding);
    runFor(run, 0.2);
    const street = streetOf(run);
    const car = street.snaps[holdersCar(run)]!;
    const first = run.footLed[0]!;
    const last = run.footLed.at(-1)!;
    expect(first.x, "led from where he stood").toBeGreaterThan(PLAYER_X - FOOT_HOLD_REACH * 2);
    expect(first.x, "led from where he stood").toBeLessThan(PLAYER_X + FOOT_HOLD_REACH * 2);
    expect(last.x, "ends beside the driver's door").toBeCloseTo(car.x + street.doorBeside + BESIDE_COP * Math.cos(DOOR_YAW), 1);
    expect(last.z, "ends beside the driver's door").toBeCloseTo(car.z - BESIDE_COP * Math.sin(DOOR_YAW), 1);
  });

  // mutation: sed -i 's/    if (holder < 0 || table.tookDown\[slot\] === 1) continue;/    if (table.resident[slot]! < 0 || holder < 0 || table.tookDown[slot] === 1) continue;/' src/game/ai/openworld-crime/crime-poses.ts
  it("when he is led and then gets into the car, then his cop acts the escort and the car-in clips", () => {
    const run = standingBeforeCop({ station: true, homeCars: 3 });
    untilBusted(run);
    runFor(run, 0.5);
    const cop = run.scene.foot.table.holder[0]!;
    expect(run.scene.copPoses.activity[cop], "leading him").toBe(ACTIVITY.escorting);
    untilMode(run, SUBJECT_MODE.boarding);
    runFor(run, 0.5);
    expect(run.scene.copPoses.activity[cop], "getting into the car with him").toBe(ACTIVITY.carIn);
  });
});

describe("given the player on foot and his cop who have just got into the cop's patrol car", () => {
  // mutation: sed -i 's/    arrestPorts?.taken(this.law.carIndexOf(table.carOf\[slot\]!));//' src/game/ai/openworld-crime/player-law.ts
  it("when the clip is over, then the engine is told which car has him, once, and the cop is off the street with the case still open", () => {
    const run = standingBeforeCop({ station: true, homeCars: 3 });
    untilBusted(run);
    untilMode(run, SUBJECT_MODE.boarding);
    const { table, cops } = run.scene.foot;
    const car = holdersCar(run);
    expect(run.footTaken, "not aboard yet").toHaveLength(0);
    runUntil(run, ACTIVITY_SECONDS.carIn + 1, () => run.footTaken.length > 0);
    expect(run.footTaken, "the car that has him: the cop's own, past the cars a case calls").toHaveLength(1);
    expect(run.footTaken[0], "the car's place in the engine's list").toBe(car);
    expect(cops.onStreet(table.holder[0]!), "his cop rides with him").toBe(false);
    expect(table.phase[0], "the case is open until he is set down").not.toBe(CASE_PHASE.free);
    expect(run.footDelivered, "not set down yet").toHaveLength(0);
  });
});

describe("given the patrol car that has the player on foot, come to the station", () => {
  // mutation: sed -i 's/if (kind === CASE_KIND.player) this.player.deliver(slot);/if (false) this.player.deliver(slot);/' src/game/ai/openworld-crime/foot-law.ts
  it("when they have got out, then he is set down once beside the car's door at the station, with no bust of a resident, the case closed and his cop back on patrol", () => {
    const run = standingBeforeCop({ station: true, homeCars: 3 });
    untilBusted(run);
    untilMode(run, SUBJECT_MODE.alighting);
    const car = streetOf(run).snaps[holdersCar(run)]!;
    const alightedAt = run.now;
    untilDelivered(run);
    const { table, cops } = run.scene.foot;
    const set = run.footDelivered[0]!;
    expect(run.now - alightedAt, "when the car-out clip was over").toBeCloseTo(ACTIVITY_SECONDS.carOut, 0);
    expect(set.x, "at the car's door at the station").toBeCloseTo(car.x + streetOf(run).doorBeside, 0);
    expect(set.yaw, "facing the way the door's clip has them").toBeCloseTo(DOOR_YAW, 3);
    expect(car.x, "the car is at the station").toBeCloseTo(STATION_X, 0);
    expect(run.busts, "no resident was busted").toHaveLength(0);
    runFor(run, 0.2);
    expect(table.phase[0], "the case is closed").toBe(CASE_PHASE.free);
    expect(cops.mode[0], "his cop is on patrol again").toBe(COP_MODE.patrol);
  });
});

describe("given the player on foot held by a cop who has no patrol car to take him in", () => {
  // mutation: sed -i 's/ESCORT_TO.station, station.x, station.z/ESCORT_TO.station, station.x - 30, station.z/' src/game/ai/openworld-crime/arrests.ts
  it("when the cop walks him to the station's door, then nobody takes him by car, and he is set down at the door after a walk's time, with no shortcut", () => {
    const run = standingBeforeCop({ station: true, homeCars: 0 });
    untilBusted(run);
    const heldAt = run.now;
    untilDelivered(run, 2 * walkSeconds(PLAYER_X));
    expect(run.now - heldAt, "after the walk's time at the least").toBeGreaterThan(walkSeconds(PLAYER_X + FOOT_HOLD_REACH));
    expect(run.footTaken, "never aboard a car").toHaveLength(0);
    expect(run.footLed.length, "led all the way").toBeGreaterThan(walkSeconds(PLAYER_X + FOOT_HOLD_REACH) * 5);
    expect(run.footDelivered[0]!.x, "at the station's door").toBeGreaterThanOrEqual(STATION_X - ESCORT_ARRIVE - BESIDE_COP);
  });
});

describe("given the player on foot held by a cop on a map with no police station", () => {
  // mutation: sed -i 's/ || table.isPlayerSlot(slot)) this.hooks.raise(caseIndex, slot);/) this.hooks.raise(caseIndex, slot);/' src/game/ai/openworld-crime/arrests.ts
  it("when his cop has led him a few metres along the street, then he is set down there", () => {
    const run = standingBeforeCop({ station: false, homeCars: 0 });
    untilBusted(run);
    const heldAt = run.now;
    untilDelivered(run, ESCORT_SECONDS + 4);
    expect(run.now - heldAt, "after the walk along the street").toBeGreaterThan(ESCORT_SECONDS - 1);
    expect(run.footTaken, "never aboard a car").toHaveLength(0);
  });
});

describe("given the player on foot being led away by his cop", () => {
  // mutation: sed -i '/^    if (this.table.isPlayerSlot(slot)) this.player.deliver(slot);$/d' src/game/ai/openworld-crime/foot-law.ts
  it("when a car runs his cop down on the way, then he is set down where he stood with the cop and the case closes", () => {
    const run = standingBeforeCop({ station: true, homeCars: 0 });
    untilBusted(run);
    runFor(run, 3);
    const { table, cops } = run.scene.foot;
    const cop = table.holder[0]!;
    expect(run.footDelivered, "still in custody").toHaveLength(0);
    run.scene.foot.knockCop(cop, run.now);
    runFor(run, 0.2);
    expect(run.footDelivered, "let go").toHaveLength(1);
    expect(cops.mode[cop], "the cop is down").toBe(COP_MODE.down);
    expect(table.phase[0], "the case is closed").toBe(CASE_PHASE.free);
  });
});

describe("given a case table whose first hold was nobody's", () => {
  // mutation: sed -i '/^    if (resident < 0) return;$/d' src/game/ai/openworld-crime/case-table.ts
  it("when the next resident is held, then she takes the first place: the player's custody has no row to keep out of the crowd", () => {
    const table = new CaseTable(4);
    table.hold(-1, 1);
    table.hold(3, 2);
    expect(table.heldResident[0], "the first place").toBe(3);
  });
});
