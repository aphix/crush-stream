import { afterEach, describe, expect, it } from "vitest";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { setGround } from "../world/ground.ts";
import { course, frame, makeWorld, type World } from "../world/race-world.test-util.ts";
import { NO_CAR_PICK, NO_PERSON_PICK, PERSON_SPRAY, SPRAY_PALETTE } from "../match/look-data.ts";
import { CAR_SPRAY } from "../vehicle/spray-box.ts";
import type { Ejection } from "../vehicle/ejection.ts";
import { NetPlay } from "./net-play.ts";
import { PHASES, type NetGame } from "./net-ports.ts";
import { BETWEEN_ROUNDS_S, RESULTS_HOLD } from "./net-constants.ts";
import { FRAME_MS, Hub } from "./net-hub.test-util.ts";
import { must } from "../kernel/must.test-util.ts";

/**
 * The Havana lobby on the real race stack: a host and a guest, each a `RaceDirector` world (the headless engine minus the renderer),
 * linked through netplay. The host steps its world; the guest only draws the host's snapshots, as a browser guest does.
 */
const havana = course("havana");

/** The engine's `NetGame` seam over a headless world: what `CrashEngine.net` wires, minus the derby, reels, looks and presentation. */
function worldGame(w: World, name: string) {
  const log = { cleared: 0, gen: 0 };
  const game: NetGame = {
    cars: () => w.live(),
    setCarCount: (n) => w.race["host"].setCarCount(n),
    matchCar: () => {},
    setRealism: () => {},
    phase: () => PHASES[0]!,
    timeScale: () => 1,
    mirrorClock: () => {},
    race: () => (w.race.active ? w.race : null),
    enterRace: (survival, lobby = false) => {
      if (w.race.active) {
        if (w.race.survival === survival && (!lobby || w.race.free)) return;
        w.race.exit();
      }
      w.race.enter(survival, lobby);
    },
    exitRace: () => w.race.exit(),
    startRace: () => w.race.command({ type: "start" }),
    setSeats: (seats) => w.race.setSeats(seats),
    playerName: () => name,
    hostFit: () => true,
    remoteDrivable: () => true,
    derbyPhase: () => null,
    derbyState: () => null,
    applyDerby: () => {},
    derbyLobby: () => {},
    startDerby: () => {},
    resetLobbyCar: (i) => w.race.resetLobbyCar(i),
    // The engine's `randomizeAndReset`: the clear count moves, then the director puts its lobby back.
    resetLobbyScene: () => {
      log.gen = (log.gen + 1) & 127;
      w.race.reset();
    },
    setVaporized: () => {},
    clearGen: () => log.gen,
    clearScene: () => void log.cleared++,
    playReel: () => {},
    reelPlaying: () => false,
    launchEjection: (_e: Ejection) => {},
    meterOf: () => null,
    courseMenu: () => w.race.courseMenu(),
    playerLook: () => ({
      car: { ...NO_CAR_PICK },
      person: { ...NO_PERSON_PICK },
      carSpray: { texels: new Uint8Array(CAR_SPRAY.w * CAR_SPRAY.h), palette: SPRAY_PALETTE },
      personSpray: { texels: new Uint8Array(PERSON_SPRAY.w * PERSON_SPRAY.h), palette: SPRAY_PALETTE },
    }),
    wearLook: () => {},
    dropLooks: () => {},
    seat: w.seat,
  };
  return { game, log };
}

/** A host and one guest in room R, both in the lobby, on one clock. */
function lobby(opts: { minPlayers?: number; course?: string } = {}) {
  const hub = new Hub();
  let now = 1000;
  const hw = makeWorld();
  const gw = makeWorld();
  const hg = worldGame(hw, "Ann");
  const gg = worldGame(gw, "Zed");
  const host = new NetPlay(hg.game, { connect: hub.connect, now: () => now });
  const guest = new NetPlay(gg.game, { connect: hub.connect, now: () => now });
  open.push(host, guest);
  host.host("R", "bc");
  if (opts.minPlayers !== undefined) host.setMinPlayers(opts.minPlayers);
  if (opts.course !== undefined) host.setLobbyCourse(opts.course);
  guest.join("R", "bc");
  const state = { acc: 0 };
  const s = {
    now: () => now,
    hub,
    hw,
    gw,
    hg,
    gg,
    host,
    guest,
    /** `n` net frames of 1/30 s: the host's world steps two 1/60 s frames and sends, the guest draws and sends its input. */
    step(n: number): void {
      for (let k = 0; k < n; k++) {
        now += FRAME_MS;
        frame(hw, state);
        frame(hw, state);
        host.frame(FRAME_MS / 1000);
        guest.frame(FRAME_MS / 1000);
        hub.flush();
      }
    },
    /** The guest's seat holds W. */
    holdThrottle(): void {
      gw.seat.sample(new Set(["KeyW"]), null);
    },
    /** The guest's seat lets go of every key. */
    release(): void {
      gw.seat.sample(new Set(), null);
    },
  };
  s.step(60);
  expect(guest.status().car, "the guest got car 1").toBe(1);
  return s;
}

