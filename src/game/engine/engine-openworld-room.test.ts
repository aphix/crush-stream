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
import { detAtan2, hypot2 } from "../kernel/physics-core.js";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { SPECIES } from "../ai/civilians/civilian-constants.ts";
import type { CivilianCrowd } from "../ai/civilians/civilian-crowd.ts";
import { BODY_KIND, BODY_POSTURE } from "../net/body-codec.ts";
import { launch } from "../contact/crash-scenarios.test-util.ts";
import { personOf } from "./people-index.ts";
import { FakeBodyHost } from "./openworld-bodies.test-util.ts";
import { MEDICS } from "./engine-openworld-medics.ts";
import * as THREE from "three";
import { RAPIER, THING, thingCode, TetherSet, WORLD } from "../contact/tether.ts";
import { RemoteCables } from "./openworld-cables.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import type { BodyMotion } from "../net/body-codec.ts";
import { DRAWN } from "./openworld-shared.ts";

/** How close a cable's far end is drawn to the host's ground point (m): the wire's centimetre. */
const CABLE_END_M = 0.01;
const camera = new THREE.PerspectiveCamera();
import { MAX_CARS } from "../scenes/fleet.ts";
import { TORSO_ABOVE_FEET } from "./body-follow.ts";

const WALL_REACH = 8;
const SEED = 0x1234;
const lots = fixtureLots(WALL_REACH);
const map = buildOpenWorldMap(lots);
const course = openWorldCourse(lots);
const SIM_STEP = 1 / FRAME_HZ;
/** The first pool slot the room's fake worlds give a dummy, and how far the host's eye is from a civilian it runs down (m): past the bodies' reach, within the art's. */
const DUMMY_FIRST_SLOT = 4;
const HOST_EYE_AWAY_M = 60;
const DUMMY_LOOK = { woman: false, shirt: 0, pants: 0, hair: 0, hat: null, mustache: false };
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
/** A car's run-up to the walker (m), its speed (m/s), the eye's distance when the hook takes a body (m) and the civilians' drawn spots' tolerance (m). */
const CAR_RUN_UP_M = 6;
const CAR_MPS = 10;
const HOOK_EYE_M = 10;
const CIVILIAN_SPOT_GAP_M = 0.1;

/** The walker on `path` at crowd second `crowdSeconds` into `out`; false for none. */
function walkerAt(path: FootPath | null, crowdSeconds: number, out: BodyMotion): boolean {
  if (path === null) return false;
  const since = crowdSeconds - path.t0;
  out.x = path.x0 + path.vx * since;
  out.y = TORSO_ABOVE_FEET;
  out.z = path.z0 + path.vz * since;
  out.vx = path.vx;
  out.vy = 0;
  out.vz = path.vz;
  out.heading = detAtan2(path.vx, path.vz);
  out.posture = path.posture;
  return true;
}

