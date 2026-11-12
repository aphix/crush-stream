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
import { kerbSpotsNear } from "../../world/openworld/openworld-parking.ts";
import { residentBody, residentColour, type ResidentCarPose } from "./traffic-look.ts";
import { spotUnseen } from "./traffic-ports.ts";
import { Clock, CYCLE_SECONDS, emptyFeed, FakeField, HOLD, homeAt, makeTraffic, ProximitySight, runSeconds, STEP_SECONDS, stepField } from "./traffic-world.test-util.ts";

const FAR = 1500;
const HOME = { x: -100, z: -45 };
const WORK = { x: 120, z: 60 };
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
  // mutation: sed -i 's/    for (let id = first; id < first + this.total; id++) ports.putAway(id);/    \/\/ none put away/' src/game/ai/openworld-traffic/openworld-traffic.ts
  it("when traffic starts, then every pool car is put away (hidden and not simulated) before anything else reads them", () => {
    const field = quietField();
    makeTraffic(field, { movers: 12, kerb: 10, patrol: 2, ambulance: 0 });
    expect(field.cars.length, "the pool's cars were built").toBe(1 + 12 + 10);
    for (let id = 1; id < field.cars.length; id++) {
      const car = field.cars[id]!;
      expect(car.stored && !car.group.visible, `car ${id} at (${car.group.position.x}, ${car.group.position.z}) is ${car.stored ? "stored" : "simulated"} and ${car.group.visible ? "shown" : "hidden"}`).toBe(true);
    }
  });

  // mutation: sed -i 's/      if (car.group.visible || !car.stored) ports.putAway(id);/      \/\/ left as found/' src/game/ai/openworld-traffic/kerb-cars.ts
  // mutation: sed -i 's/    if (car.group.visible || !car.stored) {/    if (false) {/' src/game/ai/openworld-traffic/mover-fleet.ts
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
  // mutation: sed -i 's/    sight.release(sightBase, this.total + 1);/    \/\/ ids kept/' src/game/ai/openworld-traffic/openworld-traffic.ts
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
  // mutation: sed -i 's/    ports.ensureCars(first + this.total);/    ports.ensureCars(first);/' src/game/ai/openworld-traffic/openworld-traffic.ts
  it("when traffic starts, then the field holds the seated car and one real car for every mover and kerb car, the pool past the seats", () => {
    const field = quietField();
    makeTraffic(field, { movers: 5, kerb: 3 });
    expect(field.cars.length).toBe(1 + 5 + 3);
  });

  // mutation: sed -i 's/const lateral = network.laneOffset + (network.parkingOffset - network.laneOffset) \* smoothStep(step \/ SWING_STEPS);/const lateral = network.laneOffset;/' src/game/ai/openworld-traffic/trip-route.ts
  // mutation: sed -i 's/    taken\[destination\] = 1;/    \/\/ taken[destination] = 1;/' src/game/ai/openworld-traffic/mover-fleet.ts
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

  // mutation: sed -i 's/    taken\[destination\] = 1;/    \/\/ taken[destination] = 1;/' src/game/ai/openworld-traffic/mover-fleet.ts
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

  // mutation: sed -i 's/    return ambient;/    return ambient < 0 ? 0 : ambient;/' src/game/ai/openworld-traffic/mover-fleet.ts
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

  // mutation: sed -i 's/return handle.driver !== null ?/return handle.driver === undefined ?/' src/game/ai/openworld-traffic/mover-fleet.ts
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

  // mutation: sed -i 's/      if (body !== null \&\& ports.cars()\[id\]!.style.id !== body) ports.setBody(id, body);/      \/\/ own body/' src/game/ai/openworld-traffic/mover-fleet.ts
  // mutation: sed -i 's/paint === NO_COLOUR ? null : paint);/null);/' src/game/ai/openworld-traffic/mover-fleet.ts
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

  // mutation: sed -i 's/    this.context.ports.openDoor(id, radians);/    this.context.ports.openDoor(id, 0);/' src/game/ai/openworld-traffic/openworld-traffic.ts
  // mutation: sed -i 's/    return id < 0 ? null : this.context.ports.cars()\[id\]!.style.id;/    return id < 0 ? null : "sedan";/' src/game/ai/openworld-traffic/openworld-traffic.ts
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

  // mutation: sed -i 's/    if (slot < 0 || slot >= this.size || this.state\[slot\] !== MOVER.driving || this.kindOf(slot) !== LEASE.ambient || this.context.ports.seated(carId)) return false;/    if (slot < 0 || slot >= this.size) return false;/' src/game/ai/openworld-traffic/mover-fleet.ts
  it("when a parked car, a patrol car or a human's car is named as chased, then it is refused; a car on a trip is taken", () => {
    const { field, traffic, car } = chasedWorld();
    expect(traffic.evade(car.index, 0), "a car on a trip").toBe(true);
    const parked = field.cars.findIndex((other, id) => id > 0 && id !== car.index && !other.stored);
    if (parked > 0) expect(traffic.evade(parked, 0), "a car standing parked").toBe(false);
    const patrol = traffic.spawnDrivenCar(-1, traffic.nearestSpot(HOME.x, HOME.z + 40), traffic.nearestSpot(WORK.x, WORK.z), { urgent: true })!;
    expect(traffic.evade(patrol.index, 0), "a patrol car").toBe(false);
    expect(traffic.evade(0, 0), "the human's car").toBe(false);
  });

  // mutation: sed -i 's/    if (best >= 0) this.rerouteFrom(slot, best);/    \/\/ no run/' src/game/ai/openworld-traffic/mover-fleet.ts
  it("when the chaser is on it, then it runs on past the end of its trip to far spaces and does not park", () => {
    const { field, traffic, clock, car } = chasedWorld();
    expect(traffic.evade(car.index, 0)).toBe(true);
    runSeconds(field, traffic, clock, 40);
    expect(traffic.isFleeing(car.index), "it noticed the chaser and runs").toBe(true);
    expect(car.arrived, "a run of a few hundred metres is not over").toBe(false);
    expect(field.cars[car.index]!.speed, "still driving").toBeGreaterThan(5);
  });

  // mutation: sed -i 's/  endEvade(carId: number): void {/  endEvade(carId: number): void {\n    if (carId >= 0) return;/' src/game/ai/openworld-traffic/mover-fleet.ts
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

  // mutation: sed -i 's/    if (kind === LEASE.ambulance) ports.sirens(id, true);/    \/\/ no lights/' src/game/ai/openworld-traffic/mover-fleet.ts
  // mutation: sed -i 's/const paint = kind === LEASE.ambulance ? AMBULANCE_COLOUR : /const paint = /' src/game/ai/openworld-traffic/mover-fleet.ts
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

  // mutation: sed -i 's/seconds - this.since >= AMBULANCE_LOAD_SECONDS/seconds - this.since >= 0/' src/game/ai/openworld-traffic/ambulance.ts
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

  // mutation: sed -i 's/      if (this.queued >= AMBULANCE_QUEUE) return false;/      return false;/' src/game/ai/openworld-traffic/ambulance.ts
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

  // mutation: sed -i 's/      if (this.queued >= AMBULANCE_QUEUE) return false;/      if (false) return false;/' src/game/ai/openworld-traffic/ambulance.ts
  it("when more calls wait than the queue holds, then the one past it is refused", () => {
    const { traffic } = ambulanceWorld();
    expect(traffic.callAmbulance(SCENE.x, SCENE.z, 0), "the one it goes to").toBe(true);
    for (let waiting = 0; waiting < AMBULANCE_QUEUE; waiting++) expect(traffic.callAmbulance(SCENE.x + 10 + waiting, SCENE.z, 0), `waiting call ${waiting}`).toBe(true);
    expect(traffic.callAmbulance(SCENE.x + 50, SCENE.z, 0), "past the queue").toBe(false);
  });

  // mutation: sed -i 's/      this.onLoaded?.(this.victim);/      \/\/ nobody told/' src/game/ai/openworld-traffic/ambulance.ts
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

  // mutation: sed -i 's/this.kindOf(slot) !== kind) continue;/false) continue;/' src/game/ai/openworld-traffic/mover-fleet.ts
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

  // mutation: sed -i 's/      residentSpot\[resident\] = CARLESS;/      residentSpot[resident] = -1;/' src/game/ai/openworld-traffic/openworld-traffic.ts
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

  // mutation: sed -i 's/    return this.movers.isParked(id) || this.kerb.holds(id);/    return this.movers.isParked(id);/' src/game/ai/openworld-traffic/openworld-traffic.ts
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

  // mutation: sed -i 's/      const matches = body !== null \&\& car.style.id === body;/      const matches = false;/' src/game/ai/openworld-traffic/kerb-cars.ts
  // mutation: sed -i 's/    return freeMatch >= 0 ? freeMatch : free >= 0 ? free : ambientMatch >= 0 ? ambientMatch : ambient;/    return free >= 0 ? free : ambient;/' src/game/ai/openworld-traffic/mover-fleet.ts
  it("when a car of each body is among the pool, then no car is rebuilt for a body: each resident gets a pool car that wears his", () => {
    const field = new FakeField();
    const feed = parkedFeed(BODIES_ASKED);
    const traffic = makeTraffic(field, { movers: 6, kerb: 6 }, feed, [homeAt(HOME.x, HOME.z)]);
    const base = field.rebuilt.length;
    field.cars[0]!.stand(HOME.x, HOME.z + 10, 0);
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

  // mutation: sed -i 's/ \&\& this.context.swaps.allows(this.seconds) \&\& spotUnseen(this.context, spot)) {/) {/' src/game/ai/openworld-traffic/kerb-cars.ts
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

  // mutation: sed -i 's/    if (this.seconds > this.dueAt\[slot\]! \&\& this.unseenAndFar(slot, car)) this.standInSpace(slot);/    if (false) this.standInSpace(slot);/' src/game/ai/openworld-traffic/mover-fleet.ts
  it("when the rider's second comes with the car still on the road and no one near it, then the car stands in its space, parked and still", () => {
    const { field, traffic, clock, car, to } = dueCar({ x: FAR, z: FAR });
    runSeconds(field, traffic, clock, DUE_SECONDS + 1);
    const spots = traffic.parkingSpots;
    const at = field.cars[car.index]!.group.position;
    expect(car.arrived, "arrived").toBe(true);
    expect(hypot2(at.x - spots.x[to]!, at.z - spots.z[to]!), "the car's distance from its space's middle").toBeLessThan(0.01);
    expect(field.cars[car.index]!.speed, "standing").toBeLessThan(0.01);
  });

  // mutation: sed -i 's/ \&\& this.unseenAndFar(slot, car)) this.standInSpace(slot);/) this.standInSpace(slot);/' src/game/ai/openworld-traffic/mover-fleet.ts
  it("when a player's car is near it at that second, then the car is not moved: it drives on and parks when it gets there", () => {
    const { field, traffic, clock, car } = dueCar(FAR_AWAY);
    field.cars[0]!.stand(HOME.x, HOME.z + 10, 0);
    runSeconds(field, traffic, clock, DUE_SECONDS + 1);
    expect(car.arrived, "still on the road at the second").toBe(false);
  });
});