const open: NetPlay[] = [];
afterEach(() => {
  for (const n of open.splice(0)) n.leave();
  setGround(null);
});

/** Whether (x, z) lies inside the course's bounds. */
const inHavana = (x: number, z: number): boolean => x >= havana.bounds.minX && x <= havana.bounds.maxX && z >= havana.bounds.minZ && z <= havana.bounds.maxZ;

/** The course's start anchor, where the lobby's cars stand abreast (`humanSlot`): the plaza's middle is inside the bounds too, so bounds alone would not tell a placed car from an unplaced one. */
const start = havana.survival!.start;

describe("given a host and a guest waiting in the Havana lobby", () => {
  it("when they have waited a second, then every car on both worlds is on the Havana course, the lobby is the one course both load, and nobody races or hunts", () => {
    const s = lobby();
    for (const [who, w] of [["host", s.hw], ["guest", s.gw]] as const) {
      expect(w.race.active, `${who}: race mode`).toBe(true);
      expect(w.race.free, `${who}: free drive, no rules`).toBe(true);
      expect(w.race.courseId, `${who}: the course`).toBe("havana");
      expect(w.race.phase, `${who}: no session`).toBe(null);
      expect(w.live().length, `${who}: a car each`).toBe(2);
      for (const [i, car] of w.live().entries()) {
        const { x, z } = car.group.position;
        expect(inHavana(x, z), `${who}'s car ${i} at (${x.toFixed(1)}, ${z.toFixed(1)}) is inside Havana's bounds`).toBeTruthy();
        expect(Math.hypot(x - start.x, z - start.z), `${who}'s car ${i} stands at the start anchor, not where the fleet left it`).toBeLessThan(12);
      }
    }
    expect(s.hw.race["police"], "no hunters").toBe(null);
  });

  it("when the guest holds the throttle, then its car drives away from the spawn on the host and the guest sees it move; the host's car stays where it was", () => {
    const s = lobby();
    const spawn = s.hw.live()[1]!.group.position.clone();
    const own = s.hw.live()[0]!.group.position.clone();
    s.holdThrottle();
    s.step(90);
    expect(s.hw.live()[1]!.group.position.distanceTo(spawn), "the guest's car drove").toBeGreaterThan(5);
    expect(s.gw.live()[1]!.group.position.distanceTo(spawn), "and the guest draws it moving").toBeGreaterThan(5);
    expect(s.hw.live()[0]!.group.position.distanceTo(own), "the host's car is where it was").toBeLessThan(0.5);
    for (const w of [s.hw, s.gw]) {
      const { x, z } = w.live()[1]!.group.position;
      expect(inHavana(x, z), "the driven car is still on the course").toBeTruthy();
    }
  });

  it("when the guest has crashed into the alley wall and asks to reset, then its car is repaired, upright and back at a spawn on the host and on the guest, and the host's own car was never touched", () => {
    const s = lobby();
    const car = s.hw.live()[1]!;
    const own = s.hw.live()[0]!;
    const spawn = car.group.position.clone();
    // The alley wall of `prop-wall.test.ts`: five panels across x = −40.25, the approach from +x; the guest drives straight into it.
    car.spawnFacing(-30, 12, -Math.PI / 2, 25);
    car.velocity.set(-25, 0, 0);
    s.holdThrottle();
    for (let k = 0; k < 60 && !car.crashed; k++) s.step(1);
    expect(car.crashed, "the guest's car is wrecked").toBe(true);
    const wreckedAt = car.group.position.clone();
    const ownBefore = own.group.position.clone();
    s.release();
    s.step(10);
    s.guest.requestRespawn();
    s.step(6);
    expect(car.crashed, "repaired on the host").toBe(false);
    expect(car.group.position.distanceTo(spawn), `back at a Havana spawn, ${car.group.position.distanceTo(spawn).toFixed(1)} m from the first one`).toBeLessThan(8);
    expect(car.group.position.distanceTo(wreckedAt), "and not where it crashed").toBeGreaterThan(20);
    expect(car.group.matrixWorld.elements[5]!, "upright").toBeGreaterThan(0.9);
    expect(car.velocity.length(), "at rest").toBeLessThan(2);
    expect(own.group.position.distanceTo(ownBefore), "the host's car was not moved by the guest's reset").toBeLessThan(0.5);
    s.step(30);
    const drawn = s.gw.live()[1]!;
    expect(drawn.crashed, "repaired on the guest").toBe(false);
    expect(drawn.group.position.distanceTo(car.group.position), "the guest draws it where the host has it").toBeLessThan(1);
    expect(inHavana(drawn.group.position.x, drawn.group.position.z)).toBeTruthy();
  });

  it("when the host resets the scene, then every car on both worlds is repaired and at its spawn, the props the cars knocked are back, and the guest is told to clear its own debris through the clear count", () => {
    const s = lobby();
    const [a, b] = [s.hw.live()[0]!, s.hw.live()[1]!];
    const spawns = [a.group.position.clone(), b.group.position.clone()];
    for (const car of [a, b]) {
      car.spawnFacing(-30, 12 + 6 * s.hw.live().indexOf(car), -Math.PI / 2, 25);
      car.velocity.set(-25, 0, 0);
    }
    s.hw.race["knocked"][0] = 1;
    s.holdThrottle();
    for (let k = 0; k < 60 && !(a.crashed && b.crashed); k++) s.step(1);
    expect(b.crashed, "the guest's car is wrecked").toBe(true);
    s.release();
    s.step(10);
    const cleared = s.gg.log.cleared;
    s.guest.resetScene();
    expect(b.crashed, "a guest cannot reset the scene").toBe(true);
    s.host.resetScene();
    s.step(10);
    for (const [i, car] of [a, b].entries()) {
      expect(car.crashed, `car ${i} repaired`).toBe(false);
      expect(car.group.position.distanceTo(spawns[i]!), `car ${i} back at its spawn`).toBeLessThan(1);
      expect(car.velocity.length(), `car ${i} at rest`).toBeLessThan(2);
    }
    expect(s.hw.race["knocked"][0], "the knocked prop is back on its spot").toBe(0);
    expect(s.gg.log.cleared, "the guest cleared its scene once, from the host's clear count").toBe(cleared + 1);
    for (const [i, car] of s.gw.live().entries()) expect(car.group.position.distanceTo(spawns[i]!), `the guest draws car ${i} at its spawn`).toBeLessThan(1);
  });

  it("when the host presses Go with two players, then the race starts on both worlds and the lobby is gone: no free drive, a session with both humans", () => {
    const s = lobby();
    expect(s.host.go()).toBe(true);
    s.step(40);
    for (const w of [s.hw, s.gw]) {
      expect(w.race.free, "no free drive").toBe(false);
      expect(w.race.phase, "a race session").not.toBe(null);
    }
    expect(s.hw.race.hud().standings.some((r) => r.name === "Zed"), "the guest is seated as a racer, under its name").toBeTruthy();
  });

  it("when a private game ends and its results have been shown, then the room is back in the Havana lobby on both worlds: free drive, no session, the Go gate up", () => {
    const s = lobby();
    s.host.go();
    s.step(40);
    s.hw.race.command({ type: "end" });
    s.step(30 * (RESULTS_HOLD - 1));
    expect(s.hw.race.phase, "the results are still showing before the hold is over").toBe("finished");
    expect(s.host.status().gate, "and the lobby is not up yet").toBe(null);
    s.step(60);
    for (const [who, w] of [["host", s.hw], ["guest", s.gw]] as const) {
      expect(w.race.free, `${who}: free drive`).toBe(true);
      expect(w.race.phase, `${who}: no session`).toBe(null);
      expect(w.race.courseId, `${who}: the course`).toBe("havana");
    }
    expect(s.host.status().gate?.kind, "the Go switch is up again").toBe("race");
  });
});