type Drawn = { poses: CrowdPoses | null; held: Uint8Array | null; players: CrowdPoses | null };
/** A walker on a straight path: where he stood at crowd second `t0`, how fast he moves (m/s) and how he is (`BODY_POSTURE`). */
type FootPath = { x0: number; z0: number; vx: number; vz: number; t0: number; posture: number };
type Launch = { vx: number; vy: number; vz: number };
type Side = { director: OpenWorldDirector; thrown: FigureStrike[]; car: ReturnType<typeof pooledCar>; fake: FakeBodyHost | null; eye: { x: number; z: number }; drawn: Drawn; walk: { path: FootPath | null }; knocks: Launch[]; drags: { x: number; z: number }[]; tethers: TetherSet; cables: RemoteCables };
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
    const drawn: Drawn = { poses: null, held: null, players: null };
    const walk: { path: FootPath | null } = { path: null };
    const knocks: Launch[] = [];
    const drags: { x: number; z: number }[] = [];
    const motion: BodyMotion = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, posture: 0 };
    const tethers = new TetherSet();
    const director = new OpenWorldDirector({
      ...idleOpenWorldPorts(),
      inOpenWorld: () => true,
      isClient: () => client,
      seed: () => SEED,
      tier: () => POPULATION_TIER.phone,
      cars: () => [car],
      tethers: () => tethers,
      ownCarIndex: () => slot,
      footAnchor: (out) => walkerAt(walk.path, director.crowdTime(), out),
      foot: (out) => {
        if (!walkerAt(walk.path, director.crowdTime(), motion)) return false;
        out.x = motion.x;
        out.z = motion.z;
        out.velocityX = motion.vx;
        out.velocityZ = motion.vz;
        return true;
      },
      knockWalker: (vx, vy, vz) => {
        knocks.push({ vx, vy, vz });
        return true;
      },
      dragWalker: (t) => void drags.push({ x: t.x, z: t.z }),
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
                if (capacity === MAX_CARS) drawn.players = poses;
                else if (capacity > MEDICS.count) {
                  drawn.poses = poses;
                  drawn.held = held ?? null;
                }
              },
              dispose: () => {},
            }),
            throwFigure: (strike) => {
              thrown.push(strike);
              const dummy = fake.freeSlot(DUMMY_FIRST_SLOT);
              if (dummy < 0) return -1;
              fake.start(strike.x, strike.y, strike.z, 0, DUMMY_LOOK, dummy, 0, 0);
              fake.fell(dummy);
              return dummy;
            },
            removeFigure: (dummy) => {
              fake.stop(dummy);
              return true;
            },
          }),
    });
    director.startOpenWorld(map);
    return { director, thrown, car, fake, eye, drawn, walk, knocks, drags, tethers, cables: new RemoteCables() };
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
        guest.cables.frame(guest.director.cableFrame(), [guest.car], camera, guest.director.peopleShared, guest.director.peopleCapacity, null, GUEST_CAR);
        guest.fake?.advance(FRAME_MS / 1000);
        second?.director.frame(FRAME_MS / 1000);
        second?.cables.frame(second.director.cableFrame(), [second.car], camera, second.director.peopleShared, second.director.peopleCapacity, null, 2);
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

/** Where the first guest's walker stands for the rows below, how fast the sprint is (m/s), the metres it covers, and how far the eyes stand from him (m). */
const FOOT_AT = { x: 100, z: 100 };
const SPRINT_MPS = 7;
const SPRINT_M = 20;
const EYES_AWAY_M = 15;
const DRAWN_GAP_M = 0.5;
const GUEST_CAR = 1;

/** A room of a host and two guests (cars 1 and 2) that has run a few seconds, every eye `EYES_AWAY_M` from the first guest's walker, no dummies' world: every person on foot is drawn by the pose tables. */
function footRoom() {
  const r = room({ guests: 2 });
  open.push(r.hostNet, r.guestNet, r.secondNet!);
  r.step(5 * 30);
  for (const side of [r.host, r.guest, r.second!]) {
    side.eye.x = FOOT_AT.x;
    side.eye.z = FOOT_AT.z + EYES_AWAY_M;
  }
  return r;
}

/** The pose table a side draws the players on foot from. */
function playersOf(side: { director: OpenWorldDirector }): CrowdPoses {
  return side.director["players"]!.poses;
}

/** The first guest stands at `FOOT_AT` moving (vx, 0) from now, on his own machine. */
function startWalking(r: { guest: Side }, vx: number): FootPath {
  const path = { x0: FOOT_AT.x, z0: FOOT_AT.z, vx, vz: 0, t0: r.guest.director.crowdTime(), posture: BODY_POSTURE.stand };
  r.guest.walk.path = path;
  return path;
}

