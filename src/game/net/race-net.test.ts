import { afterEach, describe, expect, it } from "vitest";
import { setGround } from "../world/ground.ts";
import { FRAME, frame, makeWorld, type World } from "../world/race-world.test-util.ts";
import type { RaceHudRow } from "../match/types.ts";
import { SURVIVAL } from "../match/survival.ts";
import { shortenBustHold } from "../world/survival-run.test-util.ts";
import { raceKey, readRace, writeRace } from "./codec.ts";
import { must } from "../kernel/must.test-util.ts";

afterEach(() => setGround(null));

/** Host world with network peers seated on `seats` (car → name), its player named "Ann", an `aiCount`-car AI field, the oval, started. */
function hostRace(seats: ReadonlyMap<number, string>, aiCount = 3): World {
  const w = makeWorld();
  w.race.enter();
  w.race.playerName = "Ann";
  w.race.setSeats(seats);
  w.race.command({ type: "options", options: { trackId: "oval", aiCount, laps: 1 } });
  w.race.command({ type: "start" });
  return w;
}

/** A client world that adopted the host's rules state as car `self`, through the race message a client decodes. */
function clientOf(host: World, self: number): World {
  const c = makeWorld();
  c.race.enter();
  // The host's field size (NetPlay sets it from snapshots); the setup park makes aiCount + 1 cars.
  c.race.command({ type: "options", options: { trackId: "oval", aiCount: host.live().length - 1 } });
  host.race.look = 0xcafe1234;
  const wire = readRace(writeRace({ lobby: null, trackId: "oval", look: host.race.look, gate: null, next: null, snap: host.race.snapshot() }));
  must(wire?.snap, "the host's race state passes the client's checks");
  must(wire.look === 0xcafe1234, "the field's driver-look seed crosses the wire");
  c.race.look = wire.look;
  c.race.applySnapshot(wire.snap, self);
  return c;
}

/** The standings rows sorted by car, each as [car, name, you], field by field. */
function expectStandings(standings: readonly RaceHudRow[], want: readonly (readonly [number, string, boolean])[], label: string): void {
  const rows = standings.map((r) => [r.id, r.name, r.you] as const).sort((a, b) => Number(a[0]) - Number(b[0]));
  expect(rows, `${label}: rows`).toHaveLength(want.length);
  for (const [i, w] of want.entries()) {
    expect(rows[i]?.[0], `${label}: row ${i} car`).toBe(w[0]);
    expect(rows[i]?.[1], `${label}: row ${i} name`).toBe(w[1]);
    expect(rows[i]?.[2], `${label}: row ${i} you`).toBe(w[2]);
  }
}

describe("given a host race on the oval with three AI cars, the host player Ann, and a network peer Zed seated on car 2", () => {
  it("when a client adopts the host's rules state as car 2, then the host seats Zed as a remote car and the client seats him as its own player, each under the chosen names", () => {
    const host = hostRace(new Map([[2, "Zed"]]));
    const hud = host.race.hud();
    expectStandings(hud.standings, [[0, "Ann", true], [1, "Car1", false], [2, "Zed", false], [3, "Car3", false]], "the host's table");

    const client = clientOf(host, 2);
    const ch = client.race.hud();
    expect(ch.you?.id, "the client's own row is its car").toBe(2);
    expectStandings(ch.standings, [[0, "Ann", false], [1, "Car1", false], [2, "Zed", true], [3, "Car3", false]], "the client's table");
    expect(client.seat.mode).toBe("drive");
    expect(client.seat.carIndex).toBe(2);
    host.race.exit();
    client.race.exit();
  });

  it("when the peer sends throttle input after the race starts, then its car waits on the grid until then, the peer's input drives it rather than the AI, and its respawn request is honoured while the paused host's own is ignored", () => {
    const host = hostRace(new Map([[2, "Zed"]]));
    const state = { acc: 0 };
    const start = host.live()[2]!.group.position.clone();
    for (let k = 0; k < 60 * 6 && host.race.phase !== "racing"; k++) frame(host, state);
    expect(host.race.phase).toBe("racing");
    // No input yet: the seat is held, it never falls back to the AI.
    for (let k = 0; k < 60; k++) frame(host, state);
    expect(host.live()[2]!.group.position.distanceTo(start), "an unseated remote car waits on the grid").toBeLessThan(1);
    host.race.setRemoteInput(2, { throttle: 1, steer: 0, brake: 0, ebrake: false, boost: false });
    for (let k = 0; k < 120; k++) frame(host, state);
    expect(host.live()[2]!.velocity.length(), "the peer's throttle drives its car").toBeGreaterThan(5);
    // The host's own menu (pause) gates only the host's respawn, never a peer's.
    host.race.command({ type: "pause" });
    host.race.requestRespawn(0);
    host.race.requestRespawn(2);
    const snap = host.race.snapshot()!;
    expect(snap.cars.find((c) => c.id === 2)!.status, "the peer's respawn request reached the rules").toBe("respawning");
    expect(snap.cars.find((c) => c.id === 0)!.status, "the paused host's own request is ignored").toBe("racing");
    host.race.exit();
  });
});

