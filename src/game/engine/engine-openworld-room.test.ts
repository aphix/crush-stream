import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { carAtWalker, shownResident } from "../ai/civilians/civilian-crowd.test-util.ts";
import { actorOfCopSubject, EVENT_KIND, FLAG, RESIDENT_INT, RESIDENT_INT_STRIDE } from "../ai/civilians/civilian-constants.ts";
import { CHEST_HEIGHT, POPULATION_TIER } from "../ai/civilians/civilian-crowd-constants.ts";
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
import { OpenWorldActs } from "./engine-openworld-acts.ts";
import { ACT, Named, NAMED } from "../net/act-codec.ts";
import type { ActorPlace } from "./engine-openworld-law.ts";
import type { Meeting } from "../ai/civilians/civilian-look.ts";
import { idleCullPorts, idleOpenWorldPorts } from "./openworld-cull-ports.test-util.ts";
import { detAtan2, hypot2, hypot3 } from "../kernel/physics-core.js";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { SPECIES } from "../ai/civilians/civilian-constants.ts";
import type { CivilianCrowd } from "../ai/civilians/civilian-crowd.ts";
import { BODY_KIND, BODY_POSTURE, SHOT_COUNT_MASK } from "../net/body-codec.ts";
import { launch } from "../contact/crash-scenarios.test-util.ts";
import { personOf } from "./people-index.ts";
import { FakeBodyHost } from "./openworld-bodies.test-util.ts";
import { MEDICS } from "./engine-openworld-medics.ts";
import * as THREE from "three";
import { RAPIER, THING, thingCode, TetherSet, WORLD } from "../contact/tether.ts";
import { RemoteCables } from "./openworld-cables.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import type { BodyMotion } from "../net/body-codec.ts";
import type { DriverLook } from "../present/driver-look.ts";
import { DRAWN } from "./openworld-shared.ts";
import { RemoteGuns } from "./engine-remote-guns.ts";
import { gunModel } from "../present/weapon-models.ts";
import { allocatedBytes, untilQuiet } from "../kernel/alloc-sample.test-util.ts";

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
/** How far (m) the hook's ray reaches in the room's host (the tether's range), and the person it met. */
const HOOK_REACH_M = 80;
const hooked: Meeting = { index: -1, along: 0 };
/** Where the host's hook has a first end held, as the room's fake ports answer. */
const HELD_AT = { x: 31.5, y: 1.2, z: -12.25 };

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
type Side = { director: OpenWorldDirector; thrown: FigureStrike[]; car: ReturnType<typeof pooledCar>; fake: FakeBodyHost | null; eye: { x: number; z: number }; drawn: Drawn; walk: { path: FootPath | null }; knocks: Launch[]; staggers: { dirX: number; dirZ: number }[]; holding: Set<number>; drags: { x: number; z: number }[]; tethers: TetherSet; cables: RemoteCables; looks: DriverLook[] };
type RoomOptions = { bodies?: boolean; guests?: 1 | 2; law?: boolean };