describe("given residents whose cars stand at a place's kerb", () => {
  // mutation: sed -i 's/      const spot = this.candidates\[(resident + step) % count\]!;/      const spot = this.candidates[step]!;/' src/game/ai/openworld-traffic/openworld-traffic.ts
  it("when two residents of one place have cars, then each holds a different one of the four empty spaces nearest its door, the one he is by number", () => {
    const field = quietField();
    const feed = emptyFeed(8);
    const traffic = makeTraffic(field, { movers: 0, kerb: 0 }, feed, [homeAt(HOME.x, HOME.z)]);
    const clock = new Clock();
    feed.parked.count = 2;
    feed.parked.resident[0] = 1;
    feed.parked.place[0] = 0;
    feed.parked.resident[1] = 2;
    feed.parked.place[1] = 0;
    runSeconds(field, traffic, clock, 1);
    const near = new Int32Array(KERB_CANDIDATES);
    const count = kerbSpotsNear(traffic.parkingSpots, HOME.x, HOME.z, near);
    const held = Array.from(traffic.claimedSpots.keys()).filter((spot) => traffic.claimedSpots[spot] === 1);
    const wanted = [near[1 % count]!, near[2 % count]!].sort((a, b) => a - b);
    held.sort((a, b) => a - b);
    expect(held.length, "spaces held").toBe(2);
    expect(held[0], "the lower space held").toBe(wanted[0]);
    expect(held[1], "the higher space held").toBe(wanted[1]);
  });
});