describe("given a host race with no network peers seated", () => {
  it("when a peer joins mid-race as car 4 and adopts the host's state, then it spectates until the next race instead of driving", () => {
    const host = hostRace(new Map());
    const late = clientOf(host, 4);
    expect(late.race.hud().you, "not in this race's field").toBe(null);
    expect(late.seat.carIndex).not.toBe(4);
    expect(late.seat.mode).not.toBe("drive");
    host.race.exit();
    late.race.exit();
  });
});

/** A client world in Survival that adopted the host's rules state as car `self`, through the race message a client decodes. */
function survivalClientOf(host: World, self: number): World {
  const c = makeWorld();
  c.race.enter(true);
  const wire = readRace(writeRace({ lobby: null, trackId: host.race.snapshot()!.trackId, look: 0, gate: null, next: null, snap: host.race.snapshot() }));
  must(wire?.snap, "the host's Survival state passes the client's checks");
  must(wire.snap.survival, "the snapshot says Survival");
  c.race.applySnapshot(wire.snap, self);
  return c;
}

/** The survival hold (s) these runs use, shortened from the owner's: the wire is under test, not the hold (`match/survival.test.ts` pins it). */
const BUST_HOLD = 1.5;

/** Race seconds after the green at which one human is wrecked: inside the shortened hold, so that car falls first and the other is busted after it. */
const WRECK_AT = BUST_HOLD / 3;

describe("given a hosted Survival run with the host and a peer Zed seated on car 1, both sitting still", () => {
  it("when the run ends and a client adopts the host's state as car 1, then the client reads the run's pack, its time, its team and its cause as the host does", (t) => {
    shortenBustHold(t, BUST_HOLD);
    const host = makeWorld();
    host.race.setSeats(new Map([[1, "Zed"]]));
    host.race.enter(true);
    const state = { acc: 0 };
    const sit = { throttle: 0, steer: 0, brake: 0, ebrake: true, boost: false };
    for (let n = 0; n < 60 * 120 && host.race.phase !== "finished"; n++) {
      host.seat.mode = "drive";
      host.seat.carIndex = 0;
      host.seat.intent.analogGas = true;
      host.seat.intent.gas = 0;
      host.seat.intent.handbrake = true;
      host.race.setRemoteInput(1, sit);
      frame(host, state);
    }
    expect(host.race.phase, "both humans were held and busted").toBe("finished");
    const hostHud = host.race.hud();
    const client = survivalClientOf(host, 1);
    const hud = client.race.hud();
    expect(hud.phase).toBe("finished");
    expect(hud.team!.humans).toBe(hostHud.team!.humans);
    expect(hud.team!.free).toBe(hostHud.team!.free);
    expect(hud.team!.won).toBe(hostHud.team!.won);
    expect(hud.survival!.cops, "the pack's cops ride the snapshot").toBe(hostHud.survival!.cops);
    expect(hud.survival!.wrecked).toBe(hostHud.survival!.wrecked);
    expect(Math.abs(hud.survival!.result!.time - hostHud.survival!.result!.time), "the team's time, as a message keeps it (to the millisecond)").toBeLessThanOrEqual(0.0005);
    const hostCause = hostHud.survival!.result!.cause;
    expect(hud.survival!.result!.cause, "the host's cause").toBe(hostCause);
    expect(hostCause === "busted" || hostCause === "wrecked", `two held humans end the run busted or wrecked, not ended (${hostCause})`).toBeTruthy();
    host.race.exit();
    client.race.exit();
  });
});