/** The host (a room of the open world) and one or two guests, their worlds on the open world's course and their crowds the directors of the engine, linked through netplay. With `bodies` each side has a dummies' world of its own (`FakeBodyHost`), an eye a test moves and an art that keeps the last poses and `held` it was handed. */
function room({ bodies = false, guests = 1, law = false }: RoomOptions = {}) {
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
    const looks: DriverLook[] = [];
    const staggers: { dirX: number; dirZ: number }[] = [];
    /** The actors this side's hook has holding a first end. */
    const holding = new Set<number>();
    const motion: BodyMotion = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, posture: 0 };
    const tethers = new TetherSet();
    const director = new OpenWorldDirector({
      ...idleOpenWorldPorts(),
      // As the engine wires it: the sight field knows the other players on foot, so a knock beside a guest far from the host's eye still throws its ragdoll.
      cull: { ...idleCullPorts(), others: (out, from) => director.sightOthers(out, from) },
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
      playerLook: (car) => looks[car] ?? DUMMY_LOOK,
      // With `law`: the police are on, and each machine knows where its own player stands from his path and every other as the host has him.
      ...(law
        ? {
            law: { solids: () => null, playerBusted: () => {}, sirens: () => {}, lineOfSight: () => true, footArrest: { busted: () => {}, led: () => {}, taken: () => {}, delivered: () => {} } },
            ownActor: () => slot,
            actorPlace: (actor: number, out: ActorPlace): boolean => {
              if (actor !== slot) return director.playerPlace(actor, out);
              if (!walkerAt(walk.path, director.crowdTime(), motion)) return false;
              out.x = motion.x;
              out.y = motion.y;
              out.z = motion.z;
              out.heading = motion.heading;
              out.velocityX = motion.vx;
              out.velocityZ = motion.vz;
              return true;
            },
          }
        : {}),
      knockWalker: (vx, vy, vz) => {
        knocks.push({ vx, vy, vz });
        return true;
      },
      staggerWalker: (dirX, dirZ) => void staggers.push({ dirX, dirZ }),
      hookHold: (actor, out) => {
        if (!holding.has(actor)) return false;
        Object.assign(out, HELD_AT);
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
            removeFigure: (dummy, spawn) => {
              if (fake.spawnOf(dummy) !== spawn) return false;
              fake.stop(dummy);
              return true;
            },
            spawnOf: (dummy) => fake.spawnOf(dummy),
          }),
    });
    director.startOpenWorld(map);
    return { director, thrown, car, fake, eye, drawn, walk, knocks, staggers, holding, drags, tethers, cables: new RemoteCables(), looks };
  };
  const host = side(false, HOST_CAR_SLOT);
  const guest = side(true, 1);
  const second = guests === 2 ? side(true, 2) : null;
  const acts = new OpenWorldActs(
    {
      actorPlace: (actor, out) => host.director.playerPlace(actor, out),
      now: () => now / 1000,
      self: () => HOST_CAR_SLOT,
      guest: () => false,
      face: () => {},
      layGun: () => false,
      sendAct: () => {},
      // As the engine's tether takes a person: another actor's ray meets one only when his own reticle lit her (`sawPerson`), the host's hook meets her as a remote ray does, and `hookBody` takes her.
      hookFire: (actor, ray, sawPerson) => {
        if (!sawPerson) return;
        host.director.hookMet(ray, HOOK_REACH_M, hooked, true);
        if (hooked.index >= 0) host.director.hookBody(hooked.index, ray.eyeX, ray.eyeZ, actor);
      },
      hookCut: () => {},
      hookReel: () => {},
      seatedCar: () => -1,
      getIn: () => 0,
      getOut: () => 0,
    },
    host.director,
  );
  const hostNet = new NetPlay(worldGame(hostWorld, "Ann", () => host.director.link(), (actor, act) => acts.hear(actor, act)).game, { connect: hub.connect, now: () => now });
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

  it("when a look for him arrives after his first body record, then the second guest's player row gets a new look word; and while no look changes, the word stays", () => {
    const r = footRoom();
    startWalking(r, 0);
    r.step(30);
    const word = playersOf(r.second!).look[GUEST_CAR]!;
    r.step(30);
    expect(playersOf(r.second!).look[GUEST_CAR], "no look has changed: the same word").toBe(word);
    r.second!.looks[GUEST_CAR] = { woman: true, shirt: 3, pants: 2, hair: 1, hat: null, mustache: false };
    r.step(2);
    expect(playersOf(r.second!).look[GUEST_CAR], "his look arrived: a new word").not.toBe(word);
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
    hostShared.took(person);
    r.step(15);
    expect([guestShared.dummy(person), guestBody.out], "the guest's ragdoll is gone").toEqual([-1, false]);
  });
});

/** The civilians the log says were knocked down, in order. */
function knocked(log: Float64Array): number[] {
  const out: number[] = [];
  for (let at = 0; at + 2 < log.length; at += 3) if (log[at] === EVENT_KIND.knock) out.push(log[at + 1]!);
  return out;
}

/** Frames a guest's foot message takes to reach the host (0.2 s), and how far west of her a guest stands to punch (m): inside the punch's 1.4 m reach. */
const FOOT_HEARD_FRAMES = 6;
const PUNCH_FROM_M = 0.9;

