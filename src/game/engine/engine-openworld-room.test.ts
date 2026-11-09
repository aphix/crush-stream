import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { carAtWalker, shownResident } from "../ai/civilians/civilian-crowd.test-util.ts";
import { EVENT_KIND, FLAG, RESIDENT_INT, RESIDENT_INT_STRIDE } from "../ai/civilians/civilian-constants.ts";
import { POPULATION_TIER } from "../ai/civilians/civilian-crowd-constants.ts";
import { legPositionAt, LegPose } from "../ai/civilians/civilian-leg.ts";
import { historyLines } from "../ai/civilians/civilian-mood.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { INTERP_DELAY } from "../net/net-constants.ts";
import { FRAME_MS, Hub } from "../net/net-hub.test-util.ts";
import { NetPlay } from "../net/net-play.ts";
import { worldGame } from "../net/net-world-game.test-util.ts";
import { pooledCar } from "../contact/crash-scenarios.test-util.ts";
import type { FigureStrike } from "../scenes/figure-strike.ts";
import { setGround } from "../world/ground.ts";
import { fixtureLots } from "../world/openworld/openworld-lots.test-util.ts";
import { buildOpenWorldMap } from "../world/openworld/openworld-map.ts";
import { openWorldCourse } from "../world/openworld/openworld-course.ts";
import { OFF_MENU } from "../world/tracks/index.ts";
import { frame, makeWorld } from "../world/race-world.test-util.ts";
import { OpenWorldDirector } from "./engine-openworld.ts";
import { idleCullPorts } from "./openworld-cull-ports.test-util.ts";

const WALL_REACH = 8;
const SEED = 0x1234;
const lots = fixtureLots(WALL_REACH);
const map = buildOpenWorldMap(lots);
const course = openWorldCourse(lots);
const SIM_STEP = 1 / FRAME_HZ;
const HOST_CAR_SLOT = 0;
/** Net frames (1/30 s) the host's crowd runs before a test looks at it: 150 crowd seconds, civilians are out. */
const MORNING_FRAMES = 150 * 30;
const AFTERMATH_FRAMES = 6 * 30;
/** The guest's clock is the host's less the delay, to within a sim step. */
const CLOCK_TOLERANCE_S = 0.02;
/** A client's civilians are where the host's were at its clock, to the width of a float. */
const POSE_TOLERANCE_M = 1e-3;

beforeAll(() => void (OFF_MENU as unknown[]).push(course));
afterAll(() => void (OFF_MENU as unknown[]).splice((OFF_MENU as unknown[]).indexOf(course), 1));

type Side = { director: OpenWorldDirector; thrown: FigureStrike[]; car: ReturnType<typeof pooledCar> };

/** The host (a room of the open world) and a guest, their worlds on the open world's course and their crowds the directors of the engine, linked through netplay. */
function room() {
  const hub = new Hub();
  let now = 1000;
  const hostWorld = makeWorld();
  const guestWorld = makeWorld();
  const side = (client: boolean, slot: number): Side => {
    const thrown: FigureStrike[] = [];
    const car = pooledCar(slot);
    car.group.position.set(5000, 0, 5000);
    const director = new OpenWorldDirector({
      inOpenWorld: () => true,
      isClient: () => client,
      seed: () => SEED,
      tier: () => POPULATION_TIER.phone,
      cars: () => [car],
      foot: () => false,
      now: () => now / 1000,
      eye: () => {},
      throwFigure: (strike) => void thrown.push(strike),
      hookWallHits: () => () => {},
      makeArt: () => ({ update: () => {}, dispose: () => {} }),
      cull: idleCullPorts(),
    });
    director.startOpenWorld(map);
    return { director, thrown, car };
  };
  const host = side(false, HOST_CAR_SLOT);
  const guest = side(true, 1);
  const hostNet = new NetPlay(worldGame(hostWorld, "Ann", () => host.director.link()).game, { connect: hub.connect, now: () => now });
  const guestNet = new NetPlay(worldGame(guestWorld, "Zed", () => guest.director.link()).game, { connect: hub.connect, now: () => now });
  hostNet.hostRoom({ kind: "openworld", code: "R", tx: "bc", minPlayers: 1, course: "", playlist: [], autoNext: true });
  guestNet.join("R", "bc");
  const worldClock = { acc: 0 };
  return {
    hub, hostNet, guestNet, host, guest,
    /** `n` net frames of 1/30 s: the host's sim steps twice, its crowd with it, then both nets and both crowds' frames. */
    step(n: number): void {
      for (let k = 0; k < n; k++) {
        now += FRAME_MS;
        for (let sim = 0; sim < 2; sim++) {
          frame(hostWorld, worldClock);
          host.director.step(SIM_STEP);
          host.director.frame(SIM_STEP);
        }
        hostNet.frame(FRAME_MS / 1000);
        guestNet.frame(FRAME_MS / 1000);
        hub.flush();
        guest.director.frame(FRAME_MS / 1000);
      }
    },
  };
}

