import { describe, expect, it } from "vitest";
import { humanSlot } from "../match/survival.ts";
import type { DriveInput } from "../vehicle/car-drive.ts";
import { FRAME, frame, makeWorld, type World } from "./race-world.test-util.ts";
import { hold, leaveSurvival, shortenBustHold } from "./survival-run.test-util.ts";
import { Track } from "./track.ts";
import { HAVANA } from "./tracks/havana.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

/**
 * A hosted Survival run with several humans (docs/SURVIVAL.md, Co-op): the host's car 0 and a network peer on each of the cars the room seated,
 * the cops after all of them, the run lost when no human is free. The peers' pedals are what the host last heard (`setRemoteInput`).
 */
const start = new Track(HAVANA).survival!.start;

/** Round and round at about 7 m/s: above the bust's 20 km/h, so the police never hold it. */
const CIRCLE: DriveInput = { throttle: 0.45, steer: 0.45, brake: 0, ebrake: false, boost: false };
const STILL: DriveInput = { throttle: 0, steer: 0, brake: 0, ebrake: true, boost: false };
/** The survival hold (s) the falls test runs with, shortened from the owner's. */
const BUST_HOLD = 3;

/** A hosted Survival run with the host's car 0 and a network peer on each of the cars in `peers` (`setSeats`). */
function coopWorld(peers: readonly number[]): World {
  const w = makeWorld();
  w.race.reseed(1);
  w.race.setSeats(new Map(peers.map((car) => [car, `Peer ${car}`])));
  w.race.enter(true);
  return w;
}

describe("given a hosted Survival run with the host and two peers seated", () => {
  it("when the run starts, then all three humans stand on their own start slots, abreast of the start anchor, and the team reads three humans free", (t) => {
    const w = coopWorld([1, 2]);
    t.onTestFinished(() => leaveSurvival(w));
    const state = { acc: 0 };
    for (let n = 0; n < 60; n++) {
      hold(w);
      w.race.setRemoteInput(1, STILL);
      w.race.setRemoteInput(2, STILL);
      frame(w, state);
    }
    expect(firstMismatch(w.race.racers.map((e) => e.kind), ["player", "remote", "remote"])).toBeUndefined();
    // Where `humanSlot` seats them, in the order the run seats the cars (the peers first, the host last).
    const seated = [humanSlot(start, 0), humanSlot(start, 1), humanSlot(start, 2)];
    const cars = [w.cars[1]!, w.cars[2]!, w.cars[0]!];
    for (const [k, car] of cars.entries()) {
      const p = car.group.position;
      expect(Math.hypot(p.x - seated[k]!.x, p.z - seated[k]!.z), `car ${k} stands within a metre of its slot`).toBeLessThan(1);
    }
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) expect(cars[a]!.group.position.distanceTo(cars[b]!.group.position), "no two humans overlap").toBeGreaterThan(3.5);
    expect(w.race.hud().team?.humans, "team humans").toBe(3);
    expect(w.race.hud().team?.free, "team free").toBe(3);
    expect(w.race.hud().team?.place, "team place").toBe(null);
    expect(w.race.hud().team?.won, "team won").toBe(null);
  });

  it("when the pack launches, then it is sized for the three humans: more units than a lone player meets", (t) => {
    const w = coopWorld([1, 2]);
    t.onTestFinished(() => leaveSurvival(w));
    const solo = makeWorld();
    solo.race.enter(true);
    t.onTestFinished(() => leaveSurvival(solo));
    expect(w.live().length - 3, `${w.live().length - 3} units for three humans, ${solo.live().length - 1} for one`).toBeGreaterThan(solo.live().length - 1);
  });
});

describe("given a hosted Survival run with one human", () => {
  it("when the run starts, then there is no team: the HUD and the rules read as a lone player's", (t) => {
    const w = coopWorld([]);
    t.onTestFinished(() => leaveSurvival(w));
    expect(w.race.hud().team).toBe(null);
  });
});