/** The guest, on foot west of resident `c` on his own machine, punches her: the host knows where he stands from his own foot messages, and his act goes over the wire along the line to her. */
function guestPunches(r: ReturnType<typeof startedRoom>, c: number): void {
  const { poses } = r.host.director["crowd"]!;
  const from = { x: poses.x[c]! - PUNCH_FROM_M, z: poses.z[c]! };
  r.guest.walk.path = { x0: from.x, z0: from.z, vx: 0, vz: 0, t0: r.guest.director.crowdTime(), posture: BODY_POSTURE.stand };
  r.step(FOOT_HEARD_FRAMES);
  const gap = hypot2(poses.x[c]! - from.x, poses.z[c]! - from.z);
  r.guestNet.sendAct(ACT.punch, 0, { x: from.x, y: TORSO_ABOVE_FEET, z: from.z }, { x: (poses.x[c]! - from.x) / gap, y: 0, z: (poses.z[c]! - from.z) / gap });
  r.step(1);
}

describe("given a host and a guest in a room of the open world, the guest on foot a metre from a civilian", () => {
  it("when the guest punches her three times inside ten seconds, then the first two leave her standing and the third knocks her out on the host, with the knock in the guest's log too", () => {
    const r = startedRoom();
    r.step(MORNING_FRAMES);
    const hostCrowd = r.host.director["crowd"]!;
    while (shownResident(hostCrowd) < 0) r.step(1);
    const c = shownResident(hostCrowd);
    for (let blow = 1; blow <= 2; blow++) {
      guestPunches(r, c);
      r.step(21);
    }
    expect(hostCrowd.poses.shown[c], "she is still standing after two punches").toBe(1);
    expect(knocked(r.host.director.eventLog()), "knocks on the host after two punches").toHaveLength(0);
    guestPunches(r, c);
    r.step(AFTERMATH_FRAMES);
    expect(hostCrowd.poses.shown[c], "she is hidden after the third").toBe(0);
    expect(firstMismatch(r.host.thrown.map((strike) => strike.guard), [c]), "the host's ragdolls").toBeUndefined();
    expect(firstMismatch(knocked(r.host.director.eventLog()), [c]), "the host's log").toBeUndefined();
    expect(firstMismatch(knocked(r.guest.director.eventLog()), [c]), "the guest's log").toBeUndefined();
  });
});

/** How far west of the person the guest stands to hook her or him (m). */
const HOOK_FROM_M = 6;

/** The players the crowd's log names as chased (`footChase`), in the order it holds them. */
function chasedPlayers(log: Float64Array): number[] {
  const out: number[] = [];
  for (let at = 0; at + 2 < log.length; at += 3) if (log[at] === EVENT_KIND.footChase) out.push(actorOfCopSubject(log[at + 1]!));
  return out;
}

/** The guest, standing at `from` on his own machine, fires his hook at the chest of person `id` of kind `kind` (`NAMED`) now at (x, z): his act names her and goes over the wire along the line to her. */
function guestHooks(r: ReturnType<typeof room>, from: { x: number; z: number }, kind: number, id: number, at: { x: number; z: number }): void {
  const toChest = { x: at.x - from.x, y: CHEST_HEIGHT - TORSO_ABOVE_FEET, z: at.z - from.z };
  const length = hypot3(toChest.x, toChest.y, toChest.z);
  const named = new Named();
  named.kind = kind;
  named.id = id;
  named.y = CHEST_HEIGHT;
  r.guestNet.sendAct(ACT.hookFire, 0, { x: from.x, y: TORSO_ABOVE_FEET, z: from.z }, { x: toChest.x / length, y: toChest.y / length, z: toChest.z / length }, named);
}

/** A started room (the police on, a dummies' world each side) whose guest stands on foot 6 m west of a shown civilian on his own machine, the host having heard it. */
function hookRoom() {
  const r = room({ bodies: true, law: true });
  open.push(r.hostNet, r.guestNet);
  r.step(60 + MORNING_FRAMES);
  const hostCrowd = r.host.director["crowd"]!;
  while (shownResident(hostCrowd) < 0) r.step(1);
  const civilian = shownResident(hostCrowd);
  const from = { x: hostCrowd.poses.x[civilian]! - HOOK_FROM_M, z: hostCrowd.poses.z[civilian]! };
  r.guest.walk.path = { x0: from.x, z0: from.z, vx: 0, vz: 0, t0: r.guest.director.crowdTime(), posture: BODY_POSTURE.stand };
  r.step(FOOT_HEARD_FRAMES);
  return { r, civilian, from, poses: hostCrowd.poses };
}