describe("given a host and two guests in an open-world room, the first guest on foot 15 m from the others", () => {
  it("when he sprints 20 m at 7 m/s, then the host and the second guest each draw him within 0.5 m of where he was at their own crowd time, neither draws a driver in his car, and nothing moves his own walker; and when he gets back in, then within 0.5 s no machine draws him on foot and his car shows its driver again", () => {
    const r = footRoom();
    const path = startWalking(r, SPRINT_MPS);
    r.step(15);
    let widest = 0;
    for (let frames = 0; frames < Math.round((SPRINT_M / SPRINT_MPS) * 30); frames++) {
      r.step(1);
      for (const side of [r.host, r.second!]) {
        const poses = playersOf(side);
        expect(poses.shown[GUEST_CAR], "he is drawn on foot").toBe(1);
        widest = Math.max(widest, hypot2(poses.x[GUEST_CAR]! - (path.x0 + path.vx * (side.director.crowdTime() - path.t0)), poses.z[GUEST_CAR]! - path.z0));
      }
    }
    expect(widest, "the widest he is drawn from where he was at the drawing machine's crowd time (m)").toBeLessThan(DRAWN_GAP_M);
    expect([r.host.director.playerAway(GUEST_CAR), r.second!.director.playerAway(GUEST_CAR)], "neither machine draws a driver in his car").toEqual([true, true]);
    expect(r.guest.knocks.length + r.guest.drags.length, "nothing moved his own walker").toBe(0);
    r.guest.walk.path = null;
    r.step(15);
    expect([playersOf(r.host).shown[GUEST_CAR], playersOf(r.second!).shown[GUEST_CAR]], "no machine draws him on foot").toEqual([0, 0]);
    expect([r.host.director.playerAway(GUEST_CAR), r.second!.director.playerAway(GUEST_CAR)], "his car shows its driver again").toEqual([false, false]);
  });

  it("when the host drives a car through him at 10 m/s, then within 0.3 s his own machine is told once to knock his walker with the host's launch and both other machines lay him down; and when only a car drawn on his own machine touches him, then nothing knocks him", () => {
    const r = footRoom();
    startWalking(r, 0);
    r.step(30);
    expect(playersOf(r.host).lying[GUEST_CAR], "control: he stands before the car comes").toBe(0);
    const car = r.host.car;
    launch(car, FOOT_AT.x - CAR_RUN_UP_M, FOOT_AT.z, Math.PI / 2, CAR_MPS, 0);
    for (let travelled = 0; travelled < 30 && r.guest.knocks.length === 0; travelled++) {
      car.group.position.set(FOOT_AT.x - CAR_RUN_UP_M + (CAR_MPS * travelled) / 30, car.group.position.y, FOOT_AT.z);
      r.step(1);
    }
    for (let frames = 0; frames < 9 && playersOf(r.second!).lying[GUEST_CAR] === 0; frames++) r.step(1);
    expect(r.guest.knocks.length, "his machine is told once").toBe(1);
    expect(r.guest.knocks[0]!.vx, "with the host's launch (m/s)").toBeCloseTo(r.host.director["players"]!["launch"][3 * GUEST_CAR]!, 1);
    expect(r.guest.knocks[0]!.vx, "along the car's way").toBeGreaterThan(0);
    expect([playersOf(r.host).lying[GUEST_CAR], playersOf(r.second!).lying[GUEST_CAR]], "the host and the second guest lay him down").toEqual([1, 1]);
    car.group.position.set(5000, car.group.position.y, 5000);
    r.step(2 * 30);
    expect(r.guest.knocks.length, "told once for the one strike").toBe(1);
    const own = r.guest.car;
    launch(own, FOOT_AT.x - CAR_RUN_UP_M, FOOT_AT.z, Math.PI / 2, CAR_MPS, 0);
    for (let frames = 0; frames < 30; frames++) {
      own.group.position.set(FOOT_AT.x - CAR_RUN_UP_M + (CAR_MPS * frames) / 30, own.group.position.y, FOOT_AT.z);
      r.step(1);
    }
    expect(r.guest.knocks.length, "a car drawn on his own machine knocks nothing more").toBe(1);
  });

  it("when the host's hook takes the host's body for him and hauls it 3 m, then his own machine is told to drag his walker to within 0.5 m of where the host's body is", () => {
    const r = room({ bodies: true, guests: 2 });
    open.push(r.hostNet, r.guestNet, r.secondNet!);
    r.step(5 * 30);
    r.host.eye.x = FOOT_AT.x;
    r.host.eye.z = FOOT_AT.z + HOOK_EYE_M;
    startWalking(r, 0);
    r.step(20);
    const bodies = r.host.director["bodies"]!;
    const person = personOf(BODY_KIND.player, GUEST_CAR, r.host.director["crowd"]!.poses.count);
    const slot = r.host.fake!.started.map((start) => start.slot).find((candidate) => bodies.personOfSlot(candidate) === person);
    expect(slot, "the host stood a body for him").toBeDefined();
    r.host.fake!.ropedSlots.add(slot!);
    r.host.fake!.haul(slot!, 1, 0);
    r.still.slot = slot!;
    r.step(3 * 30);
    const body = r.host.fake!.bodies.get(slot!)!;
    expect(body.x - FOOT_AT.x, "metres the cable hauled the host's body").toBeGreaterThan(2.5);
    expect(r.guest.drags.length, "his machine was told to drag his walker").toBeGreaterThan(0);
    const last = r.guest.drags.at(-1)!;
    expect(hypot2(last.x - body.x, last.z - body.z), "metres from the host's body to where his walker is dragged (m)").toBeLessThan(DRAWN_GAP_M);
  });

  it("when he stops beside a standing civilian, then 1 s later the host's and the second guest's drawn spots of her are within 0.1 m of each other", () => {
    const r = room({ guests: 2 });
    open.push(r.hostNet, r.guestNet, r.secondNet!);
    r.step(MORNING_FRAMES);
    const hostCrowd = r.host.director["crowd"]!;
    const secondCrowd = r.second!.director["crowd"]!;
    let civilian = standingCivilian(hostCrowd);
    for (let frames = 0; frames < MORNING_FRAMES && civilian < 0; frames++) {
      r.step(1);
      civilian = standingCivilian(hostCrowd);
    }
    expect(civilian, "a standing civilian is out").toBeGreaterThanOrEqual(0);
    const at = { x: hostCrowd.poses.x[civilian]!, z: hostCrowd.poses.z[civilian]! };
    r.guest.walk.path = { x0: at.x + 0.2, z0: at.z, vx: 0, vz: 0, t0: r.guest.director.crowdTime(), posture: BODY_POSTURE.stand };
    r.step(30);
    const pushed = hypot2(hostCrowd.poses.x[civilian]! - hostCrowd.separation.brainX[civilian]!, hostCrowd.poses.z[civilian]! - hostCrowd.separation.brainZ[civilian]!);
    expect(pushed, "control: she is pushed off her brain's spot by the man beside her (m)").toBeGreaterThan(0.05);
    expect(hypot2(hostCrowd.poses.x[civilian]! - secondCrowd.poses.x[civilian]!, hostCrowd.poses.z[civilian]! - secondCrowd.poses.z[civilian]!), "metres between the two machines' drawn spots of her").toBeLessThan(CIVILIAN_SPOT_GAP_M);
  });
});

