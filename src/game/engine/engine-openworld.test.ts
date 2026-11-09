import * as THREE from "three";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { describe, expect, it } from "vitest";
import { buildFixtureMap } from "../ai/civilians/civilian-graph.test-util.ts";
import { carAtWalker, FRAME_SECONDS, newCrowd, shownResident, stepUntilShown } from "../ai/civilians/civilian-crowd.test-util.ts";
import { EVENT_KIND, EVENT_TRIPLE, FLAG, GENDER, RESIDENT_INT, RESIDENT_INT_STRIDE } from "../ai/civilians/civilian-constants.ts";
import { CROWD_TIER_SCALE, LOOK_HZ, POPULATION, POPULATION_TIER, WRECK_SPEED } from "../ai/civilians/civilian-crowd-constants.ts";
import type { CivilianCrowd } from "../ai/civilians/civilian-crowd.ts";
import { LookRay } from "../ai/civilians/civilian-look.ts";
import { residentNameText } from "../ai/civilians/civilian-mood.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { SUBJECT } from "../ai/openworld-auto/auto-director.ts";
import { AMBULANCE } from "../ai/openworld-traffic/ambulance.ts";
import { launch, pooledCar } from "../contact/crash-scenarios.test-util.ts";
import { INTERP_DELAY } from "../net/net-constants.ts";
import { dressOfLook } from "../present/civilian-dress.ts";
import type { DriverLook } from "../present/driver-look.ts";
import type { CrowdSight } from "../present/civilian-art.ts";
import type { FigureStrike } from "../scenes/figure-strike.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import type { Sight } from "../present/spectate-cam.ts";
import { FLAT_GROUND } from "../world/ground.ts";
import { OpenWorldDirector } from "./engine-openworld.ts";
import { MEDICS } from "./engine-openworld-medics.ts";
import { idleOpenWorldPorts } from "./openworld-cull-ports.test-util.ts";

const map = buildFixtureMap();
const SEED = 5;
const HOST_TIME = 1000;
/** A host's crowd has been out this long when it runs a civilian down, so a client's catch-up has a day's morning to replay. */
const HOST_DAY_SECONDS = 100;
const FRAME = FRAME_SECONDS;
/** Drawings a crowd makes: its own, and the ambulance crew's (`MEDICS.count` scrubs, drawn by an art of their own). */
const ARTS_PER_CROWD = 2;

type WallListener = (closing: number, x: number, z: number) => void;

/** The director with its ports as fields a test sets, and what it was asked to do kept. */
class Harness {
  open = true;
  client = false;
  seed = SEED;
  tier = POPULATION_TIER.phone;
  now = 100;
  cars: DeformableCar[] = [];
  /** Where the player on foot stands and how fast he moves, null while he is in a car. */
  footAt: { x: number; z: number; velocityX: number; velocityZ: number } | null = null;
  readonly eye = new LookRay();
  readonly thrown: FigureStrike[] = [];
  readonly looks: DriverLook[] = [];
  readonly updates: { poses: CrowdPoses; eyeX: number; sight: CrowdSight; wallDt: number }[] = [];
  artsMade = 0;
  artsDisposed = 0;
  unhooked = 0;
  listener: WallListener | null = null;
  readonly director = new OpenWorldDirector({
    ...idleOpenWorldPorts(),
    inOpenWorld: () => this.open,
    isClient: () => this.client,
    seed: () => this.seed,
    tier: () => this.tier,
    cars: () => this.cars,
    foot: (out) => {
      if (this.footAt === null) return false;
      Object.assign(out, this.footAt);
      return true;
    },
    now: () => this.now,
    eye: (ray) => Object.assign(ray, this.eye),
    throwFigure: (strike, look) => {
      this.thrown.push(strike);
      this.looks.push(look);
    },
    hookWallHits: (listener) => {
      this.listener = listener;
      return () => void this.unhooked++;
    },
    makeArt: (capacity) => {
      this.artsMade++;
      const crewsOwn = capacity === MEDICS.count;
      return { update: (poses, eyeX, _eyeZ, sight, wallDt) => void (crewsOwn || this.updates.push({ poses, eyeX, sight, wallDt })), dispose: () => void this.artsDisposed++ };
    },
  });

  /** A frame: the sim steps `FRAME` s first (a host), then the frame. */
  frame(): void {
    this.director.step(FRAME);
    this.director.frame(FRAME);
  }

  crowd(): CivilianCrowd {
    return this.director["crowd"]!;
  }
}