describe("given a host and a guest in a room of the open world, a foot cop on the host's street 6 m east of the guest on foot", () => {
  it("when the guest's hook act names the cop, then the cop is down on the host with a dummy thrown for him and the cops are after the guest, not the host's player, on the host and on the guest's machine", () => {
    const { r, civilian, from, poses } = hookRoom();
    const hostScene = r.host.director["law"]!["scene"];
    const guestScene = r.guest.director["law"]!["scene"];
    const strip = { cops: 0, hold: 0, left: 0 };
    hostScene.foot.walkers.place(0, poses.x[civilian]!, poses.z[civilian]!);
    r.step(1);
    expect(hostScene.copPoses.shown[0], "control: the cop is out on the street").toBe(1);
    expect(hostScene.footChaseOf(strip, GUEST_CAR), "control: nobody is chased before the hook").toBe(false);
    guestHooks(r, from, NAMED.cop, 0, { x: hostScene.copPoses.x[0]!, z: hostScene.copPoses.z[0]! });
    r.step(AFTERMATH_FRAMES);
    expect(hostScene.copPoses.shown[0], "the cop is no longer drawn standing on the host").toBe(0);
    expect(r.host.thrown.length, "a dummy was thrown for him on the host").toBeGreaterThan(0);
    expect(hostScene.footChaseOf(strip, GUEST_CAR), "the host's law chases the guest").toBe(true);
    expect(hostScene.footChaseOf(strip, HOST_CAR_SLOT), "the host's law does not chase the host's player").toBe(false);
    expect(firstMismatch(chasedPlayers(r.host.director.eventLog()), [GUEST_CAR]), "the players the host's log names as chased").toBeUndefined();
    expect(guestScene.footChaseOf(strip, GUEST_CAR), "the guest's own law hears the chase of him").toBe(true);
    expect(firstMismatch(chasedPlayers(r.guest.director.eventLog()), [GUEST_CAR]), "the players the guest's log names as chased").toBeUndefined();
  });
});

describe("given a host and a guest in a room of the open world, a civilian 6 m east of the guest on foot, and a host with no body to stand for her", () => {
  it("when the guest's hook act names her, then the host's hook meets nobody and stands no body for her and the law is not told; the same act with a body free stands one (that the fire is then a miss, holding nothing, is `fireFor`'s, pinned in engine-tether-actors.test.ts)", () => {
    const { r, civilian, from, poses } = hookRoom();
    const bodies = r.host.director["bodies"]!;
    const hostScene = r.host.director["law"]!["scene"];
    const canStand = vi.spyOn(bodies, "canStand").mockReturnValue(false);
    guestHooks(r, from, NAMED.civilian, civilian, { x: poses.x[civilian]!, z: poses.z[civilian]! });
    r.step(AFTERMATH_FRAMES);
    expect(bodies.has(civilian), "no body stands for her").toBe(false);
    expect(hostScene.footChaseOf({ cops: 0, hold: 0, left: 0 }, GUEST_CAR), "nothing was done to the law").toBe(false);
    canStand.mockRestore();
    guestHooks(r, from, NAMED.civilian, civilian, { x: poses.x[civilian]!, z: poses.z[civilian]! });
    r.step(AFTERMATH_FRAMES);
    expect(bodies.has(civilian), "control: with a body free, the same act stands one").toBe(true);
  });
});

