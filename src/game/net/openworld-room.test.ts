import { afterEach, describe, expect, it } from "vitest";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { must } from "../kernel/must.test-util.ts";
import { setGround } from "../world/ground.ts";
import { OPENWORLD_ID } from "../world/openworld/openworld-course.ts";
import { course, frame, makeWorld, type World } from "../world/race-world.test-util.ts";
import { MSG, NET_VERSION, type GameKind } from "./codec.ts";
import { publicRoomName, openRooms } from "./matchmaking.ts";
import { FRAME_MS, Hub } from "./net-hub.test-util.ts";
import { NetPlay } from "./net-play.ts";
import type { CrowdLink } from "./net-ports.ts";
import { worldGame } from "./net-world-game.test-util.ts";
import { voiceGain } from "./voice-range.ts";

import { detCos, detSin, hypot2, hypot3 } from "../kernel/physics-core.js";
/**
 * The open world as a room's game on the real race stack: a host and a guest, each a `RaceDirector` world, linked through netplay
 * as the lobby tests do. The host steps its world; the guest draws the host's snapshots.
 */
const city = course(OPENWORLD_ID);
const start = city.survival!.start;

/** The host's crowd as `NetGame.crowdLink` sees it: a fixed seed and clock, and a log a test grows. */
const CROWD_SEED = 0x1234;
const CROWD_CLOCK = 77.5;
/** Kind, subject, time: a knock, then a wreck. */
const FIRST_EVENTS = [1, 17, 70.25, 2, 4, 71.5];
const NEXT_EVENT = [1, 9, 77];

type HeardCrowd = { seed: number; hostTime: number; crowdTime: number; events: number[] };

function hostLink(log: number[]): CrowdLink {
  return { seed: CROWD_SEED, crowdTime: () => CROWD_CLOCK, eventLog: () => Float64Array.from(log), hear: () => {} };
}

function guestLink(heard: HeardCrowd[]): CrowdLink {
  return {
    seed: 0,
    crowdTime: () => 0,
    eventLog: () => new Float64Array(0),
    hear: (seed, hostTime, crowdTime, events) => void heard.push({ seed, hostTime, crowdTime, events: [...events] }),
  };
}

const open: NetPlay[] = [];
afterEach(() => {
  for (const net of open.splice(0)) net.leave();
  setGround(null);
});

type RoomOptions = { kind?: GameKind; hostCrowd?: CrowdLink | null; guestCrowd?: CrowdLink | null; minPlayers?: number };

/** A host that hosted a private room of `kind` and one guest, both on one clock, run until the guest has its car. */
function room({ kind = "openworld", hostCrowd = null, guestCrowd = null, minPlayers = 1 }: RoomOptions = {}) {
  const hub = new Hub();
  let now = 1000;
  const hw = makeWorld();
  const gw = makeWorld();
  const host = new NetPlay(worldGame(hw, "Ann", () => hostCrowd).game, { connect: hub.connect, now: () => now });
  const guest = new NetPlay(worldGame(gw, "Zed", () => guestCrowd).game, { connect: hub.connect, now: () => now });
  open.push(host, guest);
  host.hostRoom({ kind, code: "R", tx: "bc", minPlayers, course: "", playlist: [], autoNext: true });
  guest.join("R", "bc");
  const state = { acc: 0 };
  const s = {
    hub,
    hw,
    gw,
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
  };
  s.step(60);
  expect(guest.status().car, "the guest got car 1").toBe(1);
  return s;
}

/** Whether (x, z) lies inside the city course's bounds. */
const inCity = (x: number, z: number): boolean => x >= city.bounds.minX && x <= city.bounds.maxX && z >= city.bounds.minZ && z <= city.bounds.maxZ;

type Point = { x: number; y: number; z: number };
const metresBetween = (a: Point, b: Point): number => hypot3(a.x - b.x, a.y - b.y, a.z - b.z);

/** Car `car` of `world` on the course's start anchor, abreast with the others (`humanSlot`: within 12 m of it). */
const atStart = (world: World, car: number): boolean => hypot2(world.live()[car]!.group.position.x - start.x, world.live()[car]!.group.position.z - start.z) < 12;

