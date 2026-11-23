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
import { idleOpenWorldPorts } from "./openworld-cull-ports.test-util.ts";
import { hypot2 } from "../kernel/physics-core.js";
import { FakeBodyHost } from "./openworld-bodies.test-util.ts";
import { MEDICS } from "./engine-openworld-medics.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";

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
/** Where the guest's eye is from the civilian the host hooks (m), how fast the cable hauls her (m/s), how far a guest's body may be from the host's (m), and the frames to wait for the hook's pin (6 s) to run out. */
const EYE_AWAY_M = 20;
const HAUL_MPS = 2;
const BODY_GAP_M = 0.5;
const PIN_RUNS_OUT_FRAMES = 12 * 30;

type Drawn = { poses: CrowdPoses | null; held: Uint8Array | null };
type Side = { director: OpenWorldDirector; thrown: FigureStrike[]; car: ReturnType<typeof pooledCar>; fake: FakeBodyHost | null; eye: { x: number; z: number }; drawn: Drawn };
type RoomOptions = { bodies?: boolean; guests?: 1 | 2 };

/** The host (a room of the open world) and one or two guests, their worlds on the open world's course and their crowds the directors of the engine, linked through netplay. With `bodies` each side has a dummies' world of its own (`FakeBodyHost`), an eye a test moves and an art that keeps the last poses and `held` it was handed. */
function room({ bodies = false, guests = 1 }: RoomOptions = {}) {
  const hub = new Hub();
  let now = 1000;
  const hostWorld = makeWorld();
  const guestWorld = makeWorld();
  const secondWorld = makeWorld();
  const side = (client: boolean, slot: number): Side => {
    const thrown: FigureStrike[] = [];
    const car = pooledCar(slot);
    car.group.position.set(5000, 0, 5000);
    const fake = bodies ? new FakeBodyHost() : null;
    const eye = { x: 0, z: 0 };
    const drawn: Drawn = { poses: null, held: null };
    const director = new OpenWorldDirector({
      ...idleOpenWorldPorts(),
      inOpenWorld: () => true,
      isClient: () => client,
      seed: () => SEED,
      tier: () => POPULATION_TIER.phone,
      cars: () => [car],
      now: () => now / 1000,
      throwFigure: (strike) => thrown.push(strike) - 1,
      eye: (ray) => {
        ray.eyeX = eye.x;
        ray.eyeZ = eye.z;
      },
      ...(fake === null
        ? {}
        : {
            bodies: fake,
            makeArt: (capacity) => ({
              update: (poses, _eyeX, _eyeZ, _sight, _wallDt, held) => {
                if (capacity <= MEDICS.count) return;
                drawn.poses = poses;
                drawn.held = held ?? null;
              },
              dispose: () => {},
            }),
          }),
    });
    director.startOpenWorld(map);
    return { director, thrown, car, fake, eye, drawn };
  };
  const host = side(false, HOST_CAR_SLOT);
  const guest = side(true, 1);
  const second = guests === 2 ? side(true, 2) : null;
  const hostNet = new NetPlay(worldGame(hostWorld, "Ann", () => host.director.link()).game, { connect: hub.connect, now: () => now });
  const guestNet = new NetPlay(worldGame(guestWorld, "Zed", () => guest.director.link()).game, { connect: hub.connect, now: () => now });
  const secondNet = second === null ? null : new NetPlay(worldGame(secondWorld, "Bo", () => second.director.link()).game, { connect: hub.connect, now: () => now });
  hostNet.hostRoom({ kind: "openworld", code: "R", tx: "bc", minPlayers: 1, course: "", playlist: [], autoNext: true });
  guestNet.join("R", "bc");
  secondNet?.join("R", "bc");
  const worldClock = { acc: 0 };
  /** The host's body slot a cable holds still: its steering back to her crowd spot is overpowered, as a taut cable overpowers its motors. */
  const still = { slot: -1 };
  return {
    hub, hostNet, guestNet, secondNet, host, guest, second, still,
    /** `n` net frames of 1/30 s: the host's sim steps twice, its crowd with it, then both nets and both crowds' frames. */
    step(n: number): void {
      for (let k = 0; k < n; k++) {
        now += FRAME_MS;
        for (let sim = 0; sim < 2; sim++) {
          frame(hostWorld, worldClock);
          host.director.step(SIM_STEP);
          host.director.frame(SIM_STEP);
          if (still.slot >= 0) host.fake?.steer(still.slot, 0, 0);
          host.fake?.advance(SIM_STEP);
        }
        hostNet.frame(FRAME_MS / 1000);
        guestNet.frame(FRAME_MS / 1000);
        secondNet?.frame(FRAME_MS / 1000);
        hub.flush();
        guest.director.frame(FRAME_MS / 1000);
        guest.fake?.advance(FRAME_MS / 1000);
        second?.director.frame(FRAME_MS / 1000);
        second?.fake?.advance(FRAME_MS / 1000);
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
    gap = legPositionAt(hostCrowd.state, resident, at, pose) ? Math.max(gap, hypot2(pose.x - guestCrowd.separation.brainX[resident]!, pose.z - guestCrowd.separation.brainZ[resident]!)) : Infinity;
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
    r.host.eye.x = hostCrowd.poses.x[resident]!;
    r.host.eye.z = hostCrowd.poses.z[resident]!;
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

/** A started room (host and guest each with a fake dummies' world) whose host's hook holds a shown civilian: her body roped and hauled 2 m/s along +x; the guest's eye is 20 m from her. */
function hookedRoom() {
  const r = room({ bodies: true });
  open.push(r.hostNet, r.guestNet);
  r.step(60 + MORNING_FRAMES);
  const hostCrowd = r.host.director["crowd"]!;
  while (shownResident(hostCrowd) < 0) r.step(1);
  const civilian = shownResident(hostCrowd);
  r.guest.eye.x = hostCrowd.poses.x[civilian]!;
  r.guest.eye.z = hostCrowd.poses.z[civilian]! + EYE_AWAY_M;
  const slot = r.host.director.hookBody(civilian);
  r.host.fake!.ropedSlots.add(slot);
  r.host.fake!.haul(slot, HAUL_MPS, 0);
  r.still.slot = slot;
  return { r, civilian, slot };
}

describe("given a host and a guest in an open-world room, and a civilian in the guest's sight whom the host's hook holds", () => {
  it("when the host's cable hauls her 2 m/s for 3 s, then within 0.2 s the guest stands a body for her, its art no longer draws her, and from 0.5 s on the body is within 0.5 m of where the host's was at the guest's crowd time; and when the cable is cut and the hook's pin has run out, then within 0.5 s the guest's body is the guest's own again", () => {
    const { r, civilian, slot } = hookedRoom();
    const guestBodies = r.guest.director["bodies"]!;
    r.step(6);
    expect(guestBodies.has(civilian), "within 0.2 s the guest stands a body for her").toBe(true);
    expect(r.guest.drawn.held![civilian], "its art no longer draws her").toBe(1);
    let widest = 0;
    for (let frames = 6; frames < 3 * 30; frames++) {
      r.step(1);
      if (frames < 15) continue;
      const host = r.host.fake!.bodies.get(slot)!;
      const guest = r.guest.fake!.bodies.get(guestBodies.slotOf(civilian))!;
      widest = Math.max(widest, hypot2(guest.x - (host.x - HAUL_MPS * INTERP_DELAY), guest.z - host.z));
    }
    expect(widest, "the widest the guest's body is from where the host's was at its crowd time (m)").toBeLessThan(BODY_GAP_M);
    r.host.fake!.ropedSlots.delete(slot);
    r.host.fake!.haul(slot, 0, 0);
    r.still.slot = -1;
    for (let frames = 0; frames < PIN_RUNS_OUT_FRAMES && r.host.director["bodies"]!.has(civilian); frames++) r.step(1);
    expect(r.host.director["bodies"]!.has(civilian), "control: the host let her body go").toBe(false);
    r.step(15);
    expect(guestBodies.followedCount(), "no body of the guest's follows the host's record").toBe(0);
  });

  it("when the link to the host is cut for 2 s, then the guest's body for her is the guest's own again", () => {
    const { r, civilian } = hookedRoom();
    const guestBodies = r.guest.director["bodies"]!;
    r.step(30);
    expect(guestBodies.followedCount(), "control: her body follows the host's record").toBe(1);
    r.hub.setCut(r.hostNet["transport"]!.selfId, r.guestNet["transport"]!.selfId, true);
    r.step(2 * 30);
    expect(guestBodies.followedCount(), "no body follows a record with the link cut").toBe(0);
    expect(guestBodies.has(civilian) || r.guest.drawn.held![civilian] === 0, "her body is the guest's own, or the art draws her").toBe(true);
  });
});