describe("given a patrol car on an urgent trip that is sent somewhere else on its way", () => {
  const ELSEWHERE = { x: -150, z: 80 };

  // mutation: sed -i 's/    this.routes\[slot\] = this.spareRoute;/    this.routes[slot] = old;/' src/game/ai/openworld-traffic/mover-fleet.ts
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

  // mutation: sed -i 's/ || spots.stays\[toSpot\] === 1 || taken\[toSpot\] === 1) return false;/) return false;/' src/game/ai/openworld-traffic/mover-fleet.ts
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

  // mutation: sed -i 's/if (before >= -network.stopBar || now < -network.stopBar) continue;/continue;/' src/game/ai/openworld-traffic/red-light-watch.ts
  it("when it crosses on red, then the red-light run is raised once, for the player's car", () => {
    const runs = walk(crossing, timeWhere(true));
    expect(runs.length).toBe(1);
    expect(runs[0]!.id).toBe(0);
    expect(Math.abs(runs[0]!.x - barX)).toBeLessThan(1);
  });

  // mutation: sed -i 's/if (!hadLast || seconds < this.quietUntil\[id\]! || hypot2/if (!hadLast || hypot2/' src/game/ai/openworld-traffic/red-light-watch.ts
  it("when it crosses back and forth on red, then the run is still raised once", () => {
    const back = [...crossing].reverse();
    expect(walk([...crossing, ...back, ...crossing], timeWhere(true)).length).toBe(1);
  });

  // mutation: sed -i 's/if (lightState(junction, through, seconds) !== LIGHT.red || lightState(junction, through + 1, seconds) !== LIGHT.red) continue;/\/\/ any light/' src/game/ai/openworld-traffic/red-light-watch.ts
  it("when it crosses on green, then no run is raised", () => {
    expect(walk(crossing, timeWhere(false)).length).toBe(0);
  });

  // mutation: sed -i 's/if (!urgent) target = Math.min(target, this.signalLimit/if (urgent) target = Math.min(target, this.signalLimit/' src/game/ai/openworld-traffic/traffic-driver.ts
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

  // mutation: sed -i 's/if (spots.stays\[spot\] === 1) stays.push(spot);/stays.push(spot);/' src/game/ai/openworld-traffic/kerb-cars.ts
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

  // mutation: sed -i 's/const gone = this.wreckedFor\[slot\]! > TOW_SECONDS || (!sight.near(x, z, KERB_KEEP) && sight.unseenFor(sightId) >= sight.hideGrace);/const gone = false;/' src/game/ai/openworld-traffic/kerb-cars.ts
  it("when the player drives far away, then the kerb cars are put away", () => {
    const { field, traffic, clock } = kerbWorld();
    runSeconds(field, traffic, clock, 4);
    field.cars[0]!.stand(FAR, FAR, 0);
    runSeconds(field, traffic, clock, 2);
    expect(traffic.counts().kerb).toBe(0);
    for (let id = 1; id < field.cars.length; id++) expect(field.cars[id]!.stored, `car ${id} put away`).toBe(true);
  });

  // mutation: sed -i 's/^const CLIP_HOLD_SECONDS = 4;/const CLIP_HOLD_SECONDS = 0;/' src/game/ai/openworld-traffic/openworld-traffic.ts
  it("when a resident's clip starts at an empty space no eye sees, then a kerb car stands there in her colour as hers, her door opens, the space is refused to another resident, and the car is kept through the clip though no player is near, then put away", () => {
    const { field, traffic, clock } = kerbWorld();
    runSeconds(field, traffic, clock, 4);
    const spots = traffic.parkingSpots;
    const RESIDENT = 7;
    let spot = -1;
    for (let at = 0; at < spots.count; at++) if (spots.stays[at] !== 1 && (spot < 0 || hypot2(spots.x[at]!, spots.z[at]!) > hypot2(spots.x[spot]!, spots.z[spot]!))) spot = at;
    expect(hypot2(spots.x[spot]!, spots.z[spot]!), "control: the space is past KERB_KEEP of the player, where a car nobody holds is put away").toBeGreaterThan(KERB_KEEP);
    expect(traffic.carForClip(RESIDENT, spots.x[spot]!, spots.z[spot]!, spots.yaw[spot]!, 0, 0), "a car stands for her").toBe(true);
    // The pool stands a put-away car at another kerb space in the same pass, so her car's id is no mark of it: what stands at her space is.
    const standsAtHerSpace = (): boolean => field.cars.some((car, id) => id > 0 && !car.stored && hypot2(car.group.position.x - spots.x[spot]!, car.group.position.z - spots.z[spot]!) < KERB_JITTER_SIDE + 0.1);
    let hers = -1;
    for (let id = 1; id < field.cars.length; id++) if (!field.cars[id]!.stored && hypot2(field.cars[id]!.group.position.x - spots.x[spot]!, field.cars[id]!.group.position.z - spots.z[spot]!) < KERB_JITTER_SIDE + 0.1) hers = id;
    expect(hers, "a pool car stands at her space").toBeGreaterThan(0);
    expect(field.colours[hers], "in her colour").toBe(residentColour(RESIDENT));
    expect(traffic.setCarDoor(RESIDENT, 1), "it is hers: her door is set").toBe(true);
    expect(field.doors[hers], "her door").toBe(1);
    expect(traffic.carForClip(RESIDENT, spots.x[spot]!, spots.z[spot]!, spots.yaw[spot]!, 0, 0), "asked again: it is there").toBe(true);
    expect(traffic.carForClip(RESIDENT + 1, spots.x[spot]!, spots.z[spot]!, spots.yaw[spot]!, 0, 0), "the space is hers: refused to another").toBe(false);
    runSeconds(field, traffic, clock, 1);
    expect(standsAtHerSpace(), "kept through the clip").toBe(true);
    runSeconds(field, traffic, clock, 5);
    expect(standsAtHerSpace(), "put away after the hold").toBe(false);
  });

  // mutation: sed -i '/^    if (this.movers.hasTripFor(resident)) return false;/d' src/game/ai/openworld-traffic/openworld-traffic.ts
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
    expect(traffic.carForClip(RESIDENT, spots.x[spot]!, spots.z[spot]!, spots.yaw[spot]!, 0, 0), "no car stands for her: hers is on the road").toBe(false);
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

  /** Whether the clip for `resident` at `at` is drawn. */
  function clipAt(traffic: OpenWorldTraffic, resident: number, at: number): boolean {
    const spots = traffic.parkingSpots;
    return traffic.carForClip(resident, spots.x[at]!, spots.z[at]!, spots.yaw[at]!, 0, 0);
  }

  /** The pool car that stands at space `at`, -1 for none. */
  function carAtSpace(field: FakeField, traffic: OpenWorldTraffic, at: number): number {
    const spots = traffic.parkingSpots;
    for (let id = 1; id < field.cars.length; id++) if (!field.cars[id]!.stored && hypot2(field.cars[id]!.group.position.x - spots.x[at]!, field.cars[id]!.group.position.z - spots.z[at]!) < KERB_JITTER_SIDE + 0.1) return id;
    return -1;
  }

  // mutation: sed -i 's/residentSpot\[this.holderOf(spot)\] = own;/void own;/' src/game/ai/openworld-traffic/openworld-traffic.ts
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

  // mutation: sed -i 's/^    else taken\[own\] = 0;/    else taken[own] = 1;/' src/game/ai/openworld-traffic/openworld-traffic.ts
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

  // mutation: sed -i '/^    if (this.movers.hasTripFor(resident)) return false;/d' src/game/ai/openworld-traffic/openworld-traffic.ts
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

  // mutation: sed -i 's/    if (!this.kerb.bring(spot, resident, eyeX, eyeZ, CLIP_HOLD_SECONDS)) return false;/    this.kerb.bring(spot, resident, eyeX, eyeZ, CLIP_HOLD_SECONDS);/' src/game/ai/openworld-traffic/openworld-traffic.ts
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

  // mutation: sed -i '/^    if (standing\[own\] !== STANDING.none || standing\[spot\] !== STANDING.none) return false;/d' src/game/ai/openworld-traffic/openworld-traffic.ts
  it("when a car stands at her claimed space, then her clip at another space is not drawn and no claim has moved", () => {
    const { field, traffic, clock } = kerbWorld();
    runSeconds(field, traffic, clock, 4);
    const { spot, own } = twoSpaces(traffic);
    const RESIDENT = 7;
    const OTHER = 9;
    expect(clipAt(traffic, RESIDENT, own), "control: a car is brought to her claimed space").toBe(true);
    expect(carAtSpace(field, traffic, own), "control: it stands there").toBeGreaterThan(0);
    claim(traffic, OTHER, spot);
    expect(clipAt(traffic, RESIDENT, spot), "no clip: her car stands elsewhere").toBe(false);
    const context = traffic["context"];
    expect([context.residentSpot[RESIDENT], context.residentSpot[OTHER]].join("/"), "no claim moved").toBe(`${own}/${spot}`);
    expect(carAtSpace(field, traffic, spot), "no car was brought").toBe(-1);
  });
});