describe("given a host that hosted a room of the open world and a guest that joined", () => {
  it("when they have waited a second, then both worlds are the lobby on the city's course, nobody races or hunts, and every car stands at its start", () => {
    const s = room();
    for (const [who, w] of [["host", s.hw], ["guest", s.gw]] as const) {
      expect(w.race.active, `${who}: race mode`).toBe(true);
      expect(w.race.free, `${who}: free roam, no rules`).toBe(true);
      expect(w.race.courseId, `${who}: the course`).toBe(OPENWORLD_ID);
      expect(w.race.phase, `${who}: no session`).toBe(null);
      expect(w.live().length, `${who}: a car each`).toBe(2);
      for (const car of [0, 1]) {
        const { x, z } = w.live()[car]!.group.position;
        expect(inCity(x, z) && atStart(w, car), `${who}'s car ${car} at (${x.toFixed(1)}, ${z.toFixed(1)}) stands at the city's start`).toBe(true);
      }
    }
    expect(s.hw.race["police"], "no hunters").toBe(null);
    expect(s.host.status().gate?.kind, "the gate names the game").toBe("openworld");
    expect(s.guest.status().gate?.course, "and the course, to the guest too").toBe(OPENWORLD_ID);
  });

  it("when the guest holds the throttle, then its own car drives away from its spawn on the host and on the guest", () => {
    const s = room();
    const spawn = s.hw.live()[1]!.group.position.clone();
    s.gw.seat.sample(new Set(["KeyW"]), null);
    s.step(60);
    expect(s.hw.live()[1]!.group.position.distanceTo(spawn), "the host's copy drove").toBeGreaterThan(3);
    expect(s.gw.live()[1]!.group.position.distanceTo(spawn), "the guest draws it moving").toBeGreaterThan(3);
  });

  it("when the host presses Go, then nothing starts: the lobby stays open on the city on both worlds", () => {
    const s = room();
    expect(s.host.go(), "Go works").toBe(true);
    s.step(60);
    for (const [who, w] of [["host", s.hw], ["guest", s.gw]] as const) {
      expect(w.race.free, `${who}: still the free roam`).toBe(true);
      expect(w.race.phase, `${who}: still no session`).toBe(null);
      expect(w.race.courseId, `${who}: still the city`).toBe(OPENWORLD_ID);
    }
    expect(s.host.status().gate?.kind, "the gate is still up").toBe("openworld");
  });

  it("when a private host switches the game to a race and back, then the lobby leaves the city for a Survival course and returns", () => {
    const s = room();
    s.host.setLobbyKind("race");
    s.step(30);
    expect(s.hw.race.courseId, "the host's lobby").not.toBe(OPENWORLD_ID);
    expect(s.gw.race.courseId, "the guest follows").not.toBe(OPENWORLD_ID);
    expect(s.host.status().gate?.course, "a race's gate course is its own").not.toBe(OPENWORLD_ID);
    s.host.setLobbyKind("openworld");
    s.step(30);
    expect(s.hw.race.courseId, "the host's lobby").toBe(OPENWORLD_ID);
    expect(s.gw.race.courseId, "the guest follows back").toBe(OPENWORLD_ID);
  });
});

describe("given a public room of the open world", () => {
  it("when it is hosted, then no countdown runs, and the room list names its game", () => {
    const hub = new Hub();
    const world = makeWorld();
    const net = new NetPlay(worldGame(world, "Ann").game, { connect: hub.connect, now: () => 1000 });
    open.push(net);
    net.publicHost("openworld");
    expect(net.status().lobby, "no countdown").toBe(null);
    expect(world.race.courseId, "the lobby is on the city").toBe(OPENWORLD_ID);
    const listed = openRooms([{ room: publicRoomName("openworld", "ABC123"), players: 1, addrs: 1, meta: "lobby.openworld" }], null);
    expect(listed.length, "the room is listed").toBe(1);
    expect(listed[0]!.kind, "its game").toBe("openworld");
    expect(listed[0]!.course, "its course").toBe(OPENWORLD_ID);
  });
});