function hostWithMap(): Harness {
  const harness = new Harness();
  harness.director.startOpenWorld(map);
  return harness;
}

describe("given the open world's course up and a map given", () => {
  it("when the first frame comes, then the crowd is made at the population of the tier, drawn each frame from the eye, and the crowd link carries the tier above the seed", () => {
    const harness = hostWithMap();
    harness.eye.eyeX = 12;
    harness.frame();
    harness.frame();
    expect(harness.artsMade, "drawings made").toBe(ARTS_PER_CROWD);
    expect(harness.crowd().poses.count, "capacity at least the phone tier's residents").toBeGreaterThanOrEqual(POPULATION[0]);
    expect(harness.updates.length, "draws").toBe(2);
    expect(harness.updates[0]!.poses, "drew the crowd's own poses").toBe(harness.crowd().poses);
    expect(harness.updates[0]!.eyeX, "from the eye").toBe(12);
    expect(harness.updates[0]!.sight, "as the sight field sees it").toBe(harness.director.sight);
    expect(harness.updates[0]!.wallDt, "the frame's seconds").toBe(FRAME);
    expect(harness.director.link()?.seed, "the link's key").toBe(POPULATION_TIER.phone * CROWD_TIER_SCALE + SEED);
    expect(harness.listener, "wall hits heard").not.toBeNull();
  });

  it("when the map is not given, or the course is not up, then there is no crowd and no link", () => {
    const noMap = new Harness();
    noMap.frame();
    expect(noMap.artsMade, "drawings without a map").toBe(0);
    expect(noMap.director.link(), "link without a map").toBeNull();
    const away = hostWithMap();
    away.open = false;
    away.frame();
    expect(away.artsMade, "drawings away from the course").toBe(0);
    expect(away.director.link(), "link away from the course").toBeNull();
  });

  it("when the sim steps, then the crowd's clock runs on the sim's seconds and the host's link reports them", () => {
    const harness = hostWithMap();
    harness.frame();
    for (let step = 0; step < 64; step++) harness.frame();
    expect(harness.director.crowdTime(), "crowd seconds after the 64 sim steps that found a crowd").toBeCloseTo(64 * FRAME, 9);
  });
});

describe("given the player on foot in the open world", () => {
  it("when the host steps, then the crowd has him as a body at the spot and with the velocity the ragdoll world gives, and when he is in a car again, then it has none", () => {
    const harness = hostWithMap();
    harness.frame();
    harness.footAt = { x: 5, z: 6, velocityX: 2, velocityZ: -1 };
    harness.frame();
    const { walkers } = harness.crowd();
    expect(firstMismatch([walkers.count, walkers.x[0], walkers.z[0], walkers.velocityX[0], walkers.velocityZ[0]], [1, 5, 6, 2, -1]), "walkers, and his spot and velocity").toBeUndefined();
    harness.footAt = null;
    harness.frame();
    expect(harness.crowd().walkers.count, "walkers after he is back in a car").toBe(0);
  });

  it("when the crowd is a client's, then it has him the same way", () => {
    const harness = hostWithMap();
    harness.client = true;
    harness.director.hear(POPULATION_TIER.phone * CROWD_TIER_SCALE + SEED, 500, 40, new Float64Array(0));
    harness.footAt = { x: 5, z: 6, velocityX: 2, velocityZ: -1 };
    harness.frame();
    const { walkers } = harness.crowd();
    expect(firstMismatch([walkers.count, walkers.x[0], walkers.velocityX[0]], [1, 5, 2]), "walkers, and his spot and velocity").toBeUndefined();
  });
});

describe("given a crowd that has been made and the course is then left, or the seed changes", () => {
  it("when the course is left, then the drawing, the wall hook and the crowd's brain are let go, and the link is gone", () => {
    const harness = hostWithMap();
    harness.frame();
    const crowd = harness.crowd();
    harness.open = false;
    harness.frame();
    expect(harness.artsDisposed, "drawings disposed").toBe(ARTS_PER_CROWD);
    expect(harness.unhooked, "wall hooks let go").toBe(1);
    expect(crowd.usingWorker, "no worker left").toBe(false);
    expect(harness.director.link(), "link").toBeNull();
    harness.frame();
    expect(harness.artsDisposed, "disposed once").toBe(ARTS_PER_CROWD);
  });

  it("when the run's seed changes, then a new crowd starts from time zero on the new seed", () => {
    const harness = hostWithMap();
    for (let frame = 0; frame < 10; frame++) harness.frame();
    const first = harness.crowd();
    harness.seed = SEED + 1;
    harness.frame();
    expect(harness.crowd(), "a new crowd").not.toBe(first);
    expect(harness.artsMade, "drawings made").toBe(2 * ARTS_PER_CROWD);
    expect(harness.artsDisposed, "the old crowd's drawings disposed").toBe(ARTS_PER_CROWD);
    expect(harness.director.link()?.seed, "the new key").toBe(SEED + 1);
    expect(harness.director.crowdTime(), "clock restarted").toBeLessThanOrEqual(FRAME);
  });
});