const mall = course("national-mall");
const mallStart = mall.survival!.start;
/** Whether car `car` of world `w` stands on the Mall's Survival start anchor, abreast with the others (`humanSlot`: within 16 m of it). */
const atMallStart = (w: World, car: number): boolean => Math.hypot(w.live()[car]!.group.position.x - mallStart.x, w.live()[car]!.group.position.z - mallStart.z) < 16;

describe("given a host and a guest in the lobby of a private room, Survival chosen as the game", () => {
  it("when the host reads the Survival courses, then it is offered Havana and Washington DC, and a guest cannot pick one", () => {
    const s = lobby();
    s.host.setLobbyKind("survival");
    s.step(10);
    expect(firstMismatch(s.host.status().survivalCourse.courses.map((c) => c.id), ["havana", "national-mall"])).toBeUndefined();
    expect(s.host.status().survivalCourse.id, "Havana until the host picks").toBe("havana");
    s.guest.setLobbyCourse("national-mall");
    s.step(10);
    expect(s.hw.race.courseId, "a guest's pick is nobody's").toBe("havana");
  });

  it("when the host picks the Mall, then the lobby on both worlds moves to the Mall's start, and Go starts a team Survival run there for both humans", () => {
    const s = lobby();
    s.host.setLobbyKind("survival");
    s.host.setLobbyCourse("national-mall");
    s.step(30);
    for (const [who, w] of [["host", s.hw], ["guest", s.gw]] as const) {
      expect(w.race.courseId, `${who}: the lobby's course`).toBe("national-mall");
      expect(w.race.free, `${who}: free drive`).toBe(true);
      for (const car of [0, 1]) expect(atMallStart(w, car), `${who}: car ${car} is at the Mall's start`).toBeTruthy();
    }
    expect(s.guest.status().survivalCourse.id, "the guest's panel shows the host's course").toBe("national-mall");
    expect(s.host.go()).toBe(true);
    s.step(60);
    for (const [who, w] of [["host", s.hw], ["guest", s.gw]] as const) {
      expect(w.race.courseId, `${who}: the run's course`).toBe("national-mall");
      expect(w.race.survival, `${who}: Survival`).toBe(true);
      expect(w.race.free, `${who}: not the lobby any more`).toBe(false);
      expect(atMallStart(w, 0) && atMallStart(w, 1), `${who}: both humans at the Mall's start`).toBeTruthy();
    }
    expect(s.hw.race.hud().team?.humans, "a team of two").toBe(2);
  });

  it("when the host picked the Mall before the guest joined, then the guest's lobby opens on the Mall", () => {
    const s = lobby({ course: "national-mall" });
    s.step(30);
    expect(s.gw.race.courseId).toBe("national-mall");
    expect(atMallStart(s.gw, 1), "the guest's car is at the Mall's start").toBeTruthy();
  });

  it("when a third player joins while the Mall's run is on, then its world shows that run on the Mall", () => {
    const s = lobby();
    s.host.setLobbyKind("survival");
    s.host.setLobbyCourse("national-mall");
    expect(s.host.go()).toBe(true);
    s.step(30);
    const lw = makeWorld();
    const late = new NetPlay(worldGame(lw, "Yan").game, { connect: s.hub.connect, now: s.now });
    open.push(late);
    late.join("R", "bc");
    for (let k = 0; k < 60; k++) {
      s.step(1);
      late.frame(FRAME_MS / 1000);
    }
    expect(lw.race.courseId, "the course").toBe("national-mall");
    expect(lw.race.survival, "a Survival run").toBe(true);
  });
});