describe("given a host and two guests in an open-world room, the first guest on foot", () => {
  it("when the host lands a light blow on him from the west, then within 0.3 s his own machine staggers his walker once, eastward, nothing knocks him and the second guest's walker is told nothing; and a second blow 0.6 s later staggers him once more", () => {
    const r = footRoom();
    startWalking(r, 0);
    r.step(30);
    r.host.director.staggerPlayer(GUEST_CAR, 1, 0);
    r.step(9);
    expect(r.guest.staggers.length, "staggers told to his machine").toBe(1);
    expect(r.guest.staggers[0]!.dirX, "the blow's direction (x)").toBeCloseTo(1, 1);
    expect(r.guest.knocks.length, "knocks told to his machine").toBe(0);
    expect(r.second!.staggers.length, "staggers told to the second guest's machine").toBe(0);
    r.step(9);
    r.host.director.staggerPlayer(GUEST_CAR, 1, 0);
    r.step(9);
    expect(r.guest.staggers.length, "staggers after the second blow").toBe(2);
  });

  it("when he sprints east at 7 m/s and the host lands a light blow on him from the north, then his own machine staggers his walker once, southward, and the second guest goes on drawing him within 0.5 m of where he was at its own crowd time", () => {
    const r = footRoom();
    const path = startWalking(r, SPRINT_MPS);
    r.step(15);
    r.host.director.staggerPlayer(GUEST_CAR, 0, -1);
    let widest = 0;
    for (let frames = 0; frames < 12; frames++) {
      r.step(1);
      const poses = playersOf(r.second!);
      widest = Math.max(widest, hypot2(poses.x[GUEST_CAR]! - (path.x0 + path.vx * (r.second!.director.crowdTime() - path.t0)), poses.z[GUEST_CAR]! - path.z0));
    }
    expect(r.guest.staggers.length, "staggers told to his machine").toBe(1);
    expect(r.guest.staggers[0]!.dirZ, "the blow's direction (z)").toBeCloseTo(-1, 1);
    expect(widest, "the widest the second guest draws him from where he was at its crowd time (m)").toBeLessThan(DRAWN_GAP_M);
  });

  it("when the host's hook holds one cable he fired and has him holding a first end, then his own machine reads one cable of his and an end held, and the second guest's reads none of either; and when his link to the host stalls for 1.5 s, then his machine still reads the host's last word", () => {
    const r = footRoom();
    startWalking(r, 0);
    r.step(30);
    expect([r.guest.director.hookCount(), r.guest.director.hookHeld()], "control: before the hook, his machine reads none").toEqual([0, false]);
    const cable = r.host.tethers.open(GUEST_CAR);
    r.host.tethers.setEnd(cable, 0, WORLD, FOOT_AT.x, 0, FOOT_AT.z);
    r.host.tethers.setEnd(cable, 1, WORLD, FOOT_AT.x + 3, 0, FOOT_AT.z);
    r.host.holding.add(GUEST_CAR);
    r.step(FOOT_HEARD_FRAMES);
    expect([r.guest.director.hookCount(), r.guest.director.hookHeld()], "his own machine: cables of his, an end held").toEqual([1, true]);
    expect([r.second!.director.hookCount(), r.second!.director.hookHeld()], "the second guest's machine").toEqual([0, false]);
    r.hub.setCut(r.hostNet["transport"]!.selfId, r.guestNet["transport"]!.selfId, true);
    r.step(45);
    expect([r.guest.director.hookCount(), r.guest.director.hookHeld()], "his own machine 1.5 s into a stalled link").toEqual([1, true]);
  });

  it("when the host has stood a body for him, then the host names that body's slot as his, the one his own shots and hook pass, and none for the second guest in his car", () => {
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
    expect(slot, "control: the host stood a body for him").toBeDefined();
    expect(r.host.director.playerSlot(GUEST_CAR), "the slot the host names as his").toBe(slot);
    expect(r.host.director.playerSlot(2), "the slot named for the second guest").toBe(-1);
  });
});

/** Where the shots of the rows below end, the shot counter's tracer life (s) and the metres a muzzle may stand from its player's torso. */
const FAR_END = { x: 130.5, y: 1.3, z: 80.25 };
const TRACER_LIFE_S = 0.07;
const MUZZLE_REACH_M = 1.5;
const HEARD_FAR_M = 200;
const SHOTGUN_SLOT = 2;
const RIFLE_SLOT = 3;
/** A frame this long (s) clears the rifle's spacing between drawn shots, so each step of the counter in the allocation row is drawn. */
const FIRE_STEP_S = 0.2;
/** Draw frames (a second at 1/60 s each) that clear the shotgun's 0.9 s between drawn shots, between two shots of the first row. */
const SPACED_FRAMES = 60;
/** The 600-frame loops run before the allocation row reads: cold code boxes every double, and V8 optimizes the drawing only after some hundred thousand frames. */
const WARM_LOOPS = 200;

/** The guns `side` draws for the players on foot, as the engine wires them (figures only: no dummies' world), and the shots it heard. `draw` is one frame of them from an eye `awayX` m east of the side's own. */
function gunsOf(side: Side) {
  const heard: string[] = [];
  const guns = new RemoteGuns(new THREE.MeshBasicMaterial(), () => false, () => {}, (weapon) => void heard.push(weapon));
  const draw = (awayX = 0): void => {
    guns.dt = SIM_STEP;
    guns.eyeX = side.eye.x + awayX;
    guns.eyeZ = side.eye.z;
    guns.frame(side.director.playerArms);
  };
  return { guns, heard, draw };
}