describe("given a hosted Survival run with the host and a peer Zed on car 1 where one human is wrecked and the other sits to be busted", () => {
  for (const { wrecks, host: cause, own } of [
    { wrecks: 1, host: "busted", own: "wrecked" },
    { wrecks: 0, host: "wrecked", own: "busted" },
  ] as const) {
    it(`when car ${wrecks} is wrecked and the other held until busted and a client adopts the host's state as car 1, then the client's card reads the host's cause (${cause}), not its own car's (${own})`, (t) => {
      shortenBustHold(t, BUST_HOLD);
      const host = makeWorld();
      host.race.reseed(2);
      host.race.setSeats(new Map([[1, "Zed"]]));
      host.race.enter(true);
      const state = { acc: 0 };
      const sit = { throttle: 0, steer: 0, brake: 0, ebrake: true, boost: false };
      let wrecked = false;
      for (let n = 0; n < 60 * 120 && host.race.phase !== "finished"; n++) {
        host.seat.mode = "drive";
        host.seat.carIndex = 0;
        host.seat.intent.analogGas = true;
        host.seat.intent.gas = 0;
        host.seat.intent.handbrake = true;
        host.race.setRemoteInput(1, sit);
        frame(host, state);
        if (!wrecked && host.race.time > WRECK_AT) {
          host.live()[wrecks]!.driverOut = "windshield";
          wrecked = true;
        }
      }
      expect(host.race.phase, "both humans fell").toBe("finished");
      const hostCause = host.race.hud().survival!.result!.cause;
      expect(hostCause, "the host's own car's cause").toBe(cause);
      const peer = host.race.snapshot()!.cars.find((c) => c.id === 1)!;
      expect(peer.bustedAt != null ? "busted" : "wrecked", "the peer's own car fell the other way").toBe(own);
      const client = survivalClientOf(host, 1);
      expect(client.race.hud().survival!.result!.cause, "the client's card carries the host's cause, not its own car's").toBe(hostCause);
      host.race.exit();
      client.race.exit();
    });
  }
});

describe("given a hosted Survival run that has just begun with a peer Zed seated on car 1", () => {
  it("when a client that started its own local Survival run adopts the host's first state a few frames in, then it is seated as car 1 and drives instead of spectating", () => {
    const host = makeWorld();
    host.race.setSeats(new Map([[1, "Zed"]]));
    host.race.enter(true);
    const state = { acc: 0 };
    for (let n = 0; n < 10; n++) frame(host, state);
    expect(host.race.time, "the run has not turned green yet").toBeLessThan(0);
    const client = survivalClientOf(host, 1);
    expect(client.race.hud().you, "car 1 is in the host's field").not.toBe(null);
    expect(client.seat.mode, "the client drives its car from the first state").toBe("drive");
    expect(client.seat.carIndex).toBe(1);
    host.race.exit();
    client.race.exit();
  });
});

describe("given a hosted campaign with the host and a peer seated", () => {
  it("when a client adopts the host's state, then it shows the host's campaign table, round and tracks, and the standings screen follows the host's flag", () => {
    const host = makeWorld();
    host.race.setSeats(new Map([[1, "Zed"]]));
    host.race.enter();
    host.race.command({ type: "options", options: { trackId: "oval", aiCount: 3, laps: 1 } });
    host.race.command({ type: "campaign" });
    const client = clientOf(host, 1);
    const hostTable = host.race.hud().campaign!;
    const table = client.race.hud().campaign!;
    expect(table.round).toBe(hostTable.round);
    expect(table.tracks.join()).toBe(hostTable.tracks.join());
    expect(table.standings.map((r) => `${r.id} ${r.name}`).join()).toBe(hostTable.standings.map((r) => `${r.id} ${r.name}`).join());
    expect(table.standings.find((r) => r.kind === "player")?.id, "the table marks this browser's own car as the player, the host's as remote").toBe(1);
    expect(client.race.hud().mode).toBe("campaign");
    // Host on its standings screen: a client whose results are up follows; one still racing does not.
    const snap = host.race.snapshot()!;
    expect(snap.standings).toBe(false);
    client.race.applySnapshot({ ...structuredClone(snap), standings: true }, 1);
    expect(client.race.hud().menu, "a client not yet at its results stays where it is").toBe(null);
    const over = { ...structuredClone(snap), phase: "finished" as const };
    client.race.applySnapshot(over, 1);
    for (let n = 0; n < 200 && client.race.hud().menu !== "results"; n++) client.race.frame(FRAME);
    expect(client.race.hud().menu, "its own results come first").toBe("results");
    client.race.applySnapshot({ ...structuredClone(over), standings: true }, 1);
    expect(client.race.hud().menu, "then it follows the host to the standings").toBe("standings");
    host.race.exit();
    client.race.exit();
  });
});