describe("given a peer that joins while traffic runs", () => {
  // mutation: sed -i 's/ || this.context.ports.seated(id)) return null;/) return null;/' src/game/ai/openworld-traffic/mover-fleet.ts
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

  // mutation: sed -i 's/    if (ports.seated(id)) {/    if (false) {/' src/game/ai/openworld-traffic/kerb-cars.ts
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

  // mutation: sed -i 's/if (!EVERYDAY_BODIES.includes(style)) ports.setBody/if (false) ports.setBody/' src/game/ai/openworld-traffic/openworld-traffic.ts
  it("when traffic starts, then every mover and kerb car wears an everyday body (the patrol cruisers apart)", () => {
    const field = quietField();
    makeTraffic(field, fleet);
    for (let id = 1; id < field.cars.length; id++) {
      if (patrolIds.includes(id)) continue;
      expect(EVERYDAY_BODIES, `car ${id} wears ${field.cars[id]!.style.id}`).toContain(field.cars[id]!.style.id);
    }
  });

  // mutation: sed -i 's/if (!EVERYDAY_BODIES.includes(style)) ports.setBody/if (true) ports.setBody/' src/game/ai/openworld-traffic/openworld-traffic.ts
  it("when a car already wears an everyday body, then it is kept, not rebuilt", () => {
    const field = quietField();
    makeTraffic(field, fleet);
    expect(field.rebuilt.length, "cars rebuilt").toBeGreaterThan(0);
    for (const id of field.rebuilt) expect(EVERYDAY_BODIES, `car ${id}'s fleet body`).not.toContain(fleetStyle(id));
  });

  // mutation: sed -i 's/      if (id >= this.patrolFrom && id < this.patrolEnd) continue;/      \/\/ no skip/' src/game/ai/openworld-traffic/openworld-traffic.ts
  it("when the patrol cruisers are marked, then traffic leaves their bodies alone", () => {
    const field = quietField();
    makeTraffic(field, fleet);
    for (const id of patrolIds) expect(field.rebuilt, `patrol car ${id}`).not.toContain(id);
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

  // mutation: sed -i 's/    this.driver.people = people;/    this.driver.people = null;/' src/game/ai/openworld-traffic/openworld-traffic.ts
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