describe("given a car on the host driving at a civilian, and a building hit", () => {
  function carAtSomeone(harness: Harness): void {
    harness.frame();
    const probe = harness.crowd();
    stepUntilShown(probe, probe.crowdSeconds);
  }

  it("when the car runs them down, then the ragdoll is thrown with the strike and they are gone from the drawn crowd", () => {
    const harness = hostWithMap();
    carAtSomeone(harness);
    const crowd = harness.crowd();
    const resident = shownResident(crowd);
    const { car, place } = carAtWalker(crowd, resident, 6, 14);
    harness.cars = [car];
    for (let travelled = FRAME; travelled < 2 && harness.thrown.length === 0; travelled += FRAME) {
      place(travelled);
      harness.director.step(FRAME);
    }
    expect(firstMismatch(harness.thrown.map((strike) => strike.guard), [resident]), "ragdolls thrown, by civilian").toBeUndefined();
    expect(crowd.poses.shown[resident], "shown").toBe(0);
    const drawn: DriverLook = { woman: false, shirt: 0, pants: 0, hair: 0, hat: null, mustache: false };
    dressOfLook(crowd.poses.look[resident]!, drawn);
    expect(JSON.stringify(harness.looks[0]), "the thrown civilian's dress is the drawn dummy's").toBe(JSON.stringify(drawn));
    expect(harness.looks[0]!.woman, "a woman is thrown a woman").toBe(crowd.state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.gender] === GENDER.female);
    const log = harness.director.eventLog();
    let knocked = false;
    for (let at = 0; at + EVENT_TRIPLE <= log.length; at += EVENT_TRIPLE) knocked ||= log[at] === EVENT_KIND.knock && log[at + 1] === resident;
    expect(knocked, "the knock of the civilian run down is in the log (the crowd may log pushes before it)").toBe(true);
  });

  it("when a car hits a building's face at the wreck speed, then the wall hook makes it a wreck event in the log", () => {
    const harness = hostWithMap();
    harness.frame();
    harness.frame();
    const house = map.places[harness.crowd().state.ints[RESIDENT_INT.home]!]!;
    harness.listener!(WRECK_SPEED, house.x + house.depth / 2 + 0.5, house.z);
    expect(harness.director.eventLog()[0], "kind of the first event").toBe(EVENT_KIND.wreck);
  });
});

describe("given a client that has heard nothing yet, and then the host's crowd message", () => {
  function clientHarness(): Harness {
    const harness = hostWithMap();
    harness.client = true;
    return harness;
  }

  it("when frames pass before the message, then there is no crowd, and when it comes, then the crowd is the host's seed and tier, and the clock is the host's clock behind by the interpolation delay", () => {
    const harness = clientHarness();
    harness.frame();
    expect(harness.artsMade, "drawings before the message").toBe(0);
    harness.director.hear(POPULATION_TIER.desktop * CROWD_TIER_SCALE + SEED, 500, 40, new Float64Array(0));
    harness.now += 2;
    harness.frame();
    expect(harness.crowd().poses.count, "capacity of the host's tier").toBeGreaterThanOrEqual(POPULATION[POPULATION_TIER.desktop]);
    expect(harness.director.link()?.seed, "the host's key").toBe(POPULATION_TIER.desktop * CROWD_TIER_SCALE + SEED);
    expect(harness.director.crowdTime(), "host's crowd seconds, run on two seconds, minus the delay").toBeCloseTo(40 + 2 - INTERP_DELAY, 9);
  });

  it("when the host's key changes, then the client's crowd is made again", () => {
    const harness = clientHarness();
    harness.director.hear(SEED, HOST_TIME, 0, new Float64Array(0));
    harness.frame();
    harness.director.hear(SEED + 1, HOST_TIME, 0, new Float64Array(0));
    harness.frame();
    expect(harness.artsMade, "drawings made").toBe(2 * ARTS_PER_CROWD);
    expect(harness.director.link()?.seed, "key").toBe(SEED + 1);
  });

  it("when the host's log tells of a knock and a car is by, then the client throws the civilian and the sim's own step does nothing", () => {
    const harness = clientHarness();
    const host = newCrowd(map, POPULATION[0], SEED);
    for (let seconds = 1; seconds <= HOST_DAY_SECONDS; seconds++) host.step(seconds, [], true);
    const seconds = stepUntilShown(host, HOST_DAY_SECONDS);
    const resident = shownResident(host);
    const { car } = carAtWalker(host, resident, 6, 14);
    harness.cars = [car];
    const knock = Float64Array.of(EVENT_KIND.knock, resident, seconds);
    harness.director.hear(SEED, HOST_TIME, seconds, knock);
    harness.director.step(FRAME);
    harness.frame();
    expect(harness.thrown.length, "the client's clock is behind the knock: nobody thrown yet").toBe(0);
    harness.now += 2 * INTERP_DELAY;
    harness.frame();
    expect(firstMismatch(harness.thrown.map((strike) => strike.guard), [resident]), "thrown by civilian once its clock reaches the knock").toBeUndefined();
    for (let frame = 0; frame < 8 / FRAME; frame++) {
      harness.now += FRAME;
      harness.director.frame(FRAME);
    }
    expect(harness.crowd().state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.flags]! & FLAG.hurt, "the knock, ahead of the client's clock when it was heard, reached its society").toBe(FLAG.hurt);
  });
});