/** The first civilian of `crowd` shown standing about (no pace, no activity), -1 for none. */
function standingCivilian(crowd: CivilianCrowd): number {
  for (let civilian = 0; civilian < crowd.poses.count; civilian++) {
    if (crowd.poses.shown[civilian] === 1 && crowd.poses.speed[civilian] === 0 && crowd.poses.activity[civilian] === ACTIVITY.none && crowd.state.ints[civilian * RESIDENT_INT_STRIDE + RESIDENT_INT.species] === SPECIES.person) return civilian;
  }
  return -1;
}

describe("given a host on foot and a guest", () => {
  it("when the host walks 10 m, then the guest draws him within 0.5 m", () => {
    const r = room();
    open.push(r.hostNet, r.guestNet);
    r.step(5 * 30);
    r.guest.eye.x = FOOT_AT.x;
    r.guest.eye.z = FOOT_AT.z + EYES_AWAY_M;
    const path: FootPath = { x0: FOOT_AT.x, z0: FOOT_AT.z, vx: 2, vz: 0, t0: r.host.director.crowdTime(), posture: BODY_POSTURE.stand };
    r.host.walk.path = path;
    let widest = 0;
    for (let frames = 0; frames < 5 * 30; frames++) {
      r.step(1);
      if (frames < 15) continue;
      const poses = playersOf(r.guest);
      expect(poses.shown[0], "the host is drawn on foot").toBe(1);
      widest = Math.max(widest, hypot2(poses.x[0]! - (path.x0 + path.vx * (r.guest.director.crowdTime() - path.t0)), poses.z[0]! - path.z0));
    }
    expect(widest, "the widest he is drawn from where he was at the guest's crowd time (m)").toBeLessThan(DRAWN_GAP_M);
  });
});

