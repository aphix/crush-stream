import { describe, expect, it } from "vitest";
import { detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import { LAYOUT } from "../../world/openworld/openworld-constants.ts";
import { openWorldGeometry } from "../../world/openworld/openworld-layout.ts";
import { buildRoadNetwork, junctionIndex } from "../../world/openworld/openworld-roads.ts";
import { OpenWorldTraffic, type DrivenCar } from "./openworld-traffic.ts";
import { fleetStyle } from "../../scenes/fleet.ts";
import { KERB_CANDIDATES } from "../../world/openworld/openworld-parking.ts";
import { AMBULANCE } from "./ambulance.ts";
import { PERSON_GAP } from "./traffic-constants.ts";
import { AMBULANCE_COLOUR, AMBULANCE_DEPOT_METRES, AMBULANCE_LOAD_SECONDS, AMBULANCE_QUEUE, EVERYDAY_BODIES, KERB_JITTER_SIDE, KERB_KEEP, KERB_REACH } from "./traffic-constants.ts";
import { LIGHT, lightState, SIGNAL_PHASE } from "./traffic-lights.ts";
import { kerbSpotsNear, residentSpotAt } from "../../world/openworld/openworld-parking.ts";
import { residentBody, residentColour, type ResidentCarPose } from "./traffic-look.ts";
import { spotUnseen } from "./traffic-ports.ts";
import { spawnSeats } from "../../world/openworld/openworld-spawn.ts";
import { maskSeatSpaces } from "./spawn-mask.ts";
import { Clock, CYCLE_SECONDS, emptyFeed, FakeField, HOLD, homeAt, makeTraffic, ProximitySight, runSeconds, STEP_SECONDS, stepField } from "./traffic-world.test-util.ts";

const FAR = 1500;
const HOME = { x: -100, z: -45 };
const WORK = { x: 120, z: 60 };
/** A home on the east side, mirroring `HOME`: the start formation keeps the spaces beside `HOME` empty, and these rows count the spaces by a door. */
const KERB_HOME = { x: 100, z: -45 };
const MOST_SECONDS = 900;
const SPOT_REACH = 1.5;

/** A field with the local player's car far from every street, so no space is in its sight. */
function quietField(): FakeField {
  const field = new FakeField();
  field.cars[0]!.stand(FAR, FAR, 0);
  return field;
}

/** Steps until `done` or `MOST_SECONDS` of sim have passed. */
function runUntil(run: { field: FakeField; traffic: OpenWorldTraffic; clock: Clock }, done: () => boolean): void {
  for (let step = 0; step < MOST_SECONDS / STEP_SECONDS && !done(); step++) stepField(run.field, run.traffic, run.clock);
}

describe("given a field whose pool cars the engine has just built (shown and simulated where it builds a car: the map's middle)", () => {
  it("when traffic starts, then every pool car is put away (hidden and not simulated) before anything else reads them", () => {
    const field = quietField();
    makeTraffic(field, { movers: 12, kerb: 10, patrol: 2, ambulance: 0 });
    expect(field.cars.length, "the pool's cars were built").toBe(1 + 12 + 10);
    for (let id = 1; id < field.cars.length; id++) {
      const car = field.cars[id]!;
      expect(car.stored && !car.group.visible, `car ${id} at (${car.group.position.x}, ${car.group.position.z}) is ${car.stored ? "stored" : "simulated"} and ${car.group.visible ? "shown" : "hidden"}`).toBe(true);
    }
  });

  it("when something outside traffic shows a car traffic put away and wakes it, then traffic puts it away again within a pass", () => {
    const field = quietField();
    const traffic = makeTraffic(field, { movers: 2, kerb: 2, patrol: 1, ambulance: 0 });
    const clock = new Clock();
    const woken = [2, 3, 4];
    for (const id of woken) {
      const car = field.cars[id]!;
      car.stand(0, 0, 0);
      car.stored = false;
      car.group.visible = true;
    }
    runSeconds(field, traffic, clock, 0.5);
    for (const id of woken) {
      const car = field.cars[id]!;
      expect(car.stored && !car.group.visible, `car ${id} at (${car.group.position.x}, ${car.group.position.z})`).toBe(true);
    }
  });
});

describe("given traffic rebuilt on the same sight field (a new crowd key mid-session)", () => {
  it("when traffic is let go, then it gives back every sight id it claimed", () => {
    const field = quietField();
    const sight = new ProximitySight(field.ports);
    const traffic = new OpenWorldTraffic([], field.ports, sight, { movers: 4, kerb: 3, patrol: 1, ambulance: 0 }, null);
    traffic.dispose();
    expect(sight.claims.length, "claims").toBe(1);
    expect(sight.releases.length, "releases").toBe(1);
    expect(sight.releases[0]!.first, "first id given back").toBe(sight.claims[0]!.first);
    expect(sight.releases[0]!.count, "ids given back").toBe(sight.claims[0]!.count);
  });
});

describe("given the open world's traffic on a field with the local player's car", () => {
  it("when traffic starts, then the field holds the seated car and one real car for every mover and kerb car, the pool past the seats", () => {
    const field = quietField();
    makeTraffic(field, { movers: 5, kerb: 3 });
    expect(field.cars.length).toBe(1 + 5 + 3);
  });

  it("when a resident's car is sent from a space by home to the nearest free space by work, then it parks in that space, near work, and holds it", () => {
    const field = quietField();
    const traffic = makeTraffic(field, { movers: 4, kerb: 0 });
    const clock = new Clock();
    const from = traffic.nearestSpot(HOME.x, HOME.z);
    const to = traffic.nearestSpot(WORK.x, WORK.z);
    const car = traffic.spawnDrivenCar(7, from, to);
    expect(car, "a car was leased").not.toBeNull();
    runUntil({ field, traffic, clock }, () => car!.arrived);
    const spots = traffic.parkingSpots;
    expect(car!.arrived, "the car arrived").toBe(true);
    expect(hypot2(field.cars[car!.index]!.group.position.x - spots.x[to]!, field.cars[car!.index]!.group.position.z - spots.z[to]!), "the car's distance from the space's middle").toBeLessThan(SPOT_REACH);
    expect(spots.stays[to], "the space was empty, not one a car stands in for good").toBe(0);
    expect(hypot2(spots.x[to]! - WORK.x, spots.z[to]! - WORK.z), "the space's distance from work").toBeLessThan(40);
    expect(traffic.claimedSpots[to], "the car holds its space").toBe(1);
    expect(traffic.claimedSpots[from], "the space it left is free").toBe(0);
  });

  it("when two residents are sent to the same workplace, then each parks in a space of its own", () => {
    const field = quietField();
    const traffic = makeTraffic(field, { movers: 4, kerb: 0 });
    const clock = new Clock();
    const cars: DrivenCar[] = [];
    for (const [resident, home] of [[1, HOME], [2, { x: HOME.x + 40, z: HOME.z }]] as const) {
      const car = traffic.spawnDrivenCar(resident, traffic.nearestSpot(home.x, home.z), traffic.nearestSpot(WORK.x, WORK.z));
      expect(car, `resident ${resident}'s car`).not.toBeNull();
      cars.push(car!);
    }
    runUntil({ field, traffic, clock }, () => cars.every((car) => car.arrived));
    const spots = traffic.parkingSpots;
    const held = cars.map((car) => {
      const at = field.cars[car.index]!.group.position;
      let best = -1;
      for (let spot = 0; spot < spots.count; spot++) if (best < 0 || hypot2(spots.x[spot]! - at.x, spots.z[spot]! - at.z) < hypot2(spots.x[best]! - at.x, spots.z[best]! - at.z)) best = spot;
      return best;
    });
    expect(cars.every((car) => car.arrived), "both arrived").toBe(true);
    expect(held[0], "the two cars' spaces").not.toBe(held[1]);
  });

  it("when ambient traffic runs for minutes, then no space ever holds two parked cars", () => {
    const field = quietField();
    const traffic = makeTraffic(field, { movers: 8, kerb: 0 });
    const clock = new Clock();
    const spots = traffic.parkingSpots;
    let parkedSeen = 0;
    runSeconds(field, traffic, clock, 420, () => {
      if (Math.round(clock.seconds / STEP_SECONDS) % 30 !== 0) return;
      const taken = new Map<number, number>();
      for (let id = 1; id < field.cars.length; id++) {
        const car = field.cars[id]!;
        if (car.stored || car.speed > 0.2) continue;
        for (let spot = 0; spot < spots.count; spot++) {
          if (hypot2(spots.x[spot]! - car.group.position.x, spots.z[spot]! - car.group.position.z) > SPOT_REACH) continue;
          expect(taken.has(spot), `at ${clock.seconds.toFixed(0)} s cars ${taken.get(spot)} and ${id} stand in space ${spot}`).toBe(false);
          taken.set(spot, id);
          parkedSeen++;
        }
      }
    });
    expect(parkedSeen, "parked cars looked at").toBeGreaterThan(20);
  });

  it("when every car of the pool is leased, then a further lease is refused", () => {
    const field = quietField();
    const traffic = makeTraffic(field, { movers: 2, kerb: 0 });
    const taken: DrivenCar[] = [];
    for (let resident = 0; resident < 2; resident++) {
      const car = traffic.spawnDrivenCar(resident, traffic.nearestSpot(HOME.x + resident * 30, HOME.z), traffic.nearestSpot(WORK.x, WORK.z));
      expect(car, `lease ${resident}`).not.toBeNull();
      taken.push(car!);
    }
    expect(traffic.spawnDrivenCar(9, traffic.nearestSpot(HOME.x, HOME.z + 60), traffic.nearestSpot(WORK.x, WORK.z))).toBeNull();
  });

  it("when the owner of a leased car sets its driver, then the car takes that driver's input until it is set to null", () => {
    const field = quietField();
    const traffic = makeTraffic(field, { movers: 2, kerb: 0, patrol: 1, ambulance: 0 });
    const clock = new Clock();
    const car = traffic.spawnDrivenCar(-1, traffic.nearestSpot(HOME.x, HOME.z), traffic.nearestSpot(WORK.x, WORK.z), { urgent: true })!;
    const own = { throttle: 0.9, steer: 0, brake: 0, ebrake: false, boost: false };
    car.driver = () => own;
    stepField(field, traffic, clock);
    expect(traffic.inputOf(car.index, STEP_SECONDS), "the owner's input").toBe(own);
    car.driver = null;
    stepField(field, traffic, clock);
    expect(traffic.inputOf(car.index, STEP_SECONDS), "traffic's own driver again").not.toBe(own);
  });
});

describe("given a resident whose car stands at the kerb near a player and then drives off", () => {
  /** A resident whose car is a hatchback or a wagon: both stand in the test's kerb pool and its movers, so nothing is rebuilt for him and a car that reports the sedan's body is caught. */
  const RESIDENT = Array.from({ length: 64 }, (_, number) => number).find((number) => residentBody(number) === "hatchback" || residentBody(number) === "wagon") ?? 0;

  /** The space resident `resident`'s car stands in (found from its pose), -1 when it stands in none. */
  function residentSpotIndex(traffic: OpenWorldTraffic, resident: number): number {
    const pose: ResidentCarPose = { x: 0, z: 0, yaw: 0, groundY: 0, bodyStyle: "sedan" };
    if (!traffic.carPoseOf(resident, pose)) return -1;
    const spots = traffic.parkingSpots;
    for (let spot = 0; spot < spots.count; spot++) if (hypot2(spots.x[spot]! - pose.x, spots.z[spot]! - pose.z) < 0.01) return spot;
    return -1;
  }

  /** The car standing within a metre of space `spot`: its id, or -1. */
  function carAt(field: FakeField, traffic: OpenWorldTraffic, spot: number): number {
    const spots = traffic.parkingSpots;
    for (let id = 1; id < field.cars.length; id++) {
      const car = field.cars[id]!;
      if (!car.stored && hypot2(car.group.position.x - spots.x[spot]!, car.group.position.z - spots.z[spot]!) < 1) return id;
    }
    return -1;
  }

  it("when the kerb car that stood there is replaced by the car that drives off, then both wear his body and his paint", () => {
    const field = new FakeField();
    const feed = emptyFeed(8);
    const traffic = makeTraffic(field, { movers: 4, kerb: 4 }, feed, [homeAt(HOME.x, HOME.z)]);
    field.cars[0]!.stand(HOME.x, HOME.z + 10, 0);
    feed.parked.count = 1;
    feed.parked.resident[0] = RESIDENT;
    feed.parked.place[0] = 0;
    const clock = new Clock();
    runSeconds(field, traffic, clock, 3);
    const spot = residentSpotIndex(traffic, RESIDENT);
    expect(spot, "his car's space").toBeGreaterThanOrEqual(0);
    const kerbId = carAt(field, traffic, spot);
    expect(kerbId, "a car stands at his space").toBeGreaterThan(0);
    expect(field.cars[kerbId]!.style.id, "the kerb car's body").toBe(residentBody(RESIDENT));
    expect(field.colours[kerbId], "the kerb car's paint").toBe(residentColour(RESIDENT));
    const to = traffic.nearestSpot(WORK.x, WORK.z);
    const car = traffic.spawnDrivenCar(RESIDENT, spot, to);
    expect(car, "he drives off").not.toBeNull();
    expect(field.cars[car!.index]!.style.id, "the driven car's body").toBe(residentBody(RESIDENT));
    expect(field.colours[car!.index], "the driven car's paint").toBe(residentColour(RESIDENT));
  });

  it("when his car's pose and door are asked, then the pose is its space's and the door opens on the car that stands there", () => {
    const field = new FakeField();
    const feed = emptyFeed(8);
    const traffic = makeTraffic(field, { movers: 4, kerb: 4 }, feed, [homeAt(HOME.x, HOME.z)]);
    field.cars[0]!.stand(HOME.x, HOME.z + 10, 0);
    feed.parked.count = 1;
    feed.parked.resident[0] = RESIDENT;
    feed.parked.place[0] = 0;
    runSeconds(field, traffic, new Clock(), 3);
    const pose: ResidentCarPose = { x: 0, z: 0, yaw: 0, groundY: -1, bodyStyle: "monster" };
    expect(traffic.carPoseOf(RESIDENT, pose), "his car is at a space").toBe(true);
    const spot = residentSpotIndex(traffic, RESIDENT);
    expect(pose.x, "x").toBeCloseTo(traffic.parkingSpots.x[spot]!, 3);
    expect(pose.yaw, "yaw").toBeCloseTo(traffic.parkingSpots.yaw[spot]!, 3);
    expect(pose.groundY, "ground").toBe(0);
    expect(pose.bodyStyle, "his car's body").toBe(residentBody(RESIDENT));
    expect(traffic.setCarDoor(RESIDENT, 0.8), "the door of the car there").toBe(true);
    const id = carAt(field, traffic, spot);
    expect(field.doors[id], "its angle").toBe(0.8);
    expect(traffic.carPoseOf(RESIDENT + 1, pose), "someone with no car here").toBe(false);
  });
});

describe("given a traffic car a patrol car chases", () => {
  const SHORT_TRIP_FROM = { x: HOME.x, z: HOME.z };
  const SHORT_TRIP_TO = { x: HOME.x + 60, z: HOME.z };

  /** A commuter's short trip with the player's car (the chaser's stand-in) just behind it. */
  function chasedWorld(): { field: FakeField; traffic: OpenWorldTraffic; clock: Clock; car: DrivenCar } {
    const field = new FakeField();
    field.cars[0]!.stand(HOME.x - 20, HOME.z, Math.PI / 2);
    const traffic = makeTraffic(field, { movers: 4, kerb: 0, patrol: 1 });
    const car = traffic.spawnDrivenCar(7, traffic.nearestSpot(SHORT_TRIP_FROM.x, SHORT_TRIP_FROM.z), traffic.nearestSpot(SHORT_TRIP_TO.x, SHORT_TRIP_TO.z))!;
    return { field, traffic, clock: new Clock(), car };
  }

  it("when a parked car, a patrol car or a human's car is named as chased, then it is refused; a car on a trip is taken", () => {
    const { field, traffic, car } = chasedWorld();
    expect(traffic.evade(car.index, 0), "a car on a trip").toBe(true);
    const parked = field.cars.findIndex((other, id) => id > 0 && id !== car.index && !other.stored);
    if (parked > 0) expect(traffic.evade(parked, 0), "a car standing parked").toBe(false);
    const patrol = traffic.spawnDrivenCar(-1, traffic.nearestSpot(HOME.x, HOME.z + 40), traffic.nearestSpot(WORK.x, WORK.z), { urgent: true })!;
    expect(traffic.evade(patrol.index, 0), "a patrol car").toBe(false);
    expect(traffic.evade(0, 0), "the human's car").toBe(false);
  });

  it("when the chaser is on it, then it runs on past the end of its trip to far spaces and does not park", () => {
    const { field, traffic, clock, car } = chasedWorld();
    expect(traffic.evade(car.index, 0)).toBe(true);
    runSeconds(field, traffic, clock, 40);
    expect(traffic.isFleeing(car.index), "it noticed the chaser and runs").toBe(true);
    expect(car.arrived, "a run of a few hundred metres is not over").toBe(false);
    expect(field.cars[car.index]!.speed, "still driving").toBeGreaterThan(5);
  });

  it("when the chase ends, then it finishes its run, drives as traffic and parks", () => {
    const { field, traffic, clock, car } = chasedWorld();
    traffic.evade(car.index, 0);
    runSeconds(field, traffic, clock, 10);
    traffic.endEvade(car.index);
    expect(traffic.isFleeing(car.index), "no longer running").toBe(false);
    runUntil({ field, traffic, clock }, () => car.arrived);
    expect(car.arrived, "it parks").toBe(true);
  });
});

describe("given the open world's ambulance", () => {
  const SCENE = { x: 20, z: -45 };
  const SECOND_SCENE = { x: -60, z: 40 };
  const FLEET = { movers: 5, kerb: 0, patrol: 1, ambulance: 1 };

  function ambulanceWorld(): { field: FakeField; traffic: OpenWorldTraffic; clock: Clock } {
    const field = quietField();
    return { field, traffic: makeTraffic(field, FLEET), clock: new Clock() };
  }

  function ambulanceId(field: FakeField): number {
    const [id] = [...field.sirens];
    return id ?? -1;
  }

  it("when it is called to a scene, then a white car with its lights on sets out from a space far away and comes to the space nearest the scene", () => {
    const { field, traffic, clock } = ambulanceWorld();
    expect(traffic.callAmbulance(SCENE.x, SCENE.z, clock.seconds), "the call was taken").toBe(true);
    expect(traffic.ambulanceState(), "on its way").toBe(AMBULANCE.coming);
    const id = ambulanceId(field);
    expect(id, "a car has its lights on").toBeGreaterThan(0);
    expect(field.colours[id], "its paint").toBe(AMBULANCE_COLOUR);
    const spots = traffic.parkingSpots;
    const scene = traffic.ambulanceSpot();
    expect(hypot2(spots.x[scene]! - SCENE.x, spots.z[scene]! - SCENE.z), "the space it comes to is near the scene").toBeLessThan(20);
    const start = field.cars[id]!.group.position;
    expect(hypot2(start.x - spots.x[scene]!, start.z - spots.z[scene]!), "it sets out from far away").toBeGreaterThanOrEqual(AMBULANCE_DEPOT_METRES);
    runUntil({ field, traffic, clock }, () => traffic.ambulanceState() === AMBULANCE.loading);
    expect(traffic.ambulanceState(), "it arrived").toBe(AMBULANCE.loading);
    const at = field.cars[id]!.group.position;
    expect(hypot2(at.x - spots.x[scene]!, at.z - spots.z[scene]!), "it stands in the space").toBeLessThan(SPOT_REACH);
    expect(field.sirens.has(id), "lights still on at the scene").toBe(true);
  });

  it("when it has stood at the scene for its loading time, then it drives off to another far space and is put away there, lights off, the pool car free again", () => {
    const { field, traffic, clock } = ambulanceWorld();
    traffic.callAmbulance(SCENE.x, SCENE.z, clock.seconds);
    const id = ambulanceId(field);
    runUntil({ field, traffic, clock }, () => traffic.ambulanceState() === AMBULANCE.loading);
    const arrivedAt = clock.seconds;
    runSeconds(field, traffic, clock, AMBULANCE_LOAD_SECONDS - 2);
    expect(traffic.ambulanceState(), "still loading shortly before its time").toBe(AMBULANCE.loading);
    expect(clock.seconds - arrivedAt, "stood").toBeGreaterThan(AMBULANCE_LOAD_SECONDS - 3);
    runUntil({ field, traffic, clock }, () => traffic.ambulanceState() === AMBULANCE.idle);
    expect(traffic.ambulanceState(), "it left and was put away").toBe(AMBULANCE.idle);
    expect(field.cars[id]!.stored, "put away").toBe(true);
    expect(field.sirens.has(id), "lights off").toBe(false);
    expect(traffic.callAmbulance(SCENE.x, SCENE.z, clock.seconds), "a new call is taken again").toBe(true);
  });

  it("when the pool has no ambulance, then a call is refused", () => {
    const none = makeTraffic(quietField(), { movers: 3, kerb: 0, patrol: 1, ambulance: 0 });
    expect(none.callAmbulance(SCENE.x, SCENE.z, 0), "a pool with no ambulance").toBe(false);
  });

  it("when a second call comes while the ambulance is out, then it waits its turn: the ambulance goes to it after the first has been loaded and left, and the medics' scene follows the call it is out on", () => {
    const { field, traffic, clock } = ambulanceWorld();
    const loaded: number[] = [];
    traffic.onAmbulanceLoaded((victim) => loaded.push(victim));
    expect(traffic.callAmbulance(SCENE.x, SCENE.z, 0, 11), "first").toBe(true);
    expect(traffic.callAmbulance(SECOND_SCENE.x, SECOND_SCENE.z, 0, 22), "second while one is out: queued").toBe(true);
    const scene = { x: 0, z: 0 };
    expect(traffic.ambulanceScene(scene), "the first call's scene").toBe(true);
    expect(scene.x, "x of the call it is out on").toBe(SCENE.x);
    runUntil({ field, traffic, clock }, () => loaded.length === 1);
    expect(loaded.length, "the first call was loaded").toBe(1);
    expect(loaded[0], "its victim").toBe(11);
    runUntil({ field, traffic, clock }, () => loaded.length === 2);
    expect(loaded[1], "then the second call's victim").toBe(22);
    expect(traffic.ambulanceScene(scene), "out on the second call").toBe(true);
    expect(scene.x, "its scene").toBe(SECOND_SCENE.x);
  });

  it("when more calls wait than the queue holds, then the one past it is refused", () => {
    const { traffic } = ambulanceWorld();
    expect(traffic.callAmbulance(SCENE.x, SCENE.z, 0), "the one it goes to").toBe(true);
    for (let waiting = 0; waiting < AMBULANCE_QUEUE; waiting++) expect(traffic.callAmbulance(SCENE.x + 10 + waiting, SCENE.z, 0), `waiting call ${waiting}`).toBe(true);
    expect(traffic.callAmbulance(SCENE.x + 50, SCENE.z, 0), "past the queue").toBe(false);
  });

  it("when the ambulance has loaded, then the victim is told once, at the end of the loading time and not before", () => {
    const { field, traffic, clock } = ambulanceWorld();
    const told: number[] = [];
    traffic.onAmbulanceLoaded((victim) => told.push(victim));
    traffic.callAmbulance(SCENE.x, SCENE.z, 0, 7);
    runUntil({ field, traffic, clock }, () => traffic.ambulanceState() === AMBULANCE.loading);
    const arrived = clock.seconds;
    runSeconds(field, traffic, clock, AMBULANCE_LOAD_SECONDS - 3);
    expect(told.length, "not told while loading").toBe(0);
    runSeconds(field, traffic, clock, 5);
    expect(told.length, "told once at the end").toBe(1);
    expect(told[0], "of the victim").toBe(7);
    expect(clock.seconds - arrived, "after the loading time").toBeGreaterThanOrEqual(AMBULANCE_LOAD_SECONDS);
  });

  it("when a patrol is leased, then it gets the cruiser and never the ambulance", () => {
    const { field, traffic } = ambulanceWorld();
    const patrol = traffic.spawnDrivenCar(-1, traffic.nearestSpot(HOME.x, HOME.z), traffic.nearestSpot(WORK.x, WORK.z), { urgent: true })!;
    expect(patrol.index, "the last mover slot").toBe(field.cars.length - 1 - 0);
    expect(field.colours[patrol.index], "no white paint").not.toBe(AMBULANCE_COLOUR);
  });
});

/** The space resident `resident`'s car stands in (from its pose), -1 when it stands in none. */
function residentSpace(traffic: OpenWorldTraffic, resident: number): number {
  const pose: ResidentCarPose = { x: 0, z: 0, yaw: 0, groundY: 0, bodyStyle: "sedan" };
  if (!traffic.carPoseOf(resident, pose)) return -1;
  const spots = traffic.parkingSpots;
  for (let spot = 0; spot < spots.count; spot++) if (hypot2(spots.x[spot]! - pose.x, spots.z[spot]! - pose.z) < 0.01) return spot;
  return -1;
}

/** A sight field in which every space is seen: nothing may be rebuilt there. */
class SeenSight extends ProximitySight {
  override observe(): boolean {
    return true;
  }
}

describe("given the player takes a resident's kerb car on foot", () => {
  const OWNER = Array.from({ length: 64 }, (_, number) => number).find((number) => residentBody(number) === "hatchback" || residentBody(number) === "wagon") ?? 0;

  function takenWorld(): { field: FakeField; traffic: OpenWorldTraffic; clock: Clock; id: number; spot: number } {
    const field = new FakeField();
    const feed = emptyFeed(8);
    feed.parked.count = 1;
    feed.parked.resident[0] = OWNER;
    feed.parked.place[0] = 0;
    const traffic = makeTraffic(field, { movers: 2, kerb: 4 }, feed, [homeAt(HOME.x, HOME.z)]);
    field.cars[0]!.stand(HOME.x, HOME.z + 10, 0);
    const clock = new Clock();
    runSeconds(field, traffic, clock, 3);
    const spot = residentSpace(traffic, OWNER);
    const id = field.cars.findIndex((car, index) => index > 0 && !car.stored && hypot2(car.group.position.x - traffic.parkingSpots.x[spot]!, car.group.position.z - traffic.parkingSpots.z[spot]!) < 1);
    expect(id, "his car stands at his space").toBeGreaterThan(0);
    expect(traffic.isEmptyCar(id), "an empty kerb car").toBe(true);
    return { field, traffic, clock, id, spot };
  }

  it("when he takes it, then its owner has no car (none is claimed for him again), the space is free and the car stays where it is, no longer traffic's", () => {
    const { field, traffic, clock, id, spot } = takenWorld();
    expect(traffic.takeCar(id), "the owner").toBe(OWNER);
    runSeconds(field, traffic, clock, 20);
    const pose: ResidentCarPose = { x: 0, z: 0, yaw: 0, groundY: 0, bodyStyle: "sedan" };
    expect(traffic.carPoseOf(OWNER, pose), "the owner has no car at a space").toBe(false);
    expect(traffic.claimedSpots[spot], "his space is free").toBe(0);
    expect(field.cars[id]!.stored, "the car was not put away").toBe(false);
    expect(traffic.owns(id), "it is not traffic's").toBe(false);
  });

  it("when it is taken and left, then it stays an empty car anyone may take, and a car on a trip is no such car", () => {
    const { field, traffic, clock, id } = takenWorld();
    traffic.takeCar(id);
    runSeconds(field, traffic, clock, 5);
    expect(traffic.isEmptyCar(id), "the car he left").toBe(true);
    const trip = traffic.spawnDrivenCar(5, traffic.nearestSpot(HOME.x, HOME.z + 40), traffic.nearestSpot(WORK.x, WORK.z))!;
    expect(traffic.isEmptyCar(trip.index), "a car on a trip has its driver").toBe(false);
  });
});

describe("given residents whose cars show at the kerb and drive off, over a minute", () => {
  const BODIES_ASKED = 4;
  /** One resident for each everyday body. */
  const residents = EVERYDAY_BODIES.map((body) => Array.from({ length: 200 }, (_, number) => number).find((number) => residentBody(number) === body) ?? 0);

  function parkedFeed(count: number): ReturnType<typeof emptyFeed> {
    const feed = emptyFeed(8);
    feed.parked.count = count;
    for (let index = 0; index < count; index++) {
      feed.parked.resident[index] = residents[index]!;
      feed.parked.place[index] = 0;
    }
    return feed;
  }

  it("when a car of each body is among the pool, then no car is rebuilt for a body: each resident gets a pool car that wears his", () => {
    const field = new FakeField();
    const feed = parkedFeed(BODIES_ASKED);
    const traffic = makeTraffic(field, { movers: 6, kerb: 6 }, feed, [homeAt(KERB_HOME.x, KERB_HOME.z)]);
    const base = field.rebuilt.length;
    field.cars[0]!.stand(KERB_HOME.x, KERB_HOME.z + 10, 0);
    const clock = new Clock();
    runSeconds(field, traffic, clock, 30);
    for (const resident of residents) {
      const from = residentSpace(traffic, resident);
      expect(from, `resident ${resident}'s space`).toBeGreaterThanOrEqual(0);
      expect(traffic.spawnDrivenCar(resident, from, traffic.nearestSpot(WORK.x, WORK.z)), `resident ${resident} drives off`).not.toBeNull();
    }
    runSeconds(field, traffic, clock, 30);
    expect(field.rebuilt.length - base, "cars rebuilt for a body").toBe(0);
  });

  it("when no pool car wears his body and every space is seen, then his car stands there as it is: nothing is rebuilt where an eye is", () => {
    const field = new FakeField();
    const feed = emptyFeed(8);
    const mismatched = Array.from({ length: 200 }, (_, number) => number).find((number) => residentBody(number) === "pickup" || residentBody(number) === "sedan") ?? 0;
    feed.parked.count = 1;
    feed.parked.resident[0] = mismatched;
    feed.parked.place[0] = 0;
    const traffic = new OpenWorldTraffic([homeAt(HOME.x, HOME.z)], field.ports, new SeenSight(field.ports), { movers: 0, kerb: 2, patrol: 0, ambulance: 0 }, feed);
    const base = field.rebuilt.length;
    field.cars[0]!.stand(HOME.x, HOME.z + 10, 0);
    runSeconds(field, traffic, new Clock(), 3);
    expect(residentSpace(traffic, mismatched), "his car has a space").toBeGreaterThanOrEqual(0);
    expect(traffic.counts().kerb, "kerb cars stand").toBeGreaterThan(0);
    expect(field.rebuilt.length - base, "cars rebuilt in view").toBe(0);
  });
});

describe("given a resident's car leased for a drive whose rider is due at the far end at a set second", () => {
  const FAR_AWAY = { x: 140, z: 90 };
  const DUE_SECONDS = 20;

  function dueCar(playerAt: { x: number; z: number }): { field: FakeField; traffic: OpenWorldTraffic; clock: Clock; car: DrivenCar; to: number } {
    const field = new FakeField();
    field.cars[0]!.stand(playerAt.x, playerAt.z, 0);
    const traffic = makeTraffic(field, { movers: 3, kerb: 0 });
    const to = traffic.nearestSpot(WORK.x, WORK.z);
    const car = traffic.spawnDrivenCar(7, traffic.nearestSpot(HOME.x, HOME.z), to, { dueSeconds: DUE_SECONDS })!;
    expect(car, "a car was leased").not.toBeNull();
    return { field, traffic, clock: new Clock(), car, to };
  }

  it("when the rider's second comes with the car still on the road and no one near it, then the car stands in its space, parked and still", () => {
    const { field, traffic, clock, car, to } = dueCar({ x: FAR, z: FAR });
    runSeconds(field, traffic, clock, DUE_SECONDS + 1);
    const spots = traffic.parkingSpots;
    const at = field.cars[car.index]!.group.position;
    expect(car.arrived, "arrived").toBe(true);
    expect(hypot2(at.x - spots.x[to]!, at.z - spots.z[to]!), "the car's distance from its space's middle").toBeLessThan(0.01);
    expect(field.cars[car.index]!.speed, "standing").toBeLessThan(0.01);
  });

  it("when a player's car is near it at that second, then the car is not moved: it drives on and parks when it gets there", () => {
    const { field, traffic, clock, car } = dueCar(FAR_AWAY);
    field.cars[0]!.stand(HOME.x, HOME.z + 10, 0);
    runSeconds(field, traffic, clock, DUE_SECONDS + 1);
    expect(car.arrived, "still on the road at the second").toBe(false);
  });
});

describe("given residents whose cars stand at a place's kerb", () => {
  it("when two residents of one place have cars, then each holds a different one of the four empty spaces nearest its door, the one he is by number", () => {
    const field = quietField();
    const feed = emptyFeed(8);
    const traffic = makeTraffic(field, { movers: 0, kerb: 0 }, feed, [homeAt(KERB_HOME.x, KERB_HOME.z)]);
    const clock = new Clock();
    feed.parked.count = 2;
    feed.parked.resident[0] = 1;
    feed.parked.place[0] = 0;
    feed.parked.resident[1] = 2;
    feed.parked.place[1] = 0;
    runSeconds(field, traffic, clock, 1);
    const near = new Int32Array(KERB_CANDIDATES);
    const count = kerbSpotsNear(traffic.parkingSpots, KERB_HOME.x, KERB_HOME.z, near);
    // The spaces beside the start formation are held for good (`maskedSpaces`): every held space is one of those or one of the two wanted.
    const masked = new Uint8Array(traffic.parkingSpots.count);
    maskSeatSpaces(traffic.parkingSpots, spawnSeats(openWorldGeometry(LAYOUT)), masked);
    const held = Array.from(traffic.claimedSpots.keys()).filter((spot) => traffic.claimedSpots[spot] === 1);
    const unmasked = held.filter((spot) => masked[spot] === 0);
    const wanted = [near[1 % count]!, near[2 % count]!].sort((a, b) => a - b);
    unmasked.sort((a, b) => a - b);
    expect(held.length, "spaces held: the two and the masked").toBe(2 + traffic.maskedSpaces);
    expect(unmasked.length, "spaces held that are not masked").toBe(2);
    expect(unmasked[0], "the lower space held").toBe(wanted[0]);
    expect(unmasked[1], "the higher space held").toBe(wanted[1]);
  });

  it("when a resident's own space is held by another's claim only as his fallback, then she gets her own space, as the brain draws her, and he moves on; a claim that is its holder's own pick is kept", () => {
    const field = quietField();
    const feed = emptyFeed(8);
    const traffic = makeTraffic(field, { movers: 0, kerb: 0 }, feed, [homeAt(KERB_HOME.x, KERB_HOME.z)]);
    const clock = new Clock();
    const near = new Int32Array(KERB_CANDIDATES);
    const count = kerbSpotsNear(traffic.parkingSpots, KERB_HOME.x, KERB_HOME.z, near);
    expect(count, "control: four spaces by the door").toBe(4);
    // 1 and 5 both pick near[1]: 1 claims it first, 5 falls back to near[2], which is 2's own pick.
    feed.parked.count = 3;
    for (const [at, resident] of [1, 5, 2].entries()) {
      feed.parked.resident[at] = resident;
      feed.parked.place[at] = 0;
    }
    runSeconds(field, traffic, clock, 1);
    expect(residentSpace(traffic, 1), "1 keeps his own pick").toBe(near[1]);
    expect(residentSpace(traffic, 2), "2 has her own pick").toBe(near[2]);
    expect(residentSpace(traffic, 5), "5 moved on to the next free one").toBe(near[3]);
  });

  it("when a neighbour next door picks the space a resident holds as his own pick at his own door, then he keeps it: his claim is judged by his door, not hers", () => {
    const field = quietField();
    const probe = makeTraffic(field, { movers: 0, kerb: 0 });
    const spots = probe.parkingSpots;
    // A door a few metres along from his, and a neighbour there, whose pick is his own pick while his pick by her door is another space.
    let found: { holder: number; dx: number; dz: number; neighbour: number } | null = null;
    for (let holder = 0; holder < 8 && found === null; holder++) {
      const his = residentSpotAt(spots, KERB_HOME.x, KERB_HOME.z, holder);
      for (let step = 1; step <= 48 && found === null; step++) {
        const dx = (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 4) * 1.5 * (step % 4 < 2 ? 1 : 0);
        const dz = (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 4) * 1.5 * (step % 4 < 2 ? 0 : 1);
        if (residentSpotAt(spots, KERB_HOME.x + dx, KERB_HOME.z + dz, holder) === his) continue;
        for (let neighbour = 0; neighbour < 16 && found === null; neighbour++) if (neighbour !== holder && residentSpotAt(spots, KERB_HOME.x + dx, KERB_HOME.z + dz, neighbour) === his) found = { holder, dx, dz, neighbour };
      }
    }
    expect(found, "control: adjacent doors whose candidates are shifted").not.toBeNull();
    const feed = emptyFeed(8);
    const HOLDER = found!.holder;
    const traffic = makeTraffic(field, { movers: 0, kerb: 0 }, feed, [homeAt(KERB_HOME.x, KERB_HOME.z), homeAt(KERB_HOME.x + found!.dx, KERB_HOME.z + found!.dz)]);
    const clock = new Clock();
    feed.parked.count = 1;
    feed.parked.resident[0] = HOLDER;
    feed.parked.place[0] = 0;
    runSeconds(field, traffic, clock, 1);
    const his = residentSpace(traffic, HOLDER);
    expect(his, "control: he holds his own pick").toBe(residentSpotAt(spots, KERB_HOME.x, KERB_HOME.z, HOLDER));
    feed.parked.count = 2;
    feed.parked.resident[1] = found!.neighbour;
    feed.parked.place[1] = 1;
    runSeconds(field, traffic, clock, 1);
    expect(residentSpace(traffic, HOLDER), "he keeps his own pick").toBe(his);
    expect(residentSpace(traffic, found!.neighbour), "she has another space").not.toBe(his);
  });
});

describe("given a patrol car on an urgent trip that is sent somewhere else on its way", () => {
  const ELSEWHERE = { x: -150, z: 80 };

  it("when it is redirected mid-trip, then it drives on along the streets from where it is and parks in the new space, which it holds; the old one is free again", () => {
    const field = quietField();
    const traffic = makeTraffic(field, { movers: 2, kerb: 0, patrol: 1, ambulance: 0 });
    const clock = new Clock();
    const first = traffic.nearestSpot(WORK.x, WORK.z);
    const car = traffic.spawnDrivenCar(-1, traffic.nearestSpot(HOME.x, HOME.z), first, { urgent: true })!;
    runSeconds(field, traffic, clock, 6);
    expect(car.arrived, "still on its way when redirected").toBe(false);
    const next = traffic.nearestSpot(ELSEWHERE.x, ELSEWHERE.z);
    expect(traffic.redirect(car, next), "redirected").toBe(true);
    runUntil({ field, traffic, clock }, () => car.arrived);
    const spots = traffic.parkingSpots;
    const at = field.cars[car.index]!.group.position;
    expect(car.arrived, "arrived").toBe(true);
    expect(hypot2(at.x - spots.x[next]!, at.z - spots.z[next]!), "distance from the new space's middle").toBeLessThan(SPOT_REACH);
    expect(traffic.claimedSpots[next], "the new space is held").toBe(1);
    expect(traffic.claimedSpots[first], "the first space is free again").toBe(0);
  });

  it("when it is redirected to a space another car holds, then the redirect is refused and its trip stands", () => {
    const field = quietField();
    const traffic = makeTraffic(field, { movers: 3, kerb: 0, patrol: 1, ambulance: 0 });
    const other = traffic.spawnDrivenCar(4, traffic.nearestSpot(HOME.x, HOME.z + 40), traffic.nearestSpot(ELSEWHERE.x, ELSEWHERE.z))!;
    expect(other, "a car leased").not.toBeNull();
    const held = traffic.claimedSpots.indexOf(1);
    expect(held, "the space the other car is going to").toBeGreaterThanOrEqual(0);
    const patrol = traffic.spawnDrivenCar(-1, traffic.nearestSpot(HOME.x, HOME.z), traffic.nearestSpot(WORK.x, WORK.z), { urgent: true })!;
    stepField(field, traffic, new Clock());
    expect(traffic.redirect(patrol, held)).toBe(false);
  });
});

describe("given the player's car crossing a junction's stop bar", () => {
  const network = buildRoadNetwork(openWorldGeometry(LAYOUT));
  const junction = junctionIndex(network, 1, 1);
  const barX = network.junctionX[junction]! - network.stopBar;
  const laneZ = network.junctionZ[junction]! + network.laneOffset;
  const through = SIGNAL_PHASE.eastWestThrough;

  function timeWhere(red: boolean): number {
    for (let seconds = 0; seconds < CYCLE_SECONDS; seconds += 0.5) {
      const blocked = lightState(junction, through, seconds) === LIGHT.red && lightState(junction, through + 1, seconds) === LIGHT.red;
      const free = lightState(junction, through, seconds) === LIGHT.green;
      if (red ? blocked : free) return seconds;
    }
    throw new Error("no such instant");
  }

  /** The local player's car walked over x positions `route` along the east-west lane, the clock held at `seconds`; the runs the traffic reported. */
  function walk(route: readonly number[], seconds: number): { id: number; x: number }[] {
    const field = quietField();
    const traffic = makeTraffic(field, { movers: 0, kerb: 0 });
    const runs: { id: number; x: number }[] = [];
    traffic.onRedLightRun((id, x) => runs.push({ id, x }));
    const player = field.cars[0]!;
    for (const x of route) {
      player.stand(x, laneZ, Math.PI / 2);
      traffic.step(seconds, STEP_SECONDS);
    }
    return runs;
  }

  const crossing = [barX - 3, barX - 2.5, barX - 2, barX - 1.5, barX - 1, barX - 0.5, barX, barX + 0.5, barX + 1, barX + 2, barX + 3];

  it("when it crosses on red, then the red-light run is raised once, for the player's car", () => {
    const runs = walk(crossing, timeWhere(true));
    expect(runs.length).toBe(1);
    expect(runs[0]!.id).toBe(0);
    expect(Math.abs(runs[0]!.x - barX)).toBeLessThan(1);
  });

  it("when it crosses back and forth on red, then the run is still raised once", () => {
    const back = [...crossing].reverse();
    expect(walk([...crossing, ...back, ...crossing], timeWhere(true)).length).toBe(1);
  });

  it("when it crosses on green, then no run is raised", () => {
    expect(walk(crossing, timeWhere(false)).length).toBe(0);
  });

  it("when traffic itself drives for minutes, then none of its cars runs a red light", () => {
    const field = quietField();
    const traffic = makeTraffic(field, { movers: 8, kerb: 0 });
    const clock = new Clock();
    const runs: number[] = [];
    traffic.onRedLightRun((id) => runs.push(id));
    runSeconds(field, traffic, clock, 420);
    expect(traffic.counts().driving + runs.length, "cars drove at all").toBeGreaterThan(0);
    expect(runs, "cars that ran a red").toEqual([]);
  });
});

describe("given kerb cars standing near the local player", () => {
  function kerbWorld(): { field: FakeField; traffic: OpenWorldTraffic; clock: Clock } {
    const field = new FakeField();
    const traffic = makeTraffic(field, { movers: 0, kerb: 4 });
    field.cars[0]!.stand(0, 0, 0);
    return { field, traffic, clock: new Clock() };
  }

  it("when the player has been in a street for a few seconds, then kerb cars stand in spaces where a car stands for good, within reach of it", () => {
    const { field, traffic, clock } = kerbWorld();
    runSeconds(field, traffic, clock, 4);
    const spots = traffic.parkingSpots;
    expect(traffic.counts().kerb, "kerb cars standing").toBeGreaterThan(0);
    for (let id = 1; id < field.cars.length; id++) {
      const car = field.cars[id]!;
      if (car.stored) continue;
      let nearest = -1;
      for (let spot = 0; spot < spots.count; spot++) if (nearest < 0 || hypot2(spots.x[spot]! - car.group.position.x, spots.z[spot]! - car.group.position.z) < hypot2(spots.x[nearest]! - car.group.position.x, spots.z[nearest]! - car.group.position.z)) nearest = spot;
      expect(spots.stays[nearest], `the space car ${id} stands in is one a car stands in for good`).toBe(1);
      expect(hypot2(car.group.position.x, car.group.position.z), `car ${id}'s distance from the player (the space's, and the nudge off it)`).toBeLessThan(KERB_REACH + KERB_JITTER_SIDE);
    }
  });

  it("when the player drives far away, then the kerb cars are put away", () => {
    const { field, traffic, clock } = kerbWorld();
    runSeconds(field, traffic, clock, 4);
    field.cars[0]!.stand(FAR, FAR, 0);
    runSeconds(field, traffic, clock, 2);
    expect(traffic.counts().kerb).toBe(0);
    for (let id = 1; id < field.cars.length; id++) expect(field.cars[id]!.stored, `car ${id} put away`).toBe(true);
  });

  it("when a resident's clip starts at an empty space no eye sees, then a kerb car stands there in her colour as hers, her door opens, the space is refused to another resident, and the car is kept through the clip though no player is near, then put away", () => {
    const { field, traffic, clock } = kerbWorld();
    runSeconds(field, traffic, clock, 4);
    const spots = traffic.parkingSpots;
    const RESIDENT = 7;
    let spot = -1;
    for (let at = 0; at < spots.count; at++) if (spots.stays[at] !== 1 && (spot < 0 || hypot2(spots.x[at]!, spots.z[at]!) > hypot2(spots.x[spot]!, spots.z[spot]!))) spot = at;
    expect(hypot2(spots.x[spot]!, spots.z[spot]!), "control: the space is past KERB_KEEP of the player, where a car nobody holds is put away").toBeGreaterThan(KERB_KEEP);
    expect(traffic.clipSpot(RESIDENT, spots.x[spot]!, spots.z[spot]!, spots.yaw[spot]!, 0, 0), "a car stands for her, at that space").toBe(spot);
    // The pool stands a put-away car at another kerb space in the same pass, so her car's id is no mark of it: what stands at her space is.
    const standsAtHerSpace = (): boolean => field.cars.some((car, id) => id > 0 && !car.stored && hypot2(car.group.position.x - spots.x[spot]!, car.group.position.z - spots.z[spot]!) < KERB_JITTER_SIDE + 0.1);
    let hers = -1;
    for (let id = 1; id < field.cars.length; id++) if (!field.cars[id]!.stored && hypot2(field.cars[id]!.group.position.x - spots.x[spot]!, field.cars[id]!.group.position.z - spots.z[spot]!) < KERB_JITTER_SIDE + 0.1) hers = id;
    expect(hers, "a pool car stands at her space").toBeGreaterThan(0);
    expect(field.colours[hers], "in her colour").toBe(residentColour(RESIDENT));
    expect(traffic.setCarDoor(RESIDENT, 1), "it is hers: her door is set").toBe(true);
    expect(field.doors[hers], "her door").toBe(1);
    expect(traffic.clipSpot(RESIDENT, spots.x[spot]!, spots.z[spot]!, spots.yaw[spot]!, 0, 0), "asked again: it is there").toBe(spot);
    expect(traffic.clipSpot(RESIDENT + 1, spots.x[spot]!, spots.z[spot]!, spots.yaw[spot]!, 0, 0), "the space is hers: refused to another").toBe(-1);
    runSeconds(field, traffic, clock, 1);
    expect(standsAtHerSpace(), "kept through the clip").toBe(true);
    runSeconds(field, traffic, clock, 5);
    expect(standsAtHerSpace(), "put away after the hold").toBe(false);
  });

  it("when her car is on a trip and her clip starts at an empty unseen space, then no car is brought there and the space stays free", () => {
    const field = new FakeField();
    const traffic = makeTraffic(field, { movers: 1, kerb: 4 });
    field.cars[0]!.stand(0, 0, 0);
    const clock = new Clock();
    const RESIDENT = 7;
    expect(traffic.spawnDrivenCar(RESIDENT, traffic.nearestSpot(HOME.x, HOME.z), traffic.nearestSpot(WORK.x, WORK.z)), "her car leaves on a trip").not.toBeNull();
    runSeconds(field, traffic, clock, 4);
    expect(traffic.counts().driving, "control: it is on its trip").toBe(1);
    const spots = traffic.parkingSpots;
    let spot = -1;
    for (let at = 0; at < spots.count; at++) if (spots.stays[at] !== 1 && (spot < 0 || hypot2(spots.x[at]!, spots.z[at]!) > hypot2(spots.x[spot]!, spots.z[spot]!))) spot = at;
    expect(traffic.clipSpot(RESIDENT, spots.x[spot]!, spots.z[spot]!, spots.yaw[spot]!, 0, 0), "no car stands for her: hers is on the road").toBe(-1);
    runSeconds(field, traffic, clock, 1);
    expect(field.cars.some((car, id) => id > 0 && !car.stored && hypot2(car.group.position.x - spots.x[spot]!, car.group.position.z - spots.z[spot]!) < KERB_JITTER_SIDE + 0.1), "nothing stands at that space").toBe(false);
    expect(traffic["context"].taken[spot], "the space stays free").toBe(0);
  });

  /** Two unclaimed spaces where no car stands for good, far from the player: `spot` the farthest, `own` the next. */
  function twoSpaces(traffic: OpenWorldTraffic): { spot: number; own: number } {
    const spots = traffic.parkingSpots;
    const reach = (at: number): number => hypot2(spots.x[at]!, spots.z[at]!);
    let spot = -1;
    for (let at = 0; at < spots.count; at++) if (spots.stays[at] !== 1 && (spot < 0 || reach(at) > reach(spot))) spot = at;
    let own = -1;
    for (let at = 0; at < spots.count; at++) if (at !== spot && spots.stays[at] !== 1 && (own < 0 || reach(at) > reach(own))) own = at;
    const context = traffic["context"];
    expect([context.standing[spot], context.standing[own], context.taken[spot], context.taken[own]].join("/"), "control: both spaces are empty and free").toBe("0/0/0/0");
    return { spot, own };
  }

  /** Resident `resident` holds space `at` as her car's. */
  function claim(traffic: OpenWorldTraffic, resident: number, at: number): void {
    traffic["context"].residentSpot[resident] = at;
    traffic["context"].taken[at] = 1;
  }

  /** The space the clip for `resident` at `at` is drawn at, -1 when it is not drawn. */
  function clipSpaceAt(traffic: OpenWorldTraffic, resident: number, at: number): number {
    const spots = traffic.parkingSpots;
    return traffic.clipSpot(resident, spots.x[at]!, spots.z[at]!, spots.yaw[at]!, 0, 0);
  }

  /** Whether the clip for `resident` at `at` is drawn. */
  function clipAt(traffic: OpenWorldTraffic, resident: number, at: number): boolean {
    return clipSpaceAt(traffic, resident, at) >= 0;
  }

  /** The pool car that stands at space `at`, -1 for none. */
  function carAtSpace(field: FakeField, traffic: OpenWorldTraffic, at: number): number {
    const spots = traffic.parkingSpots;
    for (let id = 1; id < field.cars.length; id++) if (!field.cars[id]!.stored && hypot2(field.cars[id]!.group.position.x - spots.x[at]!, field.cars[id]!.group.position.z - spots.z[at]!) < KERB_JITTER_SIDE + 0.1) return id;
    return -1;
  }

  it("when a resident's claim is at another space with no car at either and the space her clip is at is another resident's claim, then a car stands there as hers, her claim is that space and the other's is her old one", () => {
    const { field, traffic, clock } = kerbWorld();
    runSeconds(field, traffic, clock, 4);
    const { spot, own } = twoSpaces(traffic);
    const RESIDENT = 7;
    const OTHER = 9;
    claim(traffic, RESIDENT, own);
    claim(traffic, OTHER, spot);
    expect(clipAt(traffic, RESIDENT, spot), "her clip is drawn").toBe(true);
    const hers = carAtSpace(field, traffic, spot);
    expect(hers, "a car stands at the space").toBeGreaterThan(0);
    expect(field.colours[hers], "in her colour").toBe(residentColour(RESIDENT));
    const context = traffic["context"];
    expect(context.residentSpot[RESIDENT], "her claim").toBe(spot);
    expect(context.residentSpot[OTHER], "the other's claim").toBe(own);
    expect([context.taken[spot], context.taken[own]].join("/"), "both spaces are still held").toBe("1/1");
  });

  it("when a resident's claim is at another space with no car at either and the space her clip is at is free, then her claim is that space and her old one is free", () => {
    const { field, traffic, clock } = kerbWorld();
    runSeconds(field, traffic, clock, 4);
    const { spot, own } = twoSpaces(traffic);
    const RESIDENT = 7;
    claim(traffic, RESIDENT, own);
    expect(clipAt(traffic, RESIDENT, spot), "her clip is drawn").toBe(true);
    const context = traffic["context"];
    expect(context.residentSpot[RESIDENT], "her claim").toBe(spot);
    expect([context.taken[spot], context.taken[own]].join("/"), "hers held, her old one free").toBe("1/0");
  });

  it("when her car is on a trip and her claim is at another space, then no clip is drawn and neither her claim nor the holder of the clip's space has moved", () => {
    const field = new FakeField();
    const traffic = makeTraffic(field, { movers: 1, kerb: 4 });
    field.cars[0]!.stand(0, 0, 0);
    const clock = new Clock();
    const RESIDENT = 7;
    const OTHER = 9;
    expect(traffic.spawnDrivenCar(RESIDENT, traffic.nearestSpot(HOME.x, HOME.z), traffic.nearestSpot(WORK.x, WORK.z)), "her car leaves on a trip").not.toBeNull();
    runSeconds(field, traffic, clock, 4);
    expect(traffic.counts().driving, "control: it is on its trip").toBe(1);
    const { spot, own } = twoSpaces(traffic);
    claim(traffic, RESIDENT, own);
    claim(traffic, OTHER, spot);
    expect(clipAt(traffic, RESIDENT, spot), "no clip while her car is on the road").toBe(false);
    const context = traffic["context"];
    expect([context.residentSpot[RESIDENT], context.residentSpot[OTHER]].join("/"), "no claim moved").toBe(`${own}/${spot}`);
    expect(carAtSpace(field, traffic, spot), "no car was brought").toBe(-1);
  });

  it("when the clip's space is one the player's car is at, so no car may be brought, then no clip is drawn and no claim has moved", () => {
    const { field, traffic, clock } = kerbWorld();
    runSeconds(field, traffic, clock, 4);
    const { spot, own } = twoSpaces(traffic);
    const spots = traffic.parkingSpots;
    const RESIDENT = 7;
    const OTHER = 9;
    claim(traffic, RESIDENT, own);
    claim(traffic, OTHER, spot);
    field.cars[0]!.stand(spots.x[spot]!, spots.z[spot]!, 0);
    traffic.drive(field.cars);
    expect(spotUnseen(traffic["context"], spot), "control: the space is not one a car may appear in").toBe(false);
    expect(clipAt(traffic, RESIDENT, spot), "no clip").toBe(false);
    const context = traffic["context"];
    expect([context.residentSpot[RESIDENT], context.residentSpot[OTHER]].join("/"), "no claim moved").toBe(`${own}/${spot}`);
    expect(carAtSpace(field, traffic, spot), "no car was brought").toBe(-1);
  });

  it("when a car stands at her claimed space and her pick is another resident's empty claim, then her clip is drawn at the space her car stands in, no claim has moved and no car is brought to her pick", () => {
    const { field, traffic, clock } = kerbWorld();
    runSeconds(field, traffic, clock, 4);
    const { spot, own } = twoSpaces(traffic);
    const RESIDENT = 7;
    const OTHER = 9;
    expect(clipAt(traffic, RESIDENT, own), "control: a car is brought to her claimed space").toBe(true);
    const hers = carAtSpace(field, traffic, own);
    expect(hers, "control: it stands there").toBeGreaterThan(0);
    claim(traffic, OTHER, spot);
    expect(clipSpaceAt(traffic, RESIDENT, spot), "the clip is where her car stands").toBe(own);
    const context = traffic["context"];
    expect([context.residentSpot[RESIDENT], context.residentSpot[OTHER]].join("/"), "no claim moved").toBe(`${own}/${spot}`);
    expect(carAtSpace(field, traffic, spot), "no car was brought to her pick").toBe(-1);
    expect(carAtSpace(field, traffic, own), "her own car, not another").toBe(hers);
  });

  it("when the player's own car is parked in a kerb space, then that space is not free for a lease, and the next one is", () => {
    const { field, traffic } = kerbWorld();
    const { spot, own } = twoSpaces(traffic);
    const spots = traffic.parkingSpots;
    expect(traffic.spotIsFree(spot), "control: empty before").toBe(true);
    field.cars[0]!.stand(spots.x[spot]!, spots.z[spot]!, spots.yaw[spot]!);
    expect(traffic.spotIsFree(spot), "the player's car is in it").toBe(false);
    expect(traffic.spotIsFree(own), "another space is free").toBe(true);
  });

  describe("given two residents of one place whose picks are one space", () => {
    /** Residents 1 and 5 pick the same of the four spaces by their door: 1 holds it, and 5's car has taken another. */
    function collidingResidents() {
      const field = quietField();
      const feed = emptyFeed(8);
      const traffic = makeTraffic(field, { movers: 0, kerb: 4 }, feed, [homeAt(KERB_HOME.x, KERB_HOME.z)]);
      const clock = new Clock();
      feed.parked.count = 2;
      for (const [at, resident] of [1, 5].entries()) {
        feed.parked.resident[at] = resident;
        feed.parked.place[at] = 0;
      }
      runSeconds(field, traffic, clock, 1);
      const near = new Int32Array(KERB_CANDIDATES);
      const pick = near[1 % kerbSpotsNear(traffic.parkingSpots, KERB_HOME.x, KERB_HOME.z, near)]!;
      const fallback = residentSpace(traffic, 5);
      expect(residentSpace(traffic, 1), "control: 1 holds the pick").toBe(pick);
      expect(fallback, "control: 5's car is at another space").not.toBe(pick);
      return { field, traffic, clock, pick, fallback };
    }

    it("when both get into their cars, then each clip is drawn beside her own car: 1's at the pick, 5's at the space her car took, in her colour, her door opening", () => {
      const { field, traffic, pick, fallback } = collidingResidents();
      expect(clipSpaceAt(traffic, 1, pick), "1's clip").toBe(pick);
      expect(clipSpaceAt(traffic, 5, pick), "5's clip, asked at the brain's pick").toBe(fallback);
      const first = carAtSpace(field, traffic, pick);
      const second = carAtSpace(field, traffic, fallback);
      expect(first, "a car stands at the pick").toBeGreaterThan(0);
      expect(second, "a car stands at the fallback").toBeGreaterThan(0);
      expect(field.colours[first], "1's colour at the pick").toBe(residentColour(1));
      expect(field.colours[second], "5's colour at the fallback").toBe(residentColour(5));
      expect(traffic.setCarDoor(5, 1), "5's door is set").toBe(true);
      expect(field.doors[second], "on her own car").toBe(1);
      expect(field.doors[first], "not on 1's").not.toBe(1);
    });

    it("when 5's clip is asked again, then it is the same space and the same car: no second car is brought", () => {
      const { field, traffic, pick, fallback } = collidingResidents();
      expect(clipSpaceAt(traffic, 1, pick), "1's clip").toBe(pick);
      expect(clipSpaceAt(traffic, 5, pick), "5's clip").toBe(fallback);
      const second = carAtSpace(field, traffic, fallback);
      expect(clipSpaceAt(traffic, 5, pick), "5's clip again").toBe(fallback);
      expect(carAtSpace(field, traffic, fallback), "the same car").toBe(second);
      expect(residentSpace(traffic, 5), "her claim has not moved").toBe(fallback);
    });
  });

  /** Every kerb car of the pool standing (after 4 s), an empty unseen space far off, and the eye at the first kerb car: its cars' ids nearest the eye first, and a way to make a car seen. */
  function fullPool() {
    const { field, traffic, clock } = kerbWorld();
    runSeconds(field, traffic, clock, 4);
    const kerb = traffic["kerb"];
    expect(kerb.shownCount(), "control: every kerb car stands").toBe(kerb.size);
    const { spot } = twoSpaces(traffic);
    const eye = field.cars[kerb.first]!.group.position;
    const eyeX = eye.x;
    const eyeZ = eye.z;
    const away = (id: number): number => hypot2(field.cars[id]!.group.position.x - eyeX, field.cars[id]!.group.position.z - eyeZ);
    const ids = Array.from({ length: kerb.size }, (_, slot) => kerb.first + slot).sort((a, b) => away(a) - away(b));
    expect(away(ids[ids.length - 1]!) > away(ids[ids.length - 2]!), "control: one car is the farthest").toBe(true);
    const context = traffic["context"];
    const seen = new Set<number>();
    Object.assign(context.sight, { hideGrace: 1, unseenFor: (sightId: number) => (seen.has(sightId) ? 0 : Infinity) });
    const see = (id: number): void => void seen.add(context.sightBase + context.movers + id - kerb.first);
    const bring = (): boolean => traffic.clipSpot(7, traffic.parkingSpots.x[spot]!, traffic.parkingSpots.z[spot]!, traffic.parkingSpots.yaw[spot]!, eyeX, eyeZ) >= 0;
    return { field, traffic, spot, ids, see, bring };
  }

  it("when every kerb car stands and a clip needs a car at an empty unseen space, then the spare farthest from the eye is moved there", () => {
    const { field, traffic, spot, ids, bring } = fullPool();
    expect(bring(), "a car stands for her").toBe(true);
    expect(carAtSpace(field, traffic, spot), "the farthest spare").toBe(ids[ids.length - 1]);
  });

  it("when the farthest spare is seen and the others are not, then the farthest unseen spare is moved, not the seen one", () => {
    const { field, traffic, spot, ids, see, bring } = fullPool();
    see(ids[ids.length - 1]!);
    expect(bring(), "a car stands for her").toBe(true);
    expect(carAtSpace(field, traffic, spot), "the farthest unseen spare").toBe(ids[ids.length - 2]);
  });

  it("when the farthest spare stands as a resident's car, then it is never taken: the next farthest is moved", () => {
    const { field, traffic, spot, ids, bring } = fullPool();
    const kerb = traffic["kerb"];
    kerb["residentOfSlot"][ids[ids.length - 1]! - kerb.first] = 5;
    expect(bring(), "a car stands for her").toBe(true);
    expect(carAtSpace(field, traffic, spot), "the next farthest").toBe(ids[ids.length - 2]);
  });

  it("when the farthest spare has had its driver thrown from it, then it is never taken: the next farthest is moved", () => {
    const { field, traffic, spot, ids, bring } = fullPool();
    Object.assign(field.cars[ids[ids.length - 1]!]!, { driverOut: {} });
    expect(bring(), "a car stands for her").toBe(true);
    expect(carAtSpace(field, traffic, spot), "the next farthest").toBe(ids[ids.length - 2]);
  });

  it("when the farthest spare is a human's, then it is never taken: the next farthest is moved", () => {
    const { field, traffic, spot, ids, bring } = fullPool();
    traffic["context"].humans[ids[ids.length - 1]!] = 1;
    expect(bring(), "a car stands for her").toBe(true);
    expect(carAtSpace(field, traffic, spot), "the next farthest").toBe(ids[ids.length - 2]);
  });
});

describe("given a peer that joins while traffic runs", () => {
  it("when the peer takes the id a driving traffic car held, then traffic stops driving it, its car is left alone and no car has two drivers", () => {
    const field = quietField();
    const traffic = makeTraffic(field, { movers: 4, kerb: 2 });
    const clock = new Clock();
    const lease = traffic.spawnDrivenCar(5, traffic.nearestSpot(HOME.x, HOME.z), traffic.nearestSpot(WORK.x, WORK.z))!;
    traffic.spawnDrivenCar(6, traffic.nearestSpot(HOME.x, HOME.z + 40), traffic.nearestSpot(WORK.x, WORK.z));
    runSeconds(field, traffic, clock, 5);
    expect(traffic.inputOf(lease.index, STEP_SECONDS), "driven before the peer").not.toBeNull();
    field.seats.add(lease.index);
    field.ports.place(lease.index, 500, 500, 0, null);
    runSeconds(field, traffic, clock, 10, () => {
      for (let id = 0; id < field.cars.length; id++) {
        if (field.seats.has(id)) expect(traffic.inputOf(id, STEP_SECONDS), `car ${id} is a human's: traffic has no input for it`).toBeNull();
      }
    });
    const peer = field.cars[lease.index]!;
    expect(lease.lost, "the lease was ended").toBe(true);
    expect(peer.stored || !peer.group.visible, "the peer's car was not put away").toBe(false);
    expect(hypot2(peer.group.position.x - 500, peer.group.position.z - 500), "the peer's car stayed where it was put").toBeLessThan(0.01);
  });

  it("when the peer takes the id a standing kerb car held, then that kerb car is no longer traffic's", () => {
    const field = new FakeField();
    const traffic = makeTraffic(field, { movers: 0, kerb: 3 });
    field.cars[0]!.stand(0, 0, 0);
    const clock = new Clock();
    runSeconds(field, traffic, clock, 4);
    const before = traffic.counts().kerb;
    expect(before, "kerb cars standing before the peer").toBeGreaterThan(0);
    const shown = field.cars.findIndex((car, id) => id > 0 && !car.stored);
    field.seats.add(shown);
    runSeconds(field, traffic, clock, 1);
    expect(traffic.counts().kerb, "kerb cars standing after the peer took one").toBeLessThan(before);
    expect(field.cars[shown]!.stored, "the peer's car is not put away").toBe(false);
  });
});

describe("given nobody stepping a peer's seat", () => {
  it("when the seated car is the only one on the field, then traffic has nothing to hold for it", () => {
    const field = quietField();
    const traffic = makeTraffic(field, { movers: 0, kerb: 0 });
    stepField(field, traffic, new Clock(), HOLD);
    expect(traffic.inputOf(0, STEP_SECONDS)).toBeNull();
  });
});

describe("given a pool the engine built as the fleet's mix, a coupe and a monster truck among its bodies", () => {
  const fleet = { movers: 12, kerb: 10, patrol: 2, ambulance: 0 };
  const patrolIds = [11, 12];

  it("when traffic starts, then every mover and kerb car wears an everyday body (the patrol cruisers apart)", () => {
    const field = quietField();
    makeTraffic(field, fleet);
    for (let id = 1; id < field.cars.length; id++) {
      if (patrolIds.includes(id)) continue;
      expect(EVERYDAY_BODIES, `car ${id} wears ${field.cars[id]!.style.id}`).toContain(field.cars[id]!.style.id);
    }
  });

  it("when a car already wears an everyday body, then it is kept, not rebuilt", () => {
    const field = quietField();
    makeTraffic(field, fleet);
    expect(field.rebuilt.length, "cars rebuilt").toBeGreaterThan(0);
    for (const id of field.rebuilt) expect(EVERYDAY_BODIES, `car ${id}'s fleet body`).not.toContain(fleetStyle(id));
  });

  it("when the patrol cruisers are marked, then traffic leaves their bodies alone", () => {
    const field = quietField();
    makeTraffic(field, fleet);
    for (const id of patrolIds) expect(field.rebuilt, `patrol car ${id}`).not.toContain(id);
  });
});

/** A sight that is looking at everything when `watched` (a player is near every car), and at nothing otherwise. */
class WatchedSight extends ProximitySight {
  watched = true;
  override near(x: number, z: number, radius: number): boolean {
    return this.watched || super.near(x, z, radius);
  }
}

describe("given a car of the traffic held still in its lane by a walker for longer than it is let stand", () => {
  const AHEAD_M = 30;
  const HELD_S = 100;
  /** By this many seconds the car has braked to a stop short of the walker. */
  const SETTLED_S = 20;

  function held(watched: boolean): { field: FakeField; traffic: OpenWorldTraffic; clock: Clock; id: number; walkers: { count: number; x: Float32Array; z: Float32Array } } {
    const field = quietField();
    const sight = new WatchedSight(field.ports);
    sight.watched = watched;
    const traffic = new OpenWorldTraffic([], field.ports, sight, { movers: 3, kerb: 0, patrol: 0, ambulance: 0 }, null);
    const car = traffic.spawnDrivenCar(3, traffic.nearestSpot(HOME.x, HOME.z), traffic.nearestSpot(WORK.x, WORK.z))!;
    const walkers = { count: 0, x: new Float32Array(1), z: new Float32Array(1) };
    traffic.setWalkers(walkers);
    const clock = new Clock();
    runSeconds(field, traffic, clock, 6);
    const body = field.cars[car.index]!;
    walkers.x[0] = body.group.position.x + detSin(body.yaw) * AHEAD_M;
    walkers.z[0] = body.group.position.z + detCos(body.yaw) * AHEAD_M;
    walkers.count = 1;
    return { field, traffic, clock, id: car.index, walkers };
  }

  it("when a player's eye is on it for 100 s, then the car is still there, and it drives on when he steps off", () => {
    const { field, traffic, clock, id, walkers } = held(true);
    const body = field.cars[id]!;
    runSeconds(field, traffic, clock, SETTLED_S);
    const at = { x: body.group.position.x, z: body.group.position.z };
    runSeconds(field, traffic, clock, HELD_S - SETTLED_S);
    expect(hypot2(body.group.position.x - at.x, body.group.position.z - at.z), "metres from where it was held: it stayed").toBeLessThan(1);
    expect(body.speed, "still held").toBeLessThan(0.3);
    walkers.count = 0;
    for (let waited = 0; waited < CYCLE_SECONDS && body.speed < 2; waited++) runSeconds(field, traffic, clock, 1);
    expect(body.speed, "under way again").toBeGreaterThan(2);
  });

  it("when no eye sees it and no player is near for 100 s, then the car is towed as before", () => {
    const { field, traffic, clock, id } = held(false);
    const body = field.cars[id]!;
    runSeconds(field, traffic, clock, SETTLED_S);
    const at = { x: body.group.position.x, z: body.group.position.z };
    runSeconds(field, traffic, clock, HELD_S - SETTLED_S);
    // Put away, the pool may stand it again at once as another trip's car: it is gone from where it was held either way.
    expect(hypot2(body.group.position.x - at.x, body.group.position.z - at.z), "metres from where it was held").toBeGreaterThan(AHEAD_M);
  });
});

describe("given cars of the traffic held still in view for longer than they are let stand, a player in view of them", () => {
  const AHEAD_M = 30;
  const HELD_S = 100;
  const SETTLED_S = 25;
  const GAP_S = 3;

  function lane(): { field: FakeField; traffic: OpenWorldTraffic; clock: Clock; first: number; walkers: { count: number; x: Float32Array; z: Float32Array } } {
    const field = quietField();
    const sight = new WatchedSight(field.ports);
    const traffic = new OpenWorldTraffic([], field.ports, sight, { movers: 4, kerb: 0, patrol: 0, ambulance: 0 }, null);
    const walkers = { count: 0, x: new Float32Array(1), z: new Float32Array(1) };
    traffic.setWalkers(walkers);
    const clock = new Clock();
    const first = traffic.spawnDrivenCar(3, traffic.nearestSpot(HOME.x, HOME.z), traffic.nearestSpot(WORK.x, WORK.z))!;
    runSeconds(field, traffic, clock, 6);
    return { field, traffic, clock, first: first.index, walkers };
  }

  /** How far (m) car `id` moved over `seconds`, after `SETTLED_S` of braking. */
  function movedWhile(run: { field: FakeField; traffic: OpenWorldTraffic; clock: Clock }, ids: number[], seconds: number): number[] {
    const before = ids.map((id) => ({ x: run.field.cars[id]!.group.position.x, z: run.field.cars[id]!.group.position.z }));
    runSeconds(run.field, run.traffic, run.clock, seconds);
    return ids.map((id, at) => hypot2(run.field.cars[id]!.group.position.x - before[at]!.x, run.field.cars[id]!.group.position.z - before[at]!.z));
  }

  it("when a mover is held 100 s behind a car nobody drives, then it is towed as on the base: a jam that a person does not hold is not waited out in view", () => {
    const run = lane();
    const body = run.field.cars[run.first]!;
    run.field.cars[0]!.stand(body.group.position.x + detSin(body.yaw) * AHEAD_M, body.group.position.z + detCos(body.yaw) * AHEAD_M, body.yaw);
    runSeconds(run.field, run.traffic, run.clock, SETTLED_S);
    expect(movedWhile(run, [run.first], 1)[0], "control: it stands behind the parked car").toBeLessThan(0.5);
    const [moved] = movedWhile(run, [run.first], HELD_S);
    expect(moved, "metres it moved while held: gone from where it stood").toBeGreaterThan(AHEAD_M / 2);
  });

  it("when a mover is queued behind a mover a walker holds, then neither is towed in view in 100 s", () => {
    const run = lane();
    const lead = run.field.cars[run.first]!;
    const second = run.traffic.spawnDrivenCar(4, run.traffic.nearestSpot(HOME.x, HOME.z), run.traffic.nearestSpot(WORK.x, WORK.z))!;
    run.walkers.x[0] = lead.group.position.x + detSin(lead.yaw) * AHEAD_M;
    run.walkers.z[0] = lead.group.position.z + detCos(lead.yaw) * AHEAD_M;
    run.walkers.count = 1;
    runSeconds(run.field, run.traffic, run.clock, SETTLED_S + 3 * GAP_S);
    const moved = movedWhile(run, [run.first, second.index], HELD_S);
    expect(moved[0], "the leader stayed").toBeLessThan(1);
    expect(moved[1], "the car queued behind him stayed").toBeLessThan(1);
  });
});

describe("given people on the streets and a car of the traffic on its trip", () => {
  const AHEAD_M = 30;
  const WAIT_S = 8;
  const UNDER_WAY_MPS = 2;

  function onTheWay(): { field: FakeField; traffic: OpenWorldTraffic; clock: Clock; car: DrivenCar; people: { count: number; x: Float32Array; z: Float32Array; shown: Uint8Array } } {
    const field = quietField();
    const traffic = makeTraffic(field, { movers: 3, kerb: 0 });
    const car = traffic.spawnDrivenCar(3, traffic.nearestSpot(HOME.x, HOME.z), traffic.nearestSpot(WORK.x, WORK.z))!;
    const people = { count: 1, x: new Float32Array(1), z: new Float32Array(1), shown: new Uint8Array(1) };
    traffic.setPeople(people);
    return { field, traffic, clock: new Clock(), car, people };
  }

  it("when someone steps into its lane ahead, then the car stops short of her and waits, and goes on when she has crossed", () => {
    const { field, traffic, clock, car, people } = onTheWay();
    runSeconds(field, traffic, clock, 6);
    const body = field.cars[car.index]!;
    expect(body.speed, "it is under way").toBeGreaterThan(3);
    people.x[0] = body.group.position.x + detSin(body.yaw) * AHEAD_M;
    people.z[0] = body.group.position.z + detCos(body.yaw) * AHEAD_M;
    people.shown[0] = 1;
    runSeconds(field, traffic, clock, WAIT_S);
    expect(body.speed, "it waits for her").toBeLessThan(0.3);
    expect(hypot2(people.x[0]! - body.group.position.x, people.z[0]! - body.group.position.z), "clear of her").toBeGreaterThan(PERSON_GAP - 1);
    people.shown[0] = 0;
    // The signal ahead may be red for a while (the clock is early in the cycle): the wait is up to a whole cycle.
    for (let waited = 0; waited < CYCLE_SECONDS && body.speed < UNDER_WAY_MPS; waited++) runSeconds(field, traffic, clock, 1);
    expect(body.speed, "it is under way again").toBeGreaterThan(UNDER_WAY_MPS);
  });
});