/** `a` and `b` equal, numbers within `tol` (a message keeps a fraction to the millimetre). */
function nearlyEqual(a: unknown, b: unknown, tol: number, path = "hud"): void {
  if (typeof a === "number" && typeof b === "number") return expect(Math.abs(a - b), `${path}: ${a} vs ${b}`).toBeLessThanOrEqual(tol);
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return expect(a, path).toBe(b);
  expect(Object.keys(a).join(), path).toBe(Object.keys(b).join());
  for (const k of Object.keys(a)) nearlyEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], tol, `${path}.${k}`);
}

/** What the race screens show of a race, apart from which car is the viewer's own. */
function raceView(w: World) {
  const h = w.race.hud();
  return {
    phase: h.phase,
    time: h.time,
    laps: h.laps,
    winnerName: h.winnerName,
    standings: h.standings.map((r) => ({ id: r.id, name: r.name, place: r.place, lap: r.lap, status: r.status, gap: r.gap, bestLap: r.bestLap })),
    results: h.results?.map((r) => ({ id: r.id, name: r.name, place: r.place, status: r.status, time: r.time, gap: r.gap, bestLap: r.bestLap, laps: r.laps, busted: r.busted })) ?? null,
  };
}

/** The race message over a whole race on the oval (1 lap): what the client shows, and the bytes a second. */
for (const { aiCount, cars, boundBps } of [{ aiCount: 3, cars: 4, boundBps: 2500 }, { aiCount: 7, cars: 8, boundBps: 6000 }]) {
  describe(`given a ${cars}-car host race run from the grid to its results and a client fed what the host's sender sends`, () => {
    it("when the host offers its state every 6th snapshot and sends it only when its key changed or on a keyframe, then the client's standings, clock, finish order and results equal the host's at every offer, at a fraction of the bytes", () => {
      const host = hostRace(new Map([[2, "Zed"]]), aiCount);
      const client = clientOf(host, 2);
      // Both screens watch car 1, an AI car: its distance bar is under test.
      for (const w of [host, client]) {
        w.seat.mode = "follow";
        w.seat.carIndex = 1;
      }
      let barError = 0;
      let lastHostBar = 0;
      let lastBar = 0;
      let quiet = 0;
      let moved = 0;
      const state = { acc: 0 };
      let sentKey = "";
      let sent = 0;
      let offers = 0;
      let bytes = 0;
      let unrounded = 0;
      const statuses = new Set<string>();
      let n = 0;
      let overAt = -1;
      for (; n < 60 * 200 && (overAt < 0 || n - overAt < 60 * 3); n++) {
        if (overAt < 0 && host.race.phase === "finished") overAt = n;
        frame(host, state);
        client.race.advanceClock(FRAME);
        let heard = false;
        if ((n + 1) % 12 === 0) {
          offers++;
          const rs = { lobby: null, trackId: "oval", look: host.race.look, gate: null, next: null, snap: host.race.snapshot() };
          const key = raceKey(rs);
          unrounded += JSON.stringify(rs).length + 1;
          if ((n + 1) % 60 === 0 || key !== sentKey) {
            sentKey = key;
            const msg = writeRace(rs);
            bytes += msg.length;
            sent++;
            heard = true;
            client.race.applySnapshot(readRace(msg)!.snap!, 2);
          }
          for (const c of rs.snap!.cars) statuses.add(c.status);
          nearlyEqual(raceView(client), raceView(host), 0.0015);
        }
        // Every frame, the distance bar of the car both screens watch: close to the host's, and moving on frames the guest heard nothing.
        const hostBar = host.race.hud().view?.racer?.done ?? 0;
        const bar = client.race.hud().view?.racer?.done ?? 0;
        barError = Math.max(barError, Math.abs(bar - hostBar));
        if (!heard && hostBar > lastHostBar && hostBar < 1) {
          quiet++;
          if (bar > lastBar) moved++;
        }
        lastHostBar = hostBar;
        lastBar = bar;
      }
      expect(host.race.phase, "the race ran to its results").toBe("finished");
      expect(statuses.has("finished") && (statuses.has("dnf") || statuses.has("out")), `finishers and a car that did not finish: ${[...statuses]}`).toBeTruthy();
      expect(barError, `the guest's distance bar is within ${barError.toFixed(4)} of the host's (of the race's length)`).toBeLessThan(0.02);
      expect(quiet > 600 && moved >= 0.95 * quiet, `the bar moved on ${moved} of ${quiet} frames the guest heard nothing`).toBeTruthy();
      const seconds = (n + 1) / 60;
      console.log(`race message, ${cars} cars: ${sent} of ${offers} offers sent, ${(bytes / seconds).toFixed(0)} B/s (${(unrounded / seconds).toFixed(0)} B/s as the array-of-objects JSON offered every time); distance bar worst ${barError.toFixed(4)} off the host's, moved on ${moved} of ${quiet} quiet frames`);
      expect(bytes / seconds, `${(bytes / seconds).toFixed(0)} B/s of race messages with ${cars} cars`).toBeLessThan(boundBps);
      // A bust and a DNF in the final state cross the codec as they were.
      const snap = host.race.snapshot()!;
      snap.cars[1]!.status = "dnf";
      snap.cars[1]!.bustedAt = 14.25;
      client.race.applySnapshot(structuredClone(snap), 2);
      const direct = raceView(client);
      client.race.applySnapshot(readRace(writeRace({ lobby: null, trackId: "oval", look: 0, gate: null, next: null, snap }))!.snap!, 2);
      expect(direct.results!.some((r) => r.busted), "the bust shows in the results").toBeTruthy();
      nearlyEqual(raceView(client), direct, 0.0015);
      host.race.exit();
      client.race.exit();
    });
  });
}