describe("given a guest, and a civilian the host's hook ties to a point on the ground", () => {
  it("when the guest draws, then one cable runs from within 0.5 m of where the guest draws her to within 1 cm of the host's ground point; and when the host cuts it, then within 0.5 s the guest draws none", () => {
    const { r, civilian, slot } = hookedRoom();
    const hostCrowd = r.host.director["crowd"]!;
    const ground = { x: hostCrowd.poses.x[civilian]! + 3, y: 0, z: hostCrowd.poses.z[civilian]! };
    const cable = r.host.tethers.open();
    r.host.tethers.setEnd(cable, 0, RAPIER, ground.x - 3, 1, ground.z, thingCode(THING.doll, slot));
    r.host.tethers.setEnd(cable, 1, WORLD, ground.x, ground.y, ground.z);
    r.host.tethers.setPlace(cable, 0, ground.x - 3, 1, ground.z, 3);
    r.step(10);
    const cables = r.guest.cables.set;
    expect(cables.count, "cables the guest draws").toBe(1);
    const herAt = { x: 0, z: 0 };
    expect(r.guest.director.peopleShared!.drawnAt(civilian, herAt), "control: the guest draws her").not.toBe(DRAWN.none);
    const end = new THREE.Vector3();
    cables.anchor(0, 0, [], end);
    expect(hypot2(end.x - herAt.x, end.z - herAt.z), "metres from where the guest draws her to the cable's first end").toBeLessThan(BODY_GAP_M);
    cables.anchor(0, 1, [], end);
    expect(hypot2(end.x - ground.x, end.z - ground.z) + Math.abs(end.y - ground.y), "metres from the host's ground point to the cable's other end").toBeLessThan(CABLE_END_M);
    r.host.tethers.release(cable);
    r.step(15);
    expect(cables.count, "cables the guest draws once the host has cut it").toBe(0);
  });
});

describe("given a guest 15 m from a civilian whom the host's car runs down", () => {
  it("when she has come to rest, then the guest has one ragdoll for her within 0.5 m of the host's; and when the host's ragdoll is removed, then within 0.5 s the guest's is gone", () => {
    const r = room({ bodies: true });
    open.push(r.hostNet, r.guestNet);
    r.step(60 + MORNING_FRAMES);
    const hostCrowd = r.host.director["crowd"]!;
    while (shownResident(hostCrowd) < 0) r.step(1);
    const resident = shownResident(hostCrowd);
    const at = { x: hostCrowd.poses.x[resident]!, z: hostCrowd.poses.z[resident]! };
    r.host.eye.x = at.x + HOST_EYE_AWAY_M;
    r.host.eye.z = at.z;
    r.guest.eye.x = at.x + EYES_AWAY_M;
    r.guest.eye.z = at.z;
    const { place } = carAtWalker(hostCrowd, resident, 6, 14, HOST_CAR_SLOT);
    for (let travelled = 1 / 30; travelled < 1.5 && r.host.thrown.length === 0; travelled += 1 / 30) {
      place(travelled);
      r.step(1);
    }
    r.step(AFTERMATH_FRAMES);
    const person = personOf(BODY_KIND.civilian, resident, hostCrowd.poses.count);
    const hostShared = r.host.director.peopleShared!;
    const guestShared = r.guest.director.peopleShared!;
    const hostSlot = hostShared.dummy(person);
    const guestSlot = guestShared.dummy(person);
    expect(hostSlot, "the host has a ragdoll for her").toBeGreaterThanOrEqual(0);
    expect(guestSlot, "the guest has a ragdoll for her").toBeGreaterThanOrEqual(0);
    expect(r.guest.thrown.length, "the guest threw one").toBe(1);
    const hostBody = r.host.fake!.bodies.get(hostSlot)!;
    const guestBody = r.guest.fake!.bodies.get(guestSlot)!;
    expect(hypot2(guestBody.x - hostBody.x, guestBody.z - hostBody.z), "metres between the two ragdolls").toBeLessThan(BODY_GAP_M);
    hostShared.took(person, r.host.director.crowdTime());
    r.step(15);
    expect([guestShared.dummy(person), guestBody.out], "the guest's ragdoll is gone").toEqual([-1, false]);
  });
});