describe("given a look-at panel kept up four times a second", () => {
  it("when the eye looks at a civilian, then the panel names them once the period has passed, and keeps the same object while the text is the same", () => {
    const harness = hostWithMap();
    harness.frame();
    const crowd = harness.crowd();
    const seconds = stepUntilShown(crowd, crowd.crowdSeconds);
    const resident = shownResident(crowd);
    const { x, z, yaw } = crowd.poses;
    harness.eye.eyeX = x[resident]! - Math.sin(yaw[resident]!) * 8;
    harness.eye.eyeZ = z[resident]! - Math.cos(yaw[resident]!) * 8;
    harness.eye.eyeY = 1.5;
    harness.eye.dirX = Math.sin(yaw[resident]!);
    harness.eye.dirZ = Math.cos(yaw[resident]!);
    harness.eye.dirY = 0;
    expect(harness.director.lookAt(), "before the period").toBeNull();
    for (let frame = 0; frame < 64 / LOOK_HZ + 1; frame++) harness.director.frame(FRAME);
    const first = harness.director.lookAt();
    expect(first?.title.startsWith(residentNameText(crowd.state, resident)), `title ${first?.title}, seconds ${seconds}`).toBe(true);
    for (let frame = 0; frame < 64 / LOOK_HZ; frame++) harness.director.frame(FRAME);
    expect(harness.director.lookAt(), "the same object").toBe(first);
  });
});

describe("given the Auto camera asked for in the open world", () => {
  const camera = new THREE.PerspectiveCamera();
  const NO_SOLIDS: Sight = { ground: FLAT_GROUND, path: null, wallTop: 0, rim: Infinity, occ: [] };

  it("when Auto is switched on, then it is on across the first frame and has no subject to frame yet, and when it is switched off the regular camera keeps the view", () => {
    const harness = hostWithMap();
    harness.director.setAuto(true);
    harness.frame();
    expect(harness.director.autoOn, "Auto after the first frame").toBe(true);
    expect(harness.director.aimAuto(camera, NO_SOLIDS, FRAME), "framing a subject before anyone is out").toBe(false);
    harness.director.setAuto(false);
    expect(harness.director.autoOn, "Auto after it is switched off").toBe(false);
  });
});