describe("given a hosted Survival run in which a peer Zed on car 1 is held still until the police bust it, with the owner's hold", () => {
  it("when a guest is fed only what the host's sender sends, then its bust gauge matches the host's on every frame of the hold, the frames between messages included", () => {
    const host = makeWorld();
    host.race.setSeats(new Map([[1, "Zed"]]));
    host.race.enter(true);
    const trackId = host.race.snapshot()!.trackId;
    const client = survivalClientOf(host, 1);
    const state = { acc: 0 };
    const sit = { throttle: 0, steer: 0, brake: 0, ebrake: true, boost: false };
    let sentKey = "";
    let compared = 0;
    let quiet = 0;
    let worst = 0;
    for (let n = 0; n < 60 * 150 && host.race.phase !== "finished"; n++) {
      host.seat.mode = "drive";
      host.seat.carIndex = 0;
      host.seat.intent.analogGas = true;
      host.seat.intent.gas = 0;
      host.seat.intent.handbrake = true;
      host.race.setRemoteInput(1, sit);
      frame(host, state);
      client.race.advanceClock(FRAME);
      let heard = false;
      if ((n + 1) % 12 === 0) {
        const rs = { lobby: null, trackId, look: 0, gate: null, next: null, snap: host.race.snapshot() };
        const key = raceKey(rs);
        if ((n + 1) % 60 === 0 || key !== sentKey) {
          sentKey = key;
          heard = true;
          client.race.applySnapshot(readRace(writeRace(rs))!.snap!, 1);
        }
      }
      const hostCar = host.race.snapshot()!.cars.find((c) => c.id === 1)!;
      const chase = client.race.hud().view?.chase;
      if (hostCar.status !== "racing" || hostCar.stopped <= 0 || !chase) continue;
      compared++;
      if (!heard) quiet++;
      worst = Math.max(worst, Math.abs(chase.left - Math.max(0, SURVIVAL.bustTime - hostCar.stopped)));
    }
    expect(host.race.phase, "the held humans were busted").toBe("finished");
    expect(quiet, `the gauge was compared on ${quiet} frames the guest heard nothing (${compared} in all)`).toBeGreaterThan(60);
    console.log(`bust gauge: ${compared} frames compared (${quiet} with nothing heard), worst ${worst.toFixed(4)} s off the host's`);
    expect(worst, `the guest's gauge is ${worst.toFixed(4)} s from the host's at worst`).toBeLessThan(0.02);
    host.race.exit();
    client.race.exit();
  });
});