describe("given a hosted Survival run with the host and one peer, the host sitting still and the peer circling", () => {
  it("when the humans fall one after the other, then the run goes on while one is free, ends when none is, and its time is the team's: the last fall", (t) => {
    // The bust hold is shortened (its own constant): the falls are what is under test, not the owner's 12 s (`match/survival.test.ts`).
    shortenBustHold(t, BUST_HOLD);
    const w = coopWorld([1]);
    t.onTestFinished(() => leaveSurvival(w));
    const state = { acc: 0 };
    let sitting = false;
    let firstFall = Infinity;
    let finishedAt = -1;
    for (let n = 0; n * FRAME < 240; n++) {
      // The peer circles until the host has been busted, then sits too (so the run can end).
      hold(w);
      w.race.setRemoteInput(1, sitting ? STILL : CIRCLE);
      frame(w, state);
      if (n % 10 !== 0) continue;
      const hud = w.race.hud();
      const team = hud.team!;
      if (team.free < 2 && firstFall === Infinity) {
        firstFall = w.race.time;
        sitting = true;
      }
      expect(hud.phase === "finished", `at ${w.race.time.toFixed(1)} s: the run is over exactly when no human is free (${team.free} free)`).toBe(team.free === 0);
      if (hud.phase === "finished") {
        finishedAt = w.race.time;
        break;
      }
    }
    t.annotate(`first fall ${firstFall.toFixed(1)} s, run over ${finishedAt.toFixed(1)} s`);
    expect(finishedAt, "the run ended: no human is free").toBeGreaterThan(0);
    expect(firstFall, `the first fall (${firstFall.toFixed(1)} s) came before the run's end (${finishedAt.toFixed(1)} s)`).toBeLessThan(finishedAt);
    const result = w.race.hud().survival!.result!;
    expect(result.time, "the run's time is the race clock at the last fall").toBe(finishedAt);
    expect(w.race.hud().team!.won, "a Survival run is only ever lost").toBe(false);
  });
});

describe("given a hosted Survival run seating a peer in car 2 only, car 1 empty", () => {
  it("when the run starts, then car 1 is nobody's: parked out of the way, never hunted and never keeping the run alive", (t) => {
    const w = coopWorld([2]);
    t.onTestFinished(() => leaveSurvival(w));
    const state = { acc: 0 };
    for (let n = 0; n < 120; n++) {
      hold(w);
      w.race.setRemoteInput(2, STILL);
      frame(w, state);
    }
    const empty = w.race.snapshot()!.cars.find((c) => c.id === 1)!;
    expect(empty.kind).toBe("ai");
    expect(empty.status, "no human drives it").toBe("out");
    expect(w.cars[1]!.group.position.z, "parked off the course").toBeGreaterThan(1000);
    expect(w.race.hud().team?.humans, "team humans").toBe(2);
    expect(w.race.hud().team?.free, "team free").toBe(2);
    expect(w.race.hud().team?.place, "team place").toBe(null);
    expect(w.race.hud().team?.won, "team won").toBe(null);
  });
});

describe("given a hosted Survival run with the host and a peer seated", () => {
  it("when a second peer joins mid-run, then the run stays as it was; and when the run is retried, then the field takes the new peer in, and drops the first when it has gone", (t) => {
    const w = coopWorld([1]);
    t.onTestFinished(() => leaveSurvival(w));
    const state = { acc: 0 };
    for (let n = 0; n < 30; n++) frame(w, state);
    w.race.setSeats(new Map([[1, "Peer 1"], [2, "Peer 2"]]));
    expect(w.race.racers.length, "nobody is added to a run in progress").toBe(2);
    w.race.command({ type: "retry" });
    expect(firstMismatch(w.race.racers.map((e) => e.kind), ["player", "remote", "remote"])).toBeUndefined();
    expect(w.race.hud().team!.humans).toBe(3);
    w.race.setSeats(new Map());
    w.race.command({ type: "retry" });
    expect(firstMismatch(w.race.racers.map((e) => e.kind), ["player"]), "a peer who has gone leaves the field").toBeUndefined();
    expect(w.race.hud().team).toBe(null);
  });
});