const open: NetPlay[] = [];
afterEach(() => {
  for (const net of open.splice(0)) net.leave();
  setGround(null);
});

function startedRoom() {
  const r = room();
  open.push(r.hostNet, r.guestNet);
  r.step(60);
  return r;
}

/** The largest metres a shown civilian of the guest's brain stands from where the host's own society says it stood at the guest's crowd time (the drawn spot is pushed off others, locally). */
function worstPoseGap(r: ReturnType<typeof room>): { gap: number; shown: number } {
  const hostCrowd = r.host.director["crowd"]!;
  const guestCrowd = r.guest.director["crowd"]!;
  const at = guestCrowd.crowdSeconds;
  const pose = new LegPose();
  let gap = 0;
  let shown = 0;
  for (let resident = 0; resident < guestCrowd.poses.count; resident++) {
    if (guestCrowd.poses.shown[resident] === 0) continue;
    shown++;
    gap = legPositionAt(hostCrowd.state, resident, at, pose) ? Math.max(gap, Math.hypot(pose.x - guestCrowd.separation.brainX[resident]!, pose.z - guestCrowd.separation.brainZ[resident]!)) : Infinity;
  }
  return { gap, shown };
}

describe("given a host and a guest in a room of the open world, each with the engine's crowd director as its crowd link", () => {
  it("when the guest has joined and the host's sim has run, then the guest made the host's crowd (seed, tier) and its civilians stand where the host's society puts them at the guest's crowd time", () => {
    const r = startedRoom();
    r.step(MORNING_FRAMES);
    expect(r.guest.director.link()?.seed, "the guest's key is the host's").toBe(r.host.director.link()?.seed);
    const lag = r.host.director.crowdTime() - r.guest.director.crowdTime();
    expect(Math.abs(lag - INTERP_DELAY), "seconds the guest's clock is off the host's, the interpolation delay behind").toBeLessThan(CLOCK_TOLERANCE_S);
    const { gap, shown } = worstPoseGap(r);
    expect(shown, "civilians the guest shows").toBeGreaterThan(0);
    expect(gap, "metres the guest's civilians are off the host's").toBeLessThan(POSE_TOLERANCE_M);
  });

  it("when a car on the host runs a civilian down, then the crowd message carries the knock, and the guest's society has them hurt with it in their life log", () => {
    const r = startedRoom();
    r.step(MORNING_FRAMES);
    const hostCrowd = r.host.director["crowd"]!;
    while (shownResident(hostCrowd) < 0) r.step(1);
    const resident = shownResident(hostCrowd);
    const { place } = carAtWalker(hostCrowd, resident, 6, 14, HOST_CAR_SLOT);
    for (let travelled = 1 / 30; travelled < 1.5 && r.host.thrown.length === 0; travelled += 1 / 30) {
      place(travelled);
      r.step(1);
    }
    r.step(AFTERMATH_FRAMES);
    expect(firstMismatch(r.host.thrown.map((strike) => strike.guard), [resident]), "the host's ragdolls").toBeUndefined();
    expect(firstMismatch(Array.from(r.guest.director.eventLog()).slice(0, 2), [EVENT_KIND.knock, resident]), "the guest's log").toBeUndefined();
    const society = r.guest.director["crowd"]!.state;
    expect(society.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.flags]! & FLAG.hurt, "hurt on the guest").toBe(FLAG.hurt);
    expect(historyLines(society, resident)[0], "their log line on the guest").toContain("knocked down");
  });
});