describe("given a host and a guest in the lobby of a private room, Campaign chosen with a playlist of courses", () => {
  /** The lobby with a campaign over `playlist` (one lap, two AI) started by Go, and both worlds a second into round 1. */
  function campaign(playlist: string[]) {
    const s = lobby();
    s.host.setLobbyKind("campaign");
    s.host.setPlaylist(playlist);
    s.hw.race.command({ type: "options", options: { aiCount: 2, laps: 1 } });
    s.step(10);
    expect(s.host.go()).toBe(true);
    s.step(40);
    /** Frames of the room's clock only, `seconds` of them: the world is not stepped (the finished round has nothing left to simulate). */
    const wait = (seconds: number): void => {
      for (let k = 0; k < seconds * 30; k++) {
        s.host.frame(FRAME_MS / 1000);
        s.guest.frame(FRAME_MS / 1000);
        s.hub.flush();
      }
    };
    /** The guest's car wins the round the host is on (a human win counts), and the round is over. */
    const guestWins = (): void => {
      const session = s.hw.race["session"];
      must(session, "a round is running");
      session.winnerId = 1;
      s.hw.race.command({ type: "end" });
    };
    return { ...s, wait, guestWins };
  }

  it("when the host sets the courses and presses Go, then both worlds race the first one as round 1 of a campaign over the host's list", () => {
    const s = campaign(["rally", "oval"]);
    expect(s.guest.status().gate, "the gate closed on the guest").toBe(null);
    for (const [who, w] of [["host", s.hw], ["guest", s.gw]] as const) {
      expect(w.race.free, `${who}: no lobby`).toBe(false);
      expect(w.race.courseId, `${who}: the first course of the list`).toBe("rally");
      expect(w.race.hud().mode, `${who}: a campaign`).toBe("campaign");
      expect(firstMismatch(w.race.hud().campaign?.tracks, ["rally", "oval"]), `${who}: the host's list`).toBeUndefined();
      expect(w.race.hud().campaign?.round, `${who}: round 1`).toBe(0);
    }
  });

  it("when the lobby holds the host's list before Go, then the guest reads it from the host's gate", () => {
    const s = lobby();
    s.host.setLobbyKind("campaign");
    s.host.setPlaylist(["city", "rally"]);
    s.step(10);
    expect(s.guest.status().gate?.kind, "the gate kind on the guest").toBe("campaign");
    expect(firstMismatch(s.guest.status().gate?.playlist, ["city", "rally"]), "the host's list on the guest").toBeUndefined();
  });

  it("when a human wins round 1 and the between-rounds minute runs out, then the host scores it and starts the second course, and the guest follows to it with the table on round 2", () => {
    const s = campaign(["rally", "oval"]);
    s.guestWins();
    s.wait(20);
    expect(s.hw.race.courseId, "20 s into the minute: still the first course").toBe("rally");
    expect(s.guest.status().nextIn! >= 38 && s.guest.status().nextIn! <= 41, `the guest reads the clock: ${s.guest.status().nextIn}`).toBeTruthy();
    s.wait(BETWEEN_ROUNDS_S);
    s.step(40);
    for (const [who, w] of [["host", s.hw], ["guest", s.gw]] as const) {
      expect(w.race.courseId, `${who}: the second course`).toBe("oval");
      expect(w.race.hud().campaign?.round, `${who}: round 1 is scored`).toBe(1);
      expect(w.race.phase, `${who}: a new round is on`).not.toBe("finished");
    }
    expect(s.guest.status().nextIn, "the clock is gone").toBe(null);
    const standings = s.gw.race.hud().campaign!.standings;
    expect(standings.reduce((n, r) => n + r.wins, 0), "the table the guest shows carries the scored round: one win").toBe(1);
    expect(standings.every((r) => r.places.length === 1), "every car has its round-1 place").toBeTruthy();
  });

  it("when the host presses Next on the results and again on the standings, then the second course starts at once, without waiting for the minute", () => {
    const s = campaign(["rally", "oval"]);
    s.guestWins();
    s.step(30 * 4);
    s.hw.race.command({ type: "next" });
    expect(s.hw.race.hud().menu).toBe("standings");
    s.hw.race.command({ type: "next" });
    s.step(40);
    expect(s.hw.race.courseId).toBe("oval");
    expect(s.gw.race.courseId, "the guest followed").toBe("oval");
  });

  it("when the host turns auto-advance off, then the minute passes and the room is still on the first course's results", () => {
    const s = campaign(["rally", "oval"]);
    s.host.setAutoNext(false);
    s.guestWins();
    s.wait(BETWEEN_ROUNDS_S + 10);
    expect(s.hw.race.courseId).toBe("rally");
    expect(s.hw.race.phase).toBe("finished");
    expect(s.guest.status().nextIn).toBe(null);
  });

  it("when the last course's minute runs out, then the campaign is over and the room is back in the Havana lobby with the Go gate up, on both worlds", () => {
    const s = campaign(["oval"]);
    s.guestWins();
    s.wait(BETWEEN_ROUNDS_S + 2);
    s.step(60);
    for (const [who, w] of [["host", s.hw], ["guest", s.gw]] as const) {
      expect(w.race.free, `${who}: free drive`).toBe(true);
      expect(w.race.courseId, `${who}: the lobby course`).toBe("havana");
      expect(w.race.phase, `${who}: no session`).toBe(null);
    }
    expect(s.host.status().gate?.kind, "the same campaign is ready to run again: kind").toBe("campaign");
    expect(firstMismatch(s.host.status().gate?.playlist, ["oval"]), "the same campaign is ready to run again: playlist").toBeUndefined();
  });
});