describe("given a client hearing the host's ambulance through its event log", () => {
  const CALLED_CAR = 5;
  const STATE_STEP = 4;

  /** A client whose host ran a civilian down: the knock and the call are in the log it hears, its car is by, and its clock is past the knock, so the civilian is thrown where he lay. */
  function knocked() {
    const harness = hostWithMap();
    harness.client = true;
    const host = newCrowd(map, POPULATION[0], SEED);
    for (let seconds = 1; seconds <= HOST_DAY_SECONDS; seconds++) host.step(seconds, [], true);
    const seconds = stepUntilShown(host, HOST_DAY_SECONDS);
    const resident = shownResident(host);
    harness.cars = [carAtWalker(host, resident, 6, 14).car];
    const log = [EVENT_KIND.knock, resident, seconds];
    harness.director.hear(SEED, HOST_TIME, seconds, Float64Array.from(log));
    harness.director.step(FRAME);
    harness.frame();
    harness.now += 2 * INTERP_DELAY;
    harness.frame();
    for (let frame = 0; frame < 8 / FRAME; frame++) {
      harness.now += FRAME;
      harness.frame();
    }
    log.push(EVENT_KIND.ambulance, resident, seconds + 10);
    return { harness, log, resident, seconds };
  }

  /** The host's log with an ambulance stage appended: its car and state. */
  function heardStage(world: ReturnType<typeof knocked>, car: number, state: number): void {
    world.log.push(EVENT_KIND.ambulanceStage, car * STATE_STEP + state, world.seconds + 20);
    world.harness.director.hear(SEED, HOST_TIME, world.seconds + 20, Float64Array.from(world.log));
    world.harness.now += FRAME;
    world.harness.frame();
  }

  it("when no stage has been heard, then no ambulance is out and the medics are not drawn", () => {
    const world = knocked();
    expect(world.harness.director.ambulanceState(), "state").toBe(0);
    expect(world.harness.director.ambulanceCar(), "car").toBe(-1);
    expect(Array.from(world.harness.director["medics"]!.poses.shown), "medics drawn").toEqual([0, 0]);
  });

  it("when the host's log says its ambulance is on its way, then the client reads that state and car, and the medics are not out yet", () => {
    const world = knocked();
    heardStage(world, CALLED_CAR, AMBULANCE.coming);
    expect(world.harness.director.ambulanceState(), "state").toBe(AMBULANCE.coming);
    expect(world.harness.director.ambulanceCar(), "car").toBe(CALLED_CAR);
    expect(world.harness.director["medics"]!.poses.shown[0], "a medic drawn").toBe(0);
  });

  it("when the log says it is loading, then both medics kneel where the civilian run down lay, and when it says idle, they are gone", () => {
    const world = knocked();
    const lay = world.harness.thrown.find((strike) => strike.guard === world.resident)!;
    expect(lay, "the civilian was thrown on the client").toBeDefined();
    heardStage(world, CALLED_CAR, AMBULANCE.coming);
    heardStage(world, CALLED_CAR, AMBULANCE.loading);
    const poses = world.harness.director["medics"]!.poses;
    expect(Array.from(poses.shown), "medics drawn").toEqual([1, 1]);
    expect((poses.x[0]! + poses.x[1]!) / 2, "x they kneel round").toBeCloseTo(lay.x, 4);
    expect((poses.z[0]! + poses.z[1]!) / 2, "z they kneel round").toBeCloseTo(lay.z, 4);
    heardStage(world, CALLED_CAR, AMBULANCE.idle);
    expect(Array.from(poses.shown), "medics drawn after it left").toEqual([0, 0]);
    expect(world.harness.director.ambulanceCar(), "car after it left").toBe(-1);
  });

  it("when the Auto camera is up while the host's ambulance is loading, then the client follows the ambulance's car", () => {
    const world = knocked();
    const ambulance = pooledCar(1);
    launch(ambulance, 40, 0, 0, 0, 0);
    ambulance.setSirens(true);
    world.harness.cars = [...world.harness.cars, ambulance];
    heardStage(world, 1, AMBULANCE.coming);
    heardStage(world, 1, AMBULANCE.loading);
    world.harness.director.setAuto(true);
    for (let frame = 0; frame < 2 / FRAME; frame++) {
      world.harness.now += FRAME;
      world.harness.frame();
    }
    expect(world.harness.director["auto"]!.subject?.kind, "kind of subject followed").toBe(SUBJECT.driver);
    expect(world.harness.director["auto"]!.subject?.id, "the car followed").toBe(1);
  });

  it("when the host steps with its own ambulance out, then its state is in the log for every guest", () => {
    const harness = hostWithMap();
    harness.frame();
    harness.frame();
    const crowd = harness.crowd();
    const stages = harness.director["stages"];
    stages.note(crowd, AMBULANCE.coming, CALLED_CAR);
    stages.note(crowd, AMBULANCE.coming, CALLED_CAR);
    const log = harness.director.eventLog();
    let stageEvents = 0;
    for (let at = 0; at + EVENT_TRIPLE <= log.length; at += EVENT_TRIPLE) if (log[at] === EVENT_KIND.ambulanceStage) stageEvents++;
    expect(stageEvents, "stage events after the same stage twice").toBe(1);
    expect(log[log.length - EVENT_TRIPLE + 1], "its subject: car and state").toBe(CALLED_CAR * STATE_STEP + AMBULANCE.coming);
  });
});