/** Net frames until `done` holds (at most `limit`, a frame of 1/30 s each, `draw` after each), how many it took. */
function stepsUntil(r: { step(n: number): void }, draw: () => void, done: () => boolean, limit: number): number {
  let steps = 0;
  while (steps < limit && !done()) {
    r.step(1);
    draw();
    steps++;
  }
  return steps;
}

describe("given a host and two guests in an open-world room, all on foot, each drawing the others' guns", () => {
  it("when the host takes the shotgun, then within 3 net frames the first guest draws a shotgun in his hand; and when he fires, then within 3 more it flashes once and one tracer runs from his gun's tip to the far end, heard 15 m off but not 200 m off", () => {
    const r = footRoom();
    r.host.walk.path = { x0: FOOT_AT.x, z0: FOOT_AT.z, vx: 0, vz: 0, t0: r.host.director.crowdTime(), posture: BODY_POSTURE.stand };
    const { guns, heard, draw } = gunsOf(r.guest);
    const arms = (): NonNullable<typeof r.guest.director.playerArms> => r.guest.director.playerArms!;
    r.step(15);
    draw();
    expect(arms().armsSeen[HOST_CAR_SLOT], "control: the guest sees the host on foot").toBe(1);
    expect(guns["meshes"][HOST_CAR_SLOT]?.visible ?? false, "control: the host holds fists: no gun drawn").toBe(false);
    r.host.director.armsHeld(SHOTGUN_SLOT);
    expect(stepsUntil(r, draw, () => arms().armsWeapon[HOST_CAR_SLOT] === SHOTGUN_SLOT, 3), "net frames until the guest has his weapon").toBeLessThan(3);
    const mesh = guns["meshes"][HOST_CAR_SLOT]!;
    expect(mesh.visible, "the shotgun is drawn").toBe(true);
    expect(mesh.geometry, "it is the shotgun's model").toBe(gunModel("shotgun").geometry);
    expect(guns["shots"].firing, "control: no flash before a shot").toBe(false);
    r.host.director.shotMade(FAR_END.x, FAR_END.y, FAR_END.z);
    expect(stepsUntil(r, draw, () => heard.length === 1, 3), "net frames until the guest sees his shot").toBeLessThan(3);
    expect(heard, "the shot is heard 15 m off").toHaveLength(1);
    const shots = guns["shots"];
    const tracers = Array.from(shots["tracerAge"]).flatMap((age, k) => (age < TRACER_LIFE_S ? [k] : []));
    expect(tracers, "tracers in the air").toHaveLength(1);
    expect(shots["flashAge"][HOST_CAR_SLOT], "seconds since the flash lit").toBeLessThanOrEqual(0.05);
    const k = tracers[0]!;
    const end = Array.from(shots["tracerAt"].subarray(6 * k + 3, 6 * k + 6));
    expect(Math.max(Math.abs(end[0]! - FAR_END.x), Math.abs(end[1]! - FAR_END.y), Math.abs(end[2]! - FAR_END.z)), "metres from the tracer's end to his shot's far end").toBeLessThanOrEqual(0.01);
    expect(hypot2(shots["tracerAt"][6 * k]! - FOOT_AT.x, shots["tracerAt"][6 * k + 2]! - FOOT_AT.z), "metres from the tracer's start to his torso").toBeLessThanOrEqual(MUZZLE_REACH_M);
    for (let frames = 0; frames < SPACED_FRAMES; frames++) {
      r.step(1);
      draw();
    }
    expect(heard, "no second shot from the same record").toHaveLength(1);
    r.host.director.shotMade(FAR_END.x, FAR_END.y, FAR_END.z);
    r.step(3);
    draw(HEARD_FAR_M);
    expect(shots.firing, "a shot 200 m off is still drawn").toBe(true);
    expect(heard, "a shot 200 m off is not heard").toHaveLength(1);
  });

  it("when the first guest takes the rifle on his own machine, then within 6 net frames the host and the second guest each draw a rifle in his hand; and when he fires, each sees one shot ending at his far end", () => {
    const r = footRoom();
    startWalking(r, 0);
    const watchers = [r.host, r.second!].map((side) => ({ side, ...gunsOf(side) }));
    r.step(15);
    r.guest.director.armsHeld(RIFLE_SLOT);
    for (const { side, guns, heard, draw } of watchers) {
      expect(stepsUntil(r, draw, () => side.director.playerArms!.armsWeapon[GUEST_CAR] === RIFLE_SLOT, 6), "net frames until he has the rifle").toBeLessThan(6);
      expect(guns["meshes"][GUEST_CAR]!.geometry, "it is the rifle's model").toBe(gunModel("rifle").geometry);
      expect(heard, "control: no shot yet").toHaveLength(0);
    }
    r.guest.director.shotMade(FAR_END.x, FAR_END.y, FAR_END.z);
    for (const { side, heard, draw } of watchers) {
      expect(stepsUntil(r, draw, () => heard.length === 1, 6), "net frames until the shot is seen").toBeLessThan(6);
      expect(Math.abs(side.director.playerArms!.armsFar[3 * GUEST_CAR]! - FAR_END.x), "metres from the far end he sent").toBeLessThanOrEqual(0.01);
    }
  });

  it("when the host's hook has the first guest holding a first end, then his own machine reads the host's point within 1 cm and the second guest's reads none; and when it lets go, then his reads none", () => {
    const r = footRoom();
    startWalking(r, 0);
    const point = { x: 0, y: 0, z: 0 };
    r.step(30);
    expect(r.guest.director.hookHeldAt(point), "control: before the hook").toBe(false);
    r.host.holding.add(GUEST_CAR);
    r.step(FOOT_HEARD_FRAMES);
    expect(r.guest.director.hookHeldAt(point), "his machine reads a held end").toBe(true);
    expect(Math.max(Math.abs(point.x - HELD_AT.x), Math.abs(point.y - HELD_AT.y), Math.abs(point.z - HELD_AT.z)), "metres from the host's point").toBeLessThanOrEqual(0.01);
    expect(r.second!.director.hookHeldAt(point), "the second guest's machine reads none").toBe(false);
    r.host.holding.delete(GUEST_CAR);
    r.step(FOOT_HEARD_FRAMES);
    expect(r.guest.director.hookHeldAt(point), "after the host lets go").toBe(false);
  });

  it("when a player fires every frame for 600 frames, then drawing his gun, flash and tracer allocates under 8 KB", () => {
    const r = footRoom();
    r.host.walk.path = { x0: FOOT_AT.x, z0: FOOT_AT.z, vx: 0, vz: 0, t0: r.host.director.crowdTime(), posture: BODY_POSTURE.stand };
    let drawn = 0;
    const guns = new RemoteGuns(new THREE.MeshBasicMaterial(), () => false, () => {}, () => void drawn++);
    guns.dt = FIRE_STEP_S;
    guns.eyeX = r.guest.eye.x;
    guns.eyeZ = r.guest.eye.z;
    const draw = (): void => guns.frame(r.guest.director.playerArms);
    r.host.director.armsHeld(RIFLE_SLOT);
    r.step(15);
    draw();
    const table = r.guest.director.playerArms!;
    const seen = r.guest.director["seenFrame"]!;
    expect(table.armsWeapon[HOST_CAR_SLOT], "control: the guest has the rifle").toBe(RIFLE_SLOT);
    let stepped = 0;
    const fire = (): void => {
      for (let frame = 0; frame < 600; frame++) {
        table.readArms(seen, GUEST_CAR, 1000);
        table.armsShots[HOST_CAR_SLOT] = ++stepped & SHOT_COUNT_MASK;
        table.armsFar[3 * HOST_CAR_SLOT] = FAR_END.x;
        table.armsFar[3 * HOST_CAR_SLOT + 1] = FAR_END.y;
        table.armsFar[3 * HOST_CAR_SLOT + 2] = FAR_END.z;
        draw();
      }
    };
    for (let warm = 0; warm < WARM_LOOPS; warm++) fire();
    const before = drawn;
    const bytes = untilQuiet(() => allocatedBytes(fire), 8192);
    expect(drawn, "control: every frame's step was drawn as a shot").toBeGreaterThan(before);
    expect(bytes, "bytes allocated by 600 frames of reading the frame and drawing a shot each").toBeLessThanOrEqual(8192);
  });
});
