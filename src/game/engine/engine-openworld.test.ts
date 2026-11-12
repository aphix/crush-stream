import * as THREE from "three";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { describe, expect, it } from "vitest";
import { buildFixtureMap } from "../ai/civilians/civilian-graph.test-util.ts";
import { carAtWalker, FRAME_SECONDS, newCrowd, shownResident, stepUntilShown } from "../ai/civilians/civilian-crowd.test-util.ts";
import { CENTIMETRES_PER_METRE, DECISION_HZ, EVENT_KIND, EVENT_TRIPLE, FIGHT_PLAYER, FLAG, GENDER, HOURS_PER_GAME_DAY, NEED, RESIDENT_INT, RESIDENT_INT_STRIDE, SPECIES, TICKS_PER_GAME_DAY } from "../ai/civilians/civilian-constants.ts";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { CROWD_TIER_SCALE, LOOK_HZ, POPULATION, POPULATION_TIER, WALKER_BEARING_STEPS, WRECK_SPEED } from "../ai/civilians/civilian-crowd-constants.ts";
import type { CivilianCrowd } from "../ai/civilians/civilian-crowd.ts";
import { LookRay, placeMet } from "../ai/civilians/civilian-look.ts";
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
import { hourOfDay, tickAt } from "../ai/civilians/civilian-clock.ts";
import { sceneryShare } from "./scenery-share.ts";
import { OPENWORLD_ID } from "../world/openworld/openworld-course.ts";
import { OpenWorldDirector } from "./engine-openworld.ts";
import type { AutoOrbit } from "./engine-openworld-auto.ts";
import { MEDICS } from "./engine-openworld-medics.ts";
import { idleOpenWorldPorts } from "./openworld-cull-ports.test-util.ts";
import { fillAwakeAtHomes } from "../ai/civilians/society-awake.ts";
import { ImaginedHouseholds } from "../ai/civilians/society-households.ts";
import { stageResident } from "../ai/civilians/society.test-util.ts";
import { FACADE_HOMES, FACADE_HOMES_FRAME, HOME_SHARE_BY_AWAKE, homeCell, texelOfShare } from "../present/facade-homes.ts";
import { shareOfTexel } from "../present/facade-homes.test-util.ts";
import { PLACE_KIND } from "../world/openworld/walk-graph.ts";
import { FakeBodyHost } from "./openworld-bodies.test-util.ts";
import { detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import { WEAPONS } from "./engine-onfoot-arms.ts";

const map = buildFixtureMap();
const SEED = 5;
const HOST_TIME = 1000;
/** A host's crowd has been out this long when it runs a civilian down, so a client's catch-up has a day's morning to replay. */
const HOST_DAY_SECONDS = 100;
const FRAME = FRAME_SECONDS;
/** Drawings a crowd makes: its own, and the ambulance crew's (`MEDICS.count` scrubs, drawn by an art of their own). */
const ARTS_PER_CROWD = 2;
/** Frames (a thirtieth of a second) the eye follows a civilian until her body stands: she may start in a doorway. */
const BODY_WAIT_FRAMES = 1800;

type WallListener = (closing: number, x: number, z: number) => void;

/** The director with its ports as fields a test sets, and what it was asked to do kept. */
class Harness {
  open = true;
  client = false;
  seed = SEED;
  /** This machine is in a shared room (a host's or a client's). */
  room = false;
  tier = POPULATION_TIER.phone;
  now = 100;
  cars: DeformableCar[] = [];
  /** Where the player on foot stands and how fast he moves, null while he is in a car. */
  footAt: { x: number; z: number; velocityX: number; velocityZ: number } | null = null;
  readonly eye = new LookRay();
  readonly thrown: FigureStrike[] = [];
  readonly strikes: { dirX: number; dirZ: number }[] = [];
  readonly staggers: { dirX: number; dirZ: number }[] = [];
  readonly looks: DriverLook[] = [];
  /** The figures the ambulance's loading took away (`removeFigure`): the slot asked for and the age given. */
  readonly removed: { slot: number; age: number }[] = [];
  readonly updates: { poses: CrowdPoses; eyeX: number; sight: CrowdSight; wallDt: number; held: Uint8Array | null }[] = [];
  /** The game hours the stage's day was set to, null for it being left. */
  readonly dayHours: (number | null)[] = [];
  artsMade = 0;
  artsDisposed = 0;
  unhooked = 0;
  listener: WallListener | null = null;
  readonly director: OpenWorldDirector;

  /** `bodies`: the dummies' world the civilians near the eye have bodies in; none: the crowd's art draws them all. */
  constructor(bodies: FakeBodyHost | null = null) {
    this.director = new OpenWorldDirector({
    ...idleOpenWorldPorts(),
    inOpenWorld: () => this.open,
    isClient: () => this.client,
    inRoom: () => this.room,
    seed: () => this.seed,
    tier: () => this.tier,
    cars: () => this.cars,
    foot: (out) => {
      if (this.footAt === null) return false;
      Object.assign(out, this.footAt);
      return true;
    },
    now: () => this.now,
    setDayHour: (hour) => void this.dayHours.push(hour),
    eye: (ray) => Object.assign(ray, this.eye),
    throwFigure: (strike, look) => {
      this.thrown.push(strike);
      this.looks.push(look);
      return this.thrown.length - 1;
    },
    removeFigure: (slot, age) => {
      this.removed.push({ slot, age });
      return true;
    },
    ...(bodies === null ? {} : { bodies }),
    strikeWalker: (dirX, dirZ) => void this.strikes.push({ dirX, dirZ }),
    staggerWalker: (dirX, dirZ) => void this.staggers.push({ dirX, dirZ }),
    hookWallHits: (listener) => {
      this.listener = listener;
      return () => void this.unhooked++;
    },
    makeArt: (capacity) => {
      this.artsMade++;
      const crewsOwn = capacity === MEDICS.count;
      return { update: (poses, eyeX, _eyeZ, sight, wallDt, held) => void (crewsOwn || this.updates.push({ poses, eyeX, sight, wallDt, held: held ?? null })), dispose: () => void this.artsDisposed++ };
    },
    });
  }

  /** A frame: the sim steps `FRAME` s first (a host), then the frame. */
  frame(): void {
    this.director.step(FRAME);
    this.director.frame(FRAME);
  }

  crowd(): CivilianCrowd {
    return this.director["crowd"]!;
  }
}

function hostWithMap(bodies: FakeBodyHost | null = null): Harness {
  const harness = new Harness(bodies);
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

/** The harness's crowd stepped until a person is shown, the director's clock brought to the crowd's, then framed until a shown person of no cast walks with nothing of the brain's to do (a cast member is no free person, and a brain clip outranks a hit's): that person. */
function shownOnTheHost(harness: Harness): number {
  harness.frame();
  const crowd = harness.crowd();
  harness.director["seconds"] = stepUntilShown(crowd, crowd.crowdSeconds);
  const { shown, activity } = crowd.poses;
  const ints = crowd.state.ints;
  for (let frame = 0; frame < 60 / FRAME; frame++) {
    for (let resident = 0; resident < crowd.poses.count; resident++) {
      const base = resident * RESIDENT_INT_STRIDE;
      if (shown[resident] === 1 && activity[resident] === ACTIVITY.none && ints[base + RESIDENT_INT.species] === SPECIES.person && (ints[base + RESIDENT_INT.flags]! & FLAG.cast) === 0) return resident;
    }
    harness.frame();
  }
  throw new Error("no free person walked the fixture's streets in a minute");
}

/** Harness frames until the director's clock reaches `seconds`. */
function frameUntil(harness: Harness, seconds: number): void {
  while (harness.director["seconds"] < seconds) harness.frame();
}

/** A shown resident of the host's crowd turned on the player standing east of her (a fight and a walker's bearing in the log), and the player 1 m east of her fight spot: the crowd second she squares up. */
function turnedOnHim(harness: Harness): number {
  const resident = shownOnTheHost(harness);
  const crowd = harness.crowd();
  const seconds = harness.director["seconds"];
  crowd["logHostEvent"](EVENT_KIND.fight, resident, seconds);
  crowd["logHostEvent"](EVENT_KIND.walker, WALKER_BEARING_STEPS / 4, seconds);
  crowd["postBatch"]();
  const ints = crowd.state.ints;
  const base = resident * RESIDENT_INT_STRIDE;
  for (let frame = 0; frame < 20 / FRAME && ints[base + RESIDENT_INT.fightPartner] !== FIGHT_PLAYER; frame++) harness.frame();
  expect(ints[base + RESIDENT_INT.fightPartner], "control: she turned on him").toBe(FIGHT_PLAYER);
  harness.footAt = { x: ints[base + RESIDENT_INT.fightX]! / CENTIMETRES_PER_METRE + 1, z: ints[base + RESIDENT_INT.fightZ]! / CENTIMETRES_PER_METRE, velocityX: 0, velocityZ: 0 };
  return ints[base + RESIDENT_INT.arriveTick]! / DECISION_HZ;
}

/** Whether the crowd's log holds a push of `resident` followed by a walker's bearing. */
function pushedByWalker(log: Float64Array, resident: number): boolean {
  for (let at = 0; at + 2 * EVENT_TRIPLE <= log.length; at += EVENT_TRIPLE) if (log[at] === EVENT_KIND.push && log[at + 1] === resident && log[at + EVENT_TRIPLE] === EVENT_KIND.walker) return true;
  return false;
}

/** The player's punch from a metre short of `resident`'s drawn spot, along +x at her. */
function punchAt(harness: Harness, resident: number): void {
  const poses = harness.crowd().poses;
  harness.director.punch(poses.x[resident]! - 1, poses.z[resident]!, 1, 0);
}

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

  // mutation: sed -i 's/^    if (this.walkerBlows >= 3) {/    if (this.walkerBlows >= 1) {/' src/game/engine/engine-openworld.ts
  it("when a civilian who turned on him lands two swings inside four seconds, then he is staggered and on his feet; the third puts him down", () => {
    const harness = hostWithMap();
    const arrive = turnedOnHim(harness);
    frameUntil(harness, arrive + 0.4);
    expect([harness.staggers.length, harness.strikes.length], "after the first swing: staggers, knockdowns").toEqual([1, 0]);
    frameUntil(harness, arrive + 1.6);
    expect([harness.staggers.length, harness.strikes.length], "after the second").toEqual([2, 0]);
    frameUntil(harness, arrive + 2.8);
    expect(harness.strikes.length, "knockdowns after the third").toBe(1);
  });

  // mutation: sed -i 's/^export const PLAYER_KO_BLOWS = 3;/export const PLAYER_KO_BLOWS = 99;/' src/game/ai/civilians/civilian-constants.ts
  it("when he punches a drawn civilian a metre ahead, then a push is logged and she plays the hit clip; the third punch inside ten seconds knocks her out: hidden, thrown, the log ending with a knock", () => {
    const harness = hostWithMap();
    const c = shownOnTheHost(harness);
    const crowd = harness.crowd();
    punchAt(harness, c);
    harness.frame();
    expect(crowd.poses.activity[c], "her clip").toBe(ACTIVITY.hit);
    expect(pushedByWalker(harness.director.eventLog(), c), "a push by a walker in the log").toBe(true);
    const thrown = harness.thrown.length;
    for (let blow = 1; blow < 3; blow++) {
      punchAt(harness, c);
      harness.frame();
    }
    expect(crowd.poses.shown[c], "shown").toBe(0);
    expect(harness.thrown.length - thrown, "figures thrown").toBe(1);
    const log = harness.director.eventLog();
    let lastKnock = -1;
    for (let at = 0; at + EVENT_TRIPLE <= log.length; at += EVENT_TRIPLE) if (log[at] === EVENT_KIND.knock) lastKnock = log[at + 1]!;
    expect(lastKnock, "the log's last knock").toBe(c);
  });

  // mutation: sed -i 's/^const SHOT_BODY_RADIUS = 0.35;/const SHOT_BODY_RADIUS = 0;/' src/game/engine/engine-openworld.ts
  it("when a rifle's ray passes a drawn civilian's chest 30 m off, then she is hidden and thrown and the log ends with a knock", () => {
    const harness = hostWithMap();
    const c = shownOnTheHost(harness);
    const crowd = harness.crowd();
    const poses = crowd.poses;
    const chest = { x: poses.x[c]!, y: poses.feetY[c]! + 1.3, z: poses.z[c]! };
    // From open street, 0.1 m to the side of her chest line: the first of eight headings whose 30 m to her meets no building.
    const ray = new LookRay();
    for (let k = 0; k < 8; k++) {
      ray.dirX = detSin((k * Math.PI) / 4);
      ray.dirY = 0;
      ray.dirZ = detCos((k * Math.PI) / 4);
      ray.eyeX = chest.x - ray.dirX * 30 + ray.dirZ * 0.1;
      ray.eyeY = chest.y;
      ray.eyeZ = chest.z - ray.dirZ * 30 - ray.dirX * 0.1;
      if (placeMet(map, ray, 250).along > 31) break;
    }
    expect(placeMet(map, ray, 250).along, "control: no building in the way (m)").toBeGreaterThan(31);
    const thrown = harness.thrown.length;
    expect(harness.director.shoot(ray, WEAPONS.rifle), "how far the shot went (m)").toBeCloseTo(30, 1);
    harness.frame();
    expect(poses.shown[c], "shown").toBe(0);
    expect(harness.thrown.length - thrown, "figures thrown").toBe(1);
    const log = harness.director.eventLog();
    let lastKnock = -1;
    for (let at = 0; at + EVENT_TRIPLE <= log.length; at += EVENT_TRIPLE) if (log[at] === EVENT_KIND.knock) lastKnock = log[at + 1]!;
    expect(lastKnock, "the log's last knock").toBe(c);
  });

  // mutation: sed -i 's/^    let reach = Math.min(gun.range, placeMet(this.map, ray, gun.range).along);/    let reach = gun.range;/' src/game/engine/engine-openworld.ts
  it("when a building stands between the ray's eye and a civilian, then the shot stops at the wall and she walks on", () => {
    const harness = hostWithMap();
    const c = shownOnTheHost(harness);
    const poses = harness.crowd().poses;
    const chest = { x: poses.x[c]!, y: poses.feetY[c]! + 1.3, z: poses.z[c]! };
    let place = map.places[0]!;
    for (const entry of map.places) if (entry.doorNode >= 0 && (place.doorNode < 0 || hypot2(entry.x - chest.x, entry.z - chest.z) < hypot2(place.x - chest.x, place.z - chest.z))) place = entry;
    const away = hypot2(place.x - chest.x, place.z - chest.z);
    const beyond = away + hypot2(place.depth, place.width) / 2 + 5;
    const ray = new LookRay();
    ray.eyeX = chest.x + ((place.x - chest.x) / away) * beyond;
    ray.eyeY = chest.y;
    ray.eyeZ = chest.z + ((place.z - chest.z) / away) * beyond;
    ray.dirX = (chest.x - ray.eyeX) / beyond;
    ray.dirY = 0;
    ray.dirZ = (chest.z - ray.eyeZ) / beyond;
    expect(harness.director.shoot(ray, WEAPONS.rifle), "how far the shot went (m)").toBeLessThan(beyond - 0.5);
    harness.frame();
    expect(poses.shown[c], "she is still shown").toBe(1);
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

  // mutation: sed -i 's/      if (this.bodies?.knock(strike) === true) {/      if (false) {/' src/game/engine/engine-openworld.ts
  it("when the car runs down a civilian who has a body near the eye, then her live body is knocked, nothing is thrown as a separate figure, and the art is told she is held", () => {
    const host = new FakeBodyHost();
    const harness = hostWithMap(host);
    carAtSomeone(harness);
    const crowd = harness.crowd();
    let resident = shownResident(crowd);
    // She may have just come out of her door (no body inside or at a building): the eye follows her until she has one.
    for (let frames = 0; frames < BODY_WAIT_FRAMES && harness.director["bodies"]!.slotOf(resident) < 0; frames++) {
      harness.eye.eyeX = crowd.poses.x[resident]!;
      harness.eye.eyeZ = crowd.poses.z[resident]!;
      harness.frame();
      host.advance(FRAME);
      if (crowd.poses.shown[resident] === 0) resident = shownResident(crowd);
    }
    expect(host.started.length, "she and anyone else near the eye have bodies").toBeGreaterThan(0);
    expect(harness.director["bodies"]!.slotOf(resident), "she has a body").toBeGreaterThanOrEqual(0);
    expect(harness.updates.at(-1)!.held?.[resident], "the art is told she is held by a body").toBe(1);
    const { car, place } = carAtWalker(crowd, resident, 6, 14);
    harness.cars = [car];
    for (let travelled = FRAME; travelled < 2 && host.knocks.length === 0; travelled += FRAME) {
      place(travelled);
      harness.director.step(FRAME);
      host.advance(FRAME);
    }
    expect(host.knocks.map((knock) => knock.strike.guard), "bodies knocked, by civilian").toContain(resident);
    expect(harness.thrown.map((strike) => strike.guard), "no separate throw of her").not.toContain(resident);
    expect(crowd.poses.shown[resident], "the crowd has her down").toBe(0);
  });

  // mutation: sed -i 's/    this.ports.removeFigure(slot, this.crowd.crowdSeconds - this.figureAt\[victim\]!);/    void slot;/' src/game/engine/engine-openworld.ts
  it("when the ambulance has loaded a civilian a car ran down far from the eye, then the figure thrown for her is taken from its slot, by how long ago it was thrown", () => {
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
    expect(harness.thrown.map((strike) => strike.guard), "thrown, by civilian").toContain(resident);
    const thrownAt = crowd.crowdSeconds;
    for (let frame = 0; frame < 60; frame++) harness.director.step(FRAME);
    harness.director["removeVictim"](resident);
    expect(harness.removed.length, "one figure taken away").toBe(1);
    expect(harness.removed[0]!.slot, "the slot the throw gave").toBe(harness.thrown.findIndex((strike) => strike.guard === resident));
    expect(harness.removed[0]!.age, "thrown this long ago (s)").toBeCloseTo(crowd.crowdSeconds - thrownAt, 1);
    harness.director["removeVictim"](resident);
    expect(harness.removed.length, "taken away once").toBe(1);
  });

  // mutation: sed -i 's/    if (this.bodies?.remove(victim) === true) return;/    void victim;/' src/game/engine/engine-openworld.ts
  it("when the ambulance has loaded a civilian whose live body lay, then that body goes and no figure is asked for", () => {
    const host = new FakeBodyHost();
    const harness = hostWithMap(host);
    carAtSomeone(harness);
    const crowd = harness.crowd();
    let resident = shownResident(crowd);
    for (let frames = 0; frames < BODY_WAIT_FRAMES && harness.director["bodies"]!.slotOf(resident) < 0; frames++) {
      harness.eye.eyeX = crowd.poses.x[resident]!;
      harness.eye.eyeZ = crowd.poses.z[resident]!;
      harness.frame();
      host.advance(FRAME);
      if (crowd.poses.shown[resident] === 0) resident = shownResident(crowd);
    }
    const slot = harness.director["bodies"]!.slotOf(resident);
    expect(slot, "she has a body").toBeGreaterThanOrEqual(0);
    const { car, place } = carAtWalker(crowd, resident, 6, 14);
    harness.cars = [car];
    for (let travelled = FRAME; travelled < 2 && host.knocks.length === 0; travelled += FRAME) {
      place(travelled);
      harness.director.step(FRAME);
      host.advance(FRAME);
    }
    expect(host.knocks.length, "her body was knocked").toBeGreaterThan(0);
    harness.director["removeVictim"](resident);
    expect(host.stopped, "her body went").toContain(slot);
    expect(harness.removed.length, "no figure asked for").toBe(0);
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
    harness.eye.eyeX = x[resident]! - detSin(yaw[resident]!) * 8;
    harness.eye.eyeZ = z[resident]! - detCos(yaw[resident]!) * 8;
    harness.eye.eyeY = 1.5;
    harness.eye.dirX = detSin(yaw[resident]!);
    harness.eye.dirZ = detCos(yaw[resident]!);
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
  const NO_ORBIT: AutoOrbit = { held: () => false, aim() {}, orbit() {}, release() {} };
  const NO_SOLIDS: Sight = { ground: FLAT_GROUND, path: null, wallTop: 0, rim: Infinity, occ: [] };

  it("when Auto is switched on, then it is on across the first frame and has no subject to frame yet, and when it is switched off the regular camera keeps the view", () => {
    const harness = hostWithMap();
    harness.director.setAuto(true);
    harness.frame();
    expect(harness.director.autoOn, "Auto after the first frame").toBe(true);
    expect(harness.director.aimAuto(camera, NO_SOLIDS, FRAME, NO_ORBIT), "framing a subject before anyone is out").toBe(false);
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

describe("given the open world's stage light following the crowd's clock", () => {
  /** Frames to run a whole number of crowd seconds (a game minute each) and a little over. */
  const framesFor = (crowdSeconds: number): number => Math.round(crowdSeconds / FRAME);
  const MINUTES_PER_HOUR = 60;
  /** Crowd seconds (game minutes) a home's share takes to rise to one person's, and to fall from it, with room to spare, and a day's ticks for a dwell that outlasts the row. */
  const FADE_MINUTES = 8;
  const NEXT_DAY_TICKS = TICKS_PER_GAME_DAY;
  /** An hour no imagined household is up (the households' midday), and one nearly every household is. */
  const QUIET_HOUR = 13;
  const EVENING_HOUR = 20;

  // mutation: sed -i 's/    if (minute === this.dayMinute) return;//' src/game/engine/engine-openworld.ts
  it("when frames pass, then the stage is told the hour once a game minute, not once a frame, and the hour is the crowd's start hour and the minutes since over sixty", () => {
    const harness = hostWithMap();
    const frames = framesFor(5);
    for (let at = 0; at < frames; at++) harness.frame();
    const minutes = Math.floor(harness.crowd().crowdSeconds) + 1;
    expect(harness.dayHours.length, "calls for the frames run").toBe(minutes);
    expect(harness.dayHours.length, "calls against frames").toBeLessThan(frames / 10);
    const start = harness.crowd().state.startHour;
    for (const [minute, hour] of harness.dayHours.entries()) expect(hour, `hour at minute ${minute}`).toBeCloseTo((start + minute / MINUTES_PER_HOUR) % 24, 9);
  });

  // mutation: sed -i 's/      this.dropDay();\n//' src/game/engine/engine-openworld.ts
  it("when the open world is left, then the stage gets one null and no more, and comes back to the hour when it is entered again", () => {
    const harness = hostWithMap();
    for (let at = 0; at < framesFor(2); at++) harness.frame();
    const before = harness.dayHours.length;
    harness.open = false;
    harness.frame();
    harness.frame();
    expect(harness.dayHours.slice(before), "calls after leaving").toEqual([null]);
    harness.open = true;
    harness.director.startOpenWorld(map);
    harness.frame();
    expect(harness.dayHours.at(-1), "the hour again once the crowd is back").not.toBeNull();
  });

  /** The last hour the stage was told, as game minutes of the day. */
  const lastMinutes = (harness: Harness): number => Math.round(harness.dayHours.filter((hour): hour is number => hour !== null).at(-1)! * MINUTES_PER_HOUR);
  const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
  const modDay = (minutes: number): number => ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

  // mutation: sed -i 's/(direction > 0 ? hour + 1 : now % MINUTES_PER_GAME_HOUR === 0 ? hour - 1 : hour)/(direction > 0 ? hour : now % MINUTES_PER_GAME_HOUR === 0 ? hour - 1 : hour)/' src/game/engine/engine-openworld.ts
  // mutation: sed -i 's/^    this.seconds = skipTo;$//' src/game/engine/engine-openworld.ts
  // mutation: sed -i 's/secondsOfGameMinutes((target - now + MINUTES_PER_GAME_DAY) % MINUTES_PER_GAME_DAY)/secondsOfGameMinutes(target - now)/' src/game/engine/engine-openworld.ts
  it("when solo skips forward and back, then the crowd's clock lands at once on the next or the previous whole game hour (minus a day on: the society cannot run backwards), its society's tick with it, and the light one stage call each", () => {
    const harness = hostWithMap();
    for (let at = 0; at < framesFor(7.4); at++) harness.frame();
    const crowd = harness.crowd();
    const before = lastMinutes(harness);
    const startSeconds = harness.director.crowdTime();
    const calls = harness.dayHours.length;
    expect(harness.director.skipDay(1), "a forward skip is taken").toBe(true);
    expect(harness.dayHours.length, "one stage call").toBe(calls + 1);
    const forward = lastMinutes(harness);
    expect(forward % MINUTES_PER_HOUR, "lands on a whole hour").toBe(0);
    const ahead = modDay(forward - before);
    expect(ahead, "the next hour's start is under an hour ahead").toBeGreaterThan(0);
    expect(ahead, "the next hour's start is under an hour ahead").toBeLessThanOrEqual(MINUTES_PER_HOUR);
    expect(harness.director.crowdTime() - startSeconds, "the crowd's clock is the game minutes on, a crowd second each").toBe(ahead);
    expect(crowd.state.nextTick, "the society has lived to the new clock").toBe(tickAt(harness.director.crowdTime()));
    expect(harness.director.skipDay(-1), "a back skip is taken").toBe(true);
    expect(lastMinutes(harness), "from a whole hour, back is the hour before").toBe(modDay(forward - MINUTES_PER_HOUR));
    expect(harness.director.crowdTime() - startSeconds, "reached by living the day's other hours").toBe(ahead + MINUTES_PER_DAY - MINUTES_PER_HOUR);
    expect(crowd.state.nextTick, "the society's tick with it").toBe(tickAt(harness.director.crowdTime()));
    expect(harness.director.skipDay(-1), "again").toBe(true);
    expect(lastMinutes(harness), "and again").toBe(modDay(forward - 2 * MINUTES_PER_HOUR));
    expect(harness.dayHours.length, "one call a skip").toBe(calls + 3);
    expect(harness.crowd(), "the same crowd").toBe(crowd);
  });

  // mutation: sed -i 's/^    this.dayMinute = gameMinuteAt(skipTo);$//' src/game/engine/engine-openworld.ts
  it("when a day's skips are made one after another, then twenty-four forward are a whole day on: the same hour, the clock a day later, and the minutes after a skip go on from the new hour", () => {
    const harness = hostWithMap();
    for (let at = 0; at < framesFor(2.2); at++) harness.frame();
    harness.director.skipDay(1);
    const landed = lastMinutes(harness);
    const landedSeconds = harness.director.crowdTime();
    for (let skip = 0; skip < 24; skip++) harness.director.skipDay(1);
    expect(lastMinutes(harness), "a day of skips lands on the same hour").toBe(landed);
    expect(harness.director.crowdTime() - landedSeconds, "a game day of crowd seconds on").toBe(MINUTES_PER_DAY);
    const calls = harness.dayHours.length;
    for (let at = 0; at < framesFor(1.2); at++) harness.frame();
    expect(harness.dayHours.length, "the next game minute calls the stage once").toBe(calls + 1);
    expect(modDay(lastMinutes(harness) - landed), "the light moved on by the game minute, from the skipped hour").toBeGreaterThan(0);
    expect(modDay(lastMinutes(harness) - landed), "the light moved on by the game minute, from the skipped hour").toBeLessThanOrEqual(2);
  });

  // mutation: sed -i 's/^    this.seconds = 0;$/    this.seconds = this.seconds;/' src/game/engine/engine-openworld.ts
  // mutation: sed -i 's/if (!this.started || !this.authority) return false;/if (!this.authority) return false;/' src/game/ai/civilians/civilian-crowd.ts
  it("when a skip is asked with no crowd, or before the crowd has stepped, then nothing is skipped; and after the open world is left and entered again, the new crowd's clock and light are its own", () => {
    const harness = hostWithMap();
    expect(harness.director.skipDay(1), "no crowd yet").toBe(false);
    harness.director.frame(FRAME);
    expect(harness.director.skipDay(1), "a crowd that has not stepped").toBe(false);
    expect(harness.director.crowdTime(), "its clock stands").toBe(0);
    for (let at = 0; at < framesFor(1.5); at++) harness.frame();
    const own = harness.dayHours.at(-1)!;
    harness.director.skipDay(1);
    expect(harness.dayHours.at(-1), "the skip moved the light").not.toBe(own);
    harness.open = false;
    harness.frame();
    harness.open = true;
    harness.director.startOpenWorld(map);
    harness.frame();
    harness.frame();
    const start = harness.crowd().state.startHour;
    expect(harness.dayHours.at(-1), "the crowd's own hour again").toBeCloseTo(start, 9);
    expect(harness.director.crowdTime(), "the new crowd's clock began at its first step").toBeCloseTo(FRAME, 9);
  });

  // mutation: sed -i 's/ || this.ports.inRoom()//' src/game/engine/engine-openworld.ts
  it("when this machine is in a room, host or client, then neither key skips anything: no stage call, and the crowd's clock and tick stand", () => {
    const host = hostWithMap();
    for (let at = 0; at < framesFor(2.2); at++) host.frame();
    const client = hostWithMap();
    client.client = true;
    client.director.hear(SEED, HOST_TIME, 40, new Float64Array(0));
    client.now += 2;
    client.frame();
    for (const harness of [host, client]) {
      harness.room = true;
      const calls = harness.dayHours.length;
      const seconds = harness.director.crowdTime();
      const tick = harness.crowd().state.nextTick;
      expect(harness.director.skipDay(1), "plus").toBe(false);
      expect(harness.director.skipDay(-1), "minus").toBe(false);
      expect(harness.dayHours.length, "no stage call").toBe(calls);
      expect(harness.director.crowdTime(), "the clock").toBe(seconds);
      expect(harness.crowd().state.nextTick, "the society's tick").toBe(tick);
    }
  });

  // mutation: sed -i 's/Math.round(hour \* MINUTES_PER_GAME_HOUR) % MINUTES_PER_GAME_DAY/Math.round(hour * MINUTES_PER_GAME_HOUR + 60) % MINUTES_PER_GAME_DAY/' src/game/engine/engine-openworld.ts
  // mutation: sed -i 's/^    this.seconds = skipTo;$//' src/game/engine/engine-openworld.ts
  it("when the hour is set, then the light reads that hour, the crowd's clock is the matching minutes on, and setting it again moves nothing", () => {
    const harness = hostWithMap();
    for (let at = 0; at < framesFor(7.4); at++) harness.frame();
    const before = lastMinutes(harness);
    const startSeconds = harness.director.crowdTime();
    expect(harness.director.setHour(18.5), "taken").toBe(true);
    expect(lastMinutes(harness), "the light's last hour").toBe(18.5 * MINUTES_PER_HOUR);
    const ahead = modDay(18.5 * MINUTES_PER_HOUR - before);
    expect(harness.director.crowdTime() - startSeconds, "the crowd's clock is those game minutes on").toBe(ahead);
    const calls = harness.dayHours.length;
    const seconds = harness.director.crowdTime();
    expect(harness.director.setHour(18.5), "taken again").toBe(true);
    expect(harness.director.crowdTime(), "the clock stands").toBe(seconds);
    expect(lastMinutes(harness), "the light stands").toBe(18.5 * MINUTES_PER_HOUR);
    expect(harness.dayHours.length - calls, "one stage call at most").toBeLessThanOrEqual(1);
  });

  // mutation: sed -i '/setHour(hour: number)/,/^  }/s/ || this.ports.inRoom()//' src/game/engine/engine-openworld.ts
  it("when the hour is set in a room, or before the first crowd frame, then it is refused and nothing moves", () => {
    const early = hostWithMap();
    expect(early.director.setHour(18.5), "no crowd yet").toBe(false);
    early.director.frame(FRAME);
    expect(early.director.setHour(18.5), "a crowd that has not stepped").toBe(false);
    expect(early.director.crowdTime(), "its clock stands").toBe(0);
    const room = hostWithMap();
    for (let at = 0; at < framesFor(2.2); at++) room.frame();
    room.room = true;
    const calls = room.dayHours.length;
    const seconds = room.director.crowdTime();
    expect(room.director.setHour(18.5), "in a room").toBe(false);
    expect(room.dayHours.length, "no stage call").toBe(calls);
    expect(room.director.crowdTime(), "the clock").toBe(seconds);
  });

  // mutation: sed -i 's/    this.homeLights.step(this.awake, settles);//' src/game/engine/engine-openworld.ts
  it("when the first game minute is lit, then each home's texel holds the share of the people awake in it, taken from the crowd's own state at that tick, and the shaders' grid is the map's", () => {
    const harness = hostWithMap();
    harness.frame();
    const crowd = harness.crowd();
    const awake = new Uint8Array(crowd.state.index.placeCount);
    const tick = tickAt(crowd.crowdSeconds);
    fillAwakeAtHomes(crowd.state, tick, awake);
    new ImaginedHouseholds(crowd.state).fill(tick, awake);
    expect(FACADE_HOMES_FRAME.value.z, "a grid for the map's homes").toBeGreaterThan(1);
    const data = FACADE_HOMES.value.image.data!;
    const frame = FACADE_HOMES_FRAME.value;
    let homes = 0;
    for (const [index, place] of map.places.entries()) {
      if (place.kind !== PLACE_KIND.home) continue;
      homes++;
      const cell = homeCell(place.x, place.z, frame.x, frame.y);
      const texel = data[cell.row * frame.z + cell.column]!;
      expect(texel, `${place.name}'s texel`).toBe(texelOfShare(HOME_SHARE_BY_AWAKE[Math.min(awake[index]!, HOME_SHARE_BY_AWAKE.length - 1)]!));
    }
    expect(homes, "homes in the fixture map").toBeGreaterThan(1);
  });

  // mutation: sed -i 's/    this.homeLights?.dispose();//' src/game/engine/engine-openworld.ts
  it("when the open world is left, then the shaders' homes grid is empty again and every style reads its fixed share", () => {
    const harness = hostWithMap();
    harness.frame();
    expect(FACADE_HOMES_FRAME.value.z, "a grid while it is up").toBeGreaterThan(1);
    harness.open = false;
    harness.frame();
    expect(FACADE_HOMES_FRAME.value.z, "an empty grid after").toBe(1);
    expect(FACADE_HOMES.value.image.data![0], "no home in it").toBe(0);
  });

  /** A city with one person, who is the first home's: the harness's crowd after a game minute and a half, every home some resident's, everyone gone and the clock at an hour when no household is up. `stay` puts the person at a place with a day of dwell there (they are awake unless it is their own home on rest); `toHour` skips the clock on to an hour. */
  function loneResident() {
    const harness = hostWithMap();
    for (let at = 0; at < framesFor(1.5); at++) harness.frame();
    const crowd = harness.crowd();
    const state = crowd.state;
    for (let resident = 0; resident < state.capacity; resident++) state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.alive] = 0;
    state.occupants.fill(1);
    const homes = map.places.flatMap((place, index) => (place.kind === PLACE_KIND.home ? [index] : []));
    const frame = FACADE_HOMES_FRAME.value;
    const toHour = (hour: number): void => {
      for (let skips = 0; skips < HOURS_PER_GAME_DAY && hourOfDay(tickAt(harness.director.crowdTime()), state.startHour) !== hour; skips++) harness.director.skipDay(1);
    };
    toHour(QUIET_HOUR);
    return {
      harness,
      homes,
      toHour,
      lone: homes[0]!,
      shop: map.places.findIndex((place) => place.kind === PLACE_KIND.shop),
      shareOf: (place: number): number => {
        const cell = homeCell(map.places[place]!.x, map.places[place]!.z, frame.x, frame.y);
        return shareOfTexel(FACADE_HOMES.value.image.data![cell.row * frame.z + cell.column]!);
      },
      stay: (place: number): void => {
        const tick = tickAt(crowd.crowdSeconds);
        stageResident(state, 0, { place, home: homes[0]!, tick, dwell: 1, nextDecision: tick + NEXT_DAY_TICKS, purpose: NEED.social });
      },
      minutes: (count: number): void => {
        for (let at = 0; at < framesFor(count); at++) harness.frame();
      },
    };
  }

  // mutation: sed -i 's/      const target = HOME_SHARE_BY_AWAKE\[people\]!;/      const target = HOME_SHARE_BY_AWAKE[1]!;/' src/game/present/facade-homes.ts
  it("when the only person in the city is awake in one home, then that home's windows light over a few game minutes and every other home stays dark, and when they go out it goes dark again", () => {
    const city = loneResident();
    city.stay(city.lone);
    city.minutes(FADE_MINUTES);
    expect(city.shareOf(city.lone), "the home with one person awake").toBeCloseTo(HOME_SHARE_BY_AWAKE[1]!, 1);
    for (const other of city.homes.slice(1)) expect(city.shareOf(other), `home ${other} with nobody`).toBe(0);
    city.stay(city.shop);
    city.minutes(FADE_MINUTES);
    expect(city.shareOf(city.lone), "the person has gone out").toBe(0);
  });

  // mutation: sed -i 's/    this.lightHomes(crowd, true);//' src/game/engine/engine-openworld.ts
  it("when solo skips the clock to another hour, then each home's windows are at the share of the people awake there at the new hour at once, not eased over minutes from the old hour's", () => {
    const city = loneResident();
    city.stay(city.lone);
    expect(city.harness.director.skipDay(1), "the skip is taken").toBe(true);
    expect(city.shareOf(city.lone), "the home with one person awake, at once").toBeCloseTo(HOME_SHARE_BY_AWAKE[1]!, 2);
    for (const other of city.homes.slice(1)) expect(city.shareOf(other), `home ${other} with nobody, at once`).toBe(0);
  });

  // mutation: sed -i 's/    this.households.fill(tick, this.awake);//' src/game/engine/engine-openworld.ts
  // mutation: sed -i 's/this.size\[place\] = 1 + /this.size[place] = state.occupants[place] > 0 ? 0 : 1 + /' src/game/ai/civilians/society-households.ts
  it("when it is eight in the evening and every resident is out, then every home, the homes some resident lives in too, is lit by its household at once, and at midday every one is dark", () => {
    const city = loneResident();
    const { state } = city.harness.crowd();
    const households = new ImaginedHouseholds(state);
    const awake = new Uint8Array(state.index.placeCount);
    city.toHour(EVENING_HOUR);
    households.fill(tickAt(city.harness.director.crowdTime()), awake);
    const lit = city.homes.filter((place) => awake[place]! > 0);
    expect(state.occupants[city.lone], "the lone home has a resident, out").toBeGreaterThan(0);
    expect(lit.length, "homes lit by their households in the evening").toBeGreaterThan(0);
    for (const place of city.homes) expect(city.shareOf(place), `home ${place} with ${awake[place]} awake`).toBeCloseTo(HOME_SHARE_BY_AWAKE[Math.min(awake[place]!, HOME_SHARE_BY_AWAKE.length - 1)]!, 2);
    city.toHour(QUIET_HOUR);
    for (const place of city.homes) expect(city.shareOf(place), `home ${place} at midday`).toBe(0);
  });
});

describe("given the open world's scenery share", () => {
  // mutation: sed -i 's/(desktop ? 1 : 0.6)/(desktop ? 1 : 1)/' src/game/engine/scenery-share.ts
  it("when the course is the open world, then the share is 1 on a desktop and 0.6 on a phone whatever the tier; a race keeps its tier's", () => {
    expect(`${sceneryShare(OPENWORLD_ID, "minimal", true)} ${sceneryShare(OPENWORLD_ID, "minimal", false)} ${sceneryShare("other", "minimal", false)}`).toBe("1 0.6 0.3");
  });
});