describe("given the proximity voice of a room of the open world", () => {
  it("when the host's car is moved away from the guest's, then the guest's voice reads both cars on the city's course and the range gain falls with the distance", () => {
    const s = room();
    const peers = s.guest.voice.snapshot().peers;
    expect(peers.map((p) => p.car), "the roster seats the host in car 0").toEqual([0]);
    const world = s.guest.voice["world"];
    expect(s.gw.race.courseId, "the guest is in the city").toBe(OPENWORLD_ID);
    expect(world.carPosition(peers[0]!.car), "the voice reads the car the guest draws").toBe(s.gw.live()[0]!.group.position);
    const gains: number[] = [];
    for (const metres of [0, 20, 40]) {
      s.hw.live()[0]!.spawnFacing(start.x + detSin(start.yaw) * metres, start.z + detCos(start.yaw) * metres, start.yaw, 0);
      s.step(30);
      const listener = world.carPosition(s.guest.status().car);
      const speaker = world.carPosition(peers[0]!.car);
      must(listener && speaker, "both cars are drawn");
      gains.push(voiceGain(metresBetween(listener, speaker)));
    }
    expect(gains[0], "abreast at the start: full strength").toBe(1);
    expect(gains[1]!, "20 m up the street: fading").toBeGreaterThan(0);
    expect(gains[1]!, "20 m up the street: fading").toBeLessThan(1);
    expect(gains[2], "40 m up the street: out of range").toBe(0);
  });
});

describe("given a host with a crowd and a guest with a crowd in a room of the open world", () => {
  it("when the guest has joined, then it heard the host's seed, both clocks and the whole event log, which was there before it joined", () => {
    const heard: HeardCrowd[] = [];
    const s = room({ hostCrowd: hostLink([...FIRST_EVENTS]), guestCrowd: guestLink(heard) });
    s.step(30);
    const last = heard.at(-1);
    must(last, "a crowd message arrived");
    expect(last.seed, "seed").toBe(CROWD_SEED);
    expect(last.crowdTime, "crowd clock").toBe(CROWD_CLOCK);
    expect(last.hostTime, "the host's wall clock when it sent").toBeGreaterThan(0);
    expect(firstMismatch(last.events, FIRST_EVENTS), "event log").toBeUndefined();
  });

  it("when the host's log grows between keyframes, then the guest hears the new event within two frames, not at the next keyframe", () => {
    const heard: HeardCrowd[] = [];
    const log = [...FIRST_EVENTS];
    const s = room({ hostCrowd: hostLink(log), guestCrowd: guestLink(heard) });
    s.step(7);
    const before = heard.length;
    log.push(...NEXT_EVENT);
    s.step(2);
    expect(heard.length, "a message went out for the event").toBeGreaterThan(before);
    const last = heard.at(-1);
    must(last, "a crowd message arrived");
    expect(firstMismatch(last.events, [...FIRST_EVENTS, ...NEXT_EVENT]), "the log as the host has it").toBeUndefined();
  });
});

describe("given a room whose host has no crowd", () => {
  it("when the room runs for two seconds, then the host sends no crowd message and the guest's link hears none", () => {
    const heard: HeardCrowd[] = [];
    const s = room({ hostCrowd: null, guestCrowd: guestLink(heard) });
    let crowdSent = 0;
    const end = s.hub.ends.get(s.host.status().selfId);
    must(end, "the host's end");
    const send = end.send.bind(end);
    end.send = (data, to) => {
      if (data[0] === MSG.crowd) crowdSent++;
      send(data, to);
    };
    s.step(60);
    expect(crowdSent, "crowd messages sent").toBe(0);
    expect(heard.length, "crowd messages heard").toBe(0);
  });

  it("when the guest has no crowd link yet, then a crowd message from the host is dropped without a throw", () => {
    const s = room({ hostCrowd: hostLink([...FIRST_EVENTS]), guestCrowd: null });
    expect(() => s.step(60)).not.toThrow();
    expect(NET_VERSION, "the build both speak").toBe(62);
  });
});
